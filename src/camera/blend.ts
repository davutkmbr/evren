import * as THREE from 'three';
import type { CameraMode } from '../core/contracts';
import { WORLD_UP, lookRotation } from './math/rotation';
import { clamp, lerp, smootherstep, smoothstep, wrapAngle } from './math/scalar';
import type { CameraCollision } from './obstruction';
import type { DragonTracker } from './tracker';
import type { CameraPose } from './types';

/**
 * How a mode change is animated:
 * - orbit: swings around the dragon in spherical coordinates (log-distance) while re-aiming at it every frame,
 *   so the subject never leaves the frame and the path never crosses the body;
 * - pov-in / pov-out: a body-frame swoop that rises above the rider and drops onto (or lifts off) the eyes;
 * - linear: plain world-space lerp (no dragon to reference).
 */
export type BlendKind = 'orbit' | 'pov-in' | 'pov-out' | 'linear';

const ORBIT_BASE_DURATION = 0.4;
const POV_DURATION = 0.55;
/** Hard cut instead of blending beyond these (m / rad). */
const MAX_ORBIT_DISTANCE = 700;
const MAX_ORBIT_ANGLE = 100 * (Math.PI / 180);
const MAX_POV_DISTANCE = 150;
/** Elevation (body frame) the POV swoop passes through right above the rider. */
const POV_APEX_ELEVATION = 60 * (Math.PI / 180);
/** Distance along the rider's view used as the look target at the POV end of the swoop (m). */
const POV_AIM_DISTANCE = 30;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _invBody = new THREE.Quaternion();
const _toLocal = new THREE.Vector3();
const _toQuatLocal = new THREE.Quaternion();
const _pivot = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _look = new THREE.Quaternion();
const _relTo = new THREE.Quaternion();
const _origin = new THREE.Vector3();

interface Spherical {
  r: number;
  az: number;
  el: number;
}

function toSpherical(v: THREE.Vector3, out: Spherical): Spherical {
  out.r = v.length();
  out.az = Math.atan2(v.x, v.z);
  out.el = out.r > 1e-6 ? Math.asin(clamp(v.y / out.r, -1, 1)) : 0;
  return out;
}

function fromSpherical(r: number, az: number, el: number, out: THREE.Vector3): THREE.Vector3 {
  const ce = Math.cos(el);
  return out.set(Math.sin(az) * ce * r, Math.sin(el) * r, Math.cos(az) * ce * r);
}

const _s0: Spherical = { r: 0, az: 0, el: 0 };
const _s1: Spherical = { r: 0, az: 0, el: 0 };

export class ModeBlend {
  active = false;
  kind: BlendKind = 'linear';
  /** Eased progress 0..1. */
  weight = 1;
  from: CameraMode = 'third';
  to: CameraMode = 'third';

  private t = 0;
  private duration = ORBIT_BASE_DURATION;
  private planned = false;
  private readonly fromWorld = new THREE.Vector3();
  /** orbit: offset from the pivot (world axes); pov: position in the body frame. */
  private readonly fromLocal = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();
  /** Start orientation relative to its own look-at frame. */
  private readonly relFrom = new THREE.Quaternion();
  private readonly aimFrom = new THREE.Vector3();
  private fromFov = 60;
  private fromNear = 0.25;
  private fromSpeedEffect = 0;

