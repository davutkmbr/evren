import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../../core/math/noise';
import { airDensity, ceilingFactor } from './aero';
import { takeoffLegs } from './ground-moves';
import { DEG, ENVELOPE, FLAP, GRAVITY, HOVER, LANDING, LEAP, MASS, PLUNGE, PROXIMITY, RUNOUT, WING } from './params';
import type { FlightSim } from './sim';
import type { PilotCommand } from './types';
import { copyPilotCommand, createPilotCommand } from './types';
import { maxBankForClearance } from './wingtip';

const TWO_PI = Math.PI * 2;
/** A Space tap holds strong effort until one full downstroke is done (or this many seconds). */
const TAP_TIMEOUT = 1.3;
const TAP_EFFORT = 0.95;
const COS_FF_FADE = Math.cos(75 * DEG);
/** Cruise governor: speed low-pass (s), bank that counts as a sustained turn, speed kept above the protected minimum. */
const GOVERNOR_SPEED_TAU = 1;
const GOVERNOR_TURN_BANK = 25 * DEG;
const GOVERNOR_TURN_MARGIN = 3;
/** Extra flap force of the first take-off beats (fraction). */
const TAKEOFF_BOOST = 0.7;

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const _latched = createPilotCommand();
const _masked = createPilotCommand();

function neutralPitch(pilot: PilotCommand): PilotCommand {
  copyPilotCommand(pilot, _latched);
  _latched.pitch = 0;
  return _latched;
}

/** The pilot command with Shift ignored (a held dive that a catch has ended). */
function withoutDive(pilot: PilotCommand): PilotCommand {
  copyPilotCommand(pilot, _masked);
  _masked.dive = false;
  return _masked;
}

/** Steepest descent (negative) that still reaches `room` metres of spare height within `reach` metres. */
function pathFloor(room: number, reach: number): number {
  return -Math.asin(clamp(room / Math.max(reach, 1), -0.45, 1));
}

const _levelUp = new THREE.Vector3();
const _desiredUp = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _feedForward = new THREE.Vector3();
const _invQ = new THREE.Quaternion();

/** Outputs of the assist layer, consumed by the airborne dynamics each substep. */
export interface ControlTargets {
  /** Desired body angular velocity (rad/s). */
  readonly rate: THREE.Vector3;
  effort: number;
  spread: number;
  sweep: number;
  brake: number;
  legsOut: number;
  hover: number;
  /** Tricks: control authority multipliers (pitch, yaw, roll), 1 = normal. */
  readonly authority: THREE.Vector3;
  /** Flap force multiplier (the urge's strong beats, loops), 1 = normal. */
  thrustBoost: number;
  /** Dynamic lift of hard-flapping wings in a loop (fraction of extra lift), 0 = none. */
  liftBoost: number;
  /** Wing fold/unfold and sweep rates (1/s) for snaps; 0 = the muscles' normal rates. */
  spreadRate: number;
  sweepRate: number;
  /** Parasite drag multiplier (a streamlined dart), 1 = normal. */
  dragScale: number;
  /** Extra muscle force on the body (world frame, N): the side-slip's wing and tail flick. */
  readonly push: THREE.Vector3;
}

export function createControlTargets(): ControlTargets {
  return {
    rate: new THREE.Vector3(),
    effort: 0,
    spread: 1,
    sweep: 0,
    brake: 0,
    legsOut: 0,
    hover: 0,
    authority: new THREE.Vector3(1, 1, 1),
    thrustBoost: 1,
    liftBoost: 0,
    spreadRate: 0,
    sweepRate: 0,
    dragScale: 1,
    push: new THREE.Vector3(),
  };
}

/**
 * "Assisted" flight control: bank-angle command with auto-coordinated turns, pitch-rate command with
 * flight-path hold and gentle auto-level, soft AoA / load-factor limiters, a flap-glide cruise governor,
 * hover (vertical speed + attitude hold), take-off climb-out and an assisted landing approach + flare.
 */
export class FlightController {
  private gammaHold = 0;
  private pitchIdle = 0;
  private burst = false;
  private burstBeats = 0;
  /** Airspeed low-passed for the cruise governor (0 = take the next sample). */
  private cruiseSpeed = 0;
  private hoverIntegral = 0;
  flare = false;
  hoverDescent = false;
  /** Landing: the shallow approach that touches down running (null until the landing has chosen). */
  runOutApproach: boolean | null = null;
  /** Upset recovery (after collisions / departures): nose down, wings level, then resume. */
  upset = false;
  private diveLatched = false;
  private tapTimer = 0;
  private tapStroke = false;
  /* Hover: integral terms of the ground-velocity hold and the captured height of an idle hover. */
  private hoverForwardI = 0;
  private hoverLateralI = 0;
  private hoverHoldY: number | null = null;
  /** Vertical speed low-passed over the wing-beat bob (the hover height loop must not chase each stroke). */
  private hoverClimb = 0;
  /* Low-speed (energy) protection, refreshed every substep of the normal law. */
  private sustainPath = 0;
  /** Steepest flight path the assist allows now (rad). */
  gammaMax = 0.9;
  /** Protected minimum airspeed at the current turn load (m/s). */
  minSpeed = 0;
  /** Stall speed at the current turn load (m/s). */
  stallSpeed = 0;
  /** Largest bank the current speed supports with margin (rad). */
  bankMax: number = ENVELOPE.maxBank;
  private forwardLatch = false;
  /** Pitch rate limit (rad/s) of the flight-path override (the landing approach pitches over faster). */
  private pathRateLimit = 0.5;
  /** Steepest flight path that keeps the dragon below the ceilings along its track (Infinity when open sky). */
  private ceilingPath = Infinity;

  reset(gamma = 0): void {
    this.gammaHold = gamma;
    this.pitchIdle = 1;
    this.burst = false;
    this.burstBeats = 0;
    this.cruiseSpeed = 0;
    this.hoverIntegral = 0;
    this.flare = false;
    this.hoverDescent = false;
    this.upset = false;
    this.diveLatched = false;
    this.tapTimer = 0;
    this.tapStroke = false;
    this.resetHover();
    this.sustainPath = 0;
    this.forwardLatch = false;
  }

  private resetHover(): void {
    this.hoverIntegral = 0;
    this.hoverForwardI = 0;
    this.hoverLateralI = 0;
    this.hoverHoldY = null;
    this.hoverClimb = 0;
  }

