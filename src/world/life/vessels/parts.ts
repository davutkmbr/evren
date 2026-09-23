import * as THREE from 'three';
import { Detail, Emit, MeshBuilder, surf, type SurfaceSpec } from '../util/mesh-builder';
import type { P2 } from '../util/path';

/** Common palette (sRGB hex). */
export const PAL = {
  white: 0xeceae3,
  offWhite: 0xdcd8cc,
  cream: 0xe6dcc3,
  greyLight: 0xb9bcbc,
  grey: 0x7c8284,
  greyDark: 0x3d4144,
  black: 0x1b1c1d,
  glass: 0x141b22,
  glassBlue: 0x1a2a38,
  woodDeck: 0x8c7358,
  deckGreen: 0x4f6a52,
  deckRed: 0x6b3024,
  funnelYellow: 0xe0a31c,
  lifeboat: 0xf0641c,
  navy: 0x1d2c56,
  rope: 0x8a7a5c,
  net: 0x2d3a36,
  rust: 0x5a2d18,
  steel: 0x8a8f92,
} as const;

export const S = {
  superWhite: (): SurfaceSpec => surf(PAL.white, { roughness: 0.55, detail: Detail.Super }),
  superOff: (): SurfaceSpec => surf(PAL.offWhite, { roughness: 0.6, detail: Detail.Super }),
  roof: (hex: number = PAL.greyLight): SurfaceSpec => surf(hex, { roughness: 0.75, detail: Detail.Deck }),
  glass: (emit: number = Emit.Crew): SurfaceSpec => surf(PAL.glass, { roughness: 0.07, metalness: 0.0, emit, detail: Detail.Glass }),
  dark: (): SurfaceSpec => surf(PAL.black, { roughness: 0.6, metalness: 0.2 }),
  steel: (): SurfaceSpec => surf(PAL.steel, { roughness: 0.45, metalness: 0.6 }),
  hullPaint: (): SurfaceSpec => surf(0xffffff, { paint: 1, roughness: 0.55, metalness: 0.15, detail: Detail.Hull }),
  accent: (): SurfaceSpec => surf(0xffffff, { paint: 2, roughness: 0.5, metalness: 0.1, detail: Detail.Super }),
  lamp: (): SurfaceSpec => surf(0xfff4dc, { roughness: 0.3, emit: Emit.Lamp }),
};

function signedArea(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a * 0.5;
}

/** Outward normal of edge i of a polygon in XZ. */
function edgeNormal(poly: readonly P2[], i: number, sign: number): P2 {
  const p = poly[i];
  const q = poly[(i + 1) % poly.length];
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: (sign * dz) / l, z: (-sign * dx) / l };
}

/**
 * Vertical prism over a planform polygon (XZ) from y0 to y0 + h: walls + roof cap (+ optional floor).
 * Walls are smooth-shaded across gentle corners (< `creaseDeg`).
 */
export function prism(b: MeshBuilder, poly: readonly P2[], y0: number, h: number, wall: SurfaceSpec, roof: SurfaceSpec | null, floor: SurfaceSpec | null = null, creaseDeg = 35): void {
  const n = poly.length;
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  const normals = poly.map((_, i) => edgeNormal(poly, i, sign));
  const cosCrease = Math.cos(THREE.MathUtils.degToRad(creaseDeg));
  const y1 = y0 + h;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const ne = normals[i];
    const prev = normals[(i - 1 + n) % n];
    const next = normals[(i + 1) % n];
    const np = prev.x * ne.x + prev.z * ne.z > cosCrease ? { x: prev.x + ne.x, z: prev.z + ne.z } : ne;
    const nq = next.x * ne.x + next.z * ne.z > cosCrease ? { x: next.x + ne.x, z: next.z + ne.z } : ne;
    const i0 = b.vertex(p.x, y0, p.z, np.x, 0, np.z, wall);
    const i1 = b.vertex(q.x, y0, q.z, nq.x, 0, nq.z, wall);
    const i2 = b.vertex(q.x, y1, q.z, nq.x, 0, nq.z, wall);
    const i3 = b.vertex(p.x, y1, p.z, np.x, 0, np.z, wall);
    // Winding: outward normal = (q - p) x up for sign > 0 polygons.
    const cx = (q.z - p.z) * 1;
    const cz = -(q.x - p.x) * 1;
    if (cx * ne.x + cz * ne.z >= 0) {
      b.tri(i0, i3, i2);
      b.tri(i0, i2, i1);
    } else {
      b.tri(i0, i1, i2);
      b.tri(i0, i2, i3);
    }
  }
  const tris = THREE.ShapeUtils.triangulateShape(
    poly.map((p) => new THREE.Vector2(p.x, p.z)),
    [],
  );
  if (roof) {
    const base = b.vertexCount;
    for (const p of poly) b.vertex(p.x, y1, p.z, 0, 1, 0, roof);
    for (const [a, c, d] of tris) {
      const pa = poly[a];
      const pc = poly[c];
      const pd = poly[d];
      // y-component of (c - a) x (d - a) with (x, y, z) = (x, 0, z): (dz_c * dx_d - dx_c * dz_d)
      const ny = (pc.z - pa.z) * (pd.x - pa.x) - (pc.x - pa.x) * (pd.z - pa.z);
      if (ny >= 0) b.tri(base + a, base + c, base + d);
      else b.tri(base + a, base + d, base + c);
    }
  }
  if (floor) {
    const base = b.vertexCount;
    for (const p of poly) b.vertex(p.x, y0, p.z, 0, -1, 0, floor);
    for (const [a, c, d] of tris) {
      const pa = poly[a];
      const pc = poly[c];
      const pd = poly[d];
      const ny = (pc.z - pa.z) * (pd.x - pa.x) - (pc.x - pa.x) * (pd.z - pa.z);
      if (ny < 0) b.tri(base + a, base + c, base + d);
      else b.tri(base + a, base + d, base + c);
    }
  }
}

