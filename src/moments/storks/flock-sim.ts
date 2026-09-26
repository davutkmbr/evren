/**
 * White stork migration flock (pure TS, no three.js): a thermal "kettle" and the glide stream out of it.
 *
 * Real behaviour (Bosphorus, late August – September): storks cross the strait in flocks of hundreds to thousands and
 * hardly flap. They circle up in a thermal (a rotating column of birds, each on its own circle, all turning the same
 * way, climbing 1–3 m/s), leave from the top one after another and glide in a loose stream toward the south-southwest
 * to the next thermal, losing height (glide ratio ~12), drifting with the wind and crabbing into it. Slow, deep flaps
 * (~2 Hz) come only when needed: entering the thermal at its base, keeping a place in the stream, getting away.
 *
 * Here: every bird orbits the column's axis (which drifts with the wind and leans downwind with height) on its own
 * radius at circling speed, climbing with the thermal minus its sink; near the top it peels off when heading along the
 * course and keeps a lane in the stream. Soft separation (spatial hash) plus a hard minimum distance keeps birds from
 * intersecting; the dragon scatters birds within `avoidRadius` (predictive dodge + hard exclusion radius) and they calm
 * down again and drift back into their circles. Substeps keep large frame times stable.
 *
 * The host (./stork-scene.ts) feeds the wind, the measured updraft at the core, the dragon and optionally the ground.
 */
import { createRng } from '../../core/math/noise';

export const STORK = {
  /** Airspeed while circling (m/s) and its still-air sink (m/s). */
  soarSpeed: 11.5,
  sinkSoar: 0.95,
  /** Airspeed and sink in the glide stream: glide ratio soarSpeed/sink ≈ 12. */
  glideSpeed: 15,
  sinkGlide: 1.25,
  /** Climb rate band in the kettle (thermal updraft minus sink), m/s. */
  climbMin: 1.0,
  climbMax: 3.0,
  /** Updraft assumed when the host has no measurement (m/s). */
  defaultUpdraft: 3.1,
  /** Orbit radii in the kettle (m): individual circles from a tight core to the loose rim. */
  orbitMin: 18,
  orbitMax: 72,
  /** Downwind lean of the column with height (s/m × wind): the air at the top left the base that long ago. */
  leanK: 0.2,
  /** Soft separation radius and the hard minimum centre distance between two storks (m; wingspan 2 m). */
  sepRadius: 7,
  minSep: 2.6,
  /** Dragon: soft avoidance radius, and the hard exclusion radius around its centre (18 m wingspan + margin). */
  avoidRadius: 60,
  dragonHard: 22,
  /** Alarm decay per second (calm down again within ~6–8 s). */
  alarmDecay: 0.16,
  /** Wing-beat frequency (Hz) and the maximum steering acceleration (m/s²). */
  flapHz: 2.0,
  maxAcc: 7,
  /** Largest simulation step (s): longer frames are split. */
  maxStep: 1 / 30,
  /** Longest frame accepted (s): a hitch longer than this is clamped. */
  maxFrame: 0.25,
  /** Ground clearance kept (m). */
  clearance: 40,
  /** Stream: lateral lane half width (m) and height spread. */
  laneHalf: 55,
} as const;

export const enum StorkState {
  Kettle = 0,
  Glide = 1,
}

export interface StorkFlockOptions {
  count: number;
  seed?: number;
  /** Kettle axis at its base (world x/z) and base / top altitude (m ASL). */
  x: number;
  z: number;
  baseY: number;
  topY: number;
  /** Glide course (world x/z direction, need not be unit), toward the next thermal. */
  courseX: number;
  courseZ: number;
  /** Turning sense seen from above: 1 or -1. */
  turn?: number;
  /** Fraction of the kettle's height initially filled (0..1). */
  fill?: number;
}

export interface DragonProbe {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

const TABLE = 4096;
/** Hash cell size: twice the separation radius, so a 2×2×2 block of cells holds every neighbour in range. */
const CELL = STORK.sepRadius * 2;

export class StorkFlockSim {
  readonly count: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly state: Uint8Array;
  /** Wing pose per bird: flap phase (rad), amplitude 0..1, flex 0 soaring .. 1 gliding, tint 0..1. */
  readonly phase: Float32Array;
  readonly amp: Float32Array;
  readonly flex: Float32Array;
  readonly tint: Float32Array;
  /** Size factor (wingspan 1.9–2.1 m). */
  readonly size: Float32Array;
  readonly bank: Float32Array;
  /** 0..1 fear of the dragon. */
  readonly alarm: Float32Array;
  /** 1 on the step a downstroke began (for sound). Cleared at the start of every update. */
  readonly downbeat: Uint8Array;

