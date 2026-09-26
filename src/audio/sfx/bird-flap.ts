import { clamp } from '../dsp/math';
import { percEnv } from '../dsp/envelope';
import { Voice, type Placement, type SfxEnv } from './voice';

/** Level of a gull's wing beats (quiet: heard only close by). */
const BIRD_FLAP_LEVEL = 0.35;

/**
 * Two or three wing beats of a gull-sized bird (src/moments: the ferry gulls), synthesized: each stroke a soft
 * feathered "fwup" (band-passed pink noise, fast attack, short decay, brighter than the dragon's leather membrane) with
 * a faint low push. `strength` 0..1. Returns the duration (s).
 */
export function playBirdFlap(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1);
  const rng = env.rng;
  const v = new Voice(env, place, when, BIRD_FLAP_LEVEL);
  const strokes = rng() < 0.5 ? 2 : 3;
  const period = 0.34 + rng() * 0.06;
  for (let k = 0; k < strokes; k++) {
    const t = k * period;
    const fade = 1 - k * 0.22;
    const src = v.noise(env.noise.pink, t);
    const bp = v.filter('bandpass', 900 + rng() * 350, 0.9);
    const g = v.gain(0);
    percEnv(g.gain, v.t + t, 0.55 * s * fade, 0.018, 0.1);
    src.connect(bp).connect(g);
    v.toInput(g, (rng() - 0.5) * 0.3);
    const push = v.noise(env.noise.pink, t + 0.01);
    const lp = v.filter('bandpass', 260, 0.7);
    const pg = v.gain(0);
    percEnv(pg.gain, v.t + t + 0.01, 0.35 * s * fade, 0.03, 0.16);
    push.connect(lp).connect(pg);
    v.toInput(pg);
  }
  const duration = strokes * period + 0.25;
  v.end(duration);
  return duration;
}
