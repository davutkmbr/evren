/**
 * Phase 21 stage 7a tunables: wave particles (the interactive part of the sea) and their GPU splat window.
 * Units: metres, seconds, m/s, radians.
 */
import type { QualityPreset } from '../../../core/quality';

export const WAVE_PARTICLES = {
  /** Shortest / longest particle wavelength (m). */
  minLambda: 1.5,
  maxLambda: 70,
  /** Upper bound on any particle's lifetime (s) and the amplitude below which it dies (m). */
  maxLife: 50,
  minAmplitude: 0.004,
  /** Amplitude decay: base rate (1/s) plus a rate per unit wavenumber (short waves die sooner: breaking, viscosity). */
  damping: 1 / 150,
  dampingPerK: 0.006,
  /** Fade-in time (s) of a new particle (a new crest grows instead of popping up). */
  fadeIn: 0.35,
  /**
   * Subdivision (Yuksel et al. 2007): a particle whose front half-width (dispersion angle x radius) exceeds
   * max(splitLambdas x wavelength, splitMin) splits into three with a third of the dispersion angle each, while its
   * amplitude is above splitAmplitude and its generation below maxGeneration (otherwise its kernel just widens).
   */
  splitLambdas: 1.8,
  splitMin: 6,
  splitAmplitude: 0.015,
  maxGeneration: 2,
  /** Particles farther than this share of the emission range from the camera die (m / m). */
  keepRangeShare: 1.35,
  /** Coast test: a particle over land (coast distance above this, m) dies; a sixth of the pool is tested each frame. */
  coastKill: -1,
  /** Spatial hash for the queries: cell size (m) and bucket count (power of two). */
  cell: 32,
  buckets: 4096,
} as const;

/** Hull emitters (bow and stern waves of moving vessels, the swimming or skimming dragon). */
export const HULL_WAVES = {
  /** Below this speed through the water a hull emits nothing (m/s). */
  minSpeed: 0.8,
  /** Direction classes per side (near / beyond farRange from the camera; far hulls emit no stern wave). */
  classes: 4,
  classesFar: 3,
  farRange: 350,
  /** Shortest emitted wavelength: max(minLambda, beamShare x beam) (waves much shorter than the beam cancel). */
  beamShare: 0.25,
  /** Emission interval in wave periods (the particles of a class then tile along the wave vector). */
  emitPeriods: 1,
  /**
   * Characteristic amplitude (m): ampScale x sqrt(beam x draft) x Fr^2 / (1 + (Fr / frKnee)^3), Fr = U / sqrt(g L).
   * Displacement hulls peak near hull speed; planing hulls keep a smaller, mostly divergent wake.
   */
  ampScale: 1.0,
  frKnee: 0.5,
  maxAmplitude: 0.6,
  /** Stern wave (a trough) relative to the bow wave. */
  sternShare: 0.6,
  /** Transverse classes (theta < 25 deg) fade with Froude number: weight = clamp(transverseBase - transverseFr x Fr). */
  transverseBase: 1.4,
  transverseFr: 1.6,
  /** Initial front half-width: max(beamWidth x beam, lambdaWidth x wavelength) (m). */
  beamWidth: 0.5,
  lambdaWidth: 0.25,
  /** A hull not heard from for this long is forgotten (s). */
  forget: 3,
} as const;

/** Circular wave trains (splashes, plunges, breaches, strokes, downstrokes). */
export const RING_WAVES = {
  /** Directions per ring. */
  directions: 12,
  /** The train: wavelength factors and amplitude shares of its rings. */
  lambdas: [1, 0.55] as readonly number[],
  shares: [1, 0.6] as readonly number[],
  /** Packet half-length along the wave vector, in wavelengths. */
  packet: 0.75,
  /** Initial radius: max(radiusMin, radiusLambda x wavelength) (m). */
  radiusMin: 1,
  radiusLambda: 0.5,
} as const;

/** The dragon as a wave source (dragon-waves.ts). */
export const DRAGON_WAVES = {
  /** Swimming: the body as a displacement hull (m). */
  swimLength: 14,
  swimBeam: 4,
  swimDraft: 1.2,
  /** Skimming: the contact patch as a planing hull, scaled by the low-flight wake strength (m). */
  skimLength: 7,
  skimBeam: 3,
  skimDraft: 0.45,
  /** Splash events: amplitude = splashAmp x strength (m, capped), wavelength = splashLambda + splashLambdaPer x strength. */
  splashAmp: 0.14,
  splashAmpMax: 0.5,
  splashLambda: 2,
  splashLambdaPer: 1.5,
  /** Splashes weaker than this make no ring (the nostril bubbles under water). */
  splashMin: 0.04,
  /** A downstroke's gust ring on the water: amplitude per unit strength (m) and wavelength (m). */
  gustAmp: 0.03,
  gustLambda: 3,
} as const;

/** Reserved source ids (vessels use their non-negative ids). */
export const WATER_SOURCE = {
  none: -1,
  dragon: -2,
  dragonSkim: -3,
  splash: -4,
} as const;

export interface WaveParticleQuality {
  /** Particle pool size. */
  pool: number;
  /** Hulls farther than this from the camera emit nothing (m); 0 = only near the dragon. */
  emitRange: number;
  /** Everything within this radius of the dragon emits regardless of emitRange (m). */
  dragonRange: number;
  /** GPU splat window: texels per side (0 = off) and texel size (m). */
  splatSize: number;
  splatTexel: number;
}

/** Quality tiers: "low" keeps a small CPU pool around the dragon and no GPU splat (spectrum only on screen). */
export function waveParticleQualityFor(preset: QualityPreset): WaveParticleQuality {
  switch (preset) {
    case 'low':
      return { pool: 384, emitRange: 0, dragonRange: 250, splatSize: 0, splatTexel: 1 };
    case 'medium':
      return { pool: 1536, emitRange: 700, dragonRange: 300, splatSize: 256, splatTexel: 1.5 };
    case 'high':
      return { pool: 3072, emitRange: 1000, dragonRange: 300, splatSize: 512, splatTexel: 1 };
    case 'ultra':
    default:
      return { pool: 4096, emitRange: 1300, dragonRange: 300, splatSize: 768, splatTexel: 0.8 };
  }
}
