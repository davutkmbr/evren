/**
 * Building footprints the walls must respect: every OSM building the game draws (the Galata slice and the OSM
 * regions, public/data/osm) and every building the street compiler draws (data/osm/<area>.json), de-duplicated by
 * OSM id. The procedural city keeps out of the walls through the land-use corridors (plan.ts `corridors`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OsmBuilding } from '../../../../src/world/osm/data';
import { flat, inRing, ringArea, type V2 } from './poly';

export interface Footprint {
  id: number;
  part: boolean;
  ring: V2[];
  area: number;
  kind: string;
  levels?: number;
  height?: number;
  historic?: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

const CELL = 50;

export class Footprints {
  readonly list: Footprint[] = [];
  private readonly grid = new Map<number, number[]>();

  add(b: OsmBuilding): void {
    const ring = flat(b.ring);
    if (ring.length < 3) {
      return;
    }
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of ring) {
      minX = Math.min(minX, x);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxZ = Math.max(maxZ, z);
    }
    const k = this.list.push({ id: b.id, part: !!b.part, ring, area: Math.abs(ringArea(ring)), kind: b.kind, levels: b.levels, height: b.height, historic: b.historic, minX, minZ, maxX, maxZ }) - 1;
    for (let j = Math.floor(minZ / CELL); j <= Math.floor(maxZ / CELL); j++) {
      for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++) {
        const key = i * 100003 + j;
        let l = this.grid.get(key);
        if (!l) {
          l = [];
          this.grid.set(key, l);
        }
        l.push(k);
      }
    }
  }

  /** Footprints whose bounds touch the square (x, z) +- r. */
  near(x: number, z: number, r: number): Footprint[] {
    const out = new Set<number>();
    for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
      for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
        for (const k of this.grid.get(i * 100003 + j) ?? []) {
          const f = this.list[k];
          if (f.maxX >= x - r && f.minX <= x + r && f.maxZ >= z - r && f.minZ <= z + r) {
            out.add(k);
          }
        }
      }
    }
    return [...out].map((k) => this.list[k]);
  }
}

/** Every building file of the game and the street compiler (buildings and building:part records). */
export function loadFootprints(root: string): { fp: Footprints; files: number } {
  const fp = new Footprints();
  const seen = new Set<string>();
  const files: string[] = [];
  const slice = join(root, 'public/data/osm/slice.json');
  if (existsSync(slice)) {
    files.push(slice);
  }
  const regions = join(root, 'public/data/osm/regions');
  if (existsSync(regions)) {
    files.push(...readdirSync(regions).filter((f) => f.endsWith('.json')).map((f) => join(regions, f)));
  }
  const street = join(root, 'data/osm');
  // Street-profile area files (compiler input); walls.json is ours, *-scratch files are someone's work in progress.
  files.push(...readdirSync(street).filter((f) => f.endsWith('.json') && f !== 'walls.json' && !f.includes('scratch')).map((f) => join(street, f)));
  for (const f of files) {
    let data: { buildings?: OsmBuilding[] };
    try {
      data = JSON.parse(readFileSync(f, 'utf8')) as { buildings?: OsmBuilding[] };
    } catch {
      continue;
    }
    for (const b of data.buildings ?? []) {
      // Multipolygon buildings come as one record per outer ring under the same id.
      const key = `${b.part ? 'p' : 'b'}${b.id}:${b.ring.length}:${b.ring[0]},${b.ring[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        fp.add(b);
      }
    }
  }
  return { fp, files: files.length };
}

/**
 * Intervals [v0, v1] of the line p + v n (|v| <= reach) inside the footprint (even-odd over the ring's edges).
 */
export function crossIntervals(f: Footprint, p: V2, n: V2, reach: number): [number, number][] {
  const hits: number[] = [];
  const r = f.ring;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    // Solve p + v n = a + t (b - a).
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const den = n[0] * -ez - n[1] * -ex;
    if (Math.abs(den) < 1e-9) {
      continue;
    }
    const dx = a[0] - p[0];
    const dz = a[1] - p[1];
    const v = (dx * -ez - dz * -ex) / den;
    const t = (n[0] * dz - n[1] * dx) / den;
    if (t >= 0 && t < 1) {
      hits.push(v);
    }
  }
  hits.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < hits.length; k += 2) {
    const v0 = Math.max(-reach, hits[k]);
    const v1 = Math.min(reach, hits[k + 1]);
    if (v1 > v0) {
      out.push([v0, v1]);
    }
  }
  return out;
}

/** True when the convex quad / polygon `poly` and the footprint overlap (vertex containment + edge crossings). */
export function overlaps(f: Footprint, poly: readonly V2[]): boolean {
  for (const q of poly) {
    if (inRing(q[0], q[1], f.ring)) {
      return true;
    }
  }
  for (const q of f.ring) {
    if (inRing(q[0], q[1], poly)) {
      return true;
    }
  }
  const cross = (a: V2, b: V2, c: V2, d: V2): boolean => {
    const o = (p: V2, q: V2, r: V2): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let i = 0; i < poly.length; i++) {
    for (let j = 0; j < f.ring.length; j++) {
      if (cross(poly[i], poly[(i + 1) % poly.length], f.ring[j], f.ring[(j + 1) % f.ring.length])) {
        return true;
      }
    }
  }
  return false;
}
