/**
 * The "gull and simit on a ferry" flock (phase 19, backlog 4), pure simulation: no three.js, no DOM, no clock. The actor
 * (./actor.ts) renders it and plays its sounds; tools/headless/moments-gulls-check.ts flies it against scripted and real
 * ferries.
 *
 * Gulls hang almost still in the slipstream behind the ferry's stern (each on its own slot in the ship's frame, with a
 * slow personal drift and small wing adjustments); now and then someone at the stern rail tosses a piece of simit in
 * an arc; one to three gulls peel off to snatch it in the air, and a piece nobody caught is picked from the water. The
 * dragon scatters them (they keep their distance and regroup further away). Gulls never overlap each other and never
 * enter the ship's box (hard constraints after the steering), and the whole thing runs on fixed-size typed arrays.
 *
 * Frames: the ship's model space has -Z at the bow, +Z at the stern; `yaw` is Object3D.rotation.y. World x east, z south.
 */

/** A ferry's pose (a VesselPose subset). `speed` < 0 while going astern: the trailing end is then the bow. */
export interface FerryFrame {
  x: number;
  z: number;
  yaw: number;
  heave: number;
  speed: number;
  length: number;
  beam: number;
  draft: number;
  airDraft: number;
}

/** Where the passengers stand: rail height above the waterline and how far inside the trailing end (m). */
export interface DeckProfile {
  railY: number;
  railInset: number;
}

/** Open aft upper decks of the ferry designs (src/world/life/vessels/models/ferries.ts). */
export const DECKS: Readonly<Record<string, DeckProfile>> = {
  vapur: { railY: 5.9, railInset: 3 },
  ferry: { railY: 5.6, railInset: 2 },
};
export const DEFAULT_DECK: DeckProfile = { railY: 5, railInset: 2 };

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export const GULL_TUNING = {
  /** Most gulls a flock can hold. */
  capacity: 40,
  /** Simit pieces in flight, floating or carried at once. */
  pieces: 16,
  /** Integration sub-step (s); frames are split into equal steps no longer than this. */
  maxStep: 1 / 60,
  /** Minimum distance between two gull centres (m; wingspan 1.35 m). */
  minSeparation: 1.6,
  /** Soft separation range (m). */
  separationRange: 4,
  /** Clearance kept from the ship's box (m). */
  hullMargin: 0.8,
  /** Slot region behind the trailing end: aft distance, height above the rail (m). */
  slotAft: [2.5, 21] as const,
  slotHeight: [-1.5, 9] as const,
  /** Minimum spacing between slots (m). */
  slotSpacing: 3.6,
  /** The dragon: gulls flee inside this radius, regroup once it is this much further away (m). */
  fleeRadius: 42,
  fleeHysteresis: 15,
  /** Slots are pushed to at least this distance from the dragon (m). */
  keepFromDragon: 50,
  /** Seconds between tosses (uniform range) and the first toss after the start. */
  tossInterval: [2.6, 5.5] as const,
  firstToss: 1.2,
  /** Seconds between calls (mean of an exponential). */
  callInterval: 3.4,
  /** Horizontal speed limits relative to the ground (m/s). */
  maxSpeed: 21,
  /** Linear air drag on simit pieces (1/s). */
  pieceDrag: 0.25,
  /** Seconds a piece floats before it sinks, and a carried piece before it is swallowed. */
  floatTime: 14,
  carryTime: 1.1,
};

export const enum GullState {
  Hover = 0,
  Chase = 1,
  Water = 2,
  Pick = 3,
  Peel = 4,
  Flee = 5,
  Leave = 6,
  Gone = 7,
}

export const enum PieceState {
  Free = 0,
  Air = 1,
  Water = 2,
  Carried = 3,
}

export interface FlockEvent {
  kind: 'call' | 'catch' | 'toss';
  /** Gull index (call, catch) or piece index (toss). */
  index: number;
}

export interface FlockStats {
  tosses: number;
  catchesAir: number;
  catchesWater: number;
  sunk: number;
  landedOnDeck: number;
  flees: number;
}

const G = 9.81;

/** Small deterministic RNG (mulberry32). */
function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampLen3(o: { x: number; y: number; z: number }, max: number): void {
  const l = Math.hypot(o.x, o.y, o.z);
  if (l > max) {
    const k = max / l;
    o.x *= k;
    o.y *= k;
    o.z *= k;
  }
}

export class GullFlock {
  readonly capacity = GULL_TUNING.capacity;
  /** Gulls in use (indices 0..count-1; some may be Gone). */
  count = 0;
  readonly px = new Float32Array(GULL_TUNING.capacity);
  readonly py = new Float32Array(GULL_TUNING.capacity);
  readonly pz = new Float32Array(GULL_TUNING.capacity);
  readonly vx = new Float32Array(GULL_TUNING.capacity);
  readonly vy = new Float32Array(GULL_TUNING.capacity);
  readonly vz = new Float32Array(GULL_TUNING.capacity);
  readonly state = new Uint8Array(GULL_TUNING.capacity);
  /** Wing flap amplitude 0..1 (0 = gliding "M"), phase offset and frequency (Hz), for the bird shader. */
  readonly flapAmp = new Float32Array(GULL_TUNING.capacity);
  readonly flapPhase = new Float32Array(GULL_TUNING.capacity);
  readonly flapFreq = new Float32Array(GULL_TUNING.capacity);
  /** Render attitude: heading yaw (Object3D convention), pitch and bank (rad). */
  readonly yaw = new Float32Array(GULL_TUNING.capacity);
  readonly pitch = new Float32Array(GULL_TUNING.capacity);
  readonly bank = new Float32Array(GULL_TUNING.capacity);

