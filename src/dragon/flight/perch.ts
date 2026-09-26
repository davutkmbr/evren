import * as THREE from 'three';
import type { Collider } from '../../core/collision';
import type { DragonPerchState, DragonPose, FlightMode, PerchPhase, PerchPoint, PerchRefusal } from '../../core/contracts';
import { clamp, smoothstep } from '../../core/math/noise';
import { enterStance, pickVariant, standDepth, startLeap } from './ground-moves';
import { DEG, FLAP, GRAVITY, GROUND, LEAP } from './params';
import type { FlightSim } from './sim';
import type { PilotCommand } from './types';

/*
 * Perching on viewpoints (phase 03): the prompt (a perch in reach, inside the approach cone, slow enough), the guided
 * approach (a planned curve checked against the collision world that bleeds the speed, flares and sets the dragon down
 * exactly on the perch pose), the perched hold (the viewing mode: sitting, wings folded, looking out), and the take-off
 * off the perch (a drop-off over an edge: crouch, push, a fall with the wings still until they have room, then the
 * take-off law's drop dive; elsewhere the stage A ground leap on a temporary perch pad collider).
 *
 * While the approach, the perched hold or a drop-off runs, this driver owns the body (FlightSim.step skips its own
 * mode code); the rest of the time it only watches for the prompt. Everything is simulation: the UI reads
 * DragonPerchState (DragonState.perch). Design notes: .docs/planning/03-viewpoints.md.
 */

const TWO_PI = Math.PI * 2;
/** Wing-beat phase held at the top of the upstroke (as the ground moves hold it). */
const PHASE_TOP = TWO_PI - 0.05;

export const PERCH = {
  /* --- prompt (show / hide thresholds: the hide side is looser, so the prompt does not flicker) --- */
  /** Horizontal distance to the grip point (m). */
  reach: [260, 320] as readonly [number, number],
  /** Airspeed (m/s). */
  speed: [44, 52] as readonly [number, number],
  /** Bearing to the perch off the direction of travel (rad); ignored below `slowSpeed` (a hover can turn). */
  cone: [70 * DEG, 88 * DEG] as readonly [number, number],
  slowSpeed: 9,
  /** Height window around the grip point: at most this far above (m), at most this far below (m). */
  above: [160, 190] as readonly [number, number],
  below: [45, 60] as readonly [number, number],
  /** Prompt evaluation interval (s). */
  promptInterval: 0.1,
  /** After leaving a perch it is not offered again for this long (s) or until the dragon is this far away (m). */
  cooldownTime: 8,
  cooldownDistance: 90,

  /* --- approach path --- */
  /** Start of the final leg: this far behind the touchdown point along the arrival direction (m), and this high. */
  arriveBack: 30,
  arriveUp: 8,
  /** Arrival directions tried, off the perch heading (rad), and extra heights (× arriveUp). */
  arriveYaw: [0, 35 * DEG, -35 * DEG, 70 * DEG, -70 * DEG, 110 * DEG, -110 * DEG] as readonly number[],
  arriveLift: [1, 2.2, 3.5] as readonly number[],
  /** Duration limits (s) and the mean speed assumed for a slow (hovering) start (m/s). */
  minTime: 4,
  maxTime: 16,
  slowMeanSpeed: 7,
  /** Largest acceleration the path may ask for (m/s²). */
  maxAccel: 2.6 * GRAVITY,
  /** Path samples of the clearance check. */
  checkSamples: 72,
  /** Clearance kept by the body, head, tail and wing spheres (m, on top of their radii). */
  clearance: 0.6,
  /** Grace (s) before stick input can abort the approach, and the stick level that aborts. */
  abortGrace: 0.2,
  abortStick: 0.55,
  /** The first `blendIn` seconds the attitude blends from the attitude the approach started with. */
  blendIn: 0.7,

  /* --- flare and touchdown --- */
  /** Path fractions: legs reach down from/to, flare from/to (peak), hover blend from/to. */
  legs: [0.45, 0.78] as readonly [number, number],
  flare: [0.6, 0.84] as readonly [number, number],
  hover: [0.55, 0.94] as readonly [number, number],
  flarePitch: 32 * DEG,
  touchPitch: 8 * DEG,
  /** From raise[0] of the path the wings stop stroking and are held raised over the back (amplitude at the top of the
   *  stroke), at least `minSpread` open by raise[1]. */
  raise: [0.88, 0.95] as readonly [number, number],
  raiseAmplitude: 0.55,
  minSpread: 0.55,
  /** Largest bank from the path's lateral acceleration (rad). */
  maxBank: 40 * DEG,

  /* --- perched --- */
  /** Settle into the sit (s), the sit's nose-up pitch (rad) and how much lower the body sits than standing (m). */
  settleTime: 1.1,
  sitPitch: 4 * DEG,
  sitSink: 0.45,
  /** Narrow tower caps (grip radius up to capGrip m): upright on the hind feet, nose up capPitch, sinking capSink m;
   *  capStand = the standing height the seat is computed with (the rig's). */
  capGrip: 2.2,
  capPitch: 24 * DEG,
  capSink: 0.35,
  capStand: 2.2,
  /** How much of the perch surface's slope the body follows (the stance follows 0.7 of the terrain). */
  slopeFollow: 0.6,
  maxSlope: 22 * DEG,
  /** Temporary collider under the feet while perched and leaving (the stance and the drop leap stand on it). */
  padHeight: 1.2,
  padMaxRadius: 3,
  /** Leaving: the pad goes and the phase ends once airborne this far from the grip (m) or after this long (s). */
  leaveClear: 14,
  leaveMaxTime: 4,

  /* --- perched pose (DragonPose overlay) --- */
  poseIn: 1.4,
  poseOut: 0.35,
  /** Tail wrapped to one side and draped (pose tail yaw / pitch), the neck raised, head up toward the view. */
  tailWrapYaw: 1.15,
  tailWrapPitch: 0.22,
  neckPitch: 0.1,
  /** Occasional head turns toward the view: every lookEvery s (range) by up to lookYaw rad. */
  lookEvery: [5, 11] as readonly [number, number],
  lookYaw: 0.55,
  /** Relaxed rider: reins given, leaning back. */
  riderRein: -0.28,
  riderLean: 0.12,
} as const;

/** Leap directions tried off the perch heading when leaving (rad), and the clearance their drop line keeps (m). */
const LEAP_TURNS: readonly number[] = [0, 30, -30, 60, -60, 90, -90, 135, -135, 180].map((d) => d * DEG);
const LEAP_MARGIN = 0.4;
/** Via points tried after the direct curves: [height above the start / final leg (m), offset aside (m)]; null = none. */
const VIA_POINTS: ReadonlyArray<readonly [number, number] | null> = [null, [25, 0], [25, 60], [25, -60], [50, 0], [50, 90], [50, -90]];
/** Leaving: the drop below the feet ahead that makes a drop-off (m), and the fall before the wings open. */
const DROP_DEPTH = 8;
export const DROP_OFF = {
  /** Crouch (s, m below the sit, pitch), push-off (s, forward and up speed at lift-off m/s, pitch). */
  crouch: 0.32,
  crouchDepth: 0.35,
  crouchPitch: -8 * DEG,
  push: 0.16,
  forward: 10,
  up: 3.2,
  pushPitch: 2 * DEG,
  /** The fall: nose-down pitch reached after pitchTime s, wings half open and swept back, at most maxFall s. */
  pitch: -32 * DEG,
  pitchTime: 0.7,
  spread: 0.45,
  sweep: 0.45,
  maxFall: 1.4,
} as const;
/** Half span to the wingtips (m) and how far the down-stroke takes them below the shoulders (m, full amplitude). */
const WINGTIP_SPAN = 9;
const WINGTIP_DROP = 6.8;
/** Distances to the side (m) probed for obstacles beside the wings. */
const SIDE_PROBES: readonly number[] = [4, 6.5, 9, 12];
/** Where the wings sweep (fraction of the half span to the side, metres back) during a stroke. */
const WING_SWEEP_POINTS: ReadonlyArray<readonly [number, number]> = [-1, -0.55, 0, 0.55, 1].flatMap((side) => [-4, 0, 6].map((back) => [side, back] as const));

