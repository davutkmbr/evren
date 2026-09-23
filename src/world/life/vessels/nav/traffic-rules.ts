import { aheadStraight, Wander, type Vessel } from '../agents';
import type { TrackSample } from './track';

/** Vessels further apart than this are ignored (m). */
const RANGE = 1600;
/** Prediction step (s) and number of steps: a 60 s look-ahead along each vessel's own (curved) track. */
const STEP_T = 4;
const STEPS = 15;
/** Braking deceleration assumed per priority class (m/s²). */
const BRAKE = [0.4, 0.3, 0.22, 0.07];
/** A stopped vessel checks the way it intends to go at this speed (m/s). */
const INTENT = 1.5;

const STRIDE = (STEPS + 1) * 4;

/** Closest distance between segments p0-p1 and q0-q1 in the plane. */
function segDist(p0x: number, p0z: number, p1x: number, p1z: number, q0x: number, q0z: number, q1x: number, q1z: number): number {
  const ux = p1x - p0x;
  const uz = p1z - p0z;
  const vx = q1x - q0x;
  const vz = q1z - q0z;
  const wx = p0x - q0x;
  const wz = p0z - q0z;
  const den = ux * vz - uz * vx;
  if (Math.abs(den) > 1e-9) {
    const s = (vx * wz - vz * wx) / den;
    const t = (ux * wz - uz * wx) / den;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) return 0;
  }
  const pt = (px: number, pz: number, ax: number, az: number, dx: number, dz: number): number => {
    const l2 = dx * dx + dz * dz;
    const t = l2 > 1e-9 ? Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / l2, 0), 1) : 0;
    return Math.hypot(px - ax - dx * t, pz - az - dz * t);
  };
  return Math.min(pt(p0x, p0z, q0x, q0z, vx, vz), pt(p1x, p1z, q0x, q0z, vx, vz), pt(q0x, q0z, p0x, p0z, ux, uz), pt(q1x, q1z, p0x, p0z, ux, uz));
}

/**
 * Collision avoidance by speed control, loosely after COLREGs. Every vessel's position is predicted along its own
 * intended track (ferry legs, lanes and loops curve) for the next minute; hulls are capsules. For the first predicted
 * conflict the give-way vessel (lower priority class; within a class the one with the other on its starboard bow, the
 * overtaking one, or a deterministic tie-break head-on) slows so it stops short of the conflict, or just matches speed
 * when following. When stopping would still leave it in the other's path it keeps going to clear, and the stand-on
 * vessel brakes instead once the conflict is close (Rule 17). Stopped small craft in a larger vessel's way are told to
 * move on. The result is a speed cap in each vessel's state; behaviours honour it. Evaluated round-robin (a third of
 * the fleet per frame); predictions are refreshed every frame.
 */
export class TrafficRules {
  private frame = 0;
  private readonly moving: Vessel[];
  private readonly pred: Float32Array;
  private readonly own = new Float32Array(STRIDE);
  private readonly smp: TrackSample = { x: 0, z: 0, tx: 0, tz: -1 };

  constructor(private readonly vessels: readonly Vessel[]) {
    this.moving = vessels.filter((v) => !v.stationary);
    let maxId = 0;
    for (const v of vessels) maxId = Math.max(maxId, v.id);
    this.pred = new Float32Array((maxId + 1) * STRIDE);
    for (const v of vessels) this.predict(v, 0, this.pred, v.id * STRIDE);
  }

  update(): void {
    this.frame++;
    for (const v of this.moving) this.predict(v, v.state.speed, this.pred, v.id * STRIDE);
    const n = this.moving.length;
    for (let i = 0; i < n; i++) {
      if ((i + this.frame) % 3 !== 0) continue;
      const v = this.moving[i];
      v.state.cap = this.capFor(v);
    }
  }

  /** Fills STEPS + 1 predicted poses (x, z, axis x, axis z) at `speed` along the vessel's path. */
  private predict(v: Vessel, speed: number, out: Float32Array, base: number): void {
    const st = v.state;
    const smp = this.smp;
    // The hull axis at the present comes from the heading, not the track tangent.
    out[base] = st.x;
    out[base + 1] = st.z;
    out[base + 2] = -Math.sin(st.yaw);
    out[base + 3] = -Math.cos(st.yaw);
    if (speed <= 0) {
      for (let k = 1; k <= STEPS; k++) out.copyWithin(base + k * 4, base, base + 4);
      return;
    }
    for (let k = 1; k <= STEPS; k++) {
      const dist = speed * k * STEP_T;
      if (v.behaviour.ahead) v.behaviour.ahead(dist, st, smp);
      else aheadStraight(dist, st, smp);
      const o = base + k * 4;
      out[o] = smp.x;
      out[o + 1] = smp.z;
      out[o + 2] = smp.tx;
      out[o + 3] = smp.tz;
    }
  }

