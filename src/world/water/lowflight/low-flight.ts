/**
 * The sea reacting to low flight (phase 21 stage 2), CPU side: from the dragon's state, its rig anchors (wingtips,
 * tail, mouth) and the water service it works out, once per frame, how much downwash, skim wake, wingtip vortex and
 * fire steam reach the water and where, and queues the matching stamps into the disturbance window. It is the
 * `lowFlight` service (LowFlightView): fx and audio read the same numbers the water surface draws.
 *
 * Cost: one isWater query per frame; one wave-height query while the dragon is within ~LOW_FLIGHT.queryHeight of
 * the sea; a handful more (wingtips, tail, the fire ray) only while low.
 */
import * as THREE from 'three';
import type { FlightMode, LowFlightView, WaterService } from '../../../core/contracts';
import { DISTURBANCE_SIM, DISTURBANCE_STAMPS, LOW_FLIGHT } from './config';
import type { DisturbanceWindow } from './disturbance-window';

/** Dragon state the model reads each frame (DragonState plus rig anchors in world space). */
export interface LowFlightInput {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  quaternion: THREE.Quaternion;
  mode: FlightMode;
  airspeed: number;
  flapEffort: number;
  firing: boolean;
  touchingWater: boolean;
  wingspan: number;
  length: number;
  height: number;
  /** World positions of the wingtips (left, right), the tail tip and the mouth, and the mouth's unit direction. */
  tips: [THREE.Vector3, THREE.Vector3];
  tail: THREE.Vector3;
  mouth: THREE.Vector3;
  mouthDir: THREE.Vector3;
}

export interface LowFlightWorld {
  water: WaterService | null;
  isWater(x: number, z: number): boolean;
}

export function createLowFlightInput(): LowFlightInput {
  return {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    mode: 'flying',
    airspeed: 0,
    flapEffort: 0,
    firing: false,
    touchingWater: false,
    wingspan: 24,
    length: 18.3,
    height: 4.4,
    tips: [new THREE.Vector3(), new THREE.Vector3()],
    tail: new THREE.Vector3(),
    mouth: new THREE.Vector3(),
    mouthDir: new THREE.Vector3(0, 0, -1),
  };
}

const _m = new THREE.Matrix4();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/** Anchors from the body transform and dimensions (headless, or a rig that is not built yet): wings level, spread. */
export function fallbackAnchors(input: LowFlightInput): void {
  _m.makeRotationFromQuaternion(input.quaternion);
  _right.setFromMatrixColumn(_m, 0);
  _up.setFromMatrixColumn(_m, 1);
  _fwd.setFromMatrixColumn(_m, 2).negate();
  const p = input.position;
  input.tips[0].copy(p).addScaledVector(_right, -0.5 * input.wingspan);
  input.tips[1].copy(p).addScaledVector(_right, 0.5 * input.wingspan);
  input.tail.copy(p).addScaledVector(_fwd, -0.55 * input.length).addScaledVector(_up, -0.1 * input.height);
  input.mouth.copy(p).addScaledVector(_fwd, 0.5 * input.length).addScaledVector(_up, 0.3 * input.height);
  input.mouthDir.copy(_fwd);
}

interface Gust {
  x: number;
  z: number;
  age: number;
  strength: number;
}

const smooth = THREE.MathUtils.smoothstep;
/** No wave crest is higher than this (m): above queryHeight + this the model skips the wave query. */
const MAX_WAVE_HEIGHT = 10;

/**
 * Swept stamps (capsules from last frame's point to this one) overlap their neighbours by about their radius at each
 * end, so a point on the path is covered by (L + 2 r_eff) / L of them: scaling each by the inverse makes the amount
 * per pass independent of speed and frame rate.
 */
function sweepShare(x0: number, z0: number, x1: number, z1: number, radius: number): number {
  const len = Math.hypot(x1 - x0, z1 - z0);
  return len / (len + 1.4 * radius + 1e-3);
}
const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);
const finite01 = (v: number): number => (Number.isFinite(v) ? clamp01(v) : 0);

/** Exponential approach with separate attack / release time constants. */
function follow(current: number, target: number, dt: number, attack: number, release: number): number {
  const tau = target > current ? attack : release;
  const next = current + (target - current) * (1 - Math.exp(-dt / Math.max(tau, 1e-3)));
  return next < 5e-3 && target === 0 ? 0 : next;
}