/** Rig spheres of the clearance check, body frame (x right, y up, z back), radius (m). Wings only when spread. */
export const PERCH_BODY_SPHERES: ReadonlyArray<readonly [number, number, number, number, boolean]> = [
  [0, 0.1, 0, 1.7, false],
  [0, 0.9, -5.2, 1.1, false],
  [0, 0.4, 5.6, 1.0, false],
  [0, 0.7, 8.8, 0.6, false],
  [5.5, 0.9, 0.6, 1.3, true],
  [-5.5, 0.9, 0.6, 1.3, true],
  [10, 0.9, 1.4, 0.9, true],
  [-10, 0.9, 1.4, 0.9, true],
  // The bottom of a moderate down-stroke (the stroke is limited to the room under the wings while perching).
  [8, -2.6, 1.0, 1.0, true],
  [-8, -2.6, 1.0, 1.0, true],
];

/**
 * A planned approach: a Bézier curve from the start to the touchdown point, flown in `duration` seconds. Control
 * points: the start, the entry point (along the entry velocity), an optional via point (around or over an
 * obstacle), the start of the final leg, the touchdown point.
 */
export interface ApproachPlan {
  points: THREE.Vector3[];
  duration: number;
  /** Final yaw (Object3D yaw: the perch heading). */
  yaw: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _sphere = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _contact = { normal: new THREE.Vector3(), depth: 0, surface: '' };

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function approach(current: number, target: number, rate: number, h: number): number {
  const d = target - current;
  const s = rate * h;
  return current + (d > s ? s : d < -s ? -s : d);
}

const BINOMIAL: readonly (readonly number[])[] = [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1], [1, 4, 6, 4, 1], [1, 5, 10, 10, 5, 1]];

/** Bernstein polynomial b(i, n) at s. */
function bernstein(n: number, i: number, s: number): number {
  return BINOMIAL[n][i] * Math.pow(s, i) * Math.pow(1 - s, n - i);
}

function bezier(p: ApproachPlan, s: number, out: THREE.Vector3): THREE.Vector3 {
  const pts = p.points;
  const n = pts.length - 1;
  out.set(0, 0, 0);
  for (let i = 0; i <= n; i++) {
    out.addScaledVector(pts[i], bernstein(n, i, s));
  }
  return out;
}

/** First derivative: n Σ (P[i+1] - P[i]) b(i, n-1). */
function bezierD(p: ApproachPlan, s: number, out: THREE.Vector3): THREE.Vector3 {
  const pts = p.points;
  const n = pts.length - 1;
  out.set(0, 0, 0);
  for (let i = 0; i < n; i++) {
    out.addScaledVector(_a.subVectors(pts[i + 1], pts[i]), n * bernstein(n - 1, i, s));
  }
  return out;
}

/** Second derivative: n (n-1) Σ (P[i+2] - 2 P[i+1] + P[i]) b(i, n-2). */
function bezierDD(p: ApproachPlan, s: number, out: THREE.Vector3): THREE.Vector3 {
  const pts = p.points;
  const n = pts.length - 1;
  out.set(0, 0, 0);
  for (let i = 0; i < n - 1; i++) {
    _a.copy(pts[i + 2]).addScaledVector(pts[i + 1], -2).add(pts[i]);
    out.addScaledVector(_a, n * (n - 1) * bernstein(n - 2, i, s));
  }
  return out;
}

/** Time law of the approach: the path parameter keeps the entry pace for the first `cruise` share, then slows linearly. */
const CRUISE = 0.45;
const SIGMA0 = 2 / (1 + CRUISE);

/**
 * Kinematics of the plan at time fraction u (0..1): ds/du = SIGMA0 up to u = CRUISE, then falling linearly to 0 at
 * the touchdown (s = 1); P1 = P0 + v0·T / (n·SIGMA0) makes the start velocity the entry velocity.
 */
function sampleKinematics(p: ApproachPlan, u: number, pos: THREE.Vector3, vel: THREE.Vector3, acc: THREE.Vector3): void {
  const k = clamp(u, 0, 1);
  let s: number;
  let dsdu: number;
  let d2: number;
  if (k < CRUISE) {
    s = SIGMA0 * k;
    dsdu = SIGMA0;
    d2 = 0;
  } else {
    const e = k - CRUISE;
    s = SIGMA0 * (CRUISE + e - (e * e) / (2 * (1 - CRUISE)));
    dsdu = SIGMA0 * (1 - e / (1 - CRUISE));
    d2 = -SIGMA0 / (1 - CRUISE);
  }
  s = Math.min(s, 1);
  const ds = dsdu / p.duration;
  const dds = d2 / (p.duration * p.duration);
  bezier(p, s, pos);
  bezierD(p, s, vel);
  bezierDD(p, s, acc);
  acc.multiplyScalar(ds * ds).addScaledVector(vel, dds);
  vel.multiplyScalar(ds);
}

/** The touchdown point for a perch: feet on the grip point (the footprint centred on it), standing height. */
export function perchTouchdown(point: PerchPoint, standHeight: number, out: THREE.Vector3, baseY: number = point.y): THREE.Vector3 {
  const h = point.headingDeg * DEG;
  // Footprint centre: halfway between the hind feet (behind the centre of mass) and the fore feet (ahead of it).
  const ahead = (GROUND.foreFootZ - GROUND.hindFootZ) / 2;
  return out.set(point.x - Math.sin(h) * ahead, baseY + standHeight, point.z + Math.cos(h) * ahead);
}

/**
 * Height the feet stand on at a perch: the collision surface at the grip point when it lies within PERCH_BASE_SNAP of
 * the catalogued grip height (the colliders and the mesh differ by centimetres), else the grip height.
 */
export function perchBaseY(sim: FlightSim, point: PerchPoint): number {
  const col = sim.world.collision;
  if (!col) {
    return point.y;
  }
  // The grip point and the corners of the footprint around it (a dome or a slope rises under some feet): the highest
  // of them within the snap distance, so no foot stands below the surface.
  const h = point.headingDeg * DEG;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  let base = -Infinity;
  for (const [along, side] of FOOTPRINT) {
    const x = point.x + fx * along - fz * side;
    const z = point.z + fz * along + fx * side;
    const floor = col.columnAt(x, z, point.y + PERCH_BASE_SNAP, _column).floor;
    if (Math.abs(floor - point.y) <= PERCH_BASE_SNAP) {
      base = Math.max(base, floor);
    }
  }
  return base === -Infinity ? point.y : base;
}
/** Footprint samples around the grip (m along the heading, m to the right): centre, fore and hind feet. */
const FOOTPRINT: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1.1, 1.2],
  [1.1, -1.2],
  [-1.1, 0.8],
  [-1.1, -0.8],
];
const _column = { floor: 0, ceiling: Infinity };
const PERCH_BASE_SNAP = 0.5;

/** Centre of mass ahead of the grip (m, along the heading) with the footprint centred on it (the touchdown). */
const FLAT_AHEAD = -(GROUND.foreFootZ - GROUND.hindFootZ) / 2;

/**
 * How the dragon sits on a perch. `flat`: on all fours, the footprint centred on the grip, a little lower than
 * standing. `cap` (a narrow tower cap, grip radius <= PERCH.capGrip): upright on the hind feet at the grip like a bird
 * on a spire, wrists off the ground, nose up. `ahead` = centre of mass ahead of the grip (m).
 */
export function perchStance(point: PerchPoint): { kind: 'flat' | 'cap'; pitch: number; sink: number; ahead: number } {
  if (point.surface === 'tower' && point.gripRadius <= PERCH.capGrip) {
    const pitch = PERCH.capPitch;
    // Hind feet (hindFootZ behind the centre of mass, standHeight below it) rotated nose-up by `pitch` land on the grip.
    return { kind: 'cap', pitch, sink: PERCH.capSink, ahead: GROUND.hindFootZ * Math.cos(pitch) - PERCH.capStand * Math.sin(pitch) };
  }
  return { kind: 'flat', pitch: PERCH.sitPitch, sink: PERCH.sitSink, ahead: FLAT_AHEAD };
}

/** Object3D yaw of a perch's heading. */
export function perchYaw(point: PerchPoint): number {
  return -point.headingDeg * DEG;
}

