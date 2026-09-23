import * as THREE from 'three';
import type { DragonRig, DragonState } from '../../core/contracts';
import { LandUse } from '../../core/contracts';
import { createSpawnSpec, type SpawnSpec } from '../particles/particle-pool';
import { packColor, SharpType, VolType } from '../particles/types';
import { wingTipPosition } from './rig-anchors';
import {
  EmissionAccumulator,
  groundHeightAt,
  isWaterAt,
  poolThrottle,
  range,
  setGroundPlane,
  surfaceHeightAt,
  type EmitContext,
} from './emit-context';

interface DustLook {
  color: number;
  debris: number;
  amount: number;
}

const look = (r: number, g: number, b: number, amount: number): DustLook => ({
  color: packColor(r, g, b),
  debris: packColor(r * 0.55, g * 0.52, b * 0.5),
  amount,
});

/** Linear albedo of the dust kicked up per land use, and how dusty the surface is. */
const DUST_BY_LAND_USE: Record<number, DustLook> = {
  [LandUse.Beach]: look(0.6, 0.5, 0.36, 1.25),
  [LandUse.Urban]: look(0.44, 0.42, 0.39, 0.65),
  [LandUse.HistoricUrban]: look(0.46, 0.42, 0.37, 0.7),
  [LandUse.Highrise]: look(0.42, 0.41, 0.4, 0.55),
  [LandUse.Industrial]: look(0.38, 0.36, 0.34, 0.9),
  [LandUse.Park]: look(0.33, 0.29, 0.21, 0.75),
  [LandUse.Forest]: look(0.27, 0.23, 0.17, 0.6),
  [LandUse.Farmland]: look(0.47, 0.38, 0.26, 1.2),
  [LandUse.Airport]: look(0.42, 0.41, 0.39, 0.6),
  [LandUse.Cemetery]: look(0.36, 0.32, 0.25, 0.7),
  [LandUse.Landmark]: look(0.5, 0.45, 0.38, 0.7),
  [LandUse.Road]: look(0.36, 0.35, 0.34, 0.6),
  [LandUse.Suburban]: look(0.43, 0.38, 0.3, 0.9),
};
const DEFAULT_DUST = look(0.45, 0.4, 0.32, 1);
/** Flat roofs, terraces and landmark tops: grit and grime, not much loose dust. */
const ROOF_DUST = look(0.4, 0.38, 0.36, 0.5);

const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _pos = new THREE.Vector3();

/**
 * Water and ground interaction: one-shot splashes (crown droplets, Worthington jet, mist, foam, ring wave),
 * the continuous spray curtain + foam wake while skimming, wing-tip spray, wing downwash over water/land
 * when hovering low, and landing dust coloured by land use.
 */
export class SurfaceEmitter {
  private readonly spec: SpawnSpec = createSpawnSpec();
  private readonly skimDrops = new EmissionAccumulator();
  private readonly skimMist = new EmissionAccumulator();
  private readonly skimFoam = new EmissionAccumulator();
  private readonly skimClumps = new EmissionAccumulator();
  private readonly tipDrops = [new EmissionAccumulator(), new EmissionAccumulator()];
  private readonly washMist = new EmissionAccumulator();
  private readonly washDrops = new EmissionAccumulator();
  private readonly washDust = new EmissionAccumulator();
  private readonly washDebris = new EmissionAccumulator();
  private readonly washFoam = new EmissionAccumulator();
  private flapPulse = 0;
  private ringCooldown = 0;
  private lastOneShot = { t: -1e9, x: 0, z: 0 };
  /** Latest water contact reported through splash(): frequent weak calls = continuous skimming. */
  private readonly contact = { t: -1e9, x: 0, z: 0, strength: 0 };
  private lastDustCall = -1e9;

  /** Shifts stored fx timestamps by -delta (fx time rebase). */
  rebase(delta: number): void {
    this.lastOneShot.t -= delta;
    this.contact.t -= delta;
    this.lastDustCall -= delta;
  }

