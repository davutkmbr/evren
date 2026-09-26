/**
 * Phase 21 stage 7a check, headless (no browser, no GPU): the wind-wave spectrum and the wave particles.
 *
 *   npx tsx tools/headless/waves-check.ts          # all sections, exits 1 when a check fails
 *   npx tsx tools/headless/waves-check.ts --quick  # shorter runs
 *
 * 1. Spectrum statistics: the real sea (SeaState -> wave uniforms -> CPU evaluator) sampled as time series in the
 *    Golden Horn, the Bosphorus and the open sea for poyraz and lodos at U10 4..16 m/s: significant height (4 std)
 *    and peak period (periodogram) against the fetch-limited JONSWAP laws for each place's fetch class, growth with
 *    wind and fetch, and the mean propagation direction (from the in-phase orbital velocity) against the regime.
 *    The table printed here is the one in .docs/planning/21-sea.md.
 * 2. Kelvin wake: ships of several sizes and speeds emit wave particles for 150 s; the rms height on arcs behind the
 *    bow peaks on the cusp line at 19.5 +- 3 degrees for displacement speeds and inside it for a planing boat.
 * 3. Energy under subdivision: a ring train without damping keeps sum(a^2 l s) within 1 % through its splits, no
 *    particle ever gains amplitude, and the height field with subdivision matches the field without it.
 * 4. CPU / GPU parity: a JS port of the splat shader (the kernel at every texel centre, the wavelength filter) and of
 *    the water shader's bilinear window lookup against the CPU particle sum.
 * 5. Water service: heightAt / normalAt / velocityAt carry the particles (finite differences), the ambient part is
 *    untouched (the parity test in water-check.ts covers it), a hull does not feel its own waves.
 * 6. The dragon as a source: swimming (the real FlightSim floating on the real sea with its own waves), splashes,
 *    downstrokes.
 * 7. Budgets: the real high-preset fleet on the real sea with particles, camera over the Bosphorus / Karaköy: particle
 *    CPU (update + every query) per frame, pool use, the splat's fragment count (GPU estimate); quality tiers.
 * 8. Robustness: the same wake at dt 1/24, 1/60, 1/144 and jittered frame times, no NaNs anywhere, bad inputs ignored.
 */
import * as THREE from 'three';
import type { DragonState, WaterDynamicSample } from '../../src/core/contracts';
import { headingToYaw, latLonToLocal } from '../../src/core/geo-coords';
import { PHYSICS_DT, SWIM } from '../../src/dragon/flight/params';
import { clearPilotEdges, createPilotCommand } from '../../src/dragon/flight/types';
import { Fleet } from '../../src/world/life/vessels/fleet';
import { buildCatalog } from '../../src/world/life/vessels/catalog';
import { buildStraitLanes, placeBerths } from '../../src/world/life/vessels/routes';
import { GRAVITY, LODOS_DOWNWIND_DEG, POYRAZ_DOWNWIND_DEG, SEA_SPECTRUM } from '../../src/world/water/config';
import { LowFlightModel } from '../../src/world/water/lowflight/low-flight';
import { RING_WAVES, WATER_SOURCE, WAVE_PARTICLES, waveParticleQualityFor } from '../../src/world/water/particles/config';
import { DragonWaves } from '../../src/world/water/particles/dragon-waves';
import { SPLAT_MIN_TEXELS, splatWindow } from '../../src/world/water/particles/splat-gpu';
import { WAVE_SPLAT_FRAG, WAVE_SPLAT_VERT, WAVE_WATER_GLSL } from '../../src/world/water/particles/shaders.glsl';
import { WaveParticles } from '../../src/world/water/particles/wave-particles';
import { windSeaPeak } from '../../src/world/water/spectrum';
import { fetchFromExposure } from '../../src/world/water/bake/fetch';
import { WATER_FRAGMENT_GLSL } from '../../src/world/water/shaders/water-fragment.glsl';
import { WATER_VERTEX_GLSL } from '../../src/world/water/shaders/water-vertex.glsl';
import { buildHeadlessGeo } from './geo';
import { createHeadlessSim, LiftEnv } from './lift-sim';
import { createHeadlessSea, type SeaWind } from './water-sea';

const QUICK = process.argv.includes('--quick');
const failures: string[] = [];
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : 'nan');
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'nan');
const f3 = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : 'nan');
const DEG = Math.PI / 180;

function check(ok: boolean, label: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
  }
}

const newSample = (): WaterDynamicSample => ({ height: 0, slopeX: 0, slopeZ: 0, vx: 0, vy: 0, vz: 0 });
const t0 = Date.now();
const geo = buildHeadlessGeo();
const hs = createHeadlessSea(geo);
const waves = hs.waves;
console.log(`geo + sea ready in ${Date.now() - t0} ms`);

/* ---------------------------------------------------------------------------------------------- */
/* 1. Spectrum statistics                                                                         */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n1. Wind-wave spectrum: Hs (4 std) and Tp (periodogram) of the real sea, per place and wind');

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function findWater(lat0: number, lat1: number, lon0: number, lon1: number, coastMax: number, seed: number): { x: number; z: number } {
  const r = rng(seed);
  let best: { x: number; z: number; c: number } | null = null;
  for (let tries = 0; tries < 60000; tries++) {
    const p = latLonToLocal(lat0 + (lat1 - lat0) * r(), lon0 + (lon1 - lon0) * r());
    const c = geo.coastDistance(p.x, p.z);
    if (geo.heightAt(p.x, p.z) < -2 && c <= coastMax && (!best || c < best.c)) {
      best = { x: p.x, z: p.z, c };
      if (tries > 3000) break;
    }
  }
  if (!best) throw new Error('no water found');
  return best;
}

interface SpectrumPlace {
  name: string;
  x: number;
  z: number;
}
const places: SpectrumPlace[] = [
  { name: 'Golden Horn', ...findWater(41.028, 41.04, 28.948, 28.968, -40, 3) },
  { name: 'Bosphorus', ...findWater(41.06, 41.11, 29.03, 29.07, -250, 4) },
  { name: 'Marmara', ...findWater(40.9, 40.95, 28.92, 29.05, -4000, 5) },
  { name: 'Black Sea', ...findWater(41.225, 41.25, 29.05, 29.2, -3000, 6) },
];

