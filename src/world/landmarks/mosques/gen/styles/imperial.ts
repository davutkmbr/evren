import type { MeshBuilder } from '../builder';
import { arcade, courtyard } from '../parts/arcade';
import { corniceProfile, flatRoof, polyPath, rectPath } from '../parts/details';
import { leadDome, semiDome, turret, windowDrum } from '../parts/dome';
import { minaret, minaretTop, type MinaretSpec } from '../parts/minaret';
import { archRise, rowOpenings, wallPanel, type Opening, type RowSpec } from '../parts/wall';
import { colliderReach, Light, Mat, shiftColliderZ, type LocalCollider, type LodLevel, type RGB } from '../types';

export type SemiLayout = 'none' | 'axial' | 'all' | 'three';

export interface CourtSpec {
  w: number;
  d: number;
  nx: number;
  nz: number;
  h: number;
  fountain: 'hex' | 'oct' | 'none';
  porticoH?: number;
}

export interface ImperialSpec {
  style: 'imperial';
  /** sRGB stone colour. */
  stone: RGB;
  hall: { w: number; d: number; h: number };
  dome: {
    /** Outer radius. */
    r: number;
    /** Drum (window ring) height. */
    drum: number;
    windows: number;
    /** Crown rise above the springing (default 1.06 r). */
    rise?: number;
    alem?: number;
    /** Base of the drum when there are no semi-domes (top of the cubic dome base). */
    base?: number;
    buttress?: boolean;
  };
  semi: SemiLayout;
  semiBand?: number;
  semiWindows?: number;
  exedrae?: boolean;
  cornerDomes?: boolean;
  turrets?: boolean;
  /** Rows of small domes over the lateral aisles of axial plans. */
  sideDomes?: number;
  /** Tabhane wings on both sides. */
  wings?: { w: number; d: number; domes: number };
  /** Son cemaat portico when there is no courtyard. */
  portico?: { bays: number; depth: number; h: number; pitched?: boolean };
  court?: CourtSpec;
  minarets: MinaretSpec[];
  /** Exterior two-storey galleries along the long side walls. */
  galleries?: boolean;
  precinct?: { w: number; d: number; h: number; z?: number };
  turbes?: { x: number; z: number; r: number; h: number }[];
  /** Extra plain blocks (hünkar kasrı, medrese wings): x/z centre, sizes, roof domes count. */
  annexes?: { x: number; z: number; w: number; d: number; h: number; domes?: number }[];
  /** Big tympanum arches with windows on dome-base faces without semi-domes (default true). */
  tympana?: boolean;
  /** Hall faces are great tympanum arches filled with windows above this height (Mihrimah, Nuruosmaniye). */
  hallArches?: number;
  /** Fenestration: classical rows or tall baroque/empire windows. */
  windowStyle?: 'classic' | 'baroque';
  /** External buttresses on the side and qibla walls (default true; baroque halls have none). */
  buttresses?: boolean;
  /** Corner pilasters / buttress piers on the hall (m projection). */
  pilasters?: number;
  cornice?: number;
  /** Minaret stone colour override. */
  minaretStone?: RGB;
}

export interface StyleResult {
  colliders: LocalCollider[];
  radius: number;
  height: number;
}

/** Window rows appropriate for a wall of height h (classical Ottoman fenestration). */
export function classicRows(h: number, lod: LodLevel, scale = 1): RowSpec[] {
  const rows: RowSpec[] = [];
  const w0 = 1.35 * scale;
  rows.push({ count: 99, sill: 1.3 * scale, h: 2.3 * scale, w: w0, arch: 'flat', back: 'glass', glazing: 'grille', tympanum: lod === 0, depth: 0.55, frame: 0.16 * scale });
  if (h > 9) {
    rows.push({ count: 99, sill: h * 0.42, h: 2.0 * scale, w: 1.2 * scale, arch: 'pointed', back: 'glass', glazing: 'lattice', depth: 0.5, frame: 0.12 * scale });
  }
  if (h > 15) {
    rows.push({ count: 99, sill: h * 0.68, h: 1.6 * scale, w: 1.05 * scale, arch: 'round', back: 'glass', glazing: 'stained', depth: 0.45, frame: 0.1 * scale });
  }
  return rows;
}

/** Tall two-tier arched windows of Ottoman baroque / empire mosques. */
export function baroqueRows(h: number, lod: LodLevel): RowSpec[] {
  const rows: RowSpec[] = [];
  const tierH = h / 2;
  rows.push({ count: 99, sill: 1.6, h: tierH * 0.5, w: Math.min(2.6, h * 0.14), arch: 'segmental', back: 'glass', glazing: 'clear', depth: 0.6, frame: lod === 0 ? 0.28 : 0 });
  rows.push({ count: 99, sill: tierH + 0.8, h: tierH * 0.46, w: Math.min(2.6, h * 0.14), arch: 'round', back: 'glass', glazing: 'clear', depth: 0.6, frame: lod === 0 ? 0.28 : 0 });
  return rows;
}

