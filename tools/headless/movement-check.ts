/**
 * Phase 20 stage A movement check, headless (no browser, no GPU): the real rig driven by the real FlightSim and
 * PoseDriver (tools/headless/pose/runtime.ts) through scripted ground scenarios, measured on the skinned mesh.
 *
 *   npx tsx tools/headless/movement-check.ts            # table of numbers, exits 1 when one fails
 *   npx tsx tools/headless/movement-check.ts --json f   # also write the numbers to f
 *   npx tsx tools/headless/movement-check.ts --swim     # only the swimming section
 *   npx tsx tools/headless/movement-check.ts --landing  # only the landing sections (touchdowns, run-out, landing v2)
 *
 * Everything is measured from the per-frame records (60 fps render frames, 120 Hz physics), so the same check runs
 * against older code for before / after numbers:
 *   - gaits (walk, trot, gallop): median slip of a planted foot (< 0.15 m/s), hind foot lift, planted share and the
 *     gallop's suspension (no foot planted);
 *   - touchdowns (slow landing, fast landing, run-out): largest per-frame height and pitch change, foot penetration,
 *     wings and tail never below the ground;
 *   - run-out: stop distance without and with the brake against the distance the RUNOUT parameters predict;
 *   - landing v2 (slow landings and run-outs, each variant): contact sink and ground speed, the flare's pitch, the
 *     approach pitch not held constant, backstrokes before the contact, hind feet first, wings and tail above the
 *     ground from L on, no velocity jump; the variant picker never repeating one where another applies;
 *   - touch-and-go: ground speed kept through the fly-out (>= 70 %);
 *   - leaps (standing, running, tired, off an edge): crouch and push-off durations, no velocity jump > 3 m/s in one
 *     frame, first full downstroke within 0.15 s of lift-off, legs tucked only after the second stroke;
 *   - hover in still air: no bank without roll input;
 *   - swimming (calm sea): no walk cycle, no NaNs, rider and head above the water, the waterline along the back, the
 *     tail tip's sweep (floating / swim / fast envelopes) at the stroke frequency, the wings paddling at the surface
 *     and recovering above it (wrist heights), never deeper than a limit, the rider's head steady enough, the speed
 *     surging with each wing stroke around an unchanged mean, the outer wing stroking harder in a turn; a slow L landing
 *     settling into the float with no walk cycle; the water take-off run lifting off; wading in at a shore and floating
 *     again walking out.
 */
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import * as params from '../../src/dragon/flight/params';
import { footStats, trackFeet, type FootTrack } from './pose/contacts';
import { lowestParts as lowestPartsOf, partVertices, type LowestParts } from './pose/parts';
import { collectMeshes, skinVertex, type MeshData } from './pose/raster';
import { buildRig, PoseRuntime, type FrameRecord, type FrameScript, type Terrain } from './pose/runtime';
import { fly, GROUND_Y, landThen, scenarioByName } from './pose/scenarios';

const FPS = 60;
/** Run-out parameters (the stage A defaults when checking older code that has none, for before / after numbers). */
const RUNOUT: { minSpeed: number; maxSpeed: number; decel: number; dragPerV2: number; brakeDecel: number; endSpeed: number } = (
  params as unknown as { RUNOUT?: typeof RUNOUT }
).RUNOUT ?? { minSpeed: 8, maxSpeed: 22, decel: 3.2, dragPerV2: 0.004, brakeDecel: 7.5, endSpeed: 3 };
const DEG = 180 / Math.PI;
const failures: string[] = [];
const results: Record<string, number | string | boolean> = {};
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');

function check(ok: boolean, label: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
  }
}

function note(key: string, value: number | string | boolean): void {
  results[key] = typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
}

interface Run {
  records: FrameRecord[];
  meshes: MeshData[];
  boneNames: string[];
  skel: { id(name: string): number; restHeads: THREE.Vector3[] };
  ground: (x: number, z: number) => number;
  rt: PoseRuntime;
}

async function simulate(setup: (rt: PoseRuntime) => void, seconds: number, script: FrameScript, terrain?: Terrain): Promise<Run> {
  const rig = await buildRig();
  const rt = new PoseRuntime(rig, GROUND_Y, false, terrain, null);
  setup(rt);
  const records = rt.run({ seconds, renderFps: FPS, script });
  const boneNames = rig.skel.bones.map((b) => b.name);
  const meshes = collectMeshes(rig.root, boneNames);
  const geo = rt.sim.world.geo!;
  return { records, meshes, boneNames, skel: rig.skel, ground: (x, z) => geo.heightAt(x, z), rt };
}

async function scenario(name: string): Promise<Run> {
  const s = scenarioByName(name);
  if (!s) {
    throw new Error(`unknown scenario ${name}`);
  }
  return simulate((rt) => s.setup(rt), s.seconds, s.script(), s.terrain);
}

/* ------------------------------------------------------------------ */
/* Mesh measurements                                                    */
/* ------------------------------------------------------------------ */

function lowestParts(run: Run, t0: number, t1: number, step = 2): LowestParts {
  return lowestPartsOf(run, t0, t1, step);
}

function firstIndex(records: readonly FrameRecord[], pred: (r: FrameRecord, k: number) => boolean, from = 0): number {
  for (let k = from; k < records.length; k++) {
    if (pred(records[k], k)) {
      return k;
    }
  }
  return -1;
}

/**
 * Continuity over [k0, k1]: the largest height jump (m) — a frame's height change beyond what the previous frame's
 * change carries on (a snap of 1 m shows as ~1 m, a steady 4 m/s sink as ~0) — the largest height change of a
 * frame (m) and the largest pitch change of a frame (deg).
 */
function continuity(records: readonly FrameRecord[], k0: number, k1: number): { jump: number; dy: number; dPitch: number } {
  let jump = 0;
  let dy = 0;
  let dPitch = 0;
  for (let k = Math.max(2, k0); k <= Math.min(records.length - 1, k1); k++) {
    const d1 = records[k].position[1] - records[k - 1].position[1];
    const d0 = records[k - 1].position[1] - records[k - 2].position[1];
    jump = Math.max(jump, Math.abs(d1 - d0));
    dy = Math.max(dy, Math.abs(d1));
    dPitch = Math.max(dPitch, Math.abs(records[k].pitchDeg - records[k - 1].pitchDeg));
  }
  return { jump, dy, dPitch };
}

function horizontal(r: FrameRecord): number {
  return Math.hypot(r.velocity[0], r.velocity[2]);
}

/* ------------------------------------------------------------------ */
/* 1. Gaits                                                             */
/* ------------------------------------------------------------------ */

