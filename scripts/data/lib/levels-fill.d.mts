import type { OsmBuilding } from '../../../src/world/osm/data';

/**
 * Writes `levelsFill` on the untagged buildings of `buildings` (levels-fill.mjs): the estimates of the building merge
 * the data was fetched with (`merge`, the data's `footprints.merge` stamp) while that merge is built, else the median
 * of tagged neighbours.
 */
export function fillLevels(buildings: OsmBuilding[], options?: { merge?: string | null }): { tagged: number; filled: number; unfilled: number; merge?: string; from?: Record<string, number> };
