/**
 * Neighbourhood mosques (mahalle camii / mescit): parametric prototypes shared by every geo.smallMosqueSites entry.
 * Two families: the ubiquitous single-dome mosque (cubic hall, windowed drum, lead dome, portico, 1-2 minarets) and
 * the older hipped-roof mescit with a terracotta roof and one short minaret. Heights and dome spans follow typical
 * Istanbul examples (domes 8-22 m across, minarets 18-46 m with 1-2 serefe).
 */
import type { MeshBuilder } from '../builder';
import { corniceProfile, rectPath, tileRoof } from '../parts/details';
import { arcade } from '../parts/arcade';
import { minaret, minaretTop, type MinaretSpec } from '../parts/minaret';
import { rowOpenings } from '../parts/wall';
import { Light, Mat, shiftColliderZ, type LocalCollider, type LodLevel, type RGB } from '../types';
import { boxFacades, buildImperial, type ImperialSpec, type StyleResult } from './imperial';

export interface PitchedSpec {
  style: 'pitched';
  stone: RGB;
  w: number;
  d: number;
  h: number;
  pitchDeg: number;
  portico: boolean;
  minaret: MinaretSpec;
  /** Plastered (whitewashed) walls instead of cut stone. */
  plaster: boolean;
}

export type NeighborhoodVariant = (ImperialSpec | PitchedSpec) & {
  /** Approximate footprint radius (m) used to match sites. */
  footprint: number;
};

const CREAM: RGB = [0.86, 0.82, 0.74];
const WHITE: RGB = [0.88, 0.87, 0.84];
const WARM: RGB = [0.82, 0.75, 0.64];
const GREYSTONE: RGB = [0.76, 0.75, 0.71];
const OCHRE: RGB = [0.84, 0.74, 0.58];

function domed(
  stone: RGB,
  side: number,
  h: number,
  domeR: number,
  opts: {
    drum?: number;
    windows?: number;
    portico?: { bays: number; depth: number; h: number; pitched?: boolean };
    minarets: MinaretSpec[];
    turrets?: boolean;
    cornerDomes?: boolean;
    semi?: ImperialSpec['semi'];
    semiWindows?: number;
    d?: number;
  },
): NeighborhoodVariant {
  const d = opts.d ?? side;
  const pd = opts.portico ? opts.portico.depth : 0;
  const spec: ImperialSpec = {
    style: 'imperial',
    stone,
    hall: { w: side, d, h },
    dome: { r: domeR, drum: opts.drum ?? Math.max(1.2, domeR * 0.28), windows: opts.windows ?? (domeR > 6 ? 16 : 12), rise: domeR * 1.02, alem: Math.max(1.6, domeR * 0.34), base: h + 0.4 },
    semi: opts.semi ?? 'none',
    semiWindows: opts.semiWindows,
    turrets: opts.turrets,
    cornerDomes: opts.cornerDomes,
    tympana: side > 13,
    portico: opts.portico,
    minarets: opts.minarets,
  };
  const reach = Math.max(side, d + pd) * 0.5 + 3;
  return { ...spec, footprint: reach };
}

/** Minaret engaged at the front corner of a hall (side -1 = left, +1 = right, seen from the courtyard). */
function frontMinaret(side: -1 | 1, hallW: number, hallD: number, h: number, serefe: 1 | 2, r?: number): MinaretSpec {
  const rr = r ?? h / 29;
  return { x: side * (hallW / 2 + rr * 1.35), z: hallD / 2 - rr * 1.4, h, serefe, r: rr, baseH: Math.max(4.5, h * 0.14) };
}

export const NEIGHBORHOOD_VARIANTS: NeighborhoodVariant[] = [
  {
    style: 'pitched',
    stone: WHITE,
    w: 9,
    d: 12,
    h: 5.6,
    pitchDeg: 24,
    portico: false,
    plaster: true,
    minaret: { x: 5.6, z: 3.8, h: 18.5, serefe: 1, r: 0.72, baseH: 4.2 },
    footprint: 9,
  },
  {
    style: 'pitched',
    stone: WARM,
    w: 11,
    d: 14,
    h: 6.4,
    pitchDeg: 26,
    portico: true,
    plaster: false,
    minaret: { x: -6.9, z: 5.4, h: 23, serefe: 1, r: 0.85, baseH: 5 },
    footprint: 12,
  },
  domed(CREAM, 11, 7.2, 4.4, { minarets: [frontMinaret(1, 11, 11, 25, 1)], portico: { bays: 3, depth: 4.2, h: 5.6 } }),
  domed(WHITE, 12.5, 8, 4.9, { minarets: [frontMinaret(-1, 12.5, 12.5, 29, 1)], portico: { bays: 3, depth: 4.8, h: 6.2 } }),
  domed(GREYSTONE, 14, 9, 5.5, { minarets: [frontMinaret(1, 14, 14, 33, 1)], turrets: true, portico: { bays: 3, depth: 5.2, h: 6.8 } }),
  domed(CREAM, 15.5, 9.5, 6.1, { minarets: [frontMinaret(1, 15.5, 15.5, 37, 2)], portico: { bays: 5, depth: 5.2, h: 7 }, windows: 16 }),
  domed(OCHRE, 13, 8.5, 5.1, { minarets: [frontMinaret(-1, 13, 13, 30, 1)], portico: { bays: 3, depth: 4.6, h: 6.4, pitched: true } }),
  domed(WHITE, 17, 10.5, 6.7, {
    minarets: [frontMinaret(-1, 17, 17, 39, 2), frontMinaret(1, 17, 17, 39, 2)],
    turrets: true,
    portico: { bays: 5, depth: 5.8, h: 7.6 },
    windows: 16,
  }),
  domed(CREAM, 20, 11.5, 7.8, {
    minarets: [frontMinaret(-1, 20, 20, 43, 2), frontMinaret(1, 20, 20, 43, 2)],
    turrets: true,
    cornerDomes: true,
    portico: { bays: 5, depth: 6.4, h: 8.4 },
    windows: 20,
  }),
  domed(GREYSTONE, 22, 10, 8.2, {
    minarets: [frontMinaret(-1, 22, 24, 45, 2), frontMinaret(1, 22, 24, 45, 2)],
    turrets: true,
    semi: 'axial',
    semiWindows: 7,
    d: 24,
    portico: { bays: 5, depth: 6.4, h: 8.6 },
    windows: 20,
  }),
  domed(WHITE, 15, 9, 5.9, { minarets: [frontMinaret(1, 15, 15, 35, 2, 1.05)], portico: { bays: 5, depth: 5, h: 6.8 }, drum: 2.4, windows: 16 }),
  domed(WARM, 12, 7.6, 4.7, { minarets: [frontMinaret(1, 12, 12, 27, 1)], windows: 8, drum: 1.6 }),
];

