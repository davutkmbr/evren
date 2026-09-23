import type { Mat, MeshBuilder } from '../mesh-builder';
import { centroid, edgeNormal, obb, offsetRing, signedArea, type V2, type V3 } from '../geom';
import { face, flatPoly, wallSeg } from './basic';

export interface EaveOptions {
  /** Eave projection beyond the wall line (m). */
  overhang: number;
  /** Fascia (eave board) height (m). */
  fascia?: number;
  /** Material of the soffit (underside) and fascia (default: roof material). */
  soffitMat?: Mat;
}

/** Eave: soffit band from the wall line out to the eave line, plus the fascia. Returns the eave ring. */
export function eaves(mb: MeshBuilder, ring: readonly V2[], y: number, roofMat: Mat, opt: EaveOptions): V2[] {
  if (opt.overhang <= 0.01) {
    return ring.slice();
  }
  const eave = offsetRing(ring, opt.overhang);
  const sm = opt.soffitMat ?? roofMat;
  const n = ring.length;
  const fascia = opt.fascia ?? 0.22;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ri = ring[i];
    const rj = ring[j];
    const ei = eave[i];
    const ej = eave[j];
    face(mb, [[ri[0], y, ri[1]], [rj[0], y, rj[1]], [ej[0], y, ej[1]], [ei[0], y, ei[1]]], [0, 0, 1, 0, 1, 1, 0, 1], sm, 0.55);
    wallSeg(mb, ei[0], ei[1], ej[0], ej[1], y - fascia, y, y - fascia, y, 0, y - fascia, sm, 0.8, 1);
  }
  return eave;
}

function slopeFace(mb: MeshBuilder, pts: V3[], e0: V2, dir: V2, inward: V2, cosPitch: number, m: Mat): void {
  const uv: number[] = [];
  for (const p of pts) {
    const dx = p[0] - e0[0];
    const dz = p[2] - e0[1];
    uv.push(dx * dir[0] + dz * dir[1], (dx * inward[0] + dz * inward[1]) / Math.max(cosPitch, 0.05));
  }
  face(mb, pts, uv, m);
}

export interface InsetStep {
  /** Horizontal inset of this band (m). */
  inset: number;
  /** Rise of this band (m). */
  rise: number;
}

/**
 * Generic hipped roof for any ring: concentric inset bands (pavilion / mansard), flat cap on the last ring.
 * Returns the top height.
 */
export function insetRoof(mb: MeshBuilder, eave: readonly V2[], y: number, steps: readonly InsetStep[], m: Mat, capMat?: Mat): number {
  let outer = eave.slice();
  let yy = y;
  for (const st of steps) {
    const inner = offsetRing(outer, -st.inset);
    const cosP = st.inset / Math.hypot(st.inset, st.rise);
    const n = outer.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = outer[i];
      const b = outer[j];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dir: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const nrm = edgeNormal(a, b);
      const inward: V2 = [-nrm[0], -nrm[1]];
      slopeFace(mb, [[a[0], yy, a[1]], [b[0], yy, b[1]], [inner[j][0], yy + st.rise, inner[j][1]], [inner[i][0], yy + st.rise, inner[i][1]]], a, dir, inward, cosP, m);
    }
    outer = inner;
    yy += st.rise;
  }
  if (Math.abs(signedArea(outer)) > 0.5) {
    flatPoly(mb, outer, yy, capMat ?? m);
  }
  return yy;
}

/** True when the ring is (close to) a rectangle. */
export function isRectLike(ring: readonly V2[]): boolean {
  const b = obb(ring);
  const area = Math.abs(signedArea(ring));
  return area > 0.9 * b.len * b.wid;
}

export interface HipRoofOptions extends EaveOptions {
  pitchDeg: number;
  /** Cap for rings that are not rectangles: max inset before the flat top (m). */
  maxInset?: number;
}

/**
 * Hipped roof. Rectangular plans get a true hip roof with a ridge; other plans a pavilion roof with a flat top.
 * Returns the ridge height.
 */
