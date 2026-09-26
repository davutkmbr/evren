import * as THREE from 'three';
import { patchMaterial } from '../../../core/uniforms';
import type { ScaleTextures } from './scale-textures';

export interface BodyMaterialUniforms {
  uBreath: THREE.IUniform<number>;
  /** Bond (phase 06): eyelids 0 open .. 1 closed, pupil 0 slit .. 1 wide, neck plates 0 flat .. 1 raised. */
  uEyeLid: THREE.IUniform<number>;
  uPupil: THREE.IUniform<number>;
  uPlates: THREE.IUniform<number>;
}

const VERTEX_PARS = /* glsl */ `
attribute vec4 aData;
varying vec4 vData;
flat varying float vMatId;
uniform float uBreath;
uniform float uPlates;
`;

/**
 * Neck plates (aData.w = 2 on the dorsal thorns of the neck): raising swings each thorn's tip up and forward (toward
 * the head) in bind space, before skinning. aData.y runs 0 at the base to 1 at the tip.
 */
const PLATES_VERTEX = /* glsl */ `
if (aData.w > 1.5) {
  float plateT = aData.y * aData.y * uPlates;
  transformed += vec3(0.0, 0.035, -0.055) * plateT;
}
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec4 vData;
uniform float uEyeLid;
uniform float uPupil;
float dgLimbSkin = 0.0;
flat varying float vMatId;
float dgHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float dgNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dgHash(i), dgHash(i + vec2(1.0, 0.0)), u.x), mix(dgHash(i + vec2(0.0, 1.0)), dgHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/**
 * Per-vertex material ids (aData.x): 0 scaled skin (texture maps), 1 horn, 2 tooth, 3 eye, 4 mouth, 5 claw, 6 tongue.
 * aData.y: param along horn/tooth (0 base .. 1 tip) or head parameter; aData.z: breathing mask; aData.w: 1 on limbs,
 * -(mouth coverage 0..1) on the head and jaw skin. The ids are flat per triangle, so material changes inside one
 * surface are blended here instead: the mouth field is thresholded per pixel (smooth palate / jaw boundaries), and
 * horns and claws grow out of scaled skin over the base of their flare (no hard seam where they meet the head).
 */
const FRAGMENT_MATERIAL = /* glsl */ `
float dgMat = floor(vMatId + 0.5);
float dgSkin = 1.0 - step(0.5, dgMat);
// Derivatives outside any branch (undefined in non-uniform control flow).
float dgMouthF = clamp(-vData.w, 0.0, 1.0);
float dgMouthFw = max(fwidth(dgMouthF), 1e-4);
float dgMouth = dgSkin * smoothstep(0.5 - dgMouthFw, 0.5 + dgMouthFw, dgMouthF);
vec3 dgSkinAlbedo = diffuseColor.rgb;
float dgRough = 0.5;
float dgCoat = 0.0;
float dgCoatRough = 0.3;
vec3 dgEmissive = vec3(0.0);
{
  float t = clamp(vData.y, 0.0, 1.0);
  #if defined( USE_MAP ) || defined( USE_NORMALMAP )
    vec2 dgUv = vNormalMapUv;
  #else
    vec2 dgUv = vec2(0.0);
  #endif
  if (dgMat > 0.5 && dgMat < 1.5 || (dgMat > 4.5 && dgMat < 5.5)) {
    // Keratin horn / claw: near-black base grading to a worn, dusty ivory tip, longitudinal fibres, growth rings
    // and chipped tips. Matte-satin rather than polished.
    float streak = dgNoise(vec2(dgUv.x * 46.0, dgUv.y * 2.5)) * 0.6 + dgNoise(vec2(dgUv.x * 140.0, dgUv.y * 8.0)) * 0.4;
    float rings = smoothstep(0.55, 1.0, sin(t * 60.0 + dgNoise(vec2(dgUv.x * 9.0, t * 4.0)) * 3.0)) * (1.0 - smoothstep(0.7, 1.0, t));
    float chips = smoothstep(0.62, 0.8, dgNoise(dgUv * vec2(30.0, 12.0) + 3.1)) * smoothstep(0.75, 0.98, t);
    vec3 base = vec3(0.022, 0.019, 0.017);
    vec3 midc = vec3(0.06, 0.049, 0.04);
    vec3 tip = vec3(0.19, 0.16, 0.125);
    vec3 c = mix(base, midc, smoothstep(0.0, 0.55, t));
    c = mix(c, tip, smoothstep(0.55, 1.0, t) * 0.8);
    if (dgMat > 4.5) {
      c = mix(vec3(0.045, 0.038, 0.033), vec3(0.014, 0.012, 0.011), smoothstep(0.2, 0.9, t));
    }
    c *= (0.75 + 0.5 * streak) * (1.0 - 0.3 * rings);
    c = mix(c, c * 1.6 + vec3(0.02, 0.018, 0.015), chips);
    // Base of the flare: scaled skin creeping up the horn along a ragged edge, keratin above. The skin albedo is
    // read from the dorsal band of the scale atlas (u near 0; around the horn u would also reach the ember belly).
    float baseEdge = t + (dgNoise(vec2(dgUv.x * 26.0, t * 9.0)) - 0.5) * 0.07;
    float skinBase = 1.0 - smoothstep(0.03, 0.15, baseEdge);
    #ifdef USE_MAP
      dgSkinAlbedo = texture2D(map, vec2(0.36 * (0.5 - abs(fract(dgUv.x) - 0.5)), dgUv.y)).rgb;
    #endif
    diffuseColor.rgb = mix(c, dgSkinAlbedo, skinBase);
    dgRough = mix(0.62, 0.45, t) + (streak - 0.5) * 0.12 + rings * 0.06 + chips * 0.15;
    dgCoat = 0.08;
    dgCoatRough = 0.45;
    dgSkin = skinBase;
  } else if (dgMat > 1.5 && dgMat < 2.5) {
    // Tooth enamel.
    float streak = dgNoise(vec2(dgUv.x * 30.0, dgUv.y * 3.0));
    vec3 c = mix(vec3(0.11, 0.075, 0.04), vec3(0.42, 0.36, 0.26), smoothstep(0.05, 0.8, t));
    diffuseColor.rgb = c * (0.85 + 0.3 * streak);
    dgRough = 0.34;
    dgCoat = 0.45;
  } else if (dgMat > 2.5 && dgMat < 3.5) {
    // Eye: reptilian iris filling the visible eye, vertical slit pupil, glossy cornea, subtle ember glow.
    vec2 e = dgUv;
    float r = length(e);
    float ang = atan(e.y, e.x);
    float fibres = dgNoise(vec2(ang * 9.0, r * 5.0)) * 0.6 + dgNoise(vec2(ang * 31.0, r * 14.0)) * 0.4;
    vec3 iris = mix(vec3(0.95, 0.52, 0.06), vec3(0.42, 0.12, 0.01), smoothstep(0.1, 0.72, r));
    iris *= 0.6 + 0.8 * fibres;
    // The slit narrows in bright light and opens toward a round pupil in the dark or when excited (uPupil).
    float slitW = 0.085 * mix(0.45, 3.6, uPupil * uPupil) * sqrt(max(1.0 - pow(e.y / 0.62, 2.0), 0.0));
    float pupil = 1.0 - smoothstep(slitW - 0.02, slitW + 0.02, abs(e.x));
    pupil *= 1.0 - smoothstep(0.6, 0.66, abs(e.y));
    float limbus = smoothstep(0.62, 0.8, r);
    vec3 c = iris * (1.0 - pupil) * (1.0 - limbus * 0.9);
    diffuseColor.rgb = c * 0.6;
    dgRough = 0.08;
    dgCoat = 1.0;
    dgCoatRough = 0.02;
    dgEmissive = iris * (1.0 - pupil) * (1.0 - limbus) * (0.12 + 2.2 * uNight);
    // Eyelids (uEyeLid): the upper lid comes down, the lower one up, meeting a little below the middle along a
    // curved line; the lid is scaled skin, matte and dark.
    float lidTop = mix(1.06, -0.28, uEyeLid) - 0.22 * e.x * e.x * (1.0 - uEyeLid);
    float lidBottom = mix(-1.06, -0.3, uEyeLid) + 0.12 * e.x * e.x * (1.0 - uEyeLid);
    // Fixed edge width: derivatives are undefined inside this per-material branch.
    float lidW = 0.035;
    float lidCover = max(smoothstep(lidTop - lidW, lidTop + lidW, e.y), 1.0 - smoothstep(lidBottom - lidW, lidBottom + lidW, e.y));
    if (lidCover > 0.0) {
      float scales = dgNoise(e * vec2(34.0, 22.0)) * 0.6 + dgNoise(e * vec2(80.0, 60.0)) * 0.4;
      vec3 lidC = vec3(0.045, 0.034, 0.027) * (0.7 + 0.6 * scales);
      float crease = 1.0 - 0.5 * smoothstep(lidW * 4.0, 0.0, abs(e.y - lidTop));
      diffuseColor.rgb = mix(diffuseColor.rgb, lidC * crease, lidCover);
      dgRough = mix(dgRough, 0.55, lidCover);
      dgCoat = mix(dgCoat, 0.1, lidCover);
      dgCoatRough = mix(dgCoatRough, 0.4, lidCover);
      dgEmissive *= 1.0 - lidCover;
    }
  } else if (dgMat > 3.5 && dgMat < 4.5 || dgMat > 5.5 || dgMouth > 0.0) {
    // Mouth interior / tongue: wet dark flesh with soft, low-frequency wetness variation. On the head and jaw skin
    // it is blended in by the mouth coverage.
    float wet = dgNoise(dgUv * vec2(9.0, 4.0)) * 0.6 + dgNoise(dgUv * vec2(21.0, 9.0)) * 0.4;
    vec3 flesh = dgMat > 5.5 ? vec3(0.2, 0.055, 0.05) : vec3(0.16, 0.035, 0.032);
    float fleshW = dgMat > 0.5 ? 1.0 : dgMouth;
    diffuseColor.rgb = mix(diffuseColor.rgb, flesh * (0.8 + 0.35 * wet), fleshW);
    dgRough = 0.42 - 0.08 * wet;
    dgCoat = 0.35;
    dgCoatRough = 0.3;
    dgSkin *= 1.0 - fleshW;
  }
  #ifdef USE_ROUGHNESSMAP
  if (dgMat < 0.5 && vData.w > 0.5) {
    // Limbs (wing arms, fingers, legs, toes): no ember belly; the undersides become dark grey leathery pads.
    float bellyW = texture2D(roughnessMap, vRoughnessMapUv).b;
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.2, 0.36, 0.78), bellyW);
    dgLimbSkin = bellyW;
  }
  #endif
}
`;

export function createBodyMaterial(tex: ScaleTextures): {
  material: THREE.MeshPhysicalMaterial;
  depthMaterial: THREE.MeshDepthMaterial;
  uniforms: BodyMaterialUniforms;
} {
  const uniforms: BodyMaterialUniforms = { uBreath: { value: 0 }, uEyeLid: { value: 0 }, uPupil: { value: 0.3 }, uPlates: { value: 0 } };
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: tex.albedo,
    normalMap: tex.normal,
    normalScale: new THREE.Vector2(1, 1),
    roughnessMap: tex.orm,
    aoMap: tex.orm,
    aoMapIntensity: 1,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
    clearcoat: 0.32,
    clearcoatRoughness: 0.32,
    iridescence: 0.22,
    iridescenceIOR: 1.55,
    iridescenceThicknessRange: [260, 480],
    specularIntensity: 0.9,
  });
  patchMaterial(material, 'dragon-body-v3', (shader) => {
    shader.uniforms.uBreath = uniforms.uBreath;
    shader.uniforms.uEyeLid = uniforms.uEyeLid;
    shader.uniforms.uPupil = uniforms.uPupil;
    shader.uniforms.uPlates = uniforms.uPlates;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvData = aData;\nvMatId = aData.x;\ntransformed += normal * (aData.z * uBreath);\n${PLATES_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_MATERIAL}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(dgRough, roughnessFactor + 0.12 * dgLimbSkin, dgSkin);`)
      .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * dgSkin;')
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat = mix(dgCoat, material.clearcoat, dgSkin);
  material.clearcoatRoughness = mix(dgCoatRough, material.clearcoatRoughness, dgSkin);
#endif
#ifdef USE_IRIDESCENCE
  material.iridescence *= dgSkin;
#endif`,
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += dgEmissive;`)
      .replace(
        '#include <aomap_fragment>',
        `#ifdef USE_AOMAP
  float ambientOcclusion = mix(1.0, ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0, dgSkin);
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNVao = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNVao, ambientOcclusion, material.roughness );
  #endif
#endif`,
      );
  });
  const depthMaterial = new THREE.MeshDepthMaterial();
  patchMaterial(depthMaterial, 'dragon-body-depth-v2', (shader) => {
    shader.uniforms.uBreath = uniforms.uBreath;
    shader.uniforms.uPlates = uniforms.uPlates;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aData;\nuniform float uBreath;\nuniform float uPlates;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normal * (aData.z * uBreath);\n${PLATES_VERTEX}`);
  });
  return { material, depthMaterial, uniforms };
}
