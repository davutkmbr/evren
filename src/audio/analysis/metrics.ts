/**
 * Offline signal metrics for validating synthesized sounds without listening:
 * sample peak, clipping, RMS, ITU-R BS.1770-4 loudness (K-weighted momentary max / integrated LUFS),
 * spectral centroid, band energy split, sub-30 Hz share (fine Welch PSD), stereo correlation and a log-frequency
 * spectrogram.
 */
export interface SoundMetrics {
  durationS: number;
  peakDb: number;
  /** Samples with |x| >= 0.999. */
  clipped: number;
  rmsDb: number;
  /** Max 400 ms momentary loudness (LUFS). */
  momentaryMaxLufs: number;
  /** Gated integrated loudness (LUFS). */
  integratedLufs: number;
  crestDb: number;
  centroidHz: number;
  /** Energy share below 150 Hz, 150 Hz - 2 kHz, above 2 kHz (sums to 1). */
  bands: [number, number, number];
  /** Energy share below 30 Hz (inaudible on small speakers, but it eats headroom and drives the dynamics). */
  sub30: number;
  /** L/R correlation (1 = mono, 0 = decorrelated). */
  stereoCorrelation: number;
  dcOffset: number;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** BS.1770 K-weighting coefficients for any sample rate (pre-filter shelf + RLB high-pass). */
function kWeighting(sr: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  return [shelf, hp];
}

function filterBiquad(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

const toDb = (v: number): number => 20 * Math.log10(Math.max(v, 1e-9));

const lufs = (z: number): number => -0.691 + 10 * Math.log10(Math.max(z, 1e-12));

/** Mean-square K-weighted power of 400 ms blocks with a 100 ms hop (summed over channels, BS.1770). */
function blockPowers(channels: Float32Array[], sr: number): number[] {
  const [shelf, hp] = kWeighting(sr);
  const weighted = channels.map((c) => filterBiquad(filterBiquad(c, shelf), hp));
  const block = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  const n = weighted[0].length;
  const blocks: number[] = [];
  for (let start = 0; start + block <= n; start += hop) {
    let z = 0;
    for (const w of weighted) {
      let s = 0;
      for (let i = start; i < start + block; i++) {
        s += w[i] * w[i];
      }
      z += s / block;
    }
    blocks.push(z);
  }
  if (blocks.length === 0) {
    let z = 0;
    for (const w of weighted) {
      let s = 0;
      for (let i = 0; i < n; i++) {
        s += w[i] * w[i];
      }
      z += s / Math.max(1, n);
    }
    blocks.push(z);
  }
  return blocks;
}

function loudness(channels: Float32Array[], sr: number): { momentaryMax: number; integrated: number } {
  const blocks = blockPowers(channels, sr);
  let maxZ = 0;
  for (const z of blocks) {
    maxZ = Math.max(maxZ, z);
  }
  const abs = blocks.filter((z) => lufs(z) > -70);
  if (abs.length === 0) {
    return { momentaryMax: lufs(maxZ), integrated: -70 };
  }
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = lufs(meanAbs) - 10;
  const gated = abs.filter((z) => lufs(z) > rel);
  const meanRel = gated.reduce((a, b) => a + b, 0) / Math.max(1, gated.length);
  return { momentaryMax: lufs(maxZ), integrated: lufs(meanRel) };
}

function bufferChannels(buffer: AudioBuffer): Float32Array[] {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  return channels;
}

/** Momentary loudness (LUFS) every 100 ms: used to measure how far one sound pokes out of a masking bed. */
export function momentarySeries(buffer: AudioBuffer): Float32Array {
  const blocks = blockPowers(bufferChannels(buffer), buffer.sampleRate);
  return Float32Array.from(blocks, lufs);
}

/**
 * Largest momentary-loudness rise (LU) of `signal` over `masker` (same length, same seed, rendered with and
 * without the sound under test). Blocks where both are near silence are ignored.
 */
export function maxLoudnessRise(signal: AudioBuffer, masker: AudioBuffer): number {
  const a = momentarySeries(signal);
  const b = momentarySeries(masker);
  let rise = -Infinity;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] > -70) {
      rise = Math.max(rise, a[i] - Math.max(b[i], -70));
    }
  }
  return rise;
}

const WELCH_SIZE = 16384;

/** Energy share below `hz` from a Welch PSD (Hann, 50 % overlap, ~2.9 Hz bins at 48 kHz). */
function lowShare(mono: Float32Array, sr: number, hz: number): number {
  const n = WELCH_SIZE;
  if (mono.length < n) {
    return 0;
  }
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const psd = new Float64Array(n / 2);
  for (let start = 0; start + n <= mono.length; start += n / 2) {
    for (let i = 0; i < n; i++) {
      re[i] = mono[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < n / 2; k++) {
      psd[k] += re[k] * re[k] + im[k] * im[k];
    }
  }
  let low = 0;
  let total = 0;
  const cut = (hz * n) / sr;
  for (let k = 1; k < n / 2; k++) {
    total += psd[k];
    if (k < cut) {
      low += psd[k];
    }
  }
  return total > 0 ? low / total : 0;
}

/** In-place iterative radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface LoopRepeat {
  /** Largest normalized correlation of the signal with a delayed copy of itself (0 = never repeats, 1 = exact loop). */
  corr: number;
  /** Delay (s) where it occurs. */
  lagS: number;
}

