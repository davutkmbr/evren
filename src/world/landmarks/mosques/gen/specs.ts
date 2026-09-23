/**
 * Per-landmark configurations. Dimensions from published surveys (outer dome radius = inner diameter / 2 + shell,
 * crown heights, minaret heights incl. caps, number of şerefe, courtyard sizes and dome counts); where sources are
 * silent, proportions follow the Sinan-school norms of the same building type.
 * Frame: -Z = qibla, +Z = courtyard / entrance, +X = right when facing the mihrab.
 */
import type { MinaretSpec } from './parts/minaret';
import type { ImperialSpec } from './styles/imperial';
import type { ByzantineSpec } from './styles/byzantine';
import type { RGB } from './types';

export type MosqueSpec = ImperialSpec | ByzantineSpec;

const LIMESTONE: RGB = [0.8, 0.76, 0.68];
const GREY_STONE: RGB = [0.76, 0.75, 0.72];
const WARM_STONE: RGB = [0.82, 0.76, 0.66];
const PALE_MARBLE: RGB = [0.86, 0.84, 0.8];

/** Minarets engaged at the four corners of a rectangle (x = ±hw, z = z0 / z1). */
function corners(hw: number, z0: number, z1: number, m: Omit<MinaretSpec, 'x' | 'z'>, which: 'all' | 'front' | 'back' = 'all'): MinaretSpec[] {
  const out: MinaretSpec[] = [];
  if (which !== 'front') {
    out.push({ ...m, x: -hw, z: z0 }, { ...m, x: hw, z: z0 });
  }
  if (which !== 'back') {
    out.push({ ...m, x: -hw, z: z1 }, { ...m, x: hw, z: z1 });
  }
  return out;
}

