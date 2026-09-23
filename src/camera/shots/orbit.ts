import * as THREE from 'three';
import { AXIS_X, WORLD_UP, lookRotation, rotateLocal } from '../math/rotation';
import { DEG, clamp } from '../math/scalar';
import { Spring } from '../math/springs';
import type { CameraPose } from '../types';
import { AimRig, Shot, range, sign, type ShotEnv, type ShotKind } from './shot';

const _pivot = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _rel = new THREE.Vector3();

/** Slow orbit around the dragon, relative to its (smoothed) heading. Also used to enter cinematic mode seamlessly. */
export class OrbitShot extends Shot {
  readonly kind: ShotKind = 'orbit';
  private angle = 0;
  private angularVelocity = 0.12;
  private elevation = 10 * DEG;
  private readonly radius = new Spring(35);
  private radiusTarget = 35;
  private readonly fov = new Spring(50);
  private fovTarget = 50;
  private readonly boom = new Spring(35);
  private readonly aim = new AimRig();

  /** `from`: continue from this viewpoint. `behind`: start from behind the dragon (random side). */
  begin(env: ShotEnv, from: CameraPose | null, behind = false): boolean {
    const t = env.frame.target;
    const rng = env.rng;
    this.radiusTarget = range(rng, 0.95, 1.45) * Math.max(26, t.size * 1.25);
    this.angularVelocity = sign(rng) * range(rng, 0.1, 0.16);
    this.fovTarget = range(rng, 46, 54);
    if (from) {
      // Continue from where the camera currently is.
      _rel.subVectors(from.position, t.position);
      const flat = Math.hypot(_rel.x, _rel.z);
      this.angle = Math.atan2(_rel.x, _rel.z) - env.headingYaw;
      this.elevation = clamp(Math.atan2(_rel.y - t.riderHeight * 0.4, flat), -4 * DEG, 35 * DEG);
      this.radius.reset(clamp(_rel.length(), 12, 90));
      this.fov.reset(from.fov);
    } else if (behind) {
      this.angle = sign(rng) * range(rng, 15 * DEG, 40 * DEG);
      this.elevation = range(rng, 8 * DEG, 16 * DEG);
      this.radius.reset(this.radiusTarget);
      this.fov.reset(this.fovTarget);
    } else {
      this.angle = range(rng, -Math.PI, Math.PI);
      this.elevation = range(rng, 4 * DEG, 20 * DEG);
      this.radius.reset(this.radiusTarget);
      this.fov.reset(this.fovTarget);
    }
    this.boom.reset(1e4);
    this.pivot(env, _pivot);
    this.aim.reset(_pivot, 41 + Math.floor(rng() * 1000));
    this.start(range(rng, 7, 10));
    this.label = 'Yörünge';
    return true;
  }

  update(env: ShotEnv, out: CameraPose): void {
    const t = env.frame.target;
    const dt = env.frame.dt;
    const col = env.frame.collision;
    this.angle += this.angularVelocity * env.frame.dt;
    const r = this.radius.update(this.radiusTarget, 1.2, dt);
    const a = env.headingYaw + this.angle;
    const ce = Math.cos(this.elevation);
    _dir.set(Math.sin(a) * ce, Math.sin(this.elevation), Math.cos(a) * ce);
    this.pivot(env, _pivot);
    const allowed = Math.max(3, col.castBoom(_pivot, _dir, r, 1.5));
    if (allowed < this.boom.x) {
      this.boom.reset(allowed);
    } else {
      this.boom.update(allowed, 2, dt);
    }
    out.position.copy(_pivot).addScaledVector(_dir, Math.min(r, this.boom.x));
    col.resolve(out.position, 1.2);
    this.aim.track(_pivot, t.velocity, 9, dt);
    lookRotation(out.position, this.aim.point.x, WORLD_UP, out.quaternion);
    rotateLocal(out.quaternion, AXIS_X, 3 * DEG);
    out.fov = this.fov.update(this.fovTarget, 1.5, dt);
    out.near = 0.3;
    out.speedEffect = 0;
    out.shakeTranslation = 0.5;
    out.shakeRotation = 0.5;
  }

  private pivot(env: ShotEnv, out: THREE.Vector3): THREE.Vector3 {
    const t = env.frame.target;
    return out.copy(t.position).addScaledVector(WORLD_UP, t.riderHeight * 0.4);
  }
}