  /** Wing beat: pulses the downwash. */
  onFlap(strength: number): void {
    this.flapPulse = Math.min(1.5, this.flapPulse + Math.max(0, strength));
  }

  /** Returns false when a near-identical one-shot fired a moment ago (service call + event for the same hit). */
  private dedupe(ctx: EmitContext, p: THREE.Vector3): boolean {
    const last = this.lastOneShot;
    if (ctx.now - last.t < 0.12 && Math.hypot(p.x - last.x, p.z - last.z) < 5) {
      return false;
    }
    last.t = ctx.now;
    last.x = p.x;
    last.z = p.z;
    return true;
  }

  splash(ctx: EmitContext, p: THREE.Vector3, strength: number): void {
    const c = this.contact;
    const sinceContact = ctx.now - c.t;
    c.t = ctx.now;
    c.x = p.x;
    c.z = p.z;
    c.strength = strength;
    if (sinceContact < 0.35 && strength < 1.3) {
      // Part of a continuous skim: the rate-based curtain in update() takes over.
      return;
    }
    if (!this.dedupe(ctx, p)) {
      return;
    }
    const s = THREE.MathUtils.clamp(strength, 0.05, 3);
    const rng = ctx.rng;
    const b = ctx.budgetScale;
    const spec = this.spec;
    const sharpT = poolThrottle(ctx.sharp);
    const volT = poolThrottle(ctx.vol);

    const drops = Math.min(500, Math.round((50 + 110 * s) * b * sharpT));
    for (let i = 0; i < drops; i++) {
      const a = rng() * Math.PI * 2;
      const column = rng() < 0.18;
      const r0 = column ? rng() * 0.3 : (0.3 + 0.9 * s) * Math.sqrt(rng());
      const speed = column ? (5 + 8 * s) * range(rng, 0.55, 1.1) : (3 + 6 * s) * range(rng, 0.35, 1.15);
      const elev = column ? range(rng, 1.35, 1.55) : range(rng, 0.9, 1.4);
      spec.px = p.x + Math.cos(a) * r0;
      spec.py = 0.05;
      spec.pz = p.z + Math.sin(a) * r0;
      spec.vx = Math.cos(a) * Math.cos(elev) * speed;
      spec.vy = Math.sin(elev) * speed;
      spec.vz = Math.sin(a) * Math.cos(elev) * speed;
      this.droplet(ctx, spec, range(rng, 0.04, 0.11) * (0.8 + 0.25 * s), 0.02);
    }

    // Crown sheet (outer ring, thrown out and up) and Worthington column (centre, late and near-vertical).
    const clumps = Math.round((60 + 110 * s) * b * volT);
    for (let i = 0; i < clumps; i++) {
      const a = rng() * Math.PI * 2;
      const column = rng() < 0.2;
      const r0 = column ? rng() * 0.4 : (0.5 + 1.0 * s) * (0.8 + 0.2 * rng());
      const speed = column ? (7 + 9 * s) * range(rng, 0.55, 1.1) : (4 + 7 * s) * range(rng, 0.5, 1.1);
      const elev = column ? range(rng, 1.38, 1.56) : range(rng, 0.85, 1.25);
      spec.px = p.x + Math.cos(a) * r0;
      spec.py = 0.1;
      spec.pz = p.z + Math.sin(a) * r0;
      spec.vx = Math.cos(a) * Math.cos(elev) * speed;
      spec.vy = Math.sin(elev) * speed;
      spec.vz = Math.sin(a) * Math.cos(elev) * speed;
      spec.birth = ctx.now + (column ? range(rng, 0.08, 0.25) : rng() * 0.05);
      spec.life = range(rng, 0.9, 1.7) * (0.8 + 0.2 * s);
      spec.size0 = range(rng, 0.1, 0.22) * (0.7 + 0.3 * s);
      spec.size1 = range(rng, 0.3, 0.65) * (0.7 + 0.4 * s);
      this.sprayClump(ctx, spec, range(rng, 1.0, 1.6));
    }

    const mist = Math.round((3 + 4 * s) * b * volT);
    for (let i = 0; i < mist; i++) {
      const a = rng() * Math.PI * 2;
      const r0 = (0.5 + 1.6 * s) * Math.sqrt(rng());
      spec.px = p.x + Math.cos(a) * r0;
      spec.py = range(rng, 1, 2.5 + 2 * s);
      spec.pz = p.z + Math.sin(a) * r0;
      const out = range(rng, 1, 3.5) * s;
      spec.vx = Math.cos(a) * out;
      spec.vy = range(rng, 0.5, 2.5) * Math.sqrt(s);
      spec.vz = Math.sin(a) * out;
      spec.birth = ctx.now + range(rng, 0.15, 0.5);
      spec.life = range(rng, 1.5, 2.6);
      spec.size0 = range(rng, 0.5, 0.9) * (0.7 + 0.3 * s);
      spec.size1 = range(rng, 1.4, 2.2) * (0.8 + 0.4 * s);
      spec.drag = 1.5;
      spec.buoy = 0;
      spec.seed = rng();
      spec.type = VolType.Mist;
      spec.auxA = 0;
      spec.auxB = range(rng, 0.035, 0.08);
      spec.auxC = 0;
      setGroundPlane(spec, 0);
      ctx.vol.spawn(spec);
    }

    this.ring(ctx, p, 0.4 + 0.5 * s, 4 + 5 * s, range(rng, 4, 6), 0.9, 0);
    if (s > 0.6) {
      this.ring(ctx, p, 0.3, 2.5 + 3 * s, range(rng, 3, 4.5), 0.6, 0.35);
    }
    const foam = Math.round((2 + 3 * s) * Math.max(b, 0.5));
    for (let i = 0; i < foam; i++) {
      const a = rng() * Math.PI * 2;
      const r0 = rng() * (0.5 + s);
      this.foam(ctx, p.x + Math.cos(a) * r0, p.z + Math.sin(a) * r0, range(rng, 1.2, 2.2) * (0.7 + 0.4 * s), range(rng, 3, 5.5) * (0.8 + 0.3 * s), range(rng, 7, 11), 0);
    }
  }

