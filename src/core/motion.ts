import type * as THREE from 'three';

/**
 * Objects whose motion the temporal antialiasing must know (phase 25, stage 2): the renderer draws the meshes under
 * each root once more into a velocity target (post/velocity.ts), with their previous world and bone matrices. The
 * static world needs nothing here: TAA reprojects it through the depth and the camera. Add only what moves on its own
 * and is large on screen (the dragon and its rider); the return value removes the root again.
 */
export const motionRoots = new Set<THREE.Object3D>();

export function trackMotion(root: THREE.Object3D): () => void {
  motionRoots.add(root);
  return () => {
    motionRoots.delete(root);
  };
}
