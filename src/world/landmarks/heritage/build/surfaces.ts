/**
 * Surface catalogue shared by the geometry builders (worker) and the heritage shader.
 * Every vertex carries a surface id; the fragment shader turns it into procedural masonry, roofing, glazing...
 * UVs are metres: u runs along the surface, v up (walls) or down-slope (roofs, v = 0 at the eave).
 * Ids >= FACADE_BASE are "facades": a base surface with a procedural window grid (see FACADE_STYLES).
 */
export const Surf = {
  Plaster: 0,
  Ashlar: 1,
  /** Theodosian banded masonry: limestone courses with five-course brick bands. */
  Byzantine: 2,
  Rubble: 3,
  Marble: 4,
  Brick: 5,
  Lead: 6,
  Slate: 7,
  Tile: 8,
  Glass: 9,
  /** Pink Aswan granite; weather > 0.5 engraves hieroglyph columns (obelisk). */
  Granite: 10,
  Bronze: 11,
  Gold: 12,
  Wood: 13,
  /** Grass / soil terraces (peribolos, moat floor). */
  Earth: 14,
  Paving: 15,
  Iron: 16,
  /** Openings: dark interior with a little bounce light. */
  Void: 17,
  /** Carved white ornament (cornices, capitals, balustrades). */
  Stucco: 18,
  /** Alternating light / dark stone courses (Sirkeci, Alman Çeşmesi). */
  BandedStone: 19,
  /** Warm emissive lamp globes. */
  Lamp: 20,
  /** Marble balustrade band: balusters drawn by the shader. */
  Balustrade: 21,
  /** Clock dial (lit at night). */
  Clock: 22,
  /** Iron railing band (see-through look faked with dark gaps). */
  Railing: 23,
} as const;

export type SurfId = (typeof Surf)[keyof typeof Surf];

export const FACADE_BASE = 32;

export interface FacadeStyle {
  name: string;
  /** Base surface id (Plaster, Ashlar, Marble...). */
  base: number;
  /** Bay width (m): one window per bay. */
  spacing: number;
  winW: number;
  winH: number;
  /** Floor-to-floor height (m). */
  floorH: number;
  /** Sill height of the first window row above the facade base (v = 0). */
  sill: number;
  rows: number;
  /** 0 rectangular, 1 round-headed, 2 segmental, 3 pointed, 4 horseshoe. */
  arch: number;
  /** Surround (architrave) width in m (0 = none). */
  frame: number;
  /** 0 plain glass, 1 cross mullion, 2 small panes grid, 3 iron grille / shutters. */
  mullion: number;
  /** Probability a window is lit at night. */
  lit: number;
  /** Surround brightness relative to the wall (1 = same). */
  surround: number;
  /** Pilasters between bays: relief strength (0 = none). */
  pilaster: number;
}

