/**
 * Phase 21 stage 2 check, headless (no browser, no GPU): the sea reacting to low flight.
 *
 *   npx tsx tools/headless/lowflight-check.ts
 *
 * The real FlightSim over the real geography and the real sea (water service: poyraz waves), stepped at the physics
 * rate; each render frame the low-flight model (the `lowFlight` service) reads the sim like the game's DragonState and
 * writes stamps into a real disturbance window (whose GPU consumption is mimicked), and the real fx emitters run
 * against counting particle pools.
 *
 * 1. Scripted passes: hover low over the sea, a slow low pass, a fast skim (then a pull-up), fire aimed at the water;
 *    and the zero cases: hovering / fast / firing high over the sea, low over land, fire over land. Asserts which
 *    effects switch on, their ranges, the emitters' activation (downwash spray, edge spray, vortex curls, sea steam),
 *    no NaNs and no activity (values, stamps, spawns) when high or over land.
 * 2. Disturbance window bookkeeping: whole-texel scrolling, clears, stamp culling and the queue limit, the fixed-step
 *    clock at 24 / 60 / 144 fps, lifetime, quality off, NaN inputs.
 * 3. Shaders: structural sanity of the GLSL added (balanced brackets, GLSL 3 calls only, no reserved words, every
 *    uniform bound, the water material carries the field's uniforms).
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { DragonState, FlightMode, LowFlightView } from '../../src/core/contracts';
import { headingToYaw, latLonToLocal } from '../../src/core/geo-coords';
import { DEG, PHYSICS_DT } from '../../src/dragon/flight/params';
import type { FlightSim } from '../../src/dragon/flight/sim';
import { clearPilotEdges, createPilotCommand, type PilotCommand } from '../../src/dragon/flight/types';
import { FireEmitter, type FireLightState } from '../../src/fx/emitters/fire-emitter';
import { SurfaceEmitter } from '../../src/fx/emitters/surface-emitter';
import type { EmitContext } from '../../src/fx/emitters/emit-context';
import type { ParticlePool, SpawnSpec } from '../../src/fx/particles/particle-pool';
import { SharpType, VolType } from '../../src/fx/particles/types';
import { DISTURBANCE_SIM, LOW_FLIGHT, disturbanceQualityFor } from '../../src/world/water/lowflight/config';
import { DisturbanceWindow } from '../../src/world/water/lowflight/disturbance-window';
import { LowFlightModel, createLowFlightInput, fallbackAnchors, type LowFlightInput, type LowFlightWorld } from '../../src/world/water/lowflight/low-flight';
import { DISTURBANCE_SIM_FRAG, DISTURBANCE_WATER_SAMPLE_GLSL, DISTURBANCE_WATER_UNIFORMS_GLSL } from '../../src/world/water/lowflight/shaders.glsl';
import { buildHeadlessGeo } from './geo';
import { createHeadlessSim, LiftEnv } from './lift-sim';
import { createHeadlessSea } from './water-sea';

const failures: string[] = [];
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : String(v));

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
const SPAN = 24;
const LENGTH = 18.3;
const HEIGHT = 4.4;
console.log(`geo + sea ready in ${Date.now() - t0} ms (poyraz sea, U10 7 m/s)`);

const kadikoy = latLonToLocal(40.97, 29.0);
const sea = { x: kadikoy.x, z: kadikoy.z };
// Inland: the Topkapı plateau west of the old city walls (well away from any water).
const inland = latLonToLocal(41.02, 28.9);
check(geo.isWater(sea.x, sea.z) && geo.heightAt(sea.x, sea.z) < -20, `test site over deep water (seabed ${f2(geo.heightAt(sea.x, sea.z))} m)`);
check(!geo.isWater(inland.x, inland.z) && geo.heightAt(inland.x, inland.z) > 5, `land site inland (terrain ${f2(geo.heightAt(inland.x, inland.z))} m)`);

const world: LowFlightWorld = { water: waves, isWater: (x, z) => geo.isWater(x, z) };

/* ---------------------------------------------------------------------------------------------- */
/* Counting fx pools                                                                               */
/* ---------------------------------------------------------------------------------------------- */

interface Counts {
  vol: number[];
  sharp: number[];
  badSpawn: number;
}

function countingPool(counts: number[], bad: { n: number }): ParticlePool {
  return {
    load: 0,
    spawn(spec: SpawnSpec) {
      counts[spec.type] = (counts[spec.type] ?? 0) + 1;
      const values = [spec.px, spec.py, spec.pz, spec.vx, spec.vy, spec.vz, spec.birth, spec.life, spec.size0, spec.size1, spec.planeD];
      if (!values.every(Number.isFinite)) {
        bad.n++;
      }
    },
  } as unknown as ParticlePool;
}

/* ---------------------------------------------------------------------------------------------- */
/* One scripted pass                                                                               */
/* ---------------------------------------------------------------------------------------------- */

