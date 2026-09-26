import * as THREE from 'three';
import type { DragonBondState, DragonRig, DragonState } from '../../core/contracts';
import { createSpawnSpec, type SpawnSpec } from '../particles/particle-pool';
import { packColor, SharpType, VolType } from '../particles/types';
import { EmissionAccumulator, poolThrottle, range, type EmitContext } from './emit-context';

/** Nostrils relative to the mouth anchor (m): forward along the snout and up (the anchor sits inside the mouth). */
const NOSTRIL_FORWARD = 0.42;
const NOSTRIL_UP = 0.13;
const NOSTRIL_APART = 0.09;
/** Steam puffs per second at full exhale and full nostril steam. */
const STEAM_RATE = 26;
/** Sneeze smoke: a small grey cloud (packed albedo, soot is darker). */
const SNEEZE_SMOKE = packColor(0.42, 0.4, 0.38);

type PuffKind = 'smoke' | 'flame' | 'steam' | 'droplets';

const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _mouth = new THREE.Vector3();

/**
 * The dragon's breath (phase 06 bond): visible steam from the nostrils on each exhale in cold or humid air, and the
 * one-shot puffs of the self-driven behaviours (smoke on a sneeze, a small flame at the end of a yawn, a steam huff,
 * water drops flung off by a shake). Purely visual.
 */
export class BreathEmitter {
  private readonly spec: SpawnSpec = createSpawnSpec();
  private readonly steam = new EmissionAccumulator();
  private readonly queue: { kind: PuffKind; strength: number }[] = [];

  puff(kind: PuffKind, strength: number): void {
    if (this.queue.length < 8 && Number.isFinite(strength)) {
      this.queue.push({ kind, strength: Math.max(0, Math.min(1.5, strength)) });
    }
  }

  update(ctx: EmitContext, dragon: DragonState | undefined, rig: DragonRig | undefined, bond: DragonBondState | undefined): void {
    if (!dragon || !rig) {
      this.queue.length = 0;
      return;
    }
    rig.mouth.updateWorldMatrix(true, false);
    _m.copy(rig.mouth.matrixWorld);
    _pos.setFromMatrixPosition(_m);
    if (_pos.distanceTo(dragon.position) > rig.dimensions.length * 1.2) {
      this.queue.length = 0;
      return;
    }
    _fwd.setFromMatrixColumn(_m, 2).negate().normalize();
    _up.setFromMatrixColumn(_m, 1).normalize();
    _right.crossVectors(_fwd, _up).normalize();
    _vel.copy(dragon.velocity);
    const nostrils = _pos.addScaledVector(_fwd, NOSTRIL_FORWARD).addScaledVector(_up, NOSTRIL_UP);

    const steam = bond ? bond.nostrilSteam * bond.exhale : 0;
    const n = this.steam.take(STEAM_RATE * steam * ctx.budgetScale * poolThrottle(ctx.vol), ctx.dt);
    for (let i = 0; i < n; i++) {
      this.emitSteam(ctx, nostrils, 0.6 + 0.4 * steam, i % 2 === 0 ? 1 : -1);
    }
    for (const p of this.queue) {
      switch (p.kind) {
        case 'smoke':
          for (let i = 0; i < 10 * p.strength; i++) {
            this.emitSmoke(ctx, nostrils, p.strength);
          }
          break;
        case 'steam':
          for (let i = 0; i < 8 * p.strength; i++) {
            this.emitSteam(ctx, nostrils, 1.4 * p.strength, i % 2 === 0 ? 1 : -1);
          }
          break;
        case 'flame':
          for (let i = 0; i < 14 * p.strength; i++) {
            this.emitFlame(ctx, nostrils, p.strength);
          }
          break;
        case 'droplets':
          for (let i = 0; i < 40 * p.strength * ctx.budgetScale; i++) {
            this.emitDroplet(ctx, dragon, p.strength);
          }
          break;
      }
    }
    this.queue.length = 0;
  }

  private base(ctx: EmitContext, at: THREE.Vector3, side: number): SpawnSpec {
    const s = this.spec;
    const rng = ctx.rng;
    s.px = at.x + _right.x * NOSTRIL_APART * side + (rng() - 0.5) * 0.04;
    s.py = at.y + _right.y * NOSTRIL_APART * side + (rng() - 0.5) * 0.04;
    s.pz = at.z + _right.z * NOSTRIL_APART * side + (rng() - 0.5) * 0.04;
    s.birth = ctx.now - ctx.dt * rng();
    s.seed = rng();
    s.planeNx = 0;
    s.planeNz = 0;
    s.planeD = -1e6;
    s.auxA = 0;
    s.auxC = 0;
    s.auxD = 0;
    // Air entrained with the flying dragon: the puff trails behind the head instead of hanging still.
    s.cvx = _vel.x * 0.25;
    s.cvy = _vel.y * 0.25;
    s.cvz = _vel.z * 0.25;
    return s;
  }