/** Windows arranged under a great arch spanning the wall from yb (springing) to yt (crown). */
export function tympanumOpenings(len: number, yb: number, yt: number, glazing: 'stained' | 'lattice' | 'clear' = 'stained'): Opening[] {
  const ops: Opening[] = [];
  const archR = len / 2 - 0.9;
  const span = yt - yb;
  const rowsN = span > 12 ? 3 : span > 6 ? 2 : 1;
  for (let r = 0; r < rowsN; r++) {
    const y = yb + 1.2 + (r * (span - 2.5)) / rowsN;
    const halfW = Math.sqrt(Math.max(0, 1 - Math.pow((y + 2.4 - yb) / Math.max(span, 1), 2))) * archR;
    const n = Math.max(1, Math.floor((halfW * 2) / 2.3) - r);
    ops.push(...rowOpenings(len, { count: n, sill: y, h: 1.6, w: 1.05, arch: 'round', back: 'glass', glazing, depth: 0.5, frame: 0.1 }, len / 2 - halfW));
  }
  return ops;
}

/**
 * Ottoman-baroque / empire fenestration inside a great facade arch (Nuruosmaniye, Ortakoy, Dolmabahce, Nusretiye):
 * a tier of tall round-headed windows, a shorter tier above and a round-topped light near the crown.
 */
export function baroqueArchOpenings(len: number, yb: number, yt: number): Opening[] {
  const ops: Opening[] = [];
  const span = yt - yb;
  const archR = len / 2 - 1.2;
  const w = Math.min(2.5, len * 0.125);
  const widthAt = (y: number): number => {
    const t = Math.min(1, Math.max(0, (y - yb) / Math.max(span, 1)));
    return Math.sqrt(Math.max(0, 1 - t * t)) * archR * 2;
  };
  const tier = (sill: number, h: number, ww: number, maxCount: number): void => {
    const avail = widthAt(sill + h + ww * 0.5) - 0.8;
    const n = Math.min(maxCount, Math.floor(avail / (ww * 1.55)));
    if (n > 0) {
      ops.push(...rowOpenings(len, { count: n, sill, h, w: ww, arch: 'round', back: 'glass', glazing: 'clear', depth: 0.7, frame: 0.24 }, (len - n * ww * 1.55) / 2));
    }
  };
  tier(yb + 0.7, span * 0.34, w, 3);
  tier(yb + span * 0.5, span * 0.16, w * 0.8, 3);
  tier(yb + span * 0.74, span * 0.08, w * 0.9, 1);
  return ops;
}

/** Relief arch outline (dressed stone) on a wall panel in local XY, springing at yb, crown at yt. */
export function reliefArch(b: MeshBuilder, len: number, yb: number, yt: number, width = 0.45, proud = 0.08): void {
  const ar = len / 2 - 0.35;
  const y0 = Math.max(yb, yt - ar);
  const sy = (yt - y0) / ar;
  b.with({ mat: Mat.Smooth }, () => {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI * (i / n);
      const a1 = Math.PI * ((i + 1) / n);
      const p = (a: number, rr: number, z = proud): [number, number, number] => [len / 2 + rr * Math.cos(a), y0 + rr * Math.sin(a) * sy, z];
      b.quad(p(a1, ar - width), p(a0, ar - width), p(a0, ar), p(a1, ar));
      if (proud > 0.1) {
        b.quad(p(a1, ar), p(a0, ar), p(a0, ar, 0), p(a1, ar, 0));
      }
    }
  });
}

/** Openings of several rows over a wall, bays of ~bayW metres. */
export function facadeOpenings(len: number, rows: RowSpec[], bayW: number, margin: number): Opening[] {
  const count = Math.max(1, Math.floor((len - margin * 2) / bayW));
  const out: Opening[] = [];
  for (const r of rows) {
    out.push(...rowOpenings(len, { ...r, count }, margin));
  }
  return out;
}

/** Four facade panels around a rectangle x in [-w/2, w/2], z in [-d/2, d/2] with per-side openings. */
export function boxFacades(
  b: MeshBuilder,
  w: number,
  d: number,
  y0: number,
  h: number,
  lod: LodLevel,
  openingsFor: (side: 'front' | 'back' | 'left' | 'right', len: number) => Opening[],
  /** Wall-local x ranges kept free of relief (buttresses standing against the wall). */
  reliefClear?: (side: FacadeSide, len: number) => ReadonlyArray<readonly [number, number]>,
): void {
  const sides = facadeFrames(w, d);
  b.colBox(-w / 2, y0, -d / 2, w / 2, h + 0.1, d / 2);
  sides.forEach((s, i) => {
    b.at(s.x, 0, s.z, s.yaw, () => {
      const ops = openingsFor(s.side, s.len);
      wallPanel(b, s.len, y0, h, ops, { lod, seed: 101 + i * 31 });
      if (lod < 2) {
        facadeRelief(b, s.len, y0, h, ops, lod, reliefClear?.(s.side, s.len) ?? []);
      }
    });
  });
}