  /** Leaving the latched hover with W held: W reads as neutral pitch until it is released. */
  latchForward(): void {
    this.forwardLatch = true;
  }

  holdPath(gamma: number): void {
    this.gammaHold = gamma;
    this.pitchIdle = 0;
  }

  onModeEnter(mode: string): void {
    if (mode === 'landing') {
      this.flare = false;
      this.hoverDescent = false;
      this.runOutApproach = null;
    }
    if (mode === 'hovering' || mode === 'landing' || mode === 'takeoff') {
      this.resetHover();
    }
  }

  update(sim: FlightSim, pilot: PilotCommand, h: number): void {
    // W held through a hover exit means "keep going forward": it acts as neutral pitch (level acceleration)
    // until released, instead of pushing the nose down the moment the dragon is flying.
    if (this.forwardLatch && (pilot.pitch < 0.2 || !sim.airborne)) {
      this.forwardLatch = false;
    }
    let cmd = this.forwardLatch ? neutralPitch(pilot) : pilot;
    if (sim.maneuvers.diveMasked && cmd.dive) {
      cmd = withoutDive(cmd);
    }
    const t = sim.targets;
    t.rate.set(0, 0, 0);
    t.brake = 0;
    t.hover = 0;
    t.legsOut = 0;
    t.authority.set(1, 1, 1);
    t.thrustBoost = 1;
    t.liftBoost = 0;
    t.spreadRate = 0;
    t.sweepRate = 0;
    t.dragScale = 1;
    t.push.set(0, 0, 0);
    if (sim.beat.downstrokeStarted && this.burst) {
      this.burstBeats++;
    }
    this.updateTap(sim, cmd, h);
    // Kept current in every airborne mode, so the protection is valid the moment a take-off hands over.
    this.updateEnergyLimits(sim, h);
    if (sim.maneuvers.active) {
      this.burst = false;
      sim.maneuvers.control(sim, cmd, h, t);
      if (sim.maneuvers.active) {
        t.effort = Math.min(t.effort, sim.effortCap());
        return;
      }
      // The trick ended this substep: the normal law flies it from here.
    }
    switch (sim.mode) {
      case 'takeoff':
        this.takeoffLaw(sim, cmd, t);
        break;
      case 'landing':
        this.landingLaw(sim, cmd, h, t);
        break;
      case 'hovering': {
        let vs: number = cmd.flap ? HOVER.climb : cmd.dive ? HOVER.descend : 0;
        const y = sim.body.position.y;
        if (vs === 0) {
          // Idle: hold the height the pilot left it at (no creep in wind or thermals).
          this.hoverHoldY ??= y;
          vs = clamp(HOVER.heightGain * (this.hoverHoldY - y), -1.5, 1.5);
        } else {
          this.hoverHoldY = null;
        }
        // W/S creep forward/back (W without the brake flies out, see FlightSim), A/D turn on the spot, Q/E strafe.
        const vf = cmd.pitch > 0 ? cmd.pitch * HOVER.creep : cmd.pitch * HOVER.back;
        const bankLimit = 0.08 + 0.22 * smoothstep(2, 12, sim.footClearance);
        this.hoverLaw(sim, h, t, vs, vf, cmd.yaw * HOVER.strafe, -cmd.roll * HOVER.yawRate, bankLimit, 1.2);
        t.legsOut = 0.55;
        break;
      }
      default:
        this.normalLaw(sim, cmd, h, t, ENVELOPE.cruiseSpeed);
    }
    t.effort = Math.min(t.effort, sim.effortCap());
  }

  /**
   * Space tap in flight = one full-effort wing beat. Gliding wings (no stroke amplitude) start the downstroke
   * at once; a flapping wing loads its next downstroke.
   */
  private updateTap(sim: FlightSim, cmd: PilotCommand, h: number): void {
    const beat = sim.beat;
    const cruising = sim.mode === 'flying' || sim.mode === 'gliding' || sim.mode === 'diving' || sim.mode === 'stalling';
    if (cmd.flapPressed && cruising && !cmd.dive) {
      this.tapTimer = TAP_TIMEOUT;
      this.tapStroke = false;
      if (beat.amplitude < 0.2) {
        beat.phase = TWO_PI - 0.45;
      }
      beat.effort = Math.max(beat.effort, 0.45);
    }
    if (this.tapTimer <= 0) {
      return;
    }
    this.tapTimer -= h;
    if (!cruising) {
      this.tapTimer = 0;
    } else if (beat.downstrokeStarted) {
      this.tapStroke = true;
    } else if (this.tapStroke && beat.phase > TWO_PI * FLAP.downstrokeFraction) {
      this.tapTimer = 0;
    }
  }

  /* ---------------------------------------------------------------- */

