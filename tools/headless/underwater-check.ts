/**
 * Phase 21 stage 4 check, headless (no browser, no GPU): the camera under water and the under-water state.
 *
 *   npx tsx tools/headless/underwater-check.ts          # all sections, exits 1 when a check fails
 *   npx tsx tools/headless/underwater-check.ts --quick  # fewer camera scenarios
 *
 * 1. Camera path: the real FlightSim over the real geography and sea (as plunge-check) plunges and breaches while the
 *    real chase camera (and POV) follows through the real camera collision (seabed, hull boxes, the submerge
 *    allowance). Every frame: no NaN, never closer to the seabed than the clearance, never inside a hull box, bounded
 *    per-frame motion relative to the dragon (no jumps), a level-ish horizon under water; the camera really goes under
 *    and comes back out above the waves after the breach; the `under` flag matches the CPU wave height at the camera.
 * 2. State machine: switches in the frame the camera passes the surface band (descending and rising), never flickers
 *    on the waterline (bobbing with noise), leaves droplets only after a real submersion and fades them in ~1 s.
 * 3. Shaders: structural sanity of the GLSL added for stage 4 (no GLSL validator in node_modules): balanced
 *    brackets, every uniform the composite declares is bound by the pass, no GLSL 1 texture calls.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CameraCollision, SEABED_CLEARANCE } from '../../src/camera/obstruction';
import { ChaseController } from '../../src/camera/modes/chase';
import { PovController } from '../../src/camera/modes/pov';
import { DragonTracker } from '../../src/camera/tracker';
import { createPose, type CameraController, type CameraFrame } from '../../src/camera/types';
import { CollisionWorld, type ContactResult } from '../../src/core/collision';
import type { DragonState, EngineContext, FlightMode } from '../../src/core/contracts';
import { headingToYaw, latLonToLocal } from '../../src/core/geo-coords';
import { PHYSICS_DT, PLUNGE } from '../../src/dragon/flight/params';
import { clearPilotEdges, createPilotCommand, type PilotCommand } from '../../src/dragon/flight/types';
import type { FlightSim } from '../../src/dragon/flight/sim';
import { COMPOSITE_FRAG } from '../../src/render/post/shaders/composite.glsl';
import { createHullBox, hullBox } from '../../src/world/life/vessels/hull-colliders';
import { UNDERWATER_STATE, UnderwaterState } from '../../src/world/water/underwater/state';
import { buildHeadlessGeo } from './geo';
import { createHeadlessSim, LiftEnv } from './lift-sim';
import { createHeadlessSea, type SeaWind } from './water-sea';

const QUICK = process.argv.includes('--quick');
const failures: string[] = [];
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
const waves = hs.waves;
const env = new LiftEnv(11, 'calm');
const FRAME = 1 / 60;
const SUBSTEPS = Math.round(FRAME / PHYSICS_DT);
const kadikoy = latLonToLocal(40.97, 29.0);
const deep = { x: kadikoy.x, z: kadikoy.z };
/** Fit but moderately deep water (seabed 7.5–10 m along the dive), where the seabed bounds the camera. */
const moderate = (() => {
  const moda = latLonToLocal(40.98, 29.02);
  const yaw = headingToYaw(200);
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (let x = moda.x - 3000; x <= moda.x + 3000; x += 23) {
    for (let z = moda.z - 3000; z <= moda.z + 3000; z += 23) {
      const h = geo.heightAt(x, z);
      if (h > -7.5 || h < -10 || geo.coastDistance(x, z) > -80) continue;
      let ok = true;
      for (let d = -60; d <= 80 && ok; d += 5) {
        const hh = geo.heightAt(x - Math.sin(yaw) * d, z - Math.cos(yaw) * d);
        ok = hh < -7 && hh > -10.5;
      }
      const dd = Math.hypot(x - moda.x, z - moda.z);
      if (ok && dd < bestD) {
        bestD = dd;
        best = { x, z };
      }
    }
  }
  return best;
})();
console.log(`geo + sea ready in ${Date.now() - t0} ms; sites: Marmara off Kadıköy (seabed ${f2(geo.heightAt(deep.x, deep.z))} m), moderate ${moderate ? `(seabed ${f2(geo.heightAt(moderate.x, moderate.z))} m)` : 'not found'}`);
check(!!moderate, 'test site with a moderately deep seabed found');

