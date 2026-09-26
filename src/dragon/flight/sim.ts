import * as THREE from 'three';
import type { FlightMode } from '../../core/contracts';
import { clamp } from '../../core/math/noise';
import { WORLD_CEILING } from '../../core/geo-coords';
import { createWingShape, type WingShape } from './aero';
import { stepAirborne } from './airborne';
import { BodyAxes, BodyState } from './body';
import { BodyContacts, type ImpactReport } from './contacts';
import { createControlTargets, FlightController } from './controller';
import { enterGrounded, enterSwimming, stepGrounded, stepSwimming } from './locomotion';
import { MANEUVER_LABELS, Maneuvers } from './maneuvers';
import { DEFAULT_RIG_HEIGHT, DEFAULT_RIG_LENGTH, DEG, ENVELOPE, HOVER, INERTIA, MASS, PLUNGE, PROXIMITY, STAMINA } from './params';
import type { AssistOverrides, PilotCommand, SimEvent, SimOptions, SimWorld } from './types';
import { createOverrides } from './types';
import { DiveState, stepUnderwater, updatePlungeLook } from './underwater';
import { WingBeat } from './wingbeat';
import { WindField } from './wind';

const AIRBORNE: ReadonlySet<FlightMode> = new Set<FlightMode>(['flying', 'gliding', 'diving', 'hovering', 'stalling', 'landing', 'takeoff']);

/**
 * The dragon's flight simulation: fixed-step 6-DOF rigid body with aerodynamics, flapping, contacts,
 * ground/water locomotion and the flight-mode state machine. Pure simulation (no rendering, no DOM).
 */
export class FlightSim {
  readonly body = new BodyState();
  readonly axes = new BodyAxes();
  readonly wind = new WindField();
  readonly beat = new WingBeat();
  readonly contacts = new BodyContacts();
  readonly controller = new FlightController();
  readonly targets = createControlTargets();
  readonly maneuvers = new Maneuvers();
  /** Plunge look-ahead and the under-water state (underwater.ts). */
  readonly dive = new DiveState();
  readonly wing: WingShape = createWingShape();
  readonly overrides: AssistOverrides = createOverrides();
  readonly options: SimOptions = { autoFlap: true, stallProtection: true, turbulence: true, thermals: true, wind: true };
  readonly world: SimWorld = { collision: undefined, geo: undefined, env: undefined };
  readonly events: SimEvent[] = [];
  /** When false, events are counted but not queued (fast-forward tests). */
  queueEvents = true;
  readonly eventCounts: Record<SimEvent['type'], number> = { flap: 0, impact: 0, splash: 0, dust: 0, landed: 0, mode: 0, maneuver: 0, sound: 0, shake: 0 };

  mode: FlightMode = 'flying';
  modeTime = 0;
  time = 0;

  /* Wing / body configuration (0..1 unless noted), shared by physics and pose. */
  spread = 1;
  sweep = 0;
  brake = 0;
  legsOut = 0;
  hoverBlend = 0;
  /** Attached-flow fraction on the wing (dynamic stall state). */
  attachment = 1;

  stamina = 1;
  tired = false;
  firing = false;

  /* Telemetry (updated every substep). */
  airspeed = 0;
  alpha = 0;
  beta = 0;
  bank = 0;
  pitch = 0;
  gamma = 0;
  loadFactor = 1;
  lift = 0;
  drag = 0;
  /** Vertical component of the aerodynamic force last step (N). */
  aeroVertical = 0;
  flapForce = 0;
  /** Surface under the dragon: the highest one reaching up to its body (a bridge deck overhead does not count). */
  surfaceY = 0;
  /** Lowest bottom of a structure entirely above the body (bridge deck, arch, overhang), Infinity when open sky. */
  ceilingY = Infinity;
  terrainY = 0;
  /** The surface below is the sea (surfaceY is then the wave height there). */
  overWater = false;
  /** Water surface height under the center of mass while over water (m; 0 on land or without a water service). */
  waterY = 0;
  /** Height of the center of mass above the surface below (m). */
  agl = 0;
  /** Height of the lowest point (feet when extended, belly when tucked) above the surface. */
  footClearance = 0;
  readonly airVelocity = new THREE.Vector3();
  /** Non-gravitational acceleration (world, m/s²): what the rider feels. */
  readonly specificForce = new THREE.Vector3();
  readonly controlMoment = new THREE.Vector3();
  readonly controlCapacity = new THREE.Vector3();
  readonly inertia = new THREE.Vector3(INERTIA.pitch, INERTIA.yawSpread, INERTIA.rollSpread);
  readonly invInertia = new THREE.Vector3();

