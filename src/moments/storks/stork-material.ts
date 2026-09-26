import * as THREE from 'three';
import { patchMaterial } from '../../core/uniforms';
import { FINGER_MID, REGION, WING } from './stork-model';

/**
 * Instanced white-stork material: the wing pose (flap, soaring / gliding flex, finger fan and tip curl, idle flutter) in
 * the vertex shader, the plumage by region in the fragment shader. The pose maths mirror `storkJoints` and
 * `deformStorkVertex` in ./stork-model.ts (the headless pose sheet renders those): keep both in sync.
 *
 * No plastic look: off-white plumage with a per-bird brightness and warmth variation, fine feather striation on the
 * flight feathers and a jagged covert edge, soft body feathering with a slightly greyer, dirtier belly, high roughness
 * on the white plumage and a little less on the black flight feathers,
 * a slightly glossy bill; juveniles (about a third of autumn migrants) are duller.
 */

function replaceOnce(src: string, search: string, replacement: string): string {
  if (!src.includes(search)) {
    console.warn(`[storks] shader chunk "${search}" not found`);
    return src;
  }
  return src.replace(search, replacement);
}

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

const VERTEX_PARS = /* glsl */ `
uniform float uTime;
attribute vec4 aWing;
attribute vec4 aFinger;
attribute vec4 aPose;
varying float vRegion;
varying float vSpan;
varying float vChord;
varying float vTint;
varying float vFingerT;
varying vec3 vStLocal;
float stTh1;
float stTh2;
float stSweepArm;
float stSweepHand;
float stSpread;
float stCurl;
float stBob;
float stW;
vec2 stRot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}
`;

const VERTEX_NORMAL = /* glsl */ `
  {
    float ph = aPose.x;
    float amp = aPose.y;
    float flex = aPose.z;
    float sn = sin(ph);
    float up = 0.5 - 0.5 * sn;
    float idle = 1.0 - amp;
    stTh1 = mix(0.075, 0.02, flex) + amp * 0.62 * sn + 0.022 * idle * sin(uTime * 1.7 + aPose.w * 37.0);
    stTh2 = mix(-0.02, -0.13, flex) + amp * 0.36 * sin(ph - 0.75);
    stSweepArm = 0.1 * flex + amp * 0.12 * up;
    stSweepHand = 0.4 * flex + amp * 0.32 * up;
    stSpread = 1.0 - 0.72 * max(flex, amp * 0.55 * up);
    stCurl = mix(1.0, 0.35, flex) + amp * 0.7 * sn + 0.14 * sin(uTime * 2.3 + aPose.w * 53.0);
    stBob = -0.035 * amp * sin(ph + 1.2);
    stW = smoothstep(${f(WING.wristS - WING.wristBlend)}, ${f(WING.wristS + WING.wristBlend)}, aWing.y);
  }
  vec3 objectNormal = vec3( normal );
  if (aWing.z > ${f(REGION.arm - 0.5)}) {
    float a = mix(stTh1, stTh1 + stTh2, stW);
    objectNormal = vec3(-aWing.x * sin(a), cos(a), 0.0);
  }
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
  #endif
`;

const VERTEX_BEGIN = /* glsl */ `
  vec3 transformed = vec3( position );
  if (aWing.z > ${f(REGION.arm - 0.5)}) {
    float s = aWing.y;
    float zr = position.z;
    float yr = position.y;
    if (aWing.z > ${f(REGION.finger - 0.5)}) {
      float delta = -(1.0 - stSpread) * (aFinger.x - ${f(FINGER_MID)});
      vec2 q = stRot(vec2(s - aFinger.y, zr - aFinger.z), delta);
      s = aFinger.y + q.x;
      zr = aFinger.z + q.y;
      yr += stCurl * aFinger.w * aFinger.w * 0.85;
    }
    vec2 armP = stRot(vec2(s, zr - ${f(WING.shoulderZ)}), stSweepArm);
    vec2 armY = stRot(vec2(armP.x, yr), stTh1);
    vec3 arm = vec3(${f(WING.shoulderX)} + armY.x, armY.y, ${f(WING.shoulderZ)} + armP.y);
    vec2 wP = stRot(vec2(${f(WING.wristS)}, ${f(WING.wristZ - WING.shoulderZ)}), stSweepArm);
    vec2 wY = stRot(vec2(wP.x, 0.0), stTh1);
    vec2 hP = stRot(vec2(s - ${f(WING.wristS)}, zr - ${f(WING.wristZ)}), stSweepArm + stSweepHand);
    vec2 hY = stRot(vec2(hP.x, yr), stTh1 + stTh2);
    vec3 hand = vec3(${f(WING.shoulderX)} + wY.x + hY.x, wY.y + hY.y, ${f(WING.shoulderZ)} + wP.y + hP.y);
    transformed = mix(arm, hand, stW);
    transformed.x *= aWing.x;
  }
  if (aWing.z > ${f(REGION.head - 0.5)} && aWing.z < ${f(REGION.bill + 0.5)}) {
    transformed.y -= stBob * 0.5;
  }
  transformed.y += stBob;
  vRegion = aWing.z;
  vSpan = aWing.y;
  vChord = aWing.w;
  vTint = aPose.w;
  vFingerT = aFinger.w;
  vStLocal = position;
`;

