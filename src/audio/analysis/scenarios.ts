import type { CameraMode } from '../../core/contracts';
import { AudioEngine, createAudioFrame, type AudioFrame } from '../audio-engine';
import { createImpulseResponse } from '../dsp/impulse';
import { createNoiseBank, type NoiseBank } from '../dsp/noise';
import type { GainReduction } from '../master-bus';
import { SampleLibrary, type SampleBank } from '../samples';
import { analyze, loopRepeat, maxLoudnessRise, type LoopRepeat, type SoundMetrics } from './metrics';

/**
 * Offline test scenarios: each renders the real AudioEngine (same graph as in game, full master bus at volume 1)
 * into an OfflineAudioContext, stepping the per-frame update at 60 Hz via suspend()/resume().
 * A 1.6 s pre-roll (trimmed before analysis) lets the dynamics settle: DynamicsCompressorNodes start with gain
 * reduction that takes ~0.5 s to release (and their reduction meters ~1.5 s), which would otherwise under-measure
 * early one-shots and over-report gain reduction.
 * Besides the output, the signal entering the dynamics stage is recorded (extra channels) and the glue/limiter
 * gain reduction is sampled every step, so level balance can not be "achieved" by brickwall limiting.
 */
type StepFn = (t: number, prev: number, frame: AudioFrame, engine: AudioEngine) => void;

export interface RenderCase {
  id: string;
  label: string;
  seconds: number;
  /** Which loudness figure is judged: momentary max (one-shots) or integrated (beds/loops). */
  measure: 'momentary' | 'integrated';
  /** Acceptable LUFS window for the balance check. */
  target: [number, number];
  camera?: CameraMode;
  /** Highest acceptable sample peak (dBFS) entering the dynamics stage. Default PRE_PEAK_MAX. */
  prePeakMax?: number;
  /**
   * Audibility over a masking bed: the case is rendered again with `step` (the bed alone, same seed) and the
   * momentary loudness must rise by at least `minRise` LU somewhere.
   */
  masker?: { step: StepFn; minRise: number };
  /** Highest acceptable loop-repetition correlation (see loopRepeat); unchecked when omitted. */
  repeatMax?: number;
  /** Called every step with the current time and the time of the previous step. */
  step: StepFn;
}

export interface RenderResult {
  id: string;
  label: string;
  buffer: AudioBuffer;
  metrics: SoundMetrics;
  measure: RenderCase['measure'];
  measured: number;
  target: [number, number];
  /** Sample peak entering the dynamics stage (dBFS). */
  prePeakDb: number;
  /** Loudness (same measure as `measured`) entering the dynamics stage: the source balance without the bus. */
  preMeasured: number;
  /** Largest gain reduction (dB, <= 0) seen after the pre-roll. */
  glueGrDb: number;
  limiterGrDb: number;
  /** Loudness rise over the masker (LU), for masked cases. */
  rise: number | null;
  /** Frozen-noise repetition, for cases with `repeatMax`. */
  repeat: LoopRepeat | null;
  pass: boolean;
  problems: string[];
  renderMs: number;
}

export const SAMPLE_RATE = 48000;
export const PREROLL = 1.6;
const STEP = 1 / 60;
/** Headroom rules (see master-bus.ts). */
export const PRE_PEAK_MAX = -3;
export const LIMITER_GR_MAX = 3;
export const SUB30_MAX = 0.1;
/** A bus compressor working harder than this is doing the mixing instead of the gain staging. */
export const GLUE_GR_MAX = 6;

const crossed = (t: number, prev: number, at: number): boolean => prev < at && t >= at;

/** Third-person chase framing: dragon at the origin flying -Z, camera 28 m behind and 7 m above. */
function frameThird(frame: AudioFrame): void {
  frame.cameraMode = 'third';
  frame.listener.position.x = 0;
  frame.listener.position.y = 7;
  frame.listener.position.z = 28;
  const l = Math.hypot(7, 28);
  frame.listener.forward.x = 0;
  frame.listener.forward.y = -7 / l;
  frame.listener.forward.z = -28 / l;
}

