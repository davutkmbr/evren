/**
 * Phase 05 wind-field acceptance check, headless (no browser, no GPU): the real GeoQuery, the real FlightSim flown
 * with flapping disabled by a simple glider autopilot, and the WindField's vertical air motion at sample points.
 *
 *   npx tsx tools/headless/lift-check.ts            # table + flights, exits 1 when an acceptance number fails
 *   npx tsx tools/headless/lift-check.ts --quick    # skip the informational flights
 *   LIFT_TRACE=1 npx tsx tools/headless/lift-check.ts   # also print the ridge flight every 2 s
 *
 * Acceptance (.docs/planning/05-flight-feel.md):
 *   - t=14 over Büyük Çamlıca: climb >= 1.5 m/s without flapping; no lift over the sea.
 *   - poyraz: altitude can be held along the Rumeli Hisarı slope with ridge lift.
 * Also guarded: calm-air glide ratio at noon over the sea stays in the flight-test envelope (8-12), lift at night ~0.
 */
import * as THREE from 'three';
import { LandUse } from '../../src/core/contracts';
import { createLiftSample, sampleLift } from '../../src/dragon/flight/lift';
import { WindField } from '../../src/dragon/flight/wind';
import type { FlightSim } from '../../src/dragon/flight/sim';
import { buildHeadlessGeo } from './geo';
import { createHeadlessSim, LiftEnv, simulate, teleport, type WindRegime } from './lift-sim';

const DEG = Math.PI / 180;
const QUICK = process.argv.includes('--quick');
const failures: string[] = [];
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : 'nan');
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'nan');

function check(ok: boolean, label: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
  }
}

const t0 = Date.now();
const geo = buildHeadlessGeo();
console.log(`geo built in ${Date.now() - t0} ms`);

/* ---------------------------------------------------------------------------------------------- */
/* Places                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

function peak(cx: number, cz: number, r: number): { x: number; z: number; h: number } {
  let best = { x: cx, z: cz, h: -Infinity };
  for (let x = cx - r; x <= cx + r; x += 10) {
    for (let z = cz - r; z <= cz + r; z += 10) {
      const h = geo.heightAt(x, z);
      if (h > best.h) {
        best = { x, z, h };
      }
    }
  }
  return best;
}

const camlica = peak(4120, 1960, 400);
const hisar = geo.landmark('rumeli-hisari') ?? { x: 3082, z: -4433 };

interface Place {
  name: string;
  x: number;
  z: number;
}

const PLACES: Place[] = [
  { name: 'Büyük Çamlıca summit', x: camlica.x, z: camlica.z },
  { name: 'Küçük Çamlıca', x: 3823, z: 3179 },
  { name: 'Rumeli Hisarı slope', x: 3000, z: -4800 },
  { name: 'Fatih (historic urban)', x: -5600, z: 2600 },
  { name: 'Belgrad forest', x: -9000, z: -16000 },
  { name: 'Bosphorus mid-channel', x: 3560, z: -4400 },
  { name: 'Bosphorus off Beşiktaş', x: -700, z: 900 },
  { name: 'Marmara', x: -2500, z: 9000 },
];

const lu = (x: number, z: number): string => LandUse[geo.landUseAt(x, z)] ?? '?';
console.log(`Büyük Çamlıca summit at (${camlica.x}, ${camlica.z}), ${f1(camlica.h)} m; Rumeli Hisarı at (${Math.round(hisar.x)}, ${Math.round(hisar.z)})`);

/* ---------------------------------------------------------------------------------------------- */
/* WindField vertical air motion at a point (gusts off: thermal + ridge only)                      */
/* ---------------------------------------------------------------------------------------------- */

const _pos = new THREE.Vector3();

function ground(x: number, z: number): number {
  return Math.max(geo.heightAt(x, z), 0);
}

function fieldLift(x: number, z: number, agl: number, env: LiftEnv, opts: { thermals?: boolean; time?: number } = {}): number {
  const wind = new WindField();
  wind.gustsEnabled = false;
  wind.thermalsEnabled = opts.thermals ?? true;
  const g = ground(x, z);
  _pos.set(x, g + agl, z);
  const overWater = geo.heightAt(x, z) < -0.4;
  wind.sample(1 / 120, _pos, agl, overWater, 20, opts.time ?? 0, env, geo);
  return wind.updraft;
}

