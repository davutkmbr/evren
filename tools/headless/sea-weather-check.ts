/**
 * Phase 21 stage 6 — the weather and the sea (headless, no GPU):
 *
 * 1. Storm seas: the sea's U10 under the weather (a storm holds it at SEA_WEATHER.stormU10, rain gusts it), the real
 *    SeaState building up to it, the open-sea Hs and the 7c whitecap coverage following; ?wu10 still wins.
 * 2. Swimming in waves: the real FlightSim floating on the real sea (Marmara in a lodos) at U10 2..16: rocking (pitch
 *    and roll about level) grows with the local Hs, stays within its bounds, rides long waves with some amplification
 *    and short chop with less; the float tracks the surface; the rider (the real rig) stays above the water in the
 *    roughest sea.
 * 3. Water take-offs: the run lasts 1.2 s in calm water and longer in a lodos, costs more stamina there, a crest can
 *    cut it short (never before crestMinRun), and every run leaves the water.
 * 4. Rain on the water: the drop ring uniforms follow the rain (zero without it), the ring slope (JS port of the
 *    shader) grows with the rain and is finite, the short waves are damped.
 * 5. Sea fog: the activation logic (weather, time of day, regime, wind, rain, humidity), lifting through the morning,
 *    hysteresis, zero density when off, NaN inputs.
 * 6. Flow: the surface proximity of low flight over waves is measured against the local wave height (skimming a crest
 *    counts as a use of the world), no special case needed.
 * 7. Shaders (structure) and cost estimates.
 *
 *   npx tsx tools/headless/sea-weather-check.ts [--quick]
 */
import * as THREE from 'three';
import type { WaterService } from '../../src/core/contracts';
import { headingToYaw, latLonToLocal } from '../../src/core/geo-coords';
import { PHYSICS_DT, SWIM, SWIM_POSE, SWIM_SEA } from '../../src/dragon/flight/params';
import { seaRoughness, waterRunDuration } from '../../src/dragon/flight/locomotion';
import { proximity } from '../../src/dragon/flight/flow/harmony';
import { clearPilotEdges, createPilotCommand } from '../../src/dragon/flight/types';
import type { FlightSim } from '../../src/dragon/flight/sim';
import { monahanCoverage } from '../../src/world/water/foam/whitecaps';
import { SeaState } from '../../src/world/water/sea-state';
import { RAIN_RINGS, SEA_WEATHER } from '../../src/world/water/weather/config';
import { rainRingParams, rainRingSlope, seaWindU10 } from '../../src/world/water/weather/sea-weather';
import { RAIN_RING_GLSL } from '../../src/world/water/weather/shaders.glsl';
import { WATER_FRAGMENT_GLSL } from '../../src/world/water/shaders/water-fragment.glsl';
import { SEA_FOG, SeaFogModel, seaFogDayAmount, seaFogLift, seaFogTarget, type SeaFogInputs } from '../../src/render/weather/sea-fog';
import { buildHeadlessGeo } from './geo';
import { createHeadlessSim, LiftEnv } from './lift-sim';
import { createHeadlessSea } from './water-sea';
import { buildRig, PoseRuntime } from './pose/runtime';

const QUICK = process.argv.includes('--quick');
const failures: string[] = [];
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'nan');
const f3 = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : 'nan');
const DEG = Math.PI / 180;

function check(ok: boolean, label: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
  }
}

const tStart = Date.now();
const geo = buildHeadlessGeo();
const hs = createHeadlessSea(geo);
const waves = hs.waves;
/** Open Marmara south of the old city: the lodos sea's long fetch. */
const spot = latLonToLocal(40.93, 28.98);
console.log(`geo + sea ready in ${Date.now() - tStart} ms; Marmara spot coast distance ${geo.coastDistance(spot.x, spot.z).toFixed(0)} m`);