export type FacadeSide = 'front' | 'back' | 'left' | 'right';

/** Local frames of the four facades of a w x d rectangle: wall panels run along +X from (x, z), facing out (+Z). */
export function facadeFrames(w: number, d: number): { side: FacadeSide; x: number; z: number; yaw: number; len: number }[] {
  return [
    { side: 'front', x: -w / 2, z: d / 2, yaw: 0, len: w },
    { side: 'right', x: w / 2, z: d / 2, yaw: Math.PI / 2, len: d },
    { side: 'back', x: w / 2, z: -d / 2, yaw: Math.PI, len: w },
    { side: 'left', x: -w / 2, z: -d / 2, yaw: -Math.PI / 2, len: d },
  ];
}

export interface ButtressSpec {
  /** Centre along the wall panel (local x). */
  x: number;
  width: number;
  depth: number;
  y0: number;
  top: number;
}

/**
 * External buttress (payanda) against a wall panel in local XY (facing +Z): a pier with a sloped weathering set-off
 * halfway up where it steps back, and a sloped stone cap that dies into the wall under the cornice.
 */
export function wallButtress(b: MeshBuilder, s: ButtressSpec, lod: LodLevel): void {
  const x0 = s.x - s.width / 2;
  const x1 = s.x + s.width / 2;
  const D = s.depth;
  const D2 = D * 0.62;
  const mid = s.y0 + (s.top - s.y0) * 0.55;
  const slope = D2 * 0.9;
  // follows the steps: full pier, set-back upper pier, half-depth block under the sloped cap
  b.colBox(x0, s.y0, 0, x1, mid, D);
  b.colBox(x0, mid, 0, x1, s.top - slope * 0.5, D2);
  b.colBox(x0, s.top - slope * 0.5, 0, x1, s.top, D2 * 0.5);
  if (lod === 2) {
    b.box(x0, s.y0, 0, x1, s.top - slope, D, 'bn');
    return;
  }
  b.with({ ao: 0.92 }, () => {
    // lower pier, set-off slope, upper pier, cap slope
    b.box(x0, s.y0, 0, x1, mid, D, 'bnt');
    const setoff = (D - D2) * 0.9;
    b.with({ mat: Mat.Smooth }, () => {
      b.quad([x0, mid, D], [x1, mid, D], [x1, mid + setoff, D2], [x0, mid + setoff, D2]);
      b.poly([
        [x1, mid, D],
        [x1, mid, D2],
        [x1, mid + setoff, D2],
      ]);
      b.poly([
        [x0, mid, D2],
        [x0, mid, D],
        [x0, mid + setoff, D2],
      ]);
    });
    b.box(x0, mid, 0, x1, s.top - slope, D2, 'bnt');
    b.with({ mat: Mat.Smooth }, () => {
      const yc = s.top - slope;
      b.quad([x0, yc, D2], [x1, yc, D2], [x1, s.top, 0], [x0, s.top, 0]);
      b.poly([
        [x1, yc, D2],
        [x1, yc, 0],
        [x1, s.top, 0],
      ]);
      b.poly([
        [x0, yc, 0],
        [x0, yc, D2],
        [x0, s.top, 0],
      ]);
      if (lod === 0) {
        // plinth block at the foot
        b.box(x0 - 0.12, s.y0, 0, x1 + 0.12, s.y0 + 0.9, D + 0.12, 'bn');
      }
    });
  });
}

/**
 * Masonry relief on a wall panel in local XY (facing +Z): a moulded plinth, string courses in the clear bands
 * between window rows and shallow pilaster strips between the window bays, so a facade reads as built in courses
 * and bays instead of one flat sheet.
 */
