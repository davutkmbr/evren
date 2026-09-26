/**
 * Phase 21 stage 3 check, headless (no browser, no GPU): plunge dive, under-water movement and breach.
 *
 *   npx tsx tools/headless/plunge-check.ts          # all sections, exits 1 when a check fails
 *   npx tsx tools/headless/plunge-check.ts --quick  # a smaller depth table
 *
 * The real FlightSim over the real geography (seabed from the bathymetry), the real sea (water service: waves and the
 * Bosphorus current) and a terrain-only collision world with vessel hull boxes added where a section needs them:
 *
 * 1. Depth table: folded dives held at a fixed path (assist override, Shift held) into deep water, by entry speed and
 *    angle: plunge depth, time under water and how the dive ended with neutral controls.
 * 2. Real entries: a hands-off Shift dive and a free fall (Shift held) over deep water plunge in (the assist's dive
 *    floor and the automatic catch give way); the flow hooks are emitted.
 * 3. Breach: Space near the surface, a fast rise (S held from the entry) and Space held (strokes): exit speed, share of
 *    the underwater speed kept, height gained; a slow rise surfaces into swimming.
 * 4. Surfacing on its own: after the time limit (W held to stay down) and at low air.
 * 5. Safety: refusals over a shoal, near the shore and next to a vessel (hint, no plunge; the hands-off dive pulls out
 *    without touching the water); the seabed is never penetrated (a fit but moderately deep site hit at full speed);
 *    a hull ahead under water is bumped into, not passed through; a dragon pressed up under a hull gets out.
 * 6. Current: the under-water dragon drifts with the Bosphorus current (compared with the same dive without it).
 * Every step of every run is checked for NaNs.
 */
import * as THREE from 'three';
import { CollisionWorld, type ContactResult } from '../../src/core/collision';
import type { WaterService } from '../../src/core/contracts';
import { headingToYaw, latLonToLocal } from '../../src/core/geo-coords';
import { DEG, PHYSICS_DT, PLUNGE } from '../../src/dragon/flight/params';
import type { FlightSim } from '../../src/dragon/flight/sim';
import { clearPilotEdges, createPilotCommand, type PilotCommand, type SimEvent } from '../../src/dragon/flight/types';
import type { DiveExit, PlungeRefusal } from '../../src/dragon/flight/underwater';
import { createHullBox, hullBox } from '../../src/world/life/vessels/hull-colliders';
import { buildHeadlessGeo } from './geo';
import { createHeadlessSim, LiftEnv } from './lift-sim';
import { createHeadlessSea } from './water-sea';

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
const hs = createHeadlessSea(geo);
hs.setWind('poyraz', 7);
const waves = hs.waves;
const env = new LiftEnv(11, 'calm');
const FRAME = 1 / 60;
const SUBSTEPS = Math.round(FRAME / PHYSICS_DT);
console.log(`geo + sea ready in ${Date.now() - t0} ms (poyraz sea, U10 7 m/s)`);

interface Place {
  name: string;
  x: number;
  z: number;
}

/** First water point on a grid scan of the box satisfying `pred` (seabed h, coast distance c), nearest to `near`. */
function findPlace(name: string, near: { x: number; z: number }, radius: number, pred: (h: number, c: number, x: number, z: number) => boolean): Place | null {
  let best: Place | null = null;
  let bestD = Infinity;
  for (let x = near.x - radius; x <= near.x + radius; x += 23) {
    for (let z = near.z - radius; z <= near.z + radius; z += 23) {
      const h = geo.heightAt(x, z);
      const c = geo.coastDistance(x, z);
      if (!pred(h, c, x, z)) continue;
      const d = Math.hypot(x - near.x, z - near.z);
      if (d < bestD) {
        bestD = d;
        best = { name, x, z };
      }
    }
  }
  return best;
}

/** Deepest seabed along a heading over `reach` m from (x, z) (the plunge site test's samples). */
function shallowestAlong(x: number, z: number, headingDeg: number, reach: number): number {
  const yaw = headingToYaw(headingDeg);
  let top = -Infinity;
  for (let d = 0; d <= reach; d += 4) {
    top = Math.max(top, geo.heightAt(x - Math.sin(yaw) * d, z - Math.cos(yaw) * d));
  }
  return top;
}