  private emitSteam(ctx: EmitContext, at: THREE.Vector3, k: number, side: number): void {
    const rng = ctx.rng;
    const s = this.base(ctx, at, side);
    const out = range(rng, 0.8, 1.6) * k;
    s.vx = _vel.x + _fwd.x * out * 0.6 - _up.x * out * 0.5 + _right.x * side * 0.3;
    s.vy = _vel.y + _fwd.y * out * 0.6 - _up.y * out * 0.5 + _right.y * side * 0.3;
    s.vz = _vel.z + _fwd.z * out * 0.6 - _up.z * out * 0.5 + _right.z * side * 0.3;
    s.life = range(rng, 0.9, 1.6);
    s.size0 = range(rng, 0.05, 0.08);
    s.size1 = range(rng, 0.35, 0.55) * Math.min(1.4, k);
    s.drag = 2.2;
    s.buoy = range(rng, 0.5, 1.2);
    s.type = VolType.Steam;
    s.auxB = range(rng, 0.25, 0.4) * Math.min(1, k);
    ctx.vol.spawn(s);
  }

  private emitSmoke(ctx: EmitContext, at: THREE.Vector3, k: number): void {
    const rng = ctx.rng;
    const s = this.base(ctx, at, rng() < 0.5 ? 1 : -1);
    const out = range(rng, 2, 4.5) * k;
    s.vx = _vel.x + _fwd.x * out - _up.x * out * 0.35 + (rng() - 0.5) * 0.8;
    s.vy = _vel.y + _fwd.y * out - _up.y * out * 0.35 + (rng() - 0.5) * 0.8;
    s.vz = _vel.z + _fwd.z * out - _up.z * out * 0.35 + (rng() - 0.5) * 0.8;
    s.life = range(rng, 1.6, 2.6);
    s.size0 = range(rng, 0.08, 0.14);
    s.size1 = range(rng, 0.7, 1.1) * k;
    s.drag = 1.8;
    s.buoy = range(rng, 1, 2);
    s.type = VolType.Smoke;
    s.auxA = SNEEZE_SMOKE;
    s.auxB = range(rng, 0.3, 0.45);
    ctx.vol.spawn(s);
  }

  private emitFlame(ctx: EmitContext, at: THREE.Vector3, k: number): void {
    const rng = ctx.rng;
    // A small tongue from the mouth (a little lower and further forward than the nostrils).
    const s = this.base(ctx, _mouth.copy(at).addScaledVector(_up, -NOSTRIL_UP * 1.4), 0);
    const out = range(rng, 3, 6) * k;
    s.vx = _vel.x + _fwd.x * out + (rng() - 0.5) * 0.6;
    s.vy = _vel.y + _fwd.y * out + (rng() - 0.5) * 0.6 + 0.5;
    s.vz = _vel.z + _fwd.z * out + (rng() - 0.5) * 0.6;
    s.life = range(rng, 0.35, 0.6);
    s.size0 = range(rng, 0.06, 0.1);
    s.size1 = range(rng, 0.25, 0.4) * k;
    s.drag = 2.5;
    s.buoy = range(rng, 3, 5);
    s.type = VolType.Flame;
    s.auxA = range(rng, 0.8, 1.1);
    s.auxB = range(rng, 0.8, 1.2);
    s.auxC = range(rng, 0.7, 0.85);
    s.auxD = 0.15;
    ctx.vol.spawn(s);
  }

  private emitDroplet(ctx: EmitContext, dragon: DragonState, k: number): void {
    const rng = ctx.rng;
    const s = this.spec;
    // Along the neck and the shoulders: from the head back towards the body centre.
    const u = rng();
    s.px = _pos.x + (dragon.position.x - _pos.x) * u + (rng() - 0.5) * 0.8;
    s.py = _pos.y + (dragon.position.y - _pos.y) * u + (rng() - 0.5) * 0.5 + 0.4;
    s.pz = _pos.z + (dragon.position.z - _pos.z) * u + (rng() - 0.5) * 0.8;
    const a = rng() * Math.PI * 2;
    const sp = range(rng, 2, 5) * k;
    s.vx = dragon.velocity.x + Math.cos(a) * sp;
    s.vy = dragon.velocity.y + range(rng, 1, 3.5);
    s.vz = dragon.velocity.z + Math.sin(a) * sp;
    s.birth = ctx.now - ctx.dt * rng();
    s.life = range(rng, 0.6, 1.2);
    s.size0 = range(rng, 0.014, 0.024);
    s.size1 = s.size0 * 0.75;
    s.drag = range(rng, 0.2, 0.5);
    s.buoy = 0;
    s.seed = rng();
    s.type = SharpType.Droplet;
    s.auxA = 0;
    s.auxB = 0;
    s.auxC = 0;
    s.auxD = 0;
    s.planeNx = 0;
    s.planeNz = 0;
    s.planeD = -1e6;
    s.cvx = 0;
    s.cvy = 0;
    s.cvz = 0;
    ctx.sharp.spawn(s);
  }
}
