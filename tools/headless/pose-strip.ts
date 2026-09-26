/**
 * Pose strip: renders the dragon's animation without a GPU. Builds the real rig in Node, drives it through a scripted
 * scenario with the real flight simulation, PoseDriver and animator (the flight system's per-frame wiring), skins the
 * meshes on the CPU and draws flat silhouettes frame by frame into a contact sheet, plus a JSON sidecar with the
 * dragon's position, speed, mode and pose per frame.
 *
 *   npx tsx tools/headless/pose-strip.ts [scenario] [--view side|front|top|three-quarter] [--frames N] [--fps F]
 *       [--size WxH] [--out dir] [--strip] [--cols N] [--span m] [--start s] [--render-fps F] [--ss N] [--svg]
 *   npx tsx tools/headless/pose-strip.ts --all        every scenario, side view, into <out>/all/
 *   npx tsx tools/headless/pose-strip.ts --list       scenario names
 *
 * Output: .shots/pose/<scenario>-<view>.png (+ .json). Colours: dark = near side / body, lighter = the far (left)
 * wing, legs and membrane, rust = rider, brown = tack; red = geometry below the ground surface. Ground ticks and the
 * grid are world-fixed every 2 m, so sliding feet show against them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from 'three';
import { footStats, trackFeet, type FootStats } from './pose/contacts';
import { collectMeshes, makeCamera, renderCell, skinMesh, skinVertex, VIEWS, type MeshData, type View } from './pose/raster';
import { buildRig, PoseRuntime, type FrameRecord } from './pose/runtime';
import { GROUND_Y, SCENARIOS, scenarioByName, type Scenario } from './pose/scenarios';
import { writeSheet, type SheetFrame } from './pose/sheet';

interface Options {
  scenario: string;
  all: boolean;
  list: boolean;
  view: View | null;
  frames: number | null;
  fps: number | null;
  width: number;
  height: number;
  out: string;
  strip: boolean;
  cols: number;
  span: number;
  start: number | null;
  renderFps: number;
  ss: number;
  svg: boolean;
  verify: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    scenario: 'walk',
    all: false,
    list: false,
    view: null,
    frames: null,
    fps: null,
    width: 320,
    height: 240,
    out: '.shots/pose',
    strip: false,
    cols: 6,
    span: 0,
    start: null,
    renderFps: 60,
    ss: 2,
    svg: false,
    verify: false,
  };
  const num = (name: string, v: string | undefined): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) {
      throw new Error(`${name} needs a number`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--all':
        o.all = true;
        break;
      case '--list':
        o.list = true;
        break;
      case '--strip':
        o.strip = true;
        break;
      case '--verify':
        o.verify = true;
        break;
      case '--svg':
        o.svg = true;
        break;
      case '--view': {
        const v = argv[++i] as View;
        if (!VIEWS.includes(v)) {
          throw new Error(`--view must be one of ${VIEWS.join(', ')}`);
        }
        o.view = v;
        break;
      }
      case '--frames':
        o.frames = Math.max(1, Math.round(num(a, argv[++i])));
        break;
      case '--fps':
        o.fps = num(a, argv[++i]);
        break;
      case '--size': {
        const m = /^(\d+)x(\d+)$/.exec(argv[++i] ?? '');
        if (!m) {
          throw new Error('--size must look like 320x240');
        }
        o.width = Number(m[1]);
        o.height = Number(m[2]);
        break;
      }
      case '--out':
        o.out = argv[++i];
        break;
      case '--cols':
        o.cols = Math.max(1, Math.round(num(a, argv[++i])));
        break;
      case '--span':
        o.span = num(a, argv[++i]);
        break;
      case '--start':
        o.start = num(a, argv[++i]);
        break;
      case '--render-fps':
        o.renderFps = num(a, argv[++i]);
        break;
      case '--ss':
        o.ss = Math.max(1, Math.round(num(a, argv[++i])));
        break;
      default:
        if (a.startsWith('--')) {
          throw new Error(`unknown option ${a}`);
        }
        o.scenario = a;
    }
  }
  return o;
}

/**
 * Self-check: the CPU skinning of the last recorded frame (the rig's current state) against three's own
 * SkinnedMesh.applyBoneTransform, with the shader displacements zeroed (full stream, still air: no cloak drape).
 * Returns the largest distance (m).
 */
function verifySkinning(rig: Awaited<ReturnType<typeof buildRig>>, meshes: readonly MeshData[], last: FrameRecord): number {
  const rec: FrameRecord = { ...last, shader: { breath: 0, billowLeft: 0, billowRight: 0, foldSlack: 0, airspeed: 1000, airflow: [0, 0, 0] } };
  const three: THREE.SkinnedMesh[] = [];
  rig.root.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      three.push(obj as THREE.SkinnedMesh);
    }
  });
  const out = new Float32Array(3);
  const v = new THREE.Vector3();
  let worst = 0;
  meshes.forEach((m, mi) => {
    const mesh = three[mi];
    for (let i = 0; i < m.count; i += 7) {
      skinVertex(m, i, rec, out, 0);
      v.fromBufferAttribute(mesh.geometry.attributes.position as THREE.BufferAttribute, i);
      mesh.applyBoneTransform(i, v).applyMatrix4(mesh.matrixWorld);
      worst = Math.max(worst, Math.hypot(v.x - out[0], v.y - out[1], v.z - out[2]));
    }
  });
  return worst;
}

