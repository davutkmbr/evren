import type { GeoQuery } from '../../../../core/contracts';
import type { P2 } from '../../util/path';
import { clearance, pushToWater, segmentClear } from '../../util/water-nav';
import { routeOverWater } from '../../util/water-route';
import type { Berth } from '../routes';
import { bezier, filletPolyline, SpeedProfile, Track } from './track';

/** A scheduled line: stops as [pier id, berth index]; the service runs A -> ... -> last -> ... -> A. */
export interface ServiceLineDef {
  id: string;
  model: string;
  stops: readonly (readonly [string, number])[];
  vessels: number;
  /** Dwell alongside each pier (s). */
  dwell: number;
}

export interface HullDims {
  length: number;
  beam: number;
  /** Symmetric double-ender: leaves the pier with the other end first instead of backing out. */
  doubleEnded: boolean;
  /** Cruise speed (m/s), acceleration / braking (m/s²), max yaw rate (rad/s), turning radius (m). */
  vmax: number;
  accel: number;
  decel: number;
  yawRate: number;
  turnRadius: number;
}

/** Where a vessel lies alongside a berth: centre and bow direction. */
export interface DockPose {
  berth: Berth;
  x: number;
  z: number;
  hx: number;
  hz: number;
}

export interface Visit {
  dock: DockPose;
  /** Approach from open water to the dock (ends at the dock, tangent = dock heading). */
  approach: P2[];
  approachLength: number;
}

export interface ServiceLeg {
  from: number;
  to: number;
  /** Backing out of the departure berth (classic ferries only): reversed approach, tangent = direction of travel. */
  undock: Track | null;
  undockProfile: SpeedProfile | null;
  /** Ahead from the undock end (or the berth, for double-enders) to the next dock. */
  route: Track;
  routeProfile: SpeedProfile;
  /** Arc length on `route` where the vessel waits while the next berth is taken. */
  holdS: number;
  /** Arc length on `route` after which a double-ender has cleared its departure berth. */
  clearS: number;
}

export interface ServicePlan {
  line: ServiceLineDef;
  dims: HullDims;
  visits: Visit[];
  legs: ServiceLeg[];
}

const STEP = 3;

function norm(x: number, z: number): P2 {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}

function dockPose(b: Berth, beam: number, dir: number): DockPose {
  const off = beam / 2 + 0.7;
  return { berth: b, x: b.face.x + b.n.x * off, z: b.face.z + b.n.z * off, hx: b.t.x * dir, hz: b.t.z * dir };
}

/**
 * Run-in for a dock pose: from R0 (1.6 L astern of the berth, 0.5 L off it) the hull comes in at ~25° to the face and
 * straightens alongside, so the stern clears any ferry lying at the neighbouring berth. Score = worst hull clearance.
 */
function runInFor(geo: GeoQuery, d: DockPose, L: number, B: number, scale: number): { pts: P2[]; score: number } {
  const n = d.berth.n;
  const P = { x: d.x, z: d.z };
  const h = { x: d.hx, z: d.hz };
  const back = 1.6 * L * scale;
  const out = 0.5 * L * scale;
  const R0 = { x: P.x - h.x * back + n.x * out, z: P.z - h.z * back + n.z * out };
  const ang = THREE_DEG * 25;
  const d0 = { x: h.x * Math.cos(ang) - n.x * Math.sin(ang), z: h.z * Math.cos(ang) - n.z * Math.sin(ang) };
  const pts = bezier(R0, { x: R0.x + d0.x * 0.55 * L * scale, z: R0.z + d0.z * 0.55 * L * scale }, { x: P.x - h.x * 0.6 * L * scale, z: P.z - h.z * 0.6 * L * scale }, P, 2);
  let worst = 40;
  for (let i = 0; i < pts.length; i += 2) {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const t = norm(b.x - a.x, b.z - a.z);
    for (const f of [-0.5, 0, 0.5]) worst = Math.min(worst, clearance(geo, pts[i].x + t.x * f * L, pts[i].z + t.z * f * L) - B * 0.5);
  }
  return { pts, score: worst };
}

const THREE_DEG = Math.PI / 180;

function polyLength(pts: readonly P2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return l;
}

