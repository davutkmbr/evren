/**
 * Runs every vessel as a floating rigid body (phase 21 stage 7b): level of detail by camera distance, water sampling
 * from the water service's CPU evaluator (the very surface the shader draws, wave particles included: the wakes of
 * other vessels, the dragon's waves and splashes, stage 7a), the hulls' own bow and stern waves emitted into the
 * water service's wave particles, the fixed-step integration with interpolated render poses, impulses from splashes
 * and the dragon, a land / leash safety net and the CPU time it all costs.
 *
 * Levels of detail (camera distance, with 8 % hysteresis):
 * - Full (<= FULL_RANGE): every buoyancy column, heave / roll / pitch; water refreshed at 30 Hz within 600 m, 12 Hz
 *   beyond (heights extrapolated with their rate in between).
 * - Mid (<= MID_RANGE): heave from three samples refreshed at 6 Hz, roll and pitch settle.
 * - Far: kinematic on the navigation pose.
 * Thrust, steering and drag run for Full and Mid alike (a few dozen flops per vessel and step).
 */
import * as THREE from 'three';
import type { GeoQuery, WaterService } from '../../../../core/contracts';
import { Wander, type Vessel } from '../agents';
import { buildHullBody } from './hull-data';
import { HullLod, RigidHull, wrapPi, type HullReference } from './rigid-hull';

/** Physics tunables (see .docs/planning/21-sea.md, stage 7b). */
export const VESSEL_PHYSICS = {
  /** Fixed integration step (s). */
  step: 1 / 60,
  /** Most steps per frame (longer frames are slowed down rather than exploding). */
  maxSteps: 8,
  /** Full rigid body within this camera distance (m). */
  fullRange: 1500,
  /** Heave-only body within this distance; kinematic beyond (m). */
  midRange: 4000,
  /** Water refresh intervals (s): Full near (<= 600 m), Full far, Mid. */
  sampleNear: 1 / 30,
  sampleFull: 1 / 12,
  sampleMid: 1 / 6,
  /** The body is pulled back onto the navigation pose beyond this distance: max(leashMin, leashLengths x L). */
  leashMin: 60,
  leashLengths: 1.5,
  /** Free-roaming craft (Wander): the navigation restarts from the hull beyond max(min, lengths x L). */
  wanderLeashMin: 6,
  wanderLeashLengths: 0.3,
  /** Teleports (lane respawns): the body jumps with the reference beyond max(teleportMin, 3 L). */
  teleportMin: 300,
  /** Mass of the dragon for contacts (kg). */
  dragonMass: 1600,
  /** Splash impulse per unit strength (N s) and reach (m + per strength). */
  splashImpulse: 1500,
  splashReach: 6,
  /**
   * Wave emission (stage 7a): hulls not kinematic, moving through the water faster than emitSpeed (m/s) and within
   * emitRange of the camera (m) emit their bow and stern waves into the water service's wave particles (which apply
   * their own range and budget on top).
   */
  emitSpeed: 0.8,
  emitRange: 1500,
} as const;

export interface VesselPhysicsStats {
  /** CPU time of the last update and a smoothed average (ms). */
  ms: number;
  avgMs: number;
  full: number;
  mid: number;
  far: number;
  steps: number;
  /** Water height evaluations this frame. */
  samples: number;
  /** Bodies reset after a non-finite state, pulls of the safety net (land / leash), teleports (totals). */
  resets: number;
  pulls: number;
  /** Free-roaming craft re-planned from the hull's position. */
  replans: number;
  teleports: number;
}

interface Slot {
  v: Vessel;
  body: RigidHull;
  ref: HullReference;
  prevRefYaw: number;
  /** Seconds before the dragon can hit this hull again. */
  contactCooldown: number;
  /** Double-ended: the hull may swap ends while held. */
  doubleEnded: boolean;
  wander: boolean;
  /** Within the near water-refresh range of the camera. */
  near: boolean;
}

