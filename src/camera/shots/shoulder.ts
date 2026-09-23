import * as THREE from 'three';
import { AXIS_X, WORLD_UP, dampQuaternion, lookAlong, rotateLocal } from '../math/rotation';
import { DEG, smoothstep } from '../math/scalar';
import type { CameraPose } from '../types';
import { Shot, range, sign, type ShotEnv, type ShotKind } from './shot';

/** Relative airflow sideways across the rider (m/s) above which the cloak visibly streams to one side. */
const CLOAK_SIDESLIP = 0.8;
/** Fraction of the flight-path climb/dive the view follows (as a direction component). */
const PITCH_FOLLOW = 0.65;

const _local = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _air = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _target = new THREE.Quaternion();

/**
 * Over-the-shoulder shot riding just behind and above the rider, looking out past the dragon's head. The eye
 * sits high enough that the cloak streaming back from the rider's shoulders stays below the frame, on the side
 * the cloak is not blown toward, so the neck, horns and the view ahead lead the composition.
 */
export class ShoulderShot extends Shot {
  readonly kind: ShotKind = 'shoulder';
  private readonly local = new THREE.Vector3();
  private readonly orientation = new THREE.Quaternion();
  private fov = 62;
  private tilt = -5 * DEG;
  private initialized = false;

  begin(env: ShotEnv): boolean {
    const t = env.frame.target;
    const rng = env.rng;
    if (!t.rig) {
      return false;
    }
    // Human-scale offsets from the rider's head (body frame: +X right, +Y up, +Z back), independent of dragon size.
    this.local.set(this.cameraSide(env) * range(rng, 1.35, 1.6), range(rng, 1.05, 1.3), range(rng, 2.3, 2.8));
    this.fov = range(rng, 56, 62);
    this.tilt = -range(rng, 2, 4.5) * DEG;
    this.initialized = false;
    this.start(range(rng, 6, 8));
    this.label = 'Omuz üstü';
    return true;
  }

  update(env: ShotEnv, out: CameraPose): void {
    const t = env.frame.target;
    const dt = env.frame.dt;
    _local.copy(this.local).applyQuaternion(t.quaternion);
    out.position.copy(t.headPosition).add(_local);
    if (out.position.y < 0.4 && env.frame.collision.groundHeight(out.position.x, out.position.z) <= 0) {
      out.position.y = 0.4;
    }
    // Follow climbs and dives only partly so the horizon stays in the frame.
    _dir.copy(t.travelDir).add(t.forward).normalize();
    _dir.y *= PITCH_FOLLOW;
    _up.copy(WORLD_UP).add(t.up).normalize();
    lookAlong(_dir, _up, _target);
    rotateLocal(_target, AXIS_X, this.tilt);
    if (!this.initialized) {
      this.orientation.copy(_target);
      this.initialized = true;
    } else {
      dampQuaternion(this.orientation, _target, 7, dt);
    }
    out.quaternion.copy(this.orientation);
    out.fov = this.fov;
    out.near = 0.08;
    out.speedEffect = 0.6 * smoothstep(40, 110, t.speed);
    out.shakeTranslation = 0.15;
    out.shakeRotation = 0.9;
  }

  /** Side (+1 right, -1 left) opposite to where the relative wind blows the rider's cloak; random when it streams straight back. */
  private cameraSide(env: ShotEnv): number {
    const t = env.frame.target;
    const wind = env.frame.ctx.services.tryGet('env')?.wind;
    _air.copy(t.velocity).negate();
    if (wind) {
      _air.add(wind);
    }
    _air.applyQuaternion(_invQ.copy(t.quaternion).invert());
    if (Math.abs(_air.x) > CLOAK_SIDESLIP) {
      return _air.x > 0 ? -1 : 1;
    }
    return sign(env.rng);
  }
}
