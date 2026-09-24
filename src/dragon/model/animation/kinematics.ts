import * as THREE from 'three';

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _euler = new THREE.Euler();
const CHAIN: THREE.Object3D[] = new Array(32);

/** Sets a bone's local rotation from Euler angles (rest rotation is identity). */
export function setEuler(bone: THREE.Object3D, x: number, y: number, z: number, order: THREE.EulerOrder = 'YZX'): void {
  _euler.set(x, y, z, order);
  bone.quaternion.setFromEuler(_euler);
}

/** Pre-multiplies (parent-space) an additional rotation onto a bone's local rotation. */
export function addEuler(bone: THREE.Object3D, x: number, y: number, z: number, order: THREE.EulerOrder = 'YZX'): void {
  _euler.set(x, y, z, order);
  _q.setFromEuler(_euler);
  bone.quaternion.premultiply(_q);
}

/**
 * Rig-space forward kinematics for a bone chain whose rest rotations are identity.
 * Walks up to `stop` (exclusive; its rig-space transform is assumed identity/offset-only).
 */
export function rigTransform(bone: THREE.Object3D, stop: THREE.Object3D, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
  let n = 0;
  let b: THREE.Object3D | null = bone;
  while (b && b !== stop && n < CHAIN.length) {
    CHAIN[n++] = b;
    b = b.parent;
  }
  outPos.set(0, 0, 0);
  outQuat.identity();
  for (let i = n - 1; i >= 0; i--) {
    const c = CHAIN[i];
    _v.copy(c.position).applyQuaternion(outQuat);
    outPos.add(_v);
    outQuat.multiply(c.quaternion);
  }
}

/**
 * Rotates `bone` (local, parent frame given by parentQuat in rig space) so that its rest direction
 * `restDir` (rig space) points along `targetDir` (rig space). Keeps roll minimal.
 */
export function aimBone(bone: THREE.Object3D, parentQuat: THREE.Quaternion, restDir: THREE.Vector3, targetDir: THREE.Vector3): void {
  _a.copy(restDir).normalize();
  _b.copy(targetDir).normalize();
  _q.setFromUnitVectors(_a, _b);
  _qi.copy(parentQuat).invert();
  bone.quaternion.copy(_qi).multiply(_q);
}

const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

function basisFrom(dir: THREE.Vector3, up: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
  _z.copy(dir).normalize();
  _x.crossVectors(up, _z);
  if (_x.lengthSq() < 1e-8) {
    _x.set(1, 0, 0).cross(_z);
  }
  _x.normalize();
  _y.crossVectors(_z, _x);
  return out.makeBasis(_x, _y, _z);
}

/**
 * Like aimBone but with roll control: maps the rest frame (restDir, restUp) onto (targetDir, targetUp).
 * Writes the rig-space rotation into outRig (optional) and the local rotation into the bone.
 */
export function aimBoneUp(
  bone: THREE.Object3D,
  parentQuat: THREE.Quaternion,
  restDir: THREE.Vector3,
  restUp: THREE.Vector3,
  targetDir: THREE.Vector3,
  targetUp: THREE.Vector3,
  outRig?: THREE.Quaternion,
): void {
  basisFrom(targetDir, targetUp, _m1);
  basisFrom(restDir, restUp, _m2);
  _m1.multiply(_m2.transpose());
  _q.setFromRotationMatrix(_m1);
  if (outRig) {
    outRig.copy(_q);
  }
  _qi.copy(parentQuat).invert();
  bone.quaternion.copy(_qi).multiply(_q);
}

/** Rig-space rotation that maps the frame (restDir, restUp) onto (targetDir, targetUp). */
export function mapFrame(restDir: THREE.Vector3, restUp: THREE.Vector3, targetDir: THREE.Vector3, targetUp: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  basisFrom(targetDir, targetUp, _m1);
  basisFrom(restDir, restUp, _m2);
  _m1.multiply(_m2.transpose());
  return out.setFromRotationMatrix(_m1);
}

/** Signed angle (rad) of the twist component of `q` about the unit `axis` (swing-twist decomposition). */
export function twistAngle(q: THREE.Quaternion, axis: THREE.Vector3): number {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  return 2 * Math.atan2(d, q.w);
}

const _limbDir = new THREE.Vector3();

/**
 * Two-bone IK that also returns the bend-plane normal (unit, bendDir x chainDir). Orienting both bones with
 * mapFrame(rest, restNormal, current, normal) keeps the middle joint a pure hinge (no twist between the bones),
 * also when the limb is straight.
 */
export function solveLimb(
  root: THREE.Vector3,
  target: THREE.Vector3,
  l1: number,
  l2: number,
  pole: THREE.Vector3,
  outMid: THREE.Vector3,
  outEnd: THREE.Vector3,
  outNormal: THREE.Vector3,
): void {
  solveTwoBone(root, target, l1, l2, pole, outMid, outEnd);
  _limbDir.subVectors(outEnd, root).normalize();
  outNormal.subVectors(pole, root);
  outNormal.addScaledVector(_limbDir, -outNormal.dot(_limbDir));
  if (outNormal.lengthSq() < 1e-8) {
    outNormal.set(0, 1, 0).addScaledVector(_limbDir, -_limbDir.y);
  }
  outNormal.normalize().cross(_limbDir).normalize();
}

/**
 * Analytic two-bone IK: returns the middle joint position for a chain root -> mid -> end with lengths l1, l2
 * reaching toward `target`, bending toward `pole`.
 */
export function solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, outMid: THREE.Vector3, outEnd: THREE.Vector3): void {
  const dir = _a.subVectors(target, root);
  let d = dir.length();
  const maxReach = (l1 + l2) * 0.999;
  const minReach = Math.abs(l1 - l2) * 1.001 + 1e-4;
  d = THREE.MathUtils.clamp(d, minReach, maxReach);
  dir.normalize();
  outEnd.copy(root).addScaledVector(dir, d);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const a = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
  // Bend plane: component of the pole direction orthogonal to the chain axis.
  const bend = _b.subVectors(pole, root);
  bend.addScaledVector(dir, -bend.dot(dir));
  if (bend.lengthSq() < 1e-8) {
    bend.set(0, 1, 0).addScaledVector(dir, -dir.y);
  }
  bend.normalize();
  outMid.copy(root).addScaledVector(dir, Math.cos(a) * l1).addScaledVector(bend, Math.sin(a) * l1);
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Critically-damped-ish spring integrator for a scalar. */
export class Spring {
  value = 0;
  velocity = 0;
  constructor(
    public stiffness: number,
    public damping: number,
  ) {}
  step(target: number, dt: number): number {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const acc = this.stiffness * (target - this.value) - this.damping * this.velocity;
      this.velocity += acc * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  reset(v: number): void {
    this.value = v;
    this.velocity = 0;
  }
}
