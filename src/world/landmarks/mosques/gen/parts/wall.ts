import type { MeshBuilder } from '../builder';
import { Mat, type LodLevel, type V3 } from '../types';

export type ArchKind = 'flat' | 'round' | 'pointed' | 'segmental';
/** What closes the back of an opening: glazing, a shallow blind niche, a door leaf, or nothing (arcade). */
export type OpeningBack = 'glass' | 'blind' | 'door' | 'open';
/** Glazing pattern hint for the shader (stored in the glass tint). */
export type Glazing = 'grille' | 'lattice' | 'clear' | 'stained';

export interface Opening {
  x0: number;
  x1: number;
  /** Sill height. */
  y0: number;
  /** Spring line (top of the straight jambs). */
  y1: number;
  arch: ArchKind;
  /** Arch rise above y1; defaults: round = half width, pointed = 1.15 half width, segmental = 0.3 half width. */
  rise?: number;
  depth: number;
  back: OpeningBack;
  glazing?: Glazing;
  /** Width of a dressed-stone frame proud of the wall (LOD0 only). */
  frame?: number;
}

const GLAZING_CODE: Record<Glazing, number> = { grille: 0.2, lattice: 0.45, clear: 0.7, stained: 0.95 };

export function archRise(o: Opening): number {
  const w = (o.x1 - o.x0) * 0.5;
  if (o.arch === 'flat') {
    return 0;
  }
  if (o.rise !== undefined) {
    return o.arch === 'round' ? w : o.rise;
  }
  return o.arch === 'round' ? w : o.arch === 'pointed' ? w * 1.15 : w * 0.3;
}

/** Intrados height above the spring line at wall coordinate x. */
export function archOffset(o: Opening, x: number): number {
  const w = (o.x1 - o.x0) * 0.5;
  const xl = Math.min(Math.abs(x - (o.x0 + o.x1) * 0.5), w);
  const h = archRise(o);
  if (h <= 0 || w <= 0) {
    return 0;
  }
  if (o.arch === 'round') {
    return Math.sqrt(Math.max(w * w - xl * xl, 0));
  }
  if (o.arch === 'segmental') {
    const R = (w * w + h * h) / (2 * h);
    return h - R + Math.sqrt(Math.max(R * R - xl * xl, 0));
  }
  const R = (w * w + h * h) / (2 * w);
  const d = xl + R - w;
  return Math.sqrt(Math.max(R * R - d * d, 0));
}

function openingTop(o: Opening, x: number): number {
  return o.y1 + archOffset(o, x);
}

/**
 * Outline of the opening, counter-clockwise seen from the front, starting bottom-right; the closing edge
 * (last -> first) is the sill, which open arches skip.
 */
function outline(o: Opening, seg: number): [number, number][] {
  const jambs = o.y1 > o.y0 + 1e-4;
  const pts: [number, number][] = [[o.x1, o.y0]];
  if (jambs) {
    pts.push([o.x1, o.y1]);
  }
  const w = (o.x1 - o.x0) * 0.5;
  const xc = (o.x0 + o.x1) * 0.5;
  if (o.arch !== 'flat') {
    for (let i = 1; i < seg; i++) {
      const x = xc + w * Math.cos(Math.PI * (i / seg));
      pts.push([x, openingTop(o, x)]);
    }
  }
  pts.push([o.x0, o.y1]);
  if (jambs) {
    pts.push([o.x0, o.y0]);
  }
  return pts;
}

function archSamples(o: Opening, seg: number): number[] {
  const xs: number[] = [];
  if (o.arch === 'flat') {
    return xs;
  }
  const w = (o.x1 - o.x0) * 0.5;
  const xc = (o.x0 + o.x1) * 0.5;
  for (let i = 1; i < seg; i++) {
    xs.push(xc + w * Math.cos(Math.PI * (i / seg)));
  }
  return xs;
}

export interface WallPanelOptions {
  lod: LodLevel;
  /** Sample spacing for curved tops (m). */
  topStep?: number;
  /** Arch tessellation (segments per arch). */
  archSeg?: number;
  /** Render the reveal faces of open arches on the back too (free-standing arcades). */
  doubleSided?: boolean;
  /** Emit reveal faces (default true). */
  reveals?: boolean;
  seed?: number;
}

