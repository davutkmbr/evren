import * as THREE from 'three';
import { patchMaterial, streetHole } from '../../core/uniforms';
import { LOD_COUNT, type TerrainTierId } from './config';
import { FRAGMENT_MAIN_GLSL, FRAGMENT_PARS_GLSL } from './glsl/fragment.glsl';
import { VERTEX_BEGIN_GLSL, VERTEX_PARS_GLSL, VERTEX_TERRAIN_GLSL } from './glsl/vertex.glsl';

export interface TerrainUniforms {
  [name: string]: THREE.IUniform;
  uGeoHeight: THREE.IUniform<THREE.Texture | null>;
  uExtMap: THREE.IUniform<THREE.Texture | null>;
  uLandUse: THREE.IUniform<THREE.Texture | null>;
  uCoast: THREE.IUniform<THREE.Texture | null>;
  uDistrictMap: THREE.IUniform<THREE.Texture | null>;
  uRoadData: THREE.IUniform<THREE.Texture | null>;
  uCarpets: THREE.IUniform<THREE.Texture | null>;
  uNature: THREE.IUniform<THREE.Texture | null>;
  uDetail: THREE.IUniform<THREE.Texture | null>;
  uNoise: THREE.IUniform<THREE.Texture | null>;
  uLodMorph: THREE.IUniform<THREE.Vector2[]>;
  uLodCamera: THREE.IUniform<THREE.Vector3>;
  uPatchQuads: THREE.IUniform<number>;
  /** x = carpet start distance, y = 1 / carpet fade length, z = detail distance, w = road detail distance. */
  uTerrainRanges: THREE.IUniform<THREE.Vector4>;
  /** Land-use descriptor table: 3 vec4 per LandUse class. */
  uLandUseTable: THREE.IUniform<THREE.Vector4[]>;
  /** x = debug view (1 lod, 2 land use, 3 grey), y = resources ready (0/1), z = profiling mask. */
  uTerrainDebug: THREE.IUniform<THREE.Vector4>;
  /** Road texture layout: x = width, y = first list row, z = first segment row, w = segment count. */
  uRoadLayout: THREE.IUniform<THREE.Vector4>;
  /** x = emission scale, y = residential window occupancy, z = lights on (0..1). */
  uTerrainLights: THREE.IUniform<THREE.Vector4>;
}

function placeholderTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  t.needsUpdate = true;
  return t;
}

function placeholderNoise(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 128]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function placeholderArray(): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(new Uint8Array(4 * 16).fill(96), 1, 1, 16);
  t.needsUpdate = true;
  return t;
}

export function createTerrainUniforms(): TerrainUniforms {
  const blank = placeholderTexture();
  const blankArray = placeholderArray();
  return {
    uGeoHeight: { value: blank },
    uExtMap: { value: blank },
    uLandUse: { value: blank },
    uCoast: { value: blank },
    uDistrictMap: { value: blank },
    uRoadData: { value: blank },
    uCarpets: { value: blankArray },
    uNature: { value: blankArray },
    uDetail: { value: blankArray },
    uNoise: { value: placeholderNoise() },
    uLodMorph: { value: Array.from({ length: LOD_COUNT }, () => new THREE.Vector2(1e9, 1)) },
    uLodCamera: { value: new THREE.Vector3() },
    uPatchQuads: { value: 32 },
    uTerrainRanges: { value: new THREE.Vector4(6000, 1 / 3000, 700, 5000) },
    uLandUseTable: { value: Array.from({ length: 16 * 3 }, () => new THREE.Vector4()) },
    uTerrainDebug: { value: new THREE.Vector4() },
    uRoadLayout: { value: new THREE.Vector4(1, 0, 0, 0) },
    uTerrainLights: { value: new THREE.Vector4(1, 0, 0, 0) },
  };
}

function replaceOnce(src: string, search: string, replacement: string): string {
  if (!src.includes(search)) {
    console.warn(`[terrain] shader hook not found: ${search}`);
    return src;
  }
  return src.replace(search, replacement);
}

/** Key-light hook: scales the direct sun/moon light by the terrain's own term (micro shadows, facade lighting). */
function lightsChunkWithDirectScale(): string {
  let chunk = THREE.ShaderChunk.lights_fragment_begin;
  chunk = chunk.replace('getSunLightInfo( sunLight, directLight );', 'getSunLightInfo( sunLight, directLight );\n\t\tdirectLight.color *= terrainDirectScale;');
  chunk = chunk.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= terrainDirectScale;',
  );
  return chunk;
}

/**
 * Terrain material for one shading tier: a patched MeshStandardMaterial so the sky's key light, cascaded shadows,
 * cloud shadows, environment lighting and aerial perspective all stay consistent with the rest of the scene.
 */
export function createTerrainMaterial(uniforms: TerrainUniforms, tier: TerrainTierId): THREE.MeshStandardMaterial {
  const material = streetHole(new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, name: `terrain-tier${tier}` }));
  material.defines = { TERRAIN_TIER: tier };
  patchMaterial(material, `terrain-cdlod-3-tier${tier}`, (shader) => {
    for (const key of Object.keys(uniforms)) {
      shader.uniforms[key] = uniforms[key];
    }
    let vs = shader.vertexShader;
    vs = replaceOnce(vs, '#include <common>', `#include <common>\n${VERTEX_PARS_GLSL}`);
    vs = replaceOnce(vs, '#include <beginnormal_vertex>', VERTEX_TERRAIN_GLSL);
    vs = replaceOnce(vs, '#include <begin_vertex>', VERTEX_BEGIN_GLSL);
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = replaceOnce(fs, '#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAGMENT_PARS_GLSL}`);
    fs = replaceOnce(fs, '#include <map_fragment>', FRAGMENT_MAIN_GLSL);
    fs = replaceOnce(fs, '#include <roughnessmap_fragment>', 'float roughnessFactor = terrainSurf.roughness;');
    fs = replaceOnce(fs, '#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;');
    fs = replaceOnce(
      fs,
      '#include <normal_fragment_begin>',
      `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
      vec3 normal = normalize( ( viewMatrix * vec4( terrainSurf.normal, 0.0 ) ).xyz );
      vec3 nonPerturbedNormal = normalize( ( viewMatrix * vec4( terrainSurf.macroNormal, 0.0 ) ).xyz );`,
    );
    fs = replaceOnce(fs, '#include <normal_fragment_maps>', '');
    fs = replaceOnce(fs, '#include <emissivemap_fragment>', 'totalEmissiveRadiance = terrainSurf.emissive;');
    fs = replaceOnce(fs, '#include <lights_fragment_begin>', lightsChunkWithDirectScale());
    fs = replaceOnce(
      fs,
      '#include <aomap_fragment>',
      `reflectedLight.indirectDiffuse *= terrainSurf.ao;
      #if defined( USE_ENVMAP ) && defined( STANDARD )
        reflectedLight.indirectSpecular *= computeSpecularOcclusion( saturate( dot( geometryNormal, geometryViewDir ) ), terrainSurf.ao, material.roughness );
      #endif`,
    );
    shader.fragmentShader = fs;
  });
  return material;
}
