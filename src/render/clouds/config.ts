/**
 * Cloud layer constants (meters). Late-September Istanbul fair-weather cumulus:
 * bases ~1300-1800 m, tops ~2400-3200 m, 30-45 % sky cover, occasional thin stratocumulus, high cirrus.
 */
export const CLOUD_CONSTANTS = {
  planetRadius: 6_371_000,
  /** Raymarch shell (union of every volumetric cloud type). */
  layerBottom: 1150,
  layerTop: 3350,
  cumulusBaseMean: 1520,
  cumulusBaseVariation: 360,
  cumulusThicknessMin: 260,
  cumulusThicknessMax: 1550,
  stratoBase: 1260,
  stratoThickness: 360,
  cirrusHeight: 8600,
  /** Tiling periods of the procedural textures (weather is a multiple of the 3D noise periods). */
  weatherPeriod: 40960,
  baseNoisePeriod: 4096,
  detailNoisePeriod: 512,
  cirrusPeriod: 61440,
  /** Extinction coefficient (1/m) at density 1. Real cumulus ~0.03-0.08 1/m. */
  extinction: 0.055,
  /** Wind at cloud level relative to the 100 m wind. */
  windScale: 1.7,
  cirrusWindScale: 3.2,
  /** Upward drift of the noise field (m/s): slow convective billowing. */
  evolveSpeed: 0.9,
  maxDistance: 110_000,
} as const;

export const BASE_NOISE_SIZE = 128;
export const DETAIL_NOISE_SIZE = 32;
export const WEATHER_SIZE = 1024;
export const CIRRUS_SIZE = 512;
export const GLOW_SIZE = 96;
/** City-glow map extent (m, square centred on the world origin). */
export const GLOW_EXTENT = 64_000;

export interface CloudQualityLevel {
  /** Low-res buffer = full / divisor. */
  divisor: number;
  /** Max march iterations per ray (early termination keeps the average far lower). */
  steps: number;
  /** Fine step length relative to distance. */
  stepRel: number;
  lightSteps: number;
  shadowMapSize: number;
  /** Shadow extent in meters (square). */
  shadowExtent: number;
}

export const CLOUD_QUALITY_LEVELS: Record<1 | 2 | 3, CloudQualityLevel> = {
  1: { divisor: 4, steps: 64, stepRel: 0.055, lightSteps: 3, shadowMapSize: 384, shadowExtent: 32_000 },
  2: { divisor: 3, steps: 88, stepRel: 0.045, lightSteps: 4, shadowMapSize: 512, shadowExtent: 36_000 },
  3: { divisor: 2, steps: 112, stepRel: 0.034, lightSteps: 5, shadowMapSize: 768, shadowExtent: 40_000 },
};