  // Slot in the ship frame (lateral, aft of the trailing end, height above the rail) and personal drift.
  private readonly slotU = new Float32Array(GULL_TUNING.capacity);
  private readonly slotA = new Float32Array(GULL_TUNING.capacity);
  private readonly slotH = new Float32Array(GULL_TUNING.capacity);
  private readonly drift = new Float32Array(GULL_TUNING.capacity * 3);
  private readonly timer = new Float32Array(GULL_TUNING.capacity);
  private readonly adjust = new Float32Array(GULL_TUNING.capacity);
  private readonly target = new Int16Array(GULL_TUNING.capacity);
  private readonly peel = new Float32Array(GULL_TUNING.capacity * 3);
  private readonly calm = new Float32Array(GULL_TUNING.capacity);
  private readonly ax = new Float32Array(GULL_TUNING.capacity);
  private readonly az = new Float32Array(GULL_TUNING.capacity);
  private readonly sepX = new Float32Array(GULL_TUNING.capacity);
  private readonly sepY = new Float32Array(GULL_TUNING.capacity);
  private readonly sepZ = new Float32Array(GULL_TUNING.capacity);

  // Simit pieces.
  readonly qx = new Float32Array(GULL_TUNING.pieces);
  readonly qy = new Float32Array(GULL_TUNING.pieces);
  readonly qz = new Float32Array(GULL_TUNING.pieces);
  readonly qvx = new Float32Array(GULL_TUNING.pieces);
  readonly qvy = new Float32Array(GULL_TUNING.pieces);
  readonly qvz = new Float32Array(GULL_TUNING.pieces);
  readonly qState = new Uint8Array(GULL_TUNING.pieces);
  /** Tumble angle (rad) of each piece, for rendering. */
  readonly qSpin = new Float32Array(GULL_TUNING.pieces);
  private readonly qAge = new Float32Array(GULL_TUNING.pieces);
  private readonly qOwner = new Int16Array(GULL_TUNING.pieces);

  readonly stats: FlockStats = { tosses: 0, catchesAir: 0, catchesWater: 0, sunk: 0, landedOnDeck: 0, flees: 0 };
  /** Events since the last `drainEvents` (sounds). */
  readonly events: FlockEvent[] = [];

  private readonly rnd: () => number;
  private time = 0;
  private tossTimer: number = GULL_TUNING.firstToss;
  private callTimer = 1.5;
  private releasedAt = -1;
  private core = 0;
  private deck: DeckProfile = DEFAULT_DECK;
  private readonly tmp = { x: 0, y: 0, z: 0 };
  private readonly cam: Point3 = { x: 0, y: 0, z: 0 };

  constructor(seed = 1) {
    this.rnd = rng32(seed);
    this.target.fill(-1);
    this.qOwner.fill(-1);
  }

  /** Seconds since the start. */
  get elapsed(): number {
    return this.time;
  }

  get released(): boolean {
    return this.releasedAt >= 0;
  }

  /** True once released and every gull that was not kept for the hand-back has flown off. */
  get done(): boolean {
    if (!this.released) return false;
    for (let i = this.core; i < this.count; i++) {
      if (this.state[i] !== GullState.Gone) return false;
    }
    return true;
  }

  /**
   * Starts the scene: `handed` bird states (x, y, z, vx, vy, vz each; the ferry's ambient gulls) continue as they were,
   * the rest of `count` gulls fly in from 90+ m away from the camera. `kind` picks the deck profile.
   */
  start(ferry: FerryFrame, kind: string, count: number, handed: Float32Array | null, handedCount: number, camera: Point3): void {
    const n = Math.max(0, Math.min(this.capacity, Math.round(count)));
    this.deck = DECKS[kind] ?? DEFAULT_DECK;
    this.count = n;
    this.core = Math.min(n, handedCount > 0 ? handedCount : 12);
    this.cam.x = camera.x;
    this.cam.y = camera.y;
    this.cam.z = camera.z;
    this.assignSlots(ferry);
    const { fx, fz, rx, rz, st } = this.axes(ferry);
    for (let i = 0; i < n; i++) {
      this.state[i] = GullState.Hover;
      this.target[i] = -1;
      this.flapPhase[i] = this.rnd() * Math.PI * 2;
      this.flapFreq[i] = 2.5 + this.rnd() * 0.5;
      this.flapAmp[i] = 0.3;
      this.adjust[i] = this.rnd() * 3;
      this.calm[i] = 0;
      this.drift[i * 3] = this.rnd() * 100;
      this.drift[i * 3 + 1] = 0.6 + this.rnd() * 0.8;
      this.drift[i * 3 + 2] = 0.5 + this.rnd() * 0.7;
      if (i < handedCount && handed) {
        this.px[i] = handed[i * 6];
        this.py[i] = handed[i * 6 + 1];
        this.pz[i] = handed[i * 6 + 2];
        this.vx[i] = handed[i * 6 + 3];
        this.vy[i] = handed[i * 6 + 4];
        this.vz[i] = handed[i * 6 + 5];
      } else {
        // Joiners arrive from the aft sector, out of the close view.
        let x = 0;
        let z = 0;
        for (let k = 0; k < 24; k++) {
          const a = (this.rnd() - 0.5) * 2.4;
          const d = 70 + this.rnd() * 80;
          const bx = -fx * st;
          const bz = -fz * st;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          x = ferry.x + bx * (ferry.length / 2) + (bx * ca + rx * sa) * d;
          z = ferry.z + bz * (ferry.length / 2) + (bz * ca + rz * sa) * d;
          if (Math.hypot(x - camera.x, z - camera.z) > 90) break;
        }
        this.px[i] = x;
        this.pz[i] = z;
        this.py[i] = 14 + this.rnd() * 22;
        this.vx[i] = fx * ferry.speed;
        this.vy[i] = 0;
        this.vz[i] = fz * ferry.speed;
      }
      this.yaw[i] = Math.atan2(-this.vx[i], -this.vz[i]) || ferry.yaw;
    }
    this.separateHard();
    this.constrainHull(ferry, 0);
  }

