import * as THREE from 'three';

/**
 * Camera-centred radial grid in the XZ plane (normal +Y, counter-clockwise from above). Rings grow geometrically so
 * every cell stays roughly square (radial spacing = arc length), i.e. the vertex spacing is ~2*pi/segments of the
 * distance to the camera everywhere. position.y carries the local vertex spacing (m) for displacement filtering.
 */
export function buildRadialGrid(segments: number, innerRadius: number, extent: number): THREE.BufferGeometry {
  const ratio = 1 + (2 * Math.PI) / segments;
  const radii: number[] = [];
  for (let r = innerRadius; ; r *= ratio) {
    radii.push(r);
    if (r > extent) {
      break;
    }
  }
  const rings = radii.length;
  const vertexCount = 1 + rings * segments;
  const positions = new Float32Array(vertexCount * 3);
  positions[1] = innerRadius * (ratio - 1);
  const cos = new Float64Array(segments);
  const sin = new Float64Array(segments);
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    cos[s] = Math.cos(a);
    sin[s] = Math.sin(a);
  }
  for (let n = 0; n < rings; n++) {
    const r = radii[n];
    const spacing = r * (ratio - 1);
    for (let s = 0; s < segments; s++) {
      const o = (1 + n * segments + s) * 3;
      positions[o] = r * cos[s];
      positions[o + 1] = spacing;
      positions[o + 2] = r * sin[s];
    }
  }

  const triCount = segments + (rings - 1) * segments * 2;
  const index = new Uint32Array(triCount * 3);
  let k = 0;
  const ringIndex = (n: number, s: number): number => 1 + n * segments + (s % segments);
  for (let s = 0; s < segments; s++) {
    index[k++] = 0;
    index[k++] = ringIndex(0, s + 1);
    index[k++] = ringIndex(0, s);
  }
  for (let n = 0; n < rings - 1; n++) {
    for (let s = 0; s < segments; s++) {
      const a = ringIndex(n, s);
      const b = ringIndex(n, s + 1);
      const c = ringIndex(n + 1, s);
      const d = ringIndex(n + 1, s + 1);
      index[k++] = a;
      index[k++] = d;
      index[k++] = c;
      index[k++] = a;
      index[k++] = b;
      index[k++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), extent * 1.5);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-extent, -50, -extent), new THREE.Vector3(extent, 50, extent));
  return geometry;
}
