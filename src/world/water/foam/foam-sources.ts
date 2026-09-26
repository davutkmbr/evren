/**
 * Foam sources and spray sources of the sea (phase 21 stage 7c), CPU side; the `water.foam` service.
 *
 * Hulls (vessel physics calls `hull()` every frame), splashes and the dragon only record state here; `flush()` (in the
 * water's preRender, after every system updated) turns it into stamps for the foam window, so the order of the
 * systems' updates never matters:
 * - hull: the bow roll along both sides of the forefoot (breaking bow wave, grows as Fr^2), stern turbulence at the
 *   transom, and the propeller wash: a turbulent centreline over the last stretch of the hull's own track (a history of
 *   stern positions, so it bends with the turns) that keeps the field foamy there, widening with distance; beyond it
 *   the field's slow wake decay keeps it white for a few hundred metres behind a ferry. Planing craft add foam along
 *   the aft chines.
 * - the dragon: the skim furrow (swept from frame to frame), spray falling back at the downwash ring's edge, the fire's
 *   boiling patch, the swimming body's wash and the wing strokes where a wingtip is under water.
 * - splashes (plunges, breaches, skim contacts): a foam disk.
 * Breaking crests, breaking wake crests and surf are sources of the simulation itself (foam-gpu.ts).
 *
 * Spray sources for fx (`sprays`, rebuilt in `beginFrame`): spindrift off breaking crests in strong wind (crest points
 * found by sampling the same whitecap criterion the shaders use around the camera: the number found per second follows
 * the coverage), bow spray from fast hulls in chop or slamming, rooster tails of planing craft.
 */
import * as THREE from 'three';
import type { FlightMode, LowFlightView, WaterFoam, WaterSpraySource } from '../../../core/contracts';
import type { LagrangianSample, WaveQuery } from '../wave-query';
import { newLagrangianSample } from '../wave-query';
import { DRAGON_FOAM, HULL_FOAM, SPRAY } from './config';
import type { FoamWindow } from './foam-window';
import { breakCell, cellSpeed, crestThreshold, localBreakProbability, slotFade, type WhitecapModel } from './whitecaps';

const HIST = 12;

interface HullState {
  frame: number;
  x: number;
  z: number;
  fx: number;
  fz: number;
  speed: number;
  length: number;
  beam: number;
  draft: number;
  thrust: number;
  planing: number;
  bowHeave: number;
  /** Stern positions (newest at head), spaced `spacing` metres. */
  hist: Float64Array;
  count: number;
  head: number;
  spacing: number;
}

/** What the dragon's foam needs each frame (read from DragonState, the low-flight model and the rig). */
export interface DragonFoamInput {
  mode: FlightMode;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  low: LowFlightView | null;
  /** Wingtip world positions (swimming strokes) or null. */
  tips: readonly [THREE.Vector3, THREE.Vector3] | null;
  wingspan: number;
}

const newSpray = (): WaterSpraySource => ({ kind: 'spindrift', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dirX: 1, dirZ: 0, strength: 0, size: 1 });

