/**
 * Footprints the walls must respect: every OSM building the game draws (the Galata slice and the OSM regions,
 * public/data/osm) and every building the street compiler draws (data/osm/<area>.json), de-duplicated by OSM id, plus
 * the carriageways and rail / tram beds of the same files as quads over their full width (a wall never stands on a
 * road). The procedural city keeps out of the walls through the land-use corridors (plan.ts `corridors`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OsmBuilding, OsmRail, OsmRoad } from '../../../../src/world/osm/data';
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
  /** Road / rail quads: the centre segment, half width, major road (primary and above), one-way carriageway. */
  road?: { a: V2; b: V2; hw: number; major: boolean; oneway: boolean; rail: boolean };
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

const CELL = 50;
/** highway=* values that are carriageways (vehicles); footways, paths, steps and squares are not obstacles. */
const CARRIAGEWAY = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road', 'busway']);
/** Major roads: the coastal avenues the supplement traces are snapped off, and the dual carriageways whose medians are closed. */
export const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link']);
const RAILS = new Set(['rail', 'tram', 'light_rail', 'narrow_gauge', 'subway']);

export class Footprints {
  readonly list: Footprint[] = [];
  private readonly grid = new Map<number, number[]>();

  add(b: OsmBuilding): void {
    const ring = flat(b.ring);
    if (ring.length < 3) {
      return;
    }
    this.addRing({ id: b.id, part: !!b.part, ring, area: Math.abs(ringArea(ring)), kind: b.kind, levels: b.levels, height: b.height, historic: b.historic });
  }

  addRing(f: Omit<Footprint, 'minX' | 'minZ' | 'maxX' | 'maxZ'>): void {
    const ring = f.ring;
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
    const k = this.list.push({ ...f, minX, minZ, maxX, maxZ }) - 1;
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
  let roadId = -1e12;
  const road = (pts: readonly number[], hw: number, meta: { major: boolean; oneway: boolean; rail: boolean }, kind: string): void => {
    for (let i = 2; i + 1 < pts.length; i += 2) {
      const a: V2 = [pts[i - 2], pts[i - 1]];
      const b: V2 = [pts[i], pts[i + 1]];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 0.05) {
        continue;
      }
      const d: V2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      const n: V2 = [-d[1], d[0]];
      const e = hw * 0.5;
      const P = (p: V2, u: number, v: number): V2 => [p[0] + d[0] * u + n[0] * v, p[1] + d[1] * u + n[1] * v];
      fp.addRing({ id: roadId--, part: false, ring: [P(a, -e, -hw), P(b, e, -hw), P(b, e, hw), P(a, -e, hw)], area: (l + 2 * e) * 2 * hw, kind, road: { a, b, hw, ...meta } });
    }
  };
  for (const f of files) {
    let data: { buildings?: OsmBuilding[]; roads?: OsmRoad[]; rails?: OsmRail[] };
    try {
      data = JSON.parse(readFileSync(f, 'utf8')) as { buildings?: OsmBuilding[]; roads?: OsmRoad[]; rails?: OsmRail[] };
    } catch {
      continue;
    }
    for (const r of data.roads ?? []) {
      const key = `r${r.id}:${r.pts.length}:${r.pts[0]},${r.pts[1]}`;
      if (!CARRIAGEWAY.has(r.kind) || r.tunnel || r.bridge || seen.has(key)) {
        continue;
      }
      seen.add(key);
      // Carriageway plus kerb / verge margin.
      road(r.pts, r.width / 2 + 0.5, { major: MAJOR.has(r.kind), oneway: !!r.oneway, rail: false }, `highway=${r.kind}`);
    }
    for (const r of data.rails ?? []) {
      const key = `t${r.id}:${r.pts.length}:${r.pts[0]},${r.pts[1]}`;
      if (!RAILS.has(r.kind) || r.tunnel || r.bridge || seen.has(key)) {
        continue;
      }
      seen.add(key);
      // Track bed: gauge plus ballast / sleeper margin.
      road(r.pts, r.gauge / 2 + 1.5, { major: false, oneway: false, rail: true }, `railway=${r.kind}`);
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
