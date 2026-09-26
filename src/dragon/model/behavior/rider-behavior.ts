import * as THREE from 'three';
import type { DragonPose, DragonState, EngineContext } from '../../../core/contracts';
import type { DragonRigImpl } from '../rig';

/** Pose fields the debug handle can force (all rider cues, including the ones flight writes). */
const CUE_KEYS = ['riderReinLeft', 'riderReinRight', 'riderTuck', 'riderUrge', 'riderPoint', 'riderCheer', 'riderPet', 'riderStand', 'gazeRider'] as const;
type CueKey = (typeof CUE_KEYS)[number];

/** Debug overrides: cue values plus fixed animation phases (urge snap 0..1, petting stroke in rad) and the gaze side. */
export type RiderDebugOverrides = Partial<Record<CueKey, number>> & { urgePhase?: number; strokePhase?: number; gazeSide?: number };

export interface RiderDebugHandle {
  force(values: RiderDebugOverrides): RiderDebugOverrides;
  clear(): void;
  state(): Record<string, number | string | boolean>;
}

const DEG = Math.PI / 180;
/** Seconds to stand up or sit down, to reach the neck with the hand, and to take it back to the reins. */
const STAND_TIME = 0.9;
const PET_IN_TIME = 0.5;
const PET_OUT_TIME = 0.6;
/** The dragon turns to look at the rider after this much petting; gaze level while petted. */
const PET_GAZE_DELAY = 0.6;
const PET_GAZE = 0.8;
/** Seconds between purr phrases while petted (each phrase is ~2 s). */
const PURR_EVERY = 2.1;
/** Maneuvers the dragon glances back after ("did you like that?"). */
const GLANCE_AFTER = new Set(['catch', 'roll', 'loop', 'urge', 'wingover', 'immelmann', 'splits']);

const LABELS = {
  pet: 'Ejderhayı seviyorsun',
  stand: 'Ayağa kalktın',
  sit: 'Oturdun',
  standBlocked: 'Ancak sakin uçuşta ayağa kalkabilirsin',
};

interface Glance {
  /** Seconds until it starts (it waits while conditions are not calm). */
  delay: number;
  duration: number;
  level: number;
  side: number;
  /** Drop the glance if it could not start within this many seconds. */
  expires: number;
}

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

function bankAngle(state: DragonState): number {
  _right.set(1, 0, 0).applyQuaternion(state.quaternion);
  _up.set(0, 1, 0).applyQuaternion(state.quaternion);
  return Math.atan2(-_right.y, _up.y);
}