export class LowFlightModel implements LowFlightView {
  active = false;
  height = Infinity;
  downwash = 0;
  downwashPulse = 0;
  edgeSpray = 0;
  wake = 0;
  vortex = 0;
  readonly tipVortex: [number, number] = [0, 0];
  steam = 0;
  readonly steamPoint = new THREE.Vector3();
  readonly surfacePoint = new THREE.Vector3();
  readonly heading = new THREE.Vector3(0, 0, -1);
  speed = 0;
  readonly tipHeight: [number, number] = [Infinity, Infinity];
  readonly tipPoint: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  tailHeight = Infinity;
  readonly tailPoint = new THREE.Vector3();

  /** Diagnostics for checks: flaps that pushed a gust ring, gust rings alive, stamps queued this frame. */
  gustsSpawned = 0;
  stampsQueued = 0;
  /** Fire jet meets the water this frame (before smoothing). */
  steamHit = false;

  private readonly pendingFlaps: number[] = [];
  private readonly gusts: Gust[] = [];
  private readonly prevWake = { valid: false, x: 0, z: 0 };
  private readonly prevTips = [
    { valid: false, x: 0, z: 0 },
    { valid: false, x: 0, z: 0 },
  ];
  private readonly prevTail = { valid: false, x: 0, z: 0 };

  get gustCount(): number {
    return this.gusts.length;
  }

  /** A downstroke started (flight 'flap' event, strength 0..1); handled in the next update. */
  onFlap(strength: number): void {
    if (Number.isFinite(strength) && strength > 0 && this.pendingFlaps.length < 4) {
      this.pendingFlaps.push(Math.min(strength, 1.5));
    }
  }

  reset(): void {
    this.active = false;
    this.height = Infinity;
    this.downwash = 0;
    this.downwashPulse = 0;
    this.edgeSpray = 0;
    this.wake = 0;
    this.vortex = 0;
    this.tipVortex[0] = 0;
    this.tipVortex[1] = 0;
    this.steam = 0;
    this.speed = 0;
    this.tipHeight[0] = Infinity;
    this.tipHeight[1] = Infinity;
    this.tailHeight = Infinity;
    this.pendingFlaps.length = 0;
    this.gusts.length = 0;
    this.prevWake.valid = false;
    this.prevTips[0].valid = false;
    this.prevTips[1].valid = false;
    this.prevTail.valid = false;
  }