  /** Starts a blend from `current` (last frame's final pose). Returns false when the change should cut. */
  begin(current: CameraPose, from: CameraMode, to: CameraMode, target: DragonTracker): boolean {
    this.from = from;
    this.to = to;
    this.t = 0;
    this.weight = 0;
    this.planned = false;
    this.fromWorld.copy(current.position);
    this.fromQuat.copy(current.quaternion);
    this.fromFov = current.fov;
    this.fromNear = current.near;
    this.fromSpeedEffect = current.speedEffect;
    if (to === 'free') {
      this.active = false;
      return false;
    }
    if (!target.available) {
      this.kind = 'linear';
      this.duration = ORBIT_BASE_DURATION;
      this.active = true;
      return true;
    }
    this.kind = to === 'pov' ? 'pov-in' : from === 'pov' ? 'pov-out' : 'orbit';
    if (this.kind === 'orbit') {
      this.pivot(target, _pivot);
      this.fromLocal.subVectors(current.position, _pivot);
      lookRotation(current.position, _pivot, WORLD_UP, _look);
      this.relFrom.copy(_look).invert().multiply(current.quaternion);
    } else {
      _invBody.copy(target.quaternion).invert();
      this.fromLocal.subVectors(current.position, target.position).applyQuaternion(_invBody);
      _q.copy(_invBody).multiply(current.quaternion);
      if (this.kind === 'pov-in') {
        this.aimFrom.set(0, target.riderHeight * 0.4, 0);
      } else {
        _fwd.set(0, 0, -1).applyQuaternion(_q);
        this.aimFrom.copy(this.fromLocal).addScaledVector(_fwd, POV_AIM_DISTANCE);
      }
      lookRotation(this.fromLocal, this.aimFrom, WORLD_UP, _look);
      this.relFrom.copy(_look).invert().multiply(_q);
    }
    this.active = true;
    return true;
  }

  cancel(): void {
    this.active = false;
    this.weight = 1;
  }

  /** Writes the blended pose into `out` given the destination controller's pose `to`. */
  apply(to: CameraPose, out: CameraPose, target: DragonTracker, collision: CameraCollision, dt: number): void {
    if (!this.active) {
      return;
    }
    if (!this.planned) {
      this.planned = true;
      if (!this.plan(to, target)) {
        this.active = false;
        this.weight = 1;
        return;
      }
    }
    this.t += dt;
    const u = clamp(this.t / this.duration, 0, 1);
    const w = smootherstep(u);
    this.weight = w;
    if (this.kind === 'orbit' && target.available) {
      this.applyOrbit(to, out, target, collision, w);
    } else if ((this.kind === 'pov-in' || this.kind === 'pov-out') && target.available) {
      this.applyPov(to, out, target, collision, w);
    } else {
      out.position.lerpVectors(this.fromWorld, to.position, w);
      out.quaternion.slerpQuaternions(this.fromQuat, to.quaternion, w);
    }
    out.fov = lerp(this.fromFov, to.fov, w);
    out.near = u < 1 ? Math.min(this.fromNear, to.near) : to.near;
    out.speedEffect = lerp(this.fromSpeedEffect, to.speedEffect, w);
    out.shakeTranslation = to.shakeTranslation;
    out.shakeRotation = to.shakeRotation;
    if (u >= 1) {
      this.active = false;
    }
  }

  /** Chooses duration or a hard cut once the destination pose is known. */
  private plan(to: CameraPose, target: DragonTracker): boolean {
    if (this.kind === 'linear' || !target.available) {
      const d = this.fromWorld.distanceTo(to.position);
      this.duration = ORBIT_BASE_DURATION + 0.5 * smoothstep(40, 500, d);
      return d <= MAX_ORBIT_DISTANCE;
    }
    if (this.kind === 'orbit') {
      this.pivot(target, _pivot);
      _b.subVectors(to.position, _pivot);
      const r0 = this.fromLocal.length();
      const r1 = _b.length();
      if (r0 > MAX_ORBIT_DISTANCE || r0 < 0.5 || r1 < 0.5) {
        return false;
      }
      const angle = this.fromLocal.angleTo(_b);
      if (angle > MAX_ORBIT_ANGLE) {
        return false;
      }
      const travel = Math.abs(r1 - r0) + angle * Math.min(r0, r1);
      this.duration = ORBIT_BASE_DURATION + 0.5 * smoothstep(40, 500, travel);
      return true;
    }
    _invBody.copy(target.quaternion).invert();
    _toLocal.subVectors(to.position, target.position).applyQuaternion(_invBody);
    const d = this.fromLocal.distanceTo(_toLocal);
    this.duration = POV_DURATION + 0.2 * smoothstep(30, 120, d);
    return d <= MAX_POV_DISTANCE;
  }

