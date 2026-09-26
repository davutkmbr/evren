/**
 * Phase 21 stage 1 check, headless (no browser, no GPU): one sea for physics and pictures.
 *
 *   npx tsx tools/headless/water-check.ts          # all sections, exits 1 when a check fails
 *   npx tsx tools/headless/water-check.ts --quick  # fewer parity samples
 *
 * 1. Parity: a JS port of the water vertex shader (water-vertex / water-common GLSL: the same uniforms, fp32 phase
 *    arithmetic, GPU texel-centred bilinear sampling with clamp-to-edge of the geo coast, region and flow textures)
 *    displaces mesh vertices near the camera; the CPU evaluator (WaveQuery, the `water` service) must return the
 *    same height at the displaced position (max error < 2 cm), the same normal as the fragment shader's analytic
 *    Gerstner normal (over water; under land the sheet is sunk and hidden), and the particle velocity of the vertex (finite difference of the port over time), for every
 *    sea regime and wind speed, many places (open sea, Bosphorus, Golden Horn, near the shore) and times.
 * 2. Current: the Bosphorus surface current is strong in the narrows, weaker at the mouths and in the Golden Horn,
 *    zero in the far field.
 * 3. Flight on the waves (the real FlightSim with the water service): the swimming dragon tracks the local surface,
 *    skims over a ~3 m lodos sea do not tunnel into the waves, water take-off and landing onto water still work, the
 *    hands-off clearance over rough water holds, and a floating dragon drifts with the current.
 * 4. Cost: heightAt per call and the flight's water queries per frame.
 */
import * as THREE from 'three';
import { headingToYaw, latLonToLocal } from '../../src/core/geo-coords';
import type { WaterService } from '../../src/core/contracts';
import { PHYSICS_DT, SWIM } from '../../src/dragon/flight/params';
import type { FlightSim } from '../../src/dragon/flight/sim';
import { clearPilotEdges, createPilotCommand, type PilotCommand } from '../../src/dragon/flight/types';
import { fromHalf } from '../../src/world/water/bake/half';
import { MAX_WAVES } from '../../src/world/water/config';
import { buildHeadlessGeo } from './geo';
import { createHeadlessSim, LiftEnv } from './lift-sim';
import { createHeadlessSea, type HeadlessSea, type SeaWind } from './water-sea';

const QUICK = process.argv.includes('--quick');
const TRACE = !!process.env.WATER_TRACE;
const failures: string[] = [];
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : 'nan');
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'nan');
const f3 = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : 'nan');

function check(ok: boolean, label: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
  }
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
console.log(`geo built in ${Date.now() - t0} ms`);
const t1 = Date.now();
const hs = createHeadlessSea(geo);
console.log(`regions + current baked in ${Date.now() - t1} ms (${JSON.stringify(hs.bake.stats)})`);
const waves = hs.waves;

/* ---------------------------------------------------------------------------------------------- */
/* 1. Shader port                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

const fr = Math.fround;
const b = geo.bounds;
const worldRect = [fr(b.minX), fr(b.minZ), fr(1 / (b.maxX - b.minX)), fr(1 / (b.maxZ - b.minZ))];
const coastTex = { n: geo.coastGrid.width, data: geo.coastGrid.data, ch: 1 };
const regionTex = { n: hs.bake.size, data: Float32Array.from(hs.bake.region, (v) => v / 255), ch: 4 };
const flowTex = { n: hs.bake.size, data: Float32Array.from(hs.bake.flow, fromHalf), ch: 4 };
type Tex = typeof coastTex;

/** GPU texture() of a LinearFilter / ClampToEdge texture: texel centres at (i + 0.5) / n. */
function texture(t: Tex, u: number, v: number, out: number[]): number[] {
  const x = u * t.n - 0.5;
  const y = v * t.n - 0.5;
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  const fx = x - i0;
  const fy = y - j0;
  const cl = (i: number): number => (i < 0 ? 0 : i > t.n - 1 ? t.n - 1 : i);
  const a = cl(i0);
  const a1 = cl(i0 + 1);
  const c = cl(j0);
  const c1 = cl(j0 + 1);
  for (let k = 0; k < t.ch; k++) {
    const t00 = t.data[(c * t.n + a) * t.ch + k];
    const t10 = t.data[(c * t.n + a1) * t.ch + k];
    const t01 = t.data[(c1 * t.n + a) * t.ch + k];
    const t11 = t.data[(c1 * t.n + a1) * t.ch + k];
    out[k] = (t00 * (1 - fx) + t10 * fx) * (1 - fy) + (t01 * (1 - fx) + t11 * fx) * fy;
  }
  return out;
}

const glslSmooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, c: number, t: number): number => a * (1 - t) + c * t;

interface Uniforms {
  dir: number[][];
  amp: number[][];
  origin: [number, number];
  regime: number;
}

function captureUniforms(): Uniforms {
  const u = hs.sea.uniforms;
  return {
    dir: u.uWaveDir.value.map((v) => [fr(v.x), fr(v.y), fr(v.z), fr(v.w)]),
    amp: u.uWaveAmp.value.map((v) => [fr(v.x), fr(v.y), fr(v.z), fr(v.w)]),
    origin: [fr(hs.originX), fr(hs.originZ)],
    regime: fr(u.uSeaRegime.value.x),
  };
}

const _c = [0];
const _r = [0, 0, 0, 0];
const _f = [0, 0, 0, 0];

/** waveGroupWeights() + land factor at world0, as in the vertex shader. */
function shaderGroups(U: Uniforms, wx: number, wz: number): { groups: number[]; coast: number } {
  const u = fr((wx - worldRect[0]) * worldRect[2]);
  const v = fr((wz - worldRect[1]) * worldRect[3]);
  const coast = texture(coastTex, u, v, _c)[0];
  const region = texture(regionTex, u, v, _r);
  const flow = texture(flowTex, u, v, _f);
  const offshore = -coast;
  const lake = Math.min(Math.max((1 - (region[0] + region[1] + region[2] + region[3]) - 0.006) * 1.006, 0), 1);
  const fetch = Math.min(Math.max(mix(flow[2], flow[3], U.regime), 0), 1);
  const shore = glslSmooth(0, 45, offshore);
  const shortW = (region[0] + region[1] + region[2] + region[3] * 0.22) * mix(0.3, 1, shore) * mix(0.3, 1, glslSmooth(0.03, 0.4, fetch));
  const longW = (region[0] + region[2] + region[1] * 0.25) * glslSmooth(0.35, 0.8, fetch) * mix(0.15, 1, shore);
  const swellW = (region[0] + region[2] * 0.25 + region[1] * 0.04) * glslSmooth(60, 1800, offshore) * glslSmooth(0.45, 0.85, flow[2]);
  return { groups: [shortW + lake * 0.12 * shore, longW, swellW], coast };
}

/**
 * Vertex shader: displaced world position of the grid vertex at `xo` (relative to uOrigin, fp32) with vertex
 * spacing `spacing`, plus the fragment shader's analytic Gerstner normal (fade = 1, near the camera).
 */
function shaderVertex(U: Uniforms, xoX: number, xoZ: number, spacing: number): { p: [number, number, number]; n: [number, number, number]; land: number } {
  const ox = fr(xoX);
  const oz = fr(xoZ);
  const wx = fr(U.origin[0] + ox);
  const wz = fr(U.origin[1] + oz);
  const { groups, coast } = shaderGroups(U, wx, wz);
  let dx = 0;
  let dy = 0;
  let dz = 0;
  const dPdx = [1, 0, 0];
  const dPdz = [0, 0, 1];
  for (let i = 0; i < MAX_WAVES; i++) {
    const amp = U.amp[i];
    if (amp[0] <= 0) continue;
    const dir = U.dir[i];
    const gRaw = amp[3] < 0.5 ? groups[0] : amp[3] < 1.5 ? groups[1] : groups[2];
    const g = gRaw * (1 - glslSmooth(dir[3] * 0.1, dir[3] * 0.22, spacing));
    if (g <= 0) continue;
    const ph = fr(fr(dir[2] * fr(fr(dir[0] * ox) + fr(dir[1] * oz))) + amp[2]);
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    dx += dir[0] * ((amp[1] * g) / dir[2]) * c;
    dz += dir[1] * ((amp[1] * g) / dir[2]) * c;
    dy += amp[0] * g * s;
    // Fragment: analytic slopes (its own group weight has no spacing fade).
    const wa = dir[2] * amp[0] * gRaw;
    const q = amp[1] * gRaw;
    dPdx[0] += -q * dir[0] * dir[0] * s;
    dPdx[1] += wa * dir[0] * c;
    dPdx[2] += -q * dir[0] * dir[1] * s;
    dPdz[0] += -q * dir[0] * dir[1] * s;
    dPdz[1] += wa * dir[1] * c;
    dPdz[2] += -q * dir[1] * dir[1] * s;
  }
  const land = glslSmooth(0, 25, coast);
  dx *= 1 - land;
  dy *= 1 - land;
  dz *= 1 - land;
  dy -= land * 1.5;
  const n = new THREE.Vector3(dPdz[0], dPdz[1], dPdz[2]).cross(new THREE.Vector3(dPdx[0], dPdx[1], dPdx[2])).normalize();
  // The mesh sits at uOrigin + xo + disp (camera-relative on the GPU, so no large-coordinate rounding).
  return { p: [hs.originX + xoX + dx, dy, hs.originZ + xoZ + dz], n: [n.x, n.y, n.z], land };
}

