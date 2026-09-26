/**
 * Wave particles (phase 21 stage 7a): the interactive part of the sea, CPU side.
 *
 * After Yuksel, House & Keyser (2007), extended with dispersion and a carrier wave. Every particle is a patch of a wave
 * front: it leaves its origin along a fixed direction at the deep-water group speed of its wavelength, carries an
 * amplitude, a dispersion angle (the angle of the front it stands for) and a phase, and describes the height
 *
 *   h(x) = a * Wf(f / l) * Wq(q / s) * cos(k q + phase),
 *
 * with q / f the distance from the particle along / across its direction, s the half-length of its packet along the
 * wave vector, l = dispersion angle x radius the half-width of its piece of the front, and W(u) = (1 + cos(pi u)) / 2 a
 * partition of unity: neighbours along a front (spaced l) and successive emissions of a continuous source (spaced s)
 * sum to the particle amplitude, so the field is continuous and its level is the physical wave amplitude.
 *
 * - Spreading: the amplitude falls as sqrt(r0 / r) (energy a^2 l conserved along a widening front) and decays with a
 *   rate that grows with the wavenumber. It never grows.
 * - Subdivision: when l exceeds max(1.2 wavelengths, 6 m) the particle splits into three with a third of the
 *   dispersion angle and the same amplitude (energy exactly conserved, height field unchanged).
 * - Phase: carrier = k (d.(x - o) - r0) - w t + phase0, so particles emitted from one source at any times stay
 *   coherent. A moving hull emits, per direction class theta (from its heading) and per side, particles with the
 *   wavelength whose phase speed matches the hull's speed along that direction, c(k) = U cos(theta): the pattern is
 *   stationary in the hull's frame and each class runs along its ray at the group speed U cos(theta) / 2. The rays
 *   fill a wedge whose edge (the envelope of all classes, where they pile up: the cusp) lies at asin(1/3) = 19.47 deg
 *   from the track: the Kelvin angle emerges from the dispersion relation, nothing draws it. Fast sources whose
 *   transverse waves would be longer than WAVE_PARTICLES.maxLambda keep only the divergent classes (a narrower wake).
 *
 * Queries (heightAt, normalAt, velocityAt of the water service) go through a spatial hash rebuilt once per update.
 * Allocation-free after construction.
 */
import type { WaterDynamics, WaterDynamicSample } from '../../../core/contracts';
import { GRAVITY } from '../config';
import { HULL_WAVES, RING_WAVES, WAVE_PARTICLES, waveParticleQualityFor, type WaveParticleQuality } from './config';

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;
/** Direction slots per hull: sides x classes x (bow, stern). */
const HULL_SLOTS = 2 * HULL_WAVES.classes * 2;
/* Hot-loop constants (plain locals: bundlers may turn imported objects into getters). */
const BUCKETS = WAVE_PARTICLES.buckets;
const BUCKET_MASK = BUCKETS - 1;
const INV_CELL = 1 / WAVE_PARTICLES.cell;
const FADE_IN = WAVE_PARTICLES.fadeIn;
/** Pool use above which the emission range shrinks, and the smallest share of it that remains. */
const PRESSURE_FROM = 0.8;
const PRESSURE_MIN = 0.25;

interface HullEmitter {
  /** Next emission time per slot (s, particle clock). */
  next: Float64Array;
  seen: number;
}

export interface WaveParticleStats {
  /** Particles emitted / refused (pool full or out of range) / split / killed, since the last reset. */
  emitted: number;
  dropped: number;
  splits: number;
  killed: number;
  /** CPU time of the last update and a smoothed average (ms), grid entries, active hull emitters. */
  updateMs: number;
  avgMs: number;
  gridEntries: number;
  hulls: number;
  /** Queries answered and candidate particles tested since the last reset. */
  queries: number;
  candidates: number;
}

