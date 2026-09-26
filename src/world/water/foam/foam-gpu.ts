/**
 * GPU side of the foam field (phase 21 stage 7c): two half-float RGBA targets (the window's size², 256²–768² by
 * quality) ping-ponged by one full-window pass per fixed simulation step (FOAM_SIM_FRAG, 20 Hz), then the frame's
 * stamps drawn into the latest target with MAX blending (FOAM_STAMP_*). The water surface samples the latest target
 * through `uFoamField` (uFoamParams.x = 0 turns the sampling off).
 *
 * Cost on "high" (512² x 1 m): a step is 262k fragments of ~26 Gerstner slots + 4 texel fetches + a splat lookup
 * (≈ 350 ALU), ≈ 0.04 ms on the owner's GPU class, run on one frame in three at 60 fps (≈ 0.015 ms averaged); stamps
 * are a few hundred small quads (< 0.01 ms).
 */
import * as THREE from 'three';
import { FullscreenRenderer, createPostMaterial } from '../../../render/post/fullscreen';
import type { WaterUniforms } from '../material';
import { FOAM_SIM } from './config';
import type { FoamWindow } from './foam-window';
import type { FoamStepParams } from './params';
import { FOAM_SIM_FRAG, FOAM_STAMP_FRAG, FOAM_STAMP_VERT } from './shaders.glsl';

/** The water material's uniforms for the field (shared objects: the water material and the sim hold the same references). */
export interface FoamFieldUniforms {
  uFoamField: { value: THREE.Texture };
  uFoamRect: { value: THREE.Vector4 };
  uFoamParams: { value: THREE.Vector4 };
  uFoamCaps: { value: THREE.Vector4 };
  uCrestZ: { value: Float32Array };
}

export function createFoamFieldUniforms(placeholder: THREE.Texture, crestZ: Float32Array): FoamFieldUniforms {
  return {
    uFoamField: { value: placeholder },
    uFoamRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uFoamParams: { value: new THREE.Vector4(0, FOAM_SIM.edgeFade, 0, 0) },
    uFoamCaps: { value: new THREE.Vector4(0, 0.02, 1, 0) },
    uCrestZ: { value: crestZ },
  };
}

const FLOATS = 12;

export class FoamGpu {
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private read = 0;
  private size = 0;
  private readonly quad = new FullscreenRenderer();
  private readonly sim: THREE.ShaderMaterial;
  private readonly stampMaterial: THREE.ShaderMaterial;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly mesh: THREE.Mesh;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private capacity = 0;
  private data = new Float32Array(0);
  private buffer: THREE.InstancedInterleavedBuffer | null = null;
  private readonly placeholder: THREE.Texture;
  /** Simulation passes and stamps drawn in the last frame. */
  passes = 0;
  stamped = 0;

