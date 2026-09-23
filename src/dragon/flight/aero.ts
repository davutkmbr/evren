import { clamp, lerp, smoothstep } from '../../core/math/noise';
import { WORLD_CEILING } from '../../core/geo-coords';
import { BODY, ENVELOPE, SEA_LEVEL_DENSITY, WING } from './params';

/** Instantaneous wing planform derived from the pose (spread/sweep) and leg state. */
export interface WingShape {
  area: number;
  span: number;
  aspect: number;
  /** Mean aerodynamic chord (m). */
  chord: number;
  /** Lift curve slope per radian (finite wing). */
  liftSlope: number;
  /** Induced drag factor k in CDi = k CL². */
  inducedFactor: number;
  /** Parasitic drag area CdA (m²): body, legs, membrane profile drag, folded bundles. */
  parasiteArea: number;
}

export function createWingShape(): WingShape {
  return { area: 0, span: 0, aspect: 0, chord: 0, liftSlope: 0, inducedFactor: 0, parasiteArea: 0 };
}

export function evaluateWingShape(spread: number, sweep: number, legsOut: number, out: WingShape): WingShape {
  const s = clamp(spread, 0, 1);
  const area = lerp(WING.areaFolded, WING.areaSpread, s) * (1 - WING.sweepAreaLoss * Math.max(0, sweep));
  const span = lerp(WING.spanFolded, WING.spanSpread, s) * (1 - 0.1 * Math.abs(sweep));
  const aspect = (span * span) / area;
  out.area = area;
  out.span = span;
  out.aspect = aspect;
  out.chord = area / span;
  out.liftSlope = ((2 * Math.PI * aspect) / (aspect + 2)) * WING.membraneEfficiency;
  out.inducedFactor = 1 / (Math.PI * WING.oswald * aspect);
  out.parasiteArea =
    BODY.cdA + clamp(legsOut, 0, 1) * BODY.legsCdA + area * WING.cd0 + BODY.foldedBundleCdA * clamp((0.5 - s) / 0.4, 0, 1);
  return out;
}

/** Fraction of attached flow in steady state for a wing angle of attack (1 = fully attached). */
export function staticAttachment(alphaWing: number): number {
  const positive = 1 - smoothstep(WING.stall, WING.stall + WING.stallWidth, alphaWing);
  const negative = 1 - smoothstep(-WING.negStall, -WING.negStall + WING.negStallWidth, -alphaWing);
  return Math.min(positive, negative);
}

function softMin(a: number, b: number, k: number): number {
  return Math.min(a, b) - k * Math.log(1 + Math.exp(-Math.abs(a - b) / k));
}

function softMax(a: number, b: number, k: number): number {
  return Math.max(a, b) + k * Math.log(1 + Math.exp(-Math.abs(a - b) / k));
}

/** Attached-flow lift coefficient: linear camber + slope, softly rounded into CLmax / CLmin. */
export function attachedLift(alphaWing: number, liftSlope: number): number {
  const linear = WING.cl0 + liftSlope * alphaWing;
  return softMax(softMin(linear, WING.clCeiling, 0.08), WING.clFloor, 0.08);
}

/** Separated (flat plate) lift: CN sin(α) cos(α). */
export function separatedLift(alphaWing: number): number {
  return 0.5 * WING.separatedNormal * Math.sin(2 * alphaWing);
}

/** Separated (flat plate) pressure drag: CN sin²(α). */
export function separatedDrag(alphaWing: number): number {
  const s = Math.sin(alphaWing);
  return WING.separatedNormal * s * s;
}

export function liftCoefficient(alphaWing: number, attachment: number, liftSlope: number): number {
  return attachment * attachedLift(alphaWing, liftSlope) + (1 - attachment) * separatedLift(alphaWing);
}

/** ISA-like exponential atmosphere. */
export function airDensity(altitude: number): number {
  return SEA_LEVEL_DENSITY * Math.exp(-Math.max(altitude, 0) / 8500);
}

/** Extra thinning near the world ceiling so the dragon cannot climb out of the map. */
export function ceilingFactor(altitude: number): number {
  return 1 - 0.7 * smoothstep(WORLD_CEILING - ENVELOPE.ceilingFade, WORLD_CEILING + 250, altitude);
}

/**
 * Ground effect (McCormick). Returns the induced-drag multiplier (<= 1) and lift gain for a wing
 * at `height` above the surface with `span`.
 */
export function groundEffectInduced(height: number, span: number): number {
  const r = (16 * Math.max(height, 0.2)) / span;
  const r2 = r * r;
  return r2 / (1 + r2);
}

export function groundEffectLift(height: number, span: number): number {
  return 0.12 * Math.exp((-4 * Math.max(height, 0)) / span);
}