/** Mean and max lift over a square patch (averages out where the drifting thermal cells happen to be). */
function patchLift(cx: number, cz: number, half: number, agl: number, env: LiftEnv, filter?: (x: number, z: number) => boolean): { mean: number; max: number; n: number } {
  let sum = 0;
  let max = -Infinity;
  let n = 0;
  for (let x = cx - half; x <= cx + half; x += 100) {
    for (let z = cz - half; z <= cz + half; z += 100) {
      if (filter && !filter(x, z)) {
        continue;
      }
      const w = fieldLift(x, z, agl, env);
      sum += w;
      max = Math.max(max, w);
      n++;
    }
  }
  return { mean: n ? sum / n : NaN, max, n };
}

/* ---------------------------------------------------------------------------------------------- */
/* Table                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

const HOURS = [7, 10, 12, 14, 17, 19.5, 23];
const REGIMES: WindRegime[] = ['calm', 'poyraz', 'lodos'];
const AGL = 250;

console.log(`\nVertical air motion (m/s) at ${AGL} m above ground, gusts off. Columns: local hour (sun elevation).`);
for (const regime of REGIMES) {
  const envs = HOURS.map((h) => new LiftEnv(h, regime, 8));
  console.log(`\n  ${regime}${regime === 'calm' ? '' : ' 8 m/s'}`);
  console.log(`  ${'place'.padEnd(26)}${'land use'.padEnd(15)}` + envs.map((e, i) => `${HOURS[i]}h(${Math.round(e.sunElevationDeg)}°)`.padStart(11)).join(''));
  for (const p of PLACES) {
    const row = envs.map((e) => f2(fieldLift(p.x, p.z, AGL, e)).padStart(11)).join('');
    console.log(`  ${p.name.padEnd(26)}${lu(p.x, p.z).padEnd(15)}${row}`);
  }
}

console.log('\nLand-use comparison at 14h, calm, 250 m AGL (2 km patches, only cells of that land use):');
const env14 = new LiftEnv(14, 'calm');
const LAND_PATCHES: { name: string; x: number; z: number; use: LandUse[] }[] = [
  { name: 'Forest (Belgrad)', x: -9000, z: -16000, use: [LandUse.Forest] },
  { name: 'Urban (Fatih/Bayrampaşa)', x: -6500, z: 1500, use: [LandUse.Urban, LandUse.HistoricUrban] },
  { name: 'Urban (Kadıköy/Üsküdar)', x: 3500, z: 5000, use: [LandUse.Urban, LandUse.HistoricUrban] },
  { name: 'Sea (Marmara)', x: -2500, z: 10000, use: [LandUse.Water] },
];
const landMeans: Record<string, number> = {};
for (const lp of LAND_PATCHES) {
  const r = patchLift(lp.x, lp.z, 1000, AGL, env14, (x, z) => lp.use.includes(geo.landUseAt(x, z)));
  landMeans[lp.name] = r.mean;
  console.log(`  ${lp.name.padEnd(28)} mean ${f2(r.mean).padStart(6)}  max ${f2(r.max).padStart(6)}  (${r.n} samples)`);
}

console.log('\nLift field breakdown (sampleLift, 250 m AGL, 14h): thermal / ridge / heating / trigger / convection');
const breakdown = createLiftSample();
for (const regime of ['calm', 'poyraz'] as const) {
  const env = new LiftEnv(14, regime, 8);
  const cond = { sunDirection: env.sunDirection, wind: env.wind, time: 0 };
  console.log(`  ${regime}`);
  for (const p of PLACES) {
    sampleLift(geo, p.x, p.z, AGL, cond, breakdown);
    const b = breakdown;
    console.log(`    ${p.name.padEnd(26)}${f2(b.thermal).padStart(7)}${f2(b.ridge).padStart(7)}${f2(b.heating).padStart(7)}${f2(b.trigger).padStart(7)}${f2(b.convection).padStart(7)}`);
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Point acceptance: sea and night                                                                */
/* ---------------------------------------------------------------------------------------------- */

console.log('\nSea and night:');
let seaMax = -Infinity;
let seaWhere = '';
for (const name of ['Bosphorus mid-channel', 'Bosphorus off Beşiktaş', 'Marmara']) {
  const p = PLACES.find((q) => q.name === name)!;
  for (const hour of HOURS) {
    for (const agl of [60, 250, 800]) {
      const w = fieldLift(p.x, p.z, agl, new LiftEnv(hour, 'calm'));
      if (w > seaMax) {
        seaMax = w;
        seaWhere = `${name} ${hour}h ${agl} m`;
      }
    }
  }
}
const marmara = patchLift(-2500, 10000, 1000, AGL, env14);
check(seaMax <= 0 && marmara.max <= 0, `no lift over the sea in calm air (max ${f2(seaMax)} at ${seaWhere}; Marmara patch max ${f2(marmara.max)})`);
let nightMax = 0;
for (const p of PLACES) {
  nightMax = Math.max(nightMax, Math.abs(fieldLift(p.x, p.z, AGL, new LiftEnv(23, 'calm'))));
}
check(nightMax <= 0.05, `calm night (23h): |lift| <= 0.05 everywhere in the table (max ${f2(nightMax)})`);
console.log(`  (info) forest mean ${f2(landMeans['Forest (Belgrad)'])} vs urban ${f2(landMeans['Urban (Fatih/Bayrampaşa)'])} / ${f2(landMeans['Urban (Kadıköy/Üsküdar)'])}`);

