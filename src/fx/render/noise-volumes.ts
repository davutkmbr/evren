import * as THREE from 'three';
import { FULLSCREEN_VERTEX, NOISE_GEN_FRAGMENT } from '../shaders/composite.glsl';

export interface NoiseVolumes {
  /** 64³ RGBA8 tileable: R perlin-worley billows, G detail fbm, B cellular, A fine fbm. */
  noise: THREE.Data3DTexture;
  /** 32³ RGBA8 tileable divergence-free curl field (xyz * 0.5 + 0.5). */
  curl: THREE.Data3DTexture;
  dispose(): void;
}

function renderVolume(renderer: THREE.WebGLRenderer, size: number, mode: number): THREE.WebGL3DRenderTarget {
  const target = new THREE.WebGL3DRenderTarget(size, size, size, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  const tex = target.texture;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapR = THREE.RepeatWrapping;

  const material = new THREE.ShaderMaterial({
    uniforms: { uZ: { value: 0 }, uMode: { value: mode } },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: NOISE_GEN_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  for (let z = 0; z < size; z++) {
    material.uniforms.uZ.value = (z + 0.5) / size;
    renderer.setRenderTarget(target, z);
    renderer.render(scene, camera);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  material.dispose();
  quad.geometry.dispose();
  return target;
}

/** Generates the fx noise volumes on the GPU (~100 tiny draws, once). */
export function createNoiseVolumes(renderer: THREE.WebGLRenderer): NoiseVolumes {
  const noiseTarget = renderVolume(renderer, 64, 0);
  const curlTarget = renderVolume(renderer, 32, 1);
  return {
    noise: noiseTarget.texture,
    curl: curlTarget.texture,
    dispose() {
      noiseTarget.dispose();
      curlTarget.dispose();
    },
  };
}
