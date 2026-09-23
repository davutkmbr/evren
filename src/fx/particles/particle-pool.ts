import * as THREE from 'three';
import type { MotionProfile } from './types';

/** Particles per texture row; each particle owns TEXELS_PER_PARTICLE consecutive RGBA32F texels. */
export const PARTICLES_PER_ROW = 256;
export const TEXELS_PER_PARTICLE = 6;
export const FLOATS_PER_PARTICLE = TEXELS_PER_PARTICLE * 4;
export const DATA_TEXTURE_WIDTH = PARTICLES_PER_ROW * TEXELS_PER_PARTICLE;

/**
 * Parameters of one particle. Layout (6 texels):
 *   T0 p0.xyz birth | T1 v0.xyz life | T2 size0 size1 drag buoy | T3 seed type auxA auxB | T4 planeNx planeNz planeD auxC
 *   T5 carrier.xyz auxD
 * The collision plane is n·p >= d with ny = sqrt(1 - nx² - nz²) (surfaces facing up or sideways).
 * The carrier velocity is the air velocity (besides wind) the particle relaxes towards: a fraction of the emitter's
 * velocity for air entrained around the flying dragon, 0 for still air.
 */
export interface SpawnSpec {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  birth: number;
  life: number;
  size0: number;
  size1: number;
  drag: number;
  buoy: number;
  seed: number;
  type: number;
  auxA: number;
  auxB: number;
  planeNx: number;
  planeNz: number;
  planeD: number;
  auxC: number;
  cvx: number;
  cvy: number;
  cvz: number;
  auxD: number;
}

export function createSpawnSpec(): SpawnSpec {
  return {
    px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, birth: 0, life: 1, size0: 1, size1: 1, drag: 1, buoy: 0,
    seed: 0, type: 0, auxA: 0, auxB: 0, planeNx: 0, planeNz: 0, planeD: -1e6, auxC: 0, cvx: 0, cvy: 0, cvz: 0, auxD: 0,
  };
}

/**
 * Stateless GPU particles in a fixed slot table. The CPU only writes spawn parameters; the vertex shader evaluates
 * the closed-form motion from age. Slots are handed out next-fit: a cursor sweeps the table and takes the next
 * expired slot, so short-lived flames reuse slots freely while long-lived smoke/foam is simply skipped (no FIFO
 * blocking). Consecutive allocations stay contiguous, so only a compact cyclic range is uploaded per frame.
 * `liveSlots` lists every allocated, unexpired slot (unordered) for sorting and instancing.
 */
export class ParticlePool {
  readonly capacity: number;
  readonly rows: number;
  readonly data: Float32Array;
  readonly texture: THREE.DataTexture;
  /** Allocated, unexpired slots in [0, liveCount) (may include particles with a future birth). */
  readonly liveSlots: Uint32Array;
  liveCount = 0;
  private readonly death: Float32Array;
  private clock = -1e9;
  private cursor = 0;
  private dirtyStart = 0;
  private dirtySpan = 0;
  private fullUpload = true;

