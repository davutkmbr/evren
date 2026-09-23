import * as THREE from 'three';
import type { DragonRig, DragonState } from '../../core/contracts';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * World transforms of the rig's effect anchors. An anchor that is implausibly far from the dragon (not parented
 * yet, or a rig still being built) falls back to a position derived from the dragon transform and rig dimensions.
 */
export function mouthTransform(rig: DragonRig, dragon: DragonState | undefined, outPos: THREE.Vector3, outDir: THREE.Vector3): void {
  rig.mouth.updateWorldMatrix(true, false);
  const e = rig.mouth.matrixWorld.elements;
  outPos.set(e[12], e[13], e[14]);
  outDir.set(-e[8], -e[9], -e[10]);
  const len = outDir.length();
  if (dragon && (len < 1e-6 || outPos.distanceTo(dragon.position) > rig.dimensions.length * 1.2)) {
    basis(dragon);
    outPos.copy(dragon.position).addScaledVector(_fwd, rig.dimensions.length * 0.5).addScaledVector(_up, rig.dimensions.height * 0.3);
    outDir.copy(_fwd);
    return;
  }
  outDir.divideScalar(Math.max(len, 1e-6));
}

export function wingTipPosition(rig: DragonRig, dragon: DragonState | undefined, side: 0 | 1, out: THREE.Vector3): THREE.Vector3 {
  (side === 0 ? rig.wingTipLeft : rig.wingTipRight).getWorldPosition(out);
  if (dragon && out.distanceTo(dragon.position) > rig.dimensions.wingspan) {
    basis(dragon);
    out.copy(dragon.position).addScaledVector(_right, (side === 0 ? -0.5 : 0.5) * rig.dimensions.wingspan);
  }
  return out;
}

function basis(dragon: DragonState): void {
  _m.makeRotationFromQuaternion(dragon.quaternion);
  _right.setFromMatrixColumn(_m, 0);
  _up.setFromMatrixColumn(_m, 1);
  _fwd.setFromMatrixColumn(_m, 2).negate();
}
