import type { Mat, MeshBuilder } from '../mesh-builder';
import { ShapeUtils, Vector2 } from 'three';
import { edgeNormal, triangulate, type V2, type V3 } from '../geom';

/**
 * Planar polygon given counter-clockwise as seen from its front side (fan triangulated, so convex only).
 * `uv` is a flat [u0, v0, u1, v1, ...] list; the normal is computed with Newell's method.
 */
export function face(mb: MeshBuilder, pts: readonly V3[], uv: readonly number[], m: Mat, ao: number | readonly number[] = 1): void {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) {
    return;
  }
  nx /= l;
  ny /= l;
  nz /= l;
  const base = mb.vertexCount;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = typeof ao === 'number' ? ao : ao[i];
    mb.vertex(p[0], p[1], p[2], nx, ny, nz, uv[i * 2], uv[i * 2 + 1], m, a);
  }
  for (let i = 1; i < n - 1; i++) {
    mb.tri(base, base + i, base + i + 1);
  }
}

/**
 * Vertical wall quad along a→b. The face points to the right of a→b in map view (outward for CCW rings).
 * Bottom/top heights may differ per end (terrain following). u runs from u0 along a→b, v = y - vRef.
 */
export function wallSeg(
  mb: MeshBuilder,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  ya0: number,
  ya1: number,
  yb0: number,
  yb1: number,
  u0: number,
  vRef: number,
  m: Mat,
  aoBottom = 1,
  aoTop = 1,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) {
    return 0;
  }
  const nx = -dz / len;
  const nz = dx / len;
  const i0 = mb.vertex(ax, ya0, az, nx, 0, nz, u0, ya0 - vRef, m, aoBottom);
  const i1 = mb.vertex(bx, yb0, bz, nx, 0, nz, u0 + len, yb0 - vRef, m, aoBottom);
  const i2 = mb.vertex(bx, yb1, bz, nx, 0, nz, u0 + len, yb1 - vRef, m, aoTop);
  const i3 = mb.vertex(ax, ya1, az, nx, 0, nz, u0, ya1 - vRef, m, aoTop);
  mb.quad(i0, i1, i2, i3);
  return len;
}

