import * as THREE from 'three';
import { globalUniforms, registerGlobalUniform } from '../../core/uniforms';
import { KEY_LIGHT_HEIGHTS } from './params';

/**
 * Global uniforms added by the sky module (declared in src/render/shaders/atmosphere.glsl.ts).
 * They are registered as soon as the shared GLSL module loads (see atmosphere.glsl.ts) so every program always has a
 * bound sampler, even in sandboxes that do not run the sky system (uAtmoState.y = 0 selects the fallback fog there).
 */
function createPlaceholderLut(): THREE.DataTexture {
  const data = new Uint16Array(4);
  const one = THREE.DataUtils.toHalfFloat(1);
  data.set([THREE.DataUtils.toHalfFloat(0.4), THREE.DataUtils.toHalfFloat(0.5), THREE.DataUtils.toHalfFloat(0.62), one]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.needsUpdate = true;
  return tex;
}

export const atmosphereUniforms = {
  uSkyViewLUT: { value: createPlaceholderLut() as THREE.Texture } as THREE.IUniform<THREE.Texture>,
  /** x: altitude (m) the sky-view LUT was rendered for, y: 1 = sky active, z: haze multiplier, w: aerosol multiplier. */
  uAtmoState: { value: new THREE.Vector4(100, 0, 1, 1) } as THREE.IUniform<THREE.Vector4>,
  uAtmoGround: { value: new THREE.Vector3(0.02, 0.022, 0.025) } as THREE.IUniform<THREE.Vector3>,
  uKeyLightDir: { value: new THREE.Vector3(0, 1, 0) } as THREE.IUniform<THREE.Vector3>,
  uKeyLightColor: { value: new THREE.Vector3(4, 4, 4) } as THREE.IUniform<THREE.Vector3>,
  uKeyLightRatio: { value: KEY_LIGHT_HEIGHTS.map(() => new THREE.Vector3(1, 1, 1)) } as THREE.IUniform<THREE.Vector3[]>,
};

let registered = false;

const neutralCloudShadow = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
neutralCloudShadow.needsUpdate = true;

/**
 * Every lit material samples uCloudShadowMap (key-light patch). If anything clears the shared uniform (null sampler =
 * GL errors on every lit draw), fall back to the neutral texture; the clouds system overwrites it with its own map.
 */
export function ensureCloudShadowSampler(): void {
  const u = globalUniforms.uCloudShadowMap;
  if (u && !u.value) {
    u.value = neutralCloudShadow;
  }
}

export function registerAtmosphereGlobals(): void {
  if (registered) {
    return;
  }
  registered = true;
  for (const [name, uniform] of Object.entries(atmosphereUniforms)) {
    const actual = registerGlobalUniform(name, uniform);
    if (actual !== uniform) {
      (atmosphereUniforms as Record<string, THREE.IUniform>)[name] = actual;
    }
  }
  // The key-light patch calls cloudShadow() in every lit material. Without the clouds system (sandboxes) its sampler
  // would be unbound (GL "two textures of different types" errors), so register neutral placeholders; the clouds
  // system reuses whichever uniform objects are registered first (registerGlobalUniform returns the existing one).
  if (!globalUniforms.uCloudShadowMap) {
    registerGlobalUniform('uCloudShadowMap', { value: neutralCloudShadow });
  }
  if (!globalUniforms.uCloudShadowXform) {
    registerGlobalUniform('uCloudShadowXform', { value: new THREE.Vector4(0, 0, 1 / 32000, 0) });
  }
}
