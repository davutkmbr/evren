/**
 * Masonry walls with real depth for the hand-made towers (Galata, Kız Kulesi): wall bands pierced by recessed
 * openings (reveals into the wall thickness, glazing or a door at the back), dressed-stone surrounds proud of the
 * face, sills, string courses, pilasters, quoins and corbels. A wall is described by a `WallMap` from wall
 * coordinates (s = metres along the face, y = height, d = depth into the wall) to world space, so the same code
 * serves round shafts and flat facades.
 */
import * as THREE from 'three';
import type { MeshBuilder, SurfaceState } from '../../build/mesh-builder';

export interface WallMap {
  /** Length of the face along s. */
  len: number;
  /** Closed ring (s wraps around: 0 == len). */
  closed: boolean;
  /** World point of wall coordinate (s, y) at depth d (d > 0 into the wall, d < 0 proud of the face). */
  point(s: number, y: number, d: number, out?: THREE.Vector3): THREE.Vector3;
  /** Outward horizontal normal of the face at s. */
  normal(s: number, out?: THREE.Vector3): THREE.Vector3;
  /** Unit horizontal direction of increasing s. */
  tangent(s: number, out?: THREE.Vector3): THREE.Vector3;
  /** Base columns a smooth face needs (curvature tessellation); straight faces need none. */
  columns: number;
}

/** Cylinder face of radius r around (cx, cz); s = 0 at azimuth `phase` (radians from +X toward +Z). */
export function ringMap(cx: number, cz: number, r: number, phase = 0, columns = 48): WallMap {
  const len = Math.PI * 2 * r;
  return {
    len,
    closed: true,
    columns,
    point(s, y, d, out = new THREE.Vector3()) {
      const a = phase + s / r;
      return out.set(cx + Math.cos(a) * (r - d), y, cz + Math.sin(a) * (r - d));
    },
    normal(s, out = new THREE.Vector3()) {
      const a = phase + s / r;
      return out.set(Math.cos(a), 0, Math.sin(a));
    },
    tangent(s, out = new THREE.Vector3()) {
      const a = phase + s / r;
      return out.set(-Math.sin(a), 0, Math.cos(a));
    },
  };
}

/** Straight face from (ax, az) to (bx, bz); the outward normal is the tangent turned by -90° (to the right). */
export function lineMap(ax: number, az: number, bx: number, bz: number): WallMap {
  const len = Math.hypot(bx - ax, bz - az);
  const tx = (bx - ax) / len;
  const tz = (bz - az) / len;
  // right-hand normal (outward when the polygon winds with the interior on the left)
  const nx = tz;
  const nz = -tx;
  return {
    len,
    closed: false,
    columns: 1,
    point(s, y, d, out = new THREE.Vector3()) {
      return out.set(ax + tx * s - nx * d, y, az + tz * s - nz * d);
    },
    normal(_s, out = new THREE.Vector3()) {
      return out.set(nx, 0, nz);
    },
    tangent(_s, out = new THREE.Vector3()) {
      return out.set(tx, 0, tz);
    },
  };
}

/**
 * Faces of a convex footprint ring (x, z) wound so each face's right-hand normal points out (the ring is re-wound
 * counter-clockwise seen from above when needed).
 */
export function polygonMaps(ring: ReadonlyArray<readonly [number, number]>): WallMap[] {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    area += x0 * z1 - x1 * z0;
  }
  // The right-hand normal (tz, -tx) points away from the interior when the shoelace sum x0 z1 - x1 z0 is positive.
  const pts = area > 0 ? ring : [...ring].reverse();
  return pts.map(([x0, z0], i) => {
    const [x1, z1] = pts[(i + 1) % pts.length];
    return lineMap(x0, z0, x1, z1);
  });
}

/** 'round' = oculus of diameter w (its sill is the bottom of the circle, h is ignored). */
export type OpeningShape = 'rect' | 'arch' | 'pointed' | 'segmental' | 'round';

