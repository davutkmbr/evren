/**
 * Walls vs buildings (generic rules, .docs/planning/22-city-walls.md step 5):
 * - No wall piece intersects a building footprint the game or the street compiler draws.
 * - Small sheds and annexes built against / into the wall (SMALL_* thresholds) and buildings that are themselves
 *   parts of the fortifications (ruins, towers, gatehouses) step aside: their ids join the walls' `owned` list, so
 *   the OSM building layers leave them out and the wall stays continuous.
 * - Around every other building the wall is fitted: shifted sideways (up to MAX_SHIFT m) and, if needed, thinned
 *   (down to T_MIN m) to keep CLEAR m off its walls; where even that does not fit, the building stands on the wall
 *   line and the wall breaks there with flush ends (the house abuts the wall).
 * - Towers never stand in a building: shrunk once, else skipped.
 * wallOverlaps() re-checks the finished pieces independently (point sampling) and reports what is left.
 */
import type { TowerParams } from '../../../../src/world/landmarks/walls/kit/kit';
import { crossIntervals, overlaps, type Footprint, type Footprints } from './buildings';
import type { Piece } from './plan';
import { at, inRing, lengths, project, simplify, tangent, type V2 } from './poly';

/** Clearance (m) between a wall face and a building wall. */
export const CLEAR = 0.35;
/** Thinnest fitted wall (m) and the largest sideways shift (m) of the wall axis. */
export const T_MIN = 1.6;
const MAX_SHIFT = 3;
const STEP = 0.5;
/** Widest median (m) between the one-way carriageways of a divided major road. */
const MEDIAN_MAX = 35;
const T_QUANT = 0.2;
/** Small buildings that step aside for the wall: any footprint up to SMALL_ANY m², or up to SMALL_LOW m² when low. */
export const SMALL_ANY = 25;
export const SMALL_LOW = 60;
const LOW_HEIGHT = 4.5;
const SHED_KINDS = new Set(['shed', 'garage', 'garages', 'hut', 'kiosk', 'roof', 'service', 'container', 'cabin', 'toilets', 'carport', 'greenhouse', 'storage_tank', 'transformer_tower', 'booth']);
const WALL_KINDS = new Set(['ruins', 'tower', 'gatehouse', 'castle', 'fortification', 'wall', 'city_wall', 'bastion']);
const WALL_HISTORIC = new Set(['citywalls', 'city_wall', 'city_gate', 'castle', 'fort', 'tower', 'ruins', 'castle_wall']);

export type Displace = 'wall' | 'small';

/** Why a building overlapping the wall steps aside, or null when the wall must fit around it. */
export function displaceable(f: Footprint): Displace | null {
  if (f.road) {
    return null;
  }
  if (WALL_KINDS.has(f.kind) || (f.historic && WALL_HISTORIC.has(f.historic))) {
    return 'wall';
  }
  if (f.area <= SMALL_ANY) {
    return 'small';
  }
  const low = SHED_KINDS.has(f.kind) || (f.levels !== undefined && f.levels <= 1) || (f.height !== undefined && f.height <= LOW_HEIGHT);
  return f.area <= SMALL_LOW && low ? 'small' : null;
}

export interface Fit {
  /** Fitted axis. */
  pts: V2[];
  /** Thickness profile over the fitted axis' arc length (step function at profS). */
  profS: number[];
  profT: number[];
  /** Arc-length intervals (fitted axis) where a building (road = false) or a road / rail bed (road = true) stands on the wall line. */
  blocked: [number, number, boolean][];
  shifted: number;
  thinned: number;
}

interface Hit {
  v0: number;
  v1: number;
  f: Footprint;
}

/**
 * Fits a wall of nominal thickness T (outer batter `bat`) along pts between the buildings. `skip(f)`: footprints the
 * walls draw or displaced already; `displace(f, why)` is called for footprints that step aside (skip() is true for
 * them afterwards).
 */
