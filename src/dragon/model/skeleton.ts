import * as THREE from 'three';
import type { BoneSpec } from './anatomy';

export interface RigSkeleton {
  skeleton: THREE.Skeleton;
  bones: THREE.Bone[];
  rootBone: THREE.Bone;
  index: Map<string, number>;
  /** Rest joint positions in rig space, by bone index. */
  restHeads: THREE.Vector3[];
  /** Rest local positions (relative to the parent), by bone index. */
  restLocal: THREE.Vector3[];
  bone(name: string): THREE.Bone;
  id(name: string): number;
}

/** Builds the bone hierarchy with identity rest rotations. Call bindRestPose() before binding meshes. */
export function buildSkeleton(specs: BoneSpec[]): RigSkeleton {
  const index = new Map<string, number>();
  const bones: THREE.Bone[] = [];
  const restHeads: THREE.Vector3[] = [];
  const restLocal: THREE.Vector3[] = [];
  const byName = new Map<string, BoneSpec>();
  for (const spec of specs) {
    byName.set(spec.name, spec);
  }
  for (const spec of specs) {
    const bone = new THREE.Bone();
    bone.name = spec.name;
    const parentSpec = spec.parent ? byName.get(spec.parent) : undefined;
    const local = spec.head.clone();
    if (parentSpec) {
      local.sub(parentSpec.head);
    }
    bone.position.copy(local);
    index.set(spec.name, bones.length);
    bones.push(bone);
    restHeads.push(spec.head.clone());
    restLocal.push(local.clone());
  }
  let rootBone: THREE.Bone | undefined;
  for (const spec of specs) {
    const bone = bones[index.get(spec.name)!];
    if (spec.parent) {
      bones[index.get(spec.parent)!].add(bone);
    } else {
      rootBone = bone;
    }
  }
  if (!rootBone) {
    throw new Error('dragon skeleton has no root bone');
  }
  rootBone.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const id = (name: string): number => {
    const i = index.get(name);
    if (i === undefined) {
      throw new Error(`unknown dragon bone ${name}`);
    }
    return i;
  };
  return {
    skeleton,
    bones,
    rootBone,
    index,
    restHeads,
    restLocal,
    bone: (name: string) => bones[id(name)],
    id,
  };
}
