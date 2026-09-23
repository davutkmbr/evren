/**
 * Materials of the traffic layer.
 *
 * - vehicle: one MeshPhysicalMaterial for every vehicle part of the BatchedMesh draws. The per-vertex `aMat`
 *   (model-builder.ts VehicleMat) selects paint (clearcoat, instance colour), tinted glass, chrome, rubber, trim,
 *   lamps, liveries and lit windows; the instance colour's alpha carries the per-vehicle state bits (VehicleState).
 * - light sprites: additive glow of head / tail lamps that reads each vehicle's matrix and state straight from the
 *   BatchedMesh textures (no per-frame CPU work), with a minimum on-screen size for distant traffic and bloom.
 * - headlight pools: additive beams on the road in front of moving vehicles at night, same texture lookups.
 */
import * as THREE from 'three';
import { globalUniforms, patchMaterial } from '../../../core/uniforms';
import { SHARED_GLSL } from '../../../render/shaders';
import { VehicleMat as M } from './model-builder';

/** Bits of the instance colour alpha. */
export const VehicleState = {
  Lights: 1,
  Brake: 2,
  Interior: 4,
  Metallic: 8,
  /** Left / right indicator blinking (bit set = active). */
  IndicatorL: 16,
  IndicatorR: 32,
} as const;

const VEHICLE_VERTEX_PARS = /* glsl */ `
attribute float aMat;
varying float vMat;
varying vec3 vPaint;
varying float vState;
`;

const VEHICLE_COLOR_VERTEX = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR
  vColor.rgb = color;
#endif
#ifdef USE_BATCHING_COLOR
  vec4 vehBatch = getBatchingColor( getIndirectIndex( gl_DrawID ) );
  vPaint = vehBatch.rgb;
  vState = vehBatch.a;
#else
  vPaint = vec3( 0.8 );
  vState = 0.0;
#endif
vMat = aMat;
`;

const VEHICLE_FRAGMENT_PARS = /* glsl */ `
varying float vMat;
varying vec3 vPaint;
varying float vState;
float vehBit(int bit) { return float((int(vState + 0.5) & bit) != 0); }
`;

const VEHICLE_COLOR_FRAGMENT = /* glsl */ `
int vehMat = int(vMat + 0.5);
vec3 vehBase = vehMat == ${M.Paint} ? vPaint : vColor.rgb;
diffuseColor.rgb = vehBase;
`;

const VEHICLE_ROUGHNESS = /* glsl */ `
float metallicPaint = vehBit(${VehicleState.Metallic});
if (vehMat == ${M.Paint}) roughnessFactor = mix(0.34, 0.26, metallicPaint);
else if (vehMat == ${M.Glass} || vehMat == ${M.Lit}) roughnessFactor = 0.06;
else if (vehMat == ${M.Chrome}) roughnessFactor = 0.24;
else if (vehMat == ${M.Rubber}) roughnessFactor = 0.9;
else if (vehMat == ${M.Trim}) roughnessFactor = 0.62;
else if (vehMat == ${M.Head} || vehMat == ${M.Tail}) roughnessFactor = 0.12;
else if (vehMat == ${M.Cloth}) roughnessFactor = 0.88;
else roughnessFactor = 0.45;
`;

const VEHICLE_METALNESS = /* glsl */ `
if (vehMat == ${M.Paint}) metalnessFactor = 0.55 * metallicPaint;
else if (vehMat == ${M.Chrome}) metalnessFactor = 1.0;
else if (vehMat == ${M.Head}) metalnessFactor = 0.7;
else metalnessFactor = 0.0;
`;

const VEHICLE_CLEARCOAT = /* glsl */ `
material.clearcoat = (vehMat == ${M.Paint} || vehMat == ${M.Glass} || vehMat == ${M.Lit}) ? 1.0 : (vehMat == ${M.Fixed} ? 0.7 : 0.0);
material.clearcoatRoughness = vehMat == ${M.Paint} ? 0.06 : 0.04;
`;

const VEHICLE_EMISSIVE = /* glsl */ `
{
  float lightsOn = vehBit(${VehicleState.Lights});
  float brake = vehBit(${VehicleState.Brake});
  float interior = vehBit(${VehicleState.Interior});
  if (vehMat == ${M.Head}) totalEmissiveRadiance += vec3(1.0, 0.93, 0.82) * 26.0 * lightsOn;
  else if (vehMat == ${M.Tail}) totalEmissiveRadiance += vec3(1.0, 0.04, 0.02) * (2.8 * lightsOn + 16.0 * brake);
  else if (vehMat == ${M.Lit}) totalEmissiveRadiance += vec3(0.86, 0.93, 1.0) * 1.35 * interior;
  else if (vehMat == ${M.Sign}) totalEmissiveRadiance += vColor.rgb * mix(0.35, 5.0, lightsOn);
}
`;

function replaceOnce(src: string, search: string, replacement: string): string {
  if (!src.includes(search)) {
    console.warn(`[osm:traffic] shader chunk "${search}" not found`);
    return src;
  }
  return src.replace(search, replacement);
}

export function createVehicleMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    name: 'osm-vehicle',
    vertexColors: true,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.35,
  });
  return patchMaterial(m, 'osm-vehicle-v1', (shader) => {
    shader.vertexShader = replaceOnce(shader.vertexShader, '#include <common>', `#include <common>\n${VEHICLE_VERTEX_PARS}`);
    shader.vertexShader = replaceOnce(shader.vertexShader, '#include <color_vertex>', VEHICLE_COLOR_VERTEX);
    shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <common>', `#include <common>\n${VEHICLE_FRAGMENT_PARS}`);
    shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <color_fragment>', VEHICLE_COLOR_FRAGMENT);
    shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${VEHICLE_ROUGHNESS}`);
    shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${VEHICLE_METALNESS}`);
    shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${VEHICLE_CLEARCOAT}`);
    shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${VEHICLE_EMISSIVE}`);
  });
}

