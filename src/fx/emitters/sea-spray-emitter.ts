import type { WaterFoam, WaterSpraySource } from '../../core/contracts';
import { createSpawnSpec, type SpawnSpec } from '../particles/particle-pool';
import { SharpType, VolType } from '../particles/types';
import { EmissionAccumulator, poolThrottle, range, setGroundPlane, type EmitContext } from './emit-context';

/**
 * Spray of the sea (phase 21 stage 7c) from the water's spray sources (`water.foam.sprays`, rebuilt every frame from
 * the water's physics): spindrift torn off breaking crests by strong wind (fine drops and a mist streak blown
 * downwind), bow spray of fast hulls in chop or slamming (drops and whitewater clumps thrown outward and up), and the
 * rooster tails of planing craft. Rates come from the sources' strength; counts scale with the particle budget and
 * back off as the pools fill.
 */
export const SEA_SPRAY = {
  /** Spindrift per found breaking crest: drops, mist puffs (x strength). */
  spindriftDrops: 14,
  spindriftMist: 2,
  /** Bow spray per second at full strength per side: drops, clumps, mist puffs. */
  bowDrops: 90,
  bowClumps: 26,
  bowMist: 4,
  /** Rooster tail per second at full strength: drops, clumps. */
  propDrops: 120,
  propClumps: 30,
  /** At most this many particles per frame from all sea spray. */
  maxPerFrame: 360,
} as const;

export class SeaSprayEmitter {
  private readonly spec: SpawnSpec = createSpawnSpec();
  private readonly bowDrops = new EmissionAccumulator();
  private readonly bowClumps = new EmissionAccumulator();
  private readonly bowMist = new EmissionAccumulator();
  private readonly propDrops = new EmissionAccumulator();
  private readonly propClumps = new EmissionAccumulator();
  private readonly spindrift = new EmissionAccumulator();
  /** Particles spawned in the last frame (diagnostics). */
  spawned = 0;

  update(ctx: EmitContext, foam: WaterFoam | undefined): void {
    this.spawned = 0;
    const dt = ctx.dt;
    if (!foam || foam.sprayCount === 0 || dt <= 0) {
      return;
    }
    const b = ctx.budgetScale;
    const sharpT = poolThrottle(ctx.sharp);
    const volT = poolThrottle(ctx.vol);
    if (sharpT <= 0 && volT <= 0) {
      return;
    }
    let bowN = 0;
    let propN = 0;
    for (let i = 0; i < foam.sprayCount; i++) {
      const k = foam.sprays[i].kind;
      if (k === 'bow') bowN++;
      else if (k === 'prop') propN++;
    }
    for (let i = 0; i < foam.sprayCount && this.spawned < SEA_SPRAY.maxPerFrame; i++) {
      const s = foam.sprays[i];
      if (!Number.isFinite(s.x + s.y + s.z + s.strength) || s.strength <= 0) continue;
      if (s.kind === 'spindrift') {
        this.emitSpindrift(ctx, s, b, sharpT, volT);
      } else if (s.kind === 'bow') {
        this.emitBow(ctx, s, b, sharpT, volT, dt, bowN);
      } else {
        this.emitProp(ctx, s, b, sharpT, volT, dt, propN);
      }
    }
  }