export class WaveParticles implements WaterDynamics {
  exclude = -1;
  /** Bumped by every update (the water service's query cache keys on it). */
  version = 0;
  /** Particle clock (s). */
  now = 0;
  readonly stats: WaveParticleStats = { emitted: 0, dropped: 0, splits: 0, killed: 0, updateMs: 0, avgMs: 0, gridEntries: 0, hulls: 0, queries: 0, candidates: 0 };
  quality: WaveParticleQuality;
  /** Signed coast distance (m, negative over water); particles over land die. Null: open water everywhere. */
  coast: ((x: number, z: number) => number) | null = null;
  /** Emission range reference points: the camera and (if any) the dragon. */
  focusX = 0;
  focusZ = 0;
  dragonX = 0;
  dragonZ = 0;
  hasDragon = false;
  /** Disables the range test (headless checks). */
  unlimitedRange = false;
  /** Multiplier on the amplitude decay rate and the subdivision depth limit (headless checks). */
  dampingScale = 1;
  maxGeneration: number = WAVE_PARTICLES.maxGeneration;

  private n = 0;
  private cap = 0;
  /* Particle state (structure of arrays). */
  private ox!: Float64Array;
  private oz!: Float64Array;
  private dx!: Float64Array;
  private dz!: Float64Array;
  private r0!: Float64Array;
  private cg!: Float64Array;
  private k!: Float64Array;
  private om!: Float64Array;
  private a0!: Float64Array;
  private delta!: Float64Array;
  private s!: Float64Array;
  private age!: Float64Array;
  private phase0!: Float64Array;
  private mu!: Float64Array;
  /** Kelvin particles: the source speed (children take the stationary wavenumber of their direction), else 0. */
  private ku!: Float64Array;
  private hx!: Float64Array;
  private hz!: Float64Array;
  private gen!: Uint8Array;
  private src!: Int32Array;
  /* Derived each update. */
  private px!: Float64Array;
  private pz!: Float64Array;
  private amp!: Float64Array;
  private ell!: Float64Array;
  private rr!: Float64Array;
  private phc!: Float64Array;
  private ex!: Float64Array;
  private ez!: Float64Array;

  /* Spatial hash. */
  private readonly bucketStart = new Int32Array(BUCKETS + 1);
  private entries = new Int32Array(4096);
  private gridValid = false;
  private coastCursor = 0;
  private forgetClock = 0;
  private readonly hulls = new Map<number, HullEmitter>();
  private readonly spare: HullEmitter[] = [];

  constructor(quality: WaveParticleQuality = waveParticleQualityFor('high')) {
    this.quality = quality;
    this.allocate(quality.pool);
  }

  get count(): number {
    return this.n;
  }

  get capacity(): number {
    return this.cap;
  }

  private allocate(cap: number): void {
    const keep = Math.min(this.n, cap);
    const f = (old: Float64Array | undefined): Float64Array => {
      const a = new Float64Array(cap);
      if (old) a.set(old.subarray(0, keep));
      return a;
    };
    this.ox = f(this.ox);
    this.oz = f(this.oz);
    this.dx = f(this.dx);
    this.dz = f(this.dz);
    this.r0 = f(this.r0);
    this.cg = f(this.cg);
    this.k = f(this.k);
    this.om = f(this.om);
    this.a0 = f(this.a0);
    this.delta = f(this.delta);
    this.s = f(this.s);
    this.age = f(this.age);
    this.phase0 = f(this.phase0);
    this.mu = f(this.mu);
    this.ku = f(this.ku);
    this.hx = f(this.hx);
    this.hz = f(this.hz);
    this.px = f(this.px);
    this.pz = f(this.pz);
    this.amp = f(this.amp);
    this.ell = f(this.ell);
    this.rr = f(this.rr);
    this.phc = f(this.phc);
    this.ex = f(this.ex);
    this.ez = f(this.ez);
    const g = new Uint8Array(cap);
    if (this.gen) g.set(this.gen.subarray(0, keep));
    this.gen = g;
    const sr = new Int32Array(cap);
    if (this.src) sr.set(this.src.subarray(0, keep));
    this.src = sr;
    this.cap = cap;
    this.n = keep;
    this.gridValid = false;
  }

  setQuality(q: WaveParticleQuality): void {
    this.quality = q;
    if (q.pool !== this.cap) {
      this.allocate(q.pool);
    }
  }

  /** Removes every particle and emitter. */
  clear(): void {
    this.n = 0;
    this.hulls.clear();
    this.gridValid = false;
    this.version++;
  }

  resetStats(): void {
    const s = this.stats;
    s.emitted = 0;
    s.dropped = 0;
    s.splits = 0;
    s.killed = 0;
    s.queries = 0;
    s.candidates = 0;
  }

