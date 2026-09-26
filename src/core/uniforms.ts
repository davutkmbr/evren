import * as THREE from 'three';
import { SHARED_GLSL } from '../render/shaders';
import { registerAtmosphereGlobals } from '../render/sky/globals';
import { FADE_SLOTS, STREET_DITHER_GLSL } from '../street/fade';
import { OCCLUDER_FADE_GLSL, OCCLUDER_FADE_PARS_GLSL, occluderUniforms } from './occluder-fade';

/** Fade table of the street tiles (see street/fade.ts) until the street layer sets its own: every slot fully in. */
function defaultStreetFade(): THREE.DataTexture {
  const data = new Uint8Array(FADE_SLOTS).fill(255);
  data[0] = 0;
  const t = new THREE.DataTexture(data, FADE_SLOTS, 1, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/**
 * Global uniforms shared by every shader. The objects are shared by reference: modules may
 * spread them into ShaderMaterial uniforms, and they are injected automatically into every
 * material at compile time (see installGlobalShaderHooks). Only the owner writes each value:
 * - engine: uTime, uCamPos, uCamNear, uCamFar, uResolution
 * - sky:    uTimeOfDay, uSunDir, uSunColor, uMoonDir, uAmbient, uNight, uWind, uFog*
 * Modules may ADD their own globals via registerGlobalUniform() (e.g. clouds -> cloud shadow map).
 */
/** Streamed OSM regions holding a handover slot at once (world/osm/index.ts MAX_LOADED, plus regions fading out). */
export const OSM_FADE_SLOTS = 12;

export const globalUniforms: Record<string, THREE.IUniform> = {
  uTime: { value: 0 },
  uTimeOfDay: { value: 18.5 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.25, -0.9).normalize() },
  uSunColor: { value: new THREE.Color(3.0, 2.5, 2.0) },
  uMoonDir: { value: new THREE.Vector3(-0.3, 0.5, 0.8).normalize() },
  uAmbient: { value: new THREE.Color(0.35, 0.42, 0.55) },
  uNight: { value: 0 },
  uWind: { value: new THREE.Vector3(4, 0, 2) },
  uCamPos: { value: new THREE.Vector3() },
  uCamNear: { value: 0.1 },
  uCamFar: { value: 60000 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uFogDensity: { value: 0.00006 },
  uFogHeightFalloff: { value: 0.0012 },
  uFogColor: { value: new THREE.Color(0.62, 0.68, 0.78) },
  /**
   * Street layer (src/world/street): hole mask valid inside uStreetHoleRect (minX, minZ, sizeX, sizeZ) and addressed by
   * world xz / size with repeat wrapping (it follows the camera without being moved); red = ground materials,
   * green = building materials (streetHole). A texel holds the fade slot (byte value, 0 = no hole) of the street tile
   * that replaces the geometry there; uStreetFade maps slots to that tile's fade (see street/fade.ts).
   */
  uStreetHoleMask: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) },
  uStreetHoleRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  uStreetFade: { value: defaultStreetFade() },
  /** Occluder fade (core/occluder-fade.ts): written by the camera system while the perch camera frames the dragon. */
  ...occluderUniforms,
  /**
   * Handover of the flight-scale OSM regions (world/osm/fade.ts): per slot a build rect (minX, minZ, maxX, maxZ) and its
   * fade (x) and direction (y: 1 fading out). Materials with the OSM_FADE define (every material of a streamed region)
   * dither against it, complementary to the city chunks they replace (city/materials/city.glsl.ts CITY_FADE_FRAGMENT);
   * OSM_FADE_OUT materials (the procedural trees) draw the complementary pixels.
   */
  uOsmFadeRect: { value: Array.from({ length: OSM_FADE_SLOTS }, () => new THREE.Vector4(1e9, 1e9, 1e9, 1e9)) },
  uOsmFadeVal: { value: Array.from({ length: OSM_FADE_SLOTS }, () => new THREE.Vector2(1, 0)) },
};

/**
 * Flight-scale materials that the street layer replaces up close: fragments the street hole mask marks are discarded
 * (the live street tiles bring their own buildings, ground and props). Needs the material's fog (the hook sits in the
 * fog chunk). `ground` materials (terrain, street ground, cover, street furniture) read the mask's red channel, which
 * covers the live tiles; `building` materials read the green channel, which follows whole buildings (the compiled
 * buildings' footprints, minus the buildings the live tiles do not draw), so no slice building is cut at a tile edge.
 * `at` is a GLSL vec2 expression (world xz, a varying of the material) tested instead of the fragment's position,
 * e.g. the anchor of an instanced facade detail.
 */
export function streetHole<T extends THREE.Material>(material: T, channel: 'ground' | 'building' = 'ground', at?: string): T {
  material.defines = { ...(material.defines ?? {}), STREET_HOLE: channel === 'building' ? 1 : 0, ...(at ? { STREET_HOLE_AT: at } : {}) };
  material.needsUpdate = true;
  return material;
}

export function registerGlobalUniform(name: string, uniform: THREE.IUniform): THREE.IUniform {
  const existing = globalUniforms[name];
  if (existing) {
    return existing;
  }
  globalUniforms[name] = uniform;
  return uniform;
}

/** Adds the global uniform references to a shader object (call from onBeforeCompile). */
export function injectGlobalUniforms(shader: { uniforms: Record<string, THREE.IUniform> }): void {
  for (const key in globalUniforms) {
    if (!(key in shader.uniforms)) {
      shader.uniforms[key] = globalUniforms[key];
    }
  }
}

export type ShaderPatch = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