/** Point `dist` metres back from the end of a polyline (walking backwards). */
function backFromEnd(pts: readonly P2[], dist: number): { index: number; p: P2 } {
  let acc = 0;
  for (let i = pts.length - 1; i > 0; i--) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (acc + seg >= dist) {
      const t = (dist - acc) / seg;
      return { index: i - 1, p: { x: pts[i].x + (pts[i - 1].x - pts[i].x) * t, z: pts[i].z + (pts[i - 1].z - pts[i].z) * t } };
    }
    acc += seg;
  }
  return { index: 0, p: { ...pts[0] } };
}

interface Turn {
  pts: P2[];
  exit: P2;
  length: number;
  worst: number;
}

/**
 * Constant-radius turn from pose (p, h) on side `side` (+1 starboard, -1 port) until the heading points at `target`.
 * Returns null when the target lies inside the turning circle.
 */
function turnTowards(geo: GeoQuery, p: P2, h: P2, side: number, R: number, target: P2, L: number, B: number, avoid: P2 | null, avoidR: number): Turn | null {
  const sx = -h.z;
  const sz = h.x;
  const cx = p.x + sx * R * side;
  const cz = p.z + sz * R * side;
  if (Math.hypot(target.x - cx, target.z - cz) < R * 1.02) return null;
  const dTh = Math.min(0.035, 3 / R);
  const pts: P2[] = [{ ...p }];
  let worst = Infinity;
  for (let th = 0; th < Math.PI * 2; th += dTh) {
    const hx = h.x * Math.cos(th) + sx * side * Math.sin(th);
    const hz = h.z * Math.cos(th) + sz * side * Math.sin(th);
    const px = p.x + h.x * R * Math.sin(th) + sx * side * R * (1 - Math.cos(th));
    const pz = p.z + h.z * R * Math.sin(th) + sz * side * R * (1 - Math.cos(th));
    if (th > 0) pts.push({ x: px, z: pz });
    // Hull footprint: centre and both ends.
    for (const f of [-0.5, 0, 0.5]) {
      const qx = px + hx * f * L;
      const qz = pz + hz * f * L;
      let c = clearance(geo, qx, qz) - B * 0.5;
      if (avoid) c = Math.min(c, Math.hypot(qx - avoid.x, qz - avoid.z) - avoidR);
      worst = Math.min(worst, c);
    }
    const tx = target.x - px;
    const tz = target.z - pz;
    const cross = hx * tz - hz * tx;
    const dot = hx * tx + hz * tz;
    if (dot > 0 && Math.abs(cross) / Math.hypot(tx, tz) < Math.sin(dTh * 1.2)) {
      return { pts, exit: { x: px, z: pz }, length: th * R, worst };
    }
  }
  return null;
}

/**
 * Two-way separation: shifts a route to starboard by up to `offset` metres, ramping in over `ramp` metres after arc
 * length s0 and out again before s1 (the berth run-ins stay untouched), so the two directions of a line pass each
 * other port to port instead of sharing one track. The shift shrinks where the water does not allow it.
 */
function separateToStarboard(geo: GeoQuery, pts: readonly P2[], s0: number, s1: number, offset: number, ramp: number, minClear: number): P2[] {
  const n = pts.length;
  const cum: number[] = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const smooth = (t: number): number => {
    const c = Math.min(Math.max(t, 0), 1);
    return c * c * (3 - 2 * c);
  };
  const tangent = (i: number): P2 => {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, n - 1)];
    return norm(b.x - a.x, b.z - a.z);
  };
  const w = cum.map((c) => smooth((c - s0) / ramp) * smooth((s1 - c) / ramp));
  // Largest feasible fraction of the offset per point, then a windowed minimum and a moving average (~120 m) so the
  // shifted route stays smooth where the shore limits it.
  const kmax = pts.map((p, i) => {
    if (w[i] <= 0) return 1;
    const t = tangent(i);
    for (const k of [1, 0.75, 0.5, 0.3, 0.15]) {
      if (clearance(geo, p.x - t.z * offset * w[i] * k, p.z + t.x * offset * w[i] * k) >= minClear) return k;
    }
    return 0;
  });
  const win = Math.max(4, Math.round(120 / Math.max(cum[n - 1] / Math.max(n - 1, 1), 0.5)));
  const kmin = kmax.map((_, i) => {
    let m = 1;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) m = Math.min(m, kmax[j]);
    return m;
  });
  const k = kmin.map((_, i) => {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) {
      sum += kmin[j];
      cnt++;
    }
    return sum / cnt;
  });
  return pts.map((p, i) => {
    const o = offset * w[i] * Math.min(k[i], kmax[i]);
    if (o <= 0) return { ...p };
    const t = tangent(i);
    return { x: p.x - t.z * o, z: p.z + t.x * o };
  });
}

