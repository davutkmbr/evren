import * as THREE from 'three';
import type { EngineContext, GameEvents, PipelineFactory, RenderPipeline, System, TimeState } from './contracts';
import { RenderLayers } from './contracts';
import { EventBus } from './events';
import { ServiceRegistry } from './services';
import { Input } from './input';
import { QualityManager, type QualityPreset } from './quality';
import { globalUniforms, installGlobalShaderHooks } from './uniforms';
import { CollisionWorld } from './collision';
import { parseDebugFlags, VIEW_PRESETS } from './debug';
import { latLonToLocal } from './geo-coords';

export interface EngineOptions {
  container: HTMLElement;
  sandbox?: boolean;
  quality?: QualityPreset;
}

interface SystemEntry {
  system: System;
  index: number;
  cpuMs: number;
  errors: number;
}

export interface EngineStats {
  fps: number;
  frameMs: number;
  cpuMs: number;
  cpuBySystem: Record<string, number>;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  renderScale: number;
  pending: number;
  colliders: number;
  heapMB: number;
}

/** Minimal pipeline used until/unless a real one is installed (sandbox pages). */
class DirectPipeline implements RenderPipeline {
  renderScale = 1;
  exposure = 1;
  speedEffect = 0;
  constructor(private renderer: THREE.WebGLRenderer) {
    renderer.toneMapping = THREE.AgXToneMapping;
  }
  render(ctx: EngineContext): void {
    this.renderer.setRenderTarget(null);
    this.renderer.render(ctx.scene, ctx.camera);
  }
  addHdrPass(): void {}
  removeHdrPass(): void {}
  setSize(): void {}
  dispose(): void {}
}

export class Engine {
  readonly ctx: EngineContext;
  private entries: SystemEntry[] = [];
  private sorted: SystemEntry[] = [];
  private running = false;
  private lastTime = 0;
  /** Optional frame-rate cap from ?fps= (tooling: keeps headless screenshot sessions cheap). 0 = uncapped. */
  private readonly minFrameMs: number;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;
  private frameMs = 0;
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private cpuMs = 0;
  private readyFrames = -1;
  private resizeObserver: ResizeObserver;

  constructor(opts: EngineOptions) {
    installGlobalShaderHooks();

    const container = opts.container;
    const canvas = document.createElement('canvas');
    canvas.className = 'engine-canvas';
    container.appendChild(canvas);

    const uiRoot = document.createElement('div');
    uiRoot.className = 'ui-root';
    container.appendChild(uiRoot);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      reversedDepthBuffer: true,
      preserveDrawingBuffer: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    renderer.setClearColor(0x000000, 1);

    const debug = parseDebugFlags();
    // Automated browsers (screenshot tooling, agents' scripts) default to 24 fps so parallel sessions stay cheap;
    // ?fps=0 uncaps (performance measurements), ?fps=N sets any cap.
    const fpsParam = debug.params.get('fps');
    const automated = typeof navigator !== 'undefined' && navigator.webdriver === true;
    const fpsCap = fpsParam !== null ? Number(fpsParam) : automated ? 24 : 0;
    this.minFrameMs = fpsCap > 0 ? 1000 / fpsCap - 1 : 0;
    if (automated && fpsCap > 0) {
      console.info(`[engine] automated browser: frame rate capped at ${fpsCap} fps (add ?fps=0 to measure performance)`);
    }
    const preset = (debug.quality as QualityPreset | undefined) ?? opts.quality ?? QualityManager.detectPreset(renderer, renderer.getContext() as WebGL2RenderingContext);
    const quality = new QualityManager(preset);

    const scene = new THREE.Scene();
    // Any fog instance enables USE_FOG; the fog chunk is replaced by applyAtmosphere().
    scene.fog = new THREE.FogExp2(0xffffff, 0.0001);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 60000);
    camera.position.set(0, 300, 500);
    camera.layers.enable(RenderLayers.NoReflection);

    const time: TimeState = {
      elapsed: 0,
      dt: 0,
      realDt: 0,
      frame: 0,
      timeOfDay: debug.time ?? (debug.view ? VIEW_PRESETS[debug.view]?.time : undefined) ?? 18.0,
      dayTimeScale: 0,
      dayOfYear: 266,
      paused: debug.freeze,
    };

