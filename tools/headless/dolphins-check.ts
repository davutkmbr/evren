/**
 * Headless check of the dolphins of the Bosphorus (src/world/life/dolphins): spawn rules, pod motion, the dragon's
 * company and scare, the idle cost and determinism, on the real geography, the real strait lanes and ferry routes and
 * the real sea. No browser, no GPU.
 *
 *   npx tsx tools/headless/dolphins-check.ts          # all sections, exits 1 when a check fails
 *   npx tsx tools/headless/dolphins-check.ts --quick  # fewer samples
 *
 * 1. Spawn rate: more in the morning than at noon, few at night; calm seas favoured, none in rough seas, strong wind
 *    or a storm; rain and fog thin them out. A Monte-Carlo run of the director over the strait counts real spawns.
 * 2. Spawn sites: sea only (no land, no Golden Horn), ≥ 140 m from the shore and ≥ 8 m deep, ≥ 160 m from the lanes
 *    and the ferry routes, away from the vessels, within the camera's view band; sites are found over the strait.
 * 3. Pod motion (a full life on the real sea): every dolphin always over open water, heights bounded, every act
 *    starts and ends in the water, full leaps happen with a plausible air time and apex, breaths come every few
 *    seconds, the formation stays loose but together, the pod travels along the strait, the pod leaves at the end.
 * 4. The dragon: flying low beside a pod makes it ride along (bow-riding beside it, more leaps), flying high does
 *    not; a plunge next to it or a big splash scatters it, then it regroups and carries on.
 * 5. Engine side (stubbed engine): zero cost when idle (no meshes in the scene, no pod updates), meshes only while a pod
 *    is alive, the discovery toast once, the dragon's gaze event, splashes through fx / water / audio, the bond core
 *    glancing at a dolphin.
 * 6. Determinism: the same seed and inputs give the same pods and events; another seed differs. Frame-time budget.
 */
import * as THREE from 'three';
import type { AudioService, DolphinAudioCue, DragonState, EngineContext, FxService, GameEvents, WaterService } from '../../src/core/contracts';
import { EventBus } from '../../src/core/events';
import { latLonToLocal } from '../../src/core/geo-coords';
import { createRng } from '../../src/core/math/noise';
import { ServiceRegistry } from '../../src/core/services';
import { BondCore } from '../../src/dragon/model/behavior/bond/core';
import { createInputs, type AttentionCandidate } from '../../src/dragon/model/behavior/bond/types';
import { DOLPHIN_ACCOMPANY, DOLPHIN_LOD, DOLPHIN_SPAWN } from '../../src/world/life/dolphins/config';
import { DolphinDirector, type DirectorFrame } from '../../src/world/life/dolphins/director';
import { fillDolphinInstances, type DolphinInstanceStats, type DolphinInstanceTarget } from '../../src/world/life/dolphins/dolphin-instances';
import { buildDolphinMesh } from '../../src/world/life/dolphins/dolphin-model';
import { LaneField, type LinePoints } from '../../src/world/life/dolphins/lanes';
import { ACT, DolphinPod, EVENT, type DolphinDragon, type DolphinEnv } from '../../src/world/life/dolphins/pod-sim';
import { findSpawnSite, seaWeight, siteRefusal, spawnRate, timeWeight, type SpawnConditions, type SpawnWorld } from '../../src/world/life/dolphins/spawn';
import { buildCatalog } from '../../src/world/life/vessels/catalog';
import { Fleet } from '../../src/world/life/vessels/fleet';
import { buildStraitLanes, placeBerths } from '../../src/world/life/vessels/routes';
import { buildHeadlessGeo } from './geo';
import { createHeadlessSea } from './water-sea';

const QUICK = process.argv.includes('--quick');
const failures: string[] = [];
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : String(v));

function check(ok: boolean, label: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) failures.push(label);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

const t0 = performance.now();
const geo = buildHeadlessGeo();
const lanes = buildStraitLanes(geo);
const berths = placeBerths(geo);
const hs = createHeadlessSea(geo);
hs.setWind('poyraz', 5);
const models = await buildCatalog();
const fleet = new Fleet({ geo, models, berths, lanes, shipCount: 70, water: hs.waves }, new THREE.MeshBasicMaterial());
const routeLines: LinePoints[] = [lanes.north, lanes.south];
for (const s of fleet.services) for (const leg of s.legs) routeLines.push(leg.route);
const centre = { xs: lanes.centre.map((p) => p.x), zs: lanes.centre.map((p) => p.z) };
const laneField = new LaneField(routeLines, centre);
console.log(`world ready in ${Math.round(performance.now() - t0)} ms (${fleet.vessels.length} vessels, ${fleet.services.length} ferry services)`);

