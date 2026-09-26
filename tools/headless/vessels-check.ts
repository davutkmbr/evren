/**
 * Phase 21 stage 7b check, headless (no browser, no GPU): vessels as floating rigid bodies.
 *
 *   npx tsx tools/headless/vessels-check.ts          # all sections, exits 1 when a check fails
 *   npx tsx tools/headless/vessels-check.ts --quick  # shorter fleet runs
 *
 * 1. Hull table: mass, centre of gravity / buoyancy, metacentric heights and the linear natural periods per design.
 * 2. Free decay in calm water: heave, roll and pitch released from an offset; measured periods against the linear
 *    formulas from the hull data (±15 %) and roll periods in plausible ranges for the size (ferries 6–12 s, small
 *    boats 2–4 s, ships 10–25 s).
 * 3. Static stability: righting moment (heave in equilibrium) positive at every heel up to 30 degrees.
 * 4. Equilibrium draft in calm water within ±10 % of the design (ballast ships: of the ballast draft).
 * 5. Rough sea: hulls held in a strong lodos in the open Marmara stay upright and bounded.
 * 6. Route following with the real fleet (high preset) on the real sea, every hull on the full rigid body:
 *    cross-track and along-track error against the navigation reference, ferries arriving at and docking alongside
 *    their berths (docking time, position while alongside), no hull ever closer to the land than its reference.
 * 7. Interactions: a dragon landing on a small boat (bounded, damped), a plunge splash beside one, a ferry's wake
 *    rocking a small boat more than calm water does.
 * 8. Performance: the full ultra fleet with the camera at Karaköy, physics CPU per frame (≤ 1 ms) at 60 and 24 fps.
 * 9. Frame-rate robustness: identical motion at dt 1/24, 1/60 and 1/144 (fixed sub-step) and no NaNs anywhere.
 */
import * as THREE from 'three';
import type { WaterSeaState, WaterService } from '../../src/core/contracts';
import { latLonToLocal } from '../../src/core/geo-coords';
import { Moored, Vessel, Wander } from '../../src/world/life/vessels/agents';
import { buildCatalog, RECIPES } from '../../src/world/life/vessels/catalog';
import { Fleet } from '../../src/world/life/vessels/fleet';
import type { VesselModel } from '../../src/world/life/vessels/model-types';
import { FerryService } from '../../src/world/life/vessels/nav/ferry-service';
import { buildHullBody, columnVolume, GRAVITY, RHO_SEA, type HullBody } from '../../src/world/life/vessels/physics/hull-data';
import { HullLod, RigidHull, wrapPi } from '../../src/world/life/vessels/physics/rigid-hull';
import { VESSEL_PHYSICS, VesselPhysics } from '../../src/world/life/vessels/physics/vessel-physics';
import { buildStraitLanes, placeBerths } from '../../src/world/life/vessels/routes';
import { buildHeadlessGeo } from './geo';
import { createHeadlessSea } from './water-sea';

const QUICK = process.argv.includes('--quick');
const failures: string[] = [];
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : 'nan');
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'nan');
const deg = (r: number): number => (r * 180) / Math.PI;
const DEG = Math.PI / 180;

function check(ok: boolean, label: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
  }
}

/** Still, flat water (no waves, no current). */
class FlatWater implements WaterService {
  readonly seaState: WaterSeaState = { windSpeed: 0, significantWaveHeight: 0, lodos: 0, regime: 'poyraz' };
  heightAt(): number {
    return 0;
  }
  normalAt(_x: number, _z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 1, 0);
  }
  velocityAt(_x: number, _z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, 0);
  }
  currentAt(_x: number, _z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, 0);
  }
}

/** Plausible roll periods by kind (s). */
const ROLL_RANGE: Record<string, [number, number]> = {
  vapur: [6, 12],
  ferry: [6, 12],
  seabus: [2.5, 6],
  tour: [4.5, 9],
  tug: [4.5, 9],
  pilot: [2.5, 5],
  motorboat: [2, 4],
  fishing: [2, 4],
  sailboat: [2, 4.5],
  seiner: [4.5, 9],
  yacht: [3, 6],
  tanker: [10, 25],
  container: [10, 25],
  bulk: [10, 25],
};

const t0 = Date.now();

