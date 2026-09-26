import * as THREE from 'three';
import { REGION_OPTICS, type WaterOptics } from './config';
import type { DisturbanceUniforms } from './lowflight/disturbance-gpu';
import type { WaveSplatUniforms } from './particles/splat-gpu';
import type { SeaStateUniforms } from './sea-state';
import { WATER_FRAGMENT_GLSL } from './shaders/water-fragment.glsl';
import { WATER_VERTEX_GLSL } from './shaders/water-vertex.glsl';

export interface WaterUniforms extends SeaStateUniforms, DisturbanceUniforms, WaveSplatUniforms {
  uOrigin: { value: THREE.Vector2 };
  uGridCenter: { value: THREE.Vector2 };
  uWorldRect: { value: THREE.Vector4 };
  uGeoHeight: { value: THREE.Texture };
  uGeoCoast: { value: THREE.Texture };
  uRegionTex: { value: THREE.Texture };
  uFlowTex: { value: THREE.Texture };
  uBands: { value: THREE.Texture };
  uFoamTex: { value: THREE.Texture };
  uReflTex: { value: THREE.Texture };
  uReflDepth: { value: THREE.Texture | null };
  uReflMatrix: { value: THREE.Matrix4 };
  uReflInvProj: { value: THREE.Matrix4 };
  uReflParams: { value: THREE.Vector4 };
  uRrs: { value: THREE.Vector3[] };
  uAtten: { value: THREE.Vector3[] };
  uFloorAlbedo: { value: THREE.Vector3[] };
  uRoughness: { value: number[] };
  /** 1 while the camera is under the water (underwater service): the surface shades its underside. */
  uCamUnder: { value: number };
}

export interface WaterTextureSet {
  geoHeight: THREE.Texture;
  geoCoast: THREE.Texture;
  region: THREE.Texture;
  flow: THREE.Texture;
  bands: THREE.Texture;
  foam: THREE.Texture;
  reflection: THREE.Texture;
  reflectionDepth: THREE.Texture | null;
}

const OPTICS_ORDER: WaterOptics[] = [REGION_OPTICS.blackSea, REGION_OPTICS.bosphorus, REGION_OPTICS.marmara, REGION_OPTICS.goldenHorn, REGION_OPTICS.lake];

function vec3List(pick: (o: WaterOptics) => readonly [number, number, number]): THREE.Vector3[] {
  return OPTICS_ORDER.map((o) => new THREE.Vector3(...pick(o)));
}

export function createWaterUniforms(sea: SeaStateUniforms, textures: WaterTextureSet, worldRect: THREE.Vector4, disturbance: DisturbanceUniforms, splat: WaveSplatUniforms): WaterUniforms {
  return {
    ...sea,
    // The disturbance field's uniform objects are shared with the low-flight controller, which updates them.
    ...disturbance,
    // Likewise the wave particle splat window's (updated by the splat pass).
    ...splat,
    uOrigin: { value: new THREE.Vector2() },
    uGridCenter: { value: new THREE.Vector2() },
    uWorldRect: { value: worldRect },
    uGeoHeight: { value: textures.geoHeight },
    uGeoCoast: { value: textures.geoCoast },
    uRegionTex: { value: textures.region },
    uFlowTex: { value: textures.flow },
    uBands: { value: textures.bands },
    uFoamTex: { value: textures.foam },
    uReflTex: { value: textures.reflection },
    uReflDepth: { value: textures.reflectionDepth },
    uReflMatrix: { value: new THREE.Matrix4() },
    uReflInvProj: { value: new THREE.Matrix4() },
    uReflParams: { value: new THREE.Vector4(0, 0.45, 0, 0) },
    uRrs: { value: vec3List((o) => o.rrs) },
    uAtten: { value: vec3List((o) => o.attenuation) },
    uFloorAlbedo: { value: vec3List((o) => o.floor) },
    uRoughness: { value: OPTICS_ORDER.map((o) => o.roughness) },
    uCamUnder: { value: 0 },
  };
}

/**
 * The water ShaderMaterial. `lights: true` only so three binds the key light's cascaded shadow map (sampled directly
 * with getSunShadow); all other lighting is evaluated in the shader from the shared sky uniforms.
 */
export function createWaterMaterial(uniforms: WaterUniforms, bands: number, debugView = 0): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: 'water',
    vertexShader: WATER_VERTEX_GLSL,
    fragmentShader: WATER_FRAGMENT_GLSL,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights), ...uniforms } as Record<string, THREE.IUniform>,
    defines: { WATER_BANDS: bands, WATER_DEBUG: debugView },
    lights: true,
    fog: false,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    transparent: false,
  });
  return material;
}