  private emitSpindrift(ctx: EmitContext, s: WaterSpraySource, b: number, sharpT: number, volT: number): void {
    const rng = ctx.rng;
    const spec = this.spec;
    const wind = ctx.wind;
    const drops = Math.round(SEA_SPRAY.spindriftDrops * s.strength * b * sharpT * range(rng, 0.6, 1.4));
    const px = -s.dirZ;
    const pz = s.dirX;
    for (let i = 0; i < drops; i++) {
      const along = range(rng, -0.5, 0.5) * s.size;
      spec.px = s.x + px * along + s.dirX * range(rng, -0.3, 0.3);
      spec.py = s.y + range(rng, 0.05, 0.3);
      spec.pz = s.z + pz * along + s.dirZ * range(rng, -0.3, 0.3);
      const v = range(rng, 0.35, 0.8);
      spec.vx = wind.x * v + s.vx * 0.3;
      spec.vy = range(rng, 0.8, 2.6) * s.strength;
      spec.vz = wind.z * v + s.vz * 0.3;
      spec.birth = ctx.now + rng() * 0.08;
      spec.life = range(rng, 1.2, 2.4);
      spec.size0 = range(rng, 0.018, 0.045);
      spec.size1 = spec.size0 * 0.6;
      spec.drag = range(rng, 0.8, 1.6);
      spec.buoy = 0;
      spec.seed = rng();
      spec.type = SharpType.Droplet;
      spec.auxA = 0;
      spec.auxB = 0;
      spec.auxC = 0;
      setGroundPlane(spec, s.y);
      ctx.sharp.spawn(spec);
      this.spawned++;
    }
    const mist = this.spindrift.take(SEA_SPRAY.spindriftMist * s.strength * b * volT, 1);
    for (let i = 0; i < mist; i++) {
      spec.px = s.x + px * range(rng, -0.4, 0.4) * s.size;
      spec.py = s.y + range(rng, 0.3, 0.9);
      spec.pz = s.z + pz * range(rng, -0.4, 0.4) * s.size;
      spec.vx = wind.x * 0.8;
      spec.vy = range(rng, 0.3, 1.0);
      spec.vz = wind.z * 0.8;
      spec.birth = ctx.now + rng() * 0.1;
      spec.life = range(rng, 1.8, 3.2);
      spec.size0 = range(rng, 0.4, 0.8) * (0.6 + 0.2 * s.size);
      spec.size1 = spec.size0 * range(rng, 2.5, 4);
      spec.drag = 1.2;
      spec.buoy = 0;
      spec.seed = rng();
      spec.type = VolType.Mist;
      spec.auxA = 0;
      spec.auxB = range(rng, 0.03, 0.06) * s.strength;
      spec.auxC = 0;
      setGroundPlane(spec, s.y);
      ctx.vol.spawn(spec);
      this.spawned++;
    }
  }

  private emitBow(ctx: EmitContext, s: WaterSpraySource, b: number, sharpT: number, volT: number, dt: number, count: number): void {
    const rng = ctx.rng;
    const spec = this.spec;
    const share = 1 / Math.max(count, 1);
    const speed = Math.hypot(s.vx, s.vz);
    const drops = this.bowDrops.take(SEA_SPRAY.bowDrops * s.strength * b * sharpT * count, dt * share);
    for (let i = 0; i < drops; i++) {
      const out = range(rng, 0.15, 0.45) * speed;
      spec.px = s.x + s.dirX * range(rng, 0, 0.4);
      spec.py = s.y + range(rng, 0.1, 0.5);
      spec.pz = s.z + s.dirZ * range(rng, 0, 0.4);
      spec.vx = s.vx * 0.7 + s.dirX * out;
      spec.vy = range(rng, 1.5, 4.5) * (0.5 + s.strength);
      spec.vz = s.vz * 0.7 + s.dirZ * out;
      spec.birth = ctx.now + rng() * dt;
      spec.life = range(rng, 1, 2);
      spec.size0 = range(rng, 0.03, 0.08);
      spec.size1 = spec.size0 * 0.75;
      spec.drag = range(rng, 0.3, 0.8);
      spec.buoy = 0;
      spec.seed = rng();
      spec.type = SharpType.Droplet;
      spec.auxA = 0;
      spec.auxB = 0;
      spec.auxC = 0;
      setGroundPlane(spec, s.y);
      ctx.sharp.spawn(spec);
      this.spawned++;
    }
    const clumps = this.bowClumps.take(SEA_SPRAY.bowClumps * s.strength * b * volT * count, dt * share);
    for (let i = 0; i < clumps; i++) {
      const out = range(rng, 0.1, 0.35) * speed;
      spec.px = s.x;
      spec.py = s.y + 0.2;
      spec.pz = s.z;
      spec.vx = s.vx * 0.8 + s.dirX * out;
      spec.vy = range(rng, 1.2, 3.2) * (0.5 + s.strength);
      spec.vz = s.vz * 0.8 + s.dirZ * out;
      spec.birth = ctx.now + rng() * dt;
      spec.life = range(rng, 0.8, 1.4);
      spec.size0 = range(rng, 0.12, 0.25) * (0.5 + 0.1 * s.size);
      spec.size1 = spec.size0 * range(rng, 2, 3);
      spec.drag = range(rng, 0.5, 0.9);
      spec.buoy = 0;
      spec.seed = rng();
      spec.type = VolType.Spray;
      spec.auxA = 0;
      spec.auxB = range(rng, 0.8, 1.3);
      spec.auxC = 0;
      setGroundPlane(spec, s.y);
      ctx.vol.spawn(spec);
      this.spawned++;
    }
    const mist = this.bowMist.take(SEA_SPRAY.bowMist * s.strength * b * volT * count, dt * share);
    for (let i = 0; i < mist; i++) {
      spec.px = s.x + s.dirX * range(rng, 0.5, 1.5);
      spec.py = s.y + range(rng, 0.5, 1.5);
      spec.pz = s.z + s.dirZ * range(rng, 0.5, 1.5);
      spec.vx = s.vx * 0.5;
      spec.vy = range(rng, 0.3, 1);
      spec.vz = s.vz * 0.5;
      spec.birth = ctx.now + rng() * dt;
      spec.life = range(rng, 1.2, 2.2);
      spec.size0 = range(rng, 0.5, 1);
      spec.size1 = spec.size0 * range(rng, 2, 3);
      spec.drag = 1.4;
      spec.buoy = 0;
      spec.seed = rng();
      spec.type = VolType.Mist;
      spec.auxA = 0;
      spec.auxB = range(rng, 0.03, 0.06) * s.strength;
      spec.auxC = 0;
      setGroundPlane(spec, s.y);
      ctx.vol.spawn(spec);
      this.spawned++;
    }
  }