function smoothstep(e0: number, e1: number, x: number): number {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** Deterministic PRNG (mulberry32) for the spindrift candidates. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class FoamSources implements WaterFoam {
  readonly sprays: WaterSpraySource[] = [];
  sprayCount = 0;
  readonly window = { x: 0, z: 0, halfExtent: 0 };
  coverage = 0;
  /** Spray candidate share (quality) and a multiplier on the candidate rate (checks). */
  sprayQuality = 1;
  /** Diagnostics of the last frame: hulls flushed, stamps queued / dropped, spindrift candidates tested / found. */
  readonly stats = { hulls: 0, stamps: 0, dropped: 0, candidates: 0, crests: 0 };

  private frame = 0;
  private readonly hulls = new Map<number, HullState>();
  private readonly spare: HullState[] = [];
  private readonly splashes: number[] = [];
  private splashCount = 0;
  private readonly sample: LagrangianSample = newLagrangianSample();
  private readonly random = rng(0x5f0a3);
  private candidateAcc = 0;
  /* The dragon's swept furrow. */
  private furrowX = NaN;
  private furrowZ = NaN;
  private swimX = NaN;
  private swimZ = NaN;

  constructor() {
    for (let i = 0; i < SPRAY.maxSources; i++) this.sprays.push(newSpray());
  }

  hull(source: number, x: number, z: number, forwardX: number, forwardZ: number, speed: number, length: number, beam: number, draft: number, thrust: number, planing: number, bowHeave: number): void {
    if (!Number.isFinite(x + z + forwardX + forwardZ + speed + length + beam + draft)) return;
    const fl = Math.hypot(forwardX, forwardZ);
    if (!(fl > 1e-6) || !(length > 0) || !(beam > 0)) return;
    let h = this.hulls.get(source);
    const fx = forwardX / fl;
    const fz = forwardZ / fl;
    const sx = x - fx * length * 0.5;
    const sz = z - fz * length * 0.5;
    if (!h) {
      h = this.spare.pop() ?? { frame: 0, x: 0, z: 0, fx: 0, fz: 0, speed: 0, length: 0, beam: 0, draft: 0, thrust: 0, planing: 0, bowHeave: 0, hist: new Float64Array(HIST * 2), count: 0, head: 0, spacing: 1 };
      h.count = 0;
      this.hulls.set(source, h);
    }
    // A double-ender swapping ends or a teleport restarts the wash history.
    if (h.count > 0 && (fx * h.fx + fz * h.fz < 0 || Math.hypot(sx - h.hist[h.head * 2], sz - h.hist[h.head * 2 + 1]) > h.spacing * 12)) {
      h.count = 0;
    }
    h.frame = this.frame;
    h.x = x;
    h.z = z;
    h.fx = fx;
    h.fz = fz;
    h.speed = Math.max(0, speed);
    h.length = length;
    h.beam = beam;
    h.draft = draft;
    h.thrust = Number.isFinite(thrust) ? Math.min(1, Math.max(0, thrust)) : 0;
    h.planing = Number.isFinite(planing) ? Math.min(1, Math.max(0, planing)) : 0;
    h.bowHeave = Number.isFinite(bowHeave) ? bowHeave : 0;
    h.spacing = Math.max(4, Math.min(length / 3, 25));
    if (h.count === 0) {
      h.head = 0;
      h.hist[0] = sx;
      h.hist[1] = sz;
      h.count = 1;
    } else if (Math.hypot(sx - h.hist[h.head * 2], sz - h.hist[h.head * 2 + 1]) >= h.spacing) {
      h.head = (h.head + 1) % HIST;
      h.hist[h.head * 2] = sx;
      h.hist[h.head * 2 + 1] = sz;
      h.count = Math.min(h.count + 1, HIST);
    }
  }

  splash(x: number, z: number, strength: number): void {
    if (!Number.isFinite(x + z + strength) || strength <= 0) return;
    if (this.splashCount * 3 + 3 > this.splashes.length) {
      if (this.splashCount >= 32) return;
      this.splashes.push(0, 0, 0);
    }
    const o = this.splashCount * 3;
    this.splashes[o] = x;
    this.splashes[o + 1] = z;
    this.splashes[o + 2] = strength;
    this.splashCount++;
  }

  /**
   * Starts a frame (water update): forgets hulls not heard from, and rebuilds the spray sources from the hulls of the
   * last frame and spindrift found around the camera (`waves` null: no spindrift). Spindrift uses the same whitecap
   * criterion as what the player sees: the field's set on its grid (`texel` > 0) or the shader-only set (`texel` 0),
   * at the breaking cells' clock `capTime`.
   */
  beginFrame(dt: number, capTime: number, camX: number, camZ: number, camFx: number, camFz: number, waves: WaveQuery | null, model: WhitecapModel, texel: number, windX: number, windZ: number, u10: number): void {
    this.coverage = model.coverage;
    this.sprayCount = 0;
    this.stats.candidates = 0;
    this.stats.crests = 0;
    const forgetFrames = Math.max(2, Math.round(HULL_FOAM.forget / Math.max(dt, 1 / 240)));
    for (const [id, h] of this.hulls) {
      if (this.frame - h.frame > forgetFrames) {
        this.hulls.delete(id);
        this.spare.push(h);
      }
    }
    // Hull spray from last frame's hull states (hulls near the camera only).
    for (const h of this.hulls.values()) {
      if (h.frame !== this.frame || Math.hypot(h.x - camX, h.z - camZ) > SPRAY.hullRange) continue;
      this.hullSpray(h, waves);
    }
    this.frame++;
    // Spindrift: crest points sampled around the camera (ahead of it mostly), a steady rate per second.
    const S = SPRAY;
    const tear = smoothstep(S.spindriftFrom, S.spindriftFull, u10);
    const wl = Math.hypot(windX, windZ);
    const set = texel > 0 ? model.sim : model.shader;
    if (!waves || tear <= 0 || !(wl > 1e-6) || !(dt > 0) || set.prob <= 0) {
      this.candidateAcc = 0;
      return;
    }
    const dx = windX / wl;
    const dz = windZ / wl;
    this.candidateAcc += S.candidates * 60 * this.sprayQuality * Math.min(dt, 0.1);
    let n = Math.floor(this.candidateAcc);
    this.candidateAcc -= n;
    const fl = Math.hypot(camFx, camFz);
    const ax = fl > 1e-6 ? camFx / fl : dx;
    const az = fl > 1e-6 ? camFz / fl : dz;
    const s = this.sample;
    const fade = texel > 0 ? (lambda: number): number => slotFade(lambda, texel) : undefined;
    while (n-- > 0 && this.sprayCount < S.maxSources) {
      // Uniform in a disk, shifted ahead of the camera by half the radius.
      const r = S.radius * Math.sqrt(this.random());
      const a = this.random() * Math.PI * 2;
      const x = camX + ax * S.radius * 0.5 + Math.cos(a) * r;
      const z = camZ + az * S.radius * 0.5 + Math.sin(a) * r;
      this.stats.candidates++;
      waves.lagrangianAt(x, z, s, fade);
      if (s.keep < 0.99 || !(s.sigmaJ > 1e-5)) continue;
      if (s.jacobian >= crestThreshold(s.sigmaJ, s.nEff)) continue;
      const prob = localBreakProbability(set.prob, model.omegaOpen, s.omega);
      if (!breakCell(x, z, capTime, dx, dz, cellSpeed(s.omega), prob)) continue;
      this.stats.crests++;
      const o = this.sprays[this.sprayCount++];
      o.kind = 'spindrift';
      o.x = x;
      o.y = s.height;
      o.z = z;
      const c = cellSpeed(s.omega);
      o.vx = dx * c;
      o.vy = 0;
      o.vz = dz * c;
      o.dirX = dx;
      o.dirZ = dz;
      o.strength = tear * Math.min(1, 0.4 + s.hs / 2.5);
      o.size = Math.min(8, 1.5 + s.hs * 2.5);
    }
  }

  private hullSpray(h: HullState, waves: WaveQuery | null): void {
    const S = SPRAY;
    if (this.sprayCount >= S.maxSources) return;
    const u = h.speed;
    const bowFactor = smoothstep(S.bowFrom, S.bowFull, u);
    if (bowFactor > 0) {
      let chop = 0;
      const bx = h.x + h.fx * h.length * 0.5;
      const bz = h.z + h.fz * h.length * 0.5;
      let by = 0;
      if (waves) {
        waves.lagrangianAt(bx, bz, this.sample);
        chop = Math.min(1, this.sample.hs / 0.8);
        by = this.sample.height;
      }
      const slam = Math.min(1, Math.abs(h.bowHeave) / 2);
      const strength = Math.min(1, bowFactor * (0.25 + 0.6 * chop + 0.6 * slam) * (1 - 0.5 * h.planing));
      if (strength > 0.02) {
        for (let side = -1; side <= 1 && this.sprayCount < S.maxSources; side += 2) {
          const o = this.sprays[this.sprayCount++];
          o.kind = 'bow';
          const px = -h.fz * side;
          const pz = h.fx * side;
          o.x = bx - h.fx * h.length * 0.08 + px * h.beam * 0.4;
          o.y = by;
          o.z = bz - h.fz * h.length * 0.08 + pz * h.beam * 0.4;
          o.vx = h.fx * u;
          o.vy = 0;
          o.vz = h.fz * u;
          o.dirX = px * 0.8 + h.fx * 0.2;
          o.dirZ = pz * 0.8 + h.fz * 0.2;
          o.strength = strength;
          o.size = h.beam;
        }
      }
    }
    const prop = smoothstep(S.propFrom, S.propFull, u) * h.planing * (0.4 + 0.6 * h.thrust);
    if (prop > 0.02 && this.sprayCount < S.maxSources) {
      const o = this.sprays[this.sprayCount++];
      o.kind = 'prop';
      o.x = h.x - h.fx * h.length * 0.52;
      o.y = 0;
      o.z = h.z - h.fz * h.length * 0.52;
      o.vx = h.fx * u;
      o.vy = 0;
      o.vz = h.fz * u;
      o.dirX = -h.fx;
      o.dirZ = -h.fz;
      o.strength = prop;
      o.size = h.beam;
    }
  }

  /**
   * Turns this frame's hulls, splashes and the dragon into stamps for `win` (the water's preRender) and publishes the
   * window placement.
   */
  flush(win: FoamWindow, dragon: DragonFoamInput | null, waterHeight: ((x: number, z: number) => number) | null): void {
    this.window.x = win.minX + win.extent * 0.5;
    this.window.z = win.minZ + win.extent * 0.5;
    this.window.halfExtent = win.enabled ? win.extent * 0.5 : 0;
    const before = win.count;
    this.stats.hulls = 0;
    if (win.enabled) {
      const frame = this.frame - 1;
      const reach = this.window.halfExtent + 60;
      for (const h of this.hulls.values()) {
        if (h.frame !== frame && h.frame !== this.frame) continue;
        if (Math.max(Math.abs(h.x - this.window.x), Math.abs(h.z - this.window.z)) > reach + 1.5 * h.length) continue;
        this.hullStamps(win, h);
        this.stats.hulls++;
      }
      for (let i = 0; i < this.splashCount; i++) {
        const o = i * 3;
        const D = DRAGON_FOAM;
        const s = this.splashes[o + 2];
        const r = D.splashRadius + D.splashRadiusPer * Math.min(s, 3);
        const level = Math.min(1, D.splashFoam * s);
        win.stamp(this.splashes[o], this.splashes[o + 1], this.splashes[o], this.splashes[o + 1], r, r, 0, level, level * 0.5, level, 0);
      }
      if (dragon) {
        this.dragonStamps(win, dragon, waterHeight);
      }
    }
    this.splashCount = 0;
    this.stats.stamps = win.count - before;
    this.stats.dropped = win.dropped;
  }

  private hullStamps(win: FoamWindow, h: HullState): void {
    const H = HULL_FOAM;
    const u = h.speed;
    if (u < H.minSpeed) return;
    const L = h.length;
    const B = h.beam;
    const fx = h.fx;
    const fz = h.fz;
    const px = -fz;
    const pz = fx;
    const drive = smoothstep(H.minSpeed, H.washFull, u);
    const wash = Math.min(1, (H.washBase + H.washThrust * h.thrust) * drive);
    const sx = h.x - fx * L * 0.5;
    const sz = h.z - fz * L * 0.5;
    // Stern turbulence.
    const rs = H.sternRadius * B;
    win.stamp(sx, sz, sx, sz, rs, rs, 0, 0.7 * wash, wash, H.washBubbles * wash, 0);
    // Propeller wash along the recent track: current stern, then the history (newest first).
    const washLen = Math.max(1.2 * L, 25);
    let ax = sx;
    let az = sz;
    let d = 0;
    const r0 = 0.5 * H.washWidth * B;
    for (let k = 0; k < h.count && d < washLen; k++) {
      const idx = ((h.head - k) % HIST + HIST) % HIST;
      let bx = h.hist[idx * 2];
      let bz = h.hist[idx * 2 + 1];
      let seg = Math.hypot(bx - ax, bz - az);
      if (seg < 0.5) continue;
      if (d + seg > washLen) {
        const f = (washLen - d) / seg;
        bx = ax + (bx - ax) * f;
        bz = az + (bz - az) * f;
        seg = washLen - d;
      }
      const d1 = d + seg;
      const ra = r0 + H.washSpread * d;
      const rb = r0 + H.washSpread * d1;
      const fresh = 1 - d1 / washLen;
      win.stamp(ax, az, bx, bz, ra, rb, 0, 0.5 * wash * fresh, wash * (1 - 0.3 * d1 / washLen), H.washBubbles * wash * fresh, H.washSlick * wash);
      ax = bx;
      az = bz;
      d = d1;
    }
    // Bow roll along both sides of the forefoot.
    const fr = u / Math.sqrt(9.81 * Math.max(L, 1));
    const bow = Math.min(1, (fr / H.frBow) ** 2) * smoothstep(1.5, 4, u) * (1 - 0.6 * h.planing);
    if (bow > 0.02) {
      const bx = h.x + fx * L * 0.5;
      const bz = h.z + fz * L * 0.5;
      const rb = H.bowWidth * B + H.bowWidthSpeed * u;
      for (let side = -1; side <= 1; side += 2) {
        const x0 = bx - fx * 0.03 * L + px * side * B * 0.3;
        const z0 = bz - fz * 0.03 * L + pz * side * B * 0.3;
        const x1 = bx - fx * H.bowLength * L + px * side * (B * 0.55 + rb * 0.5);
        const z1 = bz - fz * H.bowLength * L + pz * side * (B * 0.55 + rb * 0.5);
        win.stamp(x0, z0, x1, z1, rb * 0.6, rb, 0, bow, 0.35 * bow, 0.7 * bow, 0);
      }
    }
    // Planing craft: spray sheets off the aft chines.
    if (h.planing > 0.05) {
      const lv = 0.8 * h.planing * drive;
      for (let side = -1; side <= 1; side += 2) {
        const x0 = h.x + fx * (0.5 - H.chineFrom) * L + px * side * B * 0.5;
        const z0 = h.z + fz * (0.5 - H.chineFrom) * L + pz * side * B * 0.5;
        const x1 = sx + px * side * (B * 0.5 + 0.6);
        const z1 = sz + pz * side * (B * 0.5 + 0.6);
        win.stamp(x0, z0, x1, z1, 0.5, 0.9, 0, lv, 0.4 * lv, 0.6 * lv, 0);
      }
    }
  }

  private dragonStamps(win: FoamWindow, g: DragonFoamInput, waterHeight: ((x: number, z: number) => number) | null): void {
    const D = DRAGON_FOAM;
    const low = g.low;
    // Skim furrow, swept from last frame's point.
    if (low && low.active && low.wake > 0.05) {
      const p = low.surfacePoint;
      const w = low.wake;
      const r = 0.5 * D.furrowWidth * (0.5 + 0.5 * w);
      const x0 = Number.isFinite(this.furrowX) && Math.hypot(p.x - this.furrowX, p.z - this.furrowZ) < 60 ? this.furrowX : p.x;
      const z0 = Number.isFinite(this.furrowX) && Math.hypot(p.x - this.furrowX, p.z - this.furrowZ) < 60 ? this.furrowZ : p.z;
      const lv = D.furrowFoam * w;
      win.stamp(x0, z0, p.x, p.z, r, r, 0, lv, 0.8 * lv, lv, 0.4 * lv);
      this.furrowX = p.x;
      this.furrowZ = p.z;
    } else {
      this.furrowX = NaN;
    }
    if (low && low.active) {
      // Spray falling back at the downwash ring's edge.
      if (low.edgeSpray > 0.05) {
        const p = low.surfacePoint;
        const lv = D.washFoam * low.edgeSpray;
        win.stamp(p.x, p.z, p.x, p.z, D.washRing * g.wingspan, D.washRing * g.wingspan, 3, lv, 0.4 * lv, 0.6 * lv, 0);
      }
      // The fire boiling the sea.
      if (low.steam > 0.05) {
        const q = low.steamPoint;
        const lv = D.steamFoam * low.steam;
        win.stamp(q.x, q.z, q.x, q.z, D.steamRadius, D.steamRadius, 0, lv, 0.5 * lv, lv, 0);
      }
    }
    if (g.mode === 'swimming') {
      const p = g.position;
      const v = g.velocity;
      const sp = Math.hypot(v.x, v.z);
      if (sp > 0.5) {
        const fx = v.x / sp;
        const fz = v.z / sp;
        const tx = p.x - fx * D.swimLength * 0.45;
        const tz = p.z - fz * D.swimLength * 0.45;
        const x0 = Number.isFinite(this.swimX) && Math.hypot(tx - this.swimX, tz - this.swimZ) < 30 ? this.swimX : tx;
        const z0 = Number.isFinite(this.swimX) && Math.hypot(tx - this.swimX, tz - this.swimZ) < 30 ? this.swimZ : tz;
        const lv = Math.min(1, 0.15 + sp * 0.12);
        win.stamp(x0, z0, tx, tz, D.swimBeam * 0.35, D.swimBeam * 0.35, 0, 0.6 * lv, lv, 0.7 * lv, 0.3 * lv);
        this.swimX = tx;
        this.swimZ = tz;
      } else {
        this.swimX = NaN;
      }
      if (g.tips && waterHeight) {
        for (const tip of g.tips) {
          const hw = waterHeight(tip.x, tip.z);
          const depth = hw - tip.y;
          if (depth > -D.strokeDepth && depth < 2.5) {
            const lv = D.strokeFoam * Math.min(1, (depth + D.strokeDepth) / (2 * D.strokeDepth));
            win.stamp(tip.x, tip.z, tip.x, tip.z, D.strokeRadius, D.strokeRadius, 0, lv, 0.5 * lv, lv, 0);
          }
        }
      }
    } else {
      this.swimX = NaN;
    }
  }

  /** Forgets every hull and pending splash. */
  clear(): void {
    this.hulls.clear();
    this.splashCount = 0;
    this.sprayCount = 0;
    this.furrowX = NaN;
    this.swimX = NaN;
  }

  /** Hulls tracked (diagnostics). */
  get hullCount(): number {
    return this.hulls.size;
  }
}
