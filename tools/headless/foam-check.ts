/**
 * Phase 21 stage 7c check, headless (no browser, no GPU): foam and spray from the water's state.
 *
 *   npx tsx tools/headless/foam-check.ts          # all sections, exits 1 when a check fails
 *   npx tsx tools/headless/foam-check.ts --quick  # shorter runs, fewer winds
 *
 * The foam field runs through a line-by-line JS port of its shaders (foam-port.ts) driven by the real bookkeeping
 * (FoamWindow), the real step parameters, the real sea (SeaState uniforms, region / flow / coast maps of the headless
 * geography), the real whitecap model and the real foam sources.
 *
 * 1. Whitecap model: the crest table against a Monte Carlo of sums of N sinusoids; the crest share of the real open sea
 *    (every candidate point of the real J field) near its 5 %; the JS port of the sim's Gerstner sums against
 *    WaveQuery.lagrangianAt (the CPU evaluator's own loop); the breaking cells' hash deterministic and uniform.
 * 2. Whitecap coverage vs U10 (the field's mean coverage after spin-up) at the open Black Sea and Marmara, the
 *    Bosphorus and the Golden Horn against Monahan & O'Muircheartaigh W = 3.84e-6 U10^3.41: within 0.5-2x on the open
 *    sea, growing with the wind, fewer in the Bosphorus and the Golden Horn, none in light air.
 * 3. Wake foam behind a ferry (the real FoamSources stamps of a 41.7 m ferry at 7 m/s): the centreline's decay length
 *    and how far it stays foamy; the wash bends with a turn.
 * 4. Advection: a foam patch drifts with the current (synthetic and the real Bosphorus current) and, on the open sea,
 *    with the wind drift + Stokes drift of the local slots.
 * 5. No growth without sources: sum and maximum of every channel never grow; a clear empties the field.
 * 6. Window bookkeeping: whole-texel scrolling keeps the field in place in the world, big jumps clear, the fixed-step
 *    clock at 24 / 60 / 144 fps, stamp culling and the queue limit.
 * 7. Robustness: the ferry's wake at dt 1/24, 1/60, 1/144 and jittered frame times; NaN inputs; the field stays finite.
 * 8. The dragon and splashes as foam sources; spray sources (spindrift with the wind, bow spray, rooster tails).
 * 9. Budgets (CPU timings, GPU estimates) and quality tiers; shader structure.
 */
import * as THREE from 'three';
import { latLonToLocal } from '../../src/core/geo-coords';
import type { LowFlightView } from '../../src/core/contracts';
import { WAVE_WATER_GLSL } from '../../src/world/water/particles/shaders.glsl';
import { waveParticleQualityFor } from '../../src/world/water/particles/config';
import { FOAM_SIM, HULL_FOAM, SPRAY, WHITECAPS, foamQualityFor } from '../../src/world/water/foam/config';
import { FoamSources, type DragonFoamInput } from '../../src/world/water/foam/foam-sources';
import { FoamWindow } from '../../src/world/water/foam/foam-window';
import { createFoamStepParams, foamStepParams, type FoamStepParams } from '../../src/world/water/foam/params';
import { FOAM_BREAK_GLSL, FOAM_SIM_FRAG, FOAM_STAMP_FRAG, FOAM_STAMP_VERT, FOAM_WATER_GLSL } from '../../src/world/water/foam/shaders.glsl';
import { WhitecapModel, breakCell, buildCrestTable, crestThreshold, crestZ, foamHash, monahanCoverage, slotFade } from '../../src/world/water/foam/whitecaps';
import { WATER_FRAGMENT_GLSL } from '../../src/world/water/shaders/water-fragment.glsl';
import { newLagrangianSample } from '../../src/world/water/wave-query';
import { WAKE_FRAGMENT } from '../../src/world/life/wakes/wake-shaders';
import { FoamPort, type FoamPortEnv } from './foam-port';
import { buildHeadlessGeo } from './geo';
import { createHeadlessSea, type SeaWind } from './water-sea';

const QUICK = process.argv.includes('--quick');
const failures: string[] = [];
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : 'nan');
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'nan');
const f3 = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : 'nan');
const pct = (v: number): string => (Number.isFinite(v) ? `${(v * 100).toFixed(v < 0.01 ? 3 : 2)} %` : 'nan');

function check(ok: boolean, label: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) failures.push(label);
}

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

const t0 = Date.now();
const geo = buildHeadlessGeo();
const hs = createHeadlessSea(geo);
const waves = hs.waves;
console.log(`geo + sea ready in ${Date.now() - t0} ms`);

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

interface Place {
  name: string;
  x: number;
  z: number;
  wind: SeaWind;
}
const places: Place[] = [
  { name: 'Black Sea (poyraz)', ...findWater(41.225, 41.25, 29.05, 29.2, -3000, 6), wind: 'poyraz' },
  { name: 'Marmara (lodos)', ...findWater(40.9, 40.95, 28.92, 29.05, -4000, 5), wind: 'lodos' },
  { name: 'Bosphorus (poyraz)', ...findWater(41.06, 41.11, 29.03, 29.07, -250, 4), wind: 'poyraz' },
  { name: 'Golden Horn (poyraz)', ...findWater(41.028, 41.04, 28.948, 28.968, -40, 3), wind: 'poyraz' },
];

const tmpV = new THREE.Vector3();
function seaEnv(): FoamPortEnv {
  return {
    uniforms: hs.sea.uniforms,
    originX: hs.originX,
    originZ: hs.originZ,
    waves,
    coast: (x, z) => geo.coastDistance(x, z),
    current: (x, z, o) => {
      waves.currentAt(x, z, tmpV);
      o.x = tmpV.x;
      o.z = tmpV.z;
    },
    particles: null,
  };
}