/** Horizontal polygon (any simple ring) facing up (or down), uv = world xz. */
export function flatPoly(mb: MeshBuilder, ring: readonly V2[], y: number | readonly number[], m: Mat, down = false, ao = 1): void {
  if (ring.length < 3) {
    return;
  }
  const tris = triangulate(ring);
  const base = mb.vertexCount;
  const ny = down ? -1 : 1;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const yy = typeof y === 'number' ? y : y[i];
    mb.vertex(p[0], yy, p[1], 0, ny, 0, p[0], -p[1], m, ao);
  }
  for (let i = 0; i < tris.length; i += 3) {
    const a = ring[tris[i]];
    const b = ring[tris[i + 1]];
    const c = ring[tris[i + 2]];
    // Counter-clockwise seen from above (front face toward +y) <=> negative cross product in (x, z).
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const upward = cross < 0;
    if (upward !== down) {
      mb.tri(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
    } else {
      mb.tri(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
    }
  }
}

export interface PrismOptions {
  /** Emit the top cap (default true). */
  cap?: boolean;
  capMat?: Mat;
  /** v reference for the walls (default y0 of each vertex -> v from the base). */
  vRef?: number;
  aoBottom?: number;
  aoTop?: number;
  /** Start value of u (so neighbouring prisms can continue a pattern). */
  u0?: number;
}

/** Vertical extrusion of a CCW ring between y0 and y1 (numbers or per-vertex arrays). */
export function prism(mb: MeshBuilder, ring: readonly V2[], y0: number | readonly number[], y1: number | readonly number[], m: Mat, opt: PrismOptions = {}): void {
  const n = ring.length;
  let u = opt.u0 ?? 0;
  const yAt = (y: number | readonly number[], i: number): number => (typeof y === 'number' ? y : y[i]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = ring[i];
    const b = ring[j];
    const vRef = opt.vRef ?? Math.min(yAt(y0, i), yAt(y0, j));
    u += wallSeg(mb, a[0], a[1], b[0], b[1], yAt(y0, i), yAt(y1, i), yAt(y0, j), yAt(y1, j), u, vRef, m, opt.aoBottom ?? 1, opt.aoTop ?? 1);
  }
  if (opt.cap !== false) {
    flatPoly(mb, ring, y1, opt.capMat ?? m);
  }
}

/** Oriented box. `yaw` rotates the local x axis (length) toward +z by -yaw like Object3D.rotation.y. */
export function box(
  mb: MeshBuilder,
  cx: number,
  y0: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  yaw: number,
  m: Mat,
  opt: { bottom?: boolean; top?: boolean; topMat?: Mat; aoBottom?: number; vRef?: number } = {},
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const hx = sx / 2;
  const hz = sz / 2;
  const corner = (lx: number, lz: number): V2 => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  const ring: V2[] = [corner(-hx, hz), corner(hx, hz), corner(hx, -hz), corner(-hx, -hz)];
  // Ensure CCW in map view.
  const area = (ring[1][0] - ring[0][0]) * -(ring[2][1] - ring[0][1]) - -(ring[1][1] - ring[0][1]) * (ring[2][0] - ring[0][0]);
  const r = area < 0 ? ring.reverse() : ring;
  prism(mb, r, y0, y0 + sy, m, { cap: opt.top !== false, capMat: opt.topMat, aoBottom: opt.aoBottom ?? 1, vRef: opt.vRef });
  if (opt.bottom) {
    flatPoly(mb, r, y0, m, true);
  }
}

export interface LatheOptions {
  /** Number of radial segments. */
  seg: number;
  /** Faceted (polygonal) instead of smooth. */
  flat?: boolean;
  /** Start angle (radians). */
  phase?: number;
  /** Reference radius for u (default: max radius), so u = angle * uRadius. */
  uRadius?: number;
  /** Split normals where the profile turns by more than this angle (radians, default 0.6). */
  crease?: number;
  ao?: readonly number[];
}

/**
 * Surface of revolution around the vertical axis through (cx, cz). `profile` lists [radius, y] from bottom to top.
 * u = angle * uRadius, v = arc length along the profile.
 */
export function lathe(mb: MeshBuilder, cx: number, cz: number, profile: readonly [number, number][], m: Mat, opt: LatheOptions): void {
  const seg = Math.max(3, opt.seg);
  const phase = opt.phase ?? 0;
  let uR = opt.uRadius ?? 0;
  if (!uR) {
    for (const p of profile) {
      uR = Math.max(uR, p[0]);
    }
  }
  const crease = opt.crease ?? 0.6;
  // Segment normals in the profile plane (radial, up).
  const segN: [number, number][] = [];
  const segLen: number[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const dr = profile[i + 1][0] - profile[i][0];
    const dy = profile[i + 1][1] - profile[i][1];
    const l = Math.hypot(dr, dy) || 1;
    segN.push([dy / l, -dr / l]);
    segLen.push(l);
  }
  if (opt.flat) {
    let v = 0;
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, y0] = profile[i];
      const [r1, y1] = profile[i + 1];
      const ao0 = opt.ao ? opt.ao[i] : 1;
      const ao1 = opt.ao ? opt.ao[i + 1] : 1;
      for (let k = 0; k < seg; k++) {
        const a0 = phase + (k / seg) * Math.PI * 2;
        const a1 = phase + ((k + 1) / seg) * Math.PI * 2;
        const p00: V3 = [cx + Math.sin(a0) * r0, y0, cz + Math.cos(a0) * r0];
        const p10: V3 = [cx + Math.sin(a1) * r0, y0, cz + Math.cos(a1) * r0];
        const p11: V3 = [cx + Math.sin(a1) * r1, y1, cz + Math.cos(a1) * r1];
        const p01: V3 = [cx + Math.sin(a0) * r1, y1, cz + Math.cos(a0) * r1];
        const u0 = (k / seg) * Math.PI * 2 * uR;
        const u1 = ((k + 1) / seg) * Math.PI * 2 * uR;
        if (r1 < 1e-5) {
          face(mb, [p00, p10, p01], [u0, v, u1, v, (u0 + u1) / 2, v + segLen[i]], m, [ao0, ao0, ao1]);
        } else if (r0 < 1e-5) {
          face(mb, [p00, p11, p01], [(u0 + u1) / 2, v, u1, v + segLen[i], u0, v + segLen[i]], m, [ao0, ao1, ao1]);
        } else {
          face(mb, [p00, p10, p11, p01], [u0, v, u1, v, u1, v + segLen[i], u0, v + segLen[i]], m, [ao0, ao0, ao1, ao1]);
        }
      }
      v += segLen[i];
    }
    return;
  }
  // Smooth: build rings of vertices, duplicating at creases.
  let v = 0;
  let prevRing = -1;
  for (let i = 0; i < profile.length; i++) {
    const [r, y] = profile[i];
    const nIn = i > 0 ? segN[i - 1] : null;
    const nOut = i < segN.length ? segN[i] : null;
    const ao = opt.ao ? opt.ao[i] : 1;
    const emitRing = (nr: number, ny: number): number => {
      const base = mb.vertexCount;
      for (let k = 0; k <= seg; k++) {
        const a = phase + (k / seg) * Math.PI * 2;
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        mb.vertex(cx + sa * r, y, cz + ca * r, sa * nr, ny, ca * nr, (k / seg) * Math.PI * 2 * uR, v, m, ao);
      }
      return base;
    };
    let ringIn = -1;
    let ringOut = -1;
    if (nIn && nOut) {
      const dot = nIn[0] * nOut[0] + nIn[1] * nOut[1];
      if (Math.acos(Math.min(1, Math.max(-1, dot))) > crease) {
        ringIn = emitRing(nIn[0], nIn[1]);
        ringOut = emitRing(nOut[0], nOut[1]);
      } else {
        const nr = nIn[0] + nOut[0];
        const ny = nIn[1] + nOut[1];
        const l = Math.hypot(nr, ny) || 1;
        ringIn = ringOut = emitRing(nr / l, ny / l);
      }
    } else {
      const nn = (nIn ?? nOut)!;
      ringIn = ringOut = emitRing(nn[0], nn[1]);
    }
    if (prevRing >= 0) {
      for (let k = 0; k < seg; k++) {
        // Profile goes up; ring index k increases with angle (counter-clockwise seen from above is -angle in xz...).
        mb.quad(prevRing + k, prevRing + k + 1, ringIn + k + 1, ringIn + k);
      }
    }
    prevRing = ringOut;
    if (i < segLen.length) {
      v += segLen[i];
    }
  }
}

