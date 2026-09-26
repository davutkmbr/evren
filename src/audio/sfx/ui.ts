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

/** Chain-link tones (Hz): a major pentatonic from D5 up, one step per link (the fifth link and on stay on top). */
const CHAIN_NOTES = [587.33, 659.25, 739.99, 880.0, 987.77];

/**
 * A chain link landed (phase 20 chain bursts): one soft struck-glass tone, a step higher for every link of the chain,
 * so a growing chain is heard as a rising line. Short and quiet: it plays often in a race.
 */
export function playChainCue(env: SfxEnv, when: number, volume: number, link: number): number {
  const v = new Voice(env, placement({ reverb: 0.35, width: 0.6 }), when, volume);
  const t = v.t;
  const f = CHAIN_NOTES[Math.max(0, Math.min(CHAIN_NOTES.length - 1, link - 1))];
  const partials: Array<[number, number, number]> = [
    [1, 1, 0.55],
    [2.01, 0.28, 0.3],
    [3.02, 0.09, 0.18],
  ];
  for (const [ratio, amp, decay] of partials) {
    const o = v.osc('sine', f * ratio, 0, 0, decay + 0.05);
    const g = v.gain(0);
    percEnv(g.gain, t, 0.5 * amp, 0.004, decay);
    o.connect(g);
    v.toInput(g);
  }
  v.end(0.7);
  return 0.7;
}

/** Which harmony term peaked in a "Kusursuz" moment (flow, phase 20). */
export type FlowMomentKind = 'rhythm' | 'energy' | 'handover' | 'world';

/** One struck-glass note (partials 1, 2.01, 3.02) at `at` seconds into the voice. */
function glassNote(v: Voice, t: number, at: number, freq: number, peak: number, decay: number, pan = 0): void {
  for (const [ratio, amp, d] of [
    [1, 1, decay],
    [2.01, 0.3, decay * 0.55],
    [3.02, 0.1, decay * 0.3],
  ] as const) {
    const o = v.osc('sine', freq * ratio, at, 0, d + 0.05);
    const g = v.gain(0);
    percEnv(g.gain, t + at, peak * amp, 0.004, d);
    o.connect(g);
    v.toInput(g, pan);
  }
}

/**
 * A "Kusursuz" moment (flow, phase 20): a short, airy figure in D major above the chain-link tones, one shape per
 * harmony term so the player learns what was perfect:
 *   rhythm    two quick bells on the beat (A5, D6)
 *   energy    a soft rising glide D5 → A5 with a bell on top (energy kept)
 *   handover  F♯5 and A5 together, D6 after them (a seamless handover resolving)
 *   world     an open fifth D5 + A5 with a breath of air (the world used: low, tight)
 * Returns the duration in seconds.
 */
export function playFlowMoment(env: SfxEnv, when: number, volume: number, kind: FlowMomentKind): number {
  const v = new Voice(env, placement({ reverb: 0.6, width: 0.8 }), when, volume);
  const t = v.t;
  switch (kind) {
    case 'rhythm':
      glassNote(v, t, 0, 880, 0.45, 0.45, -0.15);
      glassNote(v, t, 0.11, 1174.66, 0.4, 0.7, 0.15);
      break;
    case 'energy': {
      const o = v.osc('sine', 587.33, 0, 0, 0.9);
      o.frequency.setValueAtTime(587.33, t);
      o.frequency.exponentialRampToValueAtTime(880, t + 0.32);
      const g = v.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.28, t + 0.12);
      g.gain.setTargetAtTime(0, t + 0.36, 0.12);
      o.connect(g);
      v.toInput(g);
      glassNote(v, t, 0.3, 1760, 0.18, 0.5);
      break;
    }
    case 'handover':
      glassNote(v, t, 0, 739.99, 0.3, 0.55, -0.2);
      glassNote(v, t, 0, 880, 0.3, 0.55, 0.2);
      glassNote(v, t, 0.13, 1174.66, 0.38, 0.75);
      break;
    case 'world': {
      for (const [f, pan] of [
        [587.33, -0.25],
        [880, 0.25],
      ] as const) {
        const o = v.osc('sine', f, 0, 0, 1.1);
        const g = v.gain(0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.22, t + 0.08);
        g.gain.setTargetAtTime(0, t + 0.15, 0.22);
        o.connect(g);
        v.toInput(g, pan);
      }
      const air = v.noise(env.noise.pink);
      const bp = v.filter('bandpass', 2400, 0.8);
      const ag = v.gain(0);
      ag.gain.setValueAtTime(0, t);
      ag.gain.linearRampToValueAtTime(0.06, t + 0.1);
      ag.gain.setTargetAtTime(0, t + 0.2, 0.15);
      air.connect(bp).connect(ag);
      v.toInput(ag);
      break;
    }
  }
  v.end(1.2);
  return 1.2;
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
