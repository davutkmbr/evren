/**
 * Perceived speed for the flight cameras (phase 20, owner feedback on races): how much the chase and rider cameras add
 * on top of their own speed framing. Everything is multiplied by the speed feel (core/speed-feel.ts: the player's
 * motion setting × full in a race and at high flow, subtle in free flight).
 */
import { speedAmount, speedFeel } from '../core/speed-feel';
import { clamp } from './math/scalar';
import type { DragonTracker } from './tracker';

export const CAMERA_FEEL = {
  /** Extra FOV (deg) at full speed feel and speed, chase / rider camera. */
  fov: 6,
  povFov: 4,
  /** FOV kick (deg) at the peak of a chain burst's push, chase / rider camera. */
  kick: 5,
  povKick: 3.5,
  /** Speed effect (radial blur + edge streaks, 0..1) at full speed, and on top of it at a burst's peak. */
  speedFx: 0.75,
  burstFx: 0.35,
  /** Shake (CameraShake.buffet) at full speed, and on top of it at a burst's peak. */
  buffet: 0.035,
  burstBuffet: 0.03,
} as const;

export interface CameraFeel {
  /** Speed feel 0..1 (setting × context). */
  feel: number;
  /** Speed 0..1 for the effects. */
  speed: number;
  /** The running burst's push 0..1 (smooth envelope). */
  burst: number;
}

const out: CameraFeel = { feel: 0, speed: 0, burst: 0 };

export function cameraFeel(t: DragonTracker): CameraFeel {
  const d = t.available ? t.dragon : null;
  out.feel = speedFeel(d);
  out.speed = speedAmount(t.speed);
  out.burst = clamp(d?.burst ?? 0, 0, 1);
  return out;
}