export interface Opening {
  /** Centre along the face. */
  s: number;
  sill: number;
  /** Total height to the apex. */
  h: number;
  w: number;
  shape: OpeningShape;
  /** Depth of the reveal (wall thickness to the glazing). */
  depth: number;
  /** Surface at the back (glazing, door leaf); null leaves the opening dark and open (the reveal ends there). */
  back: SurfaceState | null;
  /** Width of a dressed surround proud of the face (0 = none). */
  frame?: number;
  /** Projecting sill ledge (m out from the face, 0 = none). */
  sillOut?: number;
  /** Keystone at the apex of arched openings. */
  keystone?: boolean;
}

export interface WallOptions {
  wall: SurfaceState;
  /** Reveal surface (default: the wall, slightly darkened). */
  reveal?: SurfaceState;
  /** Surround / sill / keystone surface (default: the reveal). */
  trim?: SurfaceState;
  /** Arch tessellation per opening. */
  archSeg?: number;
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();

/** Darker variant of a surface (in-reveal shade: the structure shader has no baked AO). */
export function shade(s: SurfaceState, k: number): SurfaceState {
  return { ...s, color: [s.color[0] * k, s.color[1] * k, s.color[2] * k] };
}

function spring(o: Opening): number {
  const hw = o.w / 2;
  if (o.shape === 'round') {
    return o.sill + hw;
  }
  if (o.shape === 'rect') {
    return o.sill + o.h;
  }
  if (o.shape === 'segmental') {
    return o.sill + o.h - hw * 0.35;
  }
  return o.sill + o.h - (o.shape === 'pointed' ? hw * 1.2 : hw);
}

/** Height of the opening's head above coordinate s (inside [s - w/2, s + w/2]). */
function topAt(o: Opening, s: number): number {
  const hw = o.w / 2;
  const x = Math.min(Math.abs(s - o.s), hw);
  const y1 = spring(o);
  if (o.shape === 'rect') {
    return y1;
  }
  if (o.shape === 'arch' || o.shape === 'round') {
    return y1 + Math.sqrt(Math.max(hw * hw - x * x, 0));
  }
  const rise = o.sill + o.h - y1;
  if (o.shape === 'segmental') {
    const R = (hw * hw + rise * rise) / (2 * rise);
    return y1 + rise - R + Math.sqrt(Math.max(R * R - x * x, 0));
  }
  // two-centred pointed arch
  const R = (hw * hw + rise * rise) / (2 * hw);
  const dx = x + R - hw;
  return y1 + Math.sqrt(Math.max(R * R - dx * dx, 0));
}

/** Apex height. */
function headOf(o: Opening): number {
  return o.shape === 'round' ? o.sill + o.w : o.sill + o.h;
}

/** Lower edge of the opening above coordinate s (the sill, or the lower half of an oculus). */
function bottomAt(o: Opening, s: number): number {
  if (o.shape !== 'round') {
    return o.sill;
  }
  const hw = o.w / 2;
  const x = Math.min(Math.abs(s - o.s), hw);
  return o.sill + hw - Math.sqrt(Math.max(hw * hw - x * x, 0));
}

function archXs(o: Opening, seg: number): number[] {
  if (o.shape === 'rect') {
    return [];
  }
  const xs: number[] = [];
  for (let i = 1; i < seg; i++) {
    xs.push(o.s - (o.w / 2) * Math.cos((Math.PI * i) / seg));
  }
  return xs;
}

/** Outline (s, y) counter-clockwise seen from the front: sill right -> up -> head -> down left. */
function outline(o: Opening, seg: number, grow = 0): Array<[number, number]> {
  const hw = o.w / 2 + grow;
  if (o.shape === 'round') {
    // full circle from the left point, down through the bottom, up over the top
    const cy = o.sill + o.w / 2;
    const ring: Array<[number, number]> = [];
    for (let k = 0; k < seg * 2; k++) {
      const a = Math.PI + (k * Math.PI) / seg;
      ring.push([o.s + hw * Math.cos(a), cy + hw * Math.sin(a)]);
    }
    return ring;
  }
  const g: Opening = { ...o, w: hw * 2, sill: o.sill - grow, h: o.h + grow * 2 };
  const pts: Array<[number, number]> = [
    [o.s - hw, g.sill],
    [o.s + hw, g.sill],
    [o.s + hw, spring(g)],
  ];
  if (o.shape !== 'rect') {
    for (let i = 1; i < seg; i++) {
      const s = o.s + hw * Math.cos((Math.PI * i) / seg);
      pts.push([s, topAt(g, s)]);
    }
  }
  pts.push([o.s - hw, spring(g)]);
  return pts;
}

/**
 * A wall band y0..y1 over s in [s0, s1] of `map`, pierced by `openings` (their centres inside the range).
 * Emits the face, the reveals and the backs; frames, sills and keystones proud of the face.
 */
export function piercedWall(mb: MeshBuilder, map: WallMap, y0: number, y1: number, openings: readonly Opening[], opt: WallOptions, s0 = 0, s1 = map.len): void {
  const seg = opt.archSeg ?? 8;
  const xsSet: number[] = [s0, s1];
  const cols = Math.max(1, Math.ceil((map.columns * (s1 - s0)) / map.len));
  for (let i = 1; i < cols; i++) {
    xsSet.push(s0 + ((s1 - s0) * i) / cols);
  }
  for (const o of openings) {
    xsSet.push(o.s - o.w / 2, o.s + o.w / 2, ...archXs(o, seg));
  }
  xsSet.sort((a, b) => a - b);
  const xs: number[] = [];
  for (const x of xsSet) {
    if (x >= s0 - 1e-6 && x <= s1 + 1e-6 && (xs.length === 0 || x - xs[xs.length - 1] > 1e-4)) {
      xs.push(Math.min(Math.max(x, s0), s1));
    }
  }
  const vBase = mb.vBase;
  mb.surface(opt.wall);
  const strip = (xa: number, xb: number, ba: number, bb: number, ta: number, tb: number): void => {
    if (ta - ba < 1e-4 && tb - bb < 1e-4) {
      return;
    }
    const na = map.normal(xa, _n);
    const a = mb.vtx(map.point(xa, ba, 0, _p), na, xa, ba - vBase);
    const d = mb.vtx(map.point(xa, Math.max(ta, ba), 0, _p), na, xa, Math.max(ta, ba) - vBase);
    const nb = map.normal(xb, _n);
    const b = mb.vtx(map.point(xb, bb, 0, _p), nb, xb, bb - vBase);
    const c = mb.vtx(map.point(xb, Math.max(tb, bb), 0, _p), nb, xb, Math.max(tb, bb) - vBase);
    mb.quad(a, b, c, d);
  };
  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i];
    const xb = xs[i + 1];
    const xm = (xa + xb) / 2;
    const cover = openings.filter((o) => xm > o.s - o.w / 2 && xm < o.s + o.w / 2 && o.sill < y1 && headOf(o) > y0).sort((p, q) => p.sill - q.sill);
    let ba = y0;
    let bb = y0;
    for (const o of cover) {
      strip(xa, xb, ba, bb, Math.max(ba, bottomAt(o, xa)), Math.max(bb, bottomAt(o, xb)));
      ba = Math.min(y1, topAt(o, xa));
      bb = Math.min(y1, topAt(o, xb));
    }
    strip(xa, xb, ba, bb, y1, y1);
  }
  for (const o of openings) {
    opening(mb, map, o, opt, seg);
  }
}

