import * as THREE from 'three';
import { LANDMARKS, mirror, sideSign, SIDES } from '../anatomy';
import type { RigSkeleton } from '../skeleton';
import { MeshBuilder, SkinAccumulator } from './buffers';
import { ChainSkinner } from './chain-skin';
import { Loft } from './loft';
import { MAT } from './materials-ids';
import { PathSampler, gauss, smoothstep } from './path';
import { buildThorn } from './thorn';

/** Rest-pose toe layout (right foot): direction, length. Toes point forward-down from the ball of the foot. */
const TOES: ReadonlyArray<{ dir: [number, number, number]; length: number; radius: number; offset: [number, number, number] }> = [
  { dir: [0.0, -0.32, -1], length: 0.52, radius: 0.07, offset: [0, 0, 0] },
  { dir: [-0.42, -0.34, -0.9], length: 0.44, radius: 0.064, offset: [0, 0, 0] },
  { dir: [0.45, -0.34, -0.88], length: 0.42, radius: 0.062, offset: [0, 0, 0] },
  // Hallux: set high on the back of the metatarsus, clear of the ground (as in theropods).
  { dir: [-0.3, 0.05, 1], length: 0.22, radius: 0.05, offset: [-0.02, 0.2, 0.07] },
];

/** Hind legs: muscular digitigrade legs with four clawed toes. */
export function buildLegs(builder: MeshBuilder, rig: RigSkeleton): void {
  for (const side of SIDES) {
    const sgn = sideSign(side);
    const hip = mirror(LANDMARKS.hip, side);
    const knee = mirror(LANDMARKS.knee, side);
    const ankle = mirror(LANDMARKS.ankle, side);
    const ball = mirror(LANDMARKS.ball, side);
    const inside = hip.clone().add(new THREE.Vector3(-0.3 * sgn, 0.18, -0.05));
    const path = new PathSampler([inside, hip, knee, ankle, ball], { type: 'centripetal', samples: 1200 });
    const k = path.knotLengths;
    const L = path.length;
    const bones = [rig.id('pelvis'), rig.id(`thigh${side}`), rig.id(`shin${side}`), rig.id(`meta${side}`)];
    const skinner = new ChainSkinner(k, bones, (i) => (i === 1 ? 0.3 : 0.12));
    const radius = (s: number): number => {
      if (s < k[1]) {
        return THREE.MathUtils.lerp(0.5, 0.47, s / k[1]);
      }
      if (s < k[2]) {
        const t = (s - k[1]) / (k[2] - k[1]);
        return THREE.MathUtils.lerp(0.47, 0.19, smoothstep(0.0, 1.0, t)) + 0.06 * gauss(t - 0.3, 0.25);
      }
      if (s < k[3]) {
        const t = (s - k[2]) / (k[3] - k[2]);
        return THREE.MathUtils.lerp(0.19, 0.115, t) + 0.05 * gauss(t - 0.25, 0.2) + 0.03 * gauss(t, 0.08);
      }
      const t = (s - k[3]) / (L - k[3]);
      return THREE.MathUtils.lerp(0.115, 0.1, t) + 0.025 * gauss(t, 0.12) + 0.02 * gauss(t - 1, 0.1);
    };
    const rings: number[] = [];
    for (let s = 0; s < L; s += 0.05) {
      rings.push(s);
    }
    rings.push(L - 0.002);
    new Loft({
      path,
      rings,
      segments: 28,
      section: (s, theta, out) => {
        const r = radius(s);
        // Thigh/calf muscles bulge toward the back (+z ~ section "down" when the leg hangs) and outward.
        const back = Math.max(0, -Math.cos(theta));
        const out1 = Math.max(0, Math.sin(theta) * sgn);
        const thighZone = s > k[1] - 0.2 && s < k[2] ? 1 : 0.4;
        const bulge = 1 + 0.12 * back * thighZone + 0.06 * out1;
        out.set(Math.sin(theta) * r * 0.88 * bulge, Math.cos(theta) * r * bulge);
      },
      skin: (s, theta, pos, acc) => skinner.apply(s, acc),
      data: (s, theta, pos, out) => out.set(MAT.skin, 0, 0, 1),
      color: (s, theta, pos, out) => out.setRGB(0.95, 0.95, 0.95),
      minCircumference: 0.7,
      vScale: 1,
      capEnd: 0.05,
    }).build(builder);

    // Toes + claws, rigid on the foot bone.
    const footSkin = new SkinAccumulator().add(rig.id(`foot${side}`), 1);
    for (const toe of TOES) {
      const dir = new THREE.Vector3(toe.dir[0] * sgn, toe.dir[1], toe.dir[2]).normalize();
      const start = ball.clone().add(new THREE.Vector3(toe.offset[0] * sgn, toe.offset[1], toe.offset[2])).addScaledVector(dir, 0.02);
      const knuckle = start.clone().addScaledVector(dir, toe.length * 0.55).add(new THREE.Vector3(0, 0.03, 0));
      const tipDir = dir.clone().add(new THREE.Vector3(0, -0.2, 0)).normalize();
      const tip = knuckle.clone().addScaledVector(tipDir, toe.length * 0.45);
      const tp = new PathSampler([start, knuckle, tip], { type: 'centripetal', samples: 300 });
      const tl = tp.length;
      const rings2: number[] = [];
      for (let s = 0; s < tl; s += 0.035) {
        rings2.push(s);
      }
      rings2.push(tl - 0.002);
      new Loft({
        path: tp,
        rings: rings2,
        segments: 12,
        section: (s, theta, out) => {
          const t = s / tl;
          let r = THREE.MathUtils.lerp(toe.radius, toe.radius * 0.6, t);
          r += 0.012 * gauss(s - toe.length * 0.55, 0.05);
          out.set(Math.sin(theta) * r, Math.cos(theta) * r * 0.85);
        },
        skin: (s, theta, pos, acc) => acc.copy(footSkin),
        data: (s, theta, pos, out) => out.set(MAT.skin, 0, 0, 1),
        color: (s, theta, pos, out) => out.setRGB(0.9, 0.9, 0.9),
        minCircumference: 0.25,
        vScale: 1,
        capEnd: 0.02,
      }).build(builder);
      buildThorn(builder, {
        base: tip.clone().addScaledVector(tipDir, -0.03),
        dir: tipDir.clone().add(new THREE.Vector3(0, 0.12, 0)).normalize(),
        bendToward: new THREE.Vector3(0, -1, 0),
        bend: 0.5,
        length: toe.length * 0.42,
        radius: toe.radius * 0.62,
        tipRadius: 0.002,
        flatten: 0.62,
        keel: 0.5,
        sink: 0.02,
        segments: 9,
        rings: 10,
        materialId: MAT.claw,
        skin: footSkin,
      });
    }
  }
}
