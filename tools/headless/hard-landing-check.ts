/**
 * Hard landing check (phase 04), headless: the real rig driven by the real FlightSim and PoseDriver
 * (tools/headless/pose/runtime.ts), with the real bond core on top (as the model system runs it).
 *
 *   npx tsx tools/headless/hard-landing-check.ts            # table of numbers, exits 1 when one fails
 *   npx tsx tools/headless/hard-landing-check.ts --verbose  # also the per-frame timeline of every impact run
 *
 * Covers:
 *   - normal landings never trigger it: every landing v2 variant (slow landing, drop, shallow, tired), the running
 *     landing and its variants, touch-and-go, a sweep of L presses over speeds and heights, take-offs, a hover, a
 *     skim over land, and the water landing (the perch landing: perch-landing-check.ts);
 *   - fast impacts at several speeds and angles trigger it (steep and shallow belly hits, a stall onto the ground, a
 *     glancing fast belly hit, legs out sinking fast, a roof), and hits below the thresholds do not;
 *   - the tumble stays on the terrain (the centre, the body's collision spheres and the rider never below the surface
 *     under them), never over the water, never into a wall, ends grounded and controllable within 4.5 s, with no NaN;
 *   - input during it is ignored (the same trajectory with the stick and Space hammered);
 *   - the variants never repeat back to back (and all three turn up);
 *   - the events (impact, dust, camera jolt, the "Sert iniş" caption), the bond's "oof", embarrassment and the head
 *     shake with a grumble or a sneeze (never the same one twice in a row);
 *   - a flow chain breaks; determinism (the same run twice gives the same numbers).
 */
import * as THREE from 'three';
import { BondCore } from '../../src/dragon/model/behavior/bond/core';
import { createInputs } from '../../src/dragon/model/behavior/bond/types';
import type { DragonMood } from '../../src/core/contracts';
import { bodySphere, HARD_LANDING_VARIANTS, triggerHardLanding, type HardLandingVariant } from '../../src/dragon/flight/hard-landing';
import { FLOW } from '../../src/dragon/flight/flow/params';
import type { FlightSim } from '../../src/dragon/flight/sim';
import type { SimEvent } from '../../src/dragon/flight/types';
import { buildRig, PoseRuntime, type FrameInput, type FrameScript, type Terrain } from './pose/runtime';
import { GROUND_Y, scenarioByName } from './pose/scenarios';

const FPS = 60;
const verbose = process.argv.includes('--verbose');
const failures: string[] = [];
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');

function check(ok: boolean, label: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
  }
}

/* ------------------------------------------------------------------ */
/* Measurements                                                         */
/* ------------------------------------------------------------------ */

const _c = new THREE.Vector3();
const _column = { floor: 0, ceiling: Infinity };
const _contact = { normal: new THREE.Vector3(), depth: 0, surface: '' };

/**
 * Lowest clearance (m) of the body's collision spheres (the head where the tumble's neck raise holds it, as the hard
 * landing models it) and of the rider's sphere: above the surface under each, or minus the depth a sphere reaches
 * into the ground or a structure; and of the centre above the ground.
 */
function clearance(sim: FlightSim): { spheres: number; centre: number } {
  const col = sim.world.collision!;
  const p = sim.body.position;
  const q = sim.body.quaternion;
  const raise = sim.hard.active && sim.hard.stage === 'tumble' ? sim.hard.neckRaise : 0;
  let spheres = Infinity;
  for (let i = 0; i <= sim.contacts.offsets.length; i++) {
    const r = bodySphere(sim, i, raise, _c);
    _c.applyQuaternion(q).add(p);
    const hit = col.resolveSphere(_c, r, _contact, true);
    const floor = col.columnAt(_c.x, _c.z, _c.y, _column).floor;
    spheres = Math.min(spheres, hit ? -hit.depth : _c.y - r - floor);
  }
  const ground = col.columnAt(p.x, p.z, p.y, _column).floor;
  return { spheres, centre: p.y - ground };
}

function finiteSim(sim: FlightSim): boolean {
  const b = sim.body;
  return b.isFinite() && Number.isFinite(sim.spread + sim.legsOut + sim.beat.phase + sim.beat.amplitude);
}