/* ------------------------------------------------------------------ */
/* 1. Hull table                                                       */
/* ------------------------------------------------------------------ */
console.log('\n1. Hull table (design draft; ballast ships float higher on the same hull)');
const bodies = RECIPES.map((r) => ({ key: r.key, body: buildHullBody(r) }));
console.log('  model        L(m)   B(m)  T(m)  F(m)  cols  mass(t)  KB(m)  KG(m)  GM(m)  GML(m)  T_heave  T_roll  T_pitch');
for (const { key, body: b } of bodies) {
  console.log(
    `  ${key.padEnd(11)} ${f1(b.length).padStart(5)} ${f1(b.beam).padStart(6)} ${f2(b.draft).padStart(5)} ${f1(b.freeboard).padStart(5)} ${String(b.columns.length).padStart(5)} ${f1(b.mass / 1000).padStart(8)} ${f2(b.kb).padStart(6)} ${f2(b.kg).padStart(6)} ${f2(b.gm).padStart(6)} ${f1(b.gmL).padStart(7)} ${f1(b.periods.heave).padStart(8)} ${f1(b.periods.roll).padStart(7)} ${f1(b.periods.pitch).padStart(8)}`,
  );
}
check(
  bodies.every(({ body: b }) => b.gm > 0 && b.kg > 0 && b.columns.length >= 6 && b.columns.length <= 24),
  'every design has a positive GM, KG above the keel and 6–24 buoyancy columns',
);

/* ------------------------------------------------------------------ */
/* 2. Free decay                                                       */
/* ------------------------------------------------------------------ */
console.log('\n2. Free decay in calm water (measured vs linear formula)');

/** Upward zero crossings of a signal sampled every h; mean period over the first `cycles` crossings. */
function period(sig: number[], h: number, mean: number, cycles = 3): number {
  const ups: number[] = [];
  for (let i = 1; i < sig.length; i++) {
    const a = sig[i - 1] - mean;
    const b = sig[i] - mean;
    if (a < 0 && b >= 0) {
      ups.push((i - 1 + a / (a - b)) * h);
      if (ups.length > cycles) break;
    }
  }
  if (ups.length < 2) return NaN;
  return (ups[ups.length - 1] - ups[0]) / (ups.length - 1);
}

/** Integrates the vertical motion of a body in flat water from an offset; returns the chosen coordinate's trace. */
function decay(b: HullBody, dof: 'heave' | 'roll' | 'pitch', seconds: number): number[] {
  const body = new RigidHull(b);
  body.lod = HullLod.Full;
  body.settle();
  // Settle first (the column model's equilibrium differs a little from the design waterline).
  const h = VESSEL_PHYSICS.step;
  for (let i = 0; i < 60 / h; i++) body.stepVertical(h, 0, 0, 0);
  const eq = { heave: body.heave, roll: body.roll, pitch: body.pitch };
  body.vh = body.vr = body.vp = 0;
  if (dof === 'heave') body.heave += 0.15 * b.draft;
  if (dof === 'roll') body.roll += 5 * DEG;
  if (dof === 'pitch') body.pitch += Math.min(1.5 * DEG, (0.3 * b.draft) / b.length);
  const out: number[] = [];
  for (let i = 0; i < seconds / h; i++) {
    body.stepVertical(h, 0, 0, 0);
    out.push(body[dof] - eq[dof]);
  }
  return out;
}

const periodRows: string[] = [];
let decayOk = true;
let rollRangeOk = true;
for (const { key, body: b } of bodies) {
  const h = VESSEL_PHYSICS.step;
  const th = period(decay(b, 'heave', 8 * b.periods.heave), h, 0, 2);
  const tr = period(decay(b, 'roll', 6 * b.periods.roll), h, 0, 3);
  const tp = period(decay(b, 'pitch', 8 * b.periods.pitch), h, 0, 2);
  // Damped period = natural / sqrt(1 - zeta²).
  const d = b.design;
  const eh = b.periods.heave / Math.sqrt(1 - d.zetaHeave ** 2);
  const er = b.periods.roll / Math.sqrt(1 - d.zetaRoll ** 2);
  const ep = b.periods.pitch / Math.sqrt(1 - d.zetaPitch ** 2);
  const within = (m: number, e: number): boolean => Math.abs(m / e - 1) <= 0.15;
  const ok = within(th, eh) && within(tr, er) && within(tp, ep);
  const [lo, hi] = ROLL_RANGE[b.kind];
  const inRange = tr >= lo && tr <= hi;
  decayOk &&= ok;
  rollRangeOk &&= inRange;
  periodRows.push(
    `  ${key.padEnd(11)} heave ${f2(th).padStart(6)} s (formula ${f2(eh)})  roll ${f2(tr).padStart(6)} s (formula ${f2(er)}, range ${lo}–${hi})  pitch ${f2(tp).padStart(6)} s (formula ${f2(ep)})${ok && inRange ? '' : '  <--'}`,
  );
}
periodRows.forEach((r) => console.log(r));
check(decayOk, 'free-decay periods within ±15 % of the linear formulas (heave, roll, pitch; every design)');
check(rollRangeOk, 'roll periods plausible for the size (ferries 6–12 s, small boats 2–4 s, catamaran 2.5–6 s, ships 10–25 s)');

