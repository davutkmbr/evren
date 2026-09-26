import * as THREE from 'three';
import type { DragonRig, DragonState, LowFlightView } from '../../core/contracts';
import { createSpawnSpec } from '../particles/particle-pool';
import { jetSpeedForReach } from '../particles/motion';
import { packColor, SharpType, VolType } from '../particles/types';
import { blackbodyRgb } from '../render/blackbody';
import { mouthTransform } from './rig-anchors';
import {
  coneDirection,
  EmissionAccumulator,
  isWaterAt,
  poolThrottle,
  range,
  setGroundPlane,
  setPlane,
  surfaceHeightAt,
  type EmitContext,
} from './emit-context';

/** Fire light values for particle shading (position + color × intensity, same units as PointLight). */
export interface FireLightState {
  pos: [THREE.Vector3, THREE.Vector3];
  color: [THREE.Color, THREE.Color];
}

const REACH = 40;
/**
 * Flame drag (1/s): high, so the jet is fast out of the mouth and gets most of its reach while still hot (a
 * flamethrower-like rod of fire 25-40 m long) instead of creeping out and piling up into a ball where it stalls.
 */
const JET_DRAG = 2.1;
/** Embers and sparks keep the gentler launch they were tuned for (they have their own, much lower drag). */
const SHARP_LAUNCH_DRAG = 1.55;
/**
 * Fraction of the mouth velocity carried by the air around a flying dragon (entrained flow). Flames stay ahead of
 * the dragon; cooled smoke keeps little of it, so it peels off below and behind the rider's line of sight quickly
 * instead of hanging in front of the camera.
 */
const CARRY = [0.85, 0.85, 0.3, 0.5, 0.35];
const RAY_INTERVAL = 0.05;
const SOOT_COLOR = packColor(0.055, 0.05, 0.046);
const BURN_SMOKE_COLOR = packColor(0.08, 0.075, 0.07);

/**
 * Dragon fire breath: a turbulent flamethrower jet from rig.mouth (-Z) that inherits the mouth velocity, with a
 * blue premixed root, white-yellow core, short-lived cooling blackbody body handing off to soot, persistent smoke
 * billows, embers and sparks, steam where it hits water, burn smoke where it hits ground. One flickering scene
 * light (placed between mouth and impact) lights the dragon and surroundings; particles are shaded by two
 * virtual lights (mouth + flame/impact) that cost nothing in the main scene.
 */
export class FireEmitter {
  readonly light: THREE.PointLight;

  private ramp = 0;
  private hasPrev = false;
  private readonly pos = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly prevPos = new THREE.Vector3();
  private readonly prevDir = new THREE.Vector3();
  private readonly mouthVel = new THREE.Vector3();
  private readonly rawVel = new THREE.Vector3();
  private readonly core = new EmissionAccumulator();
  private readonly body = new EmissionAccumulator();
  private readonly smoke = new EmissionAccumulator();
  private readonly embers = new EmissionAccumulator();
  private readonly sparks = new EmissionAccumulator();
  private readonly steam = new EmissionAccumulator();
  /** Seconds until the next hissing steam spurt where the fire meets the sea. */
  private puffTimer = 0;
  private readonly burn = new EmissionAccumulator();
  private readonly spec = createSpawnSpec();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpPos = new THREE.Vector3();
  private readonly lerpDir = new THREE.Vector3();
  private readonly worldJet = new THREE.Vector3();
  private readonly hitPoint = new THREE.Vector3();
  private readonly hitNormal = new THREE.Vector3(0, 1, 0);
  private hitValid = false;
  private hitWater = false;
  private hitDistance = 0;
  private groundPlane = -1e6;
  /** The surface the jet will reach is water: embers and sparks die (hiss) instead of glowing on it. */
  private planeWater = false;
  private rayTimer = 0;
  private flameReach = REACH;
  private readonly mouthColor = new THREE.Color();
  private readonly flameColor = new THREE.Color();
  private readonly mouthLightPos = new THREE.Vector3();
  private readonly flameLightPos = new THREE.Vector3();

  constructor() {
    blackbodyRgb(2150, this.mouthColor);
    blackbodyRgb(1850, this.flameColor);
    this.light = new THREE.PointLight(this.mouthColor, 0, 300, 2);
    this.light.name = 'fx-fire-light';
  }

