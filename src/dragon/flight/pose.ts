import * as THREE from 'three';
import type { DragonPose } from '../../core/contracts';
import { clamp, smoothstep } from '../../core/math/noise';
import { ENVELOPE, GRAVITY } from './params';
import type { FlightSim } from './sim';
import type { PilotCommand } from './types';

/** Rider cue smoothing rates (1/s): reins ~0.17 s, crouch ~0.25 s, arm gestures ~0.2 s. */
const REIN_RATE = 6;
const TUCK_RATE = 4;
const ARM_RATE = 5;
/** A Space tap pumps the reins forward for this long (s). */
const PUMP_TIME = 0.45;
const ROAR_CHEER = 1.5;

const _omegaWorld = new THREE.Vector3();
const _accelBody = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _groundN = new THREE.Vector3();
/** Tail root behind / above the centre of mass (rig frame) and the tail's length (m) for the ground clearance. */
const TAIL_ROOT_Z = 2.7;
const TAIL_ROOT_Y = 0.35;
const TAIL_LENGTH = 8.5;
/** Height the tail tip keeps above the ground near it (m) and the most it curls up for that (rad). */
const TAIL_CLEARANCE = 1.2;
const TAIL_MAX_CURL = 1.6;
/** Rate (1/s) of the ground cues (they are already continuous; this only rounds the corners). */
const CUE_RATE = 14;

/** Optional look target for the head (POV camera direction), angles relative to the body. */
export interface LookTarget {
  yaw: number;
  pitch: number;
  weight: number;
}

