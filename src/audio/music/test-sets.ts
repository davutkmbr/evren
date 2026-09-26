/**
 * DEV-ONLY procedural test sets for the adaptive music (NOT shipped as files, NOT music of the game).
 *
 * No approved music exists yet, so `?music=test` (any build) or `window.__evrenMusic.useTestSets()` renders three
 * tiny sets at runtime in an OfflineAudioContext — simple sine / pluck / pad stems on the same grid — so the owner can
 * hear the stems breathe with the flight before real stems arrive. Without that switch this module is never loaded
 * (the controller imports it dynamically).
 *
 * Each stem is rendered one loop long plus a tail, and the tail is folded back onto the start so notes ringing over
 * the loop point continue seamlessly on the next pass.
 *
 * The same switch also brings test PHRASES for sprinkle mode (a breathy ney, a few kanun plucks, a low tanbur at
 * night...) and one gentle test MOMENT PIECE (ney over a soft pad) for moments, rendered once each on first use.
 */
import { loopSeconds, type MusicPhraseDef, type MusicSetDef, type StemRole, type StingerKind } from './manifest';
import type { MusicBuffers } from './player';

export interface TestNote {
  /** Start (s from the loop start) and length (s). */
  t: number;
  dur: number;
  midi: number;
  vel: number;
}

type Voice = 'piano' | 'pad' | 'pluck' | 'shaker' | 'ney' | 'kanun' | 'air' | 'bell' | 'tanbur';

interface TestSetSpec {
  def: MusicSetDef;
  /** Chords per two bars, as MIDI notes (root first). */
  chords: number[][];
  /** Melody scale degrees of the colour instrument (MIDI), one phrase over the loop. */
  melody: Array<[number, number, number]>; // [beat, beats, midi]
  colourVoice: Voice;
  motionEvery: number; // beats between plucks
}

const credit = { title: 'Test seti (geliştirici)', author: 'Seventeen Skies (procedural dev test)', licence: 'original' as const };
const src = (id: string, r: string): string[] => [`dev-test/${id}/${r}.opus`];
const stems = (id: string): MusicSetDef['stems'] => ({
  base: { src: src(id, 'base') },
  strings: { src: src(id, 'strings'), gain: 0.8 },
  motion: { src: src(id, 'motion'), gain: 0.7 },
  colour: { src: src(id, 'colour'), gain: 0.8 },
  air: { src: src(id, 'air'), gain: 0.7 },
});