/** Facade window grids, indexed by (surface id - FACADE_BASE). The GLSL table is generated from this list. */
export const FACADE_STYLES: readonly FacadeStyle[] = [
  // 0 Dolmabahçe / Çırağan: tall round-headed windows between pilasters, two storeys over a basement.
  { name: 'palace-marble', base: Surf.Marble, spacing: 4.6, winW: 1.9, winH: 4.0, floorH: 7.6, sill: 3.6, rows: 2, arch: 1, frame: 0.3, mullion: 2, lit: 0.35, surround: 1.06, pilaster: 1 },
  // 1 Beylerbeyi: slightly squatter, more ornate surrounds.
  { name: 'palace-beylerbeyi', base: Surf.Marble, spacing: 4.2, winW: 1.7, winH: 3.4, floorH: 6.8, sill: 3.0, rows: 2, arch: 1, frame: 0.32, mullion: 2, lit: 0.3, surround: 1.05, pilaster: 1 },
  // 2 Selimiye / Kuleli barracks: regular segmental windows, three storeys, plaster.
  { name: 'barracks', base: Surf.Plaster, spacing: 3.7, winW: 1.3, winH: 2.4, floorH: 5.2, sill: 1.6, rows: 3, arch: 2, frame: 0.18, mullion: 2, lit: 0.45, surround: 1.14, pilaster: 0 },
  // 3 Haydarpaşa: stone, tall windows, five storeys.
  { name: 'station-stone', base: Surf.Ashlar, spacing: 3.3, winW: 1.35, winH: 2.6, floorH: 4.5, sill: 1.6, rows: 5, arch: 2, frame: 0.2, mullion: 2, lit: 0.4, surround: 1.08, pilaster: 0.4 },
  // 4 Sirkeci: orientalist banded stone, horseshoe windows, two storeys.
  { name: 'station-orientalist', base: Surf.BandedStone, spacing: 4.4, winW: 1.8, winH: 3.3, floorH: 6.4, sill: 1.8, rows: 2, arch: 4, frame: 0.28, mullion: 1, lit: 0.5, surround: 1.1, pilaster: 0 },
  // 5 Ottoman palace halls (Topkapı): small rectangular windows with grilles, one row.
  { name: 'ottoman-hall', base: Surf.Ashlar, spacing: 3.2, winW: 1.0, winH: 1.7, floorH: 4.2, sill: 1.1, rows: 1, arch: 0, frame: 0.16, mullion: 3, lit: 0.2, surround: 1.12, pilaster: 0 },
  // 6 Ottoman hall with upper (tepe) windows: round-headed row above the main row.
  { name: 'ottoman-hall-2', base: Surf.Ashlar, spacing: 3.2, winW: 0.9, winH: 1.6, floorH: 3.1, sill: 1.1, rows: 2, arch: 1, frame: 0.14, mullion: 3, lit: 0.2, surround: 1.12, pilaster: 0 },
  // 7 Harem / plastered Ottoman: whitewashed, rectangular.
  { name: 'harem', base: Surf.Plaster, spacing: 2.9, winW: 0.95, winH: 1.6, floorH: 3.9, sill: 1.0, rows: 2, arch: 0, frame: 0.12, mullion: 3, lit: 0.25, surround: 1.0, pilaster: 0 },
  // 8 Neoclassical museum (Arkeoloji): stone, tall.
  { name: 'museum', base: Surf.Ashlar, spacing: 4.0, winW: 1.6, winH: 3.3, floorH: 6.6, sill: 2.0, rows: 2, arch: 0, frame: 0.25, mullion: 2, lit: 0.1, surround: 1.08, pilaster: 0.6 },
  // 9 Generic stone offices / dependencies.
  { name: 'stone-offices', base: Surf.Ashlar, spacing: 3.2, winW: 1.2, winH: 2.2, floorH: 4.3, sill: 1.3, rows: 3, arch: 0, frame: 0.18, mullion: 2, lit: 0.45, surround: 1.08, pilaster: 0 },
  // 10 Plastered palace dependencies (Dolmabahçe service wings, Çırağan hotel): cream plaster, two rows.
  { name: 'palace-plaster', base: Surf.Plaster, spacing: 3.6, winW: 1.4, winH: 2.6, floorH: 5.0, sill: 1.8, rows: 2, arch: 2, frame: 0.2, mullion: 2, lit: 0.4, surround: 1.12, pilaster: 0.5 },
  // 11 Byzantine brick (Aya İrini, Tekfur Sarayı): tall round-headed openings.
  { name: 'byzantine-brick', base: Surf.Brick, spacing: 4.2, winW: 1.6, winH: 3.2, floorH: 7.0, sill: 3.0, rows: 1, arch: 1, frame: 0.2, mullion: 0, lit: 0.0, surround: 0.95, pilaster: 0 },
];

export const Facade = {
  PalaceMarble: FACADE_BASE + 0,
  PalaceBeylerbeyi: FACADE_BASE + 1,
  Barracks: FACADE_BASE + 2,
  StationStone: FACADE_BASE + 3,
  StationOrientalist: FACADE_BASE + 4,
  OttomanHall: FACADE_BASE + 5,
  OttomanHall2: FACADE_BASE + 6,
  Harem: FACADE_BASE + 7,
  Museum: FACADE_BASE + 8,
  StoneOffices: FACADE_BASE + 9,
  PalacePlaster: FACADE_BASE + 10,
  ByzantineBrick: FACADE_BASE + 11,
} as const;

export type RGB = readonly [number, number, number];

/** Linear RGB albedos used by the builders (vertex tint; shaders add variation). */
export const Palette = {
  limestone: [0.52, 0.47, 0.39],
  limestoneLight: [0.64, 0.6, 0.52],
  limestoneGrey: [0.43, 0.41, 0.37],
  byzantineStone: [0.5, 0.45, 0.37],
  rubbleGrey: [0.4, 0.37, 0.33],
  marbleWhite: [0.78, 0.77, 0.74],
  marbleWarm: [0.76, 0.72, 0.64],
  plasterWhite: [0.72, 0.7, 0.66],
  plasterCream: [0.7, 0.62, 0.48],
  plasterOchre: [0.62, 0.48, 0.3],
  plasterPink: [0.68, 0.52, 0.45],
  stoneBuff: [0.58, 0.48, 0.37],
  stoneGreyPink: [0.5, 0.44, 0.4],
  brick: [0.42, 0.19, 0.11],
  brickDark: [0.3, 0.14, 0.09],
  lead: [0.34, 0.36, 0.39],
  slate: [0.09, 0.1, 0.115],
  tile: [0.4, 0.16, 0.08],
  granitePink: [0.48, 0.31, 0.27],
  graniteGrey: [0.32, 0.31, 0.3],
  bronze: [0.19, 0.3, 0.25],
  gold: [1.0, 0.76, 0.34],
  woodDark: [0.12, 0.075, 0.045],
  woodBrown: [0.22, 0.13, 0.07],
  earth: [0.2, 0.19, 0.12],
  paving: [0.4, 0.38, 0.35],
  iron: [0.045, 0.05, 0.05],
  voidDark: [0.015, 0.014, 0.013],
  lamp: [1.0, 0.85, 0.6],
  white: [0.8, 0.8, 0.78],
} as const satisfies Record<string, RGB>;