/** Body attitude along the approach at time fraction u (world quaternion), before the start blend. */
function approachAttitude(plan: ApproachPlan, u: number, vel: THREE.Vector3, acc: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const vh = Math.hypot(vel.x, vel.z);
  const velYaw = vh > 0.5 ? Math.atan2(-vel.x, -vel.z) : plan.yaw;
  const toEnd = smoothstep(0.55, 0.92, u) + (1 - smoothstep(0.5, 2.5, vh));
  const yaw = velYaw + wrapAngle(plan.yaw - velYaw) * clamp(toEnd, 0, 1);
  const flareW = smoothstep(PERCH.flare[0], PERCH.flare[1], u);
  const gamma = Math.atan2(vel.y, Math.max(vh, 1));
  const touch = smoothstep(0.9, 1, u);
  const pitch = clamp(gamma * 0.6, -30 * DEG, 25 * DEG) * (1 - flareW) + PERCH.flarePitch * flareW * (1 - touch) + PERCH.touchPitch * touch;
  // Bank into the turn: the horizontal acceleration across the travel direction.
  const rx = Math.cos(velYaw);
  const rz = -Math.sin(velYaw);
  const lateral = acc.x * rx + acc.z * rz;
  const bank = clamp(Math.atan2(lateral, GRAVITY), -PERCH.maxBank, PERCH.maxBank) * (1 - smoothstep(0.7, 0.9, u));
  _euler.set(pitch, yaw, -bank, 'YXZ');
  return out.setFromEuler(_euler);
}

/** Tail spheres pitch with the body only this far: near the ground the tail curls up (the pose driver's tail clearance). */
const TAIL_PITCH_LIMIT = 10 * DEG;
const _qTail = new THREE.Quaternion();
const _eulerTail = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Which rig spheres count: `folded` (body, head, tail), `spread` (+ the spread wings level with the body), `stroke`
 * (+ the bottom of a moderate down-stroke), `settle` (body and head: the last 2 m onto the perch).
 */
export type SphereSet = 'folded' | 'spread' | 'stroke' | 'settle';

/**
 * Visits the clearance spheres of the rig at a body pose (world centre, radius). Tail spheres follow the body's yaw
 * and roll but its pitch only within +-TAIL_PITCH_LIMIT. Shared by the planner and the headless checks.
 */
export function visitPerchSpheres(pos: THREE.Vector3, q: THREE.Quaternion, set: SphereSet, visit: (center: THREE.Vector3, radius: number) => boolean | void, rigidTail = false): boolean {
  _eulerTail.setFromQuaternion(q, 'YXZ');
  if (!rigidTail) {
    _eulerTail.x = clamp(_eulerTail.x, -TAIL_PITCH_LIMIT, TAIL_PITCH_LIMIT);
  }
  _qTail.setFromEuler(_eulerTail);
  for (const [x, y, z, r, wing] of PERCH_BODY_SPHERES) {
    if (wing && (set === 'folded' || set === 'settle' || (set === 'spread' && y < 0))) {
      continue;
    }
    // Settling onto the perch the tail is posed by the perched overlay (wrapped aside, draped over the edge).
    if (set === 'settle' && z > 3) {
      continue;
    }
    _sphere.set(x, y, z).applyQuaternion(z > 3 ? _qTail : q).add(pos);
    if (visit(_sphere, r) === false) {
      return false;
    }
  }
  return true;
}

/**
 * Perch driver (owned by FlightSim as `sim.perch`); also the DragonPerchState the game reads through
 * DragonState.perch.
 */
export class PerchDriver implements DragonPerchState {
  phase: PerchPhase = 'free';
  phaseTime = 0;
  point: PerchPoint | null = null;
  offer: PerchPoint | null = null;
  refusals = 0;
  lastRefusal: PerchRefusal | null = null;
  aborts = 0;
  /** Viewpoints known to the driver (the 'perches' service). */
  points: readonly PerchPoint[] = [];
  /** Called after perchAt() moved the body (the flight system snaps its interpolation). */
  onPlaced: (() => void) | null = null;
  /** Approach log for headless checks: path samples that failed the clearance check on the last refusal. */
  lastBlockedAt: THREE.Vector3 | null = null;

  /** 0..1 weight of the perched pose overlay. */
  poseWeight = 0;
  /** How the last take-off off a perch went: a drop-off over an edge, or the ground's own leap. */
  lastLeave: 'drop-off' | 'ground' | null = null;
  /** Height the feet stand on at the current perch (perchBaseY). */
  baseY = 0;

  private plan: ApproachPlan | null = null;
  private readonly startQ = new THREE.Quaternion();
  private readonly prevQ = new THREE.Quaternion();
  private readonly groundUp = new THREE.Vector3(0, 1, 0);
  private touchPitch = 0;
  private promptTimer = 0;
  private cooldownId = '';
  private cooldownTime = 0;
  private padId = 0;
  private padWorld: FlightSim['world']['collision'] = undefined;
  private leaveRequested = false;
  /** Leaving off an edge: the fall before the wings open is flown here. */
  private dropOff = false;
  private leaveStage: 'none' | 'ground' | 'crouch' | 'push' | 'fall' | 'flying' = 'none';
  private stageTime = 0;
  private leaveStartY = 0;
  private leaveStartPitch = 0;
  /** Inputs held when the approach started: they count toward an abort only once released. */
  private readonly latched = { pitch: false, roll: false, yaw: false, dive: false, brake: false };
  private lookTimer = 3;
  private lookYaw = 0;
  private lookSeed = 11;
  private tailSide = 1;

  constructor(private readonly sim: FlightSim) {}

  /** The driver moves the body right now (the approach, the perched hold, the crouch, push and fall of a drop-off). */
  get ownsBody(): boolean {
    return this.phase === 'approach' || this.phase === 'perched' || (this.phase === 'leaving' && (this.leaveStage === 'crouch' || this.leaveStage === 'push' || this.leaveStage === 'fall'));
  }

  setPoints(points: readonly PerchPoint[]): void {
    this.points = points;
  }

  /** Teleport / reset: back to free flight (the pad goes). */
  reset(): void {
    this.setPhase('free');
    this.point = null;
    this.offer = null;
    this.plan = null;
    this.leaveRequested = false;
    this.dropOff = false;
    this.leaveStage = 'none';
    this.poseWeight = 0;
    this.removePad();
  }

  perchAt(id: string): boolean {
    const p = this.points.find((q) => q.id === id);
    if (!p) {
      return false;
    }
    this.placeOn(p);
    this.onPlaced?.();
    return true;
  }

