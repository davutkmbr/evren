import * as THREE from 'three';
import type { EngineContext, HdrPass, HdrPassInputs, RenderPipeline, TimeState } from '../../core/contracts';
import { globalUniforms } from '../../core/uniforms';
import { FxaaPass, SmaaPass, smaaAvailable, type AntialiasPass } from './antialias';
import { BloomChain } from './bloom';
import { DynamicResolution, type DynamicResolutionInput } from './dynamic-resolution';
import { AutoExposure } from './exposure';
import { CompositePass, type CompositeFrame } from './composite-pass';
import { FullscreenRenderer } from './fullscreen';
import { GpuTimer } from './gpu-timer';
import { createGradingState, updateGrading } from './grading';
import { SunFlare } from './lens-flare';
import { parsePostOverrides, resolvePostSettings, type AntialiasMode, type PostDebugView, type PostOverrides, type ResolvedPostSettings } from './options';
import { OutputPass } from './output-pass';
import { createColorTarget, createSceneTarget } from './targets';

/** Bloom mip used as the exposure meter source (1/8 internal resolution, already box-filtered). */
const METER_MIP = 2;
/** Dynamic resolution reads this percentile of the last GPU_WINDOW whole-frame GPU timings (~0.7 s). */
const GPU_PERCENTILE = 0.3;
const GPU_WINDOW = 40;
/** A frame-mode GPU query open for longer than this (ms of wall time) is discarded. */
const STALE_FRAME_MS = 250;
/** Metered share of exactly black HDR texels that counts as a black frame (diagnostics only). */
const BLACK_FRAME_FRACTION = 0.97;
/** Minimum wall time between two warnings of the same kind (black frame, invalid camera), ms. */
const WARN_INTERVAL_MS = 5000;

/** Read-only diagnostics for sandboxes / debug overlays. */
export interface PostDiagnostics {
  renderScale: number;
  internalWidth: number;
  internalHeight: number;
  exposure: number;
  exposureEv: number;
  meteredLog: number;
  gpuMs: number;
  /** Median / 10th percentile of recent GPU timings (the minimum-ish value is robust to GPU sharing). */
  gpuMedianMs: number;
  gpuP10Ms: number;
  antialias: AntialiasMode;
  msaa: number;
  bloom: boolean;
  flare: number;
  underwater: number;
}

/**
 * Frame producer: HDR scene (dynamic resolution, optional MSAA) -> HdrPass chain -> bloom + metering ->
 * composite (exposure, flare, grading, tone mapping) -> FXAA/SMAA -> upscale + CAS + grain + dither -> canvas.
 */
export class PostPipeline implements RenderPipeline {
  speedEffect = 0;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly gl: WebGL2RenderingContext;
  private readonly time: TimeState;
  private readonly overrides: PostOverrides;
  private settings: ResolvedPostSettings;
  private readonly fs = new FullscreenRenderer();
  private readonly passes: HdrPass[] = [];
  private readonly passErrors = new WeakMap<HdrPass, number>();
  private readonly hdrInputs: HdrPassInputs;

  private sceneTarget: THREE.WebGLRenderTarget;
  private readonly pingA: THREE.WebGLRenderTarget;
  private readonly pingB: THREE.WebGLRenderTarget;
  private readonly ldrA: THREE.WebGLRenderTarget;
  private readonly ldrB: THREE.WebGLRenderTarget;
  private readonly bloom = new BloomChain();
  private readonly exposureCtl: AutoExposure;
  private readonly flare = new SunFlare();
  private readonly grading = createGradingState();
  private readonly dynres = new DynamicResolution();
  private readonly dynresInput: DynamicResolutionInput = {
    dt: 0,
    gpuMs: -1,
    frameMs: 0,
    cpuMs: 0,
    targetFrameMs: 16.6,
    minScale: 1,
    maxScale: 1,
    paused: false,
  };
  private readonly timer: GpuTimer;
  private antialias: AntialiasPass | null = null;
  private antialiasMode: AntialiasMode = 'none';

  private readonly composite: CompositePass;
  private readonly output = new OutputPass();
  private readonly compositeFrame: CompositeFrame;