  private emitProp(ctx: EmitContext, s: WaterSpraySource, b: number, sharpT: number, volT: number, dt: number, count: number): void {
    const rng = ctx.rng;
    const spec = this.spec;
    const share = 1 / Math.max(count, 1);
    const speed = Math.hypot(s.vx, s.vz);
    const drops = this.propDrops.take(SEA_SPRAY.propDrops * s.strength * b * sharpT * count, dt * share);
    for (let i = 0; i < drops; i++) {
      const back = range(rng, 0.1, 0.35) * speed;
      const side = range(rng, -1, 1) * 0.15 * speed;
      spec.px = s.x;
      spec.py = s.y + 0.1;
      spec.pz = s.z;
      spec.vx = s.vx * 0.6 + s.dirX * back - s.dirZ * side;
      spec.vy = range(rng, 3, 7) * s.strength;
      spec.vz = s.vz * 0.6 + s.dirZ * back + s.dirX * side;
      spec.birth = ctx.now + rng() * dt;
      spec.life = range(rng, 1, 2);
      spec.size0 = range(rng, 0.03, 0.07);
      spec.size1 = spec.size0 * 0.75;
      spec.drag = range(rng, 0.3, 0.8);
      spec.buoy = 0;
      spec.seed = rng();
      spec.type = SharpType.Droplet;
      spec.auxA = 0;
      spec.auxB = 0;
      spec.auxC = 0;
      setGroundPlane(spec, s.y);
      ctx.sharp.spawn(spec);
      this.spawned++;
    }
    const clumps = this.propClumps.take(SEA_SPRAY.propClumps * s.strength * b * volT * count, dt * share);
    for (let i = 0; i < clumps; i++) {
      spec.px = s.x;
      spec.py = s.y + 0.2;
      spec.pz = s.z;
      spec.vx = s.vx * 0.7 + s.dirX * range(rng, 0.1, 0.3) * speed;
      spec.vy = range(rng, 2.5, 5.5) * s.strength;
      spec.vz = s.vz * 0.7 + s.dirZ * range(rng, 0.1, 0.3) * speed;
      spec.birth = ctx.now + rng() * dt;
      spec.life = range(rng, 0.8, 1.5);
      spec.size0 = range(rng, 0.1, 0.22);
      spec.size1 = spec.size0 * range(rng, 2, 3);
      spec.drag = range(rng, 0.5, 0.9);
      spec.buoy = 0;
      spec.seed = rng();
      spec.type = VolType.Spray;
      spec.auxA = 0;
      spec.auxB = range(rng, 0.8, 1.2);
      spec.auxC = 0;
      setGroundPlane(spec, s.y);
      ctx.vol.spawn(spec);
      this.spawned++;
    }
  }
}
