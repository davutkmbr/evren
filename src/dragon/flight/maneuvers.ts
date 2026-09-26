import * as THREE from 'three';
import type { FlightMode } from '../../core/contracts';
import { clamp, lerp, smoothstep } from '../../core/math/noise';
import { airDensity, ceilingFactor } from './aero';
import { DEG, GRAVITY, MASS, PROXIMITY, TRICKS, WING } from './params';
import type { ControlTargets } from './controller';
import type { FlightSim } from './sim';
import type { ManeuverId, PilotCommand } from './types';

/** Tricks that replace the normal control law while they run. The urge runs on top of the normal law. */
export type TrickKind = 'none' | 'roll' | 'loop' | 'drop' | 'catch';

const TWO_PI = Math.PI * 2;
/** Turkish captions of the maneuvers (the HUD shows them briefly). */
export const MANEUVER_LABELS: Record<Exclude<ManeuverId, 'hint'>, string> = {
  roll: 'Takla',
  loop: 'Looping',
  freefall: 'Serbest düşüş',
  catch: 'Kanatlar açıldı',
  urge: 'Dehh!',
  takeoff: 'Kalkış',
  land: 'İniş',
  plunge: 'Dalış',
  breach: 'Fırlama',
};

/** Largest angle of attack the tricks ask for (a margin below the stall). */
const ALPHA_MAX = WING.stall - 2.5 * DEG - WING.incidence;
const ALPHA_MIN = WING.negStall + 3 * DEG - WING.incidence;
/** Pull-out prediction: attached-flow lift limit and drag area with the wings open (m²). */
const PREDICT_CL = 1.35;
const PREDICT_CDA = 5;
const PREDICT_INTERVAL = 0.05;
/** Roll: bank lead of the lift shaping (s), extra pull while upright (g per cos φ), angle-of-attack gain (1/s). */
const ROLL_LEAD = 0.12;
const ROLL_UPRIGHT_PULL = 1;
const ROLL_ALPHA_GAIN = 10;

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const _dir = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _cross = new THREE.Vector3();

/** Angle of attack that gives load factor `n` with the current wing (dynamic lift `boost` on top of the lift curve). */
function alphaForLoad(sim: FlightSim, n: number, boost = 0): number {
  const y = sim.body.position.y;
  const V = Math.max(sim.airspeed, 4);
  const qS = 0.5 * airDensity(y) * V * V * sim.wing.area * ceilingFactor(y) * (1 + boost);
  const cl = (n * MASS * GRAVITY) / Math.max(qS, 1);
  return (cl - WING.cl0) / Math.max(sim.wing.liftSlope, 1) - WING.incidence;
}

/** Body pitch rate that keeps the angle of attack while lift and gravity curve the flight path (rad/s). */
function pitchFeed(sim: FlightSim): number {
  return (GRAVITY * (sim.loadFactor - sim.axes.up.y)) / Math.max(sim.airspeed, 6);
}

/** Body yaw rate that follows the sideways curving of the flight path (no sideslip builds up). */
function yawFeed(sim: FlightSim): number {
  const lateral = sim.specificForce.dot(sim.axes.right) - GRAVITY * sim.axes.right.y;
  return -lateral / Math.max(sim.airspeed, 6);
}

/**
 * Rider-driven maneuvers: the barrel roll, the loop, the free-fall drop and its catch, and the urge ("dehh").
 * Starts them from pilot edges (double taps, V) and automatic triggers, runs their control laws in place of the
 * normal law, and exposes cue envelopes for the pose driver. Announcements and sounds go out as sim events.
 */
export class Maneuvers {
  kind: TrickKind = 'none';
  /** Seconds since the current trick started. */
  time = 0;
  /** Full revolutions of the current roll so far (continuous spin). */
  revolutions = 0;
  /** Seconds since the urge started (large when idle). */
  urgeTime = 99;
  /** Seconds since a trick finished (the rider cheers). */
  cheerTime = 99;

