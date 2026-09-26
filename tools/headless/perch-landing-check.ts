/**
 * Perch landing check (phase 03), headless: the real FlightSim + PoseDriver + rig (tools/headless/pose/runtime.ts)
 * over the real terrain with the colliders of every perch landmark (perch-scene.ts), driven like the game drives it
 * (the L press when the prompt offers the perch, the stick to abort, Space to leave).
 *
 *   npx tsx tools/headless/perch-landing-check.ts               # every perch, exits 1 when one fails
 *   npx tsx tools/headless/perch-landing-check.ts --perch galata-kulesi [--verbose]
 *   npx tsx tools/headless/perch-landing-check.ts --quick       # one start per perch, no mesh penetration test
 *
 * Per perch:
 *   - guided approaches from three starts (a fast straight-in approach from behind, a crossing approach from the
 *     side, a slow hover that has to turn): the prompt offers the perch, L lands it, the settled dragon is within
 *     0.5 m of the perch pose (the stance's feet on the grip point: horizontal offset and the height of the feet
 *     plane over the grip) and 10° of its heading;
 *   - the flown approach keeps the rig's clearance spheres clear of every collider and the terrain (the same spheres
 *     the planner checks), and no skinned vertex of the body, wings or tail enters a collider or the ground (feet may
 *     press 0.3 m into the grip surface);
 *   - an approach aborted with the stick returns to free flight at once;
 *   - Space leaves the perch with the drop take-off: airborne and controllable within 2 s, clear of the structure
 *     (spheres and skinned mesh) until 14 m away;
 *   - the perch camera (src/camera/modes/perch-rig.ts) runs 100 s in both styles: the eye never in geometry, the
 *     dragon visible and framed in the lower part of the frame, the view open from the searched placement;
 * plus the prompt state machine on synthetic states (reach / cone / speed / height, hysteresis).
 */
import * as THREE from 'three';
import type { CollisionWorld } from '../../src/core/collision';
import type { PerchPoint } from '../../src/core/contracts';
import { CameraCollision } from '../../src/camera/obstruction';
import { PERCH_CAMERA, PerchCameraRig } from '../../src/camera/modes/perch-rig';
import { createPose } from '../../src/camera/types';
import { DEG } from '../../src/dragon/flight/params';
import { perchStance, perchTouchdown, visitPerchSpheres } from '../../src/dragon/flight/perch';
import type { FlightSim } from '../../src/dragon/flight/sim';
import { partVertices } from './pose/parts';
import { collectMeshes, skinVertex, type MeshData } from './pose/raster';
import { buildRig, PoseRuntime, type FrameInput, type FrameRecord } from './pose/runtime';
import { buildPerchScene, type PerchScene } from './perch-scene';

const FPS = 60;
const POS_TOL = 0.5;
const HEADING_TOL = 10;
const FEET_PRESS = 0.3;
const MESH_PRESS = 0.05;

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const verbose = args.includes('--verbose');
const only = args.includes('--perch') ? args[args.indexOf('--perch') + 1] : null;
/** --dump t0 t1: print the telemetry of every landing run between t0 and t1 (s). */
const dump = args.includes('--dump') ? [Number(args[args.indexOf('--dump') + 1]), Number(args[args.indexOf('--dump') + 2])] : null;

const failures: string[] = [];
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : 'n/a');

function check(ok: boolean, label: string): boolean {
  if (!ok || verbose) {
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  }
  if (!ok) {
    failures.push(label);
  }
  return ok;
}

interface FrameLog {
  phase: string;
  mode: string;
  offer: string | null;
  owned: boolean;
}

interface Run {
  records: FrameRecord[];
  /** Perch state after the frame of the record with the same index. */
  log: FrameLog[];
  meshes: MeshData[];
  boneNames: string[];
  sim: FlightSim;
  events: { pressed: number; perched: number; left: number; airborne: number };
}

type Script = (t: number, sim: FlightSim, input: FrameInput, run: Run) => void;