  update(ctx: EmitContext, dragon: DragonState | undefined, rig: DragonRig | undefined, lights: FireLightState, low?: LowFlightView): void {
    const dt = ctx.dt;
    // Fire meeting the sea (lowFlight service, the same point the water boils at and the hiss plays from). It keeps
    // steaming for a moment after the breath stops, so it runs before the early returns below.
    const seaSteam = !!low && low.steam > 0.01 && dt > 0;
    if (seaSteam) {
      this.seaSteam(ctx, low);
    }
    const firing = !!dragon && !!rig && dragon.firing;
    if (dt > 0) {
      this.ramp = THREE.MathUtils.clamp(this.ramp + (firing ? dt * 6.5 : -dt * 3.2), 0, 1);
    }
    const env = this.ramp * this.ramp * (3 - 2 * this.ramp);

    if (!rig) {
      this.hasPrev = false;
      this.setLights(0, lights, ctx.now);
      return;
    }
    mouthTransform(rig, dragon, this.pos, this.dir);

    const jumped = this.hasPrev && this.pos.distanceToSquared(this.prevPos) > 60 * 60;
    if (!this.hasPrev || jumped) {
      this.prevPos.copy(this.pos);
      this.prevDir.copy(this.dir);
      if (dragon) {
        this.mouthVel.copy(dragon.velocity);
      }
    } else if (dt > 0) {
      this.rawVel.subVectors(this.pos, this.prevPos).divideScalar(dt);
      this.mouthVel.lerp(this.rawVel, 1 - Math.exp(-dt / 0.06));
    }
    this.hasPrev = true;

    if (env <= 0.001 || dt <= 0) {
      this.setLights(env, lights, ctx.now);
      this.prevPos.copy(this.pos);
      this.prevDir.copy(this.dir);
      return;
    }

    const underwater = this.pos.y < 0.3 && isWaterAt(ctx, this.pos.x, this.pos.z);
    if (underwater) {
      if (!seaSteam) {
        this.emitSteam(ctx, this.tmpPos.set(this.pos.x, 0.2, this.pos.z), 90 * env, 4, 0);
      }
      this.setLights(0, lights, ctx.now);
      this.prevPos.copy(this.pos);
      this.prevDir.copy(this.dir);
      return;
    }

    const along = Math.max(0, this.mouthVel.dot(this.dir)) * (1 - CARRY[1]);
    const reach = REACH * (0.4 + 0.6 * env);
    const jetSpeed = jetSpeedForReach(reach, JET_DRAG, along);
    const sharpSpeed = jetSpeedForReach(reach, SHARP_LAUNCH_DRAG, along);
    this.flameReach = reach;
    // Jet velocity relative to the entrained air: sets the reach and the surface the flame will splash against.
    this.worldJet.copy(this.dir).multiplyScalar(jetSpeed).addScaledVector(this.mouthVel, 1 - CARRY[1]);

    this.rayTimer -= dt;
    if (this.rayTimer <= 0) {
      this.rayTimer = RAY_INTERVAL;
      this.castJet(ctx, reach);
    }

    const k = ctx.budgetScale * env;
    const volT = poolThrottle(ctx.vol);
    const sharpT = poolThrottle(ctx.sharp);
    // At speed the smoke is stretched over a long trail: less of it per metre.
    const smokeSpread = 1 / (1 + this.mouthVel.length() / 25);
    this.emitJet(ctx, this.core.take(420 * k * volT, dt), 0, jetSpeed);
    this.emitJet(ctx, this.body.take(170 * k * volT, dt), 1, jetSpeed);
    this.emitJet(ctx, this.smoke.take(26 * k * volT * smokeSpread, dt), 2, jetSpeed);
    this.emitJet(ctx, this.embers.take(40 * k * sharpT, dt), 3, sharpSpeed);
    this.emitJet(ctx, this.sparks.take(42 * k * sharpT, dt), 4, sharpSpeed);

    if (this.hitValid && this.hitDistance < reach * 1.25) {
      const closeness = 1 - this.hitDistance / (reach * 1.25);
      if (this.hitWater) {
        if (!seaSteam) {
          this.emitSteam(ctx, this.hitPoint, 70 * k * closeness * volT, 6, 1);
        }
      } else {
        this.emitBurnSmoke(ctx, 16 * k * closeness * volT);
      }
    }

    this.setLights(env, lights, ctx.now);
    this.prevPos.copy(this.pos);
    this.prevDir.copy(this.dir);
  }