  private rollDir = 0;
  private rollEntryPath = 0;
  private rollTarget = 0;
  private rolled = 0;
  private rollRate = 0;
  private prevBank = 0;

  private readonly loopForward = new THREE.Vector3();
  private readonly loopRight = new THREE.Vector3();
  private loopAngle = 0;
  private prevLoopAngle = 0;

  private dropMin = 0;
  private catchTime = 0;
  private catchLoadStart = 1;
  private catchLoad: number = TRICKS.catchLoad;
  private catchExitPath = 0;
  private catchSpread = 1;
  private diveTime = 0;
  /** Shift stays ignored after a catch until it is released (Space caught a held dive). */
  private diveSuppressed = false;
  private predictTimer = 0;
  /** Height the pull-out would need if it started now (m), refreshed at 20 Hz while falling. */
  pullOutNeed = 0;

  private urgeCooldown = 0;
  private urgeSpeed = 0;
  private hintTimer = 0;

  reset(): void {
    this.kind = 'none';
    this.time = 0;
    this.revolutions = 0;
    this.urgeTime = 99;
    this.cheerTime = 99;
    this.diveTime = 0;
    this.diveSuppressed = false;
    this.urgeCooldown = 0;
    this.pullOutNeed = 0;
  }

  get active(): boolean {
    return this.kind !== 'none';
  }

  /** Ends any trick at once (touchdown, splashdown). */
  cancel(): void {
    this.kind = 'none';
    this.time = 0;
  }

  /** The pilot's Shift is ignored (a held dive that Space caught). */
  get diveMasked(): boolean {
    return this.diveSuppressed;
  }

  /** 0..1 envelope of the rider's "dehh" gesture. */
  get urgeEnvelope(): number {
    const t = this.urgeTime;
    const d = TRICKS.urgeGesture;
    return t >= d ? 0 : smoothstep(0, 0.12, t) * (1 - smoothstep(d * 0.55, d, t));
  }

  /** 0..1 envelope of the rider's joy after a finished trick. */
  get cheer(): number {
    const t = this.cheerTime;
    const d = TRICKS.cheer;
    return t >= d ? 0 : smoothstep(0, 0.2, t) * (1 - smoothstep(d * 0.6, d, t));
  }

  /** The urge is driving the wings (strong beats and a surge). */
  get urging(): boolean {
    return this.urgeTime < TRICKS.urgeDuration;
  }

  /** Display mode while a trick runs (null = the normal mode logic decides). */
  displayMode(): FlightMode | null {
    switch (this.kind) {
      case 'drop':
        return 'diving';
      case 'roll':
      case 'loop':
      case 'catch':
        return 'flying';
      default:
        return null;
    }
  }

  /** Timers; every substep in every mode. */
  tick(h: number): void {
    this.urgeTime += h;
    this.cheerTime += h;
    this.urgeCooldown = Math.max(0, this.urgeCooldown - h);
    this.hintTimer = Math.max(0, this.hintTimer - h);
    if (this.kind !== 'none') {
      this.time += h;
    }
  }

  /** Lowest clearance of the body now and along the track ahead (rooftops and rising ground included). */
  clearance(sim: FlightSim): number {
    const feet = sim.body.position.y - sim.footDepth();
    let c = sim.footClearance;
    for (let i = 0; i < sim.aheadSurface.length; i++) {
      c = Math.min(c, feet - sim.aheadSurface[i]);
    }
    return c;
  }

  /** Free height above the center of mass under the ceilings now and along the track ahead (Infinity: open sky). */
  headroom(sim: FlightSim): number {
    let ceiling = sim.ceilingY;
    for (let i = 0; i < sim.aheadCeiling.length; i++) {
      ceiling = Math.min(ceiling, sim.aheadCeiling[i]);
    }
    return ceiling - sim.body.position.y;
  }

