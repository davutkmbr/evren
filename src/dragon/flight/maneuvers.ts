import * as THREE from 'three';
import type { FlightMode } from '../../core/contracts';
import { clamp, lerp, smoothstep } from '../../core/math/noise';
import { airDensity, ceilingFactor } from './aero';
import { AxisPress, inImmelmannWindow, resolvePitchUpDoubleTap, resolveRollDoubleTap } from '../../core/gestures';
import { DART, DEG, FLAP, GRAVITY, IMMELMANN, MASS, POWER_STROKE, PROXIMITY, SLIP, SPLIT_S, TRICKS, WING, WINGOVER } from './params';
import type { ControlTargets } from './controller';
import type { FlightSim } from './sim';
import type { ManeuverId, MoveId, MoveRecord, PilotCommand } from './types';

/**
 * Tricks that replace the normal control law while they run. The urge and the power stroke run on top of the normal
 * law; the surface skim is automatic (skim.ts).
 */
export type TrickKind = 'none' | 'roll' | 'loop' | 'drop' | 'catch' | 'dart' | 'slip' | 'wingover' | 'immelmann' | 'splits';

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
  runout: 'Koşarak iniş',
  touchgo: 'Dokun-kalk',
  plunge: 'Dalış',
  breach: 'Fırlama',
  power: 'Güç vuruşu',
  dart: 'Ok gibi',
  slip: 'Kayış',
  skim: 'Sıyırma',
  wingover: 'Kanat üstü dönüş',
  immelmann: 'Immelmann',
  splits: 'Split-S',
  flow: 'Kusursuz',
};

/** Moves kept in the log of finished moves (headless checks, diagnostics). */
const MOVE_LOG = 16;

/**
 * Clean-exit bookkeeping of one move (phase 20 flow hooks): entry speed, contact and stall while it runs. A move ends
 * clean with no contact, no stall and an exit speed of at least the entry speed - tolerance.
 */
export class MoveTracker {
  start = 0;
  entrySpeed = 0;
  entryY = 0;
  /** Compass heading of the track at the start (rad). */
  entryHeading = 0;
  contact = false;
  stalled = false;

  begin(sim: FlightSim): void {
    this.start = sim.time;
    this.entrySpeed = sim.airspeed;
    this.entryY = sim.body.position.y;
    this.entryHeading = trackHeading(sim);
    this.contact = false;
    this.stalled = false;
  }

  /** Every substep while the move runs. */
  sample(sim: FlightSim): void {
    if (sim.impact.touched || sim.footClearance < 0 || sim.touchingWater || !sim.airborne) {
      this.contact = true;
    }
    if (sim.attachment < 0.6 || sim.controller.upset || sim.mode === 'stalling') {
      this.stalled = true;
    }
  }

  /** The finished move's record (`forced`: ended early or cancelled, never clean). */
  finish(sim: FlightSim, id: MoveId, tolerance: number, forced = false): MoveRecord {
    const exitSpeed = sim.airspeed;
    const clean = !forced && !this.contact && !this.stalled && exitSpeed >= this.entrySpeed - tolerance;
    const heightChange = sim.body.position.y - this.entryY;
    const entryEnergy = 0.5 * this.entrySpeed * this.entrySpeed;
    return {
      id,
      start: this.start,
      duration: sim.time - this.start,
      entrySpeed: this.entrySpeed,
      exitSpeed,
      heightChange,
      clean,
      contact: this.contact,
      stalled: this.stalled,
      forced,
      lateral: 0,
      headingChange: wrapAngle(trackHeading(sim) - this.entryHeading),
      energyRatio: entryEnergy > 1 ? (0.5 * exitSpeed * exitSpeed + GRAVITY * heightChange) / entryEnergy : 1,
    };
  }
}

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

/** Compass heading of the ground track (rad, 0 = north / -z, +π/2 = east / +x). */
function trackHeading(sim: FlightSim): number {
  const v = sim.body.velocity;
  return Math.atan2(v.x, -v.z);
}

/** Compass heading of the air track (rad): the heading the wingover turns. */
function airHeading(sim: FlightSim): number {
  const v = sim.airVelocity;
  return Math.atan2(v.x, -v.z);
}

/**
 * Wingover path shape over the progress p (0..1): sin(2πp) (climb, level through the top at p = 0.5, dive), eased in
 * and out so the path starts and ends level without a jerk. Peaks near ±1 at p = 0.25 / 0.75.
 */
function wingoverShape(p: number): number {
  return Math.sin(TWO_PI * p) * smoothstep(0, WINGOVER.easeIn, p) * (1 - smoothstep(1 - WINGOVER.easeOut, 1, p));
}

/** d(wingoverShape)/dp (central difference). */
function wingoverSlope(p: number): number {
  const e = 1e-3;
  return (wingoverShape(p + e) - wingoverShape(p - e)) / (2 * e);
}

const _pathUp = new THREE.Vector3();
const _pathRight = new THREE.Vector3();
const _liftUp = new THREE.Vector3();
/**
 * Bank about the flight path (rad, + = lift tilted right): the angle between the lift direction (body up, square to
 * the air path) and the vertical plane through the path. Undefined for a vertical path (0 then).
 */
function pathBank(sim: FlightSim): number {
  const V = sim.airspeed;
  if (V < 1) {
    return sim.bank;
  }
  _dir.copy(sim.airVelocity).divideScalar(V);
  _pathUp.set(0, 1, 0).addScaledVector(_dir, -_dir.y);
  if (_pathUp.lengthSq() < 1e-4) {
    return 0;
  }
  _pathUp.normalize();
  _pathRight.crossVectors(_dir, _pathUp);
  _liftUp.copy(sim.axes.up).addScaledVector(_dir, -sim.axes.up.dot(_dir));
  return Math.atan2(_liftUp.dot(_pathRight), _liftUp.dot(_pathUp));
}

const _dir = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _cross = new THREE.Vector3();
const _slipDir = new THREE.Vector3();
const _slipFrom = new THREE.Vector3();
const _slipOffset = new THREE.Vector3();
const _slipHit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: '' };
const _slipColumn = { floor: 0, ceiling: Infinity };
const _cue = { pull: 0, roll: 0, pivot: 0 };
/** Sideways shift of a side-slip (m): SLIP.lengths body lengths of this dragon's rig. */
export function slipDistance(sim: FlightSim): number {
  return SLIP.lengths * sim.rigLength;
}