  private normalLaw(sim: FlightSim, cmd: PilotCommand, h: number, t: ControlTargets, cruise: number): void {
    const ov = sim.overrides;
    const V = Math.max(sim.airspeed, 1);
    // Flight-path corrections act through extra lift: full authority up to ~65° of bank, reversed when inverted.
    const cosBank = clamp(Math.cos(sim.bank) * 2.5, -1, 1);

    const pilotIdle = Math.abs(cmd.pitch) < 0.04 && Math.abs(cmd.roll) < 0.04;
    const departed = Math.abs(sim.alpha) > 45 * DEG || (sim.attachment < 0.3 && Math.abs(sim.alpha) > 28 * DEG);
    if (!this.upset && departed && !cmd.brake && (sim.options.stallProtection || pilotIdle)) {
      this.upset = true;
    } else if (this.upset && ((Math.abs(sim.alpha) < 22 * DEG && sim.attachment > 0.6 && V > 12) || cmd.brake)) {
      this.upset = false;
      this.holdPath(clamp(sim.gamma, -0.45 * smoothstep(20, 150, sim.agl), 0.2));
    }
    if (this.upset) {
      this.upsetRecovery(sim, t);
      return;
    }

    // Low-speed protection (assisted pilot input only: overrides, landing and braking fly slow on purpose).
    const protect = sim.options.stallProtection && !cmd.brake && ov.pathTarget === null && ov.airspeedTarget === null;
    // Fully hands-off (no stick, rudder, brake or dive, no override): the far look-ahead may climb and turn.
    const handsOff = pilotIdle && Math.abs(cmd.yaw) < 0.04 && !cmd.brake && !cmd.dive && ov.pathTarget === null && ov.airspeedTarget === null && ov.bankTarget === null;

    // Bank: stick deflection commands a bank angle; idle = gentle auto-level.
    let bankCmd = 0;
    let rollRateLimit: number = ENVELOPE.maxRollRate;
    const rollActive = Math.abs(cmd.roll) > 0.04 || Math.abs(cmd.yaw) > 0.04;
    if (ov.bankTarget !== null) {
      bankCmd = ov.bankTarget;
    } else if (rollActive) {
      bankCmd = clamp(cmd.roll, -1, 1) * ENVELOPE.maxBank + clamp(cmd.yaw, -1, 1) * ENVELOPE.rudderBank;
      if (protect) {
        // A turn the speed cannot carry would drag the dragon into a stall: shallower bank when slow.
        const limit = Math.max(this.bankMax, 20 * DEG);
        bankCmd = clamp(bankCmd, -limit, limit);
      }
    } else {
      // Gentle auto-level; decisive once past knife-edge so the dragon never stays inverted.
      const inverted = smoothstep(60 * DEG, 100 * DEG, Math.abs(sim.bank));
      rollRateLimit = ENVELOPE.autoLevelRollRate + (ENVELOPE.invertedRollRate - ENVELOPE.autoLevelRollRate) * inverted;
      if (handsOff && sim.farSide !== 0) {
        // An obstacle ahead too tall to out-climb: bank gently toward the side with more free space.
        bankCmd = sim.farSide * PROXIMITY.farTurnBank * smoothstep(0.6 * PROXIMITY.farTurnPath, PROXIMITY.farTurnFullPath, sim.farPath);
      }
    }
    bankCmd = this.limitBankNearSurface(sim, sim.boundarySteer(bankCmd), PROXIMITY.minAmplitudeCruise);
    const rollRate = -clamp(3.2 * this.rollError(sim, bankCmd), -rollRateLimit, rollRateLimit);

    // Coordinated-turn feed-forward: world yaw rate g tan(φ) / V expressed in the body frame. It fades out
    // towards knife-edge (tan φ has the wrong sense past 90° and would fight the roll back upright).
    const ffFade = clamp(Math.cos(sim.bank) / COS_FF_FADE, 0, 1);
    const turnBank = clamp(sim.bank, -75 * DEG, 75 * DEG);
    const turnRate = clamp((-GRAVITY * Math.tan(turnBank)) / Math.max(V, 10), -1.2, 1.2) * sim.attachment * ffFade;
    _invQ.copy(sim.body.quaternion).invert();
    _feedForward.set(0, turnRate, 0).applyQuaternion(_invQ);

    // Pitch: rate command while the stick is deflected, flight-path hold with gentle auto-level when idle,
    // a held steep path while diving; a ground-proximity floor under all of them.
    const pitchActive = Math.abs(cmd.pitch) > 0.04;
    if (!cmd.dive) {
      this.diveLatched = false;
    }
    let pitchRate = 0;
    // Wings stay tucked while diving unless the ground floor is pulling out (then they open to recover).
    let tuck = cmd.dive;
    if (ov.airspeedTarget !== null) {
      const gammaTarget = clamp((V - ov.airspeedTarget) * 0.045, -0.7, 0.3);
      pitchRate = clamp(1.6 * (gammaTarget - sim.gamma), -0.4, 0.4) * cosBank;
      this.holdPath(sim.gamma);
    } else if (ov.pathTarget !== null) {
      pitchRate = clamp(1.6 * (ov.pathTarget - sim.gamma), -this.pathRateLimit, this.pathRateLimit) * cosBank;
      this.holdPath(sim.gamma);
    } else {
      let floor: number;
      if (pitchActive) {
        pitchRate = -clamp(cmd.pitch, -1, 1) * ENVELOPE.maxPitchRate;
        if (protect && pitchRate > 0) {
          // No nose-up authority close to the stall, and never a path steeper than the energy allows.
          pitchRate *= smoothstep(1.0 * this.stallSpeed, 1.25 * this.stallSpeed, V);
          if (Math.abs(sim.bank) < 80 * DEG) {
            pitchRate = Math.min(pitchRate, clamp(1.6 * (this.gammaMax - sim.gamma), -0.5, ENVELOPE.maxPitchRate) * cosBank);
          }
        }
        this.holdPath(protect ? Math.min(sim.gamma, this.gammaMax) : sim.gamma);
        this.diveLatched = cmd.dive;
        // An armed, clear plunge lets the dive into the water (underwater.ts).
        floor = this.groundFloor(sim, PROXIMITY.pilotLand, sim.dive.clear ? PLUNGE.floorWater : PROXIMITY.pilotWater, 1.2 + V / 40);
        if (!sim.overWater) {
          // Pushed on low over land (a skim): below the wanted clearance the floor climbs by the height missing, and
          // the push fades out as the path nears the floor, so the dragon settles onto it instead of overshooting.
          const missing = PROXIMITY.pilotLand - sim.footClearance;
          if (missing > 0) {
            floor = Math.max(floor, Math.min(PROXIMITY.pilotLandClimb, missing * PROXIMITY.pilotLandGain));
          }
          if (pitchRate < 0) {
            const near = smoothstep(PROXIMITY.pilotLand + 4, PROXIMITY.pilotLand + 1, sim.footClearance);
            pitchRate *= lerp(1, smoothstep(floor, floor + PROXIMITY.pilotFloorSoften, sim.gamma), near);
          }
        }
        tuck = cmd.dive && floor < sim.gamma - 3 * DEG;
      } else if (cmd.dive) {
        if (!this.diveLatched) {
          this.diveLatched = true;
          this.gammaHold = Math.min(sim.gamma, ENVELOPE.divePath);
        }
        floor = this.groundFloor(sim, PROXIMITY.diveLand, sim.dive.clear ? PLUNGE.floorWater : PROXIMITY.diveWater, 2 + V / 25);
        pitchRate = clamp(1.6 * (Math.max(this.gammaHold, floor) - sim.gamma), -0.7, 0.6) * cosBank;
        tuck = floor < this.gammaHold + 2 * DEG;
      } else {
        this.pitchIdle += h;
        if (this.pitchIdle > 0.6) {
          const decay = (5 * DEG + 0.15 * Math.abs(this.gammaHold)) * h;
          this.gammaHold -= clamp(this.gammaHold, -decay, decay);
        }
        this.gammaHold = clamp(this.gammaHold, -ENVELOPE.maxHoldPath, 35 * DEG);
        if (protect) {
          // Released after a zoom: hold only the path the energy can sustain, so the nose comes down in time.
          this.gammaHold = Math.min(this.gammaHold, this.gammaMax);
        }
        // Hands-off: keep ~18 m of clearance over land (look-ahead over rising ground and roofs); braking = settling.
        floor = cmd.brake
          ? this.groundFloor(sim, PROXIMITY.pilotLand, PROXIMITY.pilotWater, PROXIMITY.idleHorizon)
          : this.groundFloor(sim, PROXIMITY.idleLand, PROXIMITY.idleWater, PROXIMITY.idleHorizon);
        if (handsOff) {
          // Tall obstacles further ahead start the climb early (never up into a deck the dragon is passing under).
          floor = Math.max(floor, Math.min(this.farFloor(sim), this.ceilingPath));
        }
        // Under a bridge deck or an overhang the held path never climbs into it.
        this.gammaHold = Math.min(this.gammaHold, this.ceilingPath);
        pitchRate = clamp(1.4 * (Math.max(this.gammaHold, floor) - sim.gamma), -0.3, 0.3) * cosBank;
        // Auto-level never pulls into a stall: with the wing stalled, lower the nose first.
        const excess = sim.alpha + WING.incidence - (WING.stall - 3 * DEG);
        if (excess > 0 && !cmd.brake) {
          pitchRate = Math.min(pitchRate, -clamp(excess * 3, 0, 1.2));
        }
      }
      if (sim.gamma < floor) {
        pitchRate = Math.max(pitchRate, clamp(2 * (floor - sim.gamma), 0, 0.9) * cosBank);
      }
      pitchRate = this.limitPitchAttitude(sim, pitchRate);
    }

    let rateX = _feedForward.x + pitchRate;
    // Angle-of-attack limiter: structural g-limits always; stall protection and a gentle push-over when assisted.
    const qS = 0.5 * airDensity(sim.body.position.y) * V * V * sim.wing.area * ceilingFactor(sim.body.position.y);
    const slope = Math.max(sim.wing.liftSlope, 1);
    let alphaLimit = ((ENVELOPE.maxLoadFactor * MASS * GRAVITY) / Math.max(qS, 1) - WING.cl0) / slope - WING.incidence;
    let alphaMin = ((-2.5 * MASS * GRAVITY) / Math.max(qS, 1) - WING.cl0) / slope - WING.incidence;
    if (sim.options.stallProtection) {
      alphaLimit = Math.min(alphaLimit, ENVELOPE.stallProtect - WING.incidence);
      alphaMin = ((ENVELOPE.minLoadFactor * MASS * GRAVITY) / Math.max(qS, 1) - WING.cl0) / slope - WING.incidence;
      alphaMin = Math.max(alphaMin, WING.negStall + 3 * DEG - WING.incidence);
    }
    const margin = alphaLimit - sim.alpha;
    if (rateX > 0 && margin < 4 * DEG) {
      rateX *= clamp(margin / (4 * DEG), 0, 1);
    }
    if (margin < 0) {
      rateX += Math.max(margin, -0.5) * 5;
    }
    const marginNeg = sim.alpha - alphaMin;
    if (rateX < 0 && marginNeg < 4 * DEG) {
      rateX *= clamp(marginNeg / (4 * DEG), 0, 1);
    }
    if (marginNeg < 0) {
      rateX -= Math.max(marginNeg, -0.5) * 5;
    }
    if (sim.loadFactor > ENVELOPE.maxLoadFactor) {
      rateX -= (sim.loadFactor - ENVELOPE.maxLoadFactor) * 0.25;
    } else if (sim.loadFactor < -2.5) {
      rateX += (-2.5 - sim.loadFactor) * 0.25;
    }
    // Rudder commands a small sideslip (most of the yaw input already went into the bank command).
    const betaCmd = -clamp(cmd.yaw, -1, 1) * ENVELOPE.rudderSideslip;
    const yawRate = _feedForward.y - 1.8 * (sim.beta - betaCmd);
    t.rate.set(rateX, yawRate, _feedForward.z + rollRate);

    // Flap effort: Space = strong beats (a tap = one beat), otherwise the flap-glide cruise governor.
    if (cmd.flap) {
      t.effort = 1;
      this.burst = false;
    } else if (this.tapTimer > 0 && !cmd.dive) {
      t.effort = TAP_EFFORT;
    } else if (tuck || cmd.brake || !sim.options.autoFlap) {
      t.effort = 0;
      this.burst = false;
    } else {
      t.effort = this.governor(sim, V, sim.body.velocity.y - sim.wind.updraft, cruise, h);
    }

    // Wing configuration: tuck for dives, flare for braking, otherwise adapt span to speed (keep CL ~0.32)
    // while gliding; full span for powered strokes.
    if (tuck) {
      t.spread = 0.12;
      t.sweep = 1;
    } else if (cmd.brake) {
      t.spread = 1;
      t.sweep = -1;
      t.brake = 1;
    } else {
      const qbar = 0.5 * airDensity(sim.body.position.y) * V * V;
      const areaNeeded = (MASS * GRAVITY * Math.max(1, sim.loadFactor)) / (qbar * 0.32 + 1);
      t.spread = Math.max(clamp((areaNeeded - 20) / 70, 0.6, 1), smoothstep(0.25, 0.7, t.effort));
      t.sweep = (1 - t.spread) * 1.3;
    }

    // Legs come down when slow and near the ground.
    t.legsOut = V < 20 ? smoothstep(40, 8, sim.footClearance) : 0;
    // The urge ("dehh"): strong beats and a surge, the path hold keeps it level; the power stroke likewise.
    sim.maneuvers.applyUrge(sim, t, !tuck && !cmd.brake);
    sim.maneuvers.applyPower(sim, t, !tuck && !cmd.brake);
  }

