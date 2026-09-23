/** 2D polyline in the XZ plane with arc-length parametrisation. */
export interface P2 {
  x: number;
  z: number;
}

export class Path2 {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly cum: Float64Array;
  readonly length: number;
  readonly closed: boolean;

  constructor(points: readonly P2[], closed = false) {
    const pts = closed && points.length > 1 ? [...points, points[0]] : [...points];
    const n = pts.length;
    this.xs = new Float64Array(n);
    this.zs = new Float64Array(n);
    this.cum = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this.xs[i] = pts[i].x;
      this.zs[i] = pts[i].z;
      if (i > 0) {
        acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      }
      this.cum[i] = acc;
    }
    this.length = acc;
    this.closed = closed;
  }

  get count(): number {
    return this.xs.length;
  }

  /** Segment index containing arc length s (binary search, `hint` speeds up sequential access). */
  segmentAt(s: number, hint = 0): number {
    const cum = this.cum;
    const n = cum.length;
    let i = Math.min(Math.max(hint, 0), n - 2);
    if (s >= cum[i] && s <= cum[i + 1]) return i;
    if (s > cum[i + 1] && i + 2 < n && s <= cum[i + 2]) return i + 1;
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  wrap(s: number): number {
    if (!this.closed) return Math.min(Math.max(s, 0), this.length);
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Writes position and unit tangent at arc length s into `out` ([x, z, tx, tz]); returns the segment index. */
  sample(s: number, out: Float64Array | number[], hint = 0): number {
    const ss = this.wrap(s);
    const i = this.segmentAt(ss, hint);
    const x0 = this.xs[i];
    const z0 = this.zs[i];
    const x1 = this.xs[i + 1];
    const z1 = this.zs[i + 1];
    const segLen = this.cum[i + 1] - this.cum[i];
    const t = segLen > 1e-9 ? (ss - this.cum[i]) / segLen : 0;
    out[0] = x0 + (x1 - x0) * t;
    out[1] = z0 + (z1 - z0) * t;
    const inv = segLen > 1e-9 ? 1 / segLen : 0;
    out[2] = (x1 - x0) * inv;
    out[3] = (z1 - z0) * inv;
    return i;
  }

  points(): P2[] {
    const out: P2[] = [];
    const n = this.closed ? this.count - 1 : this.count;
    for (let i = 0; i < n; i++) out.push({ x: this.xs[i], z: this.zs[i] });
    return out;
  }
}

/** Centripetal Catmull-Rom resampling through control points at roughly `step` metres. */
export function smoothPolyline(ctrl: readonly P2[], step: number, closed = false): P2[] {
  const n = ctrl.length;
  if (n < 3) return [...ctrl];
  const get = (i: number): P2 => {
    if (closed) return ctrl[((i % n) + n) % n];
    if (i < 0) return { x: 2 * ctrl[0].x - ctrl[1].x, z: 2 * ctrl[0].z - ctrl[1].z };
    if (i >= n) return { x: 2 * ctrl[n - 1].x - ctrl[n - 2].x, z: 2 * ctrl[n - 1].z - ctrl[n - 2].z };
    return ctrl[i];
  };
  const out: P2[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const d = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const k = Math.max(1, Math.ceil(d / step));
    const t0 = 0;
    const t1 = t0 + Math.pow(Math.max(Math.hypot(p1.x - p0.x, p1.z - p0.z), 1e-3), 0.5);
    const t2 = t1 + Math.pow(Math.max(d, 1e-3), 0.5);
    const t3 = t2 + Math.pow(Math.max(Math.hypot(p3.x - p2.x, p3.z - p2.z), 1e-3), 0.5);
    for (let j = 0; j < k; j++) {
      const t = t1 + ((t2 - t1) * j) / k;
      const a1x = ((t1 - t) / (t1 - t0)) * p0.x + ((t - t0) / (t1 - t0)) * p1.x;
      const a1z = ((t1 - t) / (t1 - t0)) * p0.z + ((t - t0) / (t1 - t0)) * p1.z;
      const a2x = ((t2 - t) / (t2 - t1)) * p1.x + ((t - t1) / (t2 - t1)) * p2.x;
      const a2z = ((t2 - t) / (t2 - t1)) * p1.z + ((t - t1) / (t2 - t1)) * p2.z;
      const a3x = ((t3 - t) / (t3 - t2)) * p2.x + ((t - t2) / (t3 - t2)) * p3.x;
      const a3z = ((t3 - t) / (t3 - t2)) * p2.z + ((t - t2) / (t3 - t2)) * p3.z;
      const b1x = ((t2 - t) / (t2 - t0)) * a1x + ((t - t0) / (t2 - t0)) * a2x;
      const b1z = ((t2 - t) / (t2 - t0)) * a1z + ((t - t0) / (t2 - t0)) * a2z;
      const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x;
      const b2z = ((t3 - t) / (t3 - t1)) * a2z + ((t - t1) / (t3 - t1)) * a3z;
      out.push({
        x: ((t2 - t) / (t2 - t1)) * b1x + ((t - t1) / (t2 - t1)) * b2x,
        z: ((t2 - t) / (t2 - t1)) * b1z + ((t - t1) / (t2 - t1)) * b2z,
      });
    }
  }
  if (!closed) out.push({ ...ctrl[n - 1] });
  return out;
}

/** Moving-average smoothing (endpoints fixed unless closed). */
export function relax(points: P2[], iterations: number, closed = false, pinned?: (i: number) => boolean): P2[] {
  let pts = points.map((p) => ({ ...p }));
  const n = pts.length;
  for (let it = 0; it < iterations; it++) {
    const next = pts.map((p) => ({ ...p }));
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      if (pinned?.(i)) continue;
      const a = pts[(i - 1 + n) % n];
      const b = pts[(i + 1) % n];
      next[i].x = pts[i].x * 0.5 + (a.x + b.x) * 0.25;
      next[i].z = pts[i].z * 0.5 + (a.z + b.z) * 0.25;
    }
    pts = next;
  }
  return pts;
}

/** Offsets a polyline sideways (positive = to the right of travel direction, i.e. starboard). */
export function offsetPolyline(points: readonly P2[], offset: (i: number) => number): P2[] {
  const n = points.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, n - 1)];
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    // Right of forward (tx, tz) in a Y-up, -Z-north frame: (-tz, tx).
    const o = offset(i);
    out.push({ x: points[i].x - tz * o, z: points[i].z + tx * o });
  }
  return out;
}
