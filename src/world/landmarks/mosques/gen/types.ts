/**
 * Shared data types of the mosque generator (runs in a worker, no three.js dependency).
 *
 * Building space: meters, Y-up, origin on the floor at the complex centre, -Z = qibla (mihrab side), +Z = entrance.
 */

/** Surface material ids interpreted by the mosque uber-shader (render/glsl.ts). */
export const Mat = {
  Stone: 0,
  Smooth: 1,
  Carved: 2,
  Lead: 3,
  Glass: 4,
  Gold: 5,
  Plaster: 6,
  Brick: 7,
  Marble: 8,
  Paving: 9,
  Lamp: 10,
  Dark: 11,
  Tile: 12,
  Banded: 13,
} as const;
export type MatId = (typeof Mat)[keyof typeof Mat];

/** Night lighting profile ids (floodlight model in the shader). */
export const Light = {
  None: 0,
  /** Ground uplights on facades: uses height above `lightBase`. */
  Facade: 1,
  /** Dome lit from its springing ring. */
  Dome: 2,
  /** Minaret shaft: downlights under each balcony (`lightTop`) + base uplight. */
  Minaret: 3,
  /** The light fixture itself (balcony light rings, lanterns). */
  Lamp: 4,
  /** Minaret cap lit from the top balcony. */
  Cap: 5,
  /** Portico soffits and arcade interiors (warm lanterns). */
  Soffit: 6,
  /** Courtyard paving / terraces. */
  Ground: 7,
} as const;
export type LightId = (typeof Light)[keyof typeof Light];

export type RGB = readonly [number, number, number];
export type V3 = [number, number, number];

/** Raw indexed geometry transferable from the worker. */
export interface GeomData {
  position: Float32Array;
  /** Signed normalized xyz + pad (4 bytes per vertex keeps attributes 4-byte aligned). */
  normal: Int8Array;
  /** Surface coordinates, meters for most materials (see builder). */
  uv: Float32Array;
  /** sRGB tint (rgb) + ambient occlusion (a), normalized u8. */
  tint: Uint8Array;
  /** u16: material id, height above light base (dm), light id * 4096 + distance below light top (dm), extra (seed). */
  data: Uint16Array;
  index: Uint32Array;
  /** [minX, minY, minZ, maxX, maxY, maxZ, sphereX, sphereY, sphereZ, sphereR] in model space. */
  bounds: number[];
}

export type LocalCollider =
  /** `open`: an arcade drawn as columns under a roof (portico), not a solid wall; neighbourhood mosques skip it. */
  | { kind: 'box'; cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; yaw: number; open?: boolean }
  | { kind: 'cylinder'; x: number; y: number; z: number; r: number; h: number }
  | { kind: 'sphere'; x: number; y: number; z: number; r: number };

export interface BuiltModel {
  id: string;
  /** Indexed by LodLevel: [detailed, simplified, silhouette]; null when that level was not requested. */
  lods: (GeomData | null)[];
  colliders: LocalCollider[];
  /** Horizontal radius of the footprint (m). */
  radius: number;
  /** Top of the tallest element (m above floor). */
  height: number;
  /** Neighbourhood prototypes: footprint radius used for site matching and whether it is a hipped-roof mescit. */
  footprint?: number;
  pitched?: boolean;
}

/** 0 = full detail (real openings, mouldings), 1 = simplified (overlay glazing), 2 = low-poly silhouette. */
export type LodLevel = 0 | 1 | 2;
