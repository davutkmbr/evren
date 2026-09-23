import type { Mat, MeshBuilder } from '../mesh-builder';
import { edgeNormal, type V2, type V3 } from '../geom';
import { box, face, flatPoly, lathe, prism, regularRing, wallSeg } from './basic';

export type GroundFn = (x: number, z: number) => number;

export interface MerlonSpec {
  /** Merlon width along the wall (m). */
  w: number;
  /** Gap (crenel) width (m). */
  gap: number;
  /** Merlon height above the parapet top (m). */
  h: number;
  /** Merlon depth across the wall (m). */
  depth: number;
  /** Pyramidal cap height (0 = flat). */
  cap?: number;
}

export interface WallSample {
  x: number;
  z: number;
  /** Arc length. */
  s: number;
  /** Unit tangent. */
  tx: number;
  tz: number;
  /** Miter scale at this sample (1 / cos(half turn)). */
  miter: number;
  /** Miter direction (unit, right side). */
  mx: number;
  mz: number;
  ground: number;
}

/** Resamples a polyline (keeping its vertices) and attaches miter frames and ground heights. */
export function samplePath(pts: readonly V2[], step: number, ground: GroundFn, closed = false): WallSample[] {
  const src = closed ? [...pts, pts[0]] : pts.slice();
  const raw: { x: number; z: number; s: number; seg: number }[] = [];
  let s = 0;
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i];
    const b = src[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) {
      continue;
    }
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      raw.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, s: s + len * t, seg: i });
    }
    s += len;
  }
  const last = src[src.length - 1];
  raw.push({ x: last[0], z: last[1], s, seg: src.length - 2 });
  const segDir = (i: number): V2 => {
    const a = src[i];
    const b = src[i + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const out: WallSample[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    let d0 = segDir(Math.min(r.seg, src.length - 2));
    let d1 = d0;
    const atVertex = i > 0 && raw[i - 1].seg !== r.seg;
    if (atVertex) {
      d0 = segDir(raw[i - 1].seg);
    }
    if (i === raw.length - 1 && closed) {
      d1 = segDir(0);
    }
    if (i === 0 && closed) {
      d0 = segDir(src.length - 2);
    }
    // Right-hand normals (outward for CCW rings): (-dz, dx).
    const n0: V2 = [-d0[1], d0[0]];
    const n1: V2 = [-d1[1], d1[0]];
    let mx = n0[0] + n1[0];
    let mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cosHalf = Math.max(mx * n1[0] + mz * n1[1], 0.4);
    const tx = d0[0] + d1[0];
    const tz = d0[1] + d1[1];
    const tl = Math.hypot(tx, tz) || 1;
    out.push({ x: r.x, z: r.z, s: r.s, tx: tx / tl, tz: tz / tl, miter: 1 / cosHalf, mx, mz, ground: ground(r.x, r.z) });
  }
  return out;
}

export interface CurtainSpec {
  thick: number;
  /** Top height above ground at a sample (m). Absolute tops can be expressed by subtracting sample.ground. */
  height: (smp: WallSample) => number;
  /** Depth of the foundation below ground (m). */
  sink: number;
  outer: Mat;
  inner: Mat;
  top: Mat;
  /** Crenellations on the outer (right-hand) edge. */
  merlons?: MerlonSpec | null;
  /** Parapet (breastwork) on the outer edge, height above the walkway (m). */
  parapet?: number;
  /** Parapet thickness (m). */
  parapetThick?: number;
  /** Skip merlons where this returns false (ruined stretches, gates). */
  merlonMask?: (smp: WallSample) => boolean;
  /** Emit end caps for open paths. */
  caps?: boolean;
  /** v reference: 'world' (horizontal masonry courses) or 'ground' (v from the local ground). */
  vMode?: 'world' | 'ground';
}

/**
 * Terrain-following curtain wall along samples (right-hand side = outer face). The top is the walkway; an optional
 * parapet and merlons run along the outer edge.
 */
export function curtainWall(mb: MeshBuilder, smp: readonly WallSample[], spec: CurtainSpec, lod: number): void {
  const n = smp.length;
  if (n < 2) {
    return;
  }
  const half = spec.thick / 2;
  const para = lod === 0 ? spec.parapet ?? 0 : 0;
  const pThick = Math.min(spec.parapetThick ?? 0.7, spec.thick * 0.5);
  const R: V2[] = [];
  const L: V2[] = [];
  const P: V2[] = [];
  const yb: number[] = [];
  const yt: number[] = [];
  for (const p of smp) {
    const k = half * p.miter;
    R.push([p.x + p.mx * k, p.z + p.mz * k]);
    L.push([p.x - p.mx * k, p.z - p.mz * k]);
    const kp = (half - pThick) * p.miter;
    P.push([p.x + p.mx * kp, p.z + p.mz * kp]);
    yb.push(p.ground - spec.sink);
    yt.push(p.ground + spec.height(p));
  }
  const vRef = (i: number): number => (spec.vMode === 'ground' ? smp[i].ground : 0);
  for (let i = 0; i < n - 1; i++) {
    const j = i + 1;
    const u0 = smp[i].s;
    const vr = spec.vMode === 'ground' ? Math.min(vRef(i), vRef(j)) : 0;
    // Outer face (right), includes the parapet height.
    wallSeg(mb, R[i][0], R[i][1], R[j][0], R[j][1], yb[i], yt[i] + para, yb[j], yt[j] + para, u0, vr, spec.outer);
    // Inner face (left): travel backwards so the face points left.
    wallSeg(mb, L[j][0], L[j][1], L[i][0], L[i][1], yb[j], yt[j], yb[i], yt[i], u0, vr, spec.inner);
    const u1 = smp[j].s;
    const th = spec.thick;
    if (para > 0) {
      // Walkway from the inner edge to the parapet, parapet inner face and parapet top.
      face(mb, [[L[i][0], yt[i], L[i][1]], [P[i][0], yt[i], P[i][1]], [P[j][0], yt[j], P[j][1]], [L[j][0], yt[j], L[j][1]]], [u0, 0, u0, th, u1, th, u1, 0], spec.top, 0.85);
      wallSeg(mb, P[j][0], P[j][1], P[i][0], P[i][1], yt[j], yt[j] + para, yt[i], yt[i] + para, u0, vr, spec.inner, 0.7, 1);
      face(mb, [[P[i][0], yt[i] + para, P[i][1]], [R[i][0], yt[i] + para, R[i][1]], [R[j][0], yt[j] + para, R[j][1]], [P[j][0], yt[j] + para, P[j][1]]], [u0, 0, u0, 1, u1, 1, u1, 0], spec.top);
    } else {
      face(mb, [[L[i][0], yt[i], L[i][1]], [R[i][0], yt[i], R[i][1]], [R[j][0], yt[j], R[j][1]], [L[j][0], yt[j], L[j][1]]], [u0, 0, u0, th, u1, th, u1, 0], spec.top);
    }
  }
  if (spec.caps !== false) {
    const a = 0;
    const b = n - 1;
    wallSeg(mb, L[a][0], L[a][1], R[a][0], R[a][1], yb[a], yt[a] + para, yb[a], yt[a] + para, 0, vRef(a), spec.outer);
    wallSeg(mb, R[b][0], R[b][1], L[b][0], L[b][1], yb[b], yt[b] + para, yb[b], yt[b] + para, 0, vRef(b), spec.outer);
  }
  if (spec.merlons && lod === 0) {
    merlonRow(mb, smp, spec, yt, para);
  }
}

function merlonRow(mb: MeshBuilder, smp: readonly WallSample[], spec: CurtainSpec, yt: readonly number[], para: number): void {
  const m = spec.merlons!;
  const pitch = m.w + m.gap;
  const total = smp[smp.length - 1].s;
  const count = Math.floor(total / pitch);
  const start = (total - count * pitch) / 2 + m.gap / 2;
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const sMid = start + k * pitch + m.w / 2;
    while (seg < smp.length - 2 && smp[seg + 1].s < sMid) {
      seg++;
    }
    const a = smp[seg];
    const b = smp[seg + 1];
    const t = b.s > a.s ? (sMid - a.s) / (b.s - a.s) : 0;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const probe: WallSample = { ...a, x, z, s: sMid };
    if (spec.merlonMask && !spec.merlonMask(probe)) {
      continue;
    }
    const y = yt[seg] + (yt[seg + 1] - yt[seg]) * t + para;
    const nx = -a.tz;
    const nz = a.tx;
    const off = spec.thick / 2 - m.depth / 2;
    const cx = x + nx * off;
    const cz = z + nz * off;
    const yaw = -Math.atan2(a.tz, a.tx);
    box(mb, cx, y - 0.05, cz, m.w, m.h + 0.05, m.depth, yaw, spec.outer, { topMat: spec.top });
  }
}