const vesselDistance = (x: number, z: number): number => {
  let best = Infinity;
  for (const v of fleet.vessels) best = Math.min(best, Math.hypot(v.x - x, v.z - z) - v.model.length * 0.5);
  return best;
};
const world: SpawnWorld = {
  isWater: (x, z) => geo.isWater(x, z),
  coastDistance: (x, z) => geo.coastDistance(x, z),
  heightAt: (x, z) => geo.heightAt(x, z),
  waterName: (x, z) => geo.waterNameAt(x, z),
  laneDistance: (x, z) => laneField.distance(x, z, 600),
  course: (x, z, out) => laneField.course(x, z, out),
  vesselDistance,
};
const flatEnv: DolphinEnv = { surface: () => 0, coast: (x, z) => geo.coastDistance(x, z), course: (x, z, out) => laneField.course(x, z, out) };
const seaEnv: DolphinEnv = { surface: (x, z) => hs.waves.heightAt(x, z), coast: flatEnv.coast, course: flatEnv.course };

const L = (lat: number, lon: number): { x: number; z: number } => latLonToLocal(lat, lon);
const SPOTS = {
  bebek: L(41.078, 29.052),
  kandilli: L(41.07, 29.058),
  besiktas: L(41.038, 29.012),
  mouth: L(41.0, 28.995),
  marmara: L(40.965, 28.975),
  rumeliKavagi: L(41.18, 29.08),
  halic: L(41.03, 28.955),
  sisli: L(41.06, 28.99),
};

const CALM: SpawnConditions = { hours: 8, waveHeight: 0.25, windSpeed: 4, rain: 0, storm: 0, fog: 0 };

/* ------------------------------------------------------------------ */
/* 1. Spawn rate                                                       */
/* ------------------------------------------------------------------ */
section('1. Spawn rate: time of day, sea state, weather');
{
  const morning = timeWeight(8);
  const noon = timeWeight(13);
  const night = timeWeight(2);
  console.log(`    time weight: 08 h ${f2(morning)}, 13 h ${f2(noon)}, 02 h ${f2(night)}, 23.9 h ${f2(timeWeight(23.9))}, 24 h ${f2(timeWeight(24))}`);
  check(morning > noon * 1.4 && noon > night * 2.5, 'more pods in the morning than at noon, few at night');
  check(Math.abs(timeWeight(0) - timeWeight(24)) < 1e-9 && Math.abs(timeWeight(-1) - timeWeight(23)) < 1e-9, 'the day wraps');
  const calm = seaWeight(CALM);
  const moderate = seaWeight({ ...CALM, waveHeight: 0.9, windSpeed: 9 });
  const rough = seaWeight({ ...CALM, waveHeight: 1.8, windSpeed: 12 });
  const windy = seaWeight({ ...CALM, waveHeight: 0.5, windSpeed: 15 });
  const storm = seaWeight({ ...CALM, storm: 0.6, rain: 0.8 });
  const rain = seaWeight({ ...CALM, rain: 1 });
  const fog = seaWeight({ ...CALM, fog: 1 });
  console.log(`    sea weight: calm ${f2(calm)}, moderate ${f2(moderate)}, rough ${f2(rough)}, 15 m/s wind ${f2(windy)}, storm ${f2(storm)}, rain ${f2(rain)}, fog ${f2(fog)}`);
  check(calm > moderate && moderate > 0, 'calm seas favoured over a moderate sea');
  check(rough === 0 && windy === 0 && storm === 0, 'none in rough seas, strong wind or a storm');
  check(rain < calm && fog < calm && rain > 0 && fog > 0, 'rain and fog thin them out');
  const perMin = spawnRate(CALM) * 60;
  console.log(`    calm morning: ${f2(perMin)} pods per minute within view (one every ${f1(1 / perMin)} min before the gap and site rules)`);
  check(perMin > 1 / 6 && perMin < 1, 'a pod every few minutes on a calm morning');

  // Monte-Carlo: the director with the camera cruising along the Bosphorus.
  const runFor = (cond: SpawnConditions, minutes: number, seed: number): number => {
    const d = new DolphinDirector(seed, world, flatEnv);
    const f: DirectorFrame = { dt: 0.5, camX: 0, camY: 150, camZ: 0, fwdX: 0, fwdZ: 1, camAltitude: 150, conditions: cond, dragon: null };
    const path = lanes.south;
    const s = [0, 0, 0, 0];
    for (let t = 0; t < minutes * 60; t += f.dt) {
      path.sample((t * 30) % path.length, s);
      f.camX = s[0];
      f.camZ = s[1];
      f.fwdX = s[2];
      f.fwdZ = s[3];
      d.update(f);
    }
    return d.stats.spawns;
  };
  const minutes = QUICK ? 240 : 720;
  const nMorning = runFor({ ...CALM, hours: 8 }, minutes, 11);
  const nNoon = runFor({ ...CALM, hours: 13 }, minutes, 12);
  const nNight = runFor({ ...CALM, hours: 2 }, minutes, 13);
  const nStorm = runFor({ ...CALM, storm: 0.7, rain: 0.9, waveHeight: 1.2, windSpeed: 12 }, minutes, 14);
  const nRough = runFor({ ...CALM, waveHeight: 1.9, windSpeed: 12.5 }, minutes, 15);
  console.log(`    ${minutes} min along the strait: morning ${nMorning}, noon ${nNoon}, night ${nNight}, storm ${nStorm}, rough sea ${nRough} pods`);
  check(nMorning > nNoon && nNoon > nNight, 'the director follows the time weighting (morning > noon > night)');
  check(nStorm === 0 && nRough === 0, 'no pods in a storm or a rough sea');
  check(nMorning / minutes > 1 / 8 && nMorning / minutes < 1 / 1.2, `a morning pod every ${f1(minutes / Math.max(1, nMorning))} min (few minutes)`);
}