const SPECS: TestSetSpec[] = [
  {
    def: { id: 'test-sabah', bpm: 84, beatsPerBar: 4, bars: 8, phraseBars: 4, key: 'D major', tags: ['day', 'flight', 'calm', 'water'], stems: stems('test-sabah'), credit, approvedOn: '2026-09-26' },
    chords: [
      [50, 62, 66, 69],
      [47, 62, 66, 71],
      [43, 62, 67, 71],
      [45, 61, 64, 69],
    ],
    melody: [
      [0, 3, 78],
      [3, 1, 76],
      [4, 2, 74],
      [6, 2, 71],
      [8, 3, 74],
      [11, 1, 76],
      [12, 4, 73],
      [16, 2, 74],
      [18, 2, 78],
      [20, 4, 81],
      [24, 3, 79],
      [27, 1, 78],
      [28, 4, 76],
    ],
    colourVoice: 'kanun',
    motionEvery: 0.5,
  },
  {
    // A hicaz-coloured night set in 3/4 (A, B♭, C♯, D, E, F, G).
    def: { id: 'test-gece', bpm: 66, beatsPerBar: 3, bars: 8, phraseBars: 4, key: 'makam:hicaz (A)', tags: ['night', 'calm', 'perch'], stems: stems('test-gece'), credit, approvedOn: '2026-09-26' },
    chords: [
      [45, 57, 60, 64],
      [50, 57, 62, 65],
      [46, 58, 62, 65],
      [40, 56, 59, 64],
    ],
    melody: [
      [0, 2, 69],
      [2, 1, 70],
      [3, 3, 73],
      [6, 2, 74],
      [8, 1, 73],
      [9, 3, 70],
      [12, 2, 69],
      [14, 1, 67],
      [15, 3, 65],
      [18, 3, 64],
      [21, 3, 69],
    ],
    colourVoice: 'ney',
    motionEvery: 1,
  },
  {
    def: {
      id: 'test-yaris',
      bpm: 112,
      beatsPerBar: 4,
      bars: 8,
      phraseBars: 4,
      key: 'E minor',
      tags: ['race', 'flight', 'day'],
      stems: stems('test-yaris'),
      stingers: { intro: { src: src('test-yaris', 'intro'), bars: 1 }, go: { src: src('test-yaris', 'go') }, finish: { src: src('test-yaris', 'finish'), bars: 2 } },
      credit,
      approvedOn: '2026-09-26',
    },
    chords: [
      [40, 64, 67, 71],
      [48, 64, 67, 72],
      [43, 62, 67, 71],
      [47, 63, 66, 71],
    ],
    melody: [
      [0, 1, 76],
      [1, 1, 79],
      [2, 2, 83],
      [4, 1, 81],
      [5, 1, 79],
      [6, 2, 76],
      [8, 1, 79],
      [9, 1, 81],
      [10, 2, 84],
      [12, 4, 83],
      [16, 1, 83],
      [17, 1, 81],
      [18, 2, 79],
      [20, 2, 78],
      [22, 2, 75],
      [24, 4, 76],
      [28, 4, 71],
    ],
    colourVoice: 'kanun',
    motionEvery: 0.5,
  },
];

/** The test sets' manifest entries (valid MusicSetDefs; their `src` files do not exist and are never fetched). */
export const TEST_SETS: readonly MusicSetDef[] = SPECS.map((s) => s.def);

/* ------------------------------------------------------------------ */
/* Test phrases (sprinkle mode) and the test moment piece               */
/* ------------------------------------------------------------------ */

interface TestPhraseSpec {
  def: MusicPhraseDef;
  /** Layers rendered into the one-shot: a voice and its notes ([start s, length s, midi, velocity]). */
  layers: Array<{ voice: Voice; notes: Array<[number, number, number, number]> }>;
}

const phraseSrc = (id: string): string[] => [`dev-test/phrases/${id}.opus`];
const phraseCredit = { title: 'Test cümlesi (geliştirici)', author: 'Seventeen Skies (procedural dev test)', licence: 'original' as const };

