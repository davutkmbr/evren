/**
 * GPU side of the wave particles (phase 21 stage 7a): a square half-float RGBA window around the camera (256² x 1.5 m
 * on medium, 512² x 1 m on high, 768² x 0.8 m on ultra; off on low) that follows it in whole texels. Every frame the
 * window is cleared and every particle whose kernel touches it is drawn as one oriented quad (instanced, additive):
 * r = height, g/b = its gradient, a = the envelope (for the foam of stage 7c). Stateless: nothing is simulated on the
 * GPU, so scrolling needs no resampling and the picture always matches the CPU particles of this frame.
 *
 * Cost on "high": a 1 MB-per-channel clear plus the particles' kernel areas in texels (a few hundred particles near
 * the camera, ~100-2000 texels each): ≈ 0.3-1 M fragments of ~25 ALU with additive blending, 0.05-0.15 ms on the
 * owner's GPU class; the water shader adds one bilinear fetch per vertex and per pixel inside the window.
 */
import * as THREE from 'three';
import { FullscreenRenderer, createPostMaterial } from '../../../render/post/fullscreen';
import { WAVE_CLEAR_FRAG, WAVE_SPLAT_FRAG, WAVE_SPLAT_VERT } from './shaders.glsl';
import type { WaveParticles } from './wave-particles';

/** The water material's uniforms for the splat window (shared objects: the water material holds the same references). */
export interface WaveSplatUniforms {
  uWaveTex: { value: THREE.Texture };
  uWaveRect: { value: THREE.Vector4 };
  uWaveParams: { value: THREE.Vector4 };
}

export function createWaveSplatUniforms(placeholder: THREE.Texture): WaveSplatUniforms {
  return {
    uWaveTex: { value: placeholder },
    uWaveRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uWaveParams: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
}

/** Window placement in whole texels around a point (shared by the GPU pass and the headless checks). */
export function splatWindow(cx: number, cz: number, size: number, texel: number, out: { minX: number; minZ: number; extent: number }): { minX: number; minZ: number; extent: number } {
  out.minX = Math.floor(cx / texel - size / 2) * texel;
  out.minZ = Math.floor(cz / texel - size / 2) * texel;
  out.extent = size * texel;
  return out;
}

/** Waves shorter than this many texels are faded out of the window (see WAVE_SPLAT_VERT). */
export const SPLAT_MIN_TEXELS = 5;

const FLOATS = 12;

export class WaveSplatGpu {
  private target: THREE.WebGLRenderTarget | null = null;
  private size = 0;
  private capacity = 0;
  private data = new Float32Array(0);
  private buffer: THREE.InstancedInterleavedBuffer | null = null;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly clearMaterial: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad = new FullscreenRenderer();
  private readonly placeholder: THREE.Texture;
  private readonly win = { minX: 0, minZ: 0, extent: 1 };
  /** Particles drawn in the last frame (0 while off). */
  drawn = 0;

  constructor(readonly uniforms: WaveSplatUniforms) {
    this.placeholder = uniforms.uWaveTex.value;
    this.geometry.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.material = new THREE.ShaderMaterial({
      name: 'water-wave-splat',
      vertexShader: WAVE_SPLAT_VERT,
      fragmentShader: WAVE_SPLAT_FRAG,
      uniforms: { uWin: { value: new THREE.Vector4() } },
      depthTest: false,
      depthWrite: false,
      fog: false,
      lights: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
    });
    this.clearMaterial = createPostMaterial({ name: 'water-wave-clear', fragmentShader: WAVE_CLEAR_FRAG, uniforms: {} });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
  }

  private ensure(size: number, capacity: number): THREE.WebGLRenderTarget {
    if (!this.target || this.size !== size) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(size, size, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      this.target.texture.name = 'water-wave-particles';
      this.size = size;
    }
    if (capacity > this.capacity) {
      this.capacity = capacity;
      this.data = new Float32Array(capacity * FLOATS);
      this.buffer = new THREE.InstancedInterleavedBuffer(this.data, FLOATS);
      this.buffer.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute('iA', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
      this.geometry.setAttribute('iB', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
      this.geometry.setAttribute('iC', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
    }
    return this.target;
  }

  /**
   * Draws this frame's particles into the window around (camX, camZ) and points the water uniforms at it, relative to
   * the water shading origin. `size` 0 switches the window (and the water's sampling) off.
   */
  update(renderer: THREE.WebGLRenderer, particles: WaveParticles, camX: number, camZ: number, originX: number, originZ: number, size: number, texel: number): void {
    this.drawn = 0;
    const params = this.uniforms.uWaveParams.value;
    if (size <= 0) {
      params.x = 0;
      if (this.target) {
        this.target.dispose();
        this.target = null;
        this.size = 0;
        this.uniforms.uWaveTex.value = this.placeholder;
      }
      return;
    }
    const target = this.ensure(size, particles.capacity);
    const w = splatWindow(camX, camZ, size, texel, this.win);
    const minLambda = SPLAT_MIN_TEXELS * texel;
    const count = particles.count > 0 ? particles.writeSplat(w.minX, w.minZ, w.extent, this.data, this.capacity, minLambda) : 0;
    if (count === 0 || !this.buffer) {
      // Nothing near the camera: the water skips its lookups entirely (the stale window is never sampled).
      params.x = 0;
      return;
    }
    const prev = renderer.getRenderTarget();
    this.quad.draw(renderer, this.clearMaterial, target);
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, count * FLOATS);
    this.buffer.needsUpdate = true;
    this.geometry.instanceCount = count;
    this.material.uniforms.uWin.value.set(1 / w.extent, texel, minLambda, 0);
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, this.camera);
    renderer.setRenderTarget(prev);
    this.drawn = count;
    this.uniforms.uWaveTex.value = target.texture;
    this.uniforms.uWaveRect.value.set(w.minX - originX, w.minZ - originZ, 1 / w.extent, texel);
    params.x = 1;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.geometry.dispose();
    this.material.dispose();
    this.clearMaterial.dispose();
    this.quad.dispose();
    this.uniforms.uWaveTex.value = this.placeholder;
  }
}