/* ------------------------------------------------------------------ */
/* 2. Spawn sites                                                      */
/* ------------------------------------------------------------------ */
section('2. Spawn sites: open sea, away from the shore, lanes, ferry routes and vessels');
{
  const rng = createRng(21);
  const tries = QUICK ? 150 : 500;
  let found = 0;
  let bad = 0;
  let halic = 0;
  let minShore = Infinity;
  let minLane = Infinity;
  let minVessel = Infinity;
  let minDepth = Infinity;
  let bandBad = 0;
  const perSpot: Record<string, number> = {};
  for (const [name, p] of Object.entries(SPOTS)) {
    let n = 0;
    for (let i = 0; i < tries; i++) {
      const a = rng() * Math.PI * 2;
      const fx = Math.sin(a);
      const fz = Math.cos(a);
      const site = findSpawnSite(world, p.x, p.z, fx, fz, rng);
      if (!site) continue;
      n++;
      found++;
      if (siteRefusal(world, site.x, site.z) !== null) bad++;
      if (geo.waterNameAt(site.x, site.z) === 'Haliç') halic++;
      minShore = Math.min(minShore, -geo.coastDistance(site.x, site.z));
      minDepth = Math.min(minDepth, -geo.heightAt(site.x, site.z));
      minLane = Math.min(minLane, laneField.distance(site.x, site.z, 2000));
      minVessel = Math.min(minVessel, vesselDistance(site.x, site.z));
      const dx = site.x - p.x;
      const dz = site.z - p.z;
      const d = Math.hypot(dx, dz);
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
      if (d < DOLPHIN_SPAWN.nearDistance - 1 || d > DOLPHIN_SPAWN.farDistance + 1 || ang > DOLPHIN_SPAWN.halfAngle + 1e-6) bandBad++;
      if (Math.abs(Math.hypot(site.hx, site.hz) - 1) > 1e-6) bad++;
    }
    perSpot[name] = n / tries;
  }
  console.log(`    sites found per roll: ${Object.entries(perSpot).map(([k, v]) => `${k} ${f2(v)}`).join(', ')}`);
  console.log(`    closest: shore ${f1(minShore)} m, depth ${f1(minDepth)} m, lane/route ${f1(minLane)} m, vessel ${f1(minVessel)} m`);
  check(found > 0 && bad === 0, `every site passes the rules (${found} sites)`);
  check(minShore >= DOLPHIN_SPAWN.minShore && minDepth >= DOLPHIN_SPAWN.minDepth, 'sea only: away from the shore, deep enough');
  check(minLane >= DOLPHIN_SPAWN.minLane && minVessel >= DOLPHIN_SPAWN.minVessel, 'away from the lanes, the ferry routes and the vessels');
  check(halic === 0, 'never in the Golden Horn');
  check(bandBad === 0, 'always within the view band of the camera');
  check(perSpot.sisli === 0 && perSpot.halic === 0 && Math.min(perSpot.bebek, perSpot.kandilli, perSpot.besiktas) > 0.15 && perSpot.marmara > 0.5, 'sites are found over the strait and the Marmara near it');
  // Rules on single points.
  const land = SPOTS.sisli;
  check(siteRefusal(world, land.x, land.z) === 'land', 'land is refused');
  const c = { x: 0, z: 0 };
  let laneRefused = false;
  for (let i = 0; i < lanes.south.count && !laneRefused; i += 7) {
    const x = lanes.south.xs[i];
    const z = lanes.south.zs[i];
    if (geo.isWater(x, z) && geo.coastDistance(x, z) < -300 && vesselDistance(x, z) > 400 && world.course(x, z, c) < 3000) laneRefused = siteRefusal(world, x, z) === 'lane';
  }
  check(laneRefused, 'a point on the traffic lane is refused');
  const farOut = L(40.75, 28.6);
  check(siteRefusal(world, farOut.x, farOut.z) !== null, 'the open Marmara far from the strait is refused');
}