const PHRASE_SPECS: TestPhraseSpec[] = [
  {
    // A soft breathy ney by day: a long tone, a small turn, a fall (D uşşak colour).
    def: { id: 'test-ney-nefes', src: phraseSrc('test-ney-nefes'), durationSec: 22, family: 'ney', tags: ['day', 'dawn', 'calm', 'water'], credit: phraseCredit, approvedOn: '2026-09-26' },
    layers: [
      {
        voice: 'ney',
        notes: [
          [1.5, 4.2, 74, 0.8],
          [6, 1.1, 76, 0.6],
          [7.2, 1, 77, 0.55],
          [8.3, 4.5, 74, 0.7],
          [13.4, 4.5, 69, 0.6],
        ],
      },
    ],
  },
  {
    // A few kanun notes over the water: two short falling groups, then silence.
    def: { id: 'test-kanun-damla', src: phraseSrc('test-kanun-damla'), durationSec: 20, family: 'kanun', tags: ['day', 'water', 'flight'], credit: phraseCredit, approvedOn: '2026-09-26' },
    layers: [
      {
        voice: 'kanun',
        notes: [
          [1.2, 0.45, 81, 0.7],
          [1.65, 0.45, 79, 0.6],
          [2.1, 1.6, 76, 0.7],
          [5.2, 0.45, 74, 0.6],
          [5.65, 0.45, 76, 0.6],
          [6.1, 2.2, 78, 0.7],
          [10.5, 0.4, 81, 0.5],
          [10.9, 0.4, 79, 0.5],
          [11.3, 2.6, 74, 0.6],
        ],
      },
    ],
  },
  {
    // A low tanbur at night: four slow notes that ring out.
    def: { id: 'test-tanbur-gece', src: phraseSrc('test-tanbur-gece'), durationSec: 24, family: 'tanbur', tags: ['night', 'calm', 'perch'], credit: phraseCredit, approvedOn: '2026-09-26' },
    layers: [
      {
        voice: 'tanbur',
        notes: [
          [1.5, 3, 45, 0.8],
          [5, 2, 52, 0.6],
          [7.4, 4, 50, 0.7],
          [12.6, 5, 45, 0.7],
        ],
      },
    ],
  },
  {
    // A lower, darker ney at night or in fog (hicaz turn: A, B♭, C♯).
    def: { id: 'test-ney-gece', src: phraseSrc('test-ney-gece'), durationSec: 24, family: 'ney', tags: ['night', 'fog', 'water'], credit: phraseCredit, approvedOn: '2026-09-26' },
    layers: [
      {
        voice: 'ney',
        notes: [
          [2, 4.5, 69, 0.7],
          [6.8, 1.2, 70, 0.55],
          [8.1, 2.6, 73, 0.6],
          [11, 5.5, 69, 0.6],
        ],
      },
    ],
  },
];

const MOMENT_SPECS: TestPhraseSpec[] = [
  {
    // A gentle moment piece: a slow ney line over a soft pad (A uşşak / minor), 48 s with a quiet ending.
    def: {
      id: 'test-an-ney',
      role: 'moment',
      src: [`dev-test/moments/test-an-ney.opus`],
      durationSec: 48,
      family: 'ney',
      tags: ['poem', 'nostalgic', 'sea', 'tender'],
      credit: { title: 'Test an müziği (geliştirici)', author: 'Seventeen Skies (procedural dev test)', licence: 'original' },
      approvedOn: '2026-09-26',
    },
    layers: [
      {
        voice: 'pad',
        notes: [
          ...[57, 60, 64].map((m): [number, number, number, number] => [0.5, 10, m, 0.55]),
          ...[53, 57, 60].map((m): [number, number, number, number] => [10.5, 10, m, 0.5]),
          ...[55, 59, 62].map((m): [number, number, number, number] => [20.5, 10, m, 0.5]),
          ...[52, 57, 60].map((m): [number, number, number, number] => [30.5, 12, m, 0.45]),
        ],
      },
      {
        voice: 'ney',
        notes: [
          [3, 3.5, 69, 0.6],
          [6.8, 1.2, 71, 0.5],
          [8.1, 2.4, 72, 0.55],
          [11.5, 3, 74, 0.6],
          [14.8, 1.2, 72, 0.5],
          [16.1, 3.2, 71, 0.55],
          [21, 2.5, 67, 0.5],
          [23.8, 1.2, 69, 0.5],
          [25.2, 4, 71, 0.55],
          [31, 2.2, 72, 0.5],
          [33.4, 1.4, 71, 0.45],
          [35, 6, 69, 0.5],
        ],
      },
    ],
  },
];

/** The test phrases (valid sprinkle phrases; their files do not exist and are never fetched). */
export const TEST_PHRASES: readonly MusicPhraseDef[] = PHRASE_SPECS.map((s) => s.def);
/** The test moment pieces (valid `role: "moment"` phrases). */
export const TEST_MOMENT_PIECES: readonly MusicPhraseDef[] = MOMENT_SPECS.map((s) => s.def);

/** The notes of a test phrase or moment piece, flattened (pure: the headless check verifies they end before the tail). */
export function testPhraseNotes(id: string): TestNote[] {
  const spec = [...PHRASE_SPECS, ...MOMENT_SPECS].find((s) => s.def.id === id);
  if (!spec) {
    throw new Error(`no test phrase ${id}`);
  }
  return spec.layers.flatMap((l) => l.notes.map(([t, dur, midi, vel]) => ({ t, dur, midi, vel })));
}

