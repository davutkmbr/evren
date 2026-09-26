import * as THREE from 'three';
import type { CameraMode } from '../../core/contracts';
import { AXIS_X, AXIS_Y, AXIS_Z, WORLD_UP, lookRotation, rotateLocal } from '../math/rotation';
import { DEG, clamp, lerp, smoothstep, wrapAngle } from '../math/scalar';
import { AngleSpring, Spring, VecSpring } from '../math/springs';
import type { CameraController, CameraFrame, CameraPose } from '../types';
import { CAMERA_FEEL, cameraFeel } from '../feel';

export const CHASE_MIN_DISTANCE = 12;
export const CHASE_MAX_DISTANCE = 90;

/** Tuning for the third-person chase camera. Angles in radians, rates in rad/s. */
const TUNING = {
  elevation: 10.5 * DEG,
  /** On the ground the eye drops to about a standing rider's height above the ground (m, scaled with size). */
  groundedEyeHeight: 4,
  groundedDistance: 0.8,
  groundedFraming: 2.5 * DEG,
  /** Fraction of the flight-path pitch the boom follows (less in climbs so the rider's back stays in view). */
  pitchFollowDive: 0.75,
  pitchFollowClimb: 0.6,
  /** Fraction of the bank the camera rolls with. */
  rollFollow: 0.3,
  maxRoll: 22 * DEG,
  yawOmega: 3.6,
  pitchOmega: 3.0,
  rollOmega: 4.2,
  /** Dragon sits this far below the screen center. */
  framingPitch: 5.2 * DEG,
  /** Look-ahead into turns: radians of view yaw per rad/s of heading rate. */
  turnLead: 0.34,
  maxTurnLead: 12 * DEG,
  climbLead: 0.16,
  maxClimbLead: 5 * DEG,
  /** Camera trails accelerations by accel * this (s²), clamped. */
  accelLag: 0.045,
  maxAccelLag: 3.2,
  /** Extra boom length at high speed (fraction), before the FOV compensation below. */
  speedStretch: 0.25,
  /**
   * Partial boom shortening against the speed FOV: distance ∝ (tan(fovMin/2) / tan(fov/2))^k. With k = 0.5 the
   * boom still grows ~8% from cruise to top speed while the dragon keeps ~3/4 of its cruise size in frame.
   */
  fovCompensation: 0.5,
  /** Steep dives: the view never looks down so far that the horizon leaves the top ~13% of the frame. */
  horizonMargin: 0.74,
  diveKnee: 8 * DEG,
  /** Near wing clearance when orbited to the side: (wingspan * this + wingClearance) m. */
  wingReach: 0.55,
  wingClearance: 7,
  fovMin: 60,
  fovMax: 74,
  /** Free fall: extra FOV (deg) and how far the camera hangs back above the dropping dragon (m per m/s of sink, max). */
  fallFov: 4,
  fallLagPerSink: 0.09,
  fallLagMax: 3,
  /** A sudden g onset (a catch) punches the FOV in by up to this (deg). */
  onsetKick: 4.5,
  recenterDelay: 2.0,
  recenterOmega: 2.3,
  /** Boom collision: soft margin eased toward, hard margin never crossed (m); spring rates (rad/s). */
  boomSoftMargin: 2.8,
  boomHardMargin: 0.6,
  minBoom: 3,
  /** Height kept above terrain/water under the eye (m). */
  groundClearance: 1.8,
  /**
   * Under water (phase 21 stage 4) the camera follows the dragon below the surface, but calmer than in the air: the
   * boom sits nearly level behind the dragon, follows this fraction of the flight-path pitch and of the roll-follow,
   * the acceleration lag is scaled down, and the eye sinks toward the lower floor (the seabed) at `underwaterSinkOmega`.
   */
  underwaterPitchFollow: 0.25,
  /** Boom elevation under water: nearly level with the dragon, so the camera really goes under with it. */
  underwaterElevation: 2.5 * DEG,
  underwaterPitchOmega: 3.2,
  underwaterRollFollow: 0.35,
  underwaterLag: 0.35,
  underwaterSinkOmega: 6,
  /** Boom length under water (fraction): the murky water hides the dragon at the full chase distance. */
  underwaterDistance: 0.55,
  pullInOmega: 14,
  releaseOmega: 2.2,
  eyeRadius: 0.9,
  near: 0.25,
} as const;

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _boomQ = new THREE.Quaternion();
const _offset = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _lagTarget = new THREE.Vector3();
const _boomUp = new THREE.Vector3();

