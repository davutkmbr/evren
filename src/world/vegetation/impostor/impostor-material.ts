import * as THREE from 'three';
import { patchMaterial } from '../../../core/uniforms';
import type { VegetationSharedUniforms } from '../render/tree-material';
import { lightsWithTranslucency, replaceOrWarn } from '../render/tree-material';
import { VEG_DITHER_GLSL, VEG_INSTANCE_GLSL } from '../render/tree.glsl';
import { SPECIES_COUNT } from '../species';
import { OCTAHEDRAL_GLSL } from './octahedral.glsl';

/** Uniforms owned by the impostor materials (shared between the main and the depth program). */
export interface ImpostorUniforms {
  uImpAlbedo: THREE.IUniform<THREE.Texture | null>;
  uImpNormal: THREE.IUniform<THREE.Texture | null>;
  uImpFrames: THREE.IUniform<number>;
  /** x = full density distance, y = minimum keep fraction, z = size compensation exponent, w = max compensation. */
  uVegThin: THREE.IUniform<THREE.Vector4>;
}

/**
 * Vertex side: camera-facing quad around the tree's bounding sphere; the view direction in the tree's frame picks the
 * three nearest hemi-octahedral frames (barycentric weights) and every quad corner is projected into each frame.
 */
const IMPOSTOR_VERTEX_PARS = /* glsl */ `
${VEG_INSTANCE_GLSL}
${OCTAHEDRAL_GLSL}
uniform float uImpFrames;
uniform vec4 uVegThin;
uniform vec3 uKeyLightDir;
varying vec4 vImpUv01;
varying vec2 vImpUv2;
varying vec3 vImpWeights;
flat varying vec4 vImpFrames01;
flat varying vec2 vImpFrame2;
flat varying vec4 vImpInst;
varying vec3 vImpTint;
varying float vImpFade;

vec2 impFrameUv(vec2 frame, vec3 local, float R) {
  vec3 dir = hemiOctDecode(frame / (uImpFrames - 1.0));
  vec3 right;
  vec3 up;
  impostorBasis(dir, right, up);
  vec2 f = vec2(dot(local, right), dot(local, up)) / (2.0 * R) + 0.5;
  return (frame + f) / uImpFrames;
}

float impKeep(float d) {
  float r = uVegThin.x / max(d, 1.0);
  return d <= uVegThin.x ? 1.0 : max(r * r, uVegThin.y);
}

/* Returns the world position of the quad corner; worldCenter / radius / lookup data go to varyings. */
vec3 impTransform(out vec3 worldCenter, out float radius) {
  int species = vegSpecies();
  vec4 S = uVegShape[species];
  float scale = aInst1.x;
  float width = aInst1.w;
  float rank = aInst1.z;
  vec3 base = aInst0.xyz;
  float s = sin(aInst0.w);
  float c = cos(aInst0.w);
  float d = distance(base, uCamPos);

  float keep = impKeep(d);
  float grow = clamp((keep - rank) / 0.04, 0.0, 1.0);
  float comp = min(pow(1.0 / keep, uVegThin.z), uVegThin.w);
  scale *= comp * sqrt(grow);

  vec3 C = base + vec3(0.0, S.y * scale, 0.0);
  float R = S.z * scale * max(width, 1.0);
  vImpFade = vegFadeFactor(d) * step(0.001, grow);
  if (vImpFade <= 0.0) {
    R = 0.0;
  }
  worldCenter = C;
  radius = R;

  #ifdef IMPOSTOR_DEPTH
    vec3 toEye = normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
  #else
    vec3 toEye = normalize(uCamPos - C);
  #endif
  vec3 local = vegRotY(toEye, -s, c);
  local.xz /= width;
  local.y = max(local.y, 0.02);
  local = normalize(local);

  float n1 = uImpFrames - 1.0;
  vec2 g = hemiOctEncode(local) * n1;
  vec2 cell = clamp(floor(g), vec2(0.0), vec2(n1 - 1.0));
  vec2 f = g - cell;
  vec2 fa;
  vec2 fb;
  vec2 fc;
  vec3 w;
  if (f.x + f.y < 1.0) {
    fa = cell;
    fb = cell + vec2(1.0, 0.0);
    fc = cell + vec2(0.0, 1.0);
    w = vec3(1.0 - f.x - f.y, f.x, f.y);
  } else {
    fa = cell + vec2(1.0, 1.0);
    fb = cell + vec2(0.0, 1.0);
    fc = cell + vec2(1.0, 0.0);
    w = vec3(f.x + f.y - 1.0, 1.0 - f.x, 1.0 - f.y);
  }

  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 P = C + (camRight * position.x + camUp * position.y) * R;
  vec3 pl = vegRotY(P - C, -s, c);
  pl.xz /= width;

  vImpUv01 = vec4(impFrameUv(fa, pl, S.z * scale), impFrameUv(fb, pl, S.z * scale));
  vImpUv2 = impFrameUv(fc, pl, S.z * scale);
  vImpWeights = w;
  vImpFrames01 = vec4(fa, fb);
  vImpFrame2 = fc;
  vImpInst = vec4(float(species), s, c, rank);
  vImpTint = vegTint(rank, 1.0, uVegLook[species]);

  #ifndef IMPOSTOR_DEPTH
    // Pull the card toward the eye (keeping its projected size) so hillsides do not clip the lower half.
    float dist = distance(P, uCamPos);
    P = uCamPos + (P - uCamPos) * max(dist - 0.6 * R, 0.5) / dist;
  #endif
  return P;
}
`;