const kadikoy = latLonToLocal(40.97, 29.0);
const deep: Place = { name: 'Marmara off Kadıköy', x: kadikoy.x, z: kadikoy.z };
const moda = latLonToLocal(40.98, 29.02);
// Fit but moderately deep water: seabed 7.5–9.5 m down along the whole reach, well away from the shore.
const moderate = findPlace('moderate', moda, 3000, (h, c, x, z) => h < -7.5 && h > -9.5 && c < -80 && shallowestAlong(x, z, 180, 60) < -7 && shallowestAlong(x, z, 180, 60) > -9.8);
// A shoal: seabed 1–5 m down, well out from the coastline (the upper Golden Horn).
const shoal = findPlace('shoal (Golden Horn)', { x: -6800, z: -500 }, 1500, (h, c, x, z) => h < -1 && h > -4.5 && c < -80 && shallowestAlong(x, z, 180, 40) < -0.8);
// Near the Moda shore: deep enough, but inside the shore margin.
const nearShore = findPlace('Moda shore', moda, 800, (h, c) => c > -PLUNGE.shoreMargin + 4 && c < -8 && h < -1);
const narrows = (() => {
  let best: Place = deep;
  let bestSpeed = 0;
  const cur = new THREE.Vector3();
  for (let lat = 41.06; lat <= 41.12; lat += 0.002) {
    for (let lon = 29.0; lon <= 29.1; lon += 0.0005) {
      const p = latLonToLocal(lat, lon);
      if (geo.heightAt(p.x, p.z) > -40 || geo.coastDistance(p.x, p.z) > -150) continue;
      hs.advance(1000, 0, p.x, p.z);
      const s = Math.hypot(waves.currentAt(p.x, p.z, cur).x, cur.z);
      if (s > bestSpeed) {
        bestSpeed = s;
        best = { name: 'Bosphorus narrows', x: p.x, z: p.z };
      }
    }
  }
  return best;
})();
for (const p of [deep, moderate, shoal, nearShore, narrows]) {
  if (p) console.log(`  site ${p.name.padEnd(22)} x ${f1(p.x)} z ${f1(p.z)} seabed ${f1(geo.heightAt(p.x, p.z))} m coast ${f1(geo.coastDistance(p.x, p.z))} m`);
}
check(!!moderate && !!shoal && !!nearShore, 'test sites found (moderate depth, shoal, near shore)');

/** Water service without the current (same waves). */
class StillWater implements WaterService {
  constructor(private readonly inner: WaterService) {}
  get seaState() {
    return this.inner.seaState;
  }
  heightAt(x: number, z: number): number {
    return this.inner.heightAt(x, z);
  }
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return this.inner.normalAt(x, z, out);
  }
  velocityAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    this.inner.velocityAt(x, z, out);
    const c = this.inner.currentAt(x, z, new THREE.Vector3());
    return out.sub(c);
  }
  currentAt(_x: number, _z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, 0);
  }
}

type Script = (t: number, sim: FlightSim, cmd: PilotCommand) => void;

interface DiveOptions {
  at: Place;
  headingDeg: number;
  speed: number;
  pathDeg: number;
  /** Height of the lowest point above the water at the start (m). */
  startClear?: number;
  /** Hold the path with the assist override until the entry (false: the pilot's own dive law). */
  holdPath?: boolean;
  /** Pilot input every substep (t = seconds since the start; `under` = seconds since the entry, -1 before). */
  script?: (t: number, under: number, sim: FlightSim, cmd: PilotCommand) => void;
  seconds: number;
  prep?: (sim: FlightSim) => void;
  water?: WaterService;
  collision?: CollisionWorld;
  folded?: boolean;
}

interface DiveResult {
  sim: FlightSim;
  entered: boolean;
  entrySpeed: number;
  entryPath: number;
  maxDepth: number;
  exit: DiveExit | null;
  exitAt: number;
  /** Largest height of the lowest point above the water within 4 s after a breach. */
  apex: number;
  minSeabedClear: number;
  maxHullPen: number;
  minFeetClearBeforeEntry: number;
  nan: boolean;
  events: SimEvent[];
  modes: Set<string>;
  refusals: Set<PlungeRefusal>;
  /** Position at the entry and at `seconds` (or at the exit). */
  entryPos: THREE.Vector3;
  endPos: THREE.Vector3;
  underTime: number;
  maxUnderSpeed: number;
  autoAt: number;
}

const _contact: ContactResult = { normal: new THREE.Vector3(), depth: 0, surface: '' };
const _c = new THREE.Vector3();
const _l = new THREE.Vector3();