  private capFor(a: Vessel): number {
    const sa = a.state;
    // Backing off out of a stand-off: stop as soon as anyone comes into the water astern.
    if (sa.reversing) {
      sa.backBlocked = !this.clearAstern(a, 0.9);
      return Infinity;
    }
    // Alongside or backing out of a berth: the pier manoeuvre is choreographed, no avoidance.
    if (sa.mode === 'moored' || sa.astern) return Infinity;
    const va = Math.max(sa.speed, INTENT);
    let pa = this.pred;
    let pab = a.id * STRIDE;
    if (sa.speed < INTENT) {
      this.predict(a, INTENT, this.own, 0);
      pa = this.own;
      pab = 0;
    }
    const La = a.model.length;
    const Ba = a.model.beam;
    const ha = La * 0.46;
    const fax = -Math.sin(sa.yaw);
    const faz = -Math.cos(sa.yaw);
    const pb = this.pred;
    let cap = Infinity;
    sa.backOff = false;
    for (const b of this.vessels) {
      if (b === a) continue;
      const sb = b.state;
      const dx = sb.x - sa.x;
      const dz = sb.z - sa.z;
      if (Math.abs(dx) > RANGE || Math.abs(dz) > RANGE) continue;
      const Lb = b.model.length;
      const Bb = b.model.beam;
      const docked = sb.mode === 'moored';
      // Hulls lying at a pier are passed close by on the run-in to the neighbouring berth: only real contact counts.
      const need = docked ? 0.5 * (Ba + Bb) + 2 : 0.5 * (Ba + Bb) + 8 + 0.04 * (La + Lb);
      const dist = Math.hypot(dx, dz);
      const reach = 0.5 * (La + Lb) + need;
      if (dist - reach > STEPS * STEP_T * (va + sb.speed)) continue;
      const hb = Lb * 0.46;
      const pbb = b.id * STRIDE;
      // First predicted step at which the hulls come within `need`. When already inside the margin but opening the
      // distance (moving away), only a later step that comes closer than now counts.
      let kc = -1;
      let limit = need;
      let d0 = -1;
      for (let k = 0; k <= STEPS; k++) {
        const oa = pab + k * 4;
        const ob = pbb + k * 4;
        const ax = pa[oa];
        const az = pa[oa + 1];
        const bx = pb[ob];
        const bz = pb[ob + 1];
        if (Math.abs(ax - bx) > reach || Math.abs(az - bz) > reach) continue;
        const d = segDist(ax - pa[oa + 2] * ha, az - pa[oa + 3] * ha, ax + pa[oa + 2] * ha, az + pa[oa + 3] * ha, bx - pb[ob + 2] * hb, bz - pb[ob + 3] * hb, bx + pb[ob + 2] * hb, bz + pb[ob + 3] * hb);
        if (k === 0) {
          d0 = d;
          continue;
        }
        if (k === 1 && d0 >= 0 && d0 < need) {
          if (d > d0 + 0.5) {
            limit = Math.min(need, d0 - 1);
            continue;
          }
          kc = 0;
          break;
        }
        // Short hulls closing fast can slip between samples: also test halfway from the previous step.
        const oa0 = oa - 4;
        const ob0 = ob - 4;
        const mx = (ax + pa[oa0]) * 0.5;
        const mz = (az + pa[oa0 + 1]) * 0.5;
        const nx = (bx + pb[ob0]) * 0.5;
        const nz = (bz + pb[ob0 + 1]) * 0.5;
        const dm = segDist(mx - pa[oa + 2] * ha, mz - pa[oa + 3] * ha, mx + pa[oa + 2] * ha, mz + pa[oa + 3] * ha, nx - pb[ob + 2] * hb, nz - pb[ob + 3] * hb, nx + pb[ob + 2] * hb, nz + pb[ob + 3] * hb);
        if (Math.min(d, dm) < limit) {
          kc = dm < limit ? k - 1 : k;
          break;
        }
      }
      if (kc < 0 && d0 >= 0 && d0 < need && limit === need) kc = 0;
      if (kc < 0) continue;
      const tc = kc * STEP_T;
      const fbx = -Math.sin(sb.yaw);
      const fbz = -Math.cos(sb.yaw);
      // A vessel coming up from abaft the beam is overtaking: it keeps clear, the leader never brakes for it.
      if ((dx * fax + dz * faz) / Math.max(dist, 1e-3) < -0.35 && !b.stationary && sb.mode !== 'moored') continue;
      const drifting = sb.speed < 0.2 && b.behaviour instanceof Wander;
      const fixed = b.stationary || docked || sb.astern || (sb.speed < 0.5 && !drifting);
      let giveWay: boolean;
      if (fixed) giveWay = true;
      else if (drifting) {
        if (a.priority > b.priority) sb.shoo = true;
        giveWay = true;
      } else if (a.priority !== b.priority) giveWay = a.priority < b.priority;
      else giveWay = this.givesWay(a, b, dx, dz, dist, fax, faz);
      // Meeting end on: both alter to starboard (track followers shift sideways, see Sidestep).
      const meeting = fax * fbx + faz * fbz < -0.8 && (dx * fax + dz * faz) / Math.max(dist, 1e-3) > 0.6;
      if (meeting && !fixed) {
        sa.sidestep = Math.max(sa.sidestep, 0.5 * (Ba + Bb) + 22);
        sa.sidestepHold = 45;
      }

      const stopShort = Math.sqrt(2 * BRAKE[a.priority] * Math.max(va * tc - need - 0.25 * La, 0));
      if (giveWay) {
        // Free-roaming craft also steer: away from the other's track (or its hull, when it lies still).
        if (a.behaviour instanceof Wander) {
          if (fixed || drifting || sb.speed < 0.5) {
            const l = Math.max(dist, 1e-3);
            sa.escapeX = -dx / l;
            sa.escapeZ = -dz / l;
          } else {
            const side = fbx * dz - fbz * dx > 0 ? -1 : 1;
            sa.escapeX = -fbz * side;
            sa.escapeZ = fbx * side;
          }
        }
        // Stopping only helps if the other's track then misses our hull, where it is now and where it would come to
        // rest: otherwise keep going and let the stand-on vessel act (never when going the same way: the one astern
        // always drops back).
        const sameWay = fax * fbx + faz * fbz > 0.6;
        if (!fixed && !drifting && !sameWay && (this.pathHits(pb, pbb, hb, sa.x, sa.z, fax, faz, ha, need) || this.stopHits(a, pb, pbb, hb, ha, need))) continue;
        // Stop before entering the other's swept track, not merely before the time of conflict: it may stop in the
        // crossing itself, and then neither could move.
        const enter = fixed || drifting ? kc : this.firstEntry(pa, pab, ha, pb, pbb, hb, need + 0.5 * sb.speed * STEP_T);
        let c = Math.min(stopShort, Math.sqrt(2 * BRAKE[a.priority] * Math.max(va * enter * STEP_T - need - 0.25 * La, 0)));
        // Following the same way: match the other's speed instead of stopping.
        const along = (fax * fbx + faz * fbz) * sb.speed;
        const ahead = (dx * fax + dz * faz) / Math.max(dist, 1e-3);
        if (!fixed && along > 0.3 && ahead > 0.5 && dist > 0.5 * (La + Lb)) c = Math.max(c, along * 0.9);
        cap = Math.min(cap, c);
        // Mutual stand-off (both stopped): the lower class, or the higher id, is the one to back off.
        // When the designated one has no room astern, the other backs off instead.
        if (sa.speed < 0.2 && sb.speed < 0.2 && !b.stationary && !docked && this.clearAstern(a)) {
          const loser = a.priority < b.priority || (a.priority === b.priority && a.id > b.id);
          if (loser || !this.clearAstern(b)) sa.backOff = true;
        }
      } else if (tc <= 32) {
        // Stand-on (Rule 17): brake too when the give-way vessel is not slowing, or could not stop clear of our track.
        const acting = sb.cap < sb.speed - 0.05;
        if (!acting || this.pathHits(pa, pab, ha, sb.x, sb.z, fbx, fbz, hb, need) || this.stopHits(b, pa, pab, ha, hb, need)) cap = Math.min(cap, stopShort);
      }
    }
    return cap;
  }

