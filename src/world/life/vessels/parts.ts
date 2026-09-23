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

/**
 * Windows on every sufficiently long wall of a planform prism (placed just outside the wall). Consecutive edges that
 * are nearly collinear (a subdivided hull-following side) are treated as one continuous wall.
 */
export function windowsOnPolygon(b: MeshBuilder, poly: readonly P2[], y0: number, w: WindowSpec, edgeFilter?: (n: P2, i: number) => boolean): void {
  const n = poly.length;
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  const margin = w.margin ?? 0.35;
  const cosJoin = Math.cos(THREE.MathUtils.degToRad(9));
  const edges = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    return { i, p, q, len: Math.hypot(q.x - p.x, q.z - p.z), ne: edgeNormal(poly, i, sign) };
  });
  const joins = (a: (typeof edges)[number], c: (typeof edges)[number]): boolean => a.ne.x * c.ne.x + a.ne.z * c.ne.z >= cosJoin;
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (!joins(edges[(i - 1 + n) % n], edges[i])) {
      start = i;
      break;
    }
  }
  const a = new THREE.Vector3();
  const bb = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const off = 0.035;
  let k = 0;
  while (k < n) {
    const run = [edges[(start + k) % n]];
    k++;
    while (k < n && joins(run[run.length - 1], edges[(start + k) % n])) {
      run.push(edges[(start + k) % n]);
      k++;
    }
    let total = 0;
    let ax = 0;
    let az = 0;
    for (const e of run) {
      total += e.len;
      ax += e.ne.x * e.len;
      az += e.ne.z * e.len;
    }
    const al = Math.hypot(ax, az) || 1;
    const avg = { x: ax / al, z: az / al };
    if (total < (w.minEdge ?? w.width + 2 * margin)) continue;
    if (edgeFilter && !edgeFilter(avg, run[0].i)) continue;
    // Point and normal at arc length s along the run.
    const at = (s: number): { x: number; z: number; nx: number; nz: number } => {
      let acc = 0;
      for (const e of run) {
        if (s <= acc + e.len || e === run[run.length - 1]) {
          const t = e.len > 1e-6 ? Math.min(Math.max((s - acc) / e.len, 0), 1) : 0;
          return { x: e.p.x + (e.q.x - e.p.x) * t, z: e.p.z + (e.q.z - e.p.z) * t, nx: e.ne.x, nz: e.ne.z };
        }
        acc += e.len;
      }
      return { x: run[0].p.x, z: run[0].p.z, nx: avg.x, nz: avg.z };
    };
    const place = (s0: number, s1: number): void => {
      const p0 = at(s0);
      const p1 = at(s1);
      const pm = at((s0 + s1) / 2);
      a.set(p0.x + pm.nx * off, y0 + w.sill, p0.z + pm.nz * off);
      bb.set(p1.x + pm.nx * off, y0 + w.sill, p1.z + pm.nz * off);
      c.set(bb.x, y0 + w.sill + w.height, bb.z);
      d.set(a.x, y0 + w.sill + w.height, a.z);
      nn.set(pm.nx, 0, pm.nz);
      b.quadFacing(a, bb, c, d, nn, w.surf);
    };
    if (w.band) {
      // Bands follow the run segment by segment so they hug curved walls.
      const segs = Math.max(1, Math.ceil((total - 2 * margin) / 2.5));
      for (let j = 0; j < segs; j++) place(margin + ((total - 2 * margin) * j) / segs, margin + ((total - 2 * margin) * (j + 1)) / segs);
      continue;
    }
    const count = Math.floor((total - 2 * margin + (w.pitch - w.width)) / w.pitch);
    if (count <= 0) continue;
    const used = count * w.pitch - (w.pitch - w.width);
    const s0 = (total - used) / 2;
    for (let j = 0; j < count; j++) place(s0 + j * w.pitch, s0 + j * w.pitch + w.width);
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
  // Clockwise in (x, z): each corner arc sweeps its own outer quadrant.
  const corners: [number, number, number][] = [
    [hw, hd, Math.PI / 2],
    [hw, -hd, 0],
    [-hw, -hd, -Math.PI / 2],
    [-hw, hd, -Math.PI],
  ];
  for (const [ox, oz, a0] of corners) {
    for (let i = 0; i <= k; i++) {
      const a = a0 - (i / k) * (Math.PI / 2);
      out.push({ x: cx + ox + Math.cos(a) * r, z: cz + oz + Math.sin(a) * r });
    }
  }
  return out;
}