interface ModelSea {
  /** Wind sea (every group but the swell) and swell at the place, from the uniforms and the group weights. */
  hsWind: number;
  hsSwell: number;
  /** Period of the wind-sea slot carrying the most energy at the place. */
  tpWind: number;
  /** Local fetch from the baked exposure map (m). */
  fetch: number;
}

/** The model's own decomposition at a place (the sea state must be advanced to the moment first). */
function modelSea(x: number, z: number): ModelSea {
  const w = [0, 0, 0, 0];
  const exposure = waves.groupWeightsAt(x, z, w);
  const amps = hs.sea.uniforms.uWaveAmp.value;
  const dirs = hs.sea.uniforms.uWaveDir.value;
  let m0w = 0;
  let m0s = 0;
  let best = 0;
  let tp = 0;
  for (let i = 0; i < amps.length; i++) {
    const a = amps[i];
    if (!(a.x > 0)) continue;
    const g = a.w < 0.5 ? 0 : a.w < 1.5 ? 1 : a.w < 2.5 ? 2 : 3;
    const e = (w[g] * a.x) ** 2 / 2;
    if (g === 2) {
      m0s += e;
    } else {
      m0w += e;
      if (e > best) {
        best = e;
        tp = (2 * Math.PI) / Math.sqrt(GRAVITY * dirs[i].z);
      }
    }
  }
  return { hsWind: 4 * Math.sqrt(m0w), hsSwell: 4 * Math.sqrt(m0s), tpWind: tp, fetch: fetchFromExposure(exposure) };
}

/** Time series at a point: Hs = 4 std of the real surface, mean direction of travel from eta * u. */
function measure(x: number, z: number, wind: SeaWind, u10: number): { hs: number; dirDeg: number; model: ModelSea } {
  hs.setWind(wind, u10);
  const n = QUICK ? 600 : 1600;
  const dt = 0.25;
  let s1 = 0;
  let s2 = 0;
  let ex = 0;
  let ez = 0;
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = 4000 + i * dt;
    hs.advance(t, dt, x, z);
    const eta = waves.heightAt(x, z);
    waves.orbitalVelocityAt(x, z, v);
    s1 += eta;
    s2 += eta * eta;
    ex += eta * v.x;
    ez += eta * v.z;
  }
  const mean = s1 / n;
  const std = Math.sqrt(Math.max(s2 / n - mean * mean, 0));
  // Direction the waves travel toward, as a compass heading (x = east, -z = north).
  const heading = ((Math.atan2(ex, -ez) / DEG) % 360 + 360) % 360;
  return { hs: 4 * std, dirDeg: heading, model: modelSea(x, z) };
}

const angleDiff = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
const winds = QUICK ? [4, 10, 16] : [4, 7, 10, 13, 16];
const table: string[] = [];
let hsOk = true;
let tpOk = true;
let realOk = true;
let growthOk = true;
let fetchOk = true;
let dirOk = true;
console.log('  regime  U10  place         fetch (km)  wind-sea Hs model / JONSWAP (m)  Tp model / JONSWAP (s)  swell Hs  surface Hs (4 std) / model  direction');
for (const wind of ['poyraz', 'lodos'] as const) {
  const lodos = wind === 'lodos';
  const prevHs = new Map<string, number>();
  const cap = lodos ? SEA_SPECTRUM.fetchLongLodos : SEA_SPECTRUM.fetchLongPoyraz;
  for (const u10 of winds) {
    const byPlace = new Map<string, number>();
    for (const place of places) {
      const m = measure(place.x, place.z, wind, u10);
      const md = m.model;
      // Effective fetch: the local fetch, capped by the duration-limited growth of the long class.
      const fetch = Math.min(md.fetch, cap);
      const j = windSeaPeak(u10, fetch);
      const hsRatio = md.hsWind / j.hs;
      // A peak shorter than the lattice's shortest wave (2.2 m) lives in the detail bands (normals only): the Gerstner
      // sea there only has to stay small (a few cm).
      const lambdaP = (GRAVITY * j.tp * j.tp) / (2 * Math.PI);
      const okHs = (hsRatio >= 0.6 && hsRatio <= 1.5) || (lambdaP < 2.2 && md.hsWind < 0.1 && hsRatio <= 2);
      // The lattice quantises the peak (periods step by ~1.18) and holds a peak beyond its longest slot (6.35 s) there.
      // Peaks shorter than the lattice's shortest wave (2.2 m, 1.19 s) are the detail bands' job: the chop slots stand in.
      const floorTp = (2 * Math.PI) / Math.sqrt((GRAVITY * 2 * Math.PI) / 2.2);
      const okTp = (md.tpWind / j.tp >= 0.72 && md.tpWind / j.tp <= 1.4) || (j.tp > 6.35 && md.tpWind > 6.3) || (j.tp < floorTp * 1.1 && md.tpWind <= floorTp * 1.45);
      const total = Math.hypot(md.hsWind, md.hsSwell);
      const okReal = Math.abs(m.hs / total - 1) < 0.2;
      const open = (lodos && place.name === 'Marmara') || (!lodos && place.name === 'Black Sea');
      const downwind = lodos ? LODOS_DOWNWIND_DEG : POYRAZ_DOWNWIND_DEG;
      const dOk = !open || angleDiff(m.dirDeg, downwind) < 30;
      hsOk &&= okHs;
      tpOk &&= okTp;
      realOk &&= okReal;
      dirOk &&= dOk;
      const last = prevHs.get(place.name);
      if (last !== undefined && md.hsWind < last * 0.98) growthOk = false;
      prevHs.set(place.name, md.hsWind);
      byPlace.set(place.name, md.hsWind);
      console.log(
        `  ${wind.padEnd(7)} ${String(u10).padStart(3)}  ${place.name.padEnd(12)} ${f1(md.fetch / 1000).padStart(8)}      ${f2(md.hsWind).padStart(5)} / ${f2(j.hs).padStart(5)}${okHs ? ' ' : '*'}                  ${f1(md.tpWind).padStart(4)} / ${f1(j.tp).padStart(4)}${okTp ? ' ' : '*'}           ${f2(md.hsSwell).padStart(5)}     ${f2(m.hs).padStart(5)} / ${f2(total).padStart(5)}${okReal ? ' ' : '*'}          ${open ? `${f1(m.dirDeg)}°${dOk ? '' : ' *'}` : ''}`,
      );
      table.push(`| ${wind} | ${u10} | ${place.name} | ${f1(md.fetch / 1000)} | ${f2(md.hsWind)} | ${f2(j.hs)} | ${f1(md.tpWind)} | ${f1(j.tp)} | ${f2(md.hsSwell)} | ${f2(m.hs)} |`);
    }
    const open = lodos ? byPlace.get('Marmara')! : byPlace.get('Black Sea')!;
    if (!(byPlace.get('Golden Horn')! < byPlace.get('Bosphorus')! && byPlace.get('Bosphorus')! < open)) fetchOk = false;
  }
}
check(hsOk, 'wind-sea Hs within 0.6–1.5x of JONSWAP at the local (baked) fetch, capped by the duration-limited long fetch');
check(tpOk, 'wind-sea peak period within 0.72–1.4x of JONSWAP at the local fetch (lattice-quantised)');
check(realOk, "the surface realises the spectrum: 4 std of the CPU height series within 20 % of the model's Hs");
check(growthOk, 'Hs grows with U10 everywhere');
check(fetchOk, 'Hs grows with fetch: Golden Horn < Bosphorus < the open sea of the regime (Marmara in a lodos, Black Sea in a poyraz)');
check(dirOk, 'open-sea waves travel downwind: poyraz toward SSW (212°), lodos toward NE (38°), within 30°');