function opening(mb: MeshBuilder, map: WallMap, o: Opening, opt: WallOptions, seg: number): void {
  const reveal = opt.reveal ?? shade(opt.wall, 0.72);
  const trim = opt.trim ?? opt.wall;
  const pts = outline(o, seg);
  const n = pts.length;
  const cy = o.shape === 'round' ? spring(o) : (o.sill + spring(o)) / 2;
  // reveals: each outline edge extruded into the wall, normal toward the opening axis
  mb.surface(reveal);
  for (let i = 0; i < n; i++) {
    const [s0, ya] = pts[i];
    const [s1, yb] = pts[(i + 1) % n];
    const l = Math.hypot(s1 - s0, yb - ya);
    if (l < 1e-5) {
      continue;
    }
    const sm = (s0 + s1) / 2;
    const ym = (ya + yb) / 2;
    // 2D inward normal of the edge (toward the opening centre)
    let es = -(yb - ya) / l;
    let ey = (s1 - s0) / l;
    if (es * (o.s - sm) + ey * (cy - ym) < 0) {
      es = -es;
      ey = -ey;
    }
    const nrm = map.tangent(sm, _t).multiplyScalar(es);
    nrm.y = ey;
    nrm.normalize();
    mb.polygon([map.point(s0, ya, 0), map.point(s1, yb, 0), map.point(s1, yb, o.depth), map.point(s0, ya, o.depth)], nrm);
  }
  if (o.back) {
    mb.surface(o.back);
    mb.polygon(
      pts.map(([s, y]) => map.point(s, y, o.depth)),
      map.normal(o.s),
    );
  }
  const f = o.frame ?? 0;
  if (f > 0) {
    // surround: a band `f` wide, 6 cm proud, with its outer side faces (the sill edge is left to the ledge)
    mb.surface(trim);
    const outer = outline(o, seg, f);
    const proud = -0.07;
    const nrm = map.normal(o.s, new THREE.Vector3());
    // every edge but the sill (pts[0] -> pts[1]); an oculus is framed all round
    for (let i = o.shape === 'round' ? 0 : 1; i < n; i++) {
      const j = (i + 1) % n;
      const a = pts[i];
      const b = pts[j];
      const A = outer[i];
      const B = outer[j];
      mb.polygon([map.point(a[0], a[1], proud), map.point(b[0], b[1], proud), map.point(B[0], B[1], proud), map.point(A[0], A[1], proud)], map.normal((a[0] + b[0]) / 2, nrm));
      const es = B[0] - A[0];
      const ey = B[1] - A[1];
      const l = Math.hypot(es, ey) || 1;
      let ns = ey / l;
      let ny = -es / l;
      if (ns * ((A[0] + B[0]) / 2 - o.s) + ny * ((A[1] + B[1]) / 2 - cy) < 0) {
        ns = -ns;
        ny = -ny;
      }
      const side = map.tangent((A[0] + B[0]) / 2, _t).multiplyScalar(ns);
      side.y = ny;
      mb.polygon([map.point(A[0], A[1], 0), map.point(B[0], B[1], 0), map.point(B[0], B[1], proud), map.point(A[0], A[1], proud)], side.normalize());
      // inner lip of the surround continues the reveal to the proud face
      mb.surface(reveal);
      const inner = map.tangent((a[0] + b[0]) / 2, _t).multiplyScalar(-ns);
      inner.y = -ny;
      mb.polygon([map.point(a[0], a[1], 0), map.point(b[0], b[1], 0), map.point(b[0], b[1], proud), map.point(a[0], a[1], proud)], inner.normalize());
      mb.surface(trim);
    }
    if (o.keystone && o.shape !== 'rect') {
      const top = headOf(o);
      block(mb, map, o.s - f * 0.55, o.s + f * 0.55, top - 0.05, top + f * 1.1, -0.07, -0.16);
    }
  }
  const ledge = o.sillOut ?? 0;
  if (ledge > 0) {
    mb.surface(trim);
    const hw = o.w / 2 + f + 0.12;
    block(mb, map, o.s - hw, o.s + hw, o.sill - 0.16, o.sill, 0.02, -ledge);
  }
}

