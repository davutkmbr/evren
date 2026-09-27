/**
 * Latency probe (phase 26, stage 1): measures the round trip from players' networks to Durable Objects placed with
 * different location hints, before the game servers' region is fixed. seventeenskies.com/probe runs the test.
 *
 *   GET  /api/probe/info            the visitor's network as Cloudflare sees it (ISP, ASN, city, ingress colo)
 *   GET  /api/probe/ws?region=eeur  WebSocket echo on the probe object for that region ('where' answers its colo)
 *   POST /api/probe/results         one test: { region, doColo, samples: number[] (ms) }
 *   GET  /api/probe/results         every stored test plus a summary per ISP and region
 */
import { DurableObject } from 'cloudflare:workers';

/** Location hints under test; 'auto' has none, so it sits near whoever created it (Istanbul). */
export const PROBE_REGIONS = ['auto', 'eeur', 'weur', 'me'] as const;
export type ProbeRegion = (typeof PROBE_REGIONS)[number];

const MAX_SAMPLES = 100;
const MAX_ROWS = 20_000;

/** Echo object: one per region, created once with its location hint (objects never move afterwards). */
export class LatencyProbe extends DurableObject<Env> {
  private colo: string | null = null;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'where') {
      ws.send(JSON.stringify({ colo: await this.where() }));
      return;
    }
    ws.send(message);
  }

  /** The data centre this object runs in, read from Cloudflare's trace endpoint and kept in storage. */
  private async where(): Promise<string> {
    if (this.colo) {
      return this.colo;
    }
    const stored = await this.ctx.storage.get<string>('colo');
    if (stored) {
      this.colo = stored;
      return stored;
    }
    const trace = await (await fetch('https://cloudflare.com/cdn-cgi/trace')).text();
    const colo = /^colo=(\w+)$/m.exec(trace)?.[1] ?? 'unknown';
    await this.ctx.storage.put('colo', colo);
    this.colo = colo;
    return colo;
  }
}

export interface ProbeRow {
  ts: number;
  region: string;
  doColo: string;
  ingressColo: string;
  asn: number;
  org: string;
  country: string;
  city: string;
  median: number;
  p90: number;
  samples: number;
}

/** Stored test results (a single object, SQLite). */
export class ProbeLog extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS results (
      ts INTEGER, region TEXT, do_colo TEXT, ingress_colo TEXT, asn INTEGER, org TEXT, country TEXT, city TEXT,
      median REAL, p90 REAL, samples INTEGER)`);
  }

  add(row: ProbeRow): void {
    const sql = this.ctx.storage.sql;
    sql.exec(
      'INSERT INTO results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      row.ts, row.region, row.doColo, row.ingressColo, row.asn, row.org, row.country, row.city, row.median, row.p90, row.samples,
    );
    sql.exec('DELETE FROM results WHERE rowid NOT IN (SELECT rowid FROM results ORDER BY ts DESC LIMIT ?)', MAX_ROWS);
  }

  rows(): ProbeRow[] {
    return this.ctx.storage.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM results ORDER BY ts DESC')
      .toArray()
      .map((r) => ({
        ts: Number(r.ts),
        region: String(r.region),
        doColo: String(r.do_colo),
        ingressColo: String(r.ingress_colo),
        asn: Number(r.asn),
        org: String(r.org),
        country: String(r.country),
        city: String(r.city),
        median: Number(r.median),
        p90: Number(r.p90),
        samples: Number(r.samples),
      }));
  }
}

function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

function isRegion(v: unknown): v is ProbeRegion {
  return typeof v === 'string' && (PROBE_REGIONS as readonly string[]).includes(v);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function network(request: Request) {
  const cf = request.cf ?? {};
  return {
    ingressColo: String(cf.colo ?? 'unknown'),
    asn: Number(cf.asn ?? 0),
    org: String(cf.asOrganization ?? 'unknown'),
    country: String(cf.country ?? 'XX'),
    city: String(cf.city ?? ''),
  };
}

function log(env: Env): DurableObjectStub<ProbeLog> {
  return env.PROBE_LOG.get(env.PROBE_LOG.idFromName('results-v1'));
}

/** Summary per ISP and region: tests, median of the medians, median of the p90s. */
function summarize(rows: ProbeRow[]) {
  const groups = new Map<string, ProbeRow[]>();
  for (const r of rows) {
    const k = `${r.org}\u0000${r.region}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()]
    .map((g) => {
      const med = g.map((r) => r.median).sort((a, b) => a - b);
      const p90 = g.map((r) => r.p90).sort((a, b) => a - b);
      return { org: g[0].org, asn: g[0].asn, region: g[0].region, doColo: g[0].doColo, tests: g.length, median: quantile(med, 0.5), p90: quantile(p90, 0.5) };
    })
    .sort((a, b) => a.org.localeCompare(b.org) || a.median - b.median);
}

export async function handleProbe(request: Request, env: Env, path: string): Promise<Response> {
  if (path === '/api/probe/info' && request.method === 'GET') {
    return json({ ...network(request), regions: PROBE_REGIONS });
  }
  if (path === '/api/probe/ws') {
    const region = new URL(request.url).searchParams.get('region');
    if (!isRegion(region)) {
      return json({ error: 'unknown region' }, 400);
    }
    const id = env.PROBE.idFromName(`probe-v1-${region}`);
    const stub = region === 'auto' ? env.PROBE.get(id) : env.PROBE.get(id, { locationHint: region });
    return stub.fetch(request);
  }
  if (path === '/api/probe/results' && request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as { region?: unknown; doColo?: unknown; samples?: unknown } | null;
    const samples = Array.isArray(body?.samples)
      ? body.samples.filter((s): s is number => typeof s === 'number' && Number.isFinite(s) && s > 0 && s < 10_000).slice(0, MAX_SAMPLES)
      : [];
    if (!body || !isRegion(body.region) || samples.length < 5) {
      return json({ error: 'invalid result' }, 400);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const row: ProbeRow = {
      ts: Date.now(),
      region: body.region,
      doColo: typeof body.doColo === 'string' ? body.doColo.slice(0, 8) : 'unknown',
      ...network(request),
      median: Math.round(quantile(sorted, 0.5) * 10) / 10,
      p90: Math.round(quantile(sorted, 0.9) * 10) / 10,
      samples: samples.length,
    };
    await log(env).add(row);
    return json({ ok: true, row });
  }
  if (path === '/api/probe/results' && request.method === 'GET') {
    const rows = await log(env).rows();
    return json({ summary: summarize(rows), rows });
  }
  return json({ error: 'not found' }, 404);
}
