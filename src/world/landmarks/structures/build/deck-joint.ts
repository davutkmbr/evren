/**
 * Deck joints: where a deck end lands on the ground (abutment on land, approach viaduct running out on the terrain),
 * the drawn ground beyond it is rarely level across the deck's width (the Karaköy street falls ~1 m across the 42 m
 * Galata deck, the quay line crossing it at an angle) and has kerbs of its own. The deck profile is a single height per
 * station, so its last metres twist into the ground: at the end every lateral position of the deck surface meets the
 * drawn ground (a raised walkway meets it too, its curb fading out), blending back into the flat section inward.
 * Builders apply the offset to every vertex, wire and light of the deck; the 'roadSurface' service applies it to the
 * published surface.
 *
 * Where ground lies under the deck's last metres (a quay line crossing the deck at an angle, a tram platform), the
 * deck is lifted to ride just above it, so no ground shows through the deck near the joint.
 *
 * The lines drawn on the ground continue on the deck: where the street ground's tram tracks and lane lines cross the
 * end off the deck's own (OSM tracks curving in, a street's lanes laid out a little differently), the deck surface is
 * warped laterally over its last metres so each of its tracks (rigidly, with its rails and bed) and lane lines lands
 * on its ground counterpart (the barriers between them move along); lamp lines, walkway edges and the deck edges stay
 * put (solveLateral).
 *
 * The ground comes from the site's terrain patches on the first build; the main thread then samples the drawn ground
 * exactly across and under each landed end (StructureSystem) and rebuilds the bridge.
 */
import type { DeckJoint, JointGround, JointLine } from '../types';
import type { BridgeFrame } from './bridge-frame';
import type { HeightSampler } from './height-sampler';

/** An end lands on the ground when the ground on its axis is within this (m) of the road surface. */
export const JOINT_REACH = 0.5;
/** Ground samples farther than this (m) from the road surface do not belong to the joint (cuttings, walls). */
const JOINT_MAX_OFFSET = 3;
/** Ground below this height (m) is sea / sea floor (next to a quay wall, off a shore): not a joint sample. */
const LAND_MIN = 0.05;
/** Lateral sample spacing (m) of the ground across the deck from the terrain patches. */
const JOINT_DX = 0.5;
/** Shortest twist (m) and the largest change of the offset per metre along the axis. */
const JOINT_MIN_LENGTH = 12;
const JOINT_MAX_TWIST = 0.02;
/** Tolerance (m) of the simplified offset profile the ribbons are tessellated with. */
const CUT_TOLERANCE = 0.003;
/** Station spacing (m) of the deck frames inside a twist. */
export const JOINT_ROW = 4;
/** Clearance (m) the deck keeps above the ground under it, reached 1 m in from the end (0 on the joint line). */
const BED_CLEARANCE = 0.015;

/** A deck track and a ground track further apart than this (m) at the end are not the same track. */
const TRACK_MATCH = 3;
/** A deck lane line and a ground lane line further apart than this (m) are not the same line. */
const LANE_MATCH = 1.2;
/** Half width (m) of a track moved rigidly (rails, sleepers and the slab around them). */
const TRACK_HALF = 1.3;
/** Largest lateral move per metre along the axis (the lateral warp fades out over |dx| / this, at least JOINT_MIN_LENGTH). */
const LATERAL_SLOPE = 0.05;
/** Warps smaller than this (m) are left out. */
const LATERAL_MIN = 0.01;

/** The deck's own lines (tram track centres, lane lines) and the lateral positions that must not move. */
export interface DeckLayout {
  lines: readonly JointLine[];
  /** Lamp lines, railings, walkway edges and the deck edges. */
  anchors: readonly number[];
}

/**
 * Lateral warp of an end: every deck line with a ground line of its kind nearby is paired with it (closest pairs
 * first, keeping the order of all pairs and anchors); tracks move as rigid TRACK_HALF bands. Null when nothing moves.
 */
