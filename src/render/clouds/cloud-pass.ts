import * as THREE from 'three';
import type { EngineContext, HdrPass, HdrPassInputs } from '../../core/contracts';
import { SHARED_GLSL } from '../shaders';
import { CLOUD_CONSTANTS, type CloudQualityLevel } from './config';
import type { CloudUniformSet } from './cloud-uniforms';
import { createPassMaterial, type FullscreenQuad } from './fullscreen';
import { CLOUD_COMMON_GLSL, glslFloat } from './glsl/cloud-common.glsl';
import { AMBIENT_FRAGMENT, COMPOSITE_FRAGMENT, MARCH_FRAGMENT, TEMPORAL_FRAGMENT } from './glsl/passes.glsl';
import type { BlueNoiseTexture } from './blue-noise';

const WARMUP_FRAMES = 14;
/** Camera jump (m) that invalidates the temporal history (teleports, camera cuts). */
const HISTORY_RESET_DISTANCE = 350;

function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** MRT low-res target; colour is linearly filterable (cubic upsample), aux/age are read with texelFetch only. */
function createLowResTarget(w: number, h: number, count: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    count,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
  });
  for (const t of rt.textures) {
    t.colorSpace = THREE.NoColorSpace;
  }
  return rt;
}

/**
 * Volumetric cloud HdrPass: low-res jittered raymarch -> temporal reprojection -> depth-aware
 * upsample + composite over the HDR scene (respecting reversed-Z scene depth).
 */
export class CloudPass implements HdrPass {
  readonly name = 'clouds';
  readonly order = 100;
  enabled = true;

  private readonly ambient: THREE.ShaderMaterial;
  private readonly ambientTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  private readonly march: THREE.ShaderMaterial;
  private readonly temporal: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly rayUniforms = {
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCloudCamPos: { value: new THREE.Vector3() },
  };
  private raw: THREE.WebGLRenderTarget | null = null;
  private history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private historyIndex = 0;
  private historyValid = false;
  /** Allocated low-res size (from the largest possible output) and the active viewport inside it. */
  private allocW = 0;
  private allocH = 0;
  private lowW = 0;
  private lowH = 0;
  private histW = 0;
  private histH = 0;
  private divisor = 3;
  private frame = 0;
  private warmup = WARMUP_FRAMES;
  private lastRenderFrame = -1;
  private readonly viewProj = new THREE.Matrix4();
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly camPos = new THREE.Vector3();
  private readonly prevCamPos = new THREE.Vector3();
  private readonly bufferSize = new THREE.Vector2();
  private lastInputs: HdrPassInputs | null = null;
  private lastOutput: THREE.WebGLRenderTarget | null = null;
  private lastCtx: EngineContext | null = null;

  constructor(
    private readonly quad: FullscreenQuad,
    shared: CloudUniformSet,
    level: CloudQualityLevel,
    blueNoise: BlueNoiseTexture,
  ) {
    const ray = this.rayUniforms;
    this.ambient = createPassMaterial(`${SHARED_GLSL}\n${CLOUD_COMMON_GLSL}\n${AMBIENT_FRAGMENT}`, {
      ...(shared as unknown as Record<string, THREE.IUniform>),
    });
    this.march = createPassMaterial(
      `${SHARED_GLSL}\n${CLOUD_COMMON_GLSL}\n${MARCH_FRAGMENT}`,
      {
        ...(shared as unknown as Record<string, THREE.IUniform>),
        ...ray,
        tDepth: { value: null },
        tBlueNoise: { value: blueNoise.texture },
        uLowSize: { value: new THREE.Vector2(1, 1) },
        uFrame: { value: 0 },
        uPixelAngle: { value: 0.002 },
        uSubPixel: { value: new THREE.Vector2() },
        tSkyAmbient: { value: this.ambientTarget.texture },
      },
      {
        CLOUD_STEPS: level.steps,
        CLOUD_STEP_REL: glslFloat(level.stepRel),
        CLOUD_LIGHT_STEPS: level.lightSteps,
        CLOUD_MAX_DIST: glslFloat(CLOUD_CONSTANTS.maxDistance),
        CLOUD_FINE_CAP: glslFloat(120),
      },
    );
    this.temporal = createPassMaterial(`${SHARED_GLSL}\n${TEMPORAL_FRAGMENT}`, {
      ...ray,
      tCur: { value: null },
      tCurAux: { value: null },
      tHist: { value: null },
      tHistAux: { value: null },
      tHistAge: { value: null },
      uPrevViewProj: { value: this.prevViewProj },
      uPrevCamPos: { value: this.prevCamPos },
      uLowSize: { value: new THREE.Vector2(1, 1) },
      uHistSize: { value: new THREE.Vector2(1, 1) },
      uHistoryValid: { value: 0 },
      uBlend: { value: 0.05 },
      uPixelAngle: this.march.uniforms.uPixelAngle,
    });
    this.composite = createPassMaterial(`${SHARED_GLSL}\n${COMPOSITE_FRAGMENT}`, {
      ...ray,
      tScene: { value: null },
      tDepth: { value: null },
      tCloud: { value: null },
      tCloudAux: { value: null },
      uLowSize: { value: new THREE.Vector2(1, 1) },
      uAllocSize: { value: new THREE.Vector2(1, 1) },
    });
    this.setLevel(level);
  }

