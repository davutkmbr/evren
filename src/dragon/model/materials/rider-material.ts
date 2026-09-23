import * as THREE from 'three';
import { patchMaterial } from '../../../core/uniforms';

export interface RiderUniforms {
  uAirspeed: THREE.IUniform<number>;
  /** Where the relative air goes, in rig space (unit). */
  uAirflow: THREE.IUniform<THREE.Vector3>;
  uFirstPerson: THREE.IUniform<number>;
  /** Bind-space point hidden vertices collapse to in first person. */
  uHidePoint: THREE.IUniform<THREE.Vector3>;
}

const VERTEX_PARS = /* glsl */ `
attribute vec4 aData;
attribute vec3 aExtra;
varying vec4 vRData;
flat varying float vRMat;
varying vec3 vRPos;
uniform float uTime;
uniform float uAirspeed;
uniform vec3 uAirflow;
uniform float uFirstPerson;
uniform vec3 uHidePoint;
`;

/**
 * Cloak (aData.w = 1 outer layer, 2 inner layer): blend streamed (rest) and draped shapes by airspeed, then add
 * travelling flutter waves along the outer-layer normal (the inner layer stores the flipped normal).
 */
const CLOAK_VERTEX = /* glsl */ `
#include <begin_vertex>
vRData = aData;
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
  // Stream with the relative wind (sideslip, or plain wind when hovering / on the ground).
  transformed.x += uAirflow.x * t * t * (0.12 + 0.35 * stream);
  transformed.z += max(uAirflow.z, 0.0) * t * t * 0.1 * (1.0 - stream) * clamp(uAirspeed / 6.0, 0.0, 1.0);
}
`;

/**
 * First person: vertices flagged in aData.z collapse onto a point inside the rider's neck (before skinning),
 * so hidden parts vanish and triangles bordering them close the opening instead of stretching.
 */