/** The notes of every stem of a test set (pure: the headless check verifies they fit the loop). */
export function testScore(id: string): Record<StemRole, TestNote[]> {
  const spec = SPECS.find((s) => s.def.id === id);
  if (!spec) {
    throw new Error(`no test set ${id}`);
  }
  const d = spec.def;
  const beat = 60 / d.bpm;
  const bar = beat * d.beatsPerBar;
  const out: Record<StemRole, TestNote[]> = { base: [], strings: [], motion: [], colour: [], air: [] };
  spec.chords.forEach((chord, ci) => {
    const t0 = ci * 2 * bar;
    // base: arpeggiated soft piano, one note per beat (bass on the downbeat).
    for (let b = 0; b < d.beatsPerBar * 2; b++) {
      const midi = b % d.beatsPerBar === 0 ? chord[0] : chord[1 + ((b + ci) % 3)];
      out.base.push({ t: t0 + b * beat, dur: beat * 1.8, midi, vel: b % d.beatsPerBar === 0 ? 0.9 : 0.55 });
    }
    // strings: the chord held over two bars.
    for (const m of chord.slice(1)) {
      out.strings.push({ t: t0, dur: 2 * bar, midi: m - 12, vel: 0.5 });
    }
    // motion: pizzicato on the chord tones + a shaker (midi 0) between.
    for (let x = 0; x < d.beatsPerBar * 2; x += spec.motionEvery) {
      const onBeat = Math.abs(x - Math.round(x)) < 1e-6;
      out.motion.push({ t: t0 + x * beat, dur: 0.2, midi: onBeat ? chord[1 + (Math.round(x) % 3)] : 0, vel: onBeat ? 0.6 : 0.35 });
    }
    // air: a high open fifth, very soft.
    out.air.push({ t: t0, dur: 2 * bar, midi: chord[0] + 24, vel: 0.35 }, { t: t0, dur: 2 * bar, midi: chord[0] + 31, vel: 0.25 });
  });
  for (const [b, len, midi] of spec.melody) {
    out.colour.push({ t: b * beat, dur: len * beat, midi, vel: 0.6 });
  }
  const loop = loopSeconds(d);
  for (const r of Object.keys(out) as StemRole[]) {
    out[r] = out[r].filter((n) => n.t < loop - 1e-6);
  }
  return out;
}

const VOICE: Record<StemRole, (spec: TestSetSpec) => Voice> = {
  base: () => 'piano',
  strings: () => 'pad',
  motion: () => 'pluck',
  colour: (s) => s.colourVoice,
  air: () => 'air',
};

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const RATE = 22050;
const TAIL_S = 3;

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (s / 0x7fffffff) * 2 - 1;
  }
  return b;
}