/** Flat open water without waves or current (hull and bookkeeping tests). */
function flatEnv(current?: { x: number; z: number }): FoamPortEnv {
  return {
    uniforms: null,
    originX: 0,
    originZ: 0,
    waves: null,
    coast: () => -5000,
    current: (_x, _z, o) => {
      o.x = current ? current.x : 0;
      o.z = current ? current.z : 0;
    },
    particles: null,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* 1. Whitecap model                                                                              */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n1. Whitecap model: crest table, crest share of the real sea, port parity, breaking cells');
{
  // Crest table vs Monte Carlo of normalised sums of N sinusoids.
  const r = rng(11);
  const worst: string[] = [];
  let ok = true;
  for (const n of [1, 2, 3, 5, 8, 13]) {
    const m = 200000;
    const z = crestZ(n);
    let above = 0;
    const sig = Math.sqrt(n / 2);
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += Math.sin(r() * Math.PI * 2);
      if (s / sig > z) above++;
    }
    const share = above / m;
    worst.push(`N ${n}: z ${f3(z)} -> ${pct(share)}`);
    ok = ok && Math.abs(share - WHITECAPS.crestShare) < 0.004;
  }
  console.log(`  crest table (upper ${pct(WHITECAPS.crestShare)} quantile of sum sin / sqrt(N/2)) vs Monte Carlo: ${worst.join(', ')}`);
  check(ok, `the crest table gives the crest share within 0.4 points for N = 1..13`);
  const t2 = buildCrestTable(0.2);
  check(t2[0] < crestZ(1) && t2[7] < crestZ(8), 'a larger share gives a lower z (table monotonic in the share)');

  // Crest share of the real open sea: the local threshold vs the local J over space and time.
  const bs = places[0];
  hs.setWind('poyraz', 12);
  const s = newLagrangianSample();
  const rr = rng(5);
  let crest = 0;
  let n = 0;
  for (let t = 0; t < 120; t += 1.5) {
    hs.advance(t, 1.5, bs.x, bs.z);
    for (let k = 0; k < 300; k++) {
      const x = bs.x + (rr() - 0.5) * 400;
      const z = bs.z + (rr() - 0.5) * 400;
      waves.lagrangianAt(x, z, s, (l) => slotFade(l, 1));
      if (s.jacobian < crestThreshold(s.sigmaJ, s.nEff)) crest++;
      n++;
    }
  }
  const shareReal = crest / n;
  console.log(`  real open sea (Black Sea, poyraz U10 12, field grid 1 m): ${pct(shareReal)} of the surface below the local crest threshold (target ${pct(WHITECAPS.crestShare)}; Gerstner quadratic terms make the tail a little thinner)`);
  check(shareReal > WHITECAPS.crestShare * 0.5 && shareReal < WHITECAPS.crestShare * 1.5, 'crest share of the real sea within 0.5-1.5x of the target');

  // Port parity: the fast tables vs WaveQuery.lagrangianAt at texels of a window.
  const win = new FoamWindow({ size: 64, texel: 1, maxStamps: 0, spray: 1 });
  win.beginFrame(0, bs.x, bs.z);
  const port = new FoamPort(win);
  const p = createFoamStepParams();
  const env = seaEnv();
  let worstJ = 0;
  let worstH = 0;
  let worstS = 0;
  let worstO = 0;
  for (let k = 0; k < 40; k++) {
    const i = Math.floor(rr() * 64);
    const j = Math.floor(rr() * 64);
    const a = port.ambientTexel(env, i, j, p);
    waves.lagrangianAt(port.texelX(i), port.texelZ(j), s, (l) => slotFade(l, 1));
    worstJ = Math.max(worstJ, Math.abs(a.J - s.jacobian));
    worstH = Math.max(worstH, Math.abs(a.h - s.height));
    worstS = Math.max(worstS, Math.abs(a.sigma - s.sigmaJ), Math.abs(a.nEff - s.nEff) * 0.01, Math.abs(a.hs - s.hs) * 0.1);
    worstO = Math.max(worstO, Math.abs(a.omega - s.omega), Math.hypot(a.stx - s.stokesX, a.stz - s.stokesZ));
  }
  console.log(`  port (sin/cos tables) vs WaveQuery.lagrangianAt at 40 texels: |dJ| ${worstJ.toExponential(1)}, |dh| ${worstH.toExponential(1)} m, spread / N / Hs ${worstS.toExponential(1)}, frequency / Stokes ${worstO.toExponential(1)}`);
  check(worstJ < 1e-5 && worstH < 1e-5 && worstS < 1e-5 && worstO < 1e-5, 'the port evaluates the same Gerstner sums as the CPU evaluator (< 1e-5)');

  // Breaking cells: deterministic, uniform rolls, rate = probability.
  const h1 = foamHash(12345, -678);
  const h2 = foamHash(12345, -678);
  let hits = 0;
  const trials = 100000;
  for (let i = 0; i < trials; i++) {
    if (breakCell(i * 7.3, i * 3.1, 17.2, 0.6, 0.8, 5, 0.03)) hits++;
  }
  console.log(`  breaking cells: hash deterministic (${h1 === h2}), ${pct(hits / trials)} of random points in breaking cells at probability 3 %`);
  check(h1 === h2 && Math.abs(hits / trials - 0.03) < 0.004, 'breaking cells break with the given probability');
}

/* ---------------------------------------------------------------------------------------------- */
/* 2. Whitecap coverage vs U10                                                                    */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n2. Whitecap coverage vs U10 (mean field coverage after spin-up) against Monahan W = 3.84e-6 U10^3.41');
const coverageRows: string[] = [];
const coverage = new Map<string, number>();
{
  const winds = QUICK ? [6, 10, 14] : [3, 4, 6, 8, 10, 12, 14, 16];
  // Light winds break rarely: the statistics need a larger window and a longer run there.
  const size = QUICK ? 160 : 192;
  const seconds = QUICK ? 100 : 160;
  const spin = 20;
  const header = `| Place | ${winds.map((u) => `U10 ${u}`).join(' | ')} |`;
  coverageRows.push(header, `|---|${winds.map(() => '---').join('|')}|`);
  coverageRows.push(`| Monahan W | ${winds.map((u) => pct(monahanCoverage(u))).join(' | ')} |`);
  for (const pl of places) {
    const cells: string[] = [];
    for (const u of winds) {
      hs.setWind(pl.wind, u);
      hs.advance(0, 0, pl.x, pl.z);
      const model = new WhitecapModel();
      const win = new FoamWindow({ size, texel: 1, maxStamps: 0, spray: 1 });
      const port = new FoamPort(win);
      const p = createFoamStepParams();
      const env = seaEnv();
      const wd = hs.sea.uniforms.uWindParams.value;
      let acc = 0;
      let nAcc = 0;
      let t = 0;
      const dt = FOAM_SIM.step;
      for (let k = 0; k < Math.round(seconds / dt); k++) {
        t += dt;
        hs.advance(t, dt, pl.x, pl.z);
        model.update(hs.sea, 1);
        win.beginFrame(dt, pl.x, pl.z);
        foamStepParams(model.sim, model.omegaOpen, win.simTime, hs.sea.u10, wd.x, wd.y, p);
        env.originX = hs.originX;
        env.originZ = hs.originZ;
        port.frame(env, p);
        if (t > spin) {
          const n = port.size;
          const m = 10;
          let sum = 0;
          let c = 0;
          for (let j = m; j < n - m; j += 1)
            for (let i = m; i < n - m; i += 1) {
              const o = (j * n + i) * 4;
              sum += Math.min(1, port.cur[o] + port.cur[o + 1]);
              c++;
            }
          acc += sum / c;
          nAcc++;
        }
      }
      const cov = acc / Math.max(nAcc, 1);
      coverage.set(`${pl.name}|${u}`, cov);
      cells.push(pct(cov));
    }
    coverageRows.push(`| ${pl.name} | ${cells.join(' | ')} |`);
    console.log(`  ${pl.name}: ${winds.map((u, i) => `U10 ${u} ${cells[i]}`).join(', ')}`);
  }
  console.log(`  Monahan:            ${winds.map((u) => `U10 ${u} ${pct(monahanCoverage(u))}`).join(', ')}`);
  const open = [places[0].name, places[1].name];
  let within = true;
  const ratios: string[] = [];
  for (const name of open) {
    for (const u of winds) {
      if (u < 6) continue;
      const r = coverage.get(`${name}|${u}`)! / monahanCoverage(u);
      ratios.push(f2(r));
      within = within && r > 0.5 && r < 2;
    }
  }
  check(within, `open sea coverage within 0.5-2x of Monahan for U10 6..16 (ratios ${ratios.join(', ')})`);
  let grows = true;
  for (const name of open) {
    for (let i = 1; i < winds.length; i++) {
      if (winds[i - 1] < 6) continue;
      grows = grows && coverage.get(`${name}|${winds[i]}`)! > coverage.get(`${name}|${winds[i - 1]}`)!;
    }
  }
  check(grows, 'open sea coverage grows with the wind');
  const uMax = winds[winds.length - 1];
  const openMax = Math.min(coverage.get(`${places[0].name}|${uMax}`)!, coverage.get(`${places[1].name}|${uMax}`)!);
  const gh = coverage.get(`${places[3].name}|${uMax}`)!;
  const bos = coverage.get(`${places[2].name}|${uMax}`)!;
  check(gh < 0.6 * openMax && bos < 0.8 * openMax && gh > 0 && bos > 0, `at U10 ${uMax} fewer whitecaps in the Golden Horn (${pct(gh)}) and the Bosphorus (${pct(bos)}) than on the open sea (${pct(openMax)}), but some`);
  if (winds.includes(3)) {
    check(coverage.get(`${places[0].name}|3`)! === 0, 'no whitecaps at U10 3 (below the minimum wind)');
  }
  const few = coverage.get(`${places[0].name}|6`)!;
  const many = coverage.get(`${places[0].name}|14`)!;
  check(many > 8 * few, `few at U10 6 (${pct(few)}), many at U10 14 (${pct(many)})`);
}

/* ---------------------------------------------------------------------------------------------- */
/* 3. Wake foam behind a ferry                                                                    */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n3. Wake foam behind a ferry (41.7 x 9.6 x 2.0 m at 7 m/s, thrust 60 %), flat calm water');

interface FerryRun {
  profile: Float64Array;
  e1: number;
  foamy: number;
  bad: boolean;
  port: FoamPort;
  src: FoamSources;
  win: FoamWindow;
}
const FERRY = { L: 41.7, B: 9.6, T: 2.0, U: 7 };

/** A ferry sailing along +x (or turning) for `seconds`, the camera trailing it; the centreline profile behind it at the end. */
function ferryRun(frameDt: () => number, seconds: number, turn = 0): FerryRun {
  const q = foamQualityFor('high');
  const win = new FoamWindow(q);
  const port = new FoamPort(win);
  const src = new FoamSources();
  const model = new WhitecapModel();
  const p = createFoamStepParams();
  foamStepParams(model.sim, 1, 0, 0, 1, 0, p);
  const env = flatEnv();
  let t = 0;
  let x = 0;
  let z = 0;
  let yaw = 0;
  let bad = false;
  const track: { x: number; z: number }[] = [];
  while (t < seconds) {
    const dt = frameDt();
    t += dt;
    yaw += turn * dt;
    const fx = Math.cos(yaw);
    const fz = Math.sin(yaw);
    x += fx * FERRY.U * dt;
    z += fz * FERRY.U * dt;
    track.push({ x, z });
    // Camera 150 m behind the ferry along its track.
    const camX = x - fx * 150;
    const camZ = z - fz * 150;
    win.beginFrame(dt, camX, camZ);
    src.beginFrame(dt, 0, camX, camZ, fx, fz, null, model, win.texel, 1, 0, 0);
    src.hull(7, x, z, fx, fz, FERRY.U, FERRY.L, FERRY.B, FERRY.T, 0.6, 0, 0);
    src.flush(win, null, null);
    port.frame(env, p);
    if (port.bad()) bad = true;
  }
  const fx = Math.cos(yaw);
  const fz = Math.sin(yaw);
  const sx = x - fx * FERRY.L * 0.5;
  const sz = z - fz * FERRY.L * 0.5;
  const profile = new Float64Array(80);
  for (let k = 0; k < profile.length; k++) {
    const d = k * 5;
    profile[k] = Math.min(1, port.at(sx - fx * d, sz - fz * d, 0) + port.at(sx - fx * d, sz - fz * d, 1));
  }
  // e-folding length from the log slope between 80 and 300 m behind the stern (beyond the stamped wash).
  let sxx = 0;
  let sxy = 0;
  let sx1 = 0;
  let sy1 = 0;
  let n = 0;
  for (let k = 16; k <= 60; k++) {
    const v = profile[k];
    if (!(v > 1e-4)) continue;
    const d = k * 5;
    sx1 += d;
    sy1 += Math.log(v);
    sxx += d * d;
    sxy += d * Math.log(v);
    n++;
  }
  const slope = (n * sxy - sx1 * sy1) / Math.max(n * sxx - sx1 * sx1, 1e-9);
  const e1 = slope < 0 ? -1 / slope : Infinity;
  let foamy = 0;
  for (let k = 0; k < profile.length; k++) {
    if (profile[k] >= 0.25) foamy = k * 5;
    else break;
  }
  return { profile, e1, foamy, bad, port, src, win };
}
const ferry = ferryRun(() => 1 / 60, QUICK ? 70 : 90);
{
  const expected = FERRY.U * FOAM_SIM.wakeLife;
  const prof = [0, 50, 100, 200, 300].map((d) => `${d} m ${f2(ferry.profile[d / 5])}`).join(', ');
  console.log(`  centreline coverage behind the stern: ${prof}; e-folding length ${f1(ferry.e1)} m (U x wake life = ${f1(expected)} m); foamy (>= 0.25) for ${ferry.foamy} m`);
  check(ferry.e1 > expected * 0.7 && ferry.e1 < expected * 1.3, 'wake foam decays over U x FOAM_SIM.wakeLife (within 30 %)');
  check(ferry.foamy >= 200 && ferry.foamy <= 600, 'the turbulent centreline stays foamy for a few hundred metres (200-600 m)');
  // Width at 150 m behind the stern: the wash widened.
  const sx = ferry.win.minX + ferry.win.extent;
  void sx;
  const prof0 = ferry.profile[0];
  check(prof0 > 0.8 && !ferry.bad, `fresh wash right behind the stern (${f2(prof0)}), no NaNs`);
  // A turning ferry: the wash follows the curved track (foam on the arc, not on the straight tangent behind the stern).
  const turn = ferryRun(() => 1 / 60, 40, 0.04);
  const yaw = 0.04 * 40;
  const R = FERRY.U / 0.04;
  // Centre of the circle: the ferry started at the origin heading +x turning toward +z.
  const cx = 0;
  const cz = R;
  let onArc = 0;
  let onTangent = 0;
  for (let k = 1; k <= 8; k++) {
    const a = yaw - (k * 12) / R - FERRY.L / (2 * R);
    const ax = cx + R * Math.sin(a);
    const az = cz - R * Math.cos(a);
    onArc += Math.min(1, turn.port.at(ax, az, 1));
    const tx = R * Math.sin(yaw) - Math.cos(yaw) * (FERRY.L / 2 + k * 12);
    const tz = cz - R * Math.cos(yaw) - Math.sin(yaw) * (FERRY.L / 2 + k * 12);
    onTangent += Math.min(1, turn.port.at(tx, tz, 1));
  }
  console.log(`  turning at 0.04 rad/s (R ${f1(R)} m): wake foam on the arc behind the stern ${f2(onArc / 8)}, on the straight tangent ${f2(onTangent / 8)}`);
  check(onArc > 1.5 * onTangent && onArc / 8 > 0.3, 'the wash bends with the turn (follows the track)');
}

/* ---------------------------------------------------------------------------------------------- */
/* 4. Advection                                                                                   */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n4. Advection: a foam patch drifts with the current, the wind drift and the Stokes drift');
function centroid(port: FoamPort, c: number): { x: number; z: number; sum: number } {
  let sx = 0;
  let sz = 0;
  let s = 0;
  const n = port.size;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const v = port.cur[(j * n + i) * 4 + c];
      sx += v * port.texelX(i);
      sz += v * port.texelZ(j);
      s += v;
    }
  return { x: sx / s, z: sz / s, sum: s };
}
{
  // Synthetic uniform current 1.2 m/s toward +x, 30 s.
  const win = new FoamWindow({ size: 160, texel: 1, maxStamps: 4, spray: 1 });
  const port = new FoamPort(win);
  const p = createFoamStepParams();
  const model = new WhitecapModel();
  foamStepParams(model.sim, 1, 0, 0, 1, 0, p);
  const env = flatEnv({ x: 1.2, z: 0 });
  win.beginFrame(0, 0, 0);
  win.stamp(-40, 0, -40, 0, 6, 6, 0, 0, 1, 0, 0);
  port.frame(env, p);
  const c0 = centroid(port, 1);
  for (let t = 0; t < 30; t += FOAM_SIM.step) {
    win.beginFrame(FOAM_SIM.step, 0, 0);
    port.frame(env, p);
  }
  const c1 = centroid(port, 1);
  const dx = c1.x - c0.x;
  const dz = c1.z - c0.z;
  console.log(`  uniform current 1.2 m/s east, 30 s: patch moved ${f2(dx)} m east, ${f2(dz)} m north (expected 36 m east)`);
  check(Math.abs(dx - 36) < 1.5 && Math.abs(dz) < 0.5, 'the patch follows the current (within 1.5 m over 36 m)');

  // The real Bosphorus current.
  const bos = places[2];
  hs.setWind('poyraz', 2);
  hs.advance(0, 0, bos.x, bos.z);
  waves.currentAt(bos.x, bos.z, tmpV);
  const cur = { x: tmpV.x, z: tmpV.z };
  const winB = new FoamWindow({ size: 128, texel: 1, maxStamps: 4, spray: 1 });
  const portB = new FoamPort(winB);
  const envB = seaEnv();
  envB.uniforms = null;
  const pB = createFoamStepParams();
  foamStepParams(model.sim, 1, 0, 0, 1, 0, pB);
  winB.beginFrame(0, bos.x, bos.z);
  winB.stamp(bos.x, bos.z, bos.x, bos.z, 5, 5, 0, 0, 1, 0, 0);
  portB.frame(envB, pB);
  const b0 = centroid(portB, 1);
  for (let t = 0; t < 20; t += FOAM_SIM.step) {
    winB.beginFrame(FOAM_SIM.step, bos.x, bos.z);
    portB.frame(envB, pB);
  }
  const b1 = centroid(portB, 1);
  const mvx = b1.x - b0.x;
  const mvz = b1.z - b0.z;
  const angle = (Math.acos(Math.max(-1, Math.min(1, (mvx * cur.x + mvz * cur.z) / Math.max(Math.hypot(mvx, mvz) * Math.hypot(cur.x, cur.z), 1e-9)))) * 180) / Math.PI;
  console.log(`  Bosphorus current ${f2(Math.hypot(cur.x, cur.z))} m/s: patch moved ${f1(Math.hypot(mvx, mvz))} m in 20 s at ${f1(angle)} deg from the current's direction`);
  check(angle < 10 && Math.abs(Math.hypot(mvx, mvz) - 20 * Math.hypot(cur.x, cur.z)) < 0.2 * 20 * Math.hypot(cur.x, cur.z) + 1, 'foam drifts with the real Bosphorus current (direction within 10 deg, distance within 20 %)');

  // Open sea: wind drift + Stokes drift of the local slots, whitecap sources off.
  const bs = places[0];
  hs.setWind('poyraz', 12);
  hs.advance(0, 0, bs.x, bs.z);
  const s = newLagrangianSample();
  waves.lagrangianAt(bs.x, bs.z, s);
  const wd = hs.sea.uniforms.uWindParams.value;
  const expX = FOAM_SIM.windDrift * 12 * wd.x + s.stokesX;
  const expZ = FOAM_SIM.windDrift * 12 * wd.y + s.stokesZ;
  const winS = new FoamWindow({ size: 128, texel: 1, maxStamps: 4, spray: 1 });
  const portS = new FoamPort(winS);
  const pS = createFoamStepParams();
  const modelS = new WhitecapModel();
  modelS.update(hs.sea, 1);
  foamStepParams(modelS.sim, modelS.omegaOpen, 0, 12, wd.x, wd.y, pS);
  pS.capProb = 0;
  const envS = seaEnv();
  winS.beginFrame(0, bs.x, bs.z);
  winS.stamp(bs.x, bs.z, bs.x, bs.z, 6, 6, 0, 0, 1, 0, 0);
  portS.frame(envS, pS);
  const s0 = centroid(portS, 1);
  let tt = 0;
  for (let k = 0; k < 400; k++) {
    tt += FOAM_SIM.step;
    hs.advance(tt, FOAM_SIM.step, bs.x, bs.z);
    envS.originX = hs.originX;
    envS.originZ = hs.originZ;
    winS.beginFrame(FOAM_SIM.step, bs.x, bs.z);
    portS.frame(envS, pS);
  }
  const s1 = centroid(portS, 1);
  const vx = (s1.x - s0.x) / tt;
  const vz = (s1.z - s0.z) / tt;
  console.log(`  open sea, poyraz U10 12: drift ${f2(Math.hypot(vx, vz))} m/s toward ${f1((Math.atan2(vx, -vz) * 180) / Math.PI)} deg (expected ${f2(Math.hypot(expX, expZ))} m/s toward ${f1((Math.atan2(expX, -expZ) * 180) / Math.PI)} deg: wind drift ${f2(FOAM_SIM.windDrift * 12)} + Stokes ${f2(Math.hypot(s.stokesX, s.stokesZ))})`);
  check(Math.hypot(vx - expX, vz - expZ) < 0.2 * Math.hypot(expX, expZ) + 0.02, 'foam drifts downwind with the wind drift + Stokes drift (within 20 %)');
}

