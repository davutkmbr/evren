/**
 * Phase 21 stage 2 tunables: the sea reacting to low flight (downwash, skim wake, wingtip vortices, fire steam) and the
 * disturbance window the water surface samples. Units: metres, seconds, m/s.
 */
import type { QualityPreset } from '../../../core/quality';

export const LOW_FLIGHT = {
  /** Downwash reaches the water from this many wingspans up (fades in from here down to `downwashFull`). */
  downwashReach: 1.5,
  downwashFull: 0.3,
  /** Airspeed band where flight counts as slow (m/s): full downwash below the first, none above the second. */
  slowFull: 10,
  slowNone: 24,
  /** Downwash floor in hover-like modes (hovering, landing, take-off, stalling) regardless of airspeed. */
  hoverFloor: 0.85,
  /** Share of the downwash that does not depend on the flap effort (an idle hover still pushes air down). */
  effortBase: 0.4,
  /** Downstroke pulse decay time (s). */
  pulseDecay: 0.4,
  /** Edge spray starts at this downwash and is full at the second (hover-like modes only). */
  edgeSprayFrom: 0.35,
  edgeSprayFull: 0.8,
  /** Skim wake: belly height above the water (m) where the wake starts / is full, speed band (m/s). */
  wakeBellyNone: 2.5,
  wakeBellyFull: 0.2,
  wakeSpeedFrom: 8,
  wakeSpeedFull: 22,
  /** Wake attack / release time constants (s): the texture and foam keep the visible wake for seconds. */
  wakeAttack: 0.05,
  wakeRelease: 0.35,
  /** Wingtip vortex curls: tip height (in wingspans) where they start, speed band (m/s). */
  vortexTipReach: 0.45,
  vortexTipFull: 0.04,
  vortexSpeedFrom: 18,
  vortexSpeedFull: 34,
  /** Fire breath reach (m, matches the fire emitter's REACH) and the extra margin within which it still boils water. */
  fireReach: 40,
  fireReachMargin: 1.25,
  /** Ray-march steps along the jet (plus bisection refinement). */
  fireSteps: 10,
  fireRefine: 4,
  steamAttack: 0.12,
  steamRelease: 0.55,
  /** A body lower than this over water (m, centre above the waves) always runs the model's per-frame queries. */
  queryHeight: 60,
  /** Gust ring of each downstroke: start radius (wingspans), outward speed (m/s) and its decay, lifetime (s). */
  gustRadius: 0.25,
  gustSpeed: 11,
  gustSpeedDecay: 1.6,
  gustLife: 1.6,
  gustRingWidth: 3.2,
  /** At most this many gust rings at a time (older ones are dropped). */
  maxGusts: 4,
} as const;

/** Amounts written into the disturbance field (per stamp, or per second for continuous ones). */
export const DISTURBANCE_STAMPS = {
  /** Water pushed down under a downstroke (m of surface depression at full strength). */
  downstrokeDepth: 0.22,
  /** Roughness added per second under a full downwash (the dark ruffled "cat's paw" patch). */
  downwashRough: 1.0,
  /** Roughness of a gust ring front (per second at full strength). */
  gustRough: 2.5,
  /** Height noise per second under a full downwash (ruffling), m. */
  downwashRuffle: 0.05,
  /**
   * Swept stamps (skim furrow, vortex streaks, tail kiss) are capsules from last frame's point to this frame's, so
   * every patch of water along the path is covered once per pass: these amounts are per pass, not per second.
   * Skim furrow: depression (m), roughness and foam at full wake; the wider roughened strip around it.
   */
  furrowDepth: 0.28,
  furrowRough: 1.1,
  furrowFoam: 0.95,
  furrowStripRough: 0.55,
  /** Vortex streaks under the wingtips (roughness, foam per pass), and a tip or the tail kissing the water. */
  vortexRough: 0.6,
  vortexFoam: 0.12,
  kissFoam: 0.8,
  kissDepth: 0.1,
  /** Boiling patch under the steam: roughness, foam, height noise per second. */
  steamRough: 3,
  steamFoam: 1.6,
  steamJitter: 0.12,
} as const;

/** The disturbance simulation (wave equation + decaying roughness and foam) in a window following the dragon. */
export const DISTURBANCE_SIM = {
  /** Ripple phase speed (m/s): 4-6 m ripples; the skim furrow's V half-angle is asin(c / v). */
  waveSpeed: 4,
  /** Amplitude damping (1/s) of the ripples. */
  waveDamping: 1.1,
  /** Roughness and foam decay (1/s) and roughness diffusion (share of the neighbour average per second). */
  roughDecay: 0.55,
  foamDecay: 0.38,
  roughDiffuse: 1.5,
  /** Fixed simulation step (s) and the most steps run in one frame. */
  step: 1 / 60,
  maxSteps: 4,
  /** The field is dropped this long after the last stamp (every channel has decayed below visibility by then). */
  lifetime: 7,
  /** The window centre trails behind a fast dragon by up to this share of its extent (more wake in view). */
  trailShare: 0.3,
  trailSpeed: 30,
  /** At most this many stamps per frame (3 vec4 each in the simulation shader). */
  maxStamps: 16,
  /** Water shader: slope and roughness scale of the field, foam scale. */
  slopeScale: 1,
  roughScale: 1,
  foamScale: 1,
} as const;

export interface DisturbanceQuality {
  /** Texels per side (0 = off: sprays and sound only). */
  size: number;
  /** Texel size (m). */
  texel: number;
}

export function disturbanceQualityFor(preset: QualityPreset): DisturbanceQuality {
  switch (preset) {
    case 'low':
      return { size: 0, texel: 1 };
    case 'medium':
      return { size: 128, texel: 0.8 };
    case 'high':
      return { size: 192, texel: 0.6 };
    case 'ultra':
    default:
      return { size: 256, texel: 0.5 };
  }
}
