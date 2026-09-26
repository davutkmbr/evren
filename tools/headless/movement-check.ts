/**
 * Phase 20 stage A movement check, headless (no browser, no GPU): the real rig driven by the real FlightSim and
 * PoseDriver (tools/headless/pose/runtime.ts) through scripted ground scenarios, measured on the skinned mesh.
 *
 *   npx tsx tools/headless/movement-check.ts            # table of numbers, exits 1 when one fails
 *   npx tsx tools/headless/movement-check.ts --json f   # also write the numbers to f
 *   npx tsx tools/headless/movement-check.ts --swim     # only the swimming section
 *
 * Everything is measured from the per-frame records (60 fps render frames, 120 Hz physics), so the same check runs
 * against older code for before / after numbers:
 *   - gaits (walk, trot, gallop): median slip of a planted foot (< 0.15 m/s), hind foot lift, planted share and the
 *     gallop's suspension (no foot planted);
 *   - touchdowns (slow landing, fast landing, run-out): largest per-frame height and pitch change, foot penetration,
 *     wings and tail never below the ground;
 *   - run-out: stop distance without and with the brake against the distance the RUNOUT parameters predict;
 *   - touch-and-go: ground speed kept through the fly-out (>= 70 %);
 *   - leaps (standing, running, tired, off an edge): crouch and push-off durations, no velocity jump > 3 m/s in one
 *     frame, first full downstroke within 0.15 s of lift-off, legs tucked only after the second stroke;
 *   - hover in still air: no bank without roll input;
 *   - swimming (calm sea): no walk cycle, rider and head above the water, the waterline along the back, wings folded,
 *     the tail's undulation frequency and amplitude growing with speed; a slow L landing settling into the float with
 *     no walk cycle; the water take-off run lifting off; wading in at a shore and floating again walking out.
 */
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import * as params from '../../src/dragon/flight/params';
import { footStats, trackFeet, type FootTrack } from './pose/contacts';
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
  return { records, meshes, boneNames, ground: (x, z) => geo.heightAt(x, z), rt };
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

type PartName = 'wing' | 'tail' | 'feet';

/** Vertex lists per part: membrane (wings), body vertices on tail bones, body vertices on the feet and wrist claws. */
function partVertices(run: Run): Record<PartName, Array<[MeshData, number]>> {
  const parts: Record<PartName, Array<[MeshData, number]>> = { wing: [], tail: [], feet: [] };
  for (const m of run.meshes) {
    if (m.kind === 'membrane') {
      for (let i = 0; i < m.count; i += 2) {
        parts.wing.push([m, i]);
      }
    } else if (m.kind === 'body') {
      for (let i = 0; i < m.count; i++) {
        const bone = run.boneNames[m.dominant[i]] ?? '';
        if (bone.startsWith('tail')) {
          if (i % 2 === 0) {
            parts.tail.push([m, i]);
          }
        } else if (/^(foot|thumb)/.test(bone)) {
          parts.feet.push([m, i]);
        }
      }
    }
  }
  return parts;
}

/** Lowest height (m) above the ground of each part over the records in [t0, t1], every `step` frames. */
function lowestParts(run: Run, t0: number, t1: number, step = 2): Record<PartName, number> & { frameWing: number; frameTail: number; frameFeet: number; boneFeet: string } {
  const parts = partVertices(run);
  const out = { wing: Infinity, tail: Infinity, feet: Infinity, frameWing: 0, frameTail: 0, frameFeet: 0, boneFeet: '' };
  const p = new Float32Array(3);
  for (let k = 0; k < run.records.length; k += step) {
    const r = run.records[k];
    if (r.time < t0 || r.time > t1) {
      continue;
    }
    for (const name of ['wing', 'tail', 'feet'] as PartName[]) {
      for (const [m, i] of parts[name]) {
        skinVertex(m, i, r, p, 0);
        const h = p[1] - run.ground(p[0], p[2]);
        if (h < out[name]) {
          out[name] = h;
          if (name === 'wing') {
            out.frameWing = r.time;
          } else if (name === 'tail') {
            out.frameTail = r.time;
          } else {
            out.frameFeet = r.time;
            out.boneFeet = run.boneNames[m.dominant[i]] ?? '';
          }
        }
      }
    }
  }
  return out;
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
  console.log(`  run-out towards an edge at 100 m: ${atEdge ? `leapt at ${f2(horizontal(atEdge))} m/s, ${f2(100 - edgeDistance)} m before the edge` : 'no leap'}`);
  note('runoutEdge.leapt', atEdge !== null && edgeDistance < 100);
  check(atEdge !== null && edgeDistance < 100 && atEdge.velocity[1] > 1, 'run-out towards an edge: leaps on its own before the edge');
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
  return { records, meshes, boneNames, ground: (x, z) => geo.heightAt(x, z), rt };
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
  const out: SwimStats = { frames: 0, allSwimming: true, walkMax: 0, riderLow: Infinity, headLow: Infinity, backLow: Infinity, backHigh: -Infinity, wingLow: Infinity, tailFreq: 0, tailAmp: 0, tailFit: 0 };
  const lateral: number[] = [];
  const times: number[] = [];
  const phases: number[] = [];
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  for (let k = 0; k < run.records.length; k++) {
    const r = run.records[k];
    if (r.time < t0 || r.time > t1) {
      continue;
    }
    out.frames++;
    out.allSwimming &&= r.mode === 'swimming';
    out.walkMax = Math.max(out.walkMax, r.pose.walkAmount ?? 0);
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
  }
  return out;
}