/** Regular polygon ring (CCW in map view) of `n` sides around (cx, cz). */
export function regularRing(cx: number, cz: number, r: number, n: number, phase = 0): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    // Decreasing angle in (x, z) with z south = counter-clockwise in map view.
    const a = phase - (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

/** Straight thick wall between two points (both faces + ends + top), heights per end. */
export function slab(
  mb: MeshBuilder,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  thick: number,
  ya0: number,
  ya1: number,
  yb0: number,
  yb1: number,
  m: Mat,
  opt: { top?: Mat | null; ends?: boolean; u0?: number; vRef?: number } = {},
): void {
  const [nx, nz] = edgeNormal([ax, az], [bx, bz]);
  const h = thick / 2;
  const a1: V2 = [ax + nx * h, az + nz * h];
  const b1: V2 = [bx + nx * h, bz + nz * h];
  const a2: V2 = [ax - nx * h, az - nz * h];
  const b2: V2 = [bx - nx * h, bz - nz * h];
  const u0 = opt.u0 ?? 0;
  const vRef = opt.vRef ?? 0;
  const len = wallSeg(mb, a1[0], a1[1], b1[0], b1[1], ya0, ya1, yb0, yb1, u0, vRef, m);
  wallSeg(mb, b2[0], b2[1], a2[0], a2[1], yb0, yb1, ya0, ya1, u0, vRef, m);
  if (opt.ends !== false) {
    wallSeg(mb, a2[0], a2[1], a1[0], a1[1], ya0, ya1, ya0, ya1, u0 - thick, vRef, m);
    wallSeg(mb, b1[0], b1[1], b2[0], b2[1], yb0, yb1, yb0, yb1, u0 + len, vRef, m);
  }
  if (opt.top !== null) {
    const tm = opt.top ?? m;
    face(mb, [[a1[0], ya1, a1[1]], [b1[0], yb1, b1[1]], [b2[0], yb1, b2[1]], [a2[0], ya1, a2[1]]], [u0, 0, u0 + len, 0, u0 + len, thick, u0, thick], tm);
  }
}

/** Upward-facing horizontal polygon with holes (courtyards). */
export function flatPolyHoles(mb: MeshBuilder, outer: readonly V2[], holes: readonly (readonly V2[])[], y: number, m: Mat): void {
  const contour = outer.map((p) => new Vector2(p[0], p[1]));
  const hs = holes.map((h) => h.map((p) => new Vector2(p[0], p[1])));
  const faces = ShapeUtils.triangulateShape(contour, hs);
  const all: V2[] = [...outer, ...holes.flat()];
  const base = mb.vertexCount;
  for (const p of all) {
    mb.vertex(p[0], y, p[1], 0, 1, 0, p[0], -p[1], m, 1);
  }
  for (const f of faces) {
    const a = all[f[0]];
    const b = all[f[1]];
    const c = all[f[2]];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross < 0) {
      mb.tri(base + f[0], base + f[1], base + f[2]);
    } else {
      mb.tri(base + f[0], base + f[2], base + f[1]);
    }
  }
}