/** GLSL fetching a BatchedMesh instance matrix / colour (same layout as three's batching_pars_vertex). */
const BATCH_FETCH = /* glsl */ `
uniform highp sampler2D uBatchMatrices;
uniform highp sampler2D uBatchColors;
mat4 batchMatrix(float i) {
  int size = textureSize(uBatchMatrices, 0).x;
  int j = int(i) * 4;
  int x = j % size;
  int y = j / size;
  return mat4(texelFetch(uBatchMatrices, ivec2(x, y), 0), texelFetch(uBatchMatrices, ivec2(x + 1, y), 0),
              texelFetch(uBatchMatrices, ivec2(x + 2, y), 0), texelFetch(uBatchMatrices, ivec2(x + 3, y), 0));
}
vec4 batchColor(float i) {
  int size = textureSize(uBatchColors, 0).x;
  int j = int(i);
  return texelFetch(uBatchColors, ivec2(j % size, j / size), 0);
}
float stateBit(float s, int bit) { return float((int(s + 0.5) & bit) != 0); }
`;

const SPRITE_VERTEX = /* glsl */ `
${SHARED_GLSL}
${BATCH_FETCH}
attribute vec2 corner;
attribute float iSlot;
attribute vec4 iLight;   // local x, y, z, kind (0 head, 1 tail)
uniform float uPixelAngle;
varying vec2 vQ;
varying vec3 vCol;
void main() {
  vQ = corner;
  vec4 c = batchColor(iSlot);
  float state = c.a;
  float lights = stateBit(state, ${VehicleState.Lights});
  float brake = stateBit(state, ${VehicleState.Brake});
  mat4 m = batchMatrix(iSlot);
  vec3 P = (m * vec4(iLight.xyz, 1.0)).xyz;
  vec3 fwd = -normalize(m[2].xyz);
  vec3 toCam = cameraPosition - P;
  float dist = max(length(toCam), 1e-3);
  vec3 dir = toCam / dist;
  float kind = iLight.w;
  // turn indicator on this lamp's side, blinking at ~1.5 Hz (each vehicle in its own phase)
  float ind = iLight.x < 0.0 ? stateBit(state, ${VehicleState.IndicatorL}) : stateBit(state, ${VehicleState.IndicatorR});
  float blink = ind * step(0.5, fract(uTime * 1.5 + iSlot * 0.137));
  vec3 amber = vec3(1.0, 0.42, 0.03) * blink * mix(5.0, 8.0, lights);
  vec3 col;
  float size;
  if (kind < 0.5) {
    float facing = smoothstep(-0.15, 0.55, dot(fwd, dir));
    col = (vec3(1.0, 0.9, 0.76) * 8.0 * lights * (1.0 - blink * 0.7) + amber) * (0.06 + 0.94 * facing);
    size = 0.19;
  } else {
    float facing = smoothstep(-0.25, 0.45, -dot(fwd, dir));
    col = (vec3(1.0, 0.05, 0.02) * (2.2 * lights + 7.0 * brake) + amber) * (0.1 + 0.9 * facing);
    size = 0.15;
  }
  float pix = dist * uPixelAngle;
  float s = max(size, pix * 1.3);
  float k = size / s;
  col *= k * k * atmoTransmittance(P);
  vCol = col;
  if (dot(col, vec3(1.0)) < 1e-4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  P += dir * min(size * 2.0 + 0.25, dist * 0.3);
  vec4 mv = viewMatrix * vec4(P, 1.0);
  mv.xy += corner * s * 3.0;
  gl_Position = projectionMatrix * mv;
}
`;