interface PassOptions {
  name: string;
  x: number;
  z: number;
  headingDeg: number;
  speed: number;
  /** Start height of the body centre above the local water (or the terrain over land). */
  height: number;
  pathDeg?: number;
  seconds: number;
  script?: (t: number, sim: FlightSim, cmd: PilotCommand) => void;
  /** Aim the fire this many degrees below the body's forward direction (the neck / look aims it in game). */
  fireAimDeg?: number;
  window?: DisturbanceWindow;
}

interface Frame {
  t: number;
  mode: FlightMode;
  height: number;
  airspeed: number;
  downwash: number;
  pulse: number;
  edge: number;
  wake: number;
  vortex: number;
  steam: number;
  active: boolean;
  stamps: number;
  touching: boolean;
  steamHit: boolean;
  steamErr: number;
  centreErr: number;
}

interface PassResult {
  name: string;
  frames: Frame[];
  nan: boolean;
  outOfRange: string[];
  gusts: number;
  flaps: number;
  counts: Counts;
  window: DisturbanceWindow;
  model: LowFlightModel;
  modes: Set<FlightMode>;
}

function stateOf(sim: FlightSim, touching: boolean): DragonState {
  return {
    object: new THREE.Object3D(),
    position: sim.body.position,
    quaternion: sim.body.quaternion,
    velocity: sim.body.velocity,
    angularVelocity: sim.body.angularVelocity,
    mode: sim.mode,
    airspeed: sim.airspeed,
    altitude: sim.body.position.y,
    agl: Math.max(0, sim.agl - sim.standHeight),
    headingDeg: 0,
    gForce: 1,
    stamina: sim.stamina,
    flapEffort: sim.beat.effort,
    firing: sim.firing,
    touchingWater: touching,
  };
}

function inRange01(v: number): boolean {
  return Number.isFinite(v) && v >= 0 && v <= 1;
}

function runPass(o: PassOptions): PassResult {
  const sim = createHeadlessSim(geo, env);
  sim.options.turbulence = false;
  sim.options.thermals = false;
  sim.world.water = waves;
  let time = 1000;
  hs.advance(time, 0, o.x, o.z);
  const overWater = geo.isWater(o.x, o.z);
  const base = overWater ? waves.heightAt(o.x, o.z) : geo.heightAt(o.x, o.z);
  const yaw = headingToYaw(o.headingDeg);
  const path = (o.pathDeg ?? 0) * DEG;
  sim.teleport(o.x, base + o.height, o.z, yaw, path, o.speed);
  const model = new LowFlightModel();
  const window = o.window ?? new DisturbanceWindow(disturbanceQualityFor('high'));
  const input: LowFlightInput = createLowFlightInput();
  input.wingspan = SPAN;
  input.length = LENGTH;
  input.height = HEIGHT;
  const counts: Counts = { vol: [], sharp: [], badSpawn: 0 };
  const bad = { n: 0 };
  const emit: EmitContext = {
    now: 0,
    dt: FRAME,
    wind: new THREE.Vector3(),
    budgetScale: 1,
    vol: countingPool(counts.vol, bad),
    sharp: countingPool(counts.sharp, bad),
    geo,
    collision: sim.world.collision ?? undefined,
    rng: (() => {
      let s = 12345;
      return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    })(),
  };
  const surface = new SurfaceEmitter();
  const fire = new FireEmitter();
  const lights: FireLightState = { pos: [new THREE.Vector3(), new THREE.Vector3()], color: [new THREE.Color(), new THREE.Color()] };
  const r: PassResult = { name: o.name, frames: [], nan: false, outOfRange: [], gusts: 0, flaps: 0, counts, window, model, modes: new Set() };
  const cmd = createPilotCommand();
  const frames = Math.round(o.seconds / FRAME);
  let t = 0;
  const centre = { x: 0, z: 0 };
  for (let f = 0; f < frames; f++) {
    const p = sim.body.position;
    hs.advance(time, FRAME, p.x, p.z);
    let splash = false;
    let touched = false;
    for (let s = 0; s < SUBSTEPS; s++) {
      cmd.pitch = 0;
      cmd.roll = 0;
      cmd.yaw = 0;
      cmd.flap = false;
      cmd.dive = false;
      cmd.brake = false;
      cmd.fire = false;
      clearPilotEdges(cmd);
      o.script?.(t, sim, cmd);
      sim.step(PHYSICS_DT, cmd);
      time += PHYSICS_DT;
      t += PHYSICS_DT;
      for (const e of sim.events) {
        if (e.type === 'flap') {
          r.flaps++;
          model.onFlap(e.strength);
          surface.onFlap(e.strength);
        } else if (e.type === 'splash') {
          splash = true;
        }
      }
      sim.events.length = 0;
      touched ||= sim.touchingWater && sim.airborne;
      if (!sim.body.isFinite()) {
        r.nan = true;
      }
    }
    r.modes.add(sim.mode);
    const touching = splash || (touched && sim.airspeed > 4);
    // The game's DragonState + rig anchors (fallback geometry: wings level; the fire aimed down by the neck).
    input.position.copy(sim.body.position);
    input.velocity.copy(sim.body.velocity);
    input.quaternion.copy(sim.body.quaternion);
    input.mode = sim.mode;
    input.airspeed = sim.airspeed;
    input.flapEffort = sim.beat.effort;
    input.firing = sim.firing;
    input.touchingWater = touching;
    fallbackAnchors(input);
    if (o.fireAimDeg) {
      const d = input.mouthDir;
      const h = Math.hypot(d.x, d.z) || 1;
      const a = o.fireAimDeg * DEG;
      input.mouthDir.set((d.x / h) * Math.cos(a), -Math.sin(a), (d.z / h) * Math.cos(a));
    }
    LowFlightModel.windowCentre(input.position, input.velocity, window.extent, centre);
    window.beginFrame(t, FRAME, centre.x, centre.z);
    model.update(FRAME, input, world, window);
    // Where the window sits vs where it was asked to (whole-texel snapping: at most one texel off per axis).
    const cx = window.minX + window.extent / 2;
    const cz = window.minZ + window.extent / 2;
    const centreErr = Math.max(Math.abs(cx - centre.x), Math.abs(cz - centre.z));
    const stamps = window.count;
    // Stamps must be finite and inside (or touching) the window.
    for (let k = 0; k < window.count; k++) {
      const st = window.stamps[k];
      const vals = [st.x0, st.z0, st.x1, st.z1, st.radius, st.ring, st.height, st.rough, st.foam, st.noise];
      if (!vals.every(Number.isFinite)) r.nan = true;
    }
    window.consumed();
    // fx emitters, fed exactly like FxSystem.update.
    emit.now = t;
    const dragon = stateOf(sim, touching);
    fire.update(emit, dragon, undefined, lights, model);
    surface.update(emit, dragon, undefined, model);

    const view: LowFlightView = model;
    const values: Array<[string, number]> = [
      ['downwash', view.downwash],
      ['downwashPulse', view.downwashPulse],
      ['edgeSpray', view.edgeSpray],
      ['wake', view.wake],
      ['vortex', view.vortex],
      ['tipVortex0', view.tipVortex[0]],
      ['tipVortex1', view.tipVortex[1]],
      ['steam', view.steam],
    ];
    for (const [k, v] of values) {
      if (!inRange01(v) && r.outOfRange.length < 6) r.outOfRange.push(`${k}=${v} at ${f2(t)} s`);
    }
    if (!(Number.isFinite(view.height) || view.height === Infinity) || !Number.isFinite(view.surfacePoint.y + view.steamPoint.x + view.heading.x)) {
      r.nan = true;
    }
    const steamErr = model.steamHit ? Math.abs(view.steamPoint.y - waves.heightAt(view.steamPoint.x, view.steamPoint.z)) : 0;
    r.frames.push({
      t,
      mode: sim.mode,
      height: view.height,
      airspeed: sim.airspeed,
      downwash: view.downwash,
      pulse: view.downwashPulse,
      edge: view.edgeSpray,
      wake: view.wake,
      vortex: view.vortex,
      steam: view.steam,
      active: view.active,
      stamps,
      touching,
      steamHit: model.steamHit,
      steamErr,
      centreErr,
    });
  }
  counts.badSpawn = bad.n;
  r.gusts = model.gustsSpawned;
  return r;
}