  dust(ctx: EmitContext, p: THREE.Vector3, strength: number): void {
    const frequent = ctx.now - this.lastDustCall < 0.35;
    this.lastDustCall = ctx.now;
    if (!this.dedupe(ctx, p)) {
      return;
    }
    if (frequent) {
      // Running touchdown / skid: repeated small bursts.
      strength *= 0.45;
    }
    const terrain = groundHeightAt(ctx, p.x, p.z);
    const top = surfaceHeightAt(ctx, p.x, p.z);
    // Roof/landmark landings use the collider top; an impact point clearly below it (a wall hit at street level,
    // a ledge) is trusted instead.
    const ground = p.y < top - 1.5 ? Math.max(p.y, terrain) : top;
    if (ground < 0.3 && p.y < 1.5 && isWaterAt(ctx, p.x, p.z)) {
      this.lastOneShot.t = -1e9;
      this.splash(ctx, p, strength);
      return;
    }
    const s = THREE.MathUtils.clamp(strength, 0.05, 3);
    const lookup = ground > terrain + 2 ? ROOF_DUST : this.dustLook(ctx, p.x, p.z);
    const rng = ctx.rng;
    const b = ctx.budgetScale;
    const spec = this.spec;
    const puffs = Math.round((16 + 30 * s) * b * lookup.amount * poolThrottle(ctx.vol));
    for (let i = 0; i < puffs; i++) {
      const a = rng() * Math.PI * 2;
      const r0 = (1 + 2 * s) * rng();
      const out = (3 + 6 * s) * range(rng, 0.4, 1.1);
      spec.px = p.x + Math.cos(a) * r0;
      spec.py = ground + range(rng, 0.3, 1.2);
      spec.pz = p.z + Math.sin(a) * r0;
      spec.vx = Math.cos(a) * out;
      spec.vy = range(rng, 0.3, 1.6);
      spec.vz = Math.sin(a) * out;
      spec.birth = ctx.now + rng() * 0.08;
      this.dustPuff(ctx, spec, lookup, ground, 0.8 + 0.3 * s, range(rng, 0.35, 0.6));
    }
    const debris = Math.round(22 * s * b * poolThrottle(ctx.sharp));
    for (let i = 0; i < debris; i++) {
      const a = rng() * Math.PI * 2;
      const out = range(rng, 2, 6) * s;
      spec.px = p.x + Math.cos(a) * rng() * 2;
      spec.py = ground + 0.2;
      spec.pz = p.z + Math.sin(a) * rng() * 2;
      spec.vx = Math.cos(a) * out;
      spec.vy = range(rng, 2, 7) * Math.sqrt(s);
      spec.vz = Math.sin(a) * out;
      this.debris(ctx, spec, lookup, ground);
    }
  }