export function solveLateral(layout: DeckLayout, ground: readonly JointLine[], maxLength: number): DeckJoint['lateral'] {
  const pairs: { d: number; g: number; half: number }[] = [];
  for (const kind of ['track', 'lane'] as const) {
    const reach = kind === 'track' ? TRACK_MATCH : LANE_MATCH;
    const deck = layout.lines.filter((l) => l.kind === kind).map((l) => l.x);
    const gs = ground.filter((l) => l.kind === kind).map((l) => l.x);
    const cands: { d: number; g: number }[] = [];
    for (const d of deck) {
      for (const g of gs) {
        if (Math.abs(g - d) <= reach) {
          cands.push({ d, g });
        }
      }
    }
    cands.sort((p, q) => Math.abs(p.g - p.d) - Math.abs(q.g - q.d));
    for (const c of cands) {
      if (pairs.some((p) => p.d === c.d || p.g === c.g)) {
        continue;
      }
      pairs.push({ ...c, half: kind === 'track' ? TRACK_HALF : 0 });
      if (!monotone(pairs, layout.anchors)) {
        pairs.pop();
      }
    }
  }
  let max = 0;
  for (const p of pairs) {
    max = Math.max(max, Math.abs(p.g - p.d));
  }
  if (max < LATERAL_MIN) {
    return null;
  }
  const ctrl = controls(pairs, layout.anchors);
  return {
    xs: Float32Array.from(ctrl.map((c) => c.d)),
    dx: Float32Array.from(ctrl.map((c) => c.g - c.d)),
    length: Math.min(Math.max(JOINT_MIN_LENGTH, max / LATERAL_SLOPE), maxLength),
  };
}