const after = (r: PassResult, from: number, to = Infinity): Frame[] => r.frames.filter((f) => f.t >= from && f.t <= to);
const max = (fs: Frame[], k: keyof Frame): number => fs.reduce((m, f) => Math.max(m, f[k] as number), 0);
const mean = (fs: Frame[], k: keyof Frame): number => (fs.length ? fs.reduce((m, f) => m + (f[k] as number), 0) / fs.length : 0);
const vol = (r: PassResult, type: number): number => r.counts.vol[type] ?? 0;
const sharp = (r: PassResult, type: number): number => r.counts.sharp[type] ?? 0;
const totalSpawns = (r: PassResult): number => [...r.counts.vol, ...r.counts.sharp].reduce((a, b) => a + (b ?? 0), 0);

function sane(r: PassResult): void {
  check(!r.nan && r.counts.badSpawn === 0, `${r.name}: no NaN (sim, model outputs, stamps, particle spawns)`);
  check(r.outOfRange.length === 0, `${r.name}: every intensity in [0, 1]${r.outOfRange.length ? ` (${r.outOfRange.join(', ')})` : ''}`);
  const worstCentre = max(r.frames, 'centreErr');
  check(worstCentre <= r.window.texel * 1.01, `${r.name}: the window follows its centre within one texel (worst ${f2(worstCentre)} m, texel ${r.window.texel} m)`);
}

function quiet(r: PassResult, label: string): void {
  const anyActive = r.frames.some((f) => f.active);
  const anyStamp = r.frames.some((f) => f.stamps > 0);
  const values = ['downwash', 'pulse', 'edge', 'wake', 'vortex', 'steam'] as const;
  const peak = Math.max(...values.map((k) => max(r.frames, k)));
  check(!anyActive && peak === 0, `${r.name}: nothing active ${label} (peak value ${f2(peak)})`);
  check(!anyStamp && !r.window.alive, `${r.name}: no stamps, the disturbance field stays off`);
  const seaSpawns = vol(r, VolType.Mist) + vol(r, VolType.Spray) + vol(r, VolType.Steam) + vol(r, VolType.Ring) + vol(r, VolType.Foam) + sharp(r, SharpType.Droplet);
  check(seaSpawns === 0, `${r.name}: no sea particles (mist, spray, droplets, rings, foam, steam: ${seaSpawns})`);
}

