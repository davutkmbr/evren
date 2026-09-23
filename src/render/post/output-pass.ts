import * as THREE from 'three';
import { createPostMaterial, type FullscreenRenderer } from './fullscreen';
import type { PostDebugView } from './options';
import { DEBUG_FRAG, FINAL_FRAG } from './shaders/final.glsl';

const DEBUG_MODE: Record<PostDebugView, number> = { off: 0, hdr: 1, luminance: 2, depth: 3, bloom: 1 };

/** Display-resolution output: upscale + CAS + grain + dither to the canvas, or a debug visualisation. */
export class OutputPass {
  private readonly final: THREE.ShaderMaterial;
  private readonly debug: THREE.ShaderMaterial;

  constructor() {
    this.final = createPostMaterial({
      name: 'post.final',
      fragmentShader: FINAL_FRAG,
      uniforms: {
        tSource: { value: null },
        uSrcSize: { value: new THREE.Vector2(1, 1) },
        uSrcTexel: { value: new THREE.Vector2(1, 1) },
        uUpscale: { value: 0 },
        uSharpness: { value: 0.2 },
        uGrain: { value: 0.01 },
        uFrame: { value: 0 },
      },
    });
    this.debug = createPostMaterial({
      name: 'post.debug',
      fragmentShader: DEBUG_FRAG,
      uniforms: {
        tSource: { value: null },
        tDepth: { value: null },
        uMode: { value: 0 },
        uExposure: { value: 1 },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
      },
    });
  }

  render(
    renderer: THREE.WebGLRenderer,
    fs: FullscreenRenderer,
    source: THREE.WebGLRenderTarget,
    displayWidth: number,
    displayHeight: number,
    sharpen: number,
    grain: number,
    frame: number,
  ): void {
    const u = this.final.uniforms;
    const w = source.width;
    const h = source.height;
    u.tSource.value = source.texture;
    (u.uSrcSize.value as THREE.Vector2).set(w, h);
    (u.uSrcTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    const upscale = w !== displayWidth || h !== displayHeight;
    u.uUpscale.value = upscale ? 1 : 0;
    // Sharpening an upscaled image amplifies resampling edges: ease CAS off with the square of the scale ratio.
    const ratio = Math.min(1, w / displayWidth);
    u.uSharpness.value = THREE.MathUtils.clamp(sharpen * (upscale ? ratio * ratio : 1), 0, 1);
    u.uGrain.value = grain;
    u.uFrame.value = frame;
    fs.draw(renderer, this.final, null);
  }

  renderDebug(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, view: PostDebugView, source: THREE.Texture, depth: THREE.Texture, exposure: number, camera: THREE.PerspectiveCamera): void {
    const u = this.debug.uniforms;
    u.tSource.value = source;
    u.tDepth.value = depth;
    u.uMode.value = DEBUG_MODE[view];
    u.uExposure.value = exposure;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    fs.draw(renderer, this.debug, null);
  }

  dispose(): void {
    this.final.dispose();
    this.debug.dispose();
  }
}
