import { WORLD_HALF_SIZE } from '../../core/geo-coords';

/** Edge length (m) of a finest-level (LOD 0) quadtree node (16 geo height cells; world edges fall on node edges). */
export const LEAF_SIZE = 375;
/** Number of LOD levels. The root (level LOD_COUNT - 1) covers the whole horizon square. */
export const LOD_COUNT = 10;
/** Root node edge (m): 375 · 2^9 = 192 km, i.e. ±96 km around the world centre (world square = level-6 nodes). */
export const ROOT_SIZE = LEAF_SIZE * 2 ** (LOD_COUNT - 1);
export const ROOT_MIN = -ROOT_SIZE / 2;

export const WORLD_HALF = WORLD_HALF_SIZE;

/** Geo height grid layout (matches world/geo HEIGHT_GRID: 2048² cells over the world square, cell-centred). */
export const GEO_HEIGHT_SIZE = 2048;
export const GEO_HEIGHT_CELL = (WORLD_HALF_SIZE * 2) / GEO_HEIGHT_SIZE;
export const GEO_HEIGHT_ORIGIN = -WORLD_HALF_SIZE + GEO_HEIGHT_CELL / 2;
/** Land-use grid (4096², nearest). */
export const GEO_LANDUSE_SIZE = 4096;

/** Horizon extension texture: covers the full root square. */
export const EXT_SIZE = 1024;
/** Width (m) outside the world edge over which the extension relaxes from the geo edge profile to its own relief. */
export const EXT_BLEND_OUTSIDE = 3500;

/** District/density raster (CPU baked, 512² over the world). */
export const DISTRICT_TEX_SIZE = 512;

/** Road segment spatial index: cells over the world square. */
export const ROAD_GRID_SIZE = 512;
/** Extra reach (m) of a segment beyond its half width that still shades (verges, lamp glow). */
export const ROAD_MARGIN = 16;
/** Street lamp spacing (m) along geo roads (matches the city's road lamps so ground pools sit under the lamp heads). */
export const ROAD_LAMP_SPACING = 38;

/** Tiling noise texture (RGBA8, 4 independent fbm fields). */
export const NOISE_TEX_SIZE = 512;

/** City carpet tiles (512², seen from kilometres away): layer order of the carpet array. */
export const CARPET_TILE_RES = 512;
export const CarpetLayer = { Dense: 0, Historic: 1, Modern: 2, Villa: 3, Industrial: 4 } as const;
export const CARPET_TILE_METERS = [384, 384, 512, 256, 640] as const;
export const CARPET_HEIGHT_RANGE = 60;

/** Natural canopy tiles (1024², also seen up close). */
export const NATURE_TILE_RES = 1024;
export const NatureLayer = { Forest: 0, Cemetery: 1 } as const;
export const NATURE_TILE_METERS = [160, 128] as const;
export const NATURE_HEIGHT_RANGE = 30;

/** Detail tiles (512²) used near the camera. */
export const DETAIL_TILE_RES = 512;
export const DetailLayer = { Asphalt: 0, Pavers: 1, Grass: 2, Soil: 3, Sand: 4, Rock: 5, ForestFloor: 6 } as const;
export const DETAIL_TILE_METERS = [24, 16, 8, 16, 16, 32, 8] as const;
export const DETAIL_HEIGHT_RANGE = 0.5;

/**
 * Shading tiers: every tier is its own program (one instanced draw each), so distant pixels run a small shader.
 * Patches of LOD 0 use the near tier, LOD 1..MID_MAX_LOD the mid tier, coarser ones the far tier.
 */
export const TerrainTier = { Near: 0, Mid: 1, Far: 2 } as const;
export type TerrainTierId = (typeof TerrainTier)[keyof typeof TerrainTier];
export const TIER_COUNT = 3;
export const MID_MAX_LOD = 2;

/** Quality dependent knobs derived from QualitySettings.terrainLodScale. */
export interface TerrainQuality {
  /** Quads per side of one render patch (a quarter node). Even. */
  patchQuads: number;
  /** LOD 0 range (m); level k uses baseRange · 2^k. */
  baseRange: number;
  /** Distance (m) up to which analytic roads are evaluated (clamped inside the mid tier). */
  roadDetailDistance: number;
  /** Distance (m) up to which detail tiles are sampled (inside the near tier). */
  detailDistance: number;
}

export function terrainQuality(lodScale: number): TerrainQuality {
  const s = Math.max(0.3, lodScale);
  // Must stay >= ~3.2 leaf sizes so a node never borders one two levels coarser (CDLOD morph invariant).
  const baseRange = Math.max(LEAF_SIZE * 3.25, 1300 * s);
  return {
    patchQuads: s >= 1.3 ? 32 : s >= 0.95 ? 24 : s >= 0.7 ? 16 : 12,
    baseRange,
    roadDetailDistance: Math.min(5000 * Math.min(1.4, Math.max(0.6, s)), baseRange * 2 ** MID_MAX_LOD * 0.96),
    detailDistance: Math.min(700 * Math.min(1.5, Math.max(0.6, s)), baseRange * 0.9),
  };
}