/* ---------------------------------------------------------------------------------------------- */
console.log('\n1. Scripted passes over the real sea');

const hoverScript = (t: number, _sim: FlightSim, cmd: PilotCommand): void => {
  cmd.brake = t < 6;
};

// Hover low over the sea: brake from 12 m/s at 9 m.
{
  const r = runPass({ name: 'hover low (9 m)', ...sea, headingDeg: 180, speed: 12, height: 9, seconds: 7, script: hoverScript });
  const late = after(r, 2.5, 6);
  const hovered = late.filter((f) => f.mode === 'hovering').length / Math.max(1, late.length);
  console.log(`  modes ${[...r.modes].join(', ')}; height ${f2(mean(late, 'height'))} m; downwash mean ${f2(mean(late, 'downwash'))} max ${f2(max(late, 'downwash'))}; pulse max ${f2(max(late, 'pulse'))}; edge max ${f2(max(late, 'edge'))}; flaps ${r.flaps}, gust rings ${r.gusts}`);
  console.log(`  spawns: mist ${vol(r, VolType.Mist)}, spray ${vol(r, VolType.Spray)}, drops ${sharp(r, SharpType.Droplet)}, rings ${vol(r, VolType.Ring)}, foam ${vol(r, VolType.Foam)}; stamps/frame ${f2(mean(late, 'stamps'))}`);
  sane(r);
  check(hovered > 0.8, `hovers over the water (${(hovered * 100).toFixed(0)} % of 2.5–6 s in 'hovering')`);
  check(mean(late, 'downwash') > 0.35, `strong downwash under a low hover (mean ${f2(mean(late, 'downwash'))} > 0.35)`);
  check(r.gusts >= 5 && max(late, 'pulse') > 0.3, `each downstroke pushes a gust ring (${r.gusts} rings, pulse peak ${f2(max(late, 'pulse'))})`);
  check(max(late, 'edge') > 0.2, `a strong low hover whips up spray at the ring's edge (peak ${f2(max(late, 'edge'))})`);
  check(max(late, 'wake') === 0 && max(late, 'vortex') === 0 && max(late, 'steam') === 0, 'no wake, vortex curls or steam while hovering');
  check(mean(late, 'stamps') >= 2 && r.window.alive, `the field gets stamps every frame (${f2(mean(late, 'stamps'))} per frame) and is alive`);
  check(vol(r, VolType.Mist) > 50 && sharp(r, SharpType.Droplet) > 200 && vol(r, VolType.Spray) > 20, 'downwash mist, droplets and edge spray sheets are emitted');
  // After the brake is released the dragon flies off; with the wake of the hover still in the field.
  const tail = after(r, 6.8);
  check(tail.every((f) => f.downwash < max(late, 'downwash')), 'downwash drops as the dragon leaves the hover');
}

// Hover high over the sea: 60 m.
{
  const r = runPass({ name: 'hover high (60 m)', ...sea, headingDeg: 180, speed: 12, height: 60, seconds: 5, script: hoverScript });
  sane(r);
  quiet(r, 'hovering 60 m over the sea');
}

// A slow low pass: 15 m/s at 8 m (the first 1.5 s: the flight assist then climbs out of the ground effect).
{
  const r = runPass({
    name: 'slow low pass',
    ...sea,
    headingDeg: 90,
    speed: 15,
    height: 8,
    seconds: 2,
    script: (_t, sim) => {
      sim.overrides.pathTarget = 0;
      sim.overrides.airspeedTarget = 14;
    },
  });
  const late = after(r, 0.3, 1.5);
  console.log(`  modes ${[...r.modes].join(', ')}; height ${f2(mean(late, 'height'))} m, airspeed ${f2(mean(late, 'airspeed'))}; downwash mean ${f2(mean(late, 'downwash'))}; wake ${f2(max(late, 'wake'))}; vortex ${f2(max(late, 'vortex'))}`);
  sane(r);
  check(mean(late, 'downwash') > 0.15 && mean(late, 'downwash') < 0.85, `a slow low pass ruffles the water, less than a hover (downwash mean ${f2(mean(late, 'downwash'))})`);
  check(max(late, 'wake') === 0 && max(late, 'edge') < 0.3, 'no skim wake 8 m up, little edge spray in forward flight');
  check(late.every((f) => f.stamps > 0), 'the downwash patch is stamped every frame');
}

