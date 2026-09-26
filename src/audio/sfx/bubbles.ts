import { clamp } from '../dsp/math';
import { Voice, type Placement, type SfxEnv } from './voice';

/**
 * A puff of bubbles from the dragon's nostrils under water: a few resonant "bloops" (a sine whose pitch rises as the
 * bubble's resonance does, Minnaert: bigger bubble = lower note) scattered over ~0.3 s, plus a faint gurgle. Every cue
 * differs in count, timing, size and pitch; the level is kept low (it repeats every half second). `under` = the
 * listener is under water too (full band; from above only the higher, fainter pops reach the ear).
 */
export function playBubbles(env: SfxEnv, when: number, strength: number, place: Placement, under: boolean): number {
  const rng = env.rng;
  const s = clamp(strength, 0.2, 1.5);
  const v = new Voice(env, { ...place, reverb: place.reverb * 0.3 }, when, 0.5 * s);
  const t = v.t;
  const count = 2 + Math.floor(rng() * 4);
  let end = 0.2;
  for (let i = 0; i < count; i++) {
    const start = Math.pow(rng(), 1.4) * 0.32;
    // Radius ~1.5-6 mm: 550-2200 Hz; big nostril bubbles dominate, the odd small one ticks higher.
    const f0 = (under ? 480 : 900) + Math.pow(rng(), 1.8) * (under ? 1300 : 1700);
    const len = 0.035 + rng() * 0.07;
    const o = v.osc('sine', f0, start, 0, len + 0.03);
    o.frequency.setValueAtTime(f0, t + start);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.35 + rng() * 0.6), t + start + len);
    const g = v.gain(0);
    const peak = (0.25 + 0.75 * rng()) / Math.sqrt(count);
    g.gain.setValueAtTime(0, t + start);
    g.gain.linearRampToValueAtTime(peak, t + start + 0.004);
    g.gain.setTargetAtTime(0, t + start + 0.006, len / 3);
    o.connect(g);
    v.toInput(g, (rng() - 0.5) * 0.6);
    end = Math.max(end, start + len + 0.06);
  }
  // Gurgle: a short band of noise under the bloops (water displaced around the head).
  const gurgle = v.noise(env.noise.pink, 0, 0.9 + rng() * 0.2);
  const bp = v.filter('bandpass', under ? 320 + rng() * 160 : 900, 1.4);
  const ge = v.gain(0);
  ge.gain.setValueAtTime(0, t);
  ge.gain.linearRampToValueAtTime(0.12, t + 0.03);
  ge.gain.setTargetAtTime(0, t + 0.08, 0.06);
  gurgle.connect(bp).connect(ge);
  v.toInput(ge);
  v.end(end + 0.1);
  return end;
}
