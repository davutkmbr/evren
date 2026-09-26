/**
 * Perceived speed ("hız hissi", phase 20 stage D, owner feedback on races): how strongly the speed effects play (camera
 * FOV and kick, high-speed shake, screen-edge wind streaks, spray, wind audio, burst accents). One factor for every
 * consumer, the product of
 *
 *   - the player's setting (Ayarlar → Görüntü → Hareket efektleri: Tam / Azaltılmış / Kapalı; accessibility for motion
 *     sensitivity), stored per viewer in localStorage (every access guarded), and
 *   - the context: full strength in a race and at high flow; in free flight the effects stay subtle (the game's calm
 *     direction) and grow with flow.
 *
 * Pure: no three.js, no DOM beyond the guarded storage.
 */
import type { DragonState } from './contracts';
import { clamp, smoothstep } from './math/noise';

export type MotionEffects = 'full' | 'reduced' | 'off';

const KEY = 'evren.ui.motion.v1';

/** Setting → strength. */
export const MOTION_EFFECTS_SCALE: Readonly<Record<MotionEffects, number>> = { full: 1, reduced: 0.4, off: 0 };

export const SPEED_FEEL = {
  /** Free flight without flow: this share of the full effects; full from flowFull. */
  freeFlight: 0.35,
  flowFrom: 0.5,
  flowFull: 0.95,
  /** Airspeed (m/s) at which the speed effects start and are full (races run 45–75 m/s). */
  speedFrom: 32,
  speedFull: 72,
} as const;

let setting: MotionEffects = load();
const listeners = new Set<(s: MotionEffects) => void>();

function load(): MotionEffects {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    return raw === 'full' || raw === 'reduced' || raw === 'off' ? raw : 'full';
  } catch {
    return 'full';
  }
}

export function motionEffects(): MotionEffects {
  return setting;
}

export function setMotionEffects(value: MotionEffects): void {
  setting = value;
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    /* storage unavailable (private window, blocked site data) */
  }
  for (const l of listeners) {
    l(value);
  }
}

export function onMotionEffects(listener: (s: MotionEffects) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Context strength 0..1: 1 in a race, subtle in free flight, growing with flow. */
export function feelContext(racing: boolean, flow: number): number {
  if (racing) {
    return 1;
  }
  return SPEED_FEEL.freeFlight + (1 - SPEED_FEEL.freeFlight) * smoothstep(SPEED_FEEL.flowFrom, SPEED_FEEL.flowFull, clamp(flow, 0, 1));
}

/** The factor every speed effect is multiplied by (setting × context), 0..1. */
export function speedFeel(dragon: DragonState | null | undefined): number {
  if (!dragon) {
    return 0;
  }
  return MOTION_EFFECTS_SCALE[setting] * feelContext(!!dragon.racing, dragon.flow ?? 0);
}

/** 0..1: how fast the dragon is for the speed effects (airspeed from SPEED_FEEL.speedFrom to speedFull). */
export function speedAmount(airspeed: number): number {
  return smoothstep(SPEED_FEEL.speedFrom, SPEED_FEEL.speedFull, airspeed);
}