/* ---------------------------------------------------------------------------------------------- */
/* Flights (real FlightSim, flapping disabled)                                                    */
/* ---------------------------------------------------------------------------------------------- */

function gliderSim(env: LiftEnv, thermals = true, wind = true): FlightSim {
  const sim = createHeadlessSim(geo, env);
  Object.assign(sim.options, { autoFlap: false, stallProtection: true, turbulence: true, thermals, wind });
  return sim;
}

/** Signed angle (rad) from the ground-track direction to `(dx, dz)`: positive = turn right. */
function steerError(sim: FlightSim, dx: number, dz: number): number {
  const v = sim.body.velocity;
  const a = Math.atan2(v.z, v.x);
  const b = Math.atan2(dz, dx);
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

interface FlightResult {
  climb: number;
  dy: number;
  meanUpdraft: number;
  mode: string;
  flaps: number;
  minAgl: number;
}

/** Circles clockwise around (cx, cz) at radius `radius`, airspeed target `speed`, for `seconds` after a settle. */
function thermalFlight(env: LiftEnv, cx: number, cz: number, startAgl: number, seconds: number, radius = 75, speed = 20): FlightResult {
  const sim = gliderSim(env);
  const y0 = ground(cx, cz) + startAgl;
  teleport(sim, cx, y0, cz - radius, 90, speed, -3);
  const script = (_t: number, s: FlightSim, _c: unknown, ov: FlightSim['overrides']): void => {
    const p = s.body.position;
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d = Math.max(Math.hypot(dx, dz), 1);
    const c = THREE.MathUtils.clamp((d - radius) * 0.02, -1, 1);
    const tx = -dz / d;
    const tz = dx / d;
    const e = steerError(s, tx * Math.cos(c) - (dx / d) * Math.sin(c), tz * Math.cos(c) - (dz / d) * Math.sin(c));
    const V = Math.max(s.airspeed, 10);
    const base = Math.atan((V * V) / (9.81 * radius));
    ov.bankTarget = THREE.MathUtils.clamp(base + 1.5 * e, 0, 45 * DEG);
    ov.airspeedTarget = speed;
  };
  simulate(sim, 8, script);
  return measure(sim, seconds, script);
}

function measure(sim: FlightSim, seconds: number, script: Parameters<typeof simulate>[2]): FlightResult {
  const flaps = sim.eventCounts.flap;
  const ya = sim.body.position.y;
  let up = 0;
  let n = 0;
  let minAgl = Infinity;
  simulate(sim, seconds, script, (_t, s) => {
    up += s.wind.updraft;
    n++;
    minAgl = Math.min(minAgl, s.agl);
  });
  const dy = sim.body.position.y - ya;
  return { climb: dy / seconds, dy, meanUpdraft: up / Math.max(n, 1), mode: sim.mode, flaps: sim.eventCounts.flap - flaps, minAgl };
}

function fmtFlight(r: FlightResult): string {
  return `climb ${f2(r.climb).padStart(6)} m/s (Δh ${f1(r.dy).padStart(6)} m), mean updraft ${f2(r.meanUpdraft)}, min AGL ${f1(r.minAgl)}, mode ${r.mode}, flaps ${r.flaps}`;
}

/** Straight glide at `speed` over open sea (flight-test 'glide' method): glide ratio and sink rate. */
function glideRatio(env: LiftEnv, x: number, z: number, speed: number, thermals: boolean): { ratio: number; sink: number } {
  const sim = gliderSim(env, thermals, false);
  sim.options.turbulence = thermals;
  teleport(sim, x, 1500, z, 20, speed, -4);
  const script = (_t: number, _s: FlightSim, _c: unknown, ov: FlightSim['overrides']): void => {
    ov.airspeedTarget = speed;
  };
  simulate(sim, 14, script);
  const a = sim.body.position.clone();
  simulate(sim, 25, script);
  const b = sim.body.position;
  return { ratio: Math.hypot(b.x - a.x, b.z - a.z) / Math.max(a.y - b.y, 1e-3), sink: (a.y - b.y) / 25 };
}

console.log('\nGlide in calm air at noon over the Marmara (flight-test envelope 8-12, best speed):');
for (const thermals of [false, true]) {
  let best = { ratio: 0, sink: 0, speed: 0 };
  for (const v of [19, 21, 23, 26]) {
    const g = glideRatio(new LiftEnv(12, 'calm'), -2500, 9000, v, thermals);
    if (g.ratio > best.ratio) {
      best = { ...g, speed: v };
    }
  }
  check(best.ratio >= 8 && best.ratio <= 12, `glide ratio ${thermals ? 'with thermals/turbulence on' : 'still air (flight-test setup)'}: ${f2(best.ratio)} at ${best.speed} m/s (sink ${f2(best.sink)} m/s)`);
}

console.log('\nThermal soaring over Büyük Çamlıca (circling, no flapping, 60 s):');
const cam14 = thermalFlight(new LiftEnv(14, 'calm'), camlica.x, camlica.z, 150, 60);
console.log(`  14h calm      ${fmtFlight(cam14)}`);
check(cam14.climb >= 1.5 && cam14.flaps === 0, `t=14 over Büyük Çamlıca climbs >= 1.5 m/s without flapping (${f2(cam14.climb)} m/s)`);
const sea14 = thermalFlight(new LiftEnv(14, 'calm'), -2500, 9000, 150, 60);
console.log(`  14h Marmara   ${fmtFlight(sea14)}`);
check(sea14.meanUpdraft <= 0, `circling over the Marmara at t=14 finds no lift (mean updraft ${f2(sea14.meanUpdraft)})`);
if (!QUICK) {
  for (const [label, env] of [
    ['10h calm', new LiftEnv(10, 'calm')],
    ['12h calm', new LiftEnv(12, 'calm')],
    ['17h calm', new LiftEnv(17, 'calm')],
    ['22h calm', new LiftEnv(22, 'calm')],
    ['14h poyraz 4', new LiftEnv(14, 'poyraz', 4)],
  ] as const) {
    console.log(`  ${label.padEnd(13)} ${fmtFlight(thermalFlight(env, camlica.x, camlica.z, 150, 60))}`);
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Ridge soaring along the Rumeli Hisarı slope in poyraz                                          */
/* ---------------------------------------------------------------------------------------------- */

interface RidgePath {
  points: { x: number; z: number }[];
  y: number;
  mean: number;
}

/**
 * Best beat on the windward face: for each 50 m step north to south the x with the most ridge lift (thermals off) at a
 * fixed altitude, then the best `span`-metre stretch of that line (a pilot beats where the slope works best).
 */
function ridgePath(env: LiftEnv, zNorth: number, zSouth: number, span = 450): RidgePath {
  let best: RidgePath = { points: [], y: 0, mean: -Infinity };
  const window = Math.round(span / 50) + 1;
  for (const y of [60, 80, 100, 120, 150]) {
    const pts: { x: number; z: number; w: number }[] = [];
    for (let z = Math.round(zNorth); z <= zSouth; z += 50) {
      let bx = 0;
      let bw = -Infinity;
      for (let x = 2700; x <= 3700; x += 20) {
        const agl = y - ground(x, z);
        if (agl < 30) {
          continue;
        }
        const w = fieldLift(x, z, agl, env, { thermals: false });
        if (w > bw) {
          bw = w;
          bx = x;
        }
      }
      pts.push({ x: bx, z, w: bw });
    }
    for (let i = 0; i + window <= pts.length; i++) {
      const seg = pts.slice(i, i + window);
      const mean = seg.reduce((acc, p) => acc + p.w, 0) / window;
      if (mean > best.mean) {
        // Smooth the line so the autopilot can follow it.
        const points = seg.map((p, k) => {
          let sx = 0;
          let n = 0;
          for (let j = Math.max(0, k - 2); j <= Math.min(seg.length - 1, k + 2); j++) {
            sx += seg[j].x;
            n++;
          }
          return { x: sx / n, z: p.z };
        });
        best = { points, y, mean };
      }
    }
  }
  return best;
}

/** Beats back and forth along the path (turning out over the water at each end, like a ridge-soaring pilot). */
function ridgeFlight(env: LiftEnv, path: RidgePath, seconds: number, thermals: boolean, speed = 20): FlightResult & { beats: number } {
  const sim = gliderSim(env, thermals);
  const pts = path.points;
  const p0 = pts[0];
  const p1 = pts[2];
  teleport(sim, p0.x, path.y, p0.z, (Math.atan2(p1.x - p0.x, -(p1.z - p0.z)) / DEG + 360) % 360, speed, -2);
  let dir = 1;
  let beats = 0;
  let turning = false;
  let turnSide = 1;
  const script = (_t: number, s: FlightSim, _c: unknown, ov: FlightSim['overrides']): void => {
    const p = s.body.position;
    let ci = 0;
    let cd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - p.x, pts[i].z - p.z);
      if (d < cd) {
        cd = d;
        ci = i;
      }
    }
    if ((dir > 0 && ci >= pts.length - 2) || (dir < 0 && ci <= 1)) {
      dir = -dir;
      beats++;
      turning = true;
      // Turn away from the slope (toward the water, east): right when heading north, left when heading south.
      turnSide = s.body.velocity.z < 0 ? 1 : -1;
    }
    const ti = THREE.MathUtils.clamp(ci + dir * 2, 0, pts.length - 1);
    let e = steerError(s, pts[ti].x - p.x, pts[ti].z - p.z);
    if (turning) {
      if (Math.abs(e) > 45 * DEG) {
        e = turnSide * Math.abs(e);
      } else {
        turning = false;
      }
    }
    ov.bankTarget = THREE.MathUtils.clamp(1.5 * e, -40 * DEG, 40 * DEG);
    ov.airspeedTarget = speed;
  };
  simulate(sim, 5, script);
  if (process.env.LIFT_TRACE) {
    simulate(sim, seconds, script, (t, s) => {
      if (Math.round(t * 120) % 240 === 0) {
        const p = s.body.position;
        console.log(`    t ${f1(t)} x ${f1(p.x)} z ${f1(p.z)} y ${f1(p.y)} agl ${f1(s.agl)} up ${f2(s.wind.updraft)} V ${f1(s.airspeed)} bank ${f1(s.bank / DEG)} dir ${dir} ${s.mode}`);
      }
    });
    teleport(sim, p0.x, path.y, p0.z, 180, speed, -2);
  }
  return { ...measure(sim, seconds, script), beats };
}

console.log('\nRidge soaring along the Rumeli Hisarı slope (beating along the windward face, no flapping, 60 s):');
const poyraz = new LiftEnv(14, 'poyraz', 8);
const path = ridgePath(poyraz, hisar.z - 1100, hisar.z + 100);
console.log(`  best line at ${path.y} m: x ${Math.round(path.points[0].x)}..${Math.round(path.points[path.points.length - 1].x)}, z ${path.points[0].z}..${path.points[path.points.length - 1].z}, mean ridge lift ${f2(path.mean)} m/s`);
const ridgeOnly = ridgeFlight(poyraz, path, 60, false);
console.log(`  poyraz 8, ridge only   ${fmtFlight(ridgeOnly)}, beats ${ridgeOnly.beats}`);
check(ridgeOnly.dy >= -10 && ridgeOnly.flaps === 0, `poyraz: altitude held along the Rumeli Hisarı slope with ridge lift (Δh ${f1(ridgeOnly.dy)} m in 60 s, need >= -10)`);
if (!QUICK) {
  const withThermals = ridgeFlight(poyraz, path, 60, true);
  console.log(`  poyraz 8, + thermals   ${fmtFlight(withThermals)}, beats ${withThermals.beats}`);
  const calm = ridgeFlight(new LiftEnv(14, 'calm'), path, 60, false);
  console.log(`  calm, same line        ${fmtFlight(calm)}, beats ${calm.beats}`);
  const lodos = ridgeFlight(new LiftEnv(14, 'lodos', 8), path, 60, false);
  console.log(`  lodos 8, same line     ${fmtFlight(lodos)}, beats ${lodos.beats}`);
  // The face right below the fortress runs almost parallel to the poyraz: weaker lift there.
  for (const speed of [8, 11]) {
    const env = new LiftEnv(14, 'poyraz', speed);
    const near = ridgePath(env, hisar.z - 500, hisar.z + 100, 400);
    const r = ridgeFlight(env, near, 60, false);
    console.log(
      `  (info) fortress face only, poyraz ${speed}: line z ${near.points[0].z}..${near.points[near.points.length - 1].z} at ${near.y} m, ` +
        `mean ridge lift ${f2(near.mean)}; ${fmtFlight(r)}`,
    );
  }
}

console.log(failures.length ? `\nFAILED (${failures.length}):\n  ${failures.join('\n  ')}` : '\nAll acceptance checks passed.');
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures.length ? 1 : 0);