export class VesselPhysics {
  water: WaterService | null = null;
  readonly stats: VesselPhysicsStats = { ms: 0, avgMs: 0, full: 0, mid: 0, far: 0, steps: 0, samples: 0, resets: 0, pulls: 0, replans: 0, teleports: 0 };
  /** Overrides the level of detail for every body (headless checks). */
  forceLod: HullLod | null = null;
  private readonly slots: Slot[] = [];
  private readonly byId = new Map<number, Slot>();
  private acc = 0;
  private time = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly moments = { heel: 0, trim: 0, lift: 0 };

  constructor(
    vessels: readonly Vessel[],
    private readonly geo: GeoQuery | null,
  ) {
    for (const v of vessels) {
      const body = new RigidHull(buildHullBody(v.model, v.lift));
      v.body = body;
      const slot: Slot = {
        v,
        body,
        ref: { x: 0, z: 0, yaw: 0, speed: 0, astern: false, held: false, yawRate: 0 },
        prevRefYaw: v.state.yaw,
        contactCooldown: 0,
        doubleEnded: !!body.hull.design.doubleEnded,
        wander: v.behaviour instanceof Wander,
        near: false,
      };
      this.readRef(slot, 0);
      body.place(slot.ref);
      body.settle();
      body.savePrevious();
      this.slots.push(slot);
      this.byId.set(v.id, slot);
      this.writePose(slot, 1);
    }
  }

  /** Physics of one vessel (by id). */
  body(id: number): RigidHull | null {
    return this.byId.get(id)?.body ?? null;
  }

  private readRef(s: Slot, dt: number): void {
    const st = s.v.state;
    const ref = s.ref;
    ref.x = st.x;
    ref.z = st.z;
    ref.yaw = st.yaw;
    ref.speed = st.speed;
    ref.astern = st.astern;
    ref.held = st.mode !== 'underway' && st.speed < 0.05;
    // (Clamped: a respawn or a double-ender's swap of ends is not a turn.)
    const rate = dt > 0 ? wrapPi(st.yaw - s.prevRefYaw) / dt : 0;
    ref.yawRate = Math.abs(rate) < 1 ? rate : 0;
    s.prevRefYaw = st.yaw;
  }

  /**
   * Speed cap for the navigation while the body lags behind its reference (the rabbit waits for the dog), m/s.
   * Infinity when the body keeps up.
   */
  lagCap(v: Vessel): number {
    const s = this.byId.get(v.id);
    if (!s || s.body.lod === HullLod.Far || s.ref.held) {
      return Infinity;
    }
    const b = s.body;
    const k = s.ref.astern ? -1 : 1;
    const tx = -Math.sin(s.ref.yaw) * k;
    const tz = -Math.cos(s.ref.yaw) * k;
    const lag = (s.ref.x - b.x) * tx + (s.ref.z - b.z) * tz;
    const L = v.model.length;
    const free = 0.3 * L + 10;
    if (lag <= free) {
      return Infinity;
    }
    return Math.max(0.35, v.state.speed * Math.max(0.2, 1 - (lag - free) / (L + 40)));
  }

  update(dt: number, camPos: THREE.Vector3): void {
    const t0 = performance.now();
    const P = VESSEL_PHYSICS;
    dt = Math.min(Math.max(dt, 0), P.step * P.maxSteps);
    this.time += dt;
    const st = this.stats;
    st.full = 0;
    st.mid = 0;
    st.far = 0;
    st.samples = 0;
    for (const s of this.slots) {
      this.readRef(s, dt);
      this.prepare(s, dt, camPos);
    }
    this.acc += dt;
    let steps = 0;
    while (this.acc >= P.step && steps < P.maxSteps) {
      this.acc -= P.step;
      steps++;
      for (const s of this.slots) {
        const b = s.body;
        if (b.lod === HullLod.Far) {
          continue;
        }
        b.savePrevious();
        // Water refreshes on the fixed-step clock, so the motion does not depend on the frame rate.
        b.sampleIn -= P.step;
        if (b.sampleIn <= 1e-9) {
          b.sampleIn += b.lod === HullLod.Mid ? P.sampleMid : s.near ? P.sampleNear : P.sampleFull;
          if (b.sampleIn < 0) b.sampleIn = 0;
          this.sampleWater(s);
          this.safetyNet(s);
        }
        b.stepPlanar(P.step, s.ref, this.moments);
        b.stepVertical(P.step, this.moments.heel, this.moments.trim, this.moments.lift);
        b.etaAge += P.step;
        if (!b.finite()) {
          st.resets++;
          b.place(s.ref);
          b.settle();
          b.savePrevious();
        }
      }
    }
    if (steps === P.maxSteps) {
      this.acc = 0;
    }
    st.steps = steps;
    const alpha = Math.min(1, this.acc / P.step);
    for (const s of this.slots) {
      s.contactCooldown = Math.max(0, s.contactCooldown - dt);
      this.writePose(s, s.body.lod === HullLod.Far ? 1 : alpha);
    }
    this.emitWaves(camPos);
    const ms = performance.now() - t0;
    st.ms = ms;
    st.avgMs = st.avgMs === 0 ? ms : st.avgMs + (ms - st.avgMs) * 0.05;
  }