/* ---------------------------------------------------------------------------------------------- */

/** DragonState view of the headless sim (what the flight module publishes as the `dragon` service). */
class SimDragon {
  readonly object = new THREE.Object3D();
  readonly velocity = new THREE.Vector3();
  readonly angularVelocity = new THREE.Vector3();
  mode: FlightMode = 'flying';
  agl = 0;
  get position(): THREE.Vector3 {
    return this.object.position;
  }
  get quaternion(): THREE.Quaternion {
    return this.object.quaternion;
  }
  sync(sim: FlightSim): void {
    this.object.position.copy(sim.body.position);
    this.object.quaternion.copy(sim.body.quaternion);
    this.object.updateMatrixWorld(true);
    this.velocity.copy(sim.body.velocity);
    this.mode = sim.mode;
    this.agl = sim.agl;
  }
}

interface CamScenario {
  label: string;
  wind: SeaWind;
  u10: number;
  speed: number;
  pathDeg: number;
  seconds: number;
  pov?: boolean;
  hull?: boolean;
  /** The player orbits the chase camera below the dragon (look button held): the boom reaches for the seabed. */
  orbitDown?: boolean;
  /** Dive site (default: deep water off Kadıköy). */
  at?: { x: number; z: number };
  script: (under: number, sim: FlightSim, cmd: PilotCommand) => void;
}

interface CamResult {
  nan: boolean;
  frames: number;
  wentUnder: boolean;
  camUnderFrames: number;
  minSeabedClear: number;
  maxHullPen: number;
  maxRelJump: number;
  maxAccelJump: number;
  /** Where the largest step change happened (diagnostics). */
  jumpNote: string;
  relNote: string;
  maxRollUnder: number;
  flagMismatch: number;
  surfacedAfterExit: number;
  exited: boolean;
  switches: number;
  maxDepth: number;
  camMaxDepth: number;
  /** Seconds the dragon spent in its under-water mode. */
  dragonUnder: number;
}

const _contact: ContactResult = { normal: new THREE.Vector3(), depth: 0, surface: '' };
const _n = new THREE.Vector3();

