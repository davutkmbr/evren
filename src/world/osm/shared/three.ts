/** Main-thread helpers turning worker output (MeshArrays, instance records) into three.js objects. */
import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import type { MeshArrays } from './protocol';

export function toGeometry(m: MeshArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(m.attributes)) {
    g.setAttribute(name, new THREE.BufferAttribute(a.array, a.size, a.normalized ?? false));
  }
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  return g;
}

export interface MeshOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** RenderLayers value (default: Default, i.e. also seen by the water reflection). */
  layer?: number;
}

/** Adds a static mesh built from worker arrays to `group`; returns null for missing / empty arrays. */
export function addMesh(group: THREE.Object3D, name: string, m: MeshArrays | undefined, material: THREE.Material, opt: MeshOptions = {}): THREE.Mesh | null {
  if (!m || m.index.length === 0) {
    return null;
  }
  const mesh = new THREE.Mesh(toGeometry(m), material);
  mesh.name = name;
  mesh.castShadow = opt.castShadow ?? false;
  mesh.receiveShadow = opt.receiveShadow ?? true;
  mesh.matrixAutoUpdate = false;
  mesh.layers.set(opt.layer ?? RenderLayers.Default);
  group.add(mesh);
  return mesh;
}

/** Disposes the geometries of every mesh under `root` and detaches it (materials belong to their layer). */
export function disposeGeometries(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh as THREE.InstancedMesh).dispose?.();
    }
  });
  root.removeFromParent();
}

/** Triangle count of the visible meshes under `root` (draw ranges honoured, instanced meshes counted per instance). */
export function countTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const per = Math.min(mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count, mesh.geometry.drawRange.count) / 3;
      tris += per * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
    }
  });
  return Math.round(tris);
}
