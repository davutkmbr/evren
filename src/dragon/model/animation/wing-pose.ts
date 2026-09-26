import * as THREE from 'three';
import { FINGERS } from '../anatomy';
import type { DragonPose } from '../../../core/contracts';

/** Euler angles (x = twist about the span axis, y = sweep, z = elevation) for one bone of the RIGHT wing. */
export interface Angles {
  x: number;
  y: number;
  z: number;
}

export interface WingAngles {
  humerus: Angles;
  forearm: Angles;
  hand: Angles;
  thumb: Angles;
  fingerA: Angles[];
  fingerB: Angles[];
}

export function createWingAngles(): WingAngles {
  const a = (): Angles => ({ x: 0, y: 0, z: 0 });
  return { humerus: a(), forearm: a(), hand: a(), thumb: a(), fingerA: FINGERS.map(a), fingerB: FINGERS.map(a) };
}

const FAN_CENTER = (FINGERS[0].angle + FINGERS[FINGERS.length - 1].angle) * 0.5;
const DOWNSTROKE_FRACTION = 0.56;

/** Landing flare shape (DragonPose.landFlare), rad: humerus forward and raise, hand twist and outer finger curl (cup). */
const LAND_WING = { forward: 0.16, raise: 0.1, cupHand: 0.14, cupFingers: 0.1 };

/** The flare shape applies with the wings swept forward (braking), not while tucked. */
function flareShare(sweep: number): number {
  return THREE.MathUtils.clamp(-sweep * 2, 0, 1);
}

/** Warped stroke phase: longer, more powerful downstroke (psi 0..PI) and a quicker upstroke. */
export function strokePhase(flapPhase: number): number {
  const TWO_PI = Math.PI * 2;
  const p = ((flapPhase % TWO_PI) + TWO_PI) % TWO_PI;
  const split = TWO_PI * DOWNSTROKE_FRACTION;
  return p < split ? (p / split) * Math.PI : Math.PI + ((p - split) / (TWO_PI - split)) * Math.PI;
}

/** Upstroke fold signal: 0 during the downstroke, peaks mid-upstroke. */
function fold(psi: number): number {
  const f = (1 - Math.sin(psi)) * 0.5;
  return f * f;
}

function set(a: Angles, x: number, y: number, z: number): void {
  a.x = x;
  a.y = y;
  a.z = z;
}

/**
 * Right-wing joint angles for a pose. Left wing = mirror (y, z negated).
 * `side` is +1 for right, -1 for left (only used for asymmetric twist/roll control).
 */
export function computeWingAngles(pose: Readonly<DragonPose>, side: number, out: WingAngles): void {
  const spread = THREE.MathUtils.clamp(pose.wingSpread, 0, 1);
  const amp = THREE.MathUtils.clamp(pose.flapAmplitude, 0, 1.5) * spread;
  const psi = strokePhase(pose.flapPhase);
  const sweep = THREE.MathUtils.clamp(pose.wingSweep, -1, 1);
  const dive = Math.max(sweep, 0);
  const flare = Math.max(-sweep, 0);
  const twist = THREE.MathUtils.clamp(pose.wingTwist, -1, 1) * side;
  // Landing flare: the wings reach further forward and up, the stroke steeper (more elevation, less fore-aft sweep),
  // the hand and fingers cupped so the membrane bellies into the air it brakes against.
  const land = THREE.MathUtils.clamp(pose.landFlare ?? 0, 0, 1) * flareShare(sweep);

  const cosP = Math.cos(psi);
  const sinP = Math.sin(psi);
  // Hover/flare flaps sweep more fore-aft (stroke plane tilts toward horizontal).
  const elevAmp = 0.62 * (1 - 0.25 * flare + 0.3 * land);
  const sweepAmp = 0.24 + 0.3 * flare - 0.2 * land;

  // Spread (glide) base + flap cycle.
  set(
    out.humerus,
    0.05 - 0.3 * amp * sinP + 0.42 * flare - 0.07 * twist,
    -0.02 - sweepAmp * amp * Math.cos(psi - 0.6) - 0.5 * dive + 0.32 * flare - 0.12 * twist + LAND_WING.forward * land,
    0.12 + amp * (elevAmp * cosP + 0.0) - 0.12 * dive + 0.28 * flare - 0.1 * twist + LAND_WING.raise * land,
  );
  set(
    out.forearm,
    -0.02 * amp,
    0.42 * amp * fold(psi - 0.15) + 0.72 * dive - 0.06 * flare,
    -0.04 + 0.26 * amp * Math.sin(psi + 0.35) + 0.05 * dive,
  );
  set(
    out.hand,
    -0.03 - 0.12 * amp * sinP - 0.2 * twist + 0.15 * flare + LAND_WING.cupHand * land,
    -0.46 * amp * fold(psi - 0.4) - 0.58 * dive + 0.05 * flare,
    -0.03 + 0.26 * amp * Math.sin(psi - 0.15) - 0.04 * dive,
  );
  set(out.thumb, 0, 0.1 * dive, 0);
  const fan = 0.34 * amp * fold(psi - 0.55) + 0.34 * dive - 0.1 * flare;
  for (let i = 0; i < FINGERS.length; i++) {
    const k = i / (FINGERS.length - 1);
    set(out.fingerA[i], -0.04 * amp * sinP * k, (FINGERS[i].angle - FAN_CENTER) * fan, 0.08 * amp * Math.sin(psi - 0.5) * (1 - 0.4 * k));
    set(out.fingerB[i], 0, 0.04 * amp * fold(psi - 0.7), 0.16 * amp * Math.sin(psi - 0.7) - 0.02 - LAND_WING.cupFingers * land * (0.4 + 0.6 * k));
  }
}

/** Downstroke loading 0..1 (for membrane billow and body heave). */
export function strokeLoad(flapPhase: number): number {
  return Math.sin(strokePhase(flapPhase));
}
