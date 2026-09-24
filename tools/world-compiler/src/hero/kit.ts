/**
 * Geometry kit of the hand-made hero buildings and interior shells: a building's local frame, façade planes with
 * arched openings, reveals, surrounds, frames, glazing bars, tile panels, hipped roofs and turned solids (domes,
 * drums, minaret shafts). Everything is emitted as real geometry through the tile's TileMesh (world metres), so the
 * compiler's UV0 / UV1 / LOD rules apply unchanged.
 *
 * Local frame (Frame): u runs along a compass heading, v 90° clockwise of it (right of u in plan), y up from a base
 * height; (u, y, v) is right-handed like (x, y, z). A Face is a vertical plane of that frame: s runs right when facing
 * it, y up, d along its outward normal (negative d goes into the wall).
 */
import * as THREE from 'three';
import type { EmitOptions, RGBA, TileMesh, Vec3 } from '../mesh';

export type V2 = [number, number];

export class Frame {
  readonly ux: number;
  readonly uz: number;
  readonly vx: number;
  readonly vz: number;

  constructor(
    readonly ox: number,
    readonly oz: number,
    readonly y0: number,
    readonly headingDeg: number,
  ) {
    const h = (headingDeg * Math.PI) / 180;
    this.ux = Math.sin(h);
    this.uz = -Math.cos(h);
    this.vx = Math.cos(h);
    this.vz = Math.sin(h);
  }

  p(u: number, y: number, v: number): Vec3 {
    return [this.ox + u * this.ux + v * this.vx, this.y0 + y, this.oz + u * this.uz + v * this.vz];
  }

  d(du: number, dy: number, dv: number): Vec3 {
    return [du * this.ux + dv * this.vx, dy, du * this.uz + dv * this.vz];
  }

  local(x: number, z: number): V2 {
    const dx = x - this.ox;
    const dz = z - this.oz;
    return [dx * this.ux + dz * this.uz, dx * this.vx + dz * this.vz];
  }

  /** Compass heading (degrees) of a local plan direction. */
  heading(du: number, dv: number): number {
    const w = this.d(du, 0, dv);
    return ((Math.atan2(w[0], -w[2]) * 180) / Math.PI + 360) % 360;
  }

  /** Yaw (radians about +Y) that turns a prop's +Z to the local plan direction (du, dv). */
  yaw(du: number, dv: number): number {
    const w = this.d(du, 0, dv);
    return Math.atan2(w[0], w[2]);
  }
}

/** A vertical plane of a frame: s right when facing it, y up, d along the outward normal. */
export class Face {
  readonly n: Vec3;
  readonly r: Vec3;

  constructor(
    readonly f: Frame,
    readonly u0: number,
    readonly v0: number,
    readonly nu: number,
    readonly nv: number,
  ) {
    this.n = f.d(nu, 0, nv);
    this.r = f.d(nv, 0, -nu);
  }

  p(s: number, y: number, d = 0): Vec3 {
    return this.f.p(this.u0 + this.nv * s + this.nu * d, y, this.v0 - this.nu * s + this.nv * d);
  }

  /** World direction of a face-local vector (ds, dy, dd). */
  dir(ds: number, dy: number, dd: number): Vec3 {
    return this.f.d(this.nv * ds + this.nu * dd, dy, -this.nu * ds + this.nv * dd);
  }

  /** The same plane moved by `d` along its normal. */
  offset(d: number): Face {
    return new Face(this.f, this.u0 + this.nu * d, this.v0 + this.nv * d, this.nu, this.nv);
  }
}

/** Face from plan point a (its left end seen from outside) to b; returns the face and its length. */
export function span(f: Frame, a: V2, b: V2): { face: Face; len: number } {
  const du = b[0] - a[0];
  const dv = b[1] - a[1];
  const len = Math.hypot(du, dv);
  const ru = du / len;
  const rv = dv / len;
  return { face: new Face(f, a[0], a[1], -rv, ru), len };
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Indexed builder for addMesh (explicit normals, winding fixed from them)                                        */
/* ------------------------------------------------------------------------------------------------------------- */

export class Builder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly idx: number[] = [];
  private uv: number[] | null = null;
  private col: RGBA[] | null = null;

  get empty(): boolean {
    return this.idx.length === 0;
  }

  v(p: Vec3, n: Vec3, uvm?: V2, c?: RGBA): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.nrm.push(n[0] / l, n[1] / l, n[2] / l);
    if (uvm) {
      if (!this.uv) {
        this.uv = new Array(i * 2).fill(0);
      }
      this.uv.push(uvm[0], uvm[1]);
    } else if (this.uv) {
      this.uv.push(0, 0);
    }
    if (c) {
      if (!this.col) {
        this.col = new Array(i).fill([1, 1, 1, 1]);
      }
      this.col.push(c);
    } else if (this.col) {
      this.col.push([1, 1, 1, 1]);
    }
    return i;
  }

  tri(a: number, b: number, c: number): void {
    const P = this.pos;
    const N = this.nrm;
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3];
    const vy = P[c * 3 + 1] - P[a * 3 + 1];
    const vz = P[c * 3 + 2] - P[a * 3 + 2];
    const gx = uy * vz - uz * vy;
    const gy = uz * vx - ux * vz;
    const gz = ux * vy - uy * vx;
    if (Math.hypot(gx, gy, gz) < 1e-10) {
      return;
    }
    const rx = N[a * 3] + N[b * 3] + N[c * 3];
    const ry = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
    const rz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (gx * rx + gy * ry + gz * rz < 0) {
      this.idx.push(a, c, b);
    } else {
      this.idx.push(a, b, c);
    }
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Flat quad from four points with one normal. */
  flatQuad(p: readonly Vec3[], n: Vec3, uvm?: readonly V2[], c?: RGBA): void {
    const ids = p.map((q, k) => this.v(q, n, uvm?.[k], c));
    this.quad(ids[0], ids[1], ids[2], ids[3]);
  }

  flush(mesh: TileMesh, m: string, lod?: number): void {
    if (this.empty) {
      return;
    }
    mesh.addMesh(m, {
      positions: this.pos,
      indices: this.idx,
      normals: this.nrm,
      ...(this.uv ? { uvm: this.uv } : {}),
      ...(this.col ? { color: this.col } : {}),
      ...(lod !== undefined ? { lod } : {}),
    });
    this.pos.length = 0;
    this.nrm.length = 0;
    this.idx.length = 0;
    this.uv = null;
    this.col = null;
  }
}

