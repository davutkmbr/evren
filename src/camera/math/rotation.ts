import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();

export const WORLD_UP: Readonly<THREE.Vector3> = new THREE.Vector3(0, 1, 0);
export const AXIS_X: Readonly<THREE.Vector3> = new THREE.Vector3(1, 0, 0);
export const AXIS_Y: Readonly<THREE.Vector3> = new THREE.Vector3(0, 1, 0);
export const AXIS_Z: Readonly<THREE.Vector3> = new THREE.Vector3(0, 0, 1);

/**
 * Camera orientation whose -Z looks from `eye` toward `target`, with `up` as the preferred up vector.
 * Falls back to a stable alternative up when the view is (nearly) parallel to `up`.
 */
export function lookRotation(eye: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _dir.subVectors(target, eye);
  if (_dir.lengthSq() < 1e-10) {
    return out;
  }
  _dir.normalize();
  _up.copy(up);
  if (Math.abs(_dir.dot(_up)) > 0.9995) {
    _up.set(0, 0, _dir.y > 0 ? 1 : -1);
  }
  _m.lookAt(eye, target, _up);
  return out.setFromRotationMatrix(_m);
}

/** Orientation looking along `dir` (normalized or not). */
export function lookAlong(dir: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _axis.set(0, 0, 0);
  return lookRotation(_axis, dir, up, out);
}

/** Post-multiplies a rotation of `angle` about a camera-local axis. */
export function rotateLocal(q: THREE.Quaternion, axis: Readonly<THREE.Vector3>, angle: number): THREE.Quaternion {
  if (angle === 0) {
    return q;
  }
  _q.setFromAxisAngle(axis, angle);
  return q.multiply(_q);
}

/**
 * Bank angle of an orientation relative to the horizon: 0 level, positive = rolled right (right wing down).
 */
export function bankOf(q: THREE.Quaternion): number {
  const x = q.x;
  const y = q.y;
  const z = q.z;
  const w = q.w;
  // right = q·(1,0,0), up = q·(0,1,0): only their y components are needed.
  const rightY = 2 * (x * y + w * z);
  const upY = 1 - 2 * (x * x + z * z);
  return Math.atan2(-rightY, upY);
}

/** Exponential slerp toward a target orientation (frame-rate independent). */
export function dampQuaternion(current: THREE.Quaternion, target: THREE.Quaternion, rate: number, dt: number): THREE.Quaternion {
  if (dt <= 0) {
    return current;
  }
  return current.slerp(target, 1 - Math.exp(-rate * dt));
}