  update(ctx: EmitContext, dragon: DragonState | undefined, rig: DragonRig | undefined): void {
    const dt = ctx.dt;
    if (dt <= 0) {
      return;
    }
    this.flapPulse *= Math.exp(-dt / 0.35);
    this.ringCooldown -= dt;
    if (!dragon) {
      return;
    }
    const pos = dragon.position;
    const vel = dragon.velocity;
    const speed = vel.length();
    const height = rig ? rig.dimensions.height : 4;
    const span = rig ? rig.dimensions.wingspan : 24;
    const overWater = isWaterAt(ctx, pos.x, pos.z);

    const belly = pos.y - height * 0.35;
    const recentContact = ctx.now - this.contact.t < 0.25;
    const skimming = overWater && speed > 4 && (recentContact || dragon.touchingWater || dragon.mode === 'swimming' || belly < 0.6);
    if (skimming) {
      this.skim(ctx, dragon, speed, span, recentContact);
    }

    if (rig && speed > 5) {
      for (let i = 0; i < 2; i++) {
        wingTipPosition(rig, dragon, i === 0 ? 0 : 1, _tip);
        if (_tip.y < 0.7 && _tip.y > -2 && isWaterAt(ctx, _tip.x, _tip.z)) {
          this.tipSpray(ctx, i, _tip, vel, speed);
        }
      }
    }

    const hoverish = dragon.mode === 'hovering' || dragon.mode === 'landing' || dragon.mode === 'takeoff' || dragon.mode === 'stalling';
    const slow = 1 - THREE.MathUtils.smoothstep(dragon.airspeed, 9, 22);
    const hover = Math.max(hoverish ? 0.8 : 0, slow);
    if (hover > 0.02 && dragon.mode !== 'grounded' && dragon.mode !== 'swimming') {
      // Height above whatever is below (roofs included): hovering over a rooftop raises its dust.
      const below = surfaceHeightAt(ctx, pos.x, pos.z);
      const range01 = THREE.MathUtils.clamp(1 - (pos.y - below) / (span * 1.1), 0, 1);
      const wash = hover * range01 * range01 * (0.35 + 0.5 * dragon.flapEffort + 0.6 * this.flapPulse);
      if (wash > 0.02) {
        this.downwash(ctx, pos, wash, span, below < 0.3 && overWater, below);
      }
    }
  }