export function facadeRelief(
  b: MeshBuilder,
  len: number,
  y0: number,
  h: number,
  ops: readonly Opening[],
  lod: LodLevel,
  clear: ReadonlyArray<readonly [number, number]> = [],
): void {
  if (h - y0 < 4 || len < 4) {
    return;
  }
  const clearOf = (o: Opening): [number, number, number, number] => {
    const f = (o.frame ?? 0) + 0.12;
    return [o.x0 - f, o.x1 + f, o.y0 - f, o.y1 + archRise(o) + f];
  };
  const boxes = ops.map(clearOf);
  const plinthTop = Math.min(y0 + 0.95, Math.min(h, ...boxes.map((q) => q[2])) - 0.05);
  b.with({ ao: 0.9 }, () => {
    if (plinthTop > y0 + 0.3) {
      b.box(-0.2, y0, 0, len + 0.2, plinthTop - 0.12, 0.2, 'bn');
      // chamfered weathering on top of the plinth
      b.quad([-0.2, plinthTop - 0.12, 0.2], [len + 0.2, plinthTop - 0.12, 0.2], [len + 0.2, plinthTop, 0.02], [-0.2, plinthTop, 0.02]);
    }
    // string courses: horizontal bands no opening crosses
    const tops = [...new Set(boxes.map((q) => Math.round(q[3] * 10) / 10))].sort((p, q) => p - q);
    for (const t of tops) {
      const next = boxes.filter((q) => q[2] > t - 0.01).reduce((m, q) => Math.min(m, q[2]), h - 0.8);
      const y = (t + next) / 2;
      if (next - t < 0.5 || y > h - 1.2 || boxes.some((q) => y + 0.14 > q[2] && y - 0.14 < q[3])) {
        continue;
      }
      b.with({ mat: Mat.Smooth }, () => b.box(-0.14, y - 0.14, 0, len + 0.14, y + 0.14, 0.16, 'n'));
    }
    if (lod > 0) {
      return;
    }
    // pilaster strips midway between neighbouring bays (never over an opening or its frame); a gap much wider than a
    // bay is where windows gave way to a buttress or a portal, and gets none
    const centres = [...new Set(ops.filter((o) => o.back !== 'door').map((o) => Math.round(((o.x0 + o.x1) / 2) * 20) / 20))].sort((p, q) => p - q);
    const gaps = centres.slice(1).map((c, i) => c - centres[i]).sort((p, q) => p - q);
    const bay = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    const pw = 0.38;
    for (let i = 0; i < centres.length - 1; i++) {
      if (centres[i + 1] - centres[i] > bay * 1.5) {
        continue;
      }
      const x = (centres[i] + centres[i + 1]) / 2;
      if (boxes.some((q) => x + pw > q[0] && x - pw < q[1]) || clear.some(([c0, c1]) => x + pw > c0 - 0.3 && x - pw < c1 + 0.3)) {
        continue;
      }
      b.with({ mat: Mat.Smooth }, () => b.box(x - pw, plinthTop, 0, x + pw, h - 0.35, 0.24, 'bn'));
    }
  });
}

function cornice(b: MeshBuilder, w: number, d: number, y: number, size: number, lod: LodLevel): void {
  if (lod === 2) {
    return;
  }
  b.sweep(
    rectPath(-w / 2, -d / 2, w / 2, d / 2),
    corniceProfile(size).map((v, k) => (k % 2 === 1 ? v + y - size * 0.5 : v)),
  );
}

/**
 * Classical Ottoman mosque (Sinan school): prayer hall with fenestrated facades, central dome on a windowed drum,
 * semi-dome cascades, exedrae, corner domes, weight towers, arcaded courtyard, minarets.
 */
