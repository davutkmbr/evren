/**
 * Tests of Steam sign-in (worker/steam) against a mocked Steamworks Web API: no network, no Steam account, no
 * wrangler. The Worker's own auth routes run in-process with Better Auth on its memory adapter. Exit code 1 on any
 * failure.
 *
 *   npm run test:steam
 */
import { memoryAdapter } from 'better-auth/adapters/memory';
import { Hono } from 'hono';
import { authRoutes } from '../../worker/auth/routes';
import { requireSiteOrigin } from '../../worker/lib/origin';
import { requireUser } from '../../worker/lib/session';
import type { AppEnv } from '../../worker/lib/types';
import { steamConfig, type SteamConfig } from '../../worker/steam/config';
import { bearerToken } from '../../worker/steam/native-session';
import { verifySteamTicket } from '../../worker/steam/verify';
import { isSteamId64, SteamWebApi } from '../../worker/steam/web-api';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) {
    failures++;
  }
}

const KEY = 'test-publisher-key';
const APP_ID = '480';
const IDENTITY = 'seventeenskies';
const ALICE = '76561198000000001';
const BOB = '76561198000000002';
const TICKET_ALICE = 'aa11'.repeat(60);
const TICKET_BOB = 'bb22'.repeat(60);

// ---------------------------------------------------------------------------------------------------------------
// Mocked Steam: tickets map to players; each test can override the next answers.

interface Player {
  steamId: string;
  owner?: string;
  vac?: boolean;
  publisherBan?: boolean;
  owns?: boolean;
}
const tickets = new Map<string, Player>([
  [TICKET_ALICE, { steamId: ALICE }],
  [TICKET_BOB, { steamId: BOB }],
]);
const calls: { url: URL; key: string | null }[] = [];
let steamDown: 'none' | 'http500' | 'throw' | 'html' = 'none';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const mockSteam: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const key = new Headers(init?.headers).get('x-webapi-key');
  calls.push({ url, key });
  if (steamDown === 'throw') {
    throw new TypeError('network down');
  }
  if (steamDown === 'http500') {
    return new Response('oops', { status: 500 });
  }
  if (steamDown === 'html') {
    return new Response('<html>busy</html>', { status: 200 });
  }
  if (key !== KEY) {
    return new Response('<html>Forbidden</html>', { status: 403 });
  }
  const q = url.searchParams;
  if (url.pathname === '/ISteamUserAuth/AuthenticateUserTicket/v1/') {
    const player = tickets.get(q.get('ticket') ?? '');
    if (!player || q.get('identity') !== IDENTITY || q.get('appid') !== APP_ID) {
      return json({ response: { error: { errorcode: 101, errordesc: 'Invalid ticket' } } });
    }
    return json({
      response: {
        params: { result: 'OK', steamid: player.steamId, ownersteamid: player.owner ?? player.steamId, vacbanned: !!player.vac, publisherbanned: !!player.publisherBan },
      },
    });
  }
  if (url.pathname === '/ISteamUser/CheckAppOwnership/v4/') {
    const player = [...tickets.values()].find((p) => p.steamId === q.get('steamid'));
    const owns = player?.owns ?? true;
    return json({ appownership: { ownsapp: owns, permanent: owns && !player?.owner, timestamp: '2026-09-28T10:00:00Z', ownersteamid: player?.owner ?? q.get('steamid'), result: 'OK' } });
  }
  return new Response('not found', { status: 404 });
};

// ---------------------------------------------------------------------------------------------------------------
// 1. SteamID64

check('steamid: a real individual account', isSteamId64(ALICE));
check('steamid: the base id (account 0) is not an account', !isSteamId64('76561197960265728'));
check('steamid: another universe or type is refused', !isSteamId64('90071996842377216') && !isSteamId64('103582791429521412'));
check('steamid: not a number / wrong length', !isSteamId64('7656119800000000x') && !isSteamId64('7656119800000000') && !isSteamId64(76561198000000001));