  private skim(ctx: EmitContext, dragon: DragonState, speed: number, span: number, fromContact: boolean): void {
    const rng = ctx.rng;
    const spec = this.spec;
    const vel = dragon.velocity;
    const sf = THREE.MathUtils.clamp(speed / 30, 0.3, 1.6) * (fromContact ? THREE.MathUtils.clamp(0.5 + this.contact.strength * 0.6, 0.5, 1.4) : 1);
    _dir.set(vel.x, 0, vel.z);
    const hs = _dir.length();
    if (hs > 1e-3) {
      _dir.divideScalar(hs);
    } else {
      _dir.set(0, 0, -1);
    }
    _side.set(-_dir.z, 0, _dir.x);
    const b = ctx.budgetScale;
    const px = fromContact ? this.contact.x : dragon.position.x - _dir.x * 1.5;
    const pz = fromContact ? this.contact.z : dragon.position.z - _dir.z * 1.5;

    // V-shaped side sheets: water thrown sideways and up from the contact and left behind by the dragon (a sharp
    // wake), plus a rooster tail rising right behind the contact.
    const drops = this.skimDrops.take(300 * sf * b * poolThrottle(ctx.sharp), ctx.dt);
    for (let i = 0; i < drops; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const out = range(rng, 2.5, 8) * sf;
      const keep = range(rng, 0.1, 0.4);
      spec.px = px + _side.x * side * range(rng, 0.3, 1.3) - _dir.x * rng() * 1.5;
      spec.py = 0.1;
      spec.pz = pz + _side.z * side * range(rng, 0.3, 1.3) - _dir.z * rng() * 1.5;
      spec.vx = vel.x * keep + _side.x * side * out;
      spec.vy = range(rng, 2, 6.5) * sf;
      spec.vz = vel.z * keep + _side.z * side * out;
      spec.birth = ctx.now - ctx.dt * rng();
      this.droplet(ctx, spec, range(rng, 0.015, 0.045), -1);
    }
    const clumps = this.skimClumps.take(150 * sf * b * poolThrottle(ctx.vol), ctx.dt);
    for (let i = 0; i < clumps; i++) {
      if (rng() < 0.28) {
        const lateral = (rng() - 0.5) * 3;
        spec.px = px - _dir.x * range(rng, 0.5, 2.2) + _side.x * lateral * 0.3;
        spec.py = 0.2;
        spec.pz = pz - _dir.z * range(rng, 0.5, 2.2) + _side.z * lateral * 0.3;
        const keep = range(rng, 0.25, 0.45);
        spec.vx = vel.x * keep + _side.x * lateral;
        spec.vy = range(rng, 4.5, 9) * sf;
        spec.vz = vel.z * keep + _side.z * lateral;
        spec.life = range(rng, 0.8, 1.5);
      } else {
        const side = rng() < 0.5 ? -1 : 1;
        const out = range(rng, 3, 7.5) * sf;
        const keep = range(rng, 0.12, 0.35);
        spec.px = px + _side.x * side * range(rng, 0.3, 1.1) - _dir.x * rng() * 1.2;
        spec.py = 0.15;
        spec.pz = pz + _side.z * side * range(rng, 0.3, 1.1) - _dir.z * rng() * 1.2;
        spec.vx = vel.x * keep + _side.x * side * out;
        spec.vy = range(rng, 1.8, 5) * sf;
        spec.vz = vel.z * keep + _side.z * side * out;
        spec.life = range(rng, 0.6, 1.2);
      }
      spec.birth = ctx.now - ctx.dt * rng();
      spec.size0 = range(rng, 0.1, 0.2);
      spec.size1 = range(rng, 0.35, 0.7);
      this.sprayClump(ctx, spec, range(rng, 0.9, 1.5));
    }
    const mist = this.skimMist.take(10 * sf * b * poolThrottle(ctx.vol), ctx.dt);
    for (let i = 0; i < mist; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      spec.px = px + _side.x * side * range(rng, 0.5, 2.5) - _dir.x * rng() * 3;
      spec.py = range(rng, 0.4, 1.6);
      spec.pz = pz + _side.z * side * range(rng, 0.5, 2.5) - _dir.z * rng() * 3;
      spec.vx = vel.x * range(rng, 0.2, 0.4) + _side.x * side * range(rng, 1, 3.5) * sf;
      spec.vy = range(rng, 0.6, 2.2) * sf;
      spec.vz = vel.z * range(rng, 0.2, 0.4) + _side.z * side * range(rng, 1, 3.5) * sf;
      spec.birth = ctx.now - ctx.dt * rng();
      spec.life = range(rng, 1.2, 2.4);
      spec.size0 = range(rng, 0.4, 0.8);
      spec.size1 = range(rng, 1.4, 2.4) * (0.8 + 0.2 * sf);
      spec.drag = 1.8;
      spec.buoy = 0;
      spec.seed = rng();
      spec.type = VolType.Mist;
      spec.auxA = 0;
      spec.auxB = range(rng, 0.045, 0.1);
      spec.auxC = 0;
      setGroundPlane(spec, 0);
      ctx.vol.spawn(spec);
    }
    const foam = this.skimFoam.take(12 * Math.max(b, 0.5) * poolThrottle(ctx.vol), ctx.dt);
    for (let i = 0; i < foam; i++) {
      const lateral = (rng() - 0.5) * 2.5;
      this.foam(ctx, px + _side.x * lateral - _dir.x * rng() * 3, pz + _side.z * lateral - _dir.z * rng() * 3, range(rng, 1.2, 2), range(rng, 3.5, span * 0.22), range(rng, 8, 12), -ctx.dt * rng());
    }
  }

