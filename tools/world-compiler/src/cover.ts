/**
 * Point-in-footprint queries of the compiler that respect inner rings (courtyards, light wells). The shared
 * FootprintIndex (src/world/osm/shared/footprints.ts, also used at runtime and by format 0, which stays byte-identical)
 * ignores holes; format 1 uses these instead where it matters:
 * - `outlineIndex`: every building outline (no building:part records: they lie inside their outline), for what a
 *   façade faces (facade/build.ts);
 * - `solidCover`: the solids the tiles actually emit (grounded ones), for the ground: a ground cell is left out only
 *   where an emitted block stands on it, so ground and buildings cover the area without holes (outlines whose parts
 *   leave gaps, buildings outside the tile rect and courtyards keep their ground).
 */
import type { OsmBuilding } from '../../../src/world/osm/data';
import { BoxGrid, bounds, pointInRing } from '../../../src/world/osm/shared/geometry';
import type { Solid } from './buildings';

export class RingIndex<T = unknown> {
  private readonly grid = new BoxGrid(20);
  private readonly items: { ring: readonly number[]; holes: readonly (readonly number[])[]; tag: T }[] = [];

  add(ring: readonly number[], holes: readonly (readonly number[])[], tag: T): void {
    const b = bounds(ring);
    this.grid.add(this.items.push({ ring, holes, tag }) - 1, b.minX, b.minZ, b.maxX, b.maxZ);
  }

  /** The tag of a footprint containing (x, z) (outside its holes) other than `not`, or undefined. */
  at(x: number, z: number, not?: T): T | undefined {
    for (const id of this.grid.at(x, z)) {
      const it = this.items[id];
      if (it.tag !== not && pointInRing(it.ring, x, z) && !it.holes.some((h) => pointInRing(h, x, z))) {
        return it.tag;
      }
    }
    return undefined;
  }

  /** 1 + the index of the first footprint containing (x, z) (outside its holes), or 0. */
  id(x: number, z: number): number {
    for (const id of this.grid.at(x, z)) {
      const it = this.items[id];
      if (pointInRing(it.ring, x, z) && !it.holes.some((h) => pointInRing(h, x, z))) {
        return id + 1;
      }
    }
    return 0;
  }

  inside(x: number, z: number, not?: T): boolean {
    return this.at(x, z, not) !== undefined;
  }
}

/** Building outlines (no parts), tagged with their OSM id. */
export function outlineIndex(buildings: readonly OsmBuilding[]): RingIndex<number> {
  const idx = new RingIndex<number>();
  for (const b of buildings) {
    if (!b.part) {
      idx.add(b.ring, b.holes ?? [], b.id);
    }
  }
  return idx;
}

/** The grounded solids the tiles emit. */
export function solidCover(solids: readonly Solid[]): RingIndex<Solid> {
  const idx = new RingIndex<Solid>();
  for (const s of solids) {
    if (s.grounded) {
      idx.add(s.ring, s.holes, s);
    }
  }
  return idx;
}
