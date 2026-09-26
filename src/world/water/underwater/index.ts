/**
 * Camera under water (phase 21 stage 4): the `underwater` service (state.ts) and the floating particles. The post
 * pipeline (render/post: fog, tint, shafts, waterline, droplets), the water surface's underside and audio read the
 * service; above water everything here is hidden and costs nothing but one wave-height query per frame.
 */
import * as THREE from 'three';
import type { EngineContext, GeoQuery, WaterService } from '../../../core/contracts';
import type { QualityPreset } from '../../../core/quality';
import { globalUniforms } from '../../../core/uniforms';
import { UnderwaterParticles } from './particles';
import { UnderwaterState } from './state';

export { UNDERWATER_STATE, UnderwaterState } from './state';
export { UNDERWATER_PARTICLES } from './particles';

const _normal = new THREE.Vector3();
const _current = new THREE.Vector3();

export class UnderwaterController {
  readonly state = new UnderwaterState();
  private particles: UnderwaterParticles | null = null;
  private owner: EngineContext | null = null;
  private unsubscribe: (() => void) | null = null;

  init(ctx: EngineContext): void {
    this.owner = ctx;
    ctx.services.provide('underwater', this.state);
    this.particles = new UnderwaterParticles(ctx.quality.settings.preset);
    ctx.scene.add(this.particles.points);
    this.unsubscribe = ctx.quality.onChange((q) => this.particles?.setQuality(q.preset as QualityPreset));
  }

  /** After the water service has synced to this frame's sea state (and after the camera moved). */
  update(ctx: EngineContext, waves: WaterService, geo: GeoQuery | null): void {
    const cam = ctx.camera;
    const p = cam.position;
    const overWater = !!geo && geo.isWater(p.x, p.z);
    const surfaceY = overWater ? waves.heightAt(p.x, p.z) : 0;
    const normal = overWater ? waves.normalAt(p.x, p.z, _normal) : null;
    const dt = Math.min(Math.max(ctx.time.realDt, 0), 0.1);
    this.state.update(p.y, surfaceY, normal, overWater, dt);
    if (this.particles) {
      const visible = this.state.under || (this.state.lensActive && this.state.depth > -0.3);
      if (visible) {
        waves.currentAt(p.x, p.z, _current);
      }
      const resY = (globalUniforms.uResolution.value as THREE.Vector2).y;
      this.particles.update(visible, ctx.time.dt, this.state.surfaceY, _current, cam.projectionMatrix.elements[5] * resY * 0.5);
    }
  }

  dispose(): void {
    this.unsubscribe?.();
    this.particles?.dispose();
    this.particles = null;
    if (this.owner?.services.tryGet('underwater') === this.state) {
      this.owner.services.withdraw('underwater');
    }
  }
}