// Fast skim: 32 m/s from 2.3 m (ground effect, then the belly and feet touch the waves); at 5.5 s the dragon is
// taken 80 m up (a real skim bleeds speed into the water, the pull-up itself is the flight model's business).
let skim: PassResult;
{
  const r = runPass({
    name: 'fast skim',
    ...sea,
    headingDeg: 45,
    speed: 32,
    height: 2.3,
    seconds: 10,
    script: (t, sim) => {
      if (t < 5.5) {
        sim.overrides.pathTarget = t < 1.5 ? -0.3 * DEG : 0;
        sim.overrides.airspeedTarget = 30;
      } else if (t < 5.5 + PHYSICS_DT * 1.5) {
        const p = sim.body.position;
        sim.teleport(p.x, p.y + 80, p.z, headingToYaw(45), 0, 34);
      } else {
        sim.overrides.pathTarget = 0;
        sim.overrides.airspeedTarget = 34;
      }
    },
  });
  skim = r;
  const low = after(r, 0.2, 5.4);
  const fast = low.filter((f) => f.airspeed > 24);
  const skimming = low.filter((f) => f.touching && f.airspeed > 20);
  const up = after(r, 7.5);
  console.log(`  modes ${[...r.modes].join(', ')}; low part: height ${f2(mean(low, 'height'))} m, contact frames ${skimming.length}/${low.length}; wake mean (contact) ${f2(mean(skimming, 'wake'))}; vortex mean (fast) ${f2(mean(fast, 'vortex'))}; downwash max (fast) ${f2(max(fast, 'downwash'))}`);
  console.log(`  80 m up (7.5 s+): wake max ${f2(max(up, 'wake'))}, vortex max ${f2(max(up, 'vortex'))}; spawns: drops ${sharp(r, SharpType.Droplet)}, spray ${vol(r, VolType.Spray)}, mist ${vol(r, VolType.Mist)}, foam ${vol(r, VolType.Foam)}`);
  sane(r);
  check(!r.modes.has('swimming') && !r.modes.has('underwater'), 'the skim stays a skim (no swimming, no plunge)');
  check(skimming.length > 30, `the flight model skims the waves (${skimming.length} contact frames above 20 m/s)`);
  check(mean(skimming, 'wake') > 0.7, `skimming leaves a strong wake (mean ${f2(mean(skimming, 'wake'))} > 0.7)`);
  check(mean(fast, 'vortex') > 0.3, `wingtip vortex curls in the fast low pass (mean ${f2(mean(fast, 'vortex'))})`);
  check(max(fast, 'downwash') === 0, `no downwash patch above 24 m/s (max ${f2(max(fast, 'downwash'))})`);
  check(sharp(r, SharpType.Droplet) > 500 && vol(r, VolType.Spray) > 100 && vol(r, VolType.Mist) > 50, 'skim sprays, wingtip curls (mist) and droplets are emitted');
  check(up.length > 0 && max(up, 'wake') === 0 && max(up, 'vortex') === 0 && up.every((f) => !f.active && f.stamps === 0), 'wake and vortex curls are gone 80 m up (no stamps)');
  const leave = r.frames.find((f) => f.t > 5.5);
  const fade = r.frames.find((f) => f.t > 5.5 && f.wake < 0.05);
  check(!!leave && leave.wake > 0.3 && !!fade && fade.t - 5.5 > 0.3 && fade.t - 5.5 < 3, `the wake value fades over a moment instead of cutting off (${fade ? f2(fade.t - 5.5) : '?'} s)`);
  check(r.window.alive, 'the field is still alive after leaving (the drawn wake fades for seconds)');
}

// The field dies DISTURBANCE_SIM.lifetime after the last stamp: fly on high for longer.
{
  const w = new DisturbanceWindow(disturbanceQualityFor('high'));
  const r1 = runPass({ name: 'skim then climb', ...sea, headingDeg: 45, speed: 32, height: 2.3, seconds: 4, window: w, script: (t, sim) => {
    sim.overrides.pathTarget = t < 1.5 ? -0.3 * DEG : 0;
    sim.overrides.airspeedTarget = 30;
  } });
  const lastStampT = [...r1.frames].reverse().find((f) => f.stamps > 0)?.t ?? -1;
  check(lastStampT > 3.5, 'the skim keeps stamping until the end of the run');
  // Keep the window clock running without stamps (dragon gone high).
  let deadAt = -1;
  for (let i = 1; i <= 60 * 10; i++) {
    const t = 4 + i / 60;
    w.beginFrame(t, 1 / 60, 0 + i, 0);
    if (!w.alive && deadAt < 0) deadAt = t;
    w.consumed();
  }
  check(deadAt > 0 && Math.abs(deadAt - lastStampT - DISTURBANCE_SIM.lifetime) < 0.1, `the field switches off ${DISTURBANCE_SIM.lifetime} s after the last stamp (${f2(deadAt - lastStampT)} s)`);
}

// Fast pass high over the sea: 80 m, 35 m/s.
{
  const r = runPass({ name: 'fast high pass (80 m)', ...sea, headingDeg: 45, speed: 35, height: 80, seconds: 4, script: (_t, sim) => {
    sim.overrides.pathTarget = 0;
    sim.overrides.airspeedTarget = 35;
  } });
  sane(r);
  quiet(r, '80 m over the sea');
}

