/**
 * Building passages (rule walk.passage): a foot way that OSM maps straight through a building for at most PASSAGE_MAX
 * m without tunnel=* / covered=* (a gate house such as Dolmabahçe's Hazine Kapısı, a han's gateway, an arcade). The
 * world compiler's walk network links the way through such a passage, so every layer that draws or collides with the
 * building opens it the same way:
 * - the compiled façades (tools/world-compiler: facade/build.ts and the plain blocks, buildings.ts) and the runtime
 *   OSM buildings (osm/buildings/build.ts) cut a round-arched opening into both walls the way crosses and line the
 *   passage with side walls and a barrel vault (passageArch);
 * - the runtime building collider leaves the passage free under the vault (passageColliderRings).
 * Pure geometry (no three.js), shared by the workers and the compiler.
 */
import type { OsmBuilding, OsmRoad } from '../data';
import { BoxGrid, bounds, pointInRing, ringArea } from './geometry';

/** Longest run (m) of a mapped foot way through a building that is walked as a passage (gate houses, arcades). */
export const PASSAGE_MAX = 16;
/** Clear width (m) of a passage: the way's width tag, clamped. */
const WIDTH_MIN = 2.4;
const WIDTH_MAX = 4.5;
const WIDTH_DEFAULT = 3.2;
/** Height (m) of the arch's springing line above the ground (the lowest spring, for low buildings). */
const SPRING = 2.6;
const SPRING_MIN = 2.1;
/** Solid wall (m) kept above the arch's crown. */
const CROWN_COVER = 0.8;
/** A portal wall may meet the passage at no more than this angle from square (the opening widens by 1 / cos). */
const MAX_SKEW = (55 * Math.PI) / 180;

export interface Passage {
  /** OSM id of the building (or building:part) the passage runs through. */
  building: number;
  /** OSM id of the foot way. */
  road: number;
  /** Entry and exit points: where the way crosses the building's walls. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit direction a -> b and its left normal (-dz, dx). */
  dx: number;
  dz: number;
  /** Half the clear width (m); the arch is a semicircle of this radius. */
  hw: number;
}

/** The arch of a passage in a building whose walls stand `wallH` m above the passage floor, or null if too low. */
export function passageArch(p: Passage, wallH: number): { spring: number; crown: number } | null {
  const spring = Math.min(SPRING, wallH - CROWN_COVER - p.hw);
  return spring >= SPRING_MIN ? { spring, crown: spring + p.hw } : null;
}

/** Rendered solids a passage may cut: buildings without parts and parts, grounded, not canopies or ruins. */
function solidCandidate(b: OsmBuilding): boolean {
  return !b.hasParts && !b.minHeight && !b.minLevel && !/^(roof|ruins|collapsed|bridge|construction|no|carport|tent|kiosk|shed|hut|container|greenhouse)$/.test(b.kind) && b.ring.length >= 6;
}

/** Foot ways the walk network re-walks (walk-network.ts footKind): footways, paths and steps above ground. */
function footWay(r: OsmRoad): boolean {
  return !r.tunnel && !r.bridge && !r.covered && (r.layer ?? 0) >= 0 && r.pts.length >= 4 && (r.kind === 'footway' || r.kind === 'path' || r.kind === 'steps');
}

/** Parameter t in [0, 1] along a -> b where it crosses segment c -> d, or -1. */
function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) {
    return -1;
  }
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

/** A wall edge: its end points, unit direction and length. */
export interface Wall {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ux: number;
  uz: number;
  len: number;
  /** Ring (0 outer, 1.. holes) and edge index of the rings it was found in. */
  ring: number;
  edge: number;
}

/** The wall edge of `rings` nearest (x, z). */
export function wallAt(rings: readonly (readonly number[])[], x: number, z: number): Wall & { d: number } {
  let best: Wall & { d: number } = { ax: x, az: z, bx: x, bz: z, ux: 1, uz: 0, len: 0, ring: 0, edge: 0, d: Infinity };
  rings.forEach((r, ri) => {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = r[i * 2];
      const az = r[i * 2 + 1];
      const bx = r[((i + 1) % n) * 2];
      const bz = r[((i + 1) % n) * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) {
        continue;
      }
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const t = Math.max(0, Math.min(len, (x - ax) * ux + (z - az) * uz));
      const d = Math.hypot(ax + ux * t - x, az + uz * t - z);
      if (d < best.d) {
        best = { ax, az, bx, bz, ux, uz, len, ring: ri, edge: i, d };
      }
    }
  });
  return best;
}