/* Places: random points over water of every kind. */
interface Place {
  name: string;
  x: number;
  z: number;
}
function findWater(name: string, lat0: number, lat1: number, lon0: number, lon1: number, coastMin: number, coastMax: number, count: number, seed: number): Place[] {
  const r = rng(seed);
  const out: Place[] = [];
  for (let tries = 0; tries < 200000 && out.length < count; tries++) {
    const lat = lat0 + (lat1 - lat0) * r();
    const lon = lon0 + (lon1 - lon0) * r();
    const p = latLonToLocal(lat, lon);
    const coast = geo.coastDistance(p.x, p.z);
    if (geo.heightAt(p.x, p.z) < -1 && coast >= coastMin && coast <= coastMax) {
      out.push({ name, x: p.x, z: p.z });
    }
  }
  return out;
}
const perKind = QUICK ? 3 : 8;
const places: Place[] = [
  ...findWater('Marmara', 40.85, 40.99, 28.85, 29.15, -1e9, -1500, perKind, 11),
  ...findWater('Black Sea', 41.215, 41.255, 29.05, 29.25, -1e9, -1500, perKind, 12),
  ...findWater('Bosphorus', 41.03, 41.19, 29.0, 29.12, -1e9, -120, perKind, 13),
  ...findWater('Golden Horn', 41.025, 41.045, 28.94, 28.975, -1e9, -30, perKind, 14),
  ...findWater('near shore', 40.95, 41.2, 28.9, 29.15, -60, -3, perKind, 15),
];

console.log('\n1. Parity: CPU evaluator vs the water shader (JS port), full detail near the camera');
const regimes: Array<{ name: string; wind: SeaWind; u10: number }> = [
  { name: 'poyraz 3', wind: 'poyraz', u10: 3 },
  { name: 'poyraz 7', wind: 'poyraz', u10: 7 },
  { name: 'poyraz 12', wind: 'poyraz', u10: 12 },
  { name: 'poyraz 16', wind: 'poyraz', u10: 16 },
  { name: 'lodos 7', wind: 'lodos', u10: 7 },
  { name: 'lodos 12', wind: 'lodos', u10: 12 },
  { name: 'lodos 16', wind: 'lodos', u10: 16 },
  { name: 'turning (cross) 12', wind: 'cross', u10: 12 },
];
const times = QUICK ? [37.3, 1811.9, 250_000.25] : [0, 37.3, 611.7, 1811.9, 7200.4, 250_000.25, 2_000_000.5];
const vertsPerCamera = QUICK ? 12 : 30;
console.log('  regime               samples  Hs open  max |dh| cm  rms cm  max normal °  max |dv| m/s (vel)  Newton its (max)');
let worstHeight = 0;
const _n = new THREE.Vector3();
const _v = new THREE.Vector3();
const sampler = rng(99);
for (const regime of regimes) {
  hs.setWind(regime.wind, regime.u10);
  let maxDh = 0;
  let sumDh2 = 0;
  let count = 0;
  let maxAngle = 0;
  let maxDv = 0;
  let maxIts = 0;
  let hsOpen = 0;
  for (const time of times) {
    for (const place of places) {
      // Camera anywhere within the origin cell around the place; vertices within 20 m of the camera.
      const camX = place.x + (sampler() - 0.5) * 60;
      const camZ = place.z + (sampler() - 0.5) * 60;
      const dt = 0.01;
      hs.advance(time - dt, 0, camX, camZ);
      const Um = captureUniforms();
      hs.advance(time + dt, 0, camX, camZ);
      const Up = captureUniforms();
      hs.advance(time, 0, camX, camZ);
      const U = captureUniforms();
      hsOpen = waves.seaState.significantWaveHeight;
      for (let k = 0; k < vertsPerCamera; k++) {
        const r = 20 * Math.sqrt(sampler());
        const a = sampler() * Math.PI * 2;
        const xoX = camX - hs.originX + r * Math.cos(a);
        const xoZ = camZ - hs.originZ + r * Math.sin(a);
        const s0 = shaderVertex(U, xoX, xoZ, 0);
        const h = waves.heightAt(s0.p[0], s0.p[2]);
        maxIts = Math.max(maxIts, waves.lastIterations);
        const dh = Math.abs(h - s0.p[1]);
        maxDh = Math.max(maxDh, dh);
        sumDh2 += dh * dh;
        count++;
        // The fragment's normal ignores the sinking of the sheet under land (hidden by the terrain there).
        if (s0.land === 0) {
          waves.normalAt(s0.p[0], s0.p[2], _n);
          const cos = Math.min(1, _n.x * s0.n[0] + _n.y * s0.n[1] + _n.z * s0.n[2]);
          maxAngle = Math.max(maxAngle, (Math.acos(cos) * 180) / Math.PI);
        }
        const sm = shaderVertex(Um, xoX, xoZ, 0);
        const sp = shaderVertex(Up, xoX, xoZ, 0);
        waves.orbitalVelocityAt(s0.p[0], s0.p[2], _v);
        const fdx = (sp.p[0] - sm.p[0]) / (2 * dt);
        const fdy = (sp.p[1] - sm.p[1]) / (2 * dt);
        const fdz = (sp.p[2] - sm.p[2]) / (2 * dt);
        maxDv = Math.max(maxDv, Math.hypot(_v.x - fdx, _v.y - fdy, _v.z - fdz));
      }
    }
  }
  worstHeight = Math.max(worstHeight, maxDh);
  console.log(
    `  ${regime.name.padEnd(20)} ${String(count).padStart(7)}  ${f2(hsOpen).padStart(6)} m  ${f3(maxDh * 100).padStart(10)}  ${f3(Math.sqrt(sumDh2 / count) * 100).padStart(6)}  ${f3(maxAngle).padStart(12)}  ${f3(maxDv).padStart(18)}  ${maxIts}`,
  );
  check(maxDh < 0.02, `${regime.name}: max height error ${f3(maxDh * 100)} cm < 2 cm`);
  check(maxAngle < 0.5 && maxDv < 0.05, `${regime.name}: normal within 0.5° (${f3(maxAngle)}°), orbital velocity within 5 cm/s (${f3(maxDv)})`);
}