function framePov(frame: AudioFrame): void {
  frame.cameraMode = 'pov';
  frame.listener.position.x = 0;
  frame.listener.position.y = 2.2;
  frame.listener.position.z = 1.5;
  frame.listener.forward.x = 0;
  frame.listener.forward.y = 0;
  frame.listener.forward.z = -1;
}

function baseFrame(camera: CameraMode): AudioFrame {
  const f = createAudioFrame();
  if (camera === 'pov') {
    framePov(f);
  } else {
    frameThird(f);
  }
  const d = f.dragon;
  d.present = true;
  d.position.x = 0;
  d.position.y = 0;
  d.position.z = 0;
  d.mouth.x = 0;
  d.mouth.y = 1.2;
  d.mouth.z = -9;
  f.probe.agl = 300;
  f.probe.altitude = 320;
  f.ambientWind = 5;
  return f;
}

const oneShot = (id: string, label: string, seconds: number, target: [number, number], camera: CameraMode, fire: (t: number, prev: number, e: AudioEngine, f: AudioFrame) => void): RenderCase => ({
  id,
  label,
  seconds,
  measure: 'momentary',
  target,
  camera,
  step: (t, prev, f, e) => fire(t, prev, e, f),
});

/** Steady beds must not expose their noise loops (Warren: repeating noise is recognizable up to ~10-20 s periods). */
const REPEAT_MAX = 0.2;

const windCase = (id: string, label: string, camera: CameraMode, target: [number, number], shape: (t: number, f: AudioFrame) => void, seconds = 6): RenderCase => ({
  id,
  label,
  seconds,
  measure: 'integrated',
  target,
  camera,
  repeatMax: REPEAT_MAX,
  step: (t, _prev, f) => shape(t, f),
});

/** Real flight-model strengths while cruising (0.36-0.59 logged in the app), over the matching wind bed. */
const CRUISE_FLAPS: Array<[number, number]> = [
  [0.4, 0.45],
  [1.3, 0.6],
  [2.2, 0.45],
  [3.1, 0.6],
];

function cruiseBed(f: AudioFrame): void {
  f.dragon.airspeed = 32;
  f.dragon.aoa = 0.06;
  Object.assign(f.probe, { agl: 200, altitude: 220, urban: 0, foliage: 0, water: 0, coast: 0, strait: 0 });
}

const flapOverWind = (id: string, label: string, camera: CameraMode, minRise: number): RenderCase => ({
  id,
  label,
  seconds: 4,
  measure: 'integrated',
  // Same window for both cameras: switching with C must not change the cruise loudness.
  target: [-26, -20],
  camera,
  masker: { step: (_t, _p, f) => cruiseBed(f), minRise },
  step: (t, p, f, e) => {
    cruiseBed(f);
    for (const [at, strength] of CRUISE_FLAPS) {
      if (crossed(t, p, at)) {
        e.flap(strength);
      }
    }
  },
});

const rainCase = (id: string, label: string, rain: number, airspeed: number, camera: CameraMode, target: [number, number]): RenderCase => ({
  id,
  label,
  seconds: 10,
  measure: 'integrated',
  target,
  camera,
  repeatMax: REPEAT_MAX,
  step: (_t, _p, f) => {
    f.rain = rain;
    f.dragon.airspeed = airspeed;
    f.dragon.grounded = airspeed === 0;
    Object.assign(f.probe, { agl: 60, altitude: 80, urban: 0, foliage: 0, water: 0, coast: 0, strait: 0 });
  },
});

