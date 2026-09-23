import type { QualitySettings } from '../../core/quality';

/** Streaming tile edge (m). */
export const TILE_SIZE = 256;

/** Object layer seen only by the shadow cameras (they enable every layer): LOD1 shadow proxies. */
export const SHADOW_ONLY_LAYER = 5;

export interface VegetationLodConfig {
  /** LOD0 -> LOD1 switch distance (m) and half width of the dithered cross-fade band. */
  lod0: number;
  lod0Fade: number;
  /** LOD1 -> impostor switch distance (m) and cross-fade half width. */
  lod1: number;
  lod1Fade: number;
  /** Trees closer than this cast shadows with their LOD1 mesh; farther ones with their impostor card. */
  meshShadowRange: number;
  /** Tiles closer than this go to the shadow casting impostor pool. */
  impostorShadowRange: number;
  /** Instance draw radius (m). */
  drawDistance: number;
  /** Full density up to this distance, thinned as (full / d)^2 beyond it. */
  fullDensityDistance: number;
  densityScale: number;
  /** Octahedral impostor frame size (px) and frames per side. */
  impostorFrame: number;
  impostorFrames: number;
  /** Bark / foliage texture layer size (px). */
  textureSize: number;
  /** Rough triangle budget used by the adaptive LOD governor. */
  triangleBudget: number;
  anisotropy: number;
}

export function lodConfigFor(q: QualitySettings): VegetationLodConfig {
  const draw = q.treeDrawDistance;
  switch (q.preset) {
    case 'low':
      return {
        lod0: 22,
        lod0Fade: 2,
        lod1: 95,
        lod1Fade: 4,
        meshShadowRange: 30,
        impostorShadowRange: 320,
        drawDistance: draw,
        fullDensityDistance: draw * 0.3,
        densityScale: q.treeDensityScale,
        impostorFrame: 96,
        impostorFrames: 8,
        textureSize: 256,
        triangleBudget: 500_000,
        anisotropy: q.anisotropy,
      };
    case 'medium':
      return {
        lod0: 30,
        lod0Fade: 2.5,
        lod1: 120,
        lod1Fade: 5,
        meshShadowRange: 45,
        impostorShadowRange: 500,
        drawDistance: draw,
        fullDensityDistance: draw * 0.28,
        densityScale: q.treeDensityScale,
        impostorFrame: 128,
        impostorFrames: 8,
        textureSize: 512,
        triangleBudget: 900_000,
        anisotropy: q.anisotropy,
      };
    case 'ultra':
      return {
        lod0: 55,
        lod0Fade: 3.5,
        lod1: 190,
        lod1Fade: 7,
        meshShadowRange: 80,
        impostorShadowRange: 1000,
        drawDistance: draw,
        fullDensityDistance: draw * 0.25,
        densityScale: q.treeDensityScale,
        impostorFrame: 128,
        impostorFrames: 8,
        textureSize: 512,
        triangleBudget: 2_200_000,
        anisotropy: q.anisotropy,
      };
    case 'high':
    default:
      return {
        lod0: 40,
        lod0Fade: 3,
        lod1: 150,
        lod1Fade: 6,
        meshShadowRange: 60,
        impostorShadowRange: 700,
        drawDistance: draw,
        fullDensityDistance: draw * 0.25,
        densityScale: q.treeDensityScale,
        impostorFrame: 128,
        impostorFrames: 8,
        textureSize: 512,
        triangleBudget: 1_450_000,
        anisotropy: q.anisotropy,
      };
  }
}

/** Continuous far-thinning fraction for a tree at distance d (GPU uses the same formula). */
export function keepFraction(d: number, cfg: VegetationLodConfig): number {
  if (d <= cfg.fullDensityDistance) {
    return 1;
  }
  const r = cfg.fullDensityDistance / d;
  return Math.max(r * r, 0.06);
}

const KEEP_LEVELS = [1, 0.72, 0.52, 0.38, 0.28, 0.2, 0.14, 0.1, 0.07];

/** Quantised keep level for a tile whose nearest point is at distance d (always >= keepFraction(d)). */
export function tileKeepLevel(d: number, cfg: VegetationLodConfig): number {
  const k = keepFraction(d, cfg);
  let level = KEEP_LEVELS[0];
  for (const l of KEEP_LEVELS) {
    if (l >= k - 1e-6) {
      level = l;
    }
  }
  return level;
}