function playNote(ctx: OfflineAudioContext, out: AudioNode, voice: Voice, n: TestNote, noise: AudioBuffer): void {
  const t = n.t;
  const f = mtof(n.midi);
  const env = ctx.createGain();
  env.connect(out);
  const g = env.gain;
  const osc = (type: OscillatorType, freq: number, level: number, detune = 0): OscillatorNode => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const lg = ctx.createGain();
    lg.gain.value = level;
    o.connect(lg).connect(env);
    o.start(t);
    o.stop(t + n.dur + 2.5);
    return o;
  };
  switch (voice) {
    case 'piano':
      osc('sine', f, 1);
      osc('sine', f * 2, 0.25);
      osc('sine', f * 3, 0.08);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(0.28 * n.vel, t + 0.008);
      g.setTargetAtTime(0, t + 0.01, 0.55);
      break;
    case 'pad': {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100;
      env.disconnect();
      env.connect(lp).connect(out);
      osc('sawtooth', f, 0.3, -7);
      osc('sawtooth', f, 0.3, 7);
      osc('triangle', f, 0.4);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(0.09 * n.vel, t + 0.9);
      g.setValueAtTime(0.09 * n.vel, t + n.dur - 0.2);
      g.setTargetAtTime(0, t + n.dur - 0.2, 0.4);
      break;
    }
    case 'pluck':
      if (n.midi === 0) {
        // Shaker: a short band-passed noise tick.
        const s = ctx.createBufferSource();
        s.buffer = noise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'highpass';
        bp.frequency.value = 5000;
        s.connect(bp).connect(env);
        s.start(t, (n.t * 7.3) % 1, 0.12);
        g.setValueAtTime(0, t);
        g.linearRampToValueAtTime(0.12 * n.vel, t + 0.004);
        g.setTargetAtTime(0, t + 0.005, 0.03);
      } else {
        osc('triangle', f, 1);
        osc('sine', f * 2, 0.3);
        g.setValueAtTime(0, t);
        g.linearRampToValueAtTime(0.25 * n.vel, t + 0.004);
        g.setTargetAtTime(0, t + 0.005, 0.09);
      }
      break;
    case 'kanun': {
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = f * 2;
      hp.Q.value = 0.7;
      env.disconnect();
      env.connect(hp).connect(out);
      osc('sawtooth', f, 0.6);
      osc('triangle', f * 2, 0.4);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(0.22 * n.vel, t + 0.003);
      g.setTargetAtTime(0, t + 0.004, 0.35);
      // A soft tremolo re-pluck on long notes, like a kanun's repeated strokes.
      if (n.dur > 0.9) {
        for (let k = 1; k * 0.18 < n.dur - 0.2; k++) {
          g.setValueAtTime(0.1 * n.vel, t + k * 0.18);
          g.setTargetAtTime(0, t + k * 0.18 + 0.002, 0.1);
        }
      }
      break;
    }
    case 'ney': {
      const o = osc('sine', f, 0.9);
      osc('triangle', f, 0.15);
      const vib = ctx.createOscillator();
      vib.frequency.value = 5;
      const depth = ctx.createGain();
      depth.gain.value = f * 0.006;
      vib.connect(depth).connect(o.frequency);
      vib.start(t + 0.25);
      vib.stop(t + n.dur + 1);
      const breath = ctx.createBufferSource();
      breath.buffer = noise;
      breath.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 4;
      const bg = ctx.createGain();
      bg.gain.value = 0.35;
      breath.connect(bp).connect(bg).connect(env);
      breath.start(t, 0, n.dur + 0.6);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(0.16 * n.vel, t + 0.18);
      g.setValueAtTime(0.16 * n.vel, t + n.dur - 0.1);
      g.setTargetAtTime(0, t + n.dur - 0.1, 0.15);
      break;
    }
    case 'air': {
      osc('sine', f, 0.6);
      osc('sine', f * 1.003, 0.4);
      const wind = ctx.createBufferSource();
      wind.buffer = noise;
      wind.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'bandpass';
      lp.frequency.value = 900;
      lp.Q.value = 0.5;
      const wg = ctx.createGain();
      wg.gain.value = 0.25;
      wind.connect(lp).connect(wg).connect(env);
      wind.start(t, 0, n.dur + 1);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(0.06 * n.vel, t + n.dur * 0.45);
      g.linearRampToValueAtTime(0, t + n.dur + 0.8);
      break;
    }
    case 'tanbur': {
      // A long-necked lute: a bright pluck through a low-pass that closes as the string rings out.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(f * 8, t);
      lp.frequency.setTargetAtTime(f * 2.5, t + 0.01, 0.4);
      env.disconnect();
      env.connect(lp).connect(out);
      osc('sawtooth', f, 0.6);
      osc('triangle', f * 2, 0.25, 4);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(0.3 * n.vel, t + 0.004);
      g.setTargetAtTime(0, t + 0.005, Math.min(1.4, n.dur * 0.5));
      break;
    }
    case 'bell':
      osc('sine', f, 1);
      osc('sine', f * 2.76, 0.4);
      osc('sine', f * 5.4, 0.15);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(0.25 * n.vel, t + 0.005);
      g.setTargetAtTime(0, t + 0.006, 0.6);
      break;
  }
}

