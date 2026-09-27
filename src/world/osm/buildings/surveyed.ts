/**
 * Surveyed buildings: per-building rows fitted to reference photos (Kadıköy S1 strip, .docs/street/s1-strip.md
 * section 2), and the storey metrics they resolve with. The street compiler's façade kit (district profile
 * `buildings.spec`, tools/world-compiler/src/facade/plan.ts) and the flight-scale layer (plan.ts planBuilding) both
 * resolve a row here, so a surveyed building has one typology, storey count, roof and wall top up close and from the air.
 */

export type Typology = 'T1' | 'T2' | 'T3' | 'T5';
export type Railing = 'solid' | 'flatbar' | 'squarebar' | 'pipe' | 'glazed' | 'glass' | 'iron';

/** A per-building row fitted to reference photos. */
export interface SpecRow {
  typ: Typology;
  /** Storeys including the ground floor; a range resolves by hash. */
  storeys: [number, number];
  roof?: 'hipped';
  /** Fixed paint (sRGB) from a photo. */
  wall?: number;
  frame?: number;
  cikma?: 'none' | 'full' | 'middle' | 'bay';
  railing?: Railing;
  glazedBase?: number;
  /** Fixed ground floor and floor-to-floor heights (m). */
  G?: number;
  F?: number;
}

/** Storey metrics per typology: ground floor, upper floor-to-floor ranges (m) and parapet. */
export const STOREY_METRICS: Record<Typology, { G: [number, number]; F: [number, number]; parapet: number }> = {
  T1: { G: [4.0, 4.4], F: [2.95, 3.1], parapet: 0.9 },
  T2: { G: [4.0, 4.4], F: [3.6, 3.95], parapet: 0.7 },
  T3: { G: [4.3, 4.6], F: [3.05, 3.3], parapet: 1.0 },
  T5: { G: [3.1, 3.4], F: [3, 3], parapet: 0.25 },
};

/** Kadıköy S1 strip, .docs/street/s1-strip.md section 2 (by OSM id). */
export const SURVEYED: Readonly<Record<number, SpecRow>> = {
  1462853463: { typ: 'T2', storeys: [3, 4] },
  179197246: { typ: 'T2', storeys: [3, 4] },
  709156144: { typ: 'T2', storeys: [4, 4] },
  694298370: { typ: 'T2', storeys: [3, 4] },
  709156145: { typ: 'T2', storeys: [4, 4], railing: 'iron' },
  694298380: { typ: 'T1', storeys: [5, 6] },
  694298381: { typ: 'T1', storeys: [5, 6] },
  694298376: { typ: 'T3', storeys: [6, 6], cikma: 'full', glazedBase: 2, wall: 0x858a8d },
  709156143: { typ: 'T1', storeys: [5, 6] },
  694298375: { typ: 'T1', storeys: [5, 5] },
  694298374: { typ: 'T1', storeys: [5, 5] },
  694298373: { typ: 'T2', storeys: [2, 3] },
  179197314: { typ: 'T1', storeys: [5, 5] },
  694298383: { typ: 'T5', storeys: [1, 1] },
  179197243: { typ: 'T3', storeys: [5, 5], railing: 'glass', wall: 0xdddbd5 },
  179197258: { typ: 'T3', storeys: [5, 5], railing: 'glass', wall: 0xdddbd5 },
  179197266: { typ: 'T1', storeys: [5, 6] },
  1462853447: { typ: 'T1', storeys: [5, 5] },
  179197226: { typ: 'T2', storeys: [3, 3], roof: 'hipped', wall: 0xd8c592, G: 3.7, F: 2.85 },
  1462853450: { typ: 'T2', storeys: [3, 3], roof: 'hipped', wall: 0xd8c592, G: 3.7, F: 2.85 },
  711321929: { typ: 'T1', storeys: [3, 4], wall: 0xdcd2b6, frame: 0x3a4d40, cikma: 'none' },
  694715116: { typ: 'T1', storeys: [4, 5] },
  711321928: { typ: 'T1', storeys: [4, 5] },
  694715117: { typ: 'T1', storeys: [4, 5] },
  694298355: { typ: 'T1', storeys: [4, 5] },
  694715125: { typ: 'T1', storeys: [4, 5] },
  694298352: { typ: 'T1', storeys: [3, 4] },
  694298353: { typ: 'T1', storeys: [3, 4] },
  694715137: { typ: 'T1', storeys: [3, 4] },
  694715138: { typ: 'T1', storeys: [3, 4] },
};