  /**
   * The urge ("dehh", V). Airborne it drives strong beats and a surge; hovering it flies out, landing it goes around.
   * Grounded and swimming take-offs are started by the locomotion. Returns false while cooling down.
   */
  tryUrge(sim: FlightSim): boolean {
    if (this.urgeCooldown > 0) {
      return false;
    }
    this.urgeCooldown = TRICKS.urgeCooldown;
    this.urgeTime = 0;
    this.urgeSpeed = Math.max(sim.airspeed, 18);
    sim.stamina = Math.max(0, sim.stamina - TRICKS.urgeStamina);
    // The rein crack is played by the rider animation when the fists snap down (dragon/model).
    this.announce(sim, 'urge');
    return true;
  }

  /** Starts tricks from pilot edges and automatic triggers (airborne substeps, before the mode logic). */
  begin(sim: FlightSim, cmd: PilotCommand, h: number): void {
    if (!cmd.dive) {
      this.diveSuppressed = false;
    }
    const mode = sim.mode;
    const cruising = mode === 'flying' || mode === 'gliding' || mode === 'diving' || mode === 'stalling';
    if (cmd.urgePressed && this.tryUrge(sim)) {
      if (mode === 'hovering') {
        sim.controller.holdPath(0.05);
        sim.setMode('takeoff');
      } else if (mode === 'landing') {
        sim.controller.holdPath(Math.max(sim.gamma, 0.1));
        sim.setMode(sim.airspeed < 12 ? 'takeoff' : 'flying');
      }
    }

    if (this.kind === 'drop') {
      this.updateDrop(sim, cmd, h);
      return;
    }
    if (this.kind !== 'none') {
      return;
    }

    // A steep Shift dive released (or Space pressed while diving) ends in a catch as well.
    const V = sim.airspeed;
    const dive = cmd.dive && !this.diveSuppressed;
    if (cruising && dive && sim.spread < 0.5 && sim.gamma < -15 * DEG) {
      this.diveTime += h;
    }
    const steepFast = this.diveTime > TRICKS.diveCatchTime && sim.gamma < TRICKS.diveCatchPath && V > TRICKS.diveCatchSpeed;
    if (cruising && steepFast && (!dive || cmd.flapPressed)) {
      this.diveSuppressed = cmd.dive;
      this.diveTime = 0;
      this.startCatch(sim, false);
      return;
    }
    if (!dive) {
      this.diveTime = 0;
    }

    const clearance = this.clearance(sim);
    // Drop: Shift while slow (hover, stall, < ~20 m/s) or a Shift double tap at any speed, when there is room for
    // a real fall (at least ~a second before the automatic catch). Lower down Shift keeps its hover descent.
    const dropMode = cruising || mode === 'hovering';
    const slowShift = dive && (mode === 'hovering' || mode === 'stalling' || V < TRICKS.dropMaxSpeed);
    if (dropMode && (cmd.dropPressed || slowShift) && clearance > TRICKS.dropMinClearance && clearance > this.dropRoom(sim)) {
      this.startDrop(sim, cmd.dropPressed ? TRICKS.dropMinTime : 0);
      return;
    }

    if (cmd.rollLeftPressed || cmd.rollRightPressed) {
      const dir = cmd.rollRightPressed ? 1 : -1;
      // The upper wingtip sweeps up to half a span above the body: no roll right under a bridge deck.
      const room = this.headroom(sim) >= 0.5 * sim.wing.span + PROXIMITY.ceilingMargin;
      if (cruising && V >= TRICKS.rollMinSpeed && clearance >= TRICKS.rollMinClearance && room && !cmd.brake) {
        this.startRoll(sim, dir);
        return;
      }
      if (cruising && !cmd.brake) {
        this.hint(sim, V < TRICKS.rollMinSpeed ? 'Takla için hızlan' : room ? 'Takla için yüksel' : 'Takla için yer yok');
      }
    }
    if (cmd.loopPressed) {
      const room = this.headroom(sim) >= TRICKS.loopMinClearance;
      const fit = !sim.tired && V >= TRICKS.loopMinSpeed && clearance >= TRICKS.loopMinClearance && room;
      const level = Math.abs(sim.gamma) < TRICKS.loopMaxEntryPath && Math.abs(sim.bank) < 50 * DEG;
      if (cruising && fit && level && !cmd.brake) {
        this.startLoop(sim);
        return;
      }
      if (cruising && !cmd.brake) {
        const why = sim.tired ? 'Ejderha yorgun' : V < TRICKS.loopMinSpeed ? 'Looping için hızlan' : !level ? 'Looping için düz uç' : !room ? 'Looping için yer yok' : 'Looping için yüksel';
        this.hint(sim, why);
      }
    }
  }