/**
 * Flat wall in the local XY plane (z = 0, facing +Z) from x = 0..len, y = yb..top(x), with real recessed openings
 * (reveals + glazing/niche/door at the back) at LOD0 and flat glazing overlays at LOD1.
 */
export function wallPanel(b: MeshBuilder, len: number, yb: number, top: number | ((x: number) => number), openings: readonly Opening[], opt: WallPanelOptions): void {
  const topFn = typeof top === 'number' ? () => top : top;
  const curved = typeof top !== 'number';
  const lod = opt.lod;
  const archSeg = lod === 2 ? 3 : opt.archSeg ?? (lod === 0 ? 10 : 5);
  const cut = openings.filter((o) => lod === 0 || o.back === 'open');
  const overlay = lod === 0 ? [] : openings.filter((o) => o.back !== 'open' && (lod === 1 || o.x1 - o.x0 >= 1.8));

  const xsSet: number[] = [0, len];
  for (const o of cut) {
    xsSet.push(o.x0, o.x1, ...archSamples(o, archSeg));
  }
  if (curved) {
    const step = opt.topStep ?? (lod === 0 ? 1.5 : lod === 1 ? 3.5 : 7);
    const n = Math.max(2, Math.ceil(len / step));
    for (let i = 1; i < n; i++) {
      xsSet.push((len * i) / n);
    }
  }
  xsSet.sort((a, c) => a - c);
  const xs: number[] = [];
  for (const x of xsSet) {
    if (x >= -1e-6 && x <= len + 1e-6 && (xs.length === 0 || x - xs[xs.length - 1] > 1e-4)) {
      xs.push(Math.min(Math.max(x, 0), len));
    }
  }

  const piece = (xa: number, xb: number, ba: number, bb: number, ta: number, tb: number): void => {
    if (ta - ba < 1e-4 && tb - bb < 1e-4) {
      return;
    }
    const base = b.vCount;
    b.vertex(xa, ba, 0, 0, 0, 1, xa, ba);
    b.vertex(xb, bb, 0, 0, 0, 1, xb, bb);
    b.vertex(xb, Math.max(tb, bb), 0, 0, 0, 1, xb, Math.max(tb, bb));
    b.vertex(xa, Math.max(ta, ba), 0, 0, 0, 1, xa, Math.max(ta, ba));
    b.quadIdx(base, base + 1, base + 2, base + 3);
  };

  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i];
    const xb = xs[i + 1];
    const xm = (xa + xb) * 0.5;
    const cover = cut.filter((o) => xm > o.x0 && xm < o.x1).sort((p, q) => p.y0 - q.y0);
    let botA = yb;
    let botB = yb;
    for (const o of cover) {
      piece(xa, xb, botA, botB, Math.min(o.y0, topFn(xa)), Math.min(o.y0, topFn(xb)));
      botA = openingTop(o, xa);
      botB = openingTop(o, xb);
    }
    piece(xa, xb, botA, botB, topFn(xa), topFn(xb));
  }

  let seed = opt.seed ?? 17;
  for (const o of cut) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    if (opt.reveals === false) {
      continue;
    }
    emitOpening(b, o, archSeg, seed, lod, opt.doubleSided ?? false);
  }
  for (const o of overlay) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    if (o.back === 'blind') {
      continue;
    }
    const pts = outline(o, archSeg);
    const poly: V3[] = pts.map(([x, y]) => [x, y, 0.04]);
    b.with(backSurface(o, seed), () => b.poly(poly, (p) => [p[0] - o.x0, p[1] - o.y0]));
  }
}

function backSurface(o: Opening, seed: number): Parameters<MeshBuilder['with']>[0] {
  if (o.back === 'glass') {
    const code = GLAZING_CODE[o.glazing ?? 'lattice'];
    return { mat: Mat.Glass, color: [(seed % 1000) / 1000, code, 0], extra: seed & 0xffff, ao: 1 };
  }
  if (o.back === 'door') {
    return { mat: Mat.Dark, color: [0.28, 0.2, 0.14], ao: 0.7 };
  }
  return { mat: Mat.Carved, ao: 0.8 };
}