// Over land, low: hover at 9 m and a fast pass at 6 m.
{
  const r = runPass({ name: 'hover over land (9 m)', x: inland.x, z: inland.z, headingDeg: 180, speed: 12, height: 9, seconds: 3, script: hoverScript });
  sane(r);
  quiet(r, 'hovering low over land');
  const r2 = runPass({ name: 'fast low pass over land (6 m)', x: inland.x, z: inland.z, headingDeg: 90, speed: 30, height: 6, seconds: 2, script: (_t, sim) => {
    sim.overrides.pathTarget = 0;
    sim.overrides.airspeedTarget = 30;
  } });
  sane(r2);
  quiet(r2, 'fast and low over land');
}

// Fire at the water: hovering 12 m up, aiming 35° down (the jet meets the sea ~21 m ahead).
{
  const fireScript = (t: number, sim: FlightSim, cmd: PilotCommand): void => {
    cmd.brake = true;
    cmd.fire = t > 1.5 && t < 4;
    void sim;
  };
  const r = runPass({ name: 'fire at the water', ...sea, headingDeg: 180, speed: 10, height: 12, seconds: 6, fireAimDeg: 35, script: fireScript });
  const firing = after(r, 2.2, 4);
  const afterFire = after(r, 5.8);
  console.log(`  steam mean ${f2(mean(firing, 'steam'))} (hits ${firing.filter((f) => f.steamHit).length}/${firing.length}), worst steam point vs wave height ${f2(max(firing, 'steamErr'))} m; steam spawns ${vol(r, VolType.Steam)}; after: ${f2(max(afterFire, 'steam'))}`);
  sane(r);
  check(mean(firing, 'steam') > 0.7 && firing.every((f) => f.steamHit), `fire aimed at the water boils it (steam mean ${f2(mean(firing, 'steam'))})`);
  check(max(firing, 'steamErr') < 0.05, `the steam sits on the wave surface (worst ${f2(max(firing, 'steamErr'))} m off)`);
  check(vol(r, VolType.Steam) > 150, `steam puffs are emitted (${vol(r, VolType.Steam)})`);
  check(max(afterFire, 'steam') < 0.06, `the steam dies down within ~2 s after the breath stops (${f2(max(afterFire, 'steam'))})`);
  const rHigh = runPass({ name: 'fire high over the sea (60 m)', ...sea, headingDeg: 180, speed: 10, height: 60, seconds: 4, fireAimDeg: 35, script: fireScript });
  sane(rHigh);
  check(max(rHigh.frames, 'steam') === 0 && vol(rHigh, VolType.Steam) === 0, 'fire 60 m up never reaches the sea: no steam');
  const rLand = runPass({ name: 'fire over land', x: inland.x, z: inland.z, headingDeg: 180, speed: 10, height: 12, seconds: 4, fireAimDeg: 35, script: fireScript });
  check(max(rLand.frames, 'steam') === 0, 'fire aimed at the ground over land: no sea steam');
}

// Stage 1 skim contact vs the model's wake: the skim pass above reported touching frames through the same mapping.
check(skim.frames.some((f) => f.touching), 'the flight model reports water contact in the skim (touchingWater mapping)');

