import type { OsmBuilding } from '../../../src/world/osm/data';

/** Writes `levelsFill` on the untagged buildings of `buildings` (levels-fill.mjs). */
export function fillLevels(buildings: OsmBuilding[]): { tagged: number; filled: number; unfilled: number };