  /** Control law while a trick runs (replaces the normal law). */
  control(sim: FlightSim, cmd: PilotCommand, h: number, t: ControlTargets): void {
    switch (this.kind) {
      case 'roll':
        this.rollLaw(sim, cmd, h, t);
        break;
      case 'loop':
        this.loopLaw(sim, t);
        break;
      case 'drop':
        this.dropLaw(sim, t);
        break;
      case 'catch':
        this.catchLaw(sim, t);
        break;
      default:
        break;
    }
  }

  /** Normal-law hook: the urge drives strong beats and a capped surge (kept level by the path hold). */
  applyUrge(sim: FlightSim, t: ControlTargets, wingsFree: boolean): void {
    if (!this.urging || !wingsFree) {
      return;
    }
    const fade = 1 - smoothstep(TRICKS.urgeDuration * 0.75, TRICKS.urgeDuration, this.urgeTime);
    t.effort = Math.max(t.effort, 0.3 + 0.7 * fade);
    const room = this.urgeSpeed + TRICKS.urgeGain - sim.airspeed;
    t.thrustBoost = Math.max(t.thrustBoost, 1 + (TRICKS.urgeThrust - 1) * smoothstep(0, 3, room) * fade);
    t.spread = Math.max(t.spread, 0.95);
    t.sweep = Math.min(t.sweep, 0.05);
  }

  /* ---------------------------------------------------------------- starts */

  private startRoll(sim: FlightSim, dir: number): void {
    this.enter('roll');
    this.rollDir = dir;
    this.rollEntryPath = sim.gamma;
    this.rollTarget = TWO_PI;
    this.rolled = 0;
    this.revolutions = 0;
    // Carry the roll rate the first tap already started.
    this.rollRate = Math.max(0, -dir * sim.body.angularVelocity.z);
    this.prevBank = sim.bank;
    sim.emit({ type: 'sound', name: 'whoosh', volume: 0.9 });
    this.announce(sim, 'roll');
  }

  private startLoop(sim: FlightSim): void {
    this.enter('loop');
    const F = sim.axes.forward;
    this.loopForward.set(F.x, 0, F.z);
    if (this.loopForward.lengthSq() < 1e-4) {
      this.loopForward.set(0, 0, -1);
    }
    this.loopForward.normalize();
    this.loopRight.set(-this.loopForward.z, 0, this.loopForward.x);
    // Progress is measured from the entry path, so the loop ends where it began.
    this.prevLoopAngle = Math.atan2(sim.airVelocity.y, sim.airVelocity.dot(this.loopForward));
    this.loopAngle = 0;
    sim.emit({ type: 'sound', name: 'whoosh', volume: 1 });
    this.announce(sim, 'loop');
  }

  private startDrop(sim: FlightSim, minTime: number): void {
    this.enter('drop');
    this.dropMin = minTime;
    this.predictTimer = 0;
    this.pullOutNeed = 0;
    this.diveTime = 0;
    sim.emit({ type: 'sound', name: 'whoosh', volume: 0.55 });
    this.announce(sim, 'freefall');
    sim.setMode('diving');
  }