function dive(o: DiveOptions): DiveResult {
  const sim = createHeadlessSim(geo, env);
  if (o.collision) {
    o.collision.setGeo(geo);
    sim.world.collision = o.collision;
  }
  sim.options.turbulence = false;
  sim.options.thermals = false;
  sim.world.water = o.water ?? waves;
  let time = 1000;
  hs.advance(time, 0, o.at.x, o.at.z);
  const path = o.pathDeg * DEG;
  const yaw = headingToYaw(o.headingDeg);
  const waterY = sim.waterHeight(o.at.x, o.at.z);
  // Start so that the path meets the water at the site.
  const clear = o.startClear ?? 14;
  const drop = clear + 1.6;
  const back = drop / Math.tan(-path);
  const sx = o.at.x + Math.sin(yaw) * back;
  const sz = o.at.z + Math.cos(yaw) * back;
  sim.teleport(sx, waterY + drop, sz, yaw, path, o.speed);
  sim.body.velocity.set(-Math.sin(yaw) * Math.cos(path) * o.speed, Math.sin(path) * o.speed, -Math.cos(yaw) * Math.cos(path) * o.speed);
  if (o.folded !== false) {
    sim.spread = 0.08;
    sim.sweep = 1;
  }
  o.prep?.(sim);
  const r: DiveResult = {
    sim,
    entered: false,
    entrySpeed: 0,
    entryPath: 0,
    maxDepth: 0,
    exit: null,
    exitAt: -1,
    apex: -Infinity,
    minSeabedClear: Infinity,
    maxHullPen: 0,
    minFeetClearBeforeEntry: Infinity,
    nan: false,
    events: [],
    modes: new Set(),
    refusals: new Set(),
    entryPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    underTime: 0,
    maxUnderSpeed: 0,
    autoAt: -1,
  };
  const cmd = createPilotCommand();
  const frames = Math.round(o.seconds / FRAME);
  let t = 0;
  let enteredAt = -1;
  let held = o.holdPath !== false;
  for (let f = 0; f < frames; f++) {
    const p = sim.body.position;
    hs.advance(time, FRAME, p.x, p.z);
    for (let s = 0; s < SUBSTEPS; s++) {
      cmd.pitch = 0;
      cmd.roll = 0;
      cmd.yaw = 0;
      cmd.flap = false;
      cmd.dive = enteredAt < 0 && r.exit === null;
      cmd.brake = false;
      cmd.fire = false;
      clearPilotEdges(cmd);
      sim.overrides.pathTarget = held ? path : null;
      o.script?.(t, enteredAt < 0 ? -1 : t - enteredAt, sim, cmd);
      sim.step(PHYSICS_DT, cmd);
      time += PHYSICS_DT;
      t += PHYSICS_DT;
      for (const e of sim.events) {
        r.events.push(e);
      }
      sim.events.length = 0;
      r.modes.add(sim.mode);
      if (!sim.body.isFinite() || !Number.isFinite(sim.airspeed) || !Number.isFinite(sim.stamina)) {
        r.nan = true;
      }
      if (sim.dive.refusal) {
        r.refusals.add(sim.dive.refusal);
      }
      if (sim.mode === 'underwater') {
        if (enteredAt < 0) {
          enteredAt = t;
          r.entered = true;
          r.entrySpeed = sim.dive.entrySpeed;
          r.entryPath = sim.dive.entryPath;
          r.entryPos.copy(p);
          held = false;
        }
        r.maxDepth = Math.max(r.maxDepth, sim.dive.maxDepth);
        if (t - enteredAt > 1.5) r.maxUnderSpeed = Math.max(r.maxUnderSpeed, sim.airspeed);
        if (sim.dive.auto && r.autoAt < 0) r.autoAt = t - enteredAt;
        // Seabed clearance and hull penetration of every body sphere.
        for (let i = 0; i < sim.contacts.offsets.length; i++) {
          const rad = sim.contacts.radii[i];
          _l.copy(sim.contacts.offsets[i]).applyQuaternion(sim.body.quaternion);
          _c.copy(p).add(_l);
          r.minSeabedClear = Math.min(r.minSeabedClear, _c.y - rad - geo.heightAt(_c.x, _c.z));
          const hit = sim.world.collision?.resolveSphere(_c, rad, _contact, false);
          if (hit && hit.surface === 'vessel') {
            r.maxHullPen = Math.max(r.maxHullPen, hit.depth);
          }
        }
      } else if (enteredAt < 0) {
        held = held && (sim.mode === 'diving' || sim.mode === 'flying' || sim.mode === 'gliding');
        if (sim.airborne) {
          r.minFeetClearBeforeEntry = Math.min(r.minFeetClearBeforeEntry, sim.footClearance);
        }
      }
      if (sim.dive.lastExit && !r.exit) {
        r.exit = sim.dive.lastExit;
        r.exitAt = t;
        r.underTime = t - enteredAt;
        r.endPos.copy(p);
      }
      if (r.exit && r.exit.kind === 'breach' && t - r.exitAt < 4) {
        r.apex = Math.max(r.apex, sim.footClearance);
      }
    }
  }
  if (!r.exit) {
    r.endPos.copy(sim.body.position);
    r.underTime = enteredAt >= 0 ? t - enteredAt : 0;
  }
  return r;
}