async function swimming(): Promise<void> {
  console.log('\nSwimming (calm sea, surface y = 0; 5 s windows at steady speed)');
  const cases: Array<[string, string]> = [
    ['swim-idle', 'floating'],
    ['swim', 'swim (W)'],
    ['swim-fast', 'fast swim (W + Shift)'],
  ];
  const stats: SwimStats[] = [];
  for (const [name, label] of cases) {
    const run = await seaScenario(name);
    const s = scenarioByName(name)!;
    const t0 = s.window(run.records);
    const st = swimStats(run, t0, t0 + 5);
    stats.push(st);
    console.log(
      `  ${label}: walk ${f2(st.walkMax)}, rider low ${f2(st.riderLow)} m, head low ${f2(st.headLow)} m, back top ${f2(st.backLow)}..${f2(st.backHigh)} m, wing low ${f2(st.wingLow)} m, stroke ${f2(st.tailFreq)} Hz, tail tip ±${f2(st.tailAmp)} m at it (explains ${(st.tailFit * 100).toFixed(0)} %)`,
    );
    note(`swim.${name}.walkMax`, st.walkMax);
    note(`swim.${name}.riderLow`, st.riderLow);
    note(`swim.${name}.headLow`, st.headLow);
    note(`swim.${name}.backLow`, st.backLow);
    note(`swim.${name}.backHigh`, st.backHigh);
    note(`swim.${name}.wingLow`, st.wingLow);
    note(`swim.${name}.tailFreq`, st.tailFreq);
    note(`swim.${name}.tailAmp`, st.tailAmp);
    check(st.allSwimming && st.walkMax < 0.01, `${label}: swimming, no walk cycle (walkAmount max ${f2(st.walkMax)} < 0.01)`);
    check(st.riderLow > 0.05, `${label}: rider's torso and head above the water (lowest ${f2(st.riderLow)} m > 0.05)`);
    check(st.headLow > 0.3, `${label}: head above the water (lowest ${f2(st.headLow)} m > 0.3)`);
    check(st.backLow > -0.1 && st.backHigh < 0.7, `${label}: waterline along the back (back top ${f2(st.backLow)}..${f2(st.backHigh)} m within -0.1..0.7)`);
    check(st.wingLow > -0.8, `${label}: wings folded, tips no deeper than 0.8 m (${f2(st.wingLow)} m)`);
  }
  const [idle, swim, fast] = stats;
  check(
    idle.tailFreq > 0 && idle.tailFreq < swim.tailFreq && swim.tailFreq * 1.3 < fast.tailFreq,
    `undulation frequency scales with speed (${f2(idle.tailFreq)} < ${f2(swim.tailFreq)} < ${f2(fast.tailFreq)} Hz)`,
  );
  check(idle.tailAmp < swim.tailAmp && swim.tailAmp < fast.tailAmp, `undulation amplitude grows with speed (±${f2(idle.tailAmp)} < ±${f2(swim.tailAmp)} < ±${f2(fast.tailAmp)} m)`);
  check(swim.tailFit > 0.6 && fast.tailFit > 0.6, `the tail sweeps at the stroke frequency (explains ${(swim.tailFit * 100).toFixed(0)} % / ${(fast.tailFit * 100).toFixed(0)} % of its sweep)`);

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
  if (!process.argv.includes('--swim')) {
    await gaits();
    await touchdowns();
    await runOut();
    await leaps();
    await hoverBank();
  }
  await swimming();
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
