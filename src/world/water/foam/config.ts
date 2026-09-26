/**
 * Phase 21 stage 7c tunables: the advected foam field, its sources (breaking crests, hulls, the dragon, splashes, surf)
 * and the spray it throws. Units: metres, seconds, m/s.
 */
import type { QualityPreset } from '../../../core/quality';

/**
 * Whitecaps from the wind-wave spectrum (whitecaps.ts): the steepest `crestShare` of the local Gerstner surface (by its
 * horizontal Jacobian, the same sum the water shader evaluates) are crest candidates; a crest breaks with probability
 * activeShare x W(U10) x dev / crestShare (Monahan's coverage law, Zhao & Toba's wave development), decided per
 * breaking cell riding downwind with the waves. The foam left behind makes up the rest of the coverage.
 */
export const WHITECAPS = {
  /** Monahan's coverage law W = coef x U10^exp (fraction of the surface). */
  monahanCoef: 3.84e-6,
  monahanExp: 3.41,
  /** Below this wind nothing breaks (m/s): the Monahan fit is meaningless in light air. */
  minU10: 3.5,
  /** Actively breaking share of the whitecap coverage (stage A of A + B; calibrated with foam-check against the field). */
  activeShare: 0.05,
  /** Share of the local surface that counts as crest (the most compressed). */
  crestShare: 0.05,
  /** Half-width of the crest threshold's soft edge (Jacobian units), at most edgeSigma x the local spread of J. */
  edge: 0.02,
  edgeSigma: 0.12,
  /**
   * Wave development (Zhao & Toba 2001: coverage grows with the breaking Reynolds number u*^2 / (nu w_p)): the local
   * breaking probability is scaled by (w_open / w_local)^devExp, never below devMin.
   */
  devExp: 1.09,
  devMin: 0.03,
  /** Breaking cells: along-wind and cross-wind size (m) and how long a cell keeps its decision (s). */
  cellAlong: 5,
  cellAcross: 9,
  cellTime: 2.5,
  /** The cells' clock wraps after this long (s; keeps the fp32 cell coordinates small on the GPU). */
  timeWrap: 3600,
} as const;

/** The foam field: a half-float RGBA ping-pong window around the camera, stepped at a fixed rate. */
export const FOAM_SIM = {
  /** Fixed simulation step (s) and the most steps in one frame. */
  step: 1 / 20,
  maxSteps: 3,
  /**
   * Channels and their e-folding lifetimes (s): r = whitecap / fresh breaking foam (few seconds; Monahan's stage B
   * decays with ~4 s), g = wake foam (turbulent water behind hulls and the dragon: tens of seconds), b = bubbles under
   * fresh foam (the bright aquamarine patch, ~1.5 s), a = slick (the smooth, darker track behind a hull, a minute).
   */
  capLife: 5,
  wakeLife: 30,
  bubbleLife: 1.6,
  slickLife: 70,
  /** Breaking fills a texel's whitecap foam at this rate (1/s) while it lasts (saturating). */
  capRate: 7,
  /** Share of whitecap foam that stays as longer-lived streaks (windrows) in the wake channel. */
  capToWake: 0.06,
  /** Foam drifts with the wind at this share of U10 (wind drift + unresolved Stokes drift of the short waves). */
  windDrift: 0.03,
  /** Wave particle crests break where the local particle slope exceeds this (soft over `particleEdge`). */
  particleBreak: 0.3,
  particleEdge: 0.1,
  /** Share of particle breaking that goes into the wake channel (bow-wave crest foam that lingers). */
  particleToWake: 0.35,
  /** Surf: the band next to the coast where arriving crests break (m), and the crest height (x local Hs) needed. */
  surfBand: 28,
  surfCrest: 0.12,
  surfRate: 3,
  /** The outer share of the window fades out (the field is not trusted near its edge; ribbons take over outside). */
  edgeFade: 0.08,
  /** Slots shorter than this many texels are faded out of the sim's Jacobian (they alias on the grid). */
  minTexels: 2,
  fullTexels: 3,
} as const;

