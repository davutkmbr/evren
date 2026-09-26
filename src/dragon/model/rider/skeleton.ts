/**
 * The rider's humanoid skeleton. Bone names follow Mixamo (Hips, Spine, Spine1, Spine2, Neck, Head, LeftShoulder,
 * LeftArm, LeftForeArm, LeftHand, LeftHandIndex1..3, LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase, ...) so clips can be
 * retargeted later; face (jaw, eyes, eyelids, mouth corners), a forearm twist helper, a three-bone hair chain and the
 * cloak are extra leaves.
 *
 * Rest (bind) pose = the riding pose, in dragon rig space (-Z forward, +Y up, +X right): seated on the saddle, torso
 * slightly forward, hands in front of the chest on the reins with the fingers half closed, thighs around the neck and
 * feet in the stirrups. Every bone has an identity rest rotation (joint positions only), like the dragon's skeleton.
 * Proportions follow the appearance (shape, build, height).
 */
import * as THREE from 'three';
import type { RiderAppearance } from './appearance';

export type RSide = 'Left' | 'Right';
export const RSIDES: readonly RSide[] = ['Right', 'Left'];
export const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;
export type Finger = (typeof FINGERS)[number];

/** +1 for the right side (rig +X), -1 for the left. */
export function rsign(side: RSide): number {
  return side === 'Right' ? 1 : -1;
}

/** Local frame for authoring: origin + axes (x lateral / right-handed, y along, z forward...), per use. */
export class Frame {
  constructor(
    readonly o: THREE.Vector3,
    readonly x: THREE.Vector3,
    readonly y: THREE.Vector3,
    readonly z: THREE.Vector3,
  ) {}

  /** Rig-space point at local (a, b, c). */
  p(a: number, b: number, c: number): THREE.Vector3 {
    return this.o.clone().addScaledVector(this.x, a).addScaledVector(this.y, b).addScaledVector(this.z, c);
  }

  /** Rig-space direction for local (a, b, c). */
  d(a: number, b: number, c: number): THREE.Vector3 {
    return new THREE.Vector3().addScaledVector(this.x, a).addScaledVector(this.y, b).addScaledVector(this.z, c);
  }

  /** y along `y`, z toward `zHint`, x = z cross y (with z forward and y up, x is the rider's right). */
  static fromYZ(o: THREE.Vector3, y: THREE.Vector3, zHint: THREE.Vector3): Frame {
    const yy = y.clone().normalize();
    const z = zHint.clone().addScaledVector(yy, -zHint.dot(yy)).normalize();
    const x = new THREE.Vector3().crossVectors(z, yy).normalize();
    return new Frame(o.clone(), x, yy, z);
  }
}

/** Body measurements (m) derived from the appearance. */
export interface Proportions {
  height: number;
  /** Height relative to the 1.78 m reference. */
  s: number;
  shape: number;
  build: number;
  shoulderHalf: number;
  hipHalf: number;
  handScale: number;
  headScale: number;
  upperArm: number;
  forearm: number;
  thigh: number;
  shin: number;
}

export function proportions(a: RiderAppearance): Proportions {
  const shape = a.shape;
  const height = THREE.MathUtils.lerp(1.64, 1.78, shape) + (a.height - 0.5) * 0.16;
  const s = height / 1.78;
  return {
    height,
    s,
    shape,
    build: a.build,
    shoulderHalf: (THREE.MathUtils.lerp(0.17, 0.205, shape) + 0.01 * a.build) * s,
    hipHalf: THREE.MathUtils.lerp(0.092, 0.086, shape) * s,
    // Stylized: slightly large hands and head.
    handScale: THREE.MathUtils.lerp(1.1, 1.22, shape) * s,
    // Heads vary less than bodies with height.
    headScale: THREE.MathUtils.lerp(1.26, 1.3, shape) * (0.6 + 0.4 * s),
    upperArm: 0.183 * height,
    forearm: 0.146 * height,
    thigh: 0.245 * height,
    shin: 0.244 * height,
  };
}

export interface BoneDef {
  name: string;
  parent: string | null;
  head: THREE.Vector3;
}

/** Hand layout of one side: finger joint chains (MCP/CMC first) and the hand frame. */
export interface HandLayout {
  frame: Frame;
  /** Per finger: 4 points (3 joints + tip). */
  chains: Record<Finger, THREE.Vector3[]>;
  /** Per finger: radius at each of the 4 points. */
  radii: Record<Finger, number[]>;
}