async function gaits(): Promise<void> {
  console.log('\nGaits (steady speed, 3 s window)');
  for (const [name, gait] of [
    ['walk', 'walk'],
    ['trot', 'trot'],
    ['run', 'gallop'],
  ] as const) {
    const run = await scenario(name);
    const recs = run.records;
    const t0 = recs[recs.length - 1].time - 3.2;
    const t1 = t0 + 3;
    const ref = recs.find((r) => r.time >= t0 && r.mode === 'grounded')!;
    const body = run.meshes.find((m) => m.kind === 'body')!;
    const tracks: FootTrack[] = trackFeet(body, run.boneNames, recs, ref);
    const stats = footStats(tracks, recs, t0, t1);
    const hind = stats.filter((s) => s.bone.startsWith('foot'));
    const fore = stats.filter((s) => s.bone.startsWith('thumb'));
    const slipHind = Math.max(...hind.map((s) => s.slip));
    const slipFore = Math.max(...fore.map((s) => s.slip));
    const lift = Math.min(...hind.map((s) => s.lift));
    const planted = stats.reduce((a, s) => a + s.planted, 0) / stats.length;
    // Suspension: grounded frames with no foot planted (the hind feet and the wrists).
    let frames = 0;
    let airborne = 0;
    for (let k = 0; k < recs.length; k++) {
      const r = recs[k];
      if (r.time < t0 || r.time > t1) {
        continue;
      }
      frames++;
      if (tracks.every((tr) => tr.points[k * 3 + 1] - r.surfaceY > 0.04)) {
        airborne++;
      }
    }
    const speed = hind[0]?.bodySpeed ?? 0;
    console.log(
      `  ${gait.padEnd(6)} ${f2(speed)} m/s: slip hind ${f2(slipHind)} fore ${f2(slipFore)} m/s, hind lift ${f2(lift)} m, planted ${(planted * 100).toFixed(0)} %, suspension ${((airborne / frames) * 100).toFixed(0)} %`,
    );
    note(`${gait}.slipHind`, slipHind);
    note(`${gait}.slipFore`, slipFore);
    note(`${gait}.lift`, lift);
    note(`${gait}.planted`, planted);
    note(`${gait}.suspension`, airborne / frames);
    check(slipHind < 0.15 && slipFore < 0.15, `${gait}: planted-foot slip < 0.15 m/s (hind ${f2(slipHind)}, fore ${f2(slipFore)})`);
    check(lift >= 0.2, `${gait}: hind feet lift >= 0.2 m (${f2(lift)})`);
    if (gait === 'gallop') {
      check(airborne / frames > 0.03, `gallop: suspension phases (${((airborne / frames) * 100).toFixed(0)} % of frames with no foot planted)`);
    }
    const low = lowestParts(run, t0, t1, 3);
    note(`${gait}.penetration`, low.feet);
    check(low.feet > -0.03, `${gait}: feet penetration < 3 cm (lowest ${f2(low.feet)} m)`);
  }
}

/* ------------------------------------------------------------------ */
/* 2. Touchdowns                                                        */
/* ------------------------------------------------------------------ */

async function touchdowns(): Promise<void> {
  console.log('\nTouchdowns (from 1 s before to 2 s after the first grounded frame)');
  for (const name of ['land', 'fastland', 'runout']) {
    const run = await scenario(name);
    const recs = run.records;
    const td = firstIndex(recs, (r) => r.mode === 'grounded');
    if (td < 0) {
      check(false, `${name}: touches down`);
      continue;
    }
    const k0 = Math.max(0, td - FPS);
    const k1 = Math.min(recs.length - 1, td + 2 * FPS);
    const c = continuity(recs, k0, k1);
    const low = lowestParts(run, recs[k0].time, recs[k1].time, 2);
    const flare = lowestParts(run, 0, recs[td].time, 3);
    const tdSpeed = horizontal(recs[Math.max(0, td - 1)]);
    console.log(
      `  ${name.padEnd(9)} touchdown ${f2(tdSpeed)} m/s at ${f2(recs[td].time)} s, pitch ${recs[td - 1]?.pitchDeg.toFixed(0)}°: height jump ${f2(c.jump)} m (largest frame dy ${f2(c.dy)} m), dpitch ${f2(c.dPitch)}°; lowest wing ${f2(Math.min(low.wing, flare.wing))} m, tail ${f2(Math.min(low.tail, flare.tail))} m, feet ${f2(low.feet)} m`,
    );
    note(`${name}.touchdownSpeed`, tdSpeed);
    note(`${name}.jump`, c.jump);
    note(`${name}.dy`, c.dy);
    note(`${name}.dPitch`, c.dPitch);
    note(`${name}.wing`, Math.min(low.wing, flare.wing));
    note(`${name}.tail`, Math.min(low.tail, flare.tail));
    note(`${name}.feet`, low.feet);
    check(c.jump <= 0.02 && c.dPitch <= 1.5, `${name}: continuous touchdown (height jump ${f2(c.jump)} m <= 0.02, dpitch ${f2(c.dPitch)}° <= 1.5 per frame)`);
    check(Math.min(low.wing, flare.wing) > -0.02 && Math.min(low.tail, flare.tail) > -0.02, `${name}: wings and tail stay above the ground`);
    check(low.feet > -0.03, `${name}: feet penetration < 3 cm (${f2(low.feet)} m)`);
  }
}

/* ------------------------------------------------------------------ */
/* 3. Run-out and touch-and-go                                          */
/* ------------------------------------------------------------------ */

/** Stop distance the RUNOUT model predicts from v0 with a constant extra deceleration (m). */
function predictedStop(v0: number, brake: boolean): number {
  const a = brake ? RUNOUT.brakeDecel : RUNOUT.decel;
  const k = RUNOUT.dragPerV2;
  const ve = RUNOUT.endSpeed;
  // dv/dt = -(a + k v²)  →  distance = ln((a + k v0²) / (a + k ve²)) / (2k), plus the walk-down from ve (~ve / 2.4 s).
  return Math.log((a + k * v0 * v0) / (a + k * ve * ve)) / (2 * k) + ve / 2.4;
}

/** Distance (m) of the drop ahead in the runout-edge scenario (the landing v2 approach and flare cover ~100 m). */
const RUNOUT_EDGE = 125;