/**
 * Third-person chase camera: critically damped springs on the boom yaw/pitch/roll, speed-scaled boom length,
 * acceleration lag, look-ahead into turns, mouse orbit with auto-recenter, wheel zoom and boom collision.
 */
export class ChaseController implements CameraController {
  readonly mode: CameraMode = 'third';

  private readonly yaw = new AngleSpring();
  private readonly pitch = new Spring();
  private readonly roll = new Spring();
  private readonly orbitYaw = new AngleSpring();
  private readonly orbitPitch = new Spring();
  private readonly zoom = new Spring(30);
  private zoomTarget = 30;
  private zoomInitialized = false;
  private readonly lag = new VecSpring();
  private readonly leadYaw = new Spring();
  private readonly leadPitch = new Spring();
  private readonly fov = new Spring(TUNING.fovMin);
  private readonly fallLag = new Spring();
  private readonly kick = new Spring();
  private readonly speedFx = new Spring();
  /** Speed stretch of the boom, smoothed: a water entry brakes the dragon by 10+ m/s within a frame. */
  private readonly stretch = new Spring();
  private readonly boomLength = new Spring(30);
  /** True while an obstacle holds the boom in (then it releases slowly once clear). */
  private obstructed = false;
  private readonly floor = new Spring(-1e4);
  /** 0 flying .. 1 grounded/swimming, smoothed so landing and take-off glide the camera. */
  private readonly groundedBlend = new Spring();
  /** 0 .. 1 while the dragon is under water (calmer boom, see TUNING.underwater*). */
  private readonly underwaterBlend = new Spring();
  private idle = 99;

  /** Current user zoom target (m), exposed for debugging/UI. */
  get zoomDistance(): number {
    return this.zoomTarget;
  }

  get orbitYawDeg(): number {
    return this.orbitYaw.x / DEG;
  }

  setZoom(distance: number): void {
    this.zoomTarget = clamp(distance, CHASE_MIN_DISTANCE, CHASE_MAX_DISTANCE);
    this.zoomInitialized = true;
  }

  enter(frame: CameraFrame): void {
    this.reset(frame);
  }

  reset(frame: CameraFrame): void {
    const t = frame.target;
    this.initZoom(frame);
    this.yaw.reset(t.travelYaw);
    this.pitch.reset(this.pitchTarget(frame));
    this.roll.reset(this.rollTarget(frame));
    this.orbitYaw.reset(0);
    this.orbitPitch.reset(0);
    this.zoom.reset(this.zoomTarget);
    this.lag.reset(_lagTarget.set(0, 0, 0));
    this.leadYaw.reset(0);
    this.leadPitch.reset(0);
    this.fov.reset(this.fovTarget(frame));
    this.fallLag.reset(0);
    this.kick.reset(0);
    this.speedFx.reset(this.speedFxTarget(frame));
    this.stretch.reset(smoothstep(22, 95, t.speed));
    this.groundedBlend.reset(this.isGrounded(frame) ? 1 : 0);
    this.underwaterBlend.reset(t.mode === 'underwater' ? 1 : 0);
    this.boomLength.reset(1e4);
    this.obstructed = false;
    this.floor.reset(frame.collision.floorHeight(t.position.x, t.position.z, TUNING.groundClearance));
    this.idle = 99;
  }