  /** Wind (m/s, world x/z), set by the host. */
  windX = 0;
  windZ = 0;
  /** Measured updraft at the core (m/s); NaN = unknown (STORK.defaultUpdraft). */
  updraft = Number.NaN;
  /** Kettle axis at the base. */
  coreX: number;
  coreZ: number;
  readonly baseY: number;
  readonly topY: number;
  readonly courseX: number;
  readonly courseZ: number;
  readonly turn: number;
  /** Seconds simulated. */
  time = 0;
  /** Optional ground height query (m); sampled a few times a second per bird. */
  ground: ((x: number, z: number) => number) | null = null;

  private readonly orbitR: Float32Array;
  private readonly ang: Float32Array;
  private readonly climbK: Float32Array;
  private readonly leaveAt: Float32Array;
  private readonly lane: Float32Array;
  private readonly laneX0: Float32Array;
  private readonly laneZ0: Float32Array;
  private readonly flapFor: Float32Array;
  private readonly flapNext: Float32Array;
  private readonly freq: Float32Array;
  private readonly floorY: Float32Array;
  private readonly head = new Int32Array(TABLE);
  private readonly next: Int32Array;
  private readonly rng: () => number;
  private steps = 0;
  private readonly axis = { x: 0, z: 0 };
  private readonly topAxis = { x: 0, z: 0 };

  constructor(o: StorkFlockOptions) {
    const n = Math.max(0, Math.floor(o.count));
    this.count = n;
    this.rng = createRng(o.seed ?? 0x5701c);
    this.coreX = o.x;
    this.coreZ = o.z;
    this.baseY = o.baseY;
    this.topY = Math.max(o.topY, o.baseY + 60);
    const cl = Math.hypot(o.courseX, o.courseZ) || 1;
    this.courseX = o.courseX / cl;
    this.courseZ = o.courseZ / cl;
    this.turn = (o.turn ?? 1) < 0 ? -1 : 1;
    const f = () => new Float32Array(n);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.state = new Uint8Array(n);
    this.phase = f();
    this.amp = f();
    this.flex = f();
    this.tint = f();
    this.size = f();
    this.bank = f();
    this.alarm = f();
    this.downbeat = new Uint8Array(n);
    this.orbitR = f();
    this.ang = f();
    this.climbK = f();
    this.leaveAt = f();
    this.lane = f();
    this.laneX0 = f();
    this.laneZ0 = f();
    this.flapFor = f();
    this.flapNext = f();
    this.freq = f();
    this.floorY = f().fill(-1e9);
    this.next = new Int32Array(n);
    this.spawn(o.fill ?? 0.92);
  }

  private spawn(fill: number): void {
    const r = this.rng;
    const n = this.count;
    const span = (this.topY - this.baseY) * Math.min(1, Math.max(0.05, fill));
    for (let i = 0; i < n; i++) {
      this.tint[i] = r();
      this.size[i] = 0.95 + 0.1 * r();
      this.freq[i] = STORK.flapHz * (0.93 + 0.14 * r());
      this.phase[i] = r() * Math.PI * 2;
      this.climbK[i] = 0.9 + 0.2 * r();
      this.leaveAt[i] = this.topY - 25 * r();
      this.flapNext[i] = 20 + 120 * r();
      // Place without overlaps: a few tries per bird against the ones already placed.
      let ok = false;
      for (let attempt = 0; attempt < 24 && !ok; attempt++) {
        const rad = STORK.orbitMin + (STORK.orbitMax - STORK.orbitMin) * Math.sqrt(r());
        const a = r() * Math.PI * 2;
        const y = this.baseY + span * r();
        const lean = STORK.leanK * (y - this.baseY);
        const x = this.coreX + this.windX * lean + Math.cos(a) * rad;
        const z = this.coreZ + this.windZ * lean + Math.sin(a) * rad;
        ok = true;
        for (let k = 0; k < i; k++) {
          const dx = this.px[k] - x;
          const dy = this.py[k] - y;
          const dz = this.pz[k] - z;
          if (dx * dx + dy * dy + dz * dz < (STORK.sepRadius * 1.2) ** 2) {
            ok = false;
            break;
          }
        }
        this.orbitR[i] = rad;
        this.ang[i] = a;
        this.px[i] = x;
        this.py[i] = y;
        this.pz[i] = z;
      }
      const tx = -Math.sin(this.ang[i]) * this.turn;
      const tz = Math.cos(this.ang[i]) * this.turn;
      this.vx[i] = tx * STORK.soarSpeed + this.windX;
      this.vz[i] = tz * STORK.soarSpeed + this.windZ;
      this.vy[i] = this.climb(i);
      this.state[i] = StorkState.Kettle;
    }
  }