/* ---------------------------------------------------------------------------------------------- */
/* 1. Storm seas                                                                                  */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n1. Storm seas: the U10 the waves are built from, the open-sea Hs and the whitecap coverage');
{
  const rows: string[] = [];
  let monotone = true;
  let prev = -1;
  for (const storm of [0, 0.25, 0.5, 0.75, 1]) {
    const u = seaWindU10(4, 0, storm);
    monotone &&= u >= prev;
    prev = u;
    rows.push(`storm ${storm}: ${f2(u)}`);
  }
  console.log(`  seaWindU10(wind U10 4, no rain, storm): ${rows.join(', ')}`);
  console.log(`  rain 0.8 on U10 6: ${f2(seaWindU10(6, 0.8, 0))}; storm preset (rain 1, storm 1) on U10 4: ${f2(seaWindU10(4, 1, 1))}; on U10 9.4: ${f2(seaWindU10(9.4, 1, 1))}`);
  check(monotone && seaWindU10(4, 0, 0) === 4 && seaWindU10(12, 0, 0) === 12, 'clear weather leaves the wind alone; a storm raises the sea\'s wind monotonically');
  check(seaWindU10(4, 1, 1) >= 14 && seaWindU10(4, 1, 1) <= SEA_WEATHER.maxU10, 'the storm preset holds the sea at U10 14..16 even in a weak wind');
  check(seaWindU10(6, 0.8, 0) > 6 && seaWindU10(6, 0.8, 0) < 7, 'rain gusts the sea\'s wind a little (< +12 %)');
  check([NaN, Infinity, -5].every((v) => Number.isFinite(seaWindU10(v, v, v))), 'bad inputs give a finite wind');

  // The real SeaState: environment wind 5 m/s at 100 m (U10 3.9), the weather switching to a storm.
  const sea = new SeaState();
  const wind = new THREE.Vector3();
  const to = (218 + 180) * DEG;
  wind.set(Math.sin(to) * 5, 0, -Math.cos(to) * 5);
  let time = 1000;
  sea.update(wind, time, 0, 0, 0);
  const calmU = sea.u10;
  const hsOf = (s: SeaState): number => {
    let a2 = 0;
    for (const a of s.uniforms.uWaveAmp.value) a2 += a.x * a.x;
    return 4 * Math.sqrt(a2 / 2);
  };
  const calmHs = hsOf(sea);
  sea.weather.rain = 1;
  sea.weather.storm = 1;
  const trace: string[] = [];
  for (let s = 1; s <= 300; s++) {
    for (let k = 0; k < 10; k++) {
      time += 0.1;
      sea.update(wind, time, 0.1, 0, 0);
    }
    if (s === 20 || s === 60 || s === 120 || s === 300) trace.push(`${s} s: U10 ${f2(sea.u10)}`);
  }
  const stormU = sea.u10;
  const stormHs = hsOf(sea);
  console.log(`  real SeaState, wind 5 m/s at 100 m (lodos), then the storm preset: U10 ${f2(calmU)} -> ${trace.join(', ')}; open-sea Hs ${f2(calmHs)} -> ${f2(stormHs)} m`);
  console.log(`  whitecap coverage (Monahan, open sea): clear ${(monahanCoverage(calmU) * 100).toFixed(3)} %, storm ${(monahanCoverage(stormU) * 100).toFixed(2)} % (env wind alone tops out at U10 9.4: ${(monahanCoverage(9.4) * 100).toFixed(2)} %)`);
  check(stormU > 14 && stormU <= SEA_WEATHER.maxU10, 'the sea builds up to the storm wind (U10 > 14 after 5 min)');
  check(monahanCoverage(stormU) > 0.03 && monahanCoverage(stormU) > 4 * monahanCoverage(9.4), 'storm whitecaps everywhere: open-sea coverage > 3 %, over 4x the strongest environment wind\'s');
  check(stormHs > 2.5 * calmHs, 'the open-sea Hs grows with it');
  const forced = new SeaState();
  forced.forcedU10 = 6;
  forced.weather.storm = 1;
  forced.update(wind, time, 0.1, 0, 0);
  check(forced.u10 === 6, '?wu10 still overrides the weather');
}

/* ---------------------------------------------------------------------------------------------- */
/* 2. Swimming in waves                                                                           */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n2. Swimming in waves: rocking vs the local Hs (real FlightSim on the real sea, Marmara, lodos)');

const FLOAT_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.3, 0],
  [-0.3, 0],
  [0, 0.12],
  [0, -0.12],
];

function makeSim(): FlightSim {
  const env = new LiftEnv(11, 'calm');
  const sim = createHeadlessSim(geo, env);
  sim.options.turbulence = false;
  sim.options.thermals = false;
  sim.queueEvents = false;
  sim.world.water = waves;
  return sim;
}

const cmd = createPilotCommand();
function neutral(): void {
  cmd.pitch = 0;
  cmd.roll = 0;
  cmd.yaw = 0;
  cmd.flap = false;
  cmd.dive = false;
  cmd.brake = false;
  cmd.fire = false;
  clearPilotEdges(cmd);
}

const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
/** Body pitch (nose up +) and roll about level (rad). */
function attitude(sim: FlightSim): [number, number] {
  _q.copy(sim.body.quaternion);
  _f.set(0, 0, -1).applyQuaternion(_q);
  _r.set(1, 0, 0).applyQuaternion(_q);
  return [Math.asin(THREE.MathUtils.clamp(_f.y, -1, 1)), Math.asin(THREE.MathUtils.clamp(_r.y, -1, 1))];
}

