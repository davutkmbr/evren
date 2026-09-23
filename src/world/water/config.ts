/**
 * Water module constants: detail-wave bands, Gerstner swell sets, regional optics, grid and reflection settings.
 * Units: meters, seconds, radians (degrees only where named ...Deg).
 */
import type { QualityPreset } from '../../core/quality';

export const GRAVITY = 9.81;
/** Surface tension / density of sea water (m^3/s^2), for the capillary term of the dispersion relation. */
export const SURFACE_TENSION = 7.4e-5;
export const WATER_IOR = 1.333;

/* ------------------------------------------------------------------ */
/* Detail normal bands                                                 */
/* ------------------------------------------------------------------ */

/**
 * Every band is a 128^2 tile holding the complex slope field P(x) of one annulus of the wave spectrum
 * (|k| between BAND_RING_MIN and BAND_RING_MAX cycles per tile). The whole annulus shares one angular frequency,
 * so the band evolves exactly as slope(x, t) = 2 Re[P(x) e^{-i w t}] (dispersion is band-quantised, +-12 %).
 * Tile sizes are not powers of two apart, so the sum of bands never repeats visibly.
 */
export const BAND_COUNT = 10;
export const BAND_SIZE = 128;
export const BAND_RING_MIN = 8;
export const BAND_RING_MAX = 13;
/** Longest wavelength of band 0 (m); each next band is BAND_RING_MAX / BAND_RING_MIN shorter. */
export const BAND_LAMBDA_MAX = 12;
export const BAND_RATIO = BAND_RING_MAX / BAND_RING_MIN;
/** Tiny per-band tile jitter so tile periods stay incommensurate. */
const BAND_TILE_JITTER = [1.0, 1.017, 0.989, 1.023, 0.994, 1.011, 0.982, 1.007, 1.019, 0.996];

export interface BandSpec {
  index: number;
  /** Tile size (m). */
  tile: number;
  /** Longest and shortest wavelength in the band (m). */
  lambdaMax: number;
  lambdaMin: number;
  /** Geometric mean wavelength (m). */
  lambda: number;
  /** Angular frequency shared by the band (rad/s). */
  omega: number;
  /** Directional spreading exponent (cos^2s of half angle). */
  spread: number;
  /** Mean square slope (sx^2 + sz^2) of the band at the reference wind (U10 = 7 m/s). */
  msSlope: number;
  /** Wind exponent: msSlope scales with (U10 / 7)^windExp. */
  windExp: number;
}

export function dispersion(k: number): number {
  return Math.sqrt(GRAVITY * k + SURFACE_TENSION * k * k * k);
}

export const BANDS: readonly BandSpec[] = Array.from({ length: BAND_COUNT }, (_, b) => {
  const lambdaMax = BAND_LAMBDA_MAX / BAND_RATIO ** b;
  const lambdaMin = lambdaMax / BAND_RATIO;
  const lambda = Math.sqrt(lambdaMax * lambdaMin);
  const t = b / (BAND_COUNT - 1);
  return {
    index: b,
    tile: BAND_RING_MIN * lambdaMax * BAND_TILE_JITTER[b],
    lambdaMax,
    lambdaMin,
    lambda,
    omega: dispersion((2 * Math.PI) / lambda),
    spread: 7 - 5.2 * t,
    // Equilibrium range: equal slope variance per log wavenumber (Phillips), Cox-Munk total ~0.04 at 7 m/s.
    msSlope: 0.0032 + 0.0012 * t,
    windExp: 0.45 + 1.0 * t,
  };
});

/** Unresolved capillary slope variance below the finest band at U10 = 7 m/s. */
export const CAPILLARY_MS_SLOPE = 0.006;

/** Flow-map period for advecting the detail bands with the surface current (s). */
export const FLOW_PERIOD = 7;

/* ------------------------------------------------------------------ */
/* Gerstner waves (vertex displacement + analytic per-pixel normals)   */
/* ------------------------------------------------------------------ */

export const enum WaveGroup {
  /** Short wind sea (all open water incl. the Bosphorus). */
  Short = 0,
  /** Longer wind sea of the open Marmara / Black Sea. */
  Long = 1,
  /** Black Sea swell entering from the north. */
  Swell = 2,
}

export interface GerstnerSpec {
  lambda: number;
  /** Propagation direction relative to the regime's downwind heading (deg). */
  dirOffsetDeg: number;
  /** Amplitude at group weight 1 and reference wind (m). */
  amplitude: number;
  group: WaveGroup;
  /** Crest sharpening Q*k*A at weight 1 (sum over waves must stay < 1). */
  steepness: number;
  phase: number;
}

/** Poyraz (NE wind) seas travel toward SSW; lodos seas are the same set turned around. */
export const POYRAZ_DOWNWIND_DEG = 212;
export const LODOS_DOWNWIND_DEG = 38;
/** Swell from the Black Sea always runs toward SSW. */
export const SWELL_HEADING_DEG = 200;

/**
 * Amplitudes: Hs = 4 sqrt(sum A^2 / 2). Short group ~0.33 m (Bosphorus chop), short + long ~0.8 m (Marmara),
 * + swell ~1.3 m (Black Sea) at U10 = 7 m/s.
 */
