/**
 * Ground wear of the street tiles (format 1.1; S1 round 2 realism pass, critique "the squares read as a flat,
 * near-white plane"): planned once per compile, used by the street ground (ground.ts) and emitted by streetWearStep.
 *
 * - Patches (convex polygons that cut the ground mesh along exact straight edges):
 *   - `apron`: the smooth concrete screed of the arrival square where the photos show it (c04 foreground, the c02
 *     left foreground); the pavers stay along the quay, round the 1926 pier and right of the c02 camera;
 *   - `relay`: pavers or slabs relaid after a dig, in another tone and with the paving pattern turned 90° and shifted
 *     (kills the texture repeat and reads as a repair);
 *   - `trench`: long, narrow asphalt fills of utility trenches across paving;
 *   - `road`: newer, darker asphalt patches on carriageways, densest along the tram rails;
 *   - `pit`: tree pits (soil 5 cm down, granite edging).
 * - Hollows: shallow dips (1.5-3 cm) in the paving where rain stands (puddles on the square, at gully grates and fish
 *   stalls); nested octagons give the ground vertices to shape them, a wet film fills them (BLEND, COLOR_0 alpha).
 * - Micro relief: a few millimetres of low-frequency unevenness away from kerbs and walls (never above the compiled
 *   surface, so markings and props keep their height).
 * - Desire lines across the square (pier gates, bus stop, crossing): darker, more worn paving; the crowd walks them.
 * - Stains and small damage (procedural decal geometry, merged per material and tile): oil and drip stains in the
 *   lane centres (more before stop lines), grime halos under benches, bins, masts and at the pier gates, chewing-gum
 *   spots at the gates and the bus stop, broken and missing pavers, cracked slabs, tar-sealed cracks on asphalt and
 *   the concrete apron, and bitumen seals along the tram rails.
 * `_WEATHER` on the ground vertices: dirt (x) for contact and gutter grime and desire lines, damp (w) round puddles,
 * in gutters and on the fish end. COLOR_0 carries the same darkening for runtimes that ignore `_WEATHER`.
 */
import { BoxGrid, hash, pointInRing, segDist } from '../../../../src/world/osm/shared/geometry';
import { LOD0, type RGBA, type Vec3, type Weather } from '../mesh';
import type { MaterialName } from '../materials';
import type { AreaContext, CompileStep, TileContext } from '../registry';
import { inTile, rng, streetContext, streetTile, valueNoise, type StreetContext } from './common';
import { streetPlan } from './furniture';

export type PatchKind = 'apron' | 'relay' | 'trench' | 'road' | 'pit' | 'hollow';

export interface WearPatch {
  id: number;
  kind: PatchKind;
  /** Convex ring [x, z, ...], counter-clockwise seen from above (+Y). */
  ring: number[];
  /** Half-planes of the ring: inside where nx·x + nz·z <= c. */
  edges: [number, number, number][];
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** COLOR_0 multiplier of the patch surface. */
  tone: number;
  /** Paving frame turn (rad) and shift (m) of a relay patch. */
  turn: number;
  shift: number;
}

export interface Hollow {
  x: number;
  z: number;
  rx: number;
  rz: number;
  ang: number;
  depth: number;
  /** Alpha of the wet film (0: a dry dip). */
  wet: number;
}

export interface WearPlan {
  patches: WearPatch[];
  hollows: Hollow[];
  /** Material patches whose bounds meet a box (hollows included for the vertex cuts). */
  patchesIn(minX: number, minZ: number, maxX: number, maxZ: number): WearPatch[];
  /** The top material patch (not a hollow) containing (x, z). */
  patchAt(x: number, z: number): WearPatch | null;
  /** True inside the square's concrete apron. */
  apronAt(x: number, z: number): boolean;
  /** Depth (m, >= 0) of the ground below the compiled surface at (x, z). */
  dip(x: number, z: number): number;
  /** Damp (0..1) at (x, z): puddle rims, the fish end. */
  damp(x: number, z: number): number;
  /** Wear (0..1) of the desire lines across the square. */
  trodden(x: number, z: number): number;
  /** Desire lines of the square (polylines [x, z, ...]) and their weights (people per hour, relative). */
  desire: { pts: number[]; weight: number }[];
  /** Named points of the square: pier gates, the bus stop, the crossing. */
  gates: { id: string; x: number; z: number; faceX: number; faceZ: number }[];
}

const OCT = 8;

function convex(id: number, kind: PatchKind, pts: [number, number][], tone = 1, turn = 0, shift = 0): WearPatch {
  // Hull (monotone chain), counter-clockwise from above: +X east, +Z south, so "above" turns the usual orientation.
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of [...P].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  const ring = hull.flat();
  const edges: [number, number, number][] = [];
  let cx = 0;
  let cz = 0;
  for (const p of hull) {
    cx += p[0] / hull.length;
    cz += p[1] / hull.length;
  }
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k];
    const b = hull[(k + 1) % hull.length];
    let nx = b[1] - a[1];
    let nz = -(b[0] - a[0]);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    let c = nx * a[0] + nz * a[1];
    if (nx * cx + nz * cz > c) {
      nx = -nx;
      nz = -nz;
      c = -c;
    }
    edges.push([nx, nz, c]);
  }
  const xs = hull.map((p) => p[0]);
  const zs = hull.map((p) => p[1]);
  return { id, kind, ring, edges, minX: Math.min(...xs), minZ: Math.min(...zs), maxX: Math.max(...xs), maxZ: Math.max(...zs), tone, turn, shift };
}

