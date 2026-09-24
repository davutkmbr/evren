import { clamp } from '../dsp/math';
import { Voice, type Placement, type SfxEnv } from './voice';

/**
 * One purr phrase (~2 s) of a content dragon: a deep, cat-like rumble (a low sawtooth pulsing at ~24 Hz through a
 * throat-like low-pass) that swells on the "exhale" and fades on the "inhale". Returns the duration in seconds.
 */
export function playPurr(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.2);
  const rng = env.rng;
  const v = new Voice(env, { ...place, reverb: place.reverb * 0.4 }, when, 1);
  const t = v.t;
  const dur = 1.9 + rng() * 0.4;
  const tone = v.osc('sawtooth', 34 + rng() * 6);
  const pulse = v.gain(0.5);
  const pulseOsc = v.osc('sine', 22 + rng() * 4);
  const pulseDepth = v.gain(0.5);
  pulseOsc.connect(pulseDepth).connect(pulse.gain);
  const lp = v.filter('lowpass', 320, 1.3);
  const body = v.noise(env.noise.brown);
  const bodyLp = v.filter('lowpass', 260, 0.8);
  const bodyGain = v.gain(0.6);
  const e = v.gain(0);
  e.gain.setValueAtTime(0, t);
  e.gain.linearRampToValueAtTime(0.9 * s, t + dur * 0.35);
  e.gain.linearRampToValueAtTime(0.5 * s, t + dur * 0.6);
  e.gain.linearRampToValueAtTime(0, t + dur);
  tone.connect(pulse).connect(lp).connect(e);
  body.connect(bodyLp).connect(bodyGain).connect(pulse);
  v.toInput(e);
  v.end(dur + 0.1);
  return dur;
}
