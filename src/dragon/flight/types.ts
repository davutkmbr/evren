import type * as THREE from 'three';
import type { CollisionWorld } from '../../core/collision';
import type { EnvironmentState, GeoQuery, WaterService } from '../../core/contracts';

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
  /**
   * Maneuver edges: A / D double tap (roll), S double tap (loop), Shift double tap (dart when fast, drop when slow),
   * Space double tap (power stroke), Q / E double tap (side-slip). The same edges start the
   * stage C reversals by context: S double tap while banked (wingover), A / D double tap in a steep dive (Split-S);
   * the Immelmann reads the held roll axis during a loop.
   */
  rollLeftPressed: boolean;
  rollRightPressed: boolean;
  loopPressed: boolean;
  dropPressed: boolean;
  powerPressed: boolean;
  slipLeftPressed: boolean;
  slipRightPressed: boolean;
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
  /** Wave surface of the sea; undefined = a flat sea at y = 0 (sandboxes, headless checks without water). */
  water?: WaterService | undefined;
}

/** Maneuver ids announced to the game ('maneuver' event); 'hint' explains a refused trick. */
export type ManeuverId =
  | 'roll'
  | 'loop'
  | 'freefall'
  | 'catch'
  | 'takeoff'
  | 'land'
  | 'runout'
  | 'touchgo'
  | 'plunge'
  | 'breach'
  | 'power'
  | 'dart'
  | 'slip'
  | 'skim'
  | 'wingover'
  | 'immelmann'
  | 'splits'
  /** A hard landing (hard-landing.ts): the dragon met the ground too fast and tumbles. */
  | 'hardland'
  /** A "Kusursuz" flow moment (flow/flow.ts; the label names the term that peaked). */
  | 'flow'
  | 'hint';

/** Phase 20 stage B and C moves that report a clean or unclean end (flow hooks). */
export type MoveId = 'power' | 'dart' | 'slip' | 'skim' | 'wingover' | 'immelmann' | 'splits';

/** A finished move (Maneuvers.log; headless checks and the future flow system). */
export interface MoveRecord {
  id: MoveId;
  /** Sim time at the start (s) and length (s). */
  start: number;
  duration: number;
  /** Airspeed at the start and at the end (m/s). */
  entrySpeed: number;
  exitSpeed: number;
  /** Height at the end minus at the start (m). */
  heightChange: number;
  /** No contact, no stall, exit speed >= entry speed - the move's tolerance, not ended early. */
  clean: boolean;
  contact: boolean;
  stalled: boolean;
  /** Ended early (too low, landed, splashed down). */
  forced: boolean;
  /** Side-slip: lateral shift (m, along the slip). */
  lateral: number;
  /** Heading change (rad): of the track (the side-slip: of the body). */
  headingChange: number;
  /** Specific energy at the end over the entry's (½V² + g·Δh, height from the entry; 1 = none lost). */
  energyRatio: number;
}

/** One-shot sounds requested by the flight model (AudioService one-shots). */
export type FlightSound = 'wing-snap' | 'whoosh';

export type SimEvent =
  | { type: 'flap'; strength: number }
  | { type: 'impact'; point: THREE.Vector3; speed: number; surface: string }
  | { type: 'splash'; point: THREE.Vector3; strength: number }
  /** Water thrown up with no sound of its own (swimming strokes: their sounds come from the audio's stroke model). */
  | { type: 'spray'; point: THREE.Vector3; strength: number }
  | { type: 'dust'; point: THREE.Vector3; strength: number }
  | { type: 'landed'; point: THREE.Vector3; speed: number; water: boolean }
  /** Counted only (mode changes are read from the state). */
  | { type: 'mode' }
  /**
   * A maneuver started (announced to the game with its caption). Flow hooks (phase 20): `ended` marks the end of a
   * move instead (not announced), `clean` says whether it went cleanly (no contact, no forced exit).
   */
  | { type: 'maneuver'; id: ManeuverId; label: string; ended?: boolean; clean?: boolean }
  | { type: 'sound'; name: FlightSound; volume: number }
  /** Camera jolt (CameraRigState.shake amount). */
  | { type: 'shake'; amount: number }
  /** A chain link landed (flow/burst.ts): its number in the chain, the speed burst it gives (m/s) and why. */
  | { type: 'chain'; link: number; dv: number; source: 'motion' | 'ring' | 'gate' }
  /** A "Kusursuz" moment (flow): which harmony term peaked (the caption comes as a `maneuver` event with id 'flow'). */
  | { type: 'moment'; kind: 'rhythm' | 'energy' | 'handover' | 'world' };

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
    powerPressed: false,
    slipLeftPressed: false,
    slipRightPressed: false,
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
  to.powerPressed = from.powerPressed;
  to.slipLeftPressed = from.slipLeftPressed;
  to.slipRightPressed = from.slipRightPressed;
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
  power: 'powerPressed',
  slipLeft: 'slipLeftPressed',
  slipRight: 'slipRightPressed',
} as const satisfies Record<string, keyof PilotCommand>;

export type PilotEdge = keyof typeof PILOT_EDGES;

/** A record of every edge name set to false (pending presses of the test hook and the headless runtime). */
export function createEdgeRecord(): Record<PilotEdge, boolean> {
  const out = {} as Record<PilotEdge, boolean>;
  for (const name of Object.keys(PILOT_EDGES) as PilotEdge[]) {
    out[name] = false;
  }
  return out;
}

/** ORs the edges of `from` into `into` (edges seen by any frame until a physics substep consumes them). */
export function latchPilotEdges(from: PilotCommand, into: PilotCommand): void {
  for (const key of Object.values(PILOT_EDGES)) {
    into[key] ||= from[key];
  }
}

/** Clears every edge-triggered field (after the first substep of a frame has seen them). */
export function clearPilotEdges(cmd: PilotCommand): void {
  for (const key of Object.values(PILOT_EDGES)) {
    cmd[key] = false;
  }
}
