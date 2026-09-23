import type { Mat, MeshBuilder } from '../mesh-builder';
import { edgeNormal, type V2, type V3 } from '../geom';
import { box, face, lathe, prism, regularRing, slab } from './basic';

export interface DomeSpec {
  r: number;
  /** Rise of the shell (default 0.9 r: Ottoman domes are slightly depressed). */
  rise?: number;
  /** 0 = round, 1 = clearly pointed crown. */
  pointed?: number;
  mat: Mat;
  /** Drum below the shell. */
  drum?: { h: number; sides: number; mat: Mat; r?: number } | null;
  /** Gilded alem finial height (m), 0 for none. */
  alem?: number;
  alemMat?: Mat;
  seg?: number;
}

/** Dome (optional drum + shell + finial) standing at y0. Returns the crown height (without finial). */
export function dome(mb: MeshBuilder, cx: number, cz: number, y0: number, spec: DomeSpec, lod: number): number {
  let y = y0;
  const seg = spec.seg ?? (lod === 0 ? 24 : 12);
  if (spec.drum && spec.drum.h > 0) {
    const dr = spec.drum.r ?? spec.r * 1.04;
    prism(mb, regularRing(cx, cz, dr / Math.cos(Math.PI / spec.drum.sides), spec.drum.sides, Math.PI / spec.drum.sides), y, y + spec.drum.h, spec.drum.mat, {
      cap: true,
      capMat: spec.mat,
    });
    y += spec.drum.h;
  }
  const rise = spec.rise ?? spec.r * 0.9;
  const pointed = spec.pointed ?? 0.15;
  const rings = lod === 0 ? 9 : 5;
  const prof: [number, number][] = [[spec.r * 1.02, y - 0.05]];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const th = t * Math.PI * 0.5;
    const rr = spec.r * Math.cos(th) * (1 - pointed * 0.12 * Math.sin(th * 2));
    const yy = y + rise * Math.sin(th) + pointed * spec.r * 0.18 * t ** 5;
    prof.push([i === rings ? 0 : rr, yy]);
  }
  lathe(mb, cx, cz, prof, spec.mat, { seg, crease: 0.9, uRadius: spec.r });
  const crown = prof[prof.length - 1][1];
  if (spec.alem && spec.alem > 0 && lod === 0) {
    alem(mb, cx, cz, crown - 0.05, spec.alem, spec.alemMat ?? spec.mat);
  }
  return crown;
}

/** Ottoman crescent finial (alem): stem, stacked spheres and a crescent. */
export function alem(mb: MeshBuilder, cx: number, cz: number, y0: number, h: number, m: Mat): void {
  const k = h;
  const prof: [number, number][] = [
    [0.05 * k, 0],
    [0.05 * k, 0.18 * k],
    [0.13 * k, 0.24 * k],
    [0.14 * k, 0.32 * k],
    [0.1 * k, 0.4 * k],
    [0.035 * k, 0.44 * k],
    [0.035 * k, 0.55 * k],
    [0.09 * k, 0.6 * k],
    [0.09 * k, 0.66 * k],
    [0.03 * k, 0.7 * k],
    [0, 0.72 * k],
  ];
  lathe(mb, cx, cz, prof, m, { seg: 8, crease: 1.2 });
  // Crescent: a thin arc of small boxes facing south (qibla-ish), opening upward.
  const cr = 0.16 * k;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.85 + (i / 6) * Math.PI * 1.7;
    const x = cx + Math.sin(a) * cr;
    const y = y0 + 0.86 * k - Math.cos(a) * cr;
    box(mb, x, y - 0.025 * k, cz, 0.06 * k, 0.05 * k, 0.03 * k, 0, m);
  }
}

/** Tall tapered octagonal chimney (Topkapı kitchens) with a conical cap. Returns the top. */
export function chimney(mb: MeshBuilder, cx: number, cz: number, y0: number, h: number, r: number, m: Mat, capMat: Mat, lod: number): number {
  const seg = lod === 0 ? 8 : 6;
  lathe(
    mb,
    cx,
    cz,
    [
      [r, y0],
      [r * 0.62, y0 + h * 0.86],
      [r * 0.72, y0 + h * 0.88],
      [r * 0.72, y0 + h * 0.92],
    ],
    m,
    { seg, flat: true, crease: 0.3 },
  );
  lathe(
    mb,
    cx,
    cz,
    [
      [r * 0.8, y0 + h * 0.92],
      [0, y0 + h],
    ],
    capMat,
    { seg, flat: true },
  );
  return y0 + h;
}

/**
 * Arched opening painted as a dark inset polygon on a wall face. a→b is the opening width along the wall base
 * (face on the right-hand side), y0 = sill, spring = springing height, archRise = height of the arch above springing.
 */