  constructor(
    readonly uniforms: FoamFieldUniforms,
    water: WaterUniforms,
  ) {
    this.placeholder = uniforms.uFoamField.value;
    this.sim = createPostMaterial({
      name: 'water-foam-sim',
      fragmentShader: FOAM_SIM_FRAG,
      uniforms: {
        // The sea's slot table, region / flow / coast maps and the wave particle splat: the water's own uniform objects.
        uWaveDir: water.uWaveDir,
        uWaveAmp: water.uWaveAmp,
        uOrigin: water.uOrigin,
        uGridCenter: water.uGridCenter,
        uWorldRect: water.uWorldRect,
        uGeoHeight: water.uGeoHeight,
        uGeoCoast: water.uGeoCoast,
        uRegionTex: water.uRegionTex,
        uFlowTex: water.uFlowTex,
        uSeaRegime: water.uSeaRegime,
        uWaveTex: water.uWaveTex,
        uWaveRect: water.uWaveRect,
        uWaveParams: water.uWaveParams,
        uCrestZ: uniforms.uCrestZ,
        uPrev: { value: null },
        uGrid: { value: new THREE.Vector4() },
        uShift: { value: new THREE.Vector4() },
        uKeep: { value: new THREE.Vector4(1, 1, 1, 1) },
        uFill: { value: new THREE.Vector4() },
        uCaps: { value: new THREE.Vector4() },
        uBreak: { value: new THREE.Vector4() },
        uDrift: { value: new THREE.Vector4() },
        uSurf: { value: new THREE.Vector4() },
      },
    });
    this.geometry.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.stampMaterial = new THREE.ShaderMaterial({
      name: 'water-foam-stamp',
      vertexShader: FOAM_STAMP_VERT,
      fragmentShader: FOAM_STAMP_FRAG,
      uniforms: { uWin: { value: new THREE.Vector4() } },
      depthTest: false,
      depthWrite: false,
      fog: false,
      lights: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.MaxEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.stampMaterial);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
  }

  private ensureTargets(size: number): [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] {
    if (this.targets && this.size === size) {
      return this.targets;
    }
    this.disposeTargets();
    const make = (name: string): THREE.WebGLRenderTarget => {
      const t = new THREE.WebGLRenderTarget(size, size, {
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
      t.texture.name = name;
      return t;
    };
    this.targets = [make('water-foam-a'), make('water-foam-b')];
    this.size = size;
    this.read = 0;
    return this.targets;
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    this.capacity = Math.max(64, Math.ceil(n / 64) * 64);
    this.data = new Float32Array(this.capacity * FLOATS);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, FLOATS);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iA', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    this.geometry.setAttribute('iB', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    this.geometry.setAttribute('iC', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
  }

  /**
   * Runs this frame's steps (the scroll and a clear in the first; an apply-only pass for a clear without a step), draws
   * the stamps, and points the water uniforms at the result relative to the water shading origin (ox, oz).
   */
  update(renderer: THREE.WebGLRenderer, w: FoamWindow, p: FoamStepParams, originX: number, originZ: number): void {
    this.passes = 0;
    this.stamped = 0;
    const params = this.uniforms.uFoamParams.value;
    if (!w.enabled) {
      params.x = 0;
      if (this.targets) this.disposeTargets();
      w.consumed();
      return;
    }
    const targets = this.ensureTargets(w.size);
    const u = this.sim.uniforms;
    u.uKeep.value.set(p.keepR, p.keepG, p.keepB, p.keepA);
    u.uFill.value.set(p.fillCap, p.fillParticle, p.fillSurf, p.dt);
    u.uCaps.value.set(p.capProb, p.edge, p.capToWake, p.particleToWake);
    u.uBreak.value.set(p.windX, p.windZ, p.omegaOpen, p.capTime);
    u.uDrift.value.set(p.driftX, p.driftZ, p.particleBreak, p.particleEdge);
    u.uSurf.value.set(p.surfBand, p.surfCrest, p.fadeFrom, p.fadeTo);
    const advance = w.steps > 0;
    const steps = advance ? w.steps : w.needsClear ? 1 : 0;
    const prevTarget = renderer.getRenderTarget();
    for (let i = 0; i < steps; i++) {
      const first = i === 0;
      u.uPrev.value = targets[this.read].texture;
      u.uGrid.value.set(w.size, first && w.needsClear ? 1 : 0, w.texel, advance ? 1 : 0);
      u.uShift.value.set(first ? w.shiftX : 0, first ? w.shiftZ : 0, w.minX - originX, w.minZ - originZ);
      const write = 1 - this.read;
      this.quad.draw(renderer, this.sim, targets[write]);
      this.read = write;
      this.passes++;
    }
    if (w.count > 0) {
      this.ensureCapacity(w.count);
      const d = this.data;
      const mx = w.minX;
      const mz = w.minZ;
      for (let k = 0; k < w.count; k++) {
        const s = w.stamps[k];
        const o = k * FLOATS;
        d[o] = s.x0 - mx;
        d[o + 1] = s.z0 - mz;
        d[o + 2] = s.x1 - mx;
        d[o + 3] = s.z1 - mz;
        d[o + 4] = s.r0;
        d[o + 5] = s.r1;
        d[o + 6] = s.ring;
        d[o + 7] = 0;
        d[o + 8] = s.foam;
        d[o + 9] = s.wake;
        d[o + 10] = s.bubbles;
        d[o + 11] = s.slick;
      }
      const buffer = this.buffer!;
      buffer.clearUpdateRanges();
      buffer.addUpdateRange(0, w.count * FLOATS);
      buffer.needsUpdate = true;
      this.geometry.instanceCount = w.count;
      this.stampMaterial.uniforms.uWin.value.set(1 / w.extent, w.texel, 0, 0);
      renderer.setRenderTarget(targets[this.read]);
      renderer.render(this.mesh, this.camera);
      this.stamped = w.count;
    }
    renderer.setRenderTarget(prevTarget);
    w.consumed();
    this.uniforms.uFoamField.value = targets[this.read].texture;
    this.uniforms.uFoamRect.value.set(w.minX - originX, w.minZ - originZ, 1 / w.extent, w.texel);
    params.x = 1;
  }

  private disposeTargets(): void {
    if (this.targets) {
      this.targets[0].dispose();
      this.targets[1].dispose();
      this.targets = null;
    }
    this.size = 0;
    this.uniforms.uFoamField.value = this.placeholder;
  }

  dispose(): void {
    this.disposeTargets();
    this.sim.dispose();
    this.stampMaterial.dispose();
    this.geometry.dispose();
    this.quad.dispose();
  }
}