function runCamera(sc: CamScenario): CamResult {
  hs.setWind(sc.wind, sc.u10);
  const sim = createHeadlessSim(geo, env);
  const world = sim.world.collision as CollisionWorld;
  sim.options.turbulence = false;
  sim.options.thermals = false;
  sim.world.water = waves;
  let time = 1000;
  const site = sc.at ?? deep;
  hs.advance(time, 0, site.x, site.z);
  if (sc.hull) {
    // A laden tanker across the track 50 m past the entry (as plunge-check's "hull ahead").
    const box = createHullBox();
    const yaw = headingToYaw(200);
    hullBox({ length: 200, beam: 32, draft: 16 }, deep.x - Math.sin(yaw) * 50, deep.z - Math.cos(yaw) * 50, yaw + Math.PI / 2, 0, box);
    world.add(box, 'vessel', 'test:tanker');
  }
  const path = (sc.pathDeg * Math.PI) / 180;
  const yaw = headingToYaw(200);
  const waterY = sim.waterHeight(site.x, site.z);
  const drop = 40;
  const back = drop / Math.tan(-path);
  sim.teleport(site.x + Math.sin(yaw) * back, waterY + drop, site.z + Math.cos(yaw) * back, yaw, path, sc.speed);
  sim.body.velocity.set(-Math.sin(yaw) * Math.cos(path) * sc.speed, Math.sin(path) * sc.speed, -Math.cos(yaw) * Math.cos(path) * sc.speed);
  sim.spread = 0.08;
  sim.sweep = 1;

  const dragon = new SimDragon();
  dragon.sync(sim);
  const services: Record<string, unknown> = { dragon: dragon as unknown as DragonState, collision: world, water: waves };
  const ctx = { services: { tryGet: (k: string) => services[k] } } as unknown as EngineContext;
  const tracker = new DragonTracker();
  const collision = new CameraCollision();
  collision.bindDirect(world, waves);
  const controller: CameraController = sc.pov ? new PovController() : new ChaseController();
  const frame: { -readonly [K in keyof CameraFrame]: CameraFrame[K] } = {
    ctx,
    dt: FRAME,
    camDt: FRAME,
    paused: false,
    target: tracker,
    collision,
    lookYaw: 0,
    lookPitch: 0,
    lookActive: false,
    lookHeld: false,
    wheel: 0,
  };
  const pose = createPose();
  const state = new UnderwaterState();
  tracker.update(ctx, FRAME);
  controller.reset(frame);
  controller.update(frame, pose);

  const r: CamResult = {
    nan: false,
    frames: 0,
    wentUnder: false,
    camUnderFrames: 0,
    minSeabedClear: Infinity,
    maxHullPen: 0,
    maxRelJump: 0,
    maxAccelJump: 0,
    jumpNote: '',
    relNote: '',
    maxRollUnder: 0,
    flagMismatch: 0,
    surfacedAfterExit: -1,
    exited: false,
    switches: 0,
    maxDepth: 0,
    camMaxDepth: 0,
    dragonUnder: 0,
  };
  const cmd = createPilotCommand();
  const prevCam = pose.position.clone();
  const prevDragon = dragon.position.clone();
  const prevStep = new THREE.Vector3();
  const prevDragonStep = new THREE.Vector3();
  let enteredAt = -1;
  let exitAt = -1;
  let t = 0;
  const frames = Math.round(sc.seconds / FRAME);
  for (let f = 0; f < frames; f++) {
    hs.advance(time, FRAME, sim.body.position.x, sim.body.position.z);
    for (let s = 0; s < SUBSTEPS; s++) {
      cmd.pitch = 0;
      cmd.roll = 0;
      cmd.yaw = 0;
      cmd.flap = false;
      cmd.dive = enteredAt < 0;
      cmd.brake = false;
      cmd.fire = false;
      clearPilotEdges(cmd);
      sim.overrides.pathTarget = enteredAt < 0 ? path : null;
      sc.script(enteredAt < 0 ? -1 : t - enteredAt, sim, cmd);
      sim.step(PHYSICS_DT, cmd);
      sim.events.length = 0;
      time += PHYSICS_DT;
      t += PHYSICS_DT;
      if (sim.mode === 'underwater' && enteredAt < 0) {
        enteredAt = t;
      }
      if (enteredAt >= 0 && sim.dive.lastExit && exitAt < 0) {
        exitAt = t;
      }
      if (sim.mode === 'underwater') {
        r.maxDepth = Math.max(r.maxDepth, sim.dive.maxDepth);
        r.dragonUnder += PHYSICS_DT;
      }
    }
    dragon.sync(sim);
    tracker.update(ctx, FRAME);
    if (sc.orbitDown) {
      frame.lookActive = true;
      frame.lookHeld = true;
      frame.lookPitch = f === 0 ? 1.3 : 0;
    }
    // As CameraSystem.update: the allowance from last frame's eye, then the controller.
    collision.updateSubmerge(tracker.mode === 'underwater', prevCam, FRAME);
    controller.update(frame, pose);
    r.frames++;
    const p = pose.position;
    if (!Number.isFinite(p.x + p.y + p.z) || !Number.isFinite(pose.quaternion.x + pose.quaternion.y + pose.quaternion.z + pose.quaternion.w)) {
      r.nan = true;
      break;
    }
    const seabed = geo.heightAt(p.x, p.z);
    if (seabed < 0) {
      r.minSeabedClear = Math.min(r.minSeabedClear, p.y - seabed);
    }
    const hit = world.resolveSphere(p, 0.3, _contact, false);
    if (hit && hit.surface === 'vessel') {
      r.maxHullPen = Math.max(r.maxHullPen, hit.depth);
    }
    // Motion relative to the dragon: the chase camera may lag and swing, but not jump.
    const stepCam = p.clone().sub(prevCam);
    const stepDragon = dragon.position.clone().sub(prevDragon);
    if (f > 2) {
      // Change of the camera's step relative to the dragon's own step change (the plunge entry itself brakes hard).
      const acc = stepCam.clone().sub(prevStep).sub(stepDragon.clone().sub(prevDragonStep)).length();
      const rel = stepCam.clone().sub(stepDragon).length();
      const note = `t ${t.toFixed(2)} s ${tracker.mode} rel ${rel.toFixed(2)} acc ${acc.toFixed(2)} cam y ${p.y.toFixed(1)} dragon y ${dragon.position.y.toFixed(1)} submerge ${collision.submerge.toFixed(1)}`;
      if (acc > r.maxAccelJump) r.jumpNote = `accel: ${note}`;
      if (rel > r.maxRelJump) r.relNote = `rel: ${note}`;
      r.maxAccelJump = Math.max(r.maxAccelJump, acc);
    }
    if (f > 2) {
      r.maxRelJump = Math.max(r.maxRelJump, stepCam.clone().sub(stepDragon).length());
    }
    prevStep.copy(stepCam);
    prevDragonStep.copy(stepDragon);
    prevCam.copy(p);
    prevDragon.copy(dragon.position);

    // The under-water state, fed exactly like the water module does.
    const overWater = geo.isWater(p.x, p.z);
    const h = waves.heightAt(p.x, p.z);
    state.update(p.y, h, waves.normalAt(p.x, p.z, _n), overWater, FRAME);
    const depth = h - p.y;
    if (Math.abs(depth) > UNDERWATER_STATE.decisiveDepth && state.under !== depth > 0) {
      r.flagMismatch++;
    }
    if (depth > 0) {
      r.camUnderFrames++;
      r.camMaxDepth = Math.max(r.camMaxDepth, depth);
    }
    if (tracker.mode === 'underwater') {
      r.wentUnder = true;
      if (depth > 1) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(pose.quaternion);
        r.maxRollUnder = Math.max(r.maxRollUnder, Math.abs(Math.asin(THREE.MathUtils.clamp(right.y, -1, 1))));
      }
    }
    if (exitAt >= 0) {
      r.exited = true;
      if (r.surfacedAfterExit < 0 && !state.under && depth < -0.3) {
        r.surfacedAfterExit = t - exitAt;
      }
    }
  }
  r.switches = state.switches;
  return r;
}

