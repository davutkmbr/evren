import * as THREE from 'three';
import type { CameraMode } from '../../core/contracts';
import { AXIS_X, AXIS_Y, AXIS_Z, rotateLocal } from '../math/rotation';
import { DEG, clamp, lerp, smoothstep } from '../math/scalar';
import { DampedOscillator, Spring, expAlpha } from '../math/springs';
import type { CameraController, CameraFrame, CameraPose } from '../types';

const TUNING = {
  yawLimit: 110 * DEG,
  pitchDown: -60 * DEG,
  pitchUp: 70 * DEG,
  returnDelay: 1.4,
  returnOmega: 3.2,
  /** Fraction of the rig's high-frequency head motion that reaches the eyes (the neck absorbs the rest). */
  headMotionKeep: 0.45,
  /** Target peak-to-center wing-beat bob (m) at full flap amplitude. */
  bobAmplitude: 0.045,
  nodAmplitude: 0.008,
  /** Riders tilt their head toward the horizon by this fraction of the bank. */
  horizonHold: 0.22,
  fovBase: 75,
  fovSpeed: 8,
  /** Free fall: extra FOV (deg) and the head floating up off the saddle (m). */
  fallFov: 5,
  fallFloat: 0.05,
  /** A sudden g onset (a catch) punches the FOV in by up to this (deg). */
  onsetKick: 4,
  near: 0.05,
  /**
   * Neutral posture: the rider sits tall (eyes this far above the rig's head anchor) and looks this far below
   * the flight path, so the dragon's head and horns sit in the lower middle of the frame and the point the
   * dragon is flying toward stays visible above them instead of behind the skull.
   */
  eyeRaise: 0.3,
  lookBelowPath: 8 * DEG,
  maxNeutralBias: 20 * DEG,
  /** Largest nose-up/down attitude the rider's torso compensates when looking around (rad). */
  maxTorsoLevel: 25 * DEG,
} as const;

/** Eye offset from the neck pivot, head frame (m): eyes sit ~9 cm above and in front of the atlas joint. */
const EYE_FROM_NECK = new THREE.Vector3(0, 0.09, -0.085);

const _invQ = new THREE.Quaternion();
const _relPos = new THREE.Vector3();
const _relRot = new THREE.Quaternion();
const _hf = new THREE.Vector3();
const _local = new THREE.Vector3();
const _lagTarget = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _lookQ = new THREE.Quaternion();
const _eye = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _dir = new THREE.Vector3();

/**
 * First-person rider view: eyes at the rig's riderHead, with neck stabilisation, wing-beat bob,
 * g-force head inertia, partial horizon hold and mouse head-look that eases back when idle.
 */
export class PovController implements CameraController {
  readonly mode: CameraMode = 'pov';

  private readonly lookYaw = new Spring();
  private readonly lookPitch = new Spring();
  private idle = 99;
  private readonly relPosSmooth = new THREE.Vector3();
  private readonly relRotSmooth = new THREE.Quaternion();
  private hfPower = 0;
  private bob = 0;
  private nod = 0;
  private readonly forceAvg = new THREE.Vector3(0, 9.81, 0);
  private readonly headLag = new DampedOscillator();
  private leanRoll = 0;
  private leanPitch = 0;
  private readonly horizon = new Spring();
  private readonly fov = new Spring(TUNING.fovBase);
  private readonly kick = new Spring();
  private readonly speedFx = new Spring();
  /** Slow average of the rig head's pitch in the body frame (its static posture, not its animation). */
  private headPitchSlow = 0;
  /** Smoothed flight-path pitch in the body frame (≈ -angle of attack). */
  private pathPitch = 0;
  private initialized = false;

  enter(frame: CameraFrame): void {
    this.reset(frame);
  }

  reset(frame: CameraFrame): void {
    const t = frame.target;
    _invQ.copy(t.quaternion).invert();
    this.relPosSmooth.subVectors(t.headPosition, t.position).applyQuaternion(_invQ);
    this.relRotSmooth.copy(_invQ).multiply(t.headQuaternion);
    this.headPitchSlow = this.headPitch();
    this.pathPitch = this.pathPitchTarget(frame);
    this.hfPower = 0;
    this.bob = 0;
    this.nod = 0;
    this.forceAvg.copy(t.specificForceBody);
    this.headLag.reset();
    this.leanRoll = 0;
    this.leanPitch = 0;
    this.horizon.reset(this.horizonTarget(frame));
    this.lookYaw.reset(0);
    this.lookPitch.reset(0);
    this.idle = 99;
    this.fov.reset(this.fovTarget(frame));
    this.kick.reset(0);
    this.speedFx.reset(0);
    this.initialized = true;
  }

