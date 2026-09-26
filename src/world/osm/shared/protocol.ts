/**
 * Plain-data types shared by the main thread and every OSM layer worker (structured-clone friendly: no classes).
 */
import type { WorldBounds } from '../../../core/contracts';

/** Row-major window of a geo grid. */
export interface GridWin<T extends Float32Array | Uint8Array> {
  data: T;
  w: number;
  h: number;
  /** World x / z of the centre of the first cell. */
  x0: number;
  z0: number;
  cell: number;
}

/** Street raster over the build rect, built once by shared/foundation.worker.ts (see shared/street-field.ts). */
export interface StreetRaster {
  /**
   * RGBA8 fields (bilinear), row-major, texel (i, j) centred at (minX + (i + 0.5) px, minZ + (j + 0.5) px):
   * R signed distance to the nearest carriageway edge over ±MASK_RANGE (negative = on the carriageway), G distance to
   * the nearest building / BUILDING_RANGE, B sidewalk width / SIDEWALK_MAX, A signed distance to the nearest footway
   * / path over ±PATH_RANGE. Signed channels are piecewise linear: decode with street-field.ts decodeSigned().
   * The streets layer uploads it as the ground shader's street mask; read it through StreetSurface.
   */
  rgba: Uint8Array;
  /**
   * RGBA8 ids (nearest), same layout: R street surface (Surf) | flags of the winning street (street-field.ts
   * FLAG_*), G ground cover of OSM areas (Ground), B surface of the nearest path, A direction of the winning street
   * (atan2(dz, dx) folded to [0, pi), 0..255; StreetSurface.directionAt()).
   */
  ids: Uint8Array;
  w: number;
  h: number;
  minX: number;
  minZ: number;
  /** Texel size (m). */
  px: number;
  /**
   * Street tram tracks inside the rect as every layer draws them (tram-tracks.ts correctTramTracks: kerb-lane tracks
   * moved onto the carriageway), centre lines resampled every metre.
   */
  tracks: { pts: number[]; gauge: number; routes?: string[] }[];
  /** Kerb-lane move: samples moved / anchored in a flush bed; flush track bed length (m). */
  trackStats: { moved: number; kept: number; bedM: number };
}

/**
 * Base input every layer worker receives (a structured clone of OsmContext.base): the build rect, terrain windows
 * cut from the geo grids, landmark pads and the street raster. Workers wrap it with `new StreetSurface(base)`.
 */
export interface OsmWorkerBase {
  /** OSM_AREA plus the seam: where OSM content replaces procedural content. */
  rect: WorldBounds;
  /** OSM_AREA itself (a streamed region's own area). */
  area: WorldBounds;
  /**
   * Where the ground fades out into the terrain (OsmContext.fade; absent: `rect`). Content that avoids the fade margin
   * (quay walls, barriers) reads this, so it continues across edges shared with another region.
   */
  fade?: WorldBounds;
  height: GridWin<Float32Array>;
  /** Signed coast distance (m, positive on land). Same layout as `height`. */
  coast: GridWin<Float32Array>;
  /**
   * Signed coast distance the ground heights follow (the quay raise, StreetSurface.quayGridValues): always the flight
   * world's geo coast, so every OSM ground (runtime slice, compiled street tiles) has the same heights. Absent: `coast`
   * (the runtime slice, where `coast` is the geo coast). The compiler keeps its finer OSM shoreline in `coast` for land
   * and water only.
   */
  groundCoast?: GridWin<Float32Array>;
  landUse: GridWin<Uint8Array>;
  /** Landmark and mosque pads kept free of OSM buildings / ground: x, z, radius triples. */
  reserved: number[];
  street: StreetRaster;
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

/** Range (m) of the signed distance stored in StreetRaster R. */
export const MASK_RANGE = 8;
/** Largest sidewalk width (m) StreetRaster A can store. */
export const SIDEWALK_MAX = 4;