  /** Camera (and dragon) position for the emission range and the level of detail. */
  setFocus(camX: number, camZ: number, dragonX?: number, dragonZ?: number): void {
    this.focusX = camX;
    this.focusZ = camZ;
    this.hasDragon = dragonX !== undefined && dragonZ !== undefined && Number.isFinite(dragonX) && Number.isFinite(dragonZ);
    if (this.hasDragon) {
      this.dragonX = dragonX as number;
      this.dragonZ = dragonZ as number;
    }
  }

  /**
   * Emission allowed at (x, z)? Returns the distance used for the level of detail (the camera distance; 0 within the
   * dragon's range), or -1 when out of range.
   */
  private rangeAt(x: number, z: number): number {
    const d = Math.hypot(x - this.focusX, z - this.focusZ);
    if (this.unlimitedRange) return d;
    if (this.hasDragon && Math.hypot(x - this.dragonX, z - this.dragonZ) <= this.quality.dragonRange) return 0;
    // A nearly full pool shrinks the emission range: the farthest sources stop first, the near ones keep theirs.
    const use = this.n / Math.max(this.cap, 1);
    const range = use > PRESSURE_FROM ? this.quality.emitRange * Math.max(PRESSURE_MIN, (1 - use) / (1 - PRESSURE_FROM)) : this.quality.emitRange;
    return d <= range ? d : -1;
  }

  /** Adds one particle; returns its index or -1 (pool full). */
  private spawn(ox: number, oz: number, dx: number, dz: number, r0: number, k: number, a0: number, delta: number, s: number, phase0: number, src: number, ku: number, hx: number, hz: number, gen: number, age: number): number {
    if (this.n >= this.cap) {
      this.stats.dropped++;
      return -1;
    }
    const i = this.n++;
    this.ox[i] = ox;
    this.oz[i] = oz;
    this.dx[i] = dx;
    this.dz[i] = dz;
    this.r0[i] = r0;
    this.k[i] = k;
    const om = Math.sqrt(GRAVITY * k);
    this.om[i] = om;
    this.cg[i] = (0.5 * om) / k;
    this.a0[i] = a0;
    this.delta[i] = delta;
    this.s[i] = s;
    this.age[i] = age;
    this.phase0[i] = phase0;
    this.mu[i] = (WAVE_PARTICLES.damping + WAVE_PARTICLES.dampingPerK * k) * this.dampingScale;
    this.ku[i] = ku;
    this.hx[i] = hx;
    this.hz[i] = hz;
    this.gen[i] = gen;
    this.src[i] = src;
    this.derive(i);
    this.stats.emitted++;
    return i;
  }

  private remove(i: number): void {
    const last = --this.n;
    this.stats.killed++;
    if (i === last) return;
    this.ox[i] = this.ox[last];
    this.oz[i] = this.oz[last];
    this.dx[i] = this.dx[last];
    this.dz[i] = this.dz[last];
    this.r0[i] = this.r0[last];
    this.cg[i] = this.cg[last];
    this.k[i] = this.k[last];
    this.om[i] = this.om[last];
    this.a0[i] = this.a0[last];
    this.delta[i] = this.delta[last];
    this.s[i] = this.s[last];
    this.age[i] = this.age[last];
    this.phase0[i] = this.phase0[last];
    this.mu[i] = this.mu[last];
    this.ku[i] = this.ku[last];
    this.hx[i] = this.hx[last];
    this.hz[i] = this.hz[last];
    this.gen[i] = this.gen[last];
    this.src[i] = this.src[last];
  }

  /** Position, amplitude, front half-width, centre phase and bounding box of particle i at its age. */
  private derive(i: number): void {
    const age = this.age[i];
    const r0 = this.r0[i];
    const r = r0 + this.cg[i] * age;
    this.rr[i] = r;
    const dx = this.dx[i];
    const dz = this.dz[i];
    this.px[i] = this.ox[i] + dx * r;
    this.pz[i] = this.oz[i] + dz * r;
    const fade = age < FADE_IN ? age / FADE_IN : 1;
    this.amp[i] = this.a0[i] * Math.sqrt(r0 / r) * Math.exp(-this.mu[i] * age) * fade;
    const ell = Math.max(this.delta[i] * r, 0.25);
    this.ell[i] = ell;
    const ph = this.k[i] * (r - r0) - this.om[i] * age + this.phase0[i];
    this.phc[i] = ph - Math.floor(ph / TWO_PI) * TWO_PI;
    const s = this.s[i];
    const adx = Math.abs(dx);
    const adz = Math.abs(dz);
    this.ex[i] = adx * s + adz * ell;
    this.ez[i] = adz * s + adx * ell;
  }