  private startCatch(sim: FlightSim, urgent: boolean): void {
    this.enter('catch');
    const V = sim.airspeed;
    this.catchLoadStart = clamp(sim.loadFactor, 0, 1.5);
    this.catchLoad = urgent ? TRICKS.urgentCatchLoad : this.catchLoadFor(V);
    this.catchTime = TRICKS.catchMaxTime + V / 25;
    // The swoop trades the excess speed for height, then glides on.
    this.catchExitPath = clamp(3 * DEG + (V - 30) * 0.22 * DEG, 2 * DEG, 14 * DEG);
    // Fast: the wings open part way (a full wing at dive speed would pull far beyond the target load).
    this.catchSpread = clamp(1.25 - V / 110, 0.62, 1);
    const snap = smoothstep(12, 80, V);
    sim.emit({ type: 'sound', name: 'wing-snap', volume: 0.55 + 0.6 * snap });
    sim.emit({ type: 'shake', amount: 0.16 + 0.3 * snap });
    this.announce(sim, 'catch');
  }

  private enter(kind: TrickKind): void {
    this.kind = kind;
    this.time = 0;
  }

  private finish(sim: FlightSim, holdPath: number, cheer: boolean): void {
    this.kind = 'none';
    this.time = 0;
    sim.controller.holdPath(holdPath);
    if (cheer) {
      this.cheerTime = 0;
    }
  }

  private announce(sim: FlightSim, id: Exclude<ManeuverId, 'hint'>): void {
    sim.emit({ type: 'maneuver', id, label: MANEUVER_LABELS[id] });
  }

  private hint(sim: FlightSim, label: string): void {
    if (this.hintTimer > 0) {
      return;
    }
    this.hintTimer = TRICKS.hintInterval;
    sim.emit({ type: 'maneuver', id: 'hint', label });
  }

  /* ---------------------------------------------------------------- roll */

  private rollLaw(sim: FlightSim, cmd: PilotCommand, h: number, t: ControlTargets): void {
    const bank = sim.bank;
    this.rolled += wrapAngle(bank - this.prevBank) * this.rollDir;
    this.prevBank = bank;
    let remaining = this.rollTarget - this.rolled;
    // Key still held as the revolution ends: keep spinning (while there is height and speed for it).
    const held = this.rollDir > 0 ? cmd.roll > 0.5 : cmd.roll < -0.5;
    const stopping = (this.rollRate * this.rollRate) / (2 * TRICKS.rollDecel);
    if (
      held &&
      remaining < stopping + 0.3 &&
      this.revolutions + 1 < TRICKS.rollMaxRevolutions &&
      this.clearance(sim) > TRICKS.rollKeepClearance &&
      sim.airspeed > TRICKS.rollMinSpeed - 4
    ) {
      this.rollTarget += TWO_PI;
      this.revolutions++;
      remaining += TWO_PI;
      sim.emit({ type: 'sound', name: 'whoosh', volume: 0.8 });
    }
    const want = Math.min(TRICKS.rollRate, Math.sqrt(2 * TRICKS.rollDecel * Math.max(remaining, 0)));
    this.rollRate = Math.min(want, this.rollRate + TRICKS.rollAccel * h);
    const diving = this.rollEntryPath < -15 * DEG;
    if (remaining < 2 * DEG || this.time > 2.4 + 1.3 * this.revolutions) {
      this.revolutions++;
      // Level: the path hold pulls out of the sink the roll left behind. Diving: the dive goes on.
      this.finish(sim, diving ? Math.min(this.rollEntryPath, sim.gamma) : clamp(sim.gamma + 4 * DEG, 0, 10 * DEG), true);
      this.normalTargets(t);
      return;
    }

    // Roll about the flight path (the angle of attack and sideslip keep), lift shaped for the lift direction:
    // a firm pull while upright, a push while inverted (the path stays nearly straight).
    _invQ.copy(sim.body.quaternion).invert();
    const V = Math.max(sim.airspeed, 1);
    _dir.copy(sim.airVelocity).divideScalar(V).applyQuaternion(_invQ);
    t.rate.copy(_dir).multiplyScalar(this.rollRate * this.rollDir);
    // The angle-of-attack loop lags the fast roll: shape the lift for the bank a moment ahead.
    // Level: n = cos φ keeps the path straight, the extra pull while upright holds the height. Diving: the lift a
    // straight dive needs (cos γ), no pull (it would round the dive out).
    const c = Math.cos(bank + this.rollDir * this.rollRate * ROLL_LEAD);
    const pull = ROLL_UPRIGHT_PULL * smoothstep(-20 * DEG, -5 * DEG, this.rollEntryPath);
    const load = c * Math.cos(this.rollEntryPath) + pull * Math.max(0, c);
    const alphaTarget = clamp(alphaForLoad(sim, load), ALPHA_MIN, ALPHA_MAX);
    t.rate.x += pitchFeed(sim) + ROLL_ALPHA_GAIN * (alphaTarget - sim.alpha);
    t.rate.y += yawFeed(sim) - 1.8 * sim.beta;
    t.effort = 0;
    t.spread = TRICKS.rollSpread;
    t.sweep = TRICKS.rollSweep;
    t.authority.set(TRICKS.rollAuthority[0], TRICKS.rollAuthority[1], TRICKS.rollAuthority[2]);
  }