const IMPOSTOR_FRAGMENT_COMMON = /* glsl */ `
precision highp sampler2DArray;
${OCTAHEDRAL_GLSL}
${VEG_DITHER_GLSL}
uniform sampler2DArray uImpAlbedo;
uniform float uImpFrames;
uniform float uVegDitherFlip;
varying vec4 vImpUv01;
varying vec2 vImpUv2;
varying vec3 vImpWeights;
flat varying vec4 vImpFrames01;
flat varying vec2 vImpFrame2;
flat varying vec4 vImpInst;
varying vec3 vImpTint;
varying float vImpFade;

vec2 impClampUv(vec2 uv, vec2 frame) {
  vec2 lo = (frame + 0.02) / uImpFrames;
  vec2 hi = (frame + 0.98) / uImpFrames;
  return clamp(uv, lo, hi);
}
`;

const IMPOSTOR_FRAGMENT_PARS = /* glsl */ `
${IMPOSTOR_FRAGMENT_COMMON}
uniform sampler2DArray uImpNormal;
uniform vec4 uVegLook[${SPECIES_COUNT}];

/* Mip-aware alpha boost so distant impostors keep their coverage. */
float impAlphaBoost(vec2 uv) {
  vec2 size = vec2(textureSize(uImpAlbedo, 0).xy);
  vec2 dx = dFdx(uv * size);
  vec2 dy = dFdy(uv * size);
  float mip = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8));
  return 1.0 + max(mip, 0.0) * 0.28;
}

/* Crown self shadow from the bent (crown radial) normal: the side facing away from the light sits behind the crown. */
float vegSelfShadow(float nl) {
  return mix(0.14, 1.0, smoothstep(-0.35, 0.4, nl));
}

vec3 impFrameNormal(vec2 frame, vec4 packedN) {
  vec3 dir = hemiOctDecode(frame / (uImpFrames - 1.0));
  vec3 right;
  vec3 up;
  impostorBasis(dir, right, up);
  vec3 n = unpackViewNormal(packedN.xy);
  return right * n.x + up * n.y + dir * n.z;
}
`;

export interface ImpostorMaterialSet {
  near: THREE.MeshStandardMaterial;
  far: THREE.MeshStandardMaterial;
  depth: THREE.MeshDepthMaterial;
  uniforms: ImpostorUniforms;
  /** Fade vectors (see uVegFade) of the two main materials and of the shadow caster (skips mesh-shadowed trees). */
  fadeNear: THREE.Vector4;
  fadeFar: THREE.Vector4;
  fadeDepth: THREE.Vector4;
  dispose(): void;
}