async function simulate(scene: PerchScene, world: CollisionWorld, place: (rt: PoseRuntime) => void, seconds: number, script: Script, stop?: (sim: FlightSim, t: number) => boolean): Promise<Run> {
  const rig = await buildRig();
  const rt = new PoseRuntime(rig, 0, false, undefined, null);
  rt.sim.world.collision = world;
  rt.sim.world.geo = scene.geo;
  rt.sim.perch.setPoints(scene.perches.points);
  place(rt);
  const run: Run = { records: [], log: [], meshes: [], boneNames: rig.skel.bones.map((b) => b.name), sim: rt.sim, events: { pressed: -1, perched: -1, left: -1, airborne: -1 } };
  const logState = (): void => {
    const p = rt.sim.perch;
    run.log.push({ phase: p.phase, mode: rt.sim.mode, offer: p.offer?.id ?? null, owned: p.phase === 'approach' || p.phase === 'perched' });
  };
  let stopped = false;
  const records = rt.run({
    seconds,
    renderFps: FPS,
    script: (t, sim, input) => {
      logState();
      if (stopped || stop?.(sim, t)) {
        stopped = true;
        return;
      }
      script(t, sim, input, run);
    },
  });
  logState();
  run.records = records;
  run.meshes = collectMeshes(rig.root, run.boneNames);
  return run;
}

/** Deepest penetration of the clearance spheres into the world over records [i0, i1] (m; <= 0 = clear). */
function sphereDepth(world: CollisionWorld, run: Run, i0: number, i1: number, wingsFrom: (i: number) => boolean): { depth: number; at: number; what: string } {
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const contact = { normal: new THREE.Vector3(), depth: 0, surface: '' };
  let worst = { depth: -Infinity, at: -1, what: '' };
  for (let i = Math.max(0, i0); i <= Math.min(i1, run.records.length - 1); i++) {
    const r = run.records[i];
    p.set(...r.position);
    q.set(...r.quaternion);
    visitPerchSpheres(p, q, wingsFrom(i) ? 'spread' : 'folded', (s, rad) => {
      const sea = world.terrainHeight(s.x, s.z) < 0;
      const c = world.resolveSphere(s, rad, contact, !sea);
      const d = c ? c.depth : -1;
      if (d > worst.depth) {
        worst = { depth: d, at: r.time, what: c ? `${c.surface} at ${s.toArray().map(f1).join(', ')}` : '' };
      }
    });
  }
  return worst;
}

/** Deepest skinned-vertex penetration (body, wings, tail) into colliders or terrain over records [i0, i1]. */
function meshDepth(world: CollisionWorld, run: Run, i0: number, i1: number, step: number): { depth: number; feet: number; feetAt: string; at: number; part: string } {
  // Standing parts: the feet and wrist claws (parts.ts) plus the metatarsals and the wing hands (the fore feet), which
  // stand within centimetres of the surface on a slope.
  const parts = partVertices({ records: run.records, meshes: run.meshes, boneNames: run.boneNames, ground: () => 0 });
  const feet = new Set(parts.feet.map(([m, i]) => `${m.name}:${i}`));
  for (const m of run.meshes) {
    if (m.kind === 'body') {
      for (let i = 0; i < m.count; i++) {
        if (/^(meta|hand)/.test(run.boneNames[m.dominant[i]] ?? '')) {
          feet.add(`${m.name}:${i}`);
        }
      }
    }
  }
  const out = new Float32Array(3);
  const v = new THREE.Vector3();
  const contact = { normal: new THREE.Vector3(), depth: 0, surface: '' };
  let worst = { depth: -Infinity, feet: -Infinity, feetAt: '', at: -1, part: '' };
  for (let k = Math.max(0, i0); k <= Math.min(i1, run.records.length - 1); k += step) {
    const r = run.records[k];
    for (const m of run.meshes) {
      if (m.kind === 'rider') {
        continue;
      }
      for (let i = 0; i < m.count; i += 3) {
        skinVertex(m, i, r, out, 0);
        v.set(out[0], out[1], out[2]);
        const sea = world.terrainHeight(v.x, v.z) < 0;
        const c = world.resolveSphere(v, 0.001, contact, !sea);
        if (!c) {
          continue;
        }
        const d = c.depth - 0.001;
        // Standing (grounded frames): the folded wing's wrist and finger roots are the fore feet as well.
        if (feet.has(`${m.name}:${i}`) || (r.mode === 'grounded' && /^finger/.test(run.boneNames[m.dominant[i]] ?? ''))) {
          if (d > worst.feet) {
            worst.feet = d;
            worst.feetAt = `${run.boneNames[m.dominant[i]]} at ${f1(r.time)} s, ${c.surface} ${[v.x - r.position[0], v.y - r.position[1], v.z - r.position[2]].map(f1).join(' ')}`;
          }
        } else if (d > worst.depth) {
          worst = { ...worst, depth: d, at: r.time, part: `${m.kind}:${run.boneNames[m.dominant[i]]} (${c.surface}, vertex ${[v.x - r.position[0], v.y - r.position[1], v.z - r.position[2]].map(f1).join(' ')} from the body at ${r.position.map(f1).join(' ')})` };
        }
      }
    }
  }
  return worst;
}