/** Old hipped-roof mescit. */
function buildPitched(b: MeshBuilder, s: PitchedSpec, lod: LodLevel): StyleResult {
  const cols: LocalCollider[] = [];
  const pd = s.portico ? 3.6 : 0;
  const shift = -pd / 2;
  b.set({ color: s.stone, mat: s.plaster ? Mat.Plaster : Mat.Stone, light: Light.Facade, lightBase: 0, ao: 1 });
  b.push();
  b.translate(0, 0, shift);
  b.with({ mat: Mat.Stone, ao: 0.85 }, () => b.box(-s.w / 2 - 1, -4, -s.d / 2 - 1, s.w / 2 + 1, 0.3, s.d / 2 + pd + 1, 'b'));
  boxFacades(b, s.w, s.d, 0.3, s.h, lod, (side, len) => {
    const ops = rowOpenings(len, { count: Math.max(1, Math.floor(len / 3.2)), sill: 1.2, h: 1.9, w: 1.05, arch: 'flat', back: 'glass', glazing: 'grille', depth: 0.4, frame: 0.12, tympanum: lod === 0 }, 1.2);
    ops.push(...rowOpenings(len, { count: Math.max(1, Math.floor(len / 3.2)), sill: s.h - 1.55, h: 0.6, w: 0.7, arch: 'round', back: 'glass', glazing: 'lattice', depth: 0.3 }, 1.2));
    if (side === 'front') {
      const dw = 1.6;
      const keep = ops.filter((o) => o.x1 < len / 2 - dw / 2 - 0.4 || o.x0 > len / 2 + dw / 2 + 0.4);
      keep.push({ x0: len / 2 - dw / 2, x1: len / 2 + dw / 2, y0: 0.3, y1: 2.6, arch: 'pointed', depth: 0.5, back: 'door', frame: lod === 0 ? 0.25 : 0 });
      return keep;
    }
    return ops;
  });
  if (lod < 2) {
    b.with({ mat: Mat.Stone }, () => b.sweep(rectPath(-s.w / 2, -s.d / 2, s.w / 2, s.d / 2), corniceProfile(0.3).map((v, k) => (k % 2 === 1 ? v + s.h - 0.15 : v))));
  }
  tileRoof(b, -s.w / 2, -s.d / 2, s.w / 2, s.d / 2, s.h + 0.1, s.pitchDeg, lod === 2 ? 0.4 : 0.7);
  cols.push({ kind: 'box', cx: 0, cy: s.h / 2 + 1, cz: shift, hx: s.w / 2 + 0.7, hy: s.h / 2 + 1.5, hz: s.d / 2 + 0.7, yaw: 0 });
  if (s.portico) {
    b.at(-s.w / 2 + 0.6, 0, s.d / 2 + pd, 0, () => arcade(b, { len: s.w - 1.2, bays: 3, depth: pd, colH: 3.2, roofH: 4.4, lod, pitched: true }));
  }
  b.with({ mat: Mat.Stone, color: s.plaster ? [0.8, 0.78, 0.74] : s.stone }, () => {
    cols.push(...minaret(b, s.minaret, lod).map((c) => shiftColliderZ(c, shift)));
  });
  b.pop();
  return { colliders: cols, radius: Math.hypot(s.w / 2, s.d / 2 + pd) + 2, height: minaretTop(s.minaret) };
}


export function buildNeighborhood(b: MeshBuilder, v: NeighborhoodVariant, lod: LodLevel): StyleResult {
  if (v.style === 'pitched') {
    return buildPitched(b, v, lod);
  }
  return buildImperial(b, v, lod);
}