export const CASES: RenderCase[] = [
  oneShot('flap-third', 'Kanat çırpma (3. şahıs) 0.5 + 1.0', 2.6, [-24, -18], 'third', (t, p, e) => {
    if (crossed(t, p, 0.2)) {
      e.flap(0.5);
    }
    if (crossed(t, p, 1.3)) {
      e.flap(1.0);
    }
  }),
  oneShot('flap-pov', 'Kanat çırpma (POV) 0.5 + 1.0', 2.6, [-20, -13], 'pov', (t, p, e) => {
    if (crossed(t, p, 0.2)) {
      e.flap(0.5);
    }
    if (crossed(t, p, 1.3)) {
      e.flap(1.0);
    }
  }),
  flapOverWind('flap-cruise-pov', 'Kanat çırpma seyirde, rüzgârın üstünde (POV, 32 m/s, güç 0.45/0.6)', 'pov', 3),
  flapOverWind('flap-cruise-third', 'Kanat çırpma seyirde, rüzgârın üstünde (3. şahıs, 32 m/s, güç 0.45/0.6)', 'third', 4),
  oneShot('roar-third', 'Kükreme (3. şahıs)', 4.2, [-16, -11], 'third', (t, p, e) => {
    if (crossed(t, p, 0.1)) {
      e.play('roar');
    }
  }),
  oneShot('roar-pov', 'Kükreme (POV)', 4.2, [-15, -10], 'pov', (t, p, e) => {
    if (crossed(t, p, 0.1)) {
      e.play('roar');
    }
  }),
  oneShot('fire', 'Ateş püskürme 0.2-2.8 s', 4, [-18, -13], 'third', (t, _p, _e, f) => {
    f.dragon.firing = t > 0.2 && t < 2.8;
  }),
  oneShot('splash', 'Suya çarpma', 3.2, [-21, -15], 'third', (t, p, e, f) => {
    if (crossed(t, p, 0.1)) {
      e.splashAt(f.dragon.position, 1);
    }
  }),
  oneShot('land', 'Yere iniş', 1.8, [-22, -16], 'third', (t, p, e, f) => {
    if (crossed(t, p, 0.1)) {
      e.landAt(f.dragon.position, 14);
    }
  }),
  oneShot('thunder-near', 'Gök gürültüsü, yakın (~1 km)', 9, [-22, -14], 'third', (t, p, e) => {
    if (crossed(t, p, 0.1)) {
      e.play('thunder', 1);
    }
  }),
  oneShot('thunder-far', 'Gök gürültüsü, uzak (~6 km)', 10, [-32, -22], 'third', (t, p, e) => {
    if (crossed(t, p, 0.1)) {
      e.play('thunder', 0.3);
    }
  }),
  {
    id: 'ground-idle',
    label: 'Yerde: nefes (sakin → yorgun) + adımlar',
    seconds: 12,
    measure: 'integrated',
    target: [-34, -24],
    step: (t, p, f, e) => {
      f.dragon.airspeed = 0;
      f.dragon.grounded = true;
      f.dragon.exertion = t < 6 ? 0.25 : 0.95;
      for (let k = 0; k < 8; k++) {
        if (crossed(t, p, 7.5 + k * 0.45)) {
          e.step(k % 2 === 0 ? 0.9 : 0.7, k < 4 ? -1 : 1);
        }
      }
    },
  },
  oneShot('ui-click', 'Arayüz tık', 0.6, [-40, -32], 'third', (t, p, e) => {
    for (const at of [0.05, 0.25, 0.45]) {
      if (crossed(t, p, at)) {
        e.play('ui-click');
      }
    }
  }),
  oneShot('discover', 'Keşif çanı', 3.6, [-24, -18], 'third', (t, p, e) => {
    if (crossed(t, p, 0.05)) {
      e.play('discover');
    }
  }),
  oneShot('gull', 'Martı çağrısı, 60 m', 3.2, [-36, -26], 'third', (t, p, e) => {
    if (crossed(t, p, 0.05)) {
      e.ambience.spawnGull(30, 60);
    }
  }),
  oneShot('gull-close', 'Martı çağrıları yakından (25 m): 4 çağrı, türler karışık', 9, [-28, -18], 'third', (t, p, e) => {
    for (const at of [0.05, 2.3, 4.6, 6.9]) {
      if (crossed(t, p, at)) {
        e.ambience.spawnGull(20, 25);
      }
    }
  }),
  oneShot('car-horn', 'Uzak korna, 300 m', 2, [-36, -28], 'third', (t, p, e) => {
    if (crossed(t, p, 0.05)) {
      e.ambience.spawnCarHorn(60, 300);
    }
  }),
  oneShot('ferry', 'Vapur düdüğü, 1.5 km', 9, [-33, -26], 'third', (t, p, e) => {
    if (crossed(t, p, 0.05)) {
      e.ambience.spawnFerry(150, 1500);
    }
  }),
  rainCase('rain-light', 'Hafif yağmur (0.35), yerde (3. şahıs)', 0.35, 0, 'third', [-33, -27]),
  rainCase('rain-heavy', 'Sağanak (1.0), yerde (POV)', 1, 0, 'pov', [-26, -20]),
  rainCase('rain-flight', 'Yağmurda seyir (0.8), 32 m/s (3. şahıs)', 0.8, 32, 'third', [-24, -18]),
  windCase('wind-cruise-third', 'Rüzgâr seyir 40 m/s (3. şahıs)', 'third', [-31, -25], (_t, f) => {
    f.dragon.airspeed = 40;
  }),
  windCase('wind-cruise-pov', 'Rüzgâr seyir 40 m/s (POV)', 'pov', [-31, -25], (_t, f) => {
    f.dragon.airspeed = 40;
  }),
  windCase(
    'wind-steady-long',
    'Uzun sabit seyir 36 m/s (POV, 36 s): gürültü döngüsü tekrar testi',
    'pov',
    [-30, -23],
    (_t, f) => {
      f.dragon.airspeed = 36;
      f.dragon.aoa = 0.05;
    },
    36,
  ),
  windCase('wind-dive-pov', 'Dalış 50→95 m/s (POV)', 'pov', [-24, -18], (t, f) => {
    f.dragon.airspeed = 50 + Math.min(1, t / 4) * 45;
    f.dragon.diving = Math.min(1, t / 1.5);
  }),
  windCase('wind-bank-third', 'Yatış/dönüş 45 m/s (3. şahıs)', 'third', [-28, -22], (t, f) => {
    f.dragon.airspeed = 45;
    f.dragon.turnRate = Math.sin(t * 1.3) * 0.8;
    f.dragon.rollRate = Math.cos(t * 1.3) * 1.2;
    f.dragon.sideslip = Math.sin(t * 1.3) * 0.12;
  }),
  windCase('wind-skim', 'Su yüzeyinde alçak uçuş 35 m/s (3. şahıs)', 'third', [-31, -25], (t, f) => {
    f.dragon.airspeed = 35;
    f.dragon.skim = Math.min(1, t / 1.5);
  }),
  windCase('wind-hover', 'Asılı kalma 6 m/s (POV)', 'pov', [-46, -32], (_t, f) => {
    f.dragon.airspeed = 6;
    f.dragon.stall = 0.25;
  }),
  {
    id: 'amb-city',
    label: 'Şehir alçak irtifa (60 m)',
    seconds: 10,
    measure: 'integrated',
    target: [-32, -25],
    repeatMax: REPEAT_MAX,
    step: (_t, _p, f) => {
      f.dragon.airspeed = 0;
      Object.assign(f.probe, { agl: 60, altitude: 110, urban: 0.85, foliage: 0.05, water: 0, coast: 0, strait: 0 });
    },
  },
  {
    id: 'amb-coast',
    label: 'Sahil alçak (40 m): dalga + martı',
    seconds: 14,
    measure: 'integrated',
    target: [-30, -23],
    repeatMax: REPEAT_MAX,
    step: (_t, _p, f) => {
      f.dragon.airspeed = 0;
      Object.assign(f.probe, { agl: 40, altitude: 40, urban: 0.2, foliage: 0, water: 0.5, coast: 1, strait: 0.6 });
    },
  },
  {
    id: 'amb-night',
    label: 'Gece park/bahçe (30 m): cırcır böcekleri',
    seconds: 8,
    measure: 'integrated',
    target: [-36, -26],
    repeatMax: REPEAT_MAX,
    step: (_t, _p, f) => {
      f.dragon.airspeed = 0;
      Object.assign(f.probe, { agl: 30, altitude: 90, urban: 0.3, foliage: 0.7, water: 0, coast: 0, strait: 0, night: 1 });
    },
  },
  {
    id: 'amb-high',
    label: 'Yüksek irtifa rüzgârı (2400 m)',
    seconds: 8,
    measure: 'integrated',
    target: [-35, -28],
    repeatMax: REPEAT_MAX,
    step: (_t, _p, f) => {
      f.dragon.airspeed = 0;
      Object.assign(f.probe, { agl: 2350, altitude: 2400, urban: 0, foliage: 0, water: 0, coast: 0, strait: 0 });
    },
  },
  {
    id: 'amb-long',
    label: 'Uzun ortam yatağı (30 s, 45 m, kıyı + şehir + koru): gürültü döngüsü tekrar testi',
    seconds: 30,
    measure: 'integrated',
    target: [-30, -22],
    repeatMax: REPEAT_MAX,
    step: (_t, _p, f) => {
      f.dragon.airspeed = 0;
      Object.assign(f.probe, { agl: 45, altitude: 60, urban: 0.6, foliage: 0.3, water: 0.5, coast: 0.8, strait: 0.5 });
    },
  },
  {
    id: 'mix-flight',
    label: 'Tam karışım: uçuş senaryosu (3. şahıs)',
    seconds: 16,
    measure: 'momentary',
    target: [-16, -10],
    repeatMax: REPEAT_MAX,
    step: (t, p, f, e) => flightScenario(t, p, f, e),
  },
  {
    id: 'mix-pov',
    label: 'Tam karışım: uçuş senaryosu (POV)',
    seconds: 16,
    measure: 'momentary',
    target: [-15, -9],
    camera: 'pov',
    repeatMax: REPEAT_MAX,
    step: (t, p, f, e) => flightScenario(t, p, f, e),
  },
  {
    id: 'stress-pov',
    label: 'En yüksek an: POV dalış 90 m/s + kükreme + ateş',
    seconds: 5,
    measure: 'momentary',
    target: [-14, -8],
    camera: 'pov',
    prePeakMax: -5,
    step: (t, p, f, e) => {
      const d = f.dragon;
      Object.assign(f.probe, { agl: 120, altitude: 140, urban: 0.6, foliage: 0, water: 0.3, coast: 0.6, strait: 0.3 });
      d.airspeed = 90;
      d.diving = 1;
      d.aoa = 0.12;
      d.turnRate = Math.sin(t * 1.4) * 0.6;
      d.rollRate = Math.cos(t * 1.4) * 1.1;
      if (crossed(t, p, 0.3)) {
        e.play('roar');
      }
      d.firing = t > 0.8 && t < 4.2;
      if (crossed(t, p, 2.5)) {
        e.flap(1);
      }
    },
  },
  {
    id: 'pause',
    label: 'Duraklatma: 2-4 s arası kısılma',
    seconds: 6,
    measure: 'integrated',
    target: [-27, -20],
    step: (t, p, f, e) => {
      f.dragon.airspeed = 40;
      Object.assign(f.probe, { agl: 90, altitude: 120, urban: 0.6, foliage: 0, water: 0.2, coast: 0.6, strait: 0.2 });
      if (crossed(t, p, 2)) {
        e.setPaused(true);
      }
      if (crossed(t, p, 4)) {
        e.setPaused(false);
      }
    },
  },
];