/* ---------------------------------------------------------------------------------------------- */
/* 2. Kelvin wake                                                                                 */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n2. Kelvin wake from the particle field (rms height on arcs 120–320 m behind the bow)');

function runShip(U: number, L: number, B: number, T: number, seconds: number, dt: number | (() => number), wp: WaveParticles): number {
  let x = 0;
  let t = 0;
  while (t < seconds) {
    const d = typeof dt === 'number' ? dt : dt();
    t += d;
    x += U * d;
    wp.hull(1, x, 0, 1, 0, U, L, B, T);
    wp.update(d);
  }
  return x;
}

function wakeProfile(wp: WaveParticles, apex: number, dMin = 120, dMax = 320): { peak: number; edge: number; env: Float64Array } {
  const out = newSample();
  const N = 41;
  const env = new Float64Array(N);
  for (let D = dMin; D <= dMax; D += 10) {
    for (let ai = 0; ai < N; ai++) {
      const ang = ai * DEG;
      for (let dr = -15; dr <= 15; dr += 0.75) {
        for (const side of [-1, 1]) {
          wp.sample(apex - (D + dr) * Math.cos(ang), side * (D + dr) * Math.sin(ang), out);
          env[ai] += out.height * out.height;
        }
      }
    }
  }
  let peak = 0;
  for (let i = 0; i < N; i++) if (env[i] > env[peak]) peak = i;
  let edge = peak;
  while (edge < N - 1 && env[edge] > 0.5 * env[peak]) edge++;
  return { peak, edge, env };
}

const ships = [
  { name: 'tour boat', U: 6, L: 30, B: 7.2, T: 1.6 },
  { name: 'vapur', U: 7, L: 72, B: 13.2, T: 3.1 },
  { name: 'fishing boat', U: 4, L: 9.5, B: 3.2, T: 0.8 },
  { name: 'yacht', U: 10, L: 24, B: 6, T: 1.6 },
  { name: 'motorboat (planing)', U: 14, L: 8.5, B: 2.8, T: 0.3 },
];
let kelvinOk = true;
for (const sh of ships) {
  const wp = new WaveParticles({ ...waveParticleQualityFor('ultra'), pool: 20000 });
  wp.unlimitedRange = true;
  const x = runShip(sh.U, sh.L, sh.B, sh.T, 150, 1 / 60, wp);
  const prof = wakeProfile(wp, x + 0.45 * sh.L);
  const fr = sh.U / Math.sqrt(GRAVITY * sh.L);
  const planing = fr > 1;
  const ok = planing ? prof.peak <= 19.5 && prof.edge <= 22.5 : Math.abs(prof.peak - 19.5) <= 3;
  if (!planing) kelvinOk &&= ok;
  else if (!ok) kelvinOk = false;
  console.log(`  ${sh.name.padEnd(20)} U ${sh.U} m/s, Fr ${f2(fr)}: ${wp.count} particles, rms peak (cusp) at ${prof.peak}°, half-max edge ${prof.edge}°${ok ? '' : '  <--'}`);
}
check(kelvinOk, 'Kelvin cusp line at 19.5° ± 3° for displacement hulls; a planing boat\'s wake no wider (narrower peak)');