  /**
   * Upset recovery: point the nose along the relative wind (a little steeper) so the wing unstalls and gains
   * speed, wings level and half-tucked; with no usable airflow, nose 35° below the horizon.
   */
  private upsetRecovery(sim: FlightSim, t: ControlTargets): void {
    const F = sim.axes.forward;
    const air = sim.airVelocity;
    const V = sim.airspeed;
    // Close to the ground there is no room to dive out: keep the nose higher and beat hard instead.
    const maxDive = (15 + 45 * smoothstep(30, 120, sim.agl)) * DEG;
    const e = sim.escapeDirection;
    const yaw = sim.escapeTimer > 0 ? Math.atan2(-e.x, -e.z) : sim.axes.yaw();
    let down = 35 * DEG;
    if (V > 4) {
      const horizontal = Math.hypot(air.x, air.z);
      down = Math.atan2(-(air.y - 0.2 * V), Math.max(horizontal, 0.1));
    }
    down = clamp(down, -10 * DEG, maxDive);
    _desiredUp.set(-Math.sin(yaw) * Math.cos(down), -Math.sin(down), -Math.cos(yaw) * Math.cos(down));
    _cross.crossVectors(F, _desiredUp);
    const s = _cross.length();
    const angle = Math.atan2(s, F.dot(_desiredUp));
    if (s > 1e-4) {
      _cross.multiplyScalar(clamp(2.5 * angle, 0, 1.6) / s);
    } else {
      _cross.set(0, 0, 0);
    }
    _invQ.copy(sim.body.quaternion).invert();
    _feedForward.copy(_cross).applyQuaternion(_invQ);
    const rollRate = -clamp(3.2 * this.rollError(sim, 0), -1.6, 1.6);
    t.rate.set(_feedForward.x, _feedForward.y, _feedForward.z + rollRate);
    const low = 1 - smoothstep(40, 120, sim.agl);
    t.spread = V < 12 || low > 0.5 ? 1 : 0.55;
    t.sweep = t.spread < 1 ? 0.5 : 0;
    t.hover = clamp((14 - V) / 8, 0, 1) * Math.max(low, 0.4);
    t.effort = V < 20 ? 1 : 0.3;
    t.legsOut = 0;
    this.burst = false;
  }