function finitePose(pose: Record<string, number | undefined>): boolean {
  for (const k in pose) {
    const v = pose[k];
    if (typeof v === 'number' && !Number.isFinite(v) && !(k === 'groundY' && Number.isNaN(v))) {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Runs                                                                 */
/* ------------------------------------------------------------------ */

interface HardRun {
  label: string;
  rt: PoseRuntime;
  /** Sim time of the impact (s since the run started), -1 when none. */
  impactAt: number;
  /** Seconds from the impact until control came back (the hard landing ended), NaN when it did not. */
  duration: number;
  variant: HardLandingVariant | null;
  count: number;
  minSpheres: number;
  minCentre: number;
  overWater: boolean;
  finite: boolean;
  modeAtEnd: string;
  /** Grounded and controllable afterwards: Space leapt into the air within 2 s of the end. */
  controllable: boolean;
  /** Horizontal distance slid from the impact to the stop (m). */
  slide: number;
  sounds: string[];
  puffs: string[];
  moods: DragonMood[];
  reactions: string[];
  /** Mood 20 s after the impact. */
  moodAfter: DragonMood;
  /** Trajectory samples (every 6th frame) for the determinism and input comparisons. */
  track: number[];
  impactPoint: THREE.Vector3;
  stopPoint: THREE.Vector3;
}

interface HardOptions {
  terrain?: Terrain;
  seconds?: number;
  /** Extra setup on the world (colliders). */
  world?: (rt: PoseRuntime) => void;
  /** Input hammered during the hard landing (it must be ignored). */
  hammer?: boolean;
  /** Keep this runtime (several hard landings in one sim). */
  rt?: PoseRuntime;
  bond?: BondCore;
}

const EVENT_TYPES: SimEvent['type'][] = ['impact', 'dust', 'shake', 'maneuver'];

async function hardRun(label: string, place: (rt: PoseRuntime) => void, script: FrameScript, opts: HardOptions = {}): Promise<HardRun> {
  const rt = opts.rt ?? new PoseRuntime(await buildRig(), GROUND_Y, false, opts.terrain, null);
  if (!opts.rt) {
    opts.world?.(rt);
  }
  const sim = rt.sim;
  const startCount = sim.hard.count;
  place(rt);
  const bond = opts.bond ?? new BondCore();
  const inp = createInputs();
  const run: HardRun = {
    label,
    rt,
    impactAt: -1,
    duration: Number.NaN,
    variant: null,
    count: 0,
    minSpheres: Infinity,
    minCentre: Infinity,
    overWater: false,
    finite: true,
    modeAtEnd: '',
    controllable: false,
    slide: 0,
    sounds: [],
    puffs: [],
    moods: [],
    reactions: [],
    moodAfter: 'content',
    track: [],
    impactPoint: new THREE.Vector3(),
    stopPoint: new THREE.Vector3(),
  };
  let ended = -1;
  let leapAt = -1;
  let frame = 0;
  const seconds = opts.seconds ?? 26;
  rt.run({
    seconds,
    renderFps: FPS,
    script: (t, s, input) => {
      if (run.impactAt < 0 && s.hard.count > startCount) {
        run.impactAt = t;
        run.variant = s.hard.variant;
        run.impactPoint.copy(s.body.position);
      }
      if (run.impactAt < 0) {
        script(t, s, input);
      } else if (s.hard.active) {
        const c = clearance(s);
        run.minSpheres = Math.min(run.minSpheres, c.spheres);
        run.minCentre = Math.min(run.minCentre, c.centre);
        run.overWater ||= s.overWater;
        if (opts.hammer) {
          input.cmd.pitch = Math.sin(t * 7);
          input.cmd.roll = Math.cos(t * 5);
          input.cmd.dive = true;
          input.cmd.flap = frame % 2 === 0;
          if (frame % 9 === 0) {
            input.press('flap');
            input.press('land');
            input.press('rollLeft');
          }
        }
        if (s.hard.stage !== 'tumble' && run.stopPoint.lengthSq() === 0) {
          run.stopPoint.copy(s.body.position);
        }
      } else if (ended < 0) {
        ended = t;
        run.duration = t - run.impactAt;
        run.modeAtEnd = s.mode;
      } else if (leapAt < 0 && t >= ended + 0.3 && t < ended + 0.3 + 1 / FPS) {
        input.press('flap');
      } else if (leapAt < 0 && ended >= 0 && s.airborne) {
        leapAt = t;
      }
      run.finite &&= finiteSim(s) && finitePose(rt.poseDriver.pose as unknown as Record<string, number>);
      if (frame % 6 === 0) {
        const p = s.body.position;
        run.track.push(Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000, Math.round(p.z * 1000) / 1000);
      }
      frame++;
      // The bond core on top, as the model system runs it (its inputs from the flight state).
      inp.dt = 1 / FPS;
      inp.mode = s.mode;
      inp.airspeed = s.airspeed;
      inp.groundSpeed = Math.hypot(s.body.velocity.x, s.body.velocity.z);
      inp.agl = s.agl;
      inp.stamina = s.stamina;
      inp.hardLanding = s.hard.phase;
      inp.maneuvering = (rt.poseDriver.pose.riderTuck ?? 0) > 0.2;
      const o = bond.update(inp);
      if (run.impactAt >= 0) {
        for (const snd of o.sounds) {
          run.sounds.push(snd.cue);
        }
        for (const puff of o.puffs) {
          run.puffs.push(puff.kind);
        }
        if (run.moods[run.moods.length - 1] !== o.mood) {
          run.moods.push(o.mood);
        }
        if (Math.abs(t - run.impactAt - 20) < 0.5 / FPS) {
          run.moodAfter = o.mood;
        }
      }
    },
  });
  run.count = sim.hard.count - startCount;
  run.controllable = leapAt >= 0 && leapAt - ended < 2;
  run.slide = run.stopPoint.lengthSq() > 0 ? Math.hypot(run.stopPoint.x - run.impactPoint.x, run.stopPoint.z - run.impactPoint.z) : 0;
  run.reactions = bond.reactions.slice();
  if (verbose) {
    console.log(`    ${label}: impact ${f2(run.impactAt)} s, ${run.variant}, ${f2(run.duration)} s, slide ${f2(run.slide)} m, sounds ${run.sounds.join(' ')}, moods ${run.moods.join(' > ')}`);
  }
  return run;
}

/**
 * Starts `height` m above flat ground moving `speed` m/s north and sinking `sink` m/s, nose along the path, legs tucked
 * (or out), holding W (nose down): it meets the ground within a fraction of a second.
 */
function impactAt(height: number, speed: number, sink: number, legs = false): (rt: PoseRuntime) => void {
  return (rt) => {
    const path = Math.atan2(-sink, Math.max(speed, 0.1));
    rt.teleport(0, GROUND_Y + height, 0, 0, Math.max(speed, 0.6), (path * 180) / Math.PI);
    const sim = rt.sim;
    sim.body.velocity.set(0, -sink, -speed);
    sim.legsOut = legs ? 1 : 0;
    sim.spread = legs ? 0.7 : 0.4;
  };
}

const holdW: FrameScript = (_t, _sim, input: FrameInput) => {
  input.cmd.pitch = 1;
};

/** Runs a named pose-strip scenario (normal landings) and returns the hard landings it produced. */
async function scenarioHardLandings(name: string): Promise<number> {
  const s = scenarioByName(name);
  if (!s) {
    throw new Error(`unknown scenario ${name}`);
  }
  const rt = new PoseRuntime(await buildRig(), s.sea !== undefined ? -s.sea : GROUND_Y, s.sea !== undefined, s.terrain, s.wind ?? null);
  s.setup(rt);
  rt.run({ seconds: s.seconds, renderFps: FPS, script: s.script() });
  return rt.sim.hard.count;
}

/** L pressed at `speed` m/s, `height` m over flat ground (hands off afterwards): the hard landings it produced. */
async function landSweep(height: number, speed: number, brake: boolean): Promise<number> {
  const rt = new PoseRuntime(await buildRig(), GROUND_Y, false, undefined, null);
  rt.teleport(0, GROUND_Y + height, 0, 0, speed);
  let pressed = false;
  rt.run({
    seconds: 22,
    renderFps: 30,
    script: (t, _sim, input) => {
      if (!pressed && t >= 0.3) {
        pressed = true;
        input.press('land');
      }
      input.cmd.brake = brake && t < 3;
    },
  });
  return rt.sim.hard.count;
}

/* ------------------------------------------------------------------ */
/* Sections                                                             */
/* ------------------------------------------------------------------ */

async function normalLandings(): Promise<void> {
  console.log('normal landings never trigger a hard landing');
  const names = ['land', 'land-drop', 'land-shallow', 'land-tired', 'fastland', 'runout', 'runout-glide', 'runout-swoop', 'touchgo', 'runout-edge', 'takeoff', 'leap', 'leap-run', 'leap-drop', 'leap-tired', 'hover', 'skim', 'land-on-water', 'wade'];
  const hits: string[] = [];
  for (const name of names) {
    const n = await scenarioHardLandings(name);
    if (n > 0) {
      hits.push(`${name} (${n})`);
    }
  }
  check(hits.length === 0, `scenarios ${names.join(', ')}: ${hits.length === 0 ? 'none' : hits.join(', ')}`);
  const sweep: string[] = [];
  let runs = 0;
  for (const height of [4, 10, 25, 45]) {
    for (const speed of [8, 14, 22, 30, 38]) {
      for (const brake of [false, true]) {
        runs++;
        if ((await landSweep(height, speed, brake)) > 0) {
          sweep.push(`${height} m ${speed} m/s${brake ? ' braked' : ''}`);
        }
      }
    }
  }
  check(sweep.length === 0, `L pressed over 4-45 m at 8-38 m/s, braked or not (${runs} runs): ${sweep.length === 0 ? 'none' : sweep.join(', ')}`);
}

async function impacts(): Promise<HardRun[]> {
  console.log('fast impacts trigger it; the tumble stays on the ground, ends grounded and controllable');
  const cases: Array<[string, (rt: PoseRuntime) => void, boolean]> = [
    ['steep belly hit (12 m/s over the ground, sinking 14 m/s)', impactAt(2.4, 12, 14), true],
    ['shallow belly hit (30 m/s, sinking 7 m/s)', impactAt(2.2, 30, 7), true],
    ['stall onto the ground (3 m/s, sinking 16 m/s)', impactAt(3, 3, 16), true],
    ['glancing fast belly hit (38 m/s, sinking 4 m/s)', impactAt(1.9, 38, 4), true],
    ['legs out, sinking 11 m/s at 10 m/s', impactAt(2.6, 10, 11, true), true],
    ['legs out, sinking 9 m/s at 20 m/s', impactAt(2.6, 20, 9, true), true],
    ['below the thresholds: belly 15 m/s sinking 3.5 m/s', impactAt(1.9, 15, 3.5), false],
    ['below the thresholds: legs out sinking 5 m/s at 12 m/s', impactAt(2.6, 12, 5, true), false],
  ];
  const runs: HardRun[] = [];
  for (const [label, place, want] of cases) {
    const run = await hardRun(label, place, holdW, { seconds: want ? 26 : 8 });
    if (!want) {
      check(run.count === 0, `${label}: no hard landing (${run.count})`);
      continue;
    }
    runs.push(run);
    check(run.count === 1, `${label}: one hard landing (${run.count}, ${run.variant ?? '-'})`);
    check(run.minCentre > 0.5 && run.minSpheres > -0.05, `${label}: stays on the ground (spheres and rider ${f2(run.minSpheres)} m, centre ${f2(run.minCentre)} m above the surface)`);
    check(run.duration >= 2.5 && run.duration <= 4.5 && run.modeAtEnd === 'grounded', `${label}: over in ${f2(run.duration)} s (2.5-4.5), ${run.modeAtEnd}`);
    check(run.controllable, `${label}: controllable afterwards (Space leaps)`);
    check(run.finite, `${label}: no NaN`);
  }
  return runs;
}

async function obstacles(): Promise<void> {
  console.log('the slide stops at the water, a wall and a roof edge');
  // Each obstacle lies ~3 m ahead of the impact, well inside the ~6 m a free slide at this speed covers.
  // A shore: land for z > -3, sea beyond.
  const shore: Terrain = (_x, z) => (z > -3 ? GROUND_Y : -8);
  const water = await hardRun('toward the water', impactAt(2.2, 30, 8), holdW, { terrain: shore, seconds: 10 });
  check(water.count === 1 && !water.overWater && water.stopPoint.z > -3, `toward the water: stops on land (centre z ${f2(water.stopPoint.z)} > -3, never over the water: ${!water.overWater})`);
  // A wall: a 20 m high building across the path, its face at z = -11 (the head starts 3 m short of it).
  const wallFace = -11;
  const wall = await hardRun('toward a wall', impactAt(2.2, 30, 8), holdW, {
    seconds: 10,
    world: (rt) => {
      rt.sim.world.collision!.add({ kind: 'box', center: new THREE.Vector3(0, GROUND_Y + 10, wallFace - 6), halfSize: new THREE.Vector3(30, 10, 6), yaw: 0 }, 'building');
    },
  });
  const inWall = wall.rt.sim.world.collision!.resolveSphere(new THREE.Vector3(...wall.rt.sim.body.position.toArray()), wall.rt.sim.contacts.bellyDepth * 0.9, undefined, false);
  check(wall.count === 1 && wall.stopPoint.z > wallFace + 4 && wall.minSpheres > -0.1 && !inWall, `toward a wall: stops before its face (centre z ${f2(wall.stopPoint.z)}, face at ${wallFace}, clearance ${f2(wall.minSpheres)} m${inWall ? ', INSIDE the wall at the end' : ''})`);
  // A flat roof 12 m up whose far edge is 4 m ahead: the tumble stays on the roof and stops before the edge.
  const roofTop = GROUND_Y + 12;
  const roof = await hardRun(
    'on a roof',
    (rt) => {
      rt.teleport(0, roofTop + 2.3, 0, 0, 26, -15);
      rt.sim.body.velocity.set(0, -8, -26);
      rt.sim.legsOut = 0;
    },
    holdW,
    {
      seconds: 10,
      world: (rt) => {
        rt.sim.world.collision!.add({ kind: 'box', center: new THREE.Vector3(0, GROUND_Y + 6, 6), halfSize: new THREE.Vector3(25, 6, 10), yaw: 0 }, 'building');
      },
    },
  );
  check(roof.count === 1 && roof.minSpheres > -0.05 && roof.stopPoint.z > -4 && roof.stopPoint.y > roofTop, `on a roof: tumbles on the roof and stops before its edge (centre z ${f2(roof.stopPoint.z)} > -4, y ${f2(roof.stopPoint.y)} > ${roofTop}, clearance ${f2(roof.minSpheres)} m)`);
}

async function inputIgnored(): Promise<void> {
  console.log('input during the tumble is ignored; determinism');
  const place = impactAt(2.2, 28, 9);
  const a = await hardRun('plain', place, holdW, { seconds: 8 });
  const b = await hardRun('plain again', place, holdW, { seconds: 8 });
  const c = await hardRun('hammered', place, holdW, { seconds: 8, hammer: true });
  const same = (x: number[], y: number[], upTo: number): boolean => x.length >= upTo && y.length >= upTo && x.slice(0, upTo).every((v, i) => v === y[i]);
  // Compare up to the end of the hard landing (the hammered run leaps off afterwards like the others).
  const upTo = Math.floor(((a.impactAt + a.duration) * FPS) / 6) * 3;
  check(same(a.track, b.track, a.track.length) && a.variant === b.variant && a.duration === b.duration, `the same run twice gives the same trajectory (${a.track.length / 3} samples, ${a.variant}, ${f2(a.duration)} s)`);
  check(same(a.track, c.track, upTo) && c.duration === a.duration, `stick, Shift, Space, L and double taps during it change nothing (${upTo / 3} samples, ${f2(c.duration)} s)`);
}

async function variantsAndBond(): Promise<void> {
  console.log('variants never repeat back to back; sounds and bond cues');
  const rt = new PoseRuntime(await buildRig(), GROUND_Y, false, undefined, null);
  rt.stand(0, 0, 0);
  const bond = new BondCore();
  const variants: HardLandingVariant[] = [];
  const sounds: string[][] = [];
  const moods: DragonMood[][] = [];
  let durationsOk = true;
  for (let i = 0; i < 7; i++) {
    const run = await hardRun(
      `repeat ${i + 1}`,
      (r) => {
        triggerHardLanding(r.sim, undefined, 18 + 3 * i, 10);
      },
      () => undefined,
      { rt, bond, seconds: 22 },
    );
    variants.push(run.variant ?? ('?' as HardLandingVariant));
    sounds.push(run.sounds);
    moods.push(run.moods);
    durationsOk &&= run.duration <= 4.5 && run.minSpheres > -0.05 && run.finite;
  }
  const repeats = variants.filter((v, i) => i > 0 && v === variants[i - 1]).length;
  const all = HARD_LANDING_VARIANTS.every((v) => variants.includes(v));
  check(repeats === 0 && all, `7 hard landings in a row: ${variants.join(', ')} (no repeat back to back, all three)`);
  check(durationsOk, 'every one of them on the ground, over within 4.5 s, no NaN');
  const reactions = bond.reactions;
  const reactionRepeats = reactions.filter((v, i) => i > 0 && v === reactions[i - 1]).length;
  check(reactions.length === 7 && reactionRepeats === 0, `head shakes: ${reactions.join(', ')} (one each, never the same twice in a row)`);
  const oof = sounds.every((s) => s[0] === 'huff');
  const voiced = sounds.every((s) => s.includes('grumble') || s.includes('sneeze'));
  check(oof && voiced, `each one: an "oof" (huff) at the impact, then a grumble or a sneeze (${sounds.map((s) => s.join('+')).join(' | ')})`);
  const embarrassed = moods.every((m) => m[0] === 'embarrassed' || m.includes('embarrassed'));
  check(embarrassed, `embarrassed at each impact (${moods.map((m) => m.join('>')).join(' | ')})`);
  // Events of one hard landing (a plain sim with the event queue on).
  const sim = rt.sim;
  sim.queueEvents = true;
  sim.events.length = 0;
  rt.stand(0, 0, 0);
  triggerHardLanding(sim, 'side', 24, 10);
  for (let i = 0; i < 480; i++) {
    sim.step(1 / 120, createNeutral());
  }
  const types = new Set(sim.events.map((e) => e.type));
  const caption = sim.events.find((e) => e.type === 'maneuver' && e.id === 'hardland');
  const thuds = sim.events.filter((e) => e.type === 'impact').length;
  check(EVENT_TYPES.every((t) => types.has(t)) && caption !== undefined && thuds >= 2, `events: impact + dust burst + camera jolt + caption "${caption && caption.type === 'maneuver' ? caption.label : '-'}", ${thuds} thuds (the roll meeting the ground)`);
  sim.queueEvents = false;
  // Mood back to normal: a single hard landing, then 20 s standing.
  const one = await hardRun('mood recovers', (r) => r.stand(0, 0, 0), (t, s) => {
    if (t > 0.5 && s.hard.count === 0) {
      triggerHardLanding(s, 'belly', 20, 10);
    }
  }, { seconds: 26 });
  check(one.moods.includes('embarrassed') && one.moodAfter !== 'embarrassed', `embarrassment passes: ${one.moods.join(' > ')}, 20 s later ${one.moodAfter}`);
}

function createNeutral(): Parameters<FlightSim['step']>[1] {
  return {
    pitch: 0,
    roll: 0,
    yaw: 0,
    flap: false,
    dive: false,
    brake: false,
    fire: false,
    flapPressed: false,
    landPressed: false,
    roarPressed: false,
    rollLeftPressed: false,
    rollRightPressed: false,
    loopPressed: false,
    dropPressed: false,
    powerPressed: false,
    slipLeftPressed: false,
    slipRightPressed: false,
  };
}

async function flowBreaks(): Promise<void> {
  console.log('flow: a hard landing breaks the chain like any ground contact');
  const rt = new PoseRuntime(await buildRig(), GROUND_Y, false, undefined, null);
  impactAt(2.2, 28, 9)(rt);
  const sim = rt.sim;
  sim.flow.value = 0.8;
  sim.flow.debugLink(sim, 3);
  const links = sim.flow.burst.links;
  let flowAfter = -1;
  let linksAfter = -1;
  rt.run({
    seconds: 1.5,
    renderFps: FPS,
    script: (_t, s, input) => {
      input.cmd.pitch = 1;
      if (flowAfter < 0 && s.hard.count > 0) {
        flowAfter = s.flow.value;
        linksAfter = s.flow.burst.links;
      }
    },
  });
  check(links > 0 && linksAfter === 0 && flowAfter >= 0 && flowAfter <= 0.8 * FLOW.contactKeep + 0.02, `chain of ${links} broken (${linksAfter} links), flow 0.80 -> ${f2(flowAfter)} (contact keeps ${FLOW.contactKeep})`);
}

async function main(): Promise<void> {
  const t0 = performance.now();
  await normalLandings();
  const runs = await impacts();
  const byVariant = new Map<string, number[]>();
  for (const r of runs) {
    const list = byVariant.get(r.variant ?? '?') ?? [];
    list.push(r.duration);
    byVariant.set(r.variant ?? '?', list);
  }
  console.log(`  durations: ${[...byVariant].map(([v, d]) => `${v} ${d.map(f2).join('/')} s`).join(', ')}; slides ${runs.map((r) => f2(r.slide)).join(', ')} m`);
  await obstacles();
  await inputIgnored();
  await variantsAndBond();
  await flowBreaks();
  console.log(failures.length === 0 ? `ALL PASS (${Math.round((performance.now() - t0) / 1000)} s)` : `${failures.length} FAILED (${Math.round((performance.now() - t0) / 1000)} s)`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
