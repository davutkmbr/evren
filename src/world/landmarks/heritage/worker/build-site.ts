import type { SiteJob, SiteResult } from '../protocol';
import { SITE_BUILDERS } from '../build/registry';
import { SiteContext, sampleWindow } from '../build/site';

/** Runs one site builder for every LOD (usable in the worker and, as a fallback, on the main thread). */
export function buildSite(job: SiteJob): SiteResult {
  const t0 = performance.now();
  const builder = SITE_BUILDERS[job.def.id];
  if (!builder) {
    return { id: job.def.id, chunks: [], colliders: [], ms: 0, error: `no builder for ${job.def.id}` };
  }
  const ctx = new SiteContext(job.def, job.heights, job.coast, job.coastlines, job.lods);
  try {
    for (let lod = 0; lod < job.lods; lod++) {
      ctx.beginLod(lod);
      builder(ctx);
    }
    const { chunks, colliders } = ctx.results((x, z) => sampleWindow(job.heights, x, z));
    return { id: job.def.id, chunks, colliders, ms: performance.now() - t0 };
  } catch (err) {
    const e = err as Error;
    return { id: job.def.id, chunks: [], colliders: [], ms: performance.now() - t0, error: `${e.message}\n${e.stack ?? ''}` };
  }
}