  /**
   * Energy limits of the assisted envelope. The sustainable climb angle γs = asin((T·cos(α+stroke) − D) / W) is what
   * the current mean flap force can hold at constant speed; above the protected minimum speed (1.3 Vs at the turn
   * load) extra climb is allowed in proportion to the spare speed (a zoom), below it the allowed path drops under
   * γs so the dragon accelerates back. The speed trend (look-ahead) damps the exchange.
   */
  private updateEnergyLimits(sim: FlightSim, h: number): void {
    const y = sim.body.position.y;
    const V = sim.airspeed;
    const weight = MASS * GRAVITY;
    const density = airDensity(y) * ceilingFactor(y);
    const vs1 = Math.sqrt((2 * weight) / (density * WING.areaSpread * ENVELOPE.clMaxProtect));
    const turnLoad = 1 / Math.max(Math.cos(sim.bank), 0.45);
    this.stallSpeed = vs1 * Math.sqrt(turnLoad);
    // Gust additive (as on an approach speed): margin for the airspeed swings of the current turbulence.
    this.minSpeed = ENVELOPE.minSpeedFactor * this.stallSpeed + sim.wind.turbulence;
    const stroke = lerp(FLAP.strokeAngle, FLAP.hoverStrokeAngle, sim.hoverBlend);
    const thrust = sim.flapForce * Math.cos(sim.alpha + stroke);
    const sustain = Math.asin(clamp((thrust - sim.drag) / weight, -0.5, 0.6));
    this.sustainPath += (sustain - this.sustainPath) * (1 - Math.exp(-h / 0.4));
    const trend = GRAVITY * (Math.sin(this.sustainPath) - Math.sin(sim.gamma));
    const predicted = V + ENVELOPE.speedLead * trend;
    this.gammaMax = this.sustainPath + clamp(ENVELOPE.zoomGain * (predicted - this.minSpeed), -0.45, 0.9);
    const loadAvailable = (V / (ENVELOPE.bankSpeedFactor * vs1)) ** 2;
    this.bankMax = loadAvailable > 1 ? Math.acos(1 / loadAvailable) : 0;
  }

  /**
   * Flap-glide cruise governor. Judges speed through a ~1 s low-pass (gusts must not toggle the bursts) and keeps
   * beating through a steep turn: gliding there bleeds speed onto the protected minimum, and the low-speed
   * protection would then trade height for it (a 60° turn in gusty wind used to sink ~60 m in 20 s).
   */
  private governor(sim: FlightSim, V: number, climbRate: number, cruise: number, h: number): number {
    this.cruiseSpeed = this.cruiseSpeed > 0 ? this.cruiseSpeed + (V - this.cruiseSpeed) * (1 - Math.exp(-h / GOVERNOR_SPEED_TAU)) : V;
    const bank = Math.abs(sim.bank);
    const turning = bank > GOVERNOR_TURN_BANK && bank < 100 * DEG;
    const target = turning ? Math.max(cruise, this.minSpeed + GOVERNOR_TURN_MARGIN) : cruise;
    const deficit = target - this.cruiseSpeed;
    if (!this.burst) {
      if (deficit > 2.5 || (deficit > -3 && climbRate > 2.5) || (turning && deficit > -1.5)) {
        this.burst = true;
        this.burstBeats = 0;
      }
    } else if (deficit < -2 && climbRate < 2 && this.burstBeats >= 3 && !turning) {
      this.burst = false;
    }
    if (!this.burst) {
      return 0;
    }
    return clamp(0.62 + 0.06 * deficit + 0.05 * Math.max(climbRate, 0), 0.45, 0.92);
  }