  /** True when the vessel could back a hull length and a half along its own track without touching anyone. */
  private clearAstern(a: Vessel, reach = 1.5): boolean {
    const beh = a.behaviour;
    if (!beh.ahead) return false;
    const st = a.state;
    const La = a.model.length;
    const ha = La * 0.46;
    const smp = this.smp;
    for (const f of [reach / 3, (reach * 2) / 3, reach]) {
      beh.ahead(-f * La, st, smp);
      for (const b of this.vessels) {
        if (b === a) continue;
        const sb = b.state;
        if (Math.abs(sb.x - smp.x) > 400 || Math.abs(sb.z - smp.z) > 400) continue;
        const hb = b.model.length * 0.46;
        const fbx = -Math.sin(sb.yaw);
        const fbz = -Math.cos(sb.yaw);
        const d = segDist(smp.x - smp.tx * ha, smp.z - smp.tz * ha, smp.x + smp.tx * ha, smp.z + smp.tz * ha, sb.x - fbx * hb, sb.z - fbz * hb, sb.x + fbx * hb, sb.z + fbz * hb);
        if (d < 0.5 * (a.model.beam + b.model.beam) + 8) return false;
      }
    }
    return true;
  }

  /** First own prediction step whose hull comes within `need` of any predicted hull of the other (its swept track). */
  private firstEntry(pa: Float32Array, pab: number, ha: number, pb: Float32Array, pbb: number, hb: number, need: number): number {
    for (let k = 0; k <= STEPS; k++) {
      const oa = pab + k * 4;
      const ax = pa[oa];
      const az = pa[oa + 1];
      const a0x = ax - pa[oa + 2] * ha;
      const a0z = az - pa[oa + 3] * ha;
      const a1x = ax + pa[oa + 2] * ha;
      const a1z = az + pa[oa + 3] * ha;
      for (let j = 0; j <= STEPS; j++) {
        const ob = pbb + j * 4;
        const bx = pb[ob];
        const bz = pb[ob + 1];
        if (Math.abs(ax - bx) > ha + hb + need || Math.abs(az - bz) > ha + hb + need) continue;
        if (segDist(a0x, a0z, a1x, a1z, bx - pb[ob + 2] * hb, bz - pb[ob + 3] * hb, bx + pb[ob + 2] * hb, bz + pb[ob + 3] * hb) < need) return k;
      }
    }
    return STEPS;
  }