/** Builders keyed by material, flushed together (fewer, larger lightmap charts). */
export class Batch {
  private readonly b = new Map<string, Builder>();

  constructor(readonly mesh: TileMesh) {}

  of(m: string): Builder {
    let x = this.b.get(m);
    if (!x) {
      x = new Builder();
      this.b.set(m, x);
    }
    return x;
  }

  flush(lod?: number): void {
    for (const [m, x] of this.b) {
      x.flush(this.mesh, m, lod);
    }
    this.b.clear();
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Openings                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------- */

export type ArchKind = 'flat' | 'round' | 'pointed' | 'segment';

export interface Opening {
  /** Centre along the face. */
  s: number;
  w: number;
  /** Bottom (sill or threshold) and spring heights. */
  y0: number;
  ys: number;
  kind: ArchKind;
  /** Arch rise above the spring (round: w / 2; pointed: > w / 2; segment: < w / 2). */
  rise?: number;
  /** Reaches the bottom of its wall (a door): the wall is notched instead of holed. */
  door?: boolean;
}

export function riseOf(o: Opening): number {
  if (o.kind === 'flat') {
    return 0;
  }
  if (o.kind === 'round') {
    return o.w / 2;
  }
  return o.rise ?? (o.kind === 'pointed' ? o.w * 0.62 : o.w * 0.2);
}

export const topOf = (o: Opening): number => o.ys + riseOf(o);

/** Arch curve from the right spring point to the left one (both included). */
export function archCurve(o: Opening, segs = 12): V2[] {
  const r = o.w / 2;
  const sR = o.s + r;
  const sL = o.s - r;
  const h = riseOf(o);
  if (o.kind === 'flat' || h <= 1e-4) {
    return [
      [sR, o.ys],
      [sL, o.ys],
    ];
  }
  const out: V2[] = [];
  if (o.kind === 'round' || Math.abs(h - r) < 1e-4) {
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI;
      out.push([o.s + r * Math.cos(a), o.ys + r * Math.sin(a)]);
    }
    return out;
  }
  if (o.kind === 'segment' || h < r) {
    const R = (r * r + h * h) / (2 * h);
    const cy = o.ys + h - R;
    const a0 = Math.asin(Math.min(1, r / R));
    const n = Math.max(4, Math.round(segs / 2));
    for (let k = 0; k <= n; k++) {
      const a = Math.PI / 2 - a0 + (2 * a0 * k) / n;
      out.push([o.s + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    out[0] = [sR, o.ys];
    out[out.length - 1] = [sL, o.ys];
    return out;
  }
  // Pointed (two-centred): right arc centred left of the axis, left arc mirrored.
  const k = (h * h - r * r) / (2 * r);
  const R = r + k;
  const apex = Math.atan2(h, k);
  const n = Math.max(3, Math.round(segs / 2));
  for (let i = 0; i <= n; i++) {
    const a = (apex * i) / n;
    out.push([o.s - k + R * Math.cos(a), o.ys + R * Math.sin(a)]);
  }
  for (let i = n - 1; i >= 0; i--) {
    const a = (apex * i) / n;
    out.push([o.s + k - R * Math.cos(a), o.ys + R * Math.sin(a)]);
  }
  return out;
}

/** Closed outline of an opening, counter-clockwise (s right, y up), starting at the bottom left. */
export function outline(o: Opening, segs = 12): V2[] {
  const r = o.w / 2;
  return [[o.s - r, o.y0], [o.s + r, o.y0], ...archCurve(o, segs)].filter((p, k, a) => k === 0 || Math.hypot(p[0] - a[k - 1][0], p[1] - a[k - 1][1]) > 1e-5) as V2[];
}

/** The opening shrunk by t on every side (the bottom only when not a door). */
export function inset(o: Opening, t: number): Opening {
  const h = riseOf(o);
  return { ...o, w: o.w - 2 * t, y0: o.door ? o.y0 : o.y0 + t, rise: o.kind === 'round' ? undefined : Math.max(0, h - t) };
}

/** The opening grown by t on the sides and the top (surround / archivolt outline). */
export function grow(o: Opening, t: number): Opening {
  const h = riseOf(o);
  return { ...o, w: o.w + 2 * t, rise: o.kind === 'round' ? undefined : h + t };
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Planar parts                                                                                                    */
/* ------------------------------------------------------------------------------------------------------------- */

const v2 = (p: V2): THREE.Vector2 => new THREE.Vector2(p[0], p[1]);

/**
 * A wall panel of a face (rectangle s0..s1 × y0..y1 at depth d) with openings: doors notch the bottom edge, other
 * openings are holes. One chart. `back` emits it facing inward (the inner side of a wall).
 */
export function wall(mesh: TileMesh, m: string, face: Face, s0: number, s1: number, y0: number, y1: number, openings: readonly Opening[] = [], opts: { d?: number; back?: boolean; segs?: number; emit?: EmitOptions } = {}): void {
  const d = opts.d ?? 0;
  const segs = opts.segs ?? 12;
  const notches = openings.filter((o) => o.door || o.y0 <= y0 + 1e-4).sort((a, b) => a.s - b.s);
  const holes = openings.filter((o) => !(o.door || o.y0 <= y0 + 1e-4));
  const contour: V2[] = [[s0, y0]];
  for (const o of notches) {
    const ol = outline({ ...o, y0 }, segs);
    // Walk the opening backwards (left jamb up, arch, right jamb down) to notch the contour.
    const rev = [ol[0], ...ol.slice(2).reverse(), ol[1]];
    contour.push(...rev);
  }
  contour.push([s1, y0], [s1, y1], [s0, y1]);
  const holeLoops = holes.map((o) => outline(o, segs));
  shape(mesh, m, face, contour, holeLoops, d, opts.back ?? false, opts.emit);
}

/** Any planar shape of a face (contour and holes in s, y) at depth d. One chart. */
export function shape(mesh: TileMesh, m: string, face: Face, contour: readonly V2[], holes: readonly (readonly V2[])[] = [], d = 0, back = false, emit?: EmitOptions): void {
  const clean = (r: readonly V2[]): V2[] => {
    const out: V2[] = [];
    for (const p of r) {
      const q = out[out.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-5) {
        out.push(p);
      }
    }
    while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-5) {
      out.pop();
    }
    return out;
  };
  const c = clean(contour);
  const hs = holes.map(clean).filter((h) => h.length >= 3);
  if (c.length < 3) {
    return;
  }
  const tris = THREE.ShapeUtils.triangulateShape(c.map(v2), hs.map((h) => h.map(v2)));
  const pts = [...c, ...hs.flat()].map((p) => face.p(p[0], p[1], d));
  const n: Vec3 = back ? [-face.n[0], -face.n[1], -face.n[2]] : face.n;
  mesh.flatTriangles(m, pts, tris.flat(), n, emit);
}

/**
 * Side strip of a closed loop (s, y) between depths d0 and d1: normals point into the loop (reveals, soffits) or
 * out of it. Sharp corners get split normals, gentle ones (arches) are smoothed.
 */
export function loopSides(b: Builder, face: Face, loop: readonly V2[], d0: number, d1: number, into = true, skipBottom = false): void {
  const n = loop.length;
  // CCW loop: the inside is on the left of each segment.
  const segN: V2[] = [];
  for (let k = 0; k < n; k++) {
    const a = loop[k];
    const c = loop[(k + 1) % n];
    const ds = c[0] - a[0];
    const dy = c[1] - a[1];
    const l = Math.hypot(ds, dy) || 1;
    segN.push(into ? [-dy / l, ds / l] : [dy / l, -ds / l]);
  }
  const world = (nn: V2): Vec3 => face.dir(nn[0], nn[1], 0);
  for (let k = 0; k < n; k++) {
    const a = loop[k];
    const c = loop[(k + 1) % n];
    if (skipBottom && Math.abs(a[1] - c[1]) < 1e-5 && a[1] <= Math.min(...loop.map((p) => p[1])) + 1e-5) {
      continue;
    }
    const nPrev = segN[(k - 1 + n) % n];
    const nHere = segN[k];
    const nNext = segN[(k + 1) % n];
    const smooth = (x: V2, y: V2): V2 | null => (x[0] * y[0] + x[1] * y[1] > 0.85 ? [x[0] + y[0], x[1] + y[1]] : null);
    const na = smooth(nPrev, nHere) ?? nHere;
    const nc = smooth(nHere, nNext) ?? nHere;
    const i0 = b.v(face.p(a[0], a[1], d0), world(na));
    const i1 = b.v(face.p(c[0], c[1], d0), world(nc));
    const i2 = b.v(face.p(c[0], c[1], d1), world(nc));
    const i3 = b.v(face.p(a[0], a[1], d1), world(na));
    b.quad(i0, i1, i2, i3);
  }
}

/** Planar polygon of the frame at height y (u, v points), with UV0 in local metres so paving follows the building. */
export function hpoly(mesh: TileMesh, m: string, f: Frame, pts: readonly V2[], y: number, down = false, emit?: EmitOptions): void {
  if (pts.length < 3) {
    return;
  }
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(v2), []);
  mesh.flatTriangles(
    m,
    pts.map((p) => f.p(p[0], y, p[1])),
    tris.flat(),
    down ? [0, -1, 0] : [0, 1, 0],
    { ...emit, uvm: pts.map((p) => [p[0], p[1]] as [number, number]) },
  );
}

/** Axis-aligned box of the frame (u0..u1, y0..y1, v0..v1). */
export function box(b: Builder, f: Frame, u0: number, u1: number, y0: number, y1: number, v0: number, v1: number, faces = { bottom: false, top: true }): void {
  const P = (u: number, y: number, v: number): Vec3 => f.p(u, y, v);
  const nU = f.d(1, 0, 0);
  const nV = f.d(0, 0, 1);
  const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
  if (faces.top) {
    b.flatQuad([P(u0, y1, v0), P(u1, y1, v0), P(u1, y1, v1), P(u0, y1, v1)], [0, 1, 0]);
  }
  if (faces.bottom) {
    b.flatQuad([P(u0, y0, v0), P(u1, y0, v0), P(u1, y0, v1), P(u0, y0, v1)], [0, -1, 0]);
  }
  b.flatQuad([P(u1, y0, v0), P(u1, y0, v1), P(u1, y1, v1), P(u1, y1, v0)], nU);
  b.flatQuad([P(u0, y0, v0), P(u0, y0, v1), P(u0, y1, v1), P(u0, y1, v0)], neg(nU));
  b.flatQuad([P(u0, y0, v1), P(u1, y0, v1), P(u1, y1, v1), P(u0, y1, v1)], nV);
  b.flatQuad([P(u0, y0, v0), P(u1, y0, v0), P(u1, y1, v0), P(u0, y1, v0)], neg(nV));
}

/** Box in face coordinates: s0..s1, y0..y1, depth d0..d1 (d1 > d0 = further out). The back (d0) face is skipped. */
export function faceBox(b: Builder, face: Face, s0: number, s1: number, y0: number, y1: number, d0: number, d1: number, withBack = false, withBottom = true): void {
  const P = (s: number, y: number, d: number): Vec3 => face.p(s, y, d);
  const n = face.n;
  const r = face.r;
  const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
  b.flatQuad([P(s0, y0, d1), P(s1, y0, d1), P(s1, y1, d1), P(s0, y1, d1)], n);
  if (withBack) {
    b.flatQuad([P(s0, y0, d0), P(s1, y0, d0), P(s1, y1, d0), P(s0, y1, d0)], neg(n));
  }
  b.flatQuad([P(s0, y1, d0), P(s1, y1, d0), P(s1, y1, d1), P(s0, y1, d1)], [0, 1, 0]);
  if (withBottom) {
    b.flatQuad([P(s0, y0, d0), P(s1, y0, d0), P(s1, y0, d1), P(s0, y0, d1)], [0, -1, 0]);
  }
  b.flatQuad([P(s1, y0, d0), P(s1, y0, d1), P(s1, y1, d1), P(s1, y1, d0)], r);
  b.flatQuad([P(s0, y0, d0), P(s0, y0, d1), P(s0, y1, d1), P(s0, y1, d0)], neg(r));
}

/** A straight bar between two face points (s, y) with a square section `w`, from depth d0 to d0 + w. */
export function faceBar(b: Builder, face: Face, a: V2, c: V2, w: number, d0: number): void {
  const ds = c[0] - a[0];
  const dy = c[1] - a[1];
  const l = Math.hypot(ds, dy);
  if (l < 1e-5) {
    return;
  }
  const px = (-dy / l) * (w / 2);
  const py = (ds / l) * (w / 2);
  const d1 = d0 + w;
  const P = (p: V2, sgn: number, d: number): Vec3 => face.p(p[0] + px * sgn, p[1] + py * sgn, d);
  const side = face.dir(-dy / l, ds / l, 0);
  const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
  b.flatQuad([P(a, -1, d1), P(c, -1, d1), P(c, 1, d1), P(a, 1, d1)], face.n);
  b.flatQuad([P(a, 1, d0), P(c, 1, d0), P(c, 1, d1), P(a, 1, d1)], side);
  b.flatQuad([P(a, -1, d0), P(c, -1, d0), P(c, -1, d1), P(a, -1, d1)], neg(side));
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Assemblies                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------- */

export interface WindowStyle {
  /** Wall material of the reveal. */
  wall: string;
  frame: string;
  /** Pane material (glass or a door leaf); null leaves the opening open (arcades). */
  pane: string | null;
  /** Pane material of the arch head above the spring (a glazed fanlight over a door leaf). */
  fan?: string;
  /** Depth of the reveal behind the wall face. */
  reveal: number;
  /** Frame width and depth (0: no frame). */
  frameW?: number;
  /** Vertical glazing bars (count) and a transom at the spring. */
  mullions?: number;
  transom?: boolean;
  /** Radial bars in the arch head. */
  radials?: number;
  /** Projecting sill (depth, height). */
  sill?: { mat: string; depth: number; h: number };
  /** Projecting surround / archivolt (band width, projection). */
  surround?: { mat: string; w: number; d: number };
  segs?: number;
}

/**
 * The inside of an opening already cut in a wall: reveal, surround, sill, frame, glazing bars and pane (or leaf).
 * Returns nothing; everything goes through `batch` except the planar pane and frame rings.
 */
export function dressOpening(mesh: TileMesh, batch: Batch, face: Face, o: Opening, st: WindowStyle): void {
  const segs = st.segs ?? 12;
  const loop = outline(o, segs);
  const sd = st.surround?.d ?? 0;
  loopSides(batch.of(st.wall), face, loop, sd, -st.reveal, true, !!o.door);
  if (st.surround) {
    const g = grow(o, st.surround.w);
    const outer = outline(g, segs);
    horseshoe(mesh, st.surround.mat, face, g, o, sd, segs);
    const b = batch.of(st.surround.mat);
    // Outer edge of the band (from the wall to its face), open at the bottom.
    const edge = [[g.s - g.w / 2, o.y0] as V2, [g.s + g.w / 2, o.y0] as V2, ...outer.slice(2)];
    loopSides(b, face, edge, 0, sd, false, true);
  }
  if (st.sill && !o.door) {
    const b = batch.of(st.sill.mat);
    faceBox(b, face, o.s - o.w / 2 - 0.06, o.s + o.w / 2 + 0.06, o.y0 - st.sill.h, o.y0, -0.02, st.sill.depth);
  }
  if (!st.pane) {
    return;
  }
  const fw = st.frameW ?? 0;
  const paneD = -st.reveal + 0.04;
  if (fw > 0) {
    const inner = inset(o, fw);
    const fd = paneD + 0.05;
    if (o.door) {
      horseshoe(mesh, st.frame, face, o, inner, fd, segs);
    } else {
      shape(mesh, st.frame, face, loop, [outline(inner, segs)], fd);
    }
    loopSides(batch.of(st.frame), face, outline(inner, segs), fd, paneD, true, !!o.door);
    if (st.fan && riseOf(inner) > 0) {
      const x0 = inner.s - inner.w / 2;
      shape(mesh, st.pane, face, [[x0, inner.y0], [x0 + inner.w, inner.y0], [x0 + inner.w, inner.ys], [x0, inner.ys]], [], paneD);
      shape(mesh, st.fan, face, archCurve(inner, segs), [], paneD);
    } else {
      shape(mesh, st.pane, face, outline(inner, segs), [], paneD);
    }
    const bars = batch.of(st.frame);
    const bw = 0.045;
    const x0 = inner.s - inner.w / 2;
    const m = st.mullions ?? 0;
    for (let k = 1; k <= m; k++) {
      const s = x0 + (inner.w * k) / (m + 1);
      const yTop = riseOf(inner) > 0 ? archHeightAt(inner, s) : inner.ys;
      faceBar(bars, face, [s, inner.y0], [s, yTop], bw, paneD);
    }
    if (st.transom && riseOf(inner) > 0) {
      faceBar(bars, face, [x0, inner.ys], [x0 + inner.w, inner.ys], bw, paneD);
    }
    const rad = st.radials ?? 0;
    if (rad > 0 && riseOf(inner) > 0) {
      const c: V2 = [inner.s, inner.ys];
      for (let k = 1; k <= rad; k++) {
        const a = (Math.PI * k) / (rad + 1);
        const tip: V2 = [inner.s + Math.cos(a) * inner.w, inner.ys + Math.sin(a) * inner.w * 2];
        const hit = clipToArch(inner, c, tip);
        faceBar(bars, face, c, hit, bw * 0.8, paneD);
      }
    }
  } else {
    shape(mesh, st.pane, face, loop, [], paneD);
  }
}

/** Band between an outer and an inner opening sharing their bottom line (surrounds, door frames), open below. */
export function horseshoe(mesh: TileMesh, m: string, face: Face, outer: Opening, inner: Opening, d: number, segs = 12): void {
  const oc = archCurve(outer, segs);
  const ic = archCurve(inner, segs);
  const y0 = inner.y0;
  const band: V2[] = [[outer.s - outer.w / 2, y0], ...oc.slice().reverse(), [outer.s + outer.w / 2, y0], [inner.s + inner.w / 2, y0], ...ic, [inner.s - inner.w / 2, y0]];
  shape(mesh, m, face, band, [], d);
}

/** Height of an opening's arch at s (spring height outside the arch). */
export function archHeightAt(o: Opening, s: number): number {
  const c = archCurve(o, 24);
  for (let k = 0; k + 1 < c.length; k++) {
    const [s0, y0] = c[k];
    const [s1, y1] = c[k + 1];
    if ((s <= s0 && s >= s1) || (s >= s0 && s <= s1)) {
      const t = Math.abs(s1 - s0) < 1e-6 ? 0 : (s - s0) / (s1 - s0);
      return y0 + (y1 - y0) * t;
    }
  }
  return o.ys;
}

/** Point where the ray from c towards tip leaves the opening's arch. */
function clipToArch(o: Opening, c: V2, tip: V2): V2 {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const t = (lo + hi) / 2;
    const p: V2 = [c[0] + (tip[0] - c[0]) * t, c[1] + (tip[1] - c[1]) * t];
    const inside = Math.abs(p[0] - o.s) <= o.w / 2 && p[1] <= archHeightAt(o, p[0]);
    if (inside) {
      lo = t;
    } else {
      hi = t;
    }
  }
  return [c[0] + (tip[0] - c[0]) * lo, c[1] + (tip[1] - c[1]) * lo];
}

/**
 * Tile panel of cells on a face (s0..s1, y0..y1) at depth d: one quad per cell, coloured by `pattern` (COLOR_0) and
 * mapped to one texture tile each (`cell` metres), plus a thin projecting border in `border` material.
 */
export function tilePanel(mesh: TileMesh, batch: Batch, m: string, face: Face, s0: number, s1: number, y0: number, y1: number, d: number, cell: number, pattern: (i: number, j: number, ni: number, nj: number) => RGBA, border?: { mat: string; w: number; d: number }): void {
  const ni = Math.max(1, Math.round((s1 - s0) / cell));
  const nj = Math.max(1, Math.round((y1 - y0) / cell));
  const cw = (s1 - s0) / ni;
  const ch = (y1 - y0) / nj;
  const pts: Vec3[] = [];
  const tris: number[] = [];
  const uvm: [number, number][] = [];
  const col: RGBA[] = [];
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const a = pts.length;
      const sa = s0 + i * cw;
      const ya = y0 + j * ch;
      pts.push(face.p(sa, ya, d), face.p(sa + cw, ya, d), face.p(sa + cw, ya + ch, d), face.p(sa, ya + ch, d));
      const off = (i % 5) * cell;
      uvm.push([off, 0], [off + cell, 0], [off + cell, cell], [off, cell]);
      const c = pattern(i, j, ni, nj);
      col.push(c, c, c, c);
      tris.push(a, a + 1, a + 2, a, a + 2, a + 3);
    }
  }
  mesh.flatTriangles(m, pts, tris, face.n, { uvm, color: col });
  if (border) {
    const b = batch.of(border.mat);
    const w = border.w;
    faceBox(b, face, s0 - w, s1 + w, y0 - w, y0, d - 0.02, d + border.d);
    faceBox(b, face, s0 - w, s1 + w, y1, y1 + w, d - 0.02, d + border.d);
    faceBox(b, face, s0 - w, s0, y0, y1, d - 0.02, d + border.d, false, false);
    faceBox(b, face, s1, s1 + w, y0, y1, d - 0.02, d + border.d, false, false);
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Roofs and turned solids                                                                                         */
/* ------------------------------------------------------------------------------------------------------------- */

/**
 * Hipped roof over the frame rectangle u0..u1 × v0..v1 (eave line, overhang included) from eave height `y` rising
 * `rise`: four planes with UV0 in slope metres (rows parallel to the eaves), an eave soffit back to the walls
 * (wallInset) and a fascia of height `fascia`.
 */
export function hippedRoof(mesh: TileMesh, roofMat: string, trimMat: string, f: Frame, u0: number, u1: number, v0: number, v1: number, y: number, rise: number, wallInset: number, fascia = 0.18, batch?: Batch): void {
  const lu = u1 - u0;
  const lv = v1 - v0;
  const alongU = lu >= lv;
  const half = (alongU ? lv : lu) / 2;
  const ridgeY = y + rise;
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  const ridge: [V2, V2] = alongU
    ? [
        [u0 + half, cv],
        [u1 - half, cv],
      ]
    : [
        [cu, v0 + half],
        [cu, v1 - half],
      ];
  const corners: V2[] = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  const slope = Math.hypot(half, rise);
  // Each side: eave edge (two corners) and the ridge points above it.
  const sides: { a: V2; b: V2; ra: V2; rb: V2; out: V2 }[] = alongU
    ? [
        { a: corners[0], b: corners[1], ra: ridge[0], rb: ridge[1], out: [0, -1] },
        { a: corners[1], b: corners[2], ra: ridge[1], rb: ridge[1], out: [1, 0] },
        { a: corners[2], b: corners[3], ra: ridge[1], rb: ridge[0], out: [0, 1] },
        { a: corners[3], b: corners[0], ra: ridge[0], rb: ridge[0], out: [-1, 0] },
      ]
    : [
        { a: corners[0], b: corners[1], ra: ridge[0], rb: ridge[0], out: [0, -1] },
        { a: corners[1], b: corners[2], ra: ridge[0], rb: ridge[1], out: [1, 0] },
        { a: corners[2], b: corners[3], ra: ridge[1], rb: ridge[1], out: [0, 1] },
        { a: corners[3], b: corners[0], ra: ridge[1], rb: ridge[0], out: [-1, 0] },
      ];
  for (const sd of sides) {
    const nLocal: Vec3 = [sd.out[0] * rise, half, sd.out[1] * rise];
    const n = f.d(nLocal[0], nLocal[1], nLocal[2]);
    const l = Math.hypot(...n);
    const nn: Vec3 = [n[0] / l, n[1] / l, n[2] / l];
    // Slope UVs: along the eave (tangent t) and down the slope from the ridge line.
    const tu = sd.b[0] - sd.a[0];
    const tv = sd.b[1] - sd.a[1];
    const tl = Math.hypot(tu, tv);
    const uv = (p: V2, atRidge: boolean): [number, number] => [((p[0] - sd.a[0]) * tu + (p[1] - sd.a[1]) * tv) / tl, atRidge ? 0 : slope];
    const pts: Vec3[] = [f.p(sd.a[0], y, sd.a[1]), f.p(sd.b[0], y, sd.b[1])];
    const uvm: [number, number][] = [uv(sd.a, false), uv(sd.b, false)];
    if (sd.ra[0] === sd.rb[0] && sd.ra[1] === sd.rb[1]) {
      pts.push(f.p(sd.ra[0], ridgeY, sd.ra[1]));
      uvm.push(uv(sd.ra, true));
    } else {
      pts.push(f.p(sd.rb[0], ridgeY, sd.rb[1]), f.p(sd.ra[0], ridgeY, sd.ra[1]));
      uvm.push(uv(sd.rb, true), uv(sd.ra, true));
    }
    mesh.flatPolygon(roofMat, pts, nn, { uvm });
  }
  // Fascia and soffit.
  const b = batch?.of(trimMat) ?? new Builder();
  const wu0 = u0 + wallInset;
  const wu1 = u1 - wallInset;
  const wv0 = v0 + wallInset;
  const wv1 = v1 - wallInset;
  const P = (u: number, yy: number, v: number): Vec3 => f.p(u, yy, v);
  const nu = f.d(1, 0, 0);
  const nv = f.d(0, 0, 1);
  const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
  b.flatQuad([P(u0, y - fascia, v0), P(u1, y - fascia, v0), P(u1, y, v0), P(u0, y, v0)], neg(nv));
  b.flatQuad([P(u0, y - fascia, v1), P(u1, y - fascia, v1), P(u1, y, v1), P(u0, y, v1)], nv);
  b.flatQuad([P(u0, y - fascia, v0), P(u0, y - fascia, v1), P(u0, y, v1), P(u0, y, v0)], neg(nu));
  b.flatQuad([P(u1, y - fascia, v0), P(u1, y - fascia, v1), P(u1, y, v1), P(u1, y, v0)], nu);
  const sy = y - fascia;
  // Soffit ring (four trapezoids) facing down.
  const ring: [V2, V2, V2, V2][] = [
    [[u0, v0], [u1, v0], [wu1, wv0], [wu0, wv0]],
    [[u1, v0], [u1, v1], [wu1, wv1], [wu1, wv0]],
    [[u1, v1], [u0, v1], [wu0, wv1], [wu1, wv1]],
    [[u0, v1], [u0, v0], [wu0, wv0], [wu0, wv1]],
  ];
  for (const q of ring) {
    b.flatQuad(q.map((p) => P(p[0], sy, p[1])), [0, -1, 0]);
  }
  if (!batch) {
    b.flush(mesh, trimMat);
  }
}

/**
 * Surface of revolution about the frame's vertical axis at (cu, cv): `profile` is [radius, height] from bottom to
 * top; `sides` segments (8 = octagon, flat-shaded; >= 16 smooth). Open at the ends unless a radius is 0.
 */
export function lathe(b: Builder, f: Frame, cu: number, cv: number, profile: readonly V2[], sides: number, rot = 0, flat = sides <= 12): void {
  const ring = (k: number): [number, number] => {
    const a = rot + (k / sides) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  };
  for (let j = 0; j + 1 < profile.length; j++) {
    const [r0, y0] = profile[j];
    const [r1, y1] = profile[j + 1];
    const dr = r1 - r0;
    const dy = y1 - y0;
    const sl = Math.hypot(dr, dy) || 1;
    // Outward normal in the (r, y) plane: (dy, -dr).
    const nr = dy / sl;
    const ny = -dr / sl;
    for (let k = 0; k < sides; k++) {
      const [ca, sa] = ring(k);
      const [cb, sb] = ring(k + 1);
      let na: Vec3;
      let nb: Vec3;
      if (flat) {
        const [cm, sm] = [Math.cos(rot + ((k + 0.5) / sides) * Math.PI * 2), Math.sin(rot + ((k + 0.5) / sides) * Math.PI * 2)];
        na = nb = f.d(cm * nr, ny, sm * nr);
      } else {
        na = f.d(ca * nr, ny, sa * nr);
        nb = f.d(cb * nr, ny, sb * nr);
      }
      const i0 = b.v(f.p(cu + ca * r0, y0, cv + sa * r0), na);
      const i1 = b.v(f.p(cu + cb * r0, y0, cv + sb * r0), nb);
      const i2 = b.v(f.p(cu + cb * r1, y1, cv + sb * r1), nb);
      const i3 = b.v(f.p(cu + ca * r1, y1, cv + sa * r1), na);
      if (r0 < 1e-6) {
        b.tri(i0, i2, i3);
      } else if (r1 < 1e-6) {
        b.tri(i0, i1, i2);
      } else {
        b.quad(i0, i1, i2, i3);
      }
    }
  }
}

/** Dome profile (quarter ellipse, radius r, height h) from base height y, optionally pointed (ogee-less) at the top. */
export function domeProfile(r: number, h: number, y: number, steps = 8): V2[] {
  const out: V2[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * (Math.PI / 2);
    out.push([r * Math.cos(a), y + h * Math.sin(a)]);
  }
  out[out.length - 1] = [0, y + h];
  return out;
}

/** Vertical prism of the frame over a plan polygon (u, v), walls only (caps separate). */
export function prism(b: Builder, f: Frame, poly: readonly V2[], y0: number, y1: number, top = true): void {
  const n = poly.length;
  // Orientation: positive area in (u, v) means counter-clockwise when u right and v up in plan.
  let area = 0;
  for (let k = 0; k < n; k++) {
    const a = poly[k];
    const c = poly[(k + 1) % n];
    area += a[0] * c[1] - c[0] * a[1];
  }
  const sgn = area >= 0 ? 1 : -1;
  for (let k = 0; k < n; k++) {
    const a = poly[k];
    const c = poly[(k + 1) % n];
    const du = c[0] - a[0];
    const dv = c[1] - a[1];
    const l = Math.hypot(du, dv) || 1;
    // For a CCW loop in (u, v) the outside is to the right: (dv, -du).
    const nn = f.d((sgn * dv) / l, 0, (-sgn * du) / l);
    b.flatQuad([f.p(a[0], y0, a[1]), f.p(c[0], y0, c[1]), f.p(c[0], y1, c[1]), f.p(a[0], y1, a[1])], nn);
  }
  if (top) {
    const tris = THREE.ShapeUtils.triangulateShape(poly.map(v2), []);
    const ids = poly.map((p) => b.v(f.p(p[0], y1, p[1]), [0, 1, 0]));
    for (const t of tris) {
      b.tri(ids[t[0]], ids[t[1]], ids[t[2]]);
    }
  }
}

/** Regular polygon in plan (u, v) around (cu, cv). */
export function ngon(cu: number, cv: number, r: number, sides: number, rot = 0): V2[] {
  return Array.from({ length: sides }, (_, k) => {
    const a = rot + (k / sides) * Math.PI * 2;
    return [cu + Math.cos(a) * r, cv + Math.sin(a) * r] as V2;
  });
}

/** sRGB hex to linear RGBA (COLOR_0). */
export function rgba(hex: number, a = 1): RGBA {
  const ch = (s: number): number => {
    const c = ((hex >> s) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [ch(16), ch(8), ch(0), a];
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Imperfect geometry (S1 round 2): chamfered arrises, gutters and downpipes                                       */
/* ------------------------------------------------------------------------------------------------------------- */

/**
 * `faceBox` with its four front arrises chamfered by `c` (mitred at the corners): real stone and render trims have
 * 1–3 cm arrises that catch the light, razor edges read as CG. The back (d0) face is skipped.
 */
export function faceBoxC(b: Builder, face: Face, s0: number, s1: number, y0: number, y1: number, d0: number, d1: number, c = 0.02, withBottom = true): void {
  const cc = Math.min(c, (s1 - s0) / 3, (y1 - y0) / 3, (d1 - d0) / 2);
  if (cc < 0.004) {
    faceBox(b, face, s0, s1, y0, y1, d0, d1, false, withBottom);
    return;
  }
  const P = (s: number, y: number, d: number): Vec3 => face.p(s, y, d);
  const n = face.n;
  const r = face.r;
  const up: Vec3 = [0, 1, 0];
  const mix = (a: Vec3, q: Vec3): Vec3 => [a[0] + q[0], a[1] + q[1], a[2] + q[2]];
  const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
  const e = d1 - cc;
  b.flatQuad([P(s0 + cc, y0 + cc, d1), P(s1 - cc, y0 + cc, d1), P(s1 - cc, y1 - cc, d1), P(s0 + cc, y1 - cc, d1)], n);
  // Chamfer strips (mitred).
  b.flatQuad([P(s0 + cc, y1 - cc, d1), P(s1 - cc, y1 - cc, d1), P(s1, y1, e), P(s0, y1, e)], mix(n, up));
  b.flatQuad([P(s1 - cc, y0 + cc, d1), P(s1, y0, e), P(s1, y1, e), P(s1 - cc, y1 - cc, d1)], mix(n, r));
  b.flatQuad([P(s0, y0, e), P(s0 + cc, y0 + cc, d1), P(s0 + cc, y1 - cc, d1), P(s0, y1, e)], mix(n, neg(r)));
  b.flatQuad([P(s0, y0, e), P(s1, y0, e), P(s1 - cc, y0 + cc, d1), P(s0 + cc, y0 + cc, d1)], mix(n, neg(up)));
  // Top, sides and bottom back to the wall.
  b.flatQuad([P(s0, y1, d0), P(s1, y1, d0), P(s1, y1, e), P(s0, y1, e)], up);
  if (withBottom) {
    b.flatQuad([P(s0, y0, d0), P(s1, y0, d0), P(s1, y0, e), P(s0, y0, e)], neg(up));
  }
  b.flatQuad([P(s1, y0, d0), P(s1, y0, e), P(s1, y1, e), P(s1, y1, d0)], r);
  b.flatQuad([P(s0, y0, d0), P(s0, y0, e), P(s0, y1, e), P(s0, y1, d0)], neg(r));
}

/** Plan rectangle u0..u1 × v0..v1 with its corners cut by c (a box with chamfered vertical arrises, for `prism`). */
export function chamferRect(u0: number, u1: number, v0: number, v1: number, c: number): V2[] {
  return [
    [u0 + c, v0],
    [u1 - c, v0],
    [u1, v0 + c],
    [u1, v1 - c],
    [u1 - c, v1],
    [u0 + c, v1],
    [u0, v1 - c],
    [u0, v0 + c],
  ];
}

/**
 * Half-round gutter along the plan line a -> b of a frame at height y (its rim), radius r, sagging up to `sag` metres
 * between the ends and dipping a little between its brackets (every ~0.9 m); open side up, `out` = the side away
 * from the wall (+1: right of a -> b in plan).
 */
export function gutter(b: Builder, f: Frame, a: V2, c: V2, y: number, r: number, sag: number, seed = 0): void {
  const du = c[0] - a[0];
  const dv = c[1] - a[1];
  const len = Math.hypot(du, dv);
  if (len < 0.2) {
    return;
  }
  const n = Math.max(2, Math.ceil(len / 1.1));
  const tu = du / len;
  const tv = dv / len;
  // Across direction (right of a -> b in plan).
  const xu = tv;
  const xv = -tu;
  const prof: V2[] = [];
  for (let k = 0; k <= 3; k++) {
    const t = Math.PI * (k / 3);
    prof.push([-Math.cos(t) * r, -Math.sin(t) * r]);
  }
  const ring = (i: number): { pts: Vec3[]; nrm: Vec3[] } => {
    const t = i / n;
    const l = t * len;
    const dip = sag * Math.sin(Math.PI * t) + 0.004 * Math.sin((l / 0.9) * Math.PI) ** 2 + 0.003 * Math.sin(l * 2.3 + seed);
    const cu = a[0] + tu * l;
    const cv = a[1] + tv * l;
    return {
      pts: prof.map(([x, yy]) => f.p(cu + xu * x, y - dip + yy, cv + xv * x)),
      nrm: prof.map(([x, yy]) => f.d(xu * x, yy, xv * x)),
    };
  };
  let prev = ring(0);
  for (let i = 1; i <= n; i++) {
    const cur = ring(i);
    for (let k = 0; k < prof.length - 1; k++) {
      // Outside of the trough (normals outward) and inside (inward, seen from above).
      b.quad(b.v(prev.pts[k], prev.nrm[k]), b.v(cur.pts[k], cur.nrm[k]), b.v(cur.pts[k + 1], cur.nrm[k + 1]), b.v(prev.pts[k + 1], prev.nrm[k + 1]));
      const inn = (q: Vec3): Vec3 => [-q[0], -q[1], -q[2]];
      b.quad(b.v(prev.pts[k], inn(prev.nrm[k])), b.v(cur.pts[k], inn(cur.nrm[k])), b.v(cur.pts[k + 1], inn(cur.nrm[k + 1])), b.v(prev.pts[k + 1], inn(prev.nrm[k + 1])));
    }
    prev = cur;
  }
}

/**
 * Round downpipe on a face at s, `off` in front of it, from yTop down to yBottom (face heights): an octagonal pipe
 * with a swan neck out to the gutter under the eave (`neck` m) at the top, clips every ~1.8 m and a shoe at the foot.
 */
export function downpipe(b: Builder, face: Face, s: number, yTop: number, yBottom: number, off = 0.08, r = 0.045, neck = 0): void {
  const p = face.p(s, 0, off);
  const [u, v] = face.f.local(p[0], p[2]);
  lathe(b, face.f, u, v, [
    [r, yBottom + 0.1],
    [r, yTop],
  ], 8, 0, false);
  // Shoe turned out at the foot.
  const q = face.p(s, 0, off + 0.06);
  const [su, sv] = face.f.local(q[0], q[2]);
  lathe(b, face.f, su, sv, [
    [r * 1.1, yBottom],
    [r * 1.1, yBottom + 0.14],
  ], 8, 0, false);
  for (let y = yBottom + 0.9; y < yTop - 0.3; y += 1.8) {
    faceBox(b, face, s - r - 0.012, s + r + 0.012, y, y + 0.035, 0, off + r + 0.01, false, true);
  }
  if (neck > 0) {
    // Swan neck: back out under the eave to the gutter outlet.
    faceBox(b, face, s - r * 0.9, s + r * 0.9, yTop - 0.02, yTop + r * 1.6, off - r, off + neck, false, true);
  }
}

/**
 * Ridge or hip cap tiles along a roof line p0 -> p1 (world): a half-round of radius r (flattened by `flat`) with a
 * slight wave every `pitch` metres (one cap tile each), so the line is not a ruler edge.
 */
export function ridgeCap(b: Builder, p0: Vec3, p1: Vec3, r = 0.12, pitch = 0.84, flat = 0.75): void {
  const t: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const len = Math.hypot(...t);
  if (len < 0.1) {
    return;
  }
  t[0] /= len;
  t[1] /= len;
  t[2] /= len;
  // up: world up made perpendicular to the line; side = t × up.
  let up: Vec3 = [-t[0] * t[1], 1 - t[1] * t[1], -t[2] * t[1]];
  const ul = Math.hypot(...up) || 1;
  up = [up[0] / ul, up[1] / ul, up[2] / ul];
  const side: Vec3 = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
  const n = Math.max(2, Math.round(len / pitch));
  const segs = 4;
  const ring = (i: number): { p: Vec3[]; nn: Vec3[] } => {
    const l = (len * i) / n;
    const swell = 1 + 0.08 * Math.sin((i % 2) * Math.PI * 0.5);
    const c: Vec3 = [p0[0] + t[0] * l, p0[1] + t[1] * l, p0[2] + t[2] * l];
    const p: Vec3[] = [];
    const nn: Vec3[] = [];
    for (let k = 0; k <= segs; k++) {
      const a = Math.PI * (k / segs);
      const cs = Math.cos(a) * r * swell;
      const sn = Math.sin(a) * r * flat * swell;
      p.push([c[0] + side[0] * cs + up[0] * sn, c[1] + side[1] * cs + up[1] * sn, c[2] + side[2] * cs + up[2] * sn]);
      nn.push([side[0] * Math.cos(a) + up[0] * Math.sin(a), side[1] * Math.cos(a) + up[1] * Math.sin(a), side[2] * Math.cos(a) + up[2] * Math.sin(a)]);
    }
    return { p, nn };
  };
  let prev = ring(0);
  for (let i = 1; i <= n; i++) {
    const cur = ring(i);
    for (let k = 0; k < segs; k++) {
      b.quad(b.v(prev.p[k], prev.nn[k]), b.v(cur.p[k], cur.nn[k]), b.v(cur.p[k + 1], cur.nn[k + 1]), b.v(prev.p[k + 1], prev.nn[k + 1]));
    }
    prev = cur;
  }
}