  /**
   * The moment is over: no more tosses; the gulls beyond the hand-back core peel off and fly away. The core keeps
   * hovering until `takeCore` hands it back.
   */
  release(camera: Point3): void {
    if (this.released) return;
    this.releasedAt = this.time;
    this.cam.x = camera.x;
    this.cam.y = camera.y;
    this.cam.z = camera.z;
    for (let i = this.core; i < this.count; i++) {
      if (this.state[i] !== GullState.Gone) {
        this.state[i] = GullState.Leave;
        this.timer[i] = 0;
      }
    }
  }

  /** Writes the core gulls' states (x, y, z, vx, vy, vz each) into `out`; returns how many. */
  takeCore(out: Float32Array): number {
    let n = 0;
    for (let i = 0; i < this.core && (n + 1) * 6 <= out.length; i++) {
      if (this.state[i] === GullState.Gone) continue;
      out[n * 6] = this.px[i];
      out[n * 6 + 1] = this.py[i];
      out[n * 6 + 2] = this.pz[i];
      out[n * 6 + 3] = this.vx[i];
      out[n * 6 + 4] = this.vy[i];
      out[n * 6 + 5] = this.vz[i];
      n++;
    }
    return n;
  }

  /** Visible gulls (not Gone). */
  get visible(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.state[i] !== GullState.Gone) n++;
    return n;
  }

  /**
   * Advances the flock by `dt` seconds (split into sub-steps). `dragon`: its position or null; `surface`: sea height
   * at (x, z) (flat 0 when omitted); `camera`: the listener, for gulls leaving the scene.
   */
  update(dt: number, ferry: FerryFrame, dragon: Point3 | null, camera: Point3 | null = null, surface?: (x: number, z: number) => number): void {
    if (!(dt > 0) || this.count === 0) return;
    if (camera) {
      this.cam.x = camera.x;
      this.cam.y = camera.y;
      this.cam.z = camera.z;
    }
    const steps = Math.min(12, Math.max(1, Math.ceil(dt / GULL_TUNING.maxStep - 1e-9)));
    const h = Math.min(dt, 0.2) / steps;
    for (let s = 0; s < steps; s++) {
      this.step(h, ferry, dragon, surface);
    }
  }

  /* ---------------------------------------------------------------- */

  private axes(f: FerryFrame): { fx: number; fz: number; rx: number; rz: number; st: number; c: number; s: number } {
    const s = Math.sin(f.yaw);
    const c = Math.cos(f.yaw);
    return { fx: -s, fz: -c, rx: c, rz: -s, st: f.speed >= 0 ? 1 : -1, c, s };
  }

  /** Slots: rejection-sampled in the ship frame so no two are closer than slotSpacing. */
  private assignSlots(f: FerryFrame): void {
    const T = GULL_TUNING;
    for (let i = 0; i < this.count; i++) {
      let u = 0;
      let a = 0;
      let hh = 0;
      for (let k = 0; k < 60; k++) {
        a = T.slotAft[0] + Math.pow(this.rnd(), 1.5) * (T.slotAft[1] - T.slotAft[0]);
        const spread = f.beam / 2 + 2 + a * 0.45;
        u = (this.rnd() * 2 - 1) * spread;
        hh = T.slotHeight[0] + this.rnd() * (T.slotHeight[1] - T.slotHeight[0]) + a * 0.12;
        let ok = true;
        for (let j = 0; j < i && ok; j++) {
          if (Math.hypot(u - this.slotU[j], a - this.slotA[j], hh - this.slotH[j]) < T.slotSpacing) ok = false;
        }
        if (ok) break;
      }
      this.slotU[i] = u;
      this.slotA[i] = a;
      this.slotH[i] = hh;
    }
  }

  /** World position of a point in the ship frame relative to the trailing end: lateral u, aft a, height h. */
  private shipPoint(f: FerryFrame, u: number, a: number, h: number, out: Point3): Point3 {
    const { st, c, s } = this.axes(f);
    const mx = u;
    const mz = st * (f.length / 2 + a);
    out.x = f.x + mx * c + mz * s;
    out.z = f.z - mx * s + mz * c;
    out.y = f.heave + this.deck.railY + h;
    return out;
  }

  /** Signed distance (m) from a point to the ship's box inflated by the hull margin, and the outward normal. */
  private hullDistance(f: FerryFrame, x: number, y: number, z: number, n: Point3): number {
    const c = Math.cos(f.yaw);
    const s = Math.sin(f.yaw);
    const dx = x - f.x;
    const dz = z - f.z;
    // Inverse of the model → world rotation.
    const mx = dx * c - dz * s;
    const mz = dx * s + dz * c;
    const m = GULL_TUNING.hullMargin;
    const hx = f.beam / 2 + m;
    const hz = f.length / 2 + m;
    const top = f.heave + f.airDraft + m;
    const qx = Math.abs(mx) - hx;
    const qz = Math.abs(mz) - hz;
    const qy = y - top;
    if (qx < 0 && qz < 0 && qy < 0) {
      // Inside: nearest of the side, end and top faces.
      let nx = 0;
      let nz = 0;
      let ny = 0;
      let d = qx;
      nx = Math.sign(mx) || 1;
      if (qz > d) {
        d = qz;
        nx = 0;
        nz = Math.sign(mz) || 1;
      }
      if (qy > d) {
        d = qy;
        nx = 0;
        nz = 0;
        ny = 1;
      }
      n.x = nx * c + nz * s;
      n.z = -nx * s + nz * c;
      n.y = ny;
      return d;
    }
    const ox = Math.max(qx, 0);
    const oz = Math.max(qz, 0);
    const oy = Math.max(qy, 0);
    const d = Math.hypot(ox, oy, oz) || 1e-6;
    const lx = (ox * (Math.sign(mx) || 1)) / d;
    const lz = (oz * (Math.sign(mz) || 1)) / d;
    n.x = lx * c + lz * s;
    n.z = -lx * s + lz * c;
    n.y = oy / d;
    return d;
  }

  private step(h: number, f: FerryFrame, dragon: Point3 | null, surface?: (x: number, z: number) => number): void {
    const T = GULL_TUNING;
    this.time += h;
    const { fx, fz } = this.axes(f);
    const shipVx = fx * f.speed;
    const shipVz = fz * f.speed;
    const tmp = this.tmp;
    const nrm: Point3 = { x: 0, y: 0, z: 0 };

    this.stepPieces(h, f, surface);
    if (!this.released && Math.abs(f.speed) > 1.5) {
      this.tossTimer -= h;
      if (this.tossTimer <= 0) {
        this.tossTimer = T.tossInterval[0] + this.rnd() * (T.tossInterval[1] - T.tossInterval[0]);
        this.toss(f);
        if (this.rnd() < 0.3) this.toss(f);
      }
    }
    this.callTimer -= h;
    if (this.callTimer <= 0) {
      this.callTimer = -Math.log(1 - this.rnd() * 0.999) * T.callInterval + 0.6;
      const i = Math.floor(this.rnd() * this.count);
      if (this.state[i] !== GullState.Gone) this.events.push({ kind: 'call', index: i });
    }

    this.softSeparation();
    for (let i = 0; i < this.count; i++) {
      let st = this.state[i];
      if (st === GullState.Gone) continue;
      const x = this.px[i];
      const y = this.py[i];
      const z = this.pz[i];
      // The sea surface matters only near it (the wave solve is not free).
      const sea = surface && y < 10 ? surface(x, z) : 0;
      let ax = 0;
      let ay = 0;
      let az = 0;
      let ampTarget = 0;

      // The dragon: flee inside the radius, regroup once well clear.
      let dd = Infinity;
      if (dragon) dd = Math.hypot(x - dragon.x, y - dragon.y, z - dragon.z);
      if (dragon && st !== GullState.Leave && dd < T.fleeRadius) {
        if (st !== GullState.Flee) {
          this.stats.flees++;
          this.dropTarget(i);
          this.state[i] = st = GullState.Flee;
        }
        this.calm[i] = 0;
      }

      switch (st) {
        case GullState.Hover:
        case GullState.Peel: {
          let u = this.slotU[i];
          let a = this.slotA[i];
          let hh = this.slotH[i];
          const t = this.time;
          const d0 = this.drift[i * 3];
          u += Math.sin(t * 0.21 * this.drift[i * 3 + 1] + d0) * 0.9;
          a += Math.sin(t * 0.17 * this.drift[i * 3 + 2] + d0 * 1.7) * 0.9;
          hh += Math.sin(t * 0.29 * this.drift[i * 3 + 1] + d0 * 2.3) * 0.6;
          if (st === GullState.Peel) {
            u += this.peel[i * 3];
            a += this.peel[i * 3 + 1];
            hh += this.peel[i * 3 + 2];
            this.timer[i] -= h;
            if (this.timer[i] <= 0) this.state[i] = GullState.Hover;
          }
          this.shipPoint(f, u, a, hh, tmp);
          this.keepFromDragon(tmp, dragon, sea);
          const kP = st === GullState.Peel ? 0.7 : 1.1;
          const rel = { x: (tmp.x - x) * kP, y: (tmp.y - y) * kP, z: (tmp.z - z) * kP };
          clampLen3(rel, st === GullState.Peel ? 11 : 8);
          ax = (shipVx + rel.x - this.vx[i]) * 2.4;
          ay = (rel.y - this.vy[i]) * 2.4;
          az = (shipVz + rel.z - this.vz[i]) * 2.4;
          // Small wing adjustments while hanging in the slipstream.
          this.adjust[i] -= h;
          if (this.adjust[i] < -0.25 - (i % 3) * 0.12) this.adjust[i] = 1.5 + this.rnd() * 4;
          ampTarget = this.adjust[i] < 0 ? 0.3 : st === GullState.Peel ? 0.15 : 0;
          break;
        }
        case GullState.Chase: {
          const q = this.target[i];
          if (q < 0 || this.qState[q] !== PieceState.Air) {
            if (q >= 0 && this.qState[q] === PieceState.Water && this.qOwner[q] < 0) {
              this.qOwner[q] = i;
              this.state[i] = GullState.Water;
            } else {
              this.startPeel(i, 1.5 + this.rnd() * 1.5);
            }
            break;
          }
          const dx = this.qx[q] - x;
          const dy = this.qy[q] - y;
          const dz = this.qz[q] - z;
          const dist = Math.hypot(dx, dy, dz);
          const lead = Math.min(0.8, dist / 14);
          const tx = dx + this.qvx[q] * lead;
          const ty = dy + (this.qvy[q] - 0.5 * G * lead) * lead;
          const tz = dz + this.qvz[q] * lead;
          const tl = Math.hypot(tx, ty, tz) || 1;
          const want = Math.min(15, tl * 2.5 + 3);
          ax = ((tx / tl) * want - this.vx[i]) * 4;
          ay = ((ty / tl) * want - this.vy[i]) * 4;
          az = ((tz / tl) * want - this.vz[i]) * 4;
          ampTarget = 0.85;
          // Catch with the bill (0.3 m ahead of the body), outside the ship's box.
          const bx = x + Math.sin(this.yaw[i]) * -0.3;
          const bz = z + Math.cos(this.yaw[i]) * -0.3;
          if (Math.hypot(this.qx[q] - bx, this.qy[q] - y, this.qz[q] - bz) < 0.8 && this.hullDistance(f, this.qx[q], this.qy[q], this.qz[q], nrm) > 0) {
            this.catchPiece(i, q, false);
          }
          break;
        }
        case GullState.Water: {
          const q = this.target[i];
          if (q < 0 || this.qState[q] !== PieceState.Water || this.qOwner[q] !== i) {
            this.startPeel(i, 1.5);
            break;
          }
          const dx = this.qx[q] - x;
          const dz = this.qz[q] - z;
          const hd = Math.hypot(dx, dz);
          const ty = sea + 0.4 + Math.min(12, hd * 0.35) - y;
          const want = Math.min(12, hd * 1.6 + 2);
          ax = ((dx / (hd || 1)) * want - this.vx[i]) * 3;
          az = ((dz / (hd || 1)) * want - this.vz[i]) * 3;
          ay = (ty * 1.5 - this.vy[i]) * 3;
          ampTarget = hd > 20 ? 0.6 : 0.05;
          if (hd < 0.8 && y < sea + 0.9) {
            this.state[i] = GullState.Pick;
            this.timer[i] = 0.55 + this.rnd() * 0.3;
          }
          break;
        }
        case GullState.Pick: {
          const q = this.target[i];
          ax = -this.vx[i] * 8;
          az = -this.vz[i] * 8;
          ay = (sea + 0.35 - y) * 20 - this.vy[i] * 8;
          ampTarget = 0.25;
          this.timer[i] -= h;
          if (this.timer[i] <= 0) {
            if (q >= 0 && this.qState[q] === PieceState.Water && this.qOwner[q] === i) this.catchPiece(i, q, true);
            else this.startPeel(i, 2);
            this.vy[i] = 2.5;
          }
          break;
        }
        case GullState.Flee: {
          if (!dragon) {
            this.state[i] = GullState.Hover;
            break;
          }
          const inv = 1 / Math.max(dd, 1e-3);
          const ox = (x - dragon.x) * inv;
          const oy = (y - dragon.y) * inv;
          const oz = (z - dragon.z) * inv;
          const k = 1 - Math.min(1, dd / (T.fleeRadius + T.fleeHysteresis));
          ax = ox * 26 * (0.4 + k) + (shipVx - this.vx[i]) * 0.3;
          ay = Math.max(0, oy) * 14 * k + 5 * k + (y < sea + 3 ? 6 : 0);
          az = oz * 26 * (0.4 + k) + (shipVz - this.vz[i]) * 0.3;
          ampTarget = 1;
          if (dd > T.fleeRadius + T.fleeHysteresis) {
            this.calm[i] += h;
            if (this.calm[i] > 0.8) this.state[i] = GullState.Hover;
          } else {
            this.calm[i] = 0;
          }
          break;
        }
        case GullState.Leave: {
          // Away from the camera and the ship, climbing, until far enough to vanish unseen.
          this.timer[i] += h;
          let ox = x - this.cam.x;
          let oz = z - this.cam.z;
          const ol = Math.hypot(ox, oz) || 1;
          ox /= ol;
          oz /= ol;
          const wantY = 32 + (i % 5) * 3;
          ax = (ox * 13 - this.vx[i]) * 1.5;
          az = (oz * 13 - this.vz[i]) * 1.5;
          ay = ((wantY - y) * 0.5 - this.vy[i]) * 1.5;
          ampTarget = 0.55;
          if (ol > 170 || this.timer[i] > 25) {
            this.state[i] = GullState.Gone;
            this.dropTarget(i);
            continue;
          }
          break;
        }
      }

      // Soft separation from flock mates (summed once per pair in softSeparation).
      ax += this.sepX[i];
      ay += this.sepY[i];
      az += this.sepZ[i];
      // Soft repulsion from the ship's box.
      const hd = this.hullDistance(f, x, y, z, nrm);
      if (hd < 3) {
        const push = (3 - hd) * 6;
        ax += nrm.x * push;
        ay += nrm.y * push;
        az += nrm.z * push;
      }

      const acc = { x: ax, y: ay, z: az };
      const lim = st === GullState.Flee ? 28 : st === GullState.Chase ? 22 : st === GullState.Pick ? 40 : 9;
      clampLen3(acc, lim);
      this.ax[i] = acc.x;
      this.az[i] = acc.z;
      this.vx[i] += acc.x * h;
      this.vy[i] += acc.y * h;
      this.vz[i] += acc.z * h;
      const sp = Math.hypot(this.vx[i], this.vz[i]);
      if (sp > T.maxSpeed) {
        this.vx[i] *= T.maxSpeed / sp;
        this.vz[i] *= T.maxSpeed / sp;
      }
      this.vy[i] = Math.max(-9, Math.min(7, this.vy[i]));
      this.px[i] += this.vx[i] * h;
      this.py[i] += this.vy[i] * h;
      this.pz[i] += this.vz[i] * h;
      const low = st === GullState.Water || st === GullState.Pick;
      const floor = sea + (low ? 0.3 : 1.2);
      if (this.py[i] < floor) {
        this.py[i] = floor;
        this.vy[i] = Math.max(this.vy[i], 0);
      }
      this.flapAmp[i] += (ampTarget - this.flapAmp[i]) * Math.min(1, h * 6);
    }

    this.separateHard();
    this.constrainHull(f, 1);
    this.attitude(h, f);
  }

  /** Pushes a slot target out to keepFromDragon around the dragon. */
  private keepFromDragon(p: Point3, dragon: Point3 | null, sea: number): void {
    if (!dragon) return;
    const K = GULL_TUNING.keepFromDragon;
    const dx = p.x - dragon.x;
    const dy = p.y - dragon.y;
    const dz = p.z - dragon.z;
    const d = Math.hypot(dx, dy, dz);
    if (d >= K) return;
    if (d < 1e-3) {
      p.y += K;
      return;
    }
    p.x = dragon.x + (dx / d) * K;
    p.y = Math.max(sea + 3, dragon.y + (dy / d) * K);
    p.z = dragon.z + (dz / d) * K;
  }

  private startPeel(i: number, seconds: number): void {
    this.dropTarget(i);
    this.state[i] = GullState.Peel;
    this.timer[i] = seconds;
    const side = this.slotU[i] >= 0 ? 1 : -1;
    this.peel[i * 3] = side * (8 + this.rnd() * 10);
    this.peel[i * 3 + 1] = 8 + this.rnd() * 16;
    this.peel[i * 3 + 2] = -2 + this.rnd() * 7;
  }

  private dropTarget(i: number): void {
    const q = this.target[i];
    if (q >= 0 && this.qOwner[q] === i && this.qState[q] !== PieceState.Carried) this.qOwner[q] = -1;
    this.target[i] = -1;
  }

  private catchPiece(i: number, q: number, fromWater: boolean): void {
    this.qState[q] = PieceState.Carried;
    this.qOwner[q] = i;
    this.qAge[q] = 0;
    if (fromWater) this.stats.catchesWater++;
    else this.stats.catchesAir++;
    this.events.push({ kind: 'catch', index: i });
    // Rivals give up.
    for (let j = 0; j < this.count; j++) {
      if (j !== i && this.target[j] === q) this.startPeel(j, 1.5 + this.rnd() * 2);
    }
    this.target[i] = -1;
    this.startPeel(i, 3 + this.rnd() * 2);
  }

  /** A passenger at the stern rail tosses a piece; one to three hovering gulls go for it. */
  private toss(f: FerryFrame): void {
    let q = -1;
    for (let k = 0; k < this.qState.length; k++) {
      if (this.qState[k] === PieceState.Free) {
        q = k;
        break;
      }
    }
    if (q < 0) return;
    const { fx, fz, rx, rz, st } = this.axes(f);
    const u = (this.rnd() * 2 - 1) * Math.max(0.5, f.beam / 2 - 1.5);
    this.shipPoint(f, u, -this.deck.railInset, 0.4, this.tmp);
    this.qx[q] = this.tmp.x;
    this.qy[q] = this.tmp.y;
    this.qz[q] = this.tmp.z;
    const aft = 2.8 + this.rnd() * 2;
    const up = 3.6 + this.rnd() * 2;
    const lat = (this.rnd() * 2 - 1) * 1.4;
    this.qvx[q] = fx * f.speed - fx * st * aft + rx * lat;
    this.qvy[q] = up;
    this.qvz[q] = fz * f.speed - fz * st * aft + rz * lat;
    this.qState[q] = PieceState.Air;
    this.qAge[q] = 0;
    this.qOwner[q] = -1;
    this.qSpin[q] = this.rnd() * 6.28;
    this.stats.tosses++;
    this.events.push({ kind: 'toss', index: q });
    // Where the piece will be in ~0.9 s: the nearest hovering gulls react.
    const t = 0.9;
    const ex = this.qx[q] + this.qvx[q] * t;
    const ey = this.qy[q] + this.qvy[q] * t - 0.5 * G * t * t;
    const ez = this.qz[q] + this.qvz[q] * t;
    const chasers = this.rnd() < 0.08 ? 0 : 1 + Math.floor(this.rnd() * 3);
    for (let c = 0; c < chasers; c++) {
      let best = -1;
      let bestD = 40;
      for (let i = 0; i < this.count; i++) {
        if (this.state[i] !== GullState.Hover) continue;
        const d = Math.hypot(this.px[i] - ex, this.py[i] - ey, this.pz[i] - ez);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) break;
      this.state[best] = GullState.Chase;
      this.target[best] = q;
    }
  }

  private stepPieces(h: number, f: FerryFrame, surface?: (x: number, z: number) => number): void {
    const T = GULL_TUNING;
    const nrm: Point3 = { x: 0, y: 0, z: 0 };
    for (let q = 0; q < this.qState.length; q++) {
      const s = this.qState[q];
      if (s === PieceState.Free) continue;
      this.qAge[q] += h;
      if (s === PieceState.Air) {
        this.qvy[q] -= G * h;
        const k = 1 - T.pieceDrag * h;
        this.qvx[q] *= k;
        this.qvy[q] *= k;
        this.qvz[q] *= k;
        this.qx[q] += this.qvx[q] * h;
        this.qy[q] += this.qvy[q] * h;
        this.qz[q] += this.qvz[q] * h;
        this.qSpin[q] += h * 9;
        const sea = surface ? surface(this.qx[q], this.qz[q]) : 0;
        // Fell back on the deck (inside the hull outline, at or below the rail height): a passenger's miss.
        const inside = this.hullDistance(f, this.qx[q], this.qy[q], this.qz[q], nrm) < -T.hullMargin;
        if (inside && this.qvy[q] < 0 && this.qy[q] < f.heave + this.deck.railY - 0.6) {
          this.qState[q] = PieceState.Free;
          this.stats.landedOnDeck++;
          this.releaseChasers(q);
        } else if (this.qy[q] <= sea) {
          this.qy[q] = sea;
          this.qState[q] = PieceState.Water;
          this.qAge[q] = 0;
        } else if (this.qAge[q] > 8) {
          this.qState[q] = PieceState.Free;
          this.releaseChasers(q);
        }
      } else if (s === PieceState.Water) {
        this.qy[q] = surface ? surface(this.qx[q], this.qz[q]) : 0;
        if (this.qOwner[q] < 0 && this.qAge[q] > 1 && !this.released) {
          // Nobody is on it: the nearest free gull goes down for it.
          let best = -1;
          let bestD = 120;
          for (let i = 0; i < this.count; i++) {
            const st = this.state[i];
            if (st !== GullState.Hover && st !== GullState.Peel) continue;
            const d = Math.hypot(this.px[i] - this.qx[q], this.pz[i] - this.qz[q]);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          if (best >= 0) {
            this.dropTarget(best);
            this.state[best] = GullState.Water;
            this.target[best] = q;
            this.qOwner[q] = best;
          }
        }
        if (this.qAge[q] > T.floatTime) {
          this.qState[q] = PieceState.Free;
          this.stats.sunk++;
          this.releaseChasers(q);
        }
      } else if (s === PieceState.Carried) {
        const i = this.qOwner[q];
        if (i < 0 || this.qAge[q] > T.carryTime || this.state[i] === GullState.Gone) {
          this.qState[q] = PieceState.Free;
          this.qOwner[q] = -1;
          continue;
        }
        // In the bill.
        this.qx[q] = this.px[i] - Math.sin(this.yaw[i]) * 0.34;
        this.qy[q] = this.py[i] + 0.01;
        this.qz[q] = this.pz[i] - Math.cos(this.yaw[i]) * 0.34;
      }
    }
  }

  private releaseChasers(q: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.target[i] === q) this.startPeel(i, 1 + this.rnd());
    }
    this.qOwner[q] = -1;
  }

  /** Soft separation push of every gull from its mates within separationRange, one pass over the pairs. */
  private softSeparation(): void {
    const R = GULL_TUNING.separationRange;
    const R2 = R * R;
    this.sepX.fill(0);
    this.sepY.fill(0);
    this.sepZ.fill(0);
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === GullState.Gone) continue;
      const x = this.px[i];
      const y = this.py[i];
      const z = this.pz[i];
      for (let j = i + 1; j < this.count; j++) {
        const sx = x - this.px[j];
        if (sx > R || sx < -R) continue;
        const sz = z - this.pz[j];
        if (sz > R || sz < -R) continue;
        const sy = y - this.py[j];
        const d2 = sx * sx + sy * sy + sz * sz;
        if (d2 >= R2 || d2 < 1e-8 || this.state[j] === GullState.Gone) continue;
        const d = Math.sqrt(d2);
        const k = ((R - d) / R) * 14 / d;
        this.sepX[i] += sx * k;
        this.sepY[i] += sy * k * 0.5;
        this.sepZ[i] += sz * k;
        this.sepX[j] -= sx * k;
        this.sepY[j] -= sy * k * 0.5;
        this.sepZ[j] -= sz * k;
      }
    }
  }

  /** Hard constraint: no two gulls closer than minSeparation. */
  private separateHard(): void {
    const min = GULL_TUNING.minSeparation;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.count; i++) {
        if (this.state[i] === GullState.Gone) continue;
        for (let j = i + 1; j < this.count; j++) {
          if (this.state[j] === GullState.Gone) continue;
          let dx = this.px[i] - this.px[j];
          if (dx > min || dx < -min) continue;
          let dz = this.pz[i] - this.pz[j];
          if (dz > min || dz < -min) continue;
          let dy = this.py[i] - this.py[j];
          let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d >= min) continue;
          if (d < 1e-4) {
            dx = ((i * 7919 + j * 104729) % 17) / 17 - 0.5;
            dy = 0.1;
            dz = 0.5;
            d = Math.hypot(dx, dy, dz);
          }
          const k = (0.5 * (min - d)) / d + 1e-4;
          this.px[i] += dx * k;
          this.py[i] += dy * k;
          this.pz[i] += dz * k;
          this.px[j] -= dx * k;
          this.py[j] -= dy * k;
          this.pz[j] -= dz * k;
        }
      }
    }
  }

  /** Hard constraint: gulls stay outside the ship's box (moved out through the nearest face, inward speed removed). */
  private constrainHull(f: FerryFrame, _pass: number): void {
    const n: Point3 = { x: 0, y: 0, z: 0 };
    const { fx, fz } = this.axes(f);
    const svx = fx * f.speed;
    const svz = fz * f.speed;
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === GullState.Gone) continue;
      const d = this.hullDistance(f, this.px[i], this.py[i], this.pz[i], n);
      if (d >= 0) continue;
      this.px[i] -= n.x * (d - 1e-3);
      this.py[i] -= n.y * (d - 1e-3);
      this.pz[i] -= n.z * (d - 1e-3);
      const rv = (this.vx[i] - svx) * n.x + this.vy[i] * n.y + (this.vz[i] - svz) * n.z;
      if (rv < 0) {
        this.vx[i] -= n.x * rv;
        this.vy[i] -= n.y * rv;
        this.vz[i] -= n.z * rv;
      }
    }
  }

  /** Heading, pitch and bank for rendering: into the airflow (the ship's heading when hanging still), banked into turns. */
  private attitude(h: number, f: FerryFrame): void {
    const k = Math.min(1, h * 4);
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === GullState.Gone) continue;
      const vx = this.vx[i];
      const vz = this.vz[i];
      const hs = Math.hypot(vx, vz);
      const want = hs > 1.5 ? Math.atan2(-vx, -vz) : f.speed >= 0 ? f.yaw : f.yaw + Math.PI;
      let dy = want - this.yaw[i];
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw[i] += dy * Math.min(1, h * 6);
      const hover = this.state[i] === GullState.Hover || this.state[i] === GullState.Pick;
      const p = hover ? 0.14 : Math.atan2(this.vy[i], Math.max(hs, 0.5)) * 0.7;
      this.pitch[i] += (p - this.pitch[i]) * k;
      const lat = hs > 0.5 ? (this.ax[i] * -vz + this.az[i] * vx) / hs : 0;
      const b = Math.max(-1.1, Math.min(1.1, -lat * 0.12));
      this.bank[i] += (b - this.bank[i]) * k;
    }
  }

  /** Returns and clears the queued events. */
  drainEvents(out: FlockEvent[]): FlockEvent[] {
    out.length = 0;
    for (const e of this.events) out.push(e);
    this.events.length = 0;
    return out;
  }

  /** Signed distance of gull `i` to the ship's box (m; debug and checks). */
  hullClearance(f: FerryFrame, i: number): number {
    const n: Point3 = { x: 0, y: 0, z: 0 };
    return this.hullDistance(f, this.px[i], this.py[i], this.pz[i], n) + GULL_TUNING.hullMargin;
  }

  /** The stern anchor point (trailing end at rail height) in world coordinates. */
  sternPoint(f: FerryFrame, out: Point3): Point3 {
    return this.shipPoint(f, 0, 0, 0, out);
  }
}
