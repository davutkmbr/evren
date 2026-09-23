import { mulberry32 } from './rng';

export interface ImpulseOptions {
  seconds: number;
  /** Low-frequency RT60 (s). High frequencies decay faster (air absorption). */
  rt60: number;
  /** Initial brightness of the diffuse field (Hz). */
  brightness: number;
  /** Discrete late echoes (hill/building slapbacks): [delay s, gain]. */
  echoes: Array<[number, number]>;
  seed: number;
}

export const OPEN_AIR_IMPULSE: ImpulseOptions = {
  seconds: 3.2,
  rt60: 2.7,
  brightness: 7000,
  echoes: [
    [0.19, 0.22],
    [0.37, 0.16],
    [0.61, 0.12],
    [0.93, 0.08],
  ],
  seed: 91,
};

export interface ImpulseData {
  sampleRate: number;
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
}

/**
 * Procedural stereo impulse response for a large open space (city basin + hills + water):
 * sparse early reflections, decorrelated diffuse tail with exponential decay whose spectrum darkens over time,
 * and a few low-passed discrete echoes. Energy-normalized so the convolver runs with normalize = false.
 * Pure (typed arrays) so it can be generated in a worker.
 */
export function generateImpulseData(sr: number, opts: ImpulseOptions = OPEN_AIR_IMPULSE): ImpulseData {
  const len = Math.round(opts.seconds * sr);
  const channels = [new Float32Array(len), new Float32Array(len)];
  const decayK = 6.907755 / opts.rt60;
  for (let ch = 0; ch < 2; ch++) {
    const rng = mulberry32(opts.seed * 7 + ch * 131);
    const data = channels[ch];
    const preDelay = 0.011 + ch * 0.0023;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if (t < preDelay) {
        continue;
      }
      const tt = t - preDelay;
      const env = Math.exp(-decayK * tt) * (1 - Math.exp(-tt / 0.018));
      const fc = 250 + opts.brightness * Math.exp(-tt * 1.9);
      const a = Math.exp((-2 * Math.PI * fc) / sr);
      lp = lp * a + (rng() * 2 - 1) * (1 - a);
      // One-pole LP loses level as fc drops; compensate halfway so the tail darkens without collapsing.
      const comp = Math.pow((1 + a) / (1 - a), 0.25);
      data[i] = lp * env * comp;
    }
    for (let e = 0; e < 7; e++) {
      const d = 0.012 + rng() * 0.07;
      const g = (0.18 + rng() * 0.25) * (rng() < 0.5 ? -1 : 1);
      const idx = Math.floor((d + preDelay) * sr);
      for (let k = 0; k < 24 && idx + k < len; k++) {
        data[idx + k] += g * Math.exp(-k / 5) * (k === 0 ? 1 : 0.35 * (rng() * 2 - 1));
      }
    }
    for (const [delay, gain] of opts.echoes) {
      const idx = Math.floor((delay + preDelay + (ch ? 0.007 : 0)) * sr);
      const w = Math.floor(0.03 * sr);
      let e = 0;
      for (let k = 0; k < w && idx + k < len; k++) {
        e = e * 0.93 + (rng() * 2 - 1) * 0.07;
        data[idx + k] += gain * e * 3.2 * Math.sin((Math.PI * k) / w);
      }
    }
  }
  let energy = 0;
  for (const d of channels) {
    for (let i = 0; i < len; i++) {
      energy += d[i] * d[i];
    }
  }
  const k = 1 / Math.sqrt(energy / 2 || 1);
  for (const d of channels) {
    for (let i = 0; i < len; i++) {
      d[i] *= k;
    }
  }
  return { sampleRate: sr, left: channels[0], right: channels[1] };
}

/** ConvolverNode requires the IR at the context's sample rate; returns null when the data does not match. */
export function impulseFromData(ctx: BaseAudioContext, d: ImpulseData): AudioBuffer | null {
  if (d.sampleRate !== ctx.sampleRate) {
    return null;
  }
  const buffer = ctx.createBuffer(2, d.left.length, d.sampleRate);
  buffer.copyToChannel(d.left, 0);
  buffer.copyToChannel(d.right, 1);
  return buffer;
}

export function createImpulseResponse(ctx: BaseAudioContext, opts: ImpulseOptions = OPEN_AIR_IMPULSE): AudioBuffer {
  return impulseFromData(ctx, generateImpulseData(ctx.sampleRate, opts))!;
}