export function fitRun(pts: readonly V2[], T: number, bat: number, fp: Footprints, skip: (f: Footprint) => boolean, displace: (f: Footprint, why: Displace) => void): Fit {
  const cum = lengths(pts);
  const total = cum[cum.length - 1];
  const N = Math.max(1, Math.ceil(total / STEP));
  const reach = T / 2 + bat + MAX_SHIFT + CLEAR + 1;
  const smp: { p: V2; n: V2; hits: Hit[] }[] = [];
  for (let k = 0; k <= N; k++) {
    const s = (total * k) / N;
    const p = at(pts, cum, s).p;
    const t = tangent(pts, cum, s, 1.5);
    const n: V2 = [-t[1], t[0]];
    const hits: Hit[] = [];
    for (const f of fp.near(p[0], p[1], reach)) {
      if (skip(f)) {
        continue;
      }
      for (const [v0, v1] of crossIntervals(f, p, n, reach)) {
        hits.push({ v0, v1, f });
      }
    }
    smp.push({ p, n, hits });
  }
  // Buildings in the nominal band that step aside.
  const bandLo = -T / 2 - CLEAR;
  const bandHi = T / 2 + bat + CLEAR;
  const considered = new Set<Footprint>();
  for (const q of smp) {
    for (const h of q.hits) {
      if (h.v1 > bandLo && h.v0 < bandHi && !skip(h.f) && !considered.has(h.f)) {
        considered.add(h.f);
        const why = displaceable(h.f);
        // Parts of the fortifications step aside only when they are the wall itself (mostly inside its band): a
        // palace or keep next to the wall stays.
        if (why === 'small' || (why === 'wall' && bandShare(h.f, pts, cum, T / 2 + bat + 1.5) >= 0.6)) {
          displace(h.f, why);
        }
      }
    }
  }
  // Per sample: the free gap that holds the thickest, least shifted wall.
  type Choice = { t: number; g0: number; g1: number } | null;
  const onRoad: boolean[] = [];
  const choice: Choice[] = smp.map((q) => {
    const live = q.hits.filter((h) => !skip(h.f)).sort((a, b) => a.v0 - b.v0);
    const occ = live.map((h) => [h.v0, h.v1] as [number, number]);
    // The median between the two carriageways of a divided major road is road too.
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const A = live[i].f.road;
        const B = live[j].f.road;
        if (A && B && A.major && B.major && A.oneway && B.oneway && live[j].v0 - live[i].v1 > 0 && live[j].v0 - live[i].v1 < MEDIAN_MAX) {
          occ.push([live[i].v1, live[j].v0]);
        }
      }
    }
    occ.sort((a, b) => a[0] - b[0]);
    onRoad.push(occ.some(([a, b]) => a < T / 2 && b > -T / 2) && live.some((h) => h.f.road && h.v0 < T / 2 + 2 && h.v1 > -T / 2 - 2));
    const gaps: [number, number][] = [];
    let cur = -reach;
    for (const [a, b] of occ) {
      if (a > cur) {
        gaps.push([cur, a]);
      }
      cur = Math.max(cur, b);
    }
    if (cur < reach) {
      gaps.push([cur, reach]);
    }
    let best: Choice = null;
    let bestScore = Infinity;
    for (const [g0, g1] of gaps) {
      const t = Math.min(T, g1 - g0 - bat - 2 * CLEAR);
      if (t < T_MIN) {
        continue;
      }
      const lo = g0 + CLEAR + t / 2;
      const hi = g1 - CLEAR - bat - t / 2;
      const c = Math.min(Math.max(0, lo), hi);
      if (Math.abs(c) > MAX_SHIFT) {
        continue;
      }
      const score = Math.abs(c) + (T - t) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = { t, g0, g1 };
      }
    }
    return best;
  });
  // Conservative thickness: the thinnest fit within +-1.5 m, quantized down.
  const W = 3;
  const tq = choice.map((c, k) => {
    if (!c) {
      return NaN;
    }
    let t = c.t;
    for (let j = Math.max(0, k - W); j <= Math.min(N, k + W); j++) {
      const o = choice[j];
      if (o) {
        t = Math.min(t, o.t);
      }
    }
    return Math.max(T_MIN, Math.floor(t / T_QUANT + 1e-6) * T_QUANT);
  });
  const lo = choice.map((c, k) => (c ? c.g0 + CLEAR + tq[k] / 2 : 0));
  const hi = choice.map((c, k) => (c ? c.g1 - CLEAR - bat - tq[k] / 2 : 0));
  const c0 = choice.map((c, k) => (c ? Math.min(Math.max(0, lo[k]), hi[k]) : NaN));
  // Smooth the shift (moving average over +-3 m), then clamp back into each sample's (and its neighbours') room.
  const cs = c0.map((c, k) => {
    if (Number.isNaN(c)) {
      return NaN;
    }
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, k - 6); j <= Math.min(N, k + 6); j++) {
      if (!Number.isNaN(c0[j])) {
        sum += c0[j];
        n++;
      }
    }
    let l = lo[k];
    let h = hi[k];
    for (let j = Math.max(0, k - 1); j <= Math.min(N, k + 1); j++) {
      if (choice[j]) {
        l = Math.max(l, choice[j]!.g0 + CLEAR + tq[k] / 2);
        h = Math.min(h, choice[j]!.g1 - CLEAR - bat - tq[k] / 2);
      }
    }
    const v = sum / n;
    return l <= h ? Math.min(Math.max(v, l), h) : Math.min(Math.max(v, lo[k]), hi[k]);
  });
  // Blocked samples hold the nearest fitted shift (the axis stays continuous through openings).
  let last = 0;
  const shift = cs.map((c) => (Number.isNaN(c) ? last : (last = c)));
  for (let k = N; k >= 0; k--) {
    if (Number.isNaN(cs[k]) && k < N && !Number.isNaN(cs[k + 1])) {
      shift[k] = shift[k + 1];
    }
  }
  const moved: V2[] = smp.map((q, k) => [q.p[0] + q.n[0] * shift[k], q.p[1] + q.n[1] * shift[k]]);
  const mcum = lengths(moved);
  const blocked: [number, number, boolean][] = [];
  let b0 = -1;
  let shifted = 0;
  let thinned = 0;
  for (let k = 0; k <= N; k++) {
    const isB = choice[k] === null;
    if (!isB) {
      if (Math.abs(shift[k]) > 0.05) {
        shifted += total / N;
      }
      if (tq[k] < T - 0.01) {
        thinned += total / N;
      }
    }
    if (isB && b0 < 0) {
      b0 = k;
    }
    if ((!isB || k === N) && b0 >= 0) {
      const k1 = isB ? k : k - 1;
      blocked.push([Math.max(0, mcum[b0] - STEP / 2 - CLEAR), Math.min(mcum[N], mcum[k1] + STEP / 2 + CLEAR), onRoad.slice(b0, k1 + 1).some(Boolean)]);
      b0 = -1;
    }
  }
  const closed = pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  const out = simplify(moved, 0.05);
  if (closed) {
    out[out.length - 1] = out[0];
  }
  return { pts: out, profS: mcum, profT: tq.map((t) => (Number.isNaN(t) ? T : t)), blocked, shifted, thinned };
}

