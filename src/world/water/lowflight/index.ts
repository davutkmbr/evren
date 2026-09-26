/**
 * The sea reacting to low flight (phase 21 stage 2): the `lowFlight` service (low-flight.ts) and the disturbance field
 * the water surface samples (disturbance-window.ts + disturbance-gpu.ts). Owned by the water system: updated after the
 * sea state synced to this frame (flight and camera have run), simulated in the water's preRender.
 *
 * Off switches: above LOW_FLIGHT.queryHeight over the sea, over land, under water or without a dragon the model does
 * nothing but one isWater query and every value is 0; the field is not simulated (and the water shader's branch is
 * skipped) once DISTURBANCE_SIM.lifetime has passed since the last stamp; the "low" preset has no field at all.
 */
import * as THREE from 'three';
import type { DragonRig, DragonState, EngineContext, GeoQuery, WaterService } from '../../../core/contracts';
import { disturbanceQualityFor } from './config';
import { DisturbanceGpu, createDisturbanceUniforms, type DisturbanceUniforms } from './disturbance-gpu';
import { DisturbanceWindow } from './disturbance-window';
import { LowFlightModel, createLowFlightInput, fallbackAnchors, type LowFlightInput, type LowFlightWorld } from './low-flight';

export { LOW_FLIGHT, DISTURBANCE_SIM, DISTURBANCE_STAMPS, disturbanceQualityFor } from './config';
export { LowFlightModel, createLowFlightInput, fallbackAnchors } from './low-flight';
export { DisturbanceWindow } from './disturbance-window';
export { createDisturbanceUniforms, type DisturbanceUniforms } from './disturbance-gpu';

const _centre = { x: 0, z: 0 };

/** Copies the rig anchors into the model input; an anchor implausibly far from the body falls back to the geometry. */
function readAnchors(input: LowFlightInput, rig: DragonRig | undefined, dragon: DragonState): void {
  fallbackAnchors(input);
  if (!rig) {
    return;
  }
  const p = dragon.position;
  const span = input.wingspan;
  const tip = input.tips;
  rig.wingTipLeft.getWorldPosition(tip[0]);
  rig.wingTipRight.getWorldPosition(tip[1]);
  if (tip[0].distanceTo(p) > span || tip[1].distanceTo(p) > span || !Number.isFinite(tip[0].x + tip[1].x)) {
    fallbackAnchors(input);
    return;
  }
  rig.mouth.updateWorldMatrix(true, false);
  const e = rig.mouth.matrixWorld.elements;
  const mx = e[12];
  const my = e[13];
  const mz = e[14];
  const len = Math.hypot(e[8], e[9], e[10]);
  if (len > 1e-6 && Math.hypot(mx - p.x, my - p.y, mz - p.z) < input.length * 1.2) {
    input.mouth.set(mx, my, mz);
    input.mouthDir.set(-e[8] / len, -e[9] / len, -e[10] / len);
  }
}

export class LowFlightController {
  readonly model = new LowFlightModel();
  readonly window = new DisturbanceWindow();
  readonly uniforms: DisturbanceUniforms;
  private readonly gpu: DisturbanceGpu;
  private readonly input = createLowFlightInput();
  private geo: GeoQuery | null = null;
  private readonly world: LowFlightWorld = { water: null, isWater: (x, z) => (this.geo ? this.geo.isWater(x, z) : true) };
  private owner: EngineContext | null = null;
  private readonly unsubscribe: Array<() => void> = [];
  private readonly placeholder: THREE.DataTexture;

  constructor() {
    this.placeholder = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    this.placeholder.needsUpdate = true;
    this.uniforms = createDisturbanceUniforms(this.placeholder);
    this.gpu = new DisturbanceGpu(this.uniforms);
  }

  /** Simulation passes drawn in the last frame (0 while the field is off). */
  get passes(): number {
    return this.gpu.passes;
  }

  init(ctx: EngineContext): void {
    this.owner = ctx;
    this.window.setQuality(disturbanceQualityFor(ctx.quality.settings.preset));
    ctx.services.provide('lowFlight', this.model);
    this.unsubscribe.push(
      ctx.events.on('flap', ({ strength }) => this.model.onFlap(strength)),
      ctx.quality.onChange((q) => this.window.setQuality(disturbanceQualityFor(q.preset))),
    );
  }

  /** After the water service synced to this frame's sea state. */
  update(ctx: EngineContext, waves: WaterService, geo: GeoQuery | null): void {
    const dt = Math.min(Math.max(ctx.time.dt, 0), 0.1);
    const dragon = ctx.services.tryGet('dragon');
    const w = this.window;
    this.world.water = waves;
    this.geo = geo;
    if (!dragon) {
      w.beginFrame(ctx.time.elapsed, dt, ctx.camera.position.x, ctx.camera.position.z);
      this.model.update(dt, null, this.world, w);
      return;
    }
    const input = this.input;
    const rig = ctx.services.tryGet('rig');
    input.position.copy(dragon.position);
    input.velocity.copy(dragon.velocity);
    input.quaternion.copy(dragon.quaternion);
    input.mode = dragon.mode;
    input.airspeed = dragon.airspeed;
    input.flapEffort = dragon.flapEffort;
    input.firing = dragon.firing;
    input.touchingWater = dragon.touchingWater;
    if (rig) {
      input.wingspan = rig.dimensions.wingspan > 1 ? rig.dimensions.wingspan : 24;
      input.length = rig.dimensions.length > 1 ? rig.dimensions.length : 18.3;
      input.height = rig.dimensions.height > 0.5 ? rig.dimensions.height : 4.4;
    }
    // Rig anchors only matter while low over the water (or breathing fire): skip the matrix reads otherwise.
    const nearSea = dragon.altitude < 90 || dragon.firing;
    if (nearSea) {
      readAnchors(input, rig, dragon);
    } else {
      fallbackAnchors(input);
    }
    LowFlightModel.windowCentre(input.position, input.velocity, w.extent, _centre);
    w.beginFrame(ctx.time.elapsed, dt, _centre.x, _centre.z);
    this.model.update(dt, input, this.world, w);
  }

  /** Before the water draws: simulate the field and point the water uniforms at it (origin = the water's uOrigin). */
  preRender(ctx: EngineContext, originX: number, originZ: number): void {
    this.gpu.update(ctx.renderer, this.window, originX, originZ);
  }

  dispose(): void {
    for (const u of this.unsubscribe.splice(0)) {
      u();
    }
    if (this.owner?.services.tryGet('lowFlight') === this.model) {
      this.owner.services.withdraw('lowFlight');
    }
    this.gpu.dispose();
    this.placeholder.dispose();
  }
}