  private displayWidth = 1;
  private displayHeight = 1;
  private internalWidth = 1;
  private internalHeight = 1;
  private msaaSamples = 0;
  private frameStart = 0;
  private lastCpuMs = 0;
  private disposed = false;
  /**
   * What the GPU timer measures: the whole frame from the start-of-frame callback to the end of render (default,
   * drives dynamic resolution; includes GPU work other systems issue in update/preRender), only the post chain
   * (?postprof=1 or ?postbench=N) or only the scene render (?postprof=scene). Profiling modes hold the max scale.
   * On ANGLE/Metal short spans are inflated by GPU sharing (see GpuTimer): measure post cost as the difference
   * between ?postbench=1 and ?postbench=N runs instead of trusting ?postprof=1 absolute values.
   */
  private readonly profileMode: 'frame' | 'post' | 'scene';
  /** ?postbench=N repeats the post chain N times per frame (GPU cost measurement under noisy timing). */
  private readonly benchIterations: number;
  /** ctx.time.frame expected in the render() that closes the frame-mode GPU query opened at frame start. */
  private timerFrame = -1;
  private lastTimeOfDay = Number.NaN;
  /** Frame bookkeeping for the black-frame diagnostics. */
  private lastScaleChangeFrame = -1;
  private lastTeleportFrame = -1;
  private lastMeasurement = 0;
  private readonly lastWarnMs = new Map<string, number>();
  private readonly unsubscribers: (() => void)[] = [];
  private readonly tmpSunDir = new THREE.Vector3();
  private readonly tmpSunColor = new THREE.Color();

  constructor(ctx: EngineContext) {
    this.renderer = ctx.renderer;
    this.time = ctx.time;
    // Tone mapping happens in the composite; the renderer must write linear radiance everywhere.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.gl = ctx.renderer.getContext() as WebGL2RenderingContext;
    this.overrides = parsePostOverrides(ctx.debug.params);
    const prof = ctx.debug.params.get('postprof');
    this.profileMode = prof === 'scene' ? 'scene' : prof === '1' || ctx.debug.params.has('postbench') ? 'post' : 'frame';
    this.benchIterations = Math.max(1, Math.min(64, Math.round(Number(ctx.debug.params.get('postbench') ?? 1)) || 1));
    const maxSamples = this.gl.getParameter(this.gl.MAX_SAMPLES) as number;
    this.settings = resolvePostSettings(ctx.quality.settings, this.overrides, maxSamples);
    // Another module's profiler (?cloudprof=1) issues its own TIME_ELAPSED queries, which cannot nest with ours.
    this.timer = new GpuTimer(this.gl, !ctx.debug.params.has('cloudprof'));
    this.exposureCtl = new AutoExposure(this.gl);
    this.exposureCtl.tuning.evBias = this.overrides.evBias;
    this.exposureCtl.fixedExposure = this.overrides.fixedExposure;
    this.flare.enabled = this.overrides.flare;
    this.dynres.enabled = this.overrides.dynamicResolution && this.profileMode === 'frame';
    this.dynres.forcedScale = this.overrides.fixedScale;
    this.dynres.reset(this.settings.maxScale);

    this.msaaSamples = this.settings.msaaSamples;
    this.sceneTarget = createSceneTarget(1, 1, this.msaaSamples);
    this.pingA = createColorTarget(1, 1, { name: 'post.pingA' });
    this.pingB = createColorTarget(1, 1, { name: 'post.pingB' });
    // Display-encoded [0,1] colour (+ luma in alpha for FXAA): 8 bits are enough (the composite dithers).
    this.ldrA = createColorTarget(1, 1, { name: 'post.ldrA', type: THREE.UnsignedByteType });
    this.ldrB = createColorTarget(1, 1, { name: 'post.ldrB', type: THREE.UnsignedByteType });
    this.hdrInputs = { color: this.sceneTarget.texture, depth: this.sceneTarget.depthTexture as THREE.DepthTexture };

    this.composite = new CompositePass(this.overrides.toneMapper, this.flare, this.grading);
    this.compositeFrame = {
      hdr: this.sceneTarget.texture,
      depth: this.sceneTarget.depthTexture as THREE.DepthTexture,
      width: 1,
      height: 1,
      bloom: this.bloom,
      bloomEnabled: true,
      exposure: 1,
      grading: this.grading,
      flareIntensity: 0,
      speedEffect: 0,
      time: 0,
      frame: 0,
      camera: ctx.camera,
    };

    this.setAntialias(this.settings.antialias);
    this.warmUpPrograms();

    this.unsubscribers.push(
      ctx.quality.onChange((q) => {
        const next = resolvePostSettings(q, this.overrides, maxSamples);
        this.settings = next;
        this.setAntialias(next.antialias);
        if (next.msaaSamples !== this.msaaSamples) {
          this.msaaSamples = next.msaaSamples;
          this.rebuildSceneTarget();
        }
        this.dynres.reset(next.maxScale);
        this.applyInternalSize();
      }),
      ctx.events.on('teleport', () => {
        this.exposureCtl.snap();
        this.lastTeleportFrame = ctx.time.frame;
      }),
      ctx.events.on('time-of-day', ({ hours }) => {
        if (!Number.isNaN(this.lastTimeOfDay) && Math.abs(hours - this.lastTimeOfDay) > 0.25) {
          this.exposureCtl.snap();
        }
        this.lastTimeOfDay = hours;
      }),
    );
    requestAnimationFrame(this.onFrameStart);
  }