/**
 * Pushes route points (between arc lengths s0 and s1) that come closer than `minClear` to the shore out along the
 * clearance gradient, then smooths the moved stretch, a few rounds.
 */
function keepOffShore(geo: GeoQuery, pts: P2[], s0: number, s1: number, minClear: number): P2[] {
  let out = pts.map((p) => ({ ...p }));
  const n = out.length;
  const cum: number[] = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  for (let round = 0; round < 3; round++) {
    const moved = new Uint8Array(n);
    let any = false;
    for (let i = 1; i < n - 1; i++) {
      if (cum[i] < s0 || cum[i] > s1) continue;
      if (clearance(geo, out[i].x, out[i].z) >= minClear) continue;
      out[i] = pushToWater(geo, out[i], minClear + 2, 12);
      moved[i] = 1;
      any = true;
    }
    if (!any) break;
    // Smooth around moved points so the route stays fair.
    const next = out.map((p) => ({ ...p }));
    for (let i = 2; i < n - 2; i++) {
      if (cum[i] < s0 || cum[i] > s1) continue;
      let near = false;
      for (let j = Math.max(0, i - 6); j <= Math.min(n - 1, i + 6); j++) if (moved[j]) near = true;
      if (!near) continue;
      next[i] = { x: (out[i - 2].x + out[i - 1].x * 2 + out[i].x * 2 + out[i + 1].x * 2 + out[i + 2].x) / 8, z: (out[i - 2].z + out[i - 1].z * 2 + out[i].z * 2 + out[i + 1].z * 2 + out[i + 2].z) / 8 };
    }
    out = next;
  }
  return out;
}

/**
 * Fairs a route between arc lengths s0 and s1: drops points that make the line double back or kink over a few metres
 * (where the turns, the middle part and the separation meet), then smooths that stretch so the tangent is continuous.
 */
function fairRoute(pts: P2[], s0: number, s1: number): P2[] {
  let out = pts.map((p) => ({ ...p }));
  const arc = (list: P2[]): number[] => {
    const c = [0];
    for (let i = 1; i < list.length; i++) c.push(c[i - 1] + Math.hypot(list[i].x - list[i - 1].x, list[i].z - list[i - 1].z));
    return c;
  };
  let cum = arc(out);
  for (let i = 1; i < out.length - 1; i++) {
    if (cum[i] < s0 || cum[i] > s1) continue;
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const ux = b.x - a.x;
    const uz = b.z - a.z;
    const vx = c.x - b.x;
    const vz = c.z - b.z;
    const lu = Math.hypot(ux, uz);
    const lv = Math.hypot(vx, vz);
    if (lu < 0.3 || lv < 0.3 || (ux * vx + uz * vz) / (lu * lv) < 0.82) {
      out.splice(i, 1);
      cum = arc(out);
      i = Math.max(0, i - 2);
    }
  }
  cum = arc(out);
  for (let it = 0; it < 4; it++) {
    const next = out.map((p) => ({ ...p }));
    for (let i = 1; i < out.length - 1; i++) {
      if (cum[i] < s0 || cum[i] > s1) continue;
      next[i] = { x: out[i].x * 0.5 + (out[i - 1].x + out[i + 1].x) * 0.25, z: out[i].z * 0.5 + (out[i - 1].z + out[i + 1].z) * 0.25 };
    }
    out = next;
  }
  return out;
}

/** Arc length over which a route eases into its two-way separation, in hull lengths. */
export const SEPARATION_RAMP = 2.5;

