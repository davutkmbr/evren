import * as THREE from 'three';
import { patchMaterial } from '../../../core/uniforms';

function replaceOnce(src: string, search: string, replacement: string): string {
  if (!src.includes(search)) {
    console.warn(`[life] bird shader chunk "${search}" not found`);
    return src;
  }
  return src.replace(search, replacement);
}

const VERTEX_PARS = /* glsl */ `
uniform float uTime;
attribute vec4 aWing;
attribute vec4 aFlap;
varying float vRegion;
varying float vSpan;
varying float vKind;
float birdTh1;
float birdTh2;
float birdPh;
`;

const VERTEX_NORMAL = /* glsl */ `
  birdPh = uTime * aFlap.y * 6.2832 + aFlap.x;
  float birdAmp = aFlap.z;
  // Flapping: shoulder stroke + lagging wrist; gliding: slight dihedral with drooped hands (gull "M").
  birdTh1 = mix(0.1, 0.05, birdAmp) + birdAmp * 0.8 * sin(birdPh);
  birdTh2 = mix(-0.24, 0.0, birdAmp) + birdAmp * 0.55 * sin(birdPh - 0.9);
  vec3 objectNormal = vec3( normal );
  if (aWing.z > 0.5) {
    float a = aWing.z > 1.5 ? birdTh1 + birdTh2 : birdTh1;
    objectNormal = vec3(-aWing.x * sin(a), cos(a), 0.0);
  }
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
  #endif
`;

const VERTEX_BEGIN = /* glsl */ `
  vec3 transformed = vec3( position );
  if (aWing.z > 0.5) {
    float rw = 0.28;
    float r1 = min(aWing.y, rw);
    vec2 wp = vec2(0.05 + r1 * cos(birdTh1), r1 * sin(birdTh1));
    if (aWing.z > 1.5) {
      float r2 = aWing.y - rw;
      wp += vec2(r2 * cos(birdTh1 + birdTh2), r2 * sin(birdTh1 + birdTh2));
    }
    transformed.x = aWing.x * wp.x;
    transformed.y = position.y + wp.y;
  }
  transformed.y -= 0.025 * aFlap.z * sin(birdPh + 1.3);
  vRegion = aWing.w;
  vSpan = aWing.y;
  vKind = aFlap.w;
`;

const FRAGMENT_PARS = /* glsl */ `
varying float vRegion;
varying float vSpan;
varying float vKind;
`;

const FRAGMENT_COLOR = /* glsl */ `
  {
    float region = floor(vRegion + 0.5);
    bool top = gl_FrontFacing;
    vec3 c;
    if (vKind < 0.5) {
      // Yellow-legged gull: white body, mid-grey mantle, black primaries with white mirrors.
      vec3 white = vec3(0.78, 0.79, 0.8);
      vec3 mantle = vec3(0.3, 0.33, 0.37);
      c = white;
      if (region > 1.5 && region < 3.5 && top) c = mantle;
      if (region > 2.5) {
        float tipK = smoothstep(0.42, 0.5, vSpan);
        c = mix(c, vec3(0.018), tipK * (top ? 1.0 : 0.85));
      }
      if (region > 0.5 && region < 1.5 && vSpan < 0.01) c = white;
      // Bill (region 5, moment gulls): yellow with the red gonys spot toward the tip.
      if (region > 4.5) c = vSpan > 0.5 ? vec3(0.62, 0.08, 0.05) : vec3(0.86, 0.66, 0.12);
    } else {
      // Rock dove: blue-grey, darker head, pale wings with dark bars; some white or chequered birds.
      float variant = fract(vKind * 7.13);
      vec3 body = vec3(0.2, 0.22, 0.27);
      vec3 head = vec3(0.09, 0.1, 0.12);
      vec3 wingC = top ? vec3(0.3, 0.32, 0.37) : vec3(0.45, 0.46, 0.48);
      if (variant > 0.85) { body = vec3(0.7); head = vec3(0.68); wingC = vec3(0.72); }
      else if (variant > 0.65) { body = vec3(0.17, 0.12, 0.1); wingC = top ? vec3(0.22, 0.16, 0.13) : vec3(0.35, 0.3, 0.27); }
      c = body;
      if (region > 0.5 && region < 1.5) c = head;
      if (region > 1.5) c = wingC;
      if (region > 1.5 && region < 2.5 && top && variant <= 0.85) c *= 0.55 + 0.45 * step(0.03, abs(vSpan - 0.18));
      if (region > 3.5) c = mix(body, head, 0.6);
    }
    diffuseColor.rgb = c;
  }
`;

/** Instanced bird material: wing flapping / gliding in the vertex shader, species plumage by region and facing. */
export function createBirdMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  m.name = 'life-birds';
  patchMaterial(m, 'life-birds-v1', (shader) => {
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