function indexOfTime(run: Run, t: number): number {
  let best = 0;
  for (let i = 0; i < run.records.length; i++) {
    if (Math.abs(run.records[i].time - t) < Math.abs(run.records[best].time - t)) {
      best = i;
    }
  }
  return best;
}

interface Start {
  name: string;
  /** Offset from the grip point along the perch heading (m, + = ahead), to its right (m), up (m). */
  back: number;
  side: number;
  up: number;
  speed: number;
  /** Heading of the start relative to the bearing to the perch (deg). */
  turn: number;
}

const STARTS: Start[] = [
  { name: 'straight-in', back: -230, side: 0, up: 45, speed: 32, turn: 0 },
  { name: 'crossing', back: -40, side: 170, up: 30, speed: 24, turn: 25 },
  { name: 'hover-turn', back: 50, side: -30, up: 18, speed: 0, turn: 140 },
];

function place(rt: PoseRuntime, p: PerchPoint, s: Start): void {
  const h = p.headingDeg * DEG;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const x = p.x + fx * s.back - fz * s.side;
  const z = p.z + fz * s.back + fx * s.side;
  const bearing = (Math.atan2(p.x - x, -(p.z - z)) / DEG + 360) % 360;
  const ground = rt.sim.world.collision!.surfaceHeight(x, z);
  const y = Math.max(p.y + s.up, ground + 25);
  rt.teleport(x, y, z, (bearing + s.turn + 360) % 360, s.speed);
}