/** Record closest to time `t`. */
function recordAt(records: readonly FrameRecord[], t: number): FrameRecord {
  let best = records[0];
  for (const r of records) {
    if (Math.abs(r.time - t) < Math.abs(best.time - t)) {
      best = r;
    }
  }
  return best;
}

async function renderScenario(s: Scenario, o: Options, view: View, base: string): Promise<string> {
  const t0 = performance.now();
  const rig = await buildRig();
  const rt = s.sea !== undefined ? new PoseRuntime(rig, -s.sea, true, s.terrain, s.wind ?? null) : new PoseRuntime(rig, GROUND_Y, false, s.terrain, s.wind ?? null);
  s.setup(rt);
  const records = rt.run({ seconds: s.seconds, renderFps: o.renderFps, script: s.script() });
  const tSim = performance.now() - t0;

  const frames = o.frames ?? s.frames;
  const fps = o.fps ?? s.fps;
  const last = records[records.length - 1].time;
  const start = Math.max(0, Math.min(o.start ?? s.window(records), last - (frames - 1) / fps));
  const meshes = collectMeshes(rig.root, rig.skel.bones.map((b) => b.name));
  const worlds = meshes.map((m) => new Float32Array(m.count * 3));
  const first = recordAt(records, start);
  const span = o.span > 0 ? o.span : (s.span ?? 30);
  const scale = (o.width * o.ss) / span;
  // Foot contacts over the window at the full render rate (grounded frames only).
  const end = start + (frames - 1) / fps;
  const ref = records.find((r) => r.time >= start - 1e-6 && r.time <= end && r.mode === 'grounded');
  const body = meshes.find((m) => m.kind === 'body');
  const tracks = ref && body ? trackFeet(body, rig.skel.bones.map((b) => b.name), records, ref) : [];
  const feet: FootStats[] = footStats(tracks, records, start, end);
  const sheetFrames: SheetFrame[] = [];
  const sidecar: unknown[] = [];
  for (let k = 0; k < frames; k++) {
    const t = start + k / fps;
    const rec = recordAt(records, t);
    meshes.forEach((m, i) => skinMesh(m, rec, worlds[i]));
    const yaw = s.camera === 'follow' ? rec.yaw : first.yaw;
    const cam = makeCamera(view, yaw, new THREE.Vector3(...rec.position), scale);
    const cell = renderCell(meshes, worlds, rec, cam, o.width, o.height, o.ss);
    const trick = rec.trick !== 'none' ? ` / ${rec.trick}` : '';
    sheetFrames.push({
      cell,
      label: `${(rec.time - start).toFixed(2)} s · ${rec.mode}${trick}`,
      sublabel: `v ${rec.airspeed.toFixed(1)} m/s  vy ${rec.velocity[1].toFixed(1)}  feet ${rec.footClearance.toFixed(1)} m  θ ${rec.pitchDeg.toFixed(0)}°  φ ${rec.bankDeg.toFixed(0)}°`,
    });
    const { bones: _bones, shader: _shader, ...telemetry } = rec;
    const ri = records.indexOf(rec);
    const footHeights = Object.fromEntries(tracks.map((tr) => [tr.bone, Math.round((tr.points[ri * 3 + 1] - rec.surfaceY) * 1000) / 1000]));
    sidecar.push({
      frame: k,
      windowTime: Math.round((rec.time - start) * 1000) / 1000,
      ...telemetry,
      lowestPointAboveGround: Math.round(cell.lowest * 1000) / 1000,
      footHeights,
    });
  }
  const path = await writeSheet(
    {
      title: `${s.name} · ${view}`,
      subtitle: `${s.description} — window from ${start.toFixed(2)} s, ${frames} frames at ${fps} fps, ${span} m across`,
      columns: o.strip ? frames : o.cols,
      frames: sheetFrames,
    },
    base,
    o.svg,
  );
  writeFileSync(
    `${base}.json`,
    JSON.stringify({ scenario: s.name, description: s.description, view, windowStart: start, fps, renderFps: o.renderFps, groundY: rt.groundY, feet, frames: sidecar }, null, 1),
  );
  console.log(`${s.name}: ${path} (sim ${tSim.toFixed(0)} ms, total ${(performance.now() - t0).toFixed(0)} ms)`);
  if (o.verify) {
    console.log(`  skinning check vs applyBoneTransform: max error ${verifySkinning(rig, meshes, records[records.length - 1]).toExponential(2)} m`);
  }
  if (feet.length > 0) {
    const lines = feet.map((f) => `${f.bone} planted ${(f.planted * 100).toFixed(0)}% slip ${f.slip.toFixed(2)} m/s (body ${f.bodySpeed.toFixed(2)}) lift ${f.lift.toFixed(2)} m, lowest ${f.lowest.toFixed(2)} m`);
    console.log(`  feet: ${lines.join(' | ')}`);
  }
  return path;
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  if (o.list) {
    for (const s of SCENARIOS) {
      console.log(`${s.name.padEnd(10)} ${s.description}`);
    }
    return;
  }
  if (o.all) {
    const dir = resolve(o.out, 'all');
    mkdirSync(dir, { recursive: true });
    for (const s of SCENARIOS) {
      await renderScenario(s, o, o.view ?? 'side', join(dir, `${s.name}-${o.view ?? 'side'}`));
    }
    return;
  }
  const s = scenarioByName(o.scenario);
  if (!s) {
    throw new Error(`unknown scenario "${o.scenario}" (try --list)`);
  }
  const view = o.view ?? s.view;
  const dir = resolve(o.out);
  mkdirSync(dir, { recursive: true });
  await renderScenario(s, o, view, join(dir, `${s.name}-${view}`));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