/* ---------------------------------------------------------------------------------------------- */
/* 3. Energy under subdivision                                                                    */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n3. Energy under subdivision (ring trains, damping off)');
{
  const make = (maxGen: number, lambda: number): WaveParticles => {
    const wp = new WaveParticles({ ...waveParticleQualityFor('ultra'), pool: 20000 });
    wp.unlimitedRange = true;
    wp.dampingScale = 0;
    wp.maxGeneration = maxGen;
    wp.ring(WATER_SOURCE.splash, 0, 0, 0.5, lambda);
    return wp;
  };
  const a = make(4, 5);
  const b = make(0, 5);
  const dt = 1 / 60;
  let e0 = 0;
  let maxDev = 0;
  let prevMax = Infinity;
  let gained = false;
  let splitErrA = -1;
  let splitErrB = -1;
  const s1 = newSample();
  const s2 = newSample();
  /** rms difference of the fields of p and q (or p and the exact circular ring) on a polar grid, relative to q's rms. */
  const compare = (p: WaveParticles, q: WaveParticles | null, rMin: number, rMax: number): number => {
    let d = 0;
    let n = 0;
    for (let r = rMin; r < rMax; r += 0.37) {
      for (let k = 0; k < 90; k++) {
        const ang = (k / 90) * 2 * Math.PI + 0.013;
        p.sample(r * Math.cos(ang), r * Math.sin(ang), s1);
        let ref: number;
        if (q) {
          ref = q.sample(r * Math.cos(ang), r * Math.sin(ang), s2).height;
        } else {
          ref = ringExact(p, r);
        }
        d += (s1.height - ref) ** 2;
        n += ref * ref;
      }
    }
    return Math.sqrt(d / Math.max(n, 1e-12));
  };
  /** The exact circular train: every ring of the train at its radius, amplitude and phase (no angular discretisation). */
  const ringExact = (p: WaveParticles, r: number): number => {
    let h = 0;
    for (let t = 0; t < RING_WAVES.lambdas.length; t++) {
      const lambda = Math.max(WAVE_PARTICLES.minLambda, 5 * RING_WAVES.lambdas[t]);
      const k = (2 * Math.PI) / lambda;
      const om = Math.sqrt(GRAVITY * k);
      const cg = om / (2 * k);
      const r0 = Math.max(RING_WAVES.radiusMin, RING_WAVES.radiusLambda * lambda);
      const s = RING_WAVES.packet * lambda;
      const age = p.now;
      const rc = r0 + cg * age;
      const q = r - rc;
      if (Math.abs(q) >= s) continue;
      const amp = 0.5 * RING_WAVES.shares[t] * Math.sqrt(r0 / rc) * Math.min(1, age / WAVE_PARTICLES.fadeIn);
      h += amp * (0.5 + 0.5 * Math.cos((Math.PI * q) / s)) * Math.cos(k * (rc - r0) - om * age + k * q);
    }
    return h;
  };
  let exactLate = 0;
  let noSplitLate = 0;
  for (let t = 0; t < 40; t += dt) {
    const splitsBefore = a.stats.splits;
    a.update(dt);
    b.update(dt);
    // The very update of the first split: the field must not jump (b is identical up to here, minus the split).
    if (splitsBefore === 0 && a.stats.splits > 0 && splitErrA < 0) {
      splitErrA = compare(a, null, 0.5, 60);
      splitErrB = compare(b, null, 0.5, 60);
    }
    if (Math.abs(t - 25) < dt / 2) {
      exactLate = compare(a, null, 30, 110);
      noSplitLate = compare(b, null, 30, 110);
    }
    if (t < 0.5) continue;
    const e = a.energy();
    if (e0 === 0) e0 = e;
    maxDev = Math.max(maxDev, Math.abs(e / e0 - 1));
    const m = a.maxAmplitude();
    if (m > prevMax * (1 + 1e-9)) gained = true;
    prevMax = m;
  }
  console.log(`  splits ${a.stats.splits}, particles ${a.count} (without subdivision ${b.count}); energy sum(a² l s) drift max ${f3(maxDev * 100)} %; amplitude ever grew: ${gained}`);
  console.log(`  height field vs the exact circular ring: at the first split ${f1(splitErrA * 100)} % (unsplit ${f1(splitErrB * 100)} %), after 25 s ${f1(exactLate * 100)} % (unsplit ${f1(noSplitLate * 100)} %)`);
  check(a.stats.splits >= 24 && maxDev < 0.01, 'wave energy conserved through subdivision (drift < 1 % over 40 s with ≥ 24 splits)');
  check(!gained, 'no particle ever gains amplitude');
  check(splitErrA >= 0 && splitErrA <= splitErrB + 0.02, 'a split never moves the field away from the true circular front (at the split, no worse than unsplit)');
  check(exactLate < 0.25 && exactLate < 0.5 * noSplitLate, 'subdivision keeps the front circular (field within 25 % of the exact ring, far better than without)');
  // With damping: energy only decreases.
  const c = new WaveParticles({ ...waveParticleQualityFor('ultra'), pool: 20000 });
  c.unlimitedRange = true;
  c.ring(WATER_SOURCE.splash, 0, 0, 0.5, 4);
  let prev = Infinity;
  let rose = false;
  for (let t = 0; t < 30; t += dt) {
    c.update(dt);
    if (t < 0.5) continue;
    const e = c.energy();
    if (e > prev * (1 + 1e-9)) rose = true;
    prev = e;
  }
  check(!rose, 'with damping the particle energy only decreases');
}

