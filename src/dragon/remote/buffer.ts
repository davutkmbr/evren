/**
 * Snapshot buffer of one remote dragon: received snapshots are drawn INTERP_DELAY_MS behind the newest one, so there
 * is almost always a pair around the render time to interpolate between (position on a Hermite curve from the
 * velocities, orientation slerped, pose fields blended, phases the short way round). When the stream stalls the dragon
 * coasts on its velocity for up to EXTRAPOLATE_MS, then holds; after an `away` snapshot (the player's tab went to the
 * background) it flies on along the loiter circle (src/net/loiter.ts) until the player is back.
 */
import * as THREE from 'three';
import { loiter, loiters } from '../../net/loiter';
import { createSnapshot, isPhaseField, type DragonSnapshot } from '../../net/snapshot';

export const INTERP_DELAY_MS = 100;
const EXTRAPOLATE_MS = 250;
const CAPACITY = 32;
/** Render clock correction: snap when this far off (ms), otherwise ease toward the target at this rate (1/s). */
const SNAP_MS = 500;
const EASE_RATE = 2;
const TAU = Math.PI * 2;

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export class SnapshotBuffer {
  private readonly items: DragonSnapshot[] = [];
  private renderT = Number.NaN;
  /** Snapshots dropped for arriving older than the render time or duplicated. */
  late = 0;

  get size(): number {
    return this.items.length;
  }

  get newest(): DragonSnapshot | undefined {
    return this.items[this.items.length - 1];
  }

  /** Adds a snapshot (copied); out-of-order arrivals are inserted in place. A teleport starts the buffer over. */
  push(s: DragonSnapshot): void {
    if (s.teleport && this.items.length && s.t > this.items[this.items.length - 1].t) {
      this.items.length = 0;
      this.renderT = Number.NaN;
    }
    if (Number.isFinite(this.renderT) && s.t <= this.renderT - EXTRAPOLATE_MS) {
      this.late++;
      return;
    }
    const copy = this.items.length >= CAPACITY ? this.items.shift()! : createSnapshot();
    copySnapshot(s, copy);
    let i = this.items.length;
    while (i > 0 && this.items[i - 1].t > copy.t) {
      i--;
    }
    if (i > 0 && this.items[i - 1].t === copy.t) {
      this.late++;
      return;
    }
    this.items.splice(i, 0, copy);
    if (!Number.isFinite(this.renderT)) {
      this.renderT = copy.t - INTERP_DELAY_MS;
    }
  }

  /** Advances the render clock by dt (s) and writes the state at the render time into `out`; false when empty. */
  sample(dt: number, out: DragonSnapshot): boolean {
    const newest = this.newest;
    if (!newest) {
      return false;
    }
    this.renderT += dt * 1000;
    // While the player is away no snapshots come: the clock runs on freely (no pull back to the old newest).
    if (!newest.away) {
      const target = newest.t - INTERP_DELAY_MS;
      const err = target - this.renderT;
      this.renderT = Math.abs(err) > SNAP_MS ? target : this.renderT + err * Math.min(1, dt * EASE_RATE);
    }
    const t = this.renderT;
    // Drop snapshots no longer needed (keep the last one at or before the render time).
    while (this.items.length > 2 && this.items[1].t <= t) {
      this.items.shift();
    }
    const a = this.items[0];
    const b = this.items[1];
    // Past an away snapshot, up to the player's return: the loiter circle (the returning player was placed on it).
    if (a.away && t > a.t && (!b || t < b.t) && loiters(a)) {
      loiter(a, (t - a.t) / 1000, out);
      return true;
    }
    if (!b || t <= a.t) {
      extrapolate(a, t, out);
      return true;
    }
    if (t >= b.t) {
      if (b.away && loiters(b)) {
        loiter(b, (t - b.t) / 1000, out);
      } else {
        extrapolate(b, t, out);
      }
      return true;
    }
    interpolate(a, b, (t - a.t) / (b.t - a.t), out);
    return true;
  }
}

function copySnapshot(s: DragonSnapshot, out: DragonSnapshot): void {
  out.t = s.t;
  out.position[0] = s.position[0];
  out.position[1] = s.position[1];
  out.position[2] = s.position[2];
  out.quaternion[0] = s.quaternion[0];
  out.quaternion[1] = s.quaternion[1];
  out.quaternion[2] = s.quaternion[2];
  out.quaternion[3] = s.quaternion[3];
  out.velocity[0] = s.velocity[0];
  out.velocity[1] = s.velocity[1];
  out.velocity[2] = s.velocity[2];
  out.mode = s.mode;
  out.firing = s.firing;
  out.riderless = s.riderless;
  out.teleport = s.teleport;
  out.away = s.away;
  out.pose.set(s.pose);
  out.groundY = s.groundY;
  out.groundNx = s.groundNx;
  out.groundNz = s.groundNz;
}

/** The snapshot moved along its velocity to time t (at most EXTRAPOLATE_MS ahead); phases keep running. */
function extrapolate(s: DragonSnapshot, t: number, out: DragonSnapshot): void {
  copySnapshot(s, out);
  const ahead = Math.min(Math.max(t - s.t, 0), EXTRAPOLATE_MS) / 1000;
  for (let i = 0; i < 3; i++) {
    out.position[i] += s.velocity[i] * ahead;
  }
  out.t = t;
}

function lerpPhase(a: number, b: number, u: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) {
    d -= TAU;
  } else if (d < -Math.PI) {
    d += TAU;
  }
  return (((a + d * u) % TAU) + TAU) % TAU;
}

function interpolate(a: DragonSnapshot, b: DragonSnapshot, u: number, out: DragonSnapshot): void {
  const span = (b.t - a.t) / 1000;
  // Cubic Hermite with the snapshots' velocities as tangents: smooth curves through turns instead of corners.
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  for (let i = 0; i < 3; i++) {
    out.position[i] = h00 * a.position[i] + h10 * span * a.velocity[i] + h01 * b.position[i] + h11 * span * b.velocity[i];
    out.velocity[i] = a.velocity[i] + (b.velocity[i] - a.velocity[i]) * u;
  }
  _qa.fromArray(a.quaternion);
  _qb.fromArray(b.quaternion);
  _qa.slerp(_qb, u);
  out.quaternion[0] = _qa.x;
  out.quaternion[1] = _qa.y;
  out.quaternion[2] = _qa.z;
  out.quaternion[3] = _qa.w;
  for (let i = 0; i < a.pose.length; i++) {
    out.pose[i] = isPhaseField(i) ? lerpPhase(a.pose[i], b.pose[i], u) : a.pose[i] + (b.pose[i] - a.pose[i]) * u;
  }
  const near = u < 0.5 ? a : b;
  out.mode = near.mode;
  out.firing = near.firing;
  out.riderless = near.riderless;
  if (Number.isFinite(a.groundY) && Number.isFinite(b.groundY)) {
    out.groundY = a.groundY + (b.groundY - a.groundY) * u;
    out.groundNx = a.groundNx + (b.groundNx - a.groundNx) * u;
    out.groundNz = a.groundNz + (b.groundNz - a.groundNz) * u;
  } else {
    out.groundY = near.groundY;
    out.groundNx = near.groundNx;
    out.groundNz = near.groundNz;
  }
  out.t = a.t + (b.t - a.t) * u;
}