  /**
   * One frame. `input` null (no dragon) resets everything. `window` receives the stamps (null or disabled: the model
   * still computes every value for the sprays and the sound).
   */
  update(dt: number, input: LowFlightInput | null, world: LowFlightWorld, window: DisturbanceWindow | null): void {
    this.stampsQueued = 0;
    this.steamHit = false;
    if (!input || !(dt >= 0)) {
      this.reset();
      return;
    }
    const L = LOW_FLIGHT;
    const S = DISTURBANCE_STAMPS;
    const p = input.position;
    const flaps = this.pendingFlaps;
    const span = Math.max(input.wingspan, 1);
    const vx = input.velocity.x;
    const vz = input.velocity.z;
    const hs = Math.hypot(vx, vz);
    this.speed = Number.isFinite(hs) ? hs : 0;
    if (hs > 0.5) {
      this.heading.set(vx / hs, 0, vz / hs);
    }
    this.downwashPulse *= Math.exp(-dt / L.pulseDecay);
    this.ageGusts(dt);

    const mode = input.mode;
    const bodyOk = Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
    const over = bodyOk && mode !== 'underwater' && mode !== 'grounded' && world.isWater(p.x, p.z);
    let surfaceY = 0;
    let height = Infinity;
    if (over && p.y > L.queryHeight + MAX_WAVE_HEIGHT) {
      // Well above any wave: no wave query (the height is only approximate up here, and nothing is low).
      height = p.y;
    } else if (over) {
      surfaceY = world.water ? world.water.heightAt(p.x, p.z) : 0;
      if (!Number.isFinite(surfaceY)) {
        surfaceY = 0;
      }
      height = p.y - surfaceY;
    }
    const low = over && height < L.queryHeight;
    this.height = over ? height : Infinity;
    this.surfacePoint.set(p.x, surfaceY, p.z);

    // ---- downwash ----
    let downwash = 0;
    let gate = 0;
    let reachF = 0;
    const airborne = mode !== 'swimming';
    if (low && airborne) {
      const hoverish = mode === 'hovering' || mode === 'landing' || mode === 'takeoff' || mode === 'stalling';
      const slow = 1 - smooth(input.airspeed, L.slowFull, L.slowNone);
      gate = Math.max(hoverish ? L.hoverFloor : 0, slow);
      reachF = 1 - smooth(height, L.downwashFull * span, L.downwashReach * span);
      downwash = finite01(gate * reachF * (L.effortBase + (1 - L.effortBase) * finite01(input.flapEffort)));
      // Spray whipped up at the ring's edge needs the air to spread along the water: a hover or nearly so.
      const pulseIn = hoverish ? 1 : smooth(slow, 0.6, 0.95);
      this.edgeSpray = finite01(smooth(downwash, L.edgeSprayFrom, L.edgeSprayFull) * pulseIn * (0.6 + 0.4 * Math.min(1, this.downwashPulse * 1.5)));
    } else {
      this.edgeSpray = 0;
    }
    this.downwash = downwash;
    for (const strength of flaps) {
      const s = finite01(strength * gate * reachF);
      if (s < 0.02) {
        continue;
      }
      this.downwashPulse = Math.max(this.downwashPulse, s);
      this.gustsSpawned++;
      if (this.gusts.length >= L.maxGusts) {
        this.gusts.shift();
      }
      this.gusts.push({ x: p.x, z: p.z, age: 0, strength: s });
      if (window) {
        // The downstroke's air pushes the water down: the wave equation turns the dent into an expanding ripple ring.
        this.queue(window, p.x, p.z, p.x, p.z, L.gustRadius * span * 1.2, 0, -S.downstrokeDepth * s, 0.15 * s, 0, 0.25);
      }
    }
    flaps.length = 0;
    if (!low) {
      this.downwashPulse = 0;
      this.gusts.length = 0;
    }

    // ---- skim wake ----
    let wakeTarget = 0;
    if (low && airborne && this.speed > L.wakeSpeedFrom) {
      const belly = height - input.height * 0.35;
      const contact = input.touchingWater ? 1 : 1 - smooth(belly, L.wakeBellyFull, L.wakeBellyNone);
      wakeTarget = finite01(contact * smooth(this.speed, L.wakeSpeedFrom, L.wakeSpeedFull));
    }
    this.wake = finite01(follow(this.wake, wakeTarget, dt, L.wakeAttack, L.wakeRelease));

    // ---- wingtips and tail (queried only when they can be near the water: a banked wingtip hangs up to half a span
    // below the body) ----
    const tipsNear = low && height < span * 1.1;
    let vortex = 0;
    for (let i = 0; i < 2; i++) {
      const tip = input.tips[i];
      let tipH = Infinity;
      let tv = 0;
      if (tipsNear && this.tipOverWater(tip, world)) {
        const ty = world.water ? world.water.heightAt(tip.x, tip.z) : 0;
        tipH = tip.y - (Number.isFinite(ty) ? ty : 0);
        this.tipPoint[i].set(tip.x, Number.isFinite(ty) ? ty : 0, tip.z);
        if (airborne && this.speed > L.vortexSpeedFrom) {
          tv = finite01((1 - smooth(tipH, L.vortexTipFull * span, L.vortexTipReach * span)) * smooth(this.speed, L.vortexSpeedFrom, L.vortexSpeedFull));
        }
      }
      this.tipHeight[i] = tipH;
      this.tipVortex[i] = tv;
      vortex = Math.max(vortex, tv);
    }
    this.vortex = vortex;
    let tailH = Infinity;
    if (tipsNear && airborne && this.tipOverWater(input.tail, world)) {
      const ty = world.water ? world.water.heightAt(input.tail.x, input.tail.z) : 0;
      tailH = input.tail.y - (Number.isFinite(ty) ? ty : 0);
      this.tailPoint.set(input.tail.x, Number.isFinite(ty) ? ty : 0, input.tail.z);
    }
    this.tailHeight = tailH;

    // ---- fire steam ----
    let steamTarget = 0;
    if (input.firing && bodyOk && mode !== 'grounded' && (over ? height < L.fireReach * 1.6 : true)) {
      steamTarget = this.traceFire(input, world);
    }
    this.steam = finite01(follow(this.steam, steamTarget, dt, L.steamAttack, L.steamRelease));

    this.active = this.downwash > 1e-3 || this.downwashPulse > 1e-3 || this.edgeSpray > 1e-3 || this.wake > 1e-3 || this.vortex > 1e-3 || this.steam > 1e-3;

    if (window && window.enabled) {
      this.writeStamps(dt, input, window, span);
    }
  }

