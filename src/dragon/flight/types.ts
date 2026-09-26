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
  /** Maneuver edges: A / D double tap (roll), S double tap (loop), Shift double tap (drop), V (the rider's "dehh"). */
  rollLeftPressed: boolean;
  rollRightPressed: boolean;
  loopPressed: boolean;
  dropPressed: boolean;
  urgePressed: boolean;
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

/** Maneuver ids announced to the game ('maneuver' event); 'hint' explains a refused trick. */
export type ManeuverId = 'roll' | 'loop' | 'freefall' | 'catch' | 'urge' | 'takeoff' | 'land' | 'runout' | 'touchgo' | 'hint';

/** One-shot sounds requested by the flight model (AudioService one-shots). */
export type FlightSound = 'wing-snap' | 'whoosh';

export type SimEvent =
  | { type: 'flap'; strength: number }
  | { type: 'impact'; point: THREE.Vector3; speed: number; surface: string }
  | { type: 'splash'; point: THREE.Vector3; strength: number }
  | { type: 'dust'; point: THREE.Vector3; strength: number }
  | { type: 'landed'; point: THREE.Vector3; speed: number; water: boolean }
  /** Counted only (mode changes are read from the state). */
  | { type: 'mode' }
  | { type: 'maneuver'; id: ManeuverId; label: string }
  | { type: 'sound'; name: FlightSound; volume: number }
  /** Camera jolt (CameraRigState.shake amount). */
  | { type: 'shake'; amount: number };

export function createPilotCommand(): PilotCommand {
  return {
    pitch: 0,
    roll: 0,
    yaw: 0,
    flap: false,
    dive: false,
    brake: false,
    fire: false,
    flapPressed: false,
    landPressed: false,
    roarPressed: false,
    rollLeftPressed: false,
    rollRightPressed: false,
    loopPressed: false,
    dropPressed: false,
    urgePressed: false,
  };
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
  to.rollLeftPressed = from.rollLeftPressed;
  to.rollRightPressed = from.rollRightPressed;
  to.loopPressed = from.loopPressed;
  to.dropPressed = from.dropPressed;
  to.urgePressed = from.urgePressed;
  return to;
}

/** Edge-triggered command fields by short name (test presses, latching across substeps). */
export const PILOT_EDGES = {
  flap: 'flapPressed',
  land: 'landPressed',
  roar: 'roarPressed',
  rollLeft: 'rollLeftPressed',
  rollRight: 'rollRightPressed',
  loop: 'loopPressed',
  drop: 'dropPressed',
  urge: 'urgePressed',
} as const satisfies Record<string, keyof PilotCommand>;

export type PilotEdge = keyof typeof PILOT_EDGES;

/** ORs the edges of `from` into `into` (edges seen by any frame until a physics substep consumes them). */
export function latchPilotEdges(from: PilotCommand, into: PilotCommand): void {
  for (const key of Object.values(PILOT_EDGES)) {
    into[key] ||= from[key];
  }
}

/** Clears every edge-triggered field (after the first substep of a frame has seen them). */
export function clearPilotEdges(cmd: PilotCommand): void {
  cmd.flapPressed = false;
  cmd.landPressed = false;
  cmd.roarPressed = false;
  cmd.rollLeftPressed = false;
  cmd.rollRightPressed = false;
  cmd.loopPressed = false;
  cmd.dropPressed = false;
  cmd.urgePressed = false;
}