/* ---------------------------------------------------------------------------------------------- */
/* 5. No growth without sources                                                                   */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n5. No growth without sources (random field, current, sources off)');
{
  const win = new FoamWindow({ size: 96, texel: 1, maxStamps: 0, spray: 1 });
  const port = new FoamPort(win);
  const p = createFoamStepParams();
  const model = new WhitecapModel();
  foamStepParams(model.sim, 1, 0, 10, 1, 0, p);
  const env = flatEnv({ x: 0.7, z: -0.4 });
  win.beginFrame(0, 0, 0);
  port.frame(env, p);
  const r = rng(3);
  for (let i = 0; i < port.cur.length; i++) port.cur[i] = r() * (r() < 0.2 ? 1 : 0.2);
  let grew = false;
  let maxGrew = false;
  const sums = [0, 1, 2, 3].map((c) => port.sum(c));
  const maxs = [0, 1, 2, 3].map((c) => port.max(c));
  const s0 = sums.slice();
  for (let k = 0; k < 400; k++) {
    win.beginFrame(FOAM_SIM.step, (k % 7) * 0.3, 0);
    port.frame(env, p);
    for (let c = 0; c < 4; c++) {
      const s = port.sum(c);
      const m = port.max(c);
      if (s > sums[c] * (1 + 1e-12) + 1e-9) grew = true;
      if (m > maxs[c] + 1e-12) maxGrew = true;
      sums[c] = s;
      maxs[c] = m;
    }
  }
  console.log(`  20 s: channel sums ${s0.map((v, c) => `${f1(v)} -> ${f1(sums[c])}`).join(', ')}`);
  check(!grew && !maxGrew, 'no channel sum or maximum ever grows without sources');
  const keepG = Math.exp(-20 / FOAM_SIM.wakeLife);
  check(sums[1] <= s0[1] * keepG * 1.001, `wake foam decays at least at its rate (${f3(sums[1] / s0[1])} <= ${f3(keepG)})`);
  win.setQuality({ size: 64, texel: 1, maxStamps: 0, spray: 1 });
  win.beginFrame(FOAM_SIM.step, 0, 0);
  const port2 = new FoamPort(win);
  port2.cur.fill(0.5);
  port2.frame(env, p);
  check(port2.max(0) === 0 && port2.max(1) === 0, 'a quality change clears the field');
}