/** Life ring hung on a side facing along `yaw` (0 = facing +X / starboard). */
export function lifeRing(b: MeshBuilder, x: number, y: number, z: number, yaw: number, s: SurfaceSpec, seg = 8): void {
  b.pushTRS(x, y, z, yaw);
  b.torus(0, 0, 0, 0.3, 0.075, seg, 4, s);
  b.pop();
}

/** Old tyre used as a fender, hanging flat against a hull side facing +X (rotated by `yaw`). */
export function tyreFender(b: MeshBuilder, x: number, y: number, z: number, yaw: number, radius: number, s: SurfaceSpec, seg = 8): void {
  b.pushTRS(x, y, z, yaw);
  b.torus(0, 0, 0, radius * 0.72, radius * 0.28, seg, 4, s);
  b.pop();
}

/** Flag on a short staff: pole + cloth (the Turkish ensign reads as a red rectangle at distance). */
export function flag(b: MeshBuilder, x: number, y: number, z: number, h: number, w: number, pole: SurfaceSpec, cloth: SurfaceSpec, yaw = 0): void {
  b.cylinder(x, y, z, 0.035, 0.025, h, 5, pole, true);
  b.pushTRS(x, y + h - w * 0.35, z, yaw);
  // Slight wave: two panels at an angle.
  b.box(0, 0, w * 0.26, 0.02, w * 0.66, w * 0.5, cloth);
  b.pushTRS(0, 0, w * 0.5, 0.25);
  b.box(0, 0, w * 0.25, 0.02, w * 0.66, w * 0.5, cloth);
  b.pop();
  b.pop();
}

const PEOPLE = [0x2b2f38, 0x3b4a66, 0x7a2a2a, 0xd9d4c7, 0x55624a, 0x1f1f22, 0x8a6d4a, 0x2f5f8f, 0xc9a23a, 0x6a3f63];

/** Standing / sitting passengers (legs, torso, head) scattered in a rectangle (x0..x1, z0..z1) on deck level y. */
export function crowd(b: MeshBuilder, x0: number, x1: number, z0: number, z1: number, y: number, count: number, rng: () => number, seated = false): void {
  const skin = surf(0xb58a6c, { roughness: 0.7 });
  const hair = surf(0x2a211b, { roughness: 0.8 });
  for (let i = 0; i < count; i++) {
    const x = x0 + (x1 - x0) * rng();
    const z = z0 + (z1 - z0) * rng();
    const top = surf(PEOPLE[Math.floor(rng() * PEOPLE.length)], { roughness: 0.85, detail: Detail.Fabric });
    const legs = surf(PEOPLE[Math.floor(rng() * 3)], { roughness: 0.85, detail: Detail.Fabric });
    const k = 0.92 + rng() * 0.16;
    const yaw = (rng() - 0.5) * 1.2 + (rng() < 0.3 ? Math.PI : 0);
    b.pushTRS(x, y, z, yaw, 0, 0, k);
    if (seated) {
      b.block(0, 0.42, 0.12, 0.36, 0.14, 0.42, legs, 1 | 2 | 4 | 16 | 32);
      b.block(0, 0.02, 0.3, 0.3, 0.42, 0.12, legs, 1 | 2 | 16 | 32);
      b.block(0, 0.56, -0.02, 0.4, 0.58, 0.22, top, 1 | 2 | 4 | 16 | 32);
      b.ellipsoid(0, 1.27, 0, 0.1, 0.12, 0.11, 6, 3, rng() < 0.5 ? hair : skin);
    } else {
      b.block(-0.1, 0, 0, 0.13, 0.82, 0.16, legs, 1 | 2 | 16 | 32);
      b.block(0.1, 0, 0, 0.13, 0.82, 0.16, legs, 1 | 2 | 16 | 32);
      b.block(0, 0.82, 0, 0.42, 0.6, 0.24, top, 1 | 2 | 4 | 16 | 32);
      b.ellipsoid(0, 1.56, 0, 0.1, 0.12, 0.11, 6, 3, rng() < 0.5 ? hair : skin);
    }
    b.pop();
  }
}

/** Row of slatted benches across the deck (backs towards `backDir` along z: +1 or -1). */
export function benchRow(b: MeshBuilder, x0: number, x1: number, z: number, y: number, s: SurfaceSpec, backDir = 1): void {
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  b.block(cx, y + 0.42, z, w, 0.06, 0.45, s, 63 & ~8);
  b.block(cx, y + 0.45, z + backDir * 0.22, w, 0.45, 0.05, s, 63 & ~8);
  for (let x = x0 + 0.2; x < x1; x += 1.6) b.block(x, y, z, 0.06, 0.42, 0.4, s, 1 | 2 | 16 | 32);
}