const deg = (rad: number): string => ((rad * 180) / Math.PI).toFixed(1);

console.log('\n1. Camera through a plunge and breach (real flight sim, real camera collision)');
{
  let pressed = false;
  const spaceNearSurface = (under: number, sim: FlightSim, cmd: PilotCommand): void => {
    if (under < 0) {
      pressed = false;
      return;
    }
    cmd.pitch = under < 0.6 ? -1 : 0;
    const depth = sim.waterHeight(sim.body.position.x, sim.body.position.z) - sim.body.position.y;
    if (!pressed && under > 0.6 && sim.mode === 'underwater' && depth < PLUNGE.breachDepth && sim.body.velocity.y > 0) {
      pressed = true;
      cmd.flapPressed = true;
    }
  };
  const scenarios: CamScenario[] = [
    { label: 'chase: plunge, Space near the surface (poyraz 7)', wind: 'poyraz', u10: 7, speed: 50, pathDeg: -60, seconds: 12, script: spaceNearSurface },
    { label: 'chase: fast J-turn breach, S held (lodos 16)', wind: 'lodos', u10: 16, speed: 65, pathDeg: -45, seconds: 12, script: (u, _s, c) => void (u >= 0 && (c.pitch = -1)) },
    { label: 'chase: slow rise into swimming (poyraz 7)', wind: 'poyraz', u10: 7, speed: 30, pathDeg: -45, seconds: 18, script: () => undefined },
    { label: 'chase: steep plunge toward a hull ahead', wind: 'poyraz', u10: 5, speed: 45, pathDeg: -60, seconds: 10, hull: true, script: (u, _s, c) => void (u > 0.3 && u < 3 && (c.pitch = 0.4)) },
    ...(moderate
      ? [{ label: 'chase: shallow site (~9 m), W held to the seabed', wind: 'poyraz' as SeaWind, u10: 7, speed: 45, pathDeg: -40, seconds: 10, at: moderate, script: (u: number, _s: FlightSim, c: PilotCommand) => void (u > 0 && u < 6 && (c.pitch = 1)) }]
      : []),
    ...(moderate
      ? [{ label: 'chase: shallow site, camera orbited below the dragon', wind: 'poyraz' as SeaWind, u10: 7, speed: 45, pathDeg: -40, seconds: 8, at: moderate, orbitDown: true, script: (u: number, _s: FlightSim, c: PilotCommand) => void (u > 0 && u < 5 && (c.pitch = 1)) }]
      : []),
    { label: 'pov: plunge, Space held (strokes)', wind: 'poyraz', u10: 7, speed: 40, pathDeg: -60, seconds: 14, pov: true, script: (u, _s, c) => void (u > 0.5 && (c.flap = true)) },
  ];
  const list = QUICK ? scenarios.filter((_, i) => i === 0 || i === 1 || i === scenarios.length - 1) : scenarios;
  console.log(`  ${'case'.padEnd(52)}${'under s'.padStart(8)}${'dragon'.padStart(8)}${'cam'.padStart(7)}${'seabed'.padStart(8)}${'hull'.padStart(6)}${'jump'.padStart(7)}${'accel'.padStart(7)}${'roll°'.padStart(7)}${'out s'.padStart(7)}${'sw'.padStart(4)}`);
  const results: Array<{ sc: CamScenario; r: CamResult }> = [];
  for (const sc of list) {
    const r = runCamera(sc);
    results.push({ sc, r });
    console.log(
      `  ${sc.label.padEnd(52)}${f2(r.dragonUnder).padStart(8)}${f2(r.maxDepth).padStart(8)}${f2(r.camMaxDepth).padStart(7)}${f2(r.minSeabedClear).padStart(8)}${f2(r.maxHullPen).padStart(6)}${f2(r.maxRelJump).padStart(7)}${f2(r.maxAccelJump).padStart(7)}${deg(r.maxRollUnder).padStart(7)}${f2(r.surfacedAfterExit).padStart(7)}${String(r.switches).padStart(4)}`,
    );
    if (process.argv.includes('--verbose')) console.log(`      ${r.jumpNote}\n      ${r.relNote}`);
  }
  const all = (pred: (r: CamResult, sc: CamScenario) => boolean): boolean => results.every(({ r, sc }) => pred(r, sc));
  check(all((r) => !r.nan), 'no NaN in any camera pose');
  check(all((r) => r.wentUnder && (r.dragonUnder < 2 || r.camMaxDepth > 1.5)), `the camera follows the dragon under water on every dive longer than 2 s (camera depth ${results.map(({ r }) => f2(r.camMaxDepth)).join(' / ')} m)`);
  check(all((r) => r.minSeabedClear >= SEABED_CLEARANCE - 0.1), `the camera never gets closer to the seabed than the clearance (min ${f2(Math.min(...results.map(({ r }) => r.minSeabedClear)))} m)`);
  check(all((r) => r.maxHullPen < 0.05), `the camera never enters a hull box (deepest ${f2(Math.max(...results.map(({ r }) => r.maxHullPen)))} m)`);
  check(all((r) => r.flagMismatch === 0), 'the under flag matches the CPU wave height at the camera (every frame beyond the switching band)');
  check(all((r, sc) => r.maxRelJump < (sc.pov ? 0.5 : 0.8)), `no jumps: per-frame camera motion relative to the dragon ≤ 0.8 m chase / 0.5 m POV (max ${results.map(({ r }) => f2(r.maxRelJump)).join(' / ')})`);
  check(all((r) => r.maxAccelJump < 0.5), `smooth: per-frame change of the camera step ≤ 0.5 m (max ${results.map(({ r }) => f2(r.maxAccelJump)).join(' / ')})`);
  check(all((r, sc) => sc.pov || r.maxRollUnder < (18 * Math.PI) / 180), `chase horizon level-ish under water (roll ≤ 18°, max ${results.filter(({ sc }) => !sc.pov).map(({ r }) => deg(r.maxRollUnder)).join(' / ')}°)`);
  check(all((r) => !r.exited || (r.surfacedAfterExit >= 0 && r.surfacedAfterExit < 3.5)), `after the dragon leaves the water the camera is back above the waves within 3.5 s (${results.map(({ r }) => f2(r.surfacedAfterExit)).join(' / ')} s)`);
  check(all((r) => r.switches <= 4), `the under/above state switched at most twice per crossing (switches ${results.map(({ r }) => r.switches).join(' / ')})`);
}