async function landingRuns(scene: PerchScene, p: PerchPoint): Promise<void> {
  const probe = scene.createWorld();
  const starts = quick ? STARTS.slice(0, 1) : STARTS;
  for (const s of starts) {
    const world = scene.createWorld();
    let pressed = false;
    let perchedAt = -1;
    const run = await simulate(
      scene,
      world,
      (rt) => place(rt, p, s),
      60,
      (t, sim, input, r) => {
        if (!pressed && sim.perch.offer?.id === p.id) {
          pressed = true;
          r.events.pressed = t;
          input.press('land');
        }
        if (sim.perch.phase === 'perched' && perchedAt < 0) {
          perchedAt = t;
          r.events.perched = t;
        }
        if (perchedAt >= 0 && t > perchedAt + 3 && r.events.left < 0) {
          r.events.left = t;
          input.press('flap');
        }
        if (r.events.left >= 0 && r.events.airborne < 0 && sim.airborne && !sim.perch.ownsBody) {
          r.events.airborne = t;
        }
      },
      (sim, t) => (perchedAt >= 0 && sim.perch.phase === 'free' && t > perchedAt + 4) || (!pressed && t > 20),
    );
    const tag = `${p.id} ${s.name}`;
    if (dump) {
      for (const r of run.records) {
        if (r.time >= dump[0] && r.time <= dump[1]) {
          const q = r.pose;
          console.log(`    ${tag} t=${r.time.toFixed(2)} ${r.mode} pos ${r.position.map(f1).join(' ')} v ${r.velocity.map(f1).join(' ')} pitch ${f1(r.pitchDeg)} bank ${f1(r.bankDeg)} hdg ${f1(r.headingDeg)} spread ${f2(q.wingSpread)} sweep ${f2(q.wingSweep)} amp ${f2(q.flapAmplitude)} phase ${f2(q.flapPhase)} legs ${f2(q.legsTuck)} tail ${f2(q.tailYaw)}/${f2(q.tailPitch)}`);
        }
      }
    }
    if (!check(run.events.pressed >= 0, `${tag}: prompt offered the perch`)) {
      continue;
    }
    if (!check(run.events.perched >= 0, `${tag}: landed on the perch (refusals ${run.sim.perch.refusals}${run.sim.perch.lastBlockedAt ? ` blocked near ${run.sim.perch.lastBlockedAt.toArray().map(f1).join(', ')}` : ''})`)) {
      continue;
    }
    // Settled pose just before the take-off.
    const iSettled = indexOfTime(run, run.events.left - 0.05);
    const r = run.records[iSettled];
    // Pose error: where the stance puts its feet (the body's centre moved back by the stance's offset, and the feet
    // plane) against the perch's grip point.
    const stance = perchStance(p);
    const hd = (p.headingDeg * Math.PI) / 180;
    const anchorX = r.position[0] - Math.sin(hd) * stance.ahead;
    const anchorZ = r.position[2] + Math.cos(hd) * stance.ahead;
    const dPos = Math.hypot(anchorX - p.x, anchorZ - p.z, run.sim.perch.baseY - p.y);
    const dHead = Math.abs(((r.headingDeg - p.headingDeg + 540) % 360) - 180);
    const approachTime = run.events.perched - run.events.pressed;
    check(dPos <= POS_TOL && dHead <= HEADING_TOL, `${tag}: perch pose error ${f2(dPos)} m, heading ${f1(dHead)}° (approach ${f1(approachTime)} s)`);
    // Clearance through the approach (wings count until the last 3 m, like the planner).
    const iPress = indexOfTime(run, run.events.pressed);
    const iTouch = indexOfTime(run, run.events.perched);
    const touchPos = perchTouchdown(p, run.sim.standHeight, new THREE.Vector3(), run.sim.perch.baseY);
    const wings = (i: number): boolean => Math.hypot(run.records[i].position[0] - touchPos.x, run.records[i].position[1] - touchPos.y, run.records[i].position[2] - touchPos.z) > 3;
    const sa = sphereDepth(probe, run, iPress, iTouch, wings);
    check(sa.depth <= 0, `${tag}: approach clearance spheres clear (deepest ${f2(sa.depth)} m at ${f1(sa.at)} s ${sa.what})`);
    // Take-off: control back within 2 s, clear of the structure.
    const iLeave = indexOfTime(run, run.events.left);
    const iEnd = run.records.length - 1;
    const controlTime = run.events.airborne >= 0 ? run.events.airborne - run.events.left : Infinity;
    check(controlTime <= 2, `${tag}: take-off airborne and controllable after ${f2(controlTime)} s`);
    const endLog = run.log[run.log.length - 1];
    check(endLog.phase === 'free', `${tag}: take-off cleared the perch (phase ${endLog.phase}, mode ${endLog.mode})`);
    const iLeaveEnd = Math.min(iEnd, iLeave + FPS * 3);
    // Spheres from the lift-off (the crouch on the perch presses the belly low by design; the mesh test covers it).
    const iAir = run.events.airborne >= 0 ? indexOfTime(run, run.events.airborne) : iLeave;
    const st = sphereDepth(probe, run, iAir, iLeaveEnd, () => false);
    check(st.depth <= 0, `${tag}: take-off body spheres clear (deepest ${f2(st.depth)} m at ${f1(st.at)} s ${st.what})`);
    if (!quick) {
      const ma = meshDepth(probe, run, iPress, iSettled, 4);
      check(ma.depth <= MESH_PRESS && ma.feet <= FEET_PRESS, `${tag}: approach + perched mesh clear (deepest ${f2(ma.depth)} m ${ma.part} at ${f1(ma.at)} s, feet ${f2(ma.feet)} m${ma.feet > FEET_PRESS ? ` ${ma.feetAt}` : ''})`);
      const mt = meshDepth(probe, run, iLeave, iLeaveEnd, 4);
      check(mt.depth <= MESH_PRESS, `${tag}: take-off mesh clear (deepest ${f2(mt.depth)} m ${mt.part} at ${f1(mt.at)} s)`);
    }
    console.log(`  ${tag}: approach ${f1(approachTime)} s, pose error ${f2(dPos)} m / ${f1(dHead)}°, feet ${f2(run.sim.perch.baseY - p.y)} m over the grip, ${run.sim.perch.lastLeave} take-off, control back ${f2(controlTime)} s`);
  }
}