/* ------------------------------------------------------------------ */
/* 3. Static stability                                                 */
/* ------------------------------------------------------------------ */
console.log('\n3. Static stability: righting arm GZ (m) with the heave in equilibrium, calm water');

/** Net vertical force and roll moment of the column model at heave h and heel phi (flat water). */
function hydro(b: HullBody, heave: number, phi: number): { force: number; moment: number } {
  let force = 0;
  let moment = 0;
  for (const c of b.columns) {
    const y = heave + c.lx * Math.sin(phi);
    const f = RHO_SEA * GRAVITY * c.area * columnVolume(b.draft - y, b.draft, b.freeboard, b.cvp, b.volExp);
    force += f;
    moment += f * c.lx * Math.cos(phi);
  }
  moment += b.mass * GRAVITY * (b.kg - b.kb) * Math.sin(phi);
  return { force, moment };
}

function righting(b: HullBody, phi: number): number {
  let lo = -b.draft;
  let hi = b.draft + b.freeboard;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (hydro(b, mid, phi).force > b.mass * GRAVITY) lo = mid;
    else hi = mid;
  }
  // Righting moment is minus the roll moment for a positive heel.
  return -hydro(b, 0.5 * (lo + hi), phi).moment / (b.mass * GRAVITY);
}

let stableOk = true;
for (const { key, body: b } of bodies) {
  const gz: number[] = [];
  let minGz = Infinity;
  for (let a = 2.5; a <= 30.01; a += 2.5) {
    const g = righting(b, a * DEG);
    gz.push(g);
    minGz = Math.min(minGz, g);
  }
  stableOk &&= minGz > 0;
  console.log(`  ${key.padEnd(11)} GZ 5° ${f2(gz[1])}  10° ${f2(gz[3])}  20° ${f2(gz[7])}  30° ${f2(gz[11])}  (min ${f2(minGz)}, GM·sin 10° ${f2(b.gm * Math.sin(10 * DEG))})`);
}
check(stableOk, 'righting moment positive at every heel from 2.5° to 30° (every design)');

/* ------------------------------------------------------------------ */
/* 4. Equilibrium draft                                                */
/* ------------------------------------------------------------------ */
console.log('\n4. Equilibrium draft in calm water');
let draftOk = true;
for (const { key } of bodies) {
  for (const lift of key.startsWith('tanker') || key.startsWith('bulk') ? [0, 0.35] : [0]) {
    const r = RECIPES.find((x) => x.key === key)!;
    const b = buildHullBody(r, lift * r.draft);
    const body = new RigidHull(b);
    body.lod = HullLod.Full;
    body.heave = 0;
    for (let i = 0; i < 120 / VESSEL_PHYSICS.step; i++) body.stepVertical(VESSEL_PHYSICS.step, 0, 0, 0);
    const draft = b.draft - body.heave;
    const spec = b.draft - b.lift;
    const err = draft / spec - 1;
    draftOk &&= Math.abs(err) <= 0.1 && Math.abs(body.roll) < 0.1 * DEG && Math.abs(body.pitch) < 0.1 * DEG;
    console.log(`  ${(key + (lift ? ' (ballast)' : '')).padEnd(20)} spec ${f2(spec)} m, floats at ${f2(draft)} m (${err >= 0 ? '+' : ''}${f1(err * 100)} %), roll ${f2(deg(body.roll))}°, pitch ${f2(deg(body.pitch))}°`);
  }
}
check(draftOk, 'equilibrium draft within ±10 % of the design, upright and level');

/* ------------------------------------------------------------------ */
/* Geography, sea, models                                              */
/* ------------------------------------------------------------------ */
const geo = buildHeadlessGeo();
const hs = createHeadlessSea(geo);
const models = await buildCatalog();
const berths = placeBerths(geo);
const lanes = buildStraitLanes(geo);
console.log(`\ngeo + sea + models ready in ${Date.now() - t0} ms`);

/** A single vessel held on a mooring spring at (x, z) in its own physics. */
function holdVessel(key: string, x: number, z: number, yaw: number, water: WaterService, id = 0): { v: Vessel; physics: VesselPhysics } {
  const model = models.get(key) as VesselModel;
  const v = new Vessel(id, model, new Moored(x, z, yaw, 0), new THREE.Color(1, 1, 1), 0);
  v.behaviour.update(0.001, v.state);
  const physics = new VesselPhysics([v], geo);
  physics.water = water;
  return { v, physics };
}