/* ---------------------------------------------------------------------------------------------- */
console.log('\n2. Disturbance window bookkeeping');
{
  const q = disturbanceQualityFor('high');
  const w = new DisturbanceWindow(q);
  check(w.enabled && w.size === q.size && Math.abs(w.extent - q.size * q.texel) < 1e-9, `high: ${q.size}² texels of ${q.texel} m (${f2(w.extent)} m)`);
  w.beginFrame(0, 1 / 60, 1000.3, -500.2);
  check(w.needsClear && w.shiftX === 0 && w.shiftZ === 0, 'first placement asks for a clear and has no scroll');
  const half = w.extent / 2;
  check(Math.abs(w.minX + half - 1000.3) <= w.texel && Math.abs(w.minZ + half + 500.2) <= w.texel, 'window centred on the requested point (within a texel)');
  check(Number.isInteger(w.originX) && Number.isInteger(w.originZ), 'window origin on the texel lattice');
  check(w.stamp(1000, -500, 1000, -500, 3, 0, -0.1, 0.5, 0, 0), 'a stamp inside the window is queued');
  w.consumed();
  check(!w.needsClear && w.alive, 'consumed: no clear pending, field alive');
  // Move 5.3 texels east and 2 texels north.
  w.beginFrame(1 / 60, 1 / 60, 1000.3 + 5.3 * q.texel, -500.2 - 2 * q.texel);
  check(w.shiftX === 5 || w.shiftX === 6, `moving 5.3 texels scrolls 5–6 whole texels (${w.shiftX})`);
  check(w.shiftZ === -2 || w.shiftZ === -3, `moving -2 texels scrolls -2..-3 (${w.shiftZ})`);
  check(!w.needsClear, 'a small move keeps the field (scroll, no clear)');
  const oldOrigin = w.originX;
  w.beginFrame(2 / 60, 1 / 60, 1000.3 + 5.3 * q.texel + q.texel * 0.2, -500.2 - 2 * q.texel);
  check(w.shiftX - (w.originX - oldOrigin) === (w.shiftX - (w.originX - oldOrigin)) && w.shiftX >= 5, 'scrolls accumulate until a pass consumes them');
  w.consumed();
  check(w.shiftX === 0 && w.shiftZ === 0, 'consumed: scroll reset');
  // Teleport: jump further than the window.
  w.beginFrame(3 / 60, 1 / 60, 1000 + w.extent * 2, -500);
  check(w.needsClear && w.shiftX === 0, 'a jump longer than the window clears the field instead of scrolling');
  w.consumed();
  // Culling and the queue limit.
  const cx = w.minX + half;
  const cz = w.minZ + half;
  check(!w.stamp(cx + w.extent, cz, cx + w.extent, cz, 2, 0, 0, 1, 0, 0), 'a stamp outside the window is dropped');
  check(!w.stamp(cx, cz, cx, cz, 2, 0, 0, 0, 0, 0), 'an empty stamp is dropped');
  check(!w.stamp(Number.NaN, cz, cx, cz, 2, 0, 0, 1, 0, 0), 'a NaN stamp is dropped');
  let queued = 0;
  for (let i = 0; i < DISTURBANCE_SIM.maxStamps + 5; i++) {
    if (w.stamp(cx, cz, cx + i, cz, 2, 0, 0, 1, 0, 0)) queued++;
  }
  check(queued === DISTURBANCE_SIM.maxStamps && w.count === DISTURBANCE_SIM.maxStamps, `at most ${DISTURBANCE_SIM.maxStamps} stamps a frame (queued ${queued})`);
  w.consumed();
  // Fixed-step clock.
  for (const fps of [24, 60, 144]) {
    const c = new DisturbanceWindow(q);
    let steps = 0;
    let applyOnly = 0;
    for (let i = 0; i < fps * 3; i++) {
      c.beginFrame(i / fps, 1 / fps, 0, 0);
      c.stamp(0, 0, 0, 0, 2, 0, 0, 0.1, 0, 0);
      steps += c.steps;
      if (c.steps === 0 && c.needsPass) applyOnly++;
      c.consumed();
    }
    const rate = steps / 3;
    const expectApply = fps > 60 ? fps * 3 - steps : 0;
    check(Math.abs(rate - 60) <= 1.5 && Math.abs(applyOnly - expectApply) <= 2, `${fps} fps: ${f2(rate)} simulation steps per second (fixed 60 Hz); ${applyOnly} apply-only passes keep every frame's stamps`);
  }
  const slow = new DisturbanceWindow(q);
  slow.beginFrame(0, 1 / 60, 0, 0);
  slow.beginFrame(1, 1, 0, 0);
  check(slow.steps <= DISTURBANCE_SIM.maxSteps, `a long frame runs at most ${DISTURBANCE_SIM.maxSteps} steps (${slow.steps})`);
  // Quality off.
  const off = new DisturbanceWindow(disturbanceQualityFor('low'));
  off.beginFrame(0, 1 / 60, 0, 0);
  check(!off.enabled && !off.stamp(0, 0, 0, 0, 2, 0, 0, 1, 0, 0) && !off.alive && off.steps === 0, '"low": no field, stamps refused, nothing simulated');
  const m = new LowFlightModel();
  const input = createLowFlightInput();
  input.position.set(sea.x, 5, sea.z);
  input.mode = 'hovering';
  input.airspeed = 3;
  input.flapEffort = 1;
  fallbackAnchors(input);
  m.update(FRAME, input, world, off);
  check(m.downwash > 0.3 && m.stampsQueued === 0, `"low": the model still drives sprays and sound (downwash ${f2(m.downwash)}) without stamps`);
  // Re-activation after the field died asks for a clear.
  const re = new DisturbanceWindow(q);
  re.beginFrame(0, FRAME, 0, 0);
  re.stamp(0, 0, 0, 0, 2, 0, 0, 1, 0, 0);
  re.consumed();
  re.beginFrame(DISTURBANCE_SIM.lifetime + 1, FRAME, 0, 0);
  const deadClear = !re.alive && re.needsClear;
  re.stamp(0, 0, 0, 0, 2, 0, 0, 1, 0, 0);
  check(deadClear && re.alive && re.needsClear && re.needsPass, 'a field that died is cleared before it is used again');
  // NaN input to the model.
  const nan = createLowFlightInput();
  nan.position.set(Number.NaN, 5, sea.z);
  nan.mode = 'hovering';
  const nw = new DisturbanceWindow(q);
  nw.beginFrame(0, FRAME, Number.NaN, 0);
  m.update(FRAME, nan, world, nw);
  check(!m.active && m.downwash === 0 && nw.count === 0 && nw.steps === 0, 'a NaN dragon position turns everything off (no stamps, no steps)');
  m.update(FRAME, null, world, nw);
  check(!m.active && m.height === Infinity, 'no dragon: everything off');
  // Gust ring kinematics.
  const r0 = LowFlightModel.gustRadius(0, SPAN);
  const r1 = LowFlightModel.gustRadius(LOW_FLIGHT.gustLife, SPAN);
  check(Math.abs(r0 - LOW_FLIGHT.gustRadius * SPAN) < 1e-9 && r1 > r0 + 5 && r1 < SPAN * 1.5, `gust rings spread from ${f2(r0)} m to ${f2(r1)} m over their life`);
}