/** Distance s along the passage (from a) where its line at lateral offset `o` (+ left) meets the line of `w`. */
export function wallHit(p: Passage, o: number, w: Wall): number {
  const nx = -p.dz;
  const nz = p.dx;
  const px = p.ax + nx * o;
  const pz = p.az + nz * o;
  // px + dx s = ax + ux t  (2x2 solve for s)
  const den = p.dx * w.uz - p.dz * w.ux;
  if (Math.abs(den) < 1e-9) {
    return 0;
  }
  return ((w.ax - px) * w.uz - (w.az - pz) * w.ux) / den;
}

/** World (x, z) of the passage point at lateral offset `o` (+ left) and distance `s` from a. */
export function passagePoint(p: Passage, o: number, s: number): [number, number] {
  return [p.ax - p.dz * o + p.dx * s, p.az + p.dx * o + p.dz * s];
}

/**
 * Cross-section of the lined passage: points (lateral offset o, + left; height h above the floor) from the left
 * side wall's foot up to the springing line, round the semicircular vault (`segs` pieces) and down the right side
 * wall; `normal` per point, pointing into the passage ([lateral, up]).
 */
export function passageProfile(p: Passage, arch: { spring: number; crown: number }, segs = 12): { o: number[]; h: number[]; nl: number[]; nh: number[]; arc0: number; arc1: number } {
  const o = [p.hw];
  const h = [0];
  const nl = [-1];
  const nh = [0];
  for (let k = 0; k <= segs; k++) {
    const f = (k / segs) * Math.PI;
    o.push(p.hw * Math.cos(f));
    h.push(arch.spring + p.hw * Math.sin(f));
    nl.push(-Math.cos(f));
    nh.push(-Math.sin(f));
  }
  o.push(-p.hw);
  h.push(0);
  nl.push(1);
  nh.push(0);
  return { o, h, nl, nh, arc0: 1, arc1: segs + 1 };
}

/**
 * The opening a passage cuts into wall `w` (one of its two portal walls): per profile point (passageProfile) the
 * distance t along the wall from (w.ax, w.az) and the height above the passage floor; the clear rectangle [t0, t1]
 * up to the springing line, the arch above it up to the crown.
 */
export function portalOnWall(p: Passage, profile: { o: number[]; h: number[] }, w: Wall): { t: number[]; h: number[]; t0: number; t1: number } {
  const t: number[] = [];
  for (let k = 0; k < profile.o.length; k++) {
    const s = wallHit(p, profile.o[k], w);
    const [x, z] = passagePoint(p, profile.o[k], s);
    t.push((x - w.ax) * w.ux + (z - w.az) * w.uz);
  }
  return { t, h: profile.h.slice(), t0: Math.min(...t), t1: Math.max(...t) };
}

/** The portal walls of a passage in `rings` (entry and exit), or null when an opening would not fit its wall. */
export function portalWalls(p: Passage, rings: readonly (readonly number[])[], margin = 0.3): [Wall, Wall] | null {
  const wa = wallAt(rings, p.ax, p.az);
  const wb = wallAt(rings, p.bx, p.bz);
  if (wa.d > 0.3 || wb.d > 0.3 || (wa.ring === wb.ring && wa.edge === wb.edge)) {
    return null;
  }
  for (const w of [wa, wb]) {
    // Skew: the angle between the passage and the wall's normal.
    if (Math.abs(p.dx * w.uz - p.dz * w.ux) < Math.cos(MAX_SKEW)) {
      return null;
    }
    const ts = [p.hw, -p.hw].map((o) => {
      const [x, z] = passagePoint(p, o, wallHit(p, o, w));
      return (x - w.ax) * w.ux + (z - w.az) * w.uz;
    });
    if (Math.min(...ts) < margin || Math.max(...ts) > w.len - margin) {
      return null;
    }
  }
  return [wa, wb];
}

/**
 * Passages of `roads` through `buildings`: every stretch of a foot way between two consecutive crossings of one
 * building's walls (outer ring or courtyard) that lies inside the solid, is at most PASSAGE_MAX m long along the way,
 * has the way continuing outside on both sides and meets both walls within MAX_SKEW of square. At most one passage per
 * building and way. Deterministic (input order).
 */