/** Plane slope angles (forward, right) of the body-averaged surface, as the float samples it. */
function planeAngles(sim: FlightSim): [number, number] {
  const L = sim.rigLength;
  const p = sim.body.position;
  const fx = -Math.sin(sim.groundYaw);
  const fz = -Math.cos(sim.groundYaw);
  const h = FLOAT_POINTS.map(([a, r]) => waves.heightAt(p.x + fx * a * L - fz * r * L, p.z + fz * a * L + fx * r * L));
  return [Math.atan((h[1] - h[2]) / (0.6 * L)), Math.atan((h[3] - h[4]) / (0.24 * L))];
}

interface RockStats {
  u10: number;
  hs: number;
  pitchRms: number;
  rollRms: number;
  pitchPeak: number;
  rollPeak: number;
  planeRms: number;
  floatRms: number;
  finite: boolean;
  swimming: boolean;
}

function rockRun(u10: number, seconds: number, seed: number): RockStats {
  hs.setWind('lodos', u10);
  const sim = makeSim();
  let time = 5000 + seed * 137;
  hs.advance(time, 0, spot.x, spot.z);
  sim.teleport(spot.x, 0, spot.z, headingToYaw(120), 0, 0);
  sim.placeOnGround();
  const pitches: number[] = [];
  const rolls: number[] = [];
  const planes: number[] = [];
  let floatE2 = 0;
  let n = 0;
  let finite = true;
  let swimming = true;
  const steps = Math.round(seconds / PHYSICS_DT);
  const sub = Math.round(1 / 60 / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    if (i % sub === 0) hs.advance(time, sub * PHYSICS_DT, sim.body.position.x, sim.body.position.z);
    neutral();
    sim.step(PHYSICS_DT, cmd);
    time += PHYSICS_DT;
    const p = sim.body.position;
    finite &&= Number.isFinite(p.x + p.y + p.z + sim.seaPitch + sim.seaRoll);
    if (i * PHYSICS_DT > 8 && i % sub === 0) {
      swimming &&= sim.mode === 'swimming';
      const [pi, ro] = attitude(sim);
      pitches.push(pi);
      rolls.push(ro);
      const [pp, pr] = planeAngles(sim);
      planes.push(Math.hypot(pp, pr));
      const e = p.y + SWIM.floatDepth - waves.heightAt(p.x, p.z);
      floatE2 += e * e;
      n++;
    }
  }
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / Math.max(a.length, 1);
  const rms = (a: number[]): number => {
    const m = mean(a);
    return Math.sqrt(mean(a.map((v) => (v - m) * (v - m))));
  };
  const peak = (a: number[]): number => {
    const m = mean(a);
    return a.reduce((s, v) => Math.max(s, Math.abs(v - m)), 0);
  };
  return {
    u10,
    hs: waves.significantHeightAt(spot.x, spot.z),
    pitchRms: rms(pitches),
    rollRms: rms(rolls),
    pitchPeak: peak(pitches),
    rollPeak: peak(rolls),
    planeRms: Math.sqrt(mean(planes.map((v) => v * v))),
    floatRms: Math.sqrt(floatE2 / Math.max(n, 1)),
    finite,
    swimming,
  };
}

const rock: RockStats[] = [];
{
  const seconds = QUICK ? 40 : 90;
  for (const u10 of [2, 6, 10, 13, 16]) {
    const r = rockRun(u10, seconds, u10);
    rock.push(r);
    console.log(
      `  U10 ${String(u10).padStart(2)}: local Hs ${f2(r.hs)} m; pitch rms ${f2(r.pitchRms / DEG)}° (peak ${f2(r.pitchPeak / DEG)}°), roll rms ${f2(r.rollRms / DEG)}° (peak ${f2(r.rollPeak / DEG)}°); surface plane rms ${f2(r.planeRms / DEG)}°; rocking / plane ${f2(Math.hypot(r.pitchRms, r.rollRms) / Math.max(r.planeRms, 1e-6))}; float - surface rms ${f3(r.floatRms)} m`,
    );
  }
  let grows = true;
  for (let i = 1; i < rock.length; i++) {
    const a = Math.hypot(rock[i - 1].pitchRms, rock[i - 1].rollRms);
    const b = Math.hypot(rock[i].pitchRms, rock[i].rollRms);
    grows &&= rock[i].hs > rock[i - 1].hs && b > a * 0.95;
  }
  const calm = rock[0];
  const storm = rock[rock.length - 1];
  const amp = (r: RockStats): number => Math.hypot(r.pitchRms, r.rollRms);
  check(rock.every((r) => r.finite && r.swimming), 'no NaNs; the dragon stays afloat and swimming in every sea');
  check(grows, 'the rocking grows with the local Hs (U10 2 -> 16)');
  check(amp(storm) > 4 * amp(calm) && amp(storm) > 3 * DEG, `a lodos rocks the dragon clearly (${f2(amp(storm) / DEG)}° rms vs ${f2(amp(calm) / DEG)}° in calm water)`);
  check(rock.every((r) => r.pitchPeak <= SWIM_SEA.maxPitch + 0.07 && r.rollPeak <= SWIM_SEA.maxRoll + 0.02), 'bounded: pitch and roll peaks within the SWIM_SEA limits');
  check(amp(storm) / storm.planeRms > 0.8 && amp(storm) / storm.planeRms < 1.8, 'long lodos waves rock it about as much as their slope, with some resonance (0.8..1.8x)');
  check(rock.every((r) => r.floatRms < 0.35), 'the float still tracks the surface under it (rms < 0.35 m)');
}