function buildVisits(geo: GeoQuery, stops: Berth[], order: number[], dims: HullDims): Visit[] {
  const L = dims.length;
  const B = dims.beam;
  const visits: Visit[] = [];
  for (let k = 0; k < order.length; k++) {
    const b = stops[order[k]];
    const prev = stops[order[(k - 1 + order.length) % order.length]];
    let best: { pose: DockPose; pts: P2[]; score: number } | null = null;
    for (const scale of [1, 0.8, 0.6]) {
      for (const dir of [1, -1]) {
        const pose = dockPose(b, B, dir);
        const r = runInFor(geo, pose, L, B, scale);
        // Prefer running in roughly in the direction of travel from the previous stop (less turning).
        const r0 = r.pts[0];
        const r1 = r.pts[Math.min(3, r.pts.length - 1)];
        const din = norm(r1.x - r0.x, r1.z - r0.z);
        const dtr = norm(r0.x - prev.face.x, r0.z - prev.face.z);
        const turn = Math.acos(Math.min(1, Math.max(-1, din.x * dtr.x + din.z * dtr.z)));
        const score = Math.min(r.score, 12) - turn * 4 + (scale === 1 ? 3 : 0);
        if (!best || score > best.score) best = { pose, pts: r.pts, score };
      }
      if (best && best.score > 4) break;
    }
    visits.push({ dock: best!.pose, approach: best!.pts, approachLength: polyLength(best!.pts) });
  }
  return visits;
}

