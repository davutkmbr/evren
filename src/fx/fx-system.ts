import * as THREE from 'three';
import type { EngineContext, FxService, System } from '../core/contracts';
import { UpdateOrder } from '../core/contracts';
import type { QualitySettings } from '../core/quality';
import { globalUniforms } from '../core/uniforms';
import { createRng } from '../core/math/noise';
import { DepthSorter } from './particles/depth-sorter';
import { ParticlePool } from './particles/particle-pool';
import { SHARP_PROFILES, VOL_PROFILES } from './particles/types';
import { FireEmitter, type FireLightState } from './emitters/fire-emitter';
import { SurfaceEmitter } from './emitters/surface-emitter';
import { TRAIL_LIFE, TRAIL_POINTS, WingTrails } from './emitters/wing-trails';
import { isWaterAt, type EmitContext } from './emitters/emit-context';
import { FxPass, MAX_MOTES, type FxRenderState } from './render/fx-pass';
import { createBlackbodyLut } from './render/blackbody';
import { createNoiseVolumes, type NoiseVolumes } from './render/noise-volumes';

const REBASE_AFTER = 1800;
const REBASE_BY = 1500;
const MOTE_BOX = 22;

/**
 * Particles & effects: fire breath, water/ground interaction, wing-tip vortices, speed motes.
 * Stateless GPU particles (CPU writes spawn parameters only), depth-sorted soft volumetrics at half resolution,
 * composited in an HDR pass. Provides the 'fx' service.
 */
export class FxSystem implements System, FxService {
  readonly name = 'fx';
  readonly order = UpdateOrder.Effects;