async function renderNotes(voice: Voice, notes: readonly TestNote[], seconds: number, loop: boolean): Promise<AudioBuffer> {
  const total = seconds + (loop ? TAIL_S : 2.5);
  const ctx = new OfflineAudioContext(1, Math.ceil(total * RATE), RATE);
  const noise = noiseBuffer(ctx, 2);
  const bus = ctx.createGain();
  bus.connect(ctx.destination);
  for (const n of notes) {
    playNote(ctx, bus, voice, n, noise);
  }
  const rendered = await ctx.startRendering();
  if (!loop) {
    return rendered;
  }
  // Fold the tail onto the start: a seamless loop of exactly `seconds`.
  const len = Math.round(seconds * RATE);
  const out = new AudioBuffer({ length: len, sampleRate: RATE, numberOfChannels: 1 });
  const src = rendered.getChannelData(0);
  const dst = out.getChannelData(0);
  for (let i = 0; i < len; i++) {
    dst[i] = src[i] + (i + len < src.length ? src[i + len] : 0);
  }
  return out;
}

/**
 * Renders a test phrase or moment piece: every layer into one buffer exactly `durationSec` long (the notes end a few
 * seconds before the end, so the file has its own silent tail like a real phrase).
 */
export async function renderTestPhrase(phrase: MusicPhraseDef): Promise<AudioBuffer> {
  const spec = [...PHRASE_SPECS, ...MOMENT_SPECS].find((s) => s.def.id === phrase.id);
  if (!spec) {
    throw new Error(`no test phrase ${phrase.id}`);
  }
  const ctx = new OfflineAudioContext(1, Math.round(phrase.durationSec * RATE), RATE);
  const noise = noiseBuffer(ctx, 2);
  const bus = ctx.createGain();
  bus.gain.value = 1.4;
  bus.connect(ctx.destination);
  for (const layer of spec.layers) {
    for (const [t, dur, midi, vel] of layer.notes) {
      playNote(ctx, bus, layer.voice, { t, dur, midi, vel }, noise);
    }
  }
  return ctx.startRendering();
}

/** Renders one test set's stems and stingers (a few hundred ms per set on a laptop). */
export async function renderTestSet(set: MusicSetDef): Promise<MusicBuffers> {
  const spec = SPECS.find((s) => s.def.id === set.id);
  if (!spec) {
    throw new Error(`no test set ${set.id}`);
  }
  const loop = loopSeconds(set);
  const score = testScore(set.id);
  const out: MusicBuffers = { stems: {}, stingers: {} };
  await Promise.all(
    (Object.keys(score) as StemRole[]).map(async (r) => {
      out.stems[r] = await renderNotes(VOICE[r](spec), score[r], loop, true);
    }),
  );
  const beat = 60 / set.bpm;
  const chord = spec.chords[0];
  const stinger: Partial<Record<StingerKind, TestNote[]>> = {
    intro: chord.slice(1).map((m, i) => ({ t: i * beat * 0.5, dur: beat, midi: m + 12, vel: 0.5 })),
    go: chord.map((m) => ({ t: 0, dur: beat * 2, midi: m + 24, vel: 0.7 })),
    finish: [...chord, chord[0] + 12].map((m, i) => ({ t: i * beat * 0.25, dur: beat * 4, midi: m + 24, vel: 0.6 })),
  };
  for (const k of Object.keys(stinger) as StingerKind[]) {
    if (set.stingers?.[k]) {
      out.stingers[k] = await renderNotes('bell', stinger[k]!, (set.stingers[k]!.bars ?? 1) * beat * set.beatsPerBar, false);
    }
  }
  return out;
}