/** RMS surface height at a point over 200 s (the sea state advanced in place). */
function rmsHeight(w: WaterService, x: number, z: number): number {
  let sum = 0;
  let n = 0;
  for (let t = 0; t < 200; t += 0.5) {
    hs.advance(1000 + t, 0.5, x, z);
    const h = w.heightAt(x, z);
    sum += h * h;
    n++;
  }
  return Math.sqrt(sum / n);
}

/* ------------------------------------------------------------------ */
/* 5. Rough sea                                                        */
/* ------------------------------------------------------------------ */
console.log('\n5. Rough sea: hulls held in a lodos (U10 18 m/s) in the open Marmara for 180 s');
{
  hs.setWind('lodos', 18);
  const spot = latLonToLocal(40.93, 28.98);
  const cam = new THREE.Vector3(spot.x, 20, spot.z);
  let roughOk = true;
  hs.advance(1000, 1 / 30, cam.x, cam.z);
  console.log(`  significant wave height ${f2(hs.waves.seaState.significantWaveHeight)} m (open sea), at the spot ~${f2(4 * rmsHeight(hs.waves, spot.x, spot.z))} m`);
  for (const key of ['motorboat', 'fishing', 'sailboat', 'tour', 'ferry', 'vapur', 'seabus', 'tanker-a']) {
    const { v, physics } = holdVessel(key, spot.x, spot.z, 0.7, hs.waves);
    let maxRoll = 0;
    let maxPitch = 0;
    let sumRoll = 0;
    let minHeave = Infinity;
    let maxHeave = -Infinity;
    let n = 0;
    let bad = false;
    const dt = 1 / 30;
    for (let t = 0; t < 180; t += dt) {
      hs.advance(1000 + t, dt, cam.x, cam.z);
      v.behaviour.update(dt, v.state);
      physics.update(dt, cam);
      if (!Number.isFinite(v.roll + v.pitch + v.heave)) bad = true;
      if (t < 20) continue;
      maxRoll = Math.max(maxRoll, Math.abs(v.roll));
      maxPitch = Math.max(maxPitch, Math.abs(v.pitch));
      sumRoll += v.roll * v.roll;
      minHeave = Math.min(minHeave, v.heave);
      maxHeave = Math.max(maxHeave, v.heave);
      n++;
    }
    const ok = !bad && deg(maxRoll) < 30 && deg(maxPitch) < 15 && physics.stats.resets === 0;
    roughOk &&= ok;
    console.log(`  ${key.padEnd(10)} roll rms ${f1(deg(Math.sqrt(sumRoll / n)))}° max ${f1(deg(maxRoll))}°, pitch max ${f1(deg(maxPitch))}°, heave ${f2(minHeave)}..${f2(maxHeave)} m${ok ? '' : '  <--'}`);
  }
  check(roughOk, 'no capsizing in a strong lodos: roll < 30°, pitch < 15°, finite, no resets');
}