  private tipSpray(ctx: EmitContext, index: number, tip: THREE.Vector3, vel: THREE.Vector3, speed: number): void {
    const rng = ctx.rng;
    const spec = this.spec;
    const sf = THREE.MathUtils.clamp(speed / 30, 0.3, 1.5);
    const n = this.tipDrops[index].take(150 * sf * ctx.budgetScale * poolThrottle(ctx.sharp), ctx.dt);
    for (let i = 0; i < n; i++) {
      spec.px = tip.x + (rng() - 0.5) * 0.6;
      spec.py = 0.08;
      spec.pz = tip.z + (rng() - 0.5) * 0.6;
      spec.vx = vel.x * range(rng, 0.25, 0.55) + (rng() - 0.5) * 3 * sf;
      spec.vy = range(rng, 1.5, 6) * sf;
      spec.vz = vel.z * range(rng, 0.25, 0.55) + (rng() - 0.5) * 3 * sf;
      spec.birth = ctx.now - ctx.dt * rng();
      this.droplet(ctx, spec, range(rng, 0.02, 0.055), -1);
    }
  }

  private downwash(ctx: EmitContext, pos: THREE.Vector3, wash: number, span: number, overWater: boolean, below: number): void {
    const rng = ctx.rng;
    const spec = this.spec;
    const b = ctx.budgetScale;
    const ground = overWater ? 0 : below;
    const radius = span * 0.35;
    if (overWater) {
      const mist = this.washMist.take(55 * wash * b * poolThrottle(ctx.vol), ctx.dt);
      for (let i = 0; i < mist; i++) {
        const a = rng() * Math.PI * 2;
        const r0 = radius * range(rng, 0.3, 1);
        const out = range(rng, 4, 11) * wash;
        spec.px = pos.x + Math.cos(a) * r0;
        spec.py = range(rng, 0.2, 1);
        spec.pz = pos.z + Math.sin(a) * r0;
        spec.vx = Math.cos(a) * out;
        spec.vy = range(rng, 0.2, 1.4);
        spec.vz = Math.sin(a) * out;
        spec.birth = ctx.now - ctx.dt * rng();
        spec.life = range(rng, 1.8, 3.2);
        spec.size0 = range(rng, 0.7, 1.3);
        spec.size1 = range(rng, 2.5, 4);
        spec.drag = 1.3;
        spec.buoy = 0;
        spec.seed = rng();
        spec.type = VolType.Mist;
        spec.auxA = 0;
        spec.auxB = range(rng, 0.12, 0.25) * Math.min(1, wash * 1.5);
        spec.auxC = 0;
        setGroundPlane(spec, 0);
        ctx.vol.spawn(spec);
      }
      const drops = this.washDrops.take(160 * wash * b * poolThrottle(ctx.sharp), ctx.dt);
      for (let i = 0; i < drops; i++) {
        const a = rng() * Math.PI * 2;
        const r0 = radius * range(rng, 0.4, 1);
        const out = range(rng, 3, 9) * wash;
        spec.px = pos.x + Math.cos(a) * r0;
        spec.py = 0.05;
        spec.pz = pos.z + Math.sin(a) * r0;
        spec.vx = Math.cos(a) * out;
        spec.vy = range(rng, 1, 3.5) * wash;
        spec.vz = Math.sin(a) * out;
        spec.birth = ctx.now - ctx.dt * rng();
        this.droplet(ctx, spec, range(rng, 0.02, 0.05), -1);
      }
      if (this.flapPulse > 0.4 && this.ringCooldown <= 0) {
        this.ringCooldown = 0.6;
        _pos.set(pos.x, 0, pos.z);
        this.ring(ctx, _pos, radius * 0.5, span * (0.6 + 0.3 * wash), range(rng, 2.8, 4), 0.3 * Math.min(1, wash * 2), 0);
      }
      const foam = this.washFoam.take(5 * wash * poolThrottle(ctx.vol), ctx.dt);
      for (let i = 0; i < foam; i++) {
        const a = rng() * Math.PI * 2;
        const r0 = radius * rng();
        this.foam(ctx, pos.x + Math.cos(a) * r0, pos.z + Math.sin(a) * r0, 1.2, range(rng, 2.5, 4), range(rng, 4, 6), 0);
      }
    } else {
      const lookup = ground > groundHeightAt(ctx, pos.x, pos.z) + 2 ? ROOF_DUST : this.dustLook(ctx, pos.x, pos.z);
      const puffs = this.washDust.take(45 * wash * b * lookup.amount * poolThrottle(ctx.vol), ctx.dt);
      for (let i = 0; i < puffs; i++) {
        const a = rng() * Math.PI * 2;
        const r0 = radius * range(rng, 0.3, 1);
        const out = range(rng, 3, 10) * wash;
        spec.px = pos.x + Math.cos(a) * r0;
        spec.py = ground + range(rng, 0.2, 0.9);
        spec.pz = pos.z + Math.sin(a) * r0;
        spec.vx = Math.cos(a) * out;
        spec.vy = range(rng, 0.2, 1.2);
        spec.vz = Math.sin(a) * out;
        spec.birth = ctx.now - ctx.dt * rng();
        this.dustPuff(ctx, spec, lookup, ground, 0.9, range(rng, 0.25, 0.45) * Math.min(1, wash * 1.5));
      }
      const debris = this.washDebris.take(25 * wash * b * lookup.amount * poolThrottle(ctx.sharp), ctx.dt);
      for (let i = 0; i < debris; i++) {
        const a = rng() * Math.PI * 2;
        const out = range(rng, 2, 7) * wash;
        spec.px = pos.x + Math.cos(a) * radius * rng();
        spec.py = ground + 0.1;
        spec.pz = pos.z + Math.sin(a) * radius * rng();
        spec.vx = Math.cos(a) * out;
        spec.vy = range(rng, 0.8, 3) * wash;
        spec.vz = Math.sin(a) * out;
        this.debris(ctx, spec, lookup, ground);
      }
    }
  }