/** Control points (deck x -> ground x) of `pairs` (with their rigid bands) and the fixed anchors, sorted by deck x. */
function controls(pairs: readonly { d: number; g: number; half: number }[], anchors: readonly number[]): { d: number; g: number }[] {
  const out: { d: number; g: number }[] = anchors.map((a) => ({ d: a, g: a }));
  for (const p of pairs) {
    if (p.half > 0) {
      out.push({ d: p.d - p.half, g: p.g - p.half }, { d: p.d + p.half, g: p.g + p.half });
    } else {
      out.push({ d: p.d, g: p.g });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

/** Whether the control points keep a strictly increasing order on both sides (no fold, no line crossing a fixture). */
function monotone(pairs: readonly { d: number; g: number; half: number }[], anchors: readonly number[]): boolean {
  const c = controls(pairs, anchors);
  for (let i = 1; i < c.length; i++) {
    if (c[i].d - c[i - 1].d < 0.05 || c[i].g - c[i - 1].g < 0.05) {
      return false;
    }
  }
  return true;
}

/** Lateral move (m) of deck x at the end of one joint (piecewise linear over its controls, 0 outside them). */
function lateralAt(j: DeckJoint, x: number): number {
  const l = j.lateral;
  if (!l) {
    return 0;
  }
  const xs = l.xs;
  const n = xs.length;
  if (x <= xs[0] || x >= xs[n - 1]) {
    return 0;
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) {
      lo = m;
    } else {
      hi = m;
    }
  }
  const u = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return l.dx[lo] + (l.dx[hi] - l.dx[lo]) * u;
}

/** Lateral move (m) of the deck point at station s, deck lateral x (0 away from warped ends). */
export function lateralShift(joints: readonly DeckJoint[], s: number, x: number): number {
  let dx = 0;
  for (const j of joints) {
    if (!j.lateral) {
      continue;
    }
    const d = (j.s - s) * j.dir;
    if (d >= j.lateral.length) {
      continue;
    }
    const t = Math.max(0, d) / j.lateral.length;
    dx += (1 - t * t * (3 - 2 * t)) * lateralAt(j, x);
  }
  return dx;
}

/** Deck x that the end's lateral warp moves onto lateral position `x` (the warp is monotone). */
function unwarp(j: DeckJoint, x: number): number {
  const l = j.lateral;
  if (!l) {
    return x;
  }
  const n = l.xs.length;
  for (let i = 1; i < n; i++) {
    const a = l.xs[i - 1] + l.dx[i - 1];
    const b = l.xs[i] + l.dx[i];
    if (x >= a && x <= b) {
      const u = (x - a) / (b - a || 1);
      return l.xs[i - 1] + (l.xs[i] - l.xs[i - 1]) * u;
    }
  }
  return x;
}

/** Deck lateral positions a ribbon needs columns at: the warp's controls and the height cuts mapped back to deck x. */
export function jointColumns(joints: readonly DeckJoint[]): number[] {
  const out: number[] = [];
  for (const j of joints) {
    out.push(...j.cuts.map((x) => unwarp(j, x)));
    if (j.lateral) {
      out.push(...j.lateral.xs);
    }
  }
  return out;
}

/** Where the ground profile is known exactly (sampled on the main thread), it wins over the terrain patches. */
function providedAt(frame: BridgeFrame, s: number, provided: readonly JointGround[]): JointGround | null {
  for (const p of provided) {
    if (Math.abs(p.s - s) < 1e-3 && Math.abs(p.ox - frame.ox) < 1e-3 && Math.abs(p.oz - frame.oz) < 1e-3 && Math.abs(p.ax - frame.ax) < 1e-6) {
      return p;
    }
  }
  return null;
}

/** Douglas-Peucker breakpoints of the profile v over xs (indices strictly between lo and hi). */
function breakpoints(xs: Float32Array, v: Float32Array, lo: number, hi: number, out: number[]): void {
  let worst = -1;
  let err = CUT_TOLERANCE;
  const span = xs[hi] - xs[lo] || 1;
  for (let i = lo + 1; i < hi; i++) {
    const t = (xs[i] - xs[lo]) / span;
    const e = Math.abs(v[i] - (v[lo] + (v[hi] - v[lo]) * t));
    if (e > err) {
      err = e;
      worst = i;
    }
  }
  if (worst >= 0) {
    breakpoints(xs, v, lo, worst, out);
    out.push(worst);
    breakpoints(xs, v, worst, hi, out);
  }
}

/**
 * Joints of a deck from s0 to s1 (road surface `height(s)`, half width `halfWidth`) against the ground `terrain`
 * (the visible ground, site-planner.ts) or the exactly sampled `provided` profiles. Free ends get none.
 */
export function solveDeckJoints(
  frame: BridgeFrame,
  terrain: HeightSampler,
  height: (s: number) => number,
  s0: number,
  s1: number,
  halfWidth: number,
  provided: readonly JointGround[] = [],
  levelAt: (x: number) => number = () => 0,
  layout: DeckLayout | null = null,
): DeckJoint[] {
  const joints: DeckJoint[] = [];
  for (const [s, dir] of [
    [s0, -1],
    [s1, 1],
  ] as const) {
    const h = height(s);
    const exact = providedAt(frame, s, provided);
    let xs: Float32Array;
    let ground: Float32Array;
    if (exact) {
      ({ xs, ground } = exact);
    } else {
      const n = Math.max(2, Math.ceil((halfWidth * 2) / JOINT_DX) + 1);
      xs = new Float32Array(n);
      ground = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        xs[i] = -halfWidth + (i * halfWidth * 2) / (n - 1);
        const p = frame.point(s + dir * 0.05, xs[i], 0);
        const g = terrain.heightAt(p.x, p.z);
        ground[i] = g;
      }
    }
    const n = ground.length;
    let axis = NaN;
    for (let i = 0, best = Infinity; i < n; i++) {
      if (Math.abs(xs[i]) < best) {
        best = Math.abs(xs[i]);
        axis = ground[i];
      }
    }
    if (!(axis >= LAND_MIN && Math.abs(axis - h) <= JOINT_REACH)) {
      continue;
    }
    const offsets = new Float32Array(n);
    const valid: boolean[] = [];
    for (let i = 0; i < n; i++) {
      const g = ground[i];
      valid.push(g >= LAND_MIN && Math.abs(g - h) <= JOINT_MAX_OFFSET);
      offsets[i] = g - h;
    }
    // Samples off the ground (water beside a quay, a cutting) take the nearest valid sample's offset.
    for (let i = 0; i < n; i++) {
      if (valid[i]) {
        continue;
      }
      let best = -1;
      for (let k = 1; k < n && best < 0; k++) {
        if (i - k >= 0 && valid[i - k]) {
          best = i - k;
        } else if (i + k < n && valid[i + k]) {
          best = i + k;
        }
      }
      offsets[i] = best >= 0 ? offsets[best] : 0;
    }
    let max = 0;
    for (const o of offsets) {
      max = Math.max(max, Math.abs(o));
    }
    const length = Math.min(Math.max(JOINT_MIN_LENGTH, max / JOINT_MAX_TWIST), (s1 - s0) / 2);
    const lateral = layout && exact?.lines?.length ? solveLateral(layout, exact.lines, (s1 - s0) / 2) : null;
    const joint: DeckJoint = { s, dir, length, xs, offsets, cuts: [], bed: null, lateral };
    const idx: number[] = [0];
    breakpoints(xs, offsets, 0, n - 1, idx);
    idx.push(n - 1);
    const cuts = new Set(idx);
    if (exact?.bed) {
      // Ground under the last metres (the quay the deck crosses at an angle, a tram platform): the deck rides over it.
      const { dd, rows, ground: under } = exact.bed;
      const lift = new Float32Array((rows + 1) * n);
      const envelope = new Float32Array(n);
      for (let k = 0; k < rows; k++) {
        const d = (k + 1) * dd;
        if (d > (s1 - s0) / 2) {
          break;
        }
        const sk = s - dir * d;
        const hk = height(sk);
        const clear = BED_CLEARANCE * Math.min(1, d);
        for (let i = 0; i < n; i++) {
          const g = under[k * n + i] >= LAND_MIN ? under[k * n + i] : NaN;
          const level = levelAt(xs[i]);
          const top = hk + level + jointOffset([joint], sk, xs[i], level);
          const l = g + clear - top;
          if (l > 0 && l <= JOINT_MAX_OFFSET) {
            lift[(k + 1) * n + i] = l;
            envelope[i] = Math.max(envelope[i], l);
          }
        }
      }
      joint.bed = { dd, rows: rows + 1, lift };
      const bidx: number[] = [0];
      breakpoints(xs, envelope, 0, n - 1, bidx);
      for (const i of bidx) {
        cuts.add(i);
      }
    }
    joint.cuts = [...cuts].sort((a, b) => a - b).map((i) => xs[i]);
    joints.push(joint);
  }
  return joints;
}

/** Bed lift of one joint at inward distance d, lateral x (bilinear over its rows and samples). */
function bedAt(j: DeckJoint, d: number, x: number): number {
  const bed = j.bed;
  if (!bed || d < 0) {
    return 0;
  }
  const f = d / bed.dd;
  if (f >= bed.rows - 1) {
    return 0;
  }
  const k = Math.floor(f);
  const t = f - k;
  const xs = j.xs;
  const n = xs.length;
  let i = 0;
  if (x >= xs[n - 1]) {
    i = n - 2;
  } else if (x > xs[0]) {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (xs[m] <= x) {
        lo = m;
      } else {
        hi = m;
      }
    }
    i = lo;
  }
  const u = Math.min(1, Math.max(0, (x - xs[i]) / (xs[i + 1] - xs[i] || 1)));
  const L = bed.lift;
  const a = L[k * n + i] + (L[k * n + i + 1] - L[k * n + i]) * u;
  const b = L[(k + 1) * n + i] + (L[(k + 1) * n + i + 1] - L[(k + 1) * n + i]) * u;
  return a + (b - a) * t;
}