// Distance filtering: the shader drops waves the camera-distance vertex spacing cannot carry; the physics does not.
{
  hs.setWind('lodos', 12);
  const place = places[0];
  hs.advance(611.7, 0, place.x, place.z);
  const U = captureUniforms();
  let maxAt40 = 0;
  let maxAt200 = 0;
  for (let k = 0; k < 200; k++) {
    const a = (k / 200) * Math.PI * 2;
    for (const [r, set] of [
      [40, 0],
      [200, 1],
    ] as const) {
      const xoX = place.x - hs.originX + r * Math.cos(a);
      const xoZ = place.z - hs.originZ + r * Math.sin(a);
      const spacing = r * ((2 * Math.PI) / 224);
      const full = shaderVertex(U, xoX, xoZ, 0).p[1];
      const filtered = shaderVertex(U, xoX, xoZ, spacing).p[1];
      if (set === 0) maxAt40 = Math.max(maxAt40, Math.abs(full - filtered));
      else maxAt200 = Math.max(maxAt200, Math.abs(full - filtered));
    }
  }
  console.log(
    `  (info) the mesh's distance filter (high, 224 segments) removes up to ${f1(maxAt40 * 100)} cm of short chop 40 m from the camera and ${f1(maxAt200 * 100)} cm 200 m away; physics always uses the full surface (what the mesh shows up close)`,
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* 2. Current                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

console.log('\n2. Bosphorus surface current (peak across the water at each latitude, m/s)');
const _cur = new THREE.Vector3();
function peakAcross(lat: number, lon0: number, lon1: number): { speed: number; vz: number } {
  let best = 0;
  let vz = 0;
  for (let lon = lon0; lon <= lon1; lon += 0.0004) {
    const p = latLonToLocal(lat, lon);
    if (geo.heightAt(p.x, p.z) > -1) continue;
    waves.currentAt(p.x, p.z, _cur);
    const s = Math.hypot(_cur.x, _cur.z);
    if (s > best) {
      best = s;
      vz = _cur.z;
    }
  }
  return { speed: best, vz };
}
const profile: Array<{ lat: number; speed: number; vz: number }> = [];
for (let lat = 41.0; lat <= 41.231; lat += 0.005) {
  const r = peakAcross(lat, 28.97, 29.16);
  profile.push({ lat, ...r });
}
console.log('  ' + profile.map((p) => `${p.lat.toFixed(3)}:${f1(p.speed)}`).join('  '));
const band = (a: number, c: number): number => Math.max(...profile.filter((p) => p.lat >= a && p.lat <= c).map((p) => p.speed));
const narrows = band(41.06, 41.12);
const southMouth = band(41.0, 41.012);
const northMouth = band(41.2, 41.231);
const horn = peakAcross(41.035, 28.94, 28.965).speed;
const farMarmara = (() => {
  const p = latLonToLocal(40.88, 28.95);
  return Math.hypot(waves.currentAt(p.x, p.z, _cur).x, _cur.z);
})();
const farBlack = (() => {
  const p = latLonToLocal(41.245, 29.25);
  return Math.hypot(waves.currentAt(p.x, p.z, _cur).x, _cur.z);
})();
const southward = profile.filter((p) => p.lat >= 41.03 && p.lat <= 41.19).every((p) => p.vz > 0);
console.log(
  `  narrows (41.06-41.12) peak ${f2(narrows)}, south mouth ${f2(southMouth)}, north mouth ${f2(northMouth)}, Golden Horn ${f2(horn)}, far Marmara ${f2(farMarmara)}, far Black Sea ${f2(farBlack)}`,
);
check(narrows >= 1.5 && narrows <= 3.2, `narrows peak ${f2(narrows)} m/s within 1.5-3.2`);
check(southMouth < narrows && northMouth < narrows * 0.8, `mouths weaker than the narrows (south ${f2(southMouth)}, north ${f2(northMouth)})`);
check(horn < 0.3, `Golden Horn nearly still (${f2(horn)} m/s)`);
check(farMarmara < 0.05 && farBlack < 0.05, `far field still (Marmara ${f2(farMarmara)}, Black Sea ${f2(farBlack)})`);
check(southward, 'flows north -> south (+z) all along the strait');

/* ---------------------------------------------------------------------------------------------- */
/* 3. Flight on the waves                                                                         */
/* ---------------------------------------------------------------------------------------------- */

console.log('\n3. Flight on the waves');

/** Counts the flight's water queries (per-frame cost). */
class CountingWater implements WaterService {
  calls = 0;
  constructor(private readonly inner: WaterService) {}
  get seaState() {
    return this.inner.seaState;
  }
  heightAt(x: number, z: number): number {
    this.calls++;
    return this.inner.heightAt(x, z);
  }
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    this.calls++;
    return this.inner.normalAt(x, z, out);
  }
  velocityAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    this.calls++;
    return this.inner.velocityAt(x, z, out);
  }
  currentAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    this.calls++;
    return this.inner.currentAt(x, z, out);
  }
}

