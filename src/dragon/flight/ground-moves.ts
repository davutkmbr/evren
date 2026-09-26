import * as THREE from 'three';
import { clamp, createRng, lerp, smoothstep } from '../../core/math/noise';
import { enterSwimming } from './locomotion';
import { MANEUVER_LABELS } from './maneuvers';
import { FLAP, GAIT, GRAVITY, GROUND, LEAP, RUNOUT } from './params';
import type { FlightSim } from './sim';
import type { PilotCommand } from './types';

/*
 * Ground moves: the grounded stance (touchdown settle, crouch, gaits), the run-out landing with its brake and
 * touch-and-go, and the leaping take-off with its variants. Pure simulation; the pose driver reads the stance cues.
 */

const TWO_PI = Math.PI * 2;
/** Wing-beat phase held at the top of the upstroke (wings raised, the next downstroke ready). */
const PHASE_TOP = TWO_PI - 0.05;
const _normal = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _targetQ = new THREE.Quaternion();
const _extraQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _step = new THREE.Vector3();
const _column = { floor: 0, ceiling: Infinity };

export type LeapVariant = 'vertical' | 'bound' | 'running' | 'drop' | 'tired' | 'touchgo';

interface LeapPlan {
  variant: LeapVariant;
  /** Crouch / gather time (s) and depth (m). */
  crouch: number;
  depth: number;
  /** Push-off time (s), vertical speed (m/s) and forward speed (m/s) it adds. */
  push: number;
  up: number;
  forward: number;
  /** Keep the stride and the speed through the crouch (running leaps). */
  moving: boolean;
  /** Body pitch (rad) at the bottom of the crouch and at lift-off. */
  pitchCrouch: number;
  pitchPush: number;
}

function approach(current: number, target: number, rate: number, h: number): number {
  const d = target - current;
  const s = rate * h;
  return current + (d > s ? s : d < -s ? -s : d);
}

/**
 * The wing wrists become fore feet once the wings are nearly folded (a half-folded wing reaching for the ground
 * would sweep its fingers through it), quickly.
 */
function foreTarget(spread: number): number {
  return smoothstep(0.3, 0.1, spread);
}
const FORE_RATE = 5;

