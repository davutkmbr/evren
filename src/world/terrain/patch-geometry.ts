import * as THREE from 'three';
import { PATCH_STRIDE } from './quadtree';

/** Grid attributes shared by every tier's instanced geometry. */
export interface PatchGrid {
  position: THREE.BufferAttribute;
  normal: THREE.BufferAttribute;
  index: THREE.BufferAttribute;
  quads: number;
}

/**
 * Shared patch grid: (quads + 1)² vertices whose position.xz holds integer grid coordinates (0..quads); the vertex
 * shader scales them by the per-instance patch size. Diagonals all run the same way so that collapsing odd vertices
 * onto their even (-x/-z) neighbours yields exactly the next coarser grid (CDLOD morph).
 */
export function createPatchGrid(quads: number): PatchGrid {
  const n = quads + 1;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      positions[k] = i;
      positions[k + 2] = j;
      normals[k + 1] = 1;
    }
  }
  const indices = new Uint16Array(quads * quads * 6);
  let o = 0;
  for (let j = 0; j < quads; j++) {
    for (let i = 0; i < quads; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Counter-clockwise seen from +Y (x east, z south): a -> c -> d and a -> d -> b.
      indices[o++] = a;
      indices[o++] = c;
      indices[o++] = d;
      indices[o++] = a;
      indices[o++] = d;
      indices[o++] = b;
    }
  }
  return {
    position: new THREE.BufferAttribute(positions, 3),
    normal: new THREE.BufferAttribute(normals, 3),
    index: new THREE.BufferAttribute(indices, 1),
    quads,
  };
}

/** One instanced draw over the shared grid; `patches` holds PATCH_STRIDE floats per instance. */
export function createPatchGeometry(grid: PatchGrid, maxPatches: number): { geometry: THREE.InstancedBufferGeometry; patches: THREE.InstancedBufferAttribute } {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', grid.position);
  geometry.setAttribute('normal', grid.normal);
  geometry.setIndex(grid.index);
  const patches = new THREE.InstancedBufferAttribute(new Float32Array(maxPatches * PATCH_STRIDE), PATCH_STRIDE);
  patches.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aPatch', patches);
  geometry.instanceCount = 0;
  // Culling is done per patch on the CPU; the mesh itself is never frustum culled.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-1e7, -1e4, -1e7), new THREE.Vector3(1e7, 1e4, 1e7));
  return { geometry, patches };
}
