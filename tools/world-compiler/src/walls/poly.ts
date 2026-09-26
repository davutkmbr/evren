/** Polyline helpers of the wall bake (x, z pairs as V2, arc length s in metres). */
import type { V2 } from '../../../../src/world/landmarks/heritage/build/geom';

export type { V2 };

export function lengths(pts: readonly V2[]): number[] {
  const s = [0];
  for (let i = 1; i < pts.length; i++) {
    s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return s;
}

export function length(pts: readonly V2[]): number {
  const s = lengths(pts);
  return s[s.length - 1];
}

/** Point and unit tangent at arc length s (clamped). */
export function at(pts: readonly V2[], cum: readonly number[], s: number): { p: V2; t: V2 } {
  const total = cum[cum.length - 1];
  const q = Math.min(Math.max(s, 0), total);
  let i = 1;
  while (i < pts.length - 1 && cum[i] < q) {
    i++;
  }
  const a = pts[i - 1];
  const b = pts[i];
  const l = cum[i] - cum[i - 1] || 1;
  const f = (q - cum[i - 1]) / l;
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
}

/** Mean tangent over [s - r, s + r] (a stable direction at vertices). */
export function tangent(pts: readonly V2[], cum: readonly number[], s: number, r = 4): V2 {
  const a = at(pts, cum, s - r).p;
  const b = at(pts, cum, s + r).p;
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return l > 1e-6 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : at(pts, cum, s).t;
}

/** Sub-polyline between arc lengths s0 < s1. */
export function slice(pts: readonly V2[], cum: readonly number[], s0: number, s1: number): V2[] {
  const out: V2[] = [at(pts, cum, s0).p];
  for (let i = 1; i < pts.length - 1; i++) {
    if (cum[i] > s0 + 0.05 && cum[i] < s1 - 0.05) {
      out.push(pts[i]);
    }
  }
  out.push(at(pts, cum, s1).p);
  return out;
}

export interface Projection {
  s: number;
  d: number;
  /** Signed offset: positive to the right of the drawing direction (the outer side). */
  side: number;
}

export function project(pts: readonly V2[], cum: readonly number[], x: number, z: number): Projection {
  let best: Projection = { s: 0, d: Infinity, side: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
    const px = a[0] + dx * t;
    const pz = a[1] + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) {
      const l = Math.sqrt(l2) || 1;
      // Right-hand normal (-dz, dx).
      const side = ((x - px) * -dz + (z - pz) * dx) / l;
      best = { s: cum[i - 1] + t * (cum[i] - cum[i - 1]), d, side };
    }
  }
  return best;
}

export function segDist(px: number, pz: number, a: V2, b: V2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2)) : 0;
  return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
}

export function ringDist(x: number, z: number, ring: readonly V2[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    d = Math.min(d, segDist(x, z, ring[i], ring[(i + 1) % ring.length]));
  }
  return d;
}

export function inRing(x: number, z: number, ring: readonly V2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export function ringArea(ring: readonly V2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function flat(v: readonly number[]): V2[] {
  const out: V2[] = [];
  for (let i = 0; i + 1 < v.length; i += 2) {
    out.push([v[i], v[i + 1]]);
  }
  return out;
}

/** Douglas-Peucker simplification (keeps the end points). */
export function simplify(pts: readonly V2[], tol: number): V2[] {
  if (pts.length < 3) {
    return pts.slice();
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i][0], pts[i][1], pts[a], pts[b]);
      if (d > dmax) {
        dmax = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Drops consecutive points closer than `eps`. */
export function dedupe(pts: readonly V2[], eps = 0.05): V2[] {
  const out: V2[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) {
      out.push(p);
    }
  }
  return out;
}

/** Chaikin corner cutting (open polyline, end points kept). */
export function chaikin(pts: readonly V2[], iterations: number): V2[] {
  let cur = pts.slice();
  for (let k = 0; k < iterations; k++) {
    if (cur.length < 3) {
      return cur;
    }
    const next: V2[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** Evenly spaced points along the polyline (step m, both ends included). */
export function resample(pts: readonly V2[], step: number): V2[] {
  const cum = lengths(pts);
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.round(total / step));
  const out: V2[] = [];
  for (let k = 0; k <= n; k++) {
    out.push(at(pts, cum, (total * k) / n).p);
  }
  return out;
}
