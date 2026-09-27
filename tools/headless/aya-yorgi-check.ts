/**
 * The Aya Yorgi knight statue (src/moments/aya-yorgi): its model is sound and sized against the dragon, and its three
 * animations and creaks follow the moment's lines.
 *
 *   npx tsx tools/headless/aya-yorgi-check.ts
 */
import * as THREE from 'three';
import { buildKnightStatue, FOUNDATION_DEPTH, plinthBase, PLINTH_HALF, STATUE_HEIGHT } from '../../src/moments/aya-yorgi/statue-model';
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

const s = buildKnightStatue();
s.root.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(s.root);
let finite = true;
let tris = 0;
s.root.traverse((o) => {
  if (o instanceof THREE.Mesh) {
    const a = o.geometry.getAttribute('position').array as Float32Array;
    finite &&= a.every(Number.isFinite);
    tris += (o.geometry.getIndex()?.count ?? 0) / 3;
    check(!!o.geometry.getAttribute('color') && !!o.geometry.getAttribute('normal'), `${o.name}: vertex colours and normals`);
  }
});
check(finite, 'every vertex is finite');
check(tris > 500 && tris < 6000, `a light model (${tris} triangles)`);
const height = box.max.y;
check(Math.abs(box.min.y + FOUNDATION_DEPTH) < 0.01, `a foundation reaches ${FOUNDATION_DEPTH} m below the base`);
check(STATUE_HEIGHT > 8 && STATUE_HEIGHT < 11, `the figure's head at ${STATUE_HEIGHT.toFixed(1)} m: taller than the standing dragon (4.4 m), not a tower`);
check(height > STATUE_HEIGHT && height < STATUE_HEIGHT + 3.5, `${height.toFixed(1)} m to the tip of the upright spear`);
check(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) < 6, 'footprint within 6 m');
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
s.dispose();

// Resident: the statue stands in the world near the camera before its moment, turns to the dragon when it starts.
{
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
  const a = new AyaYorgiStatueActor();
  at(RESIDENT_SHOW + 300);
  a.resident(yorgi, ctx, true);
  check(!a.active, 'far away (beyond RESIDENT_SHOW): the statue is not in the scene');
  at(RESIDENT_SHOW - 200);
  a.resident(yorgi, ctx, true);
  check(a.active && scene.children.length === 1, 'within RESIDENT_SHOW it stands there before the moment');
  const root = scene.children[0];
  check(Math.abs(root.position.y - 189.895) < 0.01, `the base sits on the lowest ground under the footprint (${root.position.y.toFixed(3)})`);
  at(RESIDENT_SHOW + 100);
  a.resident(yorgi, ctx, true);
  check(a.active, 'between SHOW and HIDE it stays (no flicker at the edge)');
  at(300);
  a.start(yorgi, ctx);
  for (let i = 0; i < 60 * 16; i++) a.update(1 / 60, ctx);
  const fig = root.children.find((c) => c.type === 'Group')!;
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
  check(a.active && Math.abs(fig.rotation.y - want) < 0.05, 'back near: it stands again, still facing where it turned');
  a.resident(yorgi, ctx, false);
  check(!a.active, 'moments (or legends) switched off: the statue goes');
  a.dispose();
}

console.log(`aya-yorgi-check: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