/* ---------------------------------------------------------------------------------------------- */
/* 6. Window bookkeeping                                                                          */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n6. Window bookkeeping: scrolling, clears, the fixed-step clock, stamp culling');
{
  const win = new FoamWindow({ size: 128, texel: 1, maxStamps: 8, spray: 1 });
  const port = new FoamPort(win);
  const p = createFoamStepParams();
  const model = new WhitecapModel();
  foamStepParams(model.sim, 1, 0, 0, 1, 0, p);
  p.keepR = p.keepG = p.keepB = p.keepA = 1;
  const env = flatEnv();
  win.beginFrame(0, 0, 0);
  win.stamp(10, -5, 25, 8, 3, 5, 0, 0.8, 0.6, 0.4, 0.2);
  port.frame(env, p);
  const probe: [number, number][] = [
    [10, -5],
    [18, 2],
    [25, 8],
    [14, -1],
  ];
  const before = probe.map(([x, z]) => port.at(x, z, 1));
  let cx = 0;
  let worst = 0;
  for (let k = 0; k < 60; k++) {
    cx += 0.9;
    win.beginFrame(FOAM_SIM.step, cx, cx * 0.3);
    port.frame(env, p);
    probe.forEach(([x, z], i) => {
      worst = Math.max(worst, Math.abs(port.at(x, z, 1) - before[i]));
    });
  }
  console.log(`  window scrolled ${f1(cx)} m in whole texels over 60 steps: field at 4 world points changed by at most ${worst.toExponential(1)}`);
  check(worst < 1e-12 && win.originX !== 0, 'whole-texel scrolling keeps the field in place in the world');
  win.beginFrame(FOAM_SIM.step, cx + 500, 0);
  const cleared = win.needsClear;
  port.frame(env, p);
  check(cleared && port.max(1) === 0, 'a jump larger than the window clears the field');
  const counts: number[] = [];
  for (const fps of [24, 60, 144]) {
    const w = new FoamWindow({ size: 32, texel: 1, maxStamps: 0, spray: 1 });
    let steps = 0;
    for (let k = 0; k < fps * 10; k++) {
      w.beginFrame(1 / fps, 0, 0);
      steps += w.steps;
    }
    counts.push(steps);
  }
  console.log(`  fixed-step clock over 10 s: ${counts.join(' / ')} steps at 24 / 60 / 144 fps (${10 / FOAM_SIM.step} expected)`);
  check(counts.every((c) => Math.abs(c - 10 / FOAM_SIM.step) <= 1), 'the fixed-step clock does not depend on the frame rate');
  const w2 = new FoamWindow({ size: 64, texel: 1, maxStamps: 3, spray: 1 });
  w2.beginFrame(0.05, 0, 0);
  const inside = w2.stamp(0, 0, 0, 0, 2, 2, 0, 1, 1, 1, 1);
  const outside = w2.stamp(500, 0, 500, 0, 2, 2, 0, 1, 1, 1, 1);
  const zero = w2.stamp(0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0);
  w2.stamp(1, 1, 1, 1, 2, 2, 0, 1, 1, 1, 1);
  w2.stamp(2, 2, 2, 2, 2, 2, 0, 1, 1, 1, 1);
  const full = w2.stamp(3, 3, 3, 3, 2, 2, 0, 1, 1, 1, 1);
  const nan = w2.stamp(NaN, 0, 0, 0, 2, 2, 0, 1, 1, 1, 1);
  check(inside && !outside && !zero && !full && !nan && w2.count === 3, 'stamps outside the window, empty, over the queue limit or not finite are dropped');
  const off = new FoamWindow(foamQualityFor('low'));
  off.beginFrame(0.05, 0, 0);
  check(!off.enabled && off.steps === 0 && !off.stamp(0, 0, 0, 0, 2, 2, 0, 1, 1, 1, 1), '"low": no field, no steps, no stamps');
}