  /* ---------------------------------------------------------------- loop */

  private loopLaw(sim: FlightSim, t: ControlTargets): void {
    const air = sim.airVelocity;
    const V = sim.airspeed;
    const a = Math.atan2(air.y, air.dot(this.loopForward));
    this.loopAngle += wrapAngle(a - this.prevLoopAngle);
    this.prevLoopAngle = a;
    const theta = this.loopAngle;
    if (theta > TWO_PI - 6 * DEG) {
      this.finish(sim, clamp(sim.gamma, -5 * DEG, 12 * DEG), true);
      this.normalTargets(t);
      return;
    }
    if (this.time > TRICKS.loopMaxTime || (V < 7 && theta < Math.PI)) {
      // Ran out of speed before the top: the normal law's upset recovery takes it from here.
      this.finish(sim, clamp(sim.gamma, -0.4, 0.2), false);
      this.normalTargets(t);
      return;
    }
    // An aerobatic egg rather than a circle (a round loop at cruise speed would need 6 g at the bottom): a firm
    // pull-up, a tight top while slow (the dynamic lift of hard beats) and a firm pull-out. The angle of attack stays
    // under the stall margin, so a slow loop simply grows rounder.
    const up = 1 - smoothstep(0.35 * Math.PI, 0.6 * Math.PI, theta);
    const out = smoothstep(1.4 * Math.PI, 1.6 * Math.PI, theta);
    const load = lerp(lerp(TRICKS.loopTopLoad, TRICKS.loopLoad, up), TRICKS.loopExitLoad, out);
    const alphaTarget = clamp(alphaForLoad(sim, load, TRICKS.loopLiftBoost), ALPHA_MIN, ALPHA_MAX);
    let pitchRate = pitchFeed(sim) + 6 * (alphaTarget - sim.alpha);
    if (sim.loadFactor > TRICKS.loopMaxLoad) {
      pitchRate -= (sim.loadFactor - TRICKS.loopMaxLoad) * 0.4;
    }

    // Wings level in the loop plane: the body's right axis stays on the plane normal.
    const right = sim.axes.right;
    _cross.crossVectors(right, this.loopRight);
    const rollErr = Math.atan2(_cross.dot(sim.axes.forward), right.dot(this.loopRight));
    t.rate.set(pitchRate, yawFeed(sim) - 1.8 * sim.beta, -clamp(3 * rollErr, -1.5, 1.5));
    // Strong beats on the way up (and over the top when slow); a glide down the back side.
    const climbing = theta < 0.95 * Math.PI;
    t.effort = climbing || V < 18 ? 1 : 0.15;
    t.thrustBoost = climbing ? TRICKS.loopThrust : 1;
    t.liftBoost = TRICKS.loopLiftBoost;
    t.spread = 1;
    t.sweep = 0;
    t.authority.set(2, 1.5, 1.5);
  }