function emitOpening(b: MeshBuilder, o: Opening, archSeg: number, seed: number, lod: LodLevel, doubleSided: boolean): void {
  const pts = outline(o, archSeg);
  const d = o.depth;
  const open = o.back === 'open';
  const n = pts.length;
  // Reveals: walk the closed outline (open arches skip the missing sill edge).
  b.with({ ao: Math.min(b.s.ao, 0.82) }, () => {
    let u = 0;
    for (let i = 0; i < n; i++) {
      if (open && i === n - 1) {
        break;
      }
      const p = pts[i];
      const q = pts[(i + 1) % n];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l < 1e-5) {
        continue;
      }
      b.quad([p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], -d], [p[0], p[1], -d], [u, 0, u + l, 0, u + l, d, u, d]);
      if (open && doubleSided) {
        b.quad([p[0], p[1], -d], [q[0], q[1], -d], [q[0], q[1], -d - 0.001], [p[0], p[1], -d - 0.001]);
      }
      u += l;
    }
  });
  if (!open) {
    const poly: V3[] = pts.map(([x, y]) => [x, y, -d]);
    b.with(backSurface(o, seed), () => b.poly(poly, (p) => [p[0] - o.x0, p[1] - o.y0]));
  }
  if (lod === 0 && o.frame && o.frame > 0) {
    emitFrame(b, o, pts, o.frame, open);
  }
}

/** Flat dressed-stone surround 4 cm proud of the wall. */
function emitFrame(b: MeshBuilder, o: Opening, pts: [number, number][], f: number, open: boolean): void {
  const n = pts.length;
  const cx = (o.x0 + o.x1) * 0.5;
  const cy = (o.y0 + openingTop(o, cx)) * 0.5;
  const outer: [number, number][] = pts.map(([x, y], i) => {
    const p = pts[(i + n - 1) % n];
    const q = pts[(i + 1) % n];
    let nx = q[1] - p[1];
    let ny = -(q[0] - p[0]);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    if (nx * (x - cx) + ny * (y - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return [x + nx * f, y + ny * f];
  });
  const z = 0.045;
  b.with({ mat: Mat.Smooth }, () => {
    for (let i = 0; i < n; i++) {
      if (open && i === n - 1) {
        break;
      }
      const j = (i + 1) % n;
      b.quad([outer[i][0], outer[i][1], z], [outer[j][0], outer[j][1], z], [pts[j][0], pts[j][1], z], [pts[i][0], pts[i][1], z]);
    }
  });
}

export interface RowSpec {
  count: number;
  sill: number;
  /** Height of the straight part. */
  h: number;
  /** Opening width. */
  w: number;
  arch: ArchKind;
  rise?: number;
  depth?: number;
  back?: OpeningBack;
  glazing?: Glazing;
  frame?: number;
  /** Relieving blind arch above rectangular windows (classical lower window). */
  tympanum?: boolean;
}

/** Evenly distributes a row of openings along a wall of length `len` (optionally inside [margin, len - margin]). */
export function rowOpenings(len: number, row: RowSpec, margin = 0): Opening[] {
  const out: Opening[] = [];
  const span = len - margin * 2;
  if (row.count <= 0 || span <= row.w) {
    return out;
  }
  const count = Math.min(row.count, Math.floor(span / (row.w * 1.35)));
  for (let i = 0; i < count; i++) {
    const c = margin + (span * (i + 0.5)) / count;
    const o: Opening = {
      x0: c - row.w / 2,
      x1: c + row.w / 2,
      y0: row.sill,
      y1: row.sill + row.h,
      arch: row.arch,
      rise: row.rise,
      depth: row.depth ?? 0.45,
      back: row.back ?? 'glass',
      glazing: row.glazing,
      frame: row.frame,
    };
    out.push(o);
    if (row.tympanum && row.arch === 'flat') {
      const gap = 0.18;
      out.push({ x0: o.x0, x1: o.x1, y0: o.y1 + gap, y1: o.y1 + gap + 0.05, arch: 'pointed', depth: 0.12, back: 'blind' });
    }
  }
  return out;
}