  /**
   * Hover: body pitched ~28° so the stroke plane is horizontal, vertical-speed PI on flap effort,
   * attitude tilt (PI on ground velocity, so a steady wind is trimmed out) to translate. Targets are
   * ground-relative (m/s) and a world yaw rate (rad/s, + = left).
   */
  private hoverLaw(
    sim: FlightSim,
    h: number,
    t: ControlTargets,
    vsTarget: number,
    vfTarget: number,
    vrTarget: number,
    yawRate: number,
    bankLimit: number,
    airVane: number,
    backTilt: number = HOVER.maxBackTilt,
    forwardGain = 0.055,
    liftFeed = 0,
    pitchRateLimit = 0.8,
  ): void {
    t.hover = 1;
    t.spread = 1;
    t.sweep = -0.55;
    t.brake = 0.35;
    const yaw = sim.axes.yaw();
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const v = sim.body.velocity;
    const forwardError = v.x * fx + v.z * fz - vfTarget;
    const lateralError = v.x * -fz + v.z * fx - vrTarget;
    this.hoverForwardI = clamp(this.hoverForwardI + 0.03 * forwardError * h, -0.7 * HOVER.maxForwardTilt, 0.7 * HOVER.maxBackTilt);
    this.hoverLateralI = clamp(this.hoverLateralI + 0.03 * lateralError * h, -0.2, 0.2);
    const pitchTarget = HOVER.attitude + clamp(forwardError * forwardGain + this.hoverForwardI, -HOVER.maxForwardTilt, backTilt);
    const bankCmd = clamp(-(lateralError * 0.07 + this.hoverLateralI), -bankLimit, bankLimit);
    const bankTarget = this.limitBankNearSurface(sim, bankCmd, PROXIMITY.minAmplitudeHover);

    // Nose gently into a real airflow (horizontal air-relative velocity; meaningless when nearly still).
    const air = sim.airVelocity;
    const airHorizontal = Math.hypot(air.x, air.z);
    if (airVane > 0 && airHorizontal > 3) {
      const airError = wrapAngle(Math.atan2(-air.x, -air.z) - yaw);
      yawRate += airVane * clamp(airError, -0.5, 0.5) * smoothstep(3, 8, airHorizontal);
    }
    _invQ.copy(sim.body.quaternion).invert();
    _feedForward.set(0, yawRate, 0).applyQuaternion(_invQ);
    const rollRate = -clamp(4 * this.rollError(sim, bankTarget), -1.2, 1.2);
    const pitchRate = clamp(3.5 * (pitchTarget - sim.pitch), -pitchRateLimit, pitchRateLimit);
    t.rate.set(_feedForward.x + pitchRate, _feedForward.y, _feedForward.z + rollRate);

    const ratio = (FLAP.forwardRatio + (FLAP.hoverRatio - FLAP.forwardRatio) * sim.hoverBlend) * ceilingFactor(sim.body.position.y);
    const weight = MASS * GRAVITY;
    const needed = clamp((weight * (1 + liftFeed) - sim.aeroVertical) / weight, 0, 1.5);
    const feed = Math.pow(needed / Math.max(ratio, 0.2), 1 / FLAP.effortExponent);
    this.hoverClimb += (v.y - this.hoverClimb) * (1 - Math.exp(-h / 0.15));
    const err = vsTarget - this.hoverClimb;
    this.hoverIntegral = Math.abs(err) < 1.5 ? clamp(this.hoverIntegral + 0.05 * err * h, -0.25, 0.25) : this.hoverIntegral * (1 - 2 * h);
    t.effort = clamp(feed + (err < 0 ? 0.18 : 0.25) * err + this.hoverIntegral, 0, 1);
  }

  private takeoffLaw(sim: FlightSim, cmd: PilotCommand, t: ControlTargets): void {
    const V = sim.airspeed;
    const k = clamp(sim.modeTime / 1.6, 0, 1);
    t.effort = 1;
    t.hover = clamp((15 - V) / 8, 0, 0.9);
    t.spread = 1;
    t.sweep = 0;
    // After a leap the legs stay down through the first strokes, which reach forward (full amplitude with the tips
    // clear of the ground); otherwise they retract from wherever they are (a hover carries them half out).
    const leapLegs = takeoffLegs(sim);
    t.legsOut = leapLegs ?? Math.min(sim.legsOut, 1 - k);
    if (leapLegs !== null && sim.moves.tuckTime < 0) {
      t.sweep = LEAP.strokeSweep;
    }
    let pitchTarget = 18 * DEG - 10 * DEG * clamp(V / 14, 0, 1) - cmd.pitch * 10 * DEG;
    if (sim.moves.takeoffVariant === 'drop' && sim.modeTime < LEAP.dropTime) {
      // Off an edge: dive to gain speed while the wings snap open, beating once they are.
      pitchTarget = LEAP.dropDive;
      t.effort = sim.modeTime < 0.25 ? 0.3 : 1;
      t.spreadRate = 5;
      t.sweep = 0;
    }
    const bankTarget = this.limitBankNearSurface(sim, clamp(cmd.roll, -1, 1) * 0.45, PROXIMITY.minAmplitudeCruise);
    _invQ.copy(sim.body.quaternion).invert();
    _feedForward.set(0, -cmd.roll * 0.35 - cmd.yaw * 0.3, 0).applyQuaternion(_invQ);
    const rollRate = -clamp(4 * this.rollError(sim, bankTarget), -1.4, 1.4);
    const pitchRate = clamp(3 * (pitchTarget - sim.pitch), -0.8, 0.8);
    t.rate.set(_feedForward.x + pitchRate, _feedForward.y - 1.2 * sim.beta * clamp(V / 10, 0, 1), _feedForward.z + rollRate);
    // The first big beats off the ground carry the dragon up clear of it.
    t.thrustBoost = 1 + TAKEOFF_BOOST * (1 - smoothstep(0.5, 1.4, sim.modeTime));
    sim.maneuvers.applyUrge(sim, t, true);
  }