  /**
   * Splits particle i into three (itself with a third of the dispersion angle, plus its two outer neighbours) when
   * the pool has room. Kelvin particles take the stationary wavenumber of their new direction (a child whose wave
   * would be shorter than minLambda is dropped).
   */
  private split(i: number): boolean {
    if (this.n + 2 > this.cap) return false;
    const third = this.delta[i] / 3;
    const g = this.gen[i] + 1;
    this.delta[i] = third;
    this.gen[i] = g;
    // The parent's front [-delta/2, delta/2] becomes three thirds centred at -delta/3, 0, +delta/3.
    const c = Math.cos(third);
    const sn = Math.sin(third);
    for (let side = -1; side <= 1; side += 2) {
      const dx = this.dx[i] * c - this.dz[i] * sn * side;
      const dz = this.dx[i] * sn * side + this.dz[i] * c;
      let k = this.k[i];
      let s = this.s[i];
      const U = this.ku[i];
      if (U > 0) {
        const cos = dx * this.hx[i] + dz * this.hz[i];
        const lambda = (TWO_PI * U * U * cos * cos) / GRAVITY;
        if (!(cos > 0) || lambda < WAVE_PARTICLES.minLambda) continue;
        k = TWO_PI / lambda;
        // Packet half-length follows the wavelength (emission spacing: group speed x period = lambda / 2 per period).
        s = this.s[i] * (lambda / (TWO_PI / this.k[i]));
      }
      // Same virtual origin: the child stands for the neighbouring third of the parent's front.
      const j = this.spawn(this.ox[i], this.oz[i], dx, dz, this.r0[i], k, this.a0[i], third, s, this.phase0[i], this.src[i], U, this.hx[i], this.hz[i], g, this.age[i]);
      if (j >= 0) this.stats.emitted--;
    }
    this.stats.splits++;
    return true;
  }

