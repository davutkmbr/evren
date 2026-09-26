import * as THREE from 'three';
import type { RiderAppearance } from '../appearance';
import type { Proportions, RiderSkeletonLayout } from '../skeleton';
import type { Sculpt, V3 } from '../sdf/sculpt';
import { Frame } from '../skeleton';

/** Layer indices of the rider sculpt (see buildRiderSculpt). */
export interface RiderLayers {
  skin: number;
  under: number;
  loose: number;
  tunic: number;
  outer: number;
  boots: number;
  gloves: number;
  hair: number;
  beard: number;
  headwear: number;
  gear: number;
}

export interface SculptContext {
  sc: Sculpt;
  L: RiderLayers;
  lay: RiderSkeletonLayout;
  a: RiderAppearance;
  P: Proportions;
  id(name: string): number;
}

export const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Frame along a limb segment a -> b (y along), z toward `front`. */
export function limbFrame(a: THREE.Vector3, b: THREE.Vector3, front: V3): Frame {
  return Frame.fromYZ(a, b.clone().sub(a), new THREE.Vector3(front.x, front.y, front.z));
}

/** Basis of a frame (for oriented primitives). */
export function basis(f: Frame): { x: V3; y: V3; z: V3 } {
  return { x: f.x, y: f.y, z: f.z };
}

/** Frame rotated about its own axes by Euler angles (rad): yaw about y, pitch about x, roll about z. */
export function rotated(f: Frame, pitch: number, yaw: number, roll: number, origin?: THREE.Vector3): Frame {
  const m = new THREE.Matrix4().makeBasis(f.x, f.y, f.z);
  const r = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  m.multiply(r);
  const x = new THREE.Vector3();
  const y = new THREE.Vector3();
  const z = new THREE.Vector3();
  m.extractBasis(x, y, z);
  return new Frame((origin ?? f.o).clone(), x, y, z);
}

export const lerp = THREE.MathUtils.lerp;
