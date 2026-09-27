/**
 * Latency probe (phase 26, stage 1): measures the round trip from players' networks to Durable Objects placed with
 * different location hints, before the game servers' region is fixed. seventeenskies.com/probe runs the test.
 *
 * This file holds the two Durable Objects; the endpoints are in ./routes.ts.
 */
import { DurableObject } from 'cloudflare:workers';

/** Location hints under test; 'auto' has none, so it sits near whoever created it (Istanbul). */
export const PROBE_REGIONS = ['auto', 'eeur', 'weur', 'me'] as const;
export type ProbeRegion = (typeof PROBE_REGIONS)[number];

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