  /** Level of detail, teleports, the double-ender swap, water sampling and the safety net for one vessel. */
  private prepare(s: Slot, dt: number, camPos: THREE.Vector3): void {
    const P = VESSEL_PHYSICS;
    const b = s.body;
    const ref = s.ref;
    const L = s.v.model.length;
    const d = Math.hypot(b.x - camPos.x, b.z - camPos.z);
    const hy = b.lod === HullLod.Far ? 0.92 : 1.08;
    let lod = d <= P.fullRange * (b.lod === HullLod.Full ? 1.08 : 0.92) ? HullLod.Full : d <= P.midRange * hy ? HullLod.Mid : HullLod.Far;
    if (this.forceLod !== null) {
      lod = this.forceLod;
    }
    if (lod !== b.lod) {
      if (lod === HullLod.Far) {
        b.settle();
      } else if (b.lod === HullLod.Far) {
        b.place(ref);
        b.savePrevious();
      }
      if (lod === HullLod.Mid) {
        b.vr = 0;
        b.vp = 0;
      }
      b.lod = lod;
      if (lod !== HullLod.Far) {
        // Fresh water under the new set of columns now; later refreshes staggered across the fleet.
        this.sampleWater(s);
        b.sampleIn = (lod === HullLod.Mid ? P.sampleMid : P.sampleFull) * ((s.v.id * 0.618034) % 1);
      }
    }
    if (lod === HullLod.Far) {
      this.stats.far++;
      b.place(ref);
      b.settle();
      b.savePrevious();
      return;
    }
    if (lod === HullLod.Full) this.stats.full++;
    else this.stats.mid++;
    const ex = ref.x - b.x;
    const ez = ref.z - b.z;
    const e = Math.hypot(ex, ez);
    if (e > Math.max(P.teleportMin, 3 * L)) {
      this.stats.teleports++;
      ref.yawRate = 0;
      b.place(ref);
      b.settle();
      b.savePrevious();
      b.sampleIn = 0;
    } else if (s.doubleEnded && Math.abs(wrapPi(ref.yaw - b.yaw)) > 2.4 && Math.hypot(b.vx, b.vz) < 0.8) {
      // The other end becomes the bow (the hull is symmetric, so the swap is invisible).
      b.yaw = wrapPi(b.yaw + Math.PI);
      b.pyaw = wrapPi(b.pyaw + Math.PI);
      b.r = 0;
      b.roll = -b.roll;
      b.proll = -b.proll;
      b.vr = -b.vr;
      b.pitch = -b.pitch;
      b.ppitch = -b.ppitch;
      b.vp = -b.vp;
    }
    s.near = d < 600;
  }

