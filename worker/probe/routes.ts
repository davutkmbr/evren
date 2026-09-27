/**
 * Latency probe endpoints, under /api/probe (the page is seventeenskies.com/probe):
 *
 *   GET  /api/probe/info            the visitor's network as Cloudflare sees it (ISP, ASN, city, ingress colo)
 *   GET  /api/probe/ws?region=eeur  WebSocket echo on the probe object for that region ('where' answers its colo)
 *   POST /api/probe/results         one test: { region, doColo, samples: number[] (ms) }
 *   GET  /api/probe/results         every stored test plus a summary per ISP and region
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, noStore } from '../lib/http';
import { requireSiteOrigin } from '../lib/origin';
import type { AppEnv } from '../lib/types';
import { PROBE_REGIONS, type ProbeLog, type ProbeRow } from './objects';

const MAX_SAMPLES = 100;

const regionQuery = z.object({ region: z.enum(PROBE_REGIONS) });
const resultBody = z.object({
  region: z.enum(PROBE_REGIONS),
  doColo: z.string().max(8).catch('unknown'),
  samples: z.array(z.number().positive().lt(10_000)).min(5).max(MAX_SAMPLES),
});

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
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

const invalid = (result: { success: boolean }, c: Parameters<typeof apiError>[0]) => (result.success ? undefined : apiError(c, 400, 'invalid'));

export const probeRoutes = new Hono<AppEnv>()
  .use(requireSiteOrigin)
  .get('/info', (c) => noStore(c, { ...network(c.req.raw), regions: PROBE_REGIONS }))
  .get('/ws', zValidator('query', regionQuery, invalid), (c) => {
    const { region } = c.req.valid('query');
    const id = c.env.PROBE.idFromName(`probe-v1-${region}`);
    const stub = region === 'auto' ? c.env.PROBE.get(id) : c.env.PROBE.get(id, { locationHint: region });
    return stub.fetch(c.req.raw);
  })
  .post('/results', zValidator('json', resultBody, invalid), async (c) => {
    const body = c.req.valid('json');
    const sorted = [...body.samples].sort((a, b) => a - b);
    const row: ProbeRow = {
      ts: Date.now(),
      region: body.region,
      doColo: body.doColo,
      ...network(c.req.raw),
      median: Math.round(quantile(sorted, 0.5) * 10) / 10,
      p90: Math.round(quantile(sorted, 0.9) * 10) / 10,
      samples: sorted.length,
    };
    await log(c.env).add(row);
    return noStore(c, { ok: true, row });
  })
  .get('/results', async (c) => {
    const rows = await log(c.env).rows();
    return noStore(c, { summary: summarize(rows), rows });
  });