function createImpostorMainMaterial(shared: VegetationSharedUniforms, imp: ImpostorUniforms, fade: THREE.Vector4): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.FrontSide });
  mat.name = 'vegetation-impostor';
  // The shadow pass takes its face culling from the main material (FrontSide would become BackSide there).
  mat.shadowSide = THREE.DoubleSide;
  const own = { uVegFade: { value: fade }, uVegDitherFlip: { value: 0 } };
  patchMaterial(mat, 'vegetation-impostor-v1', (shader) => {
    Object.assign(shader.uniforms, shared, imp, own);
    let vs = shader.vertexShader;
    vs = replaceOrWarn(vs, '#include <common>', `#include <common>\n${IMPOSTOR_VERTEX_PARS}`, 'impostor vertex pars');
    vs = replaceOrWarn(
      vs,
      '#include <beginnormal_vertex>',
      'vec3 impCenter;\nfloat impRadius;\nvec3 impWorld = impTransform(impCenter, impRadius);\nvec3 objectNormal = normalize(uCamPos - impCenter);',
      'impostor normal',
    );
    vs = replaceOrWarn(vs, '#include <begin_vertex>', 'vec3 transformed = impWorld;', 'impostor position');
    // Shadow lookups from a point outside the tree on the key-light side: no self shadowing of the flat card,
    // while terrain / building / neighbour shadows still land on the crown.
    vs = replaceOrWarn(
      vs,
      '#include <shadowmap_vertex>',
      `#include <shadowmap_vertex>
      #if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
        vSunShadowWorldPosition.xyz = impWorld + uKeyLightDir * (2.1 * impRadius);
        vSunShadowWorldNormal = vec3(0.0);
      #endif`,
      'impostor shadow lookup',
    );
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = replaceOrWarn(fs, '#include <common>', `#include <common>\n${IMPOSTOR_FRAGMENT_PARS}`, 'impostor fragment pars');
    fs = replaceOrWarn(
      fs,
      '#include <map_fragment>',
      /* glsl */ `
      float impLayer = vImpInst.x;
      vec2 impUv0 = impClampUv(vImpUv01.xy, vImpFrames01.xy);
      vec2 impUv1 = impClampUv(vImpUv01.zw, vImpFrames01.zw);
      vec2 impUv2 = impClampUv(vImpUv2, vImpFrame2);
      vec4 impA0 = texture(uImpAlbedo, vec3(impUv0, impLayer));
      vec4 impA1 = texture(uImpAlbedo, vec3(impUv1, impLayer));
      vec4 impA2 = texture(uImpAlbedo, vec3(impUv2, impLayer));
      float impAlpha = dot(vec3(impA0.a, impA1.a, impA2.a), vImpWeights) * impAlphaBoost(impUv0);
      float impXi = vegIGN(gl_FragCoord.xy);
      impXi = uVegDitherFlip > 0.5 ? 1.0 - impXi : impXi;
      if (impAlpha < 0.5 || impXi >= vImpFade) discard;
      vec3 impW = vImpWeights * vec3(impA0.a, impA1.a, impA2.a);
      impW /= max(impW.x + impW.y + impW.z, 1e-4);
      vec4 impN0 = texture(uImpNormal, vec3(impUv0, impLayer));
      vec4 impN1 = texture(uImpNormal, vec3(impUv1, impLayer));
      vec4 impN2 = texture(uImpNormal, vec3(impUv2, impLayer));
      vec4 impN = impN0 * impW.x + impN1 * impW.y + impN2 * impW.z;
      float impLeaf = smoothstep(0.02, 0.12, impN.a);
      vec3 impTint = mix(vec3(dot(vImpTint, vec3(0.3333))), vImpTint, impLeaf);
      diffuseColor.rgb = (impA0.rgb * impW.x + impA1.rgb * impW.y + impA2.rgb * impW.z) * impTint;
      vec4 impLook = uVegLook[int(impLayer + 0.5)];
      `,
      'impostor albedo',
    );
    fs = replaceOrWarn(fs, '#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.85, impLook.x, impLeaf);', 'impostor roughness');
    fs = replaceOrWarn(
      fs,
      '#include <normal_fragment_maps>',
      /* glsl */ `
      {
        vec3 nLocal = impFrameNormal(vImpFrames01.xy, impN0) * impW.x
          + impFrameNormal(vImpFrames01.zw, impN1) * impW.y
          + impFrameNormal(vImpFrame2, impN2) * impW.z;
        float s = vImpInst.y;
        float c = vImpInst.z;
        vec3 nWorld = normalize(vec3(c * nLocal.x + s * nLocal.z, nLocal.y, -s * nLocal.x + c * nLocal.z));
        normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
        nonPerturbedNormal = normal;
      }
      `,
      'impostor normal',
    );
    fs = replaceOrWarn(fs, '#include <lights_fragment_begin>', lightsWithTranslucency(true), 'impostor translucency');
    fs = replaceOrWarn(
      fs,
      '#include <aomap_fragment>',
      /* glsl */ `
      {
        float vegOcc = impN.b;
        reflectedLight.indirectDiffuse *= vegOcc;
        reflectedLight.indirectSpecular *= vegOcc * vegOcc * mix(1.0, 0.3, impLeaf);
        reflectedLight.directDiffuse *= mix(1.0, vegOcc, 0.35);
        reflectedLight.directSpecular *= mix(1.0, vegOcc, 0.6) * mix(1.0, 0.55, impLeaf);
        reflectedLight.directDiffuse += vegTrans * BRDF_Lambert(material.diffuseColor) * vec3(1.15, 1.05, 0.5) * impN.a * mix(0.45, 1.0, vegOcc);
      }
      `,
      'impostor occlusion',
    );
    shader.fragmentShader = fs;
  });
  return mat;
}