/** Rectangle centred at (x, z), long axis along angle `ang`, half sizes hu (along) and hv (across). */
function rect(id: number, kind: PatchKind, x: number, z: number, ang: number, hu: number, hv: number, tone = 1, turn = 0, shift = 0): WearPatch {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const pts: [number, number][] = [
    [-hu, -hv],
    [hu, -hv],
    [hu, hv],
    [-hu, hv],
  ].map(([u, v]) => [x + u * c - v * s, z + u * s + v * c]);
  return convex(id, kind, pts, tone, turn, shift);
}

function octagon(id: number, h: Hollow, k: number): WearPatch {
  const pts: [number, number][] = [];
  for (let q = 0; q < OCT; q++) {
    const a = (q / OCT) * Math.PI * 2 + Math.PI / OCT;
    const lx = Math.cos(a) * h.rx * k;
    const lz = Math.sin(a) * h.rz * k;
    pts.push([h.x + lx * Math.cos(h.ang) - lz * Math.sin(h.ang), h.z + lx * Math.sin(h.ang) + lz * Math.cos(h.ang)]);
  }
  return convex(id, 'hollow', pts);
}

export const insidePatch = (p: WearPatch, x: number, z: number): boolean => p.edges.every(([nx, nz, c]) => nx * x + nz * z <= c + 1e-9);

/** Square gates and desire lines (s1-strip.md §1: P0 bus stop, P2 crossing; the pier gates from the hero outlines). */
function squareLines(sc: StreetContext): { gates: WearPlan['gates']; desire: WearPlan['desire'] } {
  const sp = sc.spine;
  if (sc.square.length < 6 || sp.length < 6) {
    return { gates: [], desire: [] };
  }
  const P0: [number, number] = [sp[0], sp[1]];
  const P2: [number, number] = [sp[4], sp[5]];
  const gates: WearPlan['gates'] = [
    // 1926 pier: the east loggia's middle arch (c01), people face west into it.
    { id: 'pier1926', x: 160.5, z: 5929.5, faceX: -1, faceZ: 0 },
    // New pier: its passenger gate on the square side (c02 right, c03), facing north.
    { id: 'pierNew', x: 236, z: 5884, faceX: 0.05, faceZ: -1 },
    { id: 'busStop', x: P0[0], z: P0[1], faceX: 0.35, faceZ: 0.94 },
    { id: 'crossing', x: P2[0] - 1.5, z: P2[1] - 0.6, faceX: 0.2, faceZ: 1 },
  ];
  const g = (id: string): [number, number] => {
    const q = gates.find((k) => k.id === id)!;
    return [q.x, q.z];
  };
  const bend = (a: [number, number], b: [number, number], side: number): number[] => {
    // A walked line is never straight: a slight bow (3 % of its length) and the ends.
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / l;
    const nz = (b[0] - a[0]) / l;
    return [a[0], a[1], mx + nx * l * 0.03 * side, mz + nz * l * 0.03 * side, b[0], b[1]];
  };
  // The new pier carries most ferry traffic; the 1926 pier's lines run down the middle of the c01 telephoto, where the
  // photo shows only a handful of people.
  const desire = [
    { pts: bend(g('pier1926'), g('crossing'), 1), weight: 0.45 },
    { pts: bend(g('pierNew'), g('crossing'), -1), weight: 1 },
    { pts: bend(g('pier1926'), g('busStop'), -1), weight: 0.3 },
    { pts: bend(g('pierNew'), g('busStop'), 1), weight: 0.7 },
    { pts: bend(g('busStop'), g('crossing'), 1), weight: 0.5 },
    { pts: bend(g('pier1926'), g('pierNew'), 1), weight: 0.2 },
  ];
  return { gates, desire };
}

