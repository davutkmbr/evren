/**
 * Buildings as obstacles for the lane graph (network.ts): no vehicle path runs through a building, whatever the OSM
 * road geometry says. A point blocks when it lies at least INSET inside a solid building outline (outside its
 * courtyards), so a road drawn a little into a façade in OSM still counts as clear. Not obstacles: building:part
 * records (their outline is indexed), buildings raised off the ground (min_height / min_level: bridges over a street,
 * overhangs), canopies and roofs (petrol stations, carports) and the non-solid kinds.
 */
import type { OsmBuilding } from '../data';
import { BoxGrid, bounds, pointInRing } from '../shared/geometry';
import { CANOPY_KINDS, NON_SOLID_KINDS } from '../buildings/kinds';

/** Depth (m) a point must reach inside an outline to block. */
export const INSET = 0.6;
/** Sampling step (m) of the path tests. */
const STEP = 1;

export class BuildingObstacles {
  private readonly grid = new BoxGrid(20);
  private readonly outer: number[][] = [];
  private readonly holes: number[][][] = [];

  constructor(buildings: readonly OsmBuilding[]) {
    for (const b of buildings) {
      if (b.part || b.minHeight || b.minLevel || NON_SOLID_KINDS.has(b.kind) || CANOPY_KINDS.has(b.kind) || b.ring.length < 6) {
        continue;
      }
      const bb = bounds(b.ring);
      this.grid.add(this.outer.push(b.ring) - 1, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
      this.holes.push(b.holes ?? []);
    }
  }

  /** True when (x, z) lies at least INSET inside a building (and not in one of its courtyards). */
  blocks(x: number, z: number): boolean {
    for (const id of this.grid.at(x, z)) {
      const r = this.outer[id];
      if (pointInRing(r, x, z) && !this.holes[id].some((h) => pointInRing(h, x, z)) && edgeDistance(r, x, z) >= INSET) {
        return true;
      }
    }
    return false;
  }

  /** True when the polyline (x, z pairs) passes through a building. */
  blocksPath(pts: ArrayLike<number>): boolean {
    for (let k = 2; k < pts.length; k += 2) {
      const ax = pts[k - 2];
      const az = pts[k - 1];
      const dx = pts[k] - ax;
      const dz = pts[k + 1] - az;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / STEP));
      for (let i = k === 2 ? 0 : 1; i <= n; i++) {
        if (this.blocks(ax + (dx * i) / n, az + (dz * i) / n)) {
          return true;
        }
      }
    }
    return false;
  }
}

/** Distance (m) from (x, z) to the nearest edge of ring `r`. */
function edgeDistance(r: readonly number[], x: number, z: number): number {
  let best = Infinity;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2];
    const az = r[i * 2 + 1];
    const dx = r[j * 2] - ax;
    const dz = r[j * 2 + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z));
  }
  return best;
}
