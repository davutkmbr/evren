/**
 * Shared vocabulary between the city main thread and its generation workers: message shapes, the
 * vertex format of every city chunk and the small integer enums both sides encode into it.
 *
 * Vertex format (identical for every LOD so one program draws all chunks):
 *   position  Float32 x3   tile-local metres (mesh sits at the tile centre, y absolute)
 *   normal    Int8 x4 (normalized)  geometric normal (only used for shadow normal bias; shading uses derivatives)
 *   aFacade   Int16 x4     [u*16, v*16, column spacing cm (0 = blank), face flags]
 *   aColor    Uint8 x4     [r, g, b (sRGB), surface kind | fade class << 5]
 *   aParams   Uint8 x4     [seed, floor height dm, ground floor height dm, style bits]
 */

export const Kind = {
  Wall: 0,
  Stone: 1,
  Wood: 2,
  Curtain: 3,
  RoofTile: 4,
  RoofFlat: 5,
  RoofMetal: 6,
  Slab: 7,
  Railing: 8,
  Solar: 9,
  Metal: 10,
  Beacon: 11,
  Glazed: 12,
  Awning: 13,
  Chimney: 14,
  Dark: 15,
  Soffit: 16,
} as const;

export const WinType = {
  Apartment: 0,
  Historic: 1,
  Curtain: 2,
  Ribbon: 3,
  Industrial: 4,
  Villa: 5,
  Yali: 6,
  Mass: 7,
} as const;

export const Usage = {
  Residential: 0,
  Office: 1,
  Commercial: 2,
  Industrial: 3,
} as const;

/**
 * Distance fade classes of far chunks (stored in aColor.w bits 5-7). Buildings are emitted most important first so a
 * far tile can drop the tail of its index buffer (drawRange) once every building in it has faded out.
 */
export const FadeClass = {
  /** Towers and landmarks of the skyline: visible up to the edge of the draw distance. */
  Skyline: 0,
  /** Large or tall buildings (>= 18 m or >= 700 m²). */
  Large: 1,
  /** Mid-rise apartment blocks. */
  Mid: 2,
  /** Small buildings (< 12 m). */
  Small: 3,
} as const;
export const FADE_CLASS_COUNT = 4;
export const KIND_MASK = 31;
export const FADE_SHIFT = 5;

/** Roof appearance of the top face in compact (far) chunks. */
export const RoofTop = {
  Flat: 0,
  Tile: 1,
  Metal: 2,
  Terrace: 3,
} as const;

/** Bits of aFacade.w. */
export const Face = {
  RoleFront: 0,
  RoleBack: 1,
  RoleSide: 2,
  RoleParty: 3,
  Shop: 1 << 2,
  Door: 1 << 3,
  BalconyDoors: 1 << 4,
  WorldU: 1 << 5,
  Balconies: 1 << 6,
  Old: 1 << 7,
  FloorsShift: 8,
} as const;

export const Style = {
  Historic: 0,
  Dense: 1,
  Modern: 2,
  Highrise: 3,
  Villa: 4,
  Yali: 5,
  Industrial: 6,
  Suburban: 7,
} as const;
export type StyleId = (typeof Style)[keyof typeof Style];

export const STYLE_BY_NAME: Record<string, StyleId> = {
  historic: Style.Historic,
  dense: Style.Dense,
  modern: Style.Modern,
  highrise: Style.Highrise,
  villa: Style.Villa,
  yali: Style.Yali,
  industrial: Style.Industrial,
  suburban: Style.Suburban,
};

/** LOD levels: 0 = near (full detail), 1 = mid (compact), 2 = far (boxes, only notable buildings). */
export const LEVEL_SIZES = [500, 1000, 2000] as const;
export const LEVEL_COUNT = LEVEL_SIZES.length;
/** Layout generation cell (m). Tiles of every level are unions of these. */
export const BASE_CELL = 250;

export interface GridSpecMsg {
  size: number;
  cell: number;
  origin: number;
}

export interface RoadMsg {
  /** 0 highway, 1 avenue, 2 street, 3 bridge, 4 coastal */
  kind: number;
  width: number;
  /** Flat x, z pairs. */
  pts: Float32Array;
}

export interface DistrictMsg {
  x: number;
  z: number;
  style: StyleId;
  density: number;
  floorsMean: number;
  floorsMax: number;
  /** 0 europe, 1 asia, 2 island */
  side: number;
}

export interface CityInitMessage {
  type: 'init';
  landUse: GridSpecMsg;
  height: GridSpecMsg;
  roads: RoadMsg[];
  coasts: Float32Array[];
  districts: DistrictMsg[];
  /** Coarse district index grid (255 = none). */
  districtGrid: { data: Uint8Array; spec: GridSpecMsg };
  /** Coarse terrain heights for superblock orientation. */
  heightCoarse: { data: Float32Array; spec: GridSpecMsg };
}

/** Fine geography around a request, cut from the geo grids on the main thread. */
export interface GeoWindowMsg {
  /** Land-use cells: first column/row index in the land-use grid, window size. */
  luC0: number;
  luR0: number;
  luW: number;
  luH: number;
  lu: Uint8Array;
  /** Height-grid lattice window (heights, coast distance and density share it). */
  hC0: number;
  hR0: number;
  hW: number;
  hH: number;
  h: Float32Array;
  coast: Float32Array;
  dens: Float32Array;
}

export interface TileRequestMsg {
  type: 'tile';
  id: number;
  level: number;
  ix: number;
  iz: number;
  densityScale: number;
  win: GeoWindowMsg;
}

export interface ColliderRequestMsg {
  type: 'colliders';
  id: number;
  ix: number;
  iz: number;
  size: number;
  densityScale: number;
  win: GeoWindowMsg;
}

/** Drops cached cell layouts overlapping a rectangle (the exclusion list changed there, geo-window.ts). */
export interface ForgetMsg {
  type: 'forget';
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type CityWorkerRequest = CityInitMessage | TileRequestMsg | ColliderRequestMsg | ForgetMsg;

export interface ChunkArrays {
  position: Float32Array;
  normal: Int8Array;
  facade: Int16Array;
  color: Uint8Array;
  params: Uint8Array;
  index: Uint16Array | Uint32Array;
}

export interface TileResultMsg {
  type: 'tile';
  id: number;
  /** Null when the tile holds no buildings. */
  mesh: ChunkArrays | null;
  /** Tile-local bounding sphere [x, y, z, r]. */
  sphere: [number, number, number, number];
  /** World positions of street lights / beacons (x, y, z). */
  lampPos: Float32Array;
  /** Lamp colour (sRGB) + type byte (1 street, 2 road, 3 beacon, 4 shop). */
  lampCol: Uint8Array;
  buildings: number;
  /** Cumulative index counts after each fade class (Skyline..Small); only meaningful for far tiles. */
  classEnds: number[];
  /** Index count of the structural geometry; fine details (railings, rooftop clutter...) follow it. */
  detailStart: number;
  /** Some part of the tile lies within ~450 m of the water (it can show up in the water's planar reflection). */
  nearWater: boolean;
  ms: number;
}

export interface ColliderResultMsg {
  type: 'colliders';
  id: number;
  /** Per box: cx, cy, cz, hx, hy, hz, yaw. */
  boxes: Float32Array;
  ms: number;
}

export type CityWorkerResult = TileResultMsg | ColliderResultMsg;

export const COLLIDER_STRIDE = 7;