  private dustLook(ctx: EmitContext, x: number, z: number): DustLook {
    if (!ctx.geo) {
      return DEFAULT_DUST;
    }
    return DUST_BY_LAND_USE[ctx.geo.landUseAt(x, z)] ?? DEFAULT_DUST;
  }

  private droplet(ctx: EmitContext, spec: SpawnSpec, size: number, birthJitter: number): void {
    const rng = ctx.rng;
    if (birthJitter >= 0) {
      spec.birth = ctx.now + rng() * birthJitter;
    }
    spec.life = range(rng, 2.5, 4);
    spec.size0 = size;
    spec.size1 = size * 0.75;
    spec.drag = range(rng, 0.25, 0.8);
    spec.buoy = 0;
    spec.seed = rng();
    spec.type = SharpType.Droplet;
    spec.auxA = 0;
    spec.auxB = 0;
    spec.auxC = 0;
    setGroundPlane(spec, 0);
    ctx.sharp.spawn(spec);
  }

  private sprayClump(ctx: EmitContext, spec: SpawnSpec, density: number): void {
    spec.drag = range(ctx.rng, 0.5, 0.9);
    spec.buoy = 0;
    spec.seed = ctx.rng();
    spec.type = VolType.Spray;
    spec.auxA = 0;
    spec.auxB = density;
    spec.auxC = 0;
    setGroundPlane(spec, 0);
    ctx.vol.spawn(spec);
  }