/* ------------------------------------------------------------------ */
/* 3. Pod motion                                                       */
/* ------------------------------------------------------------------ */
section('3. Pod motion on the real sea (a full life)');
function podAt(spot: { x: number; z: number }, seed: number, count = 7): DolphinPod {
  const c = { x: 0, z: 1 };
  laneField.course(spot.x, spot.z, c);
  const rng = createRng(seed);
  let site = null;
  for (let k = 0; k < 40 && !site; k++) site = findSpawnSite(world, spot.x, spot.z, c.x, c.z, rng, { near: 0, far: k < 10 ? 400 : 1500, halfAngle: Math.PI });
  if (!site) throw new Error(`no dolphin site near ${Math.round(spot.x)}, ${Math.round(spot.z)}`);
  return new DolphinPod({ count, x: site.x, z: site.z, hx: site.hx, hz: site.hz, rng: createRng(seed + 1) });
}
{
  const DT = 1 / 30;
  let worstShore = -Infinity;
  let maxY = -Infinity;
  let minY = Infinity;
  let actBad = 0;
  let nan = 0;
  let leaps = 0;
  let breaths = 0;
  let maxSpread = 0;
  let courseDot = 0;
  let courseN = 0;
  let airMax = 0;
  let leftOk = 0;
  let pods = 0;
  let dolphinSeconds = 0;
  const spots = QUICK ? [SPOTS.bebek, SPOTS.marmara] : [SPOTS.bebek, SPOTS.kandilli, SPOTS.besiktas, SPOTS.mouth, SPOTS.marmara, SPOTS.rumeliKavagi];
  spots.forEach((spot, si) => {
    const pod = podAt(spot, 100 + si);
    pods++;
    const prevAct = new Uint8Array(pod.count);
    const airT = new Float64Array(pod.count);
    const c = { x: 0, z: 0 };
    let t = 0;
    hs.advance(0, 0, pod.cx, pod.cz);
    while (!pod.done && t < pod.life + 60) {
      if (Math.round(t / DT) % 15 === 0) hs.advance(t, DT * 15, pod.cx, pod.cz);
      pod.update(DT, seaEnv, null);
      t += DT;
      for (let k = 0; k < pod.eventCount; k++) {
        if (pod.eventKind[k] === EVENT.breath || pod.eventKind[k] === EVENT.leap) breaths++;
      }
      for (let i = 0; i < pod.count; i++) {
        if (!Number.isFinite(pod.px[i] + pod.py[i] + pod.pz[i] + pod.yaw[i] + pod.pitch[i] + pod.roll[i])) nan++;
        worstShore = Math.max(worstShore, geo.coastDistance(pod.px[i], pod.pz[i]));
        maxY = Math.max(maxY, pod.yRel[i]);
        minY = Math.min(minY, pod.yRel[i]);
        const a = pod.act[i];
        // An act must start and end below the surface (the body centre under the water).
        if (a !== prevAct[i] && pod.yRel[i] > 0.05) actBad++;
        if (a === ACT.leap && pod.yRel[i] > 0) airT[i] += DT;
        if (prevAct[i] === ACT.leap && a !== ACT.leap) {
          leaps++;
          airMax = Math.max(airMax, airT[i]);
          airT[i] = 0;
        }
        prevAct[i] = a;
        if (pod.mode === 'travel') maxSpread = Math.max(maxSpread, Math.hypot(pod.px[i] - pod.cx, pod.pz[i] - pod.cz));
      }
      if (pod.mode !== 'leave') dolphinSeconds += pod.count * DT;
      if (Math.round(t / DT) % 30 === 0) {
        laneField.course(pod.cx, pod.cz, c);
        courseDot += Math.abs(c.x * pod.hx + c.z * pod.hz);
        courseN++;
      }
    }
    if (pod.done && t < pod.life + 30) leftOk++;
  });
  const breathEvery = dolphinSeconds / Math.max(1, breaths);
  console.log(`    ${pods} pods: closest to shore ${f1(-worstShore)} m, height ${f2(minY)}..${f2(maxY)} m, ${leaps} leaps (longest air ${f2(airMax)} s), a breath every ${f1(breathEvery)} s per dolphin`);
  console.log(`    formation spread ≤ ${f1(maxSpread)} m, |course · heading| ${f2(courseDot / Math.max(1, courseN))}, left after their life: ${leftOk}/${pods}`);
  check(nan === 0, 'no NaNs');
  check(worstShore < -40, 'every dolphin always over open water (≥ 40 m from the shore)');
  check(actBad === 0, 'every act starts and ends in the water');
  check(maxY < 3.6 && maxY > 1.0 && minY > -7, 'heights bounded: leaps up to ~3 m, never deeper than 7 m');
  check(leaps > 0 && airMax > 0.8 && airMax < 1.7, 'full leaps with a plausible air time');
  check(breathEvery > 3 && breathEvery < 25, 'breaths every few seconds per dolphin');
  check(maxSpread < 40, 'loose formation stays together');
  check(courseDot / Math.max(1, courseN) > 0.75, 'the pod travels along the strait');
  check(leftOk === pods, 'the pod dives and leaves at the end of its life');
}