  get renderScale(): number {
    return this.dynres.scale;
  }

  get exposure(): number {
    return this.exposureCtl.exposure;
  }

  get diagnostics(): PostDiagnostics {
    return {
      renderScale: this.dynres.scale,
      internalWidth: this.internalWidth,
      internalHeight: this.internalHeight,
      exposure: this.exposureCtl.exposure,
      exposureEv: Math.log2(this.exposureCtl.exposure),
      meteredLog: this.exposureCtl.averageLog,
      gpuMs: this.timer.lastMs,
      gpuMedianMs: this.timer.percentile(0.5),
      gpuP10Ms: this.timer.percentile(0.1),
      antialias: this.antialiasMode,
      msaa: this.msaaSamples,
      bloom: this.settings.bloom,
      flare: this.flare.intensity,
      underwater: this.composite.underwater,
    };
  }

  /** Debug: the sun visibility texel of the flare pass (stalls the GPU; never call per frame). */
  debugSunVisibility(): number[] {
    return this.flare.readVisibility(this.renderer);
  }

  /** Pins the render scale (null = dynamic). */
  setFixedScale(scale: number | null): void {
    this.dynres.forcedScale = scale;
  }

  setDebugView(view: PostDebugView): void {
    this.overrides.debugView = view;
  }

  setExposureBias(ev: number): void {
    this.exposureCtl.tuning.evBias = ev;
    this.exposureCtl.snap();
  }

  addHdrPass(pass: HdrPass): void {
    if (this.passes.includes(pass)) {
      return;
    }
    this.passes.push(pass);
    this.passes.sort((a, b) => a.order - b.order);
    pass.setSize?.(this.internalWidth, this.internalHeight);
  }

  removeHdrPass(pass: HdrPass): void {
    const i = this.passes.indexOf(pass);
    if (i >= 0) {
      this.passes.splice(i, 1);
    }
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.displayWidth = Math.max(1, Math.floor(width * pixelRatio));
    this.displayHeight = Math.max(1, Math.floor(height * pixelRatio));
    this.applyInternalSize();
  }

  render(ctx: EngineContext): void {
    const renderer = this.renderer;
    const camera = ctx.camera;
    this.updateDynamicResolution(ctx);
    if (!isFiniteCamera(camera)) {
      // Every vertex would be NaN: nothing rasterises and the frame comes out black. Leave the canvas untouched
      // instead (no draw to the default framebuffer = the browser keeps presenting the last good frame).
      if (this.profileMode === 'frame') {
        this.timer.end(true);
      }
      this.warn('camera', `[post] non-finite camera matrices, frame ${ctx.time.frame} skipped (position ${camera.position.toArray().join(', ')})`);
      return;
    }

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.sceneTarget);
    if (this.profileMode === 'scene') {
      this.timer.begin();
    }
    renderer.render(ctx.scene, camera);
    if (this.profileMode === 'scene') {
      this.timer.end();
    }
    renderer.autoClear = false;