export interface RiderSkeletonLayout {
  props: Proportions;
  bones: BoneDef[];
  /** Named joints (rig space). */
  j: Record<string, THREE.Vector3>;
  /** Authoring frames: pelvis, chest, head (x right, y up, z forward along the face). */
  pelvis: Frame;
  chest: Frame;
  head: Frame;
  hands: Record<RSide, HandLayout>;
  /** Mid-eye point (POV camera) and the eye look direction at rest. */
  eye: THREE.Vector3;
  /** Hair chain joints (behind the head, hanging down the back of the neck). */
  hair: THREE.Vector3[];
  cloakPivot: THREE.Vector3;
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const deg = THREE.MathUtils.degToRad;

/** Point along the (x-mirrored) direction from `from`. */
function along(from: THREE.Vector3, dir: THREE.Vector3, length: number): THREE.Vector3 {
  return from.clone().addScaledVector(dir.clone().normalize(), length);
}

/** Two-bone rest placement: elbow / knee from root, end and a pole point. */
function midJoint(root: THREE.Vector3, end: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3): THREE.Vector3 {
  const d = end.clone().sub(root);
  let dist = d.length();
  dist = Math.min(dist, (l1 + l2) * 0.999);
  const dir = d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const hgt = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const bend = pole.clone().sub(root);
  bend.addScaledVector(dir, -bend.dot(dir)).normalize();
  return root.clone().addScaledVector(dir, a).addScaledVector(bend, hgt);
}

/** Seat surface (rig y) the pelvis rests on and where along the neck the rider sits. */
export const SEAT_Y = 1.1;
export const SEAT_Z = -2.52;

export function buildRiderLayout(a: RiderAppearance): RiderSkeletonLayout {
  const P = proportions(a);
  const s = P.s;
  const j: Record<string, THREE.Vector3> = {};
  const bones: BoneDef[] = [];
  const add = (name: string, parent: string | null, head: THREE.Vector3): void => {
    j[name] = head.clone();
    bones.push({ name, parent, head: head.clone() });
  };

  // --- Spine: slight forward lean, the neck carries the head forward a little.
  const hips = v(0, SEAT_Y + 0.1 * s, SEAT_Z);
  const seg = (from: THREE.Vector3, len: number, leanDeg: number): THREE.Vector3 =>
    from.clone().add(v(0, Math.cos(deg(leanDeg)), -Math.sin(deg(leanDeg))).multiplyScalar(len));
  const spine = seg(hips, 0.095 * s, 2);
  const spine1 = seg(spine, 0.095 * s, 7);
  const spine2 = seg(spine1, 0.105 * s, 10);
  const neck = seg(spine2, 0.18 * s, 8);
  const headJ = seg(neck, 0.075 * s, 16);
  add('Hips', null, hips);
  add('Spine', 'Hips', spine);
  add('Spine1', 'Spine', spine1);
  add('Spine2', 'Spine1', spine2);
  add('Neck', 'Spine2', neck);
  add('Head', 'Neck', headJ);

  // Head frame: looking forward, 6 deg down; z = face forward (rig -Z).
  const hs = P.headScale;
  const pitch = deg(6);
  const headFrame = new Frame(headJ.clone(), v(1, 0, 0), v(0, Math.cos(pitch), -Math.sin(pitch)), v(0, -Math.sin(pitch), -Math.cos(pitch)));
  const hp = (x: number, y: number, z: number): THREE.Vector3 => headFrame.p(x * hs, y * hs, z * hs);
  add('Jaw', 'Head', hp(0, 0.03, 0.035));
  const eyeY = 0.062;
  const eyeZ = 0.071;
  for (const side of RSIDES) {
    const sg = rsign(side);
    add(`${side}Eye`, 'Head', hp(0.032 * sg, eyeY, eyeZ));
    add(`${side}Eyelid`, 'Head', hp(0.032 * sg, eyeY, eyeZ));
    add(`${side}Mouth`, 'Head', hp(0.022 * sg, 0.004, 0.086));
  }
  // Hair chain: from the back of the head down the nape (ponytail / braid anchor; used by those styles only).
  const hair = [hp(0, 0.1, -0.09), hp(0, 0.02, -0.125), hp(0, -0.09, -0.135), hp(0, -0.2, -0.13)];
  add('Hair1', 'Head', hair[0]);
  add('Hair2', 'Hair1', hair[1]);
  add('Hair3', 'Hair2', hair[2]);

  const chestFrame = Frame.fromYZ(spine2, neck.clone().sub(spine2), v(0, 0, -1));
  const pelvisFrame = Frame.fromYZ(hips, spine.clone().sub(hips), v(0, 0, -1));

  const hands = {} as Record<RSide, HandLayout>;
  for (const side of RSIDES) {
    const sg = rsign(side);
    // Clavicle from the sternum end to the shoulder joint.
    const clav = neck.clone().add(v(0.028 * sg * s, -0.035 * s, -0.045 * s));
    const shoulder = neck.clone().add(v(P.shoulderHalf * sg, -0.05 * s, -0.012 * s));
    add(`${side}Shoulder`, 'Spine2', clav);
    add(`${side}Arm`, `${side}Shoulder`, shoulder);
    // Rest hands on the reins in front of the chest; elbows out and back.
    const wrist = hips.clone().add(v(0.155 * sg * s, 0.33 * s, -0.52 * s));
    const elbow = midJoint(shoulder, wrist, P.upperArm, P.forearm, shoulder.clone().add(v(0.35 * sg, -0.45, 0.25)));
    const wristFixed = along(elbow, wrist.clone().sub(elbow), P.forearm);
    add(`${side}ForeArm`, `${side}Arm`, elbow);
    add(`${side}ForeArmTwist`, `${side}ForeArm`, elbow.clone().lerp(wristFixed, 0.6));
    add(`${side}Hand`, `${side}ForeArm`, wristFixed);

    // Hand frame: y along the metacarpals (forearm line cocked 12 deg down), z toward the thumb (up), x = palm normal
    // pointing out of the back of the hand (lateral).
    const fore = wristFixed.clone().sub(elbow).normalize();
    const handDir = fore.clone().add(v(0, -0.2, 0)).normalize();
    const radial = v(0, 1, 0).addScaledVector(handDir, -handDir.y).normalize();
    const hf = Frame.fromYZ(wristFixed, handDir, radial);
    // x = the back of the hand (lateral: +X on the right hand, -X on the left).
    const dorsal = hf.x.clone().multiplyScalar(hf.x.x * sg >= 0 ? 1 : -1);
    const frame = new Frame(wristFixed.clone(), dorsal, hf.y.clone(), hf.z.clone());
    const hsc = P.handScale;
    // Local hand coordinates: (dorsal, distal, radial).
    const L = (dor: number, dis: number, rad: number): THREE.Vector3 => frame.p(dor * hsc, dis * hsc, rad * hsc);
    const Ld = (dor: number, dis: number, rad: number): THREE.Vector3 => frame.d(dor, dis, rad).normalize();
    const chains = {} as Record<Finger, THREE.Vector3[]>;
    const radii = {} as Record<Finger, number[]>;
    const fingerDefs: Record<Exclude<Finger, 'Thumb'>, { mcp: [number, number, number]; lens: number[]; r: number[]; spread: number }> = {
      Index: { mcp: [0.004, 0.094, 0.026], lens: [0.042, 0.025, 0.021], r: [0.0102, 0.0092, 0.0083, 0.0072], spread: 0.1 },
      Middle: { mcp: [0.005, 0.097, 0.007], lens: [0.047, 0.029, 0.022], r: [0.0105, 0.0095, 0.0086, 0.0074], spread: 0.02 },
      Ring: { mcp: [0.003, 0.091, -0.011], lens: [0.044, 0.027, 0.021], r: [0.0098, 0.0089, 0.0081, 0.007], spread: -0.06 },
      Pinky: { mcp: [0.0, 0.082, -0.027], lens: [0.034, 0.02, 0.018], r: [0.0086, 0.0077, 0.007, 0.0062], spread: -0.14 },
    };
    // Rest curl per joint (rad): relaxed grip, more toward the little finger.
    const curls: Record<Exclude<Finger, 'Thumb'>, number[]> = {
      Index: [0.35, 0.4, 0.25],
      Middle: [0.42, 0.45, 0.28],
      Ring: [0.5, 0.48, 0.3],
      Pinky: [0.58, 0.5, 0.3],
    };
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky'] as const) {
      const def = fingerDefs[f];
      const pts = [L(...def.mcp)];
      let bend = 0;
      for (let k = 0; k < 3; k++) {
        bend += curls[f][k];
        // Flex toward the palm (-dorsal), fanned slightly by `spread` toward radial.
        const dir = Ld(-Math.sin(bend), Math.cos(bend), def.spread * Math.cos(bend));
        pts.push(pts[k].clone().addScaledVector(dir, def.lens[k] * hsc));
      }
      chains[f] = pts;
      radii[f] = def.r.map((r) => r * hsc * (0.94 + 0.12 * P.build));
    }
    // Thumb: CMC near the wrist on the palm side, opposed, pointing forward and up along the index.
    const cmc = L(-0.012, 0.024, 0.02);
    const t1 = cmc.clone().addScaledVector(Ld(-0.35, 0.62, 0.7), 0.046 * hsc);
    const t2 = t1.clone().addScaledVector(Ld(-0.25, 0.85, 0.46), 0.033 * hsc);
    const t3 = t2.clone().addScaledVector(Ld(-0.35, 0.88, 0.3), 0.027 * hsc);
    chains.Thumb = [cmc, t1, t2, t3];
    radii.Thumb = [0.0135, 0.0112, 0.0098, 0.0086].map((r) => r * hsc * (0.94 + 0.12 * P.build));
    hands[side] = { frame, chains, radii };
    for (const f of FINGERS) {
      const c = chains[f];
      add(`${side}Hand${f}1`, `${side}Hand`, c[0]);
      add(`${side}Hand${f}2`, `${side}Hand${f}1`, c[1]);
      add(`${side}Hand${f}3`, `${side}Hand${f}2`, c[2]);
    }

    // Legs: thighs spread around the dragon's neck, shins down to the stirrups.
    const hip = hips.clone().add(v(P.hipHalf * sg, -0.03 * s, 0.005 * s));
    const knee = along(hip, v(0.72 * sg, -0.47, -0.51), P.thigh);
    const ankle = along(knee, v(0.42 * sg, -0.86, 0.29), P.shin);
    const ball = ankle.clone().add(v(0.025 * sg * s, -0.055 * s, -0.135 * s));
    add(`${side}UpLeg`, 'Hips', hip);
    add(`${side}Leg`, `${side}UpLeg`, knee);
    add(`${side}Foot`, `${side}Leg`, ankle);
    add(`${side}ToeBase`, `${side}Foot`, ball);
  }
  const cloakPivot = neck.clone().add(v(0, -0.06 * s, 0.07 * s));
  add('Cloak', 'Spine2', cloakPivot);

