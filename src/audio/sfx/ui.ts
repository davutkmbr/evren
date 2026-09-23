import { percEnv } from '../dsp/envelope';
import { Voice, type SfxEnv, placement } from './voice';

const DRY = placement({ reverb: 0, width: 0.5 });

/** Soft, short UI tick: damped sine + a tiny filtered noise transient. */
export function playUiClick(env: SfxEnv, when: number, volume: number): number {
  const v = new Voice(env, DRY, when, volume);
  const t = v.t;
  const o = v.osc('sine', 1850, 0, 0, 0.06);
  o.frequency.setValueAtTime(1850, t);
  o.frequency.exponentialRampToValueAtTime(1250, t + 0.03);
  const g = v.gain(0);
  percEnv(g.gain, t, 0.16, 0.0015, 0.045);
  o.connect(g);
  v.toInput(g);
  const n = v.noise(env.noise.white);
  const bp = v.filter('bandpass', 4200, 1.2);
  const ng = v.gain(0);
  percEnv(ng.gain, t, 0.18, 0.0005, 0.012);
  n.connect(bp).connect(ng);
  v.toInput(ng);
  v.end(0.09);
  return 0.09;
}

/**
 * Discovery chime: an airy open-fifth arpeggio (D5 A5 E6) on a soft struck-glass timbre
 * (partials 1, 2.01, 3.02, 4.23 with faster decay on the upper ones) over a gentle pad swell.
 */
export function playDiscover(env: SfxEnv, when: number, volume: number): number {
  const v = new Voice(env, placement({ reverb: 0.7, width: 0.8 }), when, volume);
  const t = v.t;
  const notes = [587.33, 880.0, 1318.51];
  const partials: Array<[number, number, number]> = [
    [1, 1, 2.6],
    [2.01, 0.32, 1.3],
    [3.02, 0.12, 0.8],
    [4.23, 0.06, 0.45],
  ];
  notes.forEach((f, i) => {
    const start = i * 0.13;
    const pan = (i - 1) * 0.45;
    for (const [ratio, amp, decay] of partials) {
      const o = v.osc('sine', f * ratio, start, (env.rng() - 0.5) * 6, decay + 0.1);
      const g = v.gain(0);
      percEnv(g.gain, t + start, amp * 0.1, 0.004, decay);
      o.connect(g);
      v.toInput(g, pan);
    }
  });
  const padNotes = [293.66, 440.0];
  for (const f of padNotes) {
    for (const det of [-7, 7]) {
      const o = v.osc('triangle', f, 0, det);
      const lp = v.filter('lowpass', 1400, 0.5);
      const g = v.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.022, t + 0.45);
      g.gain.setTargetAtTime(0, t + 0.9, 0.45);
      o.connect(lp).connect(g);
      v.toInput(g, det > 0 ? 0.5 : -0.5);
    }
  }
  v.end(3.2);
  return 3.2;
}