/* ---------------------------------------------------------------------------------------------- */
console.log('\n2. Under-water state machine: switching, hysteresis, droplets');
{
  const up = new THREE.Vector3(0, 1, 0);
  const S = UNDERWATER_STATE;
  // Descending slowly through the surface (0.5 m/s): switches in the first frame past the enter depth.
  const st = new UnderwaterState();
  let y = 1;
  let switchedAt = NaN;
  for (let i = 0; i < 300; i++) {
    y -= 0.5 * FRAME;
    const wasUnder = st.under;
    st.update(y, 0, up, true, FRAME);
    if (!wasUnder && st.under) {
      switchedAt = -y;
      break;
    }
  }
  check(Math.abs(switchedAt - S.enterDepth) < 0.5 * FRAME + 1e-6, `descending: switches under at ${f2(switchedAt * 100)} cm below the surface (band ${S.enterDepth * 100} cm)`);
  // Hold under, then rise at 1 m/s: switches above just past the exit band and leaves droplets.
  for (let i = 0; i < 60; i++) st.update(-1, 0, up, true, FRAME);
  y = -1;
  let aboveAt = NaN;
  for (let i = 0; i < 300; i++) {
    y += 1 * FRAME;
    const wasUnder = st.under;
    st.update(y, 0, up, true, FRAME);
    if (wasUnder && !st.under) {
      aboveAt = y;
      break;
    }
  }
  check(Math.abs(aboveAt - S.exitDepth) < FRAME + 1e-6, `rising: switches above at ${f2(aboveAt * 100)} cm above the surface (band ${S.exitDepth * 100} cm)`);
  check(st.droplets === 1, 'a breach after a real submersion puts droplets on the lens');
  let dropsGoneAt = NaN;
  for (let i = 0; i < 180; i++) {
    st.update(1, 0, up, true, FRAME);
    if (st.droplets <= 0 && Number.isNaN(dropsGoneAt)) dropsGoneAt = (i + 1) * FRAME;
  }
  check(dropsGoneAt > 0.8 && dropsGoneAt < 1.4, `droplets fade out in ~1 s (${f2(dropsGoneAt)} s)`);
  // A short dip (0.2 s) leaves no droplets.
  const dip = new UnderwaterState();
  for (let i = 0; i < 30; i++) dip.update(1, 0, up, true, FRAME);
  for (let i = 0; i < 12; i++) dip.update(-0.6, 0, up, true, FRAME);
  for (let i = 0; i < 3; i++) dip.update(0.6, 0, up, true, FRAME);
  check(!dip.under && dip.droplets === 0, 'a short dip (0.2 s) switches back without droplets');
  // Bobbing on the waterline: +-3 cm (inside the band) never switches; +-12 cm at 1.5 Hz with 2 cm frame noise never
  // switches faster than the dwell time.
  let seed = 7;
  const noise = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  const calm = new UnderwaterState();
  for (let i = 0; i < 600; i++) calm.update(0.03 * Math.sin(i * FRAME * 2 * Math.PI * 1.5), 0, up, true, FRAME);
  check(calm.switches === 0, `bobbing ±3 cm on the waterline: no switch (${calm.switches})`);
  const bob = new UnderwaterState();
  let last = -1;
  let minGap = Infinity;
  for (let i = 0; i < 1200; i++) {
    const before = bob.switches;
    bob.update(0.12 * Math.sin(i * FRAME * 2 * Math.PI * 1.5) + 0.04 * noise(), 0, up, true, FRAME);
    if (bob.switches !== before) {
      if (last >= 0) minGap = Math.min(minGap, (i - last) * FRAME);
      last = i;
    }
  }
  check(minGap >= S.minDwell - 1e-6, `bobbing ±12 cm with frame noise: ${bob.switches} switches in 20 s, never closer than ${f2(minGap)} s (dwell ${S.minDwell} s)`);
  // A decisive plunge switches even right after a switch (no dwell delay for real crossings).
  const fast = new UnderwaterState();
  fast.update(-0.05, 0, up, true, FRAME);
  fast.update(0.05, 0, up, true, FRAME);
  fast.update(-0.5, 0, up, true, FRAME);
  check(fast.under && fast.switches === 1, 'a decisive crossing switches within the dwell time (no lag on a real plunge)');
  // The smoothed amount for the audio mix follows within ~0.4 s, and nothing is active over land.
  const amt = new UnderwaterState();
  for (let i = 0; i < 24; i++) amt.update(-2, 0, up, true, FRAME);
  check(amt.amount > 0.9, `the audio mix amount reaches ${f2(amt.amount)} within 0.4 s under water`);
  const land = new UnderwaterState();
  land.update(-3, 0, up, false, FRAME);
  check(!land.under && !land.lensActive && land.amount === 0, 'over land a camera below sea level is not under water');
  const nan = new UnderwaterState();
  nan.update(Number.NaN, 0, up, true, FRAME);
  check(!nan.under && Number.isFinite(nan.depth) && Number.isFinite(nan.amount), 'NaN input keeps the state finite and above water');
  // Lens effects stay off when the camera is well above the surface.
  const high = new UnderwaterState();
  high.update(2, 0, up, true, FRAME);
  check(!high.lensActive, `lens effects off above ${S.lensBand} m over the surface`);
}