/** Planform polygon from a half-width function between zFwd (< zAft) and zAft, `samples` stations per side. */
export function planform(zFwd: number, zAft: number, halfWidth: (z: number) => number, samples = 12, minHalf = 0.05): P2[] {
  const stbd: P2[] = [];
  for (let i = 0; i <= samples; i++) {
    const z = zAft + ((zFwd - zAft) * i) / samples;
    stbd.push({ x: Math.max(halfWidth(z), minHalf), z });
  }
  const port = stbd.map((p) => ({ x: -p.x, z: p.z })).reverse();
  return [...stbd, ...port];
}

export interface WindowSpec {
  surf: SurfaceSpec;
  sill: number;
  height: number;
  width: number;
  pitch: number;
  /** Minimum edge length that receives windows. */
  minEdge?: number;
  /** Continuous band instead of individual panes. */
  band?: boolean;
  /** Distance kept free at the ends of every edge. */
  margin?: number;
}

/** Windows on every sufficiently long wall of a planform prism (placed just outside the wall). */
export function windowsOnPolygon(b: MeshBuilder, poly: readonly P2[], y0: number, w: WindowSpec, edgeFilter?: (n: P2, i: number) => boolean): void {
  const n = poly.length;
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  const margin = w.margin ?? 0.35;
  const a = new THREE.Vector3();
  const bb = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < (w.minEdge ?? w.width + 2 * margin)) continue;
    const ne = edgeNormal(poly, i, sign);
    if (edgeFilter && !edgeFilter(ne, i)) continue;
    const ux = (q.x - p.x) / len;
    const uz = (q.z - p.z) / len;
    const off = 0.025;
    nn.set(ne.x, 0, ne.z);
    const place = (s0: number, s1: number): void => {
      a.set(p.x + ux * s0 + ne.x * off, y0 + w.sill, p.z + uz * s0 + ne.z * off);
      bb.set(p.x + ux * s1 + ne.x * off, y0 + w.sill, p.z + uz * s1 + ne.z * off);
      c.set(bb.x, y0 + w.sill + w.height, bb.z);
      d.set(a.x, y0 + w.sill + w.height, a.z);
      b.quadFacing(a, bb, c, d, nn, w.surf);
    };
    if (w.band) {
      place(margin, len - margin);
      continue;
    }
    const count = Math.floor((len - 2 * margin + (w.pitch - w.width)) / w.pitch);
    if (count <= 0) continue;
    const used = count * w.pitch - (w.pitch - w.width);
    const start = (len - used) / 2;
    for (let k = 0; k < count; k++) {
      const s0 = start + k * w.pitch;
      place(s0, s0 + w.width);
    }
  }
}

/** Railing along a polyline: top rail, mid rail and posts (thin boxes). */
export function railing(b: MeshBuilder, pts: readonly P2[], y0: number, s: SurfaceSpec, height = 1.05, postPitch = 1.6, closed = false): void {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  const t = 0.05;
  for (let i = 0; i < segs; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 0.05) continue;
    const yaw = Math.atan2(q.x - p.x, q.z - p.z);
    b.pushTRS((p.x + q.x) / 2, y0, (p.z + q.z) / 2, yaw);
    b.box(0, height, 0, t, t, len + t, s, 63 & ~8);
    b.box(0, height * 0.5, 0, t * 0.6, t * 0.6, len, s, 1 | 2 | 4);
    const posts = Math.max(1, Math.round(len / postPitch));
    for (let k = 0; k < posts; k++) {
      const z = -len / 2 + (k * len) / posts;
      b.box(0, height / 2, z, t, height, t, s, 1 | 2 | 16 | 32);
    }
    b.pop();
  }
}

