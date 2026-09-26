/**
 * Buildings on the edge of a compiled area. A building belongs to the tile of its centroid, and only buildings whose
 * centroid lies in the tile grid are compiled. One that straddles the grid's edge with its centroid outside is drawn by
 * nobody up close, while the street layer's hole mask cuts the flight-scale city inside every live tile: without a
 * record the flight-scale twin was cut at the tile edge and half the building disappeared (Moda: a school on the east
 * edge). The keep records list those buildings on every tile they reach into; the runtime (src/world/street/index.ts)
 * never cuts their flight-scale twin, and landmarks keep the game's model.
 */
import type { Solid } from './buildings';
import type { Bounds2 } from './format';

/** A flight-scale building the tile leaves standing (manifest `keep`). */
export interface KeepRec {
  id: string;
  /** Flat [x, z, ...]. */
  footprint: number[];
  /** The landmark class when the game draws its own model there (district.ts landmarkClasses). */
  landmark?: string;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

function bboxOf(ring: readonly number[]): Bounds2 {
  const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (let i = 0; i < ring.length; i += 2) {
    b.minX = Math.min(b.minX, ring[i]);
    b.maxX = Math.max(b.maxX, ring[i]);
    b.minZ = Math.min(b.minZ, ring[i + 1]);
    b.maxZ = Math.max(b.maxZ, ring[i + 1]);
  }
  return b;
}

const overlaps = (a: Bounds2, b: Bounds2): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

/** Solids that reach into `rect` (the tile grid) although their centroid lies outside it: nobody compiles them. */
export function edgeSolids(solids: readonly Solid[], rect: Bounds2): Solid[] {
  const inside = (x: number, z: number): boolean => x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;
  return solids.filter((s) => !inside(s.cx, s.cz) && overlaps(bboxOf(s.ring), rect));
}

/** Keep records per tile id: every edge solid on every tile whose square its footprint's bbox reaches into. */
export function edgeKeeps(edge: readonly Solid[], tiles: ReadonlyMap<string, { bounds: Bounds2 }>, landmarks: ReadonlyMap<number, string>): Map<string, KeepRec[]> {
  const out = new Map<string, KeepRec[]>();
  for (const s of edge) {
    const box = bboxOf(s.ring);
    const landmark = landmarks.get(s.rec.osmId);
    const rec: KeepRec = { id: s.rec.id, footprint: s.ring.map(round2), ...(landmark ? { landmark } : {}) };
    for (const [id, t] of tiles) {
      if (overlaps(box, t.bounds)) {
        const list = out.get(id) ?? [];
        list.push(rec);
        out.set(id, list);
      }
    }
  }
  return out;
}