    const depth = this.sceneTarget.depthTexture as THREE.DepthTexture;
    const hdr = this.runHdrPasses(ctx, depth);

    if (this.profileMode === 'post') {
      this.timer.begin();
    }
    for (let i = 0; i < this.benchIterations; i++) {
      this.renderPost(ctx, hdr, depth);
    }
    renderer.autoClear = prevAutoClear;
    const cpuMs = performance.now() - this.frameStart;
    // Frame mode: the query opened at frame start is only representative if it spans exactly this frame (not a
    // skipped frame or the loading phase before the engine loop started).
    this.timer.end(this.profileMode === 'frame' && (ctx.time.frame !== this.timerFrame || cpuMs > STALE_FRAME_MS));
    this.lastCpuMs = cpuMs;
    this.checkBlackFrame(ctx);
  }

  /**
   * Black-frame diagnostics from the exposure meter (already read back asynchronously every frame, so free): when a
   * metered frame is (almost) exactly black, log the state that usually explains it. The report lags the frame by
   * the readback latency (1-3 frames).
   */
  private checkBlackFrame(ctx: EngineContext): void {
    const ctl = this.exposureCtl;
    if (ctl.measurements === this.lastMeasurement) {
      return;
    }
    this.lastMeasurement = ctl.measurements;
    if (ctl.blackFraction < BLACK_FRAME_FRACTION) {
      return;
    }
    const frame = ctx.time.frame;
    const since = (f: number): string => (f < 0 ? 'never' : `${frame - f} frames ago`);
    const p = ctx.camera.position;
    const passes = this.passes.map((pass) => `${pass.name}${pass.enabled ? '' : '(off)'}`).join(',');
    this.warn(
      'black',
      `[post] black HDR frame near frame ${frame}: ${(ctl.blackFraction * 100).toFixed(0)}% black, scale ${this.dynres.scale} ` +
        `(${this.internalWidth}x${this.internalHeight}, changed ${since(this.lastScaleChangeFrame)}), teleport ${since(this.lastTeleportFrame)}, ` +
        `camera ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}, exposure ${ctl.exposure.toFixed(3)}, passes ${passes || 'none'}`,
    );
  }

  private warn(kind: string, message: string): void {
    const now = performance.now();
    if (now - (this.lastWarnMs.get(kind) ?? -Infinity) < WARN_INTERVAL_MS) {
      return;
    }
    this.lastWarnMs.set(kind, now);
    console.warn(message);
  }

  /** Everything after the HDR passes: bloom + metering, flare visibility, composite, AA, output. */
  private renderPost(ctx: EngineContext, hdr: THREE.Texture, depth: THREE.DepthTexture): void {
    const renderer = this.renderer;
    const exposure = this.exposureCtl.exposure;
    const bloomOn = this.settings.bloom;
    this.bloom.downsample(renderer, this.fs, hdr, this.internalWidth, this.internalHeight, exposure / 8, bloomOn ? undefined : METER_MIP);
    this.exposureCtl.meter(renderer, this.fs, this.bloom.mips[Math.min(METER_MIP, this.bloom.levels - 1)].texture);
    this.exposureCtl.update(ctx.time.realDt);
    if (bloomOn) {
      this.bloom.upsample(renderer, this.fs, 1);
    }

    this.updateEnvironmentDrivenState(ctx);
    if (this.flare.intensity > 0) {
      this.flare.render(renderer, this.fs, this.sceneTarget.texture, hdr, depth);
    }

    const debugView = this.overrides.debugView;
    if (debugView !== 'off') {
      const isBloom = debugView === 'bloom';
      const debugExposure = this.exposureCtl.exposure / (isBloom ? this.bloom.levels : 1);
      this.output.renderDebug(renderer, this.fs, debugView, isBloom ? this.bloom.result : hdr, depth, debugExposure, ctx.camera);
      return;
    }
    const f = this.compositeFrame;
    f.hdr = hdr;
    f.depth = depth;
    f.width = this.internalWidth;
    f.height = this.internalHeight;
    f.bloomEnabled = bloomOn;
    f.exposure = this.exposureCtl.exposure;
    f.flareIntensity = this.flare.intensity;
    f.speedEffect = this.overrides.speed ?? this.speedEffect;
    f.time = globalUniforms.uTime.value as number;
    f.frame = ctx.time.frame;
    f.camera = ctx.camera;
    if (f.speedEffect > 0) {
      this.updateSpeedMask(ctx);
    }
    this.composite.render(renderer, this.fs, f, this.ldrA);
    let ldr = this.ldrA;
    if (this.antialias && this.antialias.render(renderer, this.fs, this.ldrA, this.ldrB)) {
      ldr = this.ldrB;
    }
    const grain = this.overrides.grain ? this.grading.grain : 0;
    this.output.render(renderer, this.fs, ldr, this.displayWidth, this.displayHeight, this.settings.sharpen, grain, ctx.time.frame);
  }

  /**
   * Runs before the engine's frame callback (registered earlier): collect async GPU results with an empty queue,
   * then open the frame-mode GPU query so it also covers GPU work issued by other systems' update/preRender.
   */
  private readonly onFrameStart = (t: number): void => {
    if (this.disposed) {
      return;
    }
    this.frameStart = t;
    this.exposureCtl.poll();
    this.timer.poll();
    if (this.profileMode === 'frame') {
      if (this.timer.isActive) {
        this.timer.end(true);
      }
      this.timer.begin();
      this.timerFrame = this.time.frame + 1;
    }
  };

  /** The rider's dragon as a bounding sphere, protected from the speed effect's radial smear. */
  private updateSpeedMask(ctx: EngineContext): void {
    const dragon = ctx.services.tryGet('dragon');
    const rig = ctx.services.tryGet('rig');
    if (!dragon) {
      this.composite.updateSpeedMask(ctx.camera, null, 0);
      return;
    }
    const dims = rig?.dimensions;
    const radius = dims ? 0.5 * Math.max(dims.wingspan, dims.length) + 1.5 : 16;
    this.composite.updateSpeedMask(ctx.camera, dragon.position, radius);
  }

  /**
   * Compiles the programs that are otherwise first used mid-flight (flare visibility when the sun enters the frame,
   * bloom upsampling when bloom gets enabled, SMAA before its lookup textures decode) by drawing them once.
   */
  private warmUpPrograms(): void {
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.sceneTarget);
    renderer.clear(true, true, false);
    const hdr = this.sceneTarget.texture;
    const depth = this.sceneTarget.depthTexture as THREE.DepthTexture;
    this.bloom.warmUp(renderer, this.fs, hdr);
    this.flare.render(renderer, this.fs, hdr, hdr, depth);
    renderer.setRenderTarget(previous);
  }

  private runHdrPasses(ctx: EngineContext, depth: THREE.DepthTexture): THREE.Texture {
    let src: THREE.Texture = this.sceneTarget.texture;
    let out = this.pingA;
    for (let i = 0; i < this.passes.length; i++) {
      const pass = this.passes[i];
      if (!pass.enabled) {
        continue;
      }
      this.hdrInputs.color = src;
      this.hdrInputs.depth = depth;
      try {
        pass.render(this.renderer, this.hdrInputs, out, ctx);
      } catch (err) {
        const count = (this.passErrors.get(pass) ?? 0) + 1;
        this.passErrors.set(pass, count);
        if (count <= 3 || count % 600 === 0) {
          console.error(`[post] HdrPass "${pass.name}" failed (skipped this frame)`, err);
        }
        continue;
      }
      src = out.texture;
      out = out === this.pingA ? this.pingB : this.pingA;
    }
    this.renderer.autoClear = false;
    return src;
  }

  private updateDynamicResolution(ctx: EngineContext): void {
    requestAnimationFrame(this.onFrameStart);
    const s = this.settings;
    const input = this.dynresInput;
    input.dt = ctx.time.realDt;
    input.gpuMs = this.profileMode === 'frame' ? this.timer.recentPercentile(GPU_PERCENTILE, GPU_WINDOW) : -1;
    input.frameMs = ctx.time.realDt * 1000;
    input.cpuMs = this.lastCpuMs;
    input.targetFrameMs = s.targetFrameMs;
    input.minScale = s.minScale;
    input.maxScale = s.maxScale;
    input.paused = ctx.time.paused;
    const changed = this.dynres.update(input);
    if (changed) {
      this.lastScaleChangeFrame = ctx.time.frame;
      this.applyInternalSize();
    }
  }

  private updateEnvironmentDrivenState(ctx: EngineContext): void {
    const env = ctx.services.tryGet('env');
    const sunDir = this.tmpSunDir.copy(env ? env.sunDirection : (globalUniforms.uSunDir.value as THREE.Vector3));
    const sunColor = this.tmpSunColor.copy(env ? env.sunColor : (globalUniforms.uSunColor.value as THREE.Color));
    const night = env ? env.nightFactor : (globalUniforms.uNight.value as number);
    const ambient = env ? env.ambientColor : (globalUniforms.uAmbient.value as THREE.Color);
    const elevationDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)));
    updateGrading(this.grading, elevationDeg);
    this.exposureCtl.nightFactor = THREE.MathUtils.clamp(night, 0, 1);

    const camera = ctx.camera;
    const geo = ctx.services.tryGet('geo');
    const overWater = !geo || camera.position.y >= 0 || geo.isWater(camera.position.x, camera.position.z);
    this.composite.updateUnderwater(camera, sunDir, sunColor, ambient, overWater);
    this.flare.update(camera, sunDir, sunColor, night);
    this.flare.intensity *= 1 - this.composite.underwater;
  }

  private setAntialias(mode: AntialiasMode): void {
    const resolved: AntialiasMode = mode === 'smaa' && !smaaAvailable() ? 'fxaa' : mode;
    if (resolved === this.antialiasMode && (this.antialias || resolved === 'none')) {
      return;
    }
    this.antialias?.dispose();
    this.antialias = resolved === 'fxaa' ? new FxaaPass() : resolved === 'smaa' ? new SmaaPass() : null;
    this.antialiasMode = resolved;
    this.antialias?.setSize(this.internalWidth, this.internalHeight);
    this.antialias?.warmUp(this.renderer, this.fs, this.ldrA, this.ldrB);
  }

  private rebuildSceneTarget(): void {
    this.sceneTarget.dispose();
    this.sceneTarget = createSceneTarget(this.internalWidth, this.internalHeight, this.msaaSamples);
  }

  private applyInternalSize(): void {
    const scale = this.dynres.scale;
    const w = Math.max(1, Math.round(this.displayWidth * scale));
    const h = Math.max(1, Math.round(this.displayHeight * scale));
    // gl_FragCoord in scene/HdrPass shaders refers to the internal target, not the canvas (the engine writes the
    // display size on resize right before calling setSize; this refines it). See contractRequests.
    (globalUniforms.uResolution.value as THREE.Vector2).set(w, h);
    if (w === this.internalWidth && h === this.internalHeight) {
      return;
    }
    this.internalWidth = w;
    this.internalHeight = h;
    this.rebuildSceneTarget();
    this.pingA.setSize(w, h);
    this.pingB.setSize(w, h);
    this.ldrA.setSize(w, h);
    this.ldrB.setSize(w, h);
    this.bloom.setSize(w, h);
    this.antialias?.setSize(w, h);
    for (const pass of this.passes) {
      pass.setSize?.(w, h);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.unsubscribers) {
      off();
    }
    this.unsubscribers.length = 0;
    this.sceneTarget.dispose();
    this.pingA.dispose();
    this.pingB.dispose();
    this.ldrA.dispose();
    this.ldrB.dispose();
    this.bloom.dispose();
    this.exposureCtl.dispose();
    this.flare.dispose();
    this.antialias?.dispose();
    this.composite.dispose();
    this.output.dispose();
    this.timer.dispose();
    this.fs.dispose();
  }
}

function isFiniteCamera(camera: THREE.PerspectiveCamera): boolean {
  const world = camera.matrixWorld.elements;
  const projection = camera.projectionMatrix.elements;
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(world[i]) || !Number.isFinite(projection[i])) {
      return false;
    }
  }
  return true;
}
