import * as THREE from 'three';
import { PathSampler } from './geometry/path';

/**
 * Rest-pose anatomy of the dragon (wyvern build: the forelimbs ARE the wings, like bats and pterosaurs;
 * on the ground it walks on its folded wing-wrists). Rig space: origin = center of mass, -Z forward, +Y up,
 * +X right. All bones have identity rest rotation; only their joint positions differ.
 */

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export const NECK_BONES = 9;
export const TAIL_BONES = 14;

export type Side = 'L' | 'R';
export const SIDES: readonly Side[] = ['R', 'L'];

export function sideSign(side: Side): number {
  return side === 'R' ? 1 : -1;
}

export function mirror(p: THREE.Vector3, side: Side): THREE.Vector3 {
  return side === 'R' ? p.clone() : new THREE.Vector3(-p.x, p.y, p.z);
}

export interface BoneSpec {
  name: string;
  parent: string | null;
  /** Joint position in rig space (rest). */
  head: THREE.Vector3;
}

/** Key landmark points (right side for bilateral ones). */
export const LANDMARKS = {
  snoutTip: v(0, 0.92, -8.42),
  skullBase: v(0, 1.2, -6.5),
  neckBase: v(0, 0.56, -2.3),
  chest: v(0, 0.47, -1.1),
  midBack: v(0, 0.45, 0.0),
  lumbar: v(0, 0.44, 1.0),
  pelvis: v(0, 0.4, 1.95),
  tailStart: v(0, 0.35, 2.7),
  tailTip: v(0, 0.06, 9.5),
  shoulder: v(0.52, 0.82, -1.3),
  elbow: v(2.62, 0.98, -0.62),
  wrist: v(5.66, 1.1, -1.42),
  hip: v(0.5, 0.08, 1.85),
  knee: v(0.66, -0.88, 2.28),
  ankle: v(0.68, -1.56, 3.02),
  ball: v(0.7, -1.98, 3.28),
  saddleSeat: v(0, 1.055, -2.55),
};

/** Neck control curve (skull base is the end). */
const NECK_CURVE = [LANDMARKS.neckBase, v(0, 0.75, -3.4), v(0, 0.97, -4.6), v(0, 1.11, -5.6), LANDMARKS.skullBase];
const TAIL_CURVE = [LANDMARKS.tailStart, v(0, 0.3, 4.3), v(0, 0.2, 6.4), v(0, 0.11, 8.1), LANDMARKS.tailTip];

function chainJoints(curve: THREE.Vector3[], count: number, ratio: number): THREE.Vector3[] {
  const path = new PathSampler(curve, { type: 'centripetal' });
  const lengths: number[] = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const l = Math.pow(ratio, i);
    lengths.push(l);
    sum += l;
  }
  const joints: THREE.Vector3[] = [];
  let s = 0;
  for (let i = 0; i <= count; i++) {
    joints.push(path.pointAt(s, new THREE.Vector3()));
    if (i < count) {
      s += (lengths[i] / sum) * path.length;
    }
  }
  return joints;
}

/** Neck joints: [neck0.head ... neck8.head, skullBase]. */
export const NECK_JOINTS = chainJoints(NECK_CURVE, NECK_BONES, 0.97);
/** Tail joints: [tail0.head ... tail13.head, tailTip]. */
export const TAIL_JOINTS = chainJoints(TAIL_CURVE, TAIL_BONES, 0.925);

/** Head axis (skull base -> snout tip) and head-local up. */
export const HEAD_AXIS = LANDMARKS.snoutTip.clone().sub(LANDMARKS.skullBase);
export const HEAD_LENGTH = HEAD_AXIS.length();
export const HEAD_FWD = HEAD_AXIS.clone().normalize();
export const HEAD_UP = new THREE.Vector3(0, 1, 0).addScaledVector(HEAD_FWD, -HEAD_FWD.y).normalize();

/** Point in the head frame: h = 0..1 along the head, up/right offsets in meters. */
export function headPoint(h: number, up: number, right = 0): THREE.Vector3 {
  return LANDMARKS.skullBase.clone().addScaledVector(HEAD_FWD, h * HEAD_LENGTH).addScaledVector(HEAD_UP, up).add(new THREE.Vector3(right, 0, 0));
}

export const JAW_HINGE_H = 0.17;
export const JAW_HINGE = headPoint(JAW_HINGE_H, -0.2);

