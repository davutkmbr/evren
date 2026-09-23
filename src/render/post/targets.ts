import * as THREE from 'three';

export interface ColorTargetOptions {
  type?: THREE.TextureDataType;
  filter?: THREE.MagnificationTextureFilter;
  name: string;
}

/** Color-only render target (no depth), clamp-to-edge, no mipmaps. */
export function createColorTarget(width: number, height: number, opts: ColorTargetOptions): THREE.WebGLRenderTarget {
  const filter = opts.filter ?? THREE.LinearFilter;
  const target = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type: opts.type ?? THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: filter,
    magFilter: filter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
  target.texture.name = opts.name;
  return target;
}

/**
 * Linear HDR scene target: RGBA16F color + 32-bit float depth texture (reversed-Z is configured on the renderer).
 * `samples` > 0 renders into multisampled renderbuffers that three resolves into the textures after each render().
 */
export function createSceneTarget(width: number, height: number, samples: number): THREE.WebGLRenderTarget {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
  depthTexture.name = 'post.sceneDepth';
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;
  const target = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture,
    samples,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  target.texture.name = 'post.sceneColor';
  return target;
}