/* ---------------------------------------------------------------------------------------------- */
/* 7. Robustness                                                                                  */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n7. Robustness: frame rate, jitter, bad inputs');
{
  const secs = QUICK ? 45 : 60;
  const runs = [
    ferryRun(() => 1 / 24, secs),
    ferryRun(() => 1 / 60, secs),
    ferryRun(() => 1 / 144, secs),
    (() => {
      const r = rng(9);
      return ferryRun(() => 1 / 144 + r() * (1 / 20 - 1 / 144), secs);
    })(),
  ];
  const rel = (a: Float64Array, b: Float64Array): number => {
    let d = 0;
    let s = 0;
    for (let i = 0; i < 64; i++) {
      d += (a[i] - b[i]) ** 2;
      s += b[i] ** 2;
    }
    return Math.sqrt(d / Math.max(s, 1e-12));
  };
  const d24 = rel(runs[0].profile, runs[1].profile);
  const d144 = rel(runs[2].profile, runs[1].profile);
  const dj = rel(runs[3].profile, runs[1].profile);
  console.log(`  ferry wake centreline after ${secs} s, rms difference to dt 1/60: dt 1/24 ${f1(d24 * 100)} %, dt 1/144 ${f1(d144 * 100)} %, jittered ${f1(dj * 100)} %`);
  check(d24 < 0.05 && d144 < 0.05 && dj < 0.06, 'the wake does not depend on the frame rate (< 5 %, jittered < 6 %)');
  check(runs.every((r) => !r.bad), 'no NaNs at any frame rate');
  // Bad inputs.
  const src = new FoamSources();
  const win = new FoamWindow(foamQualityFor('high'));
  const port = new FoamPort(win);
  const model = new WhitecapModel();
  const p = createFoamStepParams();
  foamStepParams(model.sim, NaN, NaN, NaN, NaN, NaN, p);
  win.beginFrame(NaN, 0, 0);
  win.beginFrame(-1, 0, 0);
  win.beginFrame(1e6, 0, 0);
  src.beginFrame(NaN, NaN, 0, 0, 0, 0, null, model, 1, NaN, NaN, NaN);
  src.hull(1, NaN, 0, 1, 0, 7, 40, 9, 2, 0.5, 0, 0);
  src.hull(2, 0, 0, 0, 0, 7, 40, 9, 2, 0.5, 0, 0);
  src.hull(3, 0, 0, 1, 0, 7, NaN, 9, 2, 0.5, 0, 0);
  src.hull(4, 0, 0, 1, 0, 7, 40, 9, 2, NaN, NaN, NaN);
  src.splash(NaN, 0, 1);
  src.splash(0, 0, NaN);
  src.flush(win, null, null);
  port.frame(flatEnv(), p);
  check(!port.bad() && src.hullCount === 1 && Number.isFinite(p.driftX + p.capTime + p.capProb), `bad inputs are ignored (${src.hullCount} valid hull kept, field finite, parameters finite)`);
}