function createImpostorDepthMaterial(shared: VegetationSharedUniforms, imp: ImpostorUniforms, fade: THREE.Vector4): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  mat.name = 'vegetation-impostor-depth';
  const own = { uVegFade: { value: fade }, uVegDitherFlip: { value: 0 } };
  patchMaterial(mat, 'vegetation-impostor-depth-v1', (shader) => {
    Object.assign(shader.uniforms, shared, imp, own);
    let vs = shader.vertexShader;
    vs = replaceOrWarn(vs, '#include <common>', `#include <common>\n#define IMPOSTOR_DEPTH\n${IMPOSTOR_VERTEX_PARS}`, 'impostor depth pars');
    vs = replaceOrWarn(vs, '#include <begin_vertex>', 'vec3 impCenter;\nfloat impRadius;\nvec3 transformed = impTransform(impCenter, impRadius);', 'impostor depth position');
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = replaceOrWarn(fs, '#include <common>', `#include <common>\n${IMPOSTOR_FRAGMENT_COMMON}`, 'impostor depth fragment pars');
    fs = replaceOrWarn(
      fs,
      '#include <alphatest_fragment>',
      /* glsl */ `
      {
        float w = max(vImpWeights.x, max(vImpWeights.y, vImpWeights.z));
        vec2 frame = w == vImpWeights.x ? vImpFrames01.xy : w == vImpWeights.y ? vImpFrames01.zw : vImpFrame2;
        vec2 uv = w == vImpWeights.x ? vImpUv01.xy : w == vImpWeights.y ? vImpUv01.zw : vImpUv2;
        if (vImpFade < 0.5 || texture(uImpAlbedo, vec3(impClampUv(uv, frame), vImpInst.x)).a < 0.5) discard;
      }
      `,
      'impostor depth alpha',
    );
    shader.fragmentShader = fs;
  });
  return mat;
}

export function createImpostorMaterials(shared: VegetationSharedUniforms, atlas: { albedo: THREE.Texture; normal: THREE.Texture; frames: number }): ImpostorMaterialSet {
  const uniforms: ImpostorUniforms = {
    uImpAlbedo: { value: atlas.albedo },
    uImpNormal: { value: atlas.normal },
    uImpFrames: { value: atlas.frames },
    uVegThin: { value: new THREE.Vector4(1000, 0.06, 0.3, 1.45) },
  };
  const fadeNear = new THREE.Vector4(215, 245, 1e9, 1e9);
  const fadeFar = new THREE.Vector4(215, 245, 3400, 4000);
  const fadeDepth = new THREE.Vector4(95, 95.01, 1e9, 1e9);
  const near = createImpostorMainMaterial(shared, uniforms, fadeNear);
  const far = createImpostorMainMaterial(shared, uniforms, fadeFar);
  const depth = createImpostorDepthMaterial(shared, uniforms, fadeDepth);
  return {
    near,
    far,
    depth,
    uniforms,
    fadeNear,
    fadeFar,
    fadeDepth,
    dispose() {
      near.dispose();
      far.dispose();
      depth.dispose();
    },
  };
}
