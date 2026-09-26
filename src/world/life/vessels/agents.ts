import * as THREE from 'three';
import type { GeoQuery } from '../../../core/contracts';
import type { Path2, P2 } from '../util/path';
import { clearance, segmentClear } from '../util/water-nav';
import { Track, type TrackSample } from './nav/track';
import type { KeepOut } from './nav/keep-out';
import type { VesselModel } from './model-types';
import type { RigidHull } from './physics/rigid-hull';

export type VesselMode = 'underway' | 'anchored' | 'moored';

/** Kinematic state shared by all behaviours. Heading is a yaw angle (object -Z forward). */
export interface VesselState {
  x: number;
  z: number;
  yaw: number;
  /** Speed through the water (m/s, >= 0); `astern` tells the direction. */
  speed: number;
  /** Signed yaw rate (rad/s) for heel in turns. */
  yawRate: number;
  mode: VesselMode;
  /** Going astern (backing out of a berth). */
  astern: boolean;
  /** Speed cap from the traffic rules (m/s, Infinity = free). */
  cap: number;
  /** Set by the traffic rules when a stopped small craft blocks a larger vessel's track: move on. */
  shoo: boolean;
  /** Set by the traffic rules when a free-roaming craft is in a stand-on vessel's track: steer this way (unit xz). */
  escapeX: number;
  escapeZ: number;
  /** Head-on encounter: wanted offset to starboard of the track (m) and how long to keep it (s). */
  sidestep: number;
  sidestepHold: number;
  /** Set by the traffic rules when this vessel is the one to back off out of a mutual stand-off. */
  backOff: boolean;
  /** Backing off along its track (Reverser), and whether the water astern is still clear (traffic rules). */
  reversing: boolean;
  backBlocked: boolean;
}

export interface Behaviour {
  update(dt: number, s: VesselState): void;
  /**
   * Where the vessel will be after `dist` more metres along its intended path (position + unit direction of travel).
   * Behaviours without a path predict a straight line.
   */
  ahead?(dist: number, s: VesselState, out: TrackSample): void;
}

/** Straight-line prediction along the current heading (astern when backing). */
export function aheadStraight(dist: number, s: VesselState, out: TrackSample): void {
  const k = s.astern ? -1 : 1;
  const fx = -Math.sin(s.yaw) * k;
  const fz = -Math.cos(s.yaw) * k;
  out.x = s.x + fx * dist;
  out.z = s.z + fz * dist;
  out.tx = fx;
  out.tz = fz;
}

