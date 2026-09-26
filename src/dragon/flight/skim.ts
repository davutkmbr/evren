/**
 * Sıyırma (surface skim, phase 20 stage B): low, fast and wings level over water or flat open ground the dragon rides
 * its ground effect. Automatic, no key: below SKIM.height of foot clearance at SKIM.minSpeed or faster with the bank
 * under SKIM.maxBank, the induced drag drops further than the physical ground effect alone (aero.ts) and the parasite
 * drag a little; the pose lowers the tail until it kisses the surface, and the wingtips at the bottom of their stroke
 * and the tail tip throw a thin line of spray over water (the water skim's 'splash' events) or dust over land.
 *
 * The water skim of airborne.ts (feet and belly in the water: hydrodynamic drag, planing, spray bursts) is the contact
 * that follows when the skim goes too low; the sıyırma itself never touches. A skim held for SKIM.announceTime is a
 * move: announced with its caption (at most every SKIM.captionInterval) and its end marked on the maneuver event with
 * `clean` (no contact, no stall, speed kept within SKIM.cleanTolerance).
 */
import * as THREE from 'three';
import { clamp, smoothstep } from '../../core/math/noise';
import { MANEUVER_LABELS, MoveTracker } from './maneuvers';
import { FLAP, SKIM } from './params';
import type { FlightSim } from './sim';
import { strokeBottomTipHeight, tipLateral } from './wingtip';

/** Tail root behind / above the centre of mass (rig frame) and the tail's length (m); shared with the pose driver. */
export const TAIL_ROOT_Z = 2.7;
export const TAIL_ROOT_Y = 0.35;
export const TAIL_LENGTH = 8.5;
/** The tail hangs this far (rad) below the body line at rest. */
export const TAIL_DROOP = 0.05;

const TWO_PI = Math.PI * 2;
const _point = new THREE.Vector3();

/**
 * Pose tail pitch (rad, + lowers the tail) that puts the tail tip `clearance` m above the surface below: with the body
 * pitched θ nose-up the tail points down by θ, an even bend b along it turns its chord down by b / 2. Negative values
 * curl it up. `height` is the centre of mass above the surface.
 */
export function tailPitchForClearance(height: number, pitch: number, clearance: number): number {
  const root = height + TAIL_ROOT_Y * Math.cos(pitch) - TAIL_ROOT_Z * Math.sin(pitch);
  const room = clamp((root - clearance) / TAIL_LENGTH, -1, 1);
  return 2 * (Math.asin(room) - pitch - TAIL_DROOP);
}

/** Height of the tail tip above the surface for a pose tail pitch (the inverse of tailPitchForClearance). */
export function tailTipHeight(height: number, pitch: number, tailPitch: number): number {
  const root = height + TAIL_ROOT_Y * Math.cos(pitch) - TAIL_ROOT_Z * Math.sin(pitch);
  return root - TAIL_LENGTH * Math.sin(clamp(pitch + TAIL_DROOP + 0.5 * tailPitch, -Math.PI / 2, Math.PI / 2));
}

/** Skim state of the flight simulation. */
export class SkimState {
  /** 0..1 strength of the skim (drag cuts, pose cues). */
  amount = 0;
  /** A skim move is running (announced). */
  active = false;
  /** Off only to compare against the plain ground effect in headless checks. */
  enabled = true;
  above = 0;
  below = 0;
  /** Sim time of the last skim caption. */
  lastCaption = -1e9;
  kissDistance = 0;
  readonly track = new MoveTracker();

  reset(): void {
    this.amount = 0;
    this.active = false;
    this.above = 0;
    this.below = 0;
    this.kissDistance = 0;
  }
}

/** Open ground under the dragon and just ahead: no structure below, the surface ahead level with the one below. */
function flatGround(sim: FlightSim): boolean {
  if (sim.surfaceY - Math.max(sim.terrainY, 0) > 0.3) {
    return false;
  }
  for (let i = 0; i < 2; i++) {
    if (sim.aheadWater[i] || Math.abs(sim.aheadSurface[i] - sim.surfaceY) > SKIM.flatness) {
      return false;
    }
  }
  return true;
}