function flightScenario(t: number, p: number, f: AudioFrame, e: AudioEngine): void {
  const d = f.dragon;
  Object.assign(f.probe, { agl: 80, altitude: 90, urban: 0.5, foliage: 0.05, water: 0.35, coast: 0.8, strait: 0.5 });
  d.airspeed = 42;
  d.turnRate = 0;
  d.rollRate = 0;
  d.diving = 0;
  for (let k = 0; k < 6; k++) {
    if (crossed(t, p, 0.3 + k * 0.85)) {
      e.flap(0.7 + 0.3 * (k % 2));
    }
  }
  if (t > 5 && t < 8.5) {
    d.turnRate = Math.sin((t - 5) * 1.8) * 0.9;
    d.rollRate = Math.cos((t - 5) * 1.8) * 1.4;
  }
  if (crossed(t, p, 6)) {
    e.play('roar');
  }
  d.firing = t > 9 && t < 11;
  if (t > 11 && t < 14.3) {
    const k = (t - 11) / 3.3;
    d.airspeed = 42 + 50 * k;
    d.diving = Math.min(1, k * 2);
  }
  if (crossed(t, p, 14.4)) {
    e.splashAt(d.position, 1.2);
  }
}

let shared: { noise: NoiseBank; impulse: AudioBuffer; samples: SampleBank | null } | null = null;
let recorded = true;