  constructor(capacity: number, readonly profiles: readonly MotionProfile[]) {
    this.capacity = Math.max(PARTICLES_PER_ROW, Math.ceil(capacity / PARTICLES_PER_ROW) * PARTICLES_PER_ROW);
    this.rows = this.capacity / PARTICLES_PER_ROW;
    this.data = new Float32Array(this.rows * DATA_TEXTURE_WIDTH * 4);
    this.death = new Float32Array(this.capacity).fill(-1e9);
    this.liveSlots = new Uint32Array(this.capacity);
    this.texture = new THREE.DataTexture(this.data, DATA_TEXTURE_WIDTH, this.rows, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
  }

  /** Fraction of the slots holding live (or pending) particles; emitters throttle above ~0.8. */
  get load(): number {
    return this.liveCount / this.capacity;
  }

  isAlive(slot: number, now: number): boolean {
    return this.death[slot] > now && this.data[this.offsetOf(slot) + 3] <= now;
  }

  /** Sets the allocation clock and drops expired slots from the live list. */
  advance(now: number): void {
    this.clock = now;
    const death = this.death;
    const live = this.liveSlots;
    let n = 0;
    for (let i = 0; i < this.liveCount; i++) {
      const slot = live[i];
      if (death[slot] > now) {
        live[n++] = slot;
      }
    }
    this.liveCount = n;
  }

  /** Writes a particle into the next free slot; returns the slot, or -1 when the pool is full. */
  spawn(s: SpawnSpec): number {
    const cap = this.capacity;
    if (this.liveCount >= cap) {
      return -1;
    }
    const death = this.death;
    const clock = this.clock;
    let slot = this.cursor;
    let steps = 1;
    while (death[slot] > clock) {
      slot = slot + 1 === cap ? 0 : slot + 1;
      steps++;
    }
    this.cursor = slot + 1 === cap ? 0 : slot + 1;
    const o = this.offsetOf(slot);
    const d = this.data;
    d[o] = s.px;
    d[o + 1] = s.py;
    d[o + 2] = s.pz;
    d[o + 3] = s.birth;
    d[o + 4] = s.vx;
    d[o + 5] = s.vy;
    d[o + 6] = s.vz;
    d[o + 7] = s.life;
    d[o + 8] = s.size0;
    d[o + 9] = s.size1;
    d[o + 10] = s.drag;
    d[o + 11] = s.buoy;
    d[o + 12] = s.seed;
    d[o + 13] = s.type;
    d[o + 14] = s.auxA;
    d[o + 15] = s.auxB;
    d[o + 16] = s.planeNx;
    d[o + 17] = s.planeNz;
    d[o + 18] = s.planeD;
    d[o + 19] = s.auxC;
    d[o + 20] = s.cvx;
    d[o + 21] = s.cvy;
    d[o + 22] = s.cvz;
    d[o + 23] = s.auxD;
    const end = s.birth + s.life;
    death[slot] = end;
    if (end > clock) {
      this.liveSlots[this.liveCount++] = slot;
    }
    if (this.dirtySpan === 0) {
      this.dirtyStart = slot;
      this.dirtySpan = 1;
    } else {
      this.dirtySpan += steps;
    }
    return slot;
  }

  /** Float offset of a slot's first texel inside `data`. */
  offsetOf(slot: number): number {
    return (slot % PARTICLES_PER_ROW) * FLOATS_PER_PARTICLE + Math.floor(slot / PARTICLES_PER_ROW) * DATA_TEXTURE_WIDTH * 4;
  }

  /** Shifts every birth time by -delta (keeps fp32 ages precise over long sessions). */
  rebase(delta: number): void {
    for (let slot = 0; slot < this.capacity; slot++) {
      const o = this.offsetOf(slot);
      this.data[o + 3] -= delta;
      this.death[slot] -= delta;
    }
    this.clock -= delta;
    this.fullUpload = true;
  }

  /** Queues the texture upload of everything written since the last flush. */
  flush(): void {
    const tex = this.texture;
    if (this.fullUpload || this.dirtySpan >= this.capacity) {
      tex.clearUpdateRanges();
      tex.needsUpdate = true;
      this.fullUpload = false;
      this.dirtySpan = 0;
      return;
    }
    if (this.dirtySpan === 0) {
      return;
    }
    let slot = this.dirtyStart;
    let remaining = this.dirtySpan;
    while (remaining > 0) {
      const col = slot % PARTICLES_PER_ROW;
      const row = Math.floor(slot / PARTICLES_PER_ROW);
      const n = Math.min(remaining, PARTICLES_PER_ROW - col, this.capacity - slot);
      tex.addUpdateRange((row * DATA_TEXTURE_WIDTH + col * TEXELS_PER_PARTICLE) * 4, n * FLOATS_PER_PARTICLE);
      slot = (slot + n) % this.capacity;
      remaining -= n;
    }
    tex.needsUpdate = true;
    this.dirtySpan = 0;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
