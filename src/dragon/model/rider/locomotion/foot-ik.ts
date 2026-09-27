/**
 * Feet on uneven ground: after the clips, each planted foot is lifted or lowered onto the ground under it (two-bone IK
 * on the leg, knee kept in its plane), the pelvis drops by the lowest foot's need so the other leg can reach, and the
 * feet tilt to the slope. The clips are authored on flat ground (sole at the character's origin height), so a foot's
 * offset is the ground height under it minus the height under the character; offsets are eased so steps do not pop.
 */
import * as THREE from 'three';
import type { HumanRider } from '../human';

interface Leg {
  upper: THREE.Bone;
  lower: THREE.Bone;
  foot: THREE.Bone;
  l1: number;
  l2: number;
  offset: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** Rotates `bone` (in world terms, about its head) so its child's head moves toward `to`. */
function aim(bone: THREE.Bone, child: THREE.Bone, to: THREE.Vector3): void {
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  _d1.subVectors(_b, _a).normalize();
  _d2.subVectors(to, _a).normalize();
  _q.setFromUnitVectors(_d1, _d2);
  bone.parent!.getWorldQuaternion(_pq);
  // local' = P⁻¹ · R · P · local
  bone.quaternion.premultiply(_pq).premultiply(_q).premultiply(_pq.invert());
  bone.updateMatrixWorld(true);
}

export class FootIK {
  private readonly legs: Leg[] = [];
  private readonly hips?: THREE.Bone;
  private pelvisDrop = 0;
  /** Feet are placed only while this is 1 (the controller fades it for air, gliding, the skid). */
  weight = 1;

  constructor(human: HumanRider) {
    for (const s of ['Left', 'Right']) {
      const upper = human.bones.get(`${s}UpLeg`);
      const lower = human.bones.get(`${s}Leg`);
      const foot = human.bones.get(`${s}Foot`);
      if (!upper || !lower || !foot) {
        continue;
      }
      upper.updateMatrixWorld(true);
      upper.getWorldPosition(_a);
      lower.getWorldPosition(_b);
      foot.getWorldPosition(_c);
      this.legs.push({ upper, lower, foot, l1: _a.distanceTo(_b), l2: _b.distanceTo(_c), offset: 0 });
    }
    this.hips = human.bones.get('Hips');
  }

  /** `root` = the character's origin (feet level on flat ground); `ground(x, z)` = terrain height. */
  apply(root: THREE.Object3D, ground: (x: number, z: number) => number, dt: number): void {
    if (this.legs.length === 0 || !this.hips) {
      return;
    }
    const k = 1 - Math.exp(-14 * dt);
    const base = root.position.y;
    root.updateMatrixWorld(true);
    let lowest = 0;
    for (const l of this.legs) {
      l.foot.getWorldPosition(_t);
      const want = (ground(_t.x, _t.z) - base) * this.weight;
      l.offset += (want - l.offset) * k;
      lowest = Math.min(lowest, l.offset);
    }
    // The pelvis sinks for the lower foot (it cannot stretch the leg), eased.
    this.pelvisDrop += (lowest - this.pelvisDrop) * k;
    if (Math.abs(this.pelvisDrop) > 1e-4) {
      this.hips.getWorldPosition(_a).y += this.pelvisDrop;
      this.hips.parent!.worldToLocal(_a);
      this.hips.position.copy(_a);
      this.hips.updateMatrixWorld(true);
    }
    for (const l of this.legs) {
      if (Math.abs(l.offset) < 1e-4 && Math.abs(this.pelvisDrop) < 1e-4) {
        continue;
      }
      l.foot.getWorldPosition(_t);
      l.foot.getWorldQuaternion(_q);
      const footRot = _q.clone();
      _t.y += l.offset - 0; // the ankle follows the ground under it
      l.upper.getWorldPosition(_a);
      l.lower.getWorldPosition(_b);
      // Knee plane: keep the clip's knee direction.
      _n.subVectors(_b, _a);
      const reach = l.l1 + l.l2;
      _d1.subVectors(_t, _a);
      const dist = THREE.MathUtils.clamp(_d1.length(), Math.abs(l.l1 - l.l2) + 1e-4, reach * 0.999);
      _d1.normalize();
      _n.addScaledVector(_d1, -_n.dot(_d1)).normalize();
      const cosA = (l.l1 * l.l1 + dist * dist - l.l2 * l.l2) / (2 * l.l1 * dist);
      const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
      _c.copy(_a).addScaledVector(_d1, cosA * l.l1).addScaledVector(_n, sinA * l.l1);
      const end = _a.clone().addScaledVector(_d1, dist);
      aim(l.upper, l.lower, _c);
      aim(l.lower, l.foot, end);
      // Foot: back to its clip orientation in the world, tilted to the slope under it.
      const e = 0.12;
      const gx = (ground(end.x + e, end.z) - ground(end.x - e, end.z)) / (2 * e);
      const gz = (ground(end.x, end.z + e) - ground(end.x, end.z - e)) / (2 * e);
      _n.set(-gx, 1, -gz).normalize();
      const tilt = new THREE.Quaternion().setFromUnitVectors(_up, _n);
      const slerpTilt = new THREE.Quaternion().slerp(tilt, this.weight);
      l.foot.parent!.getWorldQuaternion(_pq);
      l.foot.quaternion.copy(_pq.invert().multiply(slerpTilt).multiply(footRot));
      l.foot.updateMatrixWorld(true);
    }
  }
}