const env = new LiftEnv(11, 'calm');
const FRAME = 1 / 60;
const SUBSTEPS = Math.round(FRAME / PHYSICS_DT);

interface Run {
  sim: FlightSim;
  counter: CountingWater | null;
  time: number;
  frames: number;
}

function makeRun(withWater: boolean): Run {
  const sim = createHeadlessSim(geo, env);
  sim.options.turbulence = false;
  sim.options.thermals = false;
  sim.queueEvents = false;
  const counter = withWater ? new CountingWater(waves) : null;
  sim.world.water = counter ?? undefined;
  return { sim, counter, time: 1000, frames: 0 };
}

type Script = (t: number, sim: FlightSim, cmd: PilotCommand) => void;

/** 60 fps frames: sea state for the frame, then the physics substeps. */
function fly(run: Run, seconds: number, script: Script | null, every?: (t: number, sim: FlightSim) => void): void {
  const cmd = createPilotCommand();
  const frames = Math.round(seconds / FRAME);
  for (let f = 0; f < frames; f++) {
    const p = run.sim.body.position;
    hs.advance(run.time, FRAME, p.x, p.z);
    for (let s = 0; s < SUBSTEPS; s++) {
      cmd.pitch = 0;
      cmd.roll = 0;
      cmd.yaw = 0;
      cmd.flap = false;
      cmd.dive = false;
      cmd.brake = false;
      cmd.fire = false;
      clearPilotEdges(cmd);
      script?.(run.time, run.sim, cmd);
      run.sim.step(PHYSICS_DT, cmd);
      run.time += PHYSICS_DT;
      every?.(run.time, run.sim);
    }
    run.frames++;
  }
}

function place(run: Run, p: Place, y: number, headingDeg: number, speed: number): void {
  hs.advance(run.time, 0, p.x, p.z);
  run.sim.teleport(p.x, y, p.z, headingToYaw(headingDeg), 0, speed);
}

const marmara = findWater('Marmara', 40.9, 40.97, 28.9, 29.1, -1e9, -3000, 1, 21)[0];
const narrowsPoint = (() => {
  // The fastest water in the narrows band.
  let best: Place = marmara;
  let bestSpeed = 0;
  for (let lat = 41.06; lat <= 41.12; lat += 0.002) {
    for (let lon = 29.0; lon <= 29.1; lon += 0.0005) {
      const p = latLonToLocal(lat, lon);
      if (geo.heightAt(p.x, p.z) > -5 || geo.coastDistance(p.x, p.z) > -150) continue;
      const s = Math.hypot(waves.currentAt(p.x, p.z, _cur).x, _cur.z);
      if (s > bestSpeed) {
        bestSpeed = s;
        best = { name: 'narrows', x: p.x, z: p.z };
      }
    }
  }
  return best;
})();