async function abortRun(scene: PerchScene, p: PerchPoint): Promise<void> {
  const world = scene.createWorld();
  let pressed = -1;
  let abortedAt = -1;
  const run = await simulate(
    scene,
    world,
    (rt) => place(rt, p, STARTS[0]),
    14,
    (t, sim, input) => {
      if (pressed < 0 && sim.perch.offer?.id === p.id) {
        pressed = t;
        input.press('land');
      }
      if (pressed >= 0 && t > pressed + 1.5 && t < pressed + 2.5) {
        input.cmd.pitch = -1;
      }
      if (pressed >= 0 && abortedAt < 0 && t > pressed + 1.5 && sim.perch.phase === 'free') {
        abortedAt = t;
      }
    },
    (_sim, t) => pressed >= 0 && t > pressed + 4,
  );
  const tag = `${p.id} abort`;
  check(pressed >= 0 && abortedAt >= 0 && abortedAt - (pressed + 1.5) < 0.1 && run.sim.perch.aborts === 1, `${tag}: stick input aborts the approach (after ${f2(abortedAt - pressed - 1.5)} s)`);
  check(run.sim.airborne, `${tag}: back in free flight (mode ${run.sim.mode})`);
}

function cameraRun(scene: PerchScene, p: PerchPoint): void {
  const world = scene.createWorld();
  const collision = new CameraCollision();
  collision.bindDirect(world, null);
  const anchor = perchTouchdown(p, 1.8, new THREE.Vector3());
  const yaw = -p.headingDeg * DEG;
  const cam = new THREE.PerspectiveCamera(PERCH_CAMERA.fov, 16 / 9, 0.3, 20000);
  const ndc = new THREE.Vector3();
  for (const style of ['orbit', 'fixed'] as const) {
    const rig = new PerchCameraRig();
    const pose = createPose();
    rig.style = style;
    rig.begin(anchor, yaw, 24, collision, null);
    let inside = 0;
    let minDist = Infinity;
    let blocked = 0;
    let frames = 0;
    let offFrame = 0;
    let lowY = Infinity;
    let highY = -Infinity;
    let maxX = 0;
    const dt = 1 / 30;
    for (let t = 0; t < 100; t += dt) {
      // A little mouse look now and then.
      const look = Math.sin(t * 0.3) > 0.97 ? 0.01 : 0;
      rig.update(dt, anchor, yaw, collision, look, 0, pose);
      frames++;
      if (collision.blocked(pose.position, 0.2)) {
        inside++;
      }
      minDist = Math.min(minDist, pose.position.distanceTo(anchor));
      if (!collision.lineOfSight(pose.position, anchor, 3)) {
        blocked++;
      }
      // Composition: the dragon's centre on screen (lower third, inside the frame).
      cam.position.copy(pose.position);
      cam.quaternion.copy(pose.quaternion);
      cam.updateMatrixWorld();
      ndc.copy(anchor).project(cam);
      lowY = Math.min(lowY, ndc.y);
      highY = Math.max(highY, ndc.y);
      maxX = Math.max(maxX, Math.abs(ndc.x));
      if (Math.abs(ndc.x) > 0.8 || ndc.y < -0.8 || ndc.y > 0) {
        offFrame++;
      }
    }
    const l = rig.last;
    const tag = `${p.id} camera ${style}`;
    if (verbose) {
      console.log(`  ${tag}: placement az ${f1(l.az / DEG)}° el ${f1(l.el / DEG)}° open ${f2(l.open)} boom ${f2(l.clearBoom)} visible ${l.visible}; dragon y ${f2(lowY)}..${f2(highY)} |x| <= ${f2(maxX)}`);
    }
    check(inside === 0, `${tag}: 100 s without the eye in geometry (${inside} frames inside, closest ${f1(minDist)} m)`);
    check(blocked / frames < 0.02, `${tag}: dragon visible (hidden ${((blocked / frames) * 100).toFixed(0)}% of the frames)`);
    check(offFrame === 0, `${tag}: dragon framed in the lower part of the frame (y ${f2(lowY)}..${f2(highY)}, |x| <= ${f2(maxX)}, ${offFrame} frames off)`);
    check(l.open > 0.9, `${tag}: view open from the placement (${f2(l.open)})`);
  }
}

