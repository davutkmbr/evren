/**
 * The Aya Yorgi knight statue (src/moments/aya-yorgi): its model is sound and sized against the dragon, and its three
 * animations and creaks follow the moment's lines.
 *
 *   npx tsx tools/headless/aya-yorgi-check.ts
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { FigureJoint, FIGURE_SCALE, FOUNDATION_DEPTH, plinthBase, PLINTH_H, PLINTH_HALF, STATUE_HEIGHT, statueFromScene } from '../../src/moments/aya-yorgi/statue-model';
import { AyaYorgiStatueActor, RESIDENT_HIDE, RESIDENT_SHOW } from '../../src/moments/aya-yorgi/actor';
import { latLonToLocal } from '../../src/core/geo-coords';
import type { EngineContext } from '../../src/core/contracts';
import { CREAKS, knightPose, LOWER, PERFORMANCE_SEC, RAISE, SHRUG, SPEAR_DROOP, SPEAR_RAISED } from '../../src/moments/aya-yorgi/pose';
import { ALL_MOMENTS } from '../../src/moments/data';

let passes = 0;
let failures = 0;
function check(cond: boolean, what: string): void {
  if (cond) {
    passes++;
  } else {
    failures++;
    console.log(`  ✗ ${what}`);
  }
}

// --- The exported model (public/models/moments/aya-yorgi-statue.glb, built by tools/moments/knight_statue.py).
const GLB = 'public/models/moments/aya-yorgi-statue.glb';
{
  const buf = readFileSync(GLB);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const names = new Set<string>((gltf.nodes ?? []).map((n: { name?: string }) => (n.name ?? '').replace(/^mixamorig:?/, '')));
  check(buf.length < 12e6, `the model is ${(buf.length / 1e6).toFixed(1)} MB (< 12 MB)`);
  check(['Hips', 'RightArm', 'LeftArm', 'LeftShoulder', 'RightShoulder', 'Head'].every((n) => names.has(n)), 'the skeleton has the animated joints');
  check((gltf.skins ?? []).length === 1 && (gltf.meshes ?? []).length === 2, 'one skinned bronze mesh and the plinth');
  const mats = gltf.materials ?? [];
  check(mats.length === 2 && mats.every((m: Record<string, unknown>) => {
    const pbr = m.pbrMetallicRoughness as Record<string, unknown> | undefined;
    return !!pbr?.baseColorTexture && !!pbr?.metallicRoughnessTexture && !!m.normalTexture && !!m.occlusionTexture;
  }), 'bronze and stone each carry albedo, ORM and normal maps (no flat material)');
  check((gltf.extensionsUsed ?? []).includes('KHR_draco_mesh_compression') && (gltf.extensionsUsed ?? []).includes('EXT_texture_webp'), 'Draco mesh and WebP textures');
  const plinth = (gltf.meshes as { name: string; primitives: { attributes: { POSITION: number } }[] }[]).find((m) => /plinth/i.test(m.name));
  const acc = plinth ? gltf.accessors[plinth.primitives[0].attributes.POSITION] : null;
  const h = acc ? acc.max[1] - acc.min[1] : 0;
  check(!!acc && Math.abs(h * FIGURE_SCALE - (PLINTH_H + FOUNDATION_DEPTH)) < 0.3, `the plinth stands ${(PLINTH_H).toFixed(2)} m over a ${FOUNDATION_DEPTH.toFixed(2)} m foundation (${(h * FIGURE_SCALE).toFixed(2)} m)`);
  check(!!acc && Math.max(acc.max[0] - acc.min[0], acc.max[2] - acc.min[2]) * FIGURE_SCALE < 6, 'plinth footprint within 6 m');
  check(STATUE_HEIGHT > 8 && STATUE_HEIGHT < 11, `the figure's head at ${STATUE_HEIGHT.toFixed(1)} m: taller than the standing dragon (4.4 m), not a tower`);
}

// --- Figure joints: a turn about the figure's -X swings a hanging arm forward (+Z), whatever the bone's rest frame.
{
  const figure = new THREE.Group();
  const arm = new THREE.Bone();
  arm.quaternion.setFromEuler(new THREE.Euler(0.7, -1.1, 0.4));
  figure.add(arm);
  const hand = new THREE.Bone();
  arm.add(hand);
  // place the hand 0.3 below the shoulder in the figure's frame
  figure.updateWorldMatrix(true, true);
  hand.position.copy(arm.worldToLocal(new THREE.Vector3(0, -0.3, 0)));
  const j = new FigureJoint(arm, figure);
  j.set(-1.0);
  figure.updateWorldMatrix(true, true);
  const p = hand.getWorldPosition(new THREE.Vector3());
  check(p.z > 0.2 && p.y > -0.2, `the spear arm swings forward and up (hand at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
  j.set(0, 0, 0.5);
  figure.updateWorldMatrix(true, true);
  const q = hand.getWorldPosition(new THREE.Vector3());
  check(q.x > 0.1 && Math.abs(q.z) < 1e-6, `a turn about the figure's Z opens the arm sideways (+X, hand at ${q.x.toFixed(2)})`);
  j.set(0);
  check(arm.quaternion.angleTo(j.rest) < 1e-9, 'zero turns give the rest pose back');
}

// On a slope the base takes the lowest ground under the footprint: no corner hangs in the air.
const slope = (x: number, z: number): number => 170 + 0.3 * x - 0.2 * z;
const pb = plinthBase(slope, 10, 20);
const corners = [-1, 1].flatMap((i) => [-1, 1].map((j) => slope(10 + i * PLINTH_HALF, 20 + j * PLINTH_HALF)));
check(corners.every((h) => h >= pb.y - 1e-9) && Math.abs(pb.y - Math.min(...corners)) < 1e-9, 'on a slope the plinth sits on the lowest corner');
check(Math.abs(pb.spread - (Math.max(...corners) - Math.min(...corners))) < 1e-9 && pb.spread < FOUNDATION_DEPTH, `the rise across the footprint (${pb.spread.toFixed(2)} m) is buried, not floating`);

const yorgi = ALL_MOMENTS.find((m) => m.id === 'aya-yorgi-challenge')!;
const lines = yorgi.content.subtitles;
const lastEnd = Math.max(...lines.map((l) => l.at + l.duration));
check(knightPose(0).spear === 0 && knightPose(-1).spear === 0, 'rest pose before the moment');
check(Math.abs(knightPose(5).spear - SPEAR_RAISED) < 0.05, 'the spear is raised while the knight challenges (5 s)');
check(knightPose(RAISE[1]).spear > SPEAR_RAISED * 0.95 && knightPose(RAISE[0] + 0.3).spear < SPEAR_RAISED * 0.5, 'raising takes about 1.4 s');
const stall = knightPose((LOWER[0] + LOWER[1]) / 2).spear;
check(stall < SPEAR_RAISED * 0.6 && stall > SPEAR_DROOP, 'lowering stalls half way (rusty)');
check(Math.abs(knightPose(lastEnd + 5).spear - SPEAR_DROOP) < 1e-6, 'afterwards the spear stays drooping');
const mid = knightPose((SHRUG[0] + SHRUG[1]) / 2);
check(mid.shrug > 0.04 && mid.shieldOut > 0.3 && knightPose(SHRUG[1] + 0.1).shrug === 0, 'the shrug goes up and back down');
const line = (t: number) => lines.find((l) => t >= l.at && t <= l.at + l.duration);
check(line(RAISE[0])?.text.startsWith('Dur orada') ?? false, 'the spear rises on "Dur orada, ejderha!"');
check(line(LOWER[0])?.text.includes('paslandı') ?? false, 'the spear comes down on "…mızrağım biraz paslandı"');
check(line(SHRUG[0])?.text.includes('berabere') ?? false, 'the shrug falls on "Bugünlük berabere diyelim mi?"');
check(CREAKS.every((t) => !!line(t)) && CREAKS.length >= 3, 'every creak falls inside a line');
check(PERFORMANCE_SEC <= lastEnd, 'the performance ends before the lines');
let jump = 0;
for (let t = 0; t < 16; t += 1 / 60) {
  jump = Math.max(jump, Math.abs(knightPose(t + 1 / 60).spear - knightPose(t).spear));
}
check(jump < 0.05, `no jump between frames (max ${jump.toFixed(3)} rad at 60 fps)`);

// Resident: the statue stands in the world near the camera before its moment, turns to the dragon when it starts.
/** A stand-in for the glTF scene: a rig with the animated joints and a plinth box. */
function standIn(): THREE.Object3D {
  const scene = new THREE.Group();
  const rig = new THREE.Object3D();
  scene.add(rig);
  const hips = new THREE.Bone();
  hips.name = 'mixamorig:Hips';
  rig.add(hips);
  for (const n of ['LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm', 'Head']) {
    const b = new THREE.Bone();
    b.name = 'mixamorig:' + n;
    hips.add(b);
  }
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  return scene;
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
async function residency(): Promise<void> {
  const site = latLonToLocal(yorgi.content.waypoints!.find((w) => w.id === 'statue')!.lat, yorgi.content.waypoints!.find((w) => w.id === 'statue')!.lon);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const dragon = { position: new THREE.Vector3(site.x, 180, site.z + 60) };
  const geo = { heightAt: (x: number, z: number) => 190 + 0.05 * (x - site.x) };
  const services: Record<string, unknown> = { geo, dragon };
  const ctx = { scene, camera, services: { tryGet: (k: string) => services[k] } } as unknown as EngineContext;
  const at = (d: number): void => {
    camera.position.set(site.x + d, 200, site.z);
    camera.updateMatrixWorld(true);
  };
  let loads = 0;
  const statue = statueFromScene(standIn());
  const a = new AyaYorgiStatueActor(async () => {
    loads++;
    return statue;
  });
  at(RESIDENT_SHOW + 300);
  a.resident(yorgi, ctx, true);
  await flush();
  check(!a.active && loads === 0, 'far away (beyond RESIDENT_SHOW): nothing loads, the statue is not in the scene');
  at(RESIDENT_SHOW - 200);
  a.resident(yorgi, ctx, true);
  a.resident(yorgi, ctx, true);
  await flush();
  check(a.active && scene.children.length === 1 && loads === 1, 'within RESIDENT_SHOW the model loads once and stands there before the moment');
  const root = scene.children[0];
  const expectY = plinthBase(geo.heightAt, site.x, site.z).y;
  check(Math.abs(root.position.y - expectY) < 1e-6, `the base sits on the lowest ground under the footprint (${root.position.y.toFixed(3)})`);
  at(RESIDENT_SHOW + 100);
  a.resident(yorgi, ctx, true);
  check(a.active, 'between SHOW and HIDE it stays (no flicker at the edge)');
  at(300);
  a.start(yorgi, ctx);
  for (let i = 0; i < 60 * 16; i++) a.update(1 / 60, ctx);
  const fig = statue.figure;
  const want = Math.atan2(dragon.position.x - root.position.x, dragon.position.z - root.position.z) - root.rotation.y;
  check(Math.abs(Math.atan2(Math.sin(fig.rotation.y - want), Math.cos(fig.rotation.y - want))) < 0.02, 'the figure turned to face the dragon');
  a.end('complete');
  a.resident(yorgi, ctx, true);
  check(a.active, 'after its lines the statue stays');
  at(RESIDENT_HIDE + 100);
  a.resident(yorgi, ctx, true);
  check(!a.active, 'beyond RESIDENT_HIDE it leaves the scene');
  at(100);
  a.resident(yorgi, ctx, true);
  check(a.active && Math.abs(fig.rotation.y - want) < 0.05 && loads === 1, 'back near: it stands again (no reload), still facing where it turned');
  a.resident(yorgi, ctx, false);
  check(!a.active, 'moments (or legends) switched off: the statue goes');
  a.dispose();
}

await residency();

console.log(`aya-yorgi-check: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
