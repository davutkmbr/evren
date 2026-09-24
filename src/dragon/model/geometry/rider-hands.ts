import * as THREE from 'three';
import { FIST_JOINTS, fistFrame, type Side } from '../anatomy';
import type { RigSkeleton } from '../skeleton';
import type { MeshBuilder, SkinAccumulator } from './buffers';
import { RIDER_MAT } from './materials-ids';
import { PathSampler } from './path';
import { buildTube } from './rider-parts';

export { fistFrame, type FistFrame } from '../anatomy';

/** Half-width (in finger arc-length fraction) of the skin blend around each finger joint. */
const JOINT_BLEND = 0.09;

/** Weights along a chain: owners[0] up to knots[0], owners[i] between knots[i-1] and knots[i], blended at each knot. */
function chainSkin(acc: SkinAccumulator, t: number, knots: number[], owners: number[], halfWidth: number): void {
  let seg = 0;
  while (seg < knots.length && t > knots[seg]) {
    seg++;
  }
  // Blend with the previous owner just after a knot, with the next owner just before one.
  if (seg > 0 && t - knots[seg - 1] < halfWidth) {
    const k = THREE.MathUtils.smoothstep(t, knots[seg - 1] - halfWidth, knots[seg - 1] + halfWidth);
    acc.add(owners[seg - 1], 1 - k).add(owners[seg], k);
    return;
  }
  if (seg < knots.length && knots[seg] - t < halfWidth) {
    const k = THREE.MathUtils.smoothstep(t, knots[seg] - halfWidth, knots[seg] + halfWidth);
    acc.add(owners[seg], 1 - k).add(owners[seg + 1], k);
    return;
  }
  acc.add(owners[seg], 1);
}

/** Arc-length fractions of the joints A, B, C along a finger path (control points 1, 2 and 3). */
function fingerKnots(points: THREE.Vector3[], up: THREE.Vector3): number[] {
  const path = new PathSampler(points, { type: 'centripetal', up, samples: 400 });
  return [1, 2, 3].map((i) => path.knotLengths[i] / path.length);
}

/**
 * Gloved fist closed around the rein: back of the hand, four curled fingers, thumb over the index, flared cuff.
 * The fingers are skinned to three shared joints (they open together for petting and pointing), the thumb to its own.
 */
export function buildFist(builder: MeshBuilder, rig: RigSkeleton, side: Side): void {
  const handBone = rig.id(`riderHand${side}`);
  const fingerBones = [handBone, rig.id(`riderFingerA${side}`), rig.id(`riderFingerB${side}`), rig.id(`riderFingerC${side}`)];
  const thumbBone = rig.id(`riderThumb${side}`);
  const { wrist, fwd, up, medial } = fistFrame(side);
  const at = (f: number, u: number, m: number): THREE.Vector3 => wrist.clone().addScaledVector(fwd, f).addScaledVector(up, u).addScaledVector(medial, m);
  const skin = (_t: number, acc: SkinAccumulator): void => {
    acc.add(handBone, 1);
  };
  const glove = (): number => RIDER_MAT.darkLeather;
  // Back of the hand / palm: wide along the grip axis, thin toward the palm. Its front edge bends a little with the
  // first finger joint (knuckles).
  buildTube(builder, {
    points: [at(-0.004, 0.002, 0.004), at(0.04, 0.001, 0.006), at(0.083, 0, 0.008)],
    up: medial,
    keys: [
      [0, 0.036, 0.02, 0.018],
      [0.45, 0.043, 0.022, 0.016],
      [1, 0.045, 0.02, 0.016],
    ],
    segments: 14,
    spacing: 0.01,
    material: glove,
    skin: (t, acc) => {
      const k = THREE.MathUtils.smoothstep(t, 0.8, 1.0) * 0.25;
      acc.add(handBone, 1 - k).add(fingerBones[1], k);
    },
    wear: () => 0.3,
    bump: (t, theta) => 0.002 * Math.pow(Math.max(0, -Math.cos(theta)), 4) * Math.sin(t * 18),
    capEnd: true,
  });
  // Fingers (index on top): proximal phalanx forward, middle phalanx wrapping around the rein, tip tucked back.
  const fingerUp = [0.029, 0.01, -0.009, -0.027];
  const scale = [1, 1.05, 0.98, 0.84];
  const radius = [0.0098, 0.0102, 0.0096, 0.0085];
  for (let i = 0; i < 4; i++) {
    const k = scale[i];
    const u = fingerUp[i];
    const pts = [
      at(0.074, u, 0.004),
      at(0.074 + 0.03 * k, u, 0.001),
      at(0.08 + 0.042 * k, u, 0.02 * k),
      at(0.078 + 0.03 * k, u, 0.04 * k),
      at(0.066 + 0.012 * k, u, 0.043 * k),
    ];
    const knots = fingerKnots(pts, up);
    buildTube(builder, {
      points: pts,
      up: up,
      keys: [
        [0, radius[i] * 1.08, radius[i], radius[i]],
        [0.3, radius[i] * 1.12, radius[i] * 1.05, radius[i]],
        [1, radius[i] * 0.85, radius[i] * 0.8, radius[i] * 0.8],
      ],
      segments: 9,
      spacing: 0.007,
      material: glove,
      skin: (t, acc) => chainSkin(acc, t, knots, fingerBones, JOINT_BLEND),
      wear: (t) => 0.4 + 0.6 * Math.exp(-Math.pow((t - 0.32) / 0.12, 2)),
      bump: (t) => 0.0014 * Math.exp(-Math.pow((t - 0.32) / 0.07, 2)) + 0.001 * Math.exp(-Math.pow((t - 0.62) / 0.07, 2)),
      capEnd: true,
    });
  }
  // Thumb: from the base of the palm up over the index finger's middle phalanx, pinning the rein.
  const [tf, tu, tm] = FIST_JOINTS.thumb;
  buildTube(builder, {
    points: [at(tf, tu, tm), at(0.045, 0.04, 0.03), at(0.075, 0.042, 0.034), at(0.094, 0.036, 0.032)],
    up: medial,
    keys: [
      [0, 0.016, 0.015, 0.015],
      [0.4, 0.013, 0.012, 0.012],
      [1, 0.0095, 0.0085, 0.0085],
    ],
    segments: 9,
    spacing: 0.008,
    material: glove,
    skin: (t, acc) => {
      const k = THREE.MathUtils.smoothstep(t, 0.0, 0.3);
      acc.add(handBone, 1 - k).add(thumbBone, k);
    },
    wear: () => 0.5,
    capEnd: true,
  });
  // Flared gauntlet cuff over the sleeve.
  buildTube(builder, {
    points: [at(-0.075, 0, -0.004), at(-0.035, 0, 0), at(0.004, 0.001, 0.004)],
    up: medial,
    keys: [
      [0, 0.045, 0.043, 0.043],
      [0.5, 0.042, 0.037, 0.037],
      [1, 0.038, 0.028, 0.026],
    ],
    segments: 14,
    spacing: 0.012,
    material: glove,
    skin,
    wear: (t) => (t < 0.12 ? 1 : 0.2),
    bump: (t) => (t < 0.08 ? 0.002 : 0) + 0.0012 * Math.pow(Math.max(0, Math.cos(t * Math.PI * 5)), 10),
  });
}