export function hipRoof(mb: MeshBuilder, ring: readonly V2[], y: number, m: Mat, opt: HipRoofOptions): number {
  const eave = eaves(mb, ring, y, m, opt);
  const tanP = Math.tan((opt.pitchDeg * Math.PI) / 180);
  if (ring.length === 4 && isRectLike(ring)) {
    const b = obb(eave);
    const ax: V2 = [Math.cos(b.angle), Math.sin(b.angle)];
    const hw = b.wid / 2;
    const hl = b.len / 2;
    const rise = hw * tanP;
    const ridge = Math.max(hl - hw, 0);
    const c: V2 = [b.cx, b.cz];
    const side: V2 = [-ax[1], ax[0]];
    const P = (l: number, s: number): V2 => [c[0] + ax[0] * l + side[0] * s, c[1] + ax[1] * l + side[1] * s];
    // Corners in CCW map order.
    let corners: V2[] = [P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)];
    if (signedArea(corners) < 0) {
      corners = [corners[0], corners[3], corners[2], corners[1]];
    }
    const r0 = P(-ridge, 0);
    const r1 = P(ridge, 0);
    const yr = y + rise;
    const cosP = hw / Math.hypot(hw, rise);
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const bb = corners[(i + 1) % 4];
      const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]) || 1;
      const dir: V2 = [(bb[0] - a[0]) / len, (bb[1] - a[1]) / len];
      const nrm = edgeNormal(a, bb);
      const inward: V2 = [-nrm[0], -nrm[1]];
      // Ridge end nearest to each eave corner.
      const near = (p: V2): V2 => ((p[0] - r0[0]) ** 2 + (p[1] - r0[1]) ** 2 < (p[0] - r1[0]) ** 2 + (p[1] - r1[1]) ** 2 ? r0 : r1);
      const ra = near(a);
      const rb = near(bb);
      if (ra === rb) {
        slopeFace(mb, [[a[0], y, a[1]], [bb[0], y, bb[1]], [ra[0], yr, ra[1]]], a, dir, inward, cosP, m);
      } else {
        slopeFace(mb, [[a[0], y, a[1]], [bb[0], y, bb[1]], [rb[0], yr, rb[1]], [ra[0], yr, ra[1]]], a, dir, inward, cosP, m);
      }
    }
    return yr;
  }
  const b = obb(ring);
  const inset = Math.min(opt.maxInset ?? 6, b.wid * 0.42);
  return insetRoof(mb, eave, y, [{ inset, rise: inset * tanP }], m);
}

/** Pyramid roof over a convex ring (towers, pavilions). Returns the apex height. */
export function pyramidRoof(mb: MeshBuilder, ring: readonly V2[], y: number, apexRise: number, m: Mat, opt: EaveOptions = { overhang: 0 }): number {
  const eave = eaves(mb, ring, y, m, opt);
  const c = centroid(eave);
  const n = eave.length;
  for (let i = 0; i < n; i++) {
    const a = eave[i];
    const b = eave[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dir: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const nrm = edgeNormal(a, b);
    const inward: V2 = [-nrm[0], -nrm[1]];
    const d = Math.abs((c[0] - a[0]) * nrm[0] + (c[1] - a[1]) * nrm[1]);
    slopeFace(mb, [[a[0], y, a[1]], [b[0], y, b[1]], [c[0], y + apexRise, c[1]]], a, dir, inward, d / Math.hypot(d, apexRise), m);
  }
  return y + apexRise;
}

/** Gabled roof over a rectangle-like ring: ridge along the long axis, gable triangles in `wallMat`. */
export function gableRoof(mb: MeshBuilder, ring: readonly V2[], y: number, pitchDeg: number, m: Mat, wallMat: Mat, overhang = 0.4): number {
  const b = obb(ring);
  const ax: V2 = [Math.cos(b.angle), Math.sin(b.angle)];
  const side: V2 = [-ax[1], ax[0]];
  const hw = b.wid / 2 + overhang;
  const hl = b.len / 2 + overhang * 0.5;
  const rise = (b.wid / 2) * Math.tan((pitchDeg * Math.PI) / 180);
  const P = (l: number, s: number, yy: number): V3 => [b.cx + ax[0] * l + side[0] * s, yy, b.cz + ax[1] * l + side[1] * s];
  const yr = y + rise;
  const ye = y - overhang * Math.tan((pitchDeg * Math.PI) / 180);
  const slope = Math.hypot(hw, rise + (y - ye));
  // Two slopes; pick vertex order so that the normals point up.
  const s1: V3[] = [P(-hl, hw, ye), P(hl, hw, ye), P(hl, 0, yr), P(-hl, 0, yr)];
  const s2: V3[] = [P(hl, -hw, ye), P(-hl, -hw, ye), P(-hl, 0, yr), P(hl, 0, yr)];
  for (const s of [s1, s2]) {
    const pts = upward(s);
    const uv: number[] = [];
    for (const p of pts) {
      const dx = p[0] - b.cx;
      const dz = p[2] - b.cz;
      const l = dx * ax[0] + dz * ax[1];
      const sd = Math.abs(dx * side[0] + dz * side[1]);
      uv.push(l + hl, ((hw - sd) / hw) * slope);
    }
    face(mb, pts, uv, m);
  }
  // Gable walls (flush with the wall line).
  const g1: V3[] = [P(-b.len / 2, -b.wid / 2, y), P(-b.len / 2, b.wid / 2, y), P(-b.len / 2, 0, yr)];
  const g2: V3[] = [P(b.len / 2, b.wid / 2, y), P(b.len / 2, -b.wid / 2, y), P(b.len / 2, 0, yr)];
  for (const g of [g1, g2]) {
    const pts = outwardTri(g, [b.cx, b.cz]);
    face(mb, pts, [0, 0, b.wid, 0, b.wid / 2, rise], wallMat);
  }
  return yr;
}

function upward(pts: V3[]): V3[] {
  const a = pts[0];
  const b = pts[1];
  const c = pts[2];
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  return ny >= 0 ? pts : pts.slice().reverse();
}

function outwardTri(pts: V3[], center: V2): V3[] {
  const a = pts[0];
  const b = pts[1];
  const c = pts[2];
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const nz = ux * vy - uy * vx;
  const mx = (a[0] + b[0] + c[0]) / 3 - center[0];
  const mz = (a[2] + b[2] + c[2]) / 3 - center[1];
  return nx * mx + nz * mz >= 0 ? pts : [a, c, b];
}