const HIDE_VERTEX = /* glsl */ `
if (uFirstPerson > 0.5 && aData.z > 0.5) {
  transformed = uHidePoint;
}
#include <skinning_vertex>
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec4 vRData;
flat varying float vRMat;
varying vec3 vRPos;
float rdHeight = 0.0;
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

/**
 * Per-vertex material ids (aData.x): 0 wool, 1 leather, 2 iron, 3 skin, 4 dark leather, 5 scarf wool, 6 saddle blanket,
 * 7 cloak/hood, 8 goggle glass, 9 brass. aData.y = authored wear (edges, straps) for leather, t for cloth.
 * Leather wear also grows with surface curvature (rounded edges, knuckles, strap borders rub pale and smooth).
 */
const FRAGMENT_MATERIAL = /* glsl */ `
#include <color_fragment>
float rdMat = floor(vRMat + 0.5);
float rdRough = 0.8;
float rdMetal = 0.0;
{
  vec3 p = vRPos;
  float fine = vnoise3(p * 180.0);
  float mid = fbm3(p * 22.0, 3);
  float curvature = length(fwidth(vNormal)) / max(length(fwidth(vViewPosition)), 1e-5);
  if (rdMat < 0.5 || rdMat > 6.5 && rdMat < 7.5) {
    // Wool: twill weave, fuzz and pilling. Cloak/hood: deep madder red, sun-faded and dusty toward the hem;
    // clothing: charcoal.
    vec2 w = vec2(p.x + p.z, p.y) * 900.0;
    // Fade the weave out before it aliases (radians per pixel).
    float weaveAA = 1.0 - smoothstep(0.6, 1.6, length(fwidth(w)));
    float weave = 0.5 + 0.5 * sin(w.x + w.y) * sin(w.x - w.y * 0.5) * weaveAA;
    float pill = smoothstep(0.7, 0.9, vnoise3(p * 420.0)) * weaveAA;
    fine *= weaveAA;
    bool cloak = rdMat > 6.5;
    vec3 base = cloak ? vec3(0.15, 0.028, 0.022) : vec3(0.036, 0.033, 0.03);
    float fade = cloak ? smoothstep(0.35, 1.0, vRData.y) : 0.0;
    vec3 c = base * (0.8 + 0.28 * mid + 0.1 * weave + 0.08 * pill);
    c = mix(c, c * vec3(1.25, 1.35, 1.3) + vec3(0.018, 0.014, 0.011), fade * 0.45);
    diffuseColor.rgb = c;
    rdRough = 0.9;
    rdHeight = weave * 0.15 + fine * 0.25 + pill * 0.12;
  } else if (rdMat < 1.5 || (rdMat > 3.5 && rdMat < 4.5)) {
    // Leather: pebbled grain; rubbed pale and polished where authored wear or tight curvature says so.
    float grain = vnoise3(p * 240.0) * 0.6 + vnoise3(p * 520.0) * 0.4;
    vec3 base = rdMat < 1.5 ? vec3(0.085, 0.047, 0.026) : vec3(0.032, 0.021, 0.015);
    float wear = clamp(vRData.y * 0.75 + smoothstep(35.0, 140.0, curvature) * 0.6, 0.0, 1.0);
    wear *= 0.55 + 0.45 * smoothstep(0.3, 0.7, mid);
    vec3 c = base * (0.82 + 0.3 * mid) * (0.9 + 0.2 * grain);
    c = mix(c, c * 2.0 + vec3(0.014, 0.009, 0.005), wear * 0.55);
    diffuseColor.rgb = c;
    rdRough = 0.66 - 0.2 * wear + 0.08 * grain;
    rdHeight = grain * 0.6 * (1.0 - 0.6 * wear) + mid * 0.2;
  } else if (rdMat < 2.5) {
    // Iron fittings: dark steel with rust spots.
    float rust = smoothstep(0.55, 0.75, fbm3(p * 60.0, 3));
    diffuseColor.rgb = mix(vec3(0.4, 0.4, 0.42), vec3(0.18, 0.07, 0.03), rust);
    rdMetal = 1.0 - rust * 0.9;
    rdRough = 0.34 + 0.4 * rust;
    rdHeight = rust * 0.5 + fine * 0.2;
  } else if (rdMat < 3.5) {
    // Wind-burnt skin.
    diffuseColor.rgb = vec3(0.13, 0.075, 0.052) * (0.85 + 0.2 * mid);
    rdRough = 0.5;
    rdHeight = fine * 0.2;
  } else if (rdMat < 5.5) {
    // Scarf: heavy undyed wool, sand-brown.
    vec2 w = vec2(p.x + p.z, p.y) * 1100.0;
    float weave = 0.5 + 0.5 * sin(w.x) * sin(w.y) * (1.0 - smoothstep(0.6, 1.6, length(fwidth(w))));
    diffuseColor.rgb = vec3(0.11, 0.085, 0.062) * (0.8 + 0.3 * mid) * (0.9 + 0.12 * weave);
    rdRough = 0.92;
    rdHeight = weave * 0.35 + fine * 0.3;
  } else if (rdMat < 6.5) {
    // Saddle blanket: dark wool with a woven border of red and ochre bands.
    vec2 uvb = vNormalMapUvBlanket();
    float border = max(smoothstep(0.1, 0.06, min(uvb.x, 1.54 - uvb.x)), smoothstep(0.1, 0.06, min(uvb.y, 1.22 - uvb.y)));
    float bands = step(0.5, fract((min(min(uvb.x, 1.54 - uvb.x), min(uvb.y, 1.22 - uvb.y))) * 60.0));
    vec3 field = vec3(0.03, 0.028, 0.026);
    vec3 trim = mix(vec3(0.17, 0.03, 0.02), vec3(0.26, 0.15, 0.04), bands);
    diffuseColor.rgb = mix(field, trim, border) * (0.8 + 0.3 * mid);
    rdRough = 0.9;
    rdHeight = fine * 0.4;
  } else if (rdMat < 8.5) {
    // Goggle lens: smoked amber glass.
    diffuseColor.rgb = vec3(0.02, 0.012, 0.006);
    rdRough = 0.12;
  } else {
    // Brass rims, tarnished in the recesses.
    float tarnish = smoothstep(0.4, 0.8, mid);
    diffuseColor.rgb = mix(vec3(0.42, 0.3, 0.14), vec3(0.13, 0.11, 0.07), 0.35 + tarnish * 0.5);
    rdMetal = 1.0;
    rdRough = 0.42 + 0.25 * tarnish;
  }
}
`;

export function createRiderMaterial(hidePoint: THREE.Vector3): { material: THREE.MeshStandardMaterial; depthMaterial: THREE.MeshDepthMaterial; uniforms: RiderUniforms } {
  const uniforms: RiderUniforms = {
    uAirspeed: { value: 0 },
    uAirflow: { value: new THREE.Vector3(0, 0, 1) },
    uFirstPerson: { value: 0 },
    uHidePoint: { value: hidePoint.clone() },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  patchMaterial(material, 'dragon-rider-v3', (shader) => {
    shader.uniforms.uAirspeed = uniforms.uAirspeed;
    shader.uniforms.uAirflow = uniforms.uAirflow;
    shader.uniforms.uFirstPerson = uniforms.uFirstPerson;
    shader.uniforms.uHidePoint = uniforms.uHidePoint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <uv_pars_vertex>', '#include <uv_pars_vertex>\nvarying vec2 vBlanketUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvBlanketUv = uv;')
      .replace('#include <begin_vertex>', CLOAK_VERTEX)
      .replace('#include <skinning_vertex>', HIDE_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}\nvarying vec2 vBlanketUv;\nvec2 vNormalMapUvBlanket() { return vBlanketUv; }`)
      .replace('#include <color_fragment>', FRAGMENT_MATERIAL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rdRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = rdMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = rdPerturb(-vViewPosition, normal, rdHeight * 0.0022);');
  });
  const depthMaterial = new THREE.MeshDepthMaterial();
  patchMaterial(depthMaterial, 'dragon-rider-depth-v3', (shader) => {
    shader.uniforms.uAirspeed = uniforms.uAirspeed;
    shader.uniforms.uAirflow = uniforms.uAirflow;
    shader.uniforms.uFirstPerson = uniforms.uFirstPerson;
    shader.uniforms.uHidePoint = uniforms.uHidePoint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', CLOAK_VERTEX);
  });
  return { material, depthMaterial, uniforms };
}