function smooth01(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * The rider's own actions and the dragon's attention: petting (G held), standing up on the saddle (T), and when the
 * dragon turns its head back to look at the rider. Writes riderPet, riderStand and gazeRider each frame, right before
 * the model applies the pose; emits `maneuver` captions and the purr.
 */
export class RiderBehavior {
  private petT = 0;
  private petting = false;
  private petTime = 0;
  private lastPetEvent = -99;
  private purrIn = 0;
  private standT = 0;
  private wantStand = false;
  private wasStanding = false;
  private gaze = 0;
  private glance: Glance | null = null;
  private glanceAge = 0;
  private idleIn = 25 + Math.random() * 35;
  private time = 0;
  private overrides: RiderDebugOverrides | null = null;
  private readonly unsubscribe: () => void;
  private readonly handle: RiderDebugHandle | null = null;

  constructor(
    private readonly rig: DragonRigImpl,
    ctx: EngineContext,
  ) {
    this.unsubscribe = ctx.events.on('maneuver', ({ id }) => {
      if (GLANCE_AFTER.has(id)) {
        this.queueGlance(0.5, 1.6 + Math.random() * 0.6, 0.9, 5);
      }
    });
    if (import.meta.env.DEV || ctx.sandbox) {
      this.handle = {
        force: (values) => {
          this.overrides = { ...(this.overrides ?? {}), ...values };
          if (values.gazeSide !== undefined) {
            this.rig.setGazeSide(values.gazeSide, true);
          }
          return this.overrides;
        },
        clear: () => {
          this.overrides = null;
          this.rig.setDebugPhases(null, null);
        },
        state: () => ({ pet: this.petT, petting: this.petting, stand: this.standT, wantStand: this.wantStand, gaze: this.gaze, glance: !!this.glance }),
      };
      (window as unknown as { __riderDebug?: RiderDebugHandle }).__riderDebug = this.handle;
    }
  }

  update(dt: number, ctx: EngineContext): void {
    if (dt > 0) {
      this.time += dt;
      this.step(dt, ctx);
    }
    const out: Partial<DragonPose> = { riderPet: smooth01(this.petT), riderStand: smooth01(this.standT), gazeRider: this.gaze };
    this.rig.setPose(out);
    const o = this.overrides;
    if (o) {
      const forced: Partial<DragonPose> = {};
      for (const key of CUE_KEYS) {
        const v = o[key];
        if (v !== undefined) {
          forced[key] = v;
        }
      }
      this.rig.setPose(forced);
      this.rig.setDebugPhases(o.urgePhase ?? null, o.strokePhase ?? null);
      if (o.gazeSide !== undefined) {
        this.rig.setGazeSide(o.gazeSide, true);
      }
    }
  }

  dispose(): void {
    this.unsubscribe();
    const w = window as unknown as { __riderDebug?: RiderDebugHandle };
    if (this.handle && w.__riderDebug === this.handle) {
      delete w.__riderDebug;
    }
  }

  private step(dt: number, ctx: EngineContext): void {
    const state = ctx.services.tryGet('dragon');
    const pose = this.rig.getPose();
    const tuck = pose.riderTuck ?? 0;
    const busyHands = Math.max(pose.riderUrge ?? 0, pose.riderPoint ?? 0, pose.riderCheer ?? 0);
    const mode = state?.mode ?? 'flying';
    const bank = state ? Math.abs(bankAngle(state)) : 0;
    const g = state?.gForce ?? 1;
    const grounded = mode === 'grounded';
    const calmFlight = mode === 'flying' || mode === 'gliding';
    const firing = (state?.firing ?? false) || pose.jawOpen > 0.3;
    const maneuvering = tuck > 0.2 || bank > 35 * DEG || g > 1.6 || g < 0.4 || mode === 'diving' || mode === 'landing' || mode === 'takeoff' || mode === 'stalling';

    // --- Standing (T toggles) ---
    const standOk = tuck < 0.2 && ((calmFlight && bank < 30 * DEG && g > 0.7 && g < 1.4) || grounded);
    const input = ctx.input;
    // Perched on a viewpoint T is the time-lapse (src/ui/perch-view.ts), not standing up.
    const perched = state?.perch?.phase === 'perched';
    if (input.wasPressed('stand') && !perched) {
      if (this.wantStand) {
        this.sit(ctx);
      } else if (standOk && !this.petting) {
        this.wantStand = true;
        ctx.events.emit('maneuver', { id: 'stand', label: LABELS.stand });
      } else if (!standOk) {
        ctx.events.emit('toast', { text: LABELS.standBlocked, kind: 'info' });
      }
    }
    const mustSit = tuck > 0.2 || bank > 35 * DEG || g > 1.6 || (!grounded && !calmFlight);
    if (this.wantStand && mustSit) {
      this.sit(ctx);
    }

    // --- Petting (G held): the right hand goes to the neck in calm flight, hovering or on the ground ---
    const petHeld = input.isHeld('pet');
    if (petHeld && this.wantStand) {
      this.sit(ctx);
    }
    const petOk = petHeld && !maneuvering && !firing && busyHands < 0.3 && this.standT < 0.15 && (calmFlight || grounded || mode === 'hovering');
    if (petOk && !this.petting && this.time - this.lastPetEvent > 3) {
      ctx.events.emit('maneuver', { id: 'pet', label: LABELS.pet });
      this.lastPetEvent = this.time;
    }
    if (petOk !== this.petting) {
      this.petting = petOk;
      this.petTime = 0;
      this.purrIn = 0.5;
    }
    this.petT = THREE.MathUtils.clamp(this.petT + (this.petting ? dt / PET_IN_TIME : -dt / PET_OUT_TIME), 0, 1);
    this.standT = THREE.MathUtils.clamp(this.standT + (this.wantStand ? dt : -dt) / STAND_TIME, 0, 1);
    if (this.petting) {
      this.petTime += dt;
      this.purrIn -= dt;
      if (this.purrIn <= 0 && this.petT > 0.6) {
        ctx.services.tryGet('audio')?.play('purr', 0.9);
        this.purrIn = PURR_EVERY + Math.random() * 0.4;
      }
    }

    // A look back once the rider is up on his feet.
    const standing = this.standT >= 1;
    if (standing && !this.wasStanding) {
      this.queueGlance(0.3, 1.5 + Math.random(), 0.9, 3);
    }
    this.wasStanding = standing;

    // --- Gaze ---
    const lowFast = state ? state.agl < 25 && state.airspeed > 25 : false;
    const blocked = firing || maneuvering || lowFast || tuck > 0.05 || busyHands > 0.3;
    let target = 0;
    let side = 1;
    if (this.petting && this.petTime > PET_GAZE_DELAY && !blocked) {
      target = PET_GAZE;
      side = -1;
    } else {
      this.updateGlance(dt, blocked, calmFlight || grounded);
      if (this.glance && this.glance.delay <= 0) {
        target = this.glance.level;
        side = this.glance.side;
      }
    }
    if (blocked) {
      target = 0;
    }
    this.rig.setGazeSide(side);
    const rate = target > this.gaze ? 1.6 : 2.4;
    this.gaze += (target - this.gaze) * (1 - Math.exp(-rate * dt));
    if (this.gaze < 0.002 && target === 0) {
      this.gaze = 0;
    }
  }

  private sit(ctx: EngineContext): void {
    if (!this.wantStand) {
      return;
    }
    this.wantStand = false;
    ctx.events.emit('maneuver', { id: 'sit', label: LABELS.sit });
  }

  private queueGlance(delay: number, duration: number, level: number, expires: number): void {
    this.glance = { delay, duration, level, side: Math.random() < 0.5 ? 1 : -1, expires };
    this.glanceAge = 0;
  }

  /** Runs the current glance (waiting for calm), and now and then starts one on its own while cruising. */
  private updateGlance(dt: number, blocked: boolean, calm: boolean): void {
    const gl = this.glance;
    if (gl) {
      this.glanceAge += dt;
      if (gl.delay > 0) {
        if (!blocked) {
          gl.delay -= dt;
        } else if (this.glanceAge > gl.expires) {
          this.glance = null;
        }
        return;
      }
      gl.duration -= dt;
      if (gl.duration <= 0 || blocked) {
        this.glance = null;
      }
      return;
    }
    if (calm && !blocked) {
      this.idleIn -= dt;
      if (this.idleIn <= 0) {
        this.queueGlance(0, 1.8 + Math.random(), 0.85, 1);
        this.idleIn = 25 + Math.random() * 35;
      }
    }
  }
}
