/**
 * Wind-wave spectrum of the ambient sea (phase 21 stage 7a): turns the 10 m wind speed into the amplitudes of the
 * fixed Gerstner slot lattice (config.ts GERSTNER_WAVES / SWELL_WAVES).
 *
 * - Wind sea: fetch-limited JONSWAP per wave group (chop / short / long = sheltered water / Bosphorus / open sea).
 *   Peak frequency and significant height follow the JONSWAP growth laws in the dimensionless fetch X = g F / U10^2,
 *   capped at the fully developed sea; the spectral shape is S(w) = C w^-5 exp(-5/4 (wp / w)^4) gamma^r, with C set so
 *   that the integral is Hs^2 / 16.
 * - Swell: a narrow JONSWAP (gamma 6) with a fixed peak period per regime and a height that grows mildly with wind.
 * - Every slot owns a frequency bin of the lattice (edges at the geometric means between neighbouring wavelengths;
 *   the longest wind-sea slot takes everything below its bin, i.e. the peak of a long-fetch sea); its amplitude is
 *   sqrt(2 * integral of S over the bin), so sum(A^2 / 2) = m0 of the part of the spectrum the lattice carries.
 *
 * The SeaState writes these amplitudes into the wave uniforms; the water shaders and the CPU evaluator
 * (wave-query.ts) both read the uniforms, so the spectrum has exactly one source and CPU/GPU parity is untouched.
 */
import { GERSTNER_WAVES, GRAVITY, SEA_SPECTRUM, SWELL_WAVES, WaveGroup, type GerstnerSpec } from './config';

const TWO_PI = Math.PI * 2;

export interface SpectrumPeak {
  /** Significant wave height (m) and peak period (s) of the continuous spectrum. */
  hs: number;
  tp: number;
  /** Peak angular frequency (rad/s). */
  omegaP: number;
  /** Dimensionless fetch actually used (after the fully developed cap). */
  xTilde: number;
}

/** Fetch-limited JONSWAP growth (U10 in m/s, fetch in m). */
export function windSeaPeak(u10: number, fetch: number, out: SpectrumPeak = { hs: 0, tp: 0, omegaP: 0, xTilde: 0 }): SpectrumPeak {
  const u = Math.max(u10, 0.1);
  const x = Math.min((GRAVITY * Math.max(fetch, 1)) / (u * u), SEA_SPECTRUM.fullyDeveloped);
  out.xTilde = x;
  out.hs = (1.6e-3 * Math.sqrt(x) * u * u) / GRAVITY;
  out.tp = (0.286 * Math.cbrt(x) * u) / GRAVITY;
  out.omegaP = TWO_PI / out.tp;
  return out;
}

/** Dimensionless JONSWAP shape s(x) = x^-5 exp(-5/4 x^-4) gamma^r, x = w / wp. */
function shape(x: number, gamma: number): number {
  const sigma = x <= 1 ? 0.07 : 0.09;
  const r = Math.exp(-((x - 1) * (x - 1)) / (2 * sigma * sigma));
  return x ** -5 * Math.exp(-1.25 * x ** -4) * gamma ** r;
}

/** Integral of shape(x) over x from 0 to infinity (numerically, once per gamma). */
function shapeIntegral(gamma: number): number {
  // Substitution x = e^u, dx = x du; the integrand is negligible outside x in [0.4, 12].
  let sum = 0;
  const n = 4000;
  const u0 = Math.log(0.3);
  const u1 = Math.log(20);
  const h = (u1 - u0) / n;
  for (let i = 0; i <= n; i++) {
    const x = Math.exp(u0 + i * h);
    const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
    sum += w * shape(x, gamma) * x;
  }
  return (sum * h) / 3;
}

const INTEGRAL_SEA = shapeIntegral(SEA_SPECTRUM.gamma);
const INTEGRAL_SWELL = shapeIntegral(SEA_SPECTRUM.swellGamma);

/**
 * Integral of the normalised spectrum (m0 = hs^2 / 16) over [w0, w1] (rad/s). Simpson in log frequency (intervals of
 * at most 0.025 in ln w); the open ends are cut at 0.35 wp / 12 wp where the spectrum is negligible.
 */
export function binEnergy(hs: number, omegaP: number, gamma: number, w0: number, w1: number): number {
  if (!(hs > 0) || !(omegaP > 0)) {
    return 0;
  }
  const lo = Math.max(w0, omegaP * 0.35);
  const hi = Math.min(w1, omegaP * 12);
  if (!(hi > lo)) {
    return 0;
  }
  const integral = gamma === SEA_SPECTRUM.swellGamma ? INTEGRAL_SWELL : INTEGRAL_SEA;
  const m0 = (hs * hs) / 16;
  const u0 = Math.log(lo / omegaP);
  const u1 = Math.log(hi / omegaP);
  // Even interval count, fine enough for the narrow peak enhancement (sigma 0.07 in w / wp).
  const n = 2 * Math.min(64, Math.max(4, Math.ceil((u1 - u0) / 0.05)));
  const h = (u1 - u0) / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const x = Math.exp(u0 + i * h);
    const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
    sum += w * shape(x, gamma) * x;
  }
  return ((sum * h) / 3 / integral) * m0;
}

