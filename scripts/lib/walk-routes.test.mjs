// Route planner tests for the dragon collision walk: node --test scripts/lib/walk-routes.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { planRoutes, resolveArea } from './walk-routes.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const inside = (r, x, z) => x >= r.minX - 1 && x <= r.maxX + 1 && z >= r.minZ - 1 && z <= r.maxZ + 1;

test('same seed, same routes; another seed, other routes', () => {
  const area = resolveArea(ROOT, { area: 'galata' });
  const a = planRoutes(area, { seed: 3, routes: 6, lengthM: 3000 });
  const b = planRoutes(area, { seed: 3, routes: 6, lengthM: 3000 });
  const c = planRoutes(area, { seed: 4, routes: 6, lengthM: 3000 });
  assert.deepEqual(a.routes, b.routes);
  assert.notDeepEqual(a.routes, c.routes);
});

test('auto routes stay inside the bbox and cover streets, squares and quays', () => {
  const area = resolveArea(ROOT, { bbox: '-4300,2900,-3900,3200' });
  const p = planRoutes(area, { routes: 6, lengthM: 3000 });
  assert.ok(p.routes.length >= 6);
  for (const r of p.routes) {
    for (const leg of r.legs) {
      for (let i = 0; i < leg.length; i += 2) assert.ok(inside(area.rect, leg[i], leg[i + 1]), `${r.id} leaves the bbox`);
    }
  }
  const kinds = new Set(p.routes.map((r) => r.kind));
  assert.ok(kinds.has('street') && kinds.has('square') && kinds.has('quay'), [...kinds].join(','));
  assert.ok(p.graph.coveragePct > 20);
});

test('every OSM area plans without hand-picked points', () => {
  for (const id of ['galata', 'eminonu', 'kadikoy']) {
    const p = planRoutes(resolveArea(ROOT, { area: id }));
    assert.ok(p.routes.filter((r) => r.kind === 'street').length > 5, id);
  }
});

test('the eminonu-streets preset keeps the routes of commit 7c71997', () => {
  const p = planRoutes(resolveArea(ROOT, { area: 'galata' }), { preset: 'eminonu-streets' });
  assert.deepEqual(p.routes.map((r) => r.id), ['resadiye', 'hamidiye', 'yenicami', 'square', 'square-ns', 'quay', 'tram']);
  assert.ok(p.routes.every((r) => r.legs.length > 0));
});
