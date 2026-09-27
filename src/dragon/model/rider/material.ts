/**
 * The rider's material: one MeshStandardMaterial patched per material id (aData.x), stylized: clean colour fields
 * from the appearance palette (uniforms, so recolouring needs no rebuild), soft baked occlusion from the sculpt
 * (aData.w <= 0), gentle painted variation, fabric weave and leather grain as normal detail, a warm skin scatter,
 * painted eyes with a sharp highlight, brows / lips / beard shadow from the paint channels. Also carries the cloak
 * flutter (aData.w = 1 outer / 2 inner layer, aExtra = drape offset) and the first-person hide.
 */
import * as THREE from 'three';
import { patchMaterial } from '../../../core/uniforms';
import { CLOTH_COLOURS, EYE_COLOURS, HAIR_COLOURS, LEATHER_TONES, SKIN_TONES, type RGB, type RiderAppearance } from './appearance';

export interface RiderMaterialUniforms {
  uAirspeed: THREE.IUniform<number>;
  uAirflow: THREE.IUniform<THREE.Vector3>;
  uFirstPerson: THREE.IUniform<number>;
  uHidePoint: THREE.IUniform<THREE.Vector3>;
  uSkin: THREE.IUniform<THREE.Color>;
  uEyeCol: THREE.IUniform<THREE.Color>;
  uHair: THREE.IUniform<THREE.Color>;
  uPrimary: THREE.IUniform<THREE.Color>;
  uSecondary: THREE.IUniform<THREE.Color>;
  uAccent: THREE.IUniform<THREE.Color>;
  uLeather: THREE.IUniform<THREE.Color>;
  uMetal: THREE.IUniform<THREE.Color>;
  uAge: THREE.IUniform<number>;
}

const VERTEX_PARS = /* glsl */ `
attribute vec4 aData;
attribute vec3 aExtra;
varying vec4 vRData;
varying vec3 vRExtra;
flat varying float vRMat;
varying vec3 vRPos;
uniform float uTime;
uniform float uAirspeed;
uniform vec3 uAirflow;
uniform float uFirstPerson;
uniform vec3 uHidePoint;
`;

const BEGIN_VERTEX = /* glsl */ `
#include <begin_vertex>
vRData = aData;
vRExtra = aExtra;
vRMat = aData.x;
vRPos = position;
if (aData.w > 0.5) {
  float t = aData.y;
  float stream = clamp((uAirspeed - 3.0) / 22.0, 0.0, 1.0);
  transformed += aExtra * (1.0 - stream);
  float speed = 5.0 + uAirspeed * 0.55;
  float ph = uTime * speed - t * 11.0 + position.x * 7.0;
  float amp = t * t * (0.015 + 0.075 * stream) + t * 0.01;
  vec3 n = normalize(normal) * (aData.w > 1.5 ? -1.0 : 1.0);
  transformed += n * (sin(ph) * 0.65 + sin(ph * 1.83 + 1.1) * 0.35) * amp;
  transformed.x += sin(ph * 0.7 + 2.3) * t * t * 0.035 * stream;
  transformed.x += uAirflow.x * t * t * (0.12 + 0.35 * stream);
  transformed.z += max(uAirflow.z, 0.0) * t * t * 0.1 * (1.0 - stream) * clamp(uAirspeed / 6.0, 0.0, 1.0);
}
`;

