import * as THREE from 'three';
import { patchMaterial } from '../../../core/uniforms';
import { SPECIES_COUNT, SPECIES_SHAPES } from '../species';
import { TREE_DEPTH_FRAGMENT_PARS, TREE_FRAGMENT_PARS, TREE_VERTEX_PARS } from './tree.glsl';

export interface SpeciesBounds {
  centerY: number;
  /** Impostor frame half size. */
  impostorRadius: number;
  height: number;
}

/** Shared per-species uniform arrays (wind, shape, look) and the texture arrays. */
export interface VegetationSharedUniforms {
  uVegAlbedo: THREE.IUniform<THREE.Texture | null>;
  uVegNormal: THREE.IUniform<THREE.Texture | null>;
  uVegWind: THREE.IUniform<THREE.Vector4[]>;
  uVegShape: THREE.IUniform<THREE.Vector4[]>;
  uVegLook: THREE.IUniform<THREE.Vector4[]>;
}

export function createSharedUniforms(albedo: THREE.Texture, normal: THREE.Texture, bounds: SpeciesBounds[]): VegetationSharedUniforms {
  const wind: THREE.Vector4[] = [];
  const shape: THREE.Vector4[] = [];
  const look: THREE.Vector4[] = [];
  for (let s = 0; s < SPECIES_COUNT; s++) {
    const d = SPECIES_SHAPES[s];
    const b = bounds[s];
    wind.push(new THREE.Vector4(...d.wind));
    shape.push(new THREE.Vector4(b.height, b.centerY, b.impostorRadius, 0));
    look.push(new THREE.Vector4(...d.leafLook));
  }
  return {
    uVegAlbedo: { value: albedo },
    uVegNormal: { value: normal },
    uVegWind: { value: wind },
    uVegShape: { value: shape },
    uVegLook: { value: look },
  };
}

export function replaceOrWarn(src: string, search: string, replacement: string, label: string): string {
  if (!src.includes(search)) {
    console.warn(`[vegetation] shader patch "${label}" did not apply`);
    return src;
  }
  return src.replace(search, replacement);
}

/**
 * Adds leaf transmission accumulation right before the key light's RE_Direct call. `selfShadow` (impostors, whose
 * shadow lookup is moved off the card) applies an analytic crown self-shadow from the bent normal first: the far side
 * of a crown only receives light filtered through the foliage.
 */
export function lightsWithTranslucency(selfShadow = false): string {
  let chunk = THREE.ShaderChunk.lights_fragment_begin;
  const shadow = selfShadow ? 'directLight.color *= vegSelfShadow(dot(geometryNormal, directLight.direction));\n\t\t' : '';
  const add = `${shadow}vegTrans += directLight.color * (clamp(dot(-geometryNormal, directLight.direction), 0.0, 1.0) * 0.75 + 0.4 * pow(clamp(dot(-geometryViewDir, directLight.direction), 0.0, 1.0), 4.0));\n\t\t`;
  for (const marker of ['getSunLightInfo( sunLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );']) {
    const i = chunk.indexOf(marker);
    if (i < 0) {
      continue;
    }
    const j = chunk.indexOf('RE_Direct(', i);
    if (j < 0) {
      continue;
    }
    chunk = chunk.slice(0, j) + add + chunk.slice(j);
  }
  return `vec3 vegTrans = vec3(0.0);\n${chunk}`;
}

export interface TreeMaterialSet {
  lod0: THREE.MeshStandardMaterial;
  lod1: THREE.MeshStandardMaterial;
  depth: THREE.MeshDepthMaterial;
  /** (fade-in start, fade-in end, fade-out start, fade-out end) distances; x < 0 disables the fade-in. */
  fade0: THREE.Vector4;
  fade1: THREE.Vector4;
  /** Mesh shadow cut (trees beyond fadeDepth.z cast impostor shadows instead). */
  fadeDepth: THREE.Vector4;
  dispose(): void;
}

