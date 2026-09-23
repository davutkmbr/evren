/**
 * Polyline helpers for the lane graph (worker side): offsetting, trimming, clipping, Hermite connectors and the
 * PathPool that resamples every path at a uniform step with ground height, cross-slope roll and a curvature speed cap.
 */
import type { WorldBounds } from '../../../core/contracts';
import { FloatBuf } from '../shared/buffers';
import type { StreetSurface } from '../shared/street-surface';
import { SAMPLE_STRIDE } from './protocol';

/** Lateral acceleration (m/s²) drivers accept in curves. */
const A_LAT = 2.1;
/** Deceleration (m/s²) used to propagate curve caps backwards along a path. */
const CAP_DECEL = 2.2;
/** Highest speed cap (m/s) stored for straight road. */
export const CAP_MAX = 30;

export function polyLength(p: ArrayLike<number>): number {
  let l = 0;
  for (let k = 2; k < p.length; k += 2) {
    l += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
  }
  return l;
}

/** Point and unit tangent at arc length s of a flat x, z polyline. */
export function pointAt(p: ArrayLike<number>, s: number, out: number[] = [0, 0, 1, 0]): number[] {
  let acc = 0;
  const n = p.length / 2;
  for (let i = 1; i < n; i++) {
    const ax = p[i * 2 - 2];
    const az = p[i * 2 - 1];
    const dx = p[i * 2] - ax;
    const dz = p[i * 2 + 1] - az;
    const l = Math.hypot(dx, dz);
    if (acc + l >= s || i === n - 1) {
      const t = l > 1e-9 ? Math.min(1, Math.max(0, (s - acc) / l)) : 0;
      out[0] = ax + dx * t;
      out[1] = az + dz * t;
      out[2] = l > 1e-9 ? dx / l : 1;
      out[3] = l > 1e-9 ? dz / l : 0;
      return out;
    }
    acc += l;
  }
  out[0] = p[0];
  out[1] = p[1];
  return out;
}

/** Arc length of the point of `p` nearest to (x, z), and its distance. */
export function project(p: ArrayLike<number>, x: number, z: number): { s: number; d: number } {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  for (let k = 2; k < p.length; k += 2) {
    const ax = p[k - 2];
    const az = p[k - 1];
    const dx = p[k] - ax;
    const dz = p[k + 1] - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    const l = Math.sqrt(l2);
    if (d < best) {
      best = d;
      bestS = acc + t * l;
    }
    acc += l;
  }
  return { s: bestS, d: best };
}

/** Polyline offset sideways by `off` (+ = right of the direction of travel; +X east, +Z south, right = (-tz, tx)). */
export function offsetPolyline(p: ArrayLike<number>, off: number): number[] {
  const n = p.length / 2;
  const out: number[] = [];
  if (off === 0) {
    return Array.from(p);
  }
  for (let i = 0; i < n; i++) {
    let nx = 0;
    let nz = 0;
    let cnt = 0;
    for (const [a, b] of [
      [i - 1, i],
      [i, i + 1],
    ]) {
      if (a < 0 || b >= n) {
        continue;
      }
      const dx = p[b * 2] - p[a * 2];
      const dz = p[b * 2 + 1] - p[a * 2 + 1];
      const l = Math.hypot(dx, dz);
      if (l < 1e-6) {
        continue;
      }
      nx += -dz / l;
      nz += dx / l;
      cnt++;
    }
    const l = Math.hypot(nx, nz);
    if (l < 1e-6 || cnt === 0) {
      out.push(p[i * 2], p[i * 2 + 1]);
      continue;
    }
    nx /= l;
    nz /= l;
    let miter = 1;
    if (cnt === 2) {
      const dx = p[i * 2 + 2] - p[i * 2];
      const dz = p[i * 2 + 3] - p[i * 2 + 1];
      const ll = Math.hypot(dx, dz) || 1;
      const cos = nx * (-dz / ll) + nz * (dx / ll);
      miter = 1 / Math.max(0.5, cos);
    }
    out.push(p[i * 2] + nx * off * miter, p[i * 2 + 1] + nz * off * miter);
  }
  return out;
}