/**
 * Block proud of (or set into) the face: s in [sa, sb], y in [ya, yb], from depth dIn (usually >= 0, inside the
 * wall) out to dOut (< 0). Emits the front, top, bottom and the two ends; curved faces are faceted per column.
 */
export function block(mb: MeshBuilder, map: WallMap, sa: number, sb: number, ya: number, yb: number, dIn: number, dOut: number, topOut = dOut): void {
  const cols = Math.max(1, Math.ceil((map.columns * (sb - sa)) / map.len));
  const vBase = mb.vBase;
  for (let i = 0; i < cols; i++) {
    const s0 = sa + ((sb - sa) * i) / cols;
    const s1 = sa + ((sb - sa) * (i + 1)) / cols;
    const n0 = map.normal(s0, new THREE.Vector3());
    const n1 = map.normal(s1, new THREE.Vector3());
    // front (a batter when topOut differs from dOut)
    const a = mb.vtx(map.point(s0, ya, dOut, _p), n0, s0, ya - vBase);
    const b = mb.vtx(map.point(s1, ya, dOut, _p), n1, s1, ya - vBase);
    const c = mb.vtx(map.point(s1, yb, topOut, _p), n1, s1, yb - vBase);
    const d = mb.vtx(map.point(s0, yb, topOut, _p), n0, s0, yb - vBase);
    mb.quad(a, b, c, d);
    const up = new THREE.Vector3(0, 1, 0);
    mb.polygon([map.point(s0, yb, dIn), map.point(s1, yb, dIn), map.point(s1, yb, topOut), map.point(s0, yb, topOut)], up);
    mb.polygon([map.point(s0, ya, dIn), map.point(s1, ya, dIn), map.point(s1, ya, dOut), map.point(s0, ya, dOut)], up.clone().negate());
  }
  const endL = map.tangent(sa, new THREE.Vector3()).negate();
  const endR = map.tangent(sb, new THREE.Vector3());
  mb.polygon([map.point(sa, ya, dIn), map.point(sa, ya, dOut), map.point(sa, yb, topOut), map.point(sa, yb, dIn)], endL);
  mb.polygon([map.point(sb, ya, dIn), map.point(sb, ya, dOut), map.point(sb, yb, topOut), map.point(sb, yb, dIn)], endR);
}

