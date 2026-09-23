import { mulberry32, type Rng } from './rng';

/**
 * Pre-generated, seamlessly looping noise buffers shared by every voice.
 * Audio-rate buffers are mono and RMS-normalized so layer gains are predictable.
 * Control-rate buffers (gust/buffet) are smooth random signals in [-1, 1] used to modulate AudioParams.
 * Generation is pure (typed arrays) so it can run in a worker; `noiseBankFromData` wraps it in AudioBuffers.
 */
export interface NoiseBank {
  /** Flat spectrum, RMS 0.25. */
  readonly white: AudioBuffer;
  /** -3 dB/oct, RMS 0.25. */
  readonly pink: AudioBuffer;
  /** -6 dB/oct above 25 Hz (red), RMS 0.25. */
  readonly brown: AudioBuffer;
  /** Sparse fire crackle pops, peak 0.9. */
  readonly crackle: AudioBuffer;
  /** 0.1-1.6 Hz smooth random signal (wind gusts), 40 s loop, peak 1. */
  readonly gust: AudioBuffer;
  /** 4-32 Hz smooth random signal (turbulent buffeting), 8 s loop, peak 1. */
  readonly buffet: AudioBuffer;
}

export interface NoiseData {
  sampleRate: number;
  controlRate: number;
  white: Float32Array<ArrayBuffer>;
  pink: Float32Array<ArrayBuffer>;
  brown: Float32Array<ArrayBuffer>;
  crackle: Float32Array<ArrayBuffer>;
  gust: Float32Array<ArrayBuffer>;
  buffet: Float32Array<ArrayBuffer>;
}

export const NOISE_RMS = 0.25;

export const CONTROL_RATE = 4000;

/**
 * Loop lengths (s). Sustained beds play these for minutes: frozen noise repeating every few seconds is audible,
 * so the broadband buffers are long and their lengths share no simple ratio with each other.
 */
export const WHITE_SECONDS = 17.9;
export const PINK_SECONDS = 11.3;
export const BROWN_SECONDS = 6.7;

/** Crossfades the extra tail (samples [len, len+fade)) into the head so the loop point is continuous. */
function makeLoop(src: Float32Array, len: number, fade: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(len);
  out.set(src.subarray(0, len));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[i] = src[i] * Math.sin(t * Math.PI * 0.5) + src[len + i] * Math.cos(t * Math.PI * 0.5);
  }
  return out;
}

function normalizeRms(data: Float32Array, targetRms: number): void {
  let mean = 0;
  for (let i = 0; i < data.length; i++) {
    mean += data[i];
  }
  mean /= data.length;
  let sq = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] -= mean;
    sq += data[i] * data[i];
  }
  const k = targetRms / (Math.sqrt(sq / data.length) || 1);
  for (let i = 0; i < data.length; i++) {
    data[i] *= k;
  }
}

function normalizePeak(data: Float32Array, peak: number): void {
  let mean = 0;
  for (let i = 0; i < data.length; i++) {
    mean += data[i];
  }
  mean /= data.length;
  let m = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] -= mean;
    m = Math.max(m, Math.abs(data[i]));
  }
  const k = peak / (m || 1);
  for (let i = 0; i < data.length; i++) {
    data[i] *= k;
  }
}

type NoiseColor = 'white' | 'pink' | 'brown';

function colorNoise(sr: number, color: NoiseColor, seconds: number, rng: Rng): Float32Array<ArrayBuffer> {
  const len = Math.round(seconds * sr);
  const fade = Math.round(0.05 * sr);
  const raw = new Float32Array(len + fade);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let last = 0;
  const leak = Math.exp((-2 * Math.PI * 25) / sr);
  for (let i = 0; i < raw.length; i++) {
    const w = rng() * 2 - 1;
    if (color === 'white') {
      raw[i] = w;
    } else if (color === 'pink') {
      // Paul Kellet's refined pink filter (+-0.05 dB above 9.2 Hz).
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      // Leaky integrator: -6 dB/oct above 25 Hz, flat below (no DC drift).
      last = last * leak + w * (1 - leak);
      raw[i] = last;
    }
  }
  const out = makeLoop(raw, len, fade);
  normalizeRms(out, NOISE_RMS);
  return out;
}

