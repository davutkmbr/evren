import { clamp } from '../dsp/math';
import { expPoints, percEnv } from '../dsp/envelope';
import { Voice, type Placement, type SfxEnv } from './voice';

/**
 * The bronze knight statue of the Aya Yorgi moment (src/moments/aya-yorgi), synthesised: a rusty joint creak. A
 * stick-slip train (short noise impulses whose rate rises and falls, like a hinge dragged slowly) rings a small bank of
 * metal resonances, over a faint low groan of the bronze body.
 */

/** One creak: `strength` 0..1.5 (distance is in `place`). Returns the duration (s). */
export function playKnightCreak(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.5);
  const rng = env.rng;
  const v = new Voice(env, place, when, 1);
  const t = v.t;
  const dur = 0.55 + 0.35 * rng();
  // Metal modes of a joint plate (inharmonic, fairly narrow).
  const src = v.noise(env.noise.white);
  const drive = v.gain(0);
  src.connect(drive);
  const modes: Array<[number, number, number]> = [
    [620 + 60 * rng(), 14, 1],
    [1180 + 90 * rng(), 16, 0.7],
    [2230 + 150 * rng(), 18, 0.45],
  ];
  for (const [f, q, g] of modes) {
    const bp = v.filter('bandpass', f, q);
    // The pitch sags as the joint gives: friction lowers the modes a little over the creak.
    expPoints(bp.frequency, t, [
      [0, f],
      [dur, f * 0.93],
    ]);
    const lvl = v.gain(g * 2.4);
    drive.connect(bp).connect(lvl);
    v.toInput(lvl, (rng() - 0.5) * 0.2);
  }
  // Stick-slip impulses: 25 Hz rising to ~60 Hz and back, jittered.
  const r0 = 22 + 6 * rng();
  const r1 = 52 + 14 * rng();
  let at = 0;
  while (at < dur) {
    const k = at / dur;
    const rate = r0 + (r1 - r0) * Math.sin(Math.PI * k);
    const amp = s * (0.7 + 0.3 * rng()) * (k < 0.08 ? k / 0.08 : k > 0.85 ? (1 - k) / 0.15 : 1);
    percEnv(drive.gain, t + at, amp, 0.0008, 0.006 + 0.004 * rng());
    at += (1 / rate) * (0.85 + 0.3 * rng());
  }
  // The body's faint groan.
  const groan = v.osc('triangle', 92 + 14 * rng());
  expPoints(groan.frequency, t, [
    [0, groan.frequency.value],
    [dur, groan.frequency.value * 0.88],
  ]);
  const ge = v.gain(0);
  percEnv(ge.gain, t, 0.08 * s, dur * 0.3, dur * 0.7);
  groan.connect(ge);
  v.toInput(ge);
  v.end(dur + 0.25);
  return dur;
}
