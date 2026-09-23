import type * as THREE from 'three';
import type { CollisionWorld } from '../../core/collision';
import type { EnvironmentState, GeoQuery } from '../../core/contracts';

/** Pilot intent for one frame (keyboard/gamepad, autopilot or test injection). */
export interface PilotCommand {
  /** +1 = nose down (W). */
  pitch: number;
  /** +1 = roll right (D). */
  roll: number;
  /** +1 = yaw right (E). */
  yaw: number;
  flap: boolean;
  dive: boolean;
  brake: boolean;
  fire: boolean;
  /** Edge-triggered (only the first substep of a frame sees them). */
  flapPressed: boolean;
  landPressed: boolean;
  roarPressed: boolean;
}

/** Assist-layer targets that replace stick input (autopilot, tests, landing approach). */
export interface AssistOverrides {
  bankTarget: number | null;
  pathTarget: number | null;
  airspeedTarget: number | null;
}

export interface SimOptions {
  /** Automatic cruise flapping (flap-glide bursts) when the pilot is not flapping. */
  autoFlap: boolean;
  /** Soft angle-of-attack limiter. */
  stallProtection: boolean;
  turbulence: boolean;
  thermals: boolean;
  /** Use env wind (false = still air). */
  wind: boolean;
}

export interface SimWorld {
  collision: CollisionWorld | undefined;
  geo: GeoQuery | undefined;
  env: EnvironmentState | undefined;
}

export type SimEvent =
  | { type: 'flap'; strength: number }
  | { type: 'impact'; point: THREE.Vector3; speed: number; surface: string }
  | { type: 'splash'; point: THREE.Vector3; strength: number }
  | { type: 'dust'; point: THREE.Vector3; strength: number }
  | { type: 'landed'; point: THREE.Vector3; speed: number; water: boolean }
  /** Counted only (mode changes are read from the state). */
  | { type: 'mode' };

export function createPilotCommand(): PilotCommand {
  return { pitch: 0, roll: 0, yaw: 0, flap: false, dive: false, brake: false, fire: false, flapPressed: false, landPressed: false, roarPressed: false };
}

export function createOverrides(): AssistOverrides {
  return { bankTarget: null, pathTarget: null, airspeedTarget: null };
}

export function clearOverrides(o: AssistOverrides): void {
  o.bankTarget = null;
  o.pathTarget = null;
  o.airspeedTarget = null;
}

export function copyPilotCommand(from: PilotCommand, to: PilotCommand): PilotCommand {
  to.pitch = from.pitch;
  to.roll = from.roll;
  to.yaw = from.yaw;
  to.flap = from.flap;
  to.dive = from.dive;
  to.brake = from.brake;
  to.fire = from.fire;
  to.flapPressed = from.flapPressed;
  to.landPressed = from.landPressed;
  to.roarPressed = from.roarPressed;
  return to;
}