  private dustPuff(ctx: EmitContext, spec: SpawnSpec, lookup: DustLook, ground: number, scale: number, opacity: number): void {
    const rng = ctx.rng;
    spec.life = range(rng, 3, 6);
    spec.size0 = range(rng, 0.8, 1.4) * scale;
    spec.size1 = range(rng, 2.5, 4.5) * scale;
    spec.drag = range(rng, 1.1, 1.5);
    spec.buoy = range(rng, 0, 0.8);
    spec.seed = rng();
    spec.type = VolType.Dust;
    spec.auxA = lookup.color;
    spec.auxB = opacity;
    spec.auxC = 0;
    setGroundPlane(spec, ground);
    ctx.vol.spawn(spec);
  }

  private debris(ctx: EmitContext, spec: SpawnSpec, lookup: DustLook, ground: number): void {
    const rng = ctx.rng;
    spec.birth = ctx.now + rng() * 0.05;
    spec.life = range(rng, 2, 3.5);
    spec.size0 = range(rng, 0.025, 0.07);
    spec.size1 = spec.size0;
    spec.drag = range(rng, 0.3, 0.6);
    spec.buoy = 0;
    spec.seed = rng();
    spec.type = SharpType.Debris;
    spec.auxA = lookup.debris;
    spec.auxB = 0;
    spec.auxC = 0;
    setGroundPlane(spec, ground);
    ctx.sharp.spawn(spec);
  }

  private ring(ctx: EmitContext, p: THREE.Vector3, r0: number, r1: number, life: number, opacity: number, delay: number): void {
    const spec = this.spec;
    const rng = ctx.rng;
    spec.px = p.x;
    spec.py = 0.06;
    spec.pz = p.z;
    spec.vx = 0;
    spec.vy = 0;
    spec.vz = 0;
    spec.birth = ctx.now + delay;
    spec.life = life;
    spec.size0 = r0;
    spec.size1 = r1;
    spec.drag = 1;
    spec.buoy = 0;
    spec.seed = rng();
    spec.type = VolType.Ring;
    spec.auxA = 0;
    spec.auxB = opacity;
    spec.auxC = 0;
    setGroundPlane(spec, -1e6);
    ctx.vol.spawn(spec);
  }

  private foam(ctx: EmitContext, x: number, z: number, r0: number, r1: number, life: number, delay: number): void {
    const spec = this.spec;
    const rng = ctx.rng;
    spec.px = x;
    spec.py = 0.05;
    spec.pz = z;
    spec.vx = 0;
    spec.vy = 0;
    spec.vz = 0;
    spec.birth = ctx.now + delay;
    spec.life = life;
    spec.size0 = r0;
    spec.size1 = r1;
    spec.drag = 1;
    spec.buoy = 0;
    spec.seed = rng();
    spec.type = VolType.Foam;
    spec.auxA = 0;
    spec.auxB = range(rng, 0.7, 1);
    spec.auxC = 0;
    setGroundPlane(spec, -1e6);
    ctx.vol.spawn(spec);
  }
}
