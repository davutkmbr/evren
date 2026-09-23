/**
 * Vehicle catalogue shared by the worker (parked cars) and the main thread (traffic, rendering): model ids, sizes,
 * paint palettes and the traffic mix. Plain data, no three.js.
 */

export const Model = {
  Sedan: 0,
  Hatch: 1,
  Suv: 2,
  /** Fiat Doblo style MPV taxi (the current İstanbul yellow taxi). */
  TaxiDoblo: 3,
  /** Sedan taxi (Egea / Corolla / Accent style). */
  TaxiSedan: 4,
  /** Small delivery van (Doblo Cargo / Transit Connect). */
  Van: 5,
  /** High-roof panel van (Transit / Sprinter). */
  PanelVan: 6,
  /** High-roof minibus: yellow taxi-dolmuş or zone minibüs. */
  Minibus: 7,
  /** 12 m low-floor city bus (İETT / ÖHO). */
  Bus: 8,
  /** Courier scooter with rider and top box. */
  Moto: 9,
  /** Light truck (kamyonet) with a box body. */
  Truck: 10,
  /** Alstom Citadis X04 (T1): cab module (nose towards -Z) and intermediate module (unit: cab, 2 x mid, cab). */
  CitadisEnd: 11,
  CitadisMid: 12,
  /** İstiklal nostalgic tram (T2). */
  Nostalgic: 13,
} as const;
export type Model = (typeof Model)[keyof typeof Model];
export const MODEL_COUNT = 14;

/** Overall length (m) of each model, used for spacing, parking and following distances. */
export const MODEL_LENGTH: readonly number[] = [4.55, 4.05, 4.45, 4.4, 4.55, 4.4, 5.6, 6.9, 12.0, 1.9, 6.2, 9.9, 6.6, 9.6];
export const MODEL_WIDTH: readonly number[] = [1.8, 1.75, 1.85, 1.83, 1.8, 1.83, 2.05, 2.05, 2.55, 0.75, 2.1, 2.65, 2.65, 2.3];
/** Axle spacing (m): pitch is taken from the ground under the axles. */
export const MODEL_WHEELBASE: readonly number[] = [2.65, 2.5, 2.65, 2.75, 2.65, 2.75, 3.5, 4.3, 5.9, 1.3, 3.4, 6.0, 5.0, 3.2];

/** sRGB hex -> linear rgb. */
export function linear(hex: number): [number, number, number] {
  const c = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}

type Palette = readonly (readonly [number, number])[];

/**
 * Private car colours in Turkey (weight, sRGB): white dominates, then greys / silver, black, dark blue, red; a few
 * beige, brown, green and bronze tones.
 */
const CAR_PALETTE: Palette = [
  [30, 0xeeeeea],
  [6, 0xf4f2ec],
  [11, 0x9a9da1],
  [9, 0x5d6166],
  [6, 0xb9bcbf],
  [11, 0x16181b],
  [5, 0x1f2d4a],
  [3, 0x3a5a86],
  [5, 0x8e1418],
  [2, 0xb02a24],
  [3, 0x6b5a48],
  [2, 0xc2b59b],
  [2, 0x2f4538],
  [2, 0x7d6a55],
  [1, 0x3f4a55],
  [1, 0xd8761e],
];
/** İstanbul taxi yellow. */
const TAXI_PALETTE: Palette = [[1, 0xf2c200]];
/** Yellow taxi-dolmuş (RAL 1021) and zone minibüs colours (Beyoğlu light green, İstanbul side cream). */
const MINIBUS_PALETTE: Palette = [
  [5, 0xf3b800],
  [3, 0x9fd3a8],
  [2, 0xe7dcc0],
];
/** Delivery / trade vans: mostly white. */
const VAN_PALETTE: Palette = [
  [14, 0xf0f0ec],
  [2, 0xb9bcbf],
  [1, 0x1f3f7a],
  [1, 0x8e1418],
  [1, 0x2c2e31],
];
/** City buses: İETT red, ÖHO blue, a few yellow Otokar Kent / turquoise. */
const BUS_PALETTE: Palette = [
  [5, 0xc0161b],
  [4, 0x1d57a6],
  [1, 0xf1b90e],
  [1, 0x1aa3b0],
];
/** Courier top boxes (plain colours, no branding). */
const MOTO_PALETTE: Palette = [
  [3, 0xf07a14],
  [3, 0xd6202b],
  [2, 0x5d2ea0],
  [1, 0x2aa24a],
  [2, 0x1e1f22],
];
const TRUCK_PALETTE: Palette = [
  [6, 0xf0f0ec],
  [2, 0x2a5aa0],
  [1, 0xb3261e],
];

const PALETTES: readonly Palette[] = [
  CAR_PALETTE,
  CAR_PALETTE,
  CAR_PALETTE,
  TAXI_PALETTE,
  TAXI_PALETTE,
  VAN_PALETTE,
  VAN_PALETTE,
  MINIBUS_PALETTE,
  BUS_PALETTE,
  MOTO_PALETTE,
  TRUCK_PALETTE,
  [[1, 0xf1f1ee]],
  [[1, 0xf1f1ee]],
  [[1, 0xb3181c]],
];

function pickWeighted<T>(items: readonly (readonly [number, T])[], r: number): T {
  let total = 0;
  for (const [w] of items) {
    total += w;
  }
  let x = r * total;
  for (const [w, v] of items) {
    x -= w;
    if (x <= 0) {
      return v;
    }
  }
  return items[items.length - 1][1];
}

/** Linear paint colour of a model for random r in [0, 1), with a slight per-vehicle variation from r2. */
export function paintOf(model: number, r: number, r2: number): [number, number, number] {
  const hex = pickWeighted(PALETTES[model], r);
  const c = linear(hex);
  const k = 0.93 + r2 * 0.12;
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Moving traffic mix (weights) on a street of the given rank (see network.ts RANK). */
export function trafficMix(rank: number, busLane: boolean): readonly (readonly [number, number])[] {
  const major = rank >= 3;
  return [
    [major ? 26 : 30, Model.Sedan],
    [major ? 18 : 24, Model.Hatch],
    [major ? 9 : 9, Model.Suv],
    [major ? 16 : 10, Model.TaxiDoblo],
    [major ? 8 : 5, Model.TaxiSedan],
    [major ? 5 : 6, Model.Van],
    [major ? 3 : 2, Model.PanelVan],
    [major ? 3 : 1, Model.Minibus],
    [busLane ? 5 : 0, Model.Bus],
    [major ? 5 : 6, Model.Moto],
    [major ? 2 : 1, Model.Truck],
  ];
}

/** Parked vehicle mix: private cars, a few vans and taxis, scooters in the gaps. */
export const PARKED_MIX: readonly (readonly [number, number])[] = [
  [34, Model.Sedan],
  [30, Model.Hatch],
  [13, Model.Suv],
  [4, Model.TaxiDoblo],
  [2, Model.TaxiSedan],
  [7, Model.Van],
  [3, Model.PanelVan],
  [1, Model.Truck],
];

export function pickModel(mix: readonly (readonly [number, number])[], r: number): number {
  return pickWeighted(mix, r);
}

/** Small deterministic PRNG (mulberry32). */
export function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