const FRAGMENT_PARS = /* glsl */ `
varying float vRegion;
varying float vSpan;
varying float vChord;
varying float vTint;
varying float vFingerT;
varying vec3 vStLocal;
float stRough;
`;

const FRAGMENT_COLOR = /* glsl */ `
  {
    float region = floor(vRegion + 0.5);
    bool juvenile = vTint < 0.3;
    float v = 0.94 + 0.12 * fract(vTint * 7.31);
    float warm = fract(vTint * 3.17) - 0.5;
    vec3 white = (juvenile ? vec3(0.68, 0.66, 0.62) : vec3(0.76, 0.75, 0.71)) * v + vec3(0.02, 0.01, -0.012) * warm;
    vec3 black = juvenile ? vec3(0.05, 0.04, 0.034) : vec3(0.022, 0.022, 0.026);
    vec3 c = white;
    stRough = 0.86;
    // Soft feathering: the body and coverts are never one flat colour.
    float fluff = 0.96 + 0.04 * sin(vSpan * 91.0 + vChord * 13.0) * sin(vChord * 37.0 + vSpan * 11.0);
    if (region == ${f(REGION.bill)}) {
      c = juvenile ? vec3(0.26, 0.07, 0.04) : vec3(0.62, 0.07, 0.035);
      stRough = 0.42;
    } else if (region == ${f(REGION.legs)}) {
      c = juvenile ? vec3(0.42, 0.18, 0.11) : vec3(0.66, 0.13, 0.06);
      stRough = 0.6;
    } else if (region >= ${f(REGION.arm)}) {
      float edge = 0.47 + 0.05 * fract(vSpan * 26.0) + 0.04 * min(1.0, vSpan / ${f(WING.wristS)});
      // Both wings are wound with the upper side as the front face.
      if (gl_FrontFacing) edge -= 0.06;
      float isBlack = region > ${f(REGION.arm + 0.5)} ? 1.0 : smoothstep(edge - 0.015, edge + 0.015, vChord);
      // Flight-feather striation: individual feathers along the span, darker shafts, lighter worn tips.
      float feather = 0.9 + 0.1 * smoothstep(0.1, 0.9, abs(fract(vSpan * 34.0) * 2.0 - 1.0));
      float tip = region > ${f(REGION.hand + 0.5)} ? 1.0 + 0.35 * smoothstep(0.12, 0.26, vFingerT) : 1.0;
      c = mix(white * fluff, black * feather * tip, isBlack);
      stRough = mix(0.86, 0.62, isBlack);
    } else {
      // Body, neck, head, tail: soft feathering and a slightly greyer, dirtier belly.
      float soft = 0.95 + 0.05 * sin(vStLocal.z * 140.0 + 2.0 * sin(vStLocal.x * 90.0)) * sin(vStLocal.y * 120.0 + vStLocal.z * 30.0);
      c *= soft * mix(0.9, 1.0, smoothstep(-0.07, 0.04, vStLocal.y));
    }
    diffuseColor.rgb = c;
  }
`;

/** Instanced stork material (MeshStandardMaterial with the pose and plumage patched in). */
export function createStorkMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0, side: THREE.DoubleSide });
  m.name = 'moment-storks';
  patchMaterial(m, 'moment-storks-v1', (shader) => {
    let vs = shader.vertexShader;
    vs = replaceOnce(vs, '#include <common>', `#include <common>\n${VERTEX_PARS}`);
    vs = replaceOnce(vs, '#include <beginnormal_vertex>', VERTEX_NORMAL);
    vs = replaceOnce(vs, '#include <begin_vertex>', VERTEX_BEGIN);
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = replaceOnce(fs, '#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${FRAGMENT_PARS}`);
    fs = replaceOnce(fs, '#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`);
    fs = replaceOnce(fs, '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  roughnessFactor = stRough;`);
    shader.fragmentShader = fs;
  });
  return m;
}