/** Turn from a pose towards a target, trying both sides (and a few radii); best by clearance, then length. */
function bestTurn(geo: GeoQuery, p: P2, h: P2, R: number, target: P2, L: number, B: number, avoid: P2 | null, avoidR: number): Turn | null {
  let best: Turn | null = null;
  let bestScore = -Infinity;
  for (const k of [1, 0.75, 1.4, 0.55]) {
    for (const side of [1, -1]) {
      const t = turnTowards(geo, p, h, side, R * k, target, L, B, avoid, avoidR);
      if (!t) continue;
      const score = (t.worst > 3 ? 1e6 : t.worst * 1000) - t.length - Math.hypot(target.x - t.exit.x, target.z - t.exit.z) - (k !== 1 ? 60 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best && bestScore > 5e5) break;
  }
  return best;
}

/** Builds the dock poses, run-ins and all legs of a line (null when a stop is missing). */
export function planService(geo: GeoQuery, berths: Map<string, Berth[]>, line: ServiceLineDef, dims: HullDims): ServicePlan | null {
  const stops: Berth[] = [];
  for (const [pid, bi] of line.stops) {
    const list = berths.get(pid);
    const b = list?.[Math.min(bi, (list?.length ?? 1) - 1)];
    if (!b) return null;
    stops.push(b);
  }
  if (stops.length < 2) return null;
  const order: number[] = [];
  for (let i = 0; i < stops.length; i++) order.push(i);
  for (let i = stops.length - 2; i >= 1; i--) order.push(i);
  const L = dims.length;
  const B = dims.beam;
  const R = dims.turnRadius;
  const visits = buildVisits(geo, stops, order, dims);
  const legs: ServiceLeg[] = [];
  const minClear = Math.max(40, B * 3);
  for (let k = 0; k < visits.length; k++) {
    const from = visits[k];
    const to = visits[(k + 1) % visits.length];
    // Departure: back out along the run-in (classic) or run out along it with the other end first (double-ender).
    const backDist = Math.min(1.4 * L, from.approachLength * 0.92);
    const q = backFromEnd(from.approach, backDist);
    const outPts: P2[] = [];
    for (let i = from.approach.length - 1; i > q.index; i--) outPts.push(from.approach[i]);
    outPts.push(q.p);
    const outDir = norm(q.p.x - from.approach[q.index + 1].x, q.p.z - from.approach[q.index + 1].z);
    // Heading at the end of the departure manoeuvre.
    const h0 = dims.doubleEnded ? outDir : { x: -outDir.x, z: -outDir.z };
    const start = q.p;
    // Arrival: the start of the next run-in, entered along its tangent; planned backwards from there.
    const A0 = to.approach[0];
    const a1 = to.approach[Math.min(3, to.approach.length - 1)];
    const dIn = norm(a1.x - A0.x, a1.z - A0.z);
    const back = { x: -dIn.x, z: -dIn.z };
    const depFace = from.dock.berth.face;
    const depAvoid = dims.doubleEnded ? null : depFace;
    const avoidR = from.dock.berth.pier.frontage * 0.5 + 6;
    const arrFace = to.dock.berth.face;
    const arrAvoidR = to.dock.berth.pier.frontage * 0.5 + 6;

    // Common tangent between the departure and the arrival turn (a few fixed-point iterations), via A* waypoints
    // when the straight line between them is blocked.
    let dep: Turn | null = null;
    let arr: Turn | null = null;
    let mid: P2[] = [];
    let aimDep: P2 = A0;
    let aimArr: P2 = start;
    for (let it = 0; it < 4; it++) {
      dep = bestTurn(geo, start, h0, R, aimDep, L, B, depAvoid, avoidR);
      arr = bestTurn(geo, A0, back, R, aimArr, L, B, arrFace, arrAvoidR);
      const e1 = dep ? dep.exit : start;
      const e2 = arr ? arr.exit : A0;
      if (it === 1 && !segmentClear(geo, e1, e2, B / 2 + 25, 20)) {
        const route = routeOverWater(geo, pushToWater(geo, e1, minClear, 12), pushToWater(geo, e2, minClear, 12), minClear);
        mid = route.slice(1, -1);
      }
      aimDep = mid.length > 0 ? mid[0] : e2;
      aimArr = mid.length > 0 ? mid[mid.length - 1] : e1;
    }
    const depPts = dep ? dep.pts : [start];
    const arrPts = arr ? [...arr.pts].reverse() : [A0];
    const e1 = depPts[depPts.length - 1];
    const e2 = arrPts[0];
    if (mid.length === 0 && Math.hypot(e2.x - e1.x, e2.z - e1.z) > 5 * L) mid = [{ x: (e1.x + e2.x) / 2, z: (e1.z + e2.z) / 2 }];
    let poly = [e1, ...mid, e2];
    const middle = filletPolyline(poly, R * 1.5, STEP);
    const routePts: P2[] = [];
    if (dims.doubleEnded) routePts.push(...outPts);
    routePts.push(...depPts, ...middle.slice(1), ...arrPts.slice(1), ...to.approach.slice(1));
    const sepStart = dims.doubleEnded ? polyLength(outPts) : 0;
    const sepEnd = polyLength(routePts) - to.approachLength;
    const separated = separateToStarboard(geo, routePts, sepStart, sepEnd, B + 24, SEPARATION_RAMP * L, B * 0.5 + 25);
    routePts.length = 0;
    routePts.push(...fairRoute(keepOffShore(geo, separated, sepStart + L * 0.5, sepEnd - L * 0.5, B * 0.5 + 12), sepStart + 2, sepEnd - 2));
    const startDir = dims.doubleEnded ? { x: -from.dock.hx, z: -from.dock.hz } : h0;
    const route = new Track(routePts, startDir, { x: to.dock.hx, z: to.dock.hz });
    const routeProfile = new SpeedProfile(route, { vmax: dims.vmax, accel: dims.accel, decel: dims.decel, yawRate: dims.yawRate, vStart: 0, vEnd: 0 });
    let undock: Track | null = null;
    let undockProfile: SpeedProfile | null = null;
    if (!dims.doubleEnded) {
      undock = new Track(outPts, norm(outPts[1].x - outPts[0].x, outPts[1].z - outPts[0].z), outDir);
      undockProfile = new SpeedProfile(undock, { vmax: Math.min(1.5, dims.vmax * 0.25), accel: 0.06, decel: 0.08, yawRate: dims.yawRate, vStart: 0, vEnd: 0 });
    }
    // Hold short of the arrival turn while the berth is taken.
    const arrLen = polyLength(arrPts);
    // Hold well short of the arrival turn: the ferry leaving that berth backs out and turns right there.
    const holdS = Math.max(0, route.length - to.approachLength - arrLen - 2.2 * L - dims.turnRadius);
    const clearS = dims.doubleEnded ? polyLength(outPts) : 0;
    legs.push({ from: k, to: (k + 1) % visits.length, undock, undockProfile, route, routeProfile, holdS, clearS });
  }
  return { line, dims, visits, legs };
}
