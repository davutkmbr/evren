import * as THREE from 'three';
import type { DragonPose, DragonState, EngineContext } from '../../../core/contracts';
import type { DragonRigImpl } from '../rig';

/** Pose fields the debug handle can force (all rider cues, including the ones flight and the bond write). */
const CUE_KEYS = [
  'riderReinLeft',
  'riderReinRight',
  'riderTuck',
  'riderPoint',
  'riderCheer',
  'riderPet',
  'riderStand',
  'gazeRider',
  'riderLaugh',
  'riderShow',
  'riderShowYaw',
  'riderShowPitch',
  'riderPat',
  'eyeLid',
  'pupil',
  'neckPlates',
  'headRoll',
  'neckShake',
  'bodyRoll',
  'tailCurl',
] as const;
type CueKey = (typeof CUE_KEYS)[number];

/** Debug overrides: cue values plus a fixed petting stroke phase (rad) and the gaze side. */
export type RiderDebugOverrides = Partial<Record<CueKey, number>> & { strokePhase?: number; gazeSide?: number };

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

const LABELS = {
  pet: 'Ejderhayı seviyorsun',
  stand: 'Ayağa kalktın',
  sit: 'Oturdun',
  standBlocked: 'Ancak sakin uçuşta ayağa kalkabilirsin',
};

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export function bankAngle(state: DragonState): number {
  _right.set(1, 0, 0).applyQuaternion(state.quaternion);
  _up.set(0, 1, 0).applyQuaternion(state.quaternion);
  return Math.atan2(-_right.y, _up.y);
}

function smooth01(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * The rider's own actions: petting (G held) and standing up on the saddle (T). Writes riderPet and riderStand each
 * frame, right before the bond behaviour (which owns the dragon's gaze, mood and reactions, phase 06) and the model
 * applying the pose; emits `maneuver` captions. The debug handle's forced values go on last (`applyOverrides`).
 */
export class RiderBehavior {
  private petT = 0;
  private petting = false;
  private lastPetEvent = -99;
  private standT = 0;
  private wantStand = false;
  private time = 0;
  private overrides: RiderDebugOverrides | null = null;
  private readonly handle: RiderDebugHandle | null = null;
  /** The bond's gaze level, for the debug state. */
  gazeLevel: () => number = () => 0;

  constructor(
    private readonly rig: DragonRigImpl,
    ctx: EngineContext,
  ) {
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
          this.rig.setDebugStrokePhase(null);
        },
        state: () => ({ pet: this.petT, petting: this.petting, stand: this.standT, wantStand: this.wantStand, gaze: this.gazeLevel() }),
      };
      (window as unknown as { __riderDebug?: RiderDebugHandle }).__riderDebug = this.handle;
    }
  }

  /** The petting key is honoured (the hand goes to the neck) and the smoothed 0..1 reach. */
  get isPetting(): boolean {
    return this.petting;
  }

  get petAmount(): number {
    return smooth01(this.petT);
  }

  get standing(): boolean {
    return this.standT >= 1;
  }

  /** The rider's hands are free enough to pat the neck (V): seated, not tucked, not petting already. */
  get canPat(): boolean {
    return this.standT < 0.15 && !this.petting;
  }

  update(dt: number, ctx: EngineContext): void {
    if (dt > 0) {
      this.time += dt;
      this.step(dt, ctx);
    }
    this.rig.setPose({ riderPet: smooth01(this.petT), riderStand: smooth01(this.standT) });
  }

  /** Debug overrides (screenshots): applied after the bond so they win. */
  applyOverrides(): void {
    const o = this.overrides;
    if (!o) {
      return;
    }
    const forced: Partial<DragonPose> = {};
    for (const key of CUE_KEYS) {
      const v = o[key];
      if (v !== undefined) {
        forced[key] = v;
      }
    }
    this.rig.setPose(forced);
    this.rig.setDebugStrokePhase(o.strokePhase ?? null);
    if (o.gazeSide !== undefined) {
      this.rig.setGazeSide(o.gazeSide, true);
    }
  }

  dispose(): void {
    const w = window as unknown as { __riderDebug?: RiderDebugHandle };
    if (this.handle && w.__riderDebug === this.handle) {
      delete w.__riderDebug;
    }
  }

  private step(dt: number, ctx: EngineContext): void {
    const state = ctx.services.tryGet('dragon');
    const pose = this.rig.getPose();
    const tuck = pose.riderTuck ?? 0;
    const busyHands = Math.max(pose.riderPoint ?? 0, pose.riderCheer ?? 0);
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

    // --- Petting (G held): the right hand goes to the neck in calm flight, hovering, perched or on the ground ---
    const petHeld = input.isHeld('pet');
    if (petHeld && this.wantStand) {
      this.sit(ctx);
    }
    const petOk = petHeld && !maneuvering && !firing && busyHands < 0.3 && this.standT < 0.15 && (calmFlight || grounded || mode === 'hovering');
    if (petOk && !this.petting && this.time - this.lastPetEvent > 3) {
      ctx.events.emit('maneuver', { id: 'pet', label: LABELS.pet });
      this.lastPetEvent = this.time;
    }
    this.petting = petOk;
    this.petT = THREE.MathUtils.clamp(this.petT + (this.petting ? dt / PET_IN_TIME : -dt / PET_OUT_TIME), 0, 1);
    this.standT = THREE.MathUtils.clamp(this.standT + (this.wantStand ? dt : -dt) / STAND_TIME, 0, 1);
  }

  private sit(ctx: EngineContext): void {
    if (!this.wantStand) {
      return;
    }
    this.wantStand = false;
    ctx.events.emit('maneuver', { id: 'sit', label: LABELS.sit });
  }
}
