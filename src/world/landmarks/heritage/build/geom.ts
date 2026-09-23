import { ShapeUtils, Vector2 } from 'three';

/** 2D point on the ground plane: [x (east), z (south)]. */
export type V2 = [number, number];
export type V3 = [number, number, number];

export function ringFromFlat(flat: readonly number[]): V2[] {
  const out: V2[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push([flat[i], flat[i + 1]]);
  }
  return out;
}

/** Signed area, positive when counter-clockwise in map view (north up, east right). */
export function signedArea(ring: readonly V2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * -q[1] - q[0] * -p[1];
  }
  return a * 0.5;
}

export function ensureCCW(ring: V2[]): V2[] {
  return signedArea(ring) < 0 ? ring.slice().reverse() : ring;
}

export function centroid(ring: readonly V2[]): V2 {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

export interface OBB {
  cx: number;
  cz: number;
  /** Extent along the long axis. */
  len: number;
  /** Extent across. */
  wid: number;
  /** Long axis direction (x, z) = (cos a, sin a). */
  angle: number;
}

/** Minimum-area oriented rectangle (edge-aligned candidates). */
export function obb(ring: readonly V2[]): OBB {
  let best: OBB | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of ring) {
      const u = p[0] * c + p[1] * s;
      const v = -p[0] * s + p[1] * c;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      const lu = maxU - minU;
      const lv = maxV - minV;
      best = {
        cx: cu * c - cv * s,
        cz: cu * s + cv * c,
        len: Math.max(lu, lv),
        wid: Math.min(lu, lv),
        angle: lu >= lv ? ang : ang + Math.PI / 2,
      };
    }
  }
  return best ?? { cx: 0, cz: 0, len: 0, wid: 0, angle: 0 };
}

/** Rectangle corners (CCW in map view) of an oriented box. */
export function rectRing(cx: number, cz: number, len: number, wid: number, angle: number): V2[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const hl = len / 2;
  const hw = wid / 2;
  const pts: V2[] = [
    [cx - c * hl + s * hw, cz - s * hl - c * hw],
    [cx + c * hl + s * hw, cz + s * hl - c * hw],
    [cx + c * hl - s * hw, cz + s * hl + c * hw],
    [cx - c * hl - s * hw, cz - s * hl + c * hw],
  ];
  return ensureCCW(pts);
}

/** Miter offset of a CCW ring; positive distance grows it outward. */
export function offsetRing(ring: readonly V2[], d: number): V2[] {
  const n = ring.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i - 1 + n) % n];
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    const n0 = edgeNormal(p0, p1);
    const n1 = edgeNormal(p1, p2);
    let mx = n0[0] + n1[0];
    let mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cosHalf = Math.max(mx * n1[0] + mz * n1[1], 0.35);
    out.push([p1[0] + (mx * d) / cosHalf, p1[1] + (mz * d) / cosHalf]);
  }
  return out;
}

/** Outward normal of a CCW ring edge a→b. */
export function edgeNormal(a: V2, b: V2): V2 {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [-dz / l, dx / l];
}

export function pointInPolygon(x: number, z: number, ring: readonly V2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1] || 1e-9) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export function polylineLength(pts: readonly V2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) {
    l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return l;
}

export interface PathSample {
  x: number;
  z: number;
  /** Distance along the path. */
  s: number;
  /** Unit tangent. */
  tx: number;
  tz: number;
}

/** Evenly resampled polyline (keeps original vertices so corners stay sharp). */
export function resample(pts: readonly V2[], step: number): PathSample[] {
  const out: PathSample[] = [];
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      continue;
    }
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a[0] + dx * t, z: a[1] + dz * t, s: s + len * t, tx: dx / len, tz: dz / len });
    }
    s += len;
  }
  const last = pts[pts.length - 1];
  const prev = out[out.length - 1];
  out.push({ x: last[0], z: last[1], s, tx: prev ? prev.tx : 1, tz: prev ? prev.tz : 0 });
  return out;
}

/** Point and tangent at arc length s along a polyline. */
export function pointAt(pts: readonly V2[], s: number): PathSample {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + len >= s || i === pts.length - 2) {
      const t = len > 0 ? Math.min(Math.max((s - acc) / len, 0), 1) : 0;
      const tx = len > 0 ? (b[0] - a[0]) / len : 1;
      const tz = len > 0 ? (b[1] - a[1]) / len : 0;
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, s, tx, tz };
    }
    acc += len;
  }
  const p = pts[0];
  return { x: p[0], z: p[1], s: 0, tx: 1, tz: 0 };
}

/** Triangulates a simple polygon (any winding). Returns index triples into `ring`. */
export function triangulate(ring: readonly V2[]): number[] {
  const contour = ring.map((p) => new Vector2(p[0], p[1]));
  const faces = ShapeUtils.triangulateShape(contour, []);
  const out: number[] = [];
  for (const f of faces) {
    out.push(f[0], f[1], f[2]);
  }
  return out;
}

/** Compass heading (0 = north, clockwise) -> unit direction (x, z). */
export function headingDir(deg: number): V2 {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), -Math.cos(r)];
}

/** Rotates a local offset (along = forward axis, side = right) into world x/z for a frame with forward f. */
export function frame(ox: number, oz: number, f: V2, along: number, side: number): V2 {
  // right of forward (x,z) is (-f.z, f.x)
  return [ox + f[0] * along - f[1] * side, oz + f[1] * along + f[0] * side];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