/* ------------------------------------------------------------------ */
/* 6. Route following                                                  */
/* ------------------------------------------------------------------ */
console.log(`\n6. Route following: high-preset fleet, poyraz U10 8 m/s, every hull on the full rigid body, ${QUICK ? 8 : 25} simulated minutes at 24 fps`);
{
  hs.setWind('poyraz', 8);
  const fleet = new Fleet({ geo, models, berths, lanes, shipCount: 70, water: hs.waves }, new THREE.MeshBasicMaterial());
  const physics = fleet.physics;
  physics.forceLod = HullLod.Full;
  const cam = new THREE.Vector3(0, 50, 0);
  const dt = 1 / 24;
  const minutes = QUICK ? 8 : 25;
  interface Track {
    lat: number[];
    along: number[];
    landWorse: number;
  }
  const tracks = new Map<number, Track>();
  for (const v of fleet.vessels) tracks.set(v.id, { lat: [], along: [], landWorse: 0 });
  // Ferry docking episodes.
  interface Dock {
    id: number;
    start: number;
    docked: number;
    err: number[];
  }
  const docks: Dock[] = [];
  const open = new Map<number, Dock>();
  let t = 0;
  let frame = 0;
  let nan = 0;
  let worstLand = -Infinity;
  let worstLandInfo = '';
  const ferries = fleet.vessels.filter((v) => v.behaviour instanceof FerryService);
  for (; t < minutes * 60; t += dt, frame++) {
    hs.advance(2000 + t, dt, cam.x, cam.z);
    fleet.update(dt, cam);
    for (const v of fleet.vessels) {
      if (!Number.isFinite(v.x + v.z + v.yaw + v.heave + v.roll + v.pitch)) nan++;
    }
    if (frame % 12 !== 0 || t < 30) continue;
    for (const v of fleet.vessels) {
      const st = v.state;
      const tr = tracks.get(v.id)!;
      const k = st.astern ? -1 : 1;
      const tx = -Math.sin(st.yaw) * k;
      const tz = -Math.cos(st.yaw) * k;
      const ex = v.x - st.x;
      const ez = v.z - st.z;
      if (st.mode === 'underway' && st.speed > 0.3) {
        tr.lat.push(Math.abs(ex * -tz + ez * tx));
        tr.along.push(-(ex * tx + ez * tz));
      }
      const cb = geo.coastDistance(v.x, v.z);
      const cr = geo.coastDistance(st.x, st.z);
      const worse = cb - cr;
      if (cb > -0.5 * v.model.beam && worse > 3) tr.landWorse++;
      if (cb > -0.5 * v.model.beam && worse > worstLand) {
        worstLand = worse;
        worstLandInfo = `${v.model.key}#${v.id} body coast ${f1(cb)} m, reference ${f1(cr)} m`;
      }
    }
    for (const v of ferries) {
      const beh = v.behaviour as FerryService;
      const dwelling = beh.state === 'dwell';
      let d = open.get(v.id);
      if (dwelling && !d) {
        d = { id: v.id, start: t, docked: -1, err: [] };
        open.set(v.id, d);
        docks.push(d);
      } else if (!dwelling && d) {
        open.delete(v.id);
      }
      if (d) {
        const e = Math.hypot(v.x - v.state.x, v.z - v.state.z);
        const ye = Math.abs(wrapPi(v.yaw - v.state.yaw));
        const yeFlip = v.body?.hull.design.doubleEnded ? Math.min(ye, Math.PI - ye) : ye;
        if (d.docked < 0 && e < 2 && yeFlip < 3 * DEG) d.docked = t - d.start;
        if (d.docked >= 0) d.err.push(e);
      }
    }
  }
  const byKind = new Map<string, { lat: number[]; along: number[]; land: number; n: number; L: number; free: boolean }>();
  for (const v of fleet.vessels) {
    const tr = tracks.get(v.id)!;
    const free = v.behaviour instanceof Wander;
    const key = `${v.model.kind}${free ? ' (free)' : ''}`;
    const k = byKind.get(key) ?? { lat: [], along: [], land: 0, n: 0, L: v.model.length, free };
    k.lat.push(...tr.lat);
    k.along.push(...tr.along);
    k.land += tr.landWorse;
    k.n++;
    byKind.set(key, k);
  }
  const pct = (a: number[], p: number): number => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  let crossOk = true;
  for (const [kind, k] of byKind) {
    if (!k.lat.length) continue;
    const p95 = pct(k.lat, 0.95);
    const max = pct(k.lat, 1);
    // Free-roaming craft have no route: they re-plan from the hull beyond their leash (current, pushes).
    const leash = Math.max(VESSEL_PHYSICS.wanderLeashMin, VESSEL_PHYSICS.wanderLeashLengths * k.L);
    const limitP95 = k.free ? leash : Math.max(4, 0.12 * k.L);
    const limitMax = k.free ? leash + 3 : Math.max(12, 0.4 * k.L);
    const ok = p95 <= limitP95 && max <= limitMax;
    crossOk &&= ok;
    console.log(
      `  ${kind.padEnd(17)} x${String(k.n).padStart(2)}  cross-track p50 ${f1(pct(k.lat, 0.5))} p95 ${f1(p95)} max ${f1(max)} m (limits ${f1(limitP95)} / ${f1(limitMax)})  along-track lag p50 ${f1(pct(k.along, 0.5))} p95 ${f1(pct(k.along, 0.95))} m${ok ? '' : '  <--'}`,
    );
  }
  const done = docks.filter((d) => d.docked >= 0);
  const dockTimes = done.map((d) => d.docked);
  const dockErr = done.flatMap((d) => d.err);
  // The first dwell of a ferry that starts alongside counts from t = 0.
  const counted = docks.filter((d) => d.start > 5);
  const countedDone = counted.filter((d) => d.docked >= 0);
  console.log(`  ferries: ${counted.length} arrivals, ${countedDone.length} docked (within 2 m and 3° of the berth); docking time p50 ${f1(pct(dockTimes, 0.5))} s, max ${f1(pct(dockTimes, 1))} s; alongside error p95 ${f2(pct(dockErr, 0.95))} m, max ${f2(pct(dockErr, 1))} m`);
  console.log(`  free-roaming re-plans from the hull ${physics.stats.replans}, safety net pulls ${physics.stats.pulls}, teleports (lane respawns) ${physics.stats.teleports}, resets ${physics.stats.resets}, non-finite poses ${nan}`);
  console.log(`  closest to land relative to the reference (inside half a beam of the shore): ${worstLandInfo ? `${worstLandInfo} (${f1(worstLand)} m nearer)` : 'never'}`);
  check(crossOk, 'cross-track error within bounds per class (routes: p95 ≤ max(4 m, 0.12 L), max ≤ max(12 m, 0.4 L); free-roaming: within the leash)');
  check(counted.length >= (QUICK ? 4 : 12) && countedDone.length === counted.length, 'every ferry arrival docks alongside its berth (2 m, 3°)');
  check(dockTimes.length > 0 && pct(dockTimes, 1) <= 40, 'docking takes ≤ 40 s from the scheduled arrival');
  check(pct(dockErr, 1) <= 2.5, 'alongside the berth the hull stays within 2.5 m of it (mooring spring)');
  check([...byKind.values()].every((k) => k.land === 0), 'no hull ever gets nearer the land than its route reference (+3 m) inside half a beam of the shore');
  check(nan === 0 && physics.stats.resets === 0, 'no non-finite state, no body resets');
}