export const GERSTNER_WAVES: readonly GerstnerSpec[] = [
  { lambda: 13.7, dirOffsetDeg: 0, amplitude: 0.072, group: WaveGroup.Short, steepness: 0.075, phase: 0.3 },
  { lambda: 10.9, dirOffsetDeg: -27, amplitude: 0.058, group: WaveGroup.Short, steepness: 0.07, phase: 2.1 },
  { lambda: 8.8, dirOffsetDeg: 21, amplitude: 0.047, group: WaveGroup.Short, steepness: 0.065, phase: 4.4 },
  { lambda: 7.1, dirOffsetDeg: -11, amplitude: 0.037, group: WaveGroup.Short, steepness: 0.06, phase: 1.2 },
  { lambda: 5.6, dirOffsetDeg: 37, amplitude: 0.028, group: WaveGroup.Short, steepness: 0.055, phase: 5.6 },
  { lambda: 37.5, dirOffsetDeg: 7, amplitude: 0.17, group: WaveGroup.Long, steepness: 0.06, phase: 0.9 },
  { lambda: 28.6, dirOffsetDeg: -19, amplitude: 0.135, group: WaveGroup.Long, steepness: 0.055, phase: 3.3 },
  { lambda: 21.9, dirOffsetDeg: 25, amplitude: 0.105, group: WaveGroup.Long, steepness: 0.05, phase: 5.0 },
  { lambda: 104, dirOffsetDeg: 0, amplitude: 0.34, group: WaveGroup.Swell, steepness: 0.035, phase: 1.7 },
  { lambda: 79, dirOffsetDeg: 9, amplitude: 0.24, group: WaveGroup.Swell, steepness: 0.03, phase: 4.1 },
];

/** Wave slots in the shader: the poyraz set followed by the lodos set (swell only once). */
export const MAX_WAVES = 18;

/* ------------------------------------------------------------------ */
/* Regions (water body optics)                                         */
/* ------------------------------------------------------------------ */

export interface WaterOptics {
  /** Remote-sensing reflectance of optically deep water (1/sr), linear RGB. */
  rrs: readonly [number, number, number];
  /** Diffuse attenuation Kd (1/m), linear RGB. */
  attenuation: readonly [number, number, number];
  /** Multiplier on small-scale slope variance (sheltered water is glassier). */
  roughness: number;
  /** Sea-floor albedo in shallow water. */
  floor: readonly [number, number, number];
}

/** Order matches the region texture channels (R G B A) + the lake channel of the flow texture. */
export const REGION_OPTICS: Record<'blackSea' | 'bosphorus' | 'marmara' | 'goldenHorn' | 'lake', WaterOptics> = {
  blackSea: { rrs: [0.0011, 0.0027, 0.0052], attenuation: [0.42, 0.1, 0.085], roughness: 1.05, floor: [0.36, 0.34, 0.28] },
  bosphorus: { rrs: [0.0014, 0.0043, 0.0059], attenuation: [0.48, 0.14, 0.13], roughness: 1.0, floor: [0.3, 0.3, 0.26] },
  marmara: { rrs: [0.0019, 0.0058, 0.005], attenuation: [0.52, 0.18, 0.21], roughness: 1.0, floor: [0.4, 0.37, 0.29] },
  goldenHorn: { rrs: [0.0031, 0.0055, 0.0033], attenuation: [0.75, 0.42, 0.55], roughness: 0.5, floor: [0.22, 0.21, 0.16] },
  lake: { rrs: [0.0026, 0.0042, 0.0026], attenuation: [0.8, 0.45, 0.6], roughness: 0.4, floor: [0.2, 0.19, 0.14] },
};

/** Region / flow textures cover the whole world square. */
export const REGION_GRID_SIZE = 512;
/** Target 90th percentile of the Bosphorus surface current (m/s) and hard cap. */
export const CURRENT_P90 = 1.9;
export const CURRENT_MAX = 3.1;

/* ------------------------------------------------------------------ */
/* Geometry / quality                                                   */
/* ------------------------------------------------------------------ */

export interface WaterQuality {
  /** Angular segments of the radial surface grid. */
  segments: number;
  /** Detail bands evaluated per pixel. */
  bands: number;
  planar: boolean;
  /** Planar reflection resolution relative to the internal render size. */
  reflectionScale: number;
  /**
   * MSAA samples of the planar reflection. The mirror renders at a fraction of the screen resolution and is magnified
   * 2-3x on calm water, so aliased silhouettes (shore, bridge deck, towers against the sky) would show as stair steps.
   */
  reflectionSamples: number;
}

export function waterQualityFor(preset: QualityPreset, reflections: 'sky' | 'planar'): WaterQuality {
  switch (preset) {
    case 'low':
      return { segments: 112, bands: 7, planar: reflections === 'planar', reflectionScale: 0.4, reflectionSamples: 0 };
    case 'medium':
      return { segments: 160, bands: 9, planar: reflections === 'planar', reflectionScale: 0.5, reflectionSamples: 2 };
    case 'high':
      return { segments: 224, bands: BAND_COUNT, planar: reflections === 'planar', reflectionScale: 0.5, reflectionSamples: 4 };
    case 'ultra':
    default:
      return { segments: 288, bands: BAND_COUNT, planar: reflections === 'planar', reflectionScale: 0.6, reflectionSamples: 4 };
  }
}

/** Radial grid: innermost ring radius (m) and outer extent (m, beyond the camera far plane). */
export const GRID_INNER_RADIUS = 1.2;
export const GRID_EXTENT = 64000;
/** The shading origin snaps to this lattice (keeps world-relative coordinates small for fp32). */
export const ORIGIN_SNAP = 2048;