/** Renders with the recorded sounds (default) or synthesis only (A/B against the procedural voices). */
export function useRecordedSounds(on: boolean): void {
  recorded = on;
  shared = null;
}

async function loadShared(ctx: OfflineAudioContext): Promise<NonNullable<typeof shared>> {
  let samples: SampleBank | null = null;
  if (recorded) {
    samples = new SampleLibrary().createBank(ctx);
    await Promise.all((['flight', 'rain', 'storm', 'coast'] as const).map((g) => samples!.ready(g)));
  }
  return { noise: createNoiseBank(ctx), impulse: createImpulseResponse(ctx), samples };
}

interface RawRender {
  main: AudioBuffer;
  pre: AudioBuffer;
  glueGr: number;
  limiterGr: number;
}

function slice(src: AudioBuffer, firstChannel: number, offset: number, length: number): AudioBuffer {
  const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: src.sampleRate });
  for (let c = 0; c < 2; c++) {
    out.copyToChannel(src.getChannelData(firstChannel + c).subarray(offset, offset + length), c);
  }
  return out;
}

/** Renders `step` through the full engine: channels 0-1 = output, 2-3 = the dynamics-stage input. */
async function renderRaw(c: RenderCase, step: StepFn, seed: number): Promise<RawRender> {
  const total = PREROLL + c.seconds;
  const ctx = new OfflineAudioContext(4, Math.ceil(total * SAMPLE_RATE), SAMPLE_RATE);
  shared ??= await loadShared(ctx);
  const merger = ctx.createChannelMerger(4);
  merger.connect(ctx.destination);
  const mainIn = ctx.createGain();
  const mainSplit = ctx.createChannelSplitter(2);
  mainIn.connect(mainSplit);
  mainSplit.connect(merger, 0, 0);
  mainSplit.connect(merger, 1, 1);
  const engine = new AudioEngine(ctx, { seed, destination: mainIn, ...shared });
  const preSplit = ctx.createChannelSplitter(2);
  engine.bus.preDynamics.connect(preSplit);
  preSplit.connect(merger, 0, 2);
  preSplit.connect(merger, 1, 3);
  engine.setVolume(1);

  const frame = baseFrame(c.camera ?? 'third');
  frame.dt = 0;
  step(0, -1, frame, engine);
  engine.update(frame);
  const gr: GainReduction = { glue: 0, limiter: 0 };
  let glueGr = 0;
  let limiterGr = 0;
  let prevAbs = 0;
  let prevCase = 0;
  for (let i = 1; i * STEP < total - 0.01; i++) {
    const at = i * STEP;
    void ctx.suspend(at).then(() => {
      frame.dt = at - prevAbs;
      prevAbs = at;
      const tc = at - PREROLL;
      if (tc >= 0) {
        step(tc, prevCase, frame, engine);
        prevCase = tc;
        engine.bus.readReduction(gr);
        glueGr = Math.min(glueGr, gr.glue);
        limiterGr = Math.min(limiterGr, gr.limiter);
      } else {
        step(0, 0, frame, engine);
      }
      engine.update(frame);
      void ctx.resume();
    });
  }
  const rendered = await ctx.startRendering();
  engine.dispose();
  const offset = Math.round(PREROLL * SAMPLE_RATE);
  const length = Math.min(Math.ceil(c.seconds * SAMPLE_RATE), rendered.length - offset);
  return { main: slice(rendered, 0, offset, length), pre: slice(rendered, 2, offset, length), glueGr, limiterGr };
}