/* ---------------------------------------------------------------------------------------------- */
console.log('\n3. Shader sanity (structural)');
{
  const { WATER_FRAGMENT_GLSL } = await import('../../src/world/water/shaders/water-fragment.glsl');
  const { createWaterUniforms } = await import('../../src/world/water/material');
  const strip = (src: string): string => src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const balanced = (src: string): boolean => {
    const stack: string[] = [];
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    for (const ch of strip(src)) {
      if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
      else if (ch in pairs && stack.pop() !== pairs[ch]) return false;
    }
    return stack.length === 0;
  };
  const sources: Array<[string, string]> = [
    ['disturbance sim', DISTURBANCE_SIM_FRAG],
    ['water fragment', WATER_FRAGMENT_GLSL],
    ['water sample snippet', `void f(vec2 xo) {${DISTURBANCE_WATER_SAMPLE_GLSL}}`],
  ];
  check(sources.every(([, s]) => balanced(s)), `balanced brackets (${sources.map(([n]) => n).join(', ')})`);
  check(sources.every(([, s]) => !/\btexture2D\s*\(|\btexture2DLod\s*\(/.test(s)), 'no GLSL 1 texture calls');
  const reserved = ['half', 'input', 'output', 'filter', 'sample', 'common', 'partition', 'active', 'superp', 'fixed', 'unsigned', 'namespace', 'sizeof', 'cast', 'using', 'public', 'static', 'extern', 'external', 'interface', 'long', 'short', 'double', 'goto', 'inline', 'noinline', 'volatile', 'template', 'this', 'packed', 'union', 'enum', 'typedef', 'class', 'hvec2', 'fvec2', 'dvec2'];
  const idents = (src: string): Set<string> => new Set(strip(src).replace(/#include\s*<[^>]*>/g, '').match(/\b[A-Za-z_]\w*\b/g) ?? []);
  const simIdents = idents(DISTURBANCE_SIM_FRAG);
  const snippetIdents = idents(DISTURBANCE_WATER_SAMPLE_GLSL + DISTURBANCE_WATER_UNIFORMS_GLSL);
  const bad = reserved.filter((w) => simIdents.has(w) || snippetIdents.has(w));
  check(bad.length === 0, `no GLSL ES reserved words in the new GLSL (${bad.join(', ') || 'none'})`);
  const simUniforms = [...DISTURBANCE_SIM_FRAG.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]);
  const gpuSrc = readFileSync(new URL('../../src/world/water/lowflight/disturbance-gpu.ts', import.meta.url), 'utf8');
  const missing = simUniforms.filter((u) => !new RegExp(`\\b${u}:\\s*\\{`).test(gpuSrc));
  check(missing.length === 0, `every simulation uniform is bound by the pass (${simUniforms.join(', ')}${missing.length ? `; missing ${missing.join(', ')}` : ''})`);
  check(/uStamps\[MAX_STAMPS \* 3\]/.test(DISTURBANCE_SIM_FRAG) && new RegExp(`#define MAX_STAMPS ${DISTURBANCE_SIM.maxStamps}\\b`).test(DISTURBANCE_SIM_FRAG), `the stamp array matches the window's limit (${DISTURBANCE_SIM.maxStamps} × 3 vec4)`);
  check(/texelFetch\(uPrev/.test(DISTURBANCE_SIM_FRAG) && /gl_FragCoord/.test(DISTURBANCE_SIM_FRAG), 'the simulation reads the previous state per texel (texelFetch, integer scroll)');
  const waterDecl = ['uDistTex', 'uDistRect', 'uDistParams'];
  check(waterDecl.every((u) => new RegExp(`uniform\\s+\\w+\\s+${u};`).test(WATER_FRAGMENT_GLSL)), 'the water fragment declares the field uniforms');
  check(/distSlope/.test(WATER_FRAGMENT_GLSL) && /distRough/.test(WATER_FRAGMENT_GLSL) && /dragonFoam/.test(WATER_FRAGMENT_GLSL), 'the water fragment uses the field (slope, roughness, foam)');
  check(/if \(uDistParams\.x > 0\.5\)/.test(DISTURBANCE_WATER_SAMPLE_GLSL) && /textureLod\(uDistTex/.test(DISTURBANCE_WATER_SAMPLE_GLSL), 'the field is sampled only inside a uniform branch, with explicit LOD (no derivatives in divergent flow)');
  const tex = new THREE.Texture();
  const dist = { uDistTex: { value: tex }, uDistRect: { value: new THREE.Vector4() }, uDistParams: { value: new THREE.Vector4() } };
  const wu = createWaterUniforms({} as never, { geoHeight: tex, geoCoast: tex, region: tex, flow: tex, bands: tex, foam: tex, reflection: tex, reflectionDepth: null }, new THREE.Vector4(), dist) as unknown as Record<string, { value: unknown }>;
  check(waterDecl.every((u) => wu[u] === (dist as Record<string, unknown>)[u]), 'the water material shares the field uniform objects (updates reach the shader)');
}

console.log(`\n${failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILED:\n  - ${failures.join('\n  - ')}`} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures.length ? 1 : 0);