  /**
   * Assisted landing, ~7 s from 45 m: a steep braked approach, then a decisive flare (the hover law with the body
   * pitched far back, wings reaching forward and back-strokes) that takes out the sink rate and the speed together,
   * and a short settle onto the feet. It never goes around: holding height is the most it does.
   */
  private landingLaw(sim: FlightSim, cmd: PilotCommand, h: number, t: ControlTargets): void {
    // Approach and flare judge height against the ground coming up ahead (rising terrain, roofs), the
    // final settle against the ground below.
    const clearance = Math.min(sim.footClearance, this.clearanceAhead(sim));
    const V = sim.airspeed;
    const v = sim.body.velocity;
    const groundSpeed = Math.hypot(v.x, v.z);
    if (this.runOutApproach === null) {
      const water = sim.overWater || sim.aheadWater.some((w) => w);
      this.runOutApproach = !water && !this.flare && !this.hoverDescent && groundSpeed >= RUNOUT.approachMinSpeed && clearance <= RUNOUT.approachMaxHeight;
    }
    if (this.runOutApproach && sim.overWater) {
      // Water under the approach after all: the braked approach and flare (the sea has its own landing).
      this.runOutApproach = false;
    }
    if (this.runOutApproach) {
      this.runOutApproachLaw(sim, cmd, h, t, clearance, groundSpeed);
      return;
    }
    if (!this.hoverDescent) {
      const flareHeight = clamp(LANDING.flareBase + LANDING.flarePerSink * Math.max(0, -v.y) + LANDING.flarePerSpeed * groundSpeed, LANDING.flareMin, LANDING.flareMax);
      if (this.flare || clearance < flareHeight || V < LANDING.flareSpeed) {
        this.flare = true;
        this.hoverDescent = true;
        this.hoverIntegral = 0;
      }
    }
    if (!this.hoverDescent) {
      // Steep approach on a glide slope with the airbrake holding a falling speed schedule.
      const ov = sim.overrides;
      const savedPath = ov.pathTarget;
      const savedSpeed = ov.airspeedTarget;
      const speedTarget = clamp(LANDING.approachSpeed + clearance * LANDING.approachSpeedPerMetre, LANDING.approachSpeedMin, LANDING.approachSpeedMax);
      ov.pathTarget = -clamp(LANDING.pathBase + clearance / LANDING.pathReach, LANDING.pathMin, LANDING.pathMax);
      ov.airspeedTarget = null;
      this.pathRateLimit = LANDING.approachPitchRate;
      this.normalLaw(sim, cmd, h, t, speedTarget);
      this.pathRateLimit = 0.5;
      ov.pathTarget = savedPath;
      ov.airspeedTarget = savedSpeed;
      t.brake = clamp((V - speedTarget - 1) / 4, 0, 1);
      if (t.brake > 0.05) {
        t.sweep = -t.brake;
        t.spread = 1;
      }
      t.legsOut = clearance < 60 ? 1 : 0.35;
      return;
    }
    // While still moving, judge height against the ground coming up ahead as well (slopes, roofs).
    const below = groundSpeed > 3 ? Math.min(sim.footClearance, this.clearanceAhead(sim) + 0.5) : sim.footClearance;
    // Sink-rate profile of a constant deceleration the hover stroke can always deliver, ending in a soft touchdown.
    let vsTarget = -Math.min(Math.sqrt(LANDING.touchdownSink ** 2 + 2 * LANDING.settleDecel * Math.max(below, 0)), LANDING.maxSink);
    // Forward speed wanted: a few metres per second on touchdown (the feet run it off), W/S adjust it.
    const vfTarget = clamp(0.5 * LANDING.touchdownSpeed + 0.5 * below, 0.5 * LANDING.touchdownSpeed, LANDING.touchdownSpeed) * (1 + 0.8 * clamp(cmd.pitch, -1, 1));
    if (groundSpeed > LANDING.holdSpeed && below < 2) {
      // Still too fast for the feet in the last metres: stop sinking (no climb) until the flare has taken it out.
      vsTarget = Math.max(vsTarget, -0.3);
    }
    // Settle facing into a strong wind only (a light wind is not worth a slow turn on the spot): once slowed down,
    // turn the nose upwind and hold the height below 3 m until it points within ~20° of the wind.
    let yawRate = -cmd.roll * 0.6;
    const mean = sim.wind.mean;
    const slow = smoothstep(8, 5, groundSpeed);
    const vane = smoothstep(LANDING.vaneWindMin, LANDING.vaneWindFull, Math.hypot(mean.x, mean.z)) * slow * (Math.abs(cmd.roll) > 0.1 ? 0 : 1);
    if (vane > 0) {
      const err = wrapAngle(Math.atan2(mean.x, mean.z) - sim.axes.yaw());
      yawRate += clamp(1.2 * err, -HOVER.weathervaneRate, HOVER.weathervaneRate) * vane;
      if (vane > 0.3 && Math.abs(err) > 0.35 && below > 0.8 && below < 3) {
        vsTarget = Math.max(vsTarget, 0);
      }
    }
    const bankLimit = 0.08 + 0.22 * smoothstep(2, 12, below);
    // Decisive flare: pitch far back while fast (up to ~60°). The last metres belong to the vertical speed: the
    // stroke points nearly straight down again so it can cushion the touchdown (the feet run off what speed is left).
    // The deep tilt lasts while the wing still carries the weight; below ~10 m/s the stroke has to take over and
    // needs to point down again.
    const flareTilt = smoothstep(LANDING.flareTiltFadeSpeed, LANDING.flareTiltFadeSpeed + 5, V) * smoothstep(2, 5, below);
    // Low and slow through the air but still fast over the ground (a tailwind): tilt further back, the stroke then
    // pushes against the ground speed the airbrake can no longer take out.
    const lowTilt =
      LANDING.touchdownBackTilt +
      (HOVER.maxBackTilt - LANDING.touchdownBackTilt) * Math.max(smoothstep(0.8, 3, below), smoothstep(4, 7, groundSpeed)) +
      LANDING.groundSpeedBackTilt * smoothstep(8, 13, groundSpeed) * smoothstep(1, 2.5, below);
    const backTilt = lowTilt + (LANDING.flareBackTilt - lowTilt) * flareTilt;
    // Following the sink profile needs a steady upward deceleration on top of the weight.
    const liftFeed = v.y < -LANDING.touchdownSink ? LANDING.settleDecel / GRAVITY : 0;
    // Rear up quickly: passing slowly through the high-lift angles at speed balloons the dragon back up, a fast
    // pitch into the deep stall turns the wing into an airbrake instead.
    const pitchRateLimit = 0.8 + (LANDING.flarePitchRate - 0.8) * flareTilt;
    this.hoverLaw(sim, h, t, vsTarget, vfTarget, cmd.yaw * 3, yawRate, bankLimit, 0, backTilt, LANDING.flareGain, liftFeed, pitchRateLimit);
    // The wings are already beating when the flare's lift fades with the speed (no drop at the end of the flare).
    t.effort = Math.max(t.effort, LANDING.flareEffort * (1 - smoothstep(LANDING.flareTiltFadeSpeed, LANDING.flareTiltFadeSpeed + 6, V)));
    // Lift dump: at speed the flare's lift (and the ground effect) would carry the dragon back up, and a balloon only
    // lengthens the float. The wings partly close while it stops sinking; the cupped membrane keeps braking.
    t.spread = 1 - LANDING.liftDump * smoothstep(LANDING.liftDumpVy - 1.5, LANDING.liftDumpVy, v.y) * smoothstep(9, 13, V);
    // Airbrake open while fast; wings raised and reaching forward for the touchdown (tips well clear of the ground).
    t.brake = Math.max(t.brake, smoothstep(4, 12, groundSpeed));
    t.sweep = -0.55 - 0.45 * Math.max(1 - smoothstep(2, 7, below), smoothstep(5, 12, groundSpeed));
    t.legsOut = 1;
  }

