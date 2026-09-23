import * as THREE from 'three';
import { registerGlobalUniform } from '../../core/uniforms';
import { CLOUD_CONSTANTS } from './config';

/**
 * Key-light gain standing in for the high-order multiple scattering the 4-octave model under-estimates (bright,
 * milky sunlit cumulus). Moonlit clouds keep less of it so they stay dim against the night sky.
 */
export const KEY_LIGHT_GAIN_DAY = 3.4;
export const KEY_LIGHT_GAIN_NIGHT = 1.7;

/** Uniform objects shared by reference between every cloud material. */
export interface CloudUniformSet {
  uCloudWeather: THREE.IUniform<THREE.Texture | null>;
  uCloudBaseNoise: THREE.IUniform<THREE.Texture | null>;
  uCloudDetailNoise: THREE.IUniform<THREE.Texture | null>;
  uCloudCirrus: THREE.IUniform<THREE.Texture | null>;
  uCloudGlow: THREE.IUniform<THREE.Texture | null>;
  uCloudWind: THREE.IUniform<THREE.Vector4>;
  uCloudWind2: THREE.IUniform<THREE.Vector4>;
  uCloudShape: THREE.IUniform<THREE.Vector4>;
  uCloudLightDir: THREE.IUniform<THREE.Vector3>;
  uCloudLightColor: THREE.IUniform<THREE.Color>;
  uCloudAmbientTop: THREE.IUniform<THREE.Color>;
  uCloudAmbientBottom: THREE.IUniform<THREE.Color>;
  uCloudGlowColor: THREE.IUniform<THREE.Color>;
  uCloudMisc: THREE.IUniform<THREE.Vector4>;
  uCloudTune: THREE.IUniform<THREE.Vector4>;
}

export function createCloudUniforms(): CloudUniformSet {
  return {
    uCloudWeather: { value: null },
    uCloudBaseNoise: { value: null },
    uCloudDetailNoise: { value: null },
    uCloudCirrus: { value: null },
    uCloudGlow: { value: null },
    uCloudWind: { value: new THREE.Vector4() },
    uCloudWind2: { value: new THREE.Vector4() },
    uCloudShape: { value: new THREE.Vector4(0, CLOUD_CONSTANTS.extinction, 1.0, CLOUD_CONSTANTS.cumulusBaseMean) },
    uCloudLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uCloudLightColor: { value: new THREE.Color(0, 0, 0) },
    uCloudAmbientTop: { value: new THREE.Color(0.3, 0.35, 0.45) },
    uCloudAmbientBottom: { value: new THREE.Color(0.12, 0.13, 0.15) },
    uCloudGlowColor: { value: new THREE.Color(0, 0, 0) },
    uCloudMisc: { value: new THREE.Vector4(-1e5, -1e5, 0.7, KEY_LIGHT_GAIN_DAY) },
    uCloudTune: { value: new THREE.Vector4(1, 1, 1, 1) },
  };
}

export interface CloudShadowGlobals {
  map: THREE.IUniform<THREE.Texture>;
  xform: THREE.IUniform<THREE.Vector4>;
  white: THREE.DataTexture;
}

let shadowGlobals: CloudShadowGlobals | null = null;

/**
 * Registers uCloudShadowMap / uCloudShadowXform into the global uniforms (idempotent). Must run before any
 * material that calls cloudShadow() compiles, so createCloudSystem() calls it immediately.
 */
export function registerCloudShadowGlobals(): CloudShadowGlobals {
  if (shadowGlobals) {
    return shadowGlobals;
  }
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  white.needsUpdate = true;
  const map = registerGlobalUniform('uCloudShadowMap', { value: white }) as THREE.IUniform<THREE.Texture>;
  const xform = registerGlobalUniform('uCloudShadowXform', { value: new THREE.Vector4(0, 0, 1 / 32000, 0) }) as THREE.IUniform<THREE.Vector4>;
  shadowGlobals = { map, xform, white };
  return shadowGlobals;
}
