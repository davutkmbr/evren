/**
 * One pod of dolphins (pure TS, no three.js, seeded): the pod travels along the strait in loose formation, steering
 * clear of the shore; each dolphin travels a couple of metres down between breaths and comes up in group pulses for a
 * porpoising arc, a slow surface roll (back and dorsal fin showing) or, now and then, a full leap with a splash.
 *
 * Modes: `travel`; `accompany` (the dragon low over the water close by: the pod rides beside it, bow-riding its
 * pressure wave, with more leaps); `scatter` (the dragon plunged in near them or a big splash: they flee a little
 * deeper, then regroup and carry on, excited for a while); `leave` (life over: no more breaths, they go deep and the
 * pod is `done`). Heights are relative to the local water surface (`env.surface`), so every act starts and ends in the
 * water whatever the waves do.
 */
import { DOLPHIN_ACCOMPANY, DOLPHIN_ACTS, DOLPHIN_POD, DOLPHIN_SCATTER } from './config';

export const ACT = { dive: 0, porpoise: 1, roll: 2, leap: 3 } as const;
export type ActId = (typeof ACT)[keyof typeof ACT];

export type PodMode = 'travel' | 'accompany' | 'scatter' | 'leave';

export const EVENT = { breath: 0, leap: 1, splash: 2 } as const;
export type EventId = (typeof EVENT)[keyof typeof EVENT];

const G = 9.81;
const MAX_EVENTS = 64;
const COURSE_EVERY = 0.5;

/** The world a pod swims in (adapters over the water service, GeoQuery and the lane field). */
export interface DolphinEnv {
  /** Water surface height (m). */
  surface(x: number, z: number): number;
  /** Signed distance to the coast (m): positive on land, negative over water. */
  coast(x: number, z: number): number;
  /** Unit course along the strait (north → south) into `out`; returns the distance from its centreline (m). */
  course(x: number, z: number, out: { x: number; z: number }): number;
}

/** The dragon as the pod sees it. */
export interface DolphinDragon {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  /** Low over the water (skimming, hovering low, swimming). */
  low: boolean;
  /** Under water (plunge dive, swimming under). */
  underwater: boolean;
}

export interface PodOptions {
  count: number;
  x: number;
  z: number;
  /** Unit heading of travel. */
  hx: number;
  hz: number;
  rng: () => number;
  /** Life (s); random within DOLPHIN_POD.life when omitted. */
  life?: number;
}

const range = (rng: () => number, r: readonly [number, number]): number => r[0] + (r[1] - r[0]) * rng();

export class DolphinPod {
  readonly count: number;
  /** World position (y = world height), orientation and pose per dolphin. */
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly pz: Float64Array;
  readonly yaw: Float64Array;
  readonly pitch: Float64Array;
  readonly roll: Float64Array;
  /** Tail beat phase (rad) and amplitude (0..1), body length (m) and a tint (0..1: species / individual colouring). */
  readonly beat: Float64Array;
  readonly beatAmp: Float64Array;
  readonly size: Float64Array;
  readonly tint: Float64Array;
  /** Height relative to the local water surface (m, body centre). */
  readonly yRel: Float64Array;
  readonly act: Uint8Array;

  /** Pod centre and heading, speed (m/s). */
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  speed: number;
  mode: PodMode = 'travel';
  age = 0;
  life: number;
  /** True once the pod has left (removed by the owner). */
  done = false;
  /** Stats for checks and debug. */
  readonly stats = { acts: 0, leaps: 0, porpoises: 0, rolls: 0, accompanied: 0, scattered: 0, maxShore: -Infinity };

  /** Events of the last update (breath at a surfacing, leap exit, splash at an entry). */
  eventCount = 0;
  readonly eventKind = new Uint8Array(MAX_EVENTS);
  readonly eventX = new Float64Array(MAX_EVENTS);
  readonly eventY = new Float64Array(MAX_EVENTS);
  readonly eventZ = new Float64Array(MAX_EVENTS);
  readonly eventStrength = new Float64Array(MAX_EVENTS);

