import * as THREE from 'three';
import type { GeoQuery } from '../../../core/contracts';
import { Path2, type P2 } from '../util/path';
import { clearance, segmentClear } from '../util/water-nav';
import type { VesselModel } from './model-types';

export type VesselMode = 'underway' | 'anchored' | 'moored';

/** Kinematic state shared by all behaviours. Heading is a yaw angle (object -Z forward). */
export interface VesselState {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  /** Signed yaw rate (rad/s) for heel in turns. */
  yawRate: number;
  mode: VesselMode;
}

export interface Behaviour {
  update(dt: number, s: VesselState): void;
}

function yawFromDir(tx: number, tz: number): number {
  return Math.atan2(-tx, -tz);
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Scheduled ferry on a closed loop with stops (dwell + braking/acceleration profile). */
export class LoopRoute implements Behaviour {
  private s: number;
  private v = 0;
  private dwell = 0;
  private stopIndex = 0;
  private hint = 0;
  private readonly tmp = new Float64Array(4);
  private readonly ahead = new Float64Array(4);

  constructor(
    readonly path: Path2,
    /** Arc-length positions of the stops (ascending). */
    readonly stops: number[],
    readonly vmax: number,
    readonly accel: number,
    readonly dwellTime: number,
    startS: number,
  ) {
    this.s = path.wrap(startS);
    this.stopIndex = this.nextStopIndex(this.s);
    this.v = vmax;
    if (stops.length > 0) {
      const d = this.distToStop();
      if (d < 5) {
        this.dwell = dwellTime * 0.6;
        this.v = 0;
      } else {
        this.v = Math.min(vmax, Math.sqrt(2 * accel * Math.max(d - 1, 0)));
      }
    }
  }

  private nextStopIndex(s: number): number {
    for (let i = 0; i < this.stops.length; i++) if (this.stops[i] >= s - 0.01) return i;
    return 0;
  }

  private distToStop(): number {
    const L = this.path.length;
    const target = this.stops[this.stopIndex];
    return (((target - this.s) % L) + L) % L;
  }

  update(dt: number, st: VesselState): void {
    if (this.stops.length > 0) {
      if (this.dwell > 0) {
        this.dwell -= dt;
        this.v = 0;
        if (this.dwell <= 0) {
          this.stopIndex = (this.stopIndex + 1) % this.stops.length;
          this.s = this.path.wrap(this.s + 0.6);
        }
      } else {
        const d = this.distToStop();
        const target = Math.min(this.vmax, Math.sqrt(2 * this.accel * 0.7 * Math.max(d - 0.3, 0)));
        const dv = THREE.MathUtils.clamp(target - this.v, -this.accel * 1.5 * dt, this.accel * dt);
        this.v = Math.max(0, this.v + dv);
        const step = Math.min(this.v * dt, d);
        this.s = this.path.wrap(this.s + step);
        if (d - step < 0.35 && this.v < 0.8) {
          this.dwell = this.dwellTime;
          this.v = 0;
        }
      }
    } else {
      this.v += THREE.MathUtils.clamp(this.vmax - this.v, -this.accel * dt, this.accel * dt);
      this.s = this.path.wrap(this.s + this.v * dt);
    }
    this.hint = this.path.sample(this.s, this.tmp, this.hint);
    // Heading looks slightly ahead so polyline vertices do not snap the bow.
    this.path.sample(this.s + 6 + this.v * 1.5, this.ahead, this.hint);
    const dx = this.ahead[0] - this.tmp[0];
    const dz = this.ahead[1] - this.tmp[1];
    const yaw = Math.hypot(dx, dz) > 0.1 ? yawFromDir(dx, dz) : yawFromDir(this.tmp[2], this.tmp[3]);
    applyKinematics(st, this.tmp[0], this.tmp[1], yaw, this.v, dt);
    st.mode = this.v < 0.05 && this.dwell > 0 ? 'moored' : 'underway';
  }

  get progress(): number {
    return this.s;
  }
}

function applyKinematics(st: VesselState, x: number, z: number, yaw: number, v: number, dt: number): void {
  const prevYaw = st.yaw;
  const maxTurn = 0.35 * Math.max(dt, 1e-4);
  const dy = wrapAngle(yaw - prevYaw);
  st.yaw = wrapAngle(prevYaw + THREE.MathUtils.clamp(dy, -maxTurn, maxTurn));
  st.yawRate = dt > 0 ? THREE.MathUtils.lerp(st.yawRate, wrapAngle(st.yaw - prevYaw) / dt, Math.min(1, dt * 2)) : st.yawRate;
  st.x = x;
  st.z = z;
  st.speed = v;
}

/** Through-traffic in a separation lane: constant cruise with gap keeping; respawns at the lane start. */
export class LaneTransit implements Behaviour {
  s: number;
  v: number;
  private hint = 0;
  private readonly tmp = new Float64Array(4);
  private readonly ahead = new Float64Array(4);
  /** Set by the traffic manager: distance to the ship ahead in the same lane and its speed. */
  gapAhead = Infinity;
  speedAhead = 0;

  constructor(
    readonly path: Path2,
    readonly cruise: number,
    startS: number,
  ) {
    this.s = startS;
    this.v = cruise;
  }

  update(dt: number, st: VesselState): void {
    let target = this.cruise;
    if (this.gapAhead < 1400) {
      target = Math.min(target, this.speedAhead * THREE.MathUtils.smoothstep(this.gapAhead, 500, 1400) + 0.3);
    }
    this.v += THREE.MathUtils.clamp(target - this.v, -0.05 * dt, 0.04 * dt);
    this.s += this.v * dt;
    if (this.s > this.path.length) this.s -= this.path.length;
    this.hint = this.path.sample(this.s, this.tmp, this.hint);
    this.path.sample(this.s + 60, this.ahead, this.hint);
    const yaw = yawFromDir(this.ahead[0] - this.tmp[0], this.ahead[1] - this.tmp[1]);
    applyKinematics(st, this.tmp[0], this.tmp[1], yaw, this.v, dt);
    st.mode = 'underway';
  }
}

/** Swinging at anchor: slow yaw oscillation around the stream direction. */
export class AtAnchor implements Behaviour {
  private t = Math.random() * 1000;
  constructor(
    readonly x: number,
    readonly z: number,
    readonly baseYaw: number,
    readonly swing: number,
  ) {}

  update(dt: number, st: VesselState): void {
    this.t += dt;
    const yaw = this.baseYaw + this.swing * Math.sin(this.t * 0.011) + 0.04 * Math.sin(this.t * 0.037);
    st.x = this.x;
    st.z = this.z;
    st.yaw = yaw;
    st.speed = 0;
    st.yawRate = 0;
    st.mode = 'anchored';
  }
}

export interface Zone {
  x: number;
  z: number;
  radius: number;
}

/** Small craft cruising between random open-water waypoints in a zone, optionally stopping to fish/drift. */
export class Wander implements Behaviour {
  private tx: number;
  private tz: number;
  private v = 0;
  private pause = 0;
  private yawTarget = 0;

  constructor(
    private readonly geo: GeoQuery,
    private readonly zone: Zone,
    private readonly cruise: number,
    private readonly minClear: number,
    private readonly pauseChance: number,
    private readonly rng: () => number,
    st: VesselState,
  ) {
    this.tx = st.x;
    this.tz = st.z;
    this.pickTarget(st);
    this.v = cruise * (0.6 + 0.4 * rng());
    this.yawTarget = st.yaw;
  }

  static randomPoint(geo: GeoQuery, zone: Zone, minClear: number, rng: () => number): P2 | null {
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * zone.radius;
      const x = zone.x + Math.cos(a) * r;
      const z = zone.z + Math.sin(a) * r;
      if (clearance(geo, x, z) >= minClear) return { x, z };
    }
    return null;
  }

  private pickTarget(st: VesselState): void {
    for (let i = 0; i < 16; i++) {
      const p = Wander.randomPoint(this.geo, this.zone, this.minClear, this.rng);
      if (!p) break;
      const d = Math.hypot(p.x - st.x, p.z - st.z);
      if (d < 250) continue;
      if (segmentClear(this.geo, { x: st.x, z: st.z }, p, this.minClear * 0.6, 30)) {
        this.tx = p.x;
        this.tz = p.z;
        return;
      }
    }
    // Fall back to heading towards the zone centre (always open water by construction).
    this.tx = this.zone.x;
    this.tz = this.zone.z;
  }

  update(dt: number, st: VesselState): void {
    const dx = this.tx - st.x;
    const dz = this.tz - st.z;
    const d = Math.hypot(dx, dz);
    if (this.pause > 0) {
      this.pause -= dt;
      this.v = Math.max(0, this.v - 0.4 * dt);
      if (this.pause <= 0) this.pickTarget(st);
    } else if (d < 40) {
      if (this.rng() < this.pauseChance) this.pause = 60 + this.rng() * 240;
      else this.pickTarget(st);
    } else {
      this.yawTarget = yawFromDir(dx / d, dz / d);
      const target = this.cruise * THREE.MathUtils.smoothstep(d, 20, 150);
      this.v += THREE.MathUtils.clamp(target - this.v, -0.5 * dt, 0.35 * dt);
    }
    const prevYaw = st.yaw;
    const turn = (0.12 + 0.1 * Math.min(this.v, 4) / 4) * dt;
    st.yaw = wrapAngle(prevYaw + THREE.MathUtils.clamp(wrapAngle(this.yawTarget - prevYaw), -turn, turn));
    st.yawRate = dt > 0 ? THREE.MathUtils.lerp(st.yawRate, wrapAngle(st.yaw - prevYaw) / dt, Math.min(1, dt * 2)) : 0;
    const fx = -Math.sin(st.yaw);
    const fz = -Math.cos(st.yaw);
    const nx = st.x + fx * this.v * dt;
    const nz = st.z + fz * this.v * dt;
    // Never motor onto land: stop and re-plan if the next step loses clearance.
    if (clearance(this.geo, nx + fx * 20, nz + fz * 20) < this.minClear * 0.3) {
      this.v *= 0.9;
      if (this.pause <= 0) this.pickTarget(st);
    } else {
      st.x = nx;
      st.z = nz;
    }
    st.speed = this.v;
    st.mode = this.v < 0.1 && this.pause > 0 ? 'anchored' : 'underway';
  }
}

/** A vessel in the simulation: model + behaviour + motion state + render handles. */
export class Vessel {
  readonly state: VesselState = { x: 0, z: 0, yaw: 0, speed: 0, yawRate: 0, mode: 'underway' };
  /** Vertical offset of the design waterline (ballast ships ride high). */
  lift = 0;
  readonly phase: number;
  readonly matrix = new THREE.Matrix4();
  /** Index into the wake trail pool (-1 = none). */
  wake = -1;
  /** Base index into the nav-light pool. */
  lightBase = -1;
  handle: unknown = null;
  roll = 0;
  pitch = 0;
  heave = 0;

  constructor(
    readonly id: number,
    readonly model: VesselModel,
    public behaviour: Behaviour,
    readonly paint: THREE.Color,
    readonly seed: number,
  ) {
    this.phase = (id * 2.399) % (Math.PI * 2);
  }
}
