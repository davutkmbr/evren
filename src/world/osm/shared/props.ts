/**
 * Helpers for low-poly instanced prop geometries (unit scale, base at y = 0, "front" along local +X): each part gets
 * a flat vertex colour and an `aGlow` attribute (1 marks emissive glass), then parts are merged into one geometry.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Non-indexed copy of `g` with a flat vertex colour and glow value, UVs removed (mergeable with other parts). */
export function part(g: THREE.BufferGeometry, color: number, glow = 0): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.getAttribute('position').count;
  const c = new THREE.Color(color);
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  geo.deleteAttribute('uv');
  return geo;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) {
    throw new Error('[osm] prop merge failed');
  }
  g.computeBoundingSphere();
  return g;
}
