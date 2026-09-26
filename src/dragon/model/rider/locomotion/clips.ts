/**
 * The on-foot clips authored by tools/humans/anim.py (CLIPS there): duration (s), looping, and the ground speed the
 * clip's planted feet slide at (m/s; the body must travel at that speed for the feet to stay put).
 */
export interface ClipInfo {
  duration: number;
  loop: boolean;
  speed: number;
}

export const CLIPS: Record<string, ClipInfo> = {
  idle: { duration: 4.0, loop: true, speed: 0 },
  walk: { duration: 1.08, loop: true, speed: 1.45 },
  run: { duration: 0.7, loop: true, speed: 5.2 },
  crouch_idle: { duration: 3.0, loop: true, speed: 0 },
  crouch_walk: { duration: 1.3, loop: true, speed: 1.0 },
  run_stop: { duration: 0.9, loop: false, speed: 0 },
  jump_start: { duration: 0.28, loop: false, speed: 0 },
  jump_rise: { duration: 1.0, loop: true, speed: 0 },
  jump_fall: { duration: 1.0, loop: true, speed: 0 },
  jump_land: { duration: 0.55, loop: false, speed: 0 },
  glide: { duration: 2.4, loop: true, speed: 0 },
};

/** run_stop: the body brakes from the run's speed to rest in this time (s), speed falling as (1 - t/T)². */
export const STOP_BRAKE = 0.45;

/** Distance covered in one gait cycle (m) = speed × duration. */
export function cycleLength(name: string): number {
  const c = CLIPS[name];
  return c.speed * c.duration;
}