  private ctx: EngineContext | null = null;
  private volumes: NoiseVolumes | null = null;
  private blackbody: THREE.DataTexture | null = null;
  private pass: FxPass | null = null;
  private vol: ParticlePool | null = null;
  private sharp: ParticlePool | null = null;
  private sorter: DepthSorter | null = null;
  private readonly fire = new FireEmitter();
  private readonly surface = new SurfaceEmitter();
  private readonly trails = new WingTrails();
  private emit: EmitContext | null = null;
  private readonly lights: FireLightState = {
    pos: [new THREE.Vector3(0, -1e5, 0), new THREE.Vector3(0, -1e5, 0)],
    color: [new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 0)],
  };
  private readonly state: FxRenderState = {
    now: 0,
    wind: new THREE.Vector3(),
    camVel: new THREE.Vector3(),
    volCount: 0,
    sharpCount: 0,
    moteCount: 0,
    moteBox: MOTE_BOX,
    moteOffset: new THREE.Vector3(),
    moteStrength: 0,
    moteSize: 0.018,
    trailsVisible: false,
    trailLife: TRAIL_LIFE,
    fireLightPos: this.lights.pos,
    fireLightColor: this.lights.color,
    hazeStrength: 7,
  };
  private timeBase = 0;
  private windReady = false;
  private readonly wind = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly camFwd = new THREE.Vector3();
  private readonly camPrev = new THREE.Vector3();
  private readonly camVel = new THREE.Vector3();
  private readonly rawVel = new THREE.Vector3();
  private hasCam = false;
  private moteCapacity = 400;
  private baseLowScale = 0.5;
  private minLowScale = 0.5;
  private overdrawLevel = 0;
  private calmTime = 0;
  private unsubscribers: Array<() => void> = [];

  async init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.volumes = createNoiseVolumes(ctx.renderer);
    this.blackbody = createBlackbodyLut();
    this.pass = new FxPass(this.state, this.volumes, this.blackbody, this.trails.texture, TRAIL_POINTS);
    const pools = this.createPools(ctx.quality.settings);
    this.emit = {
      now: 0,
      dt: 0,
      wind: this.wind,
      budgetScale: 1,
      vol: pools.vol,
      sharp: pools.sharp,
      geo: undefined,
      collision: undefined,
      rng: createRng(0x5eed1e),
    };
    this.applyQuality(ctx.quality.settings);
    this.unsubscribers.push(ctx.quality.onChange((s) => this.applyQuality(s)));
    ctx.scene.add(this.fire.light);
    ctx.pipeline.addHdrPass(this.pass);

    this.unsubscribers.push(
      ctx.events.on('splash', ({ position, strength }) => this.splash(position, strength)),
      ctx.events.on('ground-impact', ({ position, speed }) => this.dust(position, speed / 14)),
      ctx.events.on('flap', ({ strength }) => this.surface.onFlap(strength)),
    );
    ctx.services.provide('fx', this);
    try {
      await this.pass.precompile(ctx.renderer, ctx.camera);
      this.pass.warmUp(ctx.renderer, ctx);
    } catch (err) {
      console.warn('[fx] warm-up failed (programs will be finalized on first use)', err);
    }
  }

  splash(position: THREE.Vector3, strength: number): void {
    if (this.emit && this.vol) {
      this.surface.splash(this.emit, position, strength);
    }
  }

  dust(position: THREE.Vector3, strength: number): void {
    if (this.emit && this.vol) {
      this.surface.dust(this.emit, position, strength);
    }
  }

  /** (Re)creates the particle pools when the budget changes their capacity; returns the current pools. */
  private createPools(s: QualitySettings): { vol: ParticlePool; sharp: ParticlePool } {
    const volCap = THREE.MathUtils.clamp(Math.round(s.particleBudget * 0.32), 1024, 12288);
    const sharpCap = THREE.MathUtils.clamp(Math.round(s.particleBudget * 0.3), 1024, 12288);
    const fits = (pool: ParticlePool | null, cap: number): pool is ParticlePool => !!pool && Math.abs(pool.capacity - cap) <= 255;
    if (fits(this.vol, volCap) && fits(this.sharp, sharpCap)) {
      return { vol: this.vol, sharp: this.sharp };
    }
    this.vol?.dispose();
    this.sharp?.dispose();
    const vol = new ParticlePool(volCap, VOL_PROFILES);
    const sharp = new ParticlePool(sharpCap, SHARP_PROFILES);
    this.vol = vol;
    this.sharp = sharp;
    this.sorter = new DepthSorter(vol.capacity);
    this.pass?.setPools(vol, sharp);
    return { vol, sharp };
  }

  private applyQuality(s: QualitySettings): void {
    const pools = this.createPools(s);
    if (this.emit) {
      this.emit.vol = pools.vol;
      this.emit.sharp = pools.sharp;
      this.emit.budgetScale = THREE.MathUtils.clamp(s.particleBudget / 16000, 0.35, 1.6);
    }
    const budget = s.particleBudget;
    this.moteCapacity = Math.round(THREE.MathUtils.clamp(budget * 0.06, 240, MAX_MOTES));
    this.baseLowScale = s.preset === 'ultra' ? 0.7 : s.preset === 'low' ? 0.4 : 0.5;
    // High/ultra never go below half resolution: coarser particle layers turn foam and smoke edges blocky.
    this.minLowScale = s.preset === 'ultra' || s.preset === 'high' ? 0.5 : this.baseLowScale * 0.66;
    if (this.pass) {
      this.pass.lowScale = this.baseLowScale;
    }
  }

  update(dt: number, ctx: EngineContext): void {
    const emit = this.emit;
    if (!emit || !this.vol || !this.sharp) {
      return;
    }
    let now = ctx.time.elapsed - this.timeBase;
    if (now > REBASE_AFTER) {
      this.timeBase += REBASE_BY;
      this.vol.rebase(REBASE_BY);
      this.sharp.rebase(REBASE_BY);
      this.trails.rebase(REBASE_BY);
      this.surface.rebase(REBASE_BY);
      now -= REBASE_BY;
    }
    this.updateWind(dt, ctx);
    emit.now = now;
    emit.dt = dt;
    emit.geo = ctx.services.tryGet('geo');
    emit.collision = ctx.services.tryGet('collision');
    this.vol.advance(now);
    this.sharp.advance(now);

    const dragon = ctx.services.tryGet('dragon');
    const rig = ctx.services.tryGet('rig');
    this.fire.update(emit, dragon, rig, this.lights);
    this.surface.update(emit, dragon, rig);

    let humidity = 0.8;
    if (dragon) {
      const water = isWaterAt(emit, dragon.position.x, dragon.position.z);
      humidity = (water ? 1 : 0.8) * (1 - 0.35 * THREE.MathUtils.smoothstep(dragon.position.y, 1200, 3500));
    }
    this.trails.update(now, dt, dragon, rig, humidity);

    const cam = ctx.camera;
    cam.updateMatrixWorld();
    this.camPos.setFromMatrixPosition(cam.matrixWorld);
    this.camFwd.set(0, 0, -1).transformDirection(cam.matrixWorld);
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
    const count = this.sorter!.sort(this.vol, now, this.camPos, this.camFwd, this.wind, this.pass!.orderArray, tanHalfFov, cam.aspect);
    this.pass!.commitOrder(count);
    this.state.volCount = count;
    this.adaptResolution(this.sorter!.coverage, ctx.time.realDt);
    this.state.now = now;
  }

  preRender(ctx: EngineContext): void {
    const pass = this.pass;
    if (!pass || !this.sharp) {
      return;
    }
    const st = this.state;
    const dt = ctx.time.dt;
    const cam = ctx.camera;
    this.camPos.setFromMatrixPosition(cam.matrixWorld);
    if (!this.hasCam) {
      this.camPrev.copy(this.camPos);
      this.hasCam = true;
    }
    if (dt > 0) {
      this.rawVel.subVectors(this.camPos, this.camPrev).divideScalar(dt);
      if (this.rawVel.lengthSq() < 400 * 400) {
        this.camVel.lerp(this.rawVel, 1 - Math.exp(-dt / 0.06));
      }
      st.camVel.copy(this.camVel);
    } else {
      st.camVel.set(0, 0, 0);
    }
    this.camPrev.copy(this.camPos);
    st.wind.copy(this.wind);

    // Speed motes: sparse moisture/dust glints around the camera. Clearly felt in POV, barely there (and only at
    // high speed) in third person, where the dragon itself conveys the motion.
    const airSpeed = dt > 0 ? Math.hypot(this.camVel.x - this.wind.x, this.camVel.y - this.wind.y, this.camVel.z - this.wind.z) : 0;
    const pov = ctx.services.tryGet('cameraRig')?.mode === 'pov';
    const altitudeClean = 1 - 0.65 * THREE.MathUtils.smoothstep(this.camPos.y, 700, 2600);
    const strength = (pov ? THREE.MathUtils.smoothstep(airSpeed, 14, 65) * 0.5 : THREE.MathUtils.smoothstep(airSpeed, 34, 90) * 0.07) * altitudeClean;
    st.moteStrength = strength;
    st.moteCount = strength > 0.012 ? this.moteCapacity : 0;
    if (dt > 0) {
      const off = st.moteOffset;
      off.addScaledVector(this.wind, dt);
      off.set(((off.x % MOTE_BOX) + MOTE_BOX) % MOTE_BOX, ((off.y % MOTE_BOX) + MOTE_BOX) % MOTE_BOX, ((off.z % MOTE_BOX) + MOTE_BOX) % MOTE_BOX);
    }

    const sharp = this.sharp;
    const order = pass.sharpOrderArray;
    const live = sharp.liveSlots;
    const sharpCount = sharp.liveCount;
    for (let i = 0; i < sharpCount; i++) {
      order[i] = live[i];
    }
    pass.commitSharp(sharpCount);
    st.sharpCount = sharpCount;
    this.vol?.flush();
    sharp.flush();
    st.trailsVisible = this.trails.visible;
    pass.enabled = st.volCount > 0 || sharpCount + st.moteCount > 0 || st.trailsVisible;
  }

  /**
   * Heavy overdraw (camera close to a big fire or inside a spray cloud) lowers the half-resolution particle
   * target further; returns to the preset scale after a calm second. Quantized to avoid reallocation churn.
   */
  private adaptResolution(coverage: number, realDt: number): void {
    if (!this.pass) {
      return;
    }
    const level = coverage > 16 ? 2 : coverage > 7 ? 1 : 0;
    if (level > this.overdrawLevel) {
      this.overdrawLevel = level;
      this.calmTime = 0;
    } else if (level < this.overdrawLevel) {
      this.calmTime += realDt;
      if (this.calmTime > 1) {
        this.overdrawLevel = level;
        this.calmTime = 0;
      }
    } else {
      this.calmTime = 0;
    }
    const factor = this.overdrawLevel === 2 ? 0.66 : this.overdrawLevel === 1 ? 0.8 : 1;
    this.pass.lowScale = Math.max(this.minLowScale, this.baseLowScale * factor);
  }

  private updateWind(dt: number, ctx: EngineContext): void {
    const env = ctx.services.tryGet('env');
    const src = env ? env.wind : (globalUniforms.uWind.value as THREE.Vector3);
    const tx = src.x * 0.8;
    const ty = 0;
    const tz = src.z * 0.8;
    if (!this.windReady) {
      this.wind.set(tx, ty, tz);
      this.windReady = true;
    } else if (dt > 0) {
      const k = 1 - Math.exp(-dt / 10);
      this.wind.x += (tx - this.wind.x) * k;
      this.wind.z += (tz - this.wind.z) * k;
    }
  }

  pending(): number {
    return 0;
  }

  dispose(): void {
    for (const off of this.unsubscribers) {
      off();
    }
    this.unsubscribers = [];
    if (this.ctx && this.pass) {
      this.ctx.pipeline.removeHdrPass(this.pass);
      this.ctx.scene.remove(this.fire.light);
    }
    this.pass?.dispose();
    this.vol?.dispose();
    this.sharp?.dispose();
    this.trails.dispose();
    this.volumes?.dispose();
    this.blackbody?.dispose();
    this.fire.light.dispose();
  }
}
