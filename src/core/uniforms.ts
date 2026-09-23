import * as THREE from 'three';
import { SHARED_GLSL } from '../render/shaders';

/**
 * Global uniforms shared by every shader. The objects are shared by reference: modules may
 * spread them into ShaderMaterial uniforms, and they are injected automatically into every
 * material at compile time (see installGlobalShaderHooks). Only the owner writes each value:
 * - engine: uTime, uCamPos, uCamNear, uCamFar, uResolution
 * - sky:    uTimeOfDay, uSunDir, uSunColor, uMoonDir, uAmbient, uNight, uWind, uFog*
 * Modules may ADD their own globals via registerGlobalUniform() (e.g. clouds -> cloud shadow map).
 */
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
};

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
#endif
`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = applyAtmosphere(gl_FragColor.rgb, vFogWorldPos);
#endif
`;
}