/** Wing finger layout: angle (rad) measured in the wing plane from +X toward +Z (backward), segment lengths. */
export const FINGERS: ReadonlyArray<{ angle: number; lengths: [number, number]; bend: number }> = [
  { angle: THREE.MathUtils.degToRad(7), lengths: [3.35, 3.15], bend: THREE.MathUtils.degToRad(5) },
  { angle: THREE.MathUtils.degToRad(30), lengths: [2.95, 2.7], bend: THREE.MathUtils.degToRad(7) },
  { angle: THREE.MathUtils.degToRad(55), lengths: [2.55, 2.3], bend: THREE.MathUtils.degToRad(8) },
  { angle: THREE.MathUtils.degToRad(82), lengths: [2.1, 1.85], bend: THREE.MathUtils.degToRad(6) },
];

/** Upward slope of the fingers from the wrist (dihedral within the hand). */
const FINGER_RISE = 0.02;

export function fingerJoints(side: Side): THREE.Vector3[][] {
  const s = sideSign(side);
  const wrist = mirror(LANDMARKS.wrist, side);
  return FINGERS.map((f) => {
    const a0 = f.angle;
    const a1 = f.angle + f.bend;
    const d0 = new THREE.Vector3(Math.cos(a0) * s, FINGER_RISE, Math.sin(a0));
    const d1 = new THREE.Vector3(Math.cos(a1) * s, FINGER_RISE * 0.5, Math.sin(a1));
    const knuckle = wrist.clone().addScaledVector(d0, f.lengths[0]);
    const tip = knuckle.clone().addScaledVector(d1, f.lengths[1]);
    return [wrist, knuckle, tip];
  });
}

export function thumbTip(side: Side): THREE.Vector3 {
  return mirror(LANDMARKS.wrist, side).add(new THREE.Vector3(0.3 * sideSign(side), 0.04, -0.52));
}

/**
 * Rider rest points (rig space). A 1.8 m rider sits in a tall padded saddle over the neck base, leaning slightly
 * forward, fists held up in front of the chest on the reins (thumbs up, in view of the POV camera).
 */
export const RIDER = {
  pelvis: v(0, 1.21, -2.52),
  spine: v(0, 1.27, -2.53),
  chest: v(0, 1.53, -2.61),
  head: v(0, 1.79, -2.69),
  eye: v(0, 1.945, -2.79),
  shoulder: v(0.19, 1.685, -2.64),
  elbow: v(0.3, 1.52, -2.84),
  wrist: v(0.165, 1.555, -3.12),
  hip: v(0.1, 1.21, -2.52),
  knee: v(0.5, 0.95, -2.8),
  ankle: v(0.7, 0.54, -2.66),
  toe: v(0.74, 0.48, -2.86),
};

/** Where the cloak hangs from the shoulders (pivot of the riderCloak bone). */
export const RIDER_CLOAK_PIVOT = v(0, 1.715, -2.628);

/** Extra saddle padding (m) that lifts the seat (and the rider) above the neck for a clear view over the head. */
export const SADDLE_LIFT = 0.08;

/**
 * Rest frame of a rein fist (thumbs-up grip, palms facing each other): `fwd` runs along the metacarpals, `up` is the
 * grip channel axis (pinky at the bottom, index and thumb on top), `medial` points from the back of the hand to the
 * palm. The rein runs up through `channel`, entering under the little finger and leaving between thumb and index.
 */
export interface FistFrame {
  wrist: THREE.Vector3;
  fwd: THREE.Vector3;
  up: THREE.Vector3;
  medial: THREE.Vector3;
  channel: THREE.Vector3;
}

export function fistFrame(side: Side): FistFrame {
  const sgn = sideSign(side);
  const wrist = mirror(RIDER.wrist, side);
  const elbow = mirror(RIDER.elbow, side);
  // The wrist is slightly cocked down from the forearm line.
  const fwd = wrist.clone().sub(elbow).normalize().add(new THREE.Vector3(0, -0.12, 0)).normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(fwd, -fwd.y).normalize();
  const medial = new THREE.Vector3().crossVectors(fwd, up).normalize();
  if (medial.x * sgn > 0) {
    medial.negate();
  }
  const channel = wrist.clone().addScaledVector(fwd, 0.1).addScaledVector(medial, 0.02);
  return { wrist, fwd, up, medial, channel };
}

/** Point in a fist frame: f along the metacarpals, u along the grip axis, m toward the palm (m). */
export function fistPoint(frame: FistFrame, f: number, u: number, m: number): THREE.Vector3 {
  return frame.wrist.clone().addScaledVector(frame.fwd, f).addScaledVector(frame.up, u).addScaledVector(frame.medial, m);
}