/* ------------------------------------------------------------------ */
/* 7. Interactions                                                     */
/* ------------------------------------------------------------------ */
console.log('\n7. Interactions (calm water unless stated)');
{
  const flat = new FlatWater();
  const spot = latLonToLocal(40.95, 28.98);
  const cam = new THREE.Vector3(spot.x, 10, spot.z);
  const dt = 1 / 60;
  // Dragon landing on a fishing boat, 1 m off the centreline, descending at 5 m/s.
  for (const key of ['fishing', 'motorboat', 'sailboat']) {
    const { v, physics } = holdVessel(key, spot.x, spot.z, 0, flat);
    for (let i = 0; i < 120; i++) physics.update(dt, cam);
    const b = v.body!;
    const deckY = b.heave + b.hull.freeboard;
    const side = 1;
    const pos = new THREE.Vector3(v.x + Math.cos(v.yaw) * side, deckY + 0.3, v.z - Math.sin(v.yaw) * side);
    const vel = new THREE.Vector3(1.5, -5, 0);
    const hit = physics.contact(pos, vel, 2);
    let maxRoll = 0;
    let maxHeave = 0;
    let late = 0;
    const heave0 = b.heave;
    for (let t = 0; t < 40; t += dt) {
      physics.update(dt, cam);
      maxRoll = Math.max(maxRoll, Math.abs(v.roll));
      maxHeave = Math.max(maxHeave, Math.abs(v.heave - heave0));
      if (t > 25) late = Math.max(late, Math.abs(v.roll));
    }
    const ok = hit.length === 1 && deg(maxRoll) > 1 && deg(maxRoll) < 25 && maxHeave < 0.6 && deg(late) < 1;
    console.log(`  dragon lands on a ${key.padEnd(9)}: hit ${hit.length}, max roll ${f1(deg(maxRoll))}°, max heave ${f2(maxHeave)} m, roll after 25 s ${f2(deg(late))}°${ok ? '' : '  <--'}`);
    check(ok, `a dragon landing on a ${key} rocks it (1°–25° roll, < 0.6 m heave) and the motion dies out (< 1° after 25 s)`);
  }
  // A plunge splash 4 m off a motorboat's side.
  {
    const { v, physics } = holdVessel('motorboat', spot.x, spot.z, 0, flat);
    for (let i = 0; i < 120; i++) physics.update(dt, cam);
    const n = physics.splash(v.x + Math.cos(v.yaw) * (0.5 * v.model.beam + 4), v.z - Math.sin(v.yaw) * (0.5 * v.model.beam + 4), 2.8);
    let maxRoll = 0;
    let drift = 0;
    const x0 = v.x;
    const z0 = v.z;
    for (let t = 0; t < 20; t += dt) {
      physics.update(dt, cam);
      maxRoll = Math.max(maxRoll, Math.abs(v.roll));
      drift = Math.max(drift, Math.hypot(v.x - x0, v.z - z0));
    }
    const ok = n === 1 && deg(maxRoll) > 1 && deg(maxRoll) < 25 && drift < 3;
    console.log(`  plunge splash (strength 2.8) 4 m off a motorboat: pushed ${n}, max roll ${f1(deg(maxRoll))}°, pushed away ${f2(drift)} m${ok ? '' : '  <--'}`);
    check(ok, 'a plunge splash beside a small boat rocks it (1°–25°) and shoves it a little (< 3 m, the mooring holds)');
  }
  // A ferry's wake reaching a small boat.
  {
    const ferryModel = models.get('vapur')!;
    const rollRms = (withFerry: boolean): number => {
      const boat = new Vessel(1, models.get('fishing')!, new Moored(spot.x, spot.z, 0, 0), new THREE.Color(), 0);
      boat.behaviour.update(0.001, boat.state);
      const list: Vessel[] = [boat];
      let ferry: Vessel | null = null;
      if (withFerry) {
        // A vapur steaming north at 7 m/s, passing 80 m to the east.
        const fx = spot.x + 80;
        let fz = spot.z + 250;
        ferry = new Vessel(2, ferryModel, { update: (d, st) => { fz -= 7 * d; st.x = fx; st.z = fz; st.yaw = 0; st.speed = 7; st.mode = 'underway'; st.astern = false; } }, new THREE.Color(), 0);
        ferry.behaviour.update(0.001, ferry.state);
        list.push(ferry);
      }
      const physics = new VesselPhysics(list, null);
      physics.water = flat;
      let sum = 0;
      let n = 0;
      for (let t = 0; t < 90; t += dt) {
        for (const v of list) v.behaviour.update(dt, v.state);
        physics.update(dt, cam);
        if (t > 20) {
          sum += boat.roll * boat.roll + boat.pitch * boat.pitch;
          n++;
        }
      }
      return Math.sqrt(sum / n);
    };
    const calm = rollRms(false);
    const wake = rollRms(true);
    console.log(`  fishing boat 80 m off a passing vapur (7 m/s): roll+pitch rms ${f2(deg(wake))}° (without the vapur ${f2(deg(calm))}°)`);
    check(wake > 0.5 * DEG && wake > 10 * calm, "a ferry's wake rocks a small boat (rms > 0.5°, far above calm water)");
  }
}