export function findPassages(buildings: readonly OsmBuilding[], roads: readonly OsmRoad[]): Passage[] {
  const cands = buildings.filter(solidCandidate);
  const grid = new BoxGrid(32);
  cands.forEach((b, k) => {
    const bb = bounds(b.ring);
    grid.add(k, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
  });
  const out: Passage[] = [];
  for (const r of roads) {
    if (!footWay(r)) {
      continue;
    }
    const hw = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, r.widthTagged ? r.width : WIDTH_DEFAULT)) / 2;
    // Candidate buildings: grid cells along the way, sampled every 8 m.
    const near = new Set<number>();
    for (let k = 2; k < r.pts.length; k += 2) {
      const len = Math.hypot(r.pts[k] - r.pts[k - 2], r.pts[k + 1] - r.pts[k - 1]);
      const steps = Math.max(1, Math.ceil(len / 8));
      for (let q = 0; q <= steps; q++) {
        for (const id of grid.at(r.pts[k - 2] + ((r.pts[k] - r.pts[k - 2]) * q) / steps, r.pts[k - 1] + ((r.pts[k + 1] - r.pts[k - 1]) * q) / steps)) {
          near.add(id);
        }
      }
    }
    for (const id of [...near].sort((p, q) => p - q)) {
      const b = cands[id];
      const rings = [b.ring, ...(b.holes ?? [])];
      const solid = (x: number, z: number): boolean => pointInRing(b.ring, x, z) && !(b.holes ?? []).some((h) => pointInRing(h, x, z));
      // Another building right outside a portal: the way runs on through the next block (no single passage).
      const others = (x: number, z: number): boolean => grid.at(x, z).some((k) => k !== id && pointInRing(cands[k].ring, x, z) && !(cands[k].holes ?? []).some((h) => pointInRing(h, x, z)));
      // Crossings of the way with the building's walls, as distance along the way.
      const hits: { s: number; x: number; z: number }[] = [];
      let along = 0;
      for (let k = 2; k < r.pts.length; k += 2) {
        const px = r.pts[k - 2];
        const pz = r.pts[k - 1];
        const qx = r.pts[k];
        const qz = r.pts[k + 1];
        const len = Math.hypot(qx - px, qz - pz);
        const seg: { s: number; x: number; z: number }[] = [];
        for (const ring of rings) {
          const n = ring.length / 2;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const t = cross(px, pz, qx, qz, ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]);
            if (t >= 0) {
              seg.push({ s: along + t * len, x: px + (qx - px) * t, z: pz + (qz - pz) * t });
            }
          }
        }
        hits.push(...seg.sort((p, q) => p.s - q.s));
        along += len;
      }
      for (let h = 1; h < hits.length; h++) {
        const e0 = hits[h - 1];
        const e1 = hits[h];
        const run = e1.s - e0.s;
        if (run < 0.5 || run > PASSAGE_MAX || e0.s < 0.3 || e1.s > along - 0.3) {
          continue;
        }
        // Inside the solid between the crossings, outside just beyond them.
        const at = (s: number): [number, number] => {
          let acc = 0;
          for (let k = 2; k < r.pts.length; k += 2) {
            const l = Math.hypot(r.pts[k] - r.pts[k - 2], r.pts[k + 1] - r.pts[k - 1]);
            if (acc + l >= s || k + 2 >= r.pts.length) {
              const t = l > 0 ? Math.max(0, Math.min(1, (s - acc) / l)) : 0;
              return [r.pts[k - 2] + (r.pts[k] - r.pts[k - 2]) * t, r.pts[k - 1] + (r.pts[k + 1] - r.pts[k - 1]) * t];
            }
            acc += l;
          }
          return [r.pts[0], r.pts[1]];
        };
        const mid = at((e0.s + e1.s) / 2);
        const pre = at(e0.s - 0.25);
        const post = at(e1.s + 0.25);
        if (!solid(mid[0], mid[1]) || solid(pre[0], pre[1]) || solid(post[0], post[1])) {
          continue;
        }
        const len = Math.hypot(e1.x - e0.x, e1.z - e0.z);
        if (len < 0.5) {
          continue;
        }
        const dx = (e1.x - e0.x) / len;
        const dz = (e1.z - e0.z) / len;
        if (others(pre[0], pre[1]) || others(post[0], post[1])) {
          continue;
        }
        // The chord must stay inside the solid (a way bending round a corner is not a straight passage).
        let straight = true;
        for (let q = 1; q < 8 && straight; q++) {
          straight = solid(e0.x + (e1.x - e0.x) * (q / 8), e0.z + (e1.z - e0.z) * (q / 8));
        }
        if (!straight || Math.abs(ringArea(b.ring)) < 20) {
          continue;
        }
        const pass: Passage = { building: b.id, road: r.id, ax: e0.x, az: e0.z, bx: e1.x, bz: e1.z, dx, dz, hw };
        if (!portalWalls(pass, rings)) {
          continue;
        }
        out.push(pass);
        break;
      }
    }
  }
  return out;
}

