/**
 * Foliage material of the details trees: alpha-tested atlas cards (trees/atlas.ts) with vertex-coloured bark and
 * crown occlusion, per-instance tint, two-sided cards that keep their bent crown normals on both faces, and a gentle
 * wind sway that grows with height.
 */
import * as THREE from 'three';
import { patchMaterial } from '../../../../core/uniforms';

export function createTreeMaterial(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  // Not cut by the street layer's hole mask: the compiled tiles bring few trees (OSM-mapped ones only), so the
  // street layer keeps these and leaves its own out (src/world/street).
  const m = new THREE.MeshStandardMaterial({
    name: 'osm-tree',
    map: atlas,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
  });
  patchMaterial(m, 'osm-tree-v2', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uWind;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
{
#ifdef USE_INSTANCING
  vec3 tPos = instanceMatrix[3].xyz;
#else
  vec3 tPos = vec3(0.0);
#endif
  float ph = dot(tPos.xz, vec2(0.013, 0.021)) * 6.2831;
  float h = max(0.0, transformed.y);
  float wind = clamp(length(uWind.xz) * 0.12, 0.15, 1.2);
  vec2 wd = normalize(uWind.xz + vec2(0.001, 0.0));
  float gust = 0.55 + 0.45 * sin(uTime * 0.37 + ph);
  transformed.xz += wd * h * h * 0.0016 * wind * gust * (0.7 + 0.3 * sin(uTime * 1.4 + ph));
  float leaf = smoothstep(2.0, 5.0, h);
  transformed += leaf * 0.05 * wind * vec3(sin(uTime * 3.3 + position.y * 1.9 + ph), 0.5 * sin(uTime * 2.9 + position.x * 2.3), cos(uTime * 3.1 + position.z * 1.7 + ph));
}`,
      );
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);');
  });
  return m;
}
