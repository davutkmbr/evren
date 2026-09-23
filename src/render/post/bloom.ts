import * as THREE from 'three';
import { createPostMaterial, type FullscreenRenderer } from './fullscreen';
import { createColorTarget } from './targets';
import { BLOOM_DOWNSAMPLE_FRAG, BLOOM_UPSAMPLE_FRAG } from './shaders/bloom.glsl';

export const BLOOM_LEVELS = 6;

/**
 * Physically based bloom mip chain: 13-tap downsamples (Karis-weighted first level) followed by tent upsamples
 * accumulated additively. The result (mip 0) holds the SUM of all levels; the composite divides by the level count
 * and mixes it energy-conservingly with the scene.
 */
export class BloomChain {
  readonly mips: THREE.WebGLRenderTarget[] = [];
  private readonly sizes: THREE.Vector2[] = [];
  private readonly downFirst: THREE.ShaderMaterial;
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;
  private levelCount = BLOOM_LEVELS;

  constructor() {
    const downUniforms = (): Record<string, THREE.IUniform> => ({
      tSource: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uKarisScale: { value: 1 },
    });
    this.downFirst = createPostMaterial({ name: 'post.bloomDownKaris', fragmentShader: BLOOM_DOWNSAMPLE_FRAG, uniforms: downUniforms(), defines: { KARIS: 1 } });
    this.down = createPostMaterial({ name: 'post.bloomDown', fragmentShader: BLOOM_DOWNSAMPLE_FRAG, uniforms: downUniforms(), defines: { KARIS: 0 } });
    this.up = createPostMaterial({
      name: 'post.bloomUp',
      fragmentShader: BLOOM_UPSAMPLE_FRAG,
      uniforms: {
        tSource: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uRadius: { value: 1 },
        uWeight: { value: 1 },
      },
      blending: 'additive',
    });
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.mips.push(createColorTarget(1, 1, { name: `post.bloom${i}` }));
      this.sizes.push(new THREE.Vector2(1, 1));
    }
  }

  get levels(): number {
    return this.levelCount;
  }

  get result(): THREE.Texture {
    return this.mips[0].texture;
  }

  mipSize(level: number): THREE.Vector2 {
    return this.sizes[level];
  }

  setSize(width: number, height: number): void {
    let w = width;
    let h = height;
    this.levelCount = 0;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.sizes[i].set(w, h);
      this.mips[i].setSize(w, h);
      if (w >= 2 && h >= 2) {
        this.levelCount = i + 1;
      }
    }
    this.levelCount = Math.max(1, this.levelCount);
  }

  /** Downsamples `source` through the chain. `upToLevel` limits the work (exposure metering only needs a few). */
  downsample(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, source: THREE.Texture, sourceWidth: number, sourceHeight: number, karisScale: number, upToLevel = BLOOM_LEVELS - 1): void {
    const last = Math.min(upToLevel, this.levelCount - 1);
    for (let i = 0; i <= last; i++) {
      const mat = i === 0 ? this.downFirst : this.down;
      const src = i === 0 ? source : this.mips[i - 1].texture;
      const sw = i === 0 ? sourceWidth : this.sizes[i - 1].x;
      const sh = i === 0 ? sourceHeight : this.sizes[i - 1].y;
      mat.uniforms.tSource.value = src;
      (mat.uniforms.uTexel.value as THREE.Vector2).set(1 / sw, 1 / sh);
      mat.uniforms.uKarisScale.value = karisScale;
      fs.draw(renderer, mat, this.mips[i]);
    }
  }

  /** Accumulates the chain back into mip 0 (additive tent upsampling). */
  upsample(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, radius: number): void {
    const mat = this.up;
    for (let i = this.levelCount - 1; i > 0; i--) {
      mat.uniforms.tSource.value = this.mips[i].texture;
      (mat.uniforms.uTexel.value as THREE.Vector2).set(1 / this.sizes[i].x, 1 / this.sizes[i].y);
      mat.uniforms.uRadius.value = radius;
      mat.uniforms.uWeight.value = 1;
      fs.draw(renderer, mat, this.mips[i - 1]);
    }
  }

  /** Draws each material once (program compilation up front; the upsample is skipped while bloom is off). */
  warmUp(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, source: THREE.Texture): void {
    this.downsample(renderer, fs, source, 1, 1, 1, 1);
    const mat = this.up;
    mat.uniforms.tSource.value = this.mips[1].texture;
    fs.draw(renderer, mat, this.mips[0]);
  }

  dispose(): void {
    for (const m of this.mips) {
      m.dispose();
    }
    this.downFirst.dispose();
    this.down.dispose();
    this.up.dispose();
  }
}
