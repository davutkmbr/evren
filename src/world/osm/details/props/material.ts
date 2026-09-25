/**
 * Materials of the merged static meshes: vertex-coloured props whose `aGlow` surfaces light up at night (ad panels,
 * kiosk windows, cart lamps), and the same for boats, which additionally rock around their own keel (`aPivot`).
 */
import * as THREE from 'three';
import { patchMaterial, streetHole } from '../../../../core/uniforms';

const GLOW_VERTEX = /* glsl */ `
attribute float aGlow;
varying float vGlow;
`;

const ROCK_VERTEX = /* glsl */ `
attribute vec4 aPivot;
uniform float uTime;
vec3 rockBoat(vec3 p, vec4 pv, out mat3 rot) {
  float t = uTime;
  float ph = pv.w;
  float roll = 0.045 * sin(t * 0.83 + ph) + 0.02 * sin(t * 1.91 + ph * 2.3);
  float pitch = 0.018 * sin(t * 0.61 + ph * 1.7);
  float heave = 0.12 * sin(t * 0.97 + ph * 0.7);
  float c = cos(pv.z), s = sin(pv.z);
  vec3 fwd = vec3(s, 0.0, c);
  vec3 side = vec3(c, 0.0, -s);
  mat3 toLocal = mat3(side.x, 0.0, fwd.x, 0.0, 1.0, 0.0, side.z, 0.0, fwd.z);
  mat3 toWorld = transpose(toLocal);
  float cr = cos(roll), sr = sin(roll), cp = cos(pitch), sp = sin(pitch);
  mat3 R = mat3(cr, sr, 0.0, -sr, cr, 0.0, 0.0, 0.0, 1.0) * mat3(1.0, 0.0, 0.0, 0.0, cp, sp, 0.0, -sp, cp);
  rot = toWorld * R * toLocal;
  vec3 o = vec3(pv.x, 0.0, pv.y);
  return o + rot * (p - o) + vec3(0.0, heave, 0.0);
}
`;

export function createPropMaterial(name: string, rocking = false): THREE.MeshStandardMaterial {
  // Moored boats float on the game's water, which the street tiles do not replace: they are never cut out.
  const plain = new THREE.MeshStandardMaterial({ name, vertexColors: true, roughness: 0.7, metalness: 0.05 });
  const m = rocking ? plain : streetHole(plain);
  patchMaterial(m, `osm-details-${name}-v1`, (shader) => {
    let vs = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLOW_VERTEX}${rocking ? ROCK_VERTEX : ''}`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGlow = aGlow;');
    if (rocking) {
      vs = vs
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nmat3 boatRot;\nvec3 boatPos = rockBoat(position, aPivot, boatRot);\nobjectNormal = boatRot * objectNormal;')
        .replace('#include <begin_vertex>', 'vec3 transformed = boatPos;');
    }
    shader.vertexShader = vs;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vGlow * mix(0.25, 5.0, smoothstep(0.05, 0.45, uNight));');
  });
  return m;
}