const maneuvers = (r: DiveResult, id: string): Array<Extract<SimEvent, { type: 'maneuver' }>> =>
  r.events.filter((e): e is Extract<SimEvent, { type: 'maneuver' }> => e.type === 'maneuver' && e.id === id);
const hints = (r: DiveResult): string[] => maneuvers(r, 'hint').map((e) => e.label);

let anyNan = false;
let minSeabed = Infinity;
let maxPen = 0;
function track(r: DiveResult): DiveResult {
  anyNan ||= r.nan;
  if (r.entered) {
    minSeabed = Math.min(minSeabed, r.minSeabedClear);
  }
  maxPen = Math.max(maxPen, r.maxHullPen);
  return r;
}

/* ---------------------------------------------------------------------------------------------- */
console.log('\n1. Plunge depth by entry speed and angle (deep water, neutral controls after the entry)');
{
  const speeds = QUICK ? [22, 45, 80] : [22, 35, 50, 65, 80];
  const angles = QUICK ? [-38, -60, -88] : [-38, -50, -65, -80, -88];
  const depths: number[] = [];
  let allEntered = true;
  let allSurfaced = true;
  const header = `  ${'path \\ speed'.padEnd(13)}${speeds.map((s) => `${s} m/s`.padStart(27)).join('')}`;
  console.log(header);
  console.log(`  ${''.padEnd(13)}${speeds.map(() => 'depth m / under s / exit'.padStart(27)).join('')}`);
  for (const a of angles) {
    const cells: string[] = [];
    for (const v of speeds) {
      const r = track(dive({ at: deep, headingDeg: 200, speed: v, pathDeg: a, seconds: 24 }));
      allEntered &&= r.entered;
      allSurfaced &&= !!r.exit;
      if (r.entered) depths.push(r.maxDepth);
      cells.push((r.entered ? `${f1(r.maxDepth)} / ${f1(r.underTime)} / ${r.exit?.kind ?? '-'}` : 'no plunge').padStart(27));
    }
    console.log(`  ${`${a}°`.padEnd(13)}${cells.join('')}`);
  }
  const lo = Math.min(...depths);
  const hi = Math.max(...depths);
  check(allEntered, 'every steep folded entry over deep water plunges in');
  check(allSurfaced, 'every dive ends (surfaced or breached) with neutral controls');
  check(lo >= 3.5 && lo <= 7 && hi >= 12 && hi <= 17, `plunge depth spans ~5–15 m (${f1(lo)}–${f1(hi)} m)`);
  // Entry speed and angle both matter.
  const shallowFast = track(dive({ at: deep, headingDeg: 200, speed: 80, pathDeg: -38, seconds: 3 }));
  const steepSlow = track(dive({ at: deep, headingDeg: 200, speed: 22, pathDeg: -88, seconds: 3 }));
  const steepFast = track(dive({ at: deep, headingDeg: 200, speed: 80, pathDeg: -88, seconds: 3 }));
  check(steepFast.maxDepth > steepSlow.maxDepth + 3 && steepFast.maxDepth > shallowFast.maxDepth + 3, `depth grows with speed and steepness (80 m/s: ${f1(shallowFast.maxDepth)} m at -38°, ${f1(steepFast.maxDepth)} m at -88°; 22 m/s at -88°: ${f1(steepSlow.maxDepth)} m)`);
  const slow = track(dive({ at: deep, headingDeg: 200, speed: 12, pathDeg: -60, seconds: 4, startClear: 0.5 }));
  const shallowPath = track(dive({ at: deep, headingDeg: 200, speed: 45, pathDeg: -22, seconds: 4, startClear: 6 }));
  check(!slow.entered && !shallowPath.entered, `slow (12 m/s) or shallow (-22°) entries do not plunge (modes: ${[...slow.modes].join(',')} / ${[...shallowPath.modes].join(',')})`);
}