// The rider on the real rig in the roughest sea: the saddle rides above the local water.
{
  hs.setWind('lodos', 16);
  const rig = await buildRig();
  const rt = new PoseRuntime(rig, -30, true, undefined, null);
  const ox = spot.x;
  const oz = spot.z;
  const shifted: WaterService = {
    heightAt: (x, z) => waves.heightAt(x + ox, z + oz),
    normalAt: (x, z, out) => waves.normalAt(x + ox, z + oz, out),
    velocityAt: (x, z, out) => waves.velocityAt(x + ox, z + oz, out),
    currentAt: (x, z, out) => waves.currentAt(x + ox, z + oz, out),
    get seaState() {
      return waves.seaState;
    },
    significantHeightAt: (x, z) => waves.significantHeightAt(x + ox, z + oz),
  };
  const T0 = 9000;
  hs.advance(T0, 0, ox, oz);
  rt.sim.world.water = shifted;
  rt.teleport(0, 0, 0, 0, 0);
  rt.sim.placeOnGround();
  const seconds = QUICK ? 30 : 60;
  const records = rt.run({
    seconds,
    renderFps: 30,
    script: (t, _sim, input) => {
      hs.advance(T0 + t, 1 / 30, ox, oz);
      // Float, then swim slowly across the waves.
      input.cmd.pitch = t > seconds / 2 ? 1 : 0;
    },
  });
  const skel = rig.skel;
  const ids = ['riderHead', 'riderChest', 'riderSpine'].map((n) => skel.id(n)).filter((id) => id >= 0);
  const m4 = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let lowest = Infinity;
  let lowInfo = '';
  let finite = true;
  let frames = 0;
  for (const r of records) {
    if (r.time < 5 || r.mode !== 'swimming') continue;
    hs.advance(T0 + r.time, 0, ox, oz);
    frames++;
    for (const id of ids) {
      v.copy(skel.restHeads[id]).applyMatrix4(m4.fromArray(r.bones, id * 16));
      finite &&= Number.isFinite(v.x + v.y + v.z);
      const c = v.y - shifted.heightAt(v.x, v.z);
      if (c < lowest) {
        lowest = c;
        lowInfo = `t ${r.time.toFixed(1)} s, ${r.pitchDeg.toFixed(1)}° pitch, ${r.bankDeg.toFixed(1)}° bank, body ${f2(r.position[1] - shifted.heightAt(r.position[0], r.position[2]))} m vs its water`;
      }
    }
  }
  console.log(`  real rig, lodos U10 16 (local Hs ${f2(waves.significantHeightAt(ox, oz))} m), ${seconds} s floating then swimming: rider (head, chest, spine) lowest ${f2(lowest)} m above the local water over ${frames} frames (${lowInfo})`);
  check(frames > 0 && finite && lowest > 0.3, 'the rider stays on top in the roughest sea (> 0.3 m above the local water)');
}

/* ---------------------------------------------------------------------------------------------- */
/* 3. Water take-offs                                                                             */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n3. Water take-offs: run length, stamina and crest leaps per sea state');
interface RunStats {
  duration: number;
  stamina: number;
  crest: boolean;
  left: boolean;
  finite: boolean;
}

