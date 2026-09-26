/**
 * Headless check of the "gull and simit on a ferry" flock (src/moments/actors/gull-simit/flock.ts). No browser, no GPU.
 *
 *   npx tsx tools/headless/moments-gulls-check.ts           # all sections
 *   npx tsx tools/headless/moments-gulls-check.ts --quick   # skips the real-fleet section
 *
 * 1. Scripted vapur (straight, a long turn, straight, slowing) with heave: the gulls stay near the stern anchor as the
 *    ferry moves and turns, simit pieces are tossed and caught in the air and picked from the water, no two gulls
 *    ever overlap, no gull enters the hull box, no NaNs.
 * 2. The dragon: it flies in through the flock and hovers behind the stern; the gulls scatter, keep their distance and
 *    regroup around it.
 * 3. Frame-rate robustness: the same run at 1/24, 1/60 and 1/144 s frames and with hitches passes the same checks.
 * 4. Wind-down: after release the extra gulls fly off and vanish far from the camera; the core is handed back.
 * 5. Performance: CPU per frame with the largest flock (36 gulls) at 24 and 60 fps.
 * 6. Real fleet: the living world's ferries (catalog, routes, rigid bodies) through the moments' anchor feed; the
 *    flock follows a real vapur in service for two minutes under the same checks.
 *
 * Exits non-zero on any failure.
 */
import * as THREE from 'three';
import type { VesselPose } from '../../src/core/contracts';
import { AnchorFeed, inService } from '../../src/moments/anchors';
import { GULL_TUNING, GullFlock, GullState, type FerryFrame, type Point3 } from '../../src/moments/actors/gull-simit/flock';
import { gullCountFor } from '../../src/moments/actors/gull-simit/actor';

const QUICK = process.argv.includes('--quick');
let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
}
const f1 = (v: number): string => v.toFixed(1);
const f2 = (v: number): string => v.toFixed(2);

/** Ferry of the vapur design (length, beam, draft; air draft of the built model is ~17 m). */
function vapur(): FerryFrame {
  return { x: 0, z: 0, yaw: 0, heave: 0, speed: 7.2, length: 72, beam: 13.2, draft: 3.1, airDraft: 17 };
}

/** Scripted route: 40 s straight north, 60 s turning to starboard at 0.05 rad/s, 40 s straight, 20 s slowing to 3 m/s. */
function scriptFerry(f: FerryFrame, t: number, dt: number): void {
  let yawRate = 0;
  if (t > 40 && t < 100) yawRate = -0.05;
  f.yaw += yawRate * dt;
  f.speed = t < 140 ? 7.2 : Math.max(3, 7.2 - (t - 140) * 0.21);
  f.x += -Math.sin(f.yaw) * f.speed * dt;
  f.z += -Math.cos(f.yaw) * f.speed * dt;
  f.heave = 0.25 * Math.sin(t * 0.9) + 0.1 * Math.sin(t * 2.3);
}

const surface = (x: number, z: number): number => 0.15 * Math.sin(x * 0.2 + z * 0.13);

interface RunStats {
  frames: number;
  nan: boolean;
  minPair: number;
  minHull: number;
  /** Distances of hovering gulls from the stern anchor (no dragon near). */
  hoverDist: number[];
  /** Distances of hovering gulls from the stern anchor while turning. */
  turnDist: number[];
  minDragon: number;
  fleeSeen: boolean;
  regroupDist: number[];
  catchesAir: number;
  catchesWater: number;
  tosses: number;
  cpuMs: number[];
}