/* ---------------------------------------------------------------------------------------------- */
console.log('\n2. Real entries: hands-off Shift dive and free fall over deep water');
{
  const shift = track(dive({ at: deep, headingDeg: 200, speed: 40, pathDeg: -60, startClear: 140, holdPath: false, seconds: 20 }));
  const plunges = maneuvers(shift, 'plunge');
  console.log(`  Shift dive from 140 m: entered ${shift.entered} at ${f1(shift.entrySpeed)} m/s, path ${f1(shift.entryPath / DEG)}°, depth ${f1(shift.maxDepth)} m, exit ${shift.exit?.kind ?? '-'} after ${f1(shift.underTime)} s`);
  check(shift.entered, 'a hands-off Shift dive over deep water plunges in (the dive floor gives way)');
  const started = plunges.filter((e) => !e.ended);
  const ended = plunges.filter((e) => e.ended);
  check(started.length === 1 && started[0].label === 'Dalış' && ended.length === 1 && ended[0].clean === true, `flow hooks: 'plunge' announced ("${started[0]?.label}"), its end marked clean=${ended[0]?.clean}`);
  const impacts = shift.events.filter((e) => e.type === 'impact' && e.surface === 'water');
  const splashes = shift.events.filter((e) => e.type === 'splash').map((e) => (e.type === 'splash' ? e.strength : 0));
  check(impacts.length >= 1 && Math.max(...splashes) >= 1.8, `entry: impact on 'water' and a splash column (strongest splash ${f2(Math.max(...splashes))})`);

  const fall = track(
    dive({
      at: deep,
      headingDeg: 200,
      speed: 16,
      pathDeg: -5,
      startClear: 150,
      holdPath: false,
      folded: false,
      seconds: 20,
      script: (t, under, _sim, cmd) => {
        if (t < 0.02) cmd.dropPressed = true;
        cmd.dive = under < 0;
      },
    }),
  );
  const caught = maneuvers(fall, 'catch').length;
  console.log(`  free fall (Shift held) from 150 m: entered ${fall.entered} at ${f1(fall.entrySpeed)} m/s, path ${f1(fall.entryPath / DEG)}°, depth ${f1(fall.maxDepth)} m, catches ${caught}`);
  check(fall.entered && caught === 0, 'a free fall with Shift held over deep water plunges in (no automatic catch)');
}