  get materials(): THREE.Material[] {
    return [this.ambient, this.march, this.temporal, this.composite];
  }

  /** True while the temporal history is still converging after a reset (and the pass is actually running). */
  isWarmingUp(engineFrame: number): boolean {
    return this.enabled && this.warmup > 0 && this.lastRenderFrame >= 0 && engineFrame - this.lastRenderFrame < 4;
  }

  /** Applies a quality level; the history is only reset when the level actually changes the rendering. */
  setLevel(level: CloudQualityLevel): void {
    let changed = false;
    const d = this.march.defines as Record<string, string | number>;
    if (d.CLOUD_STEPS !== level.steps || d.CLOUD_LIGHT_STEPS !== level.lightSteps || d.CLOUD_STEP_REL !== glslFloat(level.stepRel)) {
      d.CLOUD_STEPS = level.steps;
      d.CLOUD_STEP_REL = glslFloat(level.stepRel);
      d.CLOUD_LIGHT_STEPS = level.lightSteps;
      this.march.needsUpdate = true;
      changed = true;
    }
    if (this.divisor !== level.divisor) {
      this.divisor = level.divisor;
      this.allocW = 0;
      changed = true;
    }
    if (changed) {
      this.resetHistory();
    }
  }

  /** Debug: enables a CLOUD_DEBUG_<NAME> define in the march shader. */
  setDebugDefine(name: string): void {
    const key = `CLOUD_DEBUG_${name.toUpperCase()}`;
    for (const m of [this.march, this.temporal, this.composite]) {
      (m.defines as Record<string, string | number>)[key] = 1;
      m.needsUpdate = true;
    }
  }

  resetHistory(): void {
    this.historyValid = false;
    this.warmup = WARMUP_FRAMES;
  }

  setSize(): void {
    /* Buffers follow the drawing-buffer size lazily in render(). */
  }

  /**
   * Low-res buffers are allocated for the largest output the drawing buffer allows and rendered through a viewport
   * matching the current (dynamic-resolution) output, so render-scale changes neither reallocate nor lose history.
   */
  private ensureTargets(maxW: number, maxH: number, outW: number, outH: number): void {
    const allocW = Math.max(1, Math.ceil(maxW / this.divisor));
    const allocH = Math.max(1, Math.ceil(maxH / this.divisor));
    if (allocW > this.allocW || allocH > this.allocH || !this.raw) {
      this.allocW = allocW;
      this.allocH = allocH;
      this.raw?.dispose();
      this.history?.[0].dispose();
      this.history?.[1].dispose();
      this.raw = createLowResTarget(allocW, allocH, 2);
      this.history = [createLowResTarget(allocW, allocH, 3), createLowResTarget(allocW, allocH, 3)];
      (this.composite.uniforms.uAllocSize.value as THREE.Vector2).set(allocW, allocH);
      this.lowW = 0;
      this.resetHistory();
    }
    const lowW = Math.min(this.allocW, Math.max(1, Math.ceil(outW / this.divisor)));
    const lowH = Math.min(this.allocH, Math.max(1, Math.ceil(outH / this.divisor)));
    if (lowW !== this.lowW || lowH !== this.lowH) {
      this.lowW = lowW;
      this.lowH = lowH;
      for (const rt of [this.raw!, this.history![0], this.history![1]]) {
        rt.viewport.set(0, 0, lowW, lowH);
      }
      (this.march.uniforms.uLowSize.value as THREE.Vector2).set(lowW, lowH);
      (this.temporal.uniforms.uLowSize.value as THREE.Vector2).set(lowW, lowH);
      (this.composite.uniforms.uLowSize.value as THREE.Vector2).set(lowW, lowH);
    }
  }