function pct(a: number[], p: number): number {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

/** Flies the scripted scenario with frames of `dtOf(frame)` seconds; the dragon enters at 150 s when `withDragon`. */
function run(dtOf: (k: number) => number, seconds: number, withDragon: boolean, count = 30, seed = 3): { st: RunStats; flock: GullFlock; ferry: FerryFrame } {
  const ferry = vapur();
  const flock = new GullFlock(seed);
  const cam: Point3 = { x: 60, y: 20, z: 40 };
  // Twelve ambient gulls handed over, loosely behind the stern.
  const handed = new Float32Array(6 * 12);
  for (let i = 0; i < 12; i++) {
    handed.set([(i % 4) * 6 - 9, 8 + (i % 3) * 3, 45 + Math.floor(i / 4) * 7, 0, 0, -7], i * 6);
  }
  flock.start(ferry, 'vapur', count, handed, 12, cam);
  const st: RunStats = { frames: 0, nan: false, minPair: Infinity, minHull: Infinity, hoverDist: [], turnDist: [], minDragon: Infinity, fleeSeen: false, regroupDist: [], catchesAir: 0, catchesWater: 0, tosses: 0, cpuMs: [] };
  const dragon: Point3 = { x: 0, y: 0, z: 0 };
  const stern: Point3 = { x: 0, y: 0, z: 0 };
  let t = 0;
  let k = 0;
  while (t < seconds) {
    const dt = dtOf(k++);
    t += dt;
    scriptFerry(ferry, t, dt);
    // The dragon (150..200 s): flies in from 160 m abeam at 12 m/s, then hovers 25 m behind the stern, moving with it.
    let d: Point3 | null = null;
    if (withDragon && t > 150 && t < 200) {
      flock.sternPoint(ferry, stern);
      const fx = -Math.sin(ferry.yaw);
      const fz = -Math.cos(ferry.yaw);
      const rx = Math.cos(ferry.yaw);
      const rz = -Math.sin(ferry.yaw);
      const hoverX = stern.x - fx * 25;
      const hoverZ = stern.z - fz * 25;
      const lat = Math.max(0, 160 - (t - 150) * 12);
      dragon.x = hoverX + rx * lat;
      dragon.z = hoverZ + rz * lat;
      dragon.y = 14;
      d = dragon;
    }
    const c0 = performance.now();
    flock.update(dt, ferry, d, cam, surface);
    st.cpuMs.push(performance.now() - c0);
    st.frames++;
    flock.sternPoint(ferry, stern);
    const turning = t > 50 && t < 100;
    for (let i = 0; i < flock.count; i++) {
      const s = flock.state[i];
      if (s === GullState.Gone) continue;
      const x = flock.px[i];
      const y = flock.py[i];
      const z = flock.pz[i];
      if (!Number.isFinite(x + y + z + flock.vx[i] + flock.vy[i] + flock.vz[i] + flock.yaw[i] + flock.bank[i] + flock.flapAmp[i])) st.nan = true;
      st.minHull = Math.min(st.minHull, flock.hullClearance(ferry, i));
      for (let j = i + 1; j < flock.count; j++) {
        if (flock.state[j] === GullState.Gone) continue;
        st.minPair = Math.min(st.minPair, Math.hypot(x - flock.px[j], y - flock.py[j], z - flock.pz[j]));
      }
      const ds = Math.hypot(x - stern.x, y - stern.y, z - stern.z);
      if (t > 15 && s === GullState.Hover && !d) (turning ? st.turnDist : st.hoverDist).push(ds);
      if (d) {
        st.minDragon = Math.min(st.minDragon, Math.hypot(x - d.x, y - d.y, z - d.z));
        if (s === GullState.Flee) st.fleeSeen = true;
        if (t > 185 && s === GullState.Hover) st.regroupDist.push(ds);
      }
    }
  }
  st.catchesAir = flock.stats.catchesAir;
  st.catchesWater = flock.stats.catchesWater;
  st.tosses = flock.stats.tosses;
  return { st, flock, ferry };
}

function report(label: string, st: RunStats, withDragon: boolean): void {
  check(!st.nan, `${label}: no NaNs in ${st.frames} frames`);
  check(st.minPair >= 1.35, `${label}: no two gulls overlap (closest centres ${f2(st.minPair)} m ≥ 1.35 m, wingspan 1.35 m)`);
  check(st.minHull > 0.3, `${label}: no gull inside the hull box (closest ${f2(st.minHull)} m outside)`);
  const m50 = pct(st.hoverDist, 50);
  const m95 = pct(st.hoverDist, 95);
  check(m50 < 22 && m95 < 40, `${label}: hovering gulls hang by the stern (median ${f1(m50)} m, 95 % ${f1(m95)} m from the stern anchor)`);
  const t50 = pct(st.turnDist, 50);
  const t95 = pct(st.turnDist, 95);
  check(t50 < 24 && t95 < 45, `${label}: and follow it through the turn (median ${f1(t50)} m, 95 % ${f1(t95)} m)`);
  check(st.tosses >= 20, `${label}: simit tossed (${st.tosses}×)`);
  check(st.catchesAir >= 5, `${label}: caught in the air (${st.catchesAir}×)`);
  check(st.catchesWater >= 1, `${label}: picked from the water (${st.catchesWater}×)`);
  if (withDragon) {
    check(st.fleeSeen, `${label}: the dragon scatters them`);
    check(st.minDragon > 14, `${label}: they keep clear of the dragon (closest ${f1(st.minDragon)} m; its half-span is 10 m)`);
    const r50 = pct(st.regroupDist, 50);
    check(st.regroupDist.length > 0 && r50 < 70, `${label}: and regroup around it by the stern (median ${f1(r50)} m from the stern while it hovers there)`);
  }
}

/* ------------------------------------------------------------------ */
console.log('moments-gulls-check');
console.log('1–2. scripted vapur, 24 fps, dragon from 150 s');
const base = run(() => 1 / 24, 210, true);
report('24 fps', base.st, true);
console.log(`     (gulls ${base.flock.count}, tosses ${base.st.tosses}, air ${base.st.catchesAir}, water ${base.st.catchesWater}, sunk ${base.flock.stats.sunk}, deck ${base.flock.stats.landedOnDeck}, flees ${base.flock.stats.flees})`);

console.log('3. frame-rate robustness');
for (const [label, dtOf] of [
  ['60 fps', () => 1 / 60],
  ['144 fps', () => 1 / 144],
  ['24 fps with hitches', (k: number) => (k % 97 === 50 ? 0.25 : k % 31 === 7 ? 0.1 : 1 / 24)],
] as Array<[string, (k: number) => number]>) {
  const r = run(dtOf, 210, true);
  report(label, r.st, true);
}

console.log('4. wind-down');
{
  const { flock, ferry } = run(() => 1 / 24, 60, false);
  const cam: Point3 = { x: ferry.x + 60, y: 20, z: ferry.z };
  const visibleBefore = flock.visible;
  flock.release(cam);
  let t = 0;
  let nan = false;
  while (!flock.done && t < 40) {
    t += 1 / 24;
    scriptFerry(ferry, 60 + t, 1 / 24);
    flock.update(1 / 24, ferry, null, cam, surface);
    for (let i = 0; i < flock.count; i++) if (!Number.isFinite(flock.px[i] + flock.py[i] + flock.pz[i])) nan = true;
  }
  const out = new Float32Array(6 * GULL_TUNING.capacity);
  const core = flock.takeCore(out);
  check(flock.done && t <= 30, `after release the extra gulls fly off and vanish (${visibleBefore} → ${flock.visible} visible in ${f1(t)} s)`);
  check(core === 12 && !nan, `the 12 handed-over gulls are handed back (${core})`);
  let far = true;
  for (let i = 12; i < flock.count; i++) {
    if (Math.hypot(flock.px[i] - cam.x, flock.pz[i] - cam.z) < 150) far = false;
  }
  check(far, 'the leaving gulls vanished at least 150 m from the camera');
}

console.log('5. performance');
{
  const n = gullCountFor(500);
  check(n <= 40 && gullCountFor(60) >= 18, `flock size per quality: low ${gullCountFor(60)}, medium ${gullCountFor(150)}, high ${gullCountFor(300)}, ultra ${n} (≤ 40)`);
  for (const fps of [24, 60]) {
    // Warm up the JIT, then measure.
    run(() => 1 / fps, 30, false, n, 9);
    const r = run(() => 1 / fps, 120, true, n, 11);
    const ms = r.st.cpuMs.slice(Math.floor(r.st.cpuMs.length * 0.1));
    const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    check(mean <= 0.2, `CPU per frame at ${fps} fps with ${n} gulls: mean ${mean.toFixed(3)} ms, 95 % ${pct(ms, 95).toFixed(3)} ms (≤ 0.2 ms mean)`);
  }
}

/* ------------------------------------------------------------------ */
if (!QUICK) {
  console.log('6. real fleet');
  const { buildHeadlessGeo } = await import('./geo');
  const { buildCatalog } = await import('../../src/world/life/vessels/catalog');
  const { Fleet } = await import('../../src/world/life/vessels/fleet');
  const { buildStraitLanes, placeBerths } = await import('../../src/world/life/vessels/routes');
  const { createLifeService } = await import('../../src/world/life/life-service');
  const geo = buildHeadlessGeo();
  const models = await buildCatalog();
  const fleet = new Fleet({ geo, models, berths: placeBerths(geo), lanes: buildStraitLanes(geo), shipCount: 45 }, new THREE.MeshBasicMaterial());
  const life = createLifeService({ fleet, flocks: null });
  const feed = new AnchorFeed();
  const cam = new THREE.Vector3(0, 50, 0);
  const dt = 1 / 24;
  // Let the fleet settle into its schedule.
  for (let k = 0; k < 60 * 24; k++) fleet.update(dt, cam);
  const anchors = feed.update(life);
  const ferries = feed.vesselsOf('ferry');
  const kinds = new Set(ferries.map((p) => p.kind));
  check(ferries.length >= 4 && kinds.has('vapur') && kinds.has('ferry'), `anchor feed sees the vapurs and city ferries (${ferries.length}: ${[...kinds].join(', ')})`);
  check(anchors.ferry.length >= 1 && anchors.ferry.every((a) => ferries.some((p) => p.id === a.id && inService(p))), `the 'ferry' anchor lists only ferries in service (${anchors.ferry.length} of ${ferries.length})`);
  const pick = ferries.filter((p) => inService(p) && p.kind === 'vapur').sort((a, b) => geo.coastDistance(a.x, a.z) - geo.coastDistance(b.x, b.z))[0];
  check(!!pick, 'a vapur in service to follow');
  if (pick) {
    const pose: VesselPose = { ...pick };
    const frame: FerryFrame = { x: pose.x, z: pose.z, yaw: pose.yaw, heave: pose.heave, speed: pose.speed, length: pose.length, beam: pose.beam, draft: pose.draft, airDraft: pose.airDraft };
    const flock = new GullFlock(5);
    flock.start(frame, pose.kind, 30, null, 0, { x: pose.x + 200, y: 30, z: pose.z });
    let minPair = Infinity;
    let minHull = Infinity;
    let nan = false;
    const dist: number[] = [];
    const stern: Point3 = { x: 0, y: 0, z: 0 };
    let yawTravel = 0;
    let prevYaw = pose.yaw;
    let serviceFrames = 0;
    for (let k = 0; k < 120 * 24; k++) {
      fleet.update(dt, cam.set(pose.x, 50, pose.z));
      life.vessel(pick.id, pose);
      Object.assign(frame, { x: pose.x, z: pose.z, yaw: pose.yaw, heave: pose.heave, speed: pose.speed });
      yawTravel += Math.abs(Math.atan2(Math.sin(pose.yaw - prevYaw), Math.cos(pose.yaw - prevYaw)));
      prevYaw = pose.yaw;
      flock.update(dt, frame, null, { x: pose.x + 200, y: 30, z: pose.z });
      flock.sternPoint(frame, stern);
      const moving = pose.speed > 3;
      if (moving) serviceFrames++;
      for (let i = 0; i < flock.count; i++) {
        if (flock.state[i] === GullState.Gone) continue;
        if (!Number.isFinite(flock.px[i] + flock.py[i] + flock.pz[i])) nan = true;
        minHull = Math.min(minHull, flock.hullClearance(frame, i));
        for (let j = i + 1; j < flock.count; j++) minPair = Math.min(minPair, Math.hypot(flock.px[i] - flock.px[j], flock.py[i] - flock.py[j], flock.pz[i] - flock.pz[j]));
        if (k > 20 * 24 && moving && flock.state[i] === GullState.Hover) dist.push(Math.hypot(flock.px[i] - stern.x, flock.py[i] - stern.y, flock.pz[i] - stern.z));
      }
    }
    console.log(`     (vapur #${pick.id}, air draft ${f1(pose.airDraft)} m, heading change ${f1((yawTravel * 180) / Math.PI)}°, ${f1(serviceFrames / 24)} s under way)`);
    check(!nan && minPair >= 1.35 && minHull > 0.3, `real vapur: no NaNs, no overlaps (${f2(minPair)} m), clear of the hull (${f2(minHull)} m)`);
    const m50 = pct(dist, 50);
    const m95 = pct(dist, 95);
    check(dist.length > 0 && m50 < 24 && m95 < 45, `real vapur: gulls hang by the stern while it runs its line (median ${f1(m50)} m, 95 % ${f1(m95)} m)`);
    check(flock.stats.catchesAir + flock.stats.catchesWater >= 3, `real vapur: simit caught (${flock.stats.catchesAir} in the air, ${flock.stats.catchesWater} from the water, ${flock.stats.tosses} tossed)`);
  }
}

console.log(`moments-gulls-check: ${checks} checks, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