export interface RoundTowerSpec {
  r: number;
  /** Height above the ground at the centre (m) to the top of the parapet. */
  h: number;
  seg: number;
  mat: Mat;
  topMat: Mat;
  /** Base batter: extra radius at the foot (m). */
  batter?: number;
  merlons?: MerlonSpec | null;
  /** Conical roof: rise above the parapet top (m) and eave overhang. */
  cone?: { rise: number; overhang: number; mat: Mat; flare?: number } | null;
  /** Faceted polygon instead of a round tower. */
  flat?: boolean;
  phase?: number;
  sink?: number;
  /** Horizontal string course (cornice) near the top. */
  corbel?: boolean;
}

/** Round (or polygonal) tower on the ground at (cx, cz): shaft, parapet, walkway, merlons, optional cone. Returns top y. */
export function roundTower(mb: MeshBuilder, cx: number, cz: number, g: number, spec: RoundTowerSpec, lod: number): number {
  const seg = lod === 0 ? spec.seg : Math.max(8, Math.round(spec.seg / 2));
  const sink = spec.sink ?? 3;
  const bat = spec.batter ?? 0;
  const top = g + spec.h;
  const flat = spec.flat ?? false;
  const prof: [number, number][] = [
    [spec.r + bat, g - sink],
    [spec.r + bat, g + 0.2],
    [spec.r, g + Math.min(spec.h * 0.3, 6)],
    [spec.r, top - (spec.corbel ? 2.2 : 0)],
  ];
  if (spec.corbel) {
    prof.push([spec.r + 0.35, top - 1.9], [spec.r + 0.35, top]);
  }
  lathe(mb, cx, cz, prof, spec.mat, { seg, flat, phase: spec.phase ?? 0, crease: 0.35, uRadius: spec.r });
  const rimR = spec.r + (spec.corbel ? 0.35 : 0);
  if (spec.cone) {
    const c = spec.cone;
    const rr = rimR + c.overhang;
    const flare = c.flare ?? 0;
    const conePts: [number, number][] = [
      [rimR - 0.01, top],
      [rr, top - c.overhang * 0.35],
    ];
    if (flare > 0) {
      conePts.push([rr * (1 - flare * 0.45), top + c.rise * 0.18]);
    }
    conePts.push([0.0, top + c.rise]);
    lathe(mb, cx, cz, conePts, c.mat, { seg, flat, phase: spec.phase ?? 0, crease: 0.9, uRadius: rr });
    return top + c.rise;
  }
  if (lod > 0) {
    flatPoly(mb, regularRing(cx, cz, rimR, seg, spec.phase ?? 0), top, spec.topMat);
    return top;
  }
  // Parapet ring with walkway 1.3 m below the rim.
  const inner = Math.max(rimR - 0.9, 0.5);
  const walk = top - 1.3;
  lathe(mb, cx, cz, [[inner, top], [inner, walk]], spec.mat, { seg, flat, phase: spec.phase ?? 0, uRadius: spec.r });
  const ringO = regularRing(cx, cz, rimR, seg, spec.phase ?? 0);
  const ringI = regularRing(cx, cz, inner, seg, spec.phase ?? 0);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    face(mb, [[ringO[i][0], top, ringO[i][1]], [ringO[j][0], top, ringO[j][1]], [ringI[j][0], top, ringI[j][1]], [ringI[i][0], top, ringI[i][1]]], [0, 0, 1, 0, 1, 0.9, 0, 0.9], spec.topMat);
  }
  flatPoly(mb, ringI, walk, spec.topMat, false, 0.8);
  if (spec.merlons) {
    const m = spec.merlons;
    const circ = Math.PI * 2 * rimR;
    const count = Math.max(4, Math.floor(circ / (m.w + m.gap)));
    for (let k = 0; k < count; k++) {
      const a = ((k + 0.5) / count) * Math.PI * 2;
      const rr = rimR - m.depth / 2;
      box(mb, cx + Math.sin(a) * rr, top - 0.05, cz + Math.cos(a) * rr, m.w, m.h + 0.05, m.depth, a, spec.mat, { topMat: spec.topMat });
    }
  }
  return top + (spec.merlons ? spec.merlons.h : 0);
}