const HIDE_VERTEX = /* glsl */ `
if (uFirstPerson > 0.5 && aData.z > 0.5) {
  transformed = uHidePoint;
}
#include <skinning_vertex>
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec4 vRData;
varying vec3 vRExtra;
flat varying float vRMat;
varying vec3 vRPos;
uniform vec3 uSkin;
uniform vec3 uEyeCol;
uniform vec3 uHair;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uAccent;
uniform vec3 uLeather;
uniform vec3 uMetal;
uniform float uAge;
float rdHeight = 0.0;
float rdScatter = 0.0;
// Çintemani: three pearls over two waves, on a staggered grid (cell coordinates in 0..1).
float rdCintemani(vec2 q) {
  vec2 id = floor(q);
  vec2 c = fract(q + vec2(mod(id.y, 2.0) * 0.5, 0.0)) - 0.5;
  float aa = fwidth(q.x) * 1.5;
  float d = min(min(length(c - vec2(-0.16, 0.14)), length(c - vec2(0.16, 0.14))), length(c - vec2(0.0, -0.1)));
  float pearls = 1.0 - smoothstep(0.1 - aa, 0.1 + aa, d);
  float w1 = abs(c.y + 0.3 - 0.05 * sin(c.x * 14.0)) - 0.025;
  float w2 = abs(c.y + 0.4 - 0.05 * sin(c.x * 14.0 + 0.6)) - 0.02;
  float waves = (1.0 - smoothstep(-aa, aa, min(w1, w2))) * (1.0 - smoothstep(0.3, 0.42, abs(c.x)));
  return max(pearls, waves) * (1.0 - smoothstep(0.35, 0.9, aa * 4.0));
}
vec3 rdPerturb(vec3 surfPos, vec3 n, float h) {
  vec3 dpdx = dFdx(surfPos);
  vec3 dpdy = dFdy(surfPos);
  float dhdx = dFdx(h);
  float dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n);
  vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - grad);
}
`;

