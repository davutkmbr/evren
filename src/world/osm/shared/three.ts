/** Main-thread helpers turning worker output (MeshArrays, instance records) into three.js objects. */
import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import { INSTANCE_STRIDE, type MeshArrays } from './protocol';

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

/**
 * Adds an InstancedMesh for INSTANCE_STRIDE records (x, y, z, yaw, horizontal scale, vertical scale, r, g, b) and
 * takes ownership of `geometry` (disposed right away when there are no records). Defaults to the NoReflection layer.
 */
export function addInstanced(group: THREE.Object3D, name: string, records: Float32Array | undefined, geometry: THREE.BufferGeometry, material: THREE.Material, opt: MeshOptions = {}): THREE.InstancedMesh | null {
  const n = records ? records.length / INSTANCE_STRIDE : 0;
  if (!records || !n) {
    geometry.dispose();
    return null;
  }
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_STRIDE;
    p.set(records[o], records[o + 1], records[o + 2]);
    q.setFromAxisAngle(up, records[o + 3]);
    s.set(records[o + 4], records[o + 5], records[o + 4]);
    mesh.setMatrixAt(i, m4.compose(p, q, s));
    mesh.setColorAt(i, c.setRGB(records[o + 6], records[o + 7], records[o + 8]));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = name;
  mesh.castShadow = opt.castShadow ?? false;
  mesh.receiveShadow = opt.receiveShadow ?? true;
  mesh.layers.set(opt.layer ?? RenderLayers.NoReflection);
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

/** Triangle count of everything under `root` (instanced meshes counted per instance). */
export function countTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const per = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
      tris += per * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
    }
  });
  return Math.round(tris);
}