function planWear(a: AreaContext): WearPlan {
  const sc = streetContext(a);
  const s = a.foundation.surface;
  const fp = a.foundation.footprints;
  const tileOf = (x: number, z: number): string => `${Math.floor(x / 100)}_${Math.floor(z / 100)}`;
  const streetTileId = (id: string): boolean => a.manifests.has(id) && (a.detailOf(id) === 'full' || sc.kitTiles.has(id));
  const onStreet = (x: number, z: number): boolean => streetTileId(tileOf(x, z));
  const patches: WearPatch[] = [];
  const hollows: Hollow[] = [];
  const r = rng(80317);
  let id = 0;
  const { gates, desire } = squareLines(sc);

  /* The square's concrete apron (c04 foreground, c02 left of the camera): two convex parts; pavers elsewhere. */
  if (sc.square.length >= 6) {
    // West part: south of the c02 camera's line of sight (the photo's smooth left foreground; its right is pavers).
    patches.push(convex(id++, 'apron', [[189, 5939.4], [151, 5918], [150, 5990], [160, 5995], [192, 5980]], 1));
    patches.push(
      convex(id++, 'apron', [[187.5, 5940.5], [207, 5902.5], [236, 5889.5], [253, 5886.5], [256, 5899], [268, 5926], [285, 5936], [240, 5957], [192, 5980]], 1),
    );
  }
  const apronAt = (x: number, z: number): boolean => patches.some((p) => p.kind === 'apron' && insidePatch(p, x, z));
  /** Paved, open ground (not a building, carriageway, lawn or the apron). */
  const paved = (x: number, z: number): boolean => onStreet(x, z) && !fp.inside(x, z) && s.buildingDistance(x, z) > 0.8 && s.distance(x, z) > 0.6 && a.land(x, z) > 1.5 && !s.geo.isWater(x, z);

  /* Relay and trench patches on the square's pavers (about one per 150 m²), the sidewalks and the lanes. */
  if (sc.square.length >= 6) {
    for (let k = 0; k < 70; k++) {
      const x = 150 + r() * 136;
      const z = 5872 + r() * 124;
      if (!sc.inSquare(x, z) || !paved(x, z) || apronAt(x, z)) {
        continue;
      }
      if (r() < 0.8) {
        patches.push(rect(id++, 'relay', x, z, 0, 0.6 + r() * 1.6, 0.4 + r() * 1.0, 0.8 + r() * 0.32, Math.PI / 2, r() * 2));
      } else {
        const ang = r() < 0.5 ? 0 : Math.PI / 2;
        patches.push(rect(id++, 'trench', x, z, ang, 2 + r() * 5, 0.3 + r() * 0.2, 0.85 + r() * 0.2));
      }
    }
    // The apron: darker concrete repairs.
    for (let k = 0; k < 60; k++) {
      const x = 150 + r() * 136;
      const z = 5872 + r() * 124;
      if (sc.inSquare(x, z) && paved(x, z) && apronAt(x, z)) {
        // Mostly square-ish cut-outs aligned with the square's axis (service covers, relaid slabs), some long strips.
        const long = r() < 0.3;
        patches.push(rect(id++, 'road', x, z, (r() < 0.7 ? 0.45 : 0.45 + Math.PI / 2) + (r() - 0.5) * 0.1, long ? 3 + r() * 5 : 0.5 + r() * 1.6, long ? 0.3 + r() * 0.3 : 0.4 + r() * 1.1, 0.62 + r() * 0.26));
      }
    }
  }
  for (const st of sc.streets) {
    let along = 0;
    let next = 5 + hash(st.road * 0.29) * 20;
    for (let k = 2; k < st.pts.length; k += 2) {
      const ax = st.pts[k - 2];
      const az = st.pts[k - 1];
      const len = Math.hypot(st.pts[k] - ax, st.pts[k + 1] - az);
      if (len < 1e-3) {
        continue;
      }
      const tx = (st.pts[k] - ax) / len;
      const tz = (st.pts[k + 1] - az) / len;
      const ang = Math.atan2(tz, tx);
      while (next < along + len) {
        const f = next - along;
        next += 9 + hash(next * 0.7 + st.road) * 22;
        const cx = ax + tx * f;
        const cz = az + tz * f;
        if (!onStreet(cx, cz)) {
          continue;
        }
        const h1 = hash(next * 1.3 + st.road * 0.1);
        if (st.pedestrian || !st.kerbed) {
          // Lanes: relaid slabs somewhere across the lane.
          const o = (h1 - 0.5) * st.hw * 1.4;
          const x = cx - tz * o;
          const z = cz + tx * o;
          if (paved(x, z) || (s.pedestrianStreet(x, z) && !fp.inside(x, z) && s.buildingDistance(x, z) > 0.6)) {
            patches.push(rect(id++, 'relay', x, z, ang, 0.6 + h1 * 1.2, 0.5 + hash(next) * 0.7, 0.82 + hash(next * 3.1) * 0.3, Math.PI / 2, hash(next * 5.3) * 2));
          }
        } else {
          // Carriageway: a newer asphalt patch in one of the wheel paths, and a relaid stretch of sidewalk.
          const o = (h1 < 0.5 ? -1 : 1) * st.hw * (0.25 + 0.4 * hash(next * 2.7));
          const x = cx - tz * o;
          const z = cz + tx * o;
          if (s.distance(x, z) < -0.8) {
            patches.push(rect(id++, 'road', x, z, ang, 0.5 + hash(next * 4.1) * 2.2, 0.35 + hash(next * 6.7) * 0.8, 0.62 + hash(next * 8.3) * 0.25));
          }
          for (const side of [-1, 1]) {
            if (hash(next * 9.1 + side) > 0.45) {
              continue;
            }
            for (let d = st.hw + 0.8; d < st.hw + 5; d += 0.4) {
              const px = cx - tz * d * side;
              const pz = cz + tx * d * side;
              if (s.distance(px, pz) > 1.2 && s.kerbed(px, pz) && paved(px, pz)) {
                patches.push(rect(id++, 'relay', px, pz, ang, 0.7 + hash(next * 7.9) * 1.5, 0.45 + hash(next * 3.3) * 0.5, 0.85 + hash(next * 2.2) * 0.25, Math.PI / 2, hash(next) * 2));
                break;
              }
            }
          }
        }
      }
      along += len;
    }
  }
  /* Along the tram rails: asphalt repairs straddling one rail or the whole track every 6-18 m (the soul catalogue:
     "asphalt patches as darker, slightly raised rectangles over trenches, especially around the T3 rails"). */
  for (const tr of sc.tram) {
    let along = 0;
    let next = 3;
    for (let k = 2; k < tr.pts.length; k += 2) {
      const ax = tr.pts[k - 2];
      const az = tr.pts[k - 1];
      const len = Math.hypot(tr.pts[k] - ax, tr.pts[k + 1] - az);
      if (len < 1e-3) {
        continue;
      }
      const tx = (tr.pts[k] - ax) / len;
      const tz = (tr.pts[k + 1] - az) / len;
      while (next < along + len) {
        const f = next - along;
        const h1 = hash(next * 0.61);
        next += 6 + h1 * 12;
        const x = ax + tx * f;
        const z = az + tz * f;
        if (!onStreet(x, z) || s.distance(x, z) > -0.5) {
          continue;
        }
        const whole = hash(next * 3.7) < 0.4;
        const side = hash(next * 1.9) < 0.5 ? -1 : 1;
        const o = whole ? 0 : side * tr.gauge * 0.5;
        const hl = 0.6 + hash(next * 5.1) * 2.4;
        const hw = whole ? tr.gauge / 2 + 0.25 + hash(next) * 0.3 : 0.25 + hash(next * 2.3) * 0.2;
        patches.push(rect(id++, 'road', x - tz * o, z + tx * o, Math.atan2(tz, tx), hl, hw, 0.58 + hash(next * 7.3) * 0.2));
      }
      along += len;
    }
  }

  /* Tree pits: every OSM tree on paving (not in a lawn): a 1.2 m square pit aligned to the nearest street. */
  for (const m of a.manifests.values()) {
    if (!streetTileId(m.id)) {
      continue;
    }
    for (const t of m.trees) {
      const [x, , z] = t.position;
      if (!paved(x, z) && !(s.pedestrianStreet(x, z) && s.buildingDistance(x, z) > 1)) {
        continue;
      }
      const g = s.groundAt(x, z);
      void g;
      const st = sc.near(x, z, 30);
      const ang = st ? Math.atan2(st.tz, st.tx) : 0;
      patches.push(rect(id++, 'pit', x, z, ang, 0.6, 0.6, 1));
    }
  }

  /* Hollows: puddles in the square (after rain a puddle every 10-20 m, soul §44, and the c02 photo's puddles right of
     the camera), at round gully grates (markings.ts) and in front of fish stalls (their wet films stay in markings). */
  if (sc.square.length >= 6) {
    const cands: [number, number, number][] = [];
    for (let k = 0; k < 60; k++) {
      const x = 150 + hash(k * 2.9 + 7) * 136;
      cands.push([x, 5872 + hash(k * 4.1 + 3) * 124, 0.6 + hash(x * 3.1) * 1.3]);
    }
    // The c02 photo: a cluster of puddles 8-20 m ahead-right of the camera, on the pavers.
    for (const [ahead, right, rx] of [
      [9, 3.5, 1.4],
      [12, 1.2, 2.0],
      [15, 5.5, 1.1],
      [7.5, 6.5, 0.9],
      [19, 2.5, 1.6],
    ]) {
      const h = (299.5 * Math.PI) / 180;
      const fx = Math.sin(h);
      const fz = -Math.cos(h);
      cands.unshift([189.8 + fx * ahead + Math.cos(h) * right, 5937.6 + fz * ahead + Math.sin(h) * right, rx]);
    }
    let n = 0;
    for (const c of cands) {
      const [x, z, rx] = c;
      if (n >= 18 || !sc.inSquare(x, z) || !paved(x, z) || s.buildingDistance(x, z) < 2.5) {
        continue;
      }
      if (hollows.some((q) => Math.hypot(q.x - x, q.z - z) < 4)) {
        continue;
      }
      hollows.push({ x, z, rx, rz: rx * (0.45 + hash(z) * 0.3), ang: hash(x + z) * Math.PI, depth: 0.015 + hash(x * 0.7) * 0.015, wet: 0.5 + 0.3 * hash(z * 1.7) });
      n++;
    }
  }
  const hollowPatches = hollows.flatMap((h) => [octagon(id++, h, 1.35), octagon(id++, h, 0.5)]);
  const all = [...patches, ...hollowPatches];
  const grid = new BoxGrid(12);
  all.forEach((p, k) => grid.add(k, p.minX, p.minZ, p.maxX, p.maxZ));
  const hgrid = new BoxGrid(12);
  hollows.forEach((h, k) => hgrid.add(k, h.x - h.rx * 2, h.z - h.rx * 2, h.x + h.rx * 2, h.z + h.rx * 2));
  const dgrid = new BoxGrid(20);
  const dsegs: [number, number, number, number, number][] = [];
  for (const d of desire) {
    for (let k = 2; k < d.pts.length; k += 2) {
      const q = dsegs.push([d.pts[k - 2], d.pts[k - 1], d.pts[k], d.pts[k + 1], d.weight]) - 1;
      dgrid.add(q, Math.min(d.pts[k - 2], d.pts[k]) - 4, Math.min(d.pts[k - 1], d.pts[k + 1]) - 4, Math.max(d.pts[k - 2], d.pts[k]) + 4, Math.max(d.pts[k - 1], d.pts[k + 1]) + 4);
    }
  }
  /** Normalised elliptic radius of (x, z) in hollow h. */
  const rad = (h: Hollow, x: number, z: number): number => {
    const dx = x - h.x;
    const dz = z - h.z;
    const lx = dx * Math.cos(h.ang) + dz * Math.sin(h.ang);
    const lz = -dx * Math.sin(h.ang) + dz * Math.cos(h.ang);
    return Math.hypot(lx / h.rx, lz / h.rz);
  };
  const plan: WearPlan = {
    patches,
    hollows,
    gates,
    desire,
    patchesIn: (minX, minZ, maxX, maxZ) => {
      const out = new Set<WearPatch>();
      for (const [x, z] of [
        [minX, minZ],
        [maxX, minZ],
        [minX, maxZ],
        [maxX, maxZ],
        [(minX + maxX) / 2, (minZ + maxZ) / 2],
      ]) {
        for (const k of grid.at(x, z)) {
          const p = all[k];
          if (p.maxX > minX && p.minX < maxX && p.maxZ > minZ && p.minZ < maxZ) {
            out.add(p);
          }
        }
      }
      return [...out].sort((p, q) => p.id - q.id);
    },
    patchAt: (x, z) => {
      let best: WearPatch | null = null;
      for (const k of grid.at(x, z)) {
        const p = all[k];
        if (p.kind !== 'hollow' && (!best || p.id > best.id) && insidePatch(p, x, z)) {
          best = p;
        }
      }
      return best;
    },
    apronAt,
    dip: (x, z) => {
      let d = 0;
      for (const k of hgrid.at(x, z)) {
        const h = hollows[k];
        const q = rad(h, x, z);
        if (q < 1.35) {
          const t = Math.max(0, 1 - (q / 1.35) ** 2);
          d = Math.max(d, h.depth * t * t * (3 - 2 * t));
        }
      }
      // Millimetre unevenness of old paving, faded out at kerbs, walls and the coast.
      const mask = Math.min(1, Math.max(0, (s.buildingDistance(x, z) - 0.8) / 1.2)) * Math.min(1, Math.max(0, (s.distance(x, z) - 0.5) / 1.0)) * Math.min(1, Math.max(0, (a.land(x, z) - 1) / 1.5));
      if (mask > 0) {
        d += mask * 0.005 * (0.6 * valueNoise(x, z, 2.3, 21) + 0.4 * valueNoise(x, z, 0.9, 22));
      }
      return d;
    },
    damp: (x, z) => {
      let w = 0;
      for (const k of hgrid.at(x, z)) {
        const h = hollows[k];
        const q = rad(h, x, z);
        if (h.wet > 0 && q < 1.35) {
          w = Math.max(w, Math.min(1, (1.35 - q) / 0.5) * 0.85);
        }
      }
      return w;
    },
    trodden: (x, z) => {
      let t = 0;
      for (const k of dgrid.at(x, z)) {
        const [ax, az, bx, bz, wgt] = dsegs[k];
        const d = segDist(x, z, ax, az, bx, bz);
        if (d < 3.5) {
          t = Math.max(t, wgt * (1 - d / 3.5) ** 1.5);
        }
      }
      return Math.min(1, t);
    },
  };
  return plan;
}