function takeoff(u10: number, startAt: number): RunStats {
  hs.setWind('lodos', u10);
  const sim = makeSim();
  let time = 7000 + startAt;
  hs.advance(time, 0, spot.x, spot.z);
  sim.teleport(spot.x, 0, spot.z, headingToYaw(40), 0, 0);
  sim.placeOnGround();
  const sub = Math.round(1 / 60 / PHYSICS_DT);
  let pressed = -1;
  let leftAt = -1;
  let staminaAtPress = 1;
  let staminaAtLeap = 1;
  let planned = 0;
  let finite = true;
  let high = false;
  const steps = Math.round(14 / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    const t = i * PHYSICS_DT;
    if (i % sub === 0) hs.advance(time, sub * PHYSICS_DT, sim.body.position.x, sim.body.position.z);
    neutral();
    if (pressed < 0 && t >= 4 && sim.mode === 'swimming') {
      cmd.flapPressed = true;
      pressed = t;
      // Below full, so the recovery while swimming is not clipped at 1.
      sim.stamina = 0.6;
      staminaAtPress = sim.stamina;
    }
    sim.step(PHYSICS_DT, cmd);
    time += PHYSICS_DT;
    if (pressed >= 0 && planned === 0 && sim.runDuration > 0) planned = sim.runDuration;
    if (pressed >= 0 && leftAt < 0 && sim.mode !== 'swimming') {
      leftAt = t + PHYSICS_DT;
      staminaAtLeap = sim.stamina;
    }
    const p = sim.body.position;
    finite &&= Number.isFinite(p.x + p.y + p.z);
    if (leftAt > 0 && p.y - waves.heightAt(p.x, p.z) > 4) high = true;
  }
  const duration = leftAt > 0 ? leftAt - pressed : Infinity;
  return { duration, stamina: staminaAtPress - staminaAtLeap, crest: planned > 0 && duration < planned - 0.02, left: leftAt > 0 && high, finite };
}

{
  const trials = QUICK ? 6 : 12;
  const table: Array<{ u10: number; hs: number; planned: number; runs: RunStats[] }> = [];
  for (const u10 of [2, 8, 13, 16]) {
    const runs: RunStats[] = [];
    for (let k = 0; k < trials; k++) runs.push(takeoff(u10, k * 0.83));
    hs.setWind('lodos', u10);
    hs.advance(7000, 0, spot.x, spot.z);
    const localHs = waves.significantHeightAt(spot.x, spot.z);
    table.push({ u10, hs: localHs, planned: waterRunDuration(localHs), runs });
    const d = runs.map((r) => r.duration);
    const mean = d.reduce((s, v) => s + v, 0) / d.length;
    const st = runs.reduce((s, r) => s + r.stamina, 0) / runs.length;
    console.log(
      `  U10 ${String(u10).padStart(2)} (Hs ${f2(localHs)} m, rough ${f2(seaRoughness(localHs))}): planned run ${f2(waterRunDuration(localHs))} s; runs ${d.map((x) => f2(x)).join(' ')} s (mean ${f2(mean)}); crest leaps ${runs.filter((r) => r.crest).length}/${runs.length}; stamina per run ${f3(st)}; all left the water ${runs.every((r) => r.left)}`,
    );
  }
  const calm = table[0];
  const lodos = table[table.length - 1];
  const meanOf = (r: RunStats[]): number => r.reduce((s, x) => s + x.duration, 0) / r.length;
  check(table.every((t) => t.runs.every((r) => r.finite && r.left)), 'every run leaves the water and climbs past 4 m; no NaNs');
  check(calm.runs.every((r) => Math.abs(r.duration - SWIM_POSE.runTime) < 0.05 && !r.crest), 'calm water: the run lasts 1.2 s as before, no crest leaps');
  check(lodos.planned > 1.8 && meanOf(lodos.runs) > 1.5, `a lodos makes the run longer (planned ${f2(lodos.planned)} s, mean ${f2(meanOf(lodos.runs))} s)`);
  let longer = true;
  for (let i = 1; i < table.length; i++) longer &&= table[i].planned >= table[i - 1].planned;
  check(longer, 'the planned run grows with the local Hs');
  const lodosSt = lodos.runs.reduce((s, r) => s + r.stamina, 0) / lodos.runs.length;
  const calmSt = calm.runs.reduce((s, r) => s + r.stamina, 0) / calm.runs.length;
  check(lodosSt > calmSt + 0.05, `it costs more stamina in a lodos (${f3(lodosSt)} vs ${f3(calmSt)} per run)`);
  const crestRuns = table.flatMap((t) => t.runs.filter((r) => r.crest));
  const roughCrests = lodos.runs.filter((r) => r.crest).length + table[table.length - 2].runs.filter((r) => r.crest).length;
  check(roughCrests > 0 && roughCrests < 2 * trials, `sometimes a crest shortens the run in rough seas (${roughCrests} of ${2 * trials})`);
  check(crestRuns.every((r) => r.duration >= SWIM_SEA.crestMinRun * SWIM_POSE.runTime - 0.02), 'a crest leap never comes before crestMinRun of the calm run');
  check(waterRunDuration(NaN) === SWIM_POSE.runTime && seaRoughness(-1) === 0, 'bad sea inputs read as calm');
}