/* ---------------------------------------------------------------------------------------------- */
console.log('\n3. Breach');
const breaches: Array<{ label: string; r: DiveResult }> = [];
{
  // Space near the surface: S held from the entry brings the nose round, Space once within 2 m.
  let pressed = false;
  const nearSurface = track(
    dive({
      at: deep,
      headingDeg: 200,
      speed: 50,
      pathDeg: -60,
      seconds: 14,
      script: (_t, under, sim, cmd) => {
        if (under < 0) return;
        cmd.pitch = under < 0.6 ? -1 : 0;
        const depth = sim.waterHeight(sim.body.position.x, sim.body.position.z) - sim.body.position.y;
        if (!pressed && under > 0.6 && sim.mode === 'underwater' && depth < PLUNGE.breachDepth && sim.body.velocity.y > 0) {
          pressed = true;
          cmd.flapPressed = true;
        }
      },
    }),
  );
  breaches.push({ label: 'Space near the surface (S from the entry)', r: nearSurface });
  // Fast rise: S held hard from the entry, no Space: a J-turn back up through the surface.
  const fastRise = track(dive({ at: deep, headingDeg: 200, speed: 65, pathDeg: -45, seconds: 12, script: (_t, under, _s, cmd) => under >= 0 && (cmd.pitch = -1) }));
  breaches.push({ label: 'fast rise (S held, no Space)', r: fastRise });
  // Space held from the entry: strokes, the nose comes up hands-off, the breach at the surface.
  const strokes = track(dive({ at: deep, headingDeg: 200, speed: 40, pathDeg: -60, seconds: 16, script: (_t, under, _s, cmd) => under > 0.5 && (cmd.flap = true) }));
  breaches.push({ label: 'Space held (strokes)', r: strokes });
  console.log(`  ${'case'.padEnd(42)}${'under s'.padStart(9)}${'depth'.padStart(8)}${'v under'.padStart(9)}${'v exit'.padStart(8)}${'kept'.padStart(7)}${'apex m'.padStart(8)}  mode 4 s after`);
  for (const { label, r } of breaches) {
    const e = r.exit;
    const kept = e && e.underSpeed > 0 ? e.exitSpeed / e.underSpeed : NaN;
    console.log(
      `  ${label.padEnd(42)}${f1(r.underTime).padStart(9)}${f1(r.maxDepth).padStart(8)}${f1(e?.underSpeed ?? NaN).padStart(9)}${f1(e?.exitSpeed ?? NaN).padStart(8)}${(Number.isFinite(kept) ? `${(kept * 100).toFixed(0)}%` : '-').padStart(7)}${f1(r.apex).padStart(8)}  ${e?.kind ?? 'none'} → ${r.sim.mode}`,
    );
  }
  check(breaches.every((b) => b.r.exit?.kind === 'breach'), 'Space near the surface, a fast rise and held strokes all breach');
  check(breaches.every((b) => b.r.apex > 3), `the body clears the water after every breach (lowest point up to ${breaches.map((b) => f1(b.r.apex)).join(' / ')} m within 4 s)`);
  // Above the least exit speed the retention shows (slower breaches leave at PLUNGE.breachMinSpeed).
  const fast = breaches.filter((b) => (b.r.exit?.underSpeed ?? 0) * PLUNGE.retention >= PLUNGE.breachMinSpeed);
  const keptOk = fast.every((b) => {
    const k = b.r.exit!.exitSpeed / b.r.exit!.underSpeed;
    return k >= 0.5 && k <= 0.72;
  });
  check(fast.length >= 1 && keptOk, `fast breaches keep 50–70 % of the underwater speed (${fast.map((b) => `${((b.r.exit!.exitSpeed / b.r.exit!.underSpeed) * 100).toFixed(0)}%`).join(', ')})`);
  const flyingAfter = breaches.every((b) => b.r.sim.airborne);
  check(flyingAfter, `every breach climbs away airborne (${breaches.map((b) => b.r.sim.mode).join(', ')})`);
  const breachEvents = breaches.map((b) => maneuvers(b.r, 'breach'));
  check(breachEvents.every((e) => e.length === 1 && e[0].label === 'Fırlama' && typeof e[0].clean === 'boolean'), `flow hooks: 'breach' announced ("Fırlama") with a clean flag (${breachEvents.map((e) => e[0]?.clean).join(', ')})`);
  // A slow rise (neutral: the nose comes up, gentle sculling) surfaces into swimming.
  const slowRise = track(dive({ at: deep, headingDeg: 200, speed: 30, pathDeg: -45, seconds: 20 }));
  console.log(`  slow rise (neutral): exit ${slowRise.exit?.kind ?? '-'} after ${f1(slowRise.underTime)} s at ${f1(slowRise.exit?.exitSpeed ?? NaN)} m/s, mode ${slowRise.sim.mode}`);
  check(slowRise.exit?.kind === 'surface' && slowRise.sim.mode === 'swimming', 'a slow rise surfaces into swimming');
  console.log(`  strokes: fastest underwater speed with Space held (from 1.5 s after the entry) ${f1(strokes.maxUnderSpeed)} m/s (entry ${f1(strokes.entrySpeed)} m/s)`);
}

/* ---------------------------------------------------------------------------------------------- */
console.log('\n4. Surfacing on its own');
{
  const deepStay = track(dive({ at: deep, headingDeg: 200, speed: 50, pathDeg: -70, seconds: 30, script: (_t, under, _s, cmd) => under >= 0 && (cmd.pitch = 0.35) }));
  console.log(`  W held to stay down: auto-surfacing from ${f1(deepStay.autoAt)} s, out after ${f1(deepStay.underTime)} s (${deepStay.exit?.kind ?? 'still under'}), deepest ${f1(deepStay.maxDepth)} m, seabed ${f1(geo.heightAt(deep.x, deep.z))} m, stamina ${f2(deepStay.sim.stamina)}`);
  check(Math.abs(deepStay.autoAt - PLUNGE.maxTime) < 0.2 && !!deepStay.exit && deepStay.underTime < PLUNGE.maxTime + 12, `after ${PLUNGE.maxTime} s it surfaces on its own (auto at ${f1(deepStay.autoAt)} s, out at ${f1(deepStay.underTime)} s)`);
  check(deepStay.exit?.forced === true && maneuvers(deepStay, 'plunge').some((e) => e.ended && e.clean === false), 'a forced surfacing ends the plunge unclean');
  const lowAir = track(dive({ at: deep, headingDeg: 200, speed: 50, pathDeg: -70, seconds: 20, prep: (s) => (s.stamina = 0.13), script: (_t, under, _s, cmd) => under >= 0 && (cmd.pitch = 0.35) }));
  console.log(`  low air (stamina 0.13 at the entry): auto-surfacing from ${f1(lowAir.autoAt)} s, out after ${f1(lowAir.underTime)} s`);
  check(lowAir.autoAt > 0 && lowAir.autoAt < 3 && !!lowAir.exit, 'at low air it surfaces on its own early');
}