/** Material ids: see materials-ids.ts (RM). */
const FRAGMENT_MATERIAL = /* glsl */ `
#include <color_fragment>
float rdMat = floor(vRMat + 0.5);
float rdRough = 0.8;
float rdMetal = 0.0;
float rdAO = vRData.w <= 0.0 ? clamp(-vRData.w, 0.0, 1.0) : 1.0;
{
  vec3 p = vRPos;
  float mid = vnoise3(p * 14.0) * 0.6 + vnoise3(p * 37.0) * 0.4;
  float fine = vnoise3(p * 190.0);
  vec2 wv = vec2(p.x + p.z, p.y) * 780.0;
  float weaveAA = 1.0 - smoothstep(0.6, 1.6, length(fwidth(wv)));
  float weave = (0.5 + 0.5 * sin(wv.x + wv.y) * sin(wv.x - wv.y * 0.5)) * weaveAA;
  vec3 c = vec3(0.5);
  if (rdMat < 0.5) {
    // Skin: warm base, redder where painted (cheeks, nose, ears), lips, brows and beard shadow from the channels.
    vec3 base = uSkin * (0.93 + 0.1 * mid);
    float blush = clamp(vRData.y, 0.0, 1.0);
    base = mix(base, base * vec3(1.08, 0.82, 0.78), blush * 0.55);
    float lip = clamp(vRExtra.x, 0.0, 1.0);
    base = mix(base, base * vec3(0.92, 0.62, 0.6), lip * 0.75);
    float brow = clamp(vRExtra.y, 0.0, 1.0);
    float strokes = 0.6 + 0.4 * vnoise3(vec3(p.x * 900.0, p.y * 260.0, p.z * 900.0));
    base = mix(base, uHair * 0.9, brow * strokes * 0.92);
    float beard = clamp(vRExtra.z, 0.0, 1.0);
    base = mix(base, mix(uHair, vec3(0.5), uAge * 0.35) * 0.8, beard * (0.35 + 0.35 * fine));
    c = base;
    rdRough = 0.72 - 0.12 * lip + 0.1 * beard;
    rdHeight = fine * 0.12 + beard * fine * 0.3;
    rdScatter = 1.0;
  } else if (rdMat < 1.5) {
    // Hair (stylized): broad clumps with soft sheen bands, darker deep in the volume, a hint of strand lines.
    float clumps = vnoise3(vec3(p.x * 45.0, p.y * 12.0, p.z * 45.0));
    float lines = vnoise3(vec3(p.x * 520.0, p.y * 70.0, p.z * 520.0));
    float linesAA = 1.0 - smoothstep(0.3, 1.2, length(fwidth(p * 520.0)));
    c = uHair * (0.88 + 0.2 * clumps) * (0.94 + 0.12 * (lines - 0.5) * linesAA);
    c = mix(c, vec3(0.62, 0.6, 0.58), uAge * 0.25 * smoothstep(0.6, 0.8, vnoise3(p * 140.0)));
    rdRough = 0.5 - 0.12 * clumps;
    rdHeight = clumps * 0.4 + lines * 0.25 * linesAA;
  } else if (rdMat < 2.5) {
    // Eye: sclera, iris (radial fibres, dark limbal ring), pupil. vRExtra = direction in the eye frame (z = gaze).
    vec3 d = normalize(vRExtra);
    float r = length(d.xy) * (d.z > 0.0 ? 1.0 : 2.0);
    float iris = 1.0 - smoothstep(0.6, 0.63, r);
    float pupil = 1.0 - smoothstep(0.25, 0.275, r);
    float ang = atan(d.y, d.x);
    float fibres = 0.75 + 0.25 * sin(ang * 38.0 + vnoise3(d * 12.0) * 6.0);
    vec3 ir = uEyeCol * fibres * mix(1.35, 0.7, smoothstep(0.28, 0.62, r));
    ir = mix(ir, ir * 0.25, smoothstep(0.52, 0.62, r));
    vec3 sclera = vec3(0.74, 0.7, 0.66) * (1.0 - 0.25 * smoothstep(0.65, 1.0, r));
    c = mix(sclera, ir, iris);
    c = mix(c, vec3(0.012), pupil);
    rdRough = 0.08;
  } else if (rdMat < 6.5 || (rdMat > 12.5 && rdMat < 14.5)) {
    // Cloth: primary / secondary / accent / linen / cloak / felt.
    vec3 col = rdMat < 3.5 ? uPrimary : rdMat < 4.5 ? uSecondary : rdMat < 5.5 ? uAccent : rdMat < 6.5 ? vec3(0.78, 0.74, 0.66) : rdMat < 13.5 ? uPrimary : uSecondary * 0.8 + vec3(0.03);
    float felt = rdMat > 13.5 ? 1.0 : 0.0;
    c = col * (0.84 + 0.2 * mid) * (0.94 + 0.08 * weave * (1.0 - felt));
    if (rdMat > 12.5 && rdMat < 13.5) {
      // Cloak: sun-faded toward the hem.
      c = mix(c, c * vec3(1.2, 1.25, 1.2) + vec3(0.02), smoothstep(0.35, 1.0, vRData.y) * 0.35);
    } else if (vRData.y > 0.01) {
      // Woven border (ch0 on cloth): accent ground with a gilt çintemani.
      float motif = rdCintemani(vec2(p.x + p.z, p.y) * 34.0);
      vec3 ground = uAccent * (0.85 + 0.2 * mid);
      c = mix(c, mix(ground, uMetal * 0.9 + vec3(0.05), motif), clamp(vRData.y * 4.0, 0.0, 1.0));
    } else if (rdMat < 3.5) {
      // Primary cloth: a faint tone-on-tone çintemani damask.
      c *= 1.0 - 0.14 * rdCintemani(vec2(p.x + p.z, p.y) * 11.0);
    }
    rdRough = 0.88;
    rdHeight = weave * 0.2 + fine * (0.2 + 0.3 * felt);
  } else if (rdMat < 8.5) {
    // Leather (7) / dark leather (8): pebbled grain, edges rubbed lighter.
    float grain = vnoise3(p * 240.0) * 0.6 + vnoise3(p * 520.0) * 0.4;
    vec3 base = rdMat < 7.5 ? uLeather : uLeather * 0.45;
    float curvature = length(fwidth(vNormal)) / max(length(fwidth(vViewPosition)), 1e-5);
    float wear = clamp(vRData.y * 0.7 + smoothstep(35.0, 140.0, curvature) * 0.55, 0.0, 1.0);
    c = base * (0.85 + 0.25 * mid) * (0.92 + 0.16 * grain);
    c = mix(c, c * 1.7 + vec3(0.012, 0.008, 0.004), wear * 0.5);
    rdRough = 0.6 - 0.18 * wear + 0.08 * grain;
    rdHeight = grain * 0.5 * (1.0 - 0.6 * wear);
  } else if (rdMat < 10.5) {
    // Iron (9) and the chosen metal (10): brushed, darker in the recesses.
    vec3 base = rdMat < 9.5 ? vec3(0.34, 0.34, 0.36) : uMetal;
    c = base * (0.8 + 0.3 * mid);
    rdMetal = 1.0;
    rdRough = 0.32 + 0.2 * mid;
    rdHeight = fine * 0.15;
  } else if (rdMat < 11.5) {
    // Fur trim: soft, clumpy, light tips.
    float tufts = vnoise3(p * 320.0);
    c = mix(vec3(0.07, 0.045, 0.03), vec3(0.3, 0.22, 0.15), tufts) * (0.85 + 0.3 * mid);
    rdRough = 0.95;
    rdHeight = tufts * 1.2;
  } else if (rdMat < 12.5) {
    // Goggle glass: smoked amber.
    c = vec3(0.03, 0.018, 0.008);
    rdRough = 0.06;
  } else if (rdMat < 15.5) {
    // Nail.
    c = uSkin * vec3(1.08, 0.92, 0.9) + vec3(0.05);
    rdRough = 0.3;
  } else if (rdMat > 16.5) {
    // Chain mail: staggered riveted rings, dark steel with bright ring tops.
    vec2 q = vec2(p.x + p.z, p.y) * 310.0;
    vec2 id = floor(q);
    vec2 cell = fract(q + vec2(mod(id.y, 2.0) * 0.5, 0.0)) - 0.5;
    float aa = fwidth(q.x);
    float ring = 1.0 - smoothstep(0.08 - aa, 0.08 + aa, abs(length(cell) - 0.33));
    float fade = 1.0 - smoothstep(0.3, 0.8, aa);
    c = mix(vec3(0.05, 0.05, 0.055), vec3(0.32, 0.32, 0.33), mix(0.35, ring, fade)) * (0.8 + 0.3 * mid);
    rdMetal = 1.0;
    rdRough = 0.45;
    rdHeight = ring * fade * 0.8;
  } else {
    // Mouth interior with a hint of upper teeth.
    float teeth = smoothstep(0.0, 1.0, vRExtra.x) * 0.0;
    c = mix(vec3(0.09, 0.03, 0.03), vec3(0.75, 0.72, 0.66), teeth);
    rdRough = 0.4;
  }
  // Painterly finish (not plastic): brush-stroke value variation, ink in the creases and under hems (baked
  // occlusion), light hatching in the half-occluded hollows, lighter worn convex edges.
  if (rdMat > 2.5 || rdMat < 1.5) {
    float stroke = vnoise3(vec3(p.x * 55.0 + p.y * 20.0, p.y * 18.0, p.z * 55.0 - p.y * 20.0));
    c *= 0.9 + 0.2 * stroke;
    float curv = length(fwidth(vNormal)) / max(length(fwidth(vViewPosition)), 1e-5);
    c = mix(c, c * 1.25 + vec3(0.01), smoothstep(60.0, 180.0, curv) * 0.35 * (rdMat < 0.5 ? 0.3 : 1.0));
    vec2 hv = vec2(p.x - p.z, p.y) * 260.0;
    float hatchAA = 1.0 - smoothstep(0.5, 1.4, length(fwidth(hv)));
    float hatch = smoothstep(0.35, 0.65, abs(fract(hv.x + hv.y) - 0.5) * 2.0) * hatchAA;
    float hollow = smoothstep(0.85, 0.5, rdAO);
    c *= 1.0 - 0.22 * hollow * hatch * (rdMat < 1.5 ? 0.0 : 1.0);
  }
  float ink = smoothstep(0.42, 0.15, rdAO) * (rdMat < 0.5 ? 0.6 : 1.0);
  c = mix(c * mix(0.45, 1.0, rdAO), vec3(0.035, 0.022, 0.016), ink * 0.85);
  diffuseColor.rgb = c;
}
`;