/* ------------------------------------------------------------------ */
/* 8. Performance                                                      */
/* ------------------------------------------------------------------ */
console.log('\n8. Performance: ultra fleet, camera at Karaköy, lodos U10 12 m/s, level of detail by distance');
{
  hs.setWind('lodos', 12);
  const fleet = new Fleet({ geo, models, berths, lanes, shipCount: 100, water: hs.waves }, new THREE.MeshBasicMaterial());
  const karakoy = latLonToLocal(41.0215, 28.978);
  const cam = new THREE.Vector3(karakoy.x, 60, karakoy.z);
  const run = (dt: number, seconds: number): { avg: number; p95: number; max: number; fleetAvg: number; full: number; mid: number; far: number; samples: number } => {
    const phys: number[] = [];
    const whole: number[] = [];
    let full = 0;
    let mid = 0;
    let far = 0;
    let samples = 0;
    let t = 0;
    for (let i = 0; t < seconds; i++, t += dt) {
      hs.advance(5000 + t, dt, cam.x, cam.z);
      const a = performance.now();
      fleet.update(dt, cam);
      whole.push(performance.now() - a);
      phys.push(fleet.physics.stats.ms);
      full += fleet.physics.stats.full;
      mid += fleet.physics.stats.mid;
      far += fleet.physics.stats.far;
      samples += fleet.physics.stats.samples;
    }
    const n = phys.length;
    const s = [...phys].sort((x, y) => x - y);
    return { avg: phys.reduce((a, b) => a + b, 0) / n, p95: s[Math.floor(0.95 * n)], max: s[n - 1], fleetAvg: whole.reduce((a, b) => a + b, 0) / n, full: full / n, mid: mid / n, far: far / n, samples: samples / n };
  };
  run(1 / 60, 20); // warm-up (JIT)
  const r60 = run(1 / 60, QUICK ? 30 : 60);
  const r24 = run(1 / 24, QUICK ? 30 : 60);
  for (const [label, r] of [['60 fps', r60], ['24 fps', r24]] as const) {
    console.log(`  ${label}: ${fleet.vessels.length} vessels (full ${f1(r.full)}, mid ${f1(r.mid)}, kinematic ${f1(r.far)}), ${f1(r.samples)} water samples/frame; physics ${f2(r.avg)} ms avg, p95 ${f2(r.p95)}, max ${f2(r.max)}; whole fleet update ${f2(r.fleetAvg)} ms`);
  }
  check(r60.avg <= 1 && r24.avg <= 1, 'vessel physics ≤ 1 ms per frame on average (60 and 24 fps)');
  check(r60.p95 <= 1.5 && r24.p95 <= 1.5, 'vessel physics p95 ≤ 1.5 ms per frame');
  // Upper bound (information): every hull of the ultra fleet on the full rigid body at once.
  fleet.physics.forceLod = HullLod.Full;
  run(1 / 60, 5);
  const stress = run(1 / 60, QUICK ? 10 : 20);
  fleet.physics.forceLod = null;
  console.log(`  stress (information): all ${fleet.vessels.length} hulls on the full rigid body at 60 fps: ${f1(stress.samples)} water samples/frame, physics ${f2(stress.avg)} ms avg, p95 ${f2(stress.p95)}`);
}