/* ---------------------------------------------------------------------------------------------- */
console.log('\n5. Safety');
{
  // Shoal: forced entry (path held) is refused at contact, the hands-off Shift dive pulls out before the water.
  if (shoal) {
    const forced = track(dive({ at: shoal, headingDeg: 180, speed: 45, pathDeg: -60, seconds: 6 }));
    console.log(`  shoal, path held into it: modes ${[...forced.modes].join(', ')}; refusals ${[...forced.refusals].join(', ')}; hints ${JSON.stringify(hints(forced))}`);
    check(!forced.entered && forced.refusals.has('shallow') && hints(forced).includes('Burası dalış için çok sığ'), 'over a shoal the plunge is refused with "Burası dalış için çok sığ"');
    const handsOff = track(dive({ at: shoal, headingDeg: 180, speed: 40, pathDeg: -60, startClear: 120, holdPath: false, seconds: 12 }));
    console.log(`  shoal, hands-off Shift dive from 120 m: lowest feet clearance ${f2(handsOff.minFeetClearBeforeEntry)} m, modes ${[...handsOff.modes].join(', ')}`);
    check(!handsOff.entered && handsOff.minFeetClearBeforeEntry > 0 && hints(handsOff).length > 0, 'over a shoal the hands-off dive pulls out without touching the water');
  }
  if (nearShore) {
    const heading = 180;
    const r = track(dive({ at: nearShore, headingDeg: heading, speed: 45, pathDeg: -60, seconds: 5 }));
    console.log(`  near the Moda shore: refusals ${[...r.refusals].join(', ')}; hints ${JSON.stringify(hints(r))}`);
    check(!r.entered && (r.refusals.has('shore') || r.refusals.has('shallow')), 'near the shore the plunge is refused');
  }
  // A vessel beside the entry.
  {
    const col = new CollisionWorld();
    const box = createHullBox();
    const yaw = headingToYaw(200);
    // A 120 m ship, 20 m beam, 7 m draft, alongside the entry point: its side 9 m off.
    const sideX = Math.cos(yaw);
    const sideZ = -Math.sin(yaw);
    hullBox({ length: 120, beam: 20, draft: 7 }, deep.x + sideX * 18, deep.z + sideZ * 18, yaw, 0, box);
    col.add(box, 'vessel', 'test:ship');
    const r = track(dive({ at: deep, headingDeg: 200, speed: 45, pathDeg: -60, seconds: 5, collision: col }));
    console.log(`  ship 9 m off the entry: refusals ${[...r.refusals].join(', ')}; hints ${JSON.stringify(hints(r))}`);
    check(!r.entered && r.refusals.has('vessel') && hints(r).includes('Gemiye çok yakın, dalış yok'), 'next to a ship the plunge is refused');
  }
  // Seabed never penetrated: fit but moderately deep water hit vertically at full speed.
  if (moderate) {
    const r = track(dive({ at: moderate, headingDeg: 180, speed: 80, pathDeg: -50, seconds: 14, script: (_t, under, _s, cmd) => under >= 0 && under < 3 && (cmd.pitch = 0.6) }));
    const steep = track(dive({ at: moderate, headingDeg: 180, speed: 60, pathDeg: -85, seconds: 4 }));
    console.log(`  seabed ${f1(geo.heightAt(moderate.x, moderate.z))} m: a vertical entry is refused (${[...steep.refusals].join(', ') || 'entered'})`);
    check(!steep.entered && steep.refusals.has('shallow'), 'a vertical plunge needs deeper water than a shallow-angled one');
    console.log(`  seabed ${f1(geo.heightAt(moderate.x, moderate.z))} m, 80 m/s at -50°, W held 3 s: entered ${r.entered}, depth ${f1(r.maxDepth)} m, lowest body point above the seabed ${f2(r.minSeabedClear)} m, contacts ${r.exit?.contacts ?? r.sim.dive.contacts}, exit ${r.exit?.kind ?? '-'} ${r.exit?.forced ? '(forced)' : ''}`);
    check(r.entered && r.minSeabedClear > -0.05 && !!r.exit, 'a plunge toward a near seabed never penetrates it and still ends at the surface');
  }
  // A hull ahead under water: bumped into, never passed through.
  {
    const col = new CollisionWorld();
    const box = createHullBox();
    const yaw = headingToYaw(200);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    // Across the track 36 m past the entry (just clear of the entry check), 200 m long, 16 m draft (a laden tanker).
    hullBox({ length: 200, beam: 32, draft: 16 }, deep.x + fx * (36 + 14.4), deep.z + fz * (36 + 14.4), yaw + Math.PI / 2, 0, box);
    col.add(box, 'vessel', 'test:tanker');
    const r = track(
      dive({
        at: deep,
        headingDeg: 200,
        speed: 45,
        pathDeg: -45,
        seconds: 24,
        collision: col,
        // Level out a little nose-down at depth and stroke toward the hull.
        script: (_t, under, sim, cmd) => {
          if (under < 0) return;
          cmd.pitch = sim.dive.pitch < -12 * DEG ? -0.6 : sim.dive.pitch > -4 * DEG ? 0.6 : 0.05;
          const depth = sim.waterHeight(sim.body.position.x, sim.body.position.z) - sim.body.position.y;
          cmd.flap = under > 0.8 && under < 8 && depth > 3;
        },
      }),
    );
    const bumps = r.events.filter((e) => e.type === 'impact' && e.surface === 'vessel').length;
    const along = (r.endPos.x - r.entryPos.x) * fx + (r.endPos.z - r.entryPos.z) * fz;
    console.log(`  hull ahead: contacts ${r.sim.dive.contacts + (r.exit?.contacts ?? 0)}, vessel impacts ${bumps}, deepest hull penetration ${f2(r.maxHullPen)} m, travelled ${f1(along)} m along the track (hull face at 36 m), exit ${r.exit?.kind ?? '-'} after ${f1(r.underTime)} s`);
    check(r.maxHullPen < 0.3 && along < 36 + 4 && !!r.exit && (bumps > 0 || (r.exit?.contacts ?? r.sim.dive.contacts) > 0), 'a hull under water is bumped into, not passed through');
  }
  // Pressed up under a hull: gets out and surfaces.
  {
    const col = new CollisionWorld();
    const box = createHullBox();
    const r = track(
      dive({
        at: deep,
        headingDeg: 200,
        speed: 50,
        pathDeg: -70,
        seconds: 40,
        collision: col,
        script: (_t, under, sim) => {
          if (under >= 0.9 && under < 0.9 + PHYSICS_DT * 1.5 && box.halfSize.x === 0) {
            // A 180 m bulk carrier drifts over the dragon: its bottom 1.5 m above the body.
            const p = sim.body.position;
            const bottom = p.y + sim.contacts.radii[0] + 1.5;
            hullBox({ length: 180, beam: 30, draft: -bottom }, p.x, p.z, headingToYaw(200) + 0.3, 0, box);
            col.add(box, 'vessel', 'test:bulk');
          }
        },
      }),
    );
    console.log(`  under a hull: out after ${f1(r.underTime)} s (${r.exit?.kind ?? 'still under'}), deepest hull penetration ${f2(r.maxHullPen)} m, auto from ${f1(r.autoAt)} s`);
    check(!!r.exit && r.maxHullPen < 0.3, 'a dragon pressed up under a hull gets out and surfaces');
  }
}