  /** Raycasts the jet's world trajectory to find the surface it will splash against. */
  private castJet(ctx: EmitContext, reach: number): void {
    const speed = this.worldJet.length();
    const travel = Math.min(speed / JET_DRAG, 150);
    this.tmpDir.copy(this.worldJet).divideScalar(Math.max(speed, 1e-3));
    this.hitValid = false;
    const col = ctx.collision;
    if (col && travel > 1) {
      const hit = col.raycast(this.pos, this.tmpDir, travel, true);
      if (hit) {
        this.hitValid = true;
        this.hitPoint.copy(hit.point);
        this.hitNormal.copy(hit.normal);
        this.hitDistance = hit.distance;
        this.hitWater = hit.surface === 'water' || (hit.point.y < 0.4 && isWaterAt(ctx, hit.point.x, hit.point.z));
      }
    }
    let ground = -1e6;
    let water = true;
    const span = Math.min(travel, Math.max(reach * 2, 40));
    for (let i = 1; i <= 3; i++) {
      const t = (span * i) / 3;
      const x = this.pos.x + this.tmpDir.x * t;
      const z = this.pos.z + this.tmpDir.z * t;
      const h = surfaceHeightAt(ctx, x, z);
      if (h > ground) {
        ground = h;
        water = h < 0.3 && isWaterAt(ctx, x, z);
      }
    }
    this.groundPlane = Math.min(ground, this.pos.y - 0.5);
    this.planeWater = this.hitValid ? this.hitWater : water;
  }

  /**
   * kind: 0 core, 1 body, 2 smoke billow, 3 ember, 4 spark. Particles are spread over the frame
   * (sub-frame births and interpolated mouth transforms) so fast flight never leaves gaps.
   */
  private emitJet(ctx: EmitContext, n: number, kind: number, jetSpeed: number): void {
    if (n <= 0) {
      return;
    }
    const rng = ctx.rng;
    const s = this.spec;
    const sharp = kind >= 3;
    for (let i = 0; i < n; i++) {
      const f = (i + rng()) / n;
      this.tmpPos.lerpVectors(this.prevPos, this.pos, f);
      this.lerpDir.lerpVectors(this.prevDir, this.dir, f).normalize();
      s.birth = ctx.now - ctx.dt * (1 - f);
      s.seed = rng();
      if (this.hitValid) {
        setPlane(s, this.hitNormal, this.hitPoint);
      } else {
        setGroundPlane(s, this.groundPlane);
      }
      let angle: number;
      let speedScale: number;
      let jitter: number;
      switch (kind) {
        case 0:
          // Core: premixed blue root, then the white-yellow sooting core that runs down the middle of the jet
          // (~25 m), sheared into long bright streaks by its speed.
          angle = 0.022;
          speedScale = range(rng, 0.95, 1.04);
          jitter = 0.4;
          s.type = VolType.Flame;
          s.life = range(rng, 0.38, 0.6);
          s.size0 = range(rng, 0.09, 0.14);
          s.size1 = range(rng, 0.24, 0.38);
          s.drag = JET_DRAG * range(rng, 0.95, 1.05);
          s.buoy = 2.5;
          s.auxA = range(rng, 0.4, 0.55);
          s.auxB = range(rng, 0.15, 0.3);
          s.auxC = range(rng, 1.0, 1.1);
          s.auxD = 0.3;
          break;
        case 1:
          // Body: turbulent yellow -> orange tongues that burn out within ~1 s and leave soot behind. Their reach is
          // spread over the whole jet (slow tongues die early), so the flame reads as one long column rather than
          // a ball piling up where the fast ones stall.
          angle = 0.045;
          speedScale = 0.45 + 0.58 * Math.sqrt(rng());
          jitter = 0.8;
          s.type = VolType.Flame;
          s.life = range(rng, 0.8, 1.2);
          s.size0 = range(rng, 0.18, 0.28);
          s.size1 = range(rng, 0.34, 0.55);
          s.drag = JET_DRAG * range(rng, 0.9, 1.1);
          s.buoy = range(rng, 5, 8);
          // Cooler than the core (yellow-orange, not white), so the white core reads as a streak down the middle,
          // but slow to cool: the tongues stay alight to the end of the jet.
          s.auxA = range(rng, 0.85, 1.15);
          s.auxB = range(rng, 0.8, 1.25);
          s.auxC = range(rng, 0.7, 0.85);
          s.auxD = 0.15;
          break;
        case 2:
          // Smoke billow: hidden while the flames around it still burn, then rolls on as dense soot.
          angle = 0.1;
          speedScale = range(rng, 0.5, 0.75);
          jitter = 1.5;
          s.type = VolType.Smoke;
          s.life = range(rng, 4.5, 7);
          s.size0 = range(rng, 0.6, 0.9);
          s.size1 = range(rng, 3.2, 4.6);
          s.drag = JET_DRAG * range(rng, 1.05, 1.25);
          s.buoy = range(rng, 7, 11);
          s.auxA = SOOT_COLOR;
          s.auxB = range(rng, 0.4, 0.65);
          s.auxC = range(rng, 0.75, 1.1);
          s.auxD = 0;
          break;
        case 3:
          angle = 0.14;
          speedScale = range(rng, 0.6, 1.2);
          jitter = 3.5;
          s.type = SharpType.Ember;
          s.life = range(rng, 1.6, 3.6);
          s.size0 = range(rng, 0.035, 0.065);
          s.size1 = 0.012;
          s.drag = range(rng, 0.35, 0.75);
          s.buoy = range(rng, 9, 14);
          s.auxA = range(rng, 1500, 2300);
          s.auxB = range(rng, 10, 26);
          s.auxC = this.planeWater ? 1 : 0;
          s.auxD = 0;
          break;
        default:
          angle = 0.16;
          speedScale = range(rng, 0.9, 1.3);
          jitter = 5;
          s.type = SharpType.Spark;
          s.life = range(rng, 0.3, 0.85);
          s.size0 = range(rng, 0.028, 0.04);
          s.size1 = 0.008;
          s.drag = range(rng, 0.3, 0.5);
          s.buoy = 3;
          s.auxA = range(rng, 2100, 2900);
          s.auxB = range(rng, 12, 24);
          s.auxC = this.planeWater ? 1 : 0;
          s.auxD = 0;
          break;
      }
      const carry = CARRY[kind];
      s.cvx = this.mouthVel.x * carry;
      s.cvy = this.mouthVel.y * carry;
      s.cvz = this.mouthVel.z * carry;
      coneDirection(this.lerpDir, angle, rng, this.tmpDir);
      const v = jetSpeed * speedScale;
      s.vx = this.mouthVel.x + this.tmpDir.x * v + (rng() - 0.5) * jitter;
      s.vy = this.mouthVel.y + this.tmpDir.y * v + (rng() - 0.5) * jitter;
      s.vz = this.mouthVel.z + this.tmpDir.z * v + (rng() - 0.5) * jitter;
      const ahead = rng() * 0.25;
      s.px = this.tmpPos.x + this.lerpDir.x * ahead;
      s.py = this.tmpPos.y + this.lerpDir.y * ahead;
      s.pz = this.tmpPos.z + this.lerpDir.z * ahead;
      (sharp ? ctx.sharp : ctx.vol).spawn(s);
    }
  }