  render(renderer: THREE.WebGLRenderer, inputs: HdrPassInputs, output: THREE.WebGLRenderTarget, ctx: EngineContext): void {
    this.lastInputs = inputs;
    this.lastOutput = output;
    this.lastCtx = ctx;
    const prevTarget = renderer.getRenderTarget();
    renderer.getDrawingBufferSize(this.bufferSize);
    this.ensureTargets(Math.max(this.bufferSize.x, output.width), Math.max(this.bufferSize.y, output.height), output.width, output.height);
    const raw = this.raw!;
    const history = this.history!;
    const cam = ctx.camera;

    this.camPos.setFromMatrixPosition(cam.matrixWorld);
    if (this.camPos.distanceTo(this.prevCamPos) > HISTORY_RESET_DISTANCE) {
      this.resetHistory();
    }
    this.rayUniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    this.rayUniforms.uCamWorld.value.copy(cam.matrixWorld);
    this.rayUniforms.uCloudCamPos.value.copy(this.camPos);
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    this.quad.render(renderer, this.ambient, this.ambientTarget);

    const march = this.march.uniforms;
    march.tDepth.value = inputs.depth;
    march.uFrame.value = this.frame;
    march.uPixelAngle.value = THREE.MathUtils.degToRad(cam.getEffectiveFOV()) / this.lowH;
    (march.uSubPixel.value as THREE.Vector2).set(halton((this.frame % 16) + 1, 2) - 0.5, halton((this.frame % 16) + 1, 3) - 0.5);
    this.quad.render(renderer, this.march, raw);

    const src = history[this.historyIndex];
    const dst = history[1 - this.historyIndex];
    const temporal = this.temporal.uniforms;
    temporal.tCur.value = raw.textures[0];
    temporal.tCurAux.value = raw.textures[1];
    temporal.tHist.value = src.textures[0];
    temporal.tHistAux.value = src.textures[1];
    temporal.tHistAge.value = src.textures[2];
    temporal.uHistoryValid.value = this.historyValid && this.histW > 0 ? 1 : 0;
    (temporal.uHistSize.value as THREE.Vector2).set(Math.max(this.histW, 1), Math.max(this.histH, 1));
    this.quad.render(renderer, this.temporal, dst);

    const composite = this.composite.uniforms;
    composite.tScene.value = inputs.color;
    composite.tDepth.value = inputs.depth;
    composite.tCloud.value = dst.textures[0];
    composite.tCloudAux.value = dst.textures[1];
    this.quad.render(renderer, this.composite, output);

    this.historyIndex = 1 - this.historyIndex;
    this.histW = this.lowW;
    this.histH = this.lowH;
    this.prevViewProj.copy(this.viewProj);
    this.prevCamPos.copy(this.camPos);
    this.historyValid = true;
    this.frame++;
    this.lastRenderFrame = ctx.time.frame;
    if (this.warmup > 0) {
      this.warmup--;
    }
    renderer.setRenderTarget(prevTarget);
  }

  /** Debug: [L.rgb, T, cloudKm, sceneKm, frontKm, sigmaFront/km, age, ...] at a screen uv (accumulated history). */
  probe(renderer: THREE.WebGLRenderer, u: number, v: number): number[] {
    if (!this.history) {
      return [];
    }
    const rt = this.history[this.historyIndex];
    const x = Math.min(this.lowW - 1, Math.floor(u * this.lowW));
    const y = Math.min(this.lowH - 1, Math.floor(v * this.lowH));
    const out: number[] = [];
    for (let i = 0; i < 3; i++) {
      const px = new Uint16Array(4);
      renderer.readRenderTargetPixels(rt, x, y, 1, 1, px, undefined, i);
      for (const h of px) {
        out.push(+THREE.DataUtils.fromHalfFloat(h).toFixed(4));
      }
    }
    return out;
  }

  /** Debug: per-channel average of the raw march buffer (with CLOUD_DEBUG_COST: probes, density evals, light samples). */
  rawAverage(renderer: THREE.WebGLRenderer): number[] {
    if (!this.raw || this.lowW === 0) {
      return [];
    }
    const px = new Uint16Array(this.lowW * this.lowH * 4);
    renderer.readRenderTargetPixels(this.raw, 0, 0, this.lowW, this.lowH, px);
    const sum = [0, 0, 0, 0];
    for (let i = 0; i < px.length; i++) {
      sum[i & 3] += THREE.DataUtils.fromHalfFloat(px[i]);
    }
    const n = this.lowW * this.lowH;
    return sum.map((v) => +(v / n).toFixed(2));
  }

  /** Debug: average wall time (ms) of `iterations` synchronous re-renders of the last frame (GPU-bound). */
  benchmark(renderer: THREE.WebGLRenderer, iterations: number, marchOnly = false): number {
    const inputs = this.lastInputs;
    const output = this.lastOutput;
    const ctx = this.lastCtx;
    if (!inputs || !output || !ctx) {
      return -1;
    }
    const px = new Uint16Array(4);
    const syncHalf = (): void => {
      renderer.readRenderTargetPixels(this.raw!, 0, 0, 1, 1, px);
    };
    this.render(renderer, inputs, output, ctx);
    syncHalf();
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      if (marchOnly) {
        this.quad.render(renderer, this.march, this.raw!);
      } else {
        this.render(renderer, inputs, output, ctx);
      }
    }
    syncHalf();
    return (performance.now() - t0) / iterations;
  }

  dispose(): void {
    this.raw?.dispose();
    this.history?.[0].dispose();
    this.history?.[1].dispose();
    this.ambientTarget.dispose();
    this.ambient.dispose();
    this.march.dispose();
    this.temporal.dispose();
    this.composite.dispose();
  }
}
