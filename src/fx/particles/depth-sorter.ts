import { evalMotion, type MotionOut, type Vec3Out } from './motion';
import type { ParticlePool } from './particle-pool';
import { VolType } from './types';

const LOG_RANGE = Math.log2(1 + 4000);

/**
 * Back-to-front ordering of the live particles of a pool (2-pass LSD radix sort on 16-bit log-depth keys).
 * Allocation-free; the result is written as float slot indices into `order` (an instanced attribute array).
 */
export class DepthSorter {
  private keys: Uint16Array;
  private keysTmp: Uint16Array;
  private slots: Uint32Array;
  private slotsTmp: Uint32Array;
  private readonly counts = new Uint32Array(256);
  private readonly pos: MotionOut = { x: 0, y: 0, z: 0, rel: 0 };
  /** Estimated overdraw of the last sort, in full screens (projected sprite areas / screen area; flat decals excluded). */
  coverage = 0;

  constructor(capacity: number) {
    this.keys = new Uint16Array(capacity);
    this.keysTmp = new Uint16Array(capacity);
    this.slots = new Uint32Array(capacity);
    this.slotsTmp = new Uint32Array(capacity);
  }

  /**
   * Returns the number of live particles written to `order`.
   * camPos/camFwd are world camera position and forward (unit) vector.
   */
  sort(
    pool: ParticlePool,
    now: number,
    camPos: Vec3Out,
    camFwd: Vec3Out,
    wind: Vec3Out,
    order: Float32Array,
    tanHalfFov = 0.577,
    aspect = 1.78,
  ): number {
    let coverage = 0;
    const areaScale = Math.PI / (4 * tanHalfFov * tanHalfFov * aspect);
    const data = pool.data;
    const profiles = pool.profiles;
    const live = pool.liveSlots;
    const total = pool.liveCount;
    let n = 0;
    const pos = this.pos;
    for (let i = 0; i < total; i++) {
      const slot = live[i];
      if (!pool.isAlive(slot, now)) {
        continue;
      }
      const o = pool.offsetOf(slot);
      const type = data[o + 13] | 0;
      const profile = profiles[type];
      evalMotion(data, o, now, profile, wind.x, wind.y, wind.z, pos);
      const depth = (pos.x - camPos.x) * camFwd.x + (pos.y - camPos.y) * camFwd.y + (pos.z - camPos.z) * camFwd.z;
      if (depth > 0.5 && type !== VolType.Foam && type !== VolType.Ring) {
        const age = now - data[o + 3];
        const radius =
          data[o + 8] + (data[o + 9] - data[o + 8]) * (1 - Math.exp(-age / profile.growTime)) + profile.spreadRate * age + profile.jetSpread * pos.rel;
        const q = radius / depth;
        coverage += Math.min(q * q * areaScale, 1);
      }
      const d = depth > 0 ? Math.log2(1 + depth) / LOG_RANGE : 0;
      // Far first: larger depth -> smaller key.
      this.keys[n] = 65535 - Math.min(65535, (d * 65535) | 0);
      this.slots[n] = slot;
      n++;
    }
    this.radix(n, 0, this.keys, this.slots, this.keysTmp, this.slotsTmp);
    this.radix(n, 8, this.keysTmp, this.slotsTmp, this.keys, this.slots);
    const slots = this.slots;
    for (let i = 0; i < n; i++) {
      order[i] = slots[i];
    }
    this.coverage = coverage;
    return n;
  }

  private radix(n: number, shift: number, kIn: Uint16Array, sIn: Uint32Array, kOut: Uint16Array, sOut: Uint32Array): void {
    const counts = this.counts;
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      counts[(kIn[i] >> shift) & 255]++;
    }
    let sum = 0;
    for (let b = 0; b < 256; b++) {
      const c = counts[b];
      counts[b] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i++) {
      const k = kIn[i];
      const dst = counts[(k >> shift) & 255]++;
      kOut[dst] = k;
      sOut[dst] = sIn[i];
    }
  }
}