async function runOut(): Promise<void> {
  console.log('\nRun-out (L at 30 m/s, 8 m over flat ground)');
  for (const brake of [false, true]) {
    const run = await simulate(
      fly(8, 30),
      16,
      landThen(0.2, (since, _sim, input) => {
        input.cmd.brake = brake && since !== null;
      })(),
    );
    const recs = run.records;
    const td = firstIndex(recs, (r) => r.mode === 'grounded');
    const label = brake ? 'with brake' : 'no brake';
    if (td < 0) {
      check(false, `run-out ${label}: touches down`);
      continue;
    }
    const v0 = horizontal(recs[td]);
    const stop = firstIndex(recs, (r) => horizontal(r) < 0.3, td);
    const p0 = recs[td].position;
    const p1 = recs[stop >= 0 ? stop : recs.length - 1].position;
    const dist = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    const expected = predictedStop(v0, brake);
    console.log(`  ${label.padEnd(10)} touchdown ${f2(v0)} m/s → stopped after ${f2(dist)} m (${f2(stop >= 0 ? recs[stop].time - recs[td].time : NaN)} s); model ${f2(expected)} m`);
    note(`runout.${brake ? 'brake' : 'free'}.v0`, v0);
    note(`runout.${brake ? 'brake' : 'free'}.distance`, dist);
    note(`runout.${brake ? 'brake' : 'free'}.expected`, expected);
    check(v0 >= RUNOUT.minSpeed && v0 <= RUNOUT.maxSpeed, `run-out ${label}: touches down running (${f2(v0)} m/s within ${RUNOUT.minSpeed}-${RUNOUT.maxSpeed})`);
    check(stop >= 0 && dist > 0.75 * expected && dist < 1.25 * expected, `run-out ${label}: stop distance ${f2(dist)} m within ±25 % of ${f2(expected)} m`);
  }

  console.log('\nTouch-and-go (Space 0.8 s after the touchdown)');
  const run = await scenario('touchgo');
  const recs = run.records;
  const td = firstIndex(recs, (r) => r.mode === 'grounded');
  const press = firstIndex(recs, (r) => r.time >= recs[td].time + 0.8, td);
  const lift = firstIndex(recs, (r) => r.mode !== 'grounded', press);
  if (td < 0 || press < 0 || lift < 0) {
    check(false, 'touch-and-go: touches down and flies out');
    return;
  }
  const v0 = horizontal(recs[press]);
  let vMin = Infinity;
  for (let k = press; k < recs.length && recs[k].time <= recs[lift].time + 1.5; k++) {
    vMin = Math.min(vMin, horizontal(recs[k]));
  }
  const keep = vMin / v0;
  console.log(`  ground speed ${f2(v0)} m/s at the press, lift-off ${f2(recs[lift].time - recs[press].time)} s later, lowest ${f2(vMin)} m/s → kept ${(keep * 100).toFixed(0)} %`);
  note('touchgo.v0', v0);
  note('touchgo.keep', keep);
  check(keep >= 0.7, `touch-and-go keeps >= 70 % of the ground speed (${(keep * 100).toFixed(0)} %)`);
  const low = lowestParts(run, recs[td].time - 0.5, recs[lift].time + 1.5, 2);
  check(low.wing > -0.02 && low.tail > -0.02, `touch-and-go: wings and tail stay above the ground (wing ${f2(low.wing)}${low.wing <= -0.02 ? ` at ${f2(low.frameWing - recs[lift].time)} s from lift-off` : ""}, tail ${f2(low.tail)} m)`);

  const edge = await scenario('runout-edge');
  const off = firstIndex(edge.records, (r, k) => k > 0 && edge.records[k - 1].mode === 'grounded' && r.mode === 'takeoff');
  const atEdge = off >= 0 ? edge.records[off] : null;
  const edgeDistance = atEdge ? -atEdge.position[2] : NaN;
  console.log(`  run-out towards an edge at ${RUNOUT_EDGE} m: ${atEdge ? `leapt at ${f2(horizontal(atEdge))} m/s, ${f2(RUNOUT_EDGE - edgeDistance)} m before the edge` : 'no leap'}`);
  note('runoutEdge.leapt', atEdge !== null && edgeDistance < RUNOUT_EDGE);
  check(atEdge !== null && edgeDistance < RUNOUT_EDGE && atEdge.velocity[1] > 1, 'run-out towards an edge: leaps on its own before the edge');
}

/* ------------------------------------------------------------------ */
/* 3b. Landing v2: approach, flare, contact                             */
/* ------------------------------------------------------------------ */

const SLOW_LANDINGS = ['land', 'land-drop', 'land-shallow', 'land-tired'];
const RUN_LANDINGS = ['fastland', 'runout', 'runout-glide', 'runout-swoop'];

interface LandingStyleView {
  previous?: { variant: string | null; backstrokes: number; sink: number; speed: number };
  pick?(sim: unknown, runOut: boolean, clearance: number): string;
  last?: string | null;
}

function landingStyleOf(run: Run): LandingStyleView | null {
  return (run.rt.sim.controller as unknown as { landingStyle?: LandingStyleView }).landingStyle ?? null;
}

/** Lowest hind foot, wrist (fore foot), wing and tail height above the ground in one record (m). */
function contactOrder(run: Run, k: number): { hind: number; fore: number; wing: number; tail: number } {
  const parts = partVertices(run);
  const r = run.records[k];
  const p = new Float32Array(3);
  const out = { hind: Infinity, fore: Infinity, wing: Infinity, tail: Infinity };
  const height = (m: MeshData, i: number): number => {
    skinVertex(m, i, r, p, 0);
    return p[1] - run.ground(p[0], p[2]);
  };
  for (const [m, i] of parts.feet) {
    const bone = run.boneNames[m.dominant[i]] ?? '';
    const h = height(m, i);
    if (bone.startsWith('foot')) {
      out.hind = Math.min(out.hind, h);
    } else {
      out.fore = Math.min(out.fore, h);
    }
  }
  for (const [m, i] of parts.wing) {
    out.wing = Math.min(out.wing, height(m, i));
  }
  for (const [m, i] of parts.tail) {
    out.tail = Math.min(out.tail, height(m, i));
  }
  return out;
}

function stats(values: number[]): { mean: number; std: number; min: number; max: number } {
  const n = Math.max(values.length, 1);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { mean, std, min: Math.min(...values), max: Math.max(...values) };
}