  const eye = hp(0, eyeY, eyeZ + 0.012);
  return { props: P, bones, j, pelvis: pelvisFrame, chest: chestFrame, head: headFrame, hands, eye, hair, cloakPivot };
}

export interface RiderSkeleton {
  layout: RiderSkeletonLayout;
  skeleton: THREE.Skeleton;
  bones: THREE.Bone[];
  root: THREE.Bone;
  index: Map<string, number>;
  restHeads: THREE.Vector3[];
  id(name: string): number;
  bone(name: string): THREE.Bone;
}

/**
 * Bones with identity rest rotations; bone inverses from the rig-space rest joints (the mesh is authored in rig
 * space). `anchorHead`: rig-space rest position of the object the root is parented to (the dragon's chest bone).
 */
export function createRiderSkeleton(layout: RiderSkeletonLayout, anchorHead: THREE.Vector3): RiderSkeleton {
  const index = new Map<string, number>();
  const bones: THREE.Bone[] = [];
  const restHeads: THREE.Vector3[] = [];
  const byName = new Map<string, BoneDef>();
  for (const b of layout.bones) {
    byName.set(b.name, b);
  }
  for (const def of layout.bones) {
    const bone = new THREE.Bone();
    bone.name = `rider:${def.name}`;
    const parent = def.parent ? byName.get(def.parent)!.head : anchorHead;
    bone.position.copy(def.head).sub(parent);
    index.set(def.name, bones.length);
    bones.push(bone);
    restHeads.push(def.head.clone());
  }
  let root: THREE.Bone | undefined;
  for (const def of layout.bones) {
    const bone = bones[index.get(def.name)!];
    if (def.parent) {
      bones[index.get(def.parent)!].add(bone);
    } else {
      root = bone;
    }
  }
  const inverses = restHeads.map((h) => new THREE.Matrix4().makeTranslation(-h.x, -h.y, -h.z));
  const skeleton = new THREE.Skeleton(bones, inverses);
  const id = (name: string): number => {
    const i = index.get(name);
    if (i === undefined) {
      throw new Error(`unknown rider bone ${name}`);
    }
    return i;
  };
  return { layout, skeleton, bones, root: root!, index, restHeads, id, bone: (n) => bones[id(n)] };
}