  /** Climb rate of bird i in the kettle (m/s). */
  private climb(i: number): number {
    const w = Number.isFinite(this.updraft) ? this.updraft : STORK.defaultUpdraft;
    const c = (w - STORK.sinkSoar) * this.climbK[i];
    return Math.min(STORK.climbMax, Math.max(STORK.climbMin, c));
  }

  /** Kettle axis position at altitude y (drifted base + downwind lean). */
  axisAt(y: number, out: { x: number; z: number }): void {
    const lean = STORK.leanK * Math.max(0, y - this.baseY);
    out.x = this.coreX + this.windX * lean;
    out.z = this.coreZ + this.windZ * lean;
  }

  /** Birds still circling in the kettle. */
  get kettleCount(): number {
    let c = 0;
    for (let i = 0; i < this.count; i++) {
      c += this.state[i] === StorkState.Kettle ? 1 : 0;
    }
    return c;
  }

  /** Moves the column's base (the host re-centres it on the measured thermal core). */
  nudgeCore(dx: number, dz: number): void {
    this.coreX += dx;
    this.coreZ += dz;
  }

  update(dt: number, dragon: DragonProbe | null): void {
    this.downbeat.fill(0);
    if (!(dt > 0) || this.count === 0) {
      return;
    }
    let left = Math.min(dt, STORK.maxFrame);
    const n = Math.max(1, Math.ceil(left / STORK.maxStep - 1e-9));
    const h = left / n;
    for (let k = 0; k < n; k++) {
      this.step(h, dragon);
      left -= h;
    }
  }