/** Share of a footprint's area within `half` m of the polyline (1 m sample grid). */
function bandShare(f: Footprint, pts: readonly V2[], cum: readonly number[], half: number): number {
  const step = Math.max(1, Math.sqrt(f.area) / 30);
  let n = 0;
  let inside = 0;
  for (let z = f.minZ + step / 2; z < f.maxZ; z += step) {
    for (let x = f.minX + step / 2; x < f.maxX; x += step) {
      if (inRing(x, z, f.ring)) {
        n++;
        if (project(pts, cum, x, z).d <= half) {
          inside++;
        }
      }
    }
  }
  return n ? inside / n : 1;
}

/**
 * Points of curtain / gate bands that stand in a building (every 0.25 m; the faces CLEAR / 3 outside, quarter points,
 * the axis). The plan opens the wall there and rebuilds the run, so no piece ends up in a building.
 */
export function bandHits(pieces: readonly Piece[], fp: Footprints, skip: (f: Footprint) => boolean): V2[] {
  const out: V2[] = [];
  const band = (pts: V2[], t: number, bat: number): void => {
    const cum = lengths(pts);
    const total = cum[cum.length - 1];
    for (let s = 0; s <= total + 1e-6; s += 0.25) {
      const p = at(pts, cum, Math.min(s, total)).p;
      const tt = tangent(pts, cum, Math.min(s, total), 0.5);
      const n: V2 = [-tt[1], tt[0]];
      for (const v of [-t / 2 - CLEAR / 3, -t / 4, 0, t / 4, t / 2 + bat + CLEAR / 3]) {
        const x = p[0] + n[0] * v;
        const z = p[1] + n[1] * v;
        if (fp.near(x, z, 0.1).some((f) => !skip(f) && inRing(x, z, f.ring))) {
          out.push(p);
          break;
        }
      }
    }
  };
  for (const p of pieces) {
    if (p.kind === 'curtain') {
      band(p.pts, p.p.thickness, p.p.batter ?? 0.6);
    } else if (p.kind === 'gate') {
      band([p.a, p.b], p.p.wall.thickness, p.p.wall.batter ?? 0.6);
    }
  }
  return out;
}

/** Thickness of the fitted wall over [a, b] (the thinnest sample). */
export function thicknessOver(fit: Fit, a: number, b: number): number {
  let t = Infinity;
  for (let k = 0; k < fit.profS.length; k++) {
    if (fit.profS[k] >= a - STEP && fit.profS[k] <= b + STEP) {
      t = Math.min(t, fit.profT[k]);
    }
  }
  return Number.isFinite(t) ? t : fit.profT[0];
}

/** Arc lengths where the fitted thickness changes (curtains are cut there, flush). */
export function thicknessSteps(fit: Fit): number[] {
  const out: number[] = [];
  for (let k = 1; k < fit.profS.length; k++) {
    if (Math.abs(fit.profT[k] - fit.profT[k - 1]) > 1e-6) {
      out.push((fit.profS[k] + fit.profS[k - 1]) / 2);
    }
  }
  return out;
}