/** The prompt state machine on synthetic states (no rig): reach, cone, speed and height with hysteresis. */
async function promptChecks(scene: PerchScene): Promise<void> {
  const p = scene.perches.get('galata-kulesi')!;
  const rig = await buildRig();
  const rt = new PoseRuntime(rig, 0, false, undefined, null);
  rt.sim.world.collision = scene.createWorld();
  rt.sim.world.geo = scene.geo;
  rt.sim.perch.setPoints([p]);
  const sim = rt.sim;
  const at = (dist: number, bearingOffDeg: number, speed: number, up: number): void => {
    // Placed `dist` m south-west of the perch, flying `bearingOffDeg` off the bearing to it.
    const x = p.x - dist * Math.SQRT1_2;
    const z = p.z + dist * Math.SQRT1_2;
    const bearing = (Math.atan2(p.x - x, -(p.z - z)) / DEG + 360) % 360;
    rt.teleport(x, p.y + up, z, (bearing + bearingOffDeg + 360) % 360, speed);
  };
  const offerAfter = (): boolean => {
    // Evaluate as the step would (the offer keeps its hysteresis between calls).
    sim.perch.offer = sim.perch.evaluateOffer(sim);
    return sim.perch.offer !== null;
  };
  const cases: Array<[string, () => void, boolean]> = [
    ['far away (400 m): no prompt', () => at(400, 0, 30, 40), false],
    ['inside reach (240 m), slow, facing: prompt', () => at(240, 0, 30, 40), true],
    ['hysteresis: 300 m keeps the prompt', () => at(300, 0, 30, 40), true],
    ['beyond the hide reach (330 m): gone', () => at(330, 0, 30, 40), false],
    ['300 m again (between show and hide reach): stays hidden', () => at(300, 0, 30, 40), false],
    ['close, facing away (120°): no prompt', () => at(150, 120, 30, 40), false],
    ['close, 60° off: prompt', () => at(150, 60, 30, 40), true],
    ['hysteresis: 80° off keeps it', () => at(150, 80, 30, 40), true],
    ['95° off: gone', () => at(150, 95, 30, 40), false],
    ['hovering facing away: prompt (a hover can turn)', () => at(80, 170, 0, 20), true],
    ['reset: far away', () => at(500, 0, 30, 40), false],
    ['too fast (48 m/s): no prompt', () => at(200, 0, 48, 40), false],
    ['fast (40 m/s): prompt', () => at(200, 0, 40, 40), true],
    ['hysteresis: 50 m/s keeps it', () => at(200, 0, 50, 40), true],
    ['55 m/s: gone', () => at(200, 0, 55, 40), false],
    ['far below the grip (70 m): no prompt', () => at(150, 0, 30, -70), false],
  ];
  for (const [label, setup, want] of cases) {
    const before = sim.perch.offer;
    setup();
    // teleport resets the driver; restore the offer the hysteresis case relies on.
    sim.perch.offer = before;
    const got = offerAfter();
    check(got === want, `prompt: ${label} (${got ? 'shown' : 'hidden'})`);
  }
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const scene = buildPerchScene();
  console.log(`scene built in ${Math.round(performance.now() - t0)} ms (${scene.perches.points.length} perches, ${scene.landmarks.size} landmarks)`);
  await promptChecks(scene);
  for (const p of scene.perches.points) {
    if (only && p.id !== only) {
      continue;
    }
    console.log(`${p.id} [${p.surface}]`);
    await landingRuns(scene, p);
    if (!quick) {
      await abortRun(scene, p);
    }
    cameraRun(scene, p);
  }
  console.log(`\n${failures.length} failure(s) (${Math.round((performance.now() - t0) / 1000)} s)`);
  for (const f of failures) {
    console.log(`FAIL ${f}`);
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