/**
 * Patch a built-in material (MeshStandardMaterial etc.) safely: global uniforms are injected
 * first, then your patch runs. `cacheKey` must uniquely identify the patch variant.
 * SHARED_GLSL is available inside the fragment shader of every built-in material (via fog_pars_fragment),
 * so patches can call applyAtmosphere(), fbm2(), cloudShadow()... in fragment code.
 */
export function patchMaterial<T extends THREE.Material>(material: T, cacheKey: string, patch: ShaderPatch): T {
  material.onBeforeCompile = (shader, renderer) => {
    injectGlobalUniforms(shader);
    patch(shader, renderer);
  };
  material.customProgramCacheKey = () => cacheKey;
  return material;
}

let installed = false;
/** three's own clipping chunk, extended by installGlobalShaderHooks (kept so a second install cannot stack). */
const CLIPPING_PLANES_FRAGMENT = THREE.ShaderChunk.clipping_planes_fragment;

/**
 * Installs:
 * 1. A default Material.onBeforeCompile that injects global uniforms into every program.
 * 2. Fog chunk replacements so all built-in materials get physically based aerial perspective
 *    (applyAtmosphere) instead of three's linear fog, plus SHARED_GLSL in their fragment shaders.
 * The scene must have `scene.fog` set (any Fog instance) for USE_FOG to be defined.
 */
export function installGlobalShaderHooks(): void {
  if (installed) {
    return;
  }
  installed = true;

  const proto = THREE.Material.prototype as THREE.Material;
  proto.onBeforeCompile = function onBeforeCompileGlobal(shader: THREE.WebGLProgramParametersWithUniforms) {
    injectGlobalUniforms(shader);
  };

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif
`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif
`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
${SHARED_GLSL}
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  #if defined(OSM_FADE) || defined(OSM_FADE_OUT)
    uniform vec4 uOsmFadeRect[${OSM_FADE_SLOTS}];
    uniform vec2 uOsmFadeVal[${OSM_FADE_SLOTS}];
  #endif
  #ifdef STREET_HOLE
    uniform sampler2D uStreetHoleMask;
    uniform vec4 uStreetHoleRect;
    uniform sampler2D uStreetFade;
    ${STREET_DITHER_GLSL}
  #endif
  ${OCCLUDER_FADE_PARS_GLSL}
#endif
`;
  /**
   * Street hole test: fragments of flight-scale materials under a live street tile are discarded. It runs at the start
   * of the fragment shader (after three's clipping planes, where its own alpha-test-like discards sit), so the
   * geometry the street tiles replace is not lit and fogged before it is thrown away; the fog chunk keeps it for
   * shaders without the clipping chunk.
   */
  const streetHoleTest = /* glsl */ `
#if defined(USE_FOG) && defined(STREET_HOLE) && !defined(STREET_HOLE_DONE)
  #define STREET_HOLE_DONE
  {
    #ifdef STREET_HOLE_AT
    vec2 streetW = STREET_HOLE_AT;
    #else
    vec2 streetW = vFogWorldPos.xz;
    #endif
    vec2 streetUv = (streetW - uStreetHoleRect.xy) / uStreetHoleRect.zw;
    if (all(greaterThan(streetUv, vec2(0.0))) && all(lessThan(streetUv, vec2(1.0)))) {
      // The mask wraps (world position over its size, street/index.ts HoleMask); the window test above bounds it.
      float streetSlot = floor(texture2D(uStreetHoleMask, streetW / uStreetHoleRect.zw)[STREET_HOLE] * 255.0 + 0.5);
      // Complementary to the street tile's own dither (street/fade.ts): each pixel shows one of the two.
      if (streetSlot > 0.5 && streetFadeAt(uStreetFade, streetSlot) > streetDither()) discard;
    }
  }
#endif
`;
  /**
   * OSM region handover: fragments of a streamed region's materials dither in (or out) with the region's slot, with the
   * city chunks' own dither pattern so the two sides fill complementary pixels.
   */
  const osmFadeTest = /* glsl */ `
#if defined(USE_FOG) && (defined(OSM_FADE) || defined(OSM_FADE_OUT)) && !defined(OSM_FADE_DONE)
  #define OSM_FADE_DONE
  for (int osmI = 0; osmI < ${OSM_FADE_SLOTS}; osmI++) {
    vec4 osmR = uOsmFadeRect[osmI];
    if (vFogWorldPos.x >= osmR.x && vFogWorldPos.x < osmR.z && vFogWorldPos.z >= osmR.y && vFogWorldPos.z < osmR.w) {
      vec2 osmF = uOsmFadeVal[osmI];
      float osmDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      bool osmShown = osmF.y > 0.5 ? osmDither >= 1.0 - osmF.x : osmDither < osmF.x;
      #ifdef OSM_FADE_OUT
      // What the region replaces (the procedural trees): the complementary pixels.
      if (osmShown) discard;
      #else
      if (!osmShown) discard;
      #endif
      break;
    }
  }
#endif
`;
  THREE.ShaderChunk.clipping_planes_fragment = CLIPPING_PLANES_FRAGMENT + streetHoleTest + osmFadeTest + OCCLUDER_FADE_GLSL;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
${streetHoleTest}
${osmFadeTest}
${OCCLUDER_FADE_GLSL}
#ifdef USE_FOG
  gl_FragColor.rgb = applyAtmosphere(gl_FragColor.rgb, vFogWorldPos);
#endif
`;
}

// SHARED_GLSL declares the sky's atmosphere and cloud-shadow uniforms (render/sky/globals.ts registers them while the
// shader chunks load). When this module is the first of that import cycle, the chunks load before `globalUniforms`
// exists and the registration has to wait: finish it here, synchronously, so no program can compile without them.
registerAtmosphereGlobals();
