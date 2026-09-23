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
import { DEFAULT_RIG_HEIGHT, DEFAULT_RIG_LENGTH, DEG, ENVELOPE, HOVER, INERTIA, MASS, PROXIMITY, STAMINA } from './params';
import type { AssistOverrides, PilotCommand, SimEvent, SimOptions, SimWorld } from './types';
import { createOverrides } from './types';
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
  readonly wing: WingShape = createWingShape();
  readonly overrides: AssistOverrides = createOverrides();
  readonly options: SimOptions = { autoFlap: true, stallProtection: true, turbulence: true, thermals: true, wind: true };
  readonly world: SimWorld = { collision: undefined, geo: undefined, env: undefined };
  readonly events: SimEvent[] = [];
  /** When false, events are counted but not queued (fast-forward tests). */
  queueEvents = true;
  readonly eventCounts: Record<SimEvent['type'], number> = { flap: 0, impact: 0, splash: 0, dust: 0, landed: 0, mode: 0 };

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
  surfaceY = 0;
  terrainY = 0;
  overWater = false;
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
  /** Seconds W has been held in the latched hover. */
  hoverPushTime = 0;

  /* Terrain look-ahead along the ground track (refreshed at 20 Hz while airborne). */
  readonly aheadSurface: number[] = PROXIMITY.lookahead.map(() => 0);
  readonly aheadDistance: number[] = PROXIMITY.lookahead.map(() => 0);
  readonly aheadWater: boolean[] = PROXIMITY.lookahead.map(() => false);
  private aheadTimer = 0;

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
    this.hoverPushTime = 0;
    this.controller.onModeEnter(mode);
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
    this.aheadTimer = 0;
    this.splashDistance = 0;
    this.hoverPushTime = 0;
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

  surfaceIsWater(): boolean {
    return this.terrainY < -0.4 && this.surfaceY < 0.05;
  }

  sampleSurface(): void {
    const p = this.body.position;
    const col = this.world.collision;
    if (col) {
      this.terrainY = col.terrainHeight(p.x, p.z);
      this.surfaceY = col.surfaceHeight(p.x, p.z);
    } else {
      this.terrainY = -10;
      this.surfaceY = 0;
    }
    this.overWater = this.surfaceIsWater();
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

    if (this.mode === 'grounded') {
      stepGrounded(this, cmd, h);
    } else if (this.mode === 'swimming') {
      stepSwimming(this, cmd, h);
    } else {
      this.updateLookahead(h);
      this.airborneModeTransitions(cmd, h);
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

  private airborneModeTransitions(cmd: PilotCommand, h: number): void {
    const V = this.airspeed;
    switch (this.mode) {
      case 'takeoff':
        if ((this.modeTime > 0.8 && V > 14.5 && this.footClearance > 4) || this.modeTime > 6) {
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
        // The hover is latched: brake to enter, then W/S translate, Space/Shift climb/descend, A/D turn.
        if (cmd.landPressed) {
          this.setMode('landing');
          return;
        }
        // Pushing W flies out: once moving forward (over the ground or through the air, so a headwind counts),
        // or after W has been held for a moment whatever the wind.
        const pushing = !cmd.brake && cmd.pitch > 0.3;
        this.hoverPushTime = pushing ? this.hoverPushTime + h : 0;
        const yaw = this.axes.yaw();
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        const forward = fx * this.body.velocity.x + fz * this.body.velocity.z;
        const forwardAir = fx * this.airVelocity.x + fz * this.airVelocity.z;
        if (pushing && (forward > HOVER.exitSpeed || forwardAir > HOVER.exitAirspeed || this.hoverPushTime > HOVER.exitHoldTime)) {
          this.hoverPushTime = 0;
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
    const wantsFire = cmd.fire && !this.tired && this.stamina > 0.02;
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

  /** Surface heights 0.8 / 1.7 / 2.8 s ahead along the ground track (ground-proximity assist). */
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
    for (let i = 0; i < PROXIMITY.lookahead.length; i++) {
      const t = PROXIMITY.lookahead[i];
      const x = p.x + v.x * t;
      const z = p.z + v.z * t;
      this.aheadDistance[i] = horizontal * t;
      if (col) {
        const terrain = col.terrainHeight(x, z);
        const surface = col.surfaceHeight(x, z);
        this.aheadSurface[i] = surface;
        this.aheadWater[i] = terrain < -0.4 && surface < 0.05;
      } else {
        this.aheadSurface[i] = 0;
        this.aheadWater[i] = true;
      }
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