/* ---------------------------------------------------------------------------------------------- */
console.log('\n6. Current under water');
{
  const cur = waves.currentAt(narrows.x, narrows.z, new THREE.Vector3());
  const opts = { at: narrows, headingDeg: 90, speed: 40, pathDeg: -60, seconds: 7, script: (_t: number, under: number, _s: FlightSim, cmd: PilotCommand) => under >= 0 && (cmd.pitch = 0.2) };
  const withCurrent = track(dive(opts));
  const still = track(dive({ ...opts, water: new StillWater(waves) }));
  const cs = Math.hypot(cur.x, cur.z);
  const ux = cur.x / cs;
  const uz = cur.z / cs;
  const drift = (withCurrent.endPos.x - still.endPos.x) * ux + (withCurrent.endPos.z - still.endPos.z) * uz;
  const t = Math.min(withCurrent.underTime, still.underTime);
  console.log(`  ${narrows.name}: surface current ${f2(cs)} m/s; after ${f1(t)} s under water the dragon is ${f1(drift)} m further down-current than without the current (${f1(cs * t)} m at the full surface current)`);
  check(withCurrent.entered && drift > 0.4 * cs * t && drift < 1.1 * cs * t + 2, 'the current carries the dragon under water');
}

console.log(`\n  no NaNs in any run: ${!anyNan}; lowest body point above the seabed over all dives ${f2(minSeabed)} m; deepest hull penetration ${f2(maxPen)} m`);
check(!anyNan, 'no NaNs');
check(minSeabed > -0.05, 'the seabed is never penetrated');
console.log(failures.length ? `\n${failures.length} check(s) FAILED:\n  ${failures.join('\n  ')}` : '\nAll plunge checks passed.');
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures.length ? 1 : 0);
