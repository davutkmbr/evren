import * as THREE from 'three';
import { patchMaterial } from '../../../core/uniforms';
import type { MembraneTextures } from './membrane-textures';

export interface MembraneUniforms {
  /** Billow displacement (m) at the slack centre of the panels: x = left wing, y = right wing. */
  uBillow: THREE.IUniform<THREE.Vector2>;
  /** Trailing-edge flutter amplitude (m). */
  uFlutter: THREE.IUniform<number>;
  /** Flutter frequency (rad/s). */
  uFlutterFreq: THREE.IUniform<number>;
  /** Pleat depth (m) of the folded membrane (0 spread .. ~0.2 folded on the ground). */
  uFoldSlack: THREE.IUniform<number>;
  /** World direction toward the shadow-casting key light (sun or moon). */
  uKeyLightDir: THREE.IUniform<THREE.Vector3>;
  /** Baked membrane data texture (veins, thickness, wrinkles, mottling). */
  tMembrane: THREE.IUniform<THREE.Texture>;
}

const VERTEX_PARS = /* glsl */ `
attribute vec4 aData;
uniform float uTime;
uniform vec2 uBillow;
uniform float uFlutter;
uniform float uFlutterFreq;
uniform float uFoldSlack;
`;

/**
 * Billow (camber under load), trailing-edge flutter and the pleats of a folded wing, applied in bind space along the
 * bind normal before skinning, so the colour and the shadow pass deform identically.
 */
const DISPLACE = /* glsl */ `
{
  float slack = aData.x;
  float edgeT = aData.y;
  float billow = aData.w > 0.0 ? uBillow.y : uBillow.x;
  float ph = uTime * uFlutterFreq + edgeT * 7.0 + position.x * 0.9 + position.z * 1.7;
  float flutter = (sin(ph) + 0.45 * sin(ph * 2.3 + 1.7)) * uFlutter * edgeT * edgeT * (0.3 + slack);
  float pleats = uFoldSlack * min(slack * 1.6, 1.0) * (0.6 * sin(position.x * 6.3 + position.z * 1.3) + 0.4 * sin(position.x * 10.7 - position.z * 2.1 + 1.3));
  transformed += normalize(normal) * (slack * billow + flutter + pleats);
}
`;

const VERTEX_SHADOW_OFFSET = /* glsl */ `
vec4 dgWorldPosSaved = worldPosition;
// Shadow lookup moved off the membrane toward the key light (along the light and along the side of the surface
// that faces it): the thin, billowing membrane never shadows itself, so light arriving from behind passes through,
// while the body and every other occluder still shadow it.
{
  vec3 dgL = normalize(uKeyLightDir);
  vec3 dgN = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
  worldPosition.xyz += dgL * 0.3 + dgN * (dot(dgN, dgL) >= 0.0 ? 0.25 : -0.25);
}
#include <shadowmap_vertex>
worldPosition = dgWorldPosSaved;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec4 vMData;
uniform sampler2D tMembrane;
vec3 dgTransmit = vec3(0.0);
`;

const RE_OVERRIDE = /* glsl */ `
#include <lights_physical_pars_fragment>
void RE_Direct_Membrane( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  // Diffuse transmission through the thin membrane (light arriving on the far side), with forward scattering.
  float back = saturate( dot( -geometryNormal, directLight.direction ) );
  float fwd = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 6.0 );
  reflectedLight.directDiffuse += directLight.color * dgTransmit * ( back * ( 0.55 + 3.0 * fwd ) + 0.35 * fwd ) * RECIPROCAL_PI;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Membrane
`;

const FRAGMENT_MATERIAL = /* glsl */ `
#include <color_fragment>
{
  vec4 md = texture2D(tMembrane, vNormalMapUv);
  float veins = md.r;
  float thick = max(md.g, vMData.z);
  float edge = smoothstep(0.82, 1.0, vMData.y);
  float mottle = md.a;
  vec3 skin = vec3(0.105, 0.052, 0.038) * (0.75 + 0.5 * mottle);
  skin = mix(skin, vec3(0.055, 0.02, 0.018), veins * 0.6);
  skin = mix(skin, vec3(0.04, 0.03, 0.026), thick * 0.75);
  skin *= 1.0 - 0.4 * edge;
  diffuseColor.rgb = skin;
  // Transmission: thin tissue glows warm red-orange, veins and bones block light.
  float optical = 0.55 + 3.4 * thick + 2.4 * veins + 1.2 * edge + 0.4 * mottle;
  vec3 tint = vec3(1.0, 0.31, 0.12);
  dgTransmit = tint * exp(-optical * vec3(0.8, 1.35, 1.95)) * 0.5;
}
`;

const FRAGMENT_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  // Skylight transmitted through the membrane when seen from below.
  vec3 wn = inverseTransformDirection( normal, viewMatrix );
  float under = saturate( -wn.y * 0.8 + 0.2 );
  totalEmissiveRadiance += dgTransmit * uAmbient * under * 0.6;
}
`;

function bindDeformUniforms(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: MembraneUniforms): void {
  shader.uniforms.uBillow = uniforms.uBillow;
  shader.uniforms.uFlutter = uniforms.uFlutter;
  shader.uniforms.uFlutterFreq = uniforms.uFlutterFreq;
  shader.uniforms.uFoldSlack = uniforms.uFoldSlack;
}

export function createMembraneMaterial(tex: MembraneTextures): {
  material: THREE.MeshStandardMaterial;
  depthMaterial: THREE.MeshDepthMaterial;
  uniforms: MembraneUniforms;
} {
  const uniforms: MembraneUniforms = {
    uBillow: { value: new THREE.Vector2(0.1, 0.1) },
    uFlutter: { value: 0.02 },
    uFlutterFreq: { value: 20 },
    uFoldSlack: { value: 0 },
    uKeyLightDir: { value: new THREE.Vector3(0.3, 0.8, -0.4).normalize() },
    tMembrane: { value: tex.data },
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0,
    side: THREE.DoubleSide,
    normalMap: tex.normal,
    normalScale: new THREE.Vector2(0.55, 0.55),
  });
  patchMaterial(material, 'dragon-membrane-v2', (shader) => {
    bindDeformUniforms(shader, uniforms);
    shader.uniforms.uKeyLightDir = uniforms.uKeyLightDir;
    shader.uniforms.tMembrane = uniforms.tMembrane;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}\nuniform vec3 uKeyLightDir;\nvarying vec4 vMData;`)
      .replace('#include <skinning_vertex>', `vMData = aData;\n${DISPLACE}\n#include <skinning_vertex>`)
      .replace('#include <shadowmap_vertex>', VERTEX_SHADOW_OFFSET);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', RE_OVERRIDE)
      .replace('#include <color_fragment>', FRAGMENT_MATERIAL)
      .replace('#include <emissivemap_fragment>', FRAGMENT_EMISSIVE)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = clamp(0.62 + 0.25 * texture2D(tMembrane, vNormalMapUv).b - 0.1 * vMData.z, 0.35, 0.92);`,
      );
  });
  const depthMaterial = new THREE.MeshDepthMaterial();
  patchMaterial(depthMaterial, 'dragon-membrane-depth-v1', (shader) => {
    bindDeformUniforms(shader, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <skinning_vertex>', `${DISPLACE}\n#include <skinning_vertex>`);
  });
  return { material, depthMaterial, uniforms };
}