    const services = new ServiceRegistry();
    const events = new EventBus<GameEvents>();
    const collision = new CollisionWorld();
    services.provide('collision', collision);
    void services.when('geo').then((geo) => collision.setGeo(geo));

    this.ctx = {
      renderer,
      scene,
      camera,
      canvas,
      uiRoot,
      input: new Input(canvas),
      quality,
      time,
      events,
      services,
      pipeline: new DirectPipeline(renderer),
      debug,
      sandbox: !!opts.sandbox,
    };

    events.on('pause', ({ paused }) => {
      this.ctx.time.paused = paused;
    });
    quality.onChange(() => this.resize());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.installDebugApi();
  }

  setPipeline(factory: PipelineFactory): this {
    this.ctx.pipeline.dispose();
    this.ctx.pipeline = factory(this.ctx);
    this.resize();
    return this;
  }

  register(system: System): this {
    this.entries.push({ system, index: this.entries.length, cpuMs: 0, errors: 0 });
    this.sorted = [...this.entries].sort((a, b) => a.system.order - b.system.order || a.index - b.index);
    return this;
  }

  async start(): Promise<void> {
    this.resize();
    const { events } = this.ctx;
    const total = this.entries.length;
    for (let i = 0; i < total; i++) {
      const s = this.entries[i].system;
      events.emit('loading-progress', { label: s.name, progress: i / total });
      const t0 = performance.now();
      try {
        await s.init?.(this.ctx);
      } catch (err) {
        console.error(`[engine] init failed: ${s.name}`, err);
      }
      const ms = performance.now() - t0;
      if (ms > 50) {
        console.info(`[engine] init ${s.name}: ${ms.toFixed(0)} ms`);
      }
      // Let the browser breathe / paint the loading screen.
      await new Promise((r) => setTimeout(r, 0));
    }
    events.emit('loading-progress', { label: 'ready', progress: 1 });
    // Compile programs up front to avoid first-frame hitches.
    try {
      await this.ctx.renderer.compileAsync(this.ctx.scene, this.ctx.camera);
    } catch {
      /* optional */
    }
    events.emit('loading-done', {});
    this.running = true;
    this.readyFrames = 0;
    this.lastTime = performance.now();
    this.ctx.renderer.setAnimationLoop((t) => this.frame(t));
  }

  stop(): void {
    this.running = false;
    this.ctx.renderer.setAnimationLoop(null);
  }

  private frame(now: number): void {
    if (!this.running) {
      return;
    }
    if (this.minFrameMs > 0 && now - this.lastTime < this.minFrameMs) {
      return;
    }
    const ctx = this.ctx;
    const frameStart = performance.now();
    const realDt = Math.min(Math.max((now - this.lastTime) / 1000, 0), 0.25);
    this.lastTime = now;
    ctx.time.realDt = realDt;

    ctx.input.update(realDt);
    const dt = ctx.time.paused ? 0 : Math.min(realDt, 1 / 20);
    ctx.time.dt = dt;
    ctx.time.elapsed += dt;
    ctx.time.frame++;
    globalUniforms.uTime.value = ctx.time.elapsed;
    ctx.renderer.info.reset();

    for (const e of this.sorted) {
      if (!e.system.update) {
        continue;
      }
      const t0 = performance.now();
      try {
        e.system.update(dt, ctx);
      } catch (err) {
        if (e.errors++ < 3 || e.errors % 600 === 0) {
          console.error(`[engine] update failed: ${e.system.name}`, err);
        }
      }
      e.cpuMs += (performance.now() - t0 - e.cpuMs) * 0.05;
    }

    const cam = ctx.camera;
    cam.updateMatrixWorld();
    (globalUniforms.uCamPos.value as THREE.Vector3).setFromMatrixPosition(cam.matrixWorld);
    globalUniforms.uCamNear.value = cam.near;
    globalUniforms.uCamFar.value = cam.far;

    for (const e of this.sorted) {
      e.system.preRender?.(ctx);
    }
    ctx.pipeline.render(ctx);
    this.lastDrawCalls = ctx.renderer.info.render.calls;
    this.lastTriangles = ctx.renderer.info.render.triangles;

    const cpu = performance.now() - frameStart;
    this.cpuMs += (cpu - this.cpuMs) * 0.05;
    this.frameMs += (realDt * 1000 - this.frameMs) * 0.05;
    this.fpsAcc += realDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (this.readyFrames >= 0) {
      this.readyFrames++;
    }
  }

  private resize(): void {
    const ctx = this.ctx;
    const parent = ctx.canvas.parentElement!;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, ctx.quality.settings.maxPixelRatio);
    ctx.renderer.setPixelRatio(pr);
    ctx.renderer.setSize(w, h, false);
    ctx.canvas.style.width = `${w}px`;
    ctx.canvas.style.height = `${h}px`;
    ctx.camera.aspect = w / h;
    ctx.camera.updateProjectionMatrix();
    (globalUniforms.uResolution.value as THREE.Vector2).set(w * pr, h * pr);
    ctx.pipeline.setSize(w, h, pr);
    for (const e of this.entries) {
      e.system.onResize?.(w, h, ctx);
    }
  }

  pending(): number {
    let n = 0;
    for (const e of this.entries) {
      n += e.system.pending?.() ?? 0;
    }
    return n;
  }

  stats(): EngineStats {
    const info = this.ctx.renderer.info;
    const cpuBySystem: Record<string, number> = {};
    for (const e of this.entries) {
      cpuBySystem[e.system.name] = Math.round(e.cpuMs * 1000) / 1000;
    }
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      fps: Math.round(this.fps * 10) / 10,
      frameMs: Math.round(this.frameMs * 100) / 100,
      cpuMs: Math.round(this.cpuMs * 100) / 100,
      cpuBySystem,
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      renderScale: this.ctx.pipeline.renderScale,
      pending: this.pending(),
      colliders: this.ctx.services.get('collision').colliderCount,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : 0,
    };
  }

  private installDebugApi(): void {
    const engine = this;
    const api = {
      engine,
      ctx: this.ctx,
      THREE,
      get ready() {
        return engine.readyFrames >= 3;
      },
      pending: () => engine.pending(),
      stats: () => engine.stats(),
      setPaused: (paused: boolean) => engine.ctx.events.emit('pause', { paused }),
      setTime: (hours: number) => engine.ctx.services.tryGet('env')?.setTimeOfDay(hours),
      setQuality: (p: QualityPreset) => engine.ctx.quality.setPreset(p),
      setCamera: (mode: 'third' | 'pov' | 'cinematic' | 'free') => engine.ctx.services.tryGet('cameraRig')?.setMode(mode),
      view: (name: string) => {
        const v = VIEW_PRESETS[name];
        if (!v) {
          return false;
        }
        engine.ctx.events.emit('teleport', { x: v.x, y: v.y, z: v.z, headingDeg: v.headingDeg, pitchDeg: v.pitchDeg });
        if (v.time !== undefined) {
          engine.ctx.services.tryGet('env')?.setTimeOfDay(v.time);
        }
        return true;
      },
      views: () => Object.keys(VIEW_PRESETS),
      /** Hard-cut the free camera to a world position (meters) and orientation (degrees). */
      shot: (x: number, y: number, z: number, headingDeg: number, pitchDeg: number, fovDeg?: number) =>
        engine.ctx.services.tryGet('cameraRig')?.placeFree?.(x, y, z, headingDeg, pitchDeg, fovDeg),
      /** Same as shot() with latitude/longitude and altitude above sea level. */
      shotLatLon: (lat: number, lon: number, alt: number, headingDeg: number, pitchDeg: number, fovDeg?: number) => {
        const p = latLonToLocal(lat, lon);
        engine.ctx.services.tryGet('cameraRig')?.placeFree?.(p.x, alt, p.z, headingDeg, pitchDeg, fovDeg);
      },
    };
    (window as unknown as { __evren: typeof api }).__evren = api;
  }
}
