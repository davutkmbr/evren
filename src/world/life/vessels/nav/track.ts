import type { P2 } from '../../util/path';

/** Position + unit heading sampled from a track. */
export interface TrackSample {
  x: number;
  z: number;
  /** Unit tangent in the direction of increasing arc length. */
  tx: number;
  tz: number;
}

/**
 * Dense open polyline with arc-length parametrisation, per-vertex tangents interpolated along each segment (so the
 * heading turns continuously instead of snapping at vertices) and a per-vertex curvature estimate.
 */
export class Track {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly cum: Float64Array;
  readonly txs: Float64Array;
  readonly tzs: Float64Array;
  /** |curvature| (1/m) at each vertex, lightly smoothed. */
  readonly kappa: Float64Array;
  readonly length: number;

  constructor(points: readonly P2[], startDir?: P2, endDir?: P2) {
    const pts = dedupe(points);
    const n = pts.length;
    this.xs = new Float64Array(n);
    this.zs = new Float64Array(n);
    this.cum = new Float64Array(n);
    this.txs = new Float64Array(n);
    this.tzs = new Float64Array(n);
    this.kappa = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this.xs[i] = pts[i].x;
      this.zs[i] = pts[i].z;
      if (i > 0) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      this.cum[i] = acc;
    }
    this.length = acc;
    for (let i = 0; i < n; i++) {
      let tx: number;
      let tz: number;
      if (i === 0 && startDir) {
        tx = startDir.x;
        tz = startDir.z;
      } else if (i === n - 1 && endDir) {
        tx = endDir.x;
        tz = endDir.z;
      } else {
        const a = pts[Math.max(i - 1, 0)];
        const b = pts[Math.min(i + 1, n - 1)];
        tx = b.x - a.x;
        tz = b.z - a.z;
      }
      const l = Math.hypot(tx, tz) || 1;
      this.txs[i] = tx / l;
      this.tzs[i] = tz / l;
    }
    const raw = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) {
      const ax = pts[i].x - pts[i - 1].x;
      const az = pts[i].z - pts[i - 1].z;
      const bx = pts[i + 1].x - pts[i].x;
      const bz = pts[i + 1].z - pts[i].z;
      const la = Math.hypot(ax, az);
      const lb = Math.hypot(bx, bz);
      if (la < 1e-6 || lb < 1e-6) continue;
      const ang = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
      raw[i] = ang / ((la + lb) * 0.5);
    }
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let k = -2; k <= 2; k++) {
        const j = i + k;
        if (j >= 0 && j < n) m = Math.max(m, raw[j] * (k === 0 ? 1 : 0.85));
      }
      this.kappa[i] = m;
    }
  }

  get count(): number {
    return this.xs.length;
  }

  /** Segment index containing arc length s (hint speeds up sequential access). */
  segmentAt(s: number, hint = 0): number {
    const cum = this.cum;
    const n = cum.length;
    if (n < 2) return 0;
    let i = Math.min(Math.max(hint, 0), n - 2);
    if (s >= cum[i] && s <= cum[i + 1]) return i;
    if (i + 2 < n && s > cum[i + 1] && s <= cum[i + 2]) return i + 1;
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Samples position and (continuous) unit tangent at arc length s; returns the segment index. */
  sample(s: number, out: TrackSample, hint = 0): number {
    const n = this.xs.length;
    if (n < 2) {
      out.x = this.xs[0] ?? 0;
      out.z = this.zs[0] ?? 0;
      out.tx = this.txs[0] ?? 0;
      out.tz = this.tzs[0] ?? -1;
      return 0;
    }
    const ss = Math.min(Math.max(s, 0), this.length);
    const i = this.segmentAt(ss, hint);
    const seg = this.cum[i + 1] - this.cum[i];
    const t = seg > 1e-9 ? (ss - this.cum[i]) / seg : 0;
    out.x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t;
    out.z = this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t;
    const tx = this.txs[i] + (this.txs[i + 1] - this.txs[i]) * t;
    const tz = this.tzs[i] + (this.tzs[i + 1] - this.tzs[i]) * t;
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    return i;
  }

  points(): P2[] {
    const out: P2[] = [];
    for (let i = 0; i < this.xs.length; i++) out.push({ x: this.xs[i], z: this.zs[i] });
    return out;
  }
}

function dedupe(points: readonly P2[]): P2[] {
  const out: P2[] = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.z - q.z) > 0.05) out.push({ x: p.x, z: p.z });
  }
  if (out.length === 1) out.push({ x: out[0].x + 0.1, z: out[0].z });
  return out;
}

export interface ProfileOptions {
  vmax: number;
  /** Acceleration and braking (m/s²). */
  accel: number;
  decel: number;
  /** Maximum yaw rate (rad/s): caps the speed in bends to vmax_bend = yawRate / curvature. */
  yawRate: number;
  vStart: number;
  vEnd: number;
}

/**
 * Speed profile over the track vertices: bend limits from the yaw-rate cap, then a backward (braking) and a forward
 * (acceleration) pass so the vessel slows smoothly before bends and comes to rest exactly at the end.
 */
export class SpeedProfile {
  readonly v: Float32Array;