export function wearPlan(a: AreaContext): WearPlan {
  let p = a.shared.get('streetWear') as WearPlan | undefined;
  if (!p) {
    p = planWear(a);
    a.shared.set('streetWear', p);
  }
  return p;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Stains and small damage (streetWearStep).
 * ------------------------------------------------------------------------------------------------------------- */

interface Blobs {
  pos: number[];
  idx: number[];
  col: RGBA[];
}

const newBlobs = (): Blobs => ({ pos: [], idx: [], col: [] });

/**
 * Soft stain: a wobbly disc on the ground, opaque-ish centre fading to alpha 0 at the rim (BLEND material, COLOR_0
 * alpha), `lift` above the street ground.
 */
function blob(b: Blobs, y: (x: number, z: number) => number, x: number, z: number, rx: number, rz: number, ang: number, rgb: [number, number, number], alpha: number, seed: number, lift = 0.004, sides = 12, hard = 0): void {
  const base = b.pos.length / 3;
  b.pos.push(x, y(x, z) + lift, z);
  b.col.push([rgb[0], rgb[1], rgb[2], alpha]);
  const inner = hard > 0;
  for (let ring = inner ? 0 : 1; ring < 2; ring++) {
    const k = ring === 0 ? hard : 1;
    for (let q = 0; q < sides; q++) {
      const a2 = (q / sides) * Math.PI * 2;
      const wob = 0.72 + 0.28 * hash(seed + q * 1.37) + 0.12 * Math.sin(a2 * 3 + seed);
      const lx = Math.cos(a2) * rx * wob * k;
      const lz = Math.sin(a2) * rz * wob * k;
      const px = x + lx * Math.cos(ang) - lz * Math.sin(ang);
      const pz = z + lx * Math.sin(ang) + lz * Math.cos(ang);
      b.pos.push(px, y(px, pz) + lift, pz);
      b.col.push([rgb[0], rgb[1], rgb[2], ring === 0 ? alpha : 0]);
    }
  }
  if (inner) {
    for (let q = 0; q < sides; q++) {
      const i0 = base + 1 + q;
      const i1 = base + 1 + ((q + 1) % sides);
      b.idx.push(base, i1, i0);
      const o0 = i0 + sides;
      const o1 = i1 + sides;
      b.idx.push(i0, o1, o0, i0, i1, o1);
    }
  } else {
    for (let q = 0; q < sides; q++) {
      b.idx.push(base, base + 1 + ((q + 1) % sides), base + 1 + q);
    }
  }
}

/** Ground strip along a polyline (cracks, tar seals): width tapering by `w(t)`, draped `lift` above the ground. */
function strip(b: Blobs, y: (x: number, z: number) => number, pts: readonly [number, number][], w: (t: number) => number, rgb: [number, number, number], alpha: number, lift: number): void {
  if (pts.length < 2) {
    return;
  }
  const base = b.pos.length / 3;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[Math.max(0, k - 1)];
    const q = pts[Math.min(pts.length - 1, k + 1)];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const nx = -(q[1] - p[1]) / l;
    const nz = (q[0] - p[0]) / l;
    const hw = w(k / (pts.length - 1)) / 2;
    for (const side of [-1, 1]) {
      const x = pts[k][0] + nx * hw * side;
      const z = pts[k][1] + nz * hw * side;
      b.pos.push(x, y(x, z) + lift, z);
      b.col.push([rgb[0], rgb[1], rgb[2], alpha]);
    }
  }
  for (let k = 0; k + 1 < pts.length; k++) {
    const a0 = base + k * 2;
    b.idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
  }
}