  leave(): boolean {
    if (this.phase !== 'perched') {
      return false;
    }
    this.leaveRequested = true;
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Step hook                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Called by FlightSim.step after the surface sample, before the mode code. Returns true when the driver moved the
   * body this step (the sim then skips its own mode code).
   */
  step(sim: FlightSim, cmd: PilotCommand, h: number): boolean {
    this.phaseTime += h;
    this.cooldownTime = Math.max(0, this.cooldownTime - h);
    switch (this.phase) {
      case 'approach':
        if (this.shouldAbort(sim, cmd)) {
          this.abort(sim);
          return false;
        }
        this.stepApproach(sim, h);
        return true;
      case 'perched':
        if (cmd.flapPressed || cmd.landPressed || this.leaveRequested) {
          cmd.flapPressed = false;
          cmd.landPressed = false;
          this.startLeaving(sim);
          // A drop-off is flown here from this step on; a ground take-off runs in the grounded stance.
          return this.dropOff ? this.stepLeaving(sim, h) : false;
        }
        this.stepPerched(sim, h);
        return true;
      case 'leaving':
        return this.stepLeaving(sim, h);
      default:
        this.stepPrompt(sim, cmd, h);
        return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Prompt                                                               */
  /* ------------------------------------------------------------------ */

  private stepPrompt(sim: FlightSim, cmd: PilotCommand, h: number): void {
    const eligible = sim.airborne && sim.maneuvers.kind === 'none';
    if (!eligible) {
      this.offer = null;
    } else {
      this.promptTimer -= h;
      if (this.promptTimer <= 0) {
        this.promptTimer = PERCH.promptInterval;
        this.offer = this.evaluateOffer(sim);
      }
    }
    if (cmd.landPressed && this.offer) {
      cmd.landPressed = false;
      const plan = this.planApproach(sim, this.offer);
      if (plan) {
        this.latchInputs(cmd);
        this.beginApproach(sim, this.offer, plan);
      } else {
        this.refusals++;
        this.lastRefusal = 'blocked';
        sim.emit({ type: 'maneuver', id: 'hint', label: 'Konma yolu kapalı' });
      }
    }
  }

  /** The perch in reach right now (with hysteresis against the one offered), or null. */
  evaluateOffer(sim: FlightSim): PerchPoint | null {
    const p = sim.body.position;
    const v = sim.body.velocity;
    const current = this.offer;
    let best: PerchPoint | null = null;
    let bestD = Infinity;
    for (const q of this.points) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d >= bestD || d > PERCH.reach[1]) {
        continue;
      }
      if (q.id === this.cooldownId && (this.cooldownTime > 0 || d < PERCH.cooldownDistance)) {
        continue;
      }
      if (this.inReach(sim, q, d, v, q === current)) {
        best = q;
        bestD = d;
      }
    }
    if (this.cooldownId) {
      const cool = this.points.find((q) => q.id === this.cooldownId);
      if (!cool || (this.cooldownTime <= 0 && Math.hypot(cool.x - p.x, cool.z - p.z) >= PERCH.cooldownDistance)) {
        this.cooldownId = '';
      }
    }
    return best;
  }

  /** Reach, speed, height and cone test (`held`: the perch is offered already, the looser thresholds apply). */
  inReach(sim: FlightSim, q: PerchPoint, distance: number, v: THREE.Vector3, held: boolean): boolean {
    const k = held ? 1 : 0;
    if (distance > PERCH.reach[k] || sim.airspeed > PERCH.speed[k]) {
      return false;
    }
    const dy = sim.body.position.y - q.y;
    if (dy > PERCH.above[k] || -dy > PERCH.below[k]) {
      return false;
    }
    const vh = Math.hypot(v.x, v.z);
    if (vh < PERCH.slowSpeed || distance < 1) {
      return true;
    }
    const cos = ((q.x - sim.body.position.x) * v.x + (q.z - sim.body.position.z) * v.z) / (distance * vh);
    return Math.acos(clamp(cos, -1, 1)) <= PERCH.cone[k];
  }

  /* ------------------------------------------------------------------ */
  /* Approach planning                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Plans a clear approach to `point` from the current state: arrival directions around the perch heading and
   * arrival heights are tried in order until one path passes the clearance check. Null when none does.
   */
  planApproach(sim: FlightSim, point: PerchPoint): ApproachPlan | null {
    this.lastBlockedAt = null;
    const b = sim.body;
    const touch = perchTouchdown(point, sim.standHeight, new THREE.Vector3(), perchBaseY(sim, point));
    const yaw = perchYaw(point);
    // Direct curves first (every arrival), then curves through a via point above or beside the way.
    for (const via of VIA_POINTS) {
      for (const lift of PERCH.arriveLift) {
        for (const off of PERCH.arriveYaw) {
          const dir = yaw + off;
          const fx = -Math.sin(dir);
          const fz = -Math.cos(dir);
          const leg = new THREE.Vector3(touch.x - fx * PERCH.arriveBack, touch.y + PERCH.arriveUp * lift, touch.z - fz * PERCH.arriveBack);
          const points = [b.position.clone(), new THREE.Vector3()];
          if (via) {
            // Halfway between the start and the final leg, raised, and pushed aside across the line between them.
            const v = new THREE.Vector3().addVectors(b.position, leg).multiplyScalar(0.5);
            const dx = leg.x - b.position.x;
            const dz = leg.z - b.position.z;
            const len = Math.hypot(dx, dz) || 1;
            v.x += (-dz / len) * via[1];
            v.z += (dx / len) * via[1];
            v.y = Math.max(v.y, Math.max(b.position.y, leg.y) + via[0]);
            points.push(v);
          }
          points.push(leg, touch.clone());
          const plan: ApproachPlan = { points, duration: PERCH.minTime, yaw };
          this.timePlan(plan, b.velocity);
          if (this.accelOk(plan) && this.clearOk(sim, plan)) {
            return plan;
          }
        }
      }
    }
    return null;
  }

  /** Duration from the path length and the entry speed (the entry point follows the entry velocity, so iterate). */
  private timePlan(plan: ApproachPlan, v0: THREE.Vector3): void {
    const speed = v0.length();
    const mean = (Math.max(speed, PERCH.slowMeanSpeed * 2) * (1 + CRUISE)) / 2;
    const lead = 1 / ((plan.points.length - 1) * SIGMA0);
    const [p0, p1] = plan.points;
    for (let it = 0; it < 4; it++) {
      p1.copy(p0).addScaledVector(v0, plan.duration * lead);
      let length = 0;
      bezier(plan, 0, _b);
      for (let i = 1; i <= 32; i++) {
        bezier(plan, i / 32, _c);
        length += _b.distanceTo(_c);
        _b.copy(_c);
      }
      plan.duration = clamp(length / mean, PERCH.minTime, PERCH.maxTime);
    }
    p1.copy(p0).addScaledVector(v0, plan.duration * lead);
  }

  private accelOk(plan: ApproachPlan): boolean {
    for (let i = 0; i <= 40; i++) {
      sampleKinematics(plan, i / 40, _pos, _vel, _acc);
      if (_acc.length() > PERCH.maxAccel) {
        return false;
      }
    }
    return true;
  }

  /**
   * The rig spheres along the path against the collision world (terrain and colliders, not the sea: the approach
   * may skim it): nothing may come closer than PERCH.clearance. Wing spheres count while the wings are spread (all of
   * the approach but the last metres, where they fold over the perch).
   */
  private clearOk(sim: FlightSim, plan: ApproachPlan): boolean {
    const col = sim.world.collision;
    if (!col) {
      return true;
    }
    const n = PERCH.checkSamples;
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      sampleKinematics(plan, u, _pos, _vel, _acc);
      approachAttitude(plan, u, _vel, _acc, _q);
      const toEnd = _pos.distanceTo(plan.points[plan.points.length - 1]);
      // The margin fades over the last metres: the body settles onto the perch there.
      const margin = PERCH.clearance * smoothstep(1, 6, toEnd);
      const clear = visitPerchSpheres(_pos, _q, toEnd > 3 ? 'stroke' : toEnd > 2 ? 'folded' : 'settle', (c, r) => {
        // Over the sea the water is no obstacle (the terrain floor below it is): test the colliders only there.
        const overSea = col.terrainHeight(c.x, c.z) < 0;
        const hit = col.resolveSphere(c, r + margin, _contact, !overSea);
        if ((hit && hit.surface !== 'perch') || (overSea && c.y - r < 0.5)) {
          this.lastBlockedAt = c.clone();
          return false;
        }
        return true;
      });
      if (!clear) {
        return false;
      }
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Approach                                                             */
  /* ------------------------------------------------------------------ */

  private beginApproach(sim: FlightSim, point: PerchPoint, plan: ApproachPlan): void {
    this.point = point;
    this.offer = null;
    this.plan = plan;
    this.startQ.copy(sim.body.quaternion);
    this.prevQ.copy(sim.body.quaternion);
    this.setPhase('approach');
    sim.maneuvers.cancel(sim);
    setModeQuiet(sim, 'landing');
    sim.emit({ type: 'maneuver', id: 'land', label: `Konuyor · ${point.name}` });
  }

  /** Latches the inputs held at the start (called with the first approach command). */
  private latchInputs(cmd: PilotCommand): void {
    const l = this.latched;
    l.pitch = Math.abs(cmd.pitch) > 0.3;
    l.roll = Math.abs(cmd.roll) > 0.3;
    l.yaw = Math.abs(cmd.yaw) > 0.3;
    l.dive = cmd.dive;
    l.brake = cmd.brake;
  }

  /** Stick, dive, brake, a flap or L again aborts (inputs held from before the approach only once released). */
  private shouldAbort(sim: FlightSim, cmd: PilotCommand): boolean {
    // Inputs held into the approach stay latched until released.
    const l = this.latched;
    l.pitch &&= Math.abs(cmd.pitch) > 0.3;
    l.roll &&= Math.abs(cmd.roll) > 0.3;
    l.yaw &&= Math.abs(cmd.yaw) > 0.3;
    l.dive &&= cmd.dive;
    l.brake &&= cmd.brake;
    if (this.phaseTime < PERCH.abortGrace) {
      return false;
    }
    const a = PERCH.abortStick;
    return (
      cmd.flapPressed ||
      cmd.landPressed ||
      (!l.pitch && Math.abs(cmd.pitch) > a) ||
      (!l.roll && Math.abs(cmd.roll) > a) ||
      (!l.yaw && Math.abs(cmd.yaw) > a) ||
      (!l.dive && cmd.dive) ||
      (!l.brake && cmd.brake)
    );
  }

  /** Back to free flight from wherever the approach is (the airborne model takes over from the current state). */
  private abort(sim: FlightSim): void {
    this.aborts++;
    this.plan = null;
    this.point = null;
    this.setPhase('free');
    sim.controller.holdPath(Math.max(sim.gamma, 0.05));
    sim.setMode(sim.airspeed < 12 ? 'takeoff' : 'flying');
    sim.emit({ type: 'maneuver', id: 'hint', label: 'Konma iptal' });
  }

  private stepApproach(sim: FlightSim, h: number): void {
    const plan = this.plan;
    const point = this.point;
    if (!plan || !point) {
      this.setPhase('free');
      return;
    }
    const b = sim.body;
    const u = clamp(this.phaseTime / plan.duration, 0, 1);
    sampleKinematics(plan, u, _pos, _vel, _acc);
    b.position.copy(_pos);
    b.velocity.copy(_vel);
    approachAttitude(plan, u, _vel, _acc, _q);
    const blend = smoothstep(0, PERCH.blendIn, this.phaseTime);
    _q2.copy(this.startQ).slerp(_q, blend);
    this.prevQ.copy(b.quaternion);
    b.quaternion.copy(_q2);
    bodyRates(this.prevQ, b.quaternion, h, b.angularVelocity);
    sim.axes.update(b.quaternion);

    // Wings, legs and beat: relaxed strokes on the way in, spread and swept forward into the flare, back-strokes.
    const flareW = smoothstep(PERCH.flare[0], PERCH.flare[1], u);
    const hover = smoothstep(PERCH.hover[0], PERCH.hover[1], u);
    // Something reaching up beside the wings (a tower next to the perch): the wings open only as far as there is room.
    sim.spread = approach(sim.spread, Math.max(this.spreadRoom(sim), PERCH.minSpread * smoothstep(PERCH.raise[0], PERCH.raise[1], u)), 2.5, h);
    sim.sweep = approach(sim.sweep, -0.85 * flareW, 2.5, h);
    sim.brake = flareW;
    sim.hoverBlend = hover;
    sim.legsOut = approach(sim.legsOut, smoothstep(PERCH.legs[0], PERCH.legs[1], u), 2.5, h);
    sim.attachment = 1;
    sim.updateInertia();
    const climb = clamp(_vel.y / 6, -1, 1);
    const effort = u < PERCH.flare[0] ? clamp(0.28 + 0.3 * climb, 0.04, 0.7) : 0.35 + 0.4 * flareW * (1 - smoothstep(0.93, 1, u));
    // The down-stroke keeps the wingtips clear of whatever is under them (a tower's shaft beside the path, a hill).
    const room = this.wingRoom(sim);
    // No strokes with the wings half folded, and none in the last moments before the feet touch.
    const ampLimit = clamp((room - 2) / WINGTIP_DROP, 0, 1) * smoothstep(0.35, 0.7, sim.spread) * (1 - smoothstep(0.9, 0.98, u));
    const beat = sim.beat;
    if (u < PERCH.raise[0]) {
      beat.update(h, effort, hover, ampLimit);
    } else {
      // The last moments: the wings held raised in a V over the back (the top of the stroke), ready to fold.
      beat.phase = approach(beat.phase < Math.PI ? beat.phase + TWO_PI : beat.phase, PHASE_TOP, TWO_PI * 1.5, h) % TWO_PI;
      beat.amplitude = approach(beat.amplitude, PERCH.raiseAmplitude, 2, h);
      beat.effort = approach(beat.effort, 0.3, 2, h);
      beat.downstrokeStarted = false;
    }
    if (beat.downstrokeStarted) {
      sim.emit({ type: 'flap', strength: 0.3 + 0.7 * sim.beat.effort });
    }
    fillTelemetry(sim, _vel, _acc);
    this.bodyClearance(sim);

    if (u >= 1) {
      this.touchdown(sim, point, _vel.length());
    }
  }

  private touchdown(sim: FlightSim, point: PerchPoint, speed: number): void {
    this.plan = null;
    this.touchPitch = sim.axes.pitch();
    this.enterPerched(sim, point);
    sim.emit({ type: 'landed', point: new THREE.Vector3(point.x, this.baseY, point.z), speed: Math.max(speed, 0.8), water: false });
  }

  /* ------------------------------------------------------------------ */
  /* Perched                                                              */
  /* ------------------------------------------------------------------ */

  /** Directly on the perch in the settled sit (map / menu teleport). */
  private placeOn(point: PerchPoint): void {
    const sim = this.sim;
    this.removePad();
    this.plan = null;
    sim.maneuvers.cancel(sim);
    this.touchPitch = perchStance(point).pitch;
    this.enterPerched(sim, point);
    this.phaseTime = PERCH.settleTime;
    this.poseWeight = 1;
    sim.spread = 0.06;
    sim.sweep = 0;
    sim.legsOut = 1;
    sim.hoverBlend = 0;
    sim.brake = 0;
    sim.beat.reset(PHASE_TOP);
    sim.updateInertia();
    this.holdPose(sim, 1 / 120, true);
    sim.sampleSurface();
    this.writeSurface(sim, point);
  }

  private enterPerched(sim: FlightSim, point: PerchPoint): void {
    this.point = point;
    this.offer = null;
    this.leaveRequested = false;
    this.setPhase('perched');
    this.removePad();
    this.baseY = perchBaseY(sim, point);
    this.surfaceUp(sim, point, this.groundUp);
    this.addPad(sim, point);
    const m = sim.moves;
    sim.groundYaw = perchYaw(point);
    sim.groundSpeed = 0;
    sim.groundYawRate = 0;
    sim.leapCharge = 0;
    sim.runTakeoff = 0;
    sim.walkAmount = 0;
    m.runOut = false;
    m.leap = null;
    m.skid = 0;
    m.crouch = 0;
    m.heelLift = 0;
    m.wingRaise = 0;
    m.gait = 0;
    m.stride = 0;
    m.takeoffVariant = null;
    m.groundNormal.copy(this.groundUp);
    m.baseY = this.baseY;
    m.settlePitch = 0;
    m.settlePitchRate = 0;
    m.settleY = 0;
    m.settleVy = 0;
    this.tailSide = this.pickTailSide(sim, point);
    sim.body.velocity.set(0, 0, 0);
    sim.body.angularVelocity.set(0, 0, 0);
    setModeQuiet(sim, 'grounded');
  }

  private stepPerched(sim: FlightSim, h: number): void {
    const point = this.point!;
    this.holdPose(sim, h, false);
    this.writeSurface(sim, point);
    // Wings fold (the wrists become fore feet), the beat winds down to the top of the stroke.
    const m = sim.moves;
    sim.spread = approach(sim.spread, 0.06, 1.8, h);
    sim.sweep = approach(sim.sweep, 0, 2.5, h);
    sim.legsOut = approach(sim.legsOut, 1, 3, h);
    sim.hoverBlend = approach(sim.hoverBlend, 0, 2, h);
    sim.brake = approach(sim.brake, 0, 3, h);
    sim.attachment = 1;
    sim.updateInertia();
    const beat = sim.beat;
    const target = beat.phase < Math.PI ? 0 : PHASE_TOP;
    beat.phase = approach(beat.phase, target, TWO_PI * Math.max(beat.frequency, FLAP.freqMin), h);
    if (target === 0 && beat.phase <= 0) {
      beat.phase = PHASE_TOP;
    }
    // The amplitude fades slower than the wings fold: they fold from the raised V down onto the back.
    beat.amplitude = approach(beat.amplitude, 0, 1.1, h);
    beat.effort = approach(beat.effort, 0, 2, h);
    beat.downstrokeStarted = false;
    // On a cap the wrists stay off the stone (upright on the hind feet); elsewhere they become the fore feet.
    m.foreGround = approach(m.foreGround, perchStance(point).kind === 'cap' ? 0 : smoothstep(0.3, 0.1, sim.spread), 5, h);
    m.wingRaise = approach(m.wingRaise, 0, 3, h);
    m.heelLift = approach(m.heelLift, 0, 4, h);
    fillTelemetry(sim, null, null);
  }

  /** Body on the perch: settles from the touchdown into the sit (height, pitch), facing the perch heading. */
  private holdPose(sim: FlightSim, h: number, snap: boolean): void {
    const point = this.point!;
    const b = sim.body;
    const k = smoothstep(0, PERCH.settleTime, this.phaseTime);
    const st = perchStance(point);
    const pitch = this.touchPitch + (st.pitch - this.touchPitch) * k;
    // On a slope the uphill legs are already folded: sit less deep (the feet stay on the surface).
    const tilt = Math.acos(clamp(this.groundUp.y, -1, 1));
    const sink = st.sink * k * (1 - 0.8 * clamp(tilt / PERCH.maxSlope, 0, 1));
    // The centre of mass slides from the touchdown (footprint centred on the grip) to the stance's seat.
    const ahead = FLAT_AHEAD + (st.ahead - FLAT_AHEAD) * k;
    const hd = point.headingDeg * DEG;
    b.position.set(point.x + Math.sin(hd) * ahead, this.baseY + standDepth(sim.standHeight, pitch) - sink, point.z - Math.cos(hd) * ahead);
    b.velocity.set(0, 0, 0);
    // Up: part of the perch surface's slope; forward: the perch heading on that plane; then the sit's pitch.
    const yaw = perchYaw(point);
    _up.set(0, 1, 0).lerp(this.groundUp, PERCH.slopeFollow).normalize();
    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _fwd.addScaledVector(_up, -_fwd.dot(_up)).normalize();
    _right.crossVectors(_fwd, _up).normalize();
    _back.copy(_fwd).negate();
    _basis.makeBasis(_right, _up, _back);
    _q.setFromRotationMatrix(_basis);
    _euler.set(pitch, 0, 0, 'YXZ');
    _q.multiply(_q2.setFromEuler(_euler));
    this.prevQ.copy(b.quaternion);
    if (snap) {
      b.quaternion.copy(_q);
    } else {
      b.quaternion.slerp(_q, 1 - Math.exp(-10 * h));
    }
    bodyRates(this.prevQ, b.quaternion, h, b.angularVelocity);
    sim.axes.update(b.quaternion);
    sim.moves.extraPitch = pitch;
    sim.moves.extraRoll = 0;
  }

  /** The ground under the dragon while perched is the perch (the pad and the structure agree within centimetres). */
  private writeSurface(sim: FlightSim, point: PerchPoint): void {
    sim.surfaceY = this.baseY;
    sim.agl = sim.body.position.y - this.baseY;
    sim.footClearance = sim.agl - sim.footDepth();
  }

  /** Slope of the perch surface around the grip point (collision tops at ±1.5 m); flat where the samples fall off. */
  private surfaceUp(sim: FlightSim, point: PerchPoint, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 1, 0);
    const col = sim.world.collision;
    if (point.surface === 'hill' && sim.world.geo) {
      // Hills: the terrain normal, as the ground stance uses it.
      sim.world.geo.normalAt(point.x, point.z, out);
      return out;
    }
    if (!col) {
      return out;
    }
    const d = 1.5;
    const probe = (x: number, z: number): number => {
      const y = col.columnAt(x, z, point.y + 0.5, { floor: 0, ceiling: Infinity }).floor;
      return Math.abs(y - point.y) > d * Math.tan(PERCH.maxSlope) + 0.3 ? point.y : y;
    };
    const dx = (probe(point.x + d, point.z) - probe(point.x - d, point.z)) / (2 * d);
    const dz = (probe(point.x, point.z + d) - probe(point.x, point.z - d)) / (2 * d);
    out.set(-dx, 1, -dz).normalize();
    const tilt = Math.acos(clamp(out.y, -1, 1));
    if (tilt > PERCH.maxSlope) {
      out.set(0, 1, 0).lerp(_a.set(-dx, 1, -dz).normalize(), PERCH.maxSlope / tilt).normalize();
    }
    return out;
  }

  /** The tail wraps to the side with more room (the lower collision surface a few metres back and aside). */
  private pickTailSide(sim: FlightSim, point: PerchPoint): number {
    const col = sim.world.collision;
    if (!col) {
      return 1;
    }
    const yaw = perchYaw(point);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    // Right of the heading is (-fz, fx).
    const at = (side: number): number => {
      let top = -Infinity;
      for (const [back, aside] of [
        [4, 3],
        [6, 5],
        [3, 6],
      ]) {
        const x = point.x - fx * back - fz * aside * side;
        const z = point.z - fz * back + fx * aside * side;
        top = Math.max(top, col.surfaceHeight(x, z));
      }
      return top;
    };
    const right = at(1);
    const left = at(-1);
    if (Math.abs(right - left) < 0.3) {
      // No difference in the colliders: away from the landmark's centre (a dome's crown and alem, a tower's axis).
      const def = point.landmarkId ? sim.world.geo?.landmark(point.landmarkId) : undefined;
      if (def) {
        const toward = (def.x - point.x) * -fz + (def.z - point.z) * fx;
        return toward > 0 ? -1 : 1;
      }
      return 1;
    }
    return right < left ? 1 : -1;
  }

  /* ------------------------------------------------------------------ */
  /* Leaving                                                              */
  /* ------------------------------------------------------------------ */

  private startLeaving(sim: FlightSim): void {
    this.leaveRequested = false;
    this.setPhase('leaving');
    sim.sampleSurface();
    const point = this.point!;
    const line = point.surface !== 'hill' ? this.clearLeapYaw(sim, point) : null;
    this.dropOff = line !== null;
    this.lastLeave = this.dropOff ? 'drop-off' : 'ground';
    sim.groundYaw = line ?? perchYaw(point);
    this.leaveStage = this.dropOff ? 'crouch' : 'ground';
    this.stageTime = 0;
    this.leaveStartY = sim.body.position.y;
    this.leaveStartPitch = sim.axes.pitch();
    if (!this.dropOff) {
      // Hills and low terraces: the ground's own take-off (a drop where the slope falls away, else a standing leap).
      enterStance(sim, false);
      startLeap(sim, pickVariant(sim));
    }
  }

  /** The surface falls away ahead of the perch (DROP_DEPTH m below the feet 12 and 16 m out). */
  private dropAhead(sim: FlightSim, point: PerchPoint, yaw: number): boolean {
    const col = sim.world.collision;
    if (!col) {
      return false;
    }
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    for (const d of [12, 16]) {
      if (col.surfaceHeight(point.x + fx * d, point.z + fz * d) > this.baseY - DROP_DEPTH) {
        return false;
      }
    }
    return true;
  }

  /**
   * The first leap direction (Object3D yaw) around the perch heading with a drop ahead whose drop-off keeps the
   * rig's spheres clear: the push-off and the fall with the wings half open (DROP_OFF) until the wings have room for
   * the first down-stroke. Null when there is none (the ground take-off is used instead).
   */
  clearLeapYaw(sim: FlightSim, point: PerchPoint): number | null {
    const col = sim.world.collision;
    const yaw0 = perchYaw(point);
    if (!col) {
      return null;
    }
    const start = sim.body.position;
    for (const off of LEAP_TURNS) {
      const yaw = yaw0 + off;
      if (!this.dropAhead(sim, point, yaw)) {
        continue;
      }
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      let clear = true;
      let room = false;
      // From just after the lift-off (the push starts over the perch top, rising): body, head and tail, then the legs.
      for (let t = 0.3; t <= DROP_OFF.maxFall && clear; t += 0.05) {
        const d = DROP_OFF.forward * t;
        const y = start.y + DROP_OFF.up * t - 0.5 * GRAVITY * t * t;
        _pos.set(start.x + fx * d, y, start.z + fz * d);
        _euler.set(DROP_OFF.pitch * smoothstep(0, DROP_OFF.pitchTime, t), yaw, 0, 'YXZ');
        _q.setFromEuler(_euler);
        const free = (c: THREE.Vector3, r: number): boolean => {
          const sea = col.terrainHeight(c.x, c.z) < 0;
          const hit = col.resolveSphere(c, r + LEAP_MARGIN, _contact, !sea);
          return !hit || hit.surface === 'perch';
        };
        // The body, head and tail (the tail rises with the nose-down fall), and the legs hanging below the belly.
        clear = visitPerchSpheres(_pos, _q, 'folded', free, true) && (t < 0.45 || free(_a.set(0, -1.2, 0.6).applyQuaternion(_q).add(_pos), 1.1));
        if (clear && this.roomAt(col, _pos, yaw, 0) >= WINGTIP_DROP + 1) {
          // Room for the wings to open here: this line works.
          room = true;
          break;
        }
      }
      if (clear && room) {
        return yaw;
      }
    }
    return null;
  }

  /**
   * Leaving, every substep before the sim's own step. A drop-off is flown here (returns true): the crouch, the
   * push-off forward and up, the fall with the wings half open and still until they have room for a full down-stroke,
   * then the wings snap open into the take-off law's drop dive. The phase ends once clear of the perch.
   */
  private stepLeaving(sim: FlightSim, h: number): boolean {
    const point = this.point;
    const p = sim.body.position;
    let owned = false;
    if (this.leaveStage === 'crouch' || this.leaveStage === 'push' || this.leaveStage === 'fall') {
      this.stageTime += h;
      owned = true;
      if (this.leaveStage === 'crouch') {
        this.stepCrouch(sim, h);
        if (this.stageTime >= DROP_OFF.crouch) {
          this.leaveStage = 'push';
          this.stageTime = 0;
        }
      } else if (this.leaveStage === 'push') {
        this.stepPush(sim, h);
        if (this.stageTime >= DROP_OFF.push) {
          this.leaveStage = 'fall';
          this.stageTime = 0;
          setModeQuiet(sim, 'takeoff');
          sim.moves.sinceLiftOff = 0;
          sim.emit({ type: 'maneuver', id: 'takeoff', label: 'Boşluğa atıldı' });
          sim.emit({ type: 'dust', point: new THREE.Vector3(p.x, this.baseY, p.z), strength: 0.5 });
        }
      } else {
        const col = sim.world.collision;
        const room = col ? this.roomAt(col, p, sim.groundYaw, sim.axes.bank()) : Infinity;
        if (room >= WINGTIP_DROP + 1 || this.stageTime >= DROP_OFF.maxFall) {
          this.releaseFall(sim);
          owned = false;
        } else {
          this.stepFall(sim, h);
        }
      }
    }
    const far = point ? Math.hypot(p.x - point.x, p.z - point.z) > PERCH.leaveClear || p.y < this.baseY - PERCH.leaveClear : true;
    if (!owned && ((sim.airborne && far) || this.phaseTime > PERCH.leaveMaxTime)) {
      this.removePad();
      this.cooldownId = point?.id ?? '';
      this.cooldownTime = PERCH.cooldownTime;
      this.point = null;
      this.dropOff = false;
      this.leaveStage = 'none';
      this.setPhase('free');
    }
    return owned;
  }

  /** Crouch before the drop-off: the body sinks and tips forward, the wrists stand, hands raised high and back. */
  private stepCrouch(sim: FlightSim, h: number): void {
    const b = sim.body;
    const m = sim.moves;
    const k = smoothstep(0, DROP_OFF.crouch, this.stageTime);
    const pitch = this.leaveStartPitch + (DROP_OFF.crouchPitch - this.leaveStartPitch) * k;
    b.position.y = this.leaveStartY - DROP_OFF.crouchDepth * k;
    this.orient(sim, pitch, h, 20);
    b.velocity.set(0, -DROP_OFF.crouchDepth / DROP_OFF.crouch, 0);
    m.crouch = k;
    m.wingRaise = k;
    m.heelLift = 0;
    m.foreGround = 1;
    sim.leapCharge = DROP_OFF.crouch - this.stageTime + DROP_OFF.push;
    sim.spread = approach(sim.spread, 0.06, 2, h);
    this.windBeat(sim, h);
    this.writeSurface(sim, this.point!);
    fillTelemetry(sim, null, null);
  }

  /** Push-off: the legs extend and throw the body forward and up; the wrists lift and the wings half open. */
  private stepPush(sim: FlightSim, h: number): void {
    const b = sim.body;
    const m = sim.moves;
    const k = smoothstep(0, DROP_OFF.push, this.stageTime);
    const fx = -Math.sin(sim.groundYaw);
    const fz = -Math.cos(sim.groundYaw);
    b.velocity.set(fx * DROP_OFF.forward * k, DROP_OFF.up * k, fz * DROP_OFF.forward * k);
    b.position.addScaledVector(b.velocity, h);
    this.orient(sim, DROP_OFF.crouchPitch + (DROP_OFF.pushPitch - DROP_OFF.crouchPitch) * k, h, 20);
    m.crouch = 1 - k;
    m.wingRaise = 1;
    m.heelLift = smoothstep(0.3, 1, k);
    m.foreGround = 1 - smoothstep(0, 0.6, k);
    sim.leapCharge = DROP_OFF.push - this.stageTime;
    sim.spread = approach(sim.spread, DROP_OFF.spread, 4, h);
    sim.sweep = approach(sim.sweep, DROP_OFF.sweep, 4, h);
    sim.updateInertia();
    this.windBeat(sim, h);
    fillTelemetry(sim, b.velocity, null);
  }

  /** The fall: ballistic, the nose dropping into the dive, wings half open and still, legs trailing. */
  private stepFall(sim: FlightSim, h: number): void {
    const b = sim.body;
    const m = sim.moves;
    b.velocity.y -= GRAVITY * h;
    b.position.addScaledVector(b.velocity, h);
    this.orient(sim, DROP_OFF.pushPitch + (DROP_OFF.pitch - DROP_OFF.pushPitch) * smoothstep(0, DROP_OFF.pitchTime, this.stageTime), h, 8);
    m.sinceLiftOff += h;
    m.wingRaise = approach(m.wingRaise, 0, 3, h);
    m.heelLift = approach(m.heelLift, 0, 3, h);
    m.foreGround = 0;
    sim.leapCharge = 0;
    sim.spread = approach(sim.spread, DROP_OFF.spread, 3, h);
    sim.sweep = approach(sim.sweep, DROP_OFF.sweep, 3, h);
    sim.hoverBlend = approach(sim.hoverBlend, 0, 2, h);
    sim.brake = 0;
    sim.attachment = 1;
    sim.updateInertia();
    this.windBeat(sim, h);
    sim.sampleSurface();
    fillTelemetry(sim, b.velocity, _acc.set(0, -GRAVITY, 0));
  }

  /** The wings snap open: the first full down-stroke at once, then the take-off law's drop dive takes over. */
  private releaseFall(sim: FlightSim): void {
    const m = sim.moves;
    this.leaveStage = 'flying';
    m.takeoffVariant = 'drop';
    m.takeoffBeats = 0;
    m.tuckTime = -1;
    sim.legsOut = 1;
    sim.spread = Math.max(sim.spread, 0.8);
    sim.hoverBlend = 0.3;
    const beat = sim.beat;
    beat.phase = 0;
    beat.amplitude = Math.max(beat.amplitude, 0.9);
    beat.effort = Math.max(beat.effort, 0.8);
    beat.downstrokeStarted = true;
    sim.modeTime = 0;
    sim.controller.onModeEnter('takeoff');
    sim.emit({ type: 'flap', strength: 1 });
    sim.emit({ type: 'sound', name: 'wing-snap', volume: 0.9 });
    sim.emit({ type: 'shake', amount: 0.12 });
  }

  /** Body yaw along the leap, pitched `pitch`, approached at `rate` (1/s). */
  private orient(sim: FlightSim, pitch: number, h: number, rate: number): void {
    const b = sim.body;
    _euler.set(pitch, sim.groundYaw, 0, 'YXZ');
    _q.setFromEuler(_euler);
    this.prevQ.copy(b.quaternion);
    b.quaternion.slerp(_q, 1 - Math.exp(-rate * h));
    bodyRates(this.prevQ, b.quaternion, h, b.angularVelocity);
    sim.axes.update(b.quaternion);
  }

  /** The beat holds at the top of the stroke (no down-stroke until the wings have room). */
  private windBeat(sim: FlightSim, h: number): void {
    const beat = sim.beat;
    beat.amplitude = approach(beat.amplitude, 0, 3, h);
    beat.effort = approach(beat.effort, 0, 3, h);
    beat.phase = approach(beat.phase < Math.PI ? beat.phase + TWO_PI : beat.phase, PHASE_TOP, TWO_PI * 2, h) % TWO_PI;
    beat.downstrokeStarted = false;
  }

  /**
   * Largest wing spread with room beside the body: surfaces reaching up to the wings' level at the sides (from 4 m
   * out) cut the span back (spread 1 = WINGTIP_SPAN + 3 m to a side).
   */
  private spreadRoom(sim: FlightSim): number {
    const col = sim.world.collision;
    if (!col) {
      return 1;
    }
    const b = sim.body;
    const yaw = sim.axes.yaw();
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let near = Infinity;
    for (const side of [-1, 1]) {
      for (const d of SIDE_PROBES) {
        for (const back of [-3, 1, 5]) {
          const x = b.position.x + rx * side * d + Math.sin(yaw) * back;
          const z = b.position.z + rz * side * d + Math.cos(yaw) * back;
          if (col.surfaceHeight(x, z) > b.position.y - 1) {
            near = Math.min(near, d);
          }
        }
      }
    }
    return near === Infinity ? 1 : clamp((near - 3) / (WINGTIP_SPAN + 3), 0.3, 1);
  }

  /**
   * Height telemetry from the whole body: the lowest clearance of the centre, the head and the tail over the surface
   * under each (a narrow perch under the tail while the centre is over the drop): the pose driver curls the tail and
   * reaches the legs with it.
   */
  private bodyClearance(sim: FlightSim): void {
    const col = sim.world.collision;
    if (!col) {
      return;
    }
    const b = sim.body;
    const yaw = sim.axes.yaw();
    let agl = sim.agl;
    for (const back of [-5, 6, 9]) {
      const x = b.position.x + Math.sin(yaw) * back;
      const z = b.position.z + Math.cos(yaw) * back;
      agl = Math.min(agl, b.position.y - Math.max(col.surfaceHeight(x, z), 0));
    }
    if (agl < sim.agl) {
      sim.agl = agl;
      sim.footClearance = agl - sim.footDepth();
    }
  }

  /** Room (m) under the wings for a down-stroke at the current pose. */
  private wingRoom(sim: FlightSim): number {
    const col = sim.world.collision;
    return col ? this.roomAt(col, sim.body.position, sim.axes.yaw(), sim.axes.bank()) : Infinity;
  }

  /** Room (m) under the wings for a down-stroke: the wing level minus the highest surface under the stroke's sweep. */
  private roomAt(col: NonNullable<FlightSim['world']['collision']>, pos: THREE.Vector3, yaw: number, bank: number): number {
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let room = Infinity;
    for (const [side, back] of WING_SWEEP_POINTS) {
      // Right is (rx, rz); back along the heading is (sin yaw, cos yaw).
      const x = pos.x + rx * side * WINGTIP_SPAN + Math.sin(yaw) * back;
      const z = pos.z + rz * side * WINGTIP_SPAN + Math.cos(yaw) * back;
      // A banked wing is lower on the side it dips to (bank > 0: right wing down).
      room = Math.min(room, pos.y + 0.9 - side * WINGTIP_SPAN * Math.sin(bank) - col.surfaceHeight(x, z));
    }
    return room;
  }

  /* ------------------------------------------------------------------ */
  /* Pad                                                                  */
  /* ------------------------------------------------------------------ */

  private addPad(sim: FlightSim, point: PerchPoint): void {
    this.removePad();
    const col = sim.world.collision;
    if (!col) {
      return;
    }
    const radius = Math.min(point.gripRadius, PERCH.padMaxRadius);
    const collider: Collider = { kind: 'cylinder', base: new THREE.Vector3(point.x, this.baseY - PERCH.padHeight, point.z), radius, height: PERCH.padHeight };
    this.padId = col.add(collider, 'perch', `perch:${point.id}`);
    this.padWorld = col;
  }

  private removePad(): void {
    if (this.padId && this.padWorld) {
      this.padWorld.remove(this.padId);
    }
    this.padId = 0;
    this.padWorld = undefined;
  }

  private setPhase(phase: PerchPhase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }

  /* ------------------------------------------------------------------ */
  /* Pose overlay                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * The perched pose over the pose driver's output (called at the end of PoseDriver.update): the tail wrapped to one
   * side and draped, the neck raised with an occasional slow look along the view, the rider relaxed.
   */
  applyPose(pose: DragonPose, dt: number): void {
    const on = this.phase === 'perched';
    const rate = on ? 1 / PERCH.poseIn : 1 / PERCH.poseOut;
    this.poseWeight = clamp(this.poseWeight + (on ? dt : -dt) * rate, 0, 1);
    const w = smoothstep(0, 1, this.poseWeight);
    if (w <= 0) {
      return;
    }
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookSeed = (Math.imul(this.lookSeed, 1103515245) + 12345) >>> 0;
      const r = this.lookSeed / 4294967296;
      const [a, b] = PERCH.lookEvery;
      this.lookTimer = a + (b - a) * r;
      this.lookYaw = this.lookYaw !== 0 ? 0 : (r < 0.5 ? -1 : 1) * PERCH.lookYaw * (0.5 + Math.abs(r - 0.5));
    }
    const k = 1 - Math.exp(-dt * 1.2);
    const mix = (current: number | undefined, target: number): number => {
      const c = current ?? 0;
      return c + (target - c) * w;
    };
    this.lookCurrent += (this.lookYaw - this.lookCurrent) * k;
    pose.neckYaw = mix(pose.neckYaw, this.lookCurrent);
    pose.neckPitch = mix(pose.neckPitch, PERCH.neckPitch);
    pose.tailYaw = mix(pose.tailYaw, PERCH.tailWrapYaw * this.tailSide);
    pose.tailPitch = mix(pose.tailPitch, PERCH.tailWrapPitch);
    pose.riderReinLeft = mix(pose.riderReinLeft, PERCH.riderRein);
    pose.riderReinRight = mix(pose.riderReinRight, PERCH.riderRein);
    pose.riderLeanPitch = mix(pose.riderLeanPitch, PERCH.riderLean);
    pose.riderTuck = mix(pose.riderTuck, 0);
    pose.breath = mix(pose.breath, 0.2);
  }

