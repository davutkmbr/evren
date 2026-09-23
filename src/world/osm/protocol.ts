/** Messages between the OSM system and its build worker. */
import type { WorldBounds } from '../../core/contracts';
import type { OsmData } from './area';

export interface GridWin<T extends Float32Array | Uint8Array> {
  data: T;
  w: number;
  h: number;
  /** World x / z of the centre of the first cell. */
  x0: number;
  z0: number;
  cell: number;
}

export interface OsmBuildRequest {
  data: OsmData;
  rect: WorldBounds;
  height: GridWin<Float32Array>;
  coast: GridWin<Float32Array>;
  landUse: GridWin<Uint8Array>;
  /** Landmark and mosque pads: x, z, radius triples. */
  reserved: number[];
}

export interface AttributeArrays {
  array: Float32Array | Uint8Array;
  size: number;
  normalized?: boolean;
}

export interface MeshArrays {
  attributes: Record<string, AttributeArrays>;
  index: Uint32Array;
}

/** Instance record: x, y, z, yaw, horizontal scale, vertical scale, r, g, b (linear). */
export const INSTANCE_STRIDE = 9;

/** Collider record: centre x, y, z, half sizes x, y, z, yaw. */
export const COLLIDER_STRIDE = 7;

export interface StreetMaskArrays {
  /** RGBA8: signed distance to the nearest carriageway edge ((d + 8) / 16), cobble weight, granite weight, sidewalk width / 4. */
  rgba: Uint8Array;
  size: number;
  /** R8 night light pools of the street lamps. */
  pool: Uint8Array;
  poolSize: number;
  minX: number;
  minZ: number;
  extent: number;
}

export interface OsmBuildResult {
  meshes: Record<string, MeshArrays>;
  instances: Record<string, Float32Array>;
  colliders: Float32Array;
  mask: StreetMaskArrays;
  stats: Record<string, number>;
}

export const MASK_RANGE = 8;
export const SIDEWALK_MAX = 4;