/** Deep-water angular frequency of a wavelength. */
function omegaOf(lambda: number): number {
  return Math.sqrt((GRAVITY * TWO_PI) / lambda);
}

/** One slot of a regime's set with its frequency bin. */
export interface SpectrumSlot {
  spec: GerstnerSpec;
  /** Bin edges (rad/s), w0 < w1 (w0 = 0: the bin runs to the lowest frequencies). */
  w0: number;
  w1: number;
  k: number;
}

/** Bins of an ascending-wavelength list: edges at geometric means, the open ends as given. */
function binsOf(specs: readonly GerstnerSpec[], lambdaMin: number, lambdaMax: number): SpectrumSlot[] {
  const sorted = [...specs].sort((a, b) => a.lambda - b.lambda);
  return sorted.map((spec, i) => {
    const shorter = i === 0 ? lambdaMin : Math.sqrt(sorted[i - 1].lambda * spec.lambda);
    const longer = i === sorted.length - 1 ? lambdaMax : Math.sqrt(sorted[i + 1].lambda * spec.lambda);
    return { spec, w0: Number.isFinite(longer) ? omegaOf(longer) : 0, w1: omegaOf(shorter), k: TWO_PI / spec.lambda };
  });
}

/** The wind-sea lattice (both regimes) and the swell slots of each regime, with their bins. */
export const WIND_SEA_SLOTS: readonly SpectrumSlot[] = binsOf(GERSTNER_WAVES, SEA_SPECTRUM.lambdaMin, Infinity);
export const SWELL_SLOTS = {
  poyraz: binsOf(SWELL_WAVES.poyraz, 0, Infinity),
  lodos: binsOf(SWELL_WAVES.lodos, 0, Infinity),
};

/** Continuous spectra of the moment (diagnostics, checks, the water debug handle). */
export interface SeaSpectra {
  u10: number;
  chop: SpectrumPeak;
  short: SpectrumPeak;
  longPoyraz: SpectrumPeak;
  longLodos: SpectrumPeak;
  swellPoyraz: SpectrumPeak;
  swellLodos: SpectrumPeak;
}

const peak = (): SpectrumPeak => ({ hs: 0, tp: 0, omegaP: 0, xTilde: 0 });

export function createSeaSpectra(): SeaSpectra {
  return { u10: 0, chop: peak(), short: peak(), longPoyraz: peak(), longLodos: peak(), swellPoyraz: peak(), swellLodos: peak() };
}

/** Fills the continuous spectra for a 10 m wind speed. */
export function computeSeaSpectra(u10: number, out: SeaSpectra): SeaSpectra {
  const S = SEA_SPECTRUM;
  out.u10 = u10;
  windSeaPeak(u10, S.fetchChop, out.chop);
  windSeaPeak(u10, S.fetchShort, out.short);
  windSeaPeak(u10, S.fetchLongPoyraz, out.longPoyraz);
  windSeaPeak(u10, S.fetchLongLodos, out.longLodos);
  const swell = (cfg: { tp: number; hsBase: number; hsPerU10: number }, o: SpectrumPeak): void => {
    o.tp = cfg.tp;
    o.omegaP = TWO_PI / cfg.tp;
    o.hs = cfg.hsBase + cfg.hsPerU10 * u10;
    o.xTilde = 0;
  };
  swell(S.swellPoyraz, out.swellPoyraz);
  swell(S.swellLodos, out.swellLodos);
  return out;
}

/** The group's spectrum in a regime. */
export function groupPeak(spectra: SeaSpectra, group: WaveGroup, lodos: boolean): SpectrumPeak {
  switch (group) {
    case WaveGroup.Chop:
      return spectra.chop;
    case WaveGroup.Short:
      return spectra.short;
    case WaveGroup.Long:
      return lodos ? spectra.longLodos : spectra.longPoyraz;
    case WaveGroup.Swell:
    default:
      return lodos ? spectra.swellLodos : spectra.swellPoyraz;
  }
}

/**
 * Amplitude (m) of a slot at full group weight: sqrt(2 x bin energy), capped at SEA_SPECTRUM.maxSlotSteepness / k
 * (a single sinusoid steeper than that would be a breaking wave, carried by foam and the detail bands instead).
 * The chop and the short sea are nested (the chop grows everywhere, the short sea wherever the fetch reaches a few km),
 * so a chop slot carries at least the energy the short sea puts into its bin: in light winds the short sea's peak falls
 * into the chop slots. (The long sea is left out: its weight is zero in the Bosphorus and sheltered water.)
 */
export function slotAmplitude(slot: SpectrumSlot, spectra: SeaSpectra, lodos: boolean): number {
  const g = slot.spec.group;
  const p = groupPeak(spectra, g, lodos);
  const gamma = g === WaveGroup.Swell ? SEA_SPECTRUM.swellGamma : SEA_SPECTRUM.gamma;
  let e = binEnergy(p.hs, p.omegaP, gamma, slot.w0, slot.w1);
  if (g === WaveGroup.Chop) {
    e = Math.max(e, binEnergy(spectra.short.hs, spectra.short.omegaP, gamma, slot.w0, slot.w1));
  }
  return Math.min(Math.sqrt(2 * e), SEA_SPECTRUM.maxSlotSteepness / slot.k);
}