/**
 * The Şehir Hatları funnel emblem (red crossed anchors under a crescent and star, after the Denizcilik Bankası
 * insignia), simplified to a few flat pieces on a plane facing +X, `size` = overall height.
 */
export function crossedAnchors(b: MeshBuilder, x: number, y: number, z: number, yaw: number, size: number, s: SurfaceSpec): void {
  b.pushTRS(x, y, z, yaw);
  const k = size;
  for (const a of [0.62, -0.62]) {
    b.pushTRS(0, 0, 0, 0, 0, 0);
    b.push(new THREE.Matrix4().makeRotationX(a));
    b.box(0, 0, 0, 0.02, k * 0.9, k * 0.07, s);
    // Flukes: a bar across the lower end, stock across the upper end.
    b.box(0, -k * 0.4, 0, 0.02, k * 0.07, k * 0.34, s);
    b.box(0, k * 0.36, 0, 0.02, k * 0.06, k * 0.22, s);
    b.pop();
    b.pop();
  }
  // Crescent (thick arc) and star (small diamond) above.
  for (let i = 0; i < 5; i++) {
    const t = (i / 4 - 0.5) * 2.2;
    b.box(0, k * 0.62 + Math.cos(t) * k * 0.1, Math.sin(t) * k * 0.14, 0.02, k * 0.06, k * 0.07, s);
  }
  b.box(0, k * 0.8, 0, 0.02, k * 0.08, k * 0.08, s);
  b.pop();
}

/** Horizontal paint band around a planform (walls only), e.g. sheer stripes or a boot-top. */
export function band(b: MeshBuilder, poly: readonly P2[], y0: number, h: number, s: SurfaceSpec, grow = 0.02): void {
  prism(b, inflate(poly, grow), y0, h, s, null, null, 50);
}

/**
 * Stripe that follows a hull's sheer on both sides: from z0 to z1, `off` metres relative to the deck edge (negative =
 * below it), `h` tall, standing `grow` proud of the side plating.
 */
export function sheerBand(b: MeshBuilder, hb: (z: number) => number, deckY: (z: number) => number, z0: number, z1: number, n: number, off: number, h: number, s: SurfaceSpec, grow = 0.015): void {
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  const e = new THREE.Vector3();
  const f = new THREE.Vector3();
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const za = z0 + ((z1 - z0) * i) / n;
      const zb = z0 + ((z1 - z0) * (i + 1)) / n;
      const xa = side * (hb(za) + grow);
      const xb = side * (hb(zb) + grow);
      a.set(xa, deckY(za) + off, za);
      c.set(xb, deckY(zb) + off, zb);
      d.set(xb, deckY(zb) + off + h, zb);
      e.set(xa, deckY(za) + off + h, za);
      // Outward: perpendicular to the edge in plan, on this side.
      f.set((zb - za) * side, 0, -(xb - xa) * side);
      if (f.x * side < 0) f.negate();
      b.quadFacing(a, c, d, e, f, s);
    }
  }
}

/**
 * Modern wheelhouse: vertical wall up to `hWall`, then an outward-raked window band (`flare` metres wider at the top on
 * every side) of height `hGlass` with slim corner posts, as on tugs, pilot boats and sea buses. Returns the polygon of
 * the top edge (for the roof slab).
 */
export function glassHouse(b: MeshBuilder, poly: readonly P2[], y0: number, hWall: number, hGlass: number, flare: number, wall: SurfaceSpec, glass: SurfaceSpec, frame: SurfaceSpec, near = true): P2[] {
  prism(b, poly, y0, hWall, wall, null, null, 50);
  const top = inflate(poly, flare);
  const y1 = y0 + hWall;
  const y2 = y1 + hGlass;
  const n = poly.length;
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  const e = new THREE.Vector3();
  const f = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ne = edgeNormal(poly, i, sign);
    a.set(poly[i].x, y1, poly[i].z);
    c.set(poly[j].x, y1, poly[j].z);
    d.set(top[j].x, y2, top[j].z);
    e.set(top[i].x, y2, top[i].z);
    f.set(ne.x, flare / Math.max(hGlass, 1e-3), ne.z).normalize();
    b.quadFacing(a, c, d, e, f, glass);
    if (near) b.tube(new THREE.Vector3(poly[i].x, y1, poly[i].z), new THREE.Vector3(top[i].x, y2, top[i].z), 0.06, 4, frame);
  }
  if (near) {
    // Sill and header rails.
    band(b, poly, y1 - 0.08, 0.1, frame, 0.03);
  }
  return top;
}