/**
 * Finger joints shared by the four curled fingers (they are stacked along the grip axis, so one hinge about `up`
 * opens them all): A = end of the proximal phalanx, B = middle of the wrap around the rein, C = last joint before
 * the tucked tip. `thumb` = thumb base.
 */
export const FIST_JOINTS = { a: [0.104, 0.001], b: [0.122, 0.02], c: [0.108, 0.04], thumb: [0.012, 0.024, 0.02] } as const;

export function buildBoneSpecs(): BoneSpec[] {
  const specs: BoneSpec[] = [];
  const add = (name: string, parent: string | null, head: THREE.Vector3): void => {
    specs.push({ name, parent, head: head.clone() });
  };
  add('root', null, v(0, 0, 0));
  add('chest', 'root', LANDMARKS.chest);
  for (let i = 0; i < NECK_BONES; i++) {
    add(`neck${i}`, i === 0 ? 'chest' : `neck${i - 1}`, NECK_JOINTS[i]);
  }
  add('head', `neck${NECK_BONES - 1}`, LANDMARKS.skullBase);
  add('jaw', 'head', JAW_HINGE);
  add('lumbar', 'root', LANDMARKS.lumbar);
  add('pelvis', 'lumbar', LANDMARKS.pelvis);
  for (let i = 0; i < TAIL_BONES; i++) {
    add(`tail${i}`, i === 0 ? 'pelvis' : `tail${i - 1}`, TAIL_JOINTS[i]);
  }
  for (const side of SIDES) {
    add(`thigh${side}`, 'pelvis', mirror(LANDMARKS.hip, side));
    add(`shin${side}`, `thigh${side}`, mirror(LANDMARKS.knee, side));
    add(`meta${side}`, `shin${side}`, mirror(LANDMARKS.ankle, side));
    add(`foot${side}`, `meta${side}`, mirror(LANDMARKS.ball, side));

    add(`humerus${side}`, 'chest', mirror(LANDMARKS.shoulder, side));
    add(`forearm${side}`, `humerus${side}`, mirror(LANDMARKS.elbow, side));
    add(`hand${side}`, `forearm${side}`, mirror(LANDMARKS.wrist, side));
    add(`thumb${side}`, `hand${side}`, mirror(LANDMARKS.wrist, side));
    const fingers = fingerJoints(side);
    fingers.forEach((joints, f) => {
      add(`finger${f}a${side}`, `hand${side}`, joints[0]);
      add(`finger${f}b${side}`, `finger${f}a${side}`, joints[1]);
    });
  }
  add('riderPelvis', 'chest', RIDER.pelvis);
  add('riderSpine', 'riderPelvis', RIDER.spine);
  add('riderChest', 'riderSpine', RIDER.chest);
  add('riderHead', 'riderChest', RIDER.head);
  for (const side of SIDES) {
    add(`riderUpperArm${side}`, 'riderChest', mirror(RIDER.shoulder, side));
    add(`riderForearm${side}`, `riderUpperArm${side}`, mirror(RIDER.elbow, side));
    add(`riderHand${side}`, `riderForearm${side}`, mirror(RIDER.wrist, side));
    const fist = fistFrame(side);
    add(`riderFingerA${side}`, `riderHand${side}`, fistPoint(fist, FIST_JOINTS.a[0], 0, FIST_JOINTS.a[1]));
    add(`riderFingerB${side}`, `riderFingerA${side}`, fistPoint(fist, FIST_JOINTS.b[0], 0, FIST_JOINTS.b[1]));
    add(`riderFingerC${side}`, `riderFingerB${side}`, fistPoint(fist, FIST_JOINTS.c[0], 0, FIST_JOINTS.c[1]));
    add(`riderThumb${side}`, `riderHand${side}`, fistPoint(fist, FIST_JOINTS.thumb[0], FIST_JOINTS.thumb[1], FIST_JOINTS.thumb[2]));
    add(`riderThigh${side}`, 'riderPelvis', mirror(RIDER.hip, side));
    add(`riderShin${side}`, `riderThigh${side}`, mirror(RIDER.knee, side));
    add(`riderFoot${side}`, `riderShin${side}`, mirror(RIDER.ankle, side));
  }
  // Grip of the right rein: follows the right fist, or the left fist while the right hand is busy (one-handed riding).
  add('riderReinR', 'chest', mirror(RIDER.wrist, 'R'));
  // Lower cloak: pivots at the shoulders so the cloth keeps streaming back when the rider leans far forward.
  add('riderCloak', 'riderChest', RIDER_CLOAK_PIVOT);
  return specs;
}
