import * as THREE from 'three';
import type { GeomData } from '../gen/types';

/**
 * Wraps generator output into a BufferGeometry. Layout (36 B / vertex): position f32x3, normal i8x4 (normalized),
 * uv f32x2 (meters), aTint u8x4 (sRGB tint + AO), aData u16x4 (material, light height, light code, seed).
 */
export function toBufferGeometry(g: GeomData, forceUint32Index = false): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 4, true));
  geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
  geo.setAttribute('aTint', new THREE.BufferAttribute(g.tint, 4, true));
  geo.setAttribute('aData', new THREE.BufferAttribute(g.data, 4, false));
  const vertexCount = g.position.length / 3;
  const index = !forceUint32Index && vertexCount < 65536 ? new Uint16Array(g.index) : g.index;
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  const b = g.bounds;
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(b[6], b[7], b[8]), b[9]);
  return geo;
}

export function vertexCountOf(g: GeomData): number {
  return g.position.length / 3;
}