async function landings(): Promise<void> {
  console.log('\nLanding v2 (L to 2 s after the touchdown; slow: land*, run-out: fastland, runout*)');
  const variants: string[] = [];
  for (const name of [...SLOW_LANDINGS, ...RUN_LANDINGS]) {
    if (!scenarioByName(name)) {
      console.log(`  ${name.padEnd(13)} n/a (no such scenario)`);
      continue;
    }
    const run = await scenario(name);
    const recs = run.records;
    const slow = SLOW_LANDINGS.includes(name);
    const land = firstIndex(recs, (r) => r.mode === 'landing');
    const td = firstIndex(recs, (r) => r.mode === 'grounded', Math.max(land, 0));
    if (land < 0 || td < 1) {
      check(false, `${name}: lands`);
      continue;
    }
    const style = landingStyleOf(run)?.previous;
    const last = recs[td - 1];
    // Contact: exact at the contact substep from the landing style when there is one, else the last airborne frame.
    const sink = style ? style.sink : -last.velocity[1];
    const speed = style ? style.speed : horizontal(last);
    const variant = style?.variant ?? 'n/a';
    variants.push(variant);
    // The flare: from the last approach frame pitched below 12° before the touchdown.
    let flare = td - 1;
    while (flare > land && recs[flare - 1].pitchDeg >= 12) {
      flare--;
    }
    let flarePitch = -Infinity;
    for (let k = flare; k < td; k++) {
      flarePitch = Math.max(flarePitch, recs[k].pitchDeg);
    }
    // The approach: its pitch must not be held constant (an aeroplane on a glide slope).
    const approach = recs.slice(land, flare).map((r) => r.pitchDeg);
    const ap = stats(approach.length > 0 ? approach : [0]);
    // Backstrokes: downstrokes (the beat phase wrapping, a real amplitude) in the flare while the ground speed still
    // brakes (slow: above 3 m/s).
    let backstrokes = 0;
    for (let k = Math.max(flare, 1); k < td && !(style && !slow); k++) {
      const wrapped = recs[k].pose.flapPhase < recs[k - 1].pose.flapPhase - 1;
      if (wrapped && recs[k].pose.flapAmplitude > 0.3 && (!slow || horizontal(recs[k]) > 3)) {
        backstrokes++;
      }
    }
    if (style && !slow) {
      // The run-out flare starts before the body pitches through 12°: the landing style counts its downstrokes.
      backstrokes = style.backstrokes;
    }
    // Velocity continuity from the positions (the body's own velocity is reset on a touchdown by design).
    let jump = 0;
    const k1 = Math.min(recs.length - 1, td + 2 * FPS);
    for (let k = land + 2; k <= k1; k++) {
      const a = recs[k].position;
      const b = recs[k - 1].position;
      const c = recs[k - 2].position;
      jump = Math.max(jump, Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1], a[2] - 2 * b[2] + c[2]) * FPS);
    }
    // First contact: the first frame from the flare on in which any part comes within 10 cm of the ground.
    let contact = contactOrder(run, td);
    for (let k = flare; k <= Math.min(recs.length - 1, td + FPS / 2); k++) {
      const c = contactOrder(run, k);
      if (Math.min(c.hind, c.fore, c.wing, c.tail) < 0.1) {
        contact = c;
        break;
      }
    }
    const feetFirst = contact.hind <= contact.fore && contact.hind <= contact.wing && contact.hind <= contact.tail;
    const low = lowestParts(run, recs[land].time, recs[k1].time, 2);
    const dust = run.rt.sim.eventCounts.dust ?? 0;
    const time = recs[td].time - recs[land].time;
    console.log(
      `  ${name.padEnd(13)} ${variant.padEnd(7)} ${f2(time)} s from L: contact sink ${f2(sink)} m/s, speed ${f2(speed)} m/s; flare pitch max ${flarePitch.toFixed(0)}°, approach pitch ${ap.min.toFixed(0)}..${ap.max.toFixed(0)}° (sd ${f2(ap.std)}°); backstrokes ${backstrokes}; first contact heights hind ${f2(contact.hind)} fore ${f2(contact.fore)} wing ${f2(contact.wing)} tail ${f2(contact.tail)} m; lowest wing ${f2(low.wing)} tail ${f2(low.tail)} m; largest per-frame velocity change ${f2(jump)} m/s; dust ${dust}`,
    );
    note(`landing.${name}.variant`, variant);
    note(`landing.${name}.time`, time);
    note(`landing.${name}.sink`, sink);
    note(`landing.${name}.speed`, speed);
    note(`landing.${name}.flarePitch`, flarePitch);
    note(`landing.${name}.approachPitchSd`, ap.std);
    note(`landing.${name}.approachPitchRange`, ap.max - ap.min);
    note(`landing.${name}.backstrokes`, backstrokes);
    note(`landing.${name}.jump`, jump);
    note(`landing.${name}.wing`, low.wing);
    note(`landing.${name}.tail`, low.tail);
    if (slow) {
      check(sink <= 1.5, `${name}: touchdown sink <= 1.5 m/s (${f2(sink)})`);
      check(speed <= 3, `${name}: ground speed at contact <= 3 m/s (${f2(speed)})`);
      check(flarePitch >= 40, `${name}: the flare pitches back >= 40° (${flarePitch.toFixed(0)}°)`);
      check(backstrokes >= 2, `${name}: >= 2 backstrokes before the contact (${backstrokes})`);
      check(ap.std >= 3 && ap.max - ap.min >= 10, `${name}: approach pitch not held constant (sd ${f2(ap.std)}° >= 3, range ${(ap.max - ap.min).toFixed(0)}° >= 10)`);
    } else {
      check(speed >= RUNOUT.minSpeed && speed <= RUNOUT.maxSpeed, `${name}: runs out (contact ${f2(speed)} m/s within ${RUNOUT.minSpeed}-${RUNOUT.maxSpeed})`);
      check(backstrokes >= 1 && flarePitch >= 10, `${name}: a short flare with a backstroke before the contact (${backstrokes}, pitch ${flarePitch.toFixed(0)}°)`);
    }
    check(feetFirst, `${name}: hind feet first (hind ${f2(contact.hind)} <= fore ${f2(contact.fore)}, below wing and tail)`);
    check(low.wing > -0.02 && low.tail > -0.02, `${name}: wings and tail never below the ground from L on (wing ${f2(low.wing)}${low.wing <= -0.02 ? ` at ${f2(low.frameWing - recs[td].time)} s from contact` : ''}, tail ${f2(low.tail)} m)`);
    check(jump <= 1.5, `${name}: no velocity jump (largest per-frame change ${f2(jump)} m/s <= 1.5)`);
  }
  // Variants: the scenarios above differ, and the picker never repeats one where another applies.
  const slowSeen = new Set(variants.slice(0, SLOW_LANDINGS.length));
  console.log(`  variants of the landings above: ${variants.join(', ')}`);
  if (variants.every((v) => v === 'n/a')) {
    check(false, 'landing variants (no landing style)');
    return;
  }
  check(slowSeen.size >= 3, `slow landings show >= 3 variants (${[...slowSeen].join(', ')})`);
  const rig = await buildRig();
  const rt = new PoseRuntime(rig, GROUND_Y);
  rt.teleport(0, GROUND_Y + 35, 0, 0, 20);
  const style = rt.sim.controller.landingStyle;
  const sequence = (runOut: boolean, clearance: number, stamina: number): string[] => {
    rt.sim.stamina = stamina;
    const out: string[] = [];
    for (let i = 0; i < 6; i++) {
      const v = style.pick(rt.sim, runOut, clearance);
      style.last = v;
      out.push(v);
    }
    return out;
  };
  for (const [label, seq] of [
    ['slow, 35 m', sequence(false, 35, 1)],
    ['slow, tired', sequence(false, 35, 0.2)],
    ['run-out', sequence(true, 8, 1)],
  ] as const) {
    const repeats = seq.some((v, i) => i > 0 && seq[i - 1] === v);
    console.log(`  ${label}: ${seq.join(', ')}`);
    check(!repeats && new Set(seq).size >= 2, `${label}: landing variants alternate, never the same twice in a row`);
  }
}

/* ------------------------------------------------------------------ */
/* 4. Leaps                                                             */
/* ------------------------------------------------------------------ */