// 3a. Swimming in a lodos sea.
{
  hs.setWind('lodos', 16);
  const run = makeRun(true);
  place(run, marmara, 0, 0, 0);
  run.sim.placeOnGround();
  fly(run, 5, null);
  let n = 0;
  let sumC = 0;
  let sumC2 = 0;
  let sumH = 0;
  let sumH2 = 0;
  let minPitch = Infinity;
  let maxPitch = -Infinity;
  let maxRoll = 0;
  fly(
    run,
    60,
    (t, sim, cmd) => {
      cmd.pitch = t % 20 < 10 ? 0.6 : 0;
      cmd.roll = t % 30 < 6 ? 0.5 : 0;
    },
    (_t, sim) => {
      if (sim.mode !== 'swimming') return;
      const p = sim.body.position;
      const hC = waves.heightAt(p.x, p.z);
      const e = p.y + SWIM.floatDepth - hC;
      n++;
      sumC += e;
      sumC2 += e * e;
      sumH += hC;
      sumH2 += hC * hC;
      minPitch = Math.min(minPitch, sim.pitch);
      maxPitch = Math.max(maxPitch, sim.pitch);
      maxRoll = Math.max(maxRoll, Math.abs(sim.bank));
    },
  );
  const meanH = sumH / n;
  const stdH = Math.sqrt(Math.max(sumH2 / n - meanH * meanH, 0));
  const meanE = sumC / n;
  const rmsE = Math.sqrt(sumC2 / n);
  console.log(
    `  swim, lodos U10 16 over the Marmara (Hs open ${f2(waves.seaState.significantWaveHeight)} m): surface under the chest std ${f2(stdH)} m; float height - surface: mean ${f3(meanE)} m, rms ${f2(rmsE)} m; pitch ${f1((minPitch * 180) / Math.PI)}..${f1((maxPitch * 180) / Math.PI)}°, |roll| max ${f1((maxRoll * 180) / Math.PI)}°; still swimming: ${run.sim.mode === 'swimming'}`,
  );
  check(run.sim.mode === 'swimming' && n > 0, 'stays afloat (swimming) for 60 s in a lodos sea');
  check(Math.abs(meanE) < 0.1, `mean float height tracks the local surface (offset ${f3(meanE)} m, |.| < 0.1)`);
  check(rmsE < 0.6 * stdH + 0.05, `rides the waves: rms ${f2(rmsE)} m < 0.6 x surface std (${f2(stdH)} m)`);
  check(maxPitch - minPitch > 2 * (Math.PI / 180), `pitches with the waves (range ${f1(((maxPitch - minPitch) * 180) / Math.PI)}°)`);

  // No water service: flat still sea at y = 0, floats at the float depth.
  const flat = makeRun(false);
  place(flat, marmara, 0, 0, 0);
  flat.sim.placeOnGround();
  fly(flat, 10, null);
  const fy = flat.sim.body.position.y;
  check(flat.sim.mode === 'swimming' && Math.abs(fy + SWIM.floatDepth) < 0.02, `without a water service the dragon floats on y = 0 (COM ${f3(fy)} m)`);
}

// 3b. Drift with the current in the narrows.
{
  hs.setWind('poyraz', 7);
  const run = makeRun(true);
  place(run, narrowsPoint, 0, 0, 0);
  run.sim.placeOnGround();
  fly(run, 5, null);
  const p0 = run.sim.body.position.clone();
  fly(run, 20, null);
  const p1 = run.sim.body.position;
  const drift = Math.hypot(p1.x - p0.x, p1.z - p0.z) / 20;
  waves.currentAt(p0.x, p0.z, _cur);
  const local = Math.hypot(_cur.x, _cur.z);
  console.log(`  drift in the narrows: ${f2(drift)} m/s (local current ${f2(local)} m/s, heading south: ${p1.z > p0.z})`);
  check(drift > 0.6 * local && drift < 1.3 * local && p1.z > p0.z, `a floating dragon drifts south with the current (${f2(drift)} vs ${f2(local)} m/s)`);
}

