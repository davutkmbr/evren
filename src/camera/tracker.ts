import * as THREE from 'three';
import type { DragonRig, DragonState, EngineContext, FlightMode } from '../core/contracts';
import { bankOf } from './math/rotation';
import { clamp, smoothstep, wrapAngle, yawOfDirection } from './math/scalar';
import { expAlpha } from './math/springs';

const GRAVITY = 9.81;
/** A single-frame displacement above this is treated as a teleport. */
const JUMP_DISTANCE = 250;

const _tmp = new THREE.Vector3();
const _invQ = new THREE.Quaternion();

/**
 * Samples the dragon once per frame (after flight + rig animation) and derives the smoothed kinematic
 * quantities every camera mode needs: travel direction, turn/pitch rates, acceleration, specific force.
 */
export class DragonTracker {
  available = false;
  dragon: DragonState | null = null;
  rig: DragonRig | null = null;

  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly forward = new THREE.Vector3(0, 0, -1);
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly right = new THREE.Vector3(1, 0, 0);
  readonly velocity = new THREE.Vector3();
  /** Ground speed m/s. */
  speed = 0;
  /** Unit direction of travel: velocity when moving, the nose when hovering/grounded. */
  readonly travelDir = new THREE.Vector3(0, 0, -1);
  /** Horizontal unit travel direction and its right vector. */
  readonly travelFlat = new THREE.Vector3(0, 0, -1);
  readonly travelRight = new THREE.Vector3(1, 0, 0);
  /** 0..1, how horizontal the travel direction is (1 = level). */
  horizontalness = 1;
  /** Yaw (about +Y, forward -Z) of the travel direction. */
  travelYaw = 0;
  /** Flight-path pitch (radians, + = climbing). */
  travelPitch = 0;
  /** Bank relative to the horizon (radians, + = right wing down). */
  bank = 0;
  /** Smoothed rates (rad/s). headingRate > 0 = turning right. pitchRate > 0 = pulling up. */
  headingRate = 0;
  pitchRate = 0;
  /** Smoothed world acceleration (m/s²), kinematic (excludes gravity). */
  readonly accel = new THREE.Vector3();
  /** Smoothed specific force in the dragon body frame (what the rider feels, m/s²; level cruise ≈ (0, 9.81, 0)). */
  readonly specificForceBody = new THREE.Vector3(0, GRAVITY, 0);
  /** Load factor estimated from the specific force (g). */
  loadFactor = 1;
  /** 0..1: the rider is (nearly) weightless in a fall (folded wings, a push-over), smoothed. */
  weightless = 0;
  /** Smoothed rate of change of the load factor (g/s): a catch or a hard pull-out loads up quickly. */
  loadOnset = 0;
  flapPhase = 0;
  flapAmplitude = 0;
  mode: FlightMode = 'flying';
  agl = 100;
  /** True for the frame in which the dragon jumped (teleport). */
  jumped = false;
  /** Rider head world transform (falls back to an estimate on the body when the rig is missing). */
  readonly headPosition = new THREE.Vector3();
  readonly headQuaternion = new THREE.Quaternion();
  /** Typical size (m) used to scale framing: max(length, wingspan). */
  size = 24;
  /** Rig dimensions (m). */
  length = 18;
  wingspan = 24;
  /** Height of the rider's head above the body origin (m), body frame. */
  riderHeight = 2.6;

  private prevLoad = 1;
  private prevVelocity = new THREE.Vector3();
  private prevPosition = new THREE.Vector3();
  private prevYaw = 0;
  private prevPitch = 0;
  private initialized = false;