/* ---------------------------------------------------------------------------------------------- */
/* 4. Rain on the water                                                                           */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n4. Rain on the water: drop rings (JS port of the shader) and damping');
{
  const u = new THREE.Vector4();
  const rows: string[] = [];
  const rmsBy: number[] = [];
  let peakFull = 0;
  let finite = true;
  for (const rain of [0, 0.2, 0.5, 0.8, 1]) {
    rainRingParams(rain, 123.4, u);
    let s2 = 0;
    let n = 0;
    const out = { x: 0, z: 0 };
    for (let t = 0; t < 4; t += 0.37) {
      for (let x = 0; x < 16; x += 0.031) {
        const z = 3.3 + x * 0.61;
        rainRingSlope(x * 1.7, z, u.y + t, u.x, out);
        finite &&= Number.isFinite(out.x + out.z);
        s2 += out.x * out.x + out.z * out.z;
        if (rain === 1) peakFull = Math.max(peakFull, Math.hypot(out.x, out.z));
        n++;
      }
    }
    const rms = Math.sqrt(s2 / n);
    rmsBy.push(rms);
    rows.push(`rain ${rain}: density ${f2(u.x)}, band damping x${f2(u.z)}, ring slope rms ${f3(rms)}, unresolved var ${u.w.toFixed(4)}`);
  }
  console.log(`  ${rows.join('\n  ')}`);
  let grows = true;
  for (let i = 1; i < rmsBy.length; i++) grows &&= rmsBy[i] > rmsBy[i - 1];
  rainRingParams(0, 50, u);
  check(u.x === 0 && u.z === 1 && u.w === 0 && rmsBy[0] === 0, 'no rain: the rings are off (the shader skips them) and the waves undamped');
  check(grows && finite, 'the ring slope grows with the rain; finite everywhere');
  rainRingParams(1, 50, u);
  console.log(`  full rain: steepest ring slope ${f3(peakFull)} (drop rings: ~1-3 mm high, ~2 cm wide)`);
  check(u.z > 0.6 && u.z < 0.8 && rmsBy[4] > 0.004 && peakFull > 0.08 && peakFull < 0.3, 'full rain: short waves damped by 30 %, ring slopes up to 0.08..0.3 (visible rings, sparse on average)');
  rainRingParams(0.5, 1e9, u);
  check(u.y >= 0 && u.y < RAIN_RINGS.period * RAIN_RINGS.wrapCycles, 'the rain clock stays small (wraps after whole cycles)');
  rainRingParams(NaN, NaN, u);
  check(u.x === 0 && Number.isFinite(u.y), 'bad inputs: rings off');
}