  private step(h: number, dragon: DragonProbe | null): void {
    this.time += h;
    this.steps++;
    // The column drifts with the wind (the convective cells move at ~0.8 of it, the birds with the air).
    this.coreX += this.windX * 0.85 * h;
    this.coreZ += this.windZ * 0.85 * h;
    const n = this.count;
    const turn = this.turn;
    const wx = this.windX;
    const wz = this.windZ;
    const windSpeed = Math.sqrt(wx * wx + wz * wz);
    const axis = this.axis;
    const topAxis = this.topAxis;
    this.axisAt(this.topY, topAxis);
    this.buildHash();
    const cs = STORK.sepRadius;
    for (let i = 0; i < n; i++) {
      const x = this.px[i];
      const y = this.py[i];
      const z = this.pz[i];
      let vx = this.vx[i];
      let vy = this.vy[i];
      let vz = this.vz[i];
      let ax = 0;
      let ay = 0;
      let az = 0;
      let dvx: number;
      let dvy: number;
      let dvz: number;
      const alarm = this.alarm[i];
      if (this.state[i] === StorkState.Kettle) {
        // Own circle around the (leaning) axis; the rim widens a little while the flock is alarmed.
        const rad = this.orbitR[i] * (1 + 0.35 * alarm);
        this.ang[i] += (turn * STORK.soarSpeed * h) / rad;
        this.axisAt(y, axis);
        const c = Math.cos(this.ang[i]);
        const s = Math.sin(this.ang[i]);
        const tx = axis.x + c * rad;
        const tz = axis.z + s * rad;
        // Tangential airspeed + the axis' drift + a spring toward the slot.
        // The slot spring gives way while the bird is alarmed (it lets itself be pushed off its circle).
        const spring = 0.35 * (1 - 0.85 * alarm);
        dvx = -s * turn * STORK.soarSpeed + wx * 0.85 + (tx - x) * spring;
        dvz = c * turn * STORK.soarSpeed + wz * 0.85 + (tz - z) * spring;
        dvy = this.climb(i);
        // Below the thermal's base they work to get in (flapping), above its top they are leaving.
        if (y < this.baseY + 12) {
          dvy = Math.max(dvy, 1.2);
        }
        if (y >= this.leaveAt[i]) {
          dvy = Math.min(dvy, 0.2);
          const sp = Math.sqrt((vx - wx) * (vx - wx) + (vz - wz) * (vz - wz)) || 1;
          const along = ((vx - wx) * this.courseX + (vz - wz) * this.courseZ) / sp;
          if (along > 0.82 || y > this.topY + 20) {
            this.state[i] = StorkState.Glide;
            // A lane in the loose stream: near where it leaves (lateral offset from the line through the column's top),
            // spread across the stream's width.
            const lx = x - topAxis.x;
            const lz = z - topAxis.z;
            const lat = -lx * this.courseZ + lz * this.courseX;
            this.lane[i] = Math.max(-STORK.laneHalf, Math.min(STORK.laneHalf, 0.4 * lat + (this.rng() * 2 - 1) * STORK.laneHalf));
            this.laneX0[i] = topAxis.x;
            this.laneZ0[i] = topAxis.z;
            this.flapNext[i] = 15 + 60 * this.rng();
          }
        }
      } else {
        // Glide stream: along the course at glide airspeed plus the wind, holding a lane in the drifting air, sinking.
        this.laneX0[i] += wx * h;
        this.laneZ0[i] += wz * h;
        const lx = x - this.laneX0[i];
        const lz = z - this.laneZ0[i];
        const lat = -lx * this.courseZ + lz * this.courseX;
        const err = this.lane[i] - lat;
        const pull = Math.max(-3, Math.min(3, err * 0.08));
        dvx = this.courseX * STORK.glideSpeed + wx + -this.courseZ * pull;
        dvz = this.courseZ * STORK.glideSpeed + wz + this.courseX * pull;
        dvy = -STORK.sinkGlide;
        if (Math.abs(err) > 45 && this.flapFor[i] <= 0 && this.rng() < h * 0.25) {
          this.startFlaps(i, 3 + Math.floor(this.rng() * 3));
        }
      }
      ax += (dvx - vx) * 0.9;
      ay += (dvy - vy) * 1.2;
      az += (dvz - vz) * 0.9;

      // Soft separation from neighbours: the 2×2×2 hash cells (twice the radius) around the bird.
      const gx = x / CELL;
      const gy = y / CELL;
      const gz = z / CELL;
      const ix = Math.floor(gx - 0.5);
      const iy = Math.floor(gy - 0.5);
      const iz = Math.floor(gz - 0.5);
      for (let ox = 0; ox <= 1; ox++) {
        for (let oy = 0; oy <= 1; oy++) {
          for (let oz = 0; oz <= 1; oz++) {
            let j = this.head[hash(ix + ox, iy + oy, iz + oz)];
            while (j >= 0) {
              if (j !== i) {
                const sx = x - this.px[j];
                const sy = y - this.py[j];
                const sz = z - this.pz[j];
                const d2 = sx * sx + sy * sy + sz * sz;
                if (d2 < cs * cs && d2 > 1e-6) {
                  const d = Math.sqrt(d2);
                  const push = ((cs - d) / cs) * 9;
                  ax += (sx / d) * push;
                  ay += (sy / d) * push * 0.5;
                  az += (sz / d) * push;
                }
              }
              j = this.next[j];
            }
          }
        }
      }

      // The dragon: predictive dodge and a push away inside the avoidance radius.
      let fear = 0;
      if (dragon) {
        const rx = x - dragon.x;
        const ry = y - dragon.y;
        const rz = z - dragon.z;
        const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (d < STORK.avoidRadius * 3) {
          // Closest approach within 3 s along the relative velocity.
          const ux = dragon.vx - vx;
          const uy = dragon.vy - vy;
          const uz = dragon.vz - vz;
          const u2 = ux * ux + uy * uy + uz * uz;
          let t = u2 > 1e-4 ? (rx * ux + ry * uy + rz * uz) / u2 : 0;
          t = Math.max(0, Math.min(3, t));
          const mx = rx - ux * t;
          const my = ry - uy * t;
          const mz = rz - uz * t;
          const md = Math.sqrt(mx * mx + my * my + mz * mz);
          const soon = Math.min(d, md);
          if (soon < STORK.avoidRadius) {
            fear = 1 - soon / STORK.avoidRadius;
            const k = fear * (10 + 18 * fear);
            // Away from where the dragon will pass (or from it now when that is closer), storks drop and bank off.
            const bx = md < d ? mx : rx;
            const by = md < d ? my : ry;
            const bz = md < d ? mz : rz;
            const bl = Math.hypot(bx, by, bz) || 1;
            ax += (bx / bl) * k;
            ay += (by / bl) * k * 0.7 - (by < 0 ? fear * 3 : 0);
            az += (bz / bl) * k;
          }
        }
      }
      if (fear > alarm) {
        this.alarm[i] = fear;
        if (fear > 0.25 && this.flapFor[i] <= 0) {
          this.startFlaps(i, 4 + Math.floor(fear * 5));
        }
      } else {
        this.alarm[i] = Math.max(0, alarm - STORK.alarmDecay * h);
      }

      const lim = STORK.maxAcc * (1 + 2.5 * this.alarm[i]);
      const al = Math.sqrt(ax * ax + ay * ay + az * az);
      if (al > lim) {
        ax *= lim / al;
        ay *= lim / al;
        az *= lim / al;
      }
      vx += ax * h;
      vy += ay * h;
      vz += az * h;
      const maxSp = (this.state[i] === StorkState.Kettle ? 16 : 20) * (1 + 0.5 * this.alarm[i]) + windSpeed;
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp > maxSp) {
        vx *= maxSp / sp;
        vy *= maxSp / sp;
        vz *= maxSp / sp;
      }
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;
      // Bank into the turn: lateral acceleration against the air-relative heading.
      const hx = vx - wx;
      const hz = vz - wz;
      const hl = Math.sqrt(hx * hx + hz * hz) || 1;
      const lateral = (ax * -hz + az * hx) / hl;
      const centripetal = this.state[i] === StorkState.Kettle ? (turn * STORK.soarSpeed * STORK.soarSpeed) / (this.orbitR[i] * (1 + 0.35 * this.alarm[i])) : 0;
      const targetBank = Math.max(-0.9, Math.min(0.9, Math.atan((lateral * 0.5 + centripetal) / 9.81)));
      this.bank[i] += (-targetBank - this.bank[i]) * Math.min(1, h * 2.5);
      this.updateWings(i, h);
    }

