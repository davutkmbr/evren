/**
 * Integration test of the online API (worker/) against a running Worker: accounts, profiles, the game rooms and their
 * checks. Exit code 1 on any failure.
 *
 *   npx wrangler d1 migrations apply seventeen-skies --local
 *   npm run build && node scripts/deploy/stage.mjs
 *   npx wrangler dev --port 8799 --ip 127.0.0.1 --local-upstream 127.0.0.1:8799   # keeps Host / Origin local
 *   npx tsx scripts/net/online-api-test.mts [--base http://127.0.0.1:8799]
 *
 * Every run makes fresh guest accounts with random nicknames and deletes them at the end; room tests use the
 * `adalar` and `halic` servers. Each test player sends its own CF-Connecting-IP (wrangler dev would give them all
 * 127.0.0.1, and sign-ins are limited per IP); every wait has a timeout, so a broken server fails instead of hanging.
 */
import WebSocket from 'ws';
import { createSnapshot, decodeSnapshot, encodeSnapshot } from '../../src/net/snapshot';
import { MAX_PLAYERS, PROTOCOL_VERSION } from '../../src/net/protocol';

const argBase = process.argv.indexOf('--base');
const BASE = argBase > 0 ? process.argv[argBase + 1] : 'http://127.0.0.1:8799';
const WS_BASE = BASE.replace(/^http/, 'ws');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The promise, or `fallback` after `ms`. */
const within = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> => Promise.race([p, sleep(ms).then(() => fallback)]);
let ipCounter = 0;
/** A distinct private-range address per test player. */
const nextIp = () => `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
const tag = Math.random().toString(36).slice(2, 7);

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) {
    failures++;
  }
}

/** A guest with its own cookie jar. */
class Player {
  private cookies = new Map<string, string>();
  private readonly ip = nextIp();
  constructor(readonly nickname: string) {}

  get cookie(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async call(path: string, init: { method?: string; body?: unknown; origin?: string | null } = {}) {
    const headers: Record<string, string> = { Cookie: this.cookie, 'Content-Type': 'application/json', 'CF-Connecting-IP': this.ip };
    if (init.origin !== null) {
      headers.Origin = init.origin ?? BASE;
    }
    const res = await fetch(BASE + path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    for (const h of res.headers.getSetCookie()) {
      const [kv] = h.split(';');
      const i = kv.indexOf('=');
      const v = kv.slice(i + 1);
      if (v) {
        this.cookies.set(kv.slice(0, i), v);
      } else {
        this.cookies.delete(kv.slice(0, i));
      }
    }
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  async join(): Promise<void> {
    await this.call('/api/auth/sign-in/anonymous', { method: 'POST', body: {} });
    await this.call('/api/me/profile', { method: 'PUT', body: { nickname: this.nickname } });
  }

  socket(server: string, origin: string = BASE) {
    const ws = new WebSocket(`${WS_BASE}/api/servers/${server}/ws`, { headers: { Origin: origin, Cookie: this.cookie } });
    const texts: any[] = [];
    const snaps: { id: number; x: number }[] = [];
    ws.on('message', (data: Buffer, binary: boolean) => {
      if (!binary) {
        texts.push(JSON.parse(String(data)));
        return;
      }
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const v = new DataView(buf);
      for (let i = 0, n = v.getUint16(1, true); i < n; i++) {
        const o = 3 + i * 69;
        snaps.push({ id: v.getUint16(o, true), x: decodeSnapshot(buf, o + 2).position[0] });
      }
    });
    const opened = within(new Promise<string>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION }));
        resolve('open');
      });
      ws.on('unexpected-response', (_req, res) => resolve(`http ${res.statusCode}`));
      ws.on('error', () => resolve('error'));
    }), 5000, 'timeout');
    const closed = within(new Promise<number>((resolve) => ws.on('close', (code) => resolve(code))), 5000, -1);
    return { ws, texts, snaps, opened, closed };
  }
}

function snapshot(x: number, t: number, teleport = false): ArrayBuffer {
  const s = createSnapshot();
  s.t = t;
  s.position = [x, 200, 0];
  s.teleport = teleport;
  return encodeSnapshot(s);
}

async function main(): Promise<void> {
  // Accounts and profiles.
  const a = new Player(`Işıl ${tag}`);
  const b = new Player(`Bora ${tag}`);
  const me0 = await a.call('/api/me');
  check('signed out: /api/me answers 200 with user null', me0.status === 200 && me0.body?.user === null, me0);
  check('guest sign-in', (await a.call('/api/auth/sign-in/anonymous', { method: 'POST', body: {} })).status === 200);
  const me1 = await a.call('/api/me');
  check('guest account without profile', me1.body?.user?.guest === true && me1.body?.profile === null, me1.body);
  check('no profile: room refuses (403)', (await a.socket('adalar').opened) === 'http 403');
  check('invalid nickname (400)', (await a.call('/api/me/profile', { method: 'PUT', body: { nickname: '<x>' } })).status === 400);
  check('write without Origin (403)', (await a.call('/api/me/profile', { method: 'PUT', body: { nickname: a.nickname }, origin: null })).status === 403);
  check('nickname saved', (await a.call('/api/me/profile', { method: 'PUT', body: { nickname: a.nickname } })).body?.profile?.nickname === a.nickname);
  await b.call('/api/auth/sign-in/anonymous', { method: 'POST', body: {} });
  const taken = await b.call('/api/me/profile', { method: 'PUT', body: { nickname: a.nickname.toLocaleLowerCase('tr') } });
  check('nickname unique with Turkish case folding (409)', taken.status === 409, taken);
  await b.call('/api/me/profile', { method: 'PUT', body: { nickname: b.nickname } });

  // Rooms: access.
  check('room without session (401)', (await new Player('x').socket('adalar').opened) === 'http 401');
  check('room from another origin (403)', (await a.socket('adalar', 'https://evil.example').opened) === 'http 403');
  const list = await a.call('/api/servers');
  check('server list', Array.isArray(list.body?.servers) && list.body.servers.length > 0, list.body);

  // Rooms: relay and names from profiles.
  const sa = a.socket('adalar');
  await sa.opened;
  await sleep(300);
  check('welcome', sa.texts[0]?.type === 'welcome', sa.texts[0]);
  const sb = b.socket('adalar');
  await sb.opened;
  await sleep(300);
  const aId = sa.texts[0]?.id;
  check('name comes from the profile', sb.texts[0]?.players?.some((p: any) => p.id === aId && p.name === a.nickname), sb.texts[0]);
  for (let i = 0; i < 5; i++) {
    sa.ws.send(snapshot(i * 5, i * 100));
    await sleep(100);
  }
  await sleep(300);
  check('snapshots relayed', sb.snaps.filter((s) => s.id === aId).length >= 3, sb.snaps.length);
  const before = sb.snaps.length;
  sa.ws.send(snapshot(5000, 600));
  await sleep(300);
  check('speed jump dropped', sb.snaps.length === before);
  sa.ws.send(snapshot(5000, 700, true));
  await sleep(300);
  check('teleport accepted', sb.snaps.at(-1)?.x === 5000);
  sa.ws.send(snapshot(9000, 800, true));
  await sleep(300);
  check('second teleport inside the cooldown dropped', sb.snaps.at(-1)?.x === 5000);
  sa.ws.send(snapshot(99999, 900));
  await sleep(300);
  check('out of the world dropped', sb.snaps.at(-1)?.x === 5000);
  const sa2 = a.socket('adalar');
  await sa2.opened;
  await sleep(400);
  const replacedCode = await sa.closed;
  check('same account again replaces the old seat', sa.texts.at(-1)?.code === 'replaced' && replacedCode === 4000, { last: sa.texts.at(-1), replacedCode });
  check('new seat welcomed', sa2.texts[0]?.type === 'welcome');
  sa2.ws.close();
  sb.ws.close();
  await sleep(300);

  // Rooms: capacity and flooding.
  const crowd: Player[] = [];
  const sockets: ReturnType<Player['socket']>[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = new Player(`K${tag}${i}`);
    await p.join();
    crowd.push(p);
    const s = p.socket('halic');
    await s.opened;
    sockets.push(s);
  }
  await sleep(500);
  const extra = new Player(`F${tag}`);
  await extra.join();
  const extraSocket = extra.socket('halic');
  await extraSocket.opened;
  const extraCode = await extraSocket.closed;
  check(`player ${MAX_PLAYERS + 1} refused (full)`, extraSocket.texts[0]?.code === 'full' && extraCode === 4000, extraSocket.texts[0]);
  const flooder = sockets[0];
  for (let i = 0; i < 300; i++) {
    flooder.ws.send(snapshot(0, i));
  }
  const floodCode = await flooder.closed;
  check('flood closes the socket (4001)', floodCode === 4001, floodCode);
  sockets.forEach((s) => s.ws.close());
  await sleep(500);

  // Sign-in limit per IP (production sets CF-Connecting-IP; locally the test sends it).
  const statuses: number[] = [];
  const limitedIp = `203.0.113.${(Date.now() % 200) + 1}`;
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${BASE}/api/auth/sign-in/anonymous`, {
      method: 'POST',
      headers: { Origin: BASE, 'Content-Type': 'application/json', 'CF-Connecting-IP': limitedIp },
      body: '{}',
    });
    statuses.push(res.status);
  }
  check('sign-ins limited per IP (429 after 10 a minute)', statuses.includes(429) && statuses.slice(0, 10).every((st) => st === 200), statuses);

  // Deletion (cleans up every account of this run).
  check('delete without Origin (403)', (await a.call('/api/me', { method: 'DELETE', origin: null })).status === 403);
  check('delete account', (await a.call('/api/me', { method: 'DELETE' })).status === 200);
  const gone = await a.call('/api/me');
  check('deleted account is signed out', gone.body?.user === null, gone.body);
  for (const p of [b, extra, ...crowd]) {
    await p.call('/api/me', { method: 'DELETE' });
  }
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

void main();