/* ------------------------------------------------------------------ */
/* 4. The dragon                                                       */
/* ------------------------------------------------------------------ */
section('4. The dragon: company and scare');
{
  const DT = 1 / 30;
  // Company: the dragon flies low along the pod's course, starting 25 m to its side.
  const run = (low: boolean, seconds: number): { pod: DolphinPod; near: number; leapRate: number; accompanied: boolean } => {
    const pod = podAt(SPOTS.bebek, 300, 6);
    const d: DolphinDragon = { x: pod.cx - pod.hz * 25, y: low ? 4 : 90, z: pod.cz + pod.hx * 25, vx: pod.hx * 11, vz: pod.hz * 11, low, underwater: false };
    let near = 0;
    let t = 0;
    const leaps0 = pod.stats.leaps;
    let accompanyTime = 0;
    while (t < seconds) {
      // The dragon follows the pod's course (a gentle steer toward the strait's direction).
      const c = { x: 0, z: 0 };
      laneField.course(d.x, d.z, c);
      const s = c.x * d.vx + c.z * d.vz >= 0 ? 1 : -1;
      d.vx += (c.x * s * 11 - d.vx) * DT * 0.5;
      d.vz += (c.z * s * 11 - d.vz) * DT * 0.5;
      d.x += d.vx * DT;
      d.z += d.vz * DT;
      pod.update(DT, flatEnv, d);
      t += DT;
      if (pod.mode === 'accompany') accompanyTime += DT;
      if (Math.hypot(pod.cx - d.x, pod.cz - d.z) < DOLPHIN_ACCOMPANY.range) near += DT;
    }
    return { pod, near, leapRate: ((pod.stats.leaps - leaps0) / Math.max(1e-6, accompanyTime || seconds)) * 60, accompanied: pod.stats.accompanied > 0 };
  };
  const withDragon = run(true, 30);
  const high = run(false, 30);
  // Travel leap rate for comparison.
  const alone = podAt(SPOTS.bebek, 300, 6);
  for (let t = 0; t < 120; t += DT) alone.update(DT, flatEnv, null);
  const travelLeapRate = (alone.stats.leaps / 120) * 60;
  console.log(`    low alongside: accompanied ${withDragon.accompanied}, within ${DOLPHIN_ACCOMPANY.range} m for ${f1(withDragon.near)} of 30 s, ${f1(withDragon.leapRate)} leaps/min (travel ${f1(travelLeapRate)})`);
  console.log(`    flying high: accompanied ${high.accompanied}`);
  check(withDragon.accompanied && withDragon.near > 20, 'flying low beside a pod: it rides along beside the dragon');
  check(withDragon.leapRate > travelLeapRate * 1.5, 'more leaps while accompanying');
  check(!high.accompanied, 'flying high over them: no company');

  // Scatter: the dragon plunges in next to the pod.
  const pod = podAt(SPOTS.bebek, 400, 7);
  for (let t = 0; t < 10; t += DT) pod.update(DT, flatEnv, null);
  const dx = pod.cx;
  const dz = pod.cz;
  const meanDist = (): number => {
    let s = 0;
    for (let i = 0; i < pod.count; i++) s += Math.hypot(pod.px[i] - dx, pod.pz[i] - dz);
    return s / pod.count;
  };
  const spread = (): number => {
    let s = 0;
    for (let i = 0; i < pod.count; i++) s = Math.max(s, Math.hypot(pod.px[i] - pod.cx, pod.pz[i] - pod.cz));
    return s;
  };
  const before = meanDist();
  const spreadBefore = spread();
  const diver: DolphinDragon = { x: dx, y: -3, z: dz, vx: 0, vz: 0, low: false, underwater: true };
  pod.update(DT, flatEnv, diver);
  const scattered = pod.mode === 'scatter';
  let surfacedWhileScattered = 0;
  for (let t = 0; t < 4; t += DT) {
    pod.update(DT, flatEnv, t < 1 ? diver : null);
    for (let k = 0; k < pod.eventCount; k++) if (pod.eventKind[k] === EVENT.breath) surfacedWhileScattered++;
  }
  const after = meanDist();
  const spreadScatter = spread();
  let back = Infinity;
  for (let t = 0; t < 30; t += DT) {
    pod.update(DT, flatEnv, null);
    if (pod.mode === 'travel' && back === Infinity) back = t + 4;
  }
  const spreadAfter = spread();
  console.log(`    plunge beside the pod: scatter ${scattered}, mean distance ${f1(before)} → ${f1(after)} m in 4 s, spread ${f1(spreadBefore)} → ${f1(spreadScatter)} → ${f1(spreadAfter)} m, back to travel after ${f1(back)} s`);
  check(scattered && after > before + 12, 'a plunge nearby scatters the pod gently away');
  check(surfacedWhileScattered === 0, 'no breaths while fleeing');
  check(back < 14 && spreadAfter < spreadScatter && spreadAfter < 40, 'then it regroups and carries on');
  // A big splash (a breach, a hard water landing) close by scatters too; a far one does not.
  const p2 = podAt(SPOTS.marmara, 500, 5);
  for (let t = 0; t < 5; t += DT) p2.update(DT, flatEnv, null);
  const far = p2.startle(p2.cx + 300, p2.cz, 3);
  const weak = p2.startle(p2.cx + 5, p2.cz, 0.5);
  const near = p2.startle(p2.cx + 20, p2.cz, 2.5);
  check(!far && !weak && near && p2.mode === 'scatter', 'a big splash close by scatters it, a weak or far one does not');
}