// ---------------------------------------------------------------------------------------------------------------
// 2. Web API client and the sign-in policy

const config: SteamConfig = { appId: APP_ID, apiKey: KEY, identity: IDENTITY, apiBase: 'https://partner.steam-api.com' };
const api = new SteamWebApi(config, mockSteam);

{
  calls.length = 0;
  const r = await verifySteamTicket(api, TICKET_ALICE);
  check('verify: a good ticket gives the SteamID', r.ok && r.steamId === ALICE && !r.familyShared, r);
  check('verify: ticket, then ownership', calls.length === 2 && calls[0].url.pathname.includes('AuthenticateUserTicket') && calls[1].url.pathname.includes('CheckAppOwnership'));
  check('verify: the key goes in the header, never the URL', calls.every((c) => c.key === KEY && !c.url.search.includes(KEY)));
  check('verify: partner host, our identity and app id', calls[0].url.host === 'partner.steam-api.com' && calls[0].url.searchParams.get('identity') === IDENTITY && calls[0].url.searchParams.get('appid') === APP_ID);
}
for (const [name, ticket] of [
  ['empty', ''],
  ['odd length', 'abc'],
  ['not hex', 'zz'.repeat(40)],
  ['too long', 'ab'.repeat(3000)],
  ['not a string', 42],
] as const) {
  calls.length = 0;
  const r = await verifySteamTicket(api, ticket);
  check(`verify: ${name} → invalid-ticket, Steam not called`, !r.ok && r.error === 'invalid-ticket' && calls.length === 0, r);
}
{
  const r = await verifySteamTicket(api, 'cc33'.repeat(60));
  check('verify: a ticket Steam does not know → ticket-rejected', !r.ok && r.error === 'ticket-rejected', r);
  const wrongIdentity = await verifySteamTicket(new SteamWebApi({ ...config, identity: 'other-game' }, mockSteam), TICKET_ALICE);
  check('verify: a ticket for another identity → ticket-rejected', !wrongIdentity.ok && wrongIdentity.error === 'ticket-rejected', wrongIdentity);
  const badKey = await verifySteamTicket(new SteamWebApi({ ...config, apiKey: 'wrong' }, mockSteam), TICKET_ALICE);
  check('verify: a bad publisher key (403) → steam-unavailable, not the player\'s fault', !badKey.ok && badKey.error === 'steam-unavailable', badKey);
}
{
  tickets.set(TICKET_ALICE, { steamId: ALICE, publisherBan: true });
  const banned = await verifySteamTicket(api, TICKET_ALICE);
  check('verify: publisher ban → banned', !banned.ok && banned.error === 'banned', banned);
  tickets.set(TICKET_ALICE, { steamId: ALICE, vac: true });
  const vac = await verifySteamTicket(api, TICKET_ALICE);
  check('verify: a VAC ban from other games does not block', vac.ok, vac);
  tickets.set(TICKET_ALICE, { steamId: ALICE, owns: false });
  const notOwned = await verifySteamTicket(api, TICKET_ALICE);
  check('verify: no licence → not-owned', !notOwned.ok && notOwned.error === 'not-owned', notOwned);
  tickets.set(TICKET_ALICE, { steamId: ALICE, owner: BOB });
  const shared = await verifySteamTicket(api, TICKET_ALICE);
  check('verify: Family Sharing is allowed and reported', shared.ok && shared.steamId === ALICE && shared.familyShared, shared);
  tickets.set(TICKET_ALICE, { steamId: ALICE });
}
for (const mode of ['http500', 'throw', 'html'] as const) {
  steamDown = mode;
  const r = await verifySteamTicket(api, TICKET_ALICE);
  check(`verify: Steam down (${mode}) → steam-unavailable`, !r.ok && r.error === 'steam-unavailable', r);
}
steamDown = 'none';
{
  const weird: typeof fetch = async () => json({ response: { params: { result: 'OK', steamid: '123' } } });
  const r = await verifySteamTicket(new SteamWebApi(config, weird), TICKET_ALICE);
  check('verify: a malformed SteamID in Steam\'s answer is refused', !r.ok && r.error === 'ticket-rejected', r);
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Config flag

const baseEnv = {
  BETTER_AUTH_URL: 'http://127.0.0.1:8799',
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  SIGN_IN_LIMIT: { limit: async () => ({ success: true }) },
  PROFILE_LIMIT: { limit: async () => ({ success: true }) },
  DB: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
};
const offEnv = { ...baseEnv, STEAM_AUTH: 'off', STEAM_APP_ID: APP_ID, STEAM_WEB_API_KEY: KEY } as unknown as Env;
const onEnv = { ...baseEnv, STEAM_AUTH: 'on', STEAM_APP_ID: APP_ID, STEAM_WEB_API_KEY: KEY } as unknown as Env;

check('config: off unless STEAM_AUTH is "on"', steamConfig(offEnv) === null);
check('config: off without a key', steamConfig({ ...onEnv, STEAM_WEB_API_KEY: '' } as Env) === null);
check('config: off with a non-numeric app id', steamConfig({ ...onEnv, STEAM_APP_ID: 'abc' } as Env) === null);
check('config: on with defaults', steamConfig(onEnv)?.identity === IDENTITY && steamConfig(onEnv)?.apiBase === 'https://partner.steam-api.com');
check('bearer: only without cookies, only signed tokens', bearerToken(new Headers({ Authorization: 'Bearer abc.def=' })) === 'abc.def=' && bearerToken(new Headers({ Authorization: 'Bearer abc.def=', Cookie: 'x=1' })) === null && bearerToken(new Headers({ Authorization: 'Bearer abc' })) === null);

// ---------------------------------------------------------------------------------------------------------------
// 4. The Worker's routes in-process (Better Auth on the memory adapter, Steam mocked through global fetch)

globalThis.fetch = mockSteam;
const app = new Hono<AppEnv>()
  .route('/api/auth', authRoutes)
  .get('/api/test/me', requireUser, (c) => c.json(c.var.user))
  .post('/api/test/write', requireSiteOrigin, requireUser, (c) => c.json({ ok: true }))
  .get('/api/test/ws', requireSiteOrigin, requireUser, (c) => c.json({ seat: c.var.user!.id }));

const signIn = (env: Env, ticket: unknown, headers: Record<string, string> = {}) =>
  app.request('/api/auth/sign-in/steam', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.1', ...headers }, body: JSON.stringify({ ticket }) }, env);

{
  const res = await signIn(offEnv, TICKET_ALICE, { Origin: 'http://127.0.0.1:8799' });
  check('route: Steam sign-in off → 404', res.status === 404, res.status);
  const native = await signIn(offEnv, TICKET_ALICE);
  check('route: off → a request without Origin is still refused (403 origin)', native.status === 403, native.status);
}

let token = '';
let aliceId = '';
{
  const res = await signIn(onEnv, TICKET_ALICE);
  const body = (await res.json()) as { token: string; user: { id: string }; created: boolean; expiresAt: string };
  check('route: first sign-in creates the account (200)', res.status === 200 && body.created && !!body.user?.id && body.token?.includes('.'), body);
  check('route: answer is not cached', res.headers.get('Cache-Control') === 'no-store');
  check('route: no cookie and no set-auth-token header for the native client', !res.headers.get('set-cookie') && !res.headers.get('set-auth-token'));
  check('route: session lasts 90 days', Math.abs(Date.parse(body.expiresAt) - Date.now() - 90 * 86_400_000) < 60_000, body.expiresAt);
  token = body.token;
  aliceId = body.user.id;
  const again = (await (await signIn(onEnv, TICKET_ALICE)).json()) as { user: { id: string }; created: boolean };
  check('route: second sign-in finds the same account', again.user.id === aliceId && !again.created, again);
  const bob = (await (await signIn(onEnv, TICKET_BOB)).json()) as { user: { id: string } };
  check('route: another player gets another account', !!bob.user?.id && bob.user.id !== aliceId, bob);
}
{
  const bad = await signIn(onEnv, 'nothex');
  check('route: invalid ticket → 400 invalid-ticket', bad.status === 400 && ((await bad.json()) as { error: string }).error === 'invalid-ticket');
  const missing = await app.request('/api/auth/sign-in/steam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, onEnv);
  check('route: missing ticket → 400', missing.status === 400, missing.status);
  const rejected = await signIn(onEnv, 'cc33'.repeat(60));
  check('route: rejected ticket → 401 ticket-rejected', rejected.status === 401 && ((await rejected.json()) as { error: string }).error === 'ticket-rejected');
  tickets.set(TICKET_BOB, { steamId: BOB, owns: false });
  const notOwned = await signIn(onEnv, TICKET_BOB);
  check('route: no licence → 403 not-owned', notOwned.status === 403 && ((await notOwned.json()) as { error: string }).error === 'not-owned');
  tickets.set(TICKET_BOB, { steamId: BOB });
  steamDown = 'http500';
  const down = await signIn(onEnv, TICKET_ALICE);
  check('route: Steam down → 503 steam-unavailable', down.status === 503 && ((await down.json()) as { error: string }).error === 'steam-unavailable');
  steamDown = 'none';
  const limited = await signIn({ ...onEnv, SIGN_IN_LIMIT: { limit: async () => ({ success: false }) } } as unknown as Env, TICKET_ALICE);
  check('route: the per-IP sign-in limit applies → 429', limited.status === 429, limited.status);
}
{
  const bearer = { Authorization: `Bearer ${token}` };
  const me = await app.request('/api/test/me', { headers: bearer }, onEnv);
  const user = (await me.json()) as { id: string; isAnonymous: boolean; email: string };
  check('session: the bearer token signs requests in', me.status === 200 && user.id === aliceId && !user.isAnonymous, user);
  check('session: placeholder e-mail on the Steam domain', user.email === `${ALICE}@steam.seventeenskies.com`, user.email);
  const write = await app.request('/api/test/write', { method: 'POST', headers: bearer }, onEnv);
  check('session: a native write (no Origin, no cookies) passes the origin check', write.status === 200, write.status);
  const ws = await app.request('/api/test/ws', { headers: { ...bearer, Upgrade: 'websocket' } }, onEnv);
  check('session: a native WebSocket upgrade passes origin and session checks', ws.status === 200 && ((await ws.json()) as { seat: string }).seat === aliceId);
  const cross = await app.request('/api/test/write', { method: 'POST', headers: { ...bearer, Origin: 'https://evil.example' } }, onEnv);
  check('session: a foreign Origin is still refused', cross.status === 403, cross.status);
  const cookie = await app.request('/api/test/write', { method: 'POST', headers: { Cookie: 'better-auth.session_token=x' } }, onEnv);
  check('session: a cookie request without Origin is still refused', cookie.status === 403, cookie.status);
  const tampered = await app.request('/api/test/me', { headers: { Authorization: `Bearer ${token.slice(0, -4)}AAA=` } }, onEnv);
  check('session: a tampered token is signed out (401)', tampered.status === 401, tampered.status);
  const off = await app.request('/api/test/write', { method: 'POST', headers: bearer }, offEnv);
  check('session: with Steam sign-in off, native writes are refused again', off.status === 403, off.status);
  const signOut = await app.request('/api/auth/sign-out', { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' }, body: '{}' }, onEnv);
  check('session: Better Auth sign-out works with the bearer token', signOut.status === 200, signOut.status);
  const after = await app.request('/api/test/me', { headers: bearer }, onEnv);
  check('session: the token is dead after sign-out', after.status === 401, after.status);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