/** Profile value of one joint at lateral x (linear between samples, clamped at the edges). */
function profileAt(j: DeckJoint, x: number): number {
  const xs = j.xs;
  const n = xs.length;
  if (x <= xs[0]) {
    return j.offsets[0];
  }
  if (x >= xs[n - 1]) {
    return j.offsets[n - 1];
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) {
      lo = m;
    } else {
      hi = m;
    }
  }
  const u = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return j.offsets[lo] + (j.offsets[hi] - j.offsets[lo]) * u;
}

/**
 * Height offset (m) of the deck surface at station s, lateral x from its joints: a surface `level` m above the road
 * (a raised walkway) is brought down to the ground too, so it meets the drawn ground at the end. 0 away from ends.
 */
export function jointOffset(joints: readonly DeckJoint[], s: number, x: number, level = 0): number {
  let dy = 0;
  for (const j of joints) {
    const d = (j.s - s) * j.dir;
    if (d >= j.length) {
      continue;
    }
    const t = Math.max(0, d) / j.length;
    const w = 1 - t * t * (3 - 2 * t);
    dy += w * (profileAt(j, x) - level) + bedAt(j, d, x);
  }
  return dy;
}

/** Stations (m) the deck frames need inside its twists (rows every JOINT_ROW and the twist ends). */
export function jointBreaks(joints: readonly DeckJoint[]): number[] {
  const out: number[] = [];
  for (const j of joints) {
    const length = Math.max(j.length, j.lateral?.length ?? 0);
    const n = Math.ceil(length / JOINT_ROW);
    for (let k = 1; k <= n; k++) {
      out.push(j.s - j.dir * Math.min(k * JOINT_ROW, length));
    }
    // Every bed row that lifts the deck, and the first one after it (where the lift is back to 0).
    const bed = j.bed;
    if (bed) {
      const n = j.xs.length;
      let last = 0;
      for (let k = 1; k < bed.rows; k++) {
        for (let i = 0; i < n; i++) {
          if (bed.lift[k * n + i] > 0) {
            last = k;
            break;
          }
        }
      }
      for (let k = 1; k <= Math.min(last + 1, bed.rows - 1); k++) {
        out.push(j.s - j.dir * k * bed.dd);
      }
    }
  }
  return out;
}
