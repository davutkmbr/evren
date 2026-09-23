import * as THREE from 'three';
import type { DragonPose } from '../../core/contracts';
import { clamp, smoothstep } from '../../core/math/noise';
import { GRAVITY } from './params';
import type { FlightSim } from './sim';

const _omegaWorld = new THREE.Vector3();
const _accelBody = new THREE.Vector3();
const _invQ = new THREE.Quaternion();

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
    riderLeanPitch: 0,
    riderLeanRoll: 0,
  };

  private roarAge = 99;
  private exertion = 0;
  private leanPitchVel = 0;
  private leanRollVel = 0;

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

  update(sim: FlightSim, dt: number, time: number, look: LookTarget | null): DragonPose {
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
    if (onSurface) {
      neckPitch = -0.05 - sim.pitch * 0.4 - 0.04 * Math.sin(sim.walkPhase * 2) * sim.walkAmount;
      neckYaw += 0.06 * Math.sin(time * 0.37) * (1 - sim.walkAmount);
    } else if (sim.mode === 'landing' || sim.mode === 'hovering') {
      neckPitch = -0.18 - sim.pitch * 0.55;
    } else if (sim.mode === 'diving') {
      neckPitch = -sim.pitch * 0.15 - 0.05;
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
      tailYaw += 0.16 * Math.sin(sim.walkPhase + 0.9) * sim.walkAmount + 0.07 * Math.sin(time * 0.6);
      tailPitch = sim.mode === 'swimming' ? -0.08 : 0.06 + 0.04 * Math.sin(sim.walkPhase * 2 + 0.5) * sim.walkAmount;
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
    pose.tailYaw = follow(pose.tailYaw, clamp(tailYaw, -0.7, 0.7), 2.5, dt);
    pose.tailPitch = follow(pose.tailPitch, clamp(tailPitch, -0.5, 0.5), 2.5, dt);

    pose.walkPhase = sim.walkPhase;
    pose.walkAmount = follow(pose.walkAmount, onSurface ? sim.walkAmount : 0, 6, dt);

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
    const pitchTarget = clamp((-_accelBody.z / GRAVITY) * 0.5 - (_accelBody.y / GRAVITY - 1) * 0.06 - speedTuck, -0.55, 0.45);
    const rollTarget = clamp((-_accelBody.x / GRAVITY) * 0.5 + (airborne ? sim.bank * 0.1 : 0), -0.45, 0.45);
    const wn = 7;
    const zeta = 0.55;
    const h = Math.min(dt, 1 / 30);
    this.leanPitchVel += (wn * wn * (pitchTarget - pose.riderLeanPitch) - 2 * zeta * wn * this.leanPitchVel) * h;
    this.leanRollVel += (wn * wn * (rollTarget - pose.riderLeanRoll) - 2 * zeta * wn * this.leanRollVel) * h;
    pose.riderLeanPitch = clamp(pose.riderLeanPitch + this.leanPitchVel * h, -0.6, 0.5);
    pose.riderLeanRoll = clamp(pose.riderLeanRoll + this.leanRollVel * h, -0.5, 0.5);
    return pose;
  }
}
