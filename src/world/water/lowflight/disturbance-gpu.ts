/**
 * GPU side of the sea disturbance field: two RGBA half-float targets (size² texels, 128²–256² by quality) ping-ponged
 * by one full-window pass per fixed simulation step (DISTURBANCE_SIM_FRAG). Runs only while the window is alive; the
 * water surface samples the latest target through `uDistTex` (uDistParams.x = 0 turns the sampling off).
 * Cost on "high" (192²): ≈ 37k fragments × ~10 texel reads per step, 1–3 steps a frame: well under 0.05 ms.
 */
import * as THREE from 'three';
import { FullscreenRenderer, createPostMaterial } from '../../../render/post/fullscreen';
import { DISTURBANCE_SIM } from './config';
import type { DisturbanceWindow } from './disturbance-window';
import { DISTURBANCE_SIM_FRAG, STAMP_VEC4S } from './shaders.glsl';

/** The water material's uniforms for the field (shared objects: the water material holds the same references). */
export interface DisturbanceUniforms {
  uDistTex: { value: THREE.Texture };
  uDistRect: { value: THREE.Vector4 };
  uDistParams: { value: THREE.Vector4 };
}

export function createDisturbanceUniforms(placeholder: THREE.Texture): DisturbanceUniforms {
  return {
    uDistTex: { value: placeholder },
    uDistRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uDistParams: { value: new THREE.Vector4(0, DISTURBANCE_SIM.slopeScale, DISTURBANCE_SIM.roughScale, DISTURBANCE_SIM.foamScale) },
  };
}

const _texel = { x: 0, z: 0 };

export class DisturbanceGpu {
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private read = 0;
  private size = 0;
  private readonly quad = new FullscreenRenderer();
  private readonly material: THREE.ShaderMaterial;
  private readonly stampData: THREE.Vector4[] = [];
  /** Simulation passes drawn in the last frame (0 while the field is off). */
  passes = 0;

  private readonly placeholder: THREE.Texture;

  constructor(readonly uniforms: DisturbanceUniforms) {
    this.placeholder = uniforms.uDistTex.value;
    for (let i = 0; i < DISTURBANCE_SIM.maxStamps * STAMP_VEC4S; i++) {
      this.stampData.push(new THREE.Vector4());
    }
    this.material = createPostMaterial({
      name: 'water-disturbance-sim',
      fragmentShader: DISTURBANCE_SIM_FRAG,
      uniforms: {
        uPrev: { value: null },
        uShift: { value: new THREE.Vector2() },
        uGrid: { value: new THREE.Vector4() },
        uSimA: { value: new THREE.Vector4() },
        uSimB: { value: new THREE.Vector4() },
        uAdvance: { value: 1 },
        uStamps: { value: this.stampData },
      },
    });
  }

  private ensureTargets(size: number): [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] {
    if (this.targets && this.size === size) {
      return this.targets;
    }
    this.disposeTargets();
    const make = (): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(size, size, {
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
    this.targets = [make(), make()];
    this.targets[0].texture.name = 'water-disturbance-a';
    this.targets[1].texture.name = 'water-disturbance-b';
    this.size = size;
    this.read = 0;
    return this.targets;
  }

  /**
   * Runs this frame's simulation steps (scroll, clear and stamps in the first) and points the water uniforms at the
   * result, relative to the water shading origin (ox, oz). While the window is not alive nothing is drawn and the
   * water's sampling is switched off.
   */
  update(renderer: THREE.WebGLRenderer, w: DisturbanceWindow, originX: number, originZ: number): void {
    this.passes = 0;
    const params = this.uniforms.uDistParams.value;
    if (!w.enabled || !w.alive) {
      params.x = 0;
      if (!w.enabled && this.targets) {
        this.disposeTargets();
      }
      w.consumed();
      return;
    }
    const targets = this.ensureTargets(w.size);
    const S = DISTURBANCE_SIM;
    const u = this.material.uniforms;
    const dt = S.step;
    const courant = (S.waveSpeed * dt) / w.texel;
    u.uSimA.value.set(Math.min(courant * courant, 0.45), Math.exp(-S.waveDamping * dt), Math.exp(-S.roughDecay * dt), Math.exp(-S.foamDecay * dt));
    // Stamps, a scroll or a clear never wait for the next fixed step (they would be lost): without a step due the
    // frame runs one apply-only pass that does not advance the simulation.
    const advance = w.steps > 0;
    const steps = advance ? w.steps : w.needsPass ? 1 : 0;
    const prevTarget = renderer.getRenderTarget();
    for (let i = 0; i < steps; i++) {
      const first = i === 0;
      u.uPrev.value = targets[this.read].texture;
      u.uAdvance.value = advance ? 1 : 0;
      u.uShift.value.set(first ? w.shiftX : 0, first ? w.shiftZ : 0);
      u.uGrid.value.set(w.size, first && w.needsClear ? 1 : 0, ((w.originX % 512) + 512) % 512, ((w.originZ % 512) + 512) % 512);
      let count = 0;
      if (first) {
        for (let k = 0; k < w.count; k++) {
          const s = w.stamps[k];
          const base = count * STAMP_VEC4S;
          w.toTexel(s.x0, s.z0, _texel);
          const ax = _texel.x;
          const az = _texel.z;
          w.toTexel(s.x1, s.z1, _texel);
          this.stampData[base].set(ax, az, _texel.x, _texel.z);
          this.stampData[base + 1].set(s.radius / w.texel, s.ring / w.texel, 0, 0);
          this.stampData[base + 2].set(s.height, s.rough, s.foam, s.noise);
          count++;
        }
      }
      u.uSimB.value.set(S.roughDiffuse * dt, 1 - 0.02 * dt, performance.now() * 0.001 % 1000, count);
      const write = 1 - this.read;
      this.quad.draw(renderer, this.material, targets[write]);
      this.read = write;
      this.passes++;
    }
    renderer.setRenderTarget(prevTarget);
    w.consumed();
    this.uniforms.uDistTex.value = targets[this.read].texture;
    this.uniforms.uDistRect.value.set(w.minX - originX, w.minZ - originZ, 1 / w.extent, w.texel);
    params.x = 1;
  }

  private disposeTargets(): void {
    if (this.targets) {
      this.targets[0].dispose();
      this.targets[1].dispose();
      this.targets = null;
    }
    this.size = 0;
    this.uniforms.uDistTex.value = this.placeholder;
  }

  dispose(): void {
    this.disposeTargets();
    this.material.dispose();
    this.quad.dispose();
  }
}