export function buildImperial(b: MeshBuilder, s: ImperialSpec, lod: LodLevel): StyleResult {
  const cols: LocalCollider[] = [];
  const hall = s.hall;
  const R = s.dome.r;
  const Rs = R * 0.97;
  const archT = Math.max(0.8, R * 0.09);
  const semiBase = hall.h - 0.35;
  const semiBand = s.semiBand ?? Math.max(1.6, Rs * 0.2);
  const semiSpring = semiBase + semiBand;
  const hasSemi = s.semi !== 'none';
  const drumBase = hasSemi ? semiSpring + Rs + archT * 0.6 : s.dome.base ?? hall.h;
  const domeSpring = drumBase + s.dome.drum;
  const rise = s.dome.rise ?? R * 1.04;
  const crown = domeSpring + rise;
  const bayHalf = R * 1.08;

  const courtD = s.court?.d ?? 0;
  const porticoD = !s.court && s.portico ? s.portico.depth + 0.4 : 0;
  const zMin = -hall.d / 2;
  const zMax = hall.d / 2 + Math.max(courtD, porticoD);
  const shift = -(zMin + zMax) / 2;
  const minW = Math.max(hall.w + (s.wings ? s.wings.w * 2 : 0), s.court?.w ?? 0);

  b.set({ color: s.stone, mat: Mat.Stone, light: Light.Facade, lightBase: 0, ao: 1 });
  b.push();
  b.translate(0, 0, shift);

  // Plinth / terrace.
  b.with({ mat: Mat.Stone, ao: 0.85 }, () => {
    // LOD0 lays paving on the terrace: the stone top would lie 1 cm under it and z-fight
    b.box(-minW / 2 - 2, -9, zMin - 2, minW / 2 + 2, 0.3, zMax + 2, lod === 0 ? 'bt' : 'b');
  });
  if (lod === 0) {
    b.with({ mat: Mat.Paving, light: Light.Ground, lightBase: -2 }, () => {
      b.quad([-minW / 2 - 2, 0.3, zMax + 2], [minW / 2 + 2, 0.3, zMax + 2], [minW / 2 + 2, 0.3, zMin - 2], [-minW / 2 - 2, 0.3, zMin - 2]);
    });
  }

  // Galleries along the long sides (built first; the walls behind still get windows).
  // Buttresses on gallery sides pass through the arcade at the column nearest each dome-square pier (that column is
  // left out) and stand proud of the gallery front, as at Süleymaniye.
  const gallery = s.galleries ? { gl: hall.d * 0.86, gd: Math.min(5.5, hall.w * 0.09), bays: Math.max(3, Math.round((hall.d * 0.86) / 5.2)) } : null;
  const galleryPiers: number[] = [];
  if (gallery && s.buttresses !== false && s.windowStyle !== 'baroque') {
    const bw = gallery.gl / gallery.bays;
    for (const zt of [-bayHalf, bayHalf]) {
      const i = Math.round((zt + gallery.gl / 2) / bw);
      if (i > 0 && i < gallery.bays) {
        galleryPiers.push(-gallery.gl / 2 + i * bw);
      }
    }
  }
  if (gallery) {
    const { gl, gd, bays } = gallery;
    const bw = gl / bays;
    for (const side of [-1, 1]) {
      // arcade local x runs toward -z on the +x side and toward +z on the -x side
      const skip = galleryPiers.map((z) => Math.round((side > 0 ? gl / 2 - z : z + gl / 2) / bw));
      b.at(side * (hall.w / 2 + gd), 0, side > 0 ? gl / 2 : -gl / 2, side > 0 ? Math.PI / 2 : -Math.PI / 2, () =>
        arcade(b, { len: gl, bays, depth: gd, colH: hall.h * 0.32, roofH: hall.h * 0.47, lod, domes: false, skipColumns: skip }),
      );
    }
  }

  // Hall facades.
  const baroque = s.windowStyle === 'baroque';
  const archY = s.hallArches;
  let rows = (baroque ? baroqueRows(hall.h, lod) : classicRows(archY ?? hall.h, lod)).filter((r) => archY === undefined || r.sill + r.h + r.w < archY);
  if (baroque && archY !== undefined) {
    const w = Math.min(2.2, hall.w * 0.11);
    rows = [{ count: 99, sill: 1.3, h: Math.max(1.5, archY - 2.4 - w / 2), w, arch: 'round', back: 'glass', glazing: 'clear', depth: 0.6, frame: lod === 0 ? 0.24 : 0 }];
  }
  const portalW = Math.min(baroque ? 4.5 : 7, hall.w * 0.16);
  // External buttresses on the side and qibla walls, in line with the piers of the dome square; the windows give
  // way to them.
  const butW = Math.min(3, Math.max(1.6, R * 0.14));
  const butD = Math.min(3, Math.max(1.4, hall.h * 0.11));
  const gallerySide = (side: FacadeSide): boolean => !!gallery && (side === 'left' || side === 'right');
  const butAt = (side: FacadeSide, len: number): number[] => {
    if (s.buttresses === false || side === 'front' || baroque) {
      return [];
    }
    if (gallerySide(side)) {
      // wall-local x: the right wall runs from z = d/2 toward -z, the left one from z = -d/2 toward +z
      return galleryPiers.map((z) => (side === 'right' ? len / 2 - z : z + len / 2));
    }
    return [len / 2 - bayHalf, len / 2 + bayHalf].filter((x) => x > butW + 1.5 && x < len - butW - 1.5);
  };
  boxFacades(b, hall.w, hall.d, 0.3, hall.h, lod, (side, len) => {
    const clear = butAt(side, len);
    const ops = facadeOpenings(len, rows, baroque ? Math.max(4.2, len / 4) : 5.4, baroque ? 2.8 : 2.2).filter((o) =>
      clear.every((x) => o.x1 + (o.frame ?? 0) + 0.3 < x - butW / 2 || o.x0 - (o.frame ?? 0) - 0.3 > x + butW / 2),
    );
    if (archY !== undefined) {
      ops.push(...(baroque ? baroqueArchOpenings(len, archY, hall.h - 0.6) : tympanumOpenings(len, archY, hall.h - 0.6, 'stained')));
    }
    if (side === 'front') {
      const px0 = len / 2 - portalW / 2;
      const keep = ops.filter((o) => o.x1 < px0 - 0.6 || o.x0 > px0 + portalW + 0.6);
      keep.push({ x0: px0, x1: px0 + portalW, y0: 0.3, y1: Math.min(hall.h * 0.55, 11), arch: 'pointed', depth: 1.4, back: 'door', frame: lod === 0 ? 0.5 : 0 });
      return keep;
    }
    return ops;
  }, (side, len) => butAt(side, len).map((x) => [x - butW / 2, x + butW / 2] as const));
  if (lod < 2 && archY !== undefined) {
    for (const [x, z, yaw, len] of [
      [-hall.w / 2, hall.d / 2, 0, hall.w],
      [hall.w / 2, hall.d / 2, Math.PI / 2, hall.d],
      [hall.w / 2, -hall.d / 2, Math.PI, hall.w],
      [-hall.w / 2, -hall.d / 2, -Math.PI / 2, hall.d],
    ] as const) {
      b.at(x, 0, z, yaw, () => (baroque ? reliefArch(b, len, archY, hall.h - 0.4, 0.85, 0.2) : reliefArch(b, len, archY, hall.h - 0.4)));
    }
  }
  for (const f of facadeFrames(hall.w, hall.d)) {
    for (const x of butAt(f.side, f.len)) {
      const depth = gallerySide(f.side) ? gallery!.gd + 0.9 : butD;
      b.at(f.x, 0, f.z, f.yaw, () => wallButtress(b, { x, width: butW, depth, y0: 0.3, top: hall.h - 0.5 }, lod));
    }
  }
  if (s.pilasters && s.pilasters > 0) {
    const pw = s.pilasters;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cx = sx * (hall.w / 2 - pw * 0.6);
        const cz = sz * (hall.d / 2 - pw * 0.6);
        b.box(cx - pw, 0.3, cz - pw, cx + pw, hall.h + 0.1, cz + pw, 'b');
      }
    }
  }
  cornice(b, hall.w + (s.pilasters ?? 0) * 0.8, hall.d + (s.pilasters ?? 0) * 0.8, hall.h, s.cornice ?? Math.max(0.45, hall.h * 0.03), lod);
  // 6 cm over the wall top: the cornice's sloping top meets the wall at hall.h and z-fought with a roof 2 cm up
  flatRoof(b, -hall.w / 2, -hall.d / 2, hall.w / 2, hall.d / 2, hall.h + 0.06);

  // Cubic dome base with tympana (when not every side carries a semi-dome).
  const semiSides: { x: number; z: number; yaw: number }[] = [];
  if (s.semi === 'all' || s.semi === 'axial') {
    semiSides.push({ x: 0, z: bayHalf, yaw: 0 }, { x: 0, z: -bayHalf, yaw: Math.PI });
  }
  if (s.semi === 'three') {
    semiSides.push({ x: 0, z: -bayHalf, yaw: Math.PI });
  }
  if (s.semi === 'all' || s.semi === 'three') {
    semiSides.push({ x: bayHalf, z: 0, yaw: Math.PI / 2 }, { x: -bayHalf, z: 0, yaw: -Math.PI / 2 });
  }
  if (drumBase > hall.h + 0.8) {
    const bw = bayHalf + archT * 0.6;
    const blockSides: { x: number; z: number; yaw: number; key: string }[] = [
      { x: -bw, z: bw, yaw: 0, key: 'z+' },
      { x: bw, z: bw, yaw: Math.PI / 2, key: 'x+' },
      { x: bw, z: -bw, yaw: Math.PI, key: 'z-' },
      { x: -bw, z: -bw, yaw: -Math.PI / 2, key: 'x-' },
    ];
    const covered = new Set<string>(
      semiSides.map((q) => (Math.abs(q.z) > Math.abs(q.x) ? (q.z > 0 ? 'z+' : 'z-') : q.x > 0 ? 'x+' : 'x-')),
    );
    for (const side of blockSides) {
      const len = bw * 2;
      if (covered.has(side.key)) {
        // The face above a semi-dome: a wall pierced by a round arch that fits the semi-dome where it passes
        // through this plane, so the dome base roof rests on masonry instead of floating over the arch ring.
        const off = bw - bayHalf;
        const rho = Math.sqrt(Math.max(Rs * Rs - off * off, 1)) + 0.05;
        b.at(side.x, 0, side.z, side.yaw, () =>
          wallPanel(
            b,
            len,
            hall.h - 0.2,
            drumBase,
            [{ x0: len / 2 - rho, x1: len / 2 + rho, y0: hall.h - 0.2, y1: semiSpring, arch: 'round', depth: off, back: 'open' }],
            { lod, seed: 9 },
          ),
        );
        continue;
      }
      b.at(side.x, 0, side.z, side.yaw, () => {
        const ops: Opening[] = s.tympana !== false ? tympanumOpenings(len, hall.h, drumBase) : [];
        wallPanel(b, len, hall.h - 0.2, drumBase, ops, { lod, seed: 7 });
        if (lod === 0 && s.tympana !== false) {
          reliefArch(b, len, hall.h, drumBase);
        }
      });
    }
    flatRoof(b, -bw, -bw, bw, bw, drumBase + 0.06);
    if (lod < 2) {
      b.sweep(rectPath(-bw, -bw, bw, bw), corniceProfile(0.5).map((v, k) => (k % 2 === 1 ? v + drumBase - 0.25 : v)));
    }
    cols.push({ kind: 'box', cx: 0, cy: (hall.h + drumBase) / 2, cz: 0, hx: bw, hy: (drumBase - hall.h) / 2, hz: bw, yaw: 0 });
  }

  // Semi-domes and exedrae.
  const semiWin = s.semiWindows ?? Math.max(5, Math.round(Rs * 0.9));
  for (const q of semiSides) {
    semiDome(b, { x: q.x, z: q.z, yaw: q.yaw, r: Rs, y0: semiBase, band: semiBand, windows: semiWin, lod, arch: archT, archDepth: archT * 1.3 });
    if (s.exedrae) {
      for (const sgn of [-1, 1]) {
        const a = q.yaw + sgn * 0.95;
        const er = Rs * 0.34;
        const ex = q.x + Math.sin(a) * Rs * 0.82;
        const ez = q.z + Math.cos(a) * Rs * 0.82;
        semiDome(b, { x: ex, z: ez, yaw: a, r: er, y0: hall.h - 1.2, band: Math.max(1.2, er * 0.3), windows: 3, lod });
      }
    }
  }

  // Corner domes.
  if (s.cornerDomes) {
    const cr = Math.min(R * 0.42, (hall.w / 2 - bayHalf) * 0.6);
    const off = Math.min(hall.w / 2 - cr - 1.2, bayHalf + cr + 1.4);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.at(sx * off, 0, sz * Math.min(hall.d / 2 - cr - 1.2, off), 0, () => {
          b.with({ light: Light.Facade, lightBase: hall.h - 4 }, () => {
            b.lathe([cr * 1.08, hall.h - 0.2, cr * 1.08, hall.h + cr * 0.28], { seg: lod === 0 ? 12 : 8, facets: true, phase: Math.PI / (lod === 0 ? 12 : 8) });
          });
          leadDome(b, { r: cr, y: hall.h + cr * 0.28, lod, shape: 'raised', alem: cr * 0.32, ring: lod === 0 });
        });
      }
    }
  }

  // Lateral aisle domes (axial plans).
  if (s.sideDomes && s.sideDomes > 0) {
    const n = s.sideDomes;
    const aisle = hall.w / 2 - bayHalf - archT;
    const dr = Math.min(aisle * 0.42, (hall.d * 0.8) / n / 2 * 0.85);
    for (const sx of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        const z = -hall.d * 0.4 + ((i + 0.5) / n) * hall.d * 0.8;
        b.at(sx * (bayHalf + archT + aisle / 2), 0, z, 0, () => {
          b.with({ light: Light.Facade, lightBase: hall.h - 4 }, () =>
            b.lathe([dr * 1.1, hall.h - 0.2, dr * 1.1, hall.h + 0.6], { seg: 8, facets: true, phase: Math.PI / 8 }),
          );
          leadDome(b, { r: dr, y: hall.h + 0.6, lod, shape: 'raised', alem: lod === 0 ? dr * 0.3 : 0, ring: false });
        });
      }
    }
  }

  // Weight towers at the corners of the dome square.
  if (s.turrets) {
    const tr = Math.max(1.1, R * 0.13);
    const tp = bayHalf + archT * 0.3;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        turret(b, { x: sx * tp, z: sz * tp, r: tr, y0: hall.h - 0.2, y1: drumBase + Math.max(2.2, R * 0.18), lod, windows: true, alem: tr * 1.2 });
      }
    }
  }

  // Drum and main dome.
  windowDrum(b, {
    r: R * 1.05,
    y0: drumBase,
    y1: domeSpring,
    windows: s.dome.windows,
    lod,
    buttress: s.dome.buttress === false ? 0 : Math.max(0.5, R * 0.05),
    cornice: Math.max(0.4, R * 0.04),
    winFrac: 0.44,
  });
  leadDome(b, { r: R, y: domeSpring, rise, lod, shape: 'raised', alem: s.dome.alem ?? Math.max(2.5, R * 0.26) });

  // Tabhane wings.
  if (s.wings) {
    const wg = s.wings;
    for (const sx of [-1, 1]) {
      const cx = sx * (hall.w / 2 + wg.w / 2);
      const wz = -hall.d / 2 + wg.d / 2;
      const wh = hall.h * 0.55;
      b.at(cx, 0, wz, 0, () => {
        boxFacades(b, wg.w, wg.d, 0.3, wh, lod, (side, len) => (side === 'left' && sx > 0) || (side === 'right' && sx < 0) ? [] : facadeOpenings(len, classicRows(wh, lod), 5, 1.5));
        cornice(b, wg.w, wg.d, wh, 0.4, lod);
        flatRoof(b, -wg.w / 2, -wg.d / 2, wg.w / 2, wg.d / 2, wh + 0.06);
        const dr = Math.min(wg.w, wg.d / wg.domes) * 0.4;
        for (let i = 0; i < wg.domes; i++) {
          const z = -wg.d / 2 + ((i + 0.5) / wg.domes) * wg.d;
          b.at(0, 0, z, 0, () => leadDome(b, { r: dr, y: wh + 0.3, lod, shape: 'raised', alem: lod === 0 ? dr * 0.3 : 0, ring: false }));
        }
      });
    }
  }

  // Courtyard or portico.
  if (s.court) {
    const c = s.court;
    courtyard(b, { w: c.w, d: c.d, z0: hall.d / 2, nx: c.nx, nz: c.nz, h: c.h, lod, fountain: c.fountain, porticoH: c.porticoH });
  } else if (s.portico) {
    const p = s.portico;
    const len = Math.min(hall.w, p.bays * 5.6);
    b.at(-len / 2, 0, hall.d / 2 + p.depth, 0, () =>
      arcade(b, { len, bays: p.bays, depth: p.depth, colH: p.h * 0.64, roofH: p.h, lod, pitched: p.pitched, domeScale: 1.1 }),
    );
  }

  // Annex blocks.
  for (const a of s.annexes ?? []) {
    b.at(a.x, 0, a.z, 0, () => {
      boxFacades(b, a.w, a.d, 0.3, a.h, lod, (_side, len) => facadeOpenings(len, classicRows(a.h, lod, 0.9), 4.5, 1.2));
      cornice(b, a.w, a.d, a.h, 0.35, lod);
      flatRoof(b, -a.w / 2, -a.d / 2, a.w / 2, a.d / 2, a.h + 0.06, a.domes ? 0 : 0.8);
      if (a.domes) {
        const long = a.w > a.d;
        const n = a.domes;
        const dr = Math.min(long ? a.w / n : a.w, long ? a.d : a.d / n) * 0.4;
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n - 0.5;
          b.at(long ? t * a.w : 0, 0, long ? 0 : t * a.d, 0, () => leadDome(b, { r: dr, y: a.h + 0.3, lod, shape: 'raised', ring: false, alem: lod === 0 ? dr * 0.3 : 0 }));
        }
      }
    });
  }

  // Türbes (octagonal domed tombs).
  for (const t of s.turbes ?? []) {
    b.at(t.x, 0, t.z, 0, () => {
      b.with({ light: Light.Facade, lightBase: 0 }, () => {
        if (lod === 0) {
          const n = 8;
          const step = (Math.PI * 2) / n;
          const side = 2 * t.r * Math.sin(step / 2);
          const apo = t.r * Math.cos(step / 2);
          for (let i = 0; i < n; i++) {
            b.push();
            b.rotateY((i + 0.5) * step);
            b.translate(-side / 2, 0, apo);
            wallPanel(b, side, -1, t.h, facadeOpenings(side, classicRows(t.h, 0, 0.8).slice(0, 2), side * 0.9, side * 0.1), { lod, seed: i });
            b.pop();
          }
        } else {
          b.lathe([t.r, -1, t.r, t.h], { seg: 8, facets: true });
        }
        if (lod < 2) {
          b.sweep(polyPath(t.r, 8), corniceProfile(0.35).map((v, k) => (k % 2 === 1 ? v + t.h - 0.2 : v)));
        }
      });
      leadDome(b, { r: t.r * 0.9, y: t.h + 0.2, lod, shape: 'raised', alem: t.r * 0.25 });
    });
    cols.push({ kind: 'cylinder', x: t.x, y: 0, z: t.z, r: t.r, h: t.h + 0.3 });
  }

  // Precinct wall.
  if (s.precinct) {
    const p = s.precinct;
    const pz = p.z ?? 0;
    const path = rectPath(-p.w / 2, pz - p.d / 2, p.w / 2, pz + p.d / 2);
    b.with({ light: Light.Facade, lightBase: -1 }, () => {
      b.sweep(path, [0, -4, 0, p.h, -0.25, p.h + 0.35, -0.9, p.h + 0.35, -0.9, -4]);
    });
    const x0 = -p.w / 2;
    const x1 = p.w / 2;
    const z0 = pz - p.d / 2;
    const z1 = pz + p.d / 2;
    // the wall stands inside its outline (profile offsets 0 .. -0.9)
    b.colBox(x0, 0, z0, x1, p.h + 0.35, z0 + 0.9);
    b.colBox(x0, 0, z1 - 0.9, x1, p.h + 0.35, z1);
    b.colBox(x0, 0, z0 + 0.9, x0 + 0.9, p.h + 0.35, z1 - 0.9);
    b.colBox(x1 - 0.9, 0, z0 + 0.9, x1, p.h + 0.35, z1 - 0.9);
  }

  // Minarets.
  let top = crown + (s.dome.alem ?? R * 0.26);
  for (const m of s.minarets) {
    cols.push(...minaret(b, s.minaretStone && !m.color ? { ...m, color: s.minaretStone } : m, lod));
    top = Math.max(top, minaretTop(m));
  }
  b.pop();

  // parts registered theirs in building space already (inside the shifted frame)
  const all = [...cols.map((c) => shiftColliderZ(c, shift)), ...b.colliders];
  const radius = all.reduce((m, c) => Math.max(m, colliderReach(c)), 0);
  return { colliders: all, radius, height: top };
}