/** A crack: a jagged random walk from (x, z) heading `ang`, `len` metres, with an optional branch. */
function crackPts(x: number, z: number, ang: number, len: number, seed: number): [number, number][] {
  const out: [number, number][] = [[x, z]];
  let a2 = ang;
  let px = x;
  let pz = z;
  const step = len > 1.5 ? 0.2 : 0.07;
  for (let d = 0; d < len; d += step) {
    a2 += (hash(seed + d * 13.7) - 0.5) * 0.9;
    a2 += (ang - a2) * 0.15;
    px += Math.cos(a2) * step;
    pz += Math.sin(a2) * step;
    out.push([px, pz]);
  }
  return out;
}

function flush(t: TileContext, m: MaterialName, b: Blobs): void {
  if (!b.idx.length) {
    return;
  }
  const n = b.pos.length / 3;
  const normals = new Array<number>(n * 3).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0));
  t.mesh.addMesh(m, { positions: b.pos, indices: b.idx, normals, color: b.col, lod: LOD0 });
}

export interface WearStats {
  oil: number;
  grime: number;
  gum: number;
  broken: number;
  cracks: number;
  seals: number;
  pits: number;
}

export function buildWear(t: TileContext): WearStats {
  const a = t.area;
  const sc = streetContext(a);
  const s = a.foundation.surface;
  const plan = streetPlan(a);
  const wear = wearPlan(a);
  const y = (x: number, z: number): number => sc.groundY(x, z) - wear.dip(x, z);
  const stats: WearStats = { oil: 0, grime: 0, gum: 0, broken: 0, cracks: 0, seals: 0, pits: 0 };
  const oil = newBlobs();
  const grime = newBlobs();
  const gum = newBlobs();
  const soil = newBlobs();
  const crack = newBlobs();
  const seal = newBlobs();
  const pitEdge: Vec3[][] = [];
  const b = t.bounds;
  const r = rng(Math.floor(b.minX * 7.3 + b.minZ * 1.9) >>> 0);
  const nearCrossing = (x: number, z: number, d: number): boolean => sc.crossings.some((c) => segDist(x, z, c.ax, c.az, c.bx, c.bz) < d + c.width / 2);

  /* Oil and drip stains: in the lane centres of kerbed carriageways, denser 2-9 m before a zebra (queued cars). */
  for (const st of sc.streets) {
    if (st.pedestrian || !st.kerbed || st.hw < 2.2) {
      continue;
    }
    const lanes = st.lanes || Math.max(st.oneway ? 1 : 2, Math.round((st.hw * 2) / 3.3));
    const lw = (st.hw * 2) / lanes;
    for (let k = 2; k < st.pts.length; k += 2) {
      const ax = st.pts[k - 2];
      const az = st.pts[k - 1];
      const len = Math.hypot(st.pts[k] - ax, st.pts[k + 1] - az);
      if (len < 1e-3) {
        continue;
      }
      const tx = (st.pts[k] - ax) / len;
      const tz = (st.pts[k + 1] - az) / len;
      for (let l = 0; l < lanes; l++) {
        const o = -st.hw + (l + 0.5) * lw;
        for (let f = hash(st.road + l * 3.1 + k) * 3; f < len; f += 1.2) {
          const x = ax + tx * f - tz * o;
          const z = az + tz * f + tx * o;
          if (!inTile(t, x, z) || s.distance(x, z) > -0.8) {
            continue;
          }
          const queue = nearCrossing(x, z, 9) && !nearCrossing(x, z, 2);
          const p = queue ? 0.45 : 0.07;
          const h = hash(x * 3.7 + z * 1.3);
          if (h > p) {
            continue;
          }
          const jx = x - tz * (hash(z * 2.1) - 0.5) * 0.6;
          const jz = z + tx * (hash(z * 2.1) - 0.5) * 0.6;
          const rr = 0.12 + hash(x * 1.9) * (queue ? 0.45 : 0.3);
          blob(oil, y, jx, jz, rr, rr * (0.5 + hash(x) * 0.5), Math.atan2(tz, tx), [0.05, 0.045, 0.04], 0.35 + 0.35 * hash(z), x + z, 0.005, 9, 0.4);
          stats.oil++;
        }
      }
    }
  }

  /* Grime halos under benches, round bins, bollards and mast feet (butts, husks, spilt tea, feet). */
  for (const p of plan.items) {
    const [x, , z] = p.pos;
    if (!inTile(t, x, z)) {
      continue;
    }
    const seed = x * 1.3 + z;
    if (p.prop === 'st_bench') {
      blob(grime, y, x, z + 0.0, 1.3, 0.75, -p.yaw, [0.16, 0.13, 0.1], 0.5, seed, 0.004, 8, 0.45);
      stats.grime++;
    } else if (p.prop === 'st_bin') {
      blob(grime, y, x, z, 0.7, 0.6, hash(seed) * 3, [0.14, 0.12, 0.09], 0.55, seed, 0.004, 8);
      stats.grime++;
    } else if (p.prop.startsWith('lamp_mast') || p.prop === 'st_twin_lantern' || p.prop === 'st_signal' || p.prop === 'st_stop_pole') {
      blob(grime, y, x, z, 0.45, 0.4, hash(seed) * 3, [0.18, 0.15, 0.12], 0.45, seed, 0.004, 8);
      stats.grime++;
    } else if (p.prop === 'st_bollard' && hash(seed) < 0.4) {
      blob(grime, y, x, z, 0.25, 0.22, hash(seed) * 3, [0.2, 0.17, 0.13], 0.4, seed, 0.004, 6);
      stats.grime++;
    }
  }
  /* The pier gates and the bus stop: a worn, grimy apron where everyone passes, with chewing gum trodden flat. */
  for (const g of wear.gates) {
    if (!inTile(t, g.x, g.z)) {
      continue;
    }
    blob(grime, y, g.x + g.faceX * -1.5, g.z + g.faceZ * -1.5, 3.2, 2.2, Math.atan2(g.faceZ, g.faceX), [0.22, 0.2, 0.17], 0.4, g.x, 0.003, 16, 0.5);
    stats.grime++;
  }
  for (const g of wear.gates) {
    const n = g.id === 'crossing' ? 35 : 60;
    for (let k = 0; k < n; k++) {
      const ang = r() * Math.PI * 2;
      const rad = Math.sqrt(r()) * (g.id === 'busStop' ? 4.5 : 6);
      const x = g.x - g.faceX * 3 + Math.cos(ang) * rad;
      const z = g.z - g.faceZ * 3 + Math.sin(ang) * rad;
      if (!inTile(t, x, z) || s.distance(x, z) < 0.3 || s.buildingDistance(x, z) < 0.3) {
        continue;
      }
      const rr = 0.009 + r() * 0.012;
      const shade = r() < 0.7 ? 0.28 + r() * 0.15 : 0.06 + r() * 0.06;
      blob(gum, y, x, z, rr, rr * (0.75 + r() * 0.25), r() * 3, [shade, shade, shade * 0.95], 0.9, x * 7 + z, 0.0045, 5);
      stats.gum++;
    }
  }
  // Sparse gum along the desire lines.
  for (const d of wear.desire) {
    for (let k = 2; k < d.pts.length; k += 2) {
      const ax = d.pts[k - 2];
      const az = d.pts[k - 1];
      const len = Math.hypot(d.pts[k] - ax, d.pts[k + 1] - az);
      for (let f = 0; f < len; f += 0.5) {
        if (r() > 0.25 * d.weight) {
          continue;
        }
        const o = (r() + r() - 1) * 2.5;
        const x = ax + ((d.pts[k] - ax) * f) / len - ((d.pts[k + 1] - az) / len) * o;
        const z = az + ((d.pts[k + 1] - az) * f) / len + ((d.pts[k] - ax) / len) * o;
        if (!inTile(t, x, z) || !sc.inSquare(x, z)) {
          continue;
        }
        const rr = 0.008 + r() * 0.01;
        const shade = 0.25 + r() * 0.18;
        blob(gum, y, x, z, rr, rr * 0.8, r() * 3, [shade, shade, shade], 0.85, x * 5 + z, 0.0045, 5);
        stats.gum++;
      }
    }
  }

  /* Broken and missing pavers on the square and the sidewalks: a dark soil gap with a loose chip beside it. */
  for (const p of wear.patches) {
    if (p.kind !== 'relay' || hash(p.id * 3.3) > 0.45) {
      continue;
    }
    const x = (p.minX + p.maxX) / 2 + (hash(p.id) - 0.5) * 3;
    const z = (p.minZ + p.maxZ) / 2 + (hash(p.id * 2) - 0.5) * 3;
    if (!inTile(t, x, z) || s.distance(x, z) < 0.8 || s.buildingDistance(x, z) < 0.8 || !(sc.inSquare(x, z) || s.kerbed(x, z) || s.pedestrianStreet(x, z))) {
      continue;
    }
    const ang = hash(p.id * 5) < 0.5 ? 0 : Math.PI / 2;
    const w = 0.1 + hash(p.id * 7) * 0.08;
    const l = 0.18 + hash(p.id * 11) * 0.12;
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const q: [number, number][] = [
      [-l / 2, -w / 2],
      [l / 2, -w / 2],
      [l / 2, w / 2],
      [-l / 2, w / 2],
    ].map(([u, v]) => [x + u * c - v * sn, z + u * sn + v * c]);
    const base = soil.pos.length / 3;
    for (const [qx, qz] of q) {
      soil.pos.push(qx, y(qx, qz) + 0.004, qz);
      soil.col.push([0.55, 0.5, 0.45, 1]);
    }
    soil.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    stats.broken++;
  }

  /* Cracked slabs in the lanes (about one per 12 m² of slab), tar-sealed cracks on the apron and on carriageways. */
  for (let k = 0; k < 1500; k++) {
    const x = b.minX + r() * (b.maxX - b.minX);
    const z = b.minZ + r() * (b.maxZ - b.minZ);
    const roll = r();
    const ped = roll < 0.5 && s.pedestrianStreet(x, z) && s.buildingDistance(x, z) > 0.5 && !(sc.inSquare(x, z) && wear.apronAt(x, z));
    const ap = roll < 0.01 && sc.inSquare(x, z) && wear.apronAt(x, z);
    const road = roll < 0.012 && s.distance(x, z) < -0.8 && !s.pedestrianStreet(x, z);
    if (ped) {
      strip(crack, y, crackPts(x, z, r() * Math.PI * 2, 0.3 + r() * 0.5, k * 17.3 + x), (tt) => 0.012 * (1 - tt * 0.7), [0.07, 0.065, 0.06], 1, 0.0042);
      stats.cracks++;
    } else if (ap || road) {
      const pts = crackPts(x, z, r() * Math.PI * 2, 2 + r() * 6, k * 31.1 + z);
      strip(seal, y, pts, () => 0.03 + r() * 0.015, [0.03, 0.03, 0.03], 1, 0.0045);
      if (r() < 0.5) {
        const m2 = pts[Math.floor(pts.length / 2)];
        strip(seal, y, crackPts(m2[0], m2[1], r() * Math.PI * 2, 1 + r() * 2, k * 7.7), () => 0.025, [0.03, 0.03, 0.03], 1, 0.0045);
      }
      stats.seals++;
    }
  }
  /* Bitumen seals along both outer sides of every rail. */
  for (const tr of sc.tram) {
    for (let k = 2; k < tr.pts.length; k += 2) {
      const ax = tr.pts[k - 2];
      const az = tr.pts[k - 1];
      const bx = tr.pts[k];
      const bz = tr.pts[k + 1];
      if (!inTile(t, (ax + bx) / 2, (az + bz) / 2) || s.distance((ax + bx) / 2, (az + bz) / 2) > 0) {
        continue;
      }
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      for (const side of [-1, 1]) {
        const o = side * (tr.gauge / 2 + 0.085);
        strip(seal, y, [
          [ax + nx * o, az + nz * o],
          [bx + nx * o, bz + nz * o],
        ], () => 0.035, [0.035, 0.035, 0.035], 1, 0.0048);
      }
      stats.seals++;
    }
  }

  /* Tree pits: soil sunk 5 cm, a granite edging over the cut, a grime halo. */
  for (const p of wear.patches) {
    if (p.kind !== 'pit') {
      continue;
    }
    const cx = (p.minX + p.maxX) / 2;
    const cz = (p.minZ + p.maxZ) / 2;
    if (!inTile(t, cx, cz)) {
      continue;
    }
    const ring: Vec3[] = [];
    for (let q = 0; q < p.ring.length; q += 2) {
      ring.push([p.ring[q], 0, p.ring[q + 1]]);
    }
    pitEdge.push(ring);
    blob(grime, y, cx, cz, 1.25, 1.25, 0, [0.2, 0.16, 0.12], 0.45, cx, 0.003, 14, 0.55);
    stats.pits++;
  }
  for (const ring of pitEdge) {
    const n = ring.length;
    for (let q = 0; q < n; q++) {
      const A = ring[q];
      const B = ring[(q + 1) % n];
      const len = Math.hypot(B[0] - A[0], B[2] - A[2]);
      const ux = (B[0] - A[0]) / len;
      const uz = (B[2] - A[2]) / len;
      // Outward normal (the ring is convex).
      const cx = ring.reduce((sum, v) => sum + v[0], 0) / n;
      const cz = ring.reduce((sum, v) => sum + v[2], 0) / n;
      let nx = uz;
      let nz = -ux;
      if (nx * (A[0] - cx) + nz * (A[2] - cz) < 0) {
        nx = -nx;
        nz = -nz;
      }
      const w0 = -0.02;
      const w1 = 0.1;
      const y0 = y((A[0] + B[0]) / 2, (A[2] + B[2]) / 2);
      const P = (along: number, out: number, dy: number): Vec3 => [A[0] + ux * along + nx * out, y0 + dy, A[2] + uz * along + nz * out];
      const top = 0.012;
      t.mesh.withLod(LOD0, () => {
        t.mesh.flatPolygon('st_kerb', [P(-w1, w0, top), P(len + w1, w0, top), P(len + w1, w1, top), P(-w1, w1, top)], [0, 1, 0], { weather: [0.5, 0, 0.3, 0] });
        t.mesh.wall('st_kerb', A[0] + nx * w0 + ux * (len + w1), A[2] + nz * w0 + uz * (len + w1), A[0] + nx * w0 - ux * w1, A[2] + nz * w0 - uz * w1, y0 - 0.06, y0 + top, y0 - 0.06, y0 + top, [-nx, 0, -nz], { weather: [0.8, 0, 0.2, 0.3] });
      });
    }
  }

  flush(t, 'st_oil', oil);
  flush(t, 'st_grime', grime);
  flush(t, 'st_gum', gum);
  flush(t, 'st_gap', soil);
  flush(t, 'st_crack', crack);
  flush(t, 'st_seal', seal);
  return stats;
}

export const streetWearStep: CompileStep = {
  id: 'streetWear',
  prepare(a) {
    wearPlan(a);
  },
  tile(t) {
    if (!streetTile(t)) {
      return;
    }
    const st = buildWear(t);
    t.record('streetWear', st);
  },
};

/** Ground `_WEATHER` for a ground vertex: [dirt, 0, 0, damp]. */
export function groundWeather(dirt: number, damp: number): Weather {
  return [Math.min(1, Math.max(0, dirt)), 0, 0, Math.min(1, Math.max(0, damp))];
}

export { pointInRing };
