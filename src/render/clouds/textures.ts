import * as THREE from 'three';
import { BASE_NOISE_SIZE, CIRRUS_SIZE, DETAIL_NOISE_SIZE, WEATHER_SIZE } from './config';
import { BAKE_BASE_FRAGMENT, BAKE_CIRRUS_FRAGMENT, BAKE_DETAIL_FRAGMENT, BAKE_WEATHER_FRAGMENT } from './glsl/bake.glsl';
import { createPassMaterial, type FullscreenQuad } from './fullscreen';

export interface CloudTextures {
  base: THREE.Texture;
  detail: THREE.Texture;
  weather: THREE.Texture;
  cirrus: THREE.Texture;
  /** Weather render target (for CPU readback in debug tools). */
  weatherTarget: THREE.WebGLRenderTarget;
  dispose(): void;
}

function create3DTarget(size: number): THREE.WebGL3DRenderTarget {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const tex = rt.texture;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapR = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return rt;
}

function create2DTarget(size: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    anisotropy: 4,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

/** Renders every slice of a 3D target; mipmaps are generated once, after the last slice. */
function bakeVolume(renderer: THREE.WebGLRenderer, quad: FullscreenQuad, rt: THREE.WebGL3DRenderTarget, fragment: string): void {
  const size = rt.width;
  const material = createPassMaterial(fragment, { uLayer: { value: 0 }, uSize: { value: size } });
  renderer.initRenderTarget(rt);
  rt.texture.generateMipmaps = false;
  for (let layer = 0; layer < size; layer++) {
    material.uniforms.uLayer.value = layer;
    if (layer === size - 1) {
      rt.texture.generateMipmaps = true;
    }
    quad.render(renderer, material, rt, layer);
  }
  material.dispose();
}

function bakePlane(renderer: THREE.WebGLRenderer, quad: FullscreenQuad, rt: THREE.WebGLRenderTarget, fragment: string): void {
  const material = createPassMaterial(fragment, {});
  quad.render(renderer, material, rt);
  material.dispose();
}

/**
 * Generates all cloud noise textures on the GPU (a few ms): tileable Perlin-Worley 128^3 base shape,
 * Worley 32^3 detail, 1024^2 weather map and 512^2 cirrus map. Nothing is loaded from disk.
 */
export function bakeCloudTextures(renderer: THREE.WebGLRenderer, quad: FullscreenQuad): CloudTextures {
  const prevTarget = renderer.getRenderTarget();
  const base = create3DTarget(BASE_NOISE_SIZE);
  const detail = create3DTarget(DETAIL_NOISE_SIZE);
  const weather = create2DTarget(WEATHER_SIZE);
  const cirrus = create2DTarget(CIRRUS_SIZE);
  bakeVolume(renderer, quad, base, BAKE_BASE_FRAGMENT);
  bakeVolume(renderer, quad, detail, BAKE_DETAIL_FRAGMENT);
  bakePlane(renderer, quad, weather, BAKE_WEATHER_FRAGMENT);
  bakePlane(renderer, quad, cirrus, BAKE_CIRRUS_FRAGMENT);
  renderer.setRenderTarget(prevTarget);
  return {
    base: base.texture,
    detail: detail.texture,
    weather: weather.texture,
    cirrus: cirrus.texture,
    weatherTarget: weather,
    dispose() {
      base.dispose();
      detail.dispose();
      weather.dispose();
      cirrus.dispose();
    },
  };
}
