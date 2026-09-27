/**
 * The Aya Yorgi knight statue (src/moments/aya-yorgi): its model is sound and sized against the dragon, and its three
 * animations and creaks follow the moment's lines.
 *
 *   npx tsx tools/headless/aya-yorgi-check.ts
 */
import * as THREE from 'three';
import { buildKnightStatue, STATUE_HEIGHT } from '../../src/moments/aya-yorgi/statue-model';
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
const height = box.max.y - box.min.y;
check(Math.abs(box.min.y) < 0.01, 'the plinth stands on the ground (y = 0)');
check(STATUE_HEIGHT > 8 && STATUE_HEIGHT < 11, `the figure's head at ${STATUE_HEIGHT.toFixed(1)} m: taller than the standing dragon (4.4 m), not a tower`);
check(height > STATUE_HEIGHT && height < STATUE_HEIGHT + 3.5, `${height.toFixed(1)} m to the tip of the upright spear`);
check(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) < 6, 'footprint within 6 m');

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

console.log(`aya-yorgi-check: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
