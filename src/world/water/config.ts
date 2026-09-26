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
  /** Bosphorus-scale wind sea (a few km of fetch): all open water incl. the Bosphorus. */
  Short = 0,
  /** Longer wind sea of the open Marmara / Black Sea (tens of km of fetch). */
  Long = 1,
  /** Swell: from the Black Sea in a poyraz, from the Marmara in a lodos. */
  Swell = 2,
  /** Short fetch-limited chop (~1.5 km of fetch): sheltered water, the Golden Horn, harbours, lakes. */
  Chop = 3,
}

/**
 * One Gerstner slot. Wavelengths and directions are fixed (a slot never changes its wavenumber or heading, so the
 * origin-relative phases stay continuous); the amplitude of every slot comes from the wind-wave spectrum each frame
 * (spectrum.ts: JONSWAP for the group's fetch, integrated over the slot's frequency bin).
 */
export interface GerstnerSpec {
  lambda: number;
  /** Propagation direction relative to the regime's downwind heading (deg): a fixed sample of the spreading lobe. */
  dirOffsetDeg: number;
  group: WaveGroup;
  phase: number;
}

/** Poyraz (NE wind) seas travel toward SSW (along the Bosphorus); lodos (SW wind) seas travel toward NE. */
export const POYRAZ_DOWNWIND_DEG = 212;
export const LODOS_DOWNWIND_DEG = 38;
/** Swell headings: Black Sea swell toward SSW in a poyraz, Marmara swell toward NE in a lodos. */
export const SWELL_HEADING_DEG = 200;
export const LODOS_SWELL_HEADING_DEG = 42;

/**
 * The wind-sea slot lattice, shared by both regimes (the lodos set is the same lattice turned around). Wavelengths
 * step by ~1.4 from 2.2 m to 66 m: the chop class peaks in the first three, the short (Bosphorus) class in the next
 * three, the long class from 17 m up (its fully developed peak at 4 m/s is ~17 m). Direction offsets sample the
 * cos^2s(theta / 2) spreading lobe (Mitsuyasu) at a representative spreading per group: chop s ~ 5 (rms 33 deg),
 * short s ~ 7 (29 deg), long s ~ 10 (25 deg); the longest slot of each group sits closest to the mean direction.
 */
export const GERSTNER_WAVES: readonly GerstnerSpec[] = [
  { lambda: 2.2, dirOffsetDeg: 30, group: WaveGroup.Chop, phase: 2.7 },
  { lambda: 3.2, dirOffsetDeg: -26, group: WaveGroup.Chop, phase: 0.6 },
  { lambda: 4.6, dirOffsetDeg: 8, group: WaveGroup.Chop, phase: 4.9 },
  { lambda: 6.3, dirOffsetDeg: -30, group: WaveGroup.Short, phase: 5.6 },
  { lambda: 8.7, dirOffsetDeg: 23, group: WaveGroup.Short, phase: 1.2 },
  { lambda: 12.1, dirOffsetDeg: -8, group: WaveGroup.Short, phase: 4.4 },
  { lambda: 17, dirOffsetDeg: 26, group: WaveGroup.Long, phase: 0.3 },
  { lambda: 24, dirOffsetDeg: -19, group: WaveGroup.Long, phase: 5.0 },
  { lambda: 34, dirOffsetDeg: 12, group: WaveGroup.Long, phase: 3.3 },
  { lambda: 48, dirOffsetDeg: -6, group: WaveGroup.Long, phase: 0.9 },
  { lambda: 66, dirOffsetDeg: 2, group: WaveGroup.Long, phase: 2.2 },
];

/** Swell slots (narrow spectrum, s ~ 30: rms 14 deg) per regime, relative to the regime's swell heading. */
export const SWELL_WAVES: { poyraz: readonly GerstnerSpec[]; lodos: readonly GerstnerSpec[] } = {
  poyraz: [
    { lambda: 79, dirOffsetDeg: 9, group: WaveGroup.Swell, phase: 4.1 },
    { lambda: 104, dirOffsetDeg: 0, group: WaveGroup.Swell, phase: 1.7 },
  ],
  lodos: [
    { lambda: 41, dirOffsetDeg: -8, group: WaveGroup.Swell, phase: 3.6 },
    { lambda: 54, dirOffsetDeg: 0, group: WaveGroup.Swell, phase: 0.4 },
  ],
};

/**
 * Wind-wave spectrum (phase 21 stage 7a, spectrum.ts). Fetch-limited JONSWAP (Hasselmann et al. 1973):
 * X = g F / U10^2, Hs = 1.6e-3 sqrt(X) U10^2 / g, Tp = 0.286 X^(1/3) U10 / g, growth capped at the fully developed
 * sea (X = 22 500, Pierson-Moskowitz). Each group stands for a fetch class; the baked fetch-exposure map decides
 * where each group is present (waveGroupWeights in the shaders, groupsAt on the CPU).
 */
export const SEA_SPECTRUM = {
  /** JONSWAP peak enhancement of the wind sea and of the (narrower) swell. */
  gamma: 3.3,
  swellGamma: 6,
  /**
   * Effective fetch per group (m). Long: the duration-limited Black Sea sea in a poyraz, the sea built across the
   * Marmara toward the Istanbul shore in a lodos.
   */
  fetchChop: 1000,
  fetchShort: 4000,
  fetchLongPoyraz: 100_000,
  fetchLongLodos: 45_000,
  /** Dimensionless fetch of the fully developed sea. */
  fullyDeveloped: 22_500,
  /** Swell per regime: peak period (s) and Hs = hsBase + hsPerU10 * U10 (m). */
  swellPoyraz: { tp: 8.2, hsBase: 0.45, hsPerU10: 0.05 },
  swellLodos: { tp: 5.6, hsBase: 0.1, hsPerU10: 0.04 },
  /** Shortest wavelength the Gerstner lattice carries (m): shorter waves are the detail bands' job. */
  lambdaMin: 1.6,
  /** Crest sharpening Q per group (Q*k*A per slot), Short / Long / Swell / Chop. */
  crest: [1.6, 2.0, 1.5, 1.0] as readonly number[],
  /** No single slot is steeper than this (k*A). */
  maxSlotSteepness: 0.26,
} as const;

/** Wave slots in the shader: 13 poyraz slots (lattice + swell) followed by 13 lodos slots. */
export const MAX_WAVES = 26;

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