  private sampleWater(s: Slot): void {
    const b = s.body;
    const cols = b.columns;
    const water = this.water;
    const tmp = this.tmp;
    // A hull does not ride its own bow and stern waves (the wave particles it emitted).
    const dyn = water?.dynamic;
    if (dyn) dyn.exclude = s.v.id;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const x = b.worldX(c.lx, c.lz);
      const z = b.worldZ(c.lx, c.lz);
      let eta = 0;
      let rate = 0;
      if (water) {
        eta = water.heightAt(x, z);
        rate = water.velocityAt(x, z, tmp).y;
      }
      b.eta[i] = eta;
      b.etaDot[i] = rate;
    }
    if (dyn) dyn.exclude = -1;
    this.stats.samples += water ? cols.length : 0;
    b.etaAge = 0;
    if (water) {
      water.currentAt(b.x, b.z, tmp);
      b.cx = tmp.x;
      b.cz = tmp.z;
    } else {
      b.cx = 0;
      b.cz = 0;
    }
  }

  /**
   * Keeps the body off the land and near its route: when it is much closer to the shore than its reference (or too
   * far from it), it is eased back onto the reference with the reference's velocity.
   */
  private safetyNet(s: Slot): void {
    const P = VESSEL_PHYSICS;
    const b = s.body;
    const ref = s.ref;
    const e = Math.hypot(ref.x - b.x, ref.z - b.z);
    const L = s.v.model.length;
    // Free-roaming craft keep a short leash: they re-plan from where the current / a push took them.
    let pull = s.wander ? e > Math.max(P.wanderLeashMin, P.wanderLeashLengths * L) : e > Math.max(P.leashMin, P.leashLengths * L);
    if (!pull && this.geo) {
      const half = 0.5 * s.v.model.beam;
      const cBody = this.geo.coastDistance(b.x, b.z);
      if (cBody > -(half + 4)) {
        const cRef = this.geo.coastDistance(ref.x, ref.z);
        pull = cBody > cRef + 3;
      }
    }
    if (!pull) {
      return;
    }
    if (s.wander) {
      this.stats.replans++;
      // Free-roaming craft re-plan from where the hull really is (unless that is the problem).
      const st = s.v.state;
      if (!this.geo || this.geo.coastDistance(b.x, b.z) < -(0.5 * s.v.model.beam + 6)) {
        st.x = b.x;
        st.z = b.z;
        st.yaw = b.yaw;
        ref.x = b.x;
        ref.z = b.z;
        ref.yaw = b.yaw;
        return;
      }
    }
    this.stats.pulls++;
    const k = 0.35;
    b.x += (ref.x - b.x) * k;
    b.z += (ref.z - b.z) * k;
    const sp = ref.speed * (ref.astern ? -1 : 1);
    b.vx = -Math.sin(ref.yaw) * sp;
    b.vz = -Math.cos(ref.yaw) * sp;
    b.savePrevious();
  }

  /**
   * Bow and stern waves (stage 7a): every moving, non-kinematic hull near the camera hands its motion through the water
   * to the wave particles, which turn it into the Kelvin pattern other hulls and the dragon then float on.
   */
  private emitWaves(camPos: THREE.Vector3): void {
    const dyn = this.water?.dynamic;
    if (!dyn) return;
    const P = VESSEL_PHYSICS;
    const range2 = P.emitRange * P.emitRange;
    for (const s of this.slots) {
      const b = s.body;
      if (b.lod === HullLod.Far) continue;
      const cx = b.x - camPos.x;
      const cz = b.z - camPos.z;
      if (cx * cx + cz * cz > range2) continue;
      const ux = b.vx - b.cx;
      const uz = b.vz - b.cz;
      const u = Math.sqrt(ux * ux + uz * uz);
      if (u < P.emitSpeed) continue;
      const m = s.v.model;
      // Planing hulls ride up out of the water: less draft, less wave making.
      const draft = Math.max(0.05, b.hull.draft - b.hull.lift) * (1 - 0.6 * b.planing);
      dyn.hull(s.v.id, b.x, b.z, ux / u, uz / u, u, m.length, m.beam, draft);
    }
  }

  /** Render pose: interpolated between the last two fixed steps. */
  private writePose(s: Slot, alpha: number): void {
    const b = s.body;
    const v = s.v;
    const a = alpha;
    v.x = b.px + (b.x - b.px) * a;
    v.z = b.pz + (b.z - b.pz) * a;
    v.yaw = b.pyaw + wrapPi(b.yaw - b.pyaw) * a;
    v.heave = b.pheave + (b.heave - b.pheave) * a;
    v.roll = b.proll + (b.roll - b.proll) * a;
    v.pitch = b.ppitch + (b.pitch - b.ppitch) * a;
  }

  /**
   * A splash at (x, z) of `strength` (fx units, 0.5 small .. 3 plunge): the water thrown up lifts the near side of
   * hulls within reach and pushes them away. Returns the number of hulls pushed.
   */
  splash(x: number, z: number, strength: number): number {
    const P = VESSEL_PHYSICS;
    let n = 0;
    for (const s of this.slots) {
      const b = s.body;
      if (b.lod === HullLod.Far) continue;
      const L = s.v.model.length;
      const reach = P.splashReach * (1 + strength);
      const dx = x - b.x;
      const dz = z - b.z;
      const cy = Math.cos(b.yaw);
      const sy = Math.sin(b.yaw);
      // Nearest hull point (hull axes: lateral, aft), then the distance from it.
      const lx = dx * cy - dz * sy;
      const lz = dx * sy + dz * cy;
      const hx = Math.max(-0.5 * s.v.model.beam, Math.min(0.5 * s.v.model.beam, lx));
      const hz = Math.max(-0.5 * L, Math.min(0.5 * L, lz));
      const gap = Math.hypot(lx - hx, lz - hz);
      if (gap > reach) continue;
      const fall = 1 - gap / reach;
      const j = P.splashImpulse * strength * fall * fall;
      const px = b.x + hx * cy + hz * sy;
      const pz = b.z - hx * sy + hz * cy;
      const ox = px - x;
      const oz = pz - z;
      const ol = Math.hypot(ox, oz) || 1;
      b.impulse(px, pz, (0.5 * j * ox) / ol, j, (0.5 * j * oz) / ol);
      n++;
    }
    return n;
  }

  /**
   * The dragon touching hulls: landing on a small boat (from above, descending) presses it down at the contact point;
   * bumping into one pushes it along the relative velocity. Momentum exchange with the reduced mass, at most once per
   * `cooldown` per hull. Returns the ids of the hulls hit.
   */
  contact(pos: THREE.Vector3, vel: THREE.Vector3, radius = 2, mass: number = VESSEL_PHYSICS.dragonMass, out: number[] = []): number[] {
    out.length = 0;
    for (const s of this.slots) {
      const b = s.body;
      if (b.lod !== HullLod.Full || s.contactCooldown > 0) continue;
      const L = s.v.model.length;
      const B = s.v.model.beam;
      const dx = pos.x - b.x;
      const dz = pos.z - b.z;
      if (dx * dx + dz * dz > (0.5 * L + radius + 2) ** 2) continue;
      const cy = Math.cos(b.yaw);
      const sy = Math.sin(b.yaw);
      const lx = dx * cy - dz * sy;
      const lz = dx * sy + dz * cy;
      if (Math.abs(lx) > 0.5 * B + radius || Math.abs(lz) > 0.5 * L + radius) continue;
      const deck = b.heave + b.hull.freeboard;
      const keel = b.heave - b.hull.draft;
      if (pos.y > deck + radius + 0.5 || pos.y < keel - radius) continue;
      const rvx = vel.x - b.vx;
      const rvy = vel.y - b.vh;
      const rvz = vel.z - b.vz;
      const mEff = (mass * b.hull.mHeave) / (mass + b.hull.mHeave);
      const hx = Math.max(-0.5 * B, Math.min(0.5 * B, lx));
      const hz = Math.max(-0.5 * L, Math.min(0.5 * L, lz));
      const px = b.x + hx * cy + hz * sy;
      const pz = b.z - hx * sy + hz * cy;
      const onTop = pos.y > deck - 0.5 && rvy < -0.3;
      if (onTop) {
        // Landing: the vertical momentum (slightly elastic) and a share of the horizontal one.
        const mH = (mass * b.hull.mSway) / (mass + b.hull.mSway);
        b.impulse(px, pz, 0.3 * mH * rvx, 1.2 * mEff * rvy, 0.3 * mH * rvz);
      } else {
        const mH = (mass * b.hull.mSway) / (mass + b.hull.mSway);
        const approach = rvx * (px - pos.x) + rvz * (pz - pos.z);
        if (approach <= 0 && Math.hypot(lx - hx, lz - hz) > 0.01) continue;
        b.impulse(px, pz, 1.2 * mH * rvx, 0.3 * mEff * Math.min(rvy, 0), 1.2 * mH * rvz);
      }
      s.contactCooldown = 0.8;
      out.push(s.v.id);
    }
    return out;
  }
}