/**
 * Sutherland–Hodgman clip of `ring` to the half-plane (x - ox) * nx + (z - oz) * nz >= 0. Concave rings may come out
 * with zero-width bridges between their pieces, which neither a collider's point-in-ring test nor a fill sees.
 */
export function clipHalfPlane(ring: readonly number[], ox: number, oz: number, nx: number, nz: number): number[] {
  const out: number[] = [];
  const n = ring.length / 2;
  const side = (i: number): number => (ring[i * 2] - ox) * nx + (ring[i * 2 + 1] - oz) * nz;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const si = side(i);
    const sj = side(j);
    if (si >= 0) {
      out.push(ring[i * 2], ring[i * 2 + 1]);
    }
    if ((si >= 0) !== (sj >= 0)) {
      const t = si / (si - sj);
      out.push(ring[i * 2] + (ring[j * 2] - ring[i * 2]) * t, ring[i * 2 + 1] + (ring[j * 2 + 1] - ring[i * 2 + 1]) * t);
    }
  }
  return out.length >= 6 ? out : [];
}

/** Half-plane (x - ox) * nx + (z - oz) * nz >= 0. */
type HalfPlane = [number, number, number, number];

/**
 * Collider pieces of a building with passages (`rings`: outline and courtyards): every ring clipped to the convex
 * regions on either side of each passage's corridor (its clear width) and before / after it (1 m past each portal),
 * plus the corridor itself (`vault`: the passage whose vault it is; it collides only above the crown). Clipping every
 * ring by the same convex region keeps the even-odd inside test of the pieces equal to the building's.
 */
export function passageColliders(rings: readonly (readonly number[])[], passages: readonly Passage[]): { rings: number[][]; vault: Passage | null }[] {
  let regions: { planes: HalfPlane[]; vault: Passage | null }[] = [{ planes: [], vault: null }];
  for (const p of passages) {
    const nx = -p.dz;
    const nz = p.dx;
    const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
    const lo: HalfPlane = [p.ax + nx * p.hw, p.az + nz * p.hw, -nx, -nz];
    const ro: HalfPlane = [p.ax - nx * p.hw, p.az - nz * p.hw, nx, nz];
    const pieces: { planes: HalfPlane[]; vault: boolean }[] = [
      { planes: [[p.ax + nx * p.hw, p.az + nz * p.hw, nx, nz]], vault: false },
      { planes: [[p.ax - nx * p.hw, p.az - nz * p.hw, -nx, -nz]], vault: false },
      { planes: [lo, ro, [p.ax - p.dx, p.az - p.dz, -p.dx, -p.dz]], vault: false },
      { planes: [lo, ro, [p.ax + p.dx * (len + 1), p.az + p.dz * (len + 1), p.dx, p.dz]], vault: false },
      { planes: [lo, ro, [p.ax - p.dx, p.az - p.dz, p.dx, p.dz], [p.ax + p.dx * (len + 1), p.az + p.dz * (len + 1), -p.dx, -p.dz]], vault: true },
    ];
    const next: typeof regions = [];
    for (const r of regions) {
      for (const q of pieces) {
        next.push({ planes: [...r.planes, ...q.planes], vault: q.vault ? p : r.vault });
      }
    }
    regions = next;
  }
  const out: { rings: number[][]; vault: Passage | null }[] = [];
  for (const reg of regions) {
    const clipped = rings.map((ring) => reg.planes.reduce<number[]>((acc, [ox, oz, nx, nz]) => (acc.length ? clipHalfPlane(acc, ox, oz, nx, nz) : acc), ring.slice()));
    if (clipped[0].length >= 6) {
      out.push({ rings: clipped.filter((q) => q.length >= 6), vault: reg.vault });
    }
  }
  return out;
}