/** Plan outline of a kit tower (bounding shape of kit.ts towerPlanLocal plus the plinth). */
export function towerOutline(at: V2, dir: V2, p: TowerParams, grow = 0): V2[] {
  const w = p.width / 2;
  const plinth = (p.plinth ?? 0.3) + grow;
  const back = -p.wallThickness / 2 - 0.4 - plinth;
  const front = p.wallThickness / 2 + p.projection;
  let half = w;
  let tip = front;
  if (p.plan === 'pentagon') {
    tip = front + w * 0.75;
  } else if (p.plan === 'hexagon') {
    tip = front + w * 0.55;
  } else if (p.plan === 'octagon') {
    const r = w / Math.cos(Math.PI / 8);
    tip = (back + plinth + front + w * 0.8) / 2 + r;
    half = r;
  }
  half += plinth;
  tip += plinth;
  const n: V2 = [-dir[1], dir[0]];
  const W = (u: number, v: number): V2 => [at[0] + dir[0] * u + n[0] * v, at[1] + dir[1] * u + n[1] * v];
  return [W(-half, back), W(half, back), W(half, tip), W(-half, tip)];
}

/** True when the outline overlaps a building that is not skipped. */
export function outlineBlocked(poly: readonly V2[], fp: Footprints, skip: (f: Footprint) => boolean): boolean {
  let cx = 0;
  let cz = 0;
  let r = 0;
  for (const q of poly) {
    cx += q[0] / poly.length;
    cz += q[1] / poly.length;
  }
  for (const q of poly) {
    r = Math.max(r, Math.hypot(q[0] - cx, q[1] - cz));
  }
  return fp.near(cx, cz, r).some((f) => !skip(f) && overlaps(f, poly));
}

export interface OverlapReport {
  metres: number;
  count: number;
  /** Metres of wall standing on a road / rail bed. */
  roadMetres: number;
  byStretch: Record<string, { metres: number; buildings: number; towers: number; roadMetres: number }>;
}

/**
 * Independent check of the finished pieces: curtain and gate bands sampled every 0.5 m at the inner face, the axis
 * and the outer foot (5 cm inside), tower outlines polygon-tested. Buildings that `skip()` are not counted.
 */
export function wallOverlaps(pieces: readonly Piece[], fp: Footprints, skip: (f: Footprint) => boolean, stretch: (src: number) => string): OverlapReport {
  const rep: OverlapReport = { metres: 0, count: 0, roadMetres: 0, byStretch: {} };
  const hit = new Set<Footprint>();
  const entry = (src: number): OverlapReport['byStretch'][string] => (rep.byStretch[stretch(src)] ??= { metres: 0, buildings: 0, towers: 0, roadMetres: 0 });
  const band = (src: number, pts: V2[], t: number, bat: number): void => {
    const cum = lengths(pts);
    const total = cum[cum.length - 1];
    const e = entry(src);
    for (let s = 0.25; s < total; s += 0.5) {
      const p = at(pts, cum, s).p;
      const tt = tangent(pts, cum, s, 1);
      const n: V2 = [-tt[1], tt[0]];
      let over = false;
      let onRoad = false;
      for (const v of [-t / 2 + 0.05, 0, t / 2 + bat - 0.05]) {
        const x = p[0] + n[0] * v;
        const z = p[1] + n[1] * v;
        for (const f of fp.near(x, z, 0.5)) {
          if (!skip(f) && inRing(x, z, f.ring)) {
            if (f.road) {
              onRoad = true;
              continue;
            }
            over = true;
            if (!hit.has(f)) {
              hit.add(f);
              e.buildings++;
              rep.count++;
            }
          }
        }
      }
      if (over) {
        e.metres += 0.5;
        rep.metres += 0.5;
      }
      if (onRoad) {
        e.roadMetres += 0.5;
        rep.roadMetres += 0.5;
      }
    }
  };
  for (const p of pieces) {
    if (p.kind === 'curtain') {
      band(p.src, p.pts, p.p.thickness, p.p.batter ?? 0.6);
    } else if (p.kind === 'gate') {
      band(p.src, [p.a, p.b], p.p.wall.thickness, p.p.wall.batter ?? 0.6);
    } else if (p.kind === 'tower') {
      if (outlineBlocked(towerOutline(p.at, p.dir, p.p), fp, skip)) {
        entry(p.src).towers++;
        rep.count++;
      }
    }
  }
  rep.metres = Math.round(rep.metres * 10) / 10;
  rep.roadMetres = Math.round(rep.roadMetres * 10) / 10;
  return rep;
}