  /**
   * Run-out approach: a shallow glide (at most RUNOUT.approachPath) with the airbrake holding a speed schedule that
   * falls to RUNOUT.touchdownSpeed, a round-out over the last metres (sink touchdownSink + roundOutGain × clearance)
   * and the legs reaching down. Still too fast close to the ground, it floats at floatHeight until the brake has
   * taken the speed out, so the feet never meet the ground faster than RUNOUT.maxSpeed.
   */
  private runOutApproachLaw(sim: FlightSim, cmd: PilotCommand, h: number, t: ControlTargets, clearance: number, groundSpeed: number): void {
    const V = Math.max(sim.airspeed, 5);
    const speedTarget = RUNOUT.touchdownSpeed + Math.max(clearance, 0) * RUNOUT.approachSpeedPerMetre;
    let sink = Math.min(V * Math.sin(RUNOUT.approachPath), RUNOUT.touchdownSink + RUNOUT.roundOutGain * Math.max(clearance, 0));
    if (groundSpeed > RUNOUT.maxSpeed - 3) {
      sink = Math.min(sink, Math.max(0, clearance - RUNOUT.floatHeight) * 0.8);
    }
    const ov = sim.overrides;
    const savedPath = ov.pathTarget;
    const savedSpeed = ov.airspeedTarget;
    ov.pathTarget = -Math.asin(clamp(sink / V, 0, Math.sin(RUNOUT.approachPath)));
    ov.airspeedTarget = null;
    this.normalLaw(sim, cmd, h, t, speedTarget);
    ov.pathTarget = savedPath;
    ov.airspeedTarget = savedSpeed;
    t.brake = clamp((V - speedTarget) / 4, 0, 1);
    if (t.brake > 0.05) {
      t.effort = 0;
      t.spread = 1;
      t.sweep = -0.45 * t.brake;
    }
    t.legsOut = clearance < 30 ? 1 : 0.35;
  }

  /**
   * Lowest flight-path angle that keeps `want` metres between the lowest body point and the surface, now and at
   * the look-ahead points (terrain and rooftops ahead), arriving within `horizon` seconds at the current speed.
   */
  private groundFloor(sim: FlightSim, wantLand: number, wantWater: number, horizon: number): number {
    const reach = Math.max(sim.airspeed, 8) * horizon;
    const feet = sim.body.position.y - sim.footDepth();
    // Highest the lowest body point may fly under a ceiling: raised wings and the safety margin stay below it.
    const up = sim.footDepth() + PROXIMITY.headroom + PROXIMITY.ceilingKeep;
    let ceilingPath = Infinity;
    let floor = -Infinity;
    for (let i = -1; i < sim.aheadSurface.length; i++) {
      const surface = i < 0 ? sim.surfaceY : sim.aheadSurface[i];
      const ceiling = i < 0 ? sim.ceilingY : sim.aheadCeiling[i];
      const dist = reach + (i < 0 ? 0 : sim.aheadDistance[i]);
      let want = (i < 0 ? sim.overWater : sim.aheadWater[i]) ? wantWater : wantLand;
      if (ceiling < Infinity) {
        // Squeeze the wanted clearance into the gap (never below the least clearance to pass) and stay under.
        const top = ceiling - up;
        want = Math.min(want, Math.max(top - surface, Math.min(want, PROXIMITY.passClearance)));
        ceilingPath = Math.min(ceilingPath, -pathFloor(top - feet, dist));
      }
      floor = Math.max(floor, pathFloor(feet - surface - want, dist));
    }
    this.ceilingPath = ceilingPath;
    // The ceiling wins: pushing up into a deck the dragon is under or about to pass under is never the way out.
    return Math.min(floor, ceilingPath);
  }

  /**
   * Climb the far look-ahead asks for (hands-off): the path to clear the worst obstacle ahead with the hands-off
   * clearance, faded in between farIgnorePath and farFullPath (gentle slopes are left to the near look-ahead) and no
   * steeper than the energy allows (what cannot be out-climbed is turned away from as well).
   */
  private farFloor(sim: FlightSim): number {
    const path = sim.farPath;
    if (path < PROXIMITY.farIgnorePath) {
      return -Infinity;
    }
    const lift = path * smoothstep(PROXIMITY.farIgnorePath, PROXIMITY.farFullPath, path);
    return Math.min(lift, Math.max(this.gammaMax, 0));
  }

  /** Height of the lowest body point above the surface ~0.8-1.7 s ahead along the track. */
  private clearanceAhead(sim: FlightSim): number {
    const feet = sim.body.position.y - sim.footDepth();
    return Math.min(feet - sim.aheadSurface[0], feet - sim.aheadSurface[1]);
  }

  /**
   * Bank limit that keeps the lower wingtip clear of the surface when low, assuming the stroke may shrink to
   * `minAmplitude` (the beat's amplitude limit does the rest at the actual bank).
   */
  private limitBankNearSurface(sim: FlightSim, bankCmd: number, minAmplitude: number): number {
    if (sim.wing.span < 2) {
      return bankCmd;
    }
    const maxBank = maxBankForClearance(sim.agl, minAmplitude, sim.sweep, sim.wing.span, sim.pitch, PROXIMITY.wingtipMargin);
    return clamp(bankCmd, -maxBank, maxBank);
  }

  /** Assisted pitch attitude limit (±70°): the stick and the dive law fade out before vertical. */
  private limitPitchAttitude(sim: FlightSim, rate: number): number {
    const limit = ENVELOPE.maxPitchAttitude;
    const fade = 15 * DEG;
    if (rate < 0) {
      rate *= clamp((sim.pitch + limit) / fade, 0, 1);
    } else if (rate > 0) {
      rate *= clamp((limit - sim.pitch) / fade, 0, 1);
    }
    if (sim.pitch < -limit) {
      rate += (-limit - sim.pitch) * 2;
    } else if (sim.pitch > limit) {
      rate -= (sim.pitch - limit) * 2;
    }
    return rate;
  }

  /** Signed roll angle (about the nose) from the current attitude to the requested bank. */
  private rollError(sim: FlightSim, bankCmd: number): number {
    const F = sim.axes.forward;
    const U = sim.axes.up;
    _levelUp.set(-F.x * F.y, 1 - F.y * F.y, -F.z * F.y);
    const len = _levelUp.length();
    if (len < 0.05) {
      return 0;
    }
    _levelUp.divideScalar(len);
    _cross.crossVectors(F, _levelUp);
    const c = Math.cos(bankCmd);
    const s = Math.sin(bankCmd);
    _desiredUp.set(_levelUp.x * c + _cross.x * s, _levelUp.y * c + _cross.y * s, _levelUp.z * c + _cross.z * s);
    _cross.crossVectors(U, _desiredUp);
    return Math.atan2(F.dot(_cross), U.dot(_desiredUp));
  }
}