/**
 * Detects frozen-noise repetition (a looping noise buffer heard as a pattern): normalized autocorrelation of the
 * first-differenced left channel (weights the high band, where loops are recognized) over every delay from `minLagS`
 * up to the length minus `minOverlapS`. Evolving noise stays near 0; a verbatim loop approaches 1.
 */
export function loopRepeat(buffer: AudioBuffer, minLagS = 0.25, minOverlapS = 2): LoopRepeat {
  const src = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const n = src.length - 1;
  const minLag = Math.round(minLagS * sr);
  const maxLag = n - Math.round(minOverlapS * sr);
  if (maxLag <= minLag) {
    return { corr: 0, lagS: 0 };
  }
  let size = 1;
  while (size < 2 * n) {
    size <<= 1;
  }
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const energy = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const d = src[i + 1] - src[i];
    re[i] = d;
    energy[i + 1] = energy[i] + d * d;
  }
  fft(re, im);
  for (let k = 0; k < size; k++) {
    re[k] = re[k] * re[k] + im[k] * im[k];
    im[k] = 0;
  }
  // The power spectrum is real and even, so a forward transform yields size * autocorrelation.
  fft(re, im);
  let best = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const norm = Math.sqrt(energy[n - lag] * (energy[n] - energy[lag]));
    const c = norm > 0 ? re[lag] / size / norm : 0;
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  return { corr: best, lagS: bestLag / sr };
}

export interface Spectrogram {
  /** frames x bins magnitudes in dB. */
  frames: Float32Array[];
  bins: number;
  hopS: number;
  sampleRate: number;
}

const FFT_SIZE = 2048;

export function spectrogram(mono: Float32Array, sr: number, hop = 512): Spectrogram {
  const frames: Float32Array[] = [];
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const win = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  }
  for (let start = 0; start + FFT_SIZE <= mono.length; start += hop) {
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = mono[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const mags = new Float32Array(FFT_SIZE / 2);
    for (let k = 0; k < FFT_SIZE / 2; k++) {
      mags[k] = toDb((Math.hypot(re[k], im[k]) * 2) / (FFT_SIZE / 2));
    }
    frames.push(mags);
  }
  return { frames, bins: FFT_SIZE / 2, hopS: hop / sr, sampleRate: sr };
}

export function analyze(buffer: AudioBuffer): SoundMetrics {
  const sr = buffer.sampleRate;
  const channels = bufferChannels(buffer);
  const n = buffer.length;
  let peak = 0;
  let clipped = 0;
  let sq = 0;
  let dc = 0;
  for (const ch of channels) {
    for (let i = 0; i < n; i++) {
      const v = ch[i];
      const a = Math.abs(v);
      if (a > peak) {
        peak = a;
      }
      if (a >= 0.999) {
        clipped++;
      }
      sq += v * v;
      dc += v;
    }
  }
  const rms = Math.sqrt(sq / (n * channels.length));
  const { momentaryMax, integrated } = loudness(channels, sr);

  const mono = new Float32Array(n);
  for (const ch of channels) {
    for (let i = 0; i < n; i++) {
      mono[i] += ch[i] / channels.length;
    }
  }
  const spec = spectrogram(mono, sr, 1024);
  let wSum = 0;
  let fSum = 0;
  const bandE = [0, 0, 0];
  const binHz = sr / FFT_SIZE;
  for (const frame of spec.frames) {
    for (let k = 1; k < frame.length; k++) {
      const p = Math.pow(10, frame[k] / 10);
      const f = k * binHz;
      fSum += f * p;
      wSum += p;
      bandE[f < 150 ? 0 : f < 2000 ? 1 : 2] += p;
    }
  }
  const bandTotal = bandE[0] + bandE[1] + bandE[2] || 1;

  let corr = 1;
  if (channels.length === 2) {
    let lr = 0;
    let ll = 0;
    let rr = 0;
    const [l, r] = channels;
    for (let i = 0; i < n; i++) {
      lr += l[i] * r[i];
      ll += l[i] * l[i];
      rr += r[i] * r[i];
    }
    corr = lr / Math.sqrt(ll * rr || 1);
  }

  return {
    durationS: n / sr,
    peakDb: toDb(peak),
    clipped,
    rmsDb: toDb(rms),
    momentaryMaxLufs: momentaryMax,
    integratedLufs: integrated,
    crestDb: toDb(peak) - toDb(rms),
    centroidHz: wSum > 0 ? fSum / wSum : 0,
    bands: [bandE[0] / bandTotal, bandE[1] / bandTotal, bandE[2] / bandTotal],
    sub30: lowShare(mono, sr, 30),
    stereoCorrelation: corr,
    dcOffset: dc / (n * channels.length),
  };
}