    // Integrate, then the hard constraints: the dragon's exclusion radius, the minimum distance, the ground.
    for (let i = 0; i < n; i++) {
      this.px[i] += this.vx[i] * h;
      this.py[i] += this.vy[i] * h;
      this.pz[i] += this.vz[i] * h;
    }
    if (dragon) {
      for (let i = 0; i < n; i++) {
        const rx = this.px[i] - dragon.x;
        const ry = this.py[i] - dragon.y;
        const rz = this.pz[i] - dragon.z;
        const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (d < STORK.dragonHard) {
          const ux = d > 1e-6 ? rx / d : 0;
          const uy = d > 1e-6 ? ry / d : 1;
          const uz = d > 1e-6 ? rz / d : 0;
          this.px[i] = dragon.x + ux * STORK.dragonHard;
          this.py[i] = dragon.y + uy * STORK.dragonHard;
          this.pz[i] = dragon.z + uz * STORK.dragonHard;
          // Carried along by the dragon's bow wave: no velocity into it.
          const rel = (this.vx[i] - dragon.vx) * ux + (this.vy[i] - dragon.vy) * uy + (this.vz[i] - dragon.vz) * uz;
          if (rel < 0) {
            this.vx[i] -= rel * ux;
            this.vy[i] -= rel * uy;
            this.vz[i] -= rel * uz;
          }
          this.alarm[i] = 1;
        }
      }
    }
    this.resolveOverlaps();
    const ground = this.ground;
    for (let i = 0; i < n; i++) {
      if (ground && (i + this.steps) % 12 === 0) {
        const g = ground(this.px[i], this.pz[i]);
        this.floorY[i] = Number.isFinite(g) ? Math.max(g, 0) + STORK.clearance : -1e9;
      }
      if (this.py[i] < this.floorY[i]) {
        this.py[i] += (this.floorY[i] - this.py[i]) * Math.min(1, h * 2);
        this.vy[i] = Math.max(this.vy[i], 0);
      }
    }
  }