  update(frame: CameraFrame, out: CameraPose): void {
    const t = frame.target;
    const dt = frame.camDt;
    const sdt = frame.dt;
    if (!this.initialized) {
      this.reset(frame);
    }

    // Head-look.
    if (frame.lookActive && (frame.lookYaw !== 0 || frame.lookPitch !== 0)) {
      this.lookYaw.reset(clamp(this.lookYaw.x + frame.lookYaw, -TUNING.yawLimit, TUNING.yawLimit));
      this.lookPitch.reset(clamp(this.lookPitch.x + frame.lookPitch, TUNING.pitchDown, TUNING.pitchUp));
      this.idle = 0;
    } else {
      this.idle += dt;
    }
    if (this.idle > TUNING.returnDelay && !frame.paused && !(frame.lookActive && frame.ctx.input.isHeld('look'))) {
      this.lookYaw.update(0, TUNING.returnOmega, dt);
      this.lookPitch.update(0, TUNING.returnOmega, dt);
    }

    // Head transform relative to the body; the neck filters the rig's high-frequency motion.
    _invQ.copy(t.quaternion).invert();
    _relPos.subVectors(t.headPosition, t.position).applyQuaternion(_invQ);
    _relRot.copy(_invQ).multiply(t.headQuaternion);
    this.relPosSmooth.lerp(_relPos, expAlpha(1.5, sdt));
    this.relRotSmooth.slerp(_relRot, expAlpha(9, sdt));
    _hf.subVectors(_relPos, this.relPosSmooth);
    this.hfPower += (_hf.y * _hf.y - this.hfPower) * expAlpha(1.5, sdt);
    const rigBob = Math.sqrt(this.hfPower) * Math.SQRT2 * TUNING.headMotionKeep;

    // Wing-beat bob: the body is lowest mid-downstroke (displacement is opposite to the lift acceleration).
    const amp = clamp(t.flapAmplitude, 0, 1.5);
    const bobAmp = Math.max(0, TUNING.bobAmplitude - rigBob) * amp;
    const bobTarget = -bobAmp * Math.sin(t.flapPhase);
    const nodTarget = -TUNING.nodAmplitude * amp * Math.sin(t.flapPhase - 0.9);
    const damp = expAlpha(16, sdt);
    this.bob += (bobTarget - this.bob) * damp;
    this.nod += (nodTarget - this.nod) * damp;

    // G-force head inertia: transient specific force displaces the head against the acceleration.
    const f = t.specificForceBody;
    this.forceAvg.lerp(f, expAlpha(0.8, sdt));
    _delta.subVectors(f, this.forceAvg);
    const sustained = clamp(t.loadFactor - 1, -1, 4);
    _lagTarget.set(
      clamp(-_delta.x * 0.0055, -0.12, 0.12),
      clamp(-_delta.y * 0.004 - sustained * 0.018, -0.12, 0.06),
      clamp(-_delta.z * 0.005, -0.12, 0.12),
    );
    this.headLag.update(_lagTarget, 11, 0.45, sdt);
    const leanRate = expAlpha(6, sdt);
    this.leanRoll += (clamp(_delta.x * 0.0035, -0.07, 0.07) - this.leanRoll) * leanRate;
    this.leanPitch += (clamp(-_delta.z * 0.0025 - sustained * 0.006, -0.05, 0.05) - this.leanPitch) * leanRate;

    // Neck pivot parallax + torso twist when looking far to the side.
    const yaw = this.lookYaw.x;
    const pitch = this.lookPitch.x;
    _euler.set(pitch, yaw, 0, 'YXZ');
    _lookQ.setFromEuler(_euler);
    _eye.copy(EYE_FROM_NECK).applyQuaternion(_lookQ).sub(EYE_FROM_NECK);
    const twist = smoothstep(55 * DEG, 110 * DEG, Math.abs(yaw));
    _eye.x += -Math.sign(yaw) * twist * 0.22;
    _eye.y += twist * 0.05 + smoothstep(-20 * DEG, -60 * DEG, pitch) * 0.06;
    _eye.z += twist * 0.06 - smoothstep(-20 * DEG, -60 * DEG, pitch) * 0.08;

    _local.copy(this.relPosSmooth).addScaledVector(_hf, TUNING.headMotionKeep);
    // Sit-tall offset, reduced when looking down at one's own body.
    _local.y += this.bob + TUNING.eyeRaise * (1 - 0.6 * smoothstep(-15 * DEG, -50 * DEG, pitch)) + TUNING.fallFloat * t.weightless;
    _local.add(this.headLag.x);
    _eye.applyQuaternion(this.relRotSmooth);
    _local.add(_eye);
    out.position.copy(_local).applyQuaternion(t.quaternion).add(t.position);
    // Never dip the eye below the waves, except while the dragon is under water (then down to the seabed).
    if (frame.collision.groundHeight(out.position.x, out.position.z) <= 0) {
      out.position.y = Math.max(out.position.y, frame.collision.floorHeight(out.position.x, out.position.z, 0.3));
    }

    // Neutral look: replace the rig head's static pitch with "a little below the flight path"; the head's
    // faster animation (lag, lean, wing-beat nod) still comes through as the deviation from its slow average.
    _headEuler.setFromQuaternion(this.relRotSmooth, 'YXZ');
    const headPitch = _headEuler.x;
    this.headPitchSlow += (headPitch - this.headPitchSlow) * expAlpha(0.6, sdt);
    this.pathPitch += (this.pathPitchTarget(frame) - this.pathPitch) * expAlpha(2, sdt);
    const neutral = clamp(this.pathPitch - TUNING.lookBelowPath - this.headPitchSlow, -TUNING.maxNeutralBias, TUNING.maxNeutralBias);
    const forwardPitch = headPitch + neutral;

    // The head turns about a torso axis the rider keeps upright: the body's pitch attitude (angle of attack,
    // climbs, dives) is levelled out before the yaw, so looking sideways never rolls the horizon. The bank stays
    // (minus the partial horizon hold) and turns into looking down at the inside of a turn.
    const level = this.levelAngle(frame);
    const torsoPitch = lerp(-TUNING.lookBelowPath, forwardPitch - level, Math.max(0, Math.cos(yaw)));
    out.quaternion.copy(t.quaternion);
    rotateLocal(out.quaternion, AXIS_X, level);
    rotateLocal(out.quaternion, AXIS_Z, this.horizon.update(this.horizonTarget(frame), 3, sdt) + _headEuler.z);
    rotateLocal(out.quaternion, AXIS_Y, yaw + _headEuler.y);
    rotateLocal(out.quaternion, AXIS_X, torsoPitch + pitch + this.nod + this.leanPitch);
    rotateLocal(out.quaternion, AXIS_Z, this.leanRoll);

    out.fov = this.fov.update(this.fovTarget(frame), 2.2, sdt) + this.kick.update(-TUNING.onsetKick * smoothstep(3, 9, t.loadOnset), 10, sdt);
    out.near = TUNING.near;
    out.speedEffect = clamp(this.speedFx.update(0.85 * smoothstep(45, 115, t.speed), 3, sdt), 0, 1);
    out.shakeTranslation = 0.12;
    out.shakeRotation = 1.15;
  }

