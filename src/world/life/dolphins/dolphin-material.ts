import * as THREE from 'three';
import { patchMaterial } from '../../../core/uniforms';

/**
 * Instanced dolphin material: the tail beat bends the rear half of the body up and down in the vertex shader (the
 * flukes follow), the colouring comes from the body coordinates (./dolphin-model.ts `aBody`) in the fragment shader.
 *
 * Per instance `aPose` = (tail beat phase, beat amplitude 0..1, tint, unused). Tint < 0.5: short-beaked common dolphin
 * (dark cape dipping to a V under the dorsal fin, the tan-yellow front flank and the pale grey rear flank of the
 * hourglass, cream belly); tint >= 0.5: bottlenose (grey back, lighter flanks, pale belly). Wet skin: fairly glossy.
 */

function replaceOnce(src: string, search: string, replacement: string): string {
  if (!src.includes(search)) {
    console.warn(`[dolphins] shader chunk "${search}" not found`);
    return src;
  }
  return src.replace(search, replacement);
}

const VERTEX_PARS = /* glsl */ `
attribute vec3 aBody;
attribute vec4 aPose;
varying vec3 vBody;
varying float vTint;
float dlBend(float t) {
  float k = max(0.0, (t - 0.45) / 0.55);
  return aPose.y * 0.075 * k * k * sin(aPose.x - k * 2.2);
}
`;

const VERTEX_NORMAL = /* glsl */ `
  vec3 objectNormal = vec3( normal );
  {
    // Tilt the normal with the bend's slope along the body.
    float t = aBody.x;
    float slope = (dlBend(t + 0.02) - dlBend(t - 0.02)) / 0.04;
    objectNormal = normalize(objectNormal + vec3(0.0, 0.0, -slope * objectNormal.y));
  }
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
  #endif
`;

const VERTEX_BEGIN = /* glsl */ `
  vec3 transformed = vec3( position );
  transformed.y += dlBend(aBody.x);
  vBody = aBody;
  vTint = aPose.z;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vBody;
varying float vTint;
`;

const FRAGMENT_COLOR = /* glsl */ `
  {
    float t = vBody.x;
    float region = floor(vBody.y + 0.5);
    float v = vBody.z;
    float shade = 0.94 + 0.12 * fract(vTint * 13.7);
    vec3 c;
    if (vTint < 0.5) {
      vec3 cape = vec3(0.035, 0.04, 0.05);
      vec3 tan = vec3(0.55, 0.43, 0.24);
      vec3 grey = vec3(0.36, 0.38, 0.41);
      vec3 belly = vec3(0.74, 0.72, 0.67);
      // The cape comes down to a V under the dorsal fin.
      float capeLine = 0.35 - 0.45 * exp(-pow((t - 0.5) / 0.09, 2.0));
      float flankFront = smoothstep(0.1, 0.18, t) * (1.0 - smoothstep(0.44, 0.52, t));
      vec3 flank = mix(grey, tan, flankFront);
      float bellyLine = -0.45 + 0.15 * smoothstep(0.5, 0.8, t);
      c = mix(belly, flank, smoothstep(bellyLine - 0.08, bellyLine + 0.08, v));
      c = mix(c, cape, smoothstep(capeLine - 0.07, capeLine + 0.07, v));
      // Dark beak and eye stripe.
      c = mix(c, cape, (1.0 - smoothstep(0.05, 0.09, t)) * smoothstep(-0.6, -0.2, v));
    } else {
      vec3 back = vec3(0.2, 0.22, 0.25);
      vec3 side = vec3(0.4, 0.42, 0.45);
      vec3 belly = vec3(0.7, 0.71, 0.72);
      c = mix(side, back, smoothstep(0.15, 0.6, v));
      c = mix(belly, c, smoothstep(-0.65, -0.3, v));
    }
    if (region > 0.5) {
      // Fins: dark, the pectorals a little lighter.
      c = vTint < 0.5 ? vec3(0.04, 0.045, 0.055) : vec3(0.19, 0.21, 0.24);
      if (region > 1.5 && region < 2.5) c *= 1.4;
    }
    diffuseColor.rgb = c * shade;
  }
`;

/** Instanced dolphin material (MeshStandardMaterial with the tail beat and the colouring patched in). */
export function createDolphinMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0, side: THREE.DoubleSide });
  m.name = 'life-dolphins';
  patchMaterial(m, 'life-dolphins-v1', (shader) => {
    let vs = shader.vertexShader;
    vs = replaceOnce(vs, '#include <common>', `#include <common>\n${VERTEX_PARS}`);
    vs = replaceOnce(vs, '#include <beginnormal_vertex>', VERTEX_NORMAL);
    vs = replaceOnce(vs, '#include <begin_vertex>', VERTEX_BEGIN);
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = replaceOnce(fs, '#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${FRAGMENT_PARS}`);
    fs = replaceOnce(fs, '#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`);
    shader.fragmentShader = fs;
  });
  return m;
}