/* ------------------------------------------------------------------ */
/* 9. dt robustness                                                    */
/* ------------------------------------------------------------------ */
console.log('\n9. Frame-rate robustness');
{
  hs.setWind('lodos', 14);
  const spot = latLonToLocal(40.93, 28.98);
  const cam = new THREE.Vector3(spot.x, 10, spot.z);
  const trace = (dt: number | (() => number)): { roll: number[]; x: number[]; bad: boolean } => {
    const boat = new Vessel(1, models.get('fishing')!, null as never, new THREE.Color(), 0);
    let bx = spot.x;
    boat.behaviour = { update: (d, st) => { bx += 3 * d; st.x = bx; st.z = spot.z; st.yaw = -Math.PI / 2; st.speed = 3; st.mode = 'underway'; st.astern = false; } };
    boat.behaviour.update(0, boat.state);
    const physics = new VesselPhysics([boat], null);
    physics.water = hs.waves;
    const roll: number[] = [];
    const x: number[] = [];
    let bad = false;
    let t = 0;
    let next = 0;
    while (t < 60) {
      const d = typeof dt === 'number' ? dt : dt();
      t += d;
      hs.advance(9000 + t, d, cam.x, cam.z);
      boat.behaviour.update(d, boat.state);
      physics.update(d, cam);
      if (!Number.isFinite(boat.roll + boat.x + boat.heave)) bad = true;
      if (t >= next) {
        roll.push(boat.roll);
        x.push(boat.x);
        next += 1;
      }
    }
    return { roll, x, bad };
  };
  let seed = 7;
  const jitter = (): number => {
    seed = (seed * 16807) % 2147483647;
    return 1 / 144 + (seed / 2147483647) * (1 / 12);
  };
  const a = trace(1 / 24);
  const b = trace(1 / 144);
  const c = trace(1 / 60);
  const j = trace(jitter);
  const diff = (p: number[], q: number[]): number => {
    let m = 0;
    for (let i = 0; i < Math.min(p.length, q.length); i++) m = Math.max(m, Math.abs(p[i] - q[i]));
    return m;
  };
  const dRoll = Math.max(diff(a.roll, b.roll), diff(a.roll, c.roll));
  const dX = Math.max(diff(a.x, b.x), diff(a.x, c.x));
  console.log(`  fishing boat underway in a lodos: max difference between dt 1/24, 1/60 and 1/144: roll ${f2(deg(dRoll))}°, position ${f2(dX)} m; jittered dt 1/144..1/11: finite ${!j.bad}`);
  check(!a.bad && !b.bad && !c.bad && !j.bad, 'no NaNs at dt 1/24, 1/60, 1/144 and jittered frame times');
  check(deg(dRoll) < 3 && dX < 0.5, 'the motion does not depend on the frame rate (fixed sub-step: roll within 3°, position within 0.5 m)');
  // The whole fleet at 144 fps for a minute.
  hs.setWind('poyraz', 10);
  const fleet = new Fleet({ geo, models, berths, lanes, shipCount: 45, water: hs.waves }, new THREE.MeshBasicMaterial());
  fleet.physics.forceLod = HullLod.Full;
  const cam2 = new THREE.Vector3(0, 50, 0);
  let nan = 0;
  for (let t = 0; t < 60; t += 1 / 144) {
    hs.advance(3000 + t, 1 / 144, 0, 0);
    fleet.update(1 / 144, cam2);
    for (const v of fleet.vessels) if (!Number.isFinite(v.x + v.z + v.heave + v.roll + v.pitch + v.yaw)) nan++;
  }
  console.log(`  medium fleet at 144 fps for 60 s: non-finite poses ${nan}, resets ${fleet.physics.stats.resets}`);
  check(nan === 0 && fleet.physics.stats.resets === 0, 'the whole fleet stays finite at 144 fps');
}

console.log(`\nfinished in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(failures.length ? `\n${failures.length} check(s) FAILED:\n  ${failures.join('\n  ')}` : '\nAll vessel checks passed.');
process.exit(failures.length ? 1 : 0);