/* ------------------------------------------------------------------ */
/* 5. Engine side                                                       */
/* ------------------------------------------------------------------ */
section('5. Engine side (stubbed engine): idle cost, meshes, toast, gaze, effects');
{
  // A minimal browser and engine for the glue class.
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  };
  const { Dolphins, DOLPHIN_TOAST } = await import('../../src/world/life/dolphins/dolphins');
  const events = new EventBus<GameEvents>();
  const services = new ServiceRegistry();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 20000);
  const root = new THREE.Group();
  const ctx = {
    camera,
    events,
    services,
    debug: { params: new URLSearchParams(''), freeze: false, autopilot: false, stats: false, nohud: false },
    time: { timeOfDay: 8, elapsed: 0, dt: 1 / 30, realDt: 1 / 30, frame: 0, dayTimeScale: 0, dayOfYear: 200, paused: false, paceFloorMs: 16 },
    sandbox: false,
  } as unknown as EngineContext;
  let fxSplashes = 0;
  const fx: FxService = { splash: () => undefined, dust: () => undefined, worldSplash: () => void fxSplashes++ };
  const cues: Record<DolphinAudioCue, number> = { whistle: 0, breath: 0, splash: 0 };
  const audio = { dolphinCue: (c: DolphinAudioCue) => void cues[c]++ } as unknown as AudioService;
  let rings = 0;
  const water = {
    heightAt: (x: number, z: number) => hs.waves.heightAt(x, z),
    seaState: { windSpeed: 4, significantWaveHeight: 0.3, lodos: 0, regime: 'poyraz' },
    dynamic: { ring: () => void rings++ },
    foam: { splash: () => undefined },
  } as unknown as WaterService;
  services.provide('fx', fx);
  services.provide('audio', audio);
  services.provide('water', water);
  const dragonPos = new THREE.Vector3(SPOTS.bebek.x, 40, SPOTS.bebek.z);
  services.provide('dragon', {
    position: dragonPos,
    velocity: new THREE.Vector3(0, 0, -12),
    mode: 'flying',
    agl: 40,
    headingDeg: 0,
  } as unknown as DragonState);
  const toasts: string[] = [];
  const gaze: string[] = [];
  events.on('toast', ({ text }) => void toasts.push(text));
  events.on('dragon-attention', ({ kind }) => void gaze.push(kind));
  const dolphins = new Dolphins(root, geo, lanes, ctx);
  dolphins.setFleet(fleet);
  dolphins.director.rateScale = 0;
  const cam = new THREE.Vector3();
  const place = (x: number, y: number, z: number): void => {
    camera.position.set(x, y, z);
    camera.lookAt(x, y - 10, z - 60);
    camera.updateMatrixWorld();
    cam.copy(camera.position);
  };
  place(SPOTS.bebek.x, 60, SPOTS.bebek.z + 40);
  // Idle: many frames, no pod.
  const N = 20000;
  const tIdle = performance.now();
  for (let i = 0; i < N; i++) dolphins.update(1 / 60, cam);
  const idleUs = ((performance.now() - tIdle) / N) * 1000;
  const inSceneIdle = root.children.length;
  console.log(`    idle: ${f2(idleUs)} µs per frame (incl. reading the services), ${inSceneIdle} objects in the scene, ${dolphins.director.stats.podUpdates} pod updates`);
  check(inSceneIdle === 0 && !dolphins.drawing && dolphins.director.stats.podUpdates === 0, 'zero cost when idle: nothing in the scene, no pod updates');
  check(idleUs < 15, 'idle frame cost is negligible');
  // A pod near the camera: meshes appear, the toast shows once, the dragon glances, splashes go through the systems.
  const pod = dolphins.spawnNear();
  check(pod !== null, 'debug spawn near the dragon finds water');
  let maxInScene = 0;
  let drawnMax = 0;
  const target: DolphinInstanceTarget = { matrices: new Float32Array(16 * 16), poses: new Float32Array(16 * 4), capacity: 16, count: 0 };
  const target2: DolphinInstanceTarget = { matrices: new Float32Array(16 * 16), poses: new Float32Array(16 * 4), capacity: 16, count: 0 };
  const st: DolphinInstanceStats = { near: 0, far: 0, hidden: 0, nearest: 0 };
  for (let i = 0; i < 60 * 90 && dolphins.director.active; i++) {
    if (pod) place(pod.cx + 30, 25, pod.cz + 30);
    dolphins.update(1 / 60, cam);
    maxInScene = Math.max(maxInScene, root.children.length);
    fillDolphinInstances(dolphins.director.pods, cam.x, cam.y, cam.z, false, target, target2, st);
    drawnMax = Math.max(drawnMax, st.near + st.far);
  }
  console.log(`    with a pod: ${maxInScene} meshes, up to ${drawnMax} dolphins drawn, toasts ${JSON.stringify(toasts)}, gaze events ${gaze.length}, fx splashes ${fxSplashes}, rings ${rings}, cues ${JSON.stringify(cues)}`);
  check(maxInScene === 2 && drawnMax > 0, 'two instanced meshes (near and far LOD) while a pod is alive');
  check(toasts.length === 1 && toasts[0] === DOLPHIN_TOAST, 'the discovery toast shows once ("Yunuslar!")');
  check(gaze.length > 0 && gaze.every((k) => k === 'dolphin'), 'the dragon is told to look (dragon-attention, kind dolphin)');
  check(fxSplashes > 0 && rings > 0 && cues.breath > 0, 'breaths and splashes go through fx, the water rings and the audio cues');
  // Let the pod leave: meshes go away again.
  if (pod) pod.leaveNow();
  for (let i = 0; i < 60 * 30 && dolphins.director.active; i++) dolphins.update(1 / 60, cam);
  check(!dolphins.director.active && root.children.length === 0, 'after the pod left nothing is in the scene again');
  // A second pod: no second toast (seen is remembered).
  dolphins.spawnNear();
  for (let i = 0; i < 60 * 40; i++) {
    const p = dolphins.director.pods[0];
    if (p) place(p.cx + 20, 20, p.cz + 20);
    dolphins.update(1 / 60, cam);
  }
  check(toasts.length === 1, 'no second toast');
  dolphins.dispose();

  // The bond core: a dolphin candidate draws the gaze (the rider points).
  const core = new BondCore(5);
  const inp = createInputs();
  let looked = false;
  let pointed = 0;
  for (let i = 0; i < 60 * 6; i++) {
    const keep = inp.attention as AttentionCandidate[];
    Object.assign(inp, createInputs());
    inp.attention = keep;
    keep.length = 0;
    inp.mode = 'gliding';
    inp.airspeed = 22;
    inp.groundSpeed = 22;
    inp.agl = 60;
    if (i > 30) keep.push({ kind: 'dolphin', key: 'dolphin:1:2', yaw: 0.5, pitch: -0.3, distance: 180, strength: 0.9 });
    core.update(inp);
    if (core.attention.target?.kind === 'dolphin') looked = true;
    pointed = Math.max(pointed, core.attention.show);
  }
  check(looked && pointed > 0.5, 'the bond gaze glances at dolphins and the rider points');
}