/**
 * Hand-made hero buildings (tools/world-compiler/src/hero): the wall top (m above the entrance floor) and roof of the
 * massing the flight-scale layer draws for them. The hero builders take the same numbers, so the block seen from the
 * air meets the hero up close.
 */
export interface MeasuredRow {
  wallTop: number;
  roof: 'hipped' | 'flat';
}

export const HERO_MEASURES = {
  /** The 1926 pier (hero/pier1926.ts): eaves 9.1 m under a hipped roof. */
  pier1926: { wallTop: 9.1, roof: 'hipped' },
  /** The new pier (hero/new-pier.ts): the land block's parapet, the tallest wall of its three parts. */
  newPier: { wallTop: 8.6, roof: 'flat' },
  /** Haldun Taner Sahnesi (hero/haldun-taner.ts): the end pavilions' parapet. */
  haldunTaner: { wallTop: 11.05, roof: 'flat' },
} as const satisfies Record<string, MeasuredRow>;

/** Hero measures by OSM id. */
export const MEASURED: Readonly<Record<number, MeasuredRow>> = {
  102190096: HERO_MEASURES.pier1926,
  560203763: HERO_MEASURES.newPier,
  102190100: HERO_MEASURES.haldunTaner,
};

/** Hash in [0, 1) of a seed and a salt (the façade kit's per-building variation). */
export function h01(seed: number, salt: number): number {
  const s = Math.sin(seed * 12.9898 + salt * 78.233 + 0.5) * 43758.5453;
  return s - Math.floor(s);
}

/** Per-building seed of the façade kit, by OSM id. */
export function facadeSeed(osmId: number): number {
  return (Math.abs(osmId) % 1_000_003) * 0.618 + 0.37;
}

/** Per-building hash of the façade kit, by OSM id. */
export function facadeHash(osmId: number): (k: number) => number {
  const seed = facadeSeed(osmId);
  return (k) => h01(seed, k);
}

/** A resolved surveyed row: storeys, ground floor and floor-to-floor heights, roof, and the wall top above the base. */
export interface SurveyedPlan {
  typ: Typology;
  storeys: number;
  G: number;
  F: number;
  roof: 'hipped' | 'flat';
  parapet: number;
  /** Wall top (m above the street base): the roof line plus the parapet of a flat roof. */
  wallTop: number;
}

/** Resolves a row for a building (`roofShape`: its OSM roof:shape; `area`: its footprint area, m²). */
export function resolveSurveyed(row: SpecRow, osmId: number, roofShape: string | undefined, area: number): SurveyedPlan {
  const H = facadeHash(osmId);
  const met = STOREY_METRICS[row.typ];
  const G = row.G ?? met.G[0] + (met.G[1] - met.G[0]) * H(2);
  const F = row.F ?? met.F[0] + (met.F[1] - met.F[0]) * H(3);
  const storeys = row.typ === 'T5' ? 1 : row.storeys[0] + Math.floor(H(4) * (row.storeys[1] - row.storeys[0] + 1));
  const roof = row.roof ?? (row.typ === 'T2' && roofShape !== 'flat' && H(5) < 0.25 && area < 260 ? 'hipped' : roofShape === 'hipped' ? 'hipped' : 'flat');
  const parapet = roof === 'hipped' ? 0 : met.parapet;
  return { typ: row.typ, storeys, G, F, roof, parapet, wallTop: G + (storeys - 1) * F + parapet };
}
