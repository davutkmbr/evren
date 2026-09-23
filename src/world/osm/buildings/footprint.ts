/** Footprint analysis for the buildings worker: minimum-area rectangle, convexity, ring offsets, centroid. */
import { ringArea } from '../shared/geometry';
import type { FootprintInfo } from './plan';

export interface Obb {
  cx: number;
  cz: number;
  /** Unit long axis. */
  dx: number;
  dz: number;
  /** Half length (along dx, dz) and half width. */
  hl: number;
  hw: number;
  area: number;
}

export function hullArea(r: readonly number[]): number {
  const pts: [number, number][] = [];
  for (let i = 0; i < r.length; i += 2) {
    pts.push([r[i], r[i + 1]]);
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    return out;
  };
  const lower = half(pts);
  const upper = half([...pts].reverse());
  return Math.abs(ringArea(lower.slice(0, -1).concat(upper.slice(0, -1)).flat()));
}

/** Minimum-area bounding rectangle over the ring's edge directions. */
export function orientedBox(r: readonly number[]): Obb {
  const n = r.length / 2;
  let best: Obb = { area: Infinity, cx: 0, cz: 0, dx: 1, dz: 0, hl: 0, hw: 0 };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let dx = r[j * 2] - r[i * 2];
    let dz = r[j * 2 + 1] - r[i * 2 + 1];
    const len = Math.hypot(dx, dz);
    if (len < 0.5) {
      continue;
    }
    dx /= len;
    dz /= len;
    let s0 = Infinity;
    let s1 = -Infinity;
    let t0 = Infinity;
    let t1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const s = r[k * 2] * dx + r[k * 2 + 1] * dz;
      const t = -r[k * 2] * dz + r[k * 2 + 1] * dx;
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
    const area = (s1 - s0) * (t1 - t0);
    if (area < best.area) {
      const sc = (s0 + s1) / 2;
      const tc = (t0 + t1) / 2;
      const cx = sc * dx - tc * dz;
      const cz = sc * dz + tc * dx;
      const along = (s1 - s0) / 2;
      const across = (t1 - t0) / 2;
      best = along >= across ? { area, cx, cz, dx, dz, hl: along, hw: across } : { area, cx, cz, dx: -dz, dz: dx, hl: across, hw: along };
    }
  }
  if (!Number.isFinite(best.area)) {
    best = { area: 0, cx: r[0], cz: r[1], dx: 1, dz: 0, hl: 0.5, hw: 0.5 };
  }
  return best;
}

/** World point of OBB coordinates (s along the long axis, t across). */
export function obbPoint(b: Obb, s: number, t: number): [number, number] {
  return [b.cx + b.dx * s - b.dz * t, b.cz + b.dz * s + b.dx * t];
}

/** Mitred offset ring (flat x, z): positive `dist` grows outer rings (positive area), negative shrinks them. */
export function offsetRing(r: readonly number[], dist: number): number[] {
  const n = r.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const q = (i + 1) % n;
    const e1x = r[i * 2] - r[p * 2];
    const e1z = r[i * 2 + 1] - r[p * 2 + 1];
    const e2x = r[q * 2] - r[i * 2];
    const e2z = r[q * 2 + 1] - r[i * 2 + 1];
    const l1 = Math.hypot(e1x, e1z) || 1;
    const l2 = Math.hypot(e2x, e2z) || 1;
    let mx = e1z / l1 + e2z / l2;
    let mz = -e1x / l1 - e2x / l2;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cosHalf = Math.max(0.45, mx * (e2z / l2) + mz * (-e2x / l2));
    out.push(r[i * 2] + (mx * dist) / cosHalf, r[i * 2 + 1] + (mz * dist) / cosHalf);
  }
  return out;
}

/** Ring without duplicate / collinear-degenerate vertices (keeps rings of >= 3 points). */
export function cleanRing(r: readonly number[]): number[] {
  const out: number[] = [];
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const x = r[i * 2];
    const z = r[i * 2 + 1];
    const m = out.length;
    if (m >= 2 && Math.hypot(x - out[m - 2], z - out[m - 1]) < 0.15) {
      continue;
    }
    out.push(x, z);
  }
  while (out.length >= 6 && Math.hypot(out[0] - out[out.length - 2], out[1] - out[out.length - 1]) < 0.15) {
    out.length -= 2;
  }
  return out;
}

export function footprintInfo(r: readonly number[], box: Obb): FootprintInfo {
  const n = r.length / 2;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += r[i * 2];
    cz += r[i * 2 + 1];
  }
  cx /= n;
  cz /= n;
  const area = Math.abs(ringArea(r));
  return {
    area,
    cx,
    cz,
    convexity: area / Math.max(1e-3, hullArea(r)),
    vertices: n,
    hl: box.hl,
    hw: box.hw,
    rectangular: n <= 5 && area / Math.max(1e-3, box.area) > 0.9,
  };
}