/** Ease in-out 0..1. */
function ease(k: number): number {
  const t = clamp(k, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Stride frequency (Hz) for a ground speed (GAIT table, linear in between). */
export function cadenceFor(speed: number): number {
  const s = GAIT.cadenceSpeeds;
  const f = GAIT.cadenceHz;
  if (speed <= s[0]) {
    return f[0];
  }
  for (let i = 1; i < s.length; i++) {
    if (speed <= s[i]) {
      return lerp(f[i - 1], f[i], (speed - s[i - 1]) / (s[i] - s[i - 1]));
    }
  }
  return f[f.length - 1];
}

/** Gait blend for a ground speed: 0 walk, 1 trot, 2 gallop. */
export function gaitFor(speed: number): number {
  return smoothstep(GAIT.trotFrom, GAIT.trotTo, speed) + smoothstep(GAIT.gallopFrom, GAIT.gallopTo, speed);
}

/**
 * Height of the centre of mass above the ground for a body pitched `pitch` rad (relative to its stance) with the
 * legs at their standing length: nose-up it stands on the hind feet; nose-down the fore legs give (chest low).
 */
export function standDepth(standHeight: number, pitch: number): number {
  return standHeight * Math.cos(pitch) + (pitch > 0 ? GROUND.hindFootZ * Math.sin(pitch) : 0);
}

/** State of the ground moves (owned by the sim) and the stance cues the pose driver reads. */
export class GroundMoves {
  /* Stance cues (see DragonPose). */
  gait = 0;
  stride = 0;
  foreGround = 1;
  wingRaise = 0;
  heelLift = 0;
  skid = 0;
  /** 0..1 depth of the crouch (for the neck and tail). */
  crouch = 0;
  /** Ground normal under the stance (world, unit). */
  readonly groundNormal = new THREE.Vector3(0, 1, 0);

  /* Touchdown settle: pitch offset (rad) and sink (m) relaxing into the stance. */
  settlePitch = 0;
  settlePitchRate = 0;
  settleY = 0;
  settleVy = 0;
  /** Smoothed surface height the stance stands on (steps are climbed smoothly). */
  baseY = 0;
  /** Pitch offset (rad) over the stance attitude this step (settle + moves), roll lean (rad). */
  extraPitch = 0;
  extraRoll = 0;

  /* Run-out. */
  runOut = false;
  runTime = 0;
  /** W held since the touchdown: it only flies out once released and pressed again. */
  forwardLatch = false;

  /* Leap (crouch → push → take-off). */
  leap: LeapPlan | null = null;
  leapPhase: 'crouch' | 'push' = 'crouch';
  leapTime = 0;
  /** Move pitch (rad), wing spread and fore-feet share when the leap started (the crouch blends from them). */
  leapStartPitch = 0;
  leapStartSpread = 0;
  leapStartFore = 1;
  lastVariant: LeapVariant | null = null;

  /* The take-off that follows a leap (airborne). */
  takeoffVariant: LeapVariant | null = null;
  takeoffBeats = 0;
  /** Take-off mode time (s) at which the legs started to tuck (-1: not yet). */
  tuckTime = -1;
  /** Seconds since lift-off of the last leap (for the trailing legs); Infinity when none. */
  sinceLiftOff = Infinity;

  private rng = createRng(LEAP.seed);

  /** Seeded random 0..1 (variant picking). */
  random(): number {
    return this.rng();
  }

  reset(): void {
    this.gait = 0;
    this.stride = 0;
    this.foreGround = 1;
    this.wingRaise = 0;
    this.heelLift = 0;
    this.skid = 0;
    this.crouch = 0;
    this.settlePitch = 0;
    this.settlePitchRate = 0;
    this.settleY = 0;
    this.settleVy = 0;
    this.extraPitch = 0;
    this.extraRoll = 0;
    this.runOut = false;
    this.runTime = 0;
    this.forwardLatch = false;
    this.leap = null;
    this.leapTime = 0;
    this.lastVariant = null;
    this.takeoffVariant = null;
    this.takeoffBeats = 0;
    this.tuckTime = -1;
    this.sinceLiftOff = Infinity;
    this.rng = createRng(LEAP.seed);
  }

}

/* ------------------------------------------------------------------ */
/* Entering the ground                                                  */
/* ------------------------------------------------------------------ */

/**
 * Touchdown or placement: the stance starts from the body's current pitch, height and sink and relaxes into the
 * standing attitude (no snap). `runOut` keeps the ground speed for a run-out.
 */
export function enterStance(sim: FlightSim, runOut: boolean): void {
  const m = sim.moves;
  const b = sim.body;
  const pitch = sim.axes.pitch();
  m.runOut = runOut;
  m.runTime = 0;
  m.forwardLatch = true;
  m.leap = null;
  m.skid = 0;
  m.crouch = 0;
  m.heelLift = 0;
  m.wingRaise = 0;
  m.takeoffVariant = null;
  m.baseY = sim.surfaceY;
  m.foreGround = runOut ? 0 : foreTarget(sim.spread);
  const pitchTarget = RUNOUT.pitchUp * (1 - m.foreGround);
  m.settlePitch = clamp(pitch - pitchTarget, -0.6, 1.2);
  m.settlePitchRate = clamp(b.angularVelocity.x, -1.5, 1.5);
  m.extraPitch = m.settlePitch + pitchTarget;
  m.extraRoll = 0;
  m.settleY = b.position.y - (sim.surfaceY + standDepth(sim.standHeight, m.extraPitch));
  m.settleY = clamp(m.settleY, -GROUND.settleCompress, 1.5);
  m.settleVy = clamp(b.velocity.y, -8, 2);
  if (runOut) {
    sim.walkAmount = 1;
  }
}

/** Touchdown into a run-out (ground speed kept). */
export function enterRunOut(sim: FlightSim): void {
  const b = sim.body;
  const v = b.velocity;
  const yaw = sim.axes.yaw();
  sim.groundYaw = yaw;
  sim.groundSpeed = clamp(v.x * -Math.sin(yaw) + v.z * -Math.cos(yaw), 0, RUNOUT.maxSpeed);
  sim.legsOut = 1;
  sim.hoverBlend = 0;
  sim.brake = 0;
  sim.attachment = 1;
  sim.leapCharge = 0;
  sim.runTakeoff = 0;
  sim.maneuvers.cancel(sim);
  enterStance(sim, true);
  b.velocity.y = 0;
  b.angularVelocity.set(0, 0, 0);
  sim.setMode('grounded');
  sim.emit({ type: 'maneuver', id: 'runout', label: MANEUVER_LABELS.runout });
}

/* ------------------------------------------------------------------ */
/* Leap variants                                                        */
/* ------------------------------------------------------------------ */

/** Lowest surface a few metres ahead is far below: an edge or a roof to drop from. */
function edgeAhead(sim: FlightSim): boolean {
  const col = sim.world.collision;
  if (!col) {
    return false;
  }
  const p = sim.body.position;
  const fx = -Math.sin(sim.groundYaw);
  const fz = -Math.cos(sim.groundYaw);
  for (const d of LEAP.dropLook) {
    const floor = col.columnAt(p.x + fx * d, p.z + fz * d, sim.surfaceY + sim.standHeight, _column).floor;
    if (floor < sim.surfaceY - LEAP.dropMin) {
      return true;
    }
  }
  return false;
}

/**
 * Picks the take-off for the context. The most specific variant that applies wins (tired, then a drop from an
 * edge, then running), but never the one used last time when another applies; standing leaps alternate between
 * the straight-up leap and the forward bound through a seeded random.
 */
export function pickVariant(sim: FlightSim): LeapVariant {
  const m = sim.moves;
  const candidates: LeapVariant[] = [];
  if (sim.tired) {
    candidates.push('tired');
  }
  if (edgeAhead(sim)) {
    candidates.push('drop');
  }
  if (Math.abs(sim.groundSpeed) > LEAP.runMinSpeed) {
    candidates.push('running');
  } else {
    // Random order between the two standing leaps (the filter below keeps them from repeating).
    if (m.random() < 0.5) {
      candidates.push('vertical', 'bound');
    } else {
      candidates.push('bound', 'vertical');
    }
  }
  const fresh = candidates.length > 1 ? candidates.filter((c) => c !== m.lastVariant) : candidates;
  return fresh[0];
}

function planFor(variant: LeapVariant): LeapPlan {
  switch (variant) {
    case 'bound':
      return { variant, crouch: LEAP.boundCrouch, depth: LEAP.boundDepth, push: LEAP.boundPush, up: LEAP.boundUp, forward: LEAP.boundForward, moving: false, pitchCrouch: LEAP.crouchPitch, pitchPush: LEAP.boundPitch };
    case 'running':
      return { variant, crouch: LEAP.runCrouch, depth: LEAP.runDepth, push: LEAP.runPush, up: LEAP.runUp, forward: LEAP.runForward, moving: true, pitchCrouch: LEAP.runCrouchPitch, pitchPush: LEAP.runPushPitch };
    case 'drop':
      return { variant, crouch: LEAP.dropCrouch, depth: LEAP.dropDepth, push: LEAP.dropPush, up: LEAP.dropUp, forward: LEAP.dropForward, moving: false, pitchCrouch: LEAP.dropCrouchPitch, pitchPush: LEAP.dropPushPitch };
    case 'tired':
      return { variant, crouch: LEAP.tiredCrouch, depth: LEAP.tiredDepth, push: LEAP.tiredPush, up: LEAP.tiredUp, forward: LEAP.tiredForward, moving: false, pitchCrouch: LEAP.crouchPitch, pitchPush: LEAP.tiredPushPitch };
    case 'touchgo':
      return { variant, crouch: RUNOUT.flyOutGather, depth: RUNOUT.flyOutDepth, push: RUNOUT.flyOutPush, up: RUNOUT.flyOutUp, forward: 0, moving: true, pitchCrouch: RUNOUT.flyOutCrouchPitch, pitchPush: RUNOUT.flyOutPushPitch };
    default:
      return { variant: 'vertical', crouch: LEAP.crouch, depth: LEAP.crouchDepth, push: LEAP.push, up: LEAP.up, forward: LEAP.forward, moving: false, pitchCrouch: LEAP.crouchPitch, pitchPush: LEAP.pushPitch };
  }
}

export function startLeap(sim: FlightSim, variant: LeapVariant, gather?: number): void {
  const m = sim.moves;
  m.leap = planFor(variant);
  if (gather !== undefined) {
    m.leap.crouch = gather;
  }
  m.leapPhase = 'crouch';
  m.leapTime = 0;
  m.leapStartPitch = m.extraPitch - m.settlePitch;
  m.leapStartSpread = sim.spread;
  m.leapStartFore = m.foreGround;
  m.lastVariant = variant;
  sim.leapCharge = m.leap.crouch + m.leap.push;
  sim.runTakeoff = 0;
}

/* ------------------------------------------------------------------ */
/* The grounded step                                                    */
/* ------------------------------------------------------------------ */

/** Blend the body toward a yaw + surface-aligned attitude with a pitch / roll offset. */
function alignBody(sim: FlightSim, up: THREE.Vector3, extraPitch: number, extraRoll: number, rate: number, h: number): void {
  const yaw = sim.groundYaw;
  _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  _forward.addScaledVector(up, -_forward.dot(up)).normalize();
  _right.crossVectors(_forward, up).normalize();
  _back.copy(_forward).negate();
  _basis.makeBasis(_right, up, _back);
  _targetQ.setFromRotationMatrix(_basis);
  _euler.set(extraPitch, 0, extraRoll, 'YXZ');
  _targetQ.multiply(_extraQ.setFromEuler(_euler));
  sim.body.quaternion.slerp(_targetQ, 1 - Math.exp(-rate * h));
  sim.axes.update(sim.body.quaternion);
}

/**
 * Wings on the ground: a beat still running from the air finishes at the top of the stroke (back up if the
 * downstroke has only just begun) instead of sweeping down through the ground, then the amplitude fades and the
 * wings fold (or hold the spread / raise asked for).
 */
function groundWings(sim: FlightSim, spread: number, sweep: number, amplitude: number, h: number, spreadRate = 1.6): void {
  const beat = sim.beat;
  sim.spread = approach(sim.spread, spread, spreadRate, h);
  sim.sweep = approach(sim.sweep, sweep, 2.5, h);
  sim.legsOut = approach(sim.legsOut, 1, 3, h);
  sim.hoverBlend = approach(sim.hoverBlend, 0, 2, h);
  sim.brake = approach(sim.brake, 0, 3, h);
  sim.attachment = 1;
  sim.updateInertia();
  const target = beat.phase < Math.PI ? 0 : PHASE_TOP;
  const rate = TWO_PI * Math.max(beat.frequency, FLAP.freqMin);
  beat.phase = approach(beat.phase, target, rate, h);
  if (target === 0 && beat.phase <= 0) {
    beat.phase = PHASE_TOP;
  }
  beat.amplitude = approach(beat.amplitude, amplitude, amplitude > beat.amplitude ? 2.5 : 1.1, h);
  beat.effort = approach(beat.effort, 0, 2, h);
  beat.downstrokeStarted = false;
}

/** Settle springs (pitch offset and sink) one substep toward zero. */
function stepSettle(m: GroundMoves, h: number): void {
  const w = GROUND.settleOmega;
  const c = 2 * GROUND.settleZeta * w;
  m.settlePitchRate += (-w * w * m.settlePitch - c * m.settlePitchRate) * h;
  m.settlePitch += m.settlePitchRate * h;
  // The legs are stiffer than the pitch: the sink is taken in about a third of a second.
  const wy = w * 1.4;
  m.settleVy += (-wy * wy * m.settleY - 2 * GROUND.settleZeta * wy * m.settleVy) * h;
  m.settleY += m.settleVy * h;
  if (m.settleY < -GROUND.settleCompress) {
    m.settleY = -GROUND.settleCompress;
    m.settleVy = Math.max(m.settleVy, 0);
  }
}

/**
 * Quadruped on terrain and rooftops (W/S walk, A/D turn, Shift run), the run-out after a fast touchdown, and the
 * leaping take-off (Space / L: crouch and push-off; V: a galloping run into a running leap).
 */
export function stepStance(sim: FlightSim, cmd: PilotCommand, h: number): void {
  const m = sim.moves;
  const b = sim.body;
  const p = b.position;
  const collision = sim.world.collision;

  // --- intent ------------------------------------------------------------------------------
  if (!m.leap) {
    if (m.runOut) {
      if (cmd.pitch < 0.3) {
        m.forwardLatch = false;
      }
      const flyOut = cmd.flapPressed || (!m.forwardLatch && cmd.pitch > 0.5);
      if (flyOut && sim.groundSpeed >= RUNOUT.flyOutMinSpeed) {
        startLeap(sim, 'touchgo');
      } else if (cmd.flapPressed) {
        startLeap(sim, pickVariant(sim));
      }
    } else {
      if (cmd.urgePressed && sim.runTakeoff <= 0 && sim.maneuvers.tryUrge(sim)) {
        sim.runTakeoff = h;
      }
      if (sim.runTakeoff <= 0 && (cmd.flapPressed || cmd.flap || cmd.landPressed)) {
        startLeap(sim, pickVariant(sim));
      }
    }
  }
  if (sim.runTakeoff > 0 && !m.leap) {
    sim.runTakeoff += h;
    if (sim.runTakeoff > GROUND.runTakeoffTime || sim.groundSpeed > GROUND.runTakeoffSpeed - 0.5) {
      startLeap(sim, 'running');
    }
  }
  const leap = m.leap;
  if (leap) {
    m.leapTime += h;
    if (m.leapPhase === 'crouch' && m.leapTime >= leap.crouch) {
      m.leapPhase = 'push';
      m.leapTime -= leap.crouch;
    }
    sim.leapCharge = m.leapPhase === 'crouch' ? leap.crouch - m.leapTime + leap.push : leap.push - m.leapTime;
  }
  const pushing = leap !== null && m.leapPhase === 'push';
  const kCrouch = leap ? (m.leapPhase === 'crouch' ? clamp(m.leapTime / leap.crouch, 0, 1) : 1) : 0;
  const kPush = pushing ? clamp(m.leapTime / leap.push, 0, 1) : 0;

  // --- ground speed ------------------------------------------------------------------------
  const run = cmd.dive;
  const fwd = clamp(cmd.pitch, -1, 1);
  const target = fwd > 0 ? fwd * (run ? GROUND.runSpeed : GROUND.walkSpeed) : fwd * GROUND.backSpeed;
  if (leap) {
    if (pushing) {
      sim.groundSpeed += (leap.forward / leap.push) * h;
    } else if (!leap.moving) {
      sim.groundSpeed *= 1 - Math.min(1, 2.5 * h);
    }
  } else if (sim.runTakeoff > 0) {
    // Galloping run-up: accelerate hard whatever W/S say.
    sim.groundSpeed = Math.min(GROUND.runTakeoffSpeed, sim.groundSpeed + GROUND.runTakeoffAccel * h);
  } else if (m.runOut) {
    m.runTime += h;
    m.skid = approach(m.skid, cmd.brake ? 1 : 0, RUNOUT.skidRate, h);
    const v = sim.groundSpeed;
    const decel = RUNOUT.decel + RUNOUT.dragPerV2 * v * v + (RUNOUT.brakeDecel - RUNOUT.decel) * m.skid;
    sim.groundSpeed = Math.max(0, v - decel * h);
    if (sim.groundSpeed <= Math.max(RUNOUT.endSpeed, target)) {
      m.runOut = false;
    }
  } else {
    const settling = Math.abs(sim.groundSpeed) > Math.abs(target) + 1.5 && Math.abs(sim.groundSpeed) > GROUND.walkSpeed;
    sim.groundSpeed += (target - sim.groundSpeed) * (1 - Math.exp(-h * (settling ? 0.9 : run ? 1.4 : 2.4)));
  }
  if (!m.runOut) {
    m.skid = approach(m.skid, 0, RUNOUT.skidRate, h);
  }
  const speed = Math.abs(sim.groundSpeed);

  // --- heading -----------------------------------------------------------------------------
  const turn = pushing ? 0 : clamp(cmd.roll + cmd.yaw, -1, 1);
  sim.groundYawRate = m.runOut ? (-turn * RUNOUT.turnRate) / (1 + speed * 0.04) : (-turn * GROUND.turnRate) / (1 + speed * 0.08);
  sim.groundYaw += sim.groundYawRate * h;
  const fx = -Math.sin(sim.groundYaw);
  const fz = -Math.cos(sim.groundYaw);

  // --- the path ahead of a run-out: an edge, water or an obstacle makes it leap on its own ----
  if (m.runOut && !m.leap && collision) {
    const d = RUNOUT.lookMin + speed * RUNOUT.lookTime;
    const ax = p.x + fx * d;
    const az = p.z + fz * d;
    const floor = collision.columnAt(ax, az, sim.surfaceY + sim.standHeight + sim.contacts.bellyDepth, _column).floor;
    const water = collision.terrainHeight(ax, az) < -0.4 && floor < 0.05;
    const ends = water || floor < sim.surfaceY - GROUND.dropToFall || floor - sim.surfaceY > GROUND.maxStep;
    if (ends) {
      if (speed >= RUNOUT.autoLeapMinSpeed) {
        startLeap(sim, 'touchgo', RUNOUT.autoGather);
      } else {
        m.skid = approach(m.skid, 1, RUNOUT.skidRate * 2, h);
        sim.groundSpeed = Math.max(0, sim.groundSpeed - RUNOUT.brakeDecel * h);
      }
    }
  }

  // --- horizontal motion (steps, ledges, water) ---------------------------------------------
  const nx = p.x + fx * sim.groundSpeed * h;
  const nz = p.z + fz * sim.groundSpeed * h;
  // Next ground under the standing body: a deck or an overhang above the dragon's back is not a step.
  const nextSurface = collision ? collision.columnAt(nx, nz, sim.surfaceY + sim.standHeight + sim.contacts.bellyDepth, _column).floor : sim.surfaceY;
  if (!pushing && nextSurface - sim.surfaceY > GROUND.maxStep) {
    sim.groundSpeed *= 0.2;
    if (collision && sim.contacts.onWall) {
      _step.set(nx, nextSurface, nz);
      sim.contacts.onWall(collision.surfaceSource(nx, nz), 'step', -1, _step);
    }
  } else {
    p.x = nx;
    p.z = nz;
  }
  sim.sampleSurface();
  if (!pushing && p.y - (sim.surfaceY + sim.standHeight) > GROUND.dropToFall) {
    // Walked off a ledge (roof edge, cliff, quay): open the wings and fly.
    b.velocity.set(fx * sim.groundSpeed, 0, fz * sim.groundSpeed);
    sim.legsOut = 1;
    m.leap = null;
    m.runOut = false;
    sim.leapCharge = 0;
    sim.setMode('takeoff');
    return;
  }
  if (!pushing && sim.surfaceIsWater() && sim.terrainY < -1.2) {
    m.leap = null;
    m.runOut = false;
    sim.leapCharge = 0;
    enterSwimming(sim);
    return;
  }

  // --- attitude: settle + crouch / push / run-out lean / skid --------------------------------
  stepSettle(m, h);
  let movePitch = 0;
  if (leap) {
    // From the stance pitch the leap started with (a run-out's nose-up) down into the crouch, then up through the push.
    movePitch = pushing ? lerp(leap.pitchCrouch, leap.pitchPush, ease(kPush)) : lerp(m.leapStartPitch, leap.pitchCrouch, ease(kCrouch));
  } else {
    // Nose up while the fore feet are still wings (the first strides of a run-out, a landing folding its wings),
    // sat back in a skid.
    movePitch = RUNOUT.pitchUp * (1 - m.foreGround) + RUNOUT.skidPitch * m.skid;
  }
  m.extraPitch = m.settlePitch + movePitch;
  const lean = m.runOut ? -turn * RUNOUT.lean * smoothstep(4, 14, speed) : 0;
  m.extraRoll = approach(m.extraRoll, lean, 0.8, h);
  const onTerrain = sim.surfaceY - Math.max(sim.terrainY, 0) < 0.3;
  if (onTerrain && sim.world.geo) {
    sim.world.geo.normalAt(p.x, p.z, _normal);
  } else {
    _normal.set(0, 1, 0);
  }
  m.groundNormal.copy(_normal);
  _up.set(0, 1, 0).lerp(_normal, 0.7).normalize();
  alignBody(sim, _up, m.extraPitch, m.extraRoll, pushing ? 30 : 14, h);

  // --- height --------------------------------------------------------------------------------
  const prevY = p.y;
  let vy: number;
  if (pushing && leap) {
    // Push-off: the legs extend and ramp the climb up (no one-frame jump).
    vy = leap.up * kPush;
    p.y += vy * h;
  } else {
    m.baseY += (sim.surfaceY - m.baseY) * (1 - Math.exp(-h * 14));
    m.baseY = Math.max(m.baseY, sim.surfaceY - 0.3);
    const crouchDrop = leap ? leap.depth * ease(kCrouch) : 0;
    p.y = m.baseY + standDepth(sim.standHeight, m.extraPitch) - crouchDrop + m.settleY;
    vy = (p.y - prevY) / h;
  }
  b.velocity.set(fx * sim.groundSpeed, vy, fz * sim.groundSpeed);
  const pitchRate = pushing && leap ? ((leap.pitchPush - leap.pitchCrouch) * 6 * kPush * (1 - kPush)) / leap.push : 0;
  b.angularVelocity.set(pitchRate, sim.groundYawRate, 0);

  if (collision && !pushing && sim.contacts.resolveWalls(b, collision, sim.impact, sim.surfaceY + GROUND.maxStep)) {
    sim.groundSpeed *= 0.4;
    if (sim.impact.speed > 2.5 && sim.impactCooldown <= 0) {
      sim.impactCooldown = 0.4;
      sim.emit({ type: 'impact', point: sim.impact.point.clone(), speed: sim.impact.speed, surface: sim.impact.surface });
    }
  }

  // --- gait ----------------------------------------------------------------------------------
  const moving = smoothstep(0, 1, speed);
  const cadence = cadenceFor(speed) * moving + Math.abs(sim.groundYawRate) * 0.35;
  m.stride = cadence > 1e-3 ? speed / cadence : 0;
  let gait = gaitFor(speed);
  if (m.foreGround < 0.5) {
    // Hind legs only (the first strides of a run-out): a bipedal run.
    gait = Math.min(gait, 1);
  }
  m.gait = gait;
  sim.walkPhase = (sim.walkPhase + Math.sign(sim.groundSpeed || 1) * TWO_PI * cadence * h + TWO_PI) % TWO_PI;
  const walkTarget = m.runOut ? 1 : clamp((speed + Math.abs(sim.groundYawRate) * 2.5) / 2.2, 0, 1);
  sim.walkAmount += (walkTarget - sim.walkAmount) * (1 - Math.exp(-h * 6));

  // --- wings and stance cues -------------------------------------------------------------------
  if (leap) {
    leapWings(sim, leap, kCrouch, kPush, h);
  } else if (sim.runTakeoff > 0) {
    // The wings open and start beating over the last strides.
    const k = smoothstep(0.3, GROUND.runTakeoffTime, sim.runTakeoff);
    sim.spread = approach(sim.spread, 0.3 + 0.6 * k, 2, h);
    sim.sweep = approach(sim.sweep, 0.2 * (1 - k), 2, h);
    sim.legsOut = 1;
    sim.brake = 0;
    sim.attachment = 1;
    sim.updateInertia();
    sim.beat.update(h, 0.25 + 0.6 * k, 0.3);
    m.foreGround = approach(m.foreGround, foreTarget(sim.spread), FORE_RATE, h);
    m.wingRaise = approach(m.wingRaise, 0, 3, h);
    m.heelLift = approach(m.heelLift, 0, 4, h);
    m.crouch = approach(m.crouch, 0, 4, h);
  } else if (m.runOut) {
    // Wings half open for balance while fast (raised, air brakes when skidding), folded as the speed drops.
    const open = Math.max(smoothstep(RUNOUT.foldSpeed, RUNOUT.openSpeed, speed), m.runTime < RUNOUT.foreDelay ? 0.8 : 0);
    const spread = Math.max(0.06 + 0.5 * open, 0.85 * m.skid);
    groundWings(sim, spread, -0.9 * m.skid - 0.3 * open, 0.25 + 0.45 * Math.max(open, m.skid), h, 2.2);
    m.foreGround = approach(m.foreGround, m.skid > 0.3 ? 0 : foreTarget(sim.spread), FORE_RATE, h);
    m.wingRaise = approach(m.wingRaise, 0, 3, h);
    m.heelLift = approach(m.heelLift, 0, 4, h);
    m.crouch = approach(m.crouch, 0.25 * m.skid, 4, h);
    if (sim.dustTimer > (m.skid > 0.3 ? 0.12 : 0.3) && speed > 4) {
      sim.dustTimer = 0;
      sim.emit({ type: 'dust', point: new THREE.Vector3(p.x - fx * 2, sim.surfaceY, p.z - fz * 2), strength: clamp(speed / 25, 0.12, 0.5) * (0.6 + 0.8 * m.skid) });
    }
  } else {
    groundWings(sim, 0.06, 0, 0, h);
    m.foreGround = approach(m.foreGround, foreTarget(sim.spread), FORE_RATE, h);
    m.wingRaise = approach(m.wingRaise, 0, 3, h);
    m.heelLift = approach(m.heelLift, 0, 4, h);
    m.crouch = approach(m.crouch, 0, 4, h);
  }

  fillTelemetry(sim);

  // --- lift-off --------------------------------------------------------------------------------
  if (pushing && leap && m.leapTime >= leap.push) {
    liftOff(sim, leap);
  }
}

/** Wings and stance through the crouch and the push-off. */
function leapWings(sim: FlightSim, leap: LeapPlan, kCrouch: number, kPush: number, h: number): void {
  const m = sim.moves;
  const beat = sim.beat;
  const pushing = m.leapPhase === 'push';
  const touchgo = leap.variant === 'touchgo';
  // Crouch: the wrists stand, hands and fingers raised high and back; the beat is wound up to the top.
  // Push: the wings open while the fore legs push off a beat after the hind legs.
  let spread: number;
  if (touchgo) {
    // Run-up of a touch-and-go: the arms rise first (wrists off the ground if they were down), then the wings open.
    spread = pushing ? 1 : lerp(m.leapStartSpread, 1, ease((kCrouch - 0.3) / 0.7));
  } else if (pushing) {
    // The wrists lift first, then the wings open (a half-open wing with the wrist still down would dig in).
    spread = lerp(0.06, 1, ease((kPush - 0.15) / 0.85));
  } else {
    spread = 0.06;
  }
  sim.spread = spread;
  sim.sweep = approach(sim.sweep, pushing || touchgo ? LEAP.strokeSweep : 0.25, 4, h);
  sim.legsOut = 1;
  sim.hoverBlend = approach(sim.hoverBlend, 0.7, 2.5, h);
  sim.brake = 0;
  sim.attachment = 1;
  sim.updateInertia();
  beat.amplitude = approach(beat.amplitude, 1, 3.5, h);
  beat.effort = approach(beat.effort, 0.7, 3, h);
  beat.downstrokeStarted = false;
  if (!pushing) {
    // Wound up to the top of the stroke (on the run-up of a touch-and-go too: two strides with the wings rising and
    // opening, no downstroke that close to the ground).
    beat.phase = approach(beat.phase < Math.PI ? beat.phase + TWO_PI : beat.phase, PHASE_TOP, 9, h);
    if (beat.phase >= TWO_PI) {
      beat.phase -= TWO_PI;
    }
  } else {
    beat.phase = PHASE_TOP;
  }
  const standing = !leap.moving;
  m.wingRaise = touchgo ? ease(kCrouch / 0.5) : pushing ? 1 : ease(kCrouch / 0.7) * (standing ? 1 : 0.6);
  // The wrists leave the ground a beat after the hind feet push, the arms rising straight into the opening wings.
  if (touchgo) {
    m.foreGround = m.leapStartFore * (1 - smoothstep(0, 0.7, kCrouch));
  } else {
    m.foreGround = pushing ? 1 - smoothstep(0, 0.6, kPush) : approach(m.foreGround, 1, 5, h);
  }
  m.heelLift = pushing ? smoothstep(0.35, 1, kPush) : 0;
  m.crouch = pushing ? 1 - ease(kPush) : ease(kCrouch) * (leap.depth / LEAP.crouchDepth);
}

/** End of the push-off: airborne, first downstroke at once. */
function liftOff(sim: FlightSim, leap: LeapPlan): void {
  const m = sim.moves;
  const b = sim.body;
  const yaw = sim.groundYaw;
  const keep = leap.variant === 'touchgo' ? RUNOUT.flyOutKeep : 1;
  const forward = Math.max(sim.groundSpeed, 0) * keep;
  b.velocity.set(-Math.sin(yaw) * forward, leap.up, -Math.cos(yaw) * forward);
  m.leap = null;
  m.runOut = false;
  m.takeoffVariant = leap.variant;
  m.takeoffBeats = 0;
  m.tuckTime = -1;
  m.sinceLiftOff = 0;
  m.heelLift = 1;
  sim.leapCharge = 0;
  sim.runTakeoff = 0;
  sim.legsOut = 1;
  sim.spread = Math.max(sim.spread, 0.9);
  sim.hoverBlend = leap.variant === 'touchgo' ? 0.2 : 0.8;
  // The first full downstroke starts with the lift-off.
  const beat = sim.beat;
  beat.phase = 0;
  beat.amplitude = Math.max(beat.amplitude, 0.95);
  beat.effort = Math.max(beat.effort, 0.8);
  beat.downstrokeStarted = true;
  sim.emit({ type: 'flap', strength: 1 });
  const p = b.position;
  sim.emit({ type: 'dust', point: new THREE.Vector3(p.x, sim.surfaceY, p.z), strength: leap.variant === 'touchgo' ? 0.6 : 0.9 });
  sim.emit({ type: 'shake', amount: 0.14 });
  sim.setMode('takeoff');
  // W that flew the run-out back into the air means "keep going": it reads as neutral pitch until released.
  sim.controller.latchForward();
  sim.emit(leap.variant === 'touchgo' ? { type: 'maneuver', id: 'touchgo', label: MANEUVER_LABELS.touchgo } : { type: 'maneuver', id: 'takeoff', label: MANEUVER_LABELS.takeoff });
}

function fillTelemetry(sim: FlightSim): void {
  sim.airspeed = Math.abs(sim.groundSpeed);
  sim.alpha = 0;
  sim.beta = 0;
  sim.bank = sim.axes.bank();
  sim.pitch = sim.axes.pitch();
  sim.gamma = 0;
  sim.loadFactor = 1;
  sim.specificForce.set(0, GRAVITY, 0);
  sim.controlMoment.set(0, 0, 0);
  sim.lift = 0;
  sim.drag = 0;
  sim.flapForce = 0;
}

/**
 * Airborne after a leap: counts the downstrokes and says when the legs may tuck (after LEAP.tuckBeats strokes,
 * tired: one more). Called by the take-off law every substep.
 */
export function takeoffLegs(sim: FlightSim): number | null {
  const m = sim.moves;
  if (m.takeoffVariant === null) {
    return null;
  }
  if (sim.beat.downstrokeStarted) {
    m.takeoffBeats++;
  }
  const need = LEAP.tuckBeats + (m.takeoffVariant === 'tired' ? 1 : 0);
  if (m.tuckTime < 0 && m.takeoffBeats >= need && sim.beat.phase > TWO_PI * FLAP.downstrokeFraction) {
    m.tuckTime = sim.modeTime;
  }
  return m.tuckTime < 0 ? 1 : 1 - clamp((sim.modeTime - m.tuckTime) / 0.9, 0, 1);
}