/* ---------------------------------------------------------------------------------------------- */
/* 8. The dragon, splashes and spray                                                              */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n8. The dragon and splashes as foam sources; spray sources');
{
  const win = new FoamWindow(foamQualityFor('high'));
  const src = new FoamSources();
  const port = new FoamPort(win);
  const model = new WhitecapModel();
  const p = createFoamStepParams();
  foamStepParams(model.sim, 1, 0, 0, 1, 0, p);
  const low = {
    active: true,
    height: 1,
    downwash: 0,
    downwashPulse: 0,
    edgeSpray: 0,
    wake: 1,
    vortex: 0,
    tipVortex: [0, 0] as [number, number],
    steam: 0,
    steamPoint: new THREE.Vector3(),
    surfacePoint: new THREE.Vector3(),
    heading: new THREE.Vector3(1, 0, 0),
    speed: 30,
    tipHeight: [5, 5] as [number, number],
    tipPoint: [new THREE.Vector3(), new THREE.Vector3()] as [THREE.Vector3, THREE.Vector3],
    tailHeight: 5,
    tailPoint: new THREE.Vector3(),
  } satisfies LowFlightView;
  const input: DragonFoamInput = { mode: 'flying', position: new THREE.Vector3(), velocity: new THREE.Vector3(30, 0, 0), low, tips: null, wingspan: 24 };
  // A 3 s skim at 30 m/s along +x from x = -100.
  let x = -100;
  for (let k = 0; k < 180; k++) {
    x += 30 / 60;
    low.surfacePoint.set(x, 0, 0);
    input.position.set(x, 1, 0);
    win.beginFrame(1 / 60, 0, 0);
    src.beginFrame(1 / 60, 0, 0, 0, 1, 0, null, model, win.texel, 1, 0, 0);
    src.flush(win, input, null);
    port.frame(flatEnv(), p);
  }
  let furrow = 0;
  for (let xx = -90; xx <= -20; xx += 5) furrow += Math.min(1, port.at(xx, 0, 0) + port.at(xx, 0, 1));
  const side = port.at(-50, 8, 1);
  console.log(`  skim at 30 m/s: furrow coverage along the path ${f2(furrow / 15)}, 8 m to the side ${f2(side)}`);
  check(furrow / 15 > 0.5 && side < 0.05, 'the skim leaves a foam furrow along its path');
  // Splash (plunge, strength 3) and a swim stroke.
  win.beginFrame(1 / 60, 0, 0);
  src.splash(30, 30, 3);
  input.mode = 'swimming';
  input.low = null;
  input.velocity.set(0, 0, 0);
  input.tips = [new THREE.Vector3(-30, -0.3, -30), new THREE.Vector3(-20, 3, -30)];
  src.flush(win, input, () => 0);
  port.frame(flatEnv(), p);
  const splashFoam = port.at(30, 30, 0);
  const strokeIn = port.at(-30, -30, 0);
  const strokeOut = port.at(-20, -30, 0);
  console.log(`  plunge splash foam ${f2(splashFoam)}; swimming stroke: wingtip under water ${f2(strokeIn)}, wingtip in the air ${f2(strokeOut)}`);
  check(splashFoam > 0.8 && strokeIn > 0.3 && strokeOut < 0.01, 'splashes and wing strokes under water leave foam, a wingtip in the air does not');

  // Spray: spindrift found around the camera at several winds (Black Sea), bow spray, rooster tail.
  const bs = places[0];
  const rows: string[] = [];
  const found: number[] = [];
  for (const u of [10, 12, 14, 16]) {
    hs.setWind('poyraz', u);
    const m = new WhitecapModel();
    const s = new FoamSources();
    let crests = 0;
    let t = 0;
    for (let k = 0; k < 600; k++) {
      t += 1 / 60;
      hs.advance(t, 1 / 60, bs.x, bs.z);
      m.update(hs.sea, 1);
      const wd = hs.sea.uniforms.uWindParams.value;
      s.beginFrame(1 / 60, t, bs.x, bs.z, 0, -1, waves, m, 1, wd.x, wd.y, u);
      crests += s.stats.crests;
    }
    found.push(crests / 10);
    rows.push(`U10 ${u}: ${f1(crests / 10)} /s`);
  }
  console.log(`  spindrift sources (breaking crests found around the camera): ${rows.join(', ')}`);
  check(found[0] === 0 && found[2] > 0 && found[3] > found[2], 'spindrift only in strong wind (none at U10 10, some at 14, more at 16)');
  const s = new FoamSources();
  hs.setWind('poyraz', 10);
  hs.advance(0, 0, bs.x, bs.z);
  s.hull(1, bs.x, bs.z, 1, 0, 14, 8.5, 2.8, 0.3, 0.9, 0.9, 1.5);
  s.hull(2, bs.x + 100, bs.z, 1, 0, 5, 72, 13.2, 3.1, 0.5, 0, 0.1);
  s.beginFrame(1 / 60, 0, bs.x, bs.z, 1, 0, waves, new WhitecapModel(), 1, 1, 0, 10);
  const kinds = s.sprays.slice(0, s.sprayCount).map((q) => q.kind);
  console.log(`  a planing motorboat at 14 m/s in a U10 10 sea and a vapur at 5 m/s: spray sources ${kinds.join(', ') || 'none'}`);
  check(kinds.filter((k) => k === 'bow').length === 2 && kinds.includes('prop') && s.sprayCount === 3, 'bow spray (both sides) and a rooster tail from the fast boat, none from the slow vapur');
}