  update(frame: CameraFrame, out: CameraPose): void {
    const t = frame.target;
    // Player-driven parts (orbit, zoom, boom) run on camera time so they work while paused; the follow dynamics
    // run on simulation time so a paused frame stays frozen.
    const dt = frame.camDt;
    const sdt = frame.dt;
    this.initZoom(frame);

    // Player orbit (RMB / pointer lock / right stick). Recenters after a pause in mouse movement; only an
    // explicitly held look button (RMB) keeps the orbit parked, so pointer-locked play still returns behind.
    if (frame.lookActive && (frame.lookYaw !== 0 || frame.lookPitch !== 0)) {
      this.orbitYaw.reset(wrapAngle(this.orbitYaw.x + frame.lookYaw));
      this.orbitPitch.reset(clamp(this.orbitPitch.x - frame.lookPitch, -55 * DEG, 70 * DEG));
      this.idle = 0;
    } else {
      this.idle += dt;
    }
    if (this.idle > TUNING.recenterDelay && !frame.paused && !frame.lookHeld) {
      this.orbitYaw.update(0, TUNING.recenterOmega, dt);
      this.orbitPitch.update(0, TUNING.recenterOmega, dt);
    }
    if (frame.wheel !== 0) {
      this.zoomTarget = clamp(this.zoomTarget * Math.pow(1.12, frame.wheel), CHASE_MIN_DISTANCE, CHASE_MAX_DISTANCE);
    }
    this.zoom.update(this.zoomTarget, 9, dt);

    // Follow springs: yaw only follows while there is a meaningful horizontal heading (no spin in vertical dives).
    const yawOmega = TUNING.yawOmega * smoothstep(0.06, 0.35, t.horizontalness);
    this.yaw.update(t.travelYaw, yawOmega, sdt);
    const under = clamp(this.underwaterBlend.update(t.mode === 'underwater' ? 1 : 0, 5, sdt), 0, 1);
    this.pitch.update(this.pitchTarget(frame) * lerp(1, TUNING.underwaterPitchFollow, under), lerp(TUNING.pitchOmega, TUNING.underwaterPitchOmega, under), sdt);
    this.roll.update(this.rollTarget(frame) * lerp(1, TUNING.underwaterRollFollow, under), TUNING.rollOmega, sdt);
    const fov = this.fov.update(this.fovTarget(frame), 2.2, sdt);
    const g = this.groundedBlend.update(this.isGrounded(frame) ? 1 : 0, 2.5, sdt);

    const speedK = this.stretch.update(smoothstep(22, 95, t.speed), 3, sdt);
    const fovK = Math.pow(Math.tan((TUNING.fovMin * DEG) / 2) / Math.tan((fov * DEG) / 2), TUNING.fovCompensation);
    let distance = Math.max(CHASE_MIN_DISTANCE, this.zoom.x * (1 + TUNING.speedStretch * speedK) * fovK * lerp(1, TUNING.groundedDistance, g) * lerp(1, TUNING.underwaterDistance, under));
    const framing = lerp(TUNING.framingPitch, TUNING.groundedFraming, g);

    // Boom elevation: flying keeps a fixed angle above the (partially followed) flight path, softly floored so a
    // steep dive keeps the horizon in the top of the frame; on the ground the eye sits at rider height.
    const maxLookDown = Math.atan(TUNING.horizonMargin * Math.tan((fov * DEG) / 2));
    // The flight-path pitch only makes sense along the boom's own axis: seen from the side it must not tilt the boom.
    const alongBoom = Math.cos(this.orbitYaw.x);
    const elevation = lerp(TUNING.elevation, TUNING.underwaterElevation, under);
    let followPitch = softFloor(this.pitch.x * alongBoom - elevation, -maxLookDown - framing, TUNING.diveKnee);
    if (g > 0) {
      const scale = clamp(t.size / 24, 0.7, 1.5);
      const ground = frame.collision.groundHeight(t.position.x, t.position.z);
      const pivotY = t.position.y + t.riderHeight * 0.55;
      const eyeElevation = clamp(Math.atan2(ground + TUNING.groundedEyeHeight * scale - pivotY, distance), -4 * DEG, 14 * DEG);
      followPitch = lerp(followPitch, -eyeElevation, g);
    }
    const boomPitch = clamp(followPitch - this.orbitPitch.x, -84 * DEG, 72 * DEG);

    // Keep the lens outside the wing sweep when orbited to the side at short zoom.
    const side = Math.pow(Math.abs(Math.sin(this.orbitYaw.x)), 0.7);
    const wingClear = (t.wingspan * TUNING.wingReach + TUNING.wingClearance) * side * (0.35 + 0.65 * Math.cos(boomPitch));
    distance = Math.max(distance, wingClear);

    _euler.set(boomPitch, this.yaw.x + this.orbitYaw.x, 0, 'YXZ');
    _boomQ.setFromEuler(_euler);
    _offset.set(0, 0, distance).applyQuaternion(_boomQ);
    _boomUp.set(0, 1, 0).applyQuaternion(_boomQ);

    _pivot.copy(t.position).addScaledVector(WORLD_UP, t.riderHeight * 0.55);

    // Acceleration lag (the camera swings outward in turns, falls back when the dragon surges).
    _lagTarget.copy(t.accel).multiplyScalar(-TUNING.accelLag);
    const lagLen = _lagTarget.length();
    if (lagLen > TUNING.maxAccelLag) {
      _lagTarget.multiplyScalar(TUNING.maxAccelLag / lagLen);
    }
    _lagTarget.multiplyScalar((1 - 0.7 * g) * lerp(1, TUNING.underwaterLag, under));
    this.lag.update(_lagTarget, 4.5, sdt);
    _desired.copy(_pivot).add(_offset).add(this.lag.x);
    // Stomach drop: the camera hangs back above while the dragon falls away, and swoops after it on the catch.
    const fallLag = this.fallLag.update(t.weightless * clamp(-t.velocity.y * TUNING.fallLagPerSink, 0, TUNING.fallLagMax), t.weightless > 0.5 ? 3 : 2, sdt);
    _desired.y += fallLag;

    // Terrain/water under the eye: slide up along the surface instead of shortening the boom. While submerging is
    // allowed the floor is the seabed (plus clearance), and it drops there at a calmer rate than it rises.
    const floor = frame.collision.floorHeight(_desired.x, _desired.z, TUNING.groundClearance);
    this.floor.update(floor, floor > this.floor.x ? 12 : lerp(2, TUNING.underwaterSinkOmega, under), dt);
    _desired.y = Math.max(_desired.y, floor, this.floor.x);

    // Boom collision: a soft limit (wide margin) is approached with a fast spring so obstacles ease the camera in,
    // a hard limit just in front of the hit is never crossed, and the boom releases slowly once clear.
    _dir.subVectors(_desired, _pivot);
    const len = _dir.length();
    _dir.divideScalar(Math.max(len, 1e-6));
    const hit = frame.collision.hitDistance(_pivot, _dir, len + TUNING.boomSoftMargin);
    const soft = Math.max(TUNING.minBoom, Math.min(len, hit - TUNING.boomSoftMargin));
    const hard = Math.max(TUNING.minBoom, hit - TUNING.boomHardMargin);
    // Only an obstruction engages the springs; zoom, speed and wing-clearance changes act on the boom directly.
    if (soft < len - 1e-3) {
      this.obstructed = true;
    }
    if (this.obstructed) {
      this.boomLength.update(soft, soft < this.boomLength.x ? TUNING.pullInOmega : TUNING.releaseOmega, dt);
      if (soft >= len - 1e-3 && this.boomLength.x >= len - 0.02) {
        this.obstructed = false;
      }
    }
    if (!this.obstructed) {
      this.boomLength.reset(len);
    }
    if (this.boomLength.x > hard) {
      this.boomLength.reset(hard);
    }
    const boom = Math.min(len, this.boomLength.x);
    out.position.copy(_pivot).addScaledVector(_dir, boom);
    frame.collision.resolve(out.position, TUNING.eyeRadius);

    // Look: at the pivot, then framing/lead offsets and partial roll. Turn lead and roll-follow belong to the view
    // along the flight path: they fade out when orbited to the side and flip sign when looking back from the front.
    this.leadYaw.update(-clamp(t.headingRate * TUNING.turnLead, -TUNING.maxTurnLead, TUNING.maxTurnLead), 3, sdt);
    this.leadPitch.update(clamp(t.pitchRate * TUNING.climbLead, -TUNING.maxClimbLead, TUNING.maxClimbLead), 3, sdt);
    lookRotation(out.position, _pivot, _boomUp, out.quaternion);
    rotateLocal(out.quaternion, AXIS_Y, this.leadYaw.x * alongBoom);
    // The downward lead must not undo the dive floor (the player's own orbit may, deliberately).
    const lead = Math.max(this.leadPitch.x, Math.min(0, -maxLookDown - (followPitch + framing)));
    rotateLocal(out.quaternion, AXIS_X, framing + lead);
    rotateLocal(out.quaternion, AXIS_Z, -this.roll.x * alongBoom);

    // Perceived speed: a chain burst kicks the FOV open along its push envelope (fast attack via the square root, smooth
    // release).
    const feel = cameraFeel(t);
    out.fov = fov + this.kick.update(-TUNING.onsetKick * smoothstep(3, 9, t.loadOnset), 10, sdt) + CAMERA_FEEL.kick * feel.feel * Math.sqrt(feel.burst);
    out.near = TUNING.near;
    out.speedEffect = clamp(this.speedFx.update(this.speedFxTarget(frame), 3, sdt), 0, 1);
    out.shakeTranslation = 1;
    out.shakeRotation = 1;
  }