  /* Locomotion state. */
  /** Seconds left of the crouch before a leap take-off (0 = none). */
  leapCharge = 0;
  /** Seconds into a running take-off (the urge on the ground; 0 = none). */
  runTakeoff = 0;
  groundSpeed = 0;
  groundYaw = 0;
  groundYawRate = 0;
  walkPhase = 0;
  walkAmount = 0;
  touchingWater = false;
  /** Seconds since the last splash event while skimming. */
  splashTimer = 0;
  /** Distance skimmed along the water since the last spray burst (m). */
  splashDistance = 0;
  /** Seconds since the last dust puff from a belly scrape. */
  dustTimer = 0;
  impactCooldown = 0;

  /*
   * Look-ahead along the ground track (refreshed at 20 Hz while airborne): the surface the dragon has to stay above
   * at each point (terrain, roofs, and anything reaching into its predicted body band), and the ceiling it passes
   * under there (Infinity when none, or when the gap is too small and the structure counts as an obstacle).
   */
  readonly aheadSurface: number[] = PROXIMITY.lookahead.map(() => 0);
  readonly aheadCeiling: number[] = PROXIMITY.lookahead.map(() => Infinity);
  readonly aheadDistance: number[] = PROXIMITY.lookahead.map(() => 0);
  readonly aheadWater: boolean[] = PROXIMITY.lookahead.map(() => false);
  private aheadTimer = 0;
  private readonly column = { floor: 0, ceiling: Infinity };

  /*
   * Far look-ahead along the ground track beyond the near samples (hands-off assist: tall obstacles such as towers
   * are seen early enough to climb over them, or to turn away from them). Split like the near samples; ceilings are
   * kept so a distant deck to fly under is not taken for a wall. Surface -Infinity = no sample (hovering).
   */
  readonly farSurface: number[] = new Array<number>(PROXIMITY.farSamples).fill(-Infinity);
  readonly farCeiling: number[] = new Array<number>(PROXIMITY.farSamples).fill(Infinity);
  readonly farDistance: number[] = new Array<number>(PROXIMITY.farSamples).fill(0);
  readonly farWater: boolean[] = new Array<boolean>(PROXIMITY.farSamples).fill(false);
  /** Far look-ahead on (off only to compare against the near look-ahead alone in headless checks). */
  farLookahead = true;
  /** Reach of the far look-ahead (m), set at the start of each sweep. */
  farReach: number = PROXIMITY.farMin;
  /** Steepest climb angle (rad) to clear a far sample with the hands-off land / water clearance (-Infinity: none). */
  farPath = -Infinity;
  /** Distance (m) of the sample that needs farPath, and the climb (m) it needs. */
  farObstacleDistance = 0;
  farClimb = 0;
  /** Side the hands-off assist turns to around an obstacle it cannot out-climb: +1 right, -1 left, 0 none. */
  farSide = 0;
  private farCursor = 0;
  private farTurnTimer = 0;

  standHeight = 0.5 * DEFAULT_RIG_HEIGHT;
  rigLength = DEFAULT_RIG_LENGTH;
  readonly impact: ImpactReport = { speed: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: '', touched: false };
  /** Heading to escape along after bouncing off a wall (world, horizontal unit), valid while escapeTimer > 0. */
  readonly escapeDirection = new THREE.Vector3();
  escapeTimer = 0;

  private readonly lastGood = new BodyState();

  constructor() {
    this.updateInertia();
    this.contacts.configure(this.rigLength, this.standHeight);
  }

  get airborne(): boolean {
    return AIRBORNE.has(this.mode);
  }

  configureRig(length: number, standHeight: number): void {
    this.rigLength = length;
    this.standHeight = standHeight;
    this.contacts.configure(length, standHeight);
  }