  /** Advances every particle by dt, kills, splits, and rebuilds the query grid. */
  update(dt: number): void {
    const t0 = performance.now();
    const P = WAVE_PARTICLES;
    const maxLife = P.maxLife;
    const minAmp = P.minAmplitude;
    const fadeIn = P.fadeIn;
    const splitLambdas = P.splitLambdas;
    const splitMin = P.splitMin;
    const maxGen = this.maxGeneration;
    const splitAmp = P.splitAmplitude;
    const coastKill = P.coastKill;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    this.now += step;
    const keepRange2 = (this.quality.emitRange * P.keepRangeShare) ** 2;
    const dragonKeep2 = (this.quality.dragonRange * P.keepRangeShare) ** 2;
    const coast = this.coast;
    const coastEvery = 6;
    this.coastCursor = (this.coastCursor + 1) % coastEvery;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += step;
    }
    // (Children of a split are appended with their parent's age and processed later in this same pass.)
    for (let i = 0; i < this.n; ) {
      this.derive(i);
      const age = this.age[i];
      let dead = age > maxLife || (age > fadeIn && this.amp[i] < minAmp) || !Number.isFinite(this.amp[i] + this.px[i] + this.pz[i]);
      if (!dead && !this.unlimitedRange) {
        const fx = this.px[i] - this.focusX;
        const fz = this.pz[i] - this.focusZ;
        if (fx * fx + fz * fz > keepRange2) {
          const gx = this.px[i] - this.dragonX;
          const gz = this.pz[i] - this.dragonZ;
          dead = !(this.hasDragon && gx * gx + gz * gz < dragonKeep2);
        }
      }
      if (!dead && coast && i % coastEvery === this.coastCursor) {
        dead = coast(this.px[i], this.pz[i]) > coastKill;
      }
      if (dead) {
        this.remove(i);
        continue;
      }
      const lambda = TWO_PI / this.k[i];
      if (this.ell[i] > Math.max(splitLambdas * lambda, splitMin) && this.gen[i] < maxGen && this.amp[i] > splitAmp) {
        if (this.split(i)) {
          this.derive(i);
        }
      }
      i++;
    }
    this.forgetClock += step;
    if (this.forgetClock > 1) {
      this.forgetClock = 0;
      for (const [id, h] of this.hulls) {
        if (this.now - h.seen > HULL_WAVES.forget) {
          this.hulls.delete(id);
          this.spare.push(h);
        }
      }
    }
    this.buildGrid();
    this.version++;
    const ms = performance.now() - t0;
    this.stats.updateMs = ms;
    this.stats.avgMs = this.stats.avgMs === 0 ? ms : this.stats.avgMs + (ms - this.stats.avgMs) * 0.05;
    this.stats.hulls = this.hulls.size;
  }

  private static hash(cx: number, cz: number): number {
    return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & BUCKET_MASK;
  }

  private buildGrid(): void {
    const inv = INV_CELL;
    const start = this.bucketStart;
    start.fill(0);
    // Two cells of one particle can hash to the same bucket: `mark` keeps it from being listed there twice.
    const mark = this.bucketMark;
    mark.fill(-1);
    let total = 0;
    for (let i = 0; i < this.n; i++) {
      const x0 = Math.floor((this.px[i] - this.ex[i]) * inv);
      const x1 = Math.floor((this.px[i] + this.ex[i]) * inv);
      const z0 = Math.floor((this.pz[i] - this.ez[i]) * inv);
      const z1 = Math.floor((this.pz[i] + this.ez[i]) * inv);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const b = WaveParticles.hash(cx, cz);
          if (mark[b] === i) continue;
          mark[b] = i;
          start[b + 1]++;
          total++;
        }
      }
    }
    for (let b = 0; b < BUCKETS; b++) {
      start[b + 1] += start[b];
    }
    if (this.entries.length < total) {
      this.entries = new Int32Array(Math.ceil(total * 1.5));
    }
    const fill = this.fillCursor;
    fill.set(start.subarray(0, BUCKETS));
    const entries = this.entries;
    mark.fill(-1);
    for (let i = 0; i < this.n; i++) {
      const x0 = Math.floor((this.px[i] - this.ex[i]) * inv);
      const x1 = Math.floor((this.px[i] + this.ex[i]) * inv);
      const z0 = Math.floor((this.pz[i] - this.ez[i]) * inv);
      const z1 = Math.floor((this.pz[i] + this.ez[i]) * inv);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const b = WaveParticles.hash(cx, cz);
          if (mark[b] === i) continue;
          mark[b] = i;
          entries[fill[b]++] = i;
        }
      }
    }
    this.stats.gridEntries = total;
    this.gridValid = true;
  }

  private readonly fillCursor = new Int32Array(BUCKETS);
  private readonly bucketMark = new Int32Array(BUCKETS);

  /** The particle field at (x, z), skipping `exclude`'s particles. */
  sample(x: number, z: number, out: WaterDynamicSample): WaterDynamicSample {
    out.height = 0;
    out.slopeX = 0;
    out.slopeZ = 0;
    out.vx = 0;
    out.vy = 0;
    out.vz = 0;
    if (this.n === 0 || !this.gridValid) {
      return out;
    }
    const inv = INV_CELL;
    const b = WaveParticles.hash(Math.floor(x * inv), Math.floor(z * inv));
    const e0 = this.bucketStart[b];
    const e1 = this.bucketStart[b + 1];
    const exclude = this.exclude;
    let h = 0;
    let sx = 0;
    let sz = 0;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    let tested = 0;
    for (let e = e0; e < e1; e++) {
      const i = this.entries[e];
      if (i >= this.n) continue;
      const rx = x - this.px[i];
      if (rx > this.ex[i] || rx < -this.ex[i]) continue;
      const rz = z - this.pz[i];
      if (rz > this.ez[i] || rz < -this.ez[i]) continue;
      if (this.src[i] === exclude) continue;
      tested++;
      const dx = this.dx[i];
      const dz = this.dz[i];
      const s = this.s[i];
      const q = rx * dx + rz * dz;
      if (q >= s || q <= -s) continue;
      const ell = this.ell[i];
      const f = rz * dx - rx * dz;
      if (f >= ell || f <= -ell) continue;
      const uq = (Math.PI * q) / s;
      const uf = (Math.PI * f) / ell;
      const cq = Math.cos(uq);
      const cf = Math.cos(uf);
      const wq = 0.5 + 0.5 * cq;
      const wf = 0.5 + 0.5 * cf;
      const dwq = (-0.5 * Math.PI * Math.sin(uq)) / s;
      const dwf = (-0.5 * Math.PI * Math.sin(uf)) / ell;
      const k = this.k[i];
      const ph = k * q + this.phc[i];
      const c = Math.cos(ph);
      const sn = Math.sin(ph);
      const A = this.amp[i];
      const w = wq * wf;
      h += A * w * c;
      const gq = A * wf * (dwq * c - wq * k * sn);
      const gf = A * wq * dwf * c;
      sx += gq * dx - gf * dz;
      sz += gq * dz + gf * dx;
      const om = this.om[i] * A * w;
      // d/dt of the height: the carrier (-w), the envelope riding along at the group speed, the amplitude's decay.
      const cg = this.cg[i];
      vy += om * sn - cg * A * wf * dwq * c - (cg / (2 * this.rr[i]) + this.mu[i]) * A * w * c;
      vx += om * c * dx;
      vz += om * c * dz;
    }
    this.stats.queries++;
    this.stats.candidates += tested;
    out.height = h;
    out.slopeX = sx;
    out.slopeZ = sz;
    out.vx = vx;
    out.vy = vy;
    out.vz = vz;
    return out;
  }

  /** A circular wave train at (x, z): see RING_WAVES. */
  ring(source: number, x: number, z: number, amplitude: number, wavelength: number): void {
    const P = WAVE_PARTICLES;
    const R = RING_WAVES;
    if (!(amplitude > P.minAmplitude) || !Number.isFinite(x + z + wavelength)) {
      return;
    }
    if (this.rangeAt(x, z) < 0) {
      this.stats.dropped++;
      return;
    }
    const dirs = R.directions;
    const delta = TWO_PI / dirs;
    // A deterministic twist per ring so neighbouring rings do not line up their particles.
    const twist = (((x * 0.7549 + z * 0.5698) % 1) + 1) % 1 * delta;
    for (let t = 0; t < R.lambdas.length; t++) {
      const lambda = Math.min(P.maxLambda, Math.max(P.minLambda, wavelength * R.lambdas[t]));
      const a = amplitude * R.shares[t];
      if (a <= P.minAmplitude) continue;
      const k = TWO_PI / lambda;
      const r0 = Math.max(R.radiusMin, R.radiusLambda * lambda);
      const s = R.packet * lambda;
      for (let m = 0; m < dirs; m++) {
        const ang = m * delta + twist;
        this.spawn(x, z, Math.cos(ang), Math.sin(ang), r0, k, a, delta, s, 0, source, 0, 0, 0, 0, 0);
      }
    }
  }

  /** A moving hull (every frame): bow and stern waves per direction class, see the file comment and HULL_WAVES. */
  hull(source: number, x: number, z: number, headingX: number, headingZ: number, speed: number, length: number, beam: number, draft: number): void {
    const H = HULL_WAVES;
    const P = WAVE_PARTICLES;
    if (!(speed > H.minSpeed) || !Number.isFinite(x + z + headingX + headingZ + length + beam + draft)) return;
    const hl = Math.hypot(headingX, headingZ);
    if (!(hl > 1e-6)) return;
    const range = this.rangeAt(x, z);
    if (range < 0) {
      return;
    }
    const hx = headingX / hl;
    const hz = headingZ / hl;
    const lambda0 = (TWO_PI * speed * speed) / GRAVITY;
    const lambdaMin = Math.max(P.minLambda, H.beamShare * beam);
    if (lambda0 < lambdaMin * 1.2) return;
    let em = this.hulls.get(source);
    if (!em) {
      em = this.spare.pop() ?? { next: new Float64Array(HULL_SLOTS), seen: 0 };
      em.next.fill(this.now);
      this.hulls.set(source, em);
    }
    em.seen = this.now;
    const far = !this.unlimitedRange && range > H.farRange;
    const classes = far ? H.classesFar : H.classes;
    const cosMax = Math.sqrt(Math.min(1, P.maxLambda / lambda0));
    const thetaMin = Math.acos(cosMax);
    const thetaMax = Math.acos(Math.sqrt(lambdaMin / lambda0));
    const dTheta = (thetaMax - thetaMin) / classes;
    if (!(dTheta > 0.5 * DEG)) return;
    const L = Math.max(length, 1);
    const fr = speed / Math.sqrt(GRAVITY * L);
    const aChar = Math.min(H.maxAmplitude, (H.ampScale * Math.sqrt(Math.max(beam, 0.1) * Math.max(draft, 0.05)) * fr * fr) / (1 + (fr / H.frKnee) ** 3));
    const transverse = Math.min(1, Math.max(0.1, H.transverseBase - H.transverseFr * fr));
    const px = -hz;
    const pz = hx;
    for (let end = 0; end < (far ? 1 : 2); end++) {
      const along = end === 0 ? 0.45 * L : -0.45 * L;
      const share = end === 0 ? 1 : H.sternShare;
      for (let side = -1; side <= 1; side += 2) {
        const sideIndex = side < 0 ? 0 : 1;
        for (let j = 0; j < classes; j++) {
          const slot = (end * 2 + sideIndex) * H.classes + j;
          if (this.now < em.next[slot]) continue;
          const theta = thetaMin + (j + 0.5) * dTheta;
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          const lambda = lambda0 * cos * cos;
          const k = TWO_PI / lambda;
          const period = (TWO_PI * speed * cos) / GRAVITY;
          const interval = period * H.emitPeriods;
          // Emit at the due instant, not at this frame: the particle is born `late` seconds ago where the hull was
          // then, so the wake does not depend on the frame rate. A long gap (a new or returning hull) restarts.
          let late = this.now - em.next[slot];
          if (!(late < interval)) late = 0;
          em.next[slot] = this.now - late + interval;
          const a = aChar * share * (theta < 25 * DEG ? transverse : 1);
          if (a <= P.minAmplitude) continue;
          const dx = hx * cos + px * sin * side;
          const dz = hz * cos + pz * sin * side;
          const ell0 = Math.max(H.beamWidth * beam, H.lambdaWidth * lambda);
          const r0 = ell0 / dTheta;
          // Group speed x emission interval: successive particles of the class tile along the wave vector.
          const s = 0.5 * speed * cos * period * H.emitPeriods;
          const back = along - speed * late;
          const sx = x + hx * back + px * side * 0.5 * beam;
          const sz = z + hz * back + pz * side * 0.5 * beam;
          this.spawn(sx - dx * r0, sz - dz * r0, dx, dz, r0, k, a, dTheta, s, end === 0 ? 0 : Math.PI, source, speed, hx, hz, 0, late);
        }
      }
    }
  }

  /** Total wave energy measure sum(a^2 l s) of the live particles (diagnostics and the energy check). */
  energy(source?: number): number {
    let e = 0;
    for (let i = 0; i < this.n; i++) {
      if (source !== undefined && this.src[i] !== source) continue;
      e += this.amp[i] * this.amp[i] * this.ell[i] * this.s[i];
    }
    return e;
  }

  /** Largest live amplitude (m). */
  maxAmplitude(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, this.amp[i]);
    return m;
  }

  /**
   * Copies the splat data of the particles whose kernel touches the square [minX, minX + extent]^2 into `out`
   * (12 floats per particle: centre relative to the window corner, direction, front half-width, packet half-length,
   * wavenumber, centre phase, amplitude, 3 spare) and returns how many were written (at most `max`).
   */
  writeSplat(minX: number, minZ: number, extent: number, out: Float32Array, max: number, minLambda: number): number {
    let m = 0;
    for (let i = 0; i < this.n && m < max; i++) {
      const px = this.px[i] - minX;
      const pz = this.pz[i] - minZ;
      if (px + this.ex[i] < 0 || pz + this.ez[i] < 0 || px - this.ex[i] > extent || pz - this.ez[i] > extent) continue;
      const lambda = TWO_PI / this.k[i];
      if (lambda < minLambda * 0.5) continue;
      const o = m * 12;
      out[o] = px;
      out[o + 1] = pz;
      out[o + 2] = this.dx[i];
      out[o + 3] = this.dz[i];
      out[o + 4] = this.ell[i];
      out[o + 5] = this.s[i];
      out[o + 6] = this.k[i];
      out[o + 7] = this.phc[i];
      out[o + 8] = this.amp[i];
      out[o + 9] = 0;
      out[o + 10] = 0;
      out[o + 11] = 0;
      m++;
    }
    return m;
  }
}