  private applyOrbit(to: CameraPose, out: CameraPose, target: DragonTracker, collision: CameraCollision, w: number): void {
    this.pivot(target, _pivot);
    _b.subVectors(to.position, _pivot);
    toSpherical(this.fromLocal, _s0);
    toSpherical(_b, _s1);
    const r = Math.exp(lerp(Math.log(Math.max(_s0.r, 0.5)), Math.log(Math.max(_s1.r, 0.5)), w));
    const az = _s0.az + wrapAngle(_s1.az - _s0.az) * w;
    const el = lerp(_s0.el, _s1.el, w);
    out.position.copy(_pivot).add(fromSpherical(r, az, el, _a));
    collision.resolve(out.position, 0.5);

    lookRotation(to.position, _pivot, WORLD_UP, _look);
    _relTo.copy(_look).invert().multiply(to.quaternion);
    lookRotation(out.position, _pivot, WORLD_UP, _look);
    _q.slerpQuaternions(this.relFrom, _relTo, w);
    out.quaternion.copy(_look).multiply(_q);
  }

  /**
   * POV swoop in the dragon's body frame (so it rides along with turns and rolls). The camera is expressed
   * in spherical coordinates around the rider's eye; its distance shrinks (or grows) as a power curve while
   * the elevation passes through POV_APEX_ELEVATION near the rider, so the last metres are travelled from
   * above the head rather than through the rider's back.
   */
  private applyPov(to: CameraPose, out: CameraPose, target: DragonTracker, collision: CameraCollision, w: number): void {
    _invBody.copy(target.quaternion).invert();
    _toLocal.subVectors(to.position, target.position).applyQuaternion(_invBody);
    _toQuatLocal.copy(_invBody).multiply(to.quaternion);

    if (this.kind === 'pov-in') {
      _a.subVectors(this.fromLocal, _toLocal);
      toSpherical(_a, _s0);
      const apex = Math.max(_s0.el, POV_APEX_ELEVATION);
      const r = _s0.r * Math.pow(1 - w, 1.5);
      const el = lerp(_s0.el, apex, smoothstep(0, 0.6, w));
      _pos.copy(_toLocal).add(fromSpherical(r, _s0.az, el, _b));
      _fwd.set(0, 0, -1).applyQuaternion(_toQuatLocal);
      _b.copy(_toLocal).addScaledVector(_fwd, POV_AIM_DISTANCE);
      _aim.lerpVectors(this.aimFrom, _b, w);
      lookRotation(_toLocal, _b, WORLD_UP, _look);
    } else {
      _a.subVectors(_toLocal, this.fromLocal);
      toSpherical(_a, _s1);
      const apex = Math.max(_s1.el, POV_APEX_ELEVATION);
      const r = _s1.r * Math.pow(w, 1.5);
      const el = lerp(apex, _s1.el, smoothstep(0.4, 1, w));
      _pos.copy(this.fromLocal).add(fromSpherical(r, _s1.az, el, _b));
      _b.set(0, target.riderHeight * 0.4, 0);
      _aim.lerpVectors(this.aimFrom, _b, w);
      lookRotation(_toLocal, _b, WORLD_UP, _look);
    }
    _relTo.copy(_look).invert().multiply(_toQuatLocal);

    if (_aim.distanceToSquared(_pos) > 0.25) {
      lookRotation(_pos, _aim, WORLD_UP, _look);
    } else {
      lookRotation(_origin.set(0, 0, 0), _fwd.set(0, 0, -1), WORLD_UP, _look);
    }
    _q2.slerpQuaternions(this.relFrom, _relTo, w);
    out.quaternion.copy(target.quaternion).multiply(_look).multiply(_q2);
    out.position.copy(_pos).applyQuaternion(target.quaternion).add(target.position);
    const floor = collision.groundHeight(out.position.x, out.position.z) + 0.3;
    if (out.position.y < floor) {
      out.position.y = floor;
    }
  }

  private pivot(target: DragonTracker, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(target.position).addScaledVector(WORLD_UP, target.riderHeight * 0.4);
  }
}