/** Hull foam (vessel-physics.ts -> water.foam.hull). Amounts are the max-blended level a stamp holds the field at. */
export const HULL_FOAM = {
  /** Below this speed through the water a hull leaves no foam (m/s); the wash is full from `washFull`. */
  minSpeed: 1,
  washFull: 5,
  /** Bow roll: breaking along the first `bowLength` share of the hull, width = bowWidth x beam + bowWidthSpeed x U. */
  bowLength: 0.3,
  bowWidth: 0.12,
  bowWidthSpeed: 0.06,
  /** Bow roll foam at Froude number frBow (grows as Fr^2 below it). */
  frBow: 0.35,
  /** Stern turbulence (a disk at the transom, radius x beam) and the propeller wash centreline (width x beam). */
  sternRadius: 0.55,
  washWidth: 0.7,
  /** The wash spreads as it ages: width grows by this share of the distance behind the stern (m/m). */
  washSpread: 0.05,
  /** Wash foam level from thrust share (0..1) and speed; its bubbles and slick levels. */
  washBase: 0.55,
  washThrust: 0.45,
  washBubbles: 0.8,
  washSlick: 0.9,
  /** Planing hulls: spray sheets along the aft chines (share of the hull) and a narrower, whiter wash. */
  chineFrom: 0.45,
  /** A hull not heard from for this long is forgotten (s). */
  forget: 2,
} as const;

/** The dragon and splashes as foam sources. */
export const DRAGON_FOAM = {
  /** Skim furrow: width (m) at full wake and its foam level. */
  furrowWidth: 2.4,
  furrowFoam: 0.95,
  /** Downwash: at the ring edge where the spray falls back (radius in wingspans), level at full edge spray. */
  washRing: 0.45,
  washFoam: 0.5,
  /** Swimming: body wash (a small hull), and the wing strokes where a wingtip is under water (radius m, level). */
  swimLength: 14,
  swimBeam: 4,
  strokeRadius: 1.6,
  strokeFoam: 0.7,
  strokeDepth: 0.35,
  /** Splash events: radius = splashRadius + splashRadiusPer x strength (m), foam level = min(1, splashFoam x strength). */
  splashRadius: 1.2,
  splashRadiusPer: 2.2,
  splashFoam: 0.9,
  /** Fire on the sea: boiling foam under the steam point (radius m, level). */
  steamRadius: 3,
  steamFoam: 0.7,
} as const;

/** Spray sources handed to fx (water.foam.sprays): spindrift off breaking crests, bow spray, propeller spray. */
export const SPRAY = {
  /** Spindrift: wind speed where the wind starts tearing spray off crest tips, and where it is full (m/s). */
  spindriftFrom: 12,
  spindriftFull: 16,
  /** Candidate crest points tested per frame and the sampling radius around the camera (m). */
  candidates: 48,
  radius: 180,
  /** A candidate spawns spray where the whitecap source fires (J below the threshold minus this margin). */
  margin: 0.0,
  /** Bow spray: speed where it starts / is full (m/s), and the chop steepness factor. */
  bowFrom: 6,
  bowFull: 13,
  /** Propeller / rooster-tail spray of planing craft: speed band (m/s). */
  propFrom: 7,
  propFull: 14,
  /** Hulls farther than this from the camera throw no spray (m). */
  hullRange: 600,
  /** At most this many spray sources per frame (the fx emitter scales its particle counts by budget). */
  maxSources: 48,
} as const;

export interface FoamQuality {
  /** Field texels per side (0 = off: whitecaps from the spectrum only, in the shader) and texel size (m). */
  size: number;
  texel: number;
  /** Most hull / dragon / splash stamps per frame. */
  maxStamps: number;
  /** Spray candidate share (0..1 of SPRAY.candidates). */
  spray: number;
}

/**
 * Quality tiers. The field shares the wave-particle splat window's placement and texel (the sim reads the splat in
 * place), so their sizes match waveParticleQualityFor(): off on low.
 */
export function foamQualityFor(preset: QualityPreset): FoamQuality {
  switch (preset) {
    case 'low':
      return { size: 0, texel: 1, maxStamps: 0, spray: 0.35 };
    case 'medium':
      return { size: 256, texel: 1.5, maxStamps: 96, spray: 0.6 };
    case 'high':
      return { size: 512, texel: 1, maxStamps: 192, spray: 1 };
    case 'ultra':
    default:
      return { size: 768, texel: 0.8, maxStamps: 256, spray: 1 };
  }
}