/* ---------------------------------------------------------------------------------------------- */
/* 5. Sea fog                                                                                     */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n5. Sea fog: activation (weather, time, regime, wind, rain, humidity), lifting, hysteresis');
{
  // A day without its own foggy morning, so the weather cases below measure the weather alone.
  let clearDay = 1;
  while (seaFogDayAmount(clearDay) > 0) clearDay++;
  let fogDay = 1;
  while (seaFogDayAmount(fogDay) === 0) fogDay++;
  const base: SeaFogInputs = { fog: 1, rain: 0, hours: 6.5, lodos: 0, u10: 4, humidity: 0.8, day: clearDay };
  const at = (o: Partial<SeaFogInputs>): number => seaFogTarget({ ...base, ...o });
  const cases: Array<[string, number]> = [
    ['fog weather, poyraz, 06:30', at({})],
    ['fog weather, poyraz, 13:00', at({ hours: 13 })],
    ['fog weather, lodos, 06:30', at({ lodos: 1 })],
    ['fog weather, poyraz U10 13, 06:30', at({ u10: 13 })],
    ['rain preset (fog 0.2, rain 0.8)', at({ fog: 0.2, rain: 0.8, humidity: 0.95 })],
    ['storm preset (fog 0.3, rain 1)', at({ fog: 0.3, rain: 1, humidity: 0.95 })],
    ['haze (0.3), poyraz, humid morning', at({ fog: 0.3, humidity: 0.8 })],
    ['clear, poyraz, 06:30 (humidity 0.70)', at({ fog: 0, humidity: 0.7 })],
    ['clear, poyraz, 13:00', at({ fog: 0, hours: 13, humidity: 0.62 })],
  ];
  for (const [label, v] of cases) console.log(`  ${label.padEnd(40)} ${f3(v)}`);
  const [morning, noon, lodos, windy, rain, storm, haze, clear, clearNoon] = cases.map((c) => c[1]);
  check(morning > 0.9, 'fog weather on a poyraz morning: a full sea fog bank');
  check(noon > 0.2 && noon < 0.45, 'fog weather at midday: a thinner bank');
  check(lodos === 0 && windy === 0 && rain === 0 && storm === 0, 'a lodos, a strong wind, rain and storms clear it');
  check(haze > 0.15 && haze < 0.8, 'haze on a humid poyraz morning: light banks');
  check(clear < 0.05 && clearNoon === 0, 'clear weather: none (a trace at most on a dry poyraz morning)');
  // Foggy mornings of their own: about a third of the days, the same answer for the same day.
  const days = Array.from({ length: 365 }, (_, i) => seaFogDayAmount(i + 1));
  const foggyDays = days.filter((v) => v > 0);
  const share = foggyDays.length / days.length;
  console.log(`  own foggy mornings: ${foggyDays.length}/365 days (${f2(share)}), amounts ${f2(Math.min(...foggyDays))}..${f2(Math.max(...foggyDays))}; clear day ${clearDay}, foggy day ${fogDay}`);
  check(share > 0.22 && share < 0.38, 'about 30 % of the days get a foggy morning of their own');
  check(foggyDays.every((v) => v >= SEA_FOG.morningMin && v <= SEA_FOG.morningMax), 'its amount stays in the configured range');
  check(days.every((v, i) => v === seaFogDayAmount(i + 1)), 'deterministic: the same day always gives the same morning');
  let runs = 0;
  for (let i = 1; i < days.length; i++) if ((days[i] > 0) !== (days[i - 1] > 0)) runs++;
  check(runs > 60, 'foggy days are scattered, not in long blocks');
  const own = { ...base, fog: 0, humidity: 0.68, day: fogDay };
  const ownMorning = seaFogTarget(own);
  const ownNoon = seaFogTarget({ ...own, hours: 13 });
  const ownLodos = seaFogTarget({ ...own, lodos: 1 });
  const ownRain = seaFogTarget({ ...own, rain: 0.8 });
  console.log(`  clear foggy-day poyraz morning ${f3(ownMorning)}, 13:00 ${f3(ownNoon)}, lodos ${f3(ownLodos)}, rain ${f3(ownRain)}`);
  check(ownMorning > 0.4 && ownNoon === 0, 'a foggy day: a bank on the clear poyraz morning, gone by midday');
  check(ownLodos === 0 && ownRain === 0, 'a lodos or rain still clears the day\'s foggy morning');
  const m0 = new SeaFogModel();
  m0.update(0.016, own);
  check(m0.active && m0.density > 0, 'the layer draws on a foggy day without any fog setting');

  const hours = [5, 7, 8.5, 9.5, 10.5, 11.5, 12];
  const lifting = hours.map((h) => at({ hours: h }));
  console.log(`  lifting through the morning (fog weather): ${hours.map((h, i) => `${h}h ${f2(lifting[i])}`).join(', ')}; layer lift ${hours.map((h) => f2(seaFogLift(h))).join(' ')}`);
  let lifts = true;
  for (let i = 2; i < lifting.length; i++) lifts &&= lifting[i] <= lifting[i - 1] + 1e-9;
  check(lifts && lifting[0] > lifting[lifting.length - 1], 'it lifts gently as the day warms (monotone from 07:00)');

  // Model: settles, hysteresis, zero when off.
  const model = new SeaFogModel();
  model.update(0.016, { ...base, fog: 0, humidity: 0.6, hours: 13 });
  check(!model.active && model.density === 0, 'off: density exactly 0 (the pass skips the branch)');
  const m2 = new SeaFogModel();
  m2.update(0.016, base);
  check(m2.active && m2.density > 0.8 * SEA_FOG.density, 'a foggy morning starts settled (no fog rolling in on the first frame)');
  // Hysteresis: a target hovering around the on threshold toggles the layer at most once.
  const m3 = new SeaFogModel();
  let toggles = 0;
  let last = m3.active;
  for (let i = 0; i < 4000; i++) {
    m3.forced = SEA_FOG.on + 0.02 * Math.sin(i * 0.05);
    m3.update(0.05, base);
    if (m3.active !== last) toggles++;
    last = m3.active;
  }
  console.log(`  target oscillating around the on threshold (${SEA_FOG.on} +- 0.02) for 200 s: ${toggles} toggle(s), amount ${f3(m3.amount)}`);
  check(toggles <= 1, 'hysteresis: no flicker at the threshold');
  // Clearing: from full to none, turns off once the amount is gone.
  const m4 = new SeaFogModel();
  m4.update(0.016, base);
  let offAt = -1;
  for (let i = 0; i < 6000; i++) {
    m4.update(0.05, { ...base, lodos: 1 });
    if (!m4.active && offAt < 0) offAt = i * 0.05;
  }
  console.log(`  a lodos arriving on a foggy morning: the fog clears and the layer turns off after ${f2(offAt)} s`);
  check(offAt > 30 && offAt < 200 && m4.density === 0, 'it clears gradually (tau 20 s) and then costs nothing');
  const m5 = new SeaFogModel();
  m5.update(NaN, { fog: NaN, rain: NaN, hours: NaN, lodos: NaN, u10: NaN, humidity: NaN, day: NaN });
  check(Number.isFinite(m5.density + m5.height + m5.amount), 'NaN inputs stay finite');
}