const SPRITE_FRAGMENT = /* glsl */ `
varying vec2 vQ;
varying vec3 vCol;
void main() {
  float r2 = dot(vQ, vQ) * 9.0;
  float g = exp(-r2 * 1.6) + exp(-r2 * 0.3) * 0.04;
  if (g < 0.002) discard;
  gl_FragColor = vec4(vCol * g, 1.0);
}
`;

const POOL_VERTEX = /* glsl */ `
${SHARED_GLSL}
${BATCH_FETCH}
attribute vec2 corner;
attribute float iSlot;
attribute vec2 iSize;    // half width of the beam spread, reach (m)
varying vec2 vUv;
varying float vOn;
varying vec3 vW;
void main() {
  vec4 c = batchColor(iSlot);
  float lights = stateBit(c.a, ${VehicleState.Lights});
  vOn = lights * smoothstep(0.08, 0.4, uNight);
  vUv = corner * 0.5 + 0.5;
  if (vOn < 0.01) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  mat4 m = batchMatrix(iSlot);
  // quad on the vehicle's ground plane, from the bumper forward
  float along = mix(0.0, iSize.y, vUv.y);
  float half_ = mix(iSize.x * 0.55, iSize.x * 1.5, vUv.y);
  vec3 local = vec3(corner.x * half_, 0.07, -along - 1.8);
  vec4 w = m * vec4(local, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const POOL_FRAGMENT = /* glsl */ `
${SHARED_GLSL}
varying vec2 vUv;
varying float vOn;
varying vec3 vW;
void main() {
  float x = vUv.x * 2.0 - 1.0;
  float y = vUv.y;
  float beams = exp(-pow((abs(x) - 0.38) / 0.42, 2.0)) ;
  float fall = smoothstep(0.0, 0.12, y) * pow(1.0 - y, 1.6);
  float g = beams * fall * vOn;
  if (g < 0.003) discard;
  vec3 col = vec3(1.0, 0.9, 0.74) * 0.36 * g;
  gl_FragColor = vec4(col * atmoTransmittance(vW), 1.0);
}
`;

export interface BatchTextures {
  matrices: THREE.DataTexture;
  colors: THREE.DataTexture;
}

export function createSpriteMaterial(tex: BatchTextures, pixelAngle: THREE.IUniform): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'osm-vehicle-lights',
    vertexShader: SPRITE_VERTEX,
    fragmentShader: SPRITE_FRAGMENT,
    uniforms: { ...globalUniforms, uBatchMatrices: { value: tex.matrices }, uBatchColors: { value: tex.colors }, uPixelAngle: pixelAngle },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
}

export function createPoolMaterial(tex: BatchTextures): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'osm-vehicle-pools',
    vertexShader: POOL_VERTEX,
    fragmentShader: POOL_FRAGMENT,
    uniforms: { ...globalUniforms, uBatchMatrices: { value: tex.matrices }, uBatchColors: { value: tex.colors } },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  });
}