  private tipOverWater(v: THREE.Vector3, world: LowFlightWorld): boolean {
    return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) && world.isWater(v.x, v.z);
  }

  private ageGusts(dt: number): void {
    const g = this.gusts;
    for (let i = g.length - 1; i >= 0; i--) {
      g[i].age += dt;
      if (g[i].age >= LOW_FLIGHT.gustLife) {
        g.splice(i, 1);
      }
    }
  }

  /** Gust ring radius (m) after `age` s: it starts under the wings and slows down as it spreads. */
  static gustRadius(age: number, span: number): number {
    const L = LOW_FLIGHT;
    return L.gustRadius * span + (L.gustSpeed * (1 - Math.exp(-L.gustSpeedDecay * age))) / L.gustSpeedDecay;
  }

  /**
   * Marches the fire jet (mouth along its direction, LOW_FLIGHT.fireReach × margin) against the wave surface.
   * Returns the steam strength 0..1 (closer = stronger) and sets steamPoint; 0 when the jet never meets the sea.
   */
  private traceFire(input: LowFlightInput, world: LowFlightWorld): number {
    const L = LOW_FLIGHT;
    const m = input.mouth;
    const d = input.mouthDir;
    const len = Math.hypot(d.x, d.y, d.z);
    if (!(len > 1e-6) || !Number.isFinite(m.x + m.y + m.z)) {
      return 0;
    }
    const waterAt = (x: number, z: number): number => (world.water ? world.water.heightAt(x, z) : 0);
    const dx = d.x / len;
    const dy = d.y / len;
    const dz = d.z / len;
    // Breathing fire with the mouth under the surface: the water boils right at the mouth.
    if (world.isWater(m.x, m.z) && m.y < waterAt(m.x, m.z) + 0.3) {
      this.steamHit = true;
      this.steamPoint.set(m.x, waterAt(m.x, m.z), m.z);
      return 1;
    }
    if (dy > 0.05) {
      return 0;
    }
    const reach = L.fireReach * L.fireReachMargin;
    const n = L.fireSteps;
    let t0 = 0;
    for (let i = 1; i <= n; i++) {
      const t = (reach * i) / n;
      const x = m.x + dx * t;
      const y = m.y + dy * t;
      const z = m.z + dz * t;
      if (!world.isWater(x, z)) {
        // Land or a quay in the way (the fire emitter's own raycast handles burn smoke there).
        if (y < 3) {
          return 0;
        }
        t0 = t;
        continue;
      }
      if (y <= waterAt(x, z)) {
        let a = t0;
        let b = t;
        for (let k = 0; k < L.fireRefine; k++) {
          const mid = (a + b) * 0.5;
          const my = m.y + dy * mid;
          if (my <= waterAt(m.x + dx * mid, m.z + dz * mid)) {
            b = mid;
          } else {
            a = mid;
          }
        }
        const hx = m.x + dx * b;
        const hz = m.z + dz * b;
        this.steamPoint.set(hx, waterAt(hx, hz), hz);
        this.steamHit = true;
        // Full boil within ~45 % of the reach, weaker toward the jet's end (the flame has mostly burnt out there).
        return 0.25 + 0.75 * (1 - smooth(b, 0.45 * reach, reach));
      }
      t0 = t;
    }
    return 0;
  }

  private queue(w: DisturbanceWindow, x0: number, z0: number, x1: number, z1: number, radius: number, ring: number, height: number, rough: number, foam: number, noise: number): void {
    if (w.stamp(x0, z0, x1, z1, radius, ring, height, rough, foam, noise)) {
      this.stampsQueued++;
    }
  }

  private writeStamps(dt: number, input: LowFlightInput, w: DisturbanceWindow, span: number): void {
    const S = DISTURBANCE_STAMPS;
    const L = LOW_FLIGHT;
    const sp = this.surfacePoint;

    // Downwash: a ruffled, darkened patch under the wings (wider the higher the dragon is) and the gust rings racing out.
    if (this.downwash > 1e-3 && dt > 0) {
      const reachShare = clamp01(this.height / (L.downwashReach * span));
      const radius = span * (0.35 + 0.25 * reachShare);
      this.queue(w, sp.x, sp.z, sp.x, sp.z, radius, 0, S.downwashRuffle * this.downwash * dt, S.downwashRough * this.downwash * dt, 0, 1);
    }
    for (const g of this.gusts) {
      const life = 1 - g.age / L.gustLife;
      const k = g.strength * life * Math.sqrt(life);
      if (k < 0.01 || dt <= 0) continue;
      const r = LowFlightModel.gustRadius(g.age, span);
      this.queue(w, g.x, g.z, g.x, g.z, r + L.gustRingWidth * 0.5, L.gustRingWidth, 0, S.gustRough * k * dt, 0, 0.6);
    }

    // Skim wake: a furrow along the path (depression + foam + roughness) and a wider roughened strip.
    const wakeOn = this.wake > 0.02;
    if (wakeOn) {
      // Contact point: under the belly, a little behind the centre of mass.
      const cx = sp.x - this.heading.x * input.length * 0.1;
      const cz = sp.z - this.heading.z * input.length * 0.1;
      const pw = this.prevWake;
      if (pw.valid && Math.hypot(cx - pw.x, cz - pw.z) < 40) {
        const k = this.wake;
        const r = 0.9 + 0.02 * this.speed;
        const a = k * sweepShare(pw.x, pw.z, cx, cz, r);
        const b = k * sweepShare(pw.x, pw.z, cx, cz, r * 3.2);
        this.queue(w, pw.x, pw.z, cx, cz, r, 0, -S.furrowDepth * a, S.furrowRough * a, S.furrowFoam * a, 0.35);
        this.queue(w, pw.x, pw.z, cx, cz, r * 3.2, 0, 0, S.furrowStripRough * b, 0, 0.6);
      }
      pw.valid = true;
      pw.x = cx;
      pw.z = cz;
    } else {
      this.prevWake.valid = false;
    }

    // Wingtip vortices: roughened streaks under each tip; a tip kissing the water leaves foam and a small furrow.
    for (let i = 0; i < 2; i++) {
      const tv = this.tipVortex[i];
      const kiss = 1 - smooth(this.tipHeight[i], 0.15, 0.8);
      const prev = this.prevTips[i];
      if (tv > 0.02 || kiss > 0.02) {
        const tp = this.tipPoint[i];
        if (prev.valid && Math.hypot(tp.x - prev.x, tp.z - prev.z) < 40) {
          const r = 1.1 + 1.4 * tv;
          const share = sweepShare(prev.x, prev.z, tp.x, tp.z, r);
          this.queue(w, prev.x, prev.z, tp.x, tp.z, r, 0, -S.kissDepth * kiss * share, (S.vortexRough * tv + 0.3 * kiss) * share, (S.vortexFoam * tv + S.kissFoam * kiss) * share, 0.7);
        }
        prev.valid = true;
        prev.x = tp.x;
        prev.z = tp.z;
      } else {
        prev.valid = false;
      }
    }
    const tailKiss = this.speed > 4 ? 1 - smooth(this.tailHeight, 0.1, 0.7) : 0;
    const pt = this.prevTail;
    if (tailKiss > 0.02) {
      const tp = this.tailPoint;
      if (pt.valid && Math.hypot(tp.x - pt.x, tp.z - pt.z) < 40) {
        const share = tailKiss * sweepShare(pt.x, pt.z, tp.x, tp.z, 0.8);
        this.queue(w, pt.x, pt.z, tp.x, tp.z, 0.8, 0, -S.kissDepth * share, 0.4 * share, S.kissFoam * share, 0.4);
      }
      pt.valid = true;
      pt.x = tp.x;
      pt.z = tp.z;
    } else {
      pt.valid = false;
    }

    // Fire steam: a boiling, foamy, roughened patch where the jet meets the water.
    if (this.steam > 1e-3 && dt > 0) {
      const st = this.steamPoint;
      this.queue(w, st.x, st.z, st.x, st.z, 2.5 + 2 * this.steam, 0, S.steamJitter * this.steam * dt, S.steamRough * this.steam * dt, S.steamFoam * this.steam * dt, 1);
    }
  }

  /**
   * Window centre for a frame (call before update, it only needs the body): the dragon, trailed back along a fast
   * path so more of the wake stays in view.
   */
  static windowCentre(position: THREE.Vector3, velocity: THREE.Vector3, extent: number, out: { x: number; z: number }): { x: number; z: number } {
    const hs = Math.hypot(velocity.x, velocity.z);
    const trail = hs > 0.5 ? (DISTURBANCE_SIM.trailShare * extent * clamp01(hs / DISTURBANCE_SIM.trailSpeed)) / hs : 0;
    out.x = position.x - velocity.x * trail;
    out.z = position.z - velocity.z * trail;
    return out;
  }
}