function createMainMaterial(shared: VegetationSharedUniforms, fade: THREE.Vector4, ditherFlip: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  // Procedural trees give way to a streamed OSM region's own trees pixel by pixel during its handover (osm/fade.ts).
  mat.defines = { ...(mat.defines ?? {}), OSM_FADE_OUT: 1 };
  mat.name = 'vegetation-tree';
  const own = { uVegFade: { value: fade }, uVegDitherFlip: { value: ditherFlip } };
  patchMaterial(mat, 'vegetation-tree-v1', (shader) => {
    Object.assign(shader.uniforms, shared, own);
    let vs = shader.vertexShader;
    vs = replaceOrWarn(vs, '#include <common>', `#include <common>\n${TREE_VERTEX_PARS}`, 'tree vertex pars');
    vs = replaceOrWarn(
      vs,
      '#include <beginnormal_vertex>',
      'vec3 vegWorldPos;\nvec3 vegWorldNormal;\nvegTransform(vegWorldPos, vegWorldNormal);\nvec3 objectNormal = vegWorldNormal;',
      'tree normal',
    );
    vs = replaceOrWarn(vs, '#include <begin_vertex>', 'vec3 transformed = vegWorldPos;', 'tree position');
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = replaceOrWarn(fs, '#include <common>', `#include <common>\n${TREE_FRAGMENT_PARS}`, 'tree fragment pars');
    fs = replaceOrWarn(
      fs,
      '#include <map_fragment>',
      /* glsl */ `
      vec4 vegAlb = texture(uVegAlbedo, vVegTex);
      vec4 vegNrm = texture(uVegNormal, vVegTex);
      float vegXi = vegIGN(gl_FragCoord.xy);
      vegXi = uVegDitherFlip > 0.5 ? 1.0 - vegXi : vegXi;
      if (vegAlb.a * vegAlphaBoost(vVegTex.xy) < 0.5 || vegXi >= vVegMisc.z) discard;
      diffuseColor.rgb = vegAlb.rgb * vVegTint;
      `,
      'tree albedo',
    );
    fs = replaceOrWarn(fs, '#include <roughnessmap_fragment>', 'float roughnessFactor = vVegMisc.y > 0.5 ? vVegLook.x : vegNrm.a;', 'tree roughness');
    fs = replaceOrWarn(
      fs,
      '#include <normal_fragment_maps>',
      /* glsl */ `
      if (vVegMisc.y > 0.5) {
        normal = normalize(vNormal);
        nonPerturbedNormal = normal;
      }
      {
        vec3 vegMapN = vec3(vegNrm.rg * 2.0 - 1.0, 0.0);
        vegMapN.xy *= mix(1.0, vVegLook.z, vVegMisc.y);
        vegMapN.z = sqrt(max(1.0 - dot(vegMapN.xy, vegMapN.xy), 0.0));
        mat3 vegTbn = vegTangentFrame(-vViewPosition, normal, vVegTex.xy);
        normal = normalize(vegTbn * vegMapN);
      }
      `,
      'tree normal map',
    );
    fs = replaceOrWarn(fs, '#include <lights_fragment_begin>', lightsWithTranslucency(), 'tree translucency');
    fs = replaceOrWarn(
      fs,
      '#include <aomap_fragment>',
      /* glsl */ `
      {
        float vegOcc = vVegMisc.x * mix(1.0, vegNrm.b, 0.8);
        reflectedLight.indirectDiffuse *= vegOcc;
        // Thin, rough, randomly oriented foliage: much weaker sheen than a solid surface with the same normal.
        reflectedLight.indirectSpecular *= vegOcc * vegOcc * mix(1.0, 0.3, vVegMisc.y);
        reflectedLight.directDiffuse *= mix(1.0, vegOcc, 0.35);
        reflectedLight.directSpecular *= mix(1.0, vegOcc, 0.6) * mix(1.0, 0.55, vVegMisc.y);
        float vegT = vVegMisc.y * vegNrm.a * vVegLook.y;
        reflectedLight.directDiffuse += vegTrans * BRDF_Lambert(material.diffuseColor) * vec3(1.15, 1.05, 0.5) * vegT * mix(0.45, 1.0, vegOcc);
      }
      `,
      'tree occlusion',
    );
    shader.fragmentShader = fs;
  });
  return mat;
}

/** Shadow caster program: same instancing/wind/billboarding, alpha tested against the foliage texture. */
export function createTreeDepthMaterial(shared: VegetationSharedUniforms, fade: THREE.Vector4): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  mat.name = 'vegetation-tree-depth';
  const own = { uVegFade: { value: fade } };
  patchMaterial(mat, 'vegetation-tree-depth-v1', (shader) => {
    Object.assign(shader.uniforms, shared, own);
    let vs = shader.vertexShader;
    vs = replaceOrWarn(vs, '#include <common>', `#include <common>\n${TREE_VERTEX_PARS}`, 'depth vertex pars');
    vs = replaceOrWarn(
      vs,
      '#include <begin_vertex>',
      'vec3 vegWorldPos;\nvec3 vegWorldNormal;\nvegTransform(vegWorldPos, vegWorldNormal);\nvec3 transformed = vegWorldPos;',
      'depth position',
    );
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = replaceOrWarn(fs, '#include <common>', `#include <common>\n${TREE_DEPTH_FRAGMENT_PARS}`, 'depth fragment pars');
    fs = replaceOrWarn(fs, '#include <alphatest_fragment>', 'if (vVegMisc.z < 0.5 || texture(uVegAlbedo, vVegTex).a < 0.45) discard;', 'depth alpha');
    shader.fragmentShader = fs;
  });
  return mat;
}

export function createTreeMaterials(shared: VegetationSharedUniforms): TreeMaterialSet {
  const fade0 = new THREE.Vector4(-1, 0, 60, 70);
  const fade1 = new THREE.Vector4(60, 70, 220, 240);
  const lod0 = createMainMaterial(shared, fade0, 0);
  const lod1 = createMainMaterial(shared, fade1, 1);
  const fadeDepth = new THREE.Vector4(-1, 0, 95, 95.01);
  const depth = createTreeDepthMaterial(shared, fadeDepth);
  return {
    lod0,
    lod1,
    depth,
    fade0,
    fade1,
    fadeDepth,
    dispose() {
      lod0.dispose();
      lod1.dispose();
      depth.dispose();
    },
  };
}