  private initZoom(frame: CameraFrame): void {
    if (this.zoomInitialized || !frame.target.available) {
      return;
    }
    this.zoomInitialized = true;
    this.zoomTarget = clamp(frame.target.size * 1.2, 24, 34);
    this.zoom.reset(this.zoomTarget);
  }

  private isGrounded(frame: CameraFrame): boolean {
    const mode = frame.target.mode;
    return mode === 'grounded' || mode === 'swimming';
  }

  private pitchTarget(frame: CameraFrame): number {
    const p = frame.target.travelPitch;
    return clamp(p * (p > 0 ? TUNING.pitchFollowClimb : TUNING.pitchFollowDive), -68 * DEG, 55 * DEG);
  }

  private rollTarget(frame: CameraFrame): number {
    const t = frame.target;
    // Fade roll-follow out when inverted or in near-vertical flight.
    const k = smoothstep(0.1, 0.4, t.horizontalness) * smoothstep(-0.2, 0.3, t.up.y);
    return clamp(t.bank * TUNING.rollFollow * k, -TUNING.maxRoll, TUNING.maxRoll);
  }

  private fovTarget(frame: CameraFrame): number {
    const t = frame.target;
    const dive = t.mode === 'diving' ? 3 : 0;
    const feel = cameraFeel(t);
    return TUNING.fovMin + (TUNING.fovMax - TUNING.fovMin) * smoothstep(25, 100, t.speed) + dive + TUNING.fallFov * t.weightless + CAMERA_FEEL.fov * feel.feel * feel.speed;
  }

  private speedFxTarget(frame: CameraFrame): number {
    const feel = cameraFeel(frame.target);
    return Math.max(smoothstep(45, 115, frame.target.speed), feel.feel * (CAMERA_FEEL.speedFx * feel.speed + CAMERA_FEEL.burstFx * feel.burst));
  }
}

/**
 * Smooth lower bound: identity above floor + knee, then eases asymptotically toward `floor` (C1 continuous).
 */
function softFloor(x: number, floor: number, knee: number): number {
  const start = floor + knee;
  return x >= start ? x : floor + knee * Math.exp((x - start) / knee);
}
