/**
 * Phase 06 bond pose sheets, headless (no browser, no GPU): the real rig driven by the real FlightSim and PoseDriver
 * (tools/headless/pose/runtime.ts) with the bond core on top of the flight pose exactly as the game's model system
 * applies it (bondPose), skinned on the CPU and drawn as silhouettes.
 *
 *   npx tsx tools/headless/bond-sheet.ts [name ...]     # default: every sheet, into .shots/pose/bond/
 *
 * Sheets: gaze (the head comes round after the rider's POV rests on the neck), petting (hand on the neck, the head
 * round on the right, plates up, tail tip curling), yawn (with the small flame), happy-roll (rock), wing-stretch (after
 * landing), gull-snap (double) and encourage (the excited answer's wing beat and short roar).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from 'three';
import type { DragonPose } from '../../src/core/contracts';
import { bondPose } from '../../src/dragon/model/behavior/bond/apply';
import { BondCore } from '../../src/dragon/model/behavior/bond/core';
import { createInputs, type AttentionCandidate, type BondInputs } from '../../src/dragon/model/behavior/bond/types';
import type { DragonRigImpl } from '../../src/dragon/model/rig';
import { collectMeshes, makeCamera, renderCell, skinMesh, type View } from './pose/raster';
import { buildRig, PoseRuntime, type FrameRecord } from './pose/runtime';
import { GROUND_Y } from './pose/scenarios';
import { writeSheet, type SheetFrame } from './pose/sheet';

interface BondSheet {
  name: string;
  description: string;
  seconds: number;
  /** Sampled window (s) and frames. */
  start: number;
  end: number;
  frames: number;
  views: View[];
  span: number;
  /** Camera centre offset from the body centre, body frame (forward, up) in m. */
  focus: [number, number];
  ground?: boolean;
  setup?(core: BondCore): void;
  /** Edits the bond input each frame (t = seconds). */
  input?(inp: BondInputs, t: number): void;
  /** Extra pose cues the game's rider behaviour would write (petting). */
  rider?(t: number): Partial<DragonPose>;
}

const bird: AttentionCandidate = { kind: 'bird', key: 'bird', yaw: 0.55, pitch: 0.12, distance: 24, strength: 0.7 };

const SHEETS: BondSheet[] = [
  {
    name: 'gaze',
    description: 'gliding; the rider looks at the neck in POV from 0 s, the head comes round at ~3 s and holds',
    seconds: 7,
    start: 2.4,
    end: 6.6,
    frames: 8,
    views: ['top', 'three-quarter'],
    span: 16,
    focus: [3, 0.5],
    input: (inp) => {
      inp.pov = true;
      inp.povLookAtNeck = true;
      inp.povLookSide = 1;
    },
  },
  {
    name: 'petting',
    description: 'gliding; G held from 0.3 s: the hand strokes the right side of the neck, the head comes round on the right, plates up, tail tip curls',
    seconds: 7,
    start: 0.2,
    end: 6.5,
    frames: 8,
    views: ['side', 'top'],
    span: 9,
    focus: [2.6, 1],
    input: (inp, t) => {
      inp.petting = Math.min(1, Math.max(0, (t - 0.3) / 0.5));
      inp.petActive = t > 0.3;
    },
    rider: (t) => ({ riderPet: Math.min(1, Math.max(0, (t - 0.3) / 0.5)) }),
  },
  {
    name: 'yawn',
    description: 'gliding; a yawn with the small flame puff at its end (yawn:flame)',
    seconds: 6,
    start: 1.6,
    end: 4.9,
    frames: 8,
    views: ['side', 'three-quarter'],
    span: 12,
    focus: [3.5, 0.8],
    setup: (core) => core.behaviors.force('yawn', 'flame'),
  },
  {
    name: 'happy-roll',
    description: 'gliding; the happy rock (happy-roll:rock): a visual body roll, the flight body stays level',
    seconds: 5,
    start: 1.55,
    end: 3.8,
    frames: 8,
    views: ['front', 'chase'],
    span: 28,
    focus: [0, 0],
    setup: (core) => core.behaviors.force('happy-roll', 'rock'),
  },
  {
    name: 'wing-stretch',
    description: 'standing after a long flight: the wing stretch (wing-stretch:full)',
    seconds: 6,
    start: 1.6,
    end: 4.9,
    frames: 8,
    views: ['side', 'front'],
    span: 28,
    focus: [0, 0.5],
    ground: true,
    setup: (core) => core.behaviors.force('wing-stretch', 'full'),
    input: (inp) => {
      inp.mode = 'grounded';
      inp.airspeed = 0;
      inp.groundSpeed = 0;
      inp.agl = 0;
    },
  },
  {
    name: 'gull-snap',
    description: 'gliding past a gull ahead-left: two snaps and a head shake (gull-snap:double)',
    seconds: 5,
    start: 1.6,
    end: 3.7,
    frames: 8,
    views: ['three-quarter', 'top'],
    span: 14,
    focus: [3.5, 0.5],
    setup: (core) => core.behaviors.force('gull-snap', 'double'),
    input: (inp) => {
      (inp.attention as AttentionCandidate[]).push({ ...bird });
    },
  },
  {
    name: 'encourage',
    description: 'gliding, excited; V at 0.5 s: the rider pats the neck, the dragon answers with one wing beat and a short roar',
    seconds: 4,
    start: 0.4,
    end: 3.3,
    frames: 8,
    views: ['side', 'front'],
    span: 26,
    focus: [0, 0],
    setup: (core) => {
      core.mood.mood = 'excited';
    },
    input: (inp, t) => {
      inp.encourage = Math.abs(t - 0.5) < 1 / 120;
    },
  },
];