/* ---------------------------------------------------------------------------------------------- */
console.log('\n3. Shader sanity (structural; no GLSL validator available)');
{
  const { UnderwaterParticles } = await import('../../src/world/water/underwater/particles');
  const { WATER_FRAGMENT_GLSL } = await import('../../src/world/water/shaders/water-fragment.glsl');
  const particles = new UnderwaterParticles('high');
  const pm = particles.points.material as THREE.ShaderMaterial;
  const sources: Array<[string, string]> = [
    ['composite', COMPOSITE_FRAG],
    ['particles.vert', pm.vertexShader],
    ['particles.frag', pm.fragmentShader],
    ['water.frag', WATER_FRAGMENT_GLSL],
  ];
  const balanced = (src: string): boolean => {
    const stack: string[] = [];
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    for (const ch of src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')) {
      if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
      else if (ch in pairs && stack.pop() !== pairs[ch]) return false;
    }
    return stack.length === 0;
  };
  check(sources.every(([, s]) => balanced(s)), `balanced brackets in ${sources.map(([n]) => n).join(', ')}`);
  check(sources.every(([, s]) => !/\btexture2D\s*\(/.test(s)), 'no GLSL 1 texture2D calls');
  const declared = [...COMPOSITE_FRAG.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]);
  const passSrc = readFileSync(new URL('../../src/render/post/composite-pass.ts', import.meta.url), 'utf8');
  const missing = declared.filter((u) => !new RegExp(`\\b${u}:\\s*\\{`).test(passSrc));
  check(missing.length === 0, `every composite uniform is bound by the pass (${declared.length} declared${missing.length ? `, missing ${missing.join(', ')}` : ''})`);
  const pDeclared = [...pm.vertexShader.matchAll(/uniform\s+\w+\s+(u\w+)/g), ...pm.fragmentShader.matchAll(/uniform\s+\w+\s+(u\w+)/g)].map((m) => m[1]);
  const globals = ['uTime', 'uTimeOfDay', 'uSunDir', 'uSunColor', 'uMoonDir', 'uAmbient', 'uNight', 'uWind', 'uCamPos', 'uCamNear', 'uCamFar', 'uResolution', 'uFogDensity', 'uFogHeightFalloff', 'uFogColor'];
  const pMissing = pDeclared.filter((u) => !globals.includes(u) && !(u in pm.uniforms));
  check(pMissing.length === 0, `every particle uniform is bound (missing: ${pMissing.join(', ') || 'none'})`);
  check(/uniform float uCamUnder;/.test(WATER_FRAGMENT_GLSL), 'the water surface declares uCamUnder for its underside');
  particles.dispose();
}

console.log(failures.length ? `\n${failures.length} check(s) FAILED:\n  - ${failures.join('\n  - ')}` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