/* ---------------------------------------------------------------------------------------------- */
/* 6. Flow: skimming a crest                                                                      */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n6. Flow: the surface proximity of low flight over waves');
{
  hs.setWind('lodos', 16);
  const sim = makeSim();
  let time = 11000;
  hs.advance(time, 0, spot.x, spot.z);
  let worst = 0;
  let minC = Infinity;
  let maxC = -Infinity;
  let pMin = Infinity;
  let pMax = -Infinity;
  const y = 7;
  for (let k = 0; k < 400; k++) {
    time += 0.05;
    const x = spot.x + k * 1.5;
    hs.advance(time, 0.05, x, spot.z);
    sim.teleport(x, y, spot.z, headingToYaw(90), 0, 30);
    sim.sampleSurface();
    const wave = waves.heightAt(x, spot.z);
    // Clearance against the local wave height, not the mean sea level.
    worst = Math.max(worst, Math.abs(sim.footClearance + sim.footDepth() - (y - wave)));
    minC = Math.min(minC, sim.footClearance);
    maxC = Math.max(maxC, sim.footClearance);
    const pr = proximity(sim.footClearance, Infinity, 0, 30);
    pMin = Math.min(pMin, pr);
    pMax = Math.max(pMax, pr);
  }
  console.log(`  level flight at 7 m over a lodos sea: foot clearance ${f2(minC)}..${f2(maxC)} m (follows the crests; error vs y - wave height ${f3(worst)} m); flow proximity ${f2(pMin)}..${f2(pMax)}`);
  check(worst < 1e-6 && maxC - minC > 1, 'the clearance the flow reads is measured to the local wave surface');
  check(pMax > pMin + 0.02, 'passing low over a crest reads as closer (proximity rises over the crests): skimming a wave is a use of the world, no special case');
}

/* ---------------------------------------------------------------------------------------------- */
/* 7. Shaders and cost                                                                            */
/* ---------------------------------------------------------------------------------------------- */
console.log('\n7. Shaders (structure; the full GLSL parses with @shaderfrog/glsl-parser from a scratch directory) and cost');
{
  const frag = WATER_FRAGMENT_GLSL;
  check(frag.includes('uniform vec4 uRainParams;') && frag.includes('if (uRainParams.x > 0.0)') && frag.includes('rainRingSlope(xo'), 'water fragment: rain rings behind a uniform branch, sampled at the surface point');
  check(frag.includes('bandSlope *= roughMul * uRainParams.z'), 'water fragment: rain damps the detail bands');
  check(RAIN_RING_GLSL.includes('hash33') && !/texture/.test(RAIN_RING_GLSL), 'rings: procedural, no texture fetches');
  const passSrc = (await import('node:fs')).readFileSync(new URL('../../src/render/weather/weather-pass.ts', import.meta.url), 'utf8');
  check(passSrc.includes('if (uSeaFog.x > 0.0') && passSrc.includes('p.seaFogDensity > 1e-7'), 'weather pass: sea fog behind a uniform branch; counted in `active`');
  // Cost estimates (no GPU here).
  const px = 1600 * 900;
  const ringAlu = 2 * 60;
  const nearShare = 0.25;
  console.log(`  rain rings: ~${ringAlu} ALU per pixel where resolved (≈ ${Math.round(nearShare * 100)} % of the screen near the camera): ${((px * nearShare * ringAlu) / 1e9).toFixed(3)} GFLOP ≈ 0.01–0.03 ms on "high" (budget 0.1 ms); + 1 uniform branch elsewhere`);
  console.log(`  sea fog: ~90 ALU per pixel (3 exp, 1 fbm of 3 octaves) on every pixel while active: ${((px * 90) / 1e9).toFixed(3)} GFLOP ≈ 0.02–0.05 ms (budget 0.2 ms); 0 when off`);
  // CPU: rocking and the fog model.
  const sim = makeSim();
  hs.setWind('lodos', 16);
  hs.advance(20000, 0, spot.x, spot.z);
  sim.teleport(spot.x, 0, spot.z, 0, 0, 0);
  sim.placeOnGround();
  const n = 2400;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    neutral();
    sim.step(PHYSICS_DT, cmd);
  }
  const perStep = ((performance.now() - t0) / n) * 1000;
  console.log(`  CPU: a swimming step on the real sea (incl. the local Hs query) ${perStep.toFixed(1)} µs`);
  check(perStep < 200, 'swimming step stays cheap (< 200 µs incl. the wave queries)');
}

console.log(`\n${failures.length === 0 ? 'All sea-weather checks passed.' : `${failures.length} FAILED:\n  ${failures.join('\n  ')}`} (${((Date.now() - tStart) / 1000).toFixed(1)} s)`);
process.exit(failures.length === 0 ? 0 : 1);