  /* ---------------------------------------------------------------- drop and catch */

  /** Pull-out load of a catch: firmer when fast (a dive-speed pull-out at 2.6 g takes long and costs much height). */
  private catchLoadFor(V: number): number {
    return lerp(TRICKS.catchLoad, TRICKS.fastCatchLoad, smoothstep(45, 75, V));
  }

  /** Clearance a drop needs before it starts: the pull-out from here plus about a second of falling. */
  private dropRoom(sim: FlightSim): number {
    return this.predictPullOut(sim, this.catchLoadFor(sim.airspeed)) + TRICKS.catchMargin + TRICKS.dropMinFall;
  }

  private updateDrop(sim: FlightSim, cmd: PilotCommand, h: number): void {
    this.predictTimer -= h;
    if (this.predictTimer <= 0) {
      this.predictTimer = PREDICT_INTERVAL;
      this.pullOutNeed = this.predictPullOut(sim, this.catchLoadFor(sim.airspeed)) + TRICKS.catchMargin;
    }
    // Falling into water fit for a plunge with Shift held: no automatic catch (underwater.ts plunges in).
    const plunging = sim.dive.clear && cmd.dive;
    if (!plunging && this.clearance(sim) < this.pullOutNeed) {
      // Never a crash: the wings open on their own while there is still room to pull out.
      this.startCatch(sim, true);
      this.diveSuppressed = cmd.dive;
      return;
    }
    const space = (cmd.flapPressed || cmd.flap || cmd.brake || cmd.landPressed) && this.time > TRICKS.dropSpaceDelay;
    if (space || (!cmd.dive && this.time > this.dropMin)) {
      this.startCatch(sim, false);
      this.diveSuppressed = cmd.dive;
    }
  }

  /**
   * Height lost from now until the bottom of a pull-out that starts now (m): a point mass in the vertical plane of
   * the track, the wings opening over the reaction time, lift limited by the attached-flow CL and by `load`.
   */
  predictPullOut(sim: FlightSim, load: number): number {
    const v = sim.airVelocity;
    let vx = Math.hypot(v.x, v.z);
    let vy = v.y;
    const rho = airDensity(sim.body.position.y);
    const weight = MASS * GRAVITY;
    const dt = 0.05;
    const delay = TRICKS.catchDelay;
    let y = 0;
    let minY = 0;
    for (let i = 0; i < 240; i++) {
      const time = i * dt;
      const V = Math.max(Math.hypot(vx, vy), 0.1);
      const open = smoothstep(0.1, delay, time);
      const area = lerp(WING.areaFolded, WING.areaSpread, open);
      const q = 0.5 * rho * V * V;
      const onset = smoothstep(delay * 0.5, delay + TRICKS.catchOnset, time);
      const n = Math.min(load * onset, (PREDICT_CL * q * area) / weight);
      const drag = (q * (PREDICT_CDA + 0.03 * area)) / MASS;
      // Lift turns the path up (perpendicular to the velocity, on its upper side); drag slows it.
      const ax = (-vy / V) * n * GRAVITY - (vx / V) * drag;
      const ay = (vx / V) * n * GRAVITY - GRAVITY - (vy / V) * drag;
      vx += ax * dt;
      vy += ay * dt;
      y += vy * dt;
      minY = Math.min(minY, y);
      if (time > delay && vy >= 0) {
        break;
      }
    }
    return -minY;
  }