export const LANDMARK_SPECS: Record<string, MosqueSpec> = {
  sultanahmet: {
    style: 'imperial',
    stone: GREY_STONE,
    hall: { w: 56, d: 52, h: 17.5 },
    dome: { r: 12.4, drum: 2.6, windows: 28, rise: 12.6, alem: 4.8 },
    semi: 'all',
    semiBand: 2.2,
    semiWindows: 14,
    exedrae: true,
    cornerDomes: true,
    turrets: true,
    galleries: true,
    court: { w: 56, d: 52, nx: 9, nz: 8, h: 7.5, fountain: 'hex', porticoH: 10.5 },
    minarets: [
      ...corners(29.4, -27.4, 27.4, { h: 61.5, serefe: 3, baseH: 17, r: 2.05 }),
      ...corners(29.4, 0, 80.4, { h: 55, serefe: 2, baseH: 8.5, r: 1.95 }, 'front'),
    ],
  },
  suleymaniye: {
    style: 'imperial',
    stone: WARM_STONE,
    hall: { w: 59, d: 58, h: 20 },
    dome: { r: 13.9, drum: 3.3, windows: 32, rise: 13.6, alem: 5 },
    semi: 'axial',
    semiWindows: 12,
    sideDomes: 5,
    turrets: true,
    galleries: true,
    court: { w: 57, d: 46, nx: 9, nz: 7, h: 8, fountain: 'oct', porticoH: 11.5 },
    minarets: [
      ...corners(29.6, 30, 76, { h: 72.5, serefe: 3, baseH: 12, r: 2.2 }, 'back'),
      ...corners(29.6, 30, 76, { h: 56, serefe: 2, baseH: 8, r: 1.95 }, 'front'),
    ],
    turbes: [
      { x: -12, z: -47, r: 8.5, h: 11 },
      { x: 12, z: -45, r: 5.5, h: 8 },
    ],
    precinct: { w: 92, d: 132, h: 4, z: 18 },
  },
  'yeni-cami': {
    style: 'imperial',
    stone: [0.74, 0.72, 0.67],
    hall: { w: 41, d: 41, h: 14 },
    dome: { r: 9.6, drum: 2.1, windows: 24, rise: 9.8, alem: 3.8 },
    semi: 'all',
    semiWindows: 10,
    exedrae: true,
    cornerDomes: true,
    turrets: true,
    court: { w: 39, d: 39, nx: 7, nz: 7, h: 7, fountain: 'oct', porticoH: 9.5 },
    minarets: corners(21.8, 0, 21.8, { h: 58, serefe: 3, baseH: 12, r: 1.95 }, 'front'),
    annexes: [{ x: -26, z: -10, w: 10, d: 20, h: 10 }],
  },
  'fatih-camii': {
    style: 'imperial',
    stone: LIMESTONE,
    hall: { w: 58, d: 56, h: 16 },
    dome: { r: 13.6, drum: 2.8, windows: 24, rise: 12.4, alem: 4.5 },
    semi: 'all',
    semiWindows: 12,
    cornerDomes: true,
    turrets: true,
    court: { w: 58, d: 48, nx: 9, nz: 8, h: 7.5, fountain: 'oct', porticoH: 10 },
    minarets: corners(30.4, 0, 29.4, { h: 60, serefe: 2, baseH: 12, r: 2 }, 'front'),
  },
  'yavuz-selim-camii': {
    style: 'imperial',
    stone: LIMESTONE,
    hall: { w: 32, d: 32, h: 18 },
    dome: { r: 12.9, drum: 1.6, windows: 20, rise: 12.6, alem: 4, base: 18.4 },
    semi: 'none',
    turrets: true,
    wings: { w: 12, d: 30, domes: 4 },
    court: { w: 40, d: 34, nx: 6, nz: 6, h: 7, fountain: 'oct', porticoH: 9 },
    minarets: corners(20.6, 0, 17.4, { h: 49, serefe: 1, baseH: 10, r: 1.7 }, 'front'),
    turbes: [{ x: 0, z: -30, r: 7, h: 10 }],
  },
  'mihrimah-edirnekapi': {
    style: 'imperial',
    stone: LIMESTONE,
    hall: { w: 27, d: 27, h: 25 },
    dome: { r: 10.4, drum: 1.4, windows: 16, rise: 10.2, alem: 3.6, base: 25.4 },
    semi: 'none',
    turrets: true,
    hallArches: 10.5,
    galleries: true,
    portico: { bays: 7, depth: 6, h: 9.5 },
    minarets: [{ x: 15, z: 14.8, h: 48, serefe: 1, baseH: 13, r: 1.65 }],
  },
  nuruosmaniye: {
    style: 'imperial',
    stone: PALE_MARBLE,
    hall: { w: 34, d: 34, h: 24 },
    dome: { r: 13, drum: 3, windows: 32, rise: 11.5, alem: 4, base: 24.6 },
    semi: 'none',
    turrets: true,
    hallArches: 8,
    windowStyle: 'baroque',
    cornice: 1.1,
    court: { w: 34, d: 30, nx: 5, nz: 5, h: 7.5, fountain: 'none', porticoH: 10 },
    minarets: corners(18.4, 0, 18.4, { h: 48, serefe: 2, baseH: 11, r: 1.7 }, 'front'),
  },
  sehzade: {
    style: 'imperial',
    stone: WARM_STONE,
    hall: { w: 38, d: 38, h: 13 },
    dome: { r: 10, drum: 2.0, windows: 24, rise: 10, alem: 4 },
    semi: 'all',
    semiWindows: 10,
    cornerDomes: true,
    turrets: true,
    galleries: true,
    court: { w: 38, d: 38, nx: 6, nz: 6, h: 7.5, fountain: 'oct', porticoH: 9.5 },
    minarets: corners(20.4, 0, 20.4, { h: 52, serefe: 2, baseH: 10, r: 1.8 }, 'front'),
    turbes: [{ x: 0, z: -33, r: 6, h: 10 }],
  },
  'beyazit-camii': {
    style: 'imperial',
    stone: LIMESTONE,
    hall: { w: 40, d: 40, h: 14 },
    dome: { r: 9.3, drum: 2.0, windows: 20, rise: 9.5, alem: 3.6 },
    semi: 'axial',
    semiWindows: 9,
    sideDomes: 4,
    turrets: true,
    wings: { w: 12, d: 24, domes: 3 },
    court: { w: 40, d: 40, nx: 6, nz: 6, h: 7.5, fountain: 'oct', porticoH: 9.5 },
    minarets: [
      { x: -33.5, z: 1.5, h: 53, serefe: 1, baseH: 10, r: 1.75 },
      { x: 33.5, z: 1.5, h: 53, serefe: 1, baseH: 10, r: 1.75 },
    ],
  },
  'eyup-sultan': {
    style: 'imperial',
    stone: PALE_MARBLE,
    hall: { w: 28, d: 28, h: 17 },
    dome: { r: 9, drum: 2.5, windows: 16, rise: 8.6, alem: 3.4, base: 17.4 },
    semi: 'none',
    turrets: true,
    windowStyle: 'baroque',
    court: { w: 28, d: 24, nx: 4, nz: 4, h: 7, fountain: 'oct', porticoH: 9 },
    minarets: corners(15.2, 0, 15.2, { h: 47, serefe: 2, baseH: 9, r: 1.55 }, 'front'),
    turbes: [{ x: -22, z: 2, r: 6.5, h: 8.5 }],
  },
  'mihrimah-uskudar': {
    style: 'imperial',
    stone: LIMESTONE,
    hall: { w: 25, d: 22, h: 11.5 },
    dome: { r: 5.9, drum: 1.8, windows: 12, rise: 6, alem: 2.6 },
    semi: 'three',
    semiWindows: 6,
    turrets: true,
    portico: { bays: 5, depth: 8, h: 8, pitched: true },
    minarets: corners(13.4, 0, 12.2, { h: 41, serefe: 1, baseH: 8, r: 1.4 }, 'front'),
  },
  'yeni-valide-uskudar': {
    style: 'imperial',
    stone: LIMESTONE,
    hall: { w: 26, d: 26, h: 13 },
    dome: { r: 8, drum: 2.2, windows: 16, rise: 8, alem: 3.2, base: 13.4 },
    semi: 'none',
    cornerDomes: true,
    turrets: true,
    court: { w: 30, d: 24, nx: 5, nz: 4, h: 7, fountain: 'oct', porticoH: 8.5 },
    minarets: corners(14.2, 0, 14.2, { h: 42, serefe: 2, baseH: 8, r: 1.45 }, 'front'),
    turbes: [{ x: 20, z: -6, r: 4.5, h: 6.5 }],
  },
  'semsi-pasa': {
    style: 'imperial',
    stone: WARM_STONE,
    hall: { w: 10.5, d: 10.5, h: 8 },
    dome: { r: 5.3, drum: 1.4, windows: 8, rise: 5.1, alem: 2.2, base: 8.4 },
    semi: 'none',
    tympana: false,
    portico: { bays: 3, depth: 4, h: 5.8 },
    minarets: [{ x: 6.4, z: -4.5, h: 23.5, serefe: 1, baseH: 5, r: 0.95 }],
    annexes: [{ x: -9.5, z: 2, w: 5.5, d: 13, h: 4.6, domes: 3 }],
  },
  'kilic-ali-pasa': {
    style: 'imperial',
    stone: LIMESTONE,
    hall: { w: 26, d: 30, h: 12 },
    dome: { r: 6.7, drum: 1.8, windows: 16, rise: 6.8, alem: 2.8 },
    semi: 'axial',
    semiWindows: 7,
    sideDomes: 3,
    turrets: true,
    portico: { bays: 5, depth: 5.5, h: 8.5 },
    minarets: [{ x: 14.2, z: 13, h: 37.5, serefe: 1, baseH: 8, r: 1.35 }],
    turbes: [{ x: 0, z: -22, r: 4, h: 6 }],
  },
  'taksim-camii': {
    style: 'imperial',
    stone: [0.84, 0.82, 0.78],
    hall: { w: 30, d: 30, h: 16 },
    dome: { r: 9.4, drum: 3.8, windows: 20, rise: 9.2, alem: 3.4, base: 16.4 },
    semi: 'none',
    cornerDomes: true,
    turrets: true,
    portico: { bays: 5, depth: 6, h: 9.5 },
    minarets: corners(16.4, 0, 16.4, { h: 61.5, serefe: 2, baseH: 11, r: 1.75 }, 'front'),
  },
  'camlica-camii': {
    style: 'imperial',
    stone: [0.87, 0.86, 0.83],
    hall: { w: 78, d: 76, h: 28 },
    dome: { r: 17.6, drum: 4.5, windows: 32, rise: 17.8, alem: 6.5 },
    semi: 'all',
    semiBand: 3.2,
    semiWindows: 16,
    exedrae: true,
    cornerDomes: true,
    turrets: true,
    court: { w: 78, d: 64, nx: 11, nz: 9, h: 10, fountain: 'oct', porticoH: 14 },
    minarets: [
      ...corners(40.5, -39.5, 39.5, { h: 102.6, serefe: 3, baseH: 26, r: 3.1 }),
      ...corners(40.5, 0, 104.5, { h: 86.2, serefe: 2, baseH: 11, r: 2.8 }, 'front'),
    ],
  },
  'ortakoy-camii': {
    style: 'imperial',
    stone: [0.88, 0.86, 0.8],
    hall: { w: 17, d: 17, h: 17.5 },
    dome: { r: 6.4, drum: 3.6, windows: 12, rise: 6.3, alem: 2.6, base: 17.9, buttress: false },
    semi: 'none',
    tympana: false,
    windowStyle: 'baroque',
    hallArches: 6.5,
    pilasters: 1.1,
    cornice: 0.9,
    annexes: [{ x: 0, z: 13, w: 22, d: 9, h: 11.5 }],
    minarets: [
      { x: -12.4, z: 11.2, h: 38, serefe: 1, baseH: 11.5, r: 1.05, style: 'baroque' },
      { x: 12.4, z: 11.2, h: 38, serefe: 1, baseH: 11.5, r: 1.05, style: 'baroque' },
    ],
  },
  'dolmabahce-camii': {
    style: 'imperial',
    stone: [0.86, 0.84, 0.78],
    hall: { w: 25, d: 25, h: 19 },
    dome: { r: 8.2, drum: 2.2, windows: 16, rise: 8, alem: 3, base: 19.4, buttress: false },
    semi: 'none',
    tympana: false,
    windowStyle: 'baroque',
    hallArches: 7,
    pilasters: 1.2,
    cornice: 1.0,
    annexes: [{ x: 0, z: 17, w: 30, d: 9, h: 11 }],
    minarets: [
      { x: -16.6, z: 17, h: 43, serefe: 1, baseH: 11, r: 1.15, style: 'baroque' },
      { x: 16.6, z: 17, h: 43, serefe: 1, baseH: 11, r: 1.15, style: 'baroque' },
    ],
  },
  nusretiye: {
    style: 'imperial',
    stone: [0.84, 0.82, 0.76],
    hall: { w: 21, d: 21, h: 21 },
    dome: { r: 7.2, drum: 4.2, windows: 16, rise: 7, alem: 3, base: 21.4, buttress: false },
    semi: 'none',
    tympana: false,
    windowStyle: 'baroque',
    hallArches: 8,
    pilasters: 1.2,
    cornice: 1.1,
    annexes: [{ x: 0, z: 15.5, w: 34, d: 10, h: 10 }],
    minarets: [
      { x: -13.2, z: 11.6, h: 46, serefe: 2, baseH: 10, r: 0.95, style: 'baroque' },
      { x: 13.2, z: 11.6, h: 46, serefe: 2, baseH: 10, r: 0.95, style: 'baroque' },
    ],
  },
  ayasofya: { style: 'byzantine', variant: 'ayasofya' },
  'kucuk-ayasofya': { style: 'byzantine', variant: 'kucuk' },
};

/** Generic single-dome mosque sized from a landmark's catalogue height/radius (ids without a hand-made spec). */
export function genericLandmarkSpec(height: number, radius: number): MosqueSpec {
  const side = Math.max(14, Math.min(40, radius * 0.75));
  const domeR = side * 0.36;
  const h = side * 0.55;
  const minH = Math.max(25, height - 2.5);
  return {
    style: 'imperial',
    stone: LIMESTONE,
    hall: { w: side, d: side, h },
    dome: { r: domeR, drum: domeR * 0.25, windows: 16, rise: domeR * 1.02, alem: domeR * 0.3, base: h + 0.4 },
    semi: 'none',
    turrets: true,
    portico: { bays: 5, depth: Math.max(4, side * 0.2), h: h * 0.7 },
    minarets: corners(side / 2 + 1.6, 0, side / 2 - 1.2, { h: minH, serefe: minH > 45 ? 2 : 1, r: minH / 29 }, 'front').slice(0, minH > 45 ? 2 : 1),
  };
}
