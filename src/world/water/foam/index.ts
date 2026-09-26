/**
 * Foam and spray of the sea (phase 21 stage 7c): the whitecap model, the advected foam field around the camera, its
 * sources and the spray sources for fx. Owned by the water system: `update` after the sea state synced to this frame
 * (the whitecap statistics, the window's clock and placement, the spray sources), `preRender` after the wave particles
 * were splatted (stamps from hulls, splashes and the dragon; the simulation steps).
 *
 * Quality: the field shares the splat window's size and texel (512² x 1 m on "high"); "low" has no field, the water
 * shader then shows whitecaps from the spectrum alone and the ribbon wakes keep their foam line.
 */
import * as THREE from 'three';
import type { EngineContext, LowFlightView } from '../../../core/contracts';
import type { WaterUniforms } from '../material';
import type { SeaState } from '../sea-state';
import type { WaveQuery } from '../wave-query';
import { FOAM_SIM, WHITECAPS, foamQualityFor, type FoamQuality } from './config';
import { FoamGpu, createFoamFieldUniforms, type FoamFieldUniforms } from './foam-gpu';
import { FoamSources, type DragonFoamInput } from './foam-sources';
import { FoamWindow } from './foam-window';
import { createFoamStepParams, foamStepParams, type FoamStepParams } from './params';
import { WhitecapModel } from './whitecaps';

export { FOAM_SIM, HULL_FOAM, DRAGON_FOAM, SPRAY, WHITECAPS, foamQualityFor } from './config';
export { FoamWindow } from './foam-window';
export { FoamSources } from './foam-sources';
export { WhitecapModel, monahanCoverage } from './whitecaps';
export { createFoamFieldUniforms, type FoamFieldUniforms } from './foam-gpu';

const _fwd = new THREE.Vector3();
const _tipA = new THREE.Vector3();
const _tipB = new THREE.Vector3();

export class FoamController {
  readonly window = new FoamWindow();
  readonly sources = new FoamSources();
  readonly model = new WhitecapModel();
  readonly params: FoamStepParams = createFoamStepParams();
  readonly uniforms: FoamFieldUniforms;
  quality: FoamQuality = foamQualityFor('high');
  private gpu: FoamGpu | null = null;
  private readonly placeholder: THREE.DataTexture;
  private readonly dragonInput: DragonFoamInput = { mode: 'flying', position: new THREE.Vector3(), velocity: new THREE.Vector3(), low: null, tips: null, wingspan: 24 };
  private readonly tips: [THREE.Vector3, THREE.Vector3] = [_tipA, _tipB];
  private waves: WaveQuery | null = null;
  private readonly heightAt = (x: number, z: number): number => (this.waves ? this.waves.heightAt(x, z) : 0);

  constructor() {
    this.placeholder = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    this.placeholder.needsUpdate = true;
    this.uniforms = createFoamFieldUniforms(this.placeholder, this.model.zTable);
  }

  /** Simulation passes and stamps drawn in the last frame. */
  get passes(): number {
    return this.gpu?.passes ?? 0;
  }

  get stamped(): number {
    return this.gpu?.stamped ?? 0;
  }

  setQuality(q: FoamQuality): void {
    this.quality = q;
    this.window.setQuality(q);
    this.sources.sprayQuality = q.spray;
  }

  /** Once the water material's uniforms exist (the sim shares the slot table and maps with it). */
  attach(water: WaterUniforms): void {
    this.gpu?.dispose();
    this.gpu = new FoamGpu(this.uniforms, water);
  }

  /** After the sea state synced to this frame. */
  update(ctx: EngineContext, sea: SeaState, waves: WaveQuery): void {
    const dt = Math.min(Math.max(ctx.time.dt, 0), 0.25);
    this.waves = waves;
    const w = this.window;
    const cam = ctx.camera;
    this.model.update(sea, w.enabled ? w.texel : 0);
    w.beginFrame(dt, cam.position.x, cam.position.z);
    const wind = sea.uniforms.uWindParams.value;
    foamStepParams(this.model.sim, this.model.omegaOpen, w.simTime, sea.u10, wind.x, wind.y, this.params);
    cam.getWorldDirection(_fwd);
    this.sources.beginFrame(dt, this.params.capTime, cam.position.x, cam.position.z, _fwd.x, _fwd.z, waves, this.model, w.enabled ? w.texel : 0, wind.x, wind.y, sea.u10);
    // Shader-only whitecaps ("low"; also the far sea outside the field): x = open-sea breaking probability,
    // y = soft edge, z = open-sea mean frequency, w = the breaking cells' clock.
    this.uniforms.uFoamCaps.value.set(this.model.shader.prob, WHITECAPS.edge, this.model.omegaOpen, this.params.capTime);
    this.uniforms.uFoamParams.value.z = FOAM_SIM.windDrift * sea.u10;
    this.uniforms.uFoamParams.value.w = this.model.coverage;
  }

  /** Before the water draws (after the splat): stamps, simulation steps, the water's field uniforms. */
  preRender(ctx: EngineContext, originX: number, originZ: number): void {
    const dragon = ctx.services.tryGet('dragon');
    let input: DragonFoamInput | null = null;
    if (dragon && this.window.enabled) {
      input = this.dragonInput;
      input.mode = dragon.mode;
      input.position.copy(dragon.position);
      input.velocity.copy(dragon.velocity);
      input.low = (ctx.services.tryGet('lowFlight') as LowFlightView | undefined) ?? null;
      const rig = ctx.services.tryGet('rig');
      input.tips = null;
      if (rig && dragon.mode === 'swimming') {
        rig.wingTipLeft.getWorldPosition(_tipA);
        rig.wingTipRight.getWorldPosition(_tipB);
        if (Number.isFinite(_tipA.x + _tipB.x)) input.tips = this.tips;
      }
      input.wingspan = rig && rig.dimensions.wingspan > 1 ? rig.dimensions.wingspan : 24;
    }
    this.sources.flush(this.window, input, this.waves ? this.heightAt : null);
    this.gpu?.update(ctx.renderer, this.window, this.params, originX, originZ);
  }

  dispose(): void {
    this.gpu?.dispose();
    this.gpu = null;
    this.sources.clear();
    this.placeholder.dispose();
  }
}
