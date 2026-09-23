/**
 * Detail-wave band bake (CPU, runs in the water worker).
 * For each band: random-phase directional spectrum restricted to one annulus of the tile's wavenumber lattice,
 * inverse FFT of the slope spectra i*k*H(k) -> complex slope fields P_sx(x), P_sz(x).
 * Runtime: slope(x, t) = 2 Re[P(x) e^{-i w_b t}] (waves travel along +k, i.e. downwind); normalised so that the
 * time/space mean of sx^2 + sz^2 is 1.
 */
import { createRng } from '../../../core/math/noise';
import { BANDS, BAND_RING_MAX, BAND_RING_MIN, BAND_SIZE, POYRAZ_DOWNWIND_DEG } from '../config';
import { fft2d } from './fft';
import { toHalf } from './half';

export interface BandBakeResult {
  /** RGBA half floats, BAND_SIZE^2 texels per layer, layers = band count. (Re sx, Im sx, Re sz, Im sz). */
  data: Uint16Array;
  size: number;
  layers: number;
}

function gaussianPair(rng: () => number): [number, number] {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}

export function bakeBands(seed = 20260923): BandBakeResult {
  const n = BAND_SIZE;
  const layers = BANDS.length;
  const out = new Uint16Array(n * n * 4 * layers);
  const heading = (POYRAZ_DOWNWIND_DEG * Math.PI) / 180;
  const windAngle = Math.atan2(-Math.cos(heading), Math.sin(heading));

  const sxRe = new Float64Array(n * n);
  const sxIm = new Float64Array(n * n);
  const szRe = new Float64Array(n * n);
  const szIm = new Float64Array(n * n);

  for (const band of BANDS) {
    const rng = createRng(seed + band.index * 7919);
    sxRe.fill(0);
    sxIm.fill(0);
    szRe.fill(0);
    szIm.fill(0);
    const kScale = (2 * Math.PI) / band.tile;
    // Each band twists its mean direction a little so the bands do not all line up.
    const bandAngle = windAngle + (rng() - 0.5) * 0.35;
    const half = n / 2;
    for (let ky = -half; ky < half; ky++) {
      for (let kx = -half; kx < half; kx++) {
        const kappa = Math.hypot(kx, ky);
        const [g0, g1] = gaussianPair(rng);
        if (kappa < BAND_RING_MIN || kappa >= BAND_RING_MAX) {
          continue;
        }
        const theta = Math.atan2(ky, kx) - bandAngle;
        const lobe = Math.abs(Math.cos(theta * 0.5)) ** (2 * band.spread);
        const directional = lobe + 0.05;
        // Elevation amplitude ~ k^-2 -> equal slope variance per log-wavenumber interval.
        const amp = Math.sqrt(directional) / (kappa * kappa);
        const hr = g0 * amp;
        const hi = g1 * amp;
        const kxw = kx * kScale;
        const kzw = ky * kScale;
        const ix = (kx + n) % n;
        const iy = (ky + n) % n;
        const idx = iy * n + ix;
        sxRe[idx] = -kxw * hi;
        sxIm[idx] = kxw * hr;
        szRe[idx] = -kzw * hi;
        szIm[idx] = kzw * hr;
      }
    }
    fft2d(sxRe, sxIm, n, true);
    fft2d(szRe, szIm, n, true);

    let ms = 0;
    for (let i = 0; i < n * n; i++) {
      ms += sxRe[i] * sxRe[i] + sxIm[i] * sxIm[i] + szRe[i] * szRe[i] + szIm[i] * szIm[i];
    }
    ms = (2 * ms) / (n * n);
    const scale = ms > 0 ? 1 / Math.sqrt(ms) : 0;
    const base = band.index * n * n * 4;
    for (let i = 0; i < n * n; i++) {
      const o = base + i * 4;
      out[o] = toHalf(sxRe[i] * scale);
      out[o + 1] = toHalf(sxIm[i] * scale);
      out[o + 2] = toHalf(szRe[i] * scale);
      out[o + 3] = toHalf(szIm[i] * scale);
    }
  }
  return { data: out, size: n, layers };
}