/* ------------------------------------------------------------------ */
/* 6. Determinism and budget                                           */
/* ------------------------------------------------------------------ */
section('6. Determinism and budget');
{
  const runOnce = (seed: number): string => {
    const d = new DolphinDirector(seed, world, flatEnv);
    d.rateScale = 30;
    const f: DirectorFrame = { dt: 1 / 30, camX: SPOTS.bebek.x, camY: 80, camZ: SPOTS.bebek.z, fwdX: 0, fwdZ: 1, camAltitude: 80, conditions: CALM, dragon: null };
    let events = 0;
    for (let t = 0; t < 600; t += f.dt) {
      d.update(f);
      for (const p of d.pods) events += p.eventCount;
    }
    const parts = d.pods.map((p) => `${p.count}:${p.cx.toFixed(3)},${p.cz.toFixed(3)},${p.py[0].toFixed(4)}`);
    return `${d.stats.spawns}|${events}|${parts.join(';')}`;
  };
  const a = runOnce(77);
  const b = runOnce(77);
  const c = runOnce(78);
  console.log(`    seed 77: ${a.slice(0, 90)}`);
  console.log(`    seed 78: ${c.slice(0, 90)}`);
  check(a === b, 'the same seed gives the same pods and events');
  check(a !== c, 'another seed gives other pods');

  // Budget: two full pods, simulation + instance fill.
  const pods = [podAt(SPOTS.bebek, 900, 8), podAt(SPOTS.kandilli, 901, 8)];
  const near: DolphinInstanceTarget = { matrices: new Float32Array(16 * 16), poses: new Float32Array(16 * 4), capacity: 16, count: 0 };
  const farT: DolphinInstanceTarget = { matrices: new Float32Array(16 * 16), poses: new Float32Array(16 * 4), capacity: 16, count: 0 };
  const st: DolphinInstanceStats = { near: 0, far: 0, hidden: 0, nearest: 0 };
  const times: number[] = [];
  for (let i = 0; i < 3000; i++) {
    const t = performance.now();
    for (const p of pods) p.update(1 / 60, seaEnv, null);
    fillDolphinInstances(pods, pods[0].cx, 30, pods[0].cz + 60, false, near, farT, st);
    times.push(performance.now() - t);
  }
  times.sort((x, y) => x - y);
  const median = times[times.length >> 1];
  console.log(`    two pods of 8: ${f2(median * 1000)} µs per frame (median, sim + instances, real wave heights)`);
  check(median < 0.1, 'within 0.1 ms per frame');
  const nearMesh = buildDolphinMesh('near');
  const farMesh = buildDolphinMesh('far');
  console.log(`    meshes: near ${nearMesh.triangles} triangles (< ${DOLPHIN_LOD.near} m), far ${farMesh.triangles} (to ${DOLPHIN_LOD.far} m)`);
  check(nearMesh.triangles <= 300 && farMesh.triangles <= 60, 'low poly: ≤ 300 / ≤ 60 triangles');
}

console.log(failures.length ? `\n${failures.length} check(s) FAILED:\n  - ${failures.join('\n  - ')}` : '\nAll dolphin checks passed.');
process.exit(failures.length ? 1 : 0);