// 3c. Skims over a ~3 m lodos sea.
interface SkimStats {
  maxImmersion: number;
  plunges: number;
  contactTime: number;
  speed0: number;
  speed1: number;
  minRelY: number;
}
function skim(withWater: boolean, headingDeg: number, push: number, speed: number): SkimStats {
  const run = makeRun(withWater);
  place(run, marmara, 4, headingDeg, speed);
  const st: SkimStats = { maxImmersion: 0, plunges: 0, contactTime: 0, speed0: speed, speed1: 0, minRelY: Infinity };
  let wasAir = true;
  fly(
    run,
    8,
    (_t, _sim, cmd) => {
      cmd.pitch = push;
    },
    (_t, sim) => {
      const air = sim.airborne;
      if (wasAir && !air) st.plunges++;
      wasAir = air;
      if (!air) return;
      const imm = sim.footDepth() - sim.agl;
      if (TRACE && Math.round(_t / PHYSICS_DT) % 12 === 0) {
        const p = sim.body.position;
        console.log(`    t ${f2(_t - 1000)} mode ${sim.mode} V ${f1(sim.airspeed)} vy ${f2(sim.body.velocity.y)} COM ${f2(p.y)} water ${f2(sim.waterY)} immersion ${f2(imm)} pitch ${f1((sim.pitch * 180) / Math.PI)}`);
      }
      if (imm > 0) st.contactTime += PHYSICS_DT;
      st.maxImmersion = Math.max(st.maxImmersion, imm);
      const p = sim.body.position;
      st.minRelY = Math.min(st.minRelY, p.y - sim.waterHeight(p.x, p.z));
    },
  );
  st.speed1 = run.sim.airspeed;
  return st;
}
{
  hs.setWind('lodos', 16);
  // Peak-to-trough of the sea around the Marmara point (the "3 m sea").
  hs.advance(1000, 0, marmara.x, marmara.z);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let k = 0; k < 4000; k++) {
    const h = waves.heightAt(marmara.x + (k % 63) * 3.1, marmara.z + Math.floor(k / 63) * 3.1);
    hMin = Math.min(hMin, h);
    hMax = Math.max(hMax, h);
  }
  console.log(`  sea for the skims: lodos U10 16, crest-to-trough ${f2(hMax - hMin)} m over 200 m x 200 m`);
  console.log('  skim (8 s, W pushed)        max immersion  contact s  plunges  min COM above water  speed start->end');
  for (const [label, withWater, heading, push, speed] of [
    ['flat sea, 30 m/s', false, 218, 0.5, 30],
    ['waves, into the sea 30 m/s', true, 218, 0.5, 30],
    ['waves, down-sea 30 m/s', true, 38, 0.5, 30],
    ['waves, across 30 m/s', true, 128, 0.5, 30],
    ['waves, into the sea 45 m/s', true, 218, 0.5, 45],
    ['waves, into, hard push 30', true, 218, 1, 30],
  ] as const) {
    const s = skim(withWater, heading, push, speed);
    console.log(
      `  ${label.padEnd(28)} ${f2(s.maxImmersion).padStart(8)} m  ${f1(s.contactTime).padStart(8)}  ${String(s.plunges).padStart(7)}  ${f2(s.minRelY).padStart(12)} m  ${f1(s.speed0)} -> ${f1(s.speed1)}`,
    );
    if (withWater) {
      check(s.plunges === 0 && s.maxImmersion < 1.8, `${label}: no plunge into the waves (max immersion ${f2(s.maxImmersion)} m < 1.8)`);
    }
  }
}

// 3d. Hands-off low over rough water: the clearance assist keeps the feet off the waves.
{
  hs.setWind('lodos', 16);
  for (const withWater of [false, true]) {
    const run = makeRun(withWater);
    place(run, marmara, 12, 218, 30);
    let minClear = Infinity;
    let sumClear = 0;
    let n = 0;
    let wet = 0;
    fly(run, 30, null, (t, sim) => {
      if (t < 1010) return;
      const p = sim.body.position;
      const clear = p.y - sim.footDepth() - sim.waterHeight(p.x, p.z);
      minClear = Math.min(minClear, clear);
      sumClear += clear;
      n++;
      if (clear < 0) wet++;
    });
    console.log(`  hands-off 30 s low over the sea (${withWater ? 'lodos waves' : 'flat sea'}): feet above the water min ${f2(minClear)} m, mean ${f2(sumClear / n)} m, wet steps ${wet}`);
    if (withWater) {
      check(minClear > 0.5 && wet === 0, `hands-off never touches the waves (min feet clearance ${f2(minClear)} m)`);
    }
  }
}