  private dropLaw(sim: FlightSim, t: ControlTargets): void {
    t.effort = 0;
    t.spread = 0.03;
    t.sweep = 1;
    t.spreadRate = 5;
    t.sweepRate = 5;
    t.brake = 0;
    t.legsOut = 0;
    t.hover = 0;
    // Zero lift: the nose falls through with the airflow (no path hold fighting the fall); never past the vertical.
    const V = sim.airspeed;
    const alphaTarget = clamp(alphaForLoad(sim, 0), ALPHA_MIN, 2 * DEG);
    let pitchRate = V > 5 ? clamp(2.4 * (alphaTarget - sim.alpha), -1.4, 0.5) : -0.5 * smoothstep(0, 0.4, this.time);
    const floor = -80 * DEG;
    if (sim.pitch < floor + 10 * DEG) {
      pitchRate = Math.max(pitchRate, 2 * (floor - sim.pitch) - 0.4 * smoothstep(floor, floor + 10 * DEG, sim.pitch));
    }
    const level = Math.cos(sim.pitch);
    const rollRate = clamp(2.5 * sim.bank, -1.2, 1.2) * level;
    const yawRate = V > 6 ? yawFeed(sim) - 1.8 * sim.beta : 0;
    t.rate.set(pitchRate, yawRate, rollRate);
    t.authority.set(8, 2, 2);
  }

  private catchLaw(sim: FlightSim, t: ControlTargets): void {
    const V = sim.airspeed;
    if ((this.time > 0.45 && sim.gamma >= this.catchExitPath) || this.time > this.catchTime) {
      this.finish(sim, Math.max(Math.min(sim.gamma, this.catchExitPath), -5 * DEG), true);
      this.normalTargets(t);
      return;
    }
    // Wings snap open (part way at dive speed) with one strong beat when slow.
    t.spread = Math.max(this.catchSpread, clamp(1.25 - V / 110, 0.62, 1));
    t.sweep = 0;
    t.spreadRate = 6;
    t.sweepRate = 6;
    t.brake = 0;
    t.legsOut = 0;
    t.hover = 0;
    t.effort = V < 22 ? 1 : this.time < 0.6 && V < 45 ? 0.9 : 0;
    // A firm, jerk-limited pull-out: the load builds over catchOnset while the wing opens.
    const onset = smoothstep(0.06, 0.06 + TRICKS.catchOnset, this.time);
    const load = lerp(this.catchLoadStart, this.catchLoad, onset);
    const alphaTarget = clamp(alphaForLoad(sim, load), ALPHA_MIN, ALPHA_MAX);
    let pitchRate = pitchFeed(sim) + 6 * (alphaTarget - sim.alpha);
    if (sim.loadFactor > this.catchLoad + 0.4) {
      pitchRate -= (sim.loadFactor - this.catchLoad - 0.4) * 0.6;
    }
    const level = Math.cos(sim.pitch);
    t.rate.set(clamp(pitchRate, -1.5, 1.5), yawFeed(sim) - 1.8 * sim.beta, clamp(2.5 * sim.bank, -1.5, 1.5) * Math.max(level, 0.3));
    t.authority.set(2.5, 1.5, 1.5);
  }

  /** Neutral targets for the substep in which a trick ends (the normal law takes over from the next one). */
  private normalTargets(t: ControlTargets): void {
    t.effort = 0;
    t.spread = 1;
    t.sweep = 0;
  }

  /** Test/diagnostics view of the running trick. */
  describe(): { kind: TrickKind; time: number; rolledDeg: number; revolutions: number; loopDeg: number; pullOutNeed: number } {
    return {
      kind: this.kind,
      time: Math.round(this.time * 100) / 100,
      rolledDeg: Math.round((this.rolled * 180) / Math.PI),
      revolutions: this.revolutions,
      loopDeg: Math.round((this.loopAngle * 180) / Math.PI),
      pullOutNeed: Math.round(this.pullOutNeed * 10) / 10,
    };
  }
}