  /** True when vessel `v`, braking now, would come to rest inside the other's predicted track. */
  private stopHits(v: Vessel, po: Float32Array, pob: number, ho: number, hv: number, need: number): boolean {
    const st = v.state;
    if (st.speed < 0.3) return false;
    const stop = (st.speed * st.speed) / (2 * BRAKE[v.priority]);
    const smp = this.smp;
    if (v.behaviour.ahead) v.behaviour.ahead(stop, st, smp);
    else aheadStraight(stop, st, smp);
    return this.pathHits(po, pob, ho, smp.x, smp.z, smp.tx, smp.tz, hv, need);
  }

  /** True when any predicted hull of the other vessel comes within `need` of our present hull. */
  private pathHits(pb: Float32Array, base: number, hb: number, x: number, z: number, fx: number, fz: number, ha: number, need: number): boolean {
    for (let k = 1; k <= STEPS; k++) {
      const o = base + k * 4;
      const bx = pb[o];
      const bz = pb[o + 1];
      if (Math.abs(bx - x) > ha + hb + need || Math.abs(bz - z) > ha + hb + need) continue;
      if (segDist(x - fx * ha, z - fz * ha, x + fx * ha, z + fz * ha, bx - pb[o + 2] * hb, bz - pb[o + 3] * hb, bx + pb[o + 2] * hb, bz + pb[o + 3] * hb) < need) return true;
    }
    return false;
  }

  private givesWay(a: Vessel, b: Vessel, dx: number, dz: number, dist: number, fax: number, faz: number): boolean {
    const fbx = -Math.sin(b.state.yaw);
    const fbz = -Math.cos(b.state.yaw);
    const ahead = (dx * fax + dz * faz) / Math.max(dist, 1e-3);
    // Relative bearing of b: cross > 0 = starboard side.
    const cross = (fax * dz - faz * dx) / Math.max(dist, 1e-3);
    const sameWay = fax * fbx + faz * fbz;
    // Overtaking: the vessel coming up from behind keeps clear.
    if (sameWay > 0.6) return ahead > 0;
    // Head-on: deterministic tie-break.
    if (sameWay < -0.85) return a.id > b.id;
    // Crossing: give way to the vessel on the starboard side.
    if (Math.abs(cross) > 0.05) return cross > 0;
    return a.id > b.id;
  }
}