// 3e. Take-off from the water and landing onto it, in a lodos sea.
{
  hs.setWind('lodos', 16);
  const run = makeRun(true);
  place(run, marmara, 0, 218, 0);
  run.sim.placeOnGround();
  fly(run, 4, null);
  let flyingAt = -1;
  let first = true;
  const start = run.time;
  let maxClear = -Infinity;
  fly(
    run,
    10,
    (t, sim, cmd) => {
      cmd.flap = true;
      cmd.flapPressed = first;
      first = false;
      cmd.pitch = t - start > 1.5 ? 0.15 : 0;
    },
    (t, sim) => {
      if (flyingAt < 0 && (sim.mode === 'flying' || sim.mode === 'gliding')) flyingAt = t - start;
      maxClear = Math.max(maxClear, sim.footClearance);
    },
  );
  console.log(`  water take-off (lodos): flying after ${f1(flyingAt)} s, mode now ${run.sim.mode}, feet clearance reached ${f1(maxClear)} m`);
  check(flyingAt > 0 && flyingAt < 7, `take-off from a lodos sea reaches flight (${f1(flyingAt)} s < 7 s)`);

  // Landing: hover over the water, L.
  place(run, marmara, 9, 218, 0);
  let landedAt = -1;
  let firstL = true;
  const ls = run.time;
  fly(
    run,
    15,
    (_t, _sim, cmd) => {
      cmd.landPressed = firstL;
      firstL = false;
    },
    (t, sim) => {
      if (landedAt < 0 && sim.mode === 'swimming') landedAt = t - ls;
    },
  );
  console.log(`  landing onto a lodos sea from a 9 m hover: swimming after ${f1(landedAt)} s`);
  check(landedAt > 0, `landing onto the water ends swimming (${f1(landedAt)} s)`);
}

/* ---------------------------------------------------------------------------------------------- */
/* 4. Cost                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

console.log('\n4. Cost');
{
  hs.setWind('lodos', 16);
  hs.advance(1234.5, 0, marmara.x, marmara.z);
  const r = rng(5);
  const N = 200_000;
  const xs = new Float64Array(N);
  const zs = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    xs[i] = marmara.x + (r() - 0.5) * 2000;
    zs[i] = marmara.z + (r() - 0.5) * 2000;
  }
  let acc = 0;
  for (let i = 0; i < 20000; i++) acc += waves.heightAt(xs[i], zs[i]);
  let t = performance.now();
  for (let i = 0; i < N; i++) acc += waves.heightAt(xs[i], zs[i]);
  const usHeight = ((performance.now() - t) * 1000) / N;
  t = performance.now();
  for (let i = 0; i < N; i++) {
    acc += waves.heightAt(xs[i], zs[i]);
    waves.normalAt(xs[i], zs[i], _n);
    waves.velocityAt(xs[i], zs[i], _v);
  }
  const usAll = ((performance.now() - t) * 1000) / N;
  void acc;
  // Per-frame usage of the flight: count the calls in typical modes.
  const perFrame: Record<string, number> = {};
  for (const [label, setup, script] of [
    ['cruise low over the sea', (run: Run) => place(run, marmara, 12, 218, 30), null],
    ['skimming', (run: Run) => place(run, marmara, 4, 218, 30), ((_t: number, _s: FlightSim, cmd: PilotCommand) => (cmd.pitch = 0.5)) as Script],
    [
      'swimming',
      (run: Run) => {
        place(run, marmara, 0, 218, 0);
        run.sim.placeOnGround();
      },
      ((_t: number, _s: FlightSim, cmd: PilotCommand) => (cmd.pitch = 0.6)) as Script,
    ],
  ] as const) {
    const run = makeRun(true);
    setup(run);
    fly(run, 1, script);
    const c0 = run.counter!.calls;
    const f0 = run.frames;
    fly(run, 5, script);
    perFrame[label] = (run.counter!.calls - c0) / (run.frames - f0);
  }
  console.log(`  heightAt: ${f2(usHeight)} µs per call (new point each call, full solve); height + normal + velocity at one point ${f2(usAll)} µs`);
  for (const [label, calls] of Object.entries(perFrame)) {
    console.log(`  ${label.padEnd(26)} ${f1(calls).padStart(5)} water queries / frame (60 fps, ${SUBSTEPS} substeps) ~ ${f1(calls * usHeight)} µs / frame (upper bound: every query a full solve)`);
  }
  const worst = Math.max(...Object.values(perFrame)) * usHeight;
  check(usHeight < 10, `heightAt < 10 µs per call (${f2(usHeight)} µs)`);
  check(worst < 250, `flight water queries < 0.25 ms per frame (${f1(worst)} µs)`);
}

console.log(`\nworst parity height error ${f3(worstHeight * 100)} cm`);
console.log(failures.length ? `\n${failures.length} check(s) FAILED:\n  ${failures.join('\n  ')}` : '\nAll water checks passed.');
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures.length ? 1 : 0);