  private startFlaps(i: number, beats: number): void {
    this.flapFor[i] = beats / this.freq[i];
  }

  private updateWings(i: number, h: number): void {
    const kettle = this.state[i] === StorkState.Kettle;
    // Occasional flaps: rare while soaring, a little more often in the stream; always at the kettle's base.
    this.flapNext[i] -= h;
    if (this.flapNext[i] <= 0) {
      this.flapNext[i] = (kettle ? 60 : 35) + (kettle ? 120 : 70) * this.rng();
      if (this.flapFor[i] <= 0) {
        this.startFlaps(i, 2 + Math.floor(this.rng() * 4));
      }
    }
    if (kettle && this.py[i] < this.baseY + 12 && this.flapFor[i] <= 0) {
      this.startFlaps(i, 3);
    }
    const flapping = this.flapFor[i] > 0;
    this.flapFor[i] -= h;
    const target = flapping ? 0.72 + 0.28 * this.alarm[i] : 0;
    // Wings reach full stroke in ~0.4 s and settle into the glide over ~0.6 s (never snapping).
    this.amp[i] += (target - this.amp[i]) * Math.min(1, h * (flapping ? 3 : 2));
    const before = this.phase[i];
    if (this.amp[i] > 0.01 || flapping) {
      this.phase[i] = before + this.freq[i] * Math.PI * 2 * h;
      // Downstroke starts at the top of the stroke (phase π/2 mod 2π).
      const TWO_PI = Math.PI * 2;
      const a = Math.floor((before - Math.PI / 2) / TWO_PI);
      const b = Math.floor((this.phase[i] - Math.PI / 2) / TWO_PI);
      if (b > a && this.amp[i] > 0.3) {
        this.downbeat[i] = 1;
      }
      if (this.phase[i] > 1e4) {
        this.phase[i] -= TWO_PI * 1000;
      }
    }
    const flexTarget = kettle ? 0.15 * this.alarm[i] : 1 - 0.35 * this.alarm[i];
    this.flex[i] += (flexTarget - this.flex[i]) * Math.min(1, h * 0.8);
  }

  private buildHash(): void {
    this.head.fill(-1);
    for (let i = 0; i < this.count; i++) {
      const k = hash(Math.floor(this.px[i] / CELL), Math.floor(this.py[i] / CELL), Math.floor(this.pz[i] / CELL));
      this.next[i] = this.head[k];
      this.head[k] = i;
    }
  }

  /** Pushes apart any two storks closer than STORK.minSep (hash rebuilt on the integrated positions). */
  private resolveOverlaps(): void {
    this.buildHash();
    const m = STORK.minSep;
    for (let i = 0; i < this.count; i++) {
      const ix = Math.floor(this.px[i] / CELL - 0.5);
      const iy = Math.floor(this.py[i] / CELL - 0.5);
      const iz = Math.floor(this.pz[i] / CELL - 0.5);
      for (let ox = 0; ox <= 1; ox++) {
        for (let oy = 0; oy <= 1; oy++) {
          for (let oz = 0; oz <= 1; oz++) {
            let j = this.head[hash(ix + ox, iy + oy, iz + oz)];
            while (j >= 0) {
              if (j > i) {
                const sx = this.px[i] - this.px[j];
                const sy = this.py[i] - this.py[j];
                const sz = this.pz[i] - this.pz[j];
                const d2 = sx * sx + sy * sy + sz * sz;
                if (d2 < m * m) {
                  const d = Math.sqrt(d2);
                  const ux = d > 1e-6 ? sx / d : 1;
                  const uy = d > 1e-6 ? sy / d : 0;
                  const uz = d > 1e-6 ? sz / d : 0;
                  const push = (m - d) * 0.5 + 1e-3;
                  this.px[i] += ux * push;
                  this.py[i] += uy * push;
                  this.pz[i] += uz * push;
                  this.px[j] -= ux * push;
                  this.py[j] -= uy * push;
                  this.pz[j] -= uz * push;
                }
              }
              j = this.next[j];
            }
          }
        }
      }
    }
  }
}

function hash(x: number, y: number, z: number): number {
  return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (TABLE - 1);
}