  /** Effort cap from fatigue. */
  effortCap(): number {
    return this.tired ? STAMINA.tiredEffortCap : 1;
  }

  setMode(mode: FlightMode): void {
    if (mode === this.mode) {
      return;
    }
    this.eventCounts.mode++;
    this.mode = mode;
    this.modeTime = 0;
    this.controller.onModeEnter(mode);
    if (mode === 'landing') {
      this.emit({ type: 'maneuver', id: 'land', label: MANEUVER_LABELS.land });
    }
  }

  emit(event: SimEvent): void {
    this.eventCounts[event.type]++;
    if (this.queueEvents) {
      this.events.push(event);
    }
  }

  /** Place the dragon in level flight (or on the surface when `grounded`). */
  teleport(x: number, y: number, z: number, yaw: number, pitch: number, speed: number): void {
    const b = this.body;
    b.position.set(x, y, z);
    b.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    b.velocity.set(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(speed);
    b.angularVelocity.set(0, 0, 0);
    this.axes.update(b.quaternion);
    this.mode = speed > 0.5 ? 'flying' : 'hovering';
    this.modeTime = 0;
    this.spread = 1;
    this.sweep = 0;
    this.brake = 0;
    this.legsOut = 0;
    this.hoverBlend = speed > 0.5 ? 0 : 1;
    this.attachment = 1;
    this.firing = false;
    this.groundSpeed = 0;
    this.groundYaw = yaw;
    this.touchingWater = false;
    this.airspeed = speed;
    this.gamma = 0;
    this.pitch = pitch;
    this.bank = 0;
    this.beat.reset();
    this.controller.reset(0);
    this.maneuvers.reset();
    this.dive.resetLook();
    this.leapCharge = 0;
    this.runTakeoff = 0;
    this.aheadTimer = 0;
    this.resetFarLookahead();
    this.splashDistance = 0;
    this.wind.reseed(4711);
    this.sampleSurface();
    const envWind = this.wind.override ?? this.world.env?.wind;
    if (envWind && this.options.wind && speed > 0.5) {
      // Start with the airflow on the nose (no sideslip transient in a crosswind).
      const profile = clamp(Math.pow(Math.max(this.agl, 2) / 100, 0.22), 0.3, 1.6);
      b.velocity.x += envWind.x * profile;
      b.velocity.z += envWind.z * profile;
    }
    this.lastGood.copy(b);
  }

  /** Put the dragon down standing on the surface at its current x/z. */
  placeOnGround(): void {
    this.sampleSurface();
    if (this.surfaceIsWater()) {
      enterSwimming(this);
    } else {
      enterGrounded(this);
    }
  }

  /** The surface below is the sea (valid after sampleSurface). */
  surfaceIsWater(): boolean {
    return this.overWater;
  }

  /** Sea surface height at x, z: the water service's waves, or the flat sea at y = 0 without one. */
  waterHeight(x: number, z: number): number {
    const water = this.world.water;
    return water ? water.heightAt(x, z) : 0;
  }

  sampleSurface(): void {
    const p = this.body.position;
    const col = this.world.collision;
    if (col) {
      this.terrainY = col.terrainHeight(p.x, p.z);
      // Split the column at the top of the body: what reaches down to it is the surface below, what lies entirely
      // above it is a ceiling (flying or walking under a bridge keeps the water / ground as the surface).
      col.columnAt(p.x, p.z, p.y + this.contacts.bellyDepth, this.column);
      this.surfaceY = this.column.floor;
      this.ceilingY = this.column.ceiling;
    } else {
      this.terrainY = -10;
      this.surfaceY = 0;
      this.ceilingY = Infinity;
    }
    // The collision world knows the sea only as a flat floor at y = 0; over it the surface is the wave height.
    this.overWater = this.terrainY < -0.4 && this.surfaceY < 0.05;
    this.waterY = this.overWater ? this.waterHeight(p.x, p.z) : 0;
    if (this.overWater) {
      this.surfaceY = this.waterY;
    }
    this.agl = p.y - this.surfaceY;
    this.footClearance = this.agl - this.footDepth();
  }

  /** Depth of the lowest point below the center of mass: belly, or hind feet (lower when pitched up). */
  footDepth(): number {
    const legs = this.legsOut;
    const hindDrop = Math.max(0, Math.sin(this.pitch)) * this.contacts.offsets[1].z * legs;
    return this.contacts.bellyDepth + (this.standHeight - this.contacts.bellyDepth) * legs + hindDrop;
  }

  updateInertia(): void {
    const s = clamp(this.spread, 0, 1);
    this.inertia.set(
      INERTIA.pitch,
      INERTIA.yawFolded + (INERTIA.yawSpread - INERTIA.yawFolded) * s,
      INERTIA.rollFolded + (INERTIA.rollSpread - INERTIA.rollFolded) * s,
    );
    this.invInertia.set(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);
  }

  /** Bank command bias that turns the dragon back toward the map center beyond the soft boundary. */
  boundarySteer(bankCmd: number): number {
    const p = this.body.position;
    const out = Math.max(Math.abs(p.x), Math.abs(p.z));
    if (out < ENVELOPE.boundarySoft) {
      return bankCmd;
    }
    const w = clamp((out - ENVELOPE.boundarySoft) / 1000, 0, 1);
    const homeYaw = Math.atan2(p.x, p.z);
    let err = homeYaw - this.axes.yaw();
    err = Math.atan2(Math.sin(err), Math.cos(err));
    const homeBank = clamp(-err * 1.2, -0.7, 0.7);
    return bankCmd + (homeBank - bankCmd) * w;
  }

  /** One fixed physics step. */
  step(h: number, cmd: PilotCommand): void {
    this.time += h;
    this.modeTime += h;
    this.impactCooldown = Math.max(0, this.impactCooldown - h);
    this.escapeTimer = Math.max(0, this.escapeTimer - h);
    this.splashTimer += h;
    this.dustTimer += h;
    this.touchingWater = false;
    this.axes.update(this.body.quaternion);
    this.sampleSurface();
    this.maneuvers.tick(h);

    if (this.mode === 'grounded') {
      stepGrounded(this, cmd, h);
    } else if (this.mode === 'swimming') {
      stepSwimming(this, cmd, h);
    } else if (this.mode === 'underwater') {
      stepUnderwater(this, cmd, h);
    } else {
      this.updateLookahead(h);
      updatePlungeLook(this, cmd, h);
      this.maneuvers.begin(this, cmd, h);
      this.airborneModeTransitions(cmd);
      stepAirborne(this, cmd, h);
    }

    this.updateStamina(cmd, h);
    this.enforceCeiling();
    this.enforceBoundary();

    if (!this.body.isFinite()) {
      this.body.copy(this.lastGood);
      this.body.velocity.set(0, 0, 0);
      this.body.angularVelocity.set(0, 0, 0);
    } else if ((this.time * 2) % 1 < h * 2) {
      this.lastGood.copy(this.body);
    }
  }

  private airborneModeTransitions(cmd: PilotCommand): void {
    const V = this.airspeed;
    const trick = this.maneuvers.displayMode();
    if (trick) {
      this.setMode(trick);
      return;
    }
    switch (this.mode) {
      case 'takeoff':
        if ((this.modeTime > 0.8 && V > 16 && this.footClearance > 6) || this.modeTime > 6) {
          this.controller.holdPath(Math.max(this.gamma, 8 * DEG));
          this.setMode('flying');
        }
        return;
      case 'landing':
        if (cmd.landPressed || (cmd.flapPressed && this.modeTime > 0.2)) {
          this.controller.holdPath(Math.max(this.gamma, 0.1));
          // Too slow to fly away: climb out with take-off strokes.
          this.setMode(V < 12 ? 'takeoff' : 'flying');
        }
        return;
      case 'hovering': {
        // Brake to enter; the hover then holds until W is pressed with the brake released (fly out) or L (land).
        // W/S creep while braking, A/D turn, Space/Shift climb/descend (FlightController).
        if (cmd.landPressed) {
          this.setMode('landing');
          return;
        }
        if (!cmd.brake && cmd.pitch > 0.3) {
          this.controller.holdPath(0.05);
          this.controller.latchForward();
          this.setMode('takeoff');
          return;
        }
        if (this.tired) {
          // Too exhausted to hold a hover: settle onto the ground when low over land, otherwise dive away to
          // gain flying speed (gliding costs nothing).
          if (!this.overWater && this.footClearance < 40) {
            this.setMode('landing');
            this.controller.flare = true;
            this.controller.hoverDescent = true;
          } else {
            this.controller.holdPath(-0.35);
            this.setMode('flying');
          }
          return;
        }
        // Idle low over land: settle into the landing descent instead of hovering forever.
        const settle = !cmd.flap && !this.overWater && this.footClearance < HOVER.settleClearance && this.body.velocity.y < 0.8;
        if (settle && this.modeTime > 0.6) {
          this.setMode('landing');
          this.controller.flare = true;
          this.controller.hoverDescent = true;
        }
        return;
      }
      default:
        break;
    }
    if (cmd.landPressed) {
      this.setMode('landing');
      return;
    }
    if (cmd.brake && V < ENVELOPE.hoverEnterSpeed && !cmd.dive && !this.tired) {
      this.setMode('hovering');
      return;
    }
    const lowSlow = V < ENVELOPE.landingMaxSpeed && this.agl - this.standHeight < ENVELOPE.landingMaxAgl && !this.overWater;
    if (lowSlow && !cmd.flap && !cmd.dive && this.body.velocity.y < 1) {
      this.setMode('landing');
      this.controller.flare = true;
      this.controller.hoverDescent = V < 14;
      return;
    }
    let display: FlightMode = 'flying';
    if ((cmd.dive && this.spread < 0.5) || (this.spread < 0.35 && this.gamma < -0.35)) {
      display = 'diving';
    } else if (this.attachment < 0.6 && this.hoverBlend < 0.5 && this.alpha > 0) {
      display = 'stalling';
    } else if (this.beat.effort < 0.04 && this.beat.amplitude < 0.12 && !cmd.brake && this.brake < 0.3) {
      display = 'gliding';
    }
    this.setMode(display);
  }

  private updateStamina(cmd: PilotCommand, h: number): void {
    const e = this.beat.effort;
    const work = Math.max(0, e - 0.25) / 0.75;
    let drain = STAMINA.drain * work * work * (1 + STAMINA.hoverExtra * this.hoverBlend);
    // No fire under water.
    const wantsFire = cmd.fire && !this.tired && this.stamina > 0.02 && this.mode !== 'underwater';
    this.firing = wantsFire;
    if (wantsFire) {
      drain += STAMINA.fire;
    }
    let regen = 0;
    if (wantsFire) {
      // Breathing fire is never restful: no recovery while it lasts.
      regen = 0;
    } else if (this.mode === 'grounded') {
      regen = STAMINA.regenGround;
    } else if (this.mode === 'swimming') {
      regen = STAMINA.regenWater;
    } else if (this.mode === 'underwater') {
      // Holding its breath: the air runs down slowly.
      regen = -PLUNGE.airDrain;
    } else if (e < 0.5) {
      regen = STAMINA.regenAir * (1 - e / 0.5);
    }
    this.stamina = clamp(this.stamina + (regen - drain) * h, 0, 1);
    if (!this.tired && this.stamina < STAMINA.tiredBelow) {
      this.tired = true;
    } else if (this.tired && this.stamina > STAMINA.recoverAbove) {
      this.tired = false;
    }
  }

  /**
   * Surface and ceiling 0.8 / 1.7 / 2.8 s ahead along the ground track (ground-proximity assist). At each point
   * the column is split at the top of the body band swept on the way there (the higher of now and the predicted
   * height, plus the raised wings and a margin): structures reaching into it are obstacles (their top is the
   * surface to clear), structures entirely above it are ceilings to fly under — unless the gap below them is too
   * small for the dragon, then they are obstacles as well. A ceiling the dragon is already under caps the band: it
   * cannot climb over what it is beneath. The far look-ahead continues the scan beyond the near samples.
   */
  private updateLookahead(h: number): void {
    this.aheadTimer -= h;
    if (this.aheadTimer > 0) {
      return;
    }
    this.aheadTimer = PROXIMITY.sampleInterval;
    const p = this.body.position;
    const v = this.body.velocity;
    const col = this.world.collision;
    const horizontal = Math.hypot(v.x, v.z);
    const above = PROXIMITY.headroom + PROXIMITY.ceilingMargin;
    const gapNeed = this.footDepth() + PROXIMITY.headroom + PROXIMITY.ceilingKeep + PROXIMITY.passClearance;
    const under = this.ceilingY < Infinity;
    for (let i = 0; i < PROXIMITY.lookahead.length; i++) {
      const t = PROXIMITY.lookahead[i];
      const x = p.x + v.x * t;
      const z = p.z + v.z * t;
      this.aheadDistance[i] = horizontal * t;
      if (col) {
        const terrain = col.terrainHeight(x, z);
        this.sampleColumn(col, x, z, Math.max(p.y, p.y + v.y * t) + above, gapNeed, under);
        const surface = this.column.floor;
        const water = terrain < -0.4 && surface < 0.05;
        this.aheadSurface[i] = water ? this.waterHeight(x, z) : surface;
        this.aheadCeiling[i] = this.column.ceiling;
        this.aheadWater[i] = water;
      } else {
        this.aheadSurface[i] = this.waterHeight(x, z);
        this.aheadCeiling[i] = Infinity;
        this.aheadWater[i] = true;
      }
    }
    this.updateFarLookahead(horizontal, gapNeed, under);
  }

  private resetFarLookahead(): void {
    this.farSurface.fill(-Infinity);
    this.farCeiling.fill(Infinity);
    this.farDistance.fill(0);
    this.farWater.fill(false);
    this.farCursor = 0;
    this.farReach = PROXIMITY.farMin;
    this.farPath = -Infinity;
    this.farObstacleDistance = 0;
    this.farClimb = 0;
    this.farSide = 0;
    this.farTurnTimer = 0;
  }

  /**
   * Split column at (x, z) for a look-ahead point: the band is `band` (capped under a ceiling the dragon is already
   * beneath); a gap under a ceiling too small for the dragon makes the whole structure an obstacle.
   */
  private sampleColumn(col: NonNullable<SimWorld['collision']>, x: number, z: number, band: number, gapNeed: number, under: boolean): void {
    if (under) {
      band = Math.min(band, this.ceilingY - 0.01);
    }
    const c = col.columnAt(x, z, band, this.column);
    if (c.ceiling < Infinity && c.ceiling - c.floor < gapNeed && !under) {
      c.floor = col.surfaceHeight(x, z);
      c.ceiling = Infinity;
    }
  }

  /**
   * Far look-ahead: farPerUpdate of the farSamples points between the last near sample and the reach are refreshed
   * each look-ahead update (older samples have their distance shortened by the ground covered since). The reach grows
   * with the airspeed and with the climb the worst obstacle of the last sweep needs at the planned climb angle. The
   * body band is predicted no further than the near look-ahead (a climb or a descent does not go on for ever), so a
   * deck far ahead that the dragon would pass under at its height stays a ceiling. When the steepest climb needed is
   * too steep to fly, two probes along headings to either side pick the side to turn to (kept until the obstacle is
   * no longer a problem).
   */
  private updateFarLookahead(horizontal: number, gapNeed: number, under: boolean): void {
    const n = PROXIMITY.farSamples;
    const col = this.world.collision;
    const p = this.body.position;
    const v = this.body.velocity;
    if (!this.farLookahead || !col || horizontal < 3) {
      if (this.farPath !== -Infinity || this.farSide !== 0) {
        this.resetFarLookahead();
      }
      return;
    }
    const covered = horizontal * PROXIMITY.sampleInterval;
    for (let k = 0; k < n; k++) {
      this.farDistance[k] -= covered;
    }
    const nearTime = PROXIMITY.lookahead[PROXIMITY.lookahead.length - 1];
    const start = horizontal * nearTime;
    if (this.farCursor === 0) {
      const climbReach = Math.max(this.farClimb, 0) / Math.tan(PROXIMITY.farPlanPath);
      this.farReach = clamp(Math.max(horizontal * PROXIMITY.farTime, climbReach), PROXIMITY.farMin, PROXIMITY.farMax);
    }
    const reach = Math.max(this.farReach, start + 10);
    const ux = v.x / horizontal;
    const uz = v.z / horizontal;
    const band = Math.max(p.y, p.y + v.y * nearTime) + PROXIMITY.headroom + PROXIMITY.ceilingMargin;
    for (let j = 0; j < PROXIMITY.farPerUpdate; j++) {
      const k = this.farCursor;
      this.farCursor = (k + 1) % n;
      const d = start + ((reach - start) * (k + 1)) / n;
      const x = p.x + ux * d;
      const z = p.z + uz * d;
      this.sampleColumn(col, x, z, band, gapNeed, under);
      const water = col.terrainHeight(x, z) < -0.4 && this.column.floor < 0.05;
      this.farSurface[k] = water ? this.waterHeight(x, z) : this.column.floor;
      this.farCeiling[k] = this.column.ceiling;
      this.farDistance[k] = d;
      this.farWater[k] = water;
    }
    // Steepest climb to clear a sample with the hands-off clearance (ceilings squeeze it into the gap).
    const feet = p.y - this.footDepth();
    const up = this.footDepth() + PROXIMITY.headroom + PROXIMITY.ceilingKeep;
    let worst = -Infinity;
    let worstK = -1;
    let worstClimb = 0;
    for (let k = 0; k < n; k++) {
      const surface = this.farSurface[k];
      const d = this.farDistance[k];
      if (surface === -Infinity || d <= start * 0.5) {
        continue;
      }
      let want: number = this.farWater[k] ? PROXIMITY.idleWater : PROXIMITY.idleLand;
      if (this.farCeiling[k] < Infinity) {
        want = Math.min(want, Math.max(this.farCeiling[k] - up - surface, PROXIMITY.passClearance));
      }
      const climb = surface + want - feet;
      const path = Math.atan2(climb, d);
      if (path > worst) {
        worst = path;
        worstK = k;
        worstClimb = climb;
      }
    }
    this.farPath = worst;
    this.farClimb = worstClimb;
    this.farObstacleDistance = worstK >= 0 ? this.farDistance[worstK] : 0;
    // Too steep to out-climb: the climb needed is steep and the dragon's own climb has been falling short of it for a
    // moment (a dragon already climbing at about the angle needed keeps climbing).
    const shortfall = worst >= PROXIMITY.farTurnPath && worst - Math.max(this.gamma, 0) > PROXIMITY.farTurnLag;
    this.farTurnTimer = shortfall ? this.farTurnTimer + PROXIMITY.sampleInterval : 0;
    if (this.farSide !== 0 && worst < 0.6 * PROXIMITY.farTurnPath) {
      this.farSide = 0;
    } else if (this.farSide === 0 && this.farTurnTimer >= PROXIMITY.farTurnDelay) {
      // Two probes along headings to either side at the obstacle's distance: turn toward the lower column.
      const d = this.farObstacleDistance + 20;
      const c = Math.cos(PROXIMITY.farProbeAngle);
      const s = Math.sin(PROXIMITY.farProbeAngle);
      // Right of the track is (-uz, ux).
      this.sampleColumn(col, p.x + (ux * c - uz * s) * d, p.z + (uz * c + ux * s) * d, band, gapNeed, under);
      const right = this.column.floor;
      this.sampleColumn(col, p.x + (ux * c + uz * s) * d, p.z + (uz * c - ux * s) * d, band, gapNeed, under);
      const left = this.column.floor;
      this.farSide = Math.abs(right - left) < 2 ? (this.bank < 0 ? -1 : 1) : right < left ? 1 : -1;
    }
  }

  /** Hard clamp inside the world for every mode (flight also has the soft steer + push-back force). */
  private enforceBoundary(): void {
    const p = this.body.position;
    const v = this.body.velocity;
    const lim = ENVELOPE.boundaryClamp;
    if (Math.abs(p.x) > lim) {
      const s = Math.sign(p.x);
      p.x = s * lim;
      if (v.x * s > 0) {
        v.x = 0;
      }
    }
    if (Math.abs(p.z) > lim) {
      const s = Math.sign(p.z);
      p.z = s * lim;
      if (v.z * s > 0) {
        v.z = 0;
      }
    }
  }

  private enforceCeiling(): void {
    const b = this.body;
    const hard = WORLD_CEILING + 250;
    if (b.position.y > hard) {
      b.position.y = hard;
      b.velocity.y = Math.min(b.velocity.y, 0);
    }
  }

}