/** Periodic smooth value noise: sum of octaves with integer knot counts so the loop is seamless. */
function smoothNoise(rate: number, seconds: number, knotRates: number[], amps: number[], rng: Rng): Float32Array<ArrayBuffer> {
  const n = Math.round(seconds * rate);
  const data = new Float32Array(n);
  for (let o = 0; o < knotRates.length; o++) {
    const knots = Math.max(2, Math.round(knotRates[o] * seconds));
    const values = new Float32Array(knots);
    for (let k = 0; k < knots; k++) {
      values[k] = rng() * 2 - 1;
    }
    const amp = amps[o];
    for (let i = 0; i < n; i++) {
      const pos = (i / n) * knots;
      const k0 = Math.floor(pos);
      const f = pos - k0;
      const a = values[k0 % knots];
      const b = values[(k0 + 1) % knots];
      const s = f * f * f * (f * (f * 6 - 15) + 10);
      data[i] += (a + (b - a) * s) * amp;
    }
  }
  normalizePeak(data, 1);
  return data;
}

function crackleNoise(sr: number, seconds: number, rng: Rng): Float32Array<ArrayBuffer> {
  const data = new Float32Array(Math.round(seconds * sr));
  const n = data.length;
  let t = 0;
  const rate = 70;
  while (true) {
    t += -Math.log(1 - rng() * 0.9999) / rate;
    const start = Math.floor(t * sr);
    if (start >= n) {
      break;
    }
    const big = rng() < 0.12;
    const amp = (big ? 0.5 + 0.5 * rng() : Math.pow(rng(), 2.2) * 0.45) * (rng() < 0.5 ? -1 : 1);
    const dur = Math.floor((big ? 0.004 + rng() * 0.008 : 0.0004 + rng() * 0.0025) * sr);
    const lpA = big ? 0.55 : 0.12;
    let lp = 0;
    for (let i = 0; i < dur; i++) {
      const idx = (start + i) % n;
      const env = Math.exp((-6 * i) / dur);
      lp += (rng() * 2 - 1 - lp) * (1 - lpA);
      data[idx] += (i === 0 ? amp : lp * amp) * env;
    }
  }
  normalizePeak(data, 0.9);
  return data;
}

export function generateNoiseData(sampleRate: number, seed = 1337): NoiseData {
  const rng = mulberry32(seed);
  return {
    sampleRate,
    controlRate: CONTROL_RATE,
    white: colorNoise(sampleRate, 'white', WHITE_SECONDS, rng),
    pink: colorNoise(sampleRate, 'pink', PINK_SECONDS, rng),
    brown: colorNoise(sampleRate, 'brown', BROWN_SECONDS, rng),
    crackle: crackleNoise(sampleRate, 4.3, rng),
    gust: smoothNoise(CONTROL_RATE, 40, [0.1, 0.2, 0.4, 0.8, 1.6], [1, 0.7, 0.45, 0.25, 0.12], rng),
    buffet: smoothNoise(CONTROL_RATE, 8, [4, 8, 16, 32], [1, 0.75, 0.5, 0.3], rng),
  };
}

function toBuffer(ctx: BaseAudioContext, data: Float32Array<ArrayBuffer>, rate: number): AudioBuffer {
  let buffer: AudioBuffer;
  try {
    buffer = ctx.createBuffer(1, data.length, rate);
  } catch {
    // Very low sample rates are not supported everywhere: resample (linear) to the context rate.
    const n = Math.round((data.length * ctx.sampleRate) / rate);
    buffer = ctx.createBuffer(1, n, ctx.sampleRate);
    const out = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const p = (i * data.length) / n;
      const i0 = Math.floor(p);
      const f = p - i0;
      out[i] = data[i0 % data.length] * (1 - f) + data[(i0 + 1) % data.length] * f;
    }
    return buffer;
  }
  buffer.copyToChannel(data, 0);
  return buffer;
}

/** AudioBuffers may have their own sample rate (resampled on playback), so data from any rate works. */
export function noiseBankFromData(ctx: BaseAudioContext, d: NoiseData): NoiseBank {
  return {
    white: toBuffer(ctx, d.white, d.sampleRate),
    pink: toBuffer(ctx, d.pink, d.sampleRate),
    brown: toBuffer(ctx, d.brown, d.sampleRate),
    crackle: toBuffer(ctx, d.crackle, d.sampleRate),
    gust: toBuffer(ctx, d.gust, d.controlRate),
    buffet: toBuffer(ctx, d.buffet, d.controlRate),
  };
}

export function createNoiseBank(ctx: BaseAudioContext, seed = 1337): NoiseBank {
  return noiseBankFromData(ctx, generateNoiseData(ctx.sampleRate, seed));
}