/** Square / rectangular tower (Byzantine wall towers, gate pylons). Returns top y. */
export function squareTower(
  mb: MeshBuilder,
  cx: number,
  cz: number,
  yaw: number,
  w: number,
  d: number,
  g: number,
  h: number,
  mat: Mat,
  topMat: Mat,
  lod: number,
  merlons: MerlonSpec | null,
  sink = 3,
): number {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const corner = (lx: number, lz: number): V2 => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  let ring: V2[] = [corner(-w / 2, d / 2), corner(w / 2, d / 2), corner(w / 2, -d / 2), corner(-w / 2, -d / 2)];
  const area = (ring[1][0] - ring[0][0]) * -(ring[2][1] - ring[0][1]) + (ring[1][1] - ring[0][1]) * (ring[2][0] - ring[0][0]);
  if (area < 0) {
    ring = ring.reverse();
  }
  const top = g + h;
  prism(mb, ring, g - sink, top, mat, { cap: lod > 0 || !merlons, capMat: topMat, vRef: 0 });
  if (lod === 0 && merlons) {
    flatPoly(mb, ring, top, topMat);
    for (let i = 0; i < 4; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const count = Math.max(2, Math.floor(len / (merlons.w + merlons.gap)));
      const [nx, nz] = edgeNormal(a, b);
      const yawE = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count;
        const x = a[0] + (b[0] - a[0]) * t - nx * (merlons.depth / 2);
        const z = a[1] + (b[1] - a[1]) * t - nz * (merlons.depth / 2);
        box(mb, x, top - 0.05, z, merlons.w, merlons.h + 0.05, merlons.depth, yawE, mat, { topMat });
      }
    }
    return top + merlons.h;
  }
  return top;
}