  constructor(
    readonly track: Track,
    o: ProfileOptions,
  ) {
    const n = track.count;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.min(o.vmax, o.yawRate / Math.max(track.kappa[i], 1e-5));
    v[n - 1] = Math.min(v[n - 1], o.vEnd);
    for (let i = n - 2; i >= 0; i--) {
      const ds = track.cum[i + 1] - track.cum[i];
      v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * o.decel * ds));
    }
    v[0] = Math.min(v[0], o.vStart);
    for (let i = 1; i < n; i++) {
      const ds = track.cum[i] - track.cum[i - 1];
      v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * o.accel * ds));
    }
    this.v = v;
  }

  at(s: number, hint = 0): number {
    const t = this.track;
    const i = t.segmentAt(Math.min(Math.max(s, 0), t.length), hint);
    const seg = t.cum[i + 1] - t.cum[i];
    const f = seg > 1e-9 ? (s - t.cum[i]) / seg : 0;
    return this.v[i] + (this.v[i + 1] - this.v[i]) * Math.min(Math.max(f, 0), 1);
  }
}

/** Uniformly resampled points along a polyline (step in metres), keeping the end points. */
export function resample(points: readonly P2[], step: number): P2[] {
  const out: P2[] = [];
  if (points.length === 0) return out;
  out.push({ ...points[0] });
  let carry = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let d = step - carry;
    while (d < len) {
      const t = d / len;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      d += step;
    }
    carry = len - (d - step);
  }
  const last = points[points.length - 1];
  const q = out[out.length - 1];
  if (Math.hypot(last.x - q.x, last.z - q.z) > step * 0.3) out.push({ ...last });
  else out[out.length - 1] = { ...last };
  return out;
}

/**
 * Replaces every interior corner of a polyline with a circular fillet (radius up to `radius`, shrunk so neighbouring
 * fillets never overlap). Output is densely sampled (`step` m) and tangent-continuous.
 */
export function filletPolyline(points: readonly P2[], radius: number, step: number): P2[] {
  const pts = dedupe(points);
  const n = pts.length;
  if (n < 3) return resample(pts, step);
  const segLen: number[] = [];
  for (let i = 0; i < n - 1; i++) segLen.push(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z));
  // Tangent length per corner, limited to half of each adjacent segment (the end segments may be used fully).
  const tanLen: number[] = new Array(n).fill(0);
  const radii: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const ax = pts[i].x - pts[i - 1].x;
    const az = pts[i].z - pts[i - 1].z;
    const bx = pts[i + 1].x - pts[i].x;
    const bz = pts[i + 1].z - pts[i].z;
    const ang = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
    if (ang < 1e-3) continue;
    const limA = i - 1 === 0 ? segLen[i - 1] * 0.95 : segLen[i - 1] * 0.5;
    const limB = i + 1 === n - 1 ? segLen[i] * 0.95 : segLen[i] * 0.5;
    const tanHalf = Math.tan(Math.min(ang, 3.1) / 2);
    const tl = Math.min(radius * tanHalf, limA, limB);
    tanLen[i] = tl;
    radii[i] = tl / tanHalf;
  }
  const out: P2[] = [{ ...pts[0] }];
  const push = (p: P2): void => {
    const q = out[out.length - 1];
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < 0.05) return;
    if (d > step) {
      const k = Math.ceil(d / step);
      for (let j = 1; j < k; j++) out.push({ x: q.x + ((p.x - q.x) * j) / k, z: q.z + ((p.z - q.z) * j) / k });
    }
    out.push({ x: p.x, z: p.z });
  };
  for (let i = 1; i < n - 1; i++) {
    const p = pts[i];
    if (tanLen[i] <= 0) {
      push(p);
      continue;
    }
    const ax = (pts[i].x - pts[i - 1].x) / segLen[i - 1];
    const az = (pts[i].z - pts[i - 1].z) / segLen[i - 1];
    const bx = (pts[i + 1].x - pts[i].x) / segLen[i];
    const bz = (pts[i + 1].z - pts[i].z) / segLen[i];
    const t0 = { x: p.x - ax * tanLen[i], z: p.z - az * tanLen[i] };
    push(t0);
    // Arc from t0 (heading a) to t1 (heading b): side of the turn from the cross product.
    const side = ax * bz - az * bx > 0 ? 1 : -1;
    const r = radii[i];
    // Starboard perpendicular of (ax, az) is (-az, ax); turning with cross > 0 is towards starboard.
    const cx = t0.x + -az * r * side;
    const cz = t0.z + ax * r * side;
    const ang = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
    const k = Math.max(2, Math.ceil((ang * r) / step));
    for (let j = 1; j <= k; j++) {
      const th = (ang * j) / k;
      const hx = ax * Math.cos(th) + -az * side * Math.sin(th);
      const hz = az * Math.cos(th) + ax * side * Math.sin(th);
      // Position = centre - starboard(h) * r * side.
      out.push({ x: cx - -hz * r * side, z: cz - hx * r * side });
    }
  }
  push(pts[n - 1]);
  return out;
}

/** Cubic Bézier sampled every ~`step` metres. */
export function bezier(p0: P2, p1: P2, p2: P2, p3: P2, step: number): P2[] {
  const approx = Math.hypot(p1.x - p0.x, p1.z - p0.z) + Math.hypot(p2.x - p1.x, p2.z - p1.z) + Math.hypot(p3.x - p2.x, p3.z - p2.z);
  const k = Math.max(4, Math.ceil(approx / step));
  const out: P2[] = [];
  for (let i = 0; i <= k; i++) {
    const t = i / k;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, z: a * p0.z + b * p1.z + c * p2.z + d * p3.z });
  }
  return out;
}