/** Horizontal band (string course / plinth) along the whole face, `out` metres proud, with a chamfered top. */
export function band(mb: MeshBuilder, map: WallMap, ya: number, yb: number, out: number, s0 = 0, s1 = map.len): void {
  const cham = Math.min((yb - ya) * 0.4, out);
  block(mb, map, s0, s1, ya, yb - cham, 0.02, -out);
  // chamfer: sloped strip from the band's outer top edge back to the face
  const cols = Math.max(1, Math.ceil((map.columns * (s1 - s0)) / map.len));
  const vBase = mb.vBase;
  for (let i = 0; i < cols; i++) {
    const sa = s0 + ((s1 - s0) * i) / cols;
    const sb = s0 + ((s1 - s0) * (i + 1)) / cols;
    const n = map.normal((sa + sb) / 2, new THREE.Vector3()).multiplyScalar(cham).setY(out).normalize();
    const a = mb.vtx(map.point(sa, yb - cham, -out, _p), n, sa, yb - cham - vBase);
    const b = mb.vtx(map.point(sb, yb - cham, -out, _p), n, sb, yb - cham - vBase);
    const c = mb.vtx(map.point(sb, yb, 0.02, _q), n, sb, yb - vBase);
    const d = mb.vtx(map.point(sa, yb, 0.02, _q), n, sa, yb - vBase);
    mb.quad(a, b, c, d);
  }
}

/** Alternating long/short quoin blocks up a corner at s (the corner between this face and the next). */
export function quoins(mb: MeshBuilder, map: WallMap, sCorner: number, ya: number, yb: number, course: number, long: number, short: number, out = 0.05): void {
  const dir = sCorner <= 0.01 ? 1 : -1;
  let k = 0;
  for (let y = ya; y + course * 0.5 < yb; y += course, k++) {
    const w = k % 2 === 0 ? long : short;
    // the block runs `out` past the corner so it meets the neighbour face's quoin
    const s0 = dir > 0 ? sCorner - out : sCorner - w;
    const s1 = dir > 0 ? sCorner + w : sCorner + out;
    block(mb, map, s0, s1, y + 0.015, Math.min(yb, y + course) - 0.015, 0.02, -out);
  }
}

/**
 * Stone corbel (console) under a projecting slab: stepped profile from the face out to `out` at the top.
 * s = centre, width w, from y0 (foot at the face) up to y1.
 */
export function corbel(mb: MeshBuilder, map: WallMap, s: number, w: number, y0: number, y1: number, out: number): void {
  const h = y1 - y0;
  block(mb, map, s - w / 2, s + w / 2, y0 + h * 0.62, y1, 0.02, -out * 0.75, -out);
  block(mb, map, s - w * 0.42, s + w * 0.42, y0 + h * 0.3, y0 + h * 0.62, 0.02, -out * 0.35, -out * 0.72);
  block(mb, map, s - w * 0.34, s + w * 0.34, y0, y0 + h * 0.3, 0.02, -0.02, -out * 0.33);
}