function samplePeakDb(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) {
        peak = a;
      }
    }
  }
  return 20 * Math.log10(Math.max(peak, 1e-9));
}

/** Renders one case through the full engine graph and checks level, headroom, spectrum and audibility rules. */
export async function renderCase(c: RenderCase, seed = 4242): Promise<RenderResult> {
  const t0 = performance.now();
  const raw = await renderRaw(c, c.step, seed);
  const buffer = raw.main;
  const metrics = analyze(buffer);
  const measured = c.measure === 'momentary' ? metrics.momentaryMaxLufs : metrics.integratedLufs;
  const prePeakDb = samplePeakDb(raw.pre);
  const preMetrics = analyze(raw.pre);
  const preMeasured = c.measure === 'momentary' ? preMetrics.momentaryMaxLufs : preMetrics.integratedLufs;
  let rise: number | null = null;
  if (c.masker) {
    const bed = await renderRaw(c, c.masker.step, seed);
    rise = maxLoudnessRise(buffer, bed.main);
  }
  const repeat = c.repeatMax !== undefined ? loopRepeat(buffer) : null;
  const problems: string[] = [];
  if (repeat && c.repeatMax !== undefined && repeat.corr > c.repeatMax) {
    problems.push(`noise loop repeats: correlation ${repeat.corr.toFixed(2)} at ${repeat.lagS.toFixed(3)} s (max ${c.repeatMax})`);
  }
  if (metrics.clipped > 0) {
    problems.push(`${metrics.clipped} clipped samples`);
  }
  if (metrics.peakDb > -0.5) {
    problems.push(`peak ${metrics.peakDb.toFixed(1)} dBFS > -0.5`);
  }
  if (measured < c.target[0] || measured > c.target[1]) {
    problems.push(`loudness ${measured.toFixed(1)} LUFS outside [${c.target[0]}, ${c.target[1]}]`);
  }
  const prePeakMax = c.prePeakMax ?? PRE_PEAK_MAX;
  if (prePeakDb > prePeakMax) {
    problems.push(`pre-dynamics peak ${prePeakDb.toFixed(1)} dBFS > ${prePeakMax}`);
  }
  if (-raw.limiterGr > LIMITER_GR_MAX) {
    problems.push(`limiter reduction ${raw.limiterGr.toFixed(1)} dB (max ${LIMITER_GR_MAX})`);
  }
  if (-raw.glueGr > GLUE_GR_MAX) {
    problems.push(`glue reduction ${raw.glueGr.toFixed(1)} dB (max ${GLUE_GR_MAX})`);
  }
  if (metrics.sub30 > SUB30_MAX) {
    problems.push(`${(metrics.sub30 * 100).toFixed(0)} % of the energy below 30 Hz (max ${SUB30_MAX * 100} %)`);
  }
  if (c.masker && rise !== null && rise < c.masker.minRise) {
    problems.push(`rises only ${rise.toFixed(1)} LU over its bed (min ${c.masker.minRise})`);
  }
  if (Math.abs(metrics.dcOffset) > 0.01) {
    problems.push(`DC offset ${metrics.dcOffset.toFixed(3)}`);
  }
  return {
    id: c.id,
    label: c.label,
    buffer,
    metrics,
    measure: c.measure,
    measured,
    target: c.target,
    prePeakDb,
    preMeasured,
    glueGrDb: raw.glueGr,
    limiterGrDb: raw.limiterGr,
    rise,
    repeat,
    pass: problems.length === 0,
    problems,
    renderMs: performance.now() - t0,
  };
}