/** Target strength of the skim now (0 outside the conditions). */
export function skimTarget(sim: FlightSim): number {
  if (!sim.skim.enabled || (sim.mode !== 'flying' && sim.mode !== 'gliding') || sim.maneuvers.kind !== 'none') {
    return 0;
  }
  const surface = sim.overWater ? (sim.aheadWater[0] ? 1 : 0) : flatGround(sim) ? 1 : 0;
  if (surface === 0) {
    return 0;
  }
  const height = smoothstep(SKIM.height, SKIM.fullHeight, sim.footClearance) * (sim.footClearance > 0 ? 1 : 0);
  const speed = smoothstep(SKIM.minSpeed, SKIM.minSpeed + 4, sim.airspeed);
  const level = 1 - smoothstep(0.6 * SKIM.maxBank, SKIM.maxBank, Math.abs(sim.bank));
  const spread = smoothstep(SKIM.minSpread - 0.1, SKIM.minSpread + 0.1, sim.spread);
  return height * speed * level * spread;
}

/** Airborne substep, before the aerodynamics: updates the skim's strength and the move; returns the strength. */
export function updateSkim(sim: FlightSim, h: number): number {
  const k = sim.skim;
  const target = skimTarget(sim);
  const step = SKIM.rate * h;
  k.amount += clamp(target - k.amount, -step, step);
  if (!k.active) {
    k.above = k.amount > 0.6 ? k.above + h : 0;
    if (k.above >= SKIM.announceTime) {
      k.active = true;
      k.below = 0;
      k.track.begin(sim);
      if (sim.time - k.lastCaption >= SKIM.captionInterval) {
        k.lastCaption = sim.time;
        sim.emit({ type: 'maneuver', id: 'skim', label: MANEUVER_LABELS.skim });
      }
    }
  } else {
    k.track.sample(sim);
    k.below = k.amount < 0.2 ? k.below + h : 0;
    if (k.below >= SKIM.endTime) {
      endSkim(sim, false);
    }
  }
  return k.amount;
}

/** Ends a running skim move (`forced`: landed, splashed down, cancelled). */
export function endSkim(sim: FlightSim, forced: boolean): void {
  const k = sim.skim;
  if (!k.active) {
    return;
  }
  k.active = false;
  k.above = 0;
  sim.maneuvers.endMove(sim, k.track.finish(sim, 'skim', SKIM.cleanTolerance, forced));
}

/**
 * After the airborne integration: the wingtips at the bottom of the stroke and the lowered tail tip kiss the surface,
 * throwing a thin line of spray (water) or dust (land) spaced by SKIM.kissSpacing metres.
 */
export function skimKiss(sim: FlightSim, h: number): void {
  const k = sim.skim;
  if (k.amount < 0.3 || sim.touchingWater) {
    k.kissDistance = 0;
    return;
  }
  const v = sim.body.velocity;
  k.kissDistance += Math.hypot(v.x, v.z) * h;
  if (k.kissDistance < SKIM.kissSpacing) {
    return;
  }
  const beat = sim.beat;
  const split = TWO_PI * FLAP.downstrokeFraction;
  // How far down the wing is in its stroke: 0 at the top (phase 0), 1 at the bottom (end of the downstroke).
  const down = beat.phase < split ? 0.5 - 0.5 * Math.cos((Math.PI * beat.phase) / split) : 0.5 + 0.5 * Math.cos((Math.PI * (beat.phase - split)) / (TWO_PI - split));
  const tip = sim.agl + strokeBottomTipHeight(beat.amplitude * down, sim.sweep, sim.wing.span, sim.pitch);
  const tailReach = tailPitchForClearance(sim.agl, sim.pitch, sim.overWater ? SKIM.tailKissWater : SKIM.tailKissLand);
  const tail = tailTipHeight(sim.agl, sim.pitch, Math.min(tailReach, SKIM.tailMax) * k.amount);
  const p = sim.body.position;
  const axes = sim.axes;
  let kissed = false;
  if (tip < SKIM.kissHeight) {
    const lateral = tipLateral(sim.wing.span);
    for (const side of [-1, 1]) {
      _point.copy(p).addScaledVector(axes.right, side * lateral);
      emitKiss(sim, _point, 0.06 + 0.06 * k.amount);
    }
    kissed = true;
  }
  if (tail < SKIM.kissHeight) {
    _point.copy(p).addScaledVector(axes.forward, -(TAIL_ROOT_Z + TAIL_LENGTH * 0.9));
    emitKiss(sim, _point, 0.05 + 0.08 * k.amount);
    kissed = true;
  }
  if (kissed) {
    k.kissDistance = 0;
  }
}

/** Spray on the water (the water skim's splash event), dust on land. */
function emitKiss(sim: FlightSim, point: THREE.Vector3, strength: number): void {
  if (sim.overWater) {
    point.y = sim.waterHeight(point.x, point.z);
    sim.emit({ type: 'splash', point: point.clone(), strength });
  } else {
    point.y = sim.surfaceY;
    sim.emit({ type: 'dust', point: point.clone(), strength: strength * 1.5 });
  }
}