export function yawFromDir(tx: number, tz: number): number {
  return Math.atan2(-tx, -tz);
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Writes a pose into the state and derives a smoothed yaw rate. */
export function setPose(st: VesselState, x: number, z: number, yaw: number, dt: number): void {
  const prev = st.yaw;
  st.yaw = wrapAngle(yaw);
  if (dt > 0) st.yawRate = THREE.MathUtils.lerp(st.yawRate, wrapAngle(st.yaw - prev) / dt, Math.min(1, dt * 2));
  st.x = x;
  st.z = z;
}

/** Speed after one step towards `target`, limited by acceleration and braking. */
export function approachSpeed(v: number, target: number, accel: number, brake: number, dt: number): number {
  return target < v ? Math.max(target, v - brake * dt) : Math.min(target, v + accel * dt);
}

/**
 * Lateral offset from a track (m, + = starboard) for head-on encounters (COLREG Rule 14: both vessels alter to
 * starboard). The traffic rules set the wanted offset in the state. The offset changes with distance travelled, not
 * time (its slope along the track is the heading change, capped at ~7 degrees and eased in and out), so the hull never
 * slides sideways and a stopped vessel keeps its line. It is dropped where it would take the hull close to the shore.
 */
export class Sidestep {
  lat = 0;
  /** dLat/ds (m per m travelled). */
  private slope = 0;

  constructor(
    private readonly geo: GeoQuery,
    private readonly halfBeam: number,
  ) {}

  /**
   * Shifts a track sample by the offset (in place) and returns the heading correction (rad). `ahead` is a sample further
   * along the track: the offset is only taken where the shifted hull keeps clear of the shore here and there.
   */
  apply(dt: number, st: VesselState, smp: TrackSample, allowed: boolean, ahead: TrackSample | null = null): number {
    let want = 0;
    if (st.sidestepHold > 0) {
      st.sidestepHold -= dt;
      if (allowed) want = st.sidestep;
    } else {
      st.sidestep = 0;
    }
    const room = this.halfBeam + 30;
    const clear = (q: TrackSample, off: number): boolean => clearance(this.geo, q.x - q.tz * off, q.z + q.tx * off) >= room;
    if (want !== 0 && (!clear(smp, want) || (ahead && !clear(ahead, want)))) want = 0;
    if (want === 0 && this.lat === 0 && this.slope === 0) return 0;
    const ds = Math.max(st.speed, 0) * dt;
    // Closing the shore while shifted: come back on a steeper line.
    const urgent = this.lat !== 0 && clearance(this.geo, smp.x - smp.tz * this.lat, smp.z + smp.tx * this.lat) < this.halfBeam + 15;
    const maxSlope = urgent ? 0.2 : 0.12;
    const desired = THREE.MathUtils.clamp((want - this.lat) * 0.025, -maxSlope, maxSlope);
    const bend = (urgent ? 0.01 : 0.004) * ds;
    this.slope += THREE.MathUtils.clamp(desired - this.slope, -bend, bend);
    this.lat += this.slope * ds;
    if (want === 0 && Math.abs(this.lat) < 0.05 && Math.abs(this.slope) < 0.004) {
      this.lat = 0;
      this.slope = 0;
    }
    this.offset(smp);
    return -Math.atan(this.slope);
  }

  /** Heading correction of the current offset line (rad), for poses set without advancing it. */
  heading(): number {
    return -Math.atan(this.slope);
  }

  /** Shifts a predicted sample by the current offset. */
  offset(out: TrackSample): void {
    out.x -= out.tz * this.lat;
    out.z += out.tx * this.lat;
  }
}

/**
 * Breaks stand-offs on fixed tracks: after being held at a standstill for a while, a vessel the traffic rules picked
 * to give way backs off astern along its own track (where it came from) for about a hull length, then tries again.
 */
export class Reverser {
  private held = 0;
  private backed = -1;

  /** Returns the distance to move along the track this step (negative while backing), or null for normal driving. */
  step(dt: number, st: VesselState, length: number): number | null {
    if (this.backed >= 0) {
      const v = Math.min(0.8, 0.25 + this.backed * 0.02);
      this.backed += v * dt;
      if (this.backed >= length || st.backBlocked) {
        this.backed = -1;
        this.held = 0;
        st.reversing = false;
        st.backBlocked = false;
        return null;
      }
      st.speed = v;
      st.astern = true;
      st.reversing = true;
      return -v * dt;
    }
    this.held = st.cap < 0.3 && st.speed < 0.2 ? this.held + dt : 0;
    if (this.held > 25 && st.backOff) {
      this.backed = 0;
      this.held = 0;
    }
    return null;
  }
}

/** Closed polyline converted to a track with a continuous tangent across the seam. */
export function loopTrack(path: Path2): Track {
  const pts = path.points();
  const n = pts.length;
  const seam = { x: pts[1].x - pts[n - 1].x, z: pts[1].z - pts[n - 1].z };
  return new Track([...pts, pts[0]], seam, seam);
}

/** Sightseeing boats and other scheduled craft on a closed loop without stops. */
export class LoopRoute implements Behaviour {
  private s: number;
  private v: number;
  private hint = 0;
  private readonly reverser = new Reverser();
  private readonly smp: TrackSample = { x: 0, z: 0, tx: 0, tz: -1 };
  private readonly look: TrackSample = { x: 0, z: 0, tx: 0, tz: -1 };
  readonly track: Track;

  constructor(
    path: Path2,
    readonly vmax: number,
    readonly accel: number,
    startS: number,
    private readonly side: Sidestep | null = null,
  ) {
    this.track = loopTrack(path);
    this.s = ((startS % this.track.length) + this.track.length) % this.track.length;
    this.v = vmax;
  }

  ahead(dist: number, _s: VesselState, out: TrackSample): void {
    const L = this.track.length;
    this.track.sample((((this.s + dist) % L) + L) % L, out, this.hint);
    this.side?.offset(out);
  }

  update(dt: number, st: VesselState): void {
    const back = this.reverser.step(dt, st, 30);
    if (back !== null) {
      this.v = 0;
      this.s = (this.s + back + this.track.length) % this.track.length;
      this.hint = this.track.sample(this.s, this.smp, this.hint);
      this.side?.offset(this.smp);
      setPose(st, this.smp.x, this.smp.z, yawFromDir(this.smp.tx, this.smp.tz) + (this.side?.heading() ?? 0), dt);
      st.mode = 'underway';
      return;
    }
    this.v = approachSpeed(this.v, Math.min(this.vmax, st.cap), this.accel, this.accel * 3, dt);
    this.s += this.v * dt;
    if (this.s >= this.track.length) this.s -= this.track.length;
    this.hint = this.track.sample(this.s, this.smp, this.hint);
    let dyaw = 0;
    if (this.side) {
      this.track.sample((this.s + 150) % this.track.length, this.look, this.hint);
      dyaw = this.side.apply(dt, st, this.smp, true, this.look);
    }
    setPose(st, this.smp.x, this.smp.z, yawFromDir(this.smp.tx, this.smp.tz) + dyaw, dt);
    st.speed = this.v;
    st.astern = false;
    st.mode = 'underway';
  }
}

/** Through-traffic in a separation lane: constant cruise, follows the lane track; respawns at the lane start. */
export class LaneTransit implements Behaviour {
  s: number;
  v: number;
  private hint = 0;
  private readonly smp: TrackSample = { x: 0, z: 0, tx: 0, tz: -1 };
  private readonly look: TrackSample = { x: 0, z: 0, tx: 0, tz: -1 };

  constructor(
    readonly track: Track,
    readonly cruise: number,
    startS: number,
    private readonly side: Sidestep | null = null,
  ) {
    this.s = startS;
    this.v = cruise;
  }

  ahead(dist: number, _s: VesselState, out: TrackSample): void {
    this.track.sample(Math.min(this.s + dist, this.track.length), out, this.hint);
    this.side?.offset(out);
  }

  update(dt: number, st: VesselState): void {
    const target = Math.min(this.cruise, st.cap);
    this.v = approachSpeed(this.v, target, 0.035, 0.08, dt);
    this.s += this.v * dt;
    if (this.s > this.track.length) this.s -= this.track.length;
    this.hint = this.track.sample(this.s, this.smp, this.hint);
    let dyaw = 0;
    if (this.side) {
      this.track.sample(Math.min(this.s + 300, this.track.length), this.look, this.hint);
      dyaw = this.side.apply(dt, st, this.smp, true, this.look);
    }
    setPose(st, this.smp.x, this.smp.z, yawFromDir(this.smp.tx, this.smp.tz) + dyaw, dt);
    st.speed = this.v;
    st.astern = false;
    st.mode = 'underway';
  }
}

/** Swinging at anchor: slow yaw oscillation around the stream direction. */
export class AtAnchor implements Behaviour {
  private t: number;
  constructor(
    readonly x: number,
    readonly z: number,
    readonly baseYaw: number,
    readonly swing: number,
    phase = 0,
  ) {
    this.t = phase * 1000;
  }

  update(dt: number, st: VesselState): void {
    this.t += dt;
    const yaw = this.baseYaw + this.swing * Math.sin(this.t * 0.011) + 0.04 * Math.sin(this.t * 0.037);
    st.x = this.x;
    st.z = this.z;
    st.yaw = yaw;
    st.speed = 0;
    st.yawRate = 0;
    st.astern = false;
    st.mode = 'anchored';
  }
}

/** Made fast alongside a quay or rafted to another boat: only surges a little on its lines. */
export class Moored implements Behaviour {
  private t: number;
  constructor(
    readonly x: number,
    readonly z: number,
    readonly yaw: number,
    phase = 0,
  ) {
    this.t = phase * 100;
  }

  update(dt: number, st: VesselState): void {
    this.t += dt;
    const surge = 0.12 * Math.sin(this.t * 0.21) + 0.05 * Math.sin(this.t * 0.53);
    st.x = this.x - Math.sin(this.yaw) * surge;
    st.z = this.z - Math.cos(this.yaw) * surge;
    st.yaw = this.yaw + 0.006 * Math.sin(this.t * 0.17);
    st.speed = 0;
    st.yawRate = 0;
    st.astern = false;
    st.mode = 'moored';
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
  private blocked = 0;
  /** Seconds left of an escape manoeuvre (turn on the spot before moving off). */
  private escaping = 0;
  private readonly turnRate: number;

  constructor(
    private readonly geo: GeoQuery,
    private readonly zone: Zone,
    private readonly cruise: number,
    private readonly minClear: number,
    private readonly pauseChance: number,
    private readonly rng: () => number,
    st: VesselState,
    turnRate = 0.2,
    private readonly keepOut: KeepOut | null = null,
  ) {
    this.tx = st.x;
    this.tz = st.z;
    this.turnRate = turnRate;
    this.pickTarget(st);
    this.v = cruise * (0.6 + 0.4 * rng());
    this.yawTarget = st.yaw;
  }

  /** Random open-water point in the zone, outside shipping lanes and ferry tracks when a keep-out map is given. */
  static randomPoint(geo: GeoQuery, zone: Zone, minClear: number, rng: () => number, keepOut: KeepOut | null = null): P2 | null {
    for (let i = 0; i < 60; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * zone.radius;
      const x = zone.x + Math.cos(a) * r;
      const z = zone.z + Math.sin(a) * r;
      if (clearance(geo, x, z) >= minClear && !(keepOut && i < 50 && keepOut.blocked(x, z))) return { x, z };
    }
    return null;
  }

  private pickTarget(st: VesselState): void {
    for (let i = 0; i < 16; i++) {
      const p = Wander.randomPoint(this.geo, this.zone, this.minClear, this.rng, this.keepOut);
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

  /** Turns off to the side given by the traffic rules (out of a larger vessel's track), if there is water there. */
  private escape(st: VesselState): void {
    const ex = st.escapeX;
    const ez = st.escapeZ;
    // Already heading away: keep the current target.
    const fx = this.tx - st.x;
    const fz = this.tz - st.z;
    const fl = Math.hypot(fx, fz);
    if (fl > 1 && (fx * ex + fz * ez) / fl > 0.5) return;
    for (const [dist, rot] of [
      [220, 0],
      [220, 0.5],
      [220, -0.5],
      [140, 0],
    ]) {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const px = st.x + (ex * c - ez * s) * dist;
      const pz = st.z + (ex * s + ez * c) * dist;
      if (clearance(this.geo, px, pz) >= this.minClear * 0.6) {
        this.tx = px;
        this.tz = pz;
        this.pause = 0;
        this.escaping = 25;
        return;
      }
    }
  }

  ahead(dist: number, st: VesselState, out: TrackSample): void {
    const dx = this.tx - st.x;
    const dz = this.tz - st.z;
    const d = Math.hypot(dx, dz);
    if (this.pause > 0 || d < 1) {
      aheadStraight(0, st, out);
      return;
    }
    const k = Math.min(dist, d) / d;
    out.x = st.x + dx * k;
    out.z = st.z + dz * k;
    out.tx = dx / d;
    out.tz = dz / d;
  }

  update(dt: number, st: VesselState): void {
    // Drifting in a larger vessel's way, or held up by traffic for long: go somewhere else.
    if (st.shoo) {
      st.shoo = false;
      if (this.pause > 0 || this.v < 0.3) {
        this.pause = 0;
        this.pickTarget(st);
      }
    }
    if (st.escapeX !== 0 || st.escapeZ !== 0) {
      this.escape(st);
      st.escapeX = 0;
      st.escapeZ = 0;
    }
    this.escaping = Math.max(0, this.escaping - dt);
    this.blocked = st.cap < 0.3 && this.pause <= 0 ? this.blocked + dt : 0;
    if (this.blocked > 30) {
      this.blocked = 0;
      this.pickTarget(st);
    }
    const dx = this.tx - st.x;
    const dz = this.tz - st.z;
    const d = Math.hypot(dx, dz);
    let target = 0;
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) this.pickTarget(st);
    } else if (d < 40) {
      if (this.rng() < this.pauseChance) this.pause = 60 + this.rng() * 240;
      else this.pickTarget(st);
    } else {
      this.yawTarget = yawFromDir(dx / d, dz / d);
      // Slow down while the bow is still swinging round (almost stop when escaping, so the turn stays tight).
      const off = Math.abs(wrapAngle(this.yawTarget - st.yaw));
      const swing = this.escaping > 0 ? 0.92 : 0.6;
      target = this.cruise * THREE.MathUtils.smoothstep(d, 20, 150) * (1 - swing * THREE.MathUtils.smoothstep(off, 0.3, 1.4));
    }
    this.v = approachSpeed(this.v, Math.min(target, st.cap), 0.35, 0.6, dt);
    const prevYaw = st.yaw;
    // Rudder authority grows with speed; a drifting boat barely turns.
    const turn = this.turnRate * (0.15 + 0.85 * Math.min(this.v / Math.max(this.cruise * 0.5, 0.5), 1)) * dt;
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
    st.astern = false;
    st.mode = this.v < 0.1 && this.pause > 0 ? 'anchored' : 'underway';
  }
}

/** Right-of-way class for the traffic rules (higher keeps course and speed). */
export const enum Priority {
  Small = 0,
  Service = 1,
  Ferry = 2,
  Ship = 3,
}

/** A vessel in the simulation: model + behaviour + motion state + render handles. */
export class Vessel {
  readonly state: VesselState = { x: 0, z: 0, yaw: 0, speed: 0, yawRate: 0, mode: 'underway', astern: false, cap: Infinity, shoo: false, escapeX: 0, escapeZ: 0, sidestep: 0, sidestepHold: 0, backOff: false, reversing: false, backBlocked: false };
  /** Ballast ships ride this much above their design waterline (m): the floating body is built lighter by it. */
  lift = 0;
  readonly phase: number;
  readonly matrix = new THREE.Matrix4();
  /** Index into the wake trail pool (-1 = none). */
  wake = -1;
  /** Heading at the last wake feed, and whether the trail must restart (went astern). */
  wakeYaw = 0;
  wakeBroken = false;
  /** Base index into the nav-light pool. */
  lightBase = -1;
  handle: unknown = null;
  /**
   * Render pose of the floating body (phase 21 stage 7b): horizontal position and heading (may lag or drift a little
   * from the navigation reference in `state`), heave of the design waterline (ballast lift included), roll, pitch.
   */
  x = 0;
  z = 0;
  yaw = 0;
  roll = 0;
  pitch = 0;
  heave = 0;
  /** The rigid body (set up by the fleet's physics). */
  body: RigidHull | null = null;
  priority: Priority = Priority.Small;

  constructor(
    readonly id: number,
    readonly model: VesselModel,
    public behaviour: Behaviour,
    readonly paint: THREE.Color,
    readonly seed: number,
  ) {
    this.phase = (id * 2.399) % (Math.PI * 2);
  }

  /** True for vessels that never leave their spot (anchored ships, moored boats). */
  get stationary(): boolean {
    return this.behaviour instanceof AtAnchor || this.behaviour instanceof Moored;
  }
}
