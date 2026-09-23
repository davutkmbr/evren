/** Spatial index of OSM building outlines for "is this point inside a building" queries (workers and main). */
import type { OsmBuilding } from '../data';
import { BoxGrid, bounds, pointInRing } from './geometry';

export class FootprintIndex {
  private readonly grid = new BoxGrid(20);
  private readonly rings: number[][] = [];

  /** Indexes every outline (building:part records are skipped: they lie inside their outline). */
  constructor(buildings: readonly OsmBuilding[]) {
    for (const b of buildings) {
      if (b.part) {
        continue;
      }
      const bb = bounds(b.ring);
      this.grid.add(this.rings.push(b.ring) - 1, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
    }
  }

  /** True when (x, z) is inside any building outline. */
  inside(x: number, z: number): boolean {
    for (const id of this.grid.at(x, z)) {
      if (pointInRing(this.rings[id], x, z)) {
        return true;
      }
    }
    return false;
  }
}