/** Elliptical, optionally raked funnel with a black top band (accent-painted body unless a surface is given). */
export function funnel(b: MeshBuilder, x: number, y0: number, z: number, rx: number, rz: number, h: number, rakeDeg: number, body: SurfaceSpec, band: SurfaceSpec, bandH: number, seg = 14): void {
  const m = new THREE.Matrix4().makeTranslation(x, y0, z).multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(rakeDeg)));
  b.push(m);
  b.cylinder(0, 0, 0, 1, 0.97, h - bandH, seg, body, false, false, rx, rz);
  b.cylinder(0, h - bandH, 0, 0.97, 0.95, bandH, seg, band, true, false, rx, rz);
  b.pop();
}

/** Pole mast with a yard; returns the masthead position. */
export function mast(b: MeshBuilder, x: number, y0: number, z: number, h: number, r: number, s: SurfaceSpec, yard = 0, rakeDeg = 0): THREE.Vector3 {
  const m = new THREE.Matrix4().makeTranslation(x, y0, z).multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(rakeDeg)));
  b.push(m);
  b.cylinder(0, 0, 0, r, r * 0.6, h, 6, s, true);
  if (yard > 0) b.box(0, h * 0.8, 0, yard, 0.12, 0.12, s);
  b.pop();
  const top = new THREE.Vector3(0, h, 0).applyMatrix4(m);
  return top;
}

/** Enclosed lifeboat (ellipsoid hull + canopy) along Z. */
export function lifeboat(b: MeshBuilder, x: number, y: number, z: number, len: number, s: SurfaceSpec, seg = 8): void {
  const w = len * 0.3;
  b.ellipsoid(x, y, z, w / 2, w * 0.28, len / 2, seg, 5, s);
  b.ellipsoid(x, y + w * 0.18, z, w * 0.42, w * 0.32, len * 0.42, seg, 4, s);
}

/** Life-raft canister (horizontal cylinder along X). */
export function raftCanister(b: MeshBuilder, x: number, y: number, z: number, s: SurfaceSpec): void {
  b.pushTRS(x, y, z, 0, 0, Math.PI / 2);
  b.cylinder(0, -0.6, 0, 0.32, 0.32, 1.2, 8, s, true, true);
  b.pop();
}

/** Bollard pair on a deck. */
export function bollards(b: MeshBuilder, x: number, y: number, z: number, s: SurfaceSpec): void {
  b.cylinder(x, y, z - 0.25, 0.14, 0.14, 0.45, 6, s, true);
  b.cylinder(x, y, z + 0.25, 0.14, 0.14, 0.45, 6, s, true);
}

/** Offset a closed planform outward (positive) along vertex normals. */
export function inflate(poly: readonly P2[], d: number): P2[] {
  const n = poly.length;
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = edgeNormal(poly, (i - 1 + n) % n, sign);
    const c = edgeNormal(poly, i, sign);
    let nx = a.x + c.x;
    let nz = a.z + c.z;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    const cosHalf = Math.max(0.35, nx * c.x + nz * c.z);
    out.push({ x: poly[i].x + (nx * d) / cosHalf, z: poly[i].z + (nz * d) / cosHalf });
  }
  return out;
}

/** Horizontal slab (deck plate / canopy) over a polygon with a rim. */
export function slab(b: MeshBuilder, poly: readonly P2[], y: number, thickness: number, top: SurfaceSpec, rim: SurfaceSpec, bottom: SurfaceSpec | null = null): void {
  prism(b, poly, y - thickness, thickness, rim, top, bottom, 30);
}

/** Rectangle polygon helper (XZ), centred. */
export function rect(cx: number, cz: number, w: number, d: number): P2[] {
  return [
    { x: cx + w / 2, z: cz + d / 2 },
    { x: cx + w / 2, z: cz - d / 2 },
    { x: cx - w / 2, z: cz - d / 2 },
    { x: cx - w / 2, z: cz + d / 2 },
  ];
}

/** Rounded-rectangle polygon (corner radius r, `k` segments per corner). */
export function roundRect(cx: number, cz: number, w: number, d: number, r: number, k = 3): P2[] {
  const out: P2[] = [];
  const hw = w / 2 - r;
  const hd = d / 2 - r;
  const corners: [number, number, number][] = [
    [hw, hd, 0],
    [hw, -hd, -Math.PI / 2],
    [-hw, -hd, Math.PI],
    [-hw, hd, Math.PI / 2],
  ];
  for (const [ox, oz, a0] of corners) {
    for (let i = 0; i <= k; i++) {
      const a = a0 - (i / k) * (Math.PI / 2);
      out.push({ x: cx + ox + Math.cos(a) * r, z: cz + oz + Math.sin(a) * r });
    }
  }
  return out;
}