  /**
   * Fire boiling the sea: a steady steam cloud rising from the wave surface at the low-flight steam point plus hissing
   * spurts (tight, fast-rising puffs every 0.1-0.35 s, the visual beat of the hiss).
   */
  private seaSteam(ctx: EmitContext, low: LowFlightView): void {
    const k = low.steam;
    const volT = poolThrottle(ctx.vol);
    const at = low.steamPoint;
    this.emitSteam(ctx, at, 80 * ctx.budgetScale * k * volT, 3 + 3 * k, 1, at.y);
    this.puffTimer -= ctx.dt;
    if (this.puffTimer > 0) {
      return;
    }
    const rng = ctx.rng;
    this.puffTimer = range(rng, 0.1, 0.35);
    const n = Math.round((3 + 6 * k) * ctx.budgetScale * volT);
    const s = this.spec;
    const cx = at.x + (rng() - 0.5) * 4 * k;
    const cz = at.z + (rng() - 0.5) * 4 * k;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * 1.2;
      s.px = cx + Math.cos(a) * r;
      s.py = at.y + range(rng, 0.1, 0.5);
      s.pz = cz + Math.sin(a) * r;
      s.vx = Math.cos(a) * range(rng, 0.5, 2) + this.worldJet.x * 0.05;
      s.vy = range(rng, 4, 9) * (0.6 + 0.4 * k);
      s.vz = Math.sin(a) * range(rng, 0.5, 2) + this.worldJet.z * 0.05;
      s.birth = ctx.now + rng() * 0.06;
      s.life = range(rng, 1.4, 2.6);
      s.size0 = range(rng, 0.4, 0.8);
      s.size1 = range(rng, 2.2, 3.6);
      s.drag = 1.6;
      s.buoy = range(rng, 4, 7);
      s.seed = rng();
      s.type = VolType.Steam;
      s.cvx = 0;
      s.cvy = 0;
      s.cvz = 0;
      s.auxA = 0;
      s.auxB = range(rng, 0.55, 0.85);
      s.auxC = 0;
      setGroundPlane(s, at.y);
      ctx.vol.spawn(s);
    }
  }

  /** White steam boiling off water (fire hitting the sea, or breathing underwater); `base` = the water surface. */
  private emitSteam(ctx: EmitContext, at: THREE.Vector3, rate: number, spread: number, inherit: number, base = 0): void {
    const n = this.steam.take(rate, ctx.dt);
    const rng = ctx.rng;
    const s = this.spec;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * spread;
      s.px = at.x + Math.cos(a) * r;
      s.py = base + 0.3;
      s.pz = at.z + Math.sin(a) * r;
      s.vx = Math.cos(a) * range(rng, 0.5, 2.5) + this.worldJet.x * 0.08 * inherit;
      s.vy = range(rng, 1.5, 4);
      s.vz = Math.sin(a) * range(rng, 0.5, 2.5) + this.worldJet.z * 0.08 * inherit;
      s.birth = ctx.now - ctx.dt * rng();
      s.life = range(rng, 2.4, 4.2);
      s.size0 = range(rng, 0.9, 1.4);
      s.size1 = range(rng, 3.2, 5);
      s.drag = 1.2;
      s.buoy = range(rng, 3, 5);
      s.seed = rng();
      s.type = VolType.Steam;
      s.cvx = 0;
      s.cvy = 0;
      s.cvz = 0;
      s.auxA = 0;
      s.auxB = range(rng, 0.45, 0.7);
      s.auxC = 0;
      setGroundPlane(s, base);
      ctx.vol.spawn(s);
    }
  }

  /** Dark smoke rising where the flame licks the ground or a building. */
  private emitBurnSmoke(ctx: EmitContext, rate: number): void {
    const n = this.burn.take(rate, ctx.dt);
    const rng = ctx.rng;
    const s = this.spec;
    for (let i = 0; i < n; i++) {
      s.px = this.hitPoint.x + this.hitNormal.x * 1.5 + (rng() - 0.5) * 6;
      s.py = this.hitPoint.y + this.hitNormal.y * 1.5 + rng() * 1.5;
      s.pz = this.hitPoint.z + this.hitNormal.z * 1.5 + (rng() - 0.5) * 6;
      s.vx = (rng() - 0.5) * 2 + this.hitNormal.x * 2;
      s.vy = range(rng, 1, 3);
      s.vz = (rng() - 0.5) * 2 + this.hitNormal.z * 2;
      s.birth = ctx.now - ctx.dt * rng();
      s.life = range(rng, 4, 6.5);
      s.size0 = range(rng, 1.2, 2);
      s.size1 = range(rng, 3.5, 5.5);
      s.drag = 1.1;
      s.buoy = range(rng, 4, 6);
      s.seed = rng();
      s.type = VolType.Smoke;
      s.cvx = 0;
      s.cvy = 0;
      s.cvz = 0;
      s.auxA = BURN_SMOKE_COLOR;
      s.auxB = range(rng, 0.35, 0.55);
      s.auxC = 0;
      setPlane(s, this.hitNormal, this.hitPoint);
      ctx.vol.spawn(s);
    }
  }

  private setLights(env: number, lights: FireLightState, t: number): void {
    const flick0 = 1 + 0.17 * Math.sin(t * 38.1) * Math.sin(t * 9.7 + 0.6) + 0.1 * Math.sin(t * 23.3 + 1.7) + 0.05 * Math.sin(t * 61.7);
    const flick1 = 1 + 0.2 * Math.sin(t * 17.3 + 2.2) * Math.sin(t * 6.1) + 0.12 * Math.sin(t * 31.9 + 0.4) + 0.06 * Math.sin(t * 53.3 + 1.1);
    const i0 = 170 * env * flick0;
    const i1 = 480 * env * flick1;
    const mouth = this.mouthLightPos.copy(this.pos).addScaledVector(this.dir, 2.8);
    mouth.y += 0.4;
    const hitClose = this.hitValid && this.hitDistance < this.flameReach * 1.1;
    const flame = this.flameLightPos;
    if (hitClose) {
      flame.copy(this.hitPoint).addScaledVector(this.hitNormal, 2.5);
    } else {
      flame.copy(this.pos).addScaledVector(this.dir, this.flameReach * 0.5);
      flame.y += 1.5;
    }
    // Scene light: close to the mouth (lights the head and neck) unless the flame splashes against something near.
    const toward = hitClose ? THREE.MathUtils.clamp(1.1 - this.hitDistance / this.flameReach, 0.25, 0.8) : 0.18;
    this.light.position.lerpVectors(mouth, flame, toward);
    this.light.intensity = (i0 + i1) * 0.8;
    this.light.color.copy(this.mouthColor).lerp(this.flameColor, 0.5);
    lights.pos[0].copy(mouth);
    lights.pos[1].copy(flame);
    lights.color[0].copy(this.mouthColor).multiplyScalar(i0);
    lights.color[1].copy(this.flameColor).multiplyScalar(i1);
  }
}