async function leaps(): Promise<void> {
  console.log('\nLeaping take-offs (Space)');
  for (const name of ['leap', 'leap-run', 'leap-tired', 'leap-drop']) {
    const run = await scenario(name);
    const recs = run.records;
    const pressTime = name === 'leap-run' ? 4 : 1;
    const press = firstIndex(recs, (r) => r.time >= pressTime);
    const lift = firstIndex(recs, (r) => r.mode === 'takeoff', press);
    if (lift < 0) {
      check(false, `${name}: lifts off`);
      continue;
    }
    // Push-off: the frames before the lift-off where the body already rises.
    let push = lift;
    while (push > press && recs[push - 1].velocity[1] > 0.3) {
      push--;
    }
    const crouchTime = recs[push].time - recs[press].time;
    const pushTime = recs[lift].time - recs[push].time;
    let jump = 0;
    for (let k = press + 1; k <= Math.min(recs.length - 1, lift + 0.3 * FPS); k++) {
      const a = recs[k].velocity;
      const b = recs[k - 1].velocity;
      jump = Math.max(jump, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    // Downstrokes: the wing-beat phase wraps (top of the upstroke) with a full amplitude.
    const strokes: number[] = [];
    let firstStroke = NaN;
    for (let k = lift; k < recs.length && recs[k].time < recs[lift].time + 4; k++) {
      const prev = recs[k - 1].pose.flapPhase;
      const cur = recs[k].pose.flapPhase;
      if (cur < prev - 1) {
        strokes.push(recs[k].time - recs[lift].time);
        if (Number.isNaN(firstStroke) && recs[k].pose.flapAmplitude >= 0.85) {
          firstStroke = recs[k].time - recs[lift].time;
        }
      }
    }
    const tuckK = firstIndex(recs, (r) => r.pose.legsTuck > 0.05, lift);
    const tuckTime = tuckK >= 0 ? recs[tuckK].time - recs[lift].time : NaN;
    const strokesBeforeTuck = strokes.filter((t) => t < tuckTime).length;
    const variant = (run.rt.sim as unknown as { moves?: { lastVariant: string | null } }).moves?.lastVariant ?? 'n/a';
    // Height gained in the first second after lift-off (the leap itself, before sustained flapping).
    let apex = -Infinity;
    for (let k = lift; k < recs.length && recs[k].time < recs[lift].time + 1; k++) {
      apex = Math.max(apex, recs[k].position[1] - recs[press].position[1]);
    }
    console.log(`  ${name.padEnd(10)} rises ${f2(apex)} m in the first second after lift-off (upward speed at lift-off ${f2(recs[lift].velocity[1])} m/s)`);
    note(`${name}.rise1s`, apex);
    if (name === 'leap') {
      check(apex >= 5, `${name}: a powerful leap, >= 5 m up in the first second (${f2(apex)})`);
    }
    console.log(
      `  ${name.padEnd(10)} (${variant}) crouch ${f2(crouchTime)} s, push ${f2(pushTime)} s, largest per-frame velocity change ${f2(jump)} m/s, first full downstroke ${f2(firstStroke)} s after lift-off, legs tuck at ${f2(tuckTime)} s after ${strokesBeforeTuck} strokes`,
    );
    note(`${name}.crouch`, crouchTime);
    note(`${name}.push`, pushTime);
    note(`${name}.jump`, jump);
    note(`${name}.firstStroke`, firstStroke);
    note(`${name}.strokesBeforeTuck`, strokesBeforeTuck);
    if (name === 'leap') {
      check(crouchTime >= 0.6 && crouchTime <= 0.8, `${name}: crouch 0.6-0.8 s, a slow, deep gather (${f2(crouchTime)})`);
    }
    check(pushTime >= 0.11 && pushTime <= 0.24, `${name}: push-off 0.12-0.2 s (tired up to 0.23) (${f2(pushTime)})`);
    check(jump <= 3, `${name}: no velocity jump > 3 m/s in one frame (${f2(jump)})`);
    check(firstStroke <= 0.15, `${name}: first full downstroke <= 0.15 s after lift-off (${f2(firstStroke)})`);
    check(strokesBeforeTuck >= 2, `${name}: legs tuck only after the second stroke (${strokesBeforeTuck} strokes first)`);
    const low = lowestParts(run, recs[press].time, recs[lift].time + 1.2, 2);
    note(`${name}.wing`, low.wing);
    note(`${name}.tail`, low.tail);
    note(`${name}.feet`, low.feet);
    check(low.wing > -0.02 && low.tail > -0.02, `${name}: wings and tail stay above the ground (wing ${f2(low.wing)}, tail ${f2(low.tail)} m)`);
    check(low.feet > -0.03, `${name}: feet penetration < 3 cm (${f2(low.feet)} m${low.feet <= -0.03 ? ` ${low.boneFeet} at ${f2(low.frameFeet - recs[lift].time)} s from lift-off` : ''})`);
    if (low.wing <= -0.02) {
      console.log(`    lowest wing point at ${f2(low.frameWing - recs[lift].time)} s from lift-off`);
    }
  }
  // Variants never repeat where several apply: six standing leaps in a row.
  const rig = await buildRig();
  const rt = new PoseRuntime(rig, GROUND_Y);
  rt.stand(0, 0, 0);
  const moves = (rt.sim as unknown as { moves?: { lastVariant: string | null } }).moves;
  if (!moves) {
    console.log('  variants: n/a (no ground moves)');
    check(false, 'leap variants alternate');
    return;
  }
  const picked: string[] = [];
  const { pickVariant } = await import('../../src/dragon/flight/ground-moves');
  for (let i = 0; i < 6; i++) {
    const v = pickVariant(rt.sim);
    moves.lastVariant = v;
    picked.push(v);
  }
  const repeats = picked.some((v, i) => i > 0 && picked[i - 1] === v);
  console.log(`  standing leaps in a row: ${picked.join(', ')}`);
  check(!repeats, 'leap variants never repeat twice in a row');
}

/* ------------------------------------------------------------------ */
/* 5. Bank without roll input                                            */
/* ------------------------------------------------------------------ */

async function hoverBank(): Promise<void> {
  console.log('\nHover bank without roll input (brake held at 18 m/s, 60 m up)');
  for (const wind of [null, [4, 2] as const]) {
    const rig = await buildRig();
    const rt = new PoseRuntime(rig, GROUND_Y, false, undefined, wind);
    rt.teleport(0, GROUND_Y + 60, 0, 0, 18);
    const recs = rt.run({
      seconds: 9,
      renderFps: 30,
      script: (_t, _s, input) => {
        input.cmd.brake = true;
      },
    });
    let worst = 0;
    for (const r of recs) {
      if (r.time > 2 && r.mode === 'hovering') {
        worst = Math.max(worst, Math.abs(r.bankDeg));
      }
    }
    const label = wind ? 'crosswind 4.5 m/s (the old headless default)' : 'still air';
    console.log(`  ${label}: largest bank ${f2(worst)}°`);
    note(wind ? 'hover.bankWind' : 'hover.bankStill', worst);
    if (!wind) {
      check(worst <= 2, `hover in still air holds the wings level (${f2(worst)}° <= 2°)`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 6. Swimming (phase 21 stage 5)                                        */
/* ------------------------------------------------------------------ */

/** Sea runs: open water with the seabed `depth` m down (or shaped by `terrain`), the surface at y = 0, flat calm. */
async function simulateSea(setup: (rt: PoseRuntime) => void, seconds: number, script: FrameScript, depth = 30, terrain?: Terrain): Promise<Run> {
  const rig = await buildRig();
  const rt = new PoseRuntime(rig, -depth, true, terrain, null);
  setup(rt);
  const records = rt.run({ seconds, renderFps: FPS, script });
  const boneNames = rig.skel.bones.map((b) => b.name);
  const meshes = collectMeshes(rig.root, boneNames);
  const geo = rt.sim.world.geo!;
  return { records, meshes, boneNames, skel: rig.skel, ground: (x, z) => geo.heightAt(x, z), rt };
}

async function seaScenario(name: string): Promise<Run> {
  const s = scenarioByName(name);
  if (!s || s.sea === undefined) {
    throw new Error(`unknown sea scenario ${name}`);
  }
  return simulateSea((rt) => s.setup(rt), s.seconds, s.script(), s.sea, s.terrain);
}

interface SwimStats {
  frames: number;
  allSwimming: boolean;
  walkMax: number;
  /** Lowest point (m, relative to the water surface y = 0) of the rider's torso and head, and of the dragon's head. */
  riderLow: number;
  headLow: number;
  /** Highest point of the back (chest / root / lumbar bones) above the water, min and max over the window. */
  backLow: number;
  backHigh: number;
  /** Deepest wing point (membrane, fingers). */
  wingLow: number;
  /**
   * Stroke frequency (Hz, from the pose's swimPhase) and the tail tip's lateral sweep in the body frame at that
   * frequency (m: amplitude of its projection onto the stroke phase, so slow drifts do not count) with the share of the
   * sweep's variance the stroke explains.
   */
  tailFreq: number;
  tailAmp: number;
  tailFit: number;
  /** Wrist (hand bone head) height above the water, lowest and highest over the window, per wing (left, right). */
  wristLow: [number, number];
  wristHigh: [number, number];
  /** Rider's head (riderHead bone) in the body frame: vertical and lateral range (m). */
  riderRise: number;
  riderSway: number;
  /**
   * Horizontal speed: mean (m/s) and its surge at twice the stroke frequency (m/s: amplitude of the fit on sin / cos of
   * 2 x the stroke phase; one surge per wing stroke).
   */
  speedMean: number;
  surgeAmp: number;
  /** Every record finite (positions, velocities, skinning matrices). */
  finite: boolean;
}

function swimStats(run: Run, t0: number, t1: number): SwimStats {
  const rider: Array<[MeshData, number]> = [];
  const head: Array<[MeshData, number]> = [];
  const back: Array<[MeshData, number]> = [];
  const wing: Array<[MeshData, number]> = [];
  let tip: [MeshData, number] | null = null;
  let tipZ = -Infinity;
  for (const m of run.meshes) {
    for (let i = 0; i < m.count; i++) {
      const bone = run.boneNames[m.dominant[i]] ?? '';
      if (m.kind === 'rider') {
        if (/^rider(Spine|Chest|Head)$/.test(bone)) {
          rider.push([m, i]);
        }
      } else if (m.kind === 'membrane') {
        if (i % 2 === 0) {
          wing.push([m, i]);
        }
      } else if (bone === 'head' || bone === 'jaw') {
        head.push([m, i]);
      } else if (bone === 'chest' || bone === 'root' || bone === 'lumbar') {
        back.push([m, i]);
      } else if (bone.startsWith('finger')) {
        wing.push([m, i]);
      } else if (bone === 'tail13' && m.position[i * 3 + 2] > tipZ) {
        tipZ = m.position[i * 3 + 2];
        tip = [m, i];
      }
    }
  }
  const p = new Float32Array(3);
  const lowest = (list: Array<[MeshData, number]>, r: FrameRecord): number => {
    let low = Infinity;
    for (const [m, i] of list) {
      skinVertex(m, i, r, p, 0);
      low = Math.min(low, p[1]);
    }
    return low;
  };
  const highest = (list: Array<[MeshData, number]>, r: FrameRecord): number => {
    let high = -Infinity;
    for (const [m, i] of list) {
      skinVertex(m, i, r, p, 0);
      high = Math.max(high, p[1]);
    }
    return high;
  };
  const out: SwimStats = {
    frames: 0,
    allSwimming: true,
    walkMax: 0,
    riderLow: Infinity,
    headLow: Infinity,
    backLow: Infinity,
    backHigh: -Infinity,
    wingLow: Infinity,
    tailFreq: 0,
    tailAmp: 0,
    tailFit: 0,
    wristLow: [Infinity, Infinity],
    wristHigh: [-Infinity, -Infinity],
    riderRise: 0,
    riderSway: 0,
    speedMean: 0,
    surgeAmp: 0,
    finite: true,
  };
  const lateral: number[] = [];
  const times: number[] = [];
  const phases: number[] = [];
  const speeds: number[] = [];
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const skel = run.skel;
  const wristIds = [skel.id('handL'), skel.id('handR')];
  const riderHeadId = skel.id('riderHead');
  const boneHead = (id: number, r: FrameRecord): THREE.Vector3 => v.copy(skel.restHeads[id]).applyMatrix4(m4.fromArray(r.bones, id * 16));
  const riderMin = [Infinity, Infinity];
  const riderMax = [-Infinity, -Infinity];
  for (let k = 0; k < run.records.length; k++) {
    const r = run.records[k];
    if (r.time < t0 || r.time > t1) {
      continue;
    }
    out.frames++;
    out.allSwimming &&= r.mode === 'swimming';
    out.walkMax = Math.max(out.walkMax, r.pose.walkAmount ?? 0);
    out.finite &&= r.position.every(Number.isFinite) && r.velocity.every(Number.isFinite) && r.bones.every(Number.isFinite);
    speeds.push(Math.hypot(r.velocity[0], r.velocity[2]));
    for (let w = 0; w < 2; w++) {
      const y = boneHead(wristIds[w], r).y;
      out.wristLow[w] = Math.min(out.wristLow[w], y);
      out.wristHigh[w] = Math.max(out.wristHigh[w], y);
    }
    q.set(r.quaternion[0], r.quaternion[1], r.quaternion[2], r.quaternion[3]).invert();
    boneHead(riderHeadId, r).sub(new THREE.Vector3(r.position[0], r.position[1], r.position[2])).applyQuaternion(q);
    riderMin[0] = Math.min(riderMin[0], v.x);
    riderMin[1] = Math.min(riderMin[1], v.y);
    riderMax[0] = Math.max(riderMax[0], v.x);
    riderMax[1] = Math.max(riderMax[1], v.y);
    if (tip) {
      skinVertex(tip[0], tip[1], r, p, 0);
      q.set(r.quaternion[0], r.quaternion[1], r.quaternion[2], r.quaternion[3]).invert();
      v.set(p[0] - r.position[0], p[1] - r.position[1], p[2] - r.position[2]).applyQuaternion(q);
      lateral.push(v.x);
      times.push(r.time);
      phases.push(r.pose.swimPhase ?? 0);
    }
    if (k % 3 !== 0) {
      continue;
    }
    out.riderLow = Math.min(out.riderLow, lowest(rider, r));
    out.headLow = Math.min(out.headLow, lowest(head, r));
    const top = highest(back, r);
    out.backLow = Math.min(out.backLow, top);
    out.backHigh = Math.max(out.backHigh, top);
    out.wingLow = Math.min(out.wingLow, lowest(wing, r));
  }
  if (lateral.length > 2) {
    // Unwrapped stroke phase -> frequency.
    let turns = 0;
    for (let k = 1; k < phases.length; k++) {
      let d = phases[k] - phases[k - 1];
      if (d < -Math.PI) {
        d += 2 * Math.PI;
      }
      turns += d / (2 * Math.PI);
    }
    out.tailFreq = turns / (times[times.length - 1] - times[0]);
    // Least squares of the (mean-free) lateral sweep on sin / cos of the stroke phase.
    const mean = lateral.reduce((a, b) => a + b, 0) / lateral.length;
    let ss = 0;
    let sc = 0;
    let s2 = 0;
    let c2 = 0;
    let sxc = 0;
    let total = 0;
    for (let k = 0; k < lateral.length; k++) {
      const x = lateral[k] - mean;
      const sn = Math.sin(phases[k]);
      const cs = Math.cos(phases[k]);
      ss += x * sn;
      sc += x * cs;
      s2 += sn * sn;
      c2 += cs * cs;
      sxc += sn * cs;
      total += x * x;
    }
    const det = s2 * c2 - sxc * sxc;
    const a = det > 1e-9 ? (ss * c2 - sc * sxc) / det : 0;
    const b = det > 1e-9 ? (sc * s2 - ss * sxc) / det : 0;
    out.tailAmp = Math.hypot(a, b);
    out.tailFit = total > 0 ? (a * ss + b * sc) / total : 0;
    // The speed's surge: its fit on sin / cos of twice the stroke phase (two power strokes per cycle).
    out.speedMean = speeds.reduce((x, y) => x + y, 0) / speeds.length;
    out.surgeAmp = fitAmplitude(
      speeds,
      phases.map((ph) => 2 * ph),
    );
  }
  out.riderSway = riderMax[0] - riderMin[0];
  out.riderRise = riderMax[1] - riderMin[1];
  return out;
}

/** Amplitude of the least-squares fit of the (mean-free) samples on sin / cos of the given phases. */
function fitAmplitude(samples: readonly number[], phases: readonly number[]): number {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  let ss = 0;
  let sc = 0;
  let s2 = 0;
  let c2 = 0;
  let sxc = 0;
  for (let k = 0; k < samples.length; k++) {
    const x = samples[k] - mean;
    const sn = Math.sin(phases[k]);
    const cs = Math.cos(phases[k]);
    ss += x * sn;
    sc += x * cs;
    s2 += sn * sn;
    c2 += cs * cs;
    sxc += sn * cs;
  }
  const det = s2 * c2 - sxc * sxc;
  if (det <= 1e-9) {
    return 0;
  }
  return Math.hypot((ss * c2 - sc * sxc) / det, (sc * s2 - ss * sxc) / det);
}

async function swimming(): Promise<void> {
  console.log('\nSwimming (calm sea, surface y = 0; 5 s windows at steady speed)');
  const surge = (params.SWIM_POSE as unknown as { surge?: number }).surge ?? 0;
  const cases: Array<[string, string, number]> = [
    ['swim-idle', 'floating', 0],
    ['swim', 'swim (W)', params.SWIM.paddleSpeed],
    ['swim-fast', 'fast swim (W + Shift)', params.SWIM.fastSpeed],
  ];
  const stats: SwimStats[] = [];
  for (const [name, label, target] of cases) {
    const run = await seaScenario(name);
    const s = scenarioByName(name)!;
    const t0 = s.window(run.records);
    const st = swimStats(run, t0, t0 + 5);
    stats.push(st);
    const wr = (w: number): string => `${f2(st.wristLow[w])}..${f2(st.wristHigh[w])}`;
    console.log(
      `  ${label}: walk ${f2(st.walkMax)}, rider low ${f2(st.riderLow)} m, head low ${f2(st.headLow)} m, back top ${f2(st.backLow)}..${f2(st.backHigh)} m, wing low ${f2(st.wingLow)} m, stroke ${f2(st.tailFreq)} Hz, tail tip ±${f2(st.tailAmp)} m at it (explains ${(st.tailFit * 100).toFixed(0)} %)`,
    );
    console.log(
      `    wrists L ${wr(0)} m / R ${wr(1)} m above the water, rider head moves ${f2(st.riderRise)} m up-down / ${f2(st.riderSway)} m sideways, speed ${f2(st.speedMean)} m/s surging ±${f2(st.surgeAmp)} m/s per stroke`,
    );
    note(`swim.${name}.walkMax`, st.walkMax);
    note(`swim.${name}.riderLow`, st.riderLow);
    note(`swim.${name}.headLow`, st.headLow);
    note(`swim.${name}.backLow`, st.backLow);
    note(`swim.${name}.backHigh`, st.backHigh);
    note(`swim.${name}.wingLow`, st.wingLow);
    note(`swim.${name}.tailFreq`, st.tailFreq);
    note(`swim.${name}.tailAmp`, st.tailAmp);
    note(`swim.${name}.wristLow`, Math.min(...st.wristLow));
    note(`swim.${name}.wristHigh`, Math.min(...st.wristHigh));
    note(`swim.${name}.riderRise`, st.riderRise);
    note(`swim.${name}.riderSway`, st.riderSway);
    note(`swim.${name}.speedMean`, st.speedMean);
    note(`swim.${name}.surgeAmp`, st.surgeAmp);
    check(st.finite, `${label}: no NaN or infinite values in the body state or the skinning`);
    // Visible stroke spray (no sound events): the catch and lift-out of each wing, and the tail churn when fast.
    const sprays = (run.rt.sim as unknown as { eventCounts: Record<string, number> }).eventCounts.spray ?? 0;
    const splashes = (run.rt.sim as unknown as { eventCounts: Record<string, number> }).eventCounts.splash ?? 0;
    console.log(`    stroke spray events ${sprays}, splash events ${splashes}`);
    note(`swim.${name}.sprays`, sprays);
    if (target > 0) {
      check(sprays >= 8, `${label}: the wing strokes throw visible spray (${sprays} spray events >= 8)`);
    }
    check(st.allSwimming && st.walkMax < 0.01, `${label}: swimming, no walk cycle (walkAmount max ${f2(st.walkMax)} < 0.01)`);
    check(st.riderLow > 0.05, `${label}: rider's torso and head above the water (lowest ${f2(st.riderLow)} m > 0.05)`);
    check(st.headLow > 0.8, `${label}: head above the water (lowest ${f2(st.headLow)} m > 0.8)`);
    check(st.backLow > 0.25 && st.backHigh < 0.9, `${label}: waterline along the back (back top ${f2(st.backLow)}..${f2(st.backHigh)} m within 0.25..0.9)`);
    check(st.wingLow > -2.2, `${label}: wings never deeper than 2.2 m (${f2(st.wingLow)} m)`);
    check(st.riderRise < 0.32 && st.riderSway < 0.55, `${label}: rider's head steady enough (${f2(st.riderRise)} m < 0.32 up-down, ${f2(st.riderSway)} m < 0.55 sideways)`);
    const wristLow = Math.min(...st.wristLow);
    const wristHigh = Math.min(...st.wristHigh);
    const wristRange = Math.min(st.wristHigh[0] - st.wristLow[0], st.wristHigh[1] - st.wristLow[1]);
    if (target > 0) {
      check(
        wristLow > -0.5 && wristLow < 0.45 && wristHigh > 1.2 && wristRange > 1.0,
        `${label}: both wings paddle at the surface and recover above it (wrists down to ${f2(wristLow)} m within -0.5..0.45, up to ${f2(wristHigh)} m > 1.2, range ${f2(wristRange)} m > 1)`,
      );
      check(Math.abs(st.speedMean - target) < 0.04 * target, `${label}: mean speed unchanged by the surge (${f2(st.speedMean)} m/s vs ${f2(target)} ± 4 %)`);
      check(
        st.surgeAmp > 0.6 * surge * target && st.surgeAmp < 1.4 * surge * target,
        `${label}: speed surges with each wing stroke (±${f2(st.surgeAmp)} m/s, expected ±${f2(surge * target)} ± 40 %)`,
      );
    } else {
      check(wristRange > 0.08 && wristHigh < 1.3, `${label}: lazy sculls, wings moving but mostly folded (wrist range ${f2(wristRange)} m > 0.08, top ${f2(wristHigh)} m < 1.3)`);
    }
  }
  const [idle, swim, fast] = stats;
  check(
    idle.tailFreq > 0 && idle.tailFreq < swim.tailFreq && swim.tailFreq * 1.3 < fast.tailFreq,
    `stroke frequency scales with speed (${f2(idle.tailFreq)} < ${f2(swim.tailFreq)} < ${f2(fast.tailFreq)} Hz)`,
  );
  check(
    idle.tailAmp > 0.3 && idle.tailAmp < 1.4 && swim.tailAmp > 1.5 && swim.tailAmp < 2.5 && fast.tailAmp > swim.tailAmp + 0.3 && fast.tailAmp < 4,
    `tail tip sweep: floating ±${f2(idle.tailAmp)} m (0.3..1.4), swim ±${f2(swim.tailAmp)} m (1.5..2.5), fast ±${f2(fast.tailAmp)} m (> swim + 0.3, < 4)`,
  );
  check(swim.tailFit > 0.6 && fast.tailFit > 0.6, `the tail sweeps at the stroke frequency (explains ${(swim.tailFit * 100).toFixed(0)} % / ${(fast.tailFit * 100).toFixed(0)} % of its sweep)`);
  const top = (st: SwimStats): number => Math.max(...st.wristHigh);
  check(top(fast) > top(swim) - 0.05 && top(swim) > top(idle) + 0.3, `the wing strokes grow with speed (wrist tops ${f2(top(idle))} < ${f2(top(swim))} <= ${f2(top(fast))} m)`);

  // Turning: the outer wing strokes harder (its wrist loop spans more).
  {
    const run = await seaScenario('swim-turn');
    const st = swimStats(run, 7, 11);
    // D held: a right turn, the left wing is the outer one.
    const spanL = st.wristHigh[0] - st.wristLow[0];
    const spanR = st.wristHigh[1] - st.wristLow[1];
    console.log(`  right turn: wrist loop heights L ${f2(spanL)} m / R ${f2(spanR)} m, tail tip ±${f2(st.tailAmp)} m, rider head ${f2(st.riderRise)} m up-down`);
    note('swim.turn.outerSpan', spanL);
    note('swim.turn.innerSpan', spanR);
    check(st.finite && st.allSwimming, 'swimming turn: still swimming, all values finite');
    check(spanL > spanR * 1.15, `swimming turn: the outer wing strokes harder (outer ${f2(spanL)} m > inner ${f2(spanR)} m × 1.15)`);
  }

  // A slow landing onto the water (L): settles into the float with no walk cycle.
  {
    const run = await seaScenario('land-on-water');
    const recs = run.records;
    const k0 = firstIndex(recs, (r) => r.mode === 'swimming');
    let walk = 0;
    const modes = new Set<string>();
    for (let k = Math.max(0, k0); k < recs.length; k++) {
      walk = Math.max(walk, recs[k].pose.walkAmount ?? 0);
      modes.add(recs[k].mode);
    }
    const c = continuity(recs, k0, k0 + FPS * 3);
    const settled = k0 >= 0 ? swimStats(run, recs[k0].time + 3, recs[k0].time + 6) : null;
    console.log(
      `  slow L landing: swimming after ${k0 >= 0 ? f2(recs[k0].time) : 'never'} s, walk after it ${f2(walk)}, modes after ${[...modes].join('/')}, per-frame dy ${f2(c.dy)} m, pitch ${f2(c.dPitch)}°`,
    );
    note('swim.land.walkMax', walk);
    note('swim.land.dPitch', c.dPitch);
    check(k0 >= 0 && walk < 0.01 && modes.size === 1, `slow L landing on water ends swimming with no walk cycle (walkAmount ${f2(walk)})`);
    check(c.dPitch < 1.5 && c.dy < 0.06, `landing settles smoothly (per frame: pitch ${f2(c.dPitch)}° < 1.5, height ${f2(c.dy)} m < 0.06)`);
    check(!!settled && settled.riderLow > 0.05 && settled.headLow > 0.3, `settled float after the landing: rider and head above the water`);
  }

  // Water take-off: Space while floating, the run, the leap, climbing away.
  {
    const run = await seaScenario('water-takeoff');
    const recs = run.records;
    const k0 = firstIndex(recs, (r) => r.mode === 'takeoff');
    const kUp = firstIndex(recs, (r) => r.position[1] > 4 && r.mode !== 'swimming');
    const run0 = firstIndex(recs, (r) => r.time >= 2);
    const runLen = k0 >= 0 && run0 >= 0 ? recs[k0].time - recs[run0].time : NaN;
    const end = recs[recs.length - 1];
    console.log(`  water take-off: run ${f2(runLen)} s, leaves the water at ${k0 >= 0 ? f2(recs[k0].groundSpeed) : 'n/a'} m/s, 4 m up after ${kUp >= 0 ? f2(recs[kUp].time - 2) : 'never'} s, end ${end.mode} at ${f2(end.position[1])} m`);
    note('swim.takeoff.run', runLen);
    check(k0 >= 0 && runLen > 0.8 && runLen < 2, `water take-off runs on the surface first (${f2(runLen)} s within 0.8..2)`);
    check(kUp >= 0 && recs[kUp].time - 2 < 4 && end.mode !== 'swimming' && end.position[1] > 4, `water take-off lifts off (4 m up within 4 s of Space, ${end.mode} at ${f2(end.position[1])} m)`);
  }

  // Shore: swimming in, the feet reach the seabed, wading out; walking back into deep water floats again.
  {
    const run = await seaScenario('wade');
    const recs = run.records;
    const k0 = firstIndex(recs, (r) => r.mode === 'grounded');
    let switches = 0;
    for (let k = 1; k < recs.length; k++) {
      switches += recs[k].mode !== recs[k - 1].mode ? 1 : 0;
    }
    const depth = k0 >= 0 ? -run.ground(recs[k0].position[0], recs[k0].position[2]) : NaN;
    const c = continuity(recs, k0 - 5, k0 + FPS);
    const walking = k0 >= 0 ? Math.max(...recs.slice(k0 + FPS, k0 + FPS * 3).map((r) => r.pose.walkAmount ?? 0)) : 0;
    // Before the switch (the test shore's geo reports a flat normal, so the planted feet on its slope are not measured).
    const low = k0 >= 0 ? lowestParts(run, recs[k0].time - 3, recs[k0].time, 3) : null;
    console.log(
      `  wading in: grounded at seabed depth ${f2(depth)} m, ${switches} mode switch(es), per-frame dy ${f2(c.dy)} m, walk ${f2(walking)}, feet low ${low ? f2(low.feet) : 'n/a'} m above the seabed`,
    );
    note('swim.wade.depth', depth);
    check(k0 >= 0 && switches === 1 && depth > 1.8 && depth < 3, `swimming toward a shore switches to wading once (seabed ${f2(depth)} m, ${switches} switch)`);
    check(walking > 0.5 && c.dy < 0.08, `wading walks on the seabed (walk ${f2(walking)}), no height jump (${f2(c.dy)} m)`);
    check(!!low && low.feet > -0.25, `kicking feet stay out of the seabed before the switch (${low ? f2(low.feet) : 'n/a'} m)`);

    const s = scenarioByName('wade')!;
    const back = await simulateSea(
      (rt) => rt.stand(0, -48, 180),
      14,
      (t, _sim, input) => {
        input.cmd.pitch = t >= 1 ? 1 : 0;
      },
      s.sea,
      s.terrain,
    );
    const kb = firstIndex(back.records, (r) => r.mode === 'swimming');
    let sw2 = 0;
    for (let k = 1; k < back.records.length; k++) {
      sw2 += back.records[k].mode !== back.records[k - 1].mode ? 1 : 0;
    }
    const d2 = kb >= 0 ? -back.ground(back.records[kb].position[0], back.records[kb].position[2]) : NaN;
    console.log(`  wading out: swimming at seabed depth ${f2(d2)} m, ${sw2} mode switch(es)`);
    check(kb >= 0 && sw2 === 1 && d2 > 3, `walking into deep water starts swimming once (seabed ${f2(d2)} m, ${sw2} switch)`);
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  // --swim: only the swimming section.
  if (process.argv.includes('--landing')) {
    await touchdowns();
    await runOut();
    await landings();
  } else if (!process.argv.includes('--swim')) {
    await gaits();
    await touchdowns();
    await runOut();
    await landings();
    await leaps();
    await hoverBank();
  }
  if (!process.argv.includes('--landing')) {
    await swimming();
  }
  console.log(`\n${failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILED`} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const jsonAt = process.argv.indexOf('--json');
  if (jsonAt >= 0 && process.argv[jsonAt + 1]) {
    writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ results, failures }, null, 1));
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
