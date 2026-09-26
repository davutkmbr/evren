/**
 * Perch clearings: no tree grows over a perch. Within PERCH_RULES.neighbourRadius of every offered perch, a tree whose
 * crown would reach higher than the grip minus PERCH_RULES.neighbourMargin is not planted (the procedural vegetation
 * and the OSM trees apply it); lower trees stay, so the ground around a perch keeps its green. This is what lets the
 * perch rules count the trees as cleared where the surroundings are measured (wall towers, walls.ts).
 */
import type { GeoQuery } from '../../core/contracts';
import { PERCH_RULES } from './rules';
import { buildPerchService } from './service';

export { inClearing } from './clearing-test';

const cache = new WeakMap<GeoQuery, number[]>();

/** Clearings as flat (x, z, radius, highest allowed crown top) records, one per offered perch. */
export function perchClearings(geo: GeoQuery): number[] {
  let out = cache.get(geo);
  if (!out) {
    out = [];
    for (const p of buildPerchService(geo).points) {
      out.push(p.x, p.z, PERCH_RULES.neighbourRadius, p.y - PERCH_RULES.neighbourMargin);
    }
    cache.set(geo, out);
  }
  return out;
}
