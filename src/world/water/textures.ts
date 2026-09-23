import * as THREE from 'three';
import { BAND_COUNT } from './config';
import type { BandBakeResult } from './bake/spectrum-bake';
import type { FoamBakeResult } from './bake/foam-bake';
import type { RegionBakeResult } from './bake/region-bake';
import { toHalf } from './bake/half';

export function createBandTexture(bake: BandBakeResult, anisotropy: number): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(bake.data, bake.size, bake.size, bake.layers);
  tex.name = 'water.bands';
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createFoamTexture(bake: FoamBakeResult, anisotropy: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(bake.data, bake.size, bake.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'water.foam';
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createFlowTexture(bake: RegionBakeResult): THREE.DataTexture {
  const tex = new THREE.DataTexture(bake.flow, bake.size, bake.size, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.name = 'water.flow';
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createRegionTexture(bake: RegionBakeResult): THREE.DataTexture {
  const tex = new THREE.DataTexture(bake.region, bake.size, bake.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'water.region';
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Stand-ins used until the bakes land (flat detail, Bosphorus-like open water). */
export interface PlaceholderTextures {
  bands: THREE.DataArrayTexture;
  foam: THREE.DataTexture;
  flow: THREE.DataTexture;
  region: THREE.DataTexture;
  geo: THREE.DataTexture;
}

export function createPlaceholders(): PlaceholderTextures {
  const bands = new THREE.DataArrayTexture(new Uint16Array(4 * BAND_COUNT), 1, 1, BAND_COUNT);
  bands.type = THREE.HalfFloatType;
  bands.format = THREE.RGBAFormat;
  bands.needsUpdate = true;
  const foam = new THREE.DataTexture(new Uint8Array([0, 0, 0, 128]), 1, 1, THREE.RGBAFormat);
  foam.needsUpdate = true;
  const flow = new THREE.DataTexture(new Uint16Array([0, 0, toHalf(0.6), toHalf(0.6)]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  flow.needsUpdate = true;
  const region = new THREE.DataTexture(new Uint8Array([0, 255, 0, 0]), 1, 1, THREE.RGBAFormat);
  region.needsUpdate = true;
  const geo = new THREE.DataTexture(new Float32Array([-40]), 1, 1, THREE.RedFormat, THREE.FloatType);
  geo.needsUpdate = true;
  return { bands, foam, flow, region, geo };
}