const OUTPUT_FRAGMENT = /* glsl */ `
// Warm scatter on skin (stylized subsurface): lifts the terminator and shadowed skin toward red.
outgoingLight += diffuseColor.rgb * vec3(0.55, 0.2, 0.12) * rdScatter * 0.12;
#include <opaque_fragment>
`;

function linear(rgb: RGB, out: THREE.Color): THREE.Color {
  return out.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
}

const METAL_COLOURS: Record<RiderAppearance['metal'], RGB> = {
  iron: [0.55, 0.56, 0.58],
  brass: [0.78, 0.6, 0.3],
  silver: [0.85, 0.85, 0.88],
};

export function createRiderMaterial(hidePoint: THREE.Vector3): { material: THREE.MeshStandardMaterial; depthMaterial: THREE.MeshDepthMaterial; uniforms: RiderMaterialUniforms } {
  const uniforms: RiderMaterialUniforms = {
    uAirspeed: { value: 0 },
    uAirflow: { value: new THREE.Vector3(0, 0, 1) },
    uFirstPerson: { value: 0 },
    uHidePoint: { value: hidePoint.clone() },
    uSkin: { value: new THREE.Color() },
    uEyeCol: { value: new THREE.Color() },
    uHair: { value: new THREE.Color() },
    uPrimary: { value: new THREE.Color() },
    uSecondary: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uLeather: { value: new THREE.Color() },
    uMetal: { value: new THREE.Color() },
    uAge: { value: 0 },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  patchMaterial(material, 'rider-v4', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', BEGIN_VERTEX)
      .replace('#include <skinning_vertex>', HIDE_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_MATERIAL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rdRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = rdMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = rdPerturb(-vViewPosition, normal, rdHeight * 0.0018);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= mix(0.45, 1.0, rdAO);\nreflectedLight.indirectSpecular *= mix(0.3, 1.0, rdAO) * (rdMetal > 0.5 || rdMat > 1.5 && rdMat < 2.5 ? 1.0 : 0.45);')
      .replace('#include <opaque_fragment>', OUTPUT_FRAGMENT);
  });
  const depthMaterial = new THREE.MeshDepthMaterial();
  patchMaterial(depthMaterial, 'rider-depth-v4', (shader) => {
    Object.assign(shader.uniforms, { uAirspeed: uniforms.uAirspeed, uAirflow: uniforms.uAirflow, uFirstPerson: uniforms.uFirstPerson, uHidePoint: uniforms.uHidePoint });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', BEGIN_VERTEX);
  });
  return { material, depthMaterial, uniforms };
}

/** Palette colours of an appearance into the uniforms (instant recolour). */
export function applyRiderColours(u: RiderMaterialUniforms, a: RiderAppearance): void {
  linear(SKIN_TONES[a.skin], u.uSkin.value);
  linear(EYE_COLOURS[a.eyes], u.uEyeCol.value);
  linear(HAIR_COLOURS[a.hairColour], u.uHair.value);
  linear(CLOTH_COLOURS[a.primary], u.uPrimary.value);
  linear(CLOTH_COLOURS[a.secondary], u.uSecondary.value);
  linear(CLOTH_COLOURS[a.accent], u.uAccent.value);
  linear(LEATHER_TONES[a.leather], u.uLeather.value);
  linear(METAL_COLOURS[a.metal], u.uMetal.value);
  u.uAge.value = a.age;
}

/**
 * Ink outline (inverted hull): the same skinned geometry drawn back faces only, pushed out along the normal by a
 * width that grows gently with distance (about 1-2 px), dark warm brown rather than black so it sits in the lit
 * scene. Follows the cloak flutter and the first-person hide like the main material.
 */
export function createRiderOutlineMaterial(u: RiderMaterialUniforms): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uAirspeed: u.uAirspeed,
      uAirflow: u.uAirflow,
      uFirstPerson: u.uFirstPerson,
      uHidePoint: u.uHidePoint,
      uInk: { value: new THREE.Color(0.05, 0.032, 0.022) },
      uWidth: { value: 0.0022 },
      uTime: { value: 0 },
      ...THREE.UniformsLib.fog,
    },
    side: THREE.BackSide,
    fog: true,
    vertexShader: /* glsl */ `
#include <common>
${VERTEX_PARS}
uniform float uWidth;
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  ${BEGIN_VERTEX}
  // Glass, eyes, the mouth interior and the thin cloak get no outline.
  float m = floor(aData.x + 0.5);
  float w = (m == 2.0 || m == 12.0 || m == 16.0 || aData.w > 0.5) ? 0.0 : 1.0;
  if (uFirstPerson > 0.5 && aData.z > 0.5) {
    transformed = uHidePoint;
    w = 0.0;
  }
  #include <skinning_vertex>
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  vec3 nView = normalize(normalMatrix * objectNormal);
  float dist = max(-mvPosition.z, 0.1);
  mvPosition.xyz += nView * w * clamp(uWidth * (0.6 + 0.12 * dist), uWidth * 0.6, uWidth * 4.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
#include <common>
uniform vec3 uInk;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(uInk, 1.0);
  #include <fog_fragment>
}`,
  });
  return mat;
}