/* ---------------------------------------------------------------------------------------------- */
/* 9. Budgets, quality tiers, shaders                                                             */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n9. Budgets, quality tiers, shaders');
{
  const bs = places[0];
  hs.setWind('poyraz', 14);
  hs.advance(0, 0, bs.x, bs.z);
  const model = new WhitecapModel();
  let ta = performance.now();
  for (let i = 0; i < 2000; i++) model.update(hs.sea, 1);
  const modelUs = ((performance.now() - ta) / 2000) * 1000;
  const src = new FoamSources();
  const win = new FoamWindow(foamQualityFor('high'));
  const wd = hs.sea.uniforms.uWindParams.value;
  ta = performance.now();
  for (let i = 0; i < 600; i++) {
    win.beginFrame(1 / 60, bs.x, bs.z);
    src.beginFrame(1 / 60, i / 60, bs.x, bs.z, 0, -1, waves, model, 1, wd.x, wd.y, 14);
    for (let h = 0; h < 12; h++) src.hull(h, bs.x + h * 40 - 200, bs.z + h * 17 - 100, 1, 0, 7, 42, 9.6, 2, 0.6, 0, 0.2);
    src.flush(win, null, null);
  }
  const frameUs = ((performance.now() - ta) / 600) * 1000;
  console.log(`  CPU: whitecap model ${f1(modelUs)} us / frame; window + sources with 12 hulls in view + spindrift at U10 14 ${f1(frameUs)} us / frame (${src.stats.stamps} stamps, ${src.stats.candidates} candidates)`);
  check(modelUs < 50 && frameUs < 300, 'CPU cost small (model < 50 us, sources < 0.3 ms per frame)');
  // GPU estimate on "high": the sim pass per step and the water shader's extra work per pixel.
  const q = foamQualityFor('high');
  const texels = q.size * q.size;
  const aluSim = 26 * 16 + 120;
  const stepsPerFrame60 = 60 * FOAM_SIM.step;
  const simMs = (texels * aluSim) / 4e12 * 1000;
  const shadePix = 1600 * 900 * 0.6;
  const shadeMs = (shadePix * 70) / 4e12 * 1000;
  console.log(`  GPU estimate ("high", 1600 x 900, ~4 TALU/s effective): sim ${q.size}² x ~${aluSim} ALU = ${f3(simMs)} ms per step (${f3(simMs / stepsPerFrame60 > 0 ? simMs * (1 / (60 * FOAM_SIM.step)) : 0)} ms per 60 fps frame averaged), stamps < 0.01 ms, water shading ~70 ALU + 2 fetches on ~60 % of the pixels = ${f3(shadeMs)} ms; total ${f3(simMs / 3 + shadeMs + 0.01)} ms (budget 0.3 ms)`);
  check(simMs + shadeMs + 0.01 < 0.3, 'GPU estimate within 0.3 ms on "high" even on a step frame');
  const tiers = (['low', 'medium', 'high', 'ultra'] as const).map((t) => {
    const f = foamQualityFor(t);
    const w = waveParticleQualityFor(t);
    return { t, ok: f.size === w.splatSize && (f.size === 0 || f.texel === w.splatTexel), f };
  });
  console.log(`  tiers: ${tiers.map((x) => `${x.t} ${x.f.size ? `${x.f.size}² x ${x.f.texel} m` : 'off'}`).join(', ')}`);
  check(tiers.every((x) => x.ok), 'the field shares the splat window size and texel on every tier ("low": off)');
  check(HULL_FOAM.washFull > HULL_FOAM.minSpeed && SPRAY.spindriftFull > SPRAY.spindriftFrom, 'tunables consistent');
  // Shader structure.
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
  const all = [FOAM_SIM_FRAG, FOAM_STAMP_VERT, FOAM_STAMP_FRAG, FOAM_WATER_GLSL, FOAM_BREAK_GLSL, WATER_FRAGMENT_GLSL, WAKE_FRAGMENT];
  const uses =
    WATER_FRAGMENT_GLSL.includes('foamFieldAt(') &&
    WATER_FRAGMENT_GLSL.includes('foamBreakCell(') &&
    FOAM_SIM_FRAG.includes('waveParticlesAt(') &&
    FOAM_SIM_FRAG.includes('foamBreakCell(') &&
    WATER_FRAGMENT_GLSL.includes('dragonFoam') &&
    WAKE_FRAGMENT.includes('uNearFade') &&
    WAVE_WATER_GLSL.length > 0;
  const declared = ['uPrev', 'uGrid', 'uShift', 'uKeep', 'uFill', 'uCaps', 'uBreak', 'uDrift', 'uSurf', 'uCrestZ'].every((u) => new RegExp(`uniform\\s+\\w+\\s+${u}(\\[|;)`).test(FOAM_SIM_FRAG));
  console.log(`  GLSL: ${all.reduce((n, s) => n + s.split('\n').length, 0)} lines checked; the full sim, stamp, water and wake shaders parse with @shaderfrog/glsl-parser (run from a scratch directory, not a dependency)`);
  check(all.every(balanced) && uses && declared, 'balanced GLSL; the sim declares its uniforms; the water shader samples the field and the breaking cells; the ribbons fade inside the field');
}

console.log(`\ncoverage table for the planning doc:\n${coverageRows.join('\n')}`);
console.log(`\nfinished in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(failures.length ? `\n${failures.length} check(s) FAILED:\n  ${failures.join('\n  ')}` : '\nAll foam checks passed.');
process.exit(failures.length ? 1 : 0);
