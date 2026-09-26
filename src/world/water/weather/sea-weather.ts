/**
 * The weather's hold on the sea (phase 21 stage 6), as pure functions shared by the water system, the shader uniforms
 * and the headless checks:
 * - `seaWindU10`: the 10 m wind the spectrum is built from, the environment wind raised by a storm and gusting under
 *   rain (a storm preset alone would leave the sea at the environment wind's ~U10 9, too calm for "whitecaps
 *   everywhere");
 * - `rainRingParams`: the drop ring uniforms of the water shader (all zero without rain: the shader skips them);
 * - `rainRingSlope`: a JS port of the shader's ring function (statistics in the checks, not bit parity).
 */
import { RAIN_RINGS, SEA_WEATHER } from './config';

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

/** U10 (m/s) the sea is built from: the wind's own U10, at least `stormU10` x storm, gusting up with rain. */
export function seaWindU10(windU10: number, rain: number, storm: number): number {
  const base = Number.isFinite(windU10) ? Math.max(windU10, 0) : 0;
  const r = clamp01(Number.isFinite(rain) ? rain : 0);
  const s = clamp01(Number.isFinite(storm) ? storm : 0);
  const raised = Math.max(base, SEA_WEATHER.stormU10 * s) * (1 + SEA_WEATHER.rainGust * r);
  return Math.min(Math.max(raised, base), Math.max(SEA_WEATHER.maxU10, base));
}

export interface RainRingUniform {
  set(x: number, y: number, z: number, w: number): unknown;
}

/**
 * Fills the water shader's `uRainParams`: x = drop density per cell (0 = off), y = the rain clock (s, wrapped after
 * whole ring cycles), z = the detail bands' damping multiplier, w = the unresolved rings' mean square slope.
 */
export function rainRingParams(rain: number, time: number, out: RainRingUniform): void {
  const r = clamp01(Number.isFinite(rain) ? rain : 0);
  if (r < SEA_WEATHER.rainOn) {
    out.set(0, 0, 1, 0);
    return;
  }
  const wrap = RAIN_RINGS.period * RAIN_RINGS.wrapCycles;
  const t = Number.isFinite(time) ? ((time % wrap) + wrap) % wrap : 0;
  // Density grows faster than linearly at first: light rain already dots the water.
  const density = RAIN_RINGS.density * Math.sqrt(r);
  out.set(density, t, 1 - SEA_WEATHER.rainDamp * r, RAIN_RINGS.unresolvedVar * r);
}

/* JS port of the GLSL hashes (render/shaders/common.glsl.ts). */
const fract = (x: number): number => x - Math.floor(x);

function hash13(x: number, y: number, z: number): number {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.1031);
  let c = fract(z * 0.1031);
  const d = a * (c + 31.32) + b * (b + 31.32) + c * (a + 31.32);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

function hash33(x: number, y: number, z: number, out: number[]): void {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.103);
  let c = fract(z * 0.0973);
  // p3 += dot(p3, p3.yxz + 33.33)
  const d = a * (b + 33.33) + b * (a + 33.33) + c * (c + 33.33);
  a += d;
  b += d;
  c += d;
  // fract((p3.xxy + p3.yxx) * p3.zyx)
  out[0] = fract((a + b) * c);
  out[1] = fract((a + a) * b);
  out[2] = fract((b + a) * a);
}

const _h = [0, 0, 0];

/**
 * Slope (d height / dx, d height / dz) of the drop rings at world (x, z) and rain clock t with drop `density`
 * (uRainParams.x), as the water shader computes it (RAIN_RING_GLSL).
 */
export function rainRingSlope(x: number, z: number, t: number, density: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = 0;
  out.z = 0;
  if (!(density > 0)) {
    return out;
  }
  const R = RAIN_RINGS;
  for (let l = 0; l < 2; l++) {
    const qx = x / R.cell + l * 0.37;
    const qz = z / R.cell + l * 0.61;
    const cx = Math.floor(qx);
    const cz = Math.floor(qz);
    const ph = t / R.period + hash13(cx, cz, l * 17 + 1);
    const cyc = Math.floor(ph);
    const age = ph - cyc;
    hash33(cx, cz, cyc + l * 131, _h);
    if (_h[2] >= density) continue;
    const dx = (qx - cx - (0.3 + 0.4 * _h[0])) * R.cell;
    const dz = (qz - cz - (0.3 + 0.4 * _h[1])) * R.cell;
    const r = Math.hypot(dx, dz);
    const u = (r - age * R.ringMax) / R.width;
    const env = (1 - age) * (1 - age);
    // Height h = A env (-u) exp(-u^2): a crest outside the ring line, a trough inside; dh/dr = A env (2u^2 - 1) e^-u^2 / w.
    const dh = (R.amplitude / R.width) * env * (2 * u * u - 1) * Math.exp(-u * u);
    const inv = r > 1e-4 ? 1 / r : 0;
    out.x += dh * dx * inv;
    out.z += dh * dz * inv;
  }
  return out;
}
