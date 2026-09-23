/**
 * Skyscraper cluster builder: one tower (plus catalogued siblings) per landmark anchor, heights from the anchors.
 */
import { createRng, hashString } from '../../../../../core/math/noise';
import type { StructureBuild } from '../../build/context';
import { catalogFor, genericTower } from './catalog';
import { buildTower } from './tower';

export function buildSkyscraperCluster(b: StructureBuild): void {
  const anchors = b.def.anchors ?? [{ x: b.def.x, z: b.def.z, height: b.def.height }];
  const catalog = catalogFor(b.def.id);
  anchors.forEach((a, i) => {
    const seed = hashString(`${b.def.id}:${i}`);
    const rng = createRng(seed);
    const placed = catalog[i] ?? [{ spec: genericTower(a.height ?? b.def.height, rng) }];
    placed.forEach((p, j) => {
      buildTower(b, a.x + (p.dx ?? 0), a.z + (p.dz ?? 0), p.spec, (seed % 997) + j * 13);
    });
  });
}
