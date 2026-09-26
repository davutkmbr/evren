/**
 * Heritage sites check: builds every heritage landmark with its site builder (all LODs, the worker code) and reports
 * triangles, height range and colliders. Fails on a builder error, non-finite vertices, a site without colliders, or
 * a heritage landmark without a builder (kind 'walls' excepted: the city-wall bake draws those).
 *
 *   npx tsx tools/headless/heritage-sites-check.ts [id ...]
 */
import { buildHeadlessGeo } from './geo';
import { makeJob } from '../../src/world/landmarks/heritage/jobs';
import { buildSite } from '../../src/world/landmarks/heritage/worker/build-site';
import { SITE_BUILDERS } from '../../src/world/landmarks/heritage/build/registry';

const geo = buildHeadlessGeo();
const only = process.argv.slice(2);
const failures: string[] = [];
for (const l of geo.landmarks) {
  if (l.builder !== 'heritage' || (only.length && !only.includes(l.id))) {
    continue;
  }
  if (!SITE_BUILDERS[l.id]) {
    if (l.kind !== 'walls') {
      failures.push(`${l.id}: no site builder`);
    }
    continue;
  }
  const r = buildSite(makeJob(geo, l, 3));
  if (r.error) {
    failures.push(`${l.id}: ${r.error.split('\n')[0]}`);
    continue;
  }
  const tris = [0, 0, 0];
  let minY = Infinity;
  let maxY = -Infinity;
  let finite = true;
  for (const c of r.chunks) {
    c.lods.forEach((m, i) => {
      tris[i] += m.triangleCount;
      for (let k = 0; k < m.positions.length; k++) {
        const v = m.positions[k];
        finite &&= Number.isFinite(v);
        if (k % 3 === 1) {
          minY = Math.min(minY, v);
          maxY = Math.max(maxY, v);
        }
      }
    });
  }
  if (!finite) {
    failures.push(`${l.id}: non-finite vertices`);
  }
  if (r.colliders.length === 0) {
    failures.push(`${l.id}: no colliders`);
  }
  console.log(`${l.id.padEnd(20)} chunks ${String(r.chunks.length).padStart(2)}  tris ${tris.join(' / ')}  y ${minY.toFixed(1)} .. ${maxY.toFixed(1)} (ground ${geo.heightAt(l.x, l.z).toFixed(1)})  colliders ${r.colliders.length}  ${r.ms.toFixed(0)} ms`);
}
for (const f of failures) {
  console.log(`FAIL ${f}`);
}
console.log(`${failures.length} failure(s)`);
process.exit(failures.length ? 1 : 0);