function recordAt(records: readonly FrameRecord[], t: number): FrameRecord {
  let best = records[0];
  for (const r of records) {
    if (Math.abs(r.time - t) < Math.abs(best.time - t)) {
      best = r;
    }
  }
  return best;
}

async function renderSheet(s: BondSheet, outDir: string): Promise<void> {
  const rig: DragonRigImpl = await buildRig();
  const rt = new PoseRuntime(rig, GROUND_Y);
  if (s.ground) {
    rt.stand(0, 0, 0);
  } else {
    rt.teleport(0, GROUND_Y + 300, 0, 0, 27);
  }
  const core = new BondCore(606);
  s.setup?.(core);
  const inp = createInputs();
  const labels = new Map<number, string>();
  const records = rt.run({
    seconds: s.seconds,
    renderFps: 60,
    script: () => undefined,
    afterPose: (dt, elapsed, state) => {
      const keep = inp.attention as AttentionCandidate[];
      Object.assign(inp, createInputs());
      keep.length = 0;
      inp.attention = keep;
      inp.dt = dt;
      inp.mode = state.mode;
      inp.airspeed = state.airspeed;
      inp.groundSpeed = Math.hypot(state.velocity.x, state.velocity.z);
      inp.agl = state.agl;
      s.input?.(inp, elapsed);
      if (s.name === 'encourage') {
        core.mood.mood = 'excited';
      }
      const o = core.update(inp);
      if (s.rider) {
        rig.setPose(s.rider(elapsed));
      }
      rig.setPose(bondPose(rig.getPose(), o, false));
      rig.setGazeSide(o.gazeSide);
      labels.set(Math.round(elapsed * 1000), `${o.behavior ?? (o.gazeRider > 0.05 ? 'gaze' : '—')}  gaze ${o.gazeRider.toFixed(2)}  lid ${o.eyeLid.toFixed(2)}  plates ${o.neckPlates.toFixed(2)}`);
    },
  });
  const meshes = collectMeshes(rig.root, rig.skel.bones.map((b) => b.name));
  const worlds = meshes.map((m) => new Float32Array(m.count * 3));
  const width = 320;
  const height = 240;
  const ss = 2;
  const scale = (width * ss) / s.span;
  for (const view of s.views) {
    const frames: SheetFrame[] = [];
    for (let k = 0; k < s.frames; k++) {
      const t = s.start + ((s.end - s.start) * k) / Math.max(1, s.frames - 1);
      const rec = recordAt(records, t);
      meshes.forEach((m, i) => skinMesh(m, rec, worlds[i]));
      const q = new THREE.Quaternion(...rec.quaternion);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const center = new THREE.Vector3(...rec.position).addScaledVector(fwd, s.focus[0]).addScaledVector(up, s.focus[1]);
      const cam = makeCamera(view, rec.yaw, center, scale);
      const cell = renderCell(meshes, worlds, rec, cam, width, height, ss);
      const label = labels.get(Math.round(rec.time * 1000)) ?? '';
      frames.push({ cell, label: `${rec.time.toFixed(2)} s · ${rec.mode}`, sublabel: label });
    }
    const base = join(outDir, `${s.name}-${view}`);
    const path = await writeSheet({ title: `bond · ${s.name} · ${view}`, subtitle: s.description, columns: 4, frames }, base);
    writeFileSync(`${base}.json`, JSON.stringify({ sheet: s.name, view, description: s.description, log: core.behaviors.log }, null, 1));
    console.log(`${s.name} ${view}: ${path}`);
  }
}

async function main(): Promise<void> {
  const names = process.argv.slice(2);
  const outDir = resolve('.shots/pose/bond');
  mkdirSync(outDir, { recursive: true });
  for (const s of SHEETS) {
    if (names.length === 0 || names.includes(s.name)) {
      await renderSheet(s, outDir);
    }
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