  private readonly rng: () => number;
  private readonly cruise: number;
  private readonly ox: Float64Array;
  private readonly oz: Float64Array;
  private readonly tox: Float64Array;
  private readonly toz: Float64Array;
  private readonly wanderPhase: Float64Array;
  private readonly scx: Float64Array;
  private readonly scz: Float64Array;
  private readonly svx: Float64Array;
  private readonly svz: Float64Array;
  private readonly actT: Float64Array;
  private readonly actDur: Float64Array;
  private readonly actPeak: Float64Array;
  private readonly actBase: Float64Array;
  private readonly actSide: Float64Array;
  private readonly diveLeft: Float64Array;
  private readonly prevX: Float64Array;
  private readonly prevZ: Float64Array;
  private pulseIn: number;
  private modeT = 0;
  private restT = 0;
  private lowGrace = 0;
  private excited = 0;
  private regroup = 0;
  private side = 1;
  private courseIn = 0;
  private readonly courseDir = { x: 0, z: 1 };
  private readonly scratch = { x: 0, z: 0 };

  constructor(o: PodOptions) {
    const n = Math.max(1, Math.floor(o.count));
    this.count = n;
    this.rng = o.rng;
    const f = (): Float64Array => new Float64Array(n);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.yaw = f();
    this.pitch = f();
    this.roll = f();
    this.beat = f();
    this.beatAmp = f();
    this.size = f();
    this.tint = f();
    this.yRel = f();
    this.act = new Uint8Array(n);
    this.ox = f();
    this.oz = f();
    this.tox = f();
    this.toz = f();
    this.wanderPhase = f();
    this.scx = f();
    this.scz = f();
    this.svx = f();
    this.svz = f();
    this.actT = f();
    this.actDur = f();
    this.actPeak = f();
    this.actBase = f();
    this.actSide = f();
    this.diveLeft = f();
    this.prevX = f();
    this.prevZ = f();
    const l = Math.hypot(o.hx, o.hz) || 1;
    this.cx = o.x;
    this.cz = o.z;
    this.hx = o.hx / l;
    this.hz = o.hz / l;
    const rng = this.rng;
    this.cruise = DOLPHIN_POD.cruise + (rng() * 2 - 1) * DOLPHIN_POD.cruiseJitter;
    this.speed = this.cruise;
    this.life = o.life ?? range(rng, DOLPHIN_POD.life);
    // One species per pod (common dolphins in the Bosphorus mostly, bottlenose now and then): tint < 0.5 = common.
    const species = rng() < 0.7 ? 0 : 0.5;
    const S = DOLPHIN_POD.spacing;
    for (let i = 0; i < n; i++) {
      // Loose staggered formation: rows of two or three, the leader in front.
      const row = Math.floor((i + 1) / 2.5);
      const col = i === 0 ? 0 : ((i % 3) - 1) * (0.8 + 0.4 * rng());
      this.tox[i] = col * S + (rng() - 0.5) * 1.5;
      this.toz[i] = -row * S * 0.9 + (rng() - 0.5) * 1.5;
      this.ox[i] = this.tox[i];
      this.oz[i] = this.toz[i];
      this.wanderPhase[i] = rng() * 100;
      this.size[i] = species === 0 ? 1.8 + 0.5 * rng() : 2.3 + 0.7 * rng();
      // A calf now and then.
      if (i > 1 && rng() < 0.15) this.size[i] *= 0.6;
      this.tint[i] = species + 0.49 * rng();
      this.beat[i] = rng() * Math.PI * 2;
      this.beatAmp[i] = 1;
      this.yRel[i] = -DOLPHIN_POD.travelDepth * (0.6 + 0.4 * rng());
      this.act[i] = ACT.dive;
      // The first breaths come soon after the pod appears.
      this.diveLeft[i] = 0.3 + 2.5 * rng();
    }
    this.pulseIn = range(rng, DOLPHIN_POD.pulse);
  }

  /** The pod stops surfacing and leaves under water (a storm is coming, the category was switched off). */
  leaveNow(): void {
    this.life = Math.min(this.life, this.age);
  }