/* ---------------------------------------------------------------------------------------------- */
/* 4. CPU / GPU parity                                                                            */
/* ---------------------------------------------------------------------------------------------- */
console.log("\n4. CPU / GPU parity: JS port of the splat shader + the water shader's window lookup vs the CPU sum");
{
  const wp = new WaveParticles({ ...waveParticleQualityFor('high'), pool: 20000 });
  wp.unlimitedRange = true;
  const x = runShip(7, 40, 9, 2, 60, 1 / 60, wp);
  wp.ring(WATER_SOURCE.splash, x - 120, 60, 0.3, 8);
  for (let t = 0; t < 4; t += 1 / 60) {
    wp.hull(1, x, 0, 1, 0, 7, 40, 9, 2);
    wp.update(1 / 60);
  }
  const fr = Math.fround;
  const smooth = (a: number, b: number, v: number): number => {
    const t = Math.min(Math.max((v - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  for (const tier of ['medium', 'high', 'ultra'] as const) {
    const q = waveParticleQualityFor(tier);
    const w = splatWindow(x - 150, 0, q.splatSize, q.splatTexel, { minX: 0, minZ: 0, extent: 0 });
    const size = q.splatSize;
    const texel = q.splatTexel;
    const grid = new Float64Array(size * size * 3);
    const data = new Float32Array(wp.capacity * 12);
    const minLambda = SPLAT_MIN_TEXELS * texel;
    const count = wp.writeSplat(w.minX, w.minZ, w.extent, data, wp.capacity, minLambda);
    // Every particle, short waves included (the formula check), and what the window carries (the splat).
    const dataAll = new Float32Array(wp.capacity * 12);
    const countAll = wp.writeSplat(w.minX, w.minZ, w.extent, dataAll, wp.capacity, 0);
    let frags = 0;
    /** WAVE_SPLAT_FRAG at a point (window coordinates), fp32 inputs as uploaded; `filter` = the wavelength fade. */
    const kernel = (buf: Float32Array, o: number, px: number, pz: number, out: number[], filter: boolean): boolean => {
      const cx = buf[o];
      const cz = buf[o + 1];
      const dx = buf[o + 2];
      const dz = buf[o + 3];
      const ell = buf[o + 4];
      const s = buf[o + 5];
      const k = buf[o + 6];
      const phc = buf[o + 7];
      const lambda = (2 * Math.PI) / Math.max(k, 1e-4);
      const A = buf[o + 8] * (filter ? smooth(0.5 * minLambda, minLambda, lambda) : 1);
      const rx = px - cx;
      const rz = pz - cz;
      const q_ = rx * dx + rz * dz;
      const f = rx * -dz + rz * dx;
      if (Math.abs(f) >= ell || Math.abs(q_) >= s) return false;
      const wf = 0.5 + 0.5 * Math.cos((Math.PI * f) / ell);
      const wq = 0.5 + 0.5 * Math.cos((Math.PI * q_) / s);
      const dwf = (-0.5 * Math.PI * Math.sin((Math.PI * f) / ell)) / ell;
      const dwq = (-0.5 * Math.PI * Math.sin((Math.PI * q_) / s)) / s;
      const ph = k * q_ + phc;
      const c = Math.cos(ph);
      const sn = Math.sin(ph);
      const gq = A * wf * (dwq * c - wq * k * sn);
      const gf = A * wq * dwf * c;
      out[0] += A * wf * wq * c;
      out[1] += dx * gq - dz * gf;
      out[2] += dz * gq + dx * gf;
      return true;
    };
    const acc = [0, 0, 0];
    for (let m = 0; m < count; m++) {
      const o = m * 12;
      const ex = Math.abs(data[o + 2]) * data[o + 5] + Math.abs(data[o + 3]) * data[o + 4];
      const ez = Math.abs(data[o + 3]) * data[o + 5] + Math.abs(data[o + 2]) * data[o + 4];
      const i0 = Math.max(0, Math.floor((data[o] - ex) / texel));
      const i1 = Math.min(size - 1, Math.ceil((data[o] + ex) / texel));
      const j0 = Math.max(0, Math.floor((data[o + 1] - ez) / texel));
      const j1 = Math.min(size - 1, Math.ceil((data[o + 1] + ez) / texel));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          acc[0] = acc[1] = acc[2] = 0;
          if (kernel(data, o, fr((i + 0.5) * texel), fr((j + 0.5) * texel), acc, true)) {
            const g = (j * size + i) * 3;
            grid[g] += acc[0];
            grid[g + 1] += acc[1];
            grid[g + 2] += acc[2];
            frags++;
          }
        }
      }
    }
    /** The water shader's lookup: bilinear, clamp to edge, faded over the outer 6 %. */
    const lookup = (wx: number, wz: number): number[] => {
      const u = (wx - w.minX) / w.extent;
      const v = (wz - w.minZ) / w.extent;
      const edge = smooth(0, 0.06, Math.min(u, 1 - u, v, 1 - v));
      const fx = u * size - 0.5;
      const fz = v * size - 0.5;
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      const tx = fx - ix;
      const tz = fz - iz;
      const res = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const at = (a: number, b: number): number => grid[(Math.min(size - 1, Math.max(0, b)) * size + Math.min(size - 1, Math.max(0, a))) * 3 + c];
        res[c] = ((at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz) * edge;
      }
      return res;
    };
    const r = rng(7);
    const s = newSample();
    let formulaErr = 0;
    let reconMax = 0;
    let reconErr2 = 0;
    let filtH2 = 0;
    let filtMax = 0;
    let shortErr2 = 0;
    let cpuH2 = 0;
    for (let k = 0; k < 3000; k++) {
      // Away from the edge fade (the physics near the camera sees the same water).
      const px = w.minX + w.extent * (0.08 + 0.84 * r());
      const pz = w.minZ + w.extent * (0.08 + 0.84 * r());
      wp.sample(px, pz, s);
      const exact = [0, 0, 0];
      const filtered = [0, 0, 0];
      for (let m = 0; m < countAll; m++) kernel(dataAll, m * 12, px - w.minX, pz - w.minZ, exact, false);
      for (let m = 0; m < count; m++) kernel(data, m * 12, px - w.minX, pz - w.minZ, filtered, true);
      formulaErr = Math.max(formulaErr, Math.abs(exact[0] - s.height), 0.1 * Math.hypot(exact[1] - s.slopeX, exact[2] - s.slopeZ));
      const g = lookup(px, pz);
      const e = Math.abs(g[0] - filtered[0]);
      reconMax = Math.max(reconMax, e);
      reconErr2 += e * e;
      filtH2 += filtered[0] * filtered[0];
      filtMax = Math.max(filtMax, Math.abs(filtered[0]));
      shortErr2 += (g[0] - s.height) ** 2;
      cpuH2 += s.height * s.height;
    }
    const recon = Math.sqrt(reconErr2 / Math.max(filtH2, 1e-12));
    const total = Math.sqrt(shortErr2 / Math.max(cpuH2, 1e-12));
    const gpuMs = (frags / 3e9) * 1000 + 0.03;
    console.log(
      `  ${tier.padEnd(6)} ${size}² x ${texel} m: ${count} particles, ${(frags / 1e6).toFixed(2)} M fragments (~${f3(gpuMs)} ms); kernel = CPU within ${(formulaErr * 1000).toFixed(4)} mm; texel reconstruction max ${f1(reconMax * 100)} cm (of ${f1(filtMax * 100)} cm), rms ${f1(recon * 100)} %; window vs CPU incl. the waves shorter than ${f1(minLambda)} m the window drops: rms ${f1(total * 100)} %`,
    );
    check(formulaErr < 1e-4, `${tier}: the splat shader's kernel is the CPU particle formula (within 0.1 mm)`);
    check(reconMax < Math.max(0.02, 0.15 * filtMax) && recon < 0.06, `${tier}: the water's window lookup reconstructs the splat (max ${f1(reconMax * 100)} cm < 15 % of the peak, rms ${f1(recon * 100)} % < 6 %)`);
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* 5. Water service                                                                               */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n5. Water service: the particles in heightAt / normalAt / velocityAt');
{
  hs.setWind('poyraz', 3);
  const spot = latLonToLocal(40.93, 28.98);
  const wp = new WaveParticles({ ...waveParticleQualityFor('high'), pool: 8000 });
  wp.coast = (x, z) => geo.coastDistance(x, z);
  wp.setFocus(spot.x, spot.z);
  waves.dynamic = wp;
  let t = 5000;
  let sx = spot.x - 200;
  for (let i = 0; i < 60 * 40; i++) {
    t += 1 / 60;
    sx += 7 / 60;
    hs.advance(t, 1 / 60, spot.x, spot.z);
    wp.hull(1, sx, spot.z, 1, 0, 7, 40, 9, 2);
    wp.update(1 / 60);
  }
  hs.advance(t, 0, spot.x, spot.z);
  const r = rng(3);
  const n = new THREE.Vector3();
  const v = new THREE.Vector3();
  const s = newSample();
  let maxDiffH = 0;
  let maxSlopeErr = 0;
  let maxDyn = 0;
  let maxVyErr = 0;
  for (let k = 0; k < 400; k++) {
    const x = sx - 30 - 150 * r();
    const z = spot.z + (r() - 0.5) * 120;
    const h = waves.heightAt(x, z);
    const amb = waves.ambientHeightAt(x, z);
    wp.sample(x, z, s);
    maxDyn = Math.max(maxDyn, Math.abs(s.height));
    maxDiffH = Math.max(maxDiffH, Math.abs(h - amb - s.height));
    // Normal vs finite differences of heightAt.
    const e = 0.05;
    const gx = (waves.heightAt(x + e, z) - waves.heightAt(x - e, z)) / (2 * e);
    const gz = (waves.heightAt(x, z + e) - waves.heightAt(x, z - e)) / (2 * e);
    waves.normalAt(x, z, n);
    maxSlopeErr = Math.max(maxSlopeErr, Math.hypot(-n.x / n.y - gx, -n.z / n.y - gz));
    waves.orbitalVelocityAt(x, z, v);
    // Vertical velocity of the particle part vs its time derivative (the next update, 1/60 s later).
    const hA = s.height;
    wp.update(1 / 600);
    wp.sample(x, z, s);
    maxVyErr = Math.max(maxVyErr, Math.abs((s.height - hA) / (1 / 600) - s.vy));
  }
  console.log(`  poyraz 3 m/s + a 7 m/s ship's wake: particle heights up to ${f2(maxDyn)} m; heightAt - ambient - particles max ${(maxDiffH * 1000).toFixed(3)} mm; normal vs finite differences max slope error ${f3(maxSlopeErr)}; particle vy vs d/dt max ${f3(maxVyErr)} m/s`);
  check(maxDyn > 0.05 && maxDiffH < 1e-6, 'heightAt = ambient waves + particles (the dragon and hulls float on the wakes)');
  check(maxSlopeErr < 0.03, 'normalAt includes the particle slope (matches finite differences within 0.03)');
  check(maxVyErr < 0.05, 'the particles\' vertical velocity is the time derivative of their height (within 5 cm/s)');
  // Exclusion: a hull does not see its own waves.
  wp.exclude = 1;
  const x = sx - 60;
  const own = wp.sample(x, spot.z + 25, s).height;
  wp.exclude = -1;
  const all = wp.sample(x, spot.z + 25, s).height;
  console.log(`  own-wave exclusion at 25 m abeam, 60 m astern: with ${f3(all)} m, excluded ${f3(own)} m`);
  check(own === 0 && all !== 0, 'a source excluded from the queries does not feel its own waves');
  waves.dynamic = undefined;
}

/* ---------------------------------------------------------------------------------------------- */
/* 6. The dragon as a source                                                                      */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n6. The dragon: swimming on its own waves, splashes, downstrokes');
{
  hs.setWind('poyraz', 5);
  const spot = latLonToLocal(40.93, 28.98);
  const wp = new WaveParticles(waveParticleQualityFor('high'));
  wp.coast = (x, z) => geo.coastDistance(x, z);
  waves.dynamic = wp;
  const dragonWaves = new DragonWaves(wp);
  const low = new LowFlightModel();
  const env = new LiftEnv(11, 'calm');
  const sim = createHeadlessSim(geo, env);
  sim.options.turbulence = false;
  sim.options.thermals = false;
  sim.queueEvents = false;
  sim.world.water = waves;
  let time = 7000;
  hs.advance(time, 0, spot.x, spot.z);
  sim.teleport(spot.x, 0, spot.z, headingToYaw(90), 0, 0);
  sim.placeOnGround();
  const cmd = createPilotCommand();
  const FRAME = 1 / 60;
  const SUB = Math.round(FRAME / PHYSICS_DT);
  let n = 0;
  let sumE = 0;
  let sumE2 = 0;
  let maxE = 0;
  let bad = false;
  const state = { mode: sim.mode, position: sim.body.position, velocity: sim.body.velocity } as unknown as DragonState;
  for (let f = 0; f < 60 * 40; f++) {
    const p = sim.body.position;
    hs.advance(time, FRAME, p.x, p.z);
    (state as { mode: string }).mode = sim.mode;
    wp.setFocus(p.x, p.z, p.x, p.z);
    dragonWaves.update(state, low, waves);
    wp.update(FRAME);
    for (let s = 0; s < SUB; s++) {
      cmd.pitch = 0;
      cmd.roll = 0;
      cmd.yaw = 0;
      cmd.flap = false;
      cmd.dive = false;
      cmd.brake = false;
      cmd.fire = false;
      clearPilotEdges(cmd);
      // W (swim forward) for the first 30 s, with a gentle turn.
      cmd.pitch = f < 60 * 30 ? 0.8 : 0;
      cmd.roll = f % 600 < 120 ? 0.4 : 0;
      sim.step(PHYSICS_DT, cmd);
      time += PHYSICS_DT;
    }
    if (!Number.isFinite(p.x + p.y + p.z)) bad = true;
    if (sim.mode === 'swimming' && f > 120) {
      const e = p.y + SWIM.floatDepth - waves.heightAt(p.x, p.z);
      n++;
      sumE += e;
      sumE2 += e * e;
      maxE = Math.max(maxE, Math.abs(e));
    }
  }
  const speed = Math.hypot(sim.body.velocity.x, sim.body.velocity.z);
  console.log(`  swimming 40 s (W then drift): ${wp.stats.emitted} particles emitted, ${wp.count} alive; float height - surface mean ${f3(sumE / Math.max(n, 1))} m, rms ${f3(Math.sqrt(sumE2 / Math.max(n, 1)))} m, max ${f2(maxE)} m; still swimming ${sim.mode === 'swimming'}, speed at the end ${f2(speed)} m/s`);
  check(!bad && sim.mode === 'swimming' && n > 0, 'the swimming dragon stays afloat and finite on its own waves');
  check(wp.stats.emitted > 50, 'a swimming dragon makes a wake (bow and stern particles)');
  check(Math.abs(sumE / Math.max(n, 1)) < 0.1 && Math.sqrt(sumE2 / Math.max(n, 1)) < 0.25, 'its float still tracks the surface (mean < 0.1 m, rms < 0.25 m)');
  // Splash events.
  const before = wp.stats.emitted;
  dragonWaves.splash(spot.x + 50, spot.z, 2.8, state);
  const plunge = wp.stats.emitted - before;
  (state as { mode: string }).mode = 'underwater';
  const b2 = wp.stats.emitted;
  dragonWaves.splash(spot.x + 50, spot.z, 0.06, state);
  const bubbles = wp.stats.emitted - b2;
  console.log(`  a plunge splash (strength 2.8) starts ${plunge} particles; a bubble splash under water ${bubbles}`);
  check(plunge >= 12 && bubbles === 0, 'splashes start ring trains; the nostril bubbles under water do not');
  waves.dynamic = undefined;
}

/* ---------------------------------------------------------------------------------------------- */
/* 7. Budgets                                                                                     */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n7. Budgets: high-preset fleet on the real sea with wave particles');
const models = await buildCatalog();
const berths = placeBerths(geo);
const lanes = buildStraitLanes(geo);
{
  hs.setWind('poyraz', 8);
  const wp = new WaveParticles(waveParticleQualityFor('high'));
  wp.coast = (x, z) => geo.coastDistance(x, z);
  waves.dynamic = wp;
  const fleet = new Fleet({ geo, models, berths, lanes, shipCount: 70, water: waves }, new THREE.MeshBasicMaterial());
  const cams = [
    { name: 'Karaköy', ...latLonToLocal(41.0215, 28.978) },
    { name: 'Bosphorus (Beşiktaş)', ...latLonToLocal(41.04, 29.012) },
  ];
  for (const camSpot of cams) {
    const cam = new THREE.Vector3(camSpot.x, 60, camSpot.z);
    wp.clear();
    const dt = 1 / 60;
    let t = 6000;
    const upd: number[] = [];
    const qry: number[] = [];
    const counts: number[] = [];
    const frames = (QUICK ? 60 : 120) * 60;
    // Per-query cost measured on the live field.
    let queryUs = 0;
    const hq = waveParticleQualityFor('high');
    const win = splatWindow(cam.x, cam.z, hq.splatSize, hq.splatTexel, { minX: 0, minZ: 0, extent: 0 });
    const splatData = new Float32Array(wp.capacity * 12);
    let worstFrags = 0;
    let worstSplat = 0;
    for (let f = 0; f < frames; f++) {
      t += dt;
      hs.advance(t, dt, cam.x, cam.z);
      wp.setFocus(cam.x, cam.z);
      const q0 = wp.stats.queries;
      const qa = performance.now();
      fleet.update(dt, cam);
      const fleetMs = performance.now() - qa;
      const queries = wp.stats.queries - q0;
      wp.update(dt);
      if (f > 60 * 20 && f % 30 === 0) {
        const m = wp.writeSplat(win.minX, win.minZ, win.extent, splatData, wp.capacity, SPLAT_MIN_TEXELS * hq.splatTexel);
        let area = 0;
        for (let i = 0; i < m; i++) {
          const o = i * 12;
          area += (2 * splatData[o + 4] + hq.splatTexel) * (2 * splatData[o + 5] + hq.splatTexel);
        }
        const frags = area / (hq.splatTexel * hq.splatTexel);
        if (frags > worstFrags) {
          worstFrags = frags;
          worstSplat = m;
        }
      }
      if (f > 60 * 20) {
        upd.push(wp.stats.updateMs);
        counts.push(wp.count);
        qry.push(queries);
      }
      if (f === frames - 1) {
        const out = newSample();
        const r = rng(11);
        const a = performance.now();
        for (let k = 0; k < 20000; k++) wp.sample(cam.x + (r() - 0.5) * 1200, cam.z + (r() - 0.5) * 1200, out);
        queryUs = ((performance.now() - a) * 1000) / 20000;
      }
      void fleetMs;
    }
    const sorted = [...upd].sort((a, b) => a - b);
    const avg = upd.reduce((a, b) => a + b, 0) / upd.length;
    const p95 = sorted[Math.floor(0.95 * sorted.length)];
    const avgQ = qry.reduce((a, b) => a + b, 0) / qry.length;
    const avgN = counts.reduce((a, b) => a + b, 0) / counts.length;
    const maxN = Math.max(...counts);
    // Queries of the dragon, camera, fx and low-flight model on top of the vessels' (~40 a frame while low).
    const queryMs = ((avgQ + 40) * queryUs) / 1000;
    const total = avg + queryMs;
    console.log(`  camera at ${camSpot.name}: particles avg ${f1(avgN)} (max ${maxN}, pool ${wp.capacity}), hull emitters ${wp.stats.hulls}; update ${f3(avg)} ms avg / ${f3(p95)} p95; ${f1(avgQ)} vessel queries/frame x ${f2(queryUs)} µs (+40 other) = ${f3(queryMs)} ms; particle CPU ≈ ${f3(total)} ms/frame; dropped ${wp.stats.dropped}`);
    check(total <= 0.5, `${camSpot.name}: wave particle CPU ≤ 0.5 ms per frame (${f3(total)} ms)`);
    check(maxN <= wp.capacity, `${camSpot.name}: the pool cap holds (${maxN} ≤ ${wp.capacity})`);
    // GPU estimate: the busiest frame's quad fragments inside the high window (sampled every half second).
    const gpuMs = (worstFrags / 3e9) * 1000 + 0.03;
    console.log(`  splat window (high 512² x 1 m), busiest frame: ${worstSplat} particles, ${(worstFrags / 1e6).toFixed(2)} M quad fragments ≈ ${f3(gpuMs)} ms at 3 Gfrag/s + clear and lookups (estimate; the owner measures on the GPU)`);
    check(gpuMs <= 0.4, `${camSpot.name}: splat GPU estimate ≤ 0.4 ms on high (${f3(gpuMs)} ms)`);
  }
  // Quality tiers: low keeps particles only around the dragon and draws none.
  const low = waveParticleQualityFor('low');
  const lw = new WaveParticles(low);
  lw.setFocus(0, 0, 0, 0);
  lw.hull(5, 600, 0, 1, 0, 7, 40, 9, 2);
  const far = lw.stats.emitted;
  lw.hull(6, 100, 0, 1, 0, 7, 40, 9, 2);
  const near = lw.stats.emitted - far;
  console.log(`  low: pool ${low.pool}, splat ${low.splatSize ? 'on' : 'off'}; a hull 600 m from the dragon emits ${far}, one 100 m away ${near}`);
  check(low.splatSize === 0 && far === 0 && near > 0, 'low: spectrum only on screen (no splat), CPU particles only near the dragon');
  check(waveParticleQualityFor('medium').pool < waveParticleQualityFor('high').pool && waveParticleQualityFor('high').pool <= waveParticleQualityFor('ultra').pool, 'pool sizes scale with the quality tier');
  waves.dynamic = undefined;
}

/* ---------------------------------------------------------------------------------------------- */
/* 8. Robustness                                                                                  */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n8. Robustness: frame rates, NaNs, bad inputs');
{
  const field = (dt: number | (() => number)): { h: Float64Array; bad: boolean; count: number } => {
    const wp = new WaveParticles({ ...waveParticleQualityFor('ultra'), pool: 20000 });
    wp.unlimitedRange = true;
    const x = runShip(7, 40, 9, 2, 60, dt, wp);
    const out = newSample();
    const h = new Float64Array(2000);
    let bad = false;
    const r = rng(5);
    for (let k = 0; k < h.length; k++) {
      wp.sample(x - 20 - 250 * r(), (r() - 0.5) * 200, out);
      h[k] = out.height;
      if (!Number.isFinite(out.height + out.slopeX + out.slopeZ + out.vx + out.vy + out.vz)) bad = true;
    }
    return { h, bad, count: wp.count };
  };
  let seed = 9;
  const jitter = (): number => {
    seed = (seed * 16807) % 2147483647;
    return 1 / 144 + (seed / 2147483647) * (1 / 12);
  };
  const a = field(1 / 24);
  const b = field(1 / 60);
  const c = field(1 / 144);
  const j = field(jitter);
  const rel = (p: Float64Array, q: Float64Array): number => {
    let d = 0;
    let s = 0;
    for (let i = 0; i < p.length; i++) {
      d += (p[i] - q[i]) ** 2;
      s += q[i] * q[i];
    }
    return Math.sqrt(d / Math.max(s, 1e-12));
  };
  const d24 = rel(a.h, b.h);
  const d144 = rel(c.h, b.h);
  const dj = rel(j.h, b.h);
  console.log(`  a 7 m/s ship's wake after 60 s: rms difference to dt 1/60: dt 1/24 ${f1(d24 * 100)} %, dt 1/144 ${f1(d144 * 100)} %, jittered ${f1(dj * 100)} %; particles ${a.count} / ${b.count} / ${c.count} / ${j.count}`);
  check(!a.bad && !b.bad && !c.bad && !j.bad, 'no NaNs at dt 1/24, 1/60, 1/144 and jittered frame times');
  check(d24 < 0.1 && d144 < 0.1 && dj < 0.12, 'the wake does not depend on the frame rate (rms difference < 10 %, jittered < 12 %: particles are born at their due instant)');
  // Bad inputs.
  const wp = new WaveParticles(waveParticleQualityFor('high'));
  wp.setFocus(0, 0);
  wp.hull(1, NaN, 0, 1, 0, 7, 40, 9, 2);
  wp.hull(1, 0, 0, 0, 0, 7, 40, 9, 2);
  wp.hull(1, 0, 0, 1, 0, Infinity, 40, 9, 2);
  wp.hull(1, 0, 0, 1, 0, 0.2, 40, 9, 2);
  wp.ring(-4, 0, NaN, 0.3, 4);
  wp.ring(-4, 0, 0, NaN, 4);
  wp.ring(-4, 0, 0, 0.3, NaN);
  wp.update(NaN);
  wp.update(-1);
  wp.update(10);
  const out = wp.sample(NaN, 0, newSample());
  console.log(`  bad inputs (NaN positions / speeds / amplitudes, zero heading, NaN / negative / huge dt): ${wp.count} particles, sample finite ${Number.isFinite(out.height)}`);
  check(wp.count === 0 && Number.isFinite(out.height), 'bad inputs are ignored (no particles, finite queries)');
}

/* ---------------------------------------------------------------------------------------------- */
/* 9. Shaders                                                                                     */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n9. Shaders (structure; the full GLSL was parsed with @shaderfrog/glsl-parser from a scratch directory)');
{
  const balanced = (src: string): boolean => {
    let a = 0;
    let b = 0;
    for (const ch of src) {
      if (ch === '{') a++;
      if (ch === '}') a--;
      if (ch === '(') b++;
      if (ch === ')') b--;
      if (a < 0 || b < 0) return false;
    }
    return a === 0 && b === 0;
  };
  const ok = [WAVE_SPLAT_VERT, WAVE_SPLAT_FRAG, WAVE_WATER_GLSL, WATER_VERTEX_GLSL, WATER_FRAGMENT_GLSL].every(balanced);
  const uses = WATER_VERTEX_GLSL.includes('waveParticlesAt(') && WATER_FRAGMENT_GLSL.includes('waveParticlesAt(') && WATER_VERTEX_GLSL.includes('uWaveParams') && WATER_FRAGMENT_GLSL.includes('uWaveRect');
  const lines = WAVE_SPLAT_VERT.split('\n').length + WAVE_SPLAT_FRAG.split('\n').length + WAVE_WATER_GLSL.split('\n').length;
  console.log(`  splat + lookup GLSL: ${lines} lines; the water vertex and fragment shaders sample the window: ${uses}`);
  check(ok && uses, 'balanced GLSL; both water stages sample the wave particle window');
}

console.log(`\ntable for the planning doc:\n| Regime | U10 (m/s) | Place | Fetch (km) | Wind-sea Hs (m) | JONSWAP Hs (m) | Tp (s) | JONSWAP Tp (s) | Swell Hs (m) | Surface Hs (m) |\n|---|---|---|---|---|---|---|---|---|---|\n${table.join('\n')}`);
console.log(`\nfinished in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(failures.length ? `\n${failures.length} check(s) FAILED:\n  ${failures.join('\n  ')}` : '\nAll wave checks passed.');
process.exit(failures.length ? 1 : 0);