/** The part of polyline `p` between arc lengths a and b (a < b). */
export function subPolyline(p: ArrayLike<number>, a: number, b: number): number[] {
  const out: number[] = [];
  const pa = pointAt(p, a);
  out.push(pa[0], pa[1]);
  let acc = 0;
  for (let k = 2; k < p.length; k += 2) {
    acc += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
    if (acc > a + 1e-6 && acc < b - 1e-6) {
      out.push(p[k], p[k + 1]);
    }
  }
  const pb = pointAt(p, b);
  out.push(pb[0], pb[1]);
  return out;
}

export function reversePolyline(p: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let k = p.length - 2; k >= 0; k -= 2) {
    out.push(p[k], p[k + 1]);
  }
  return out;
}

/** Cubic Hermite curve from p0 (unit tangent t0) to p1 (unit tangent t1) as a polyline with ~1 m spacing. */
export function hermite(p0x: number, p0z: number, t0x: number, t0z: number, p1x: number, p1z: number, t1x: number, t1z: number, tangentScale: number): number[] {
  const d = Math.hypot(p1x - p0x, p1z - p0z);
  const m = Math.max(d, 0.5) * tangentScale;
  const n = Math.max(2, Math.ceil(d * 1.2) + 2);
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    out.push(h00 * p0x + h10 * m * t0x + h01 * p1x + h11 * m * t1x, h00 * p0z + h10 * m * t0z + h01 * p1z + h11 * m * t1z);
  }
  return out;
}

/** Pieces of a polyline inside `rect`; `boundary` marks ends created by the clip. `keep` carries per-vertex data. */
export function clipPolyline(p: ArrayLike<number>, keep: ArrayLike<number>, rect: WorldBounds): { pts: number[]; keep: number[]; startCut: boolean; endCut: boolean }[] {
  const inside = (x: number, z: number): boolean => x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ;
  const cross = (ax: number, az: number, bx: number, bz: number): [number, number] => {
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dz = bz - az;
    const clipT = (pp: number, q: number): boolean => {
      if (Math.abs(pp) < 1e-12) {
        return q >= 0;
      }
      const r = q / pp;
      if (pp < 0) {
        if (r > t1) {
          return false;
        }
        t0 = Math.max(t0, r);
      } else {
        if (r < t0) {
          return false;
        }
        t1 = Math.min(t1, r);
      }
      return true;
    };
    clipT(-dx, ax - rect.minX);
    clipT(dx, rect.maxX - ax);
    clipT(-dz, az - rect.minZ);
    clipT(dz, rect.maxZ - az);
    // the entering / leaving point: whichever end is outside moves to the boundary
    const t = inside(ax, az) ? t1 : t0;
    return [ax + dx * t, az + dz * t];
  };
  const out: { pts: number[]; keep: number[]; startCut: boolean; endCut: boolean }[] = [];
  const n = p.length / 2;
  let cur: { pts: number[]; keep: number[]; startCut: boolean; endCut: boolean } | null = null;
  for (let i = 0; i < n; i++) {
    const x = p[i * 2];
    const z = p[i * 2 + 1];
    const ins = inside(x, z);
    if (i > 0) {
      const px = p[i * 2 - 2];
      const pz = p[i * 2 - 1];
      const pin = inside(px, pz);
      if (pin && !ins && cur) {
        const [cx, cz] = cross(px, pz, x, z);
        cur.pts.push(cx, cz);
        cur.keep.push(-1);
        cur.endCut = true;
        out.push(cur);
        cur = null;
      } else if (!pin && ins) {
        const [cx, cz] = cross(x, z, px, pz);
        cur = { pts: [cx, cz], keep: [-1], startCut: true, endCut: false };
      }
    }
    if (ins) {
      if (!cur) {
        cur = { pts: [], keep: [], startCut: false, endCut: false };
      }
      cur.pts.push(x, z);
      cur.keep.push(keep[i]);
    }
  }
  if (cur) {
    out.push(cur);
  }
  return out.filter((c) => c.pts.length >= 4);
}