  /** Something big hit the water at (x, z): the pod scatters if it is close enough. */
  startle(x: number, z: number, strength: number): boolean {
    if (strength < DOLPHIN_SCATTER.splashStrength || this.mode === 'leave') return false;
    if (this.nearestDistance(x, z) > DOLPHIN_SCATTER.splashRange) return false;
    this.scatterFrom(x, z);
    return true;
  }

  /** Horizontal distance from (x, z) to the closest dolphin (m). */
  nearestDistance(x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i < this.count; i++) {
      const d = Math.hypot(this.px[i] - x, this.pz[i] - z);
      if (d < best) best = d;
    }
    return best;
  }

  private scatterFrom(x: number, z: number): void {
    const rng = this.rng;
    if (this.mode !== 'scatter') this.stats.scattered++;
    this.mode = 'scatter';
    this.modeT = range(rng, DOLPHIN_SCATTER.time);
    this.excited = 30;
    this.restT = DOLPHIN_ACCOMPANY.rest;
    for (let i = 0; i < this.count; i++) {
      let ax = this.px[i] - x;
      let az = this.pz[i] - z;
      const l = Math.hypot(ax, az);
      if (l < 1e-3) {
        const a = rng() * Math.PI * 2;
        ax = Math.sin(a);
        az = Math.cos(a);
      } else {
        ax /= l;
        az /= l;
      }
      // Fan out a little around "away".
      const spread = (rng() - 0.5) * 0.9;
      const c = Math.cos(spread);
      const s = Math.sin(spread);
      const v = DOLPHIN_SCATTER.speed * (0.8 + 0.4 * rng());
      this.svx[i] = (ax * c - az * s) * v;
      this.svz[i] = (ax * s + az * c) * v;
      // Acts in progress end under water at once (a leap already in the air finishes).
      if (this.act[i] !== ACT.leap) {
        this.act[i] = ACT.dive;
      }
      this.diveLeft[i] = this.modeT + range(rng, [1, 3]);
    }
  }

  update(dt: number, env: DolphinEnv, dragon: DolphinDragon | null): void {
    this.eventCount = 0;
    if (!(dt > 0) || this.done) return;
    dt = Math.min(dt, 0.1);
    this.age += dt;
    this.excited = Math.max(0, this.excited - dt);
    this.restT = Math.max(0, this.restT - dt);
    this.regroup = Math.max(0, this.regroup - dt);
    this.updateMode(dt, env, dragon);
    this.steer(dt, env, dragon);
    this.cx += this.hx * this.speed * dt;
    this.cz += this.hz * this.speed * dt;
    this.pulse(dt);
    this.individuals(dt, env);
  }

  private updateMode(dt: number, env: DolphinEnv, dragon: DolphinDragon | null): void {
    const A = DOLPHIN_ACCOMPANY;
    if (this.mode !== 'leave' && this.age > this.life) {
      this.mode = 'leave';
      this.modeT = 0;
    }
    if (this.mode === 'leave') {
      this.modeT += dt;
      let under = true;
      for (let i = 0; i < this.count; i++) {
        if (this.act[i] !== ACT.dive || this.yRel[i] > -3) under = false;
      }
      if (under && this.modeT > 4) this.done = true;
      return;
    }
    if (dragon && dragon.underwater && this.nearestDistance(dragon.x, dragon.z) < DOLPHIN_SCATTER.range && this.mode !== 'scatter') {
      this.scatterFrom(dragon.x, dragon.z);
      return;
    }
    if (this.mode === 'scatter') {
      this.modeT -= dt;
      if (this.modeT <= 0) {
        this.mode = 'travel';
        this.regroup = DOLPHIN_SCATTER.regroup;
      }
      return;
    }
    const dx = dragon ? dragon.x - this.cx : 0;
    const dz = dragon ? dragon.z - this.cz : 0;
    const dist = Math.hypot(dx, dz);
    const dSpeed = dragon ? Math.hypot(dragon.vx, dragon.vz) : 0;
    if (this.mode === 'travel') {
      if (dragon && dragon.low && this.restT <= 0 && dSpeed <= A.maxDragonSpeed && this.nearestDistance(dragon.x, dragon.z) < A.range) {
        this.mode = 'accompany';
        this.modeT = range(this.rng, A.maxTime);
        this.lowGrace = 3;
        this.stats.accompanied++;
        // Stay on the side of the dragon's track the pod is on already.
        const fx = dSpeed > 0.5 ? dragon.vx / dSpeed : this.hx;
        const fz = dSpeed > 0.5 ? dragon.vz / dSpeed : this.hz;
        this.side = -dx * -fz + -dz * fx >= 0 ? 1 : -1;
      }
      return;
    }
    // Accompanying.
    this.modeT -= dt;
    this.lowGrace = dragon && dragon.low ? 3 : this.lowGrace - dt;
    const shoreAhead = env.coast(this.cx + this.hx * this.speed * 3, this.cz + this.hz * this.speed * 3);
    if (!dragon || this.modeT <= 0 || dist > A.lose || this.lowGrace <= 0 || shoreAhead > -DOLPHIN_POD.keepShore * 0.4) {
      this.mode = 'travel';
      this.restT = A.rest;
      this.regroup = 4;
    }
  }

  private steer(dt: number, env: DolphinEnv, dragon: DolphinDragon | null): void {
    const P = DOLPHIN_POD;
    let wantX = this.hx;
    let wantZ = this.hz;
    let wantSpeed = this.cruise;
    if (this.mode === 'accompany' && dragon) {
      const A = DOLPHIN_ACCOMPANY;
      const s = Math.hypot(dragon.vx, dragon.vz);
      const fx = s > 0.5 ? dragon.vx / s : this.hx;
      const fz = s > 0.5 ? dragon.vz / s : this.hz;
      // Beside the dragon, a little ahead: right = (-fz, fx).
      const tx = dragon.x + fx * A.lead - fz * A.side * this.side;
      const tz = dragon.z + fz * A.lead + fx * A.side * this.side;
      // Wanted velocity: the dragon's plus a pull toward the spot beside it (capped at the riding top speed); the
      // pod's velocity follows with a limited acceleration, so it neither overshoots nor turns on the spot.
      let vx = dragon.vx + (tx - this.cx) * 0.6;
      let vz = dragon.vz + (tz - this.cz) * 0.6;
      const v = Math.hypot(vx, vz);
      if (v > A.maxSpeed) {
        vx *= A.maxSpeed / v;
        vz *= A.maxSpeed / v;
      }
      const cvx = this.hx * this.speed;
      const cvz = this.hz * this.speed;
      let ax = vx - cvx;
      let az = vz - cvz;
      const al = Math.hypot(ax, az);
      const maxDv = A.accel * dt;
      if (al > maxDv) {
        ax *= maxDv / al;
        az *= maxDv / al;
      }
      const nvx = cvx + ax;
      const nvz = cvz + az;
      const ns = Math.hypot(nvx, nvz);
      if (ns > 0.3) {
        this.hx = nvx / ns;
        this.hz = nvz / ns;
      }
      this.speed = Math.max(this.cruise * 0.5, ns);
      return;
    } else {
      this.courseIn -= dt;
      if (this.courseIn <= 0) {
        this.courseIn = COURSE_EVERY;
        env.course(this.cx, this.cz, this.courseDir);
      }
      const c = this.courseDir;
      const sign = c.x * this.hx + c.z * this.hz >= 0 ? 1 : -1;
      wantX = c.x * sign;
      wantZ = c.z * sign;
      if (this.mode === 'scatter') wantSpeed = this.cruise * 1.4;
      else if (this.excited > 0) wantSpeed = this.cruise * 1.25;
    }
    // Keep clear of the shore: steer down the coast-distance gradient when the look-ahead point gets close.
    const la = P.lookAhead;
    const ax = this.cx + wantX * la;
    const az = this.cz + wantZ * la;
    const near = env.coast(ax, az);
    const here = env.coast(this.cx, this.cz);
    if (near > -P.keepShore || here > -P.keepShore) {
      const h = 25;
      const gx = env.coast(ax + h, az) - env.coast(ax - h, az);
      const gz = env.coast(ax, az + h) - env.coast(ax, az - h);
      const gl = Math.hypot(gx, gz);
      if (gl > 1e-6) {
        const w = Math.min(3, (Math.max(near, here) + P.keepShore) / 40 + 0.5);
        wantX -= (gx / gl) * w;
        wantZ -= (gz / gl) * w;
        const l = Math.hypot(wantX, wantZ) || 1;
        wantX /= l;
        wantZ /= l;
      }
    }
    // Turn toward the wanted heading at a limited rate (faster while accompanying or near the shore).
    const cur = Math.atan2(this.hx, this.hz);
    const want = Math.atan2(wantX, wantZ);
    let d = want - cur;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    const rate = (this.mode === 'accompany' ? 1.4 : near > -P.keepShore ? 0.9 : P.turnRate) * dt;
    const a = cur + Math.max(-rate, Math.min(rate, d));
    this.hx = Math.sin(a);
    this.hz = Math.cos(a);
    this.speed += (wantSpeed - this.speed) * Math.min(1, dt * (this.mode === 'accompany' ? 1.5 : 0.8));
  }

  private pulse(dt: number): void {
    if (this.mode === 'scatter' || this.mode === 'leave') return;
    this.pulseIn -= dt;
    if (this.pulseIn > 0) return;
    const rng = this.rng;
    this.pulseIn = range(rng, DOLPHIN_POD.pulse) * (this.mode === 'accompany' ? 0.55 : 1);
    const share = range(rng, DOLPHIN_POD.pulseShare);
    for (let i = 0; i < this.count; i++) {
      if (this.act[i] === ACT.dive && rng() < share) {
        this.diveLeft[i] = Math.min(this.diveLeft[i], 0.15 + rng() * 1.1);
      }
    }
  }

  private startAct(i: number): void {
    const rng = this.rng;
    const C = DOLPHIN_ACTS;
    const leapChance = this.mode === 'accompany' ? C.leapChanceAccompany : this.excited > 0 ? C.leapChanceExcited : C.leapChance;
    this.actT[i] = 0;
    this.actBase[i] = Math.min(this.yRel[i], -0.6);
    this.actSide[i] = rng() < 0.5 ? -1 : 1;
    this.stats.acts++;
    if (rng() < leapChance) {
      const vy = range(rng, C.leap.vy);
      this.act[i] = ACT.leap;
      this.actPeak[i] = vy;
      this.actDur[i] = C.leap.lead + (2 * vy) / G + C.leap.tail;
      this.stats.leaps++;
      return;
    }
    const fast = this.speed > C.porpoiseSpeed;
    const porpoise = rng() < (fast ? 0.85 : 0.4);
    if (porpoise) {
      this.act[i] = ACT.porpoise;
      this.actDur[i] = range(rng, C.porpoise.time);
      this.actPeak[i] = range(rng, C.porpoise.peak);
      this.stats.porpoises++;
    } else {
      this.act[i] = ACT.roll;
      this.actDur[i] = range(rng, C.roll.time);
      this.actPeak[i] = range(rng, C.roll.peak);
      this.stats.rolls++;
    }
  }

  /** Height (relative to the surface) and its rate for dolphin i in its current act at time t. */
  private actHeight(i: number, t: number, out: { x: number; z: number }): void {
    const base = this.actBase[i];
    const peak = this.actPeak[i];
    const dur = this.actDur[i];
    switch (this.act[i]) {
      case ACT.leap: {
        const L = DOLPHIN_ACTS.leap;
        const vy = peak;
        const air = (2 * vy) / G;
        if (t < L.lead) {
          // Rising from depth to the surface (cubic Hermite: at rest vertically below, the take-off speed at the top).
          const u = t / L.lead;
          const m1 = vy * L.lead;
          out.x = base * (2 * u * u * u - 3 * u * u + 1) + m1 * (u * u * u - u * u);
          out.z = (base * (6 * u * u - 6 * u) + m1 * (3 * u * u - 2 * u)) / L.lead;
        } else if (t < L.lead + air) {
          const tau = t - L.lead;
          out.x = vy * tau - 0.5 * G * tau * tau;
          out.z = vy - G * tau;
        } else {
          // Into the water, braking.
          const tau = Math.min(t - L.lead - air, L.tail);
          const decel = vy / L.tail;
          out.x = -vy * tau + 0.5 * decel * tau * tau;
          out.z = -vy + decel * tau;
        }
        return;
      }
      default: {
        const u = Math.min(1, t / dur);
        out.x = base + (peak - base) * Math.sin(Math.PI * u);
        out.z = ((peak - base) * Math.PI * Math.cos(Math.PI * u)) / dur;
      }
    }
  }

  private emit(kind: EventId, i: number, strength: number, y: number): void {
    if (this.eventCount >= MAX_EVENTS) return;
    const k = this.eventCount++;
    this.eventKind[k] = kind;
    this.eventX[k] = this.px[i];
    this.eventY[k] = y;
    this.eventZ[k] = this.pz[i];
    this.eventStrength[k] = strength;
  }

  private individuals(dt: number, env: DolphinEnv): void {
    const P = DOLPHIN_POD;
    const rng = this.rng;
    const hx = this.hx;
    const hz = this.hz;
    const tight = this.mode === 'accompany' ? 0.7 : 1;
    const relax = Math.min(1, dt * (this.regroup > 0 ? P.relax * 3 : P.relax));
    const hv = this.scratch;
    for (let i = 0; i < this.count; i++) {
      // Formation offset with a slow wander.
      const wp = this.wanderPhase[i] + this.age * 0.21;
      const wx = Math.sin(wp) * P.wander;
      const wz = Math.sin(wp * 0.73 + 1.3) * P.wander;
      this.ox[i] += (this.tox[i] * tight + wx - this.ox[i]) * relax;
      this.oz[i] += (this.toz[i] * tight + wz - this.oz[i]) * relax;
      // Scatter: fly apart, then drift back into formation.
      if (this.mode === 'scatter') {
        this.scx[i] += this.svx[i] * dt;
        this.scz[i] += this.svz[i] * dt;
        this.svx[i] *= 1 - Math.min(1, dt * 0.25);
        this.svz[i] *= 1 - Math.min(1, dt * 0.25);
      } else if (this.scx[i] !== 0 || this.scz[i] !== 0) {
        const k = 1 - Math.min(1, dt * (3 / DOLPHIN_SCATTER.regroup));
        this.scx[i] *= k;
        this.scz[i] *= k;
        if (Math.abs(this.scx[i]) + Math.abs(this.scz[i]) < 0.05) {
          this.scx[i] = 0;
          this.scz[i] = 0;
        }
      }
      const x = this.cx - hz * this.ox[i] + hx * this.oz[i] + this.scx[i];
      const z = this.cz + hx * this.ox[i] + hz * this.oz[i] + this.scz[i];
      if (this.age > dt * 1.5) {
        this.prevX[i] = this.px[i];
        this.prevZ[i] = this.pz[i];
      } else {
        this.prevX[i] = x - hx * this.speed * dt;
        this.prevZ[i] = z - hz * this.speed * dt;
      }
      this.px[i] = x;
      this.pz[i] = z;

      // Vertical: travel depth between breaths, the act profile while surfacing.
      const y0 = this.yRel[i];
      let vy = 0;
      let airborne = false;
      if (this.act[i] === ACT.dive) {
        this.diveLeft[i] -= dt;
        const leaving = this.mode === 'leave';
        let target = this.mode === 'scatter' ? -P.scatterDepth : leaving ? -6 : -P.travelDepth;
        // Rising toward the surface in the last second before a breath.
        if (!leaving && this.mode !== 'scatter' && this.diveLeft[i] < 1) target = -0.9;
        const y = y0 + (target - y0) * Math.min(1, dt * 1.6);
        vy = (y - y0) / dt;
        this.yRel[i] = y;
        if (this.diveLeft[i] <= 0 && !leaving && this.mode !== 'scatter') {
          this.startAct(i);
        }
      } else {
        this.actT[i] += dt;
        const t = this.actT[i];
        if (t >= this.actDur[i]) {
          const wasLeap = this.act[i] === ACT.leap;
          this.act[i] = ACT.dive;
          this.diveLeft[i] = range(rng, P.pulse) * (1.2 + 0.6 * rng());
          this.yRel[i] = Math.min(this.yRel[i], wasLeap ? -0.9 : this.actBase[i]);
        } else {
          this.actHeight(i, t, hv);
          this.yRel[i] = hv.x;
          vy = hv.z;
          airborne = this.act[i] === ACT.leap && hv.x > 0.3;
        }
      }
      const y1 = this.yRel[i];
      // Events: the blowhole breaks the surface (a breath; a leap's exit), a leap or an arc goes back in (a splash).
      const top = 0.25 * this.size[i];
      if (y0 + top < 0 && y1 + top >= 0 && this.act[i] !== ACT.dive) {
        const surf = env.surface(x, z);
        if (this.act[i] === ACT.leap) this.emit(EVENT.leap, i, Math.min(1.5, this.actPeak[i] / 6), surf);
        else this.emit(EVENT.breath, i, 1, surf);
      }
      if (y0 >= 0 && y1 < 0 && (this.act[i] === ACT.leap || this.act[i] === ACT.porpoise || y0 > 0.4)) {
        const surf = env.surface(x, z);
        const big = this.act[i] === ACT.leap || y0 > 0.4;
        this.emit(EVENT.splash, i, big ? Math.min(1.4, 0.45 + this.actPeak[i] * 0.12) * (this.size[i] / 2.2) : 0.22, surf);
      }

      // Orientation: along the horizontal motion, pitched by the vertical rate, a little roll in rolls and turns.
      const mvx = (x - this.prevX[i]) / dt;
      const mvz = (z - this.prevZ[i]) / dt;
      const hs = Math.hypot(mvx, mvz);
      if (hs > 0.4) {
        const yaw = Math.atan2(-mvx, -mvz);
        let d = yaw - this.yaw[i];
        d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
        this.yaw[i] += d * Math.min(1, dt * 4);
      }
      const fwd = Math.max(1.5, hs);
      const pitch = Math.max(-1.25, Math.min(1.25, Math.atan2(vy, fwd)));
      this.pitch[i] += (pitch - this.pitch[i]) * Math.min(1, dt * (airborne ? 12 : 5));
      let roll = 0;
      if (this.act[i] === ACT.roll) {
        roll = 0.45 * this.actSide[i] * Math.sin((Math.PI * this.actT[i]) / this.actDur[i]);
      } else if (this.act[i] === ACT.leap && airborne && this.actSide[i] > 0 && this.actPeak[i] > 6.6) {
        // A high leap sometimes twists half a turn onto its side.
        roll = 1.2 * Math.sin((Math.PI * (this.actT[i] - DOLPHIN_ACTS.leap.lead)) / ((2 * this.actPeak[i]) / G));
      }
      this.roll[i] += (roll - this.roll[i]) * Math.min(1, dt * 6);
      // Tail beat: ~1–3 Hz with speed, almost still in the air.
      const freq = 0.9 + 0.28 * Math.max(hs, Math.abs(vy));
      this.beat[i] += dt * Math.PI * 2 * freq;
      if (this.beat[i] > 1e4) this.beat[i] -= Math.PI * 2 * 1000;
      const amp = airborne ? 0.12 : this.act[i] === ACT.roll ? 0.55 : 1;
      this.beatAmp[i] += (amp - this.beatAmp[i]) * Math.min(1, dt * 6);

      this.py[i] = env.surface(x, z) + y1;
      const shore = env.coast(x, z);
      if (shore > this.stats.maxShore) this.stats.maxShore = shore;
    }
  }
}
