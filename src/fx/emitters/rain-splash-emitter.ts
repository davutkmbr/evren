import type { WaterService } from '../../core/contracts';
import { createSpawnSpec, type SpawnSpec } from '../particles/particle-pool';
import { SharpType } from '../particles/types';
import { EmissionAccumulator, isWaterAt, poolThrottle, range, setGroundPlane, type EmitContext } from './emit-context';

/**
 * Rain drops splashing on the sea near the camera (phase 21 stage 6): tiny crowns of droplets jumping off the water
 * where drops land, only close to the camera where they can be seen (the drop rings further out are the water
 * shader's). Nothing without rain, over land, with the camera high above the water or under it.
 */
export const RAIN_SPLASH = {
  /** Splashes per second at full rain (before the particle budget scale) and droplets per splash. */
  rate: 220,
  dropsMin: 2,
  dropsMax: 4,
  /** Annulus around the camera's foot point (m); denser near the inner edge. */
  innerRadius: 1.5,
  outerRadius: 16,
  /** No splashes with the camera more than this above the water (m). */
  maxHeight: 40,
  /** Rain intensity below which nothing is emitted. */
  minRain: 0.02,
  /** Droplet launch speed (m/s), size (m) and life (s). */
  speedMin: 0.6,
  speedMax: 1.6,
  sizeMin: 0.005,
  sizeMax: 0.011,
  lifeMin: 0.22,
  lifeMax: 0.4,
  /** At most this many droplets per frame. */
  maxPerFrame: 120,
} as const;

export class RainSplashEmitter {
  private readonly spec: SpawnSpec = createSpawnSpec();
  private readonly acc = new EmissionAccumulator();
  /** Droplets spawned in the last frame (diagnostics). */
  spawned = 0;

  /** `rain` 0..1 (weather.current.rain); `cx, cy, cz` the camera position. */
  update(ctx: EmitContext, rain: number, water: WaterService | undefined, cx: number, cy: number, cz: number): void {
    this.spawned = 0;
    const R = RAIN_SPLASH;
    if (!(rain > R.minRain) || !water || !(ctx.dt > 0) || !Number.isFinite(cx + cy + cz)) {
      this.acc.reset();
      return;
    }
    const surface = water.heightAt(cx, cz);
    const height = cy - surface;
    if (!(height > -0.05) || height > R.maxHeight) {
      this.acc.reset();
      return;
    }
    const throttle = poolThrottle(ctx.sharp);
    if (throttle <= 0) {
      return;
    }
    const near = 1 - Math.max(0, (height - 10) / (R.maxHeight - 10));
    const splashes = this.acc.take(R.rate * Math.min(rain, 1) * ctx.budgetScale * throttle * near, ctx.dt);
    const rng = ctx.rng;
    const spec = this.spec;
    for (let i = 0; i < splashes && this.spawned < R.maxPerFrame; i++) {
      const a = rng() * Math.PI * 2;
      const r = R.innerRadius + (R.outerRadius - R.innerRadius) * Math.pow(rng(), 1.6);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (!isWaterAt(ctx, x, z)) continue;
      const y = water.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      const drops = Math.round(range(rng, R.dropsMin, R.dropsMax));
      const birth = ctx.now + rng() * ctx.dt;
      for (let k = 0; k < drops; k++) {
        const da = rng() * Math.PI * 2;
        const out = range(rng, 0.15, 0.5);
        const up = range(rng, R.speedMin, R.speedMax);
        spec.px = x;
        spec.py = y + 0.01;
        spec.pz = z;
        spec.vx = Math.cos(da) * out + ctx.wind.x * 0.05;
        spec.vy = up;
        spec.vz = Math.sin(da) * out + ctx.wind.z * 0.05;
        spec.birth = birth;
        spec.life = range(rng, R.lifeMin, R.lifeMax);
        spec.size0 = range(rng, R.sizeMin, R.sizeMax);
        spec.size1 = spec.size0 * 0.7;
        spec.drag = 0.4;
        spec.buoy = 0;
        spec.seed = rng();
        spec.type = SharpType.Droplet;
        spec.auxA = 0;
        spec.auxB = 0;
        spec.auxC = 0;
        setGroundPlane(spec, y);
        ctx.sharp.spawn(spec);
        this.spawned++;
      }
    }
  }
}