  update(ctx: EngineContext, dt: number): void {
    const dragon = ctx.services.tryGet('dragon') ?? null;
    this.dragon = dragon;
    this.rig = ctx.services.tryGet('rig') ?? null;
    this.jumped = false;
    if (!dragon) {
      this.available = false;
      return;
    }
    this.available = true;

    dragon.object.getWorldPosition(this.position);
    dragon.object.getWorldQuaternion(this.quaternion);
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
    this.velocity.copy(dragon.velocity);
    this.speed = this.velocity.length();
    this.mode = dragon.mode;
    this.agl = dragon.agl;
    // Tumbling after a hard landing (phase 04): the body rolls and somersaults, the view keeps the travel direction it
    // had and does not roll with it.
    const tumbling = this.initialized && (dragon.hardLanding === 'tumble' || dragon.hardLanding === 'rise');
    this.bank = tumbling ? 0 : bankOf(this.quaternion);

    const rig = this.rig;
    let headValid = false;
    if (rig) {
      const dims = rig.dimensions;
      this.size = clamp(Math.max(dims.length, dims.wingspan), 6, 60);
      this.length = clamp(dims.length, 4, 60);
      this.wingspan = clamp(dims.wingspan, 4, 80);
      const pose = rig.getPose();
      this.flapPhase = pose.flapPhase;
      this.flapAmplitude = pose.flapAmplitude;
      if (rig.riderHead.parent) {
        rig.riderHead.getWorldPosition(this.headPosition);
        rig.riderHead.getWorldQuaternion(this.headQuaternion);
        headValid = this.headPosition.distanceToSquared(this.position) < this.size * this.size;
      }
      if (headValid) {
        _invQ.copy(this.quaternion).invert();
        this.riderHeight = clamp(_tmp.subVectors(this.headPosition, this.position).applyQuaternion(_invQ).y, 0.5, 8);
      } else {
        // Rig without a usable rider anchor: estimate the saddle from the body dimensions.
        this.riderHeight = clamp(dims.height * 0.62, 1.2, 6);
        this.headPosition.set(0, this.riderHeight, -dims.length * 0.14);
      }
    } else {
      this.headPosition.set(0, this.riderHeight, -3);
    }
    if (!headValid) {
      this.headPosition.applyQuaternion(this.quaternion).add(this.position);
      this.headQuaternion.copy(this.quaternion);
    }

    // Travel direction: velocity when flying, the nose when slow; blended to avoid pops around hover.
    if (!tumbling) {
      const moving = smoothstep(3, 12, this.speed);
      if (this.speed > 1e-3) {
        _tmp.copy(this.velocity).multiplyScalar(moving / this.speed);
      } else {
        _tmp.set(0, 0, 0);
      }
      _tmp.addScaledVector(this.forward, 1 - moving);
      if (_tmp.lengthSq() < 1e-6) {
        _tmp.copy(this.forward);
      }
      this.travelDir.copy(_tmp.normalize());
      const flat = Math.hypot(this.travelDir.x, this.travelDir.z);
      this.horizontalness = flat;
      if (flat > 1e-3) {
        this.travelFlat.set(this.travelDir.x / flat, 0, this.travelDir.z / flat);
      } else {
        // Vertical travel: keep heading from the body (up vector points backwards in a dive).
        const fx = this.forward.x - this.up.x * Math.sign(this.travelDir.y);
        const fz = this.forward.z - this.up.z * Math.sign(this.travelDir.y);
        const fl = Math.hypot(fx, fz) || 1;
        this.travelFlat.set(fx / fl, 0, fz / fl);
      }
      this.travelRight.set(-this.travelFlat.z, 0, this.travelFlat.x);
      this.travelYaw = yawOfDirection(this.travelFlat.x, this.travelFlat.z);
      this.travelPitch = Math.asin(clamp(this.travelDir.y, -1, 1));
    }

    const jumped = this.initialized && this.position.distanceTo(this.prevPosition) > JUMP_DISTANCE;
    if (!this.initialized || jumped) {
      this.jumped = jumped;
      this.initialized = true;
      this.accel.set(0, 0, 0);
      this.headingRate = 0;
      this.pitchRate = 0;
      this.specificForceBody.set(0, GRAVITY, 0);
      this.loadFactor = 1;
      this.prevLoad = 1;
      this.weightless = 0;
      this.loadOnset = 0;
      this.prevVelocity.copy(this.velocity);
      this.prevPosition.copy(this.position);
      this.prevYaw = this.travelYaw;
      this.prevPitch = this.travelPitch;
      return;
    }

    if (dt > 0) {
      const a = expAlpha(10, dt);
      const ax = clamp((this.velocity.x - this.prevVelocity.x) / dt, -120, 120);
      const ay = clamp((this.velocity.y - this.prevVelocity.y) / dt, -120, 120);
      const az = clamp((this.velocity.z - this.prevVelocity.z) / dt, -120, 120);
      this.accel.x += (ax - this.accel.x) * a;
      this.accel.y += (ay - this.accel.y) * a;
      this.accel.z += (az - this.accel.z) * a;

      const yawRate = this.horizontalness > 0.25 ? -wrapAngle(this.travelYaw - this.prevYaw) / dt : 0;
      const pitchRate = (this.travelPitch - this.prevPitch) / dt;
      const r = expAlpha(6, dt);
      this.headingRate += (clamp(yawRate, -3, 3) - this.headingRate) * r;
      this.pitchRate += (clamp(pitchRate, -3, 3) - this.pitchRate) * r;

      _invQ.copy(this.quaternion).invert();
      _tmp.set(this.accel.x, this.accel.y + GRAVITY, this.accel.z).applyQuaternion(_invQ);
      this.specificForceBody.copy(_tmp);
      this.loadFactor = _tmp.length() / GRAVITY;

      // Falling with next to nothing holding the dragon up: the stomach-drop cues (camera lag, FOV, flutter).
      const airborne = this.mode !== 'grounded' && this.mode !== 'swimming' && this.mode !== 'underwater';
      const falling = airborne && this.velocity.y < -2;
      const weightless = falling ? smoothstep(0.6, 0.2, this.loadFactor) : 0;
      this.weightless += (weightless - this.weightless) * expAlpha(weightless > this.weightless ? 8 : 3, dt);
      const onset = clamp((this.loadFactor - this.prevLoad) / dt, -20, 20);
      this.loadOnset += (onset - this.loadOnset) * expAlpha(12, dt);
      this.prevLoad = this.loadFactor;
    }
    this.prevVelocity.copy(this.velocity);
    this.prevPosition.copy(this.position);
    this.prevYaw = this.travelYaw;
    this.prevPitch = this.travelPitch;
  }
}