function follow(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * Animation driver: turns the physical state into a DragonPose. Angles follow right-handed body axes
 * (+X right, +Y up, +Z back): neckYaw > 0 turns the head left, neckPitch > 0 raises it, tailYaw > 0 swings
 * the tail tip right, tailPitch > 0 lowers it, riderLeanPitch > 0 leans back; riderLeanRoll > 0 leans right
 * (like wingTwist, positive = toward the right).
 */
export class PoseDriver {
  readonly pose: DragonPose = {
    flapPhase: 1.2,
    flapAmplitude: 0,
    wingSpread: 1,
    wingSweep: 0,
    wingTwist: 0,
    neckYaw: 0,
    neckPitch: 0,
    jawOpen: 0,
    tailYaw: 0,
    tailPitch: 0,
    legsTuck: 1,
    walkPhase: 0,
    walkAmount: 0,
    breath: 0.3,
    groundY: Number.NaN,
    groundNx: 0,
    groundNz: 0,
    gait: 0,
    stride: 0,
    foreGround: 1,
    wingRaise: 0,
    heelLift: 0,
    legReach: 0,
    skid: 0,
    riderLeanPitch: 0,
    riderLeanRoll: 0,
    riderReinLeft: 0,
    riderReinRight: 0,
    riderTuck: 0,
    riderUrge: 0,
    riderPoint: 0,
    riderCheer: 0,
  };

  private roarAge = 99;
  private exertion = 0;
  private leanPitchVel = 0;
  private leanRollVel = 0;
  private pumpAge = 99;
  private reinLeft = 0;
  private reinRight = 0;
  private tuck = 0;
  private point = 0;
  private cheer = 0;

  roar(): void {
    this.roarAge = 0;
  }

  /** Envelope 0..1 of the current roar. */
  roarEnvelope(): number {
    const t = this.roarAge;
    if (t >= 2.1) {
      return 0;
    }
    return smoothstep(0, 0.22, t) * (1 - smoothstep(1.35, 2.1, t));
  }

  /** `cmd` is the pilot's command this frame (null: none, e.g. tests): the rider shows every command given. */
  update(sim: FlightSim, dt: number, time: number, look: LookTarget | null, cmd: PilotCommand | null = null): DragonPose {
    const pose = this.pose;
    pose.flapPhase = sim.beat.phase;
    pose.flapAmplitude = clamp(sim.beat.amplitude, 0, 1);
    pose.wingSpread = clamp(sim.spread, 0, 1);
    pose.wingSweep = clamp(sim.sweep, -1, 1);
    pose.legsTuck = clamp(1 - sim.legsOut, 0, 1);
    if (dt <= 0) {
      return pose;
    }
    this.roarAge += dt;

    const airborne = sim.airborne;
    const onSurface = sim.mode === 'grounded' || sim.mode === 'swimming';
    const q = sim.body.quaternion;
    _omegaWorld.copy(sim.body.angularVelocity).applyQuaternion(q);
    const turnRate = onSurface ? sim.groundYawRate : _omegaWorld.y;
    const roar = this.roarEnvelope();

    // Wings: asymmetric twist mirrors the roll control moment actually applied.
    const twist = airborne ? clamp(-sim.controlMoment.z / (sim.controlCapacity.z + 1), -1, 1) * 0.85 : 0;
    pose.wingTwist = follow(pose.wingTwist, twist, 14, dt);

    // Neck: look into turns, keep the head nearer the horizon (bird-like stabilization), look down to land.
    let neckYaw = clamp(turnRate * 0.55 + sim.beta * 0.6, -0.55, 0.55);
    let neckPitch: number;
    const moves = sim.moves;
    if (onSurface) {
      neckPitch = -0.05 - sim.pitch * 0.4 - 0.04 * Math.sin(sim.walkPhase * 2) * sim.walkAmount - 0.22 * moves.crouch + 0.12 * moves.skid;
      neckYaw += 0.06 * Math.sin(time * 0.37) * (1 - sim.walkAmount);
    } else if (sim.mode === 'landing' || sim.mode === 'hovering') {
      neckPitch = -0.18 - sim.pitch * 0.55;
    } else if (sim.mode === 'diving') {
      neckPitch = -sim.pitch * 0.15 - 0.05;
    } else if (sim.mode === 'takeoff' && moves.takeoffVariant !== null) {
      // Neck stretched forward through the first strokes.
      neckPitch = -sim.pitch * 0.5 - 0.08;
    } else {
      neckPitch = -sim.pitch * 0.38 + 0.05;
    }
    neckPitch += roar * 0.32;
    if (look && look.weight > 0) {
      neckYaw += clamp(look.yaw, -1, 1) * 0.6 * look.weight;
      neckPitch += clamp(look.pitch, -0.8, 0.6) * 0.45 * look.weight;
    }
    pose.neckYaw = follow(pose.neckYaw, clamp(neckYaw, -0.9, 0.9), 4, dt);
    pose.neckPitch = follow(pose.neckPitch, clamp(neckPitch, -0.7, 0.6), 4, dt);

    // Tail: trails inside the turn, weathervanes into sideslip, lifts in pull-ups, drops as an airbrake.
    let tailYaw = clamp(-turnRate * 0.5 - sim.beta * 0.8, -0.6, 0.6);
    let tailPitch: number;
    if (onSurface) {
      // Gallop: the tail swings less and counterbalances the bound; a run-out holds it up; a crouch lowers it.
      const gallop = clamp(moves.gait - 1, 0, 1);
      const running = moves.runOut ? smoothstep(3, 10, sim.groundSpeed) : 0;
      tailYaw += 0.16 * Math.sin(sim.walkPhase + 0.9) * sim.walkAmount * (1 - 0.5 * gallop) + 0.07 * Math.sin(time * 0.6);
      tailPitch =
        sim.mode === 'swimming'
          ? -0.08
          : 0.06 +
            0.04 * Math.sin(sim.walkPhase * 2 + 0.5) * sim.walkAmount * (1 - gallop) -
            0.08 * gallop * Math.sin(sim.walkPhase - 2.2) * sim.walkAmount -
            0.22 * running -
            0.12 * moves.skid +
            0.22 * moves.crouch;
    } else {
      const nearGround = 1 - smoothstep(4, 14, sim.footClearance);
      tailPitch =
        -sim.body.angularVelocity.x * 0.35 +
        (sim.brake * 0.3 + sim.hoverBlend * 0.22) * (1 - nearGround) -
        Math.max(0, sim.pitch) * 0.75 * Math.max(nearGround, sim.hoverBlend) -
        (sim.mode === 'diving' ? 0.08 : 0);
      tailYaw += 0.05 * Math.sin(time * 1.3) * (1 - sim.beat.amplitude);
      tailPitch += 0.05 * Math.sin(sim.beat.phase + 2.2) * sim.beat.amplitude;
    }
    // Near the ground the tail curls up enough to keep its tip clear (a flare pitched 50° would drag it).
    tailPitch = Math.min(clamp(tailPitch, -0.5, 0.5), -this.tailClearCurl(sim));
    pose.tailYaw = follow(pose.tailYaw, clamp(tailYaw, -0.7, 0.7), 2.5, dt);
    pose.tailPitch = follow(pose.tailPitch, tailPitch, tailPitch < pose.tailPitch ? 6 : 2.5, dt);

    pose.walkPhase = sim.walkPhase;
    pose.walkAmount = follow(pose.walkAmount, onSurface ? sim.walkAmount : 0, moves.runOut ? 20 : 6, dt);
    this.updateGroundCues(sim, dt);

    // Exertion drives breathing and panting.
    const exertionTarget = clamp(sim.beat.effort * sim.beat.effort * 0.9 + (sim.tired ? 0.6 : 0) + (1 - sim.stamina) * 0.35, 0, 1);
    this.exertion = follow(this.exertion, exertionTarget, exertionTarget > this.exertion ? 0.8 : 0.15, dt);
    pose.breath = 0.22 + 0.78 * this.exertion;

    let jaw = 0.02 + 0.03 * this.exertion;
    if (sim.firing) {
      jaw = Math.max(jaw, 0.72 + 0.1 * Math.sin(time * 11) + 0.05 * Math.sin(time * 23.7));
    }
    if (this.exertion > 0.55) {
      jaw = Math.max(jaw, 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(time * 5.5)));
    }
    jaw = Math.max(jaw, roar * (0.92 + 0.05 * Math.sin(time * 17)));
    pose.jawOpen = follow(pose.jawOpen, clamp(jaw, 0, 1), 14, dt);

    // Rider: spring-damper driven by the specific force felt in the saddle, plus a speed tuck and turn lean.
    _invQ.copy(q).invert();
    _accelBody.copy(sim.specificForce).applyQuaternion(_invQ);
    const speedTuck = airborne ? smoothstep(28, 75, sim.airspeed) * 0.32 + (sim.mode === 'diving' ? 0.12 : 0) : 0;
    // A soft landing reads in the saddle: the rider sits back through the flare.
    const flareLean = sim.mode === 'landing' && sim.controller.hoverDescent ? 0.22 : 0;
    const leapLean = sim.leapCharge > 0 || sim.runTakeoff > 0 ? -0.18 : 0;
    const pitchTarget = clamp((-_accelBody.z / GRAVITY) * 0.5 - (_accelBody.y / GRAVITY - 1) * 0.06 - speedTuck + flareLean + leapLean, -0.55, 0.45);
    const rollTarget = clamp((-_accelBody.x / GRAVITY) * 0.5 + (airborne ? sim.bank * 0.1 : 0), -0.45, 0.45);
    const wn = 7;
    const zeta = 0.55;
    const h = Math.min(dt, 1 / 30);
    this.leanPitchVel += (wn * wn * (pitchTarget - pose.riderLeanPitch) - 2 * zeta * wn * this.leanPitchVel) * h;
    this.leanRollVel += (wn * wn * (rollTarget - pose.riderLeanRoll) - 2 * zeta * wn * this.leanRollVel) * h;
    pose.riderLeanPitch = clamp(pose.riderLeanPitch + this.leanPitchVel * h, -0.6, 0.5);
    pose.riderLeanRoll = clamp(pose.riderLeanRoll + this.leanRollVel * h, -0.5, 0.5);
    this.updateRiderCues(sim, dt, cmd);
    return pose;
  }

  /**
   * Ground plane in the body frame (the rig plants its feet on it), gait and stance cues of the ground moves, and
   * the legs' reach while they are clear of the ground.
   */
  private updateGroundCues(sim: FlightSim, dt: number): void {
    const pose = this.pose;
    const m = sim.moves;
    const onGround = sim.mode === 'grounded';
    if (onGround) {
      _groundN.copy(m.groundNormal);
    } else {
      _groundN.set(0, 1, 0);
    }
    pose.groundY = sim.surfaceY;
    pose.groundNx = _groundN.x;
    pose.groundNz = _groundN.z;
    pose.gait = onGround ? m.gait : 0;
    pose.stride = onGround ? m.stride : 0;
    // Legs clear of the ground: trailing back after a push-off, reaching forward low over the ground before a
    // touchdown.
    let reach = 0;
    if (!onGround) {
      const trail = 1 - smoothstep(0.25, 0.9, m.sinceLiftOff);
      const descending = sim.body.velocity.y < 0.5 && (sim.mode === 'landing' || sim.mode === 'flying' || sim.mode === 'gliding') ? 1 : 0;
      reach = descending * smoothstep(6, 1.5, sim.footClearance) - trail;
    }
    const heel = onGround ? m.heelLift : 1 - smoothstep(0, 0.35, m.sinceLiftOff);
    const k = 1 - Math.exp(-CUE_RATE * dt);
    const ease = (current: number | undefined, target: number, rate = k): number => (current ?? target) + (target - (current ?? target)) * rate;
    // Off the ground both fade slowly: the rig's wing spread lags the flight model's, and until it has caught up the
    // folded part of the wing keeps to the raised pose instead of dropping to the flank.
    const airFade = 1 - Math.exp(-4 * dt);
    pose.foreGround = ease(pose.foreGround, onGround ? m.foreGround : 0, onGround ? k : airFade);
    pose.wingRaise = ease(pose.wingRaise, onGround ? m.wingRaise : 0, onGround ? k : airFade);
    pose.heelLift = ease(pose.heelLift, heel);
    pose.legReach = ease(pose.legReach, reach, k * 0.5);
    pose.skid = ease(pose.skid, onGround ? m.skid : 0);
  }

  /**
   * Tail curl (rad, upward) that keeps the tip TAIL_CLEARANCE above the ground: with the body pitched θ nose-up the
   * tail points down by θ; an even curl c along it turns its chord up by c / 2.
   */
  private tailClearCurl(sim: FlightSim): number {
    if (sim.mode === 'swimming') {
      return 0;
    }
    // Lead the pitch a little (a push-off or a flare rears up faster than the tail can follow).
    const theta = sim.pitch + clamp(sim.body.angularVelocity.x, -1, 3) * 0.3;
    const height = sim.agl + Math.min(sim.body.velocity.y, 0) * 0.5;
    const root = height + TAIL_ROOT_Y * Math.cos(theta) - TAIL_ROOT_Z * Math.sin(theta);
    const room = clamp((root - TAIL_CLEARANCE) / TAIL_LENGTH, -1, 1);
    // The tail hangs a little below the body line at rest (about 0.05 rad).
    const need = 2 * (theta + 0.05 - Math.asin(room));
    return clamp(need, 0, TAIL_MAX_CURL);
  }

  /**
   * Rider cues: reins, crouch and arm gestures for every command the player gives (and for what the dragon does on
   * its own: autopilot turns, landings, the automatic catch). Targets are smoothed so nothing pops.
   */
  private updateRiderCues(sim: FlightSim, dt: number, cmd: PilotCommand | null): void {
    const pose = this.pose;
    const m = sim.maneuvers;
    const trick = m.kind;
    const airborne = sim.airborne;
    const roll = cmd ? clamp(cmd.roll + 0.5 * cmd.yaw, -1, 1) : 0;
    const pitch = cmd ? clamp(cmd.pitch, -1, 1) : 0;
    const dive = (cmd?.dive ?? false) && !m.diveMasked;
    const brake = cmd?.brake ?? false;

    // Turning: the inside rein comes back to the chest (0.6-0.9), the outside one gives a little. Turns the dragon
    // flies without the stick (autopilot, overrides) still show through the bank.
    const bankTurn = airborne && trick === 'none' ? clamp(sim.bank / ENVELOPE.maxBank, -1, 1) * 0.7 : 0;
    const turn = Math.abs(roll) >= Math.abs(bankTurn) ? roll : bankTurn;
    const inside = smoothstep(0.05, 0.3, Math.abs(turn)) * (0.55 + 0.3 * Math.abs(turn));
    let left = turn < 0 ? inside : -0.12 * inside;
    let right = turn > 0 ? inside : -0.12 * inside;
    // Climb (S): both reins back; nose down (W): both forward.
    const both = pitch < 0 ? -0.55 * pitch : -0.5 * pitch;
    left += both;
    right += both;
    let tuck = airborne ? smoothstep(45, 85, sim.airspeed) * 0.45 : 0;

    const falling = trick === 'drop' || (airborne && dive && sim.spread < 0.6);
    if (falling) {
      // Folded wings: flat on the neck, reins given all the way.
      left = right = -1;
      tuck = 1;
    } else if (trick === 'catch') {
      // Wings open: the rider hauls back through the pull-out, then sits up.
      left = right = 1;
      tuck = Math.max(tuck, 0.5 * (1 - smoothstep(0.2, 0.9, m.time)));
    } else if (trick === 'roll') {
      tuck = Math.max(tuck, 0.7);
      left = right = 0.25;
    } else if (trick === 'loop') {
      tuck = Math.max(tuck, 0.85);
      left = right = 0.6;
    } else if (brake || sim.mode === 'hovering') {
      left = right = brake ? 1 : 0.75;
    } else if (sim.mode === 'landing') {
      // Approach: reins shortened; the flare: pulled right back.
      left = right = sim.controller.hoverDescent ? 1 : 0.55;
    } else if (sim.mode === 'takeoff' || sim.leapCharge > 0 || sim.runTakeoff > 0) {
      left = right = -0.45;
      tuck = Math.max(tuck, 0.35);
    }
    this.reinLeft = follow(this.reinLeft, clamp(left, -1, 1), REIN_RATE, dt);
    this.reinRight = follow(this.reinRight, clamp(right, -1, 1), REIN_RATE, dt);
    this.tuck = follow(this.tuck, clamp(tuck, 0, 1), TUCK_RATE, dt);

    // Space: a forward pump of the hands per tap, and with every downstroke while held.
    this.pumpAge += dt;
    if (cmd?.flapPressed) {
      this.pumpAge = 0;
    }
    const tapPump = this.pumpAge < PUMP_TIME ? Math.sin((Math.PI * this.pumpAge) / PUMP_TIME) : 0;
    const heldPump = cmd?.flap && airborne && !falling ? Math.max(0, Math.sin(sim.beat.phase)) * sim.beat.amplitude : 0;
    const pump = -0.35 * Math.max(tapPump, heldPump);
    pose.riderReinLeft = clamp(this.reinLeft + pump, -1, 1);
    pose.riderReinRight = clamp(this.reinRight + pump, -1, 1);
    pose.riderTuck = this.tuck;

    // The "dehh": the animator runs the rein snaps and heel kicks inside this envelope.
    pose.riderUrge = m.urgeEnvelope;
    this.point = follow(this.point, sim.firing || cmd?.fire ? 1 : 0, ARM_RATE, dt);
    pose.riderPoint = this.point;
    const roarCheer = this.roarAge < ROAR_CHEER ? smoothstep(0, 0.2, this.roarAge) * (1 - smoothstep(ROAR_CHEER * 0.65, ROAR_CHEER, this.roarAge)) : 0;
    this.cheer = follow(this.cheer, Math.max(roarCheer, m.cheer), ARM_RATE * 1.6, dt);
    pose.riderCheer = this.cheer;
  }
}