export function archVoid(mb: MeshBuilder, a: V2, b: V2, y0: number, spring: number, archRise: number, m: Mat, offset = 0.04, pointed = false): void {
  const [nx, nz] = edgeNormal(a, b);
  const ox = nx * offset;
  const oz = nz * offset;
  const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) / (w || 1);
  const dz = (b[1] - a[1]) / (w || 1);
  const pts: V3[] = [];
  const uv: number[] = [];
  pts.push([a[0] + ox, y0, a[1] + oz], [b[0] + ox, y0, b[1] + oz]);
  uv.push(0, 0, w, 0);
  const steps = 8;
  const k = archRise / (w * Math.sin(Math.PI / 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let lx: number;
    let ly: number;
    if (pointed) {
      // Equilateral pointed arch: two arcs of radius w centred on the opposite springing points.
      if (t <= 0.5) {
        const phi = (t / 0.5) * (Math.PI / 3);
        lx = w * Math.cos(phi);
        ly = w * Math.sin(phi) * k;
      } else {
        const phi = Math.PI * (2 / 3) + ((t - 0.5) / 0.5) * (Math.PI / 3);
        lx = w + w * Math.cos(phi);
        ly = w * Math.sin(phi) * k;
      }
    } else {
      const ang = t * Math.PI;
      lx = w / 2 + (w / 2) * Math.cos(ang);
      ly = archRise * Math.sin(ang);
    }
    pts.push([a[0] + dx * lx + ox, spring + ly, a[1] + dz * lx + oz]);
    uv.push(lx, spring + ly - y0);
  }
  face(mb, pts, uv, m, 0.6);
}

/** Row of columns between a and b (inclusive ends) with an entablature beam. */
export function colonnade(
  mb: MeshBuilder,
  a: V2,
  b: V2,
  y0: number,
  colH: number,
  count: number,
  r: number,
  colMat: Mat,
  beamMat: Mat,
  lod: number,
  beamH = 0.6,
): void {
  if (lod === 0) {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[1] + (b[1] - a[1]) * t;
      lathe(
        mb,
        x,
        z,
        [
          [r * 1.35, y0],
          [r * 1.35, y0 + 0.35],
          [r, y0 + 0.45],
          [r * 0.88, y0 + colH - 0.5],
          [r * 1.3, y0 + colH - 0.1],
          [r * 1.3, y0 + colH],
        ],
        colMat,
        { seg: 10, crease: 0.5 },
      );
    }
  }
  slab(mb, a[0], a[1], b[0], b[1], r * 2.4, y0 + colH, y0 + colH + beamH, y0 + colH, y0 + colH + beamH, beamMat);
}

/** Balustrade band (balusters drawn by the shader) with a coping. */
export function balustrade(mb: MeshBuilder, a: V2, b: V2, y0: number, h: number, m: Mat, copingMat: Mat): void {
  slab(mb, a[0], a[1], b[0], b[1], 0.32, y0, y0 + h, y0, y0 + h, m, { top: copingMat, vRef: y0 });
}

/** Cast-iron lamp post with a lit globe. */
export function lampPost(mb: MeshBuilder, x: number, z: number, g: number, h: number, iron: Mat, lamp: Mat): void {
  lathe(
    mb,
    x,
    z,
    [
      [0.18, g],
      [0.14, g + 0.6],
      [0.07, g + 0.8],
      [0.055, g + h - 0.5],
      [0.1, g + h - 0.4],
    ],
    iron,
    { seg: 6, crease: 0.5 },
  );
  lathe(
    mb,
    x,
    z,
    [
      [0.06, g + h - 0.42],
      [0.22, g + h - 0.2],
      [0.24, g + h],
      [0.2, g + h + 0.18],
      [0.0, g + h + 0.3],
    ],
    lamp,
    { seg: 8, crease: 1.2 },
  );
}

/** Egyptian obelisk: tapered square shaft + pyramidion. u/v in metres on each face. Returns the tip height. */
export function obelisk(mb: MeshBuilder, cx: number, cz: number, y0: number, h: number, base: number, top: number, yaw: number, m: Mat): number {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const P = (lx: number, lz: number, y: number): V3 => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
  const b = base / 2;
  const t = top / 2;
  const yt = y0 + h;
  const corners = [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ];
  const pyr = top * 0.9;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    const pts: V3[] = [P(ax * b, az * b, y0), P(bx * b, bz * b, y0), P(bx * t, bz * t, yt), P(ax * t, az * t, yt)];
    const q = orient(pts, cx, cz);
    face(mb, q, [0, 0, base, 0, base - (base - top) / 2, h, (base - top) / 2, h], m);
    const tri: V3[] = [P(ax * t, az * t, yt), P(bx * t, bz * t, yt), P(0, 0, yt + pyr)];
    face(mb, orient(tri, cx, cz), [0, h, top, h, top / 2, h + pyr], m);
  }
  return yt + pyr;
}

function orient(pts: V3[], cx: number, cz: number): V3[] {
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
  let mx = 0;
  let mz = 0;
  for (const p of pts) {
    mx += p[0];
    mz += p[2];
  }
  mx = mx / pts.length - cx;
  mz = mz / pts.length - cz;
  return nx * mx + nz * mz >= 0 ? pts : pts.slice().reverse();
}
