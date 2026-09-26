/**
 * Perch pose sheets (phase 03), headless: the real rig, FlightSim and PoseDriver fly the guided approach onto a perch,
 * sit there and leave it (the same runs as perch-landing-check.ts), drawn frame by frame with the structure the perch
 * sits on (its most detailed LOD from the real builder) into contact sheets.
 *
 *   npx tsx tools/headless/perch-sheet.ts                      # galata-kulesi, suleymaniye-kubbe, fsm-koprusu-kule
 *   npx tsx tools/headless/perch-sheet.ts --perch kiz-kulesi [--view side|front|top|three-quarter] [--span 34]
 *
 * Output: .shots/pose/perch/<perch>-<view>.png (not committed). Frames: the flare, the touchdown, the settle into the
 * sit, the perched look-around, the drop-off (crouch, push, fall, wings open).
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from 'three';
import type { PerchPoint } from '../../src/core/contracts';
import { DEG } from '../../src/dragon/flight/params';
import { collectMeshes, makeCamera, renderCell, skinMesh, VIEWS, type View } from './pose/raster';
import { buildRig, PoseRuntime, type FrameRecord } from './pose/runtime';
import { writeSheet, type SheetFrame } from './pose/sheet';
import { buildPerchScene, perchTriangles, type PerchScene } from './perch-scene';

const args = process.argv.slice(2);
const opt = (name: string): string | null => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const PERCHES = opt('--perch') ? [opt('--perch')!] : ['galata-kulesi', 'suleymaniye-kubbe', 'fsm-koprusu-kule'];
const VIEWS_OUT: View[] = opt('--view') ? [opt('--view') as View] : ['side', 'three-quarter', 'front'];
const SPAN = Number(opt('--span') ?? 34);
const OUT = resolve(opt('--out') ?? '.shots/pose/perch');

interface Marks {
  pressed: number;
  perched: number;
  left: number;
}

async function run(scene: PerchScene, p: PerchPoint): Promise<{ records: FrameRecord[]; phases: string[]; marks: Marks; rt: PoseRuntime }> {
  const rig = await buildRig();
  const rt = new PoseRuntime(rig, 0, false, undefined, null);
  rt.sim.world.collision = scene.createWorld();
  rt.sim.world.geo = scene.geo;
  rt.sim.perch.setPoints(scene.perches.points);
  // The straight-in start of the landing check: 230 m behind the perch, 45 m above it, 32 m/s toward it.
  const h = p.headingDeg * DEG;
  rt.teleport(p.x - Math.sin(h) * 230, p.y + 45, p.z + Math.cos(h) * 230, p.headingDeg, 32);
  const marks: Marks = { pressed: -1, perched: -1, left: -1 };
  const phases: string[] = [];
  const records = rt.run({
    seconds: 34,
    renderFps: 60,
    script: (t, sim, input) => {
      phases.push(sim.perch.phase);
      if (marks.pressed < 0 && sim.perch.offer?.id === p.id) {
        marks.pressed = t;
        input.press('land');
      }
      if (marks.perched < 0 && sim.perch.phase === 'perched') {
        marks.perched = t;
      }
      if (marks.perched >= 0 && marks.left < 0 && t > marks.perched + 12) {
        marks.left = t;
        input.press('flap');
      }
    },
  });
  phases.push(rt.sim.perch.phase);
  return { records, phases, marks, rt };
}

function recordAt(records: readonly FrameRecord[], t: number): FrameRecord {
  let best = records[0];
  for (const r of records) {
    if (Math.abs(r.time - t) < Math.abs(best.time - t)) {
      best = r;
    }
  }
  return best;
}

async function main(): Promise<void> {
  const scene = buildPerchScene();
  mkdirSync(OUT, { recursive: true });
  for (const id of PERCHES) {
    const p = scene.perches.get(id);
    if (!p) {
      throw new Error(`unknown perch ${id}`);
    }
    const { records, phases, marks, rt } = await run(scene, p);
    if (marks.perched < 0 || marks.left < 0) {
      console.log(`${id}: did not perch (refusals ${rt.sim.perch.refusals})`);
      continue;
    }
    const shots: Array<[number, string]> = [
      [marks.perched - 2.2, 'approach'],
      [marks.perched - 1.1, 'flare'],
      [marks.perched - 0.35, 'feet reaching'],
      [marks.perched + 0.05, 'touchdown'],
      [marks.perched + 0.6, 'settling'],
      [marks.perched + 2, 'perched'],
      [marks.perched + 6, 'looking out'],
      [marks.perched + 10, 'looking out'],
      [marks.left + 0.2, 'crouch'],
      [marks.left + 0.42, 'push-off'],
      [marks.left + 0.8, 'fall'],
      [marks.left + 1.5, 'wings open'],
    ];
    const rig = rt.rig;
    const meshes = collectMeshes(rig.root, rig.skel.bones.map((b) => b.name));
    const worlds = meshes.map((m) => new Float32Array(m.count * 3));
    const tris = perchTriangles(scene, p);
    const perchedRec = recordAt(records, marks.perched + 2);
    for (const view of VIEWS_OUT) {
      const frames: SheetFrame[] = [];
      for (const [t, label] of shots) {
        const rec = recordAt(records, t);
        meshes.forEach((m, i) => skinMesh(m, rec, worlds[i]));
        // Framed on the dragon, the camera heading fixed to the perch heading (the structure reads the same in every cell).
        const cam = makeCamera(view, perchedRec.yaw, new THREE.Vector3(...rec.position), (320 * 2) / SPAN);
        const cell = renderCell(meshes, worlds, rec, cam, 320, 240, 2, { tris, groundLine: false });
        const i = records.indexOf(rec);
        frames.push({
          cell,
          label: `${(rec.time - marks.perched).toFixed(2)} s · ${label} · ${phases[i] ?? ''}`,
          sublabel: `${rec.mode}  v ${rec.airspeed.toFixed(1)} m/s  pitch ${rec.pitchDeg.toFixed(0)}°  hdg ${rec.headingDeg.toFixed(0)}°  feet ${rec.footClearance.toFixed(1)} m`,
        });
      }
      const base = join(OUT, `${id}-${view}`);
      const path = await writeSheet({ title: `${p.name} · ${view}`, subtitle: `perch landing, sit and drop-off; ${SPAN} m across, times from the touchdown`, columns: 4, frames }, base);
      console.log(`${id}: ${path}`);
    }
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

void VIEWS;