export const PathFlag = {
  /** Some samples may lie on a bridge deck (heights resolved on the main thread). */
  Deck: 1,
  /** Inside a tunnel: vehicles are hidden. */
  Hidden: 2,
} as const;

/** Uniformly resampled paths with ground height, roll and curvature speed caps (see protocol.ts SAMPLE_STRIDE). */
export class PathPool {
  readonly samples = new FloatBuf(1 << 16);
  readonly start: number[] = [];
  readonly count: number[] = [];
  readonly step: number[] = [];
  readonly length: number[] = [];
  readonly flags: number[] = [];

  constructor(private readonly surface: StreetSurface) {}

  get size(): number {
    return this.start.length;
  }

  /** Adds polyline `p` resampled at about `step` m; returns the path id. */
  add(p: ArrayLike<number>, step: number, flags = 0): number {
    const L = Math.max(polyLength(p), 0.05);
    const n = Math.max(2, Math.ceil(L / step) + 1);
    const ds = L / (n - 1);
    const id = this.start.length;
    const base = this.samples.length / SAMPLE_STRIDE;
    this.start.push(base);
    this.count.push(n);
    this.step.push(ds);
    this.length.push(L);
    this.flags.push(flags);
    const xs = new Float64Array(n);
    const zs = new Float64Array(n);
    // walk the polyline once
    let seg = 1;
    let segStart = 0;
    let segLen = p.length >= 4 ? Math.hypot(p[2] - p[0], p[3] - p[1]) : 0;
    const segs = p.length / 2;
    for (let i = 0; i < n; i++) {
      const s = i === n - 1 ? L : i * ds;
      while (seg < segs - 1 && segStart + segLen < s) {
        segStart += segLen;
        seg++;
        segLen = Math.hypot(p[seg * 2] - p[seg * 2 - 2], p[seg * 2 + 1] - p[seg * 2 - 1]);
      }
      const t = segLen > 1e-9 ? Math.min(1, Math.max(0, (s - segStart) / segLen)) : 0;
      xs[i] = p[seg * 2 - 2] + (p[seg * 2] - p[seg * 2 - 2]) * t;
      zs[i] = p[seg * 2 - 1] + (p[seg * 2 + 1] - p[seg * 2 - 1]) * t;
    }
    const kappa = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) {
      const ax = xs[i] - xs[i - 1];
      const az = zs[i] - zs[i - 1];
      const bx = xs[i + 1] - xs[i];
      const bz = zs[i + 1] - zs[i];
      const la = Math.hypot(ax, az);
      const lb = Math.hypot(bx, bz);
      if (la < 1e-6 || lb < 1e-6) {
        continue;
      }
      const ang = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
      kappa[i] = ang / ((la + lb) / 2);
    }
    if (n > 2) {
      kappa[0] = kappa[1];
      kappa[n - 1] = kappa[n - 2];
    }
    const caps = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let k = kappa[i];
      for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
        k = Math.max(k, kappa[j] * 0.8);
      }
      caps[i] = Math.min(CAP_MAX, Math.sqrt(A_LAT / Math.max(k, 1e-5)));
    }
    for (let i = n - 2; i >= 0; i--) {
      caps[i] = Math.min(caps[i], Math.sqrt(caps[i + 1] * caps[i + 1] + 2 * CAP_DECEL * ds));
    }
    const surface = this.surface;
    for (let i = 0; i < n; i++) {
      const j0 = Math.max(0, i - 1);
      const j1 = Math.min(n - 1, i + 1);
      let tx = xs[j1] - xs[j0];
      let tz = zs[j1] - zs[j0];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const x = xs[i];
      const z = zs[i];
      const y = surface.heightAt(x, z);
      const hr = surface.heightAt(x - tz * 0.9, z + tx * 0.9);
      const hl = surface.heightAt(x + tz * 0.9, z - tx * 0.9);
      const roll = Math.atan2(hl - hr, 1.8);
      this.samples.push(x, y, z, roll, caps[i]);
    }
    return id;
  }
}