  private lookCurrent = 0;
}

/** Mode change without the landing caption (the perch approach announces itself). */
function setModeQuiet(sim: FlightSim, mode: FlightMode): void {
  if (sim.mode === mode) {
    return;
  }
  sim.eventCounts.mode++;
  sim.mode = mode;
  sim.modeTime = 0;
  sim.controller.onModeEnter(mode);
}

/** Body-frame angular velocity that turns `from` into `to` in `h` seconds. */
function bodyRates(from: THREE.Quaternion, to: THREE.Quaternion, h: number, out: THREE.Vector3): void {
  _q2.copy(from).invert().multiply(to);
  if (_q2.w < 0) {
    _q2.set(-_q2.x, -_q2.y, -_q2.z, -_q2.w);
  }
  const s = Math.sqrt(Math.max(0, 1 - _q2.w * _q2.w));
  const angle = 2 * Math.atan2(s, _q2.w);
  if (s < 1e-6 || h <= 0) {
    out.set(0, 0, 0);
    return;
  }
  out.set(_q2.x / s, _q2.y / s, _q2.z / s).multiplyScalar(angle / h);
}

/** Telemetry the rest of the game reads (airspeed, path, attitude, load); still air assumed. */
function fillTelemetry(sim: FlightSim, vel: THREE.Vector3 | null, acc: THREE.Vector3 | null): void {
  const speed = vel ? vel.length() : 0;
  sim.airspeed = speed;
  sim.airVelocity.copy(vel ?? _a.set(0, 0, 0));
  sim.alpha = 0;
  sim.beta = 0;
  sim.bank = sim.axes.bank();
  sim.pitch = sim.axes.pitch();
  sim.gamma = vel && speed > 0.5 ? Math.asin(clamp(vel.y / speed, -1, 1)) : 0;
  if (acc) {
    sim.specificForce.set(acc.x, acc.y + GRAVITY, acc.z);
  } else {
    sim.specificForce.set(0, GRAVITY, 0);
  }
  sim.loadFactor = sim.specificForce.length() / GRAVITY;
  sim.controlMoment.set(0, 0, 0);
  sim.lift = 0;
  sim.drag = 0;
  sim.flapForce = 0;
  sim.aeroVertical = 0;
}