/** Fractions of the slip's run along the track at which the room beside it is probed. */
const SLIP_PROBES = [0, 0.35, 0.7, 1];

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
 * Rider-driven maneuvers: the barrel roll, the loop, the free-fall drop and its catch, the urge ("dehh"), the stage B
 * moves (power stroke, dart, side-slip) and the stage C reversals (wingover, Immelmann, Split-S). Starts them from
 * pilot edges (double taps, V, the roll axis during a loop) and automatic triggers, runs their control laws in place
 * of the normal law, and exposes cue envelopes for the pose driver. Announcements and sounds go out as sim events.
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

  /** Finished stage B moves, newest last (at most MOVE_LOG). */
  readonly log: MoveRecord[] = [];

  /* Power stroke (runs on top of the normal law). */
  /** A power stroke is running. */
  powerActive = false;
  /** Seconds since the power stroke started (large when idle). */
  powerTime = 99;
  private powerBeats = 0;
  private powerEntry = 0;
  private powerCooldown = 0;
  private powerPrevPhase = 0;
  private readonly powerTrack = new MoveTracker();

  /* Dart and side-slip (tricks). */
  private readonly moveTrack = new MoveTracker();
  private dartOpened = false;
  /** Side of the running side-slip: +1 right, -1 left. */
  slipDir = 0;
  private readonly slipOrigin = new THREE.Vector3();
  private readonly slipLateral = new THREE.Vector3();
  private slipYaw = 0;
  private slipPath = 0;
  private slipPushPrev = 0;

  /* Stage C reversals (tricks): wingover, Immelmann (from the top of a loop), Split-S (from a steep dive). */
  /** Fresh A / D presses on the held roll axis (the Immelmann's trigger during a loop). */
  private readonly rollAxis = new AxisPress(IMMELMANN.press, IMMELMANN.release);
  /** Side of the running reversal's turn or roll: +1 right, -1 left. */
  reversalDir = 0;
  /** Reversal phase: the Immelmann's pull and half roll, the Split-S's half roll and pull through. */
  reversalPhase: 'pull' | 'roll' = 'pull';
  /** Wingover progress (heading turned / 180°, 0..1). */
  wingoverProgress = 0;
  private woTurned = 0;
  private woPrevHeading = 0;
  private woStartLoad = 1;
  private woDiveDepth = 1;
  private revRolled = 0;
  private revRate = 0;
  private revPrevRoll = 0;
  private revPhaseTime = 0;
  private splitLoadStart = 0;
  private splitUrgent = false;
  private splitAngle = 0;
  private splitPrevAngle = 0;
  private splitNeedTimer = 0;
  private splitNeed = 0;

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
    this.powerActive = false;
    this.powerTime = 99;
    this.powerCooldown = 0;
    this.slipDir = 0;
    this.reversalDir = 0;
    this.wingoverProgress = 0;
    this.log.length = 0;
  }

  get active(): boolean {
    return this.kind !== 'none';
  }

  /** Ends any trick at once (touchdown, splashdown); a running dart, side-slip or power stroke ends unclean. */
  cancel(sim?: FlightSim): void {
    if (sim && (this.kind === 'dart' || this.kind === 'slip' || this.kind === 'wingover' || this.kind === 'immelmann' || this.kind === 'splits')) {
      this.endMove(sim, this.moveTrack.finish(sim, this.kind, 0, true));
    }
    if (sim && this.powerActive) {
      this.endPower(sim, true);
    }
    this.kind = 'none';
    this.time = 0;
    this.slipDir = 0;
    this.reversalDir = 0;
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
      case 'dart':
        return 'diving';
      case 'roll':
      case 'loop':
      case 'catch':
      case 'slip':
      case 'wingover':
      case 'immelmann':
      case 'splits':
        return 'flying';
      default:
        return null;
    }
  }

  /** Timers; every substep in every mode. */
  tick(h: number, sim?: FlightSim): void {
    this.urgeTime += h;
    this.cheerTime += h;
    this.powerTime += h;
    this.urgeCooldown = Math.max(0, this.urgeCooldown - h);
    this.powerCooldown = Math.max(0, this.powerCooldown - h);
    this.hintTimer = Math.max(0, this.hintTimer - h);
    if (this.kind !== 'none') {
      this.time += h;
    }
    if (sim && this.powerActive) {
      this.updatePower(sim);
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
    // A / D pressed during the top of a loop: the Immelmann (a double tap there counts as a press too).
    const rollPress = this.rollAxis.update(cmd.roll) || (cmd.rollRightPressed ? 1 : cmd.rollLeftPressed ? -1 : 0);
    if (this.kind === 'loop' && rollPress !== 0) {
      this.tryImmelmann(sim, rollPress);
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
    // Dart: a Shift double tap while fast from about level flight (slower, or diving steeply: the drop below).
    if (cmd.dropPressed && cruising && V > DART.minSpeed && Math.abs(sim.gamma) < DART.maxEntryPath) {
      if (Math.abs(sim.bank) > DART.maxEntryBank) {
        this.hint(sim, 'Ok gibi atılmak için düz uç');
      } else if (clearance < DART.minClearance || cmd.brake) {
        this.hint(sim, 'Ok gibi atılmak için yer yok');
      } else {
        this.startDart(sim);
      }
      return;
    }
    // Drop: Shift while slow (hover, stall, < ~20 m/s) or a Shift double tap at any speed, when there is room for
    // a real fall (at least ~a second before the automatic catch). Lower down Shift keeps its hover descent.
    const dropMode = cruising || mode === 'hovering';
    const slowShift = dive && (mode === 'hovering' || mode === 'stalling' || V < TRICKS.dropMaxSpeed);
    if (dropMode && (cmd.dropPressed || slowShift) && clearance > TRICKS.dropMinClearance && clearance > this.dropRoom(sim)) {
      this.startDrop(sim, cmd.dropPressed ? TRICKS.dropMinTime : 0);
      return;
    }

    if ((cmd.rollLeftPressed || cmd.rollRightPressed) && cruising && !cmd.brake && resolveRollDoubleTap(sim.gamma, SPLIT_S.maxPath) === 'splits') {
      // A steep dive: the Split-S (half roll onto the back, pull through to the reverse heading).
      const dir = cmd.rollRightPressed ? 1 : -1;
      const why = V < SPLIT_S.minSpeed ? 'Split-S için hızlan' : !this.splitRoom(sim) ? 'Split-S için yüksel' : null;
      if (why) {
        this.hint(sim, why);
      } else {
        this.startSplit(sim, dir);
        return;
      }
    } else if (cmd.rollLeftPressed || cmd.rollRightPressed) {
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
    if (cmd.loopPressed && resolvePitchUpDoubleTap(sim.bank, WINGOVER.minBank) === 'wingover') {
      // Banked: the wingover (a climbing turn over the high wing, diving out on the reverse heading).
      if (cruising && !cmd.brake) {
        const dir = sim.bank > 0 ? 1 : -1;
        const why = sim.tired
          ? 'Ejderha yorgun'
          : V < WINGOVER.minSpeed
            ? 'Kanat üstü dönüş için hızlan'
            : Math.abs(sim.gamma) > WINGOVER.maxEntryPath
              ? 'Kanat üstü dönüş için düz uç'
              : clearance < WINGOVER.minClearance
                ? 'Kanat üstü dönüş için yüksel'
                : !this.wingoverRoom(sim, dir)
                  ? 'Kanat üstü dönüş için yer yok'
                  : null;
        if (why) {
          this.hint(sim, why);
        } else {
          this.startWingover(sim, dir);
          return;
        }
      }
    } else if (cmd.loopPressed) {
      const room = this.headroom(sim) >= TRICKS.loopMinClearance;
      const fit = !sim.tired && V >= TRICKS.loopMinSpeed && clearance >= TRICKS.loopMinClearance && room;
      const level = Math.abs(sim.gamma) < TRICKS.loopMaxEntryPath;
      if (cruising && fit && level && !cmd.brake) {
        this.startLoop(sim);
        return;
      }
      if (cruising && !cmd.brake) {
        const why = sim.tired ? 'Ejderha yorgun' : V < TRICKS.loopMinSpeed ? 'Looping için hızlan' : !level ? 'Looping için düz uç' : !room ? 'Looping için yer yok' : 'Looping için yüksel';
        this.hint(sim, why);
      }
    }
    if (cmd.slipLeftPressed || cmd.slipRightPressed) {
      const dir = cmd.slipRightPressed ? 1 : -1;
      if (cruising && !cmd.brake && !cmd.dive) {
        const why =
          V < SLIP.minSpeed
            ? 'Kayış için hızlan'
            : sim.tired || sim.stamina < SLIP.stamina
              ? 'Ejderha yorgun'
              : clearance < SLIP.minClearance || !this.slipRoom(sim, dir)
                ? 'Kayış için yer yok'
                : null;
        if (why) {
          this.hint(sim, why);
        } else {
          this.startSlip(sim, dir);
          return;
        }
      }
    }
    if (cmd.powerPressed && cruising && !cmd.dive && !cmd.brake) {
      this.tryPower(sim);
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
      case 'wingover':
        this.wingoverLaw(sim, t);
        break;
      case 'immelmann':
        this.immelmannLaw(sim, h, t);
        break;
      case 'splits':
        this.splitLaw(sim, cmd, h, t);
        break;
      case 'drop':
        this.dropLaw(sim, t);
        break;
      case 'catch':
        this.catchLaw(sim, t);
        break;
      case 'dart':
        this.dartLaw(sim, cmd, t);
        break;
      case 'slip':
        this.slipLaw(sim, t);
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

  /** 0..1 envelope of the running power stroke (pose and rider cues). */
  get powerEnvelope(): number {
    if (!this.powerActive) {
      return 0;
    }
    return smoothstep(0, 0.08, this.powerTime);
  }

  /** Normal-law hook: the power stroke's two deep, full-amplitude downstrokes and their capped surge. */
  applyPower(sim: FlightSim, t: ControlTargets, wingsFree: boolean): void {
    if (!this.powerActive || !wingsFree) {
      return;
    }
    // Flow makes the surge stronger (exactly the plain stroke without flow).
    const room = this.powerEntry + POWER_STROKE.gain * sim.flow.powerGainScale - sim.airspeed;
    t.effort = 1;
    t.thrustBoost = Math.max(t.thrustBoost, 1 + (POWER_STROKE.thrust * sim.flow.powerThrustScale - 1) * smoothstep(0, 2.5, room));
    t.spread = 1;
    t.sweep = Math.min(t.sweep, POWER_STROKE.sweep);
  }

  /** Space double tap: starts the power stroke (refused, with a hint, when tired or low on stamina). */
  private tryPower(sim: FlightSim): void {
    if (this.powerActive || this.powerCooldown > 0) {
      return;
    }
    if (sim.tired || sim.stamina < POWER_STROKE.minStamina) {
      this.hint(sim, 'Güç vuruşu için ejderha yorgun');
      return;
    }
    this.powerActive = true;
    this.powerTime = 0;
    this.powerEntry = sim.airspeed;
    this.powerTrack.begin(sim);
    sim.stamina = Math.max(0, sim.stamina - POWER_STROKE.stamina);
    const beat = sim.beat;
    const split = TWO_PI * FLAP.downstrokeFraction;
    // The first tap's downstroke still under way counts as the first of the two; otherwise the next one starts now.
    if (beat.amplitude > 0.25 && beat.phase < 0.5 * split) {
      this.powerBeats = 1;
    } else {
      this.powerBeats = 0;
      beat.phase = TWO_PI - 0.25;
    }
    this.powerPrevPhase = beat.phase;
    beat.effort = Math.max(beat.effort, 0.85);
    sim.emit({ type: 'sound', name: 'whoosh', volume: 0.5 });
    this.announce(sim, 'power');
  }

  /** Counts the power stroke's downstrokes and ends it after the last one (every substep while it runs). */
  private updatePower(sim: FlightSim): void {
    this.powerTrack.sample(sim);
    const phase = sim.beat.phase;
    if (phase < this.powerPrevPhase - 1) {
      this.powerBeats++;
    }
    this.powerPrevPhase = phase;
    const split = TWO_PI * FLAP.downstrokeFraction;
    const done = this.powerBeats >= POWER_STROKE.beats && phase >= split;
    if (done || this.powerTime > POWER_STROKE.maxTime || !sim.airborne) {
      this.endPower(sim, !sim.airborne);
    }
  }

  private endPower(sim: FlightSim, forced: boolean): void {
    this.powerActive = false;
    this.powerCooldown = POWER_STROKE.cooldown;
    this.endMove(sim, this.powerTrack.finish(sim, 'power', POWER_STROKE.cleanTolerance, forced));
  }

  /** Logs a finished move and marks its end on the flight-internal maneuver event (flow hooks). */
  endMove(sim: FlightSim, record: MoveRecord): void {
    this.log.push(record);
    if (this.log.length > MOVE_LOG) {
      this.log.shift();
    }
    sim.emit({ type: 'maneuver', id: record.id, label: MANEUVER_LABELS[record.id], ended: true, clean: record.clean });
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
    // The Immelmann's record starts at the loop's entry (height and energy over the whole half loop).
    this.moveTrack.begin(sim);
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

  private startDart(sim: FlightSim): void {
    this.enter('dart');
    this.moveTrack.begin(sim);
    this.dartOpened = false;
    this.diveTime = 0;
    sim.emit({ type: 'sound', name: 'whoosh', volume: 0.7 });
    this.announce(sim, 'dart');
  }

  private startSlip(sim: FlightSim, dir: number): void {
    this.enter('slip');
    this.moveTrack.begin(sim);
    this.slipDir = dir;
    this.slipOrigin.copy(sim.body.position);
    this.slipYaw = sim.axes.yaw();
    // Right of the heading, horizontal (yaw measured with forward = -z).
    this.slipLateral.set(Math.cos(this.slipYaw), 0, -Math.sin(this.slipYaw)).multiplyScalar(dir);
    this.slipPath = clamp(sim.gamma, -15 * DEG, 15 * DEG);
    this.slipPushPrev = 0;
    sim.stamina = Math.max(0, sim.stamina - SLIP.stamina);
    sim.emit({ type: 'sound', name: 'wing-snap', volume: 0.45 });
    sim.emit({ type: 'sound', name: 'whoosh', volume: 0.6 });
    this.announce(sim, 'slip');
  }

  /**
   * Room for a side-slip toward `dir`: horizontal rays along the slip from points along the track (at the body, the
   * feet and the raised wings) reach the shift plus half the span and a margin without a hit, and at the destination
   * the ground (or a roof) stays SLIP.minClearance below the feet and nothing hangs lower than SLIP.headroom above.
   */
  private slipRoom(sim: FlightSim, dir: number): boolean {
    const col = sim.world.collision;
    if (!col) {
      return true;
    }
    const p = sim.body.position;
    const yaw = sim.axes.yaw();
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    _slipDir.set(Math.cos(yaw) * dir, 0, -Math.sin(yaw) * dir);
    const reach = slipDistance(sim) + 0.5 * sim.wing.span + SLIP.sideMargin;
    const run = Math.max(sim.airspeed, 10) * SLIP.time;
    const feet = p.y - sim.footDepth();
    for (const f of SLIP_PROBES) {
      for (const dy of [0, 1 - sim.footDepth(), 3]) {
        _slipFrom.set(p.x + fx * run * f, p.y + dy, p.z + fz * run * f);
        if (col.raycast(_slipFrom, _slipDir, reach, false, _slipHit)) {
          return false;
        }
      }
      const x = p.x + fx * run * f + _slipDir.x * slipDistance(sim);
      const z = p.z + fz * run * f + _slipDir.z * slipDistance(sim);
      col.columnAt(x, z, p.y, _slipColumn);
      const floor = col.terrainHeight(x, z) < -0.4 && _slipColumn.floor < 0.05 ? sim.waterHeight(x, z) : _slipColumn.floor;
      if (feet - floor < SLIP.minClearance || _slipColumn.ceiling < p.y + SLIP.headroom) {
        return false;
      }
    }
    return true;
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

  /** Loop angle (rad) from the entry path, accumulated in the loop plane. */
  private updateLoopAngle(sim: FlightSim): number {
    const air = sim.airVelocity;
    const a = Math.atan2(air.y, air.dot(this.loopForward));
    this.loopAngle += wrapAngle(a - this.prevLoopAngle);
    this.prevLoopAngle = a;
    return this.loopAngle;
  }

  private loopLaw(sim: FlightSim, t: ControlTargets): void {
    const V = sim.airspeed;
    const theta = this.updateLoopAngle(sim);
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
    this.loopSteer(sim, t, theta);
  }

  /** The loop's pitch, roll and wing targets at loop angle `theta` (the loop and the Immelmann's pull). */
  private loopSteer(sim: FlightSim, t: ControlTargets, theta: number): void {
    const V = sim.airspeed;
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

  /* ---------------------------------------------------------------- dart */

  /**
   * Dart: wings half folded and the body streamlined for DART.time, a shallow push-over onto DART.path (shallower
   * near the ground), then the wings open on their own and the path rounds out. A / D steer with a little bank.
   */
  private dartLaw(sim: FlightSim, cmd: PilotCommand, t: ControlTargets): void {
    this.moveTrack.sample(sim);
    const tt = this.time;
    const clearance = this.clearance(sim);
    const tooLow = tt > 0.1 && clearance < DART.minClearance;
    if (tt >= DART.time + DART.open || tooLow) {
      this.endMove(sim, this.moveTrack.finish(sim, 'dart', DART.cleanTolerance, tooLow));
      // Shift still held from the double tap stays ignored until released: the wings stay open.
      this.diveSuppressed = cmd.dive;
      this.finish(sim, clamp(sim.gamma, -5 * DEG, 3 * DEG), true);
      this.normalTargets(t);
      return;
    }
    const folded = tt < DART.time;
    if (!folded && !this.dartOpened) {
      this.dartOpened = true;
      sim.emit({ type: 'sound', name: 'wing-snap', volume: 0.35 });
    }
    const open = smoothstep(DART.time, DART.time + DART.open, tt);
    const depth = DART.path * smoothstep(DART.levelClearance, DART.levelClearance + 8, clearance);
    const gammaTarget = depth * clamp(tt / DART.pathTime, 0, 1) * (1 - open);
    const V = Math.max(sim.airspeed, 10);
    const bankTarget = clamp(cmd.roll, -1, 1) * DART.bank;
    const load = clamp(
      Math.cos(sim.gamma) / Math.max(Math.cos(sim.bank), 0.5) + (V / GRAVITY) * DART.pathGain * (gammaTarget - sim.gamma),
      DART.minLoad,
      DART.maxLoad,
    );
    const alphaTarget = clamp(alphaForLoad(sim, load), ALPHA_MIN, ALPHA_MAX);
    const pitchRate = pitchFeed(sim) + 6 * (alphaTarget - sim.alpha);
    t.rate.set(clamp(pitchRate, -1.2, 1.2), yawFeed(sim) - 1.8 * sim.beta, clamp(3.2 * (sim.bank - bankTarget), -1.5, 1.5));
    t.effort = 0;
    t.spread = folded ? DART.spread : 1;
    t.sweep = folded ? DART.sweep : 0;
    t.spreadRate = DART.foldRate;
    t.sweepRate = DART.foldRate;
    t.dragScale = lerp(DART.dragScale, 1, open);
    t.brake = 0;
    t.legsOut = 0;
    t.hover = 0;
    t.authority.set(1.5, 1.5, 1.5);
  }

  /* ---------------------------------------------------------------- side-slip */

  /**
   * Side-slip: the lateral offset from the entry line follows a sine-shaped acceleration profile (out, then back to
   * zero lateral speed) over SLIP.time. The bank into the slip and out of it tilts the lift sideways; the wing and tail
   * flick (t.push) supplies the rest, with feedback on the offset and its rate. The heading and the entry path are held.
   */
  private slipLaw(sim: FlightSim, t: ControlTargets): void {
    this.moveTrack.sample(sim);
    const T = SLIP.time;
    const tt = this.time;
    const L = this.slipLateral;
    const p = sim.body.position;
    const v = sim.body.velocity;
    _slipOffset.copy(p).sub(this.slipOrigin);
    const offset = _slipOffset.dot(L);
    if (tt >= T) {
      const record = this.moveTrack.finish(sim, 'slip', SLIP.cleanTolerance);
      record.lateral = offset;
      record.headingChange = wrapAngle(sim.axes.yaw() - this.slipYaw);
      this.endMove(sim, record);
      this.slipDir = 0;
      this.finish(sim, clamp(sim.gamma, -5 * DEG, 8 * DEG), true);
      this.normalTargets(t);
      return;
    }
    const w = TWO_PI / T;
    const A = (TWO_PI * slipDistance(sim)) / (T * T);
    const sDes = slipDistance(sim) * (tt / T - Math.sin(w * tt) / TWO_PI);
    const vDes = (A / w) * (1 - Math.cos(w * tt));
    const aDes = A * Math.sin(w * tt);
    const a = aDes + SLIP.offsetGain * (sDes - offset) + SLIP.speedGain * (vDes - v.dot(L));
    // Lateral acceleration the air already gives (last substep's specific force without last substep's push).
    const aero = sim.specificForce.dot(L) - this.slipPushPrev / MASS;
    const push = clamp(a - aero, -SLIP.maxPush * GRAVITY, SLIP.maxPush * GRAVITY) * MASS;
    this.slipPushPrev = push;
    t.push.copy(L).multiplyScalar(push);

    // Heading held (world yaw rate toward the entry heading), a quick bank into the slip and out of it.
    const yawRate = -SLIP.headingGain * wrapAngle(sim.axes.yaw() - this.slipYaw);
    _invQ.copy(sim.body.quaternion).invert();
    _dir.set(0, yawRate, 0).applyQuaternion(_invQ);
    // The bank leads a little (the roll takes a moment), so the wings are level again as the slip ends.
    const bankTarget = this.slipDir * SLIP.bank * Math.sin(w * Math.min(tt + SLIP.bankLead, T));
    const V = Math.max(sim.airspeed, 10);
    // Load the wing has to carry: what holds the path, minus the part of the push along the body's up axis.
    const pushUp = (push * L.dot(sim.axes.up)) / (MASS * GRAVITY);
    const load = clamp(
      Math.cos(sim.gamma) / Math.max(Math.cos(sim.bank), 0.5) + (V / GRAVITY) * 2.5 * (this.slipPath - sim.gamma) - pushUp,
      0,
      3.5,
    );
    const alphaTarget = clamp(alphaForLoad(sim, load), ALPHA_MIN, ALPHA_MAX);
    const pitchRate = pitchFeed(sim) + 6 * (alphaTarget - sim.alpha);
    t.rate.set(_dir.x + clamp(pitchRate, -1.2, 1.2), _dir.y, _dir.z + clamp(4 * (sim.bank - bankTarget), -2.5, 2.5));
    // One strong asymmetric beat for the flick, lighter strokes while sliding.
    t.effort = tt < 0.5 * T ? 0.9 : 0.4;
    t.spread = 1;
    t.sweep = 0;
    t.brake = 0;
    t.legsOut = 0;
    t.hover = 0;
    t.authority.set(SLIP.authority[0], SLIP.authority[1], SLIP.authority[2]);
  }

  /* ---------------------------------------------------------------- stage C reversals */

  /**
   * Ends a reversal: logs its record and marks its end. Clean = no contact, no stall, not cut short, upright, the track
   * within headingTolerance of the reverse heading, and the move's energy trade: the wingover keeps cleanEnergy of the
   * entry's specific energy, the Immelmann ends higher (and keeps cleanEnergy), the Split-S ends lower and faster.
   */
  private endReversal(sim: FlightSim, id: 'wingover' | 'immelmann' | 'splits', forced: boolean): MoveRecord {
    const rec = this.moveTrack.finish(sim, id, Infinity, forced);
    const tolerance = id === 'wingover' ? WINGOVER.headingTolerance : id === 'immelmann' ? IMMELMANN.headingTolerance : SPLIT_S.headingTolerance;
    const reversed = Math.abs(Math.PI - Math.abs(rec.headingChange)) <= tolerance;
    const upright = sim.axes.up.y > 0.5;
    const traded =
      id === 'wingover'
        ? rec.energyRatio >= WINGOVER.cleanEnergy
        : id === 'immelmann'
          ? rec.heightChange > 0 && rec.energyRatio >= IMMELMANN.cleanEnergy
          : rec.heightChange < 0 && rec.exitSpeed >= rec.entrySpeed - SPLIT_S.cleanTolerance;
    rec.clean = !forced && !rec.contact && !rec.stalled && reversed && upright && traded;
    this.endMove(sim, rec);
    this.reversalDir = 0;
    return rec;
  }

  /** Roll angle of the body about the flight path from the loop plane's right axis (rad, + = rolled right). */
  private planeRoll(sim: FlightSim): number {
    const right = sim.axes.right;
    const V = Math.max(sim.airspeed, 1);
    _cross.crossVectors(this.loopRight, right);
    _slipDir.copy(sim.airVelocity).divideScalar(V);
    return Math.atan2(_cross.dot(_slipDir), right.dot(this.loopRight));
  }

  /**
   * One substep of a half roll about the flight path toward `reversalDir` (the Immelmann's and the Split-S's): body
   * rates into `t.rate` (the roll only), returns the angle still to roll (rad).
   */
  private halfRoll(sim: FlightSim, h: number, t: ControlTargets, rate: number, accel: number, decel: number): number {
    const dir = this.reversalDir;
    const roll = this.planeRoll(sim);
    this.revRolled += wrapAngle(roll - this.revPrevRoll) * dir;
    this.revPrevRoll = roll;
    const remaining = Math.PI - this.revRolled;
    const want = Math.min(rate, Math.sqrt(2 * decel * Math.max(remaining, 0)));
    this.revRate = Math.min(want, this.revRate + accel * h);
    _invQ.copy(sim.body.quaternion).invert();
    _dir.copy(sim.airVelocity).divideScalar(Math.max(sim.airspeed, 1)).applyQuaternion(_invQ);
    t.rate.copy(_dir).multiplyScalar(this.revRate * dir);
    return remaining;
  }

  /** Starts a half roll from the current roll rate about the flight path. */
  private beginHalfRoll(sim: FlightSim): void {
    this.reversalPhase = 'roll';
    this.revRolled = 0;
    this.revPrevRoll = this.planeRoll(sim);
    this.revPhaseTime = 0;
    _invQ.copy(sim.body.quaternion).invert();
    _dir.copy(sim.airVelocity).divideScalar(Math.max(sim.airspeed, 1)).applyQuaternion(_invQ);
    this.revRate = Math.max(0, this.reversalDir * sim.body.angularVelocity.dot(_dir));
  }

  /** Sets the horizontal plane of a reversal (loopForward / loopRight) from the air track (or the body when vertical). */
  private setPlane(sim: FlightSim): void {
    const v = sim.airVelocity;
    this.loopForward.set(v.x, 0, v.z);
    if (this.loopForward.lengthSq() < 0.01 * Math.max(sim.airspeed * sim.airspeed, 1)) {
      // Straight down: the body's forward (or, nose down, the back of its up axis) points along the track.
      const F = sim.axes.forward;
      const U = sim.axes.up;
      this.loopForward.set(F.x, 0, F.z);
      if (this.loopForward.lengthSq() < 1e-4) {
        this.loopForward.set(-U.x, 0, -U.z);
      }
    }
    if (this.loopForward.lengthSq() < 1e-6) {
      this.loopForward.set(0, 0, -1);
    }
    this.loopForward.normalize();
    this.loopRight.set(-this.loopForward.z, 0, this.loopForward.x);
  }

  /* ---------------------------------------------------------------- wingover */

  /**
   * Room for a wingover toward `dir`: headroom for the climb, and along the turn (an inner and an outer arc of the
   * planned radius, with the wingtip margin) no wall at the body's height or halfway up the climb, the ground or a
   * roof WINGOVER.minClearance below the feet, nothing overhead lower than the climb.
   */
  private wingoverRoom(sim: FlightSim, dir: number): boolean {
    if (this.headroom(sim) < WINGOVER.headroom) {
      return false;
    }
    const col = sim.world.collision;
    if (!col) {
      return true;
    }
    const p = sim.body.position;
    const heading = airHeading(sim);
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    const rx = Math.cos(heading) * dir;
    const rz = Math.sin(heading) * dir;
    const radius = (sim.airspeed * sim.airspeed) / (GRAVITY * WINGOVER.turnLoad);
    const margin = 0.5 * sim.wing.span + WINGOVER.sideMargin;
    const feet = p.y - sim.footDepth();
    const steps = 6;
    for (const r of [Math.max(radius - margin, 0.4 * radius), radius + margin]) {
      let px = p.x;
      let pz = p.z;
      for (let i = 1; i <= steps; i++) {
        const psi = (Math.PI * i) / steps;
        const x = p.x + r * (Math.sin(psi) * fx + (1 - Math.cos(psi)) * rx);
        const z = p.z + r * (Math.sin(psi) * fz + (1 - Math.cos(psi)) * rz);
        const dx = x - px;
        const dz = z - pz;
        const len = Math.hypot(dx, dz);
        _slipDir.set(dx / len, 0, dz / len);
        for (const dy of [0, 0.5 * WINGOVER.headroom]) {
          _slipFrom.set(px, p.y + dy, pz);
          if (col.raycast(_slipFrom, _slipDir, len, false, _slipHit)) {
            return false;
          }
        }
        col.columnAt(x, z, p.y, _slipColumn);
        const floor = col.terrainHeight(x, z) < -0.4 && _slipColumn.floor < 0.05 ? sim.waterHeight(x, z) : _slipColumn.floor;
        if (feet - floor < WINGOVER.minClearance || _slipColumn.ceiling < p.y + WINGOVER.headroom) {
          return false;
        }
        px = x;
        pz = z;
      }
    }
    return true;
  }

  private startWingover(sim: FlightSim, dir: number): void {
    this.enter('wingover');
    this.moveTrack.begin(sim);
    this.reversalDir = dir;
    this.woTurned = 0;
    this.wingoverProgress = 0;
    this.woPrevHeading = airHeading(sim);
    // The turn starts from the horizontal lift the entry bank already gives (no roll back toward level first).
    this.woStartLoad = clamp(Math.tan(Math.min(Math.abs(pathBank(sim)), 70 * DEG)), 0.6, WINGOVER.turnLoad);
    this.woDiveDepth = 1;
    sim.stamina = Math.max(0, sim.stamina - WINGOVER.stamina);
    sim.emit({ type: 'sound', name: 'whoosh', volume: 0.8 });
    this.announce(sim, 'wingover');
  }

  /**
   * Wingover: the flight path follows a planned climb and dive over the heading turned (WINGOVER), the lift vector is
   * solved for it each substep (vertical part: the path's curvature plus gravity, horizontal part: the turn) and the
   * dragon rolls about the flight path to point it. Over the top, slow, the vertical part goes below zero: the bank
   * passes 90° and the nose slices through the horizon (the pivot over the high wing), then the dive rolls out.
   */
  private wingoverLaw(sim: FlightSim, t: ControlTargets): void {
    this.moveTrack.sample(sim);
    const dir = this.reversalDir;
    const heading = airHeading(sim);
    this.woTurned += dir * wrapAngle(heading - this.woPrevHeading);
    this.woPrevHeading = heading;
    const p = clamp(this.woTurned / Math.PI, 0, 1);
    this.wingoverProgress = p;
    const forced = this.time > WINGOVER.maxTime;
    if (p >= WINGOVER.endProgress || forced) {
      this.endReversal(sim, 'wingover', forced);
      this.finish(sim, clamp(sim.gamma, -10 * DEG, 5 * DEG), !forced);
      this.normalTargets(t);
      return;
    }
    const V = Math.max(sim.airspeed, 6);
    const gamma = sim.gamma;
    // Near the ground the dive out gets shallower (never deeper than it was planned at a lower clearance).
    this.woDiveDepth = Math.min(this.woDiveDepth, smoothstep(WINGOVER.minClearance - 10, WINGOVER.diveClearance, this.clearance(sim)));
    const amp = p < 0.5 ? WINGOVER.climb : WINGOVER.dive * this.woDiveDepth;
    const gammaPlan = amp * wingoverShape(p);
    const slope = amp * wingoverSlope(p);
    let turn = lerp(this.woStartLoad, WINGOVER.turnLoad, smoothstep(0, 0.25, p));
    turn = lerp(turn, WINGOVER.diveLoad, smoothstep(0.5, 0.65, p));
    turn = lerp(turn, WINGOVER.endLoad, smoothstep(0.75, 1, p));
    const headingRate = (GRAVITY * turn) / (V * Math.max(Math.cos(gamma), 0.3));
    const gammaRate = (slope * headingRate) / Math.PI + WINGOVER.pathGain * (gammaPlan - gamma);
    // Over the top the vertical part may go a little below zero (the bank passes 90°), no further; past the top the
    // push into the dive may go on a little further while the nose falls.
    const floor = lerp(WINGOVER.topLift, WINGOVER.diveLift, smoothstep(0.55, 0.7, p));
    const vertical = Math.max(Math.cos(gamma) + (V * gammaRate) / GRAVITY, floor);
    // A softer pull-out (less induced drag): the dive may run a little deeper and faster than planned.
    const maxLoad = lerp(WINGOVER.maxLoad, WINGOVER.exitLoad, smoothstep(0.6, 0.75, p));
    let load = Math.min(Math.hypot(vertical, turn), maxLoad);
    let bankTarget = dir * Math.atan2(turn, vertical);
    // The climb keeps a bank toward the turn (a climbing turn, not a straight pull-up): the vertical part comes from a
    // firmer pull at that bank instead.
    const bankFloor = WINGOVER.climbBank * (1 - smoothstep(0.35, 0.5, p));
    if (Math.abs(bankTarget) < bankFloor && vertical > 0) {
      bankTarget = dir * bankFloor;
      load = Math.min(vertical / Math.cos(bankFloor), maxLoad);
    }
    const bank = pathBank(sim);
    const rollRate = clamp(WINGOVER.rollGain * wrapAngle(bankTarget - bank), -WINGOVER.rollRate, WINGOVER.rollRate);
    _invQ.copy(sim.body.quaternion).invert();
    _dir.copy(sim.airVelocity).divideScalar(Math.max(sim.airspeed, 1)).applyQuaternion(_invQ);
    t.rate.copy(_dir).multiplyScalar(rollRate);
    // Steady beats on the climb, hard ones while slow over the top (their dynamic lift helps the pivot).
    const climbing = p < 0.42;
    const hard = V < 20;
    const boost = hard ? WINGOVER.liftBoost : 0;
    const alphaTarget = clamp(alphaForLoad(sim, load, boost), ALPHA_MIN, ALPHA_MAX);
    t.rate.x += pitchFeed(sim) + 6 * (alphaTarget - sim.alpha);
    t.rate.y += yawFeed(sim) - 1.8 * sim.beta;
    t.effort = hard ? 1 : climbing ? WINGOVER.climbEffort : WINGOVER.diveEffort;
    t.liftBoost = boost;
    t.spread = 1;
    t.sweep = 0;
    t.brake = 0;
    t.legsOut = 0;
    t.hover = 0;
    t.authority.set(2, 1.5, 2);
  }

  /* ---------------------------------------------------------------- Immelmann */

  /** A / D pressed during a loop: the Immelmann when the loop is at its top and there is room to roll. */
  private tryImmelmann(sim: FlightSim, dir: number): void {
    if (!inImmelmannWindow(this.loopAngle, IMMELMANN.windowStart, IMMELMANN.windowEnd)) {
      return;
    }
    if (this.headroom(sim) < 0.5 * sim.wing.span + PROXIMITY.ceilingMargin) {
      this.hint(sim, 'Immelmann için yer yok');
      return;
    }
    this.kind = 'immelmann';
    this.time = 0;
    this.reversalDir = dir;
    this.reversalPhase = 'pull';
    if (this.loopAngle >= Math.PI - IMMELMANN.rollStart) {
      this.beginHalfRoll(sim);
      sim.emit({ type: 'sound', name: 'wing-snap', volume: 0.4 });
    }
    sim.emit({ type: 'sound', name: 'whoosh', volume: 0.6 });
    this.announce(sim, 'immelmann');
  }

  /**
   * Immelmann: the loop pulls on to the top (the path level on its back), then a half roll about the flight path
   * toward the key's side brings the dragon upright, on the reverse heading, a loop's height above the entry.
   */
  private immelmannLaw(sim: FlightSim, h: number, t: ControlTargets): void {
    this.moveTrack.sample(sim);
    const theta = this.updateLoopAngle(sim);
    const forced = this.time > IMMELMANN.maxTime + 0.25 * TRICKS.loopMaxTime;
    if (this.reversalPhase === 'pull') {
      if (theta >= Math.PI - IMMELMANN.rollStart) {
        this.beginHalfRoll(sim);
        sim.emit({ type: 'sound', name: 'wing-snap', volume: 0.4 });
      } else if (forced || sim.airspeed < 7) {
        this.endReversal(sim, 'immelmann', true);
        this.finish(sim, clamp(sim.gamma, -0.4, 0.2), false);
        this.normalTargets(t);
        return;
      } else {
        this.loopSteer(sim, t, theta);
        return;
      }
    }
    this.revPhaseTime += h;
    const remaining = this.halfRoll(sim, h, t, IMMELMANN.rollRate, IMMELMANN.rollAccel, IMMELMANN.rollDecel);
    if (remaining < 3 * DEG || forced || this.revPhaseTime > IMMELMANN.maxTime) {
      this.endReversal(sim, 'immelmann', forced);
      this.finish(sim, clamp(sim.gamma, -6 * DEG, 10 * DEG), !forced);
      this.normalTargets(t);
      return;
    }
    // Lift shaped for a straight, level path while rolling (a push on the back, a pull upright), a moment ahead.
    const V = Math.max(sim.airspeed, 6);
    const c = Math.cos(pathBank(sim) + this.reversalDir * this.revRate * ROLL_LEAD);
    const hold = Math.cos(sim.gamma) + (V * 1.5 * (0 - sim.gamma)) / GRAVITY;
    const load = clamp(c * hold, -1.2, 2.5);
    const alphaTarget = clamp(alphaForLoad(sim, load, TRICKS.loopLiftBoost), ALPHA_MIN, ALPHA_MAX);
    t.rate.x += pitchFeed(sim) + ROLL_ALPHA_GAIN * (alphaTarget - sim.alpha);
    t.rate.y += yawFeed(sim) - 1.8 * sim.beta;
    t.effort = V < 20 ? 1 : 0.3;
    t.thrustBoost = TRICKS.loopThrust;
    t.liftBoost = TRICKS.loopLiftBoost;
    t.spread = IMMELMANN.spread;
    t.sweep = IMMELMANN.sweep;
    t.brake = 0;
    t.legsOut = 0;
    t.hover = 0;
    t.authority.set(IMMELMANN.authority[0], IMMELMANN.authority[1], IMMELMANN.authority[2]);
  }

  /* ---------------------------------------------------------------- Split-S */

  /** Seconds a Split-S half roll takes from rest (acceleration, cruise and deceleration of the roll rate). */
  private splitRollTime(): number {
    const r = SPLIT_S.rollRate;
    return Math.PI / r + (0.5 * r) / SPLIT_S.rollAccel + (0.5 * r) / SPLIT_S.rollDecel;
  }

  /**
   * Point-mass prediction of a Split-S in the vertical plane of the track: `rollTime` s straight along the path (the
   * half roll), then the pull through at `load` (`onsetDone` s into its onset) until the path is level on the reverse
   * heading. `u0` is the speed along the entry heading (negative past the vertical), `w0` the vertical speed. Returns
   * the height lost to the lowest point (m) and the horizontal offsets along the entry heading of the farthest point
   * and of the end (m).
   */
  predictSplit(sim: FlightSim, u0: number, w0: number, rollTime: number, load: number, onsetDone: number): { drop: number; far: number; end: number } {
    let u = u0;
    let w = w0;
    const rho = airDensity(sim.body.position.y);
    const weight = MASS * GRAVITY;
    const area = WING.areaSpread * 0.8;
    const dt = 0.04;
    let x = 0;
    let y = 0;
    let minY = 0;
    let far = 0;
    for (let i = 0; i < 400; i++) {
      const time = i * dt;
      const V = Math.max(Math.hypot(u, w), 0.1);
      const q = 0.5 * rho * V * V;
      const drag = (q * (PREDICT_CDA + 0.03 * area)) / MASS;
      let au: number;
      let aw: number;
      if (time < rollTime) {
        const along = (-GRAVITY * w) / V - drag;
        au = (u / V) * along;
        aw = (w / V) * along;
      } else {
        const onset = smoothstep(0, SPLIT_S.onset, time - rollTime + onsetDone);
        const n = Math.min(load * Math.max(onset, 0.15), (PREDICT_CL * q * area) / weight);
        // On its back the lift turns the path down through the vertical and back to level (clockwise in u, w).
        au = (w / V) * n * GRAVITY - (u / V) * drag;
        aw = (-u / V) * n * GRAVITY - GRAVITY - (w / V) * drag;
      }
      u += au * dt;
      w += aw * dt;
      x += u * dt;
      y += w * dt;
      minY = Math.min(minY, y);
      far = Math.max(far, x);
      if (time > rollTime && u < 0 && w >= 0) {
        break;
      }
    }
    return { drop: -minY, far, end: x };
  }

  /**
   * Room for a Split-S from here: the predicted lowest point of the body keeps SPLIT_S.margin above the surface now,
   * along the track ahead, and below the farthest point and the end of the pull through.
   */
  private splitRoom(sim: FlightSim): boolean {
    const v = sim.airVelocity;
    const pred = this.predictSplit(sim, Math.hypot(v.x, v.z), v.y, this.splitRollTime(), SPLIT_S.load, 0);
    if (this.clearance(sim) < pred.drop + SPLIT_S.margin) {
      return false;
    }
    const col = sim.world.collision;
    if (!col) {
      return true;
    }
    const p = sim.body.position;
    const horizontal = Math.max(Math.hypot(v.x, v.z), 1e-3);
    const fx = v.x / horizontal;
    const fz = v.z / horizontal;
    const lowest = p.y - pred.drop - sim.footDepth();
    for (const d of [pred.far, pred.end, 0.5 * (pred.far + pred.end)]) {
      const x = p.x + fx * d;
      const z = p.z + fz * d;
      col.columnAt(x, z, lowest, _slipColumn);
      const floor = col.terrainHeight(x, z) < -0.4 && _slipColumn.floor < 0.05 ? sim.waterHeight(x, z) : _slipColumn.floor;
      if (lowest - floor < SPLIT_S.margin) {
        return false;
      }
    }
    return true;
  }

  private startSplit(sim: FlightSim, dir: number): void {
    this.enter('splits');
    this.moveTrack.begin(sim);
    this.reversalDir = dir;
    this.setPlane(sim);
    this.beginHalfRoll(sim);
    this.splitUrgent = false;
    this.splitNeedTimer = 0;
    this.splitNeed = 0;
    this.diveTime = 0;
    sim.emit({ type: 'sound', name: 'whoosh', volume: 0.8 });
  }

  /**
   * Split-S: a half roll onto the back about the flight path (the dive goes on straight), then a firm pull through the
   * bottom of a half loop in the entry's vertical plane to level flight on the reverse heading. The pull goes up to
   * SPLIT_S.maxLoad when the predicted bottom gets close to the ground. The key still held as the half roll ends hands
   * over to the diving barrel roll instead (the spinning dive).
   */
  private splitLaw(sim: FlightSim, cmd: PilotCommand, h: number, t: ControlTargets): void {
    this.moveTrack.sample(sim);
    const dir = this.reversalDir;
    const V = Math.max(sim.airspeed, 6);
    const clearance = this.clearance(sim);
    this.revPhaseTime += h;
    if (this.reversalPhase === 'roll') {
      const remaining = this.halfRoll(sim, h, t, SPLIT_S.rollRate, SPLIT_S.rollAccel, SPLIT_S.rollDecel);
      if (remaining >= 3 * DEG && this.revPhaseTime <= 2) {
        // Straight dive while rolling: the lift carries only gravity's part square to the path, shaped a moment ahead.
        const c = Math.cos(pathBank(sim) + dir * this.revRate * ROLL_LEAD);
        const alphaTarget = clamp(alphaForLoad(sim, c * Math.cos(sim.gamma)), ALPHA_MIN, ALPHA_MAX);
        t.rate.x += pitchFeed(sim) + ROLL_ALPHA_GAIN * (alphaTarget - sim.alpha);
        t.rate.y += yawFeed(sim) - 1.8 * sim.beta;
        t.effort = 0;
        t.spread = SPLIT_S.rollSpread;
        t.sweep = SPLIT_S.rollSweep;
        t.brake = 0;
        t.legsOut = 0;
        t.hover = 0;
        t.authority.set(SPLIT_S.rollAuthority[0], SPLIT_S.rollAuthority[1], SPLIT_S.rollAuthority[2]);
        return;
      }
      const held = dir > 0 ? cmd.roll > 0.5 : cmd.roll < -0.5;
      if (held && clearance > TRICKS.rollKeepClearance && sim.airspeed > TRICKS.rollMinSpeed - 4) {
        this.splitToRoll(sim);
        this.rollLaw(sim, cmd, h, t);
        return;
      }
      this.reversalPhase = 'pull';
      this.revPhaseTime = 0;
      this.splitLoadStart = clamp(sim.loadFactor, 0, 1.5);
      this.splitAngle = Math.atan2(sim.airVelocity.y, sim.airVelocity.dot(this.loopForward));
      this.splitPrevAngle = this.splitAngle;
      sim.emit({ type: 'sound', name: 'wing-snap', volume: 0.55 + 0.4 * smoothstep(20, 70, V) });
      sim.emit({ type: 'shake', amount: 0.12 + 0.2 * smoothstep(20, 70, V) });
      this.announce(sim, 'splits');
    }
    // Pull through: the path angle in the entry plane runs from the dive through the vertical to level backwards.
    const air = sim.airVelocity;
    const a = Math.atan2(air.y, air.dot(this.loopForward));
    this.splitAngle += wrapAngle(a - this.splitPrevAngle);
    this.splitPrevAngle = a;
    const forced = this.time > SPLIT_S.maxTime;
    if ((this.splitAngle < -0.5 * Math.PI && sim.gamma >= -SPLIT_S.exitPath) || forced) {
      this.endReversal(sim, 'splits', forced);
      // Shift still held from the dive stays ignored until released: the wings stay open.
      this.diveSuppressed = cmd.dive;
      this.finish(sim, clamp(sim.gamma, -3 * DEG, 8 * DEG), !forced);
      this.normalTargets(t);
      return;
    }
    // Watch the bottom: pull harder when the predicted lowest point gets close to the ground.
    this.splitNeedTimer -= h;
    if (this.splitNeedTimer <= 0) {
      this.splitNeedTimer = PREDICT_INTERVAL;
      this.splitNeed = this.predictSplit(sim, air.dot(this.loopForward), air.y, 0, SPLIT_S.load, this.revPhaseTime).drop;
    }
    if (!this.splitUrgent && clearance < this.splitNeed + 0.5 * SPLIT_S.margin) {
      this.splitUrgent = true;
    }
    const onset = smoothstep(0, SPLIT_S.onset, this.revPhaseTime);
    const target = this.splitUrgent ? SPLIT_S.maxLoad : SPLIT_S.load;
    const load = lerp(this.splitLoadStart, target, onset);
    const alphaTarget = clamp(alphaForLoad(sim, load), ALPHA_MIN, ALPHA_MAX);
    let pitchRate = pitchFeed(sim) + 6 * (alphaTarget - sim.alpha);
    if (sim.loadFactor > target + 0.4) {
      pitchRate -= (sim.loadFactor - target - 0.4) * 0.6;
    }
    // Wings level in the entry plane, on the back: the body's right axis on the plane's left.
    const right = sim.axes.right;
    _slipOffset.copy(this.loopRight).negate();
    _cross.crossVectors(right, _slipOffset);
    const rollErr = Math.atan2(_cross.dot(sim.axes.forward), right.dot(_slipOffset));
    t.rate.set(clamp(pitchRate, -1.8, 1.8), yawFeed(sim) - 1.8 * sim.beta, -clamp(3 * rollErr, -1.5, 1.5));
    // Wings open (part way at dive speed, like the catch), a strong beat when slow at the bottom.
    t.spread = clamp(1.25 - V / 110, 0.62, 1);
    t.sweep = 0;
    t.spreadRate = 5;
    t.sweepRate = 5;
    t.effort = V < 22 ? 1 : 0;
    t.brake = 0;
    t.legsOut = 0;
    t.hover = 0;
    t.authority.set(2.5, 1.5, 1.5);
  }

  /** The key held through the Split-S's half roll: the diving barrel roll finishes the revolution (and spins on). */
  private splitToRoll(sim: FlightSim): void {
    const dir = this.reversalDir;
    this.kind = 'roll';
    this.time = 0.3;
    this.rollDir = dir;
    this.rollEntryPath = Math.min(sim.gamma, -16 * DEG);
    this.rollTarget = TWO_PI;
    this.rolled = this.revRolled;
    this.revolutions = 0;
    this.rollRate = this.revRate;
    this.prevBank = sim.bank;
    this.reversalDir = 0;
    this.announce(sim, 'roll');
  }

  /**
   * Pose cues of the reversals: `pull` 0..1 while a loop-like pull runs (the neck raised into it), `roll` signed
   * (+ right) during a half roll, `pivot` signed (+ right) around the wingover's top.
   */
  get reversalCue(): { pull: number; roll: number; pivot: number } {
    const out = _cue;
    out.pull = 0;
    out.roll = 0;
    out.pivot = 0;
    if (this.kind === 'wingover') {
      const p = this.wingoverProgress;
      out.pivot = this.reversalDir * smoothstep(0.2, 0.45, p) * (1 - smoothstep(0.6, 0.9, p));
      out.pull = 1 - smoothstep(0.25, 0.45, p);
    } else if (this.kind === 'immelmann' || this.kind === 'splits') {
      out.pull = this.reversalPhase === 'pull' ? 1 : 0;
      out.roll = this.reversalPhase === 'roll' ? this.reversalDir : 0;
    } else if (this.kind === 'loop') {
      out.pull = 1;
    }
    return out;
  }

  /** The side-slip's flick, signed (+ right): into the slip, then out of it (the pose's wing and tail cue). */
  get slipCue(): number {
    if (this.kind !== 'slip') {
      return 0;
    }
    return this.slipDir * Math.sin((TWO_PI * this.time) / SLIP.time);
  }

  /** Neutral targets for the substep in which a trick ends (the normal law takes over from the next one). */
  private normalTargets(t: ControlTargets): void {
    t.effort = 0;
    t.spread = 1;
    t.sweep = 0;
  }

  /** Test/diagnostics view of the running trick. */
  describe(): { kind: TrickKind; time: number; rolledDeg: number; revolutions: number; loopDeg: number; pullOutNeed: number; power: boolean } {
    return {
      power: this.powerActive,
      kind: this.kind,
      time: Math.round(this.time * 100) / 100,
      rolledDeg: Math.round((this.rolled * 180) / Math.PI),
      revolutions: this.revolutions,
      loopDeg: Math.round((this.loopAngle * 180) / Math.PI),
      pullOutNeed: Math.round(this.pullOutNeed * 10) / 10,
    };
  }
}