  /** Pitch of the smoothed rig head orientation relative to the body (rad, + = up). */
  private headPitch(): number {
    return _headEuler.setFromQuaternion(this.relRotSmooth, 'YXZ').x;
  }

  /**
   * Rotation about the body's lateral axis that brings the nose to the horizon (rad), limited and faded out
   * in steep banks, loops and inverted flight, where the rider's torso simply follows the dragon.
   */
  private levelAngle(frame: CameraFrame): number {
    const t = frame.target;
    const upright = smoothstep(0.3, 0.7, t.up.y);
    if (upright <= 0) {
      return 0;
    }
    return clamp(Math.atan2(-t.forward.y, t.up.y), -TUNING.maxTorsoLevel, TUNING.maxTorsoLevel) * upright;
  }

  private pathPitchTarget(frame: CameraFrame): number {
    const t = frame.target;
    _invQ.copy(t.quaternion).invert();
    _dir.copy(t.travelDir).applyQuaternion(_invQ);
    return clamp(Math.asin(clamp(_dir.y, -1, 1)), -15 * DEG, 12 * DEG);
  }

  private horizonTarget(frame: CameraFrame): number {
    const t = frame.target;
    const k = smoothstep(-0.2, 0.3, t.up.y);
    return clamp(t.bank * TUNING.horizonHold * k, -0.3, 0.3);
  }

  private fovTarget(frame: CameraFrame): number {
    const t = frame.target;
    return TUNING.fovBase + TUNING.fovSpeed * smoothstep(35, 105, t.speed) + TUNING.fallFov * t.weightless;
  }
}
