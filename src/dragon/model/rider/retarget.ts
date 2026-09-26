/**
 * Drives the human rider (Mixamo skeleton, glTF) from the dragon rig's procedural rider bones every frame.
 *
 * The rig's `RiderAnimator` keeps posing its own rider skeleton (`riderPelvis` … `riderFoot`): leaning, rein pulls,
 * tuck, petting, pointing, cheering, standing in the stirrups, looking around. The reins are skinned to its fists,
 * and the saddle and stirrups are built around its rest pose. So the human follows that skeleton:
 *  - pelvis, spine, chest and head copy its rotations, calibrated against the human's own riding pose (the old
 *    bones' rest rotations are identity in rig space, so the human's rig-space riding pose is the offset);
 *  - each hand is set on the old fist's frame (metacarpals along its `fwd`, palm toward its `medial`) with the rope's
 *    channel through the human fist on the old one's, the arm reaching it by two-bone IK, the elbow toward the old
 *    elbow; the fingers wrap the rein and open as far as the old hand opens;
 *  - the legs reach the old ankles (in the stirrups) by IK, the knees toward the old knees; the feet take the old
 *    feet's rotations.
 */
import * as THREE from 'three';
import type { RigSkeleton } from '../skeleton';
import { rigTransform } from '../animation/kinematics';
import { fistFrame, type FistFrame } from '../anatomy';

type Side = 'L' | 'R';
const SIDES: Side[] = ['L', 'R'];
/** The human's side names (mixamo, the character's own left and right; both sit on the same side as the old ones). */
const HUMAN_SIDE: Record<Side, string> = { L: 'Left', R: 'Right' };
/** Old rider finger joint A's angle when the hand is fully open (rad), see rider-pose.ts OPEN_FINGERS. */
const OPEN_A = 0.6;
/** Fist: curl per finger joint (rad, base to tip) around the rein; the little finger closes a little more. */
const CURL = [1.3, 1.5, 0.9];
const PINKY_EXTRA = 0.12;
/** Thumb: curl per joint over the index (rad). */
const THUMB_CURL = [0.2, 0.45, 0.4];
/** The rope's channel through the human fist: along the metacarpals (share of the wrist → middle knuckle length) and
 * toward the palm (m). */
const CHANNEL_ALONG = 0.95;
const CHANNEL_PALM = 0.03;
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'];

interface Limb {
  upper: THREE.Bone;
  lower: THREE.Bone;
  end: THREE.Bone;
  l1: number;
  l2: number;
  oldEnd: THREE.Bone;
  oldMid: THREE.Bone;
  /** The human end bone's rig-space rotation in the riding pose (old rest = identity). */
  endRide: THREE.Quaternion;
  /** Offset from the old middle joint's rest to the human's (keeps the bend on the human's side of the line). */
  midOffset: THREE.Vector3;
}

interface Hand {
  side: Side;
  arm: Limb;
  /** Hand-local axes: along the metacarpals, toward the palm; the rope channel's offset from the wrist. */
  dir: THREE.Vector3;
  palm: THREE.Vector3;
  channel: THREE.Vector3;
  fist: FistFrame;
  fingers: { bones: THREE.Bone[]; bind: THREE.Quaternion[]; thumb: boolean; pinky: boolean }[];
  oldFingerA: THREE.Bone;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pp = new THREE.Vector3();
const _pq = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _target = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _med = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _e3 = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();

/** Rotation taking the frame (a1, b1) onto (a2, b2): a onto a exactly, b as close as possible. */
function frameToFrame(a1: THREE.Vector3, b1: THREE.Vector3, a2: THREE.Vector3, b2: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _e3.crossVectors(a1, b1).normalize();
  _e2.crossVectors(_e3, a1);
  _m1.makeBasis(a1, _e2, _e3);
  _e3.crossVectors(a2, b2).normalize();
  _e1.copy(a2).normalize();
  _e2.crossVectors(_e3, _e1);
  _m2.makeBasis(_e1, _e2, _e3);
  _m2.multiply(_m1.transpose());
  return out.setFromRotationMatrix(_m2);
}

export class RiderRetarget {
  private readonly base = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly hips: THREE.Bone;
  private readonly hipsRide = new THREE.Quaternion();
  private readonly hipsOffset = new THREE.Vector3();
  private readonly spine: { bone: THREE.Bone; ride: THREE.Quaternion; from: THREE.Bone; to: THREE.Bone; t: number }[] = [];
  private readonly legs: Limb[] = [];
  private readonly hands: Hand[] = [];
  private readonly head?: THREE.Bone;
  private hidden = false;
  enabled = true;

  constructor(
    private readonly old: RigSkeleton,
    bones: Map<string, THREE.Bone>,
    private readonly rigRoot: THREE.Object3D,
    /** Local rotations of the human's bind (standing) pose: straight fingers. */
    bindLocal: Map<THREE.Bone, THREE.Quaternion>,
  ) {
    const h = (n: string): THREE.Bone => {
      const b = bones.get(n);
      if (!b) {
        throw new Error(`rider retarget: missing bone ${n}`);
      }
      return b;
    };
    const o = (n: string): THREE.Bone => old.bone(n);
    const restHead = (n: string): THREE.Vector3 => old.restHeads[old.id(n)];
    for (const b of bones.values()) {
      this.base.set(b, b.quaternion.clone());
    }
    this.hips = h('Hips');
    rigTransform(this.hips, rigRoot, _p, this.hipsRide);
    this.hipsOffset.copy(_p).sub(restHead('riderPelvis'));

    const spineMap: [string, string, string, number][] = [
      ['Spine', 'riderPelvis', 'riderSpine', 0.6],
      ['Spine1', 'riderSpine', 'riderChest', 0.5],
      ['Spine2', 'riderChest', 'riderChest', 0],
      ['Neck', 'riderChest', 'riderHead', 0.5],
      ['Head', 'riderHead', 'riderHead', 0],
    ];
    for (const [name, from, to, t] of spineMap) {
      const bone = bones.get(name);
      if (!bone) {
        continue;
      }
      const ride = new THREE.Quaternion();
      rigTransform(bone, rigRoot, _p, ride);
      this.spine.push({ bone, ride, from: o(from), to: o(to), t });
    }
    this.head = bones.get('Head');

    const limb = (upper: string, lower: string, end: string, oldMid: string, oldEnd: string): Limb => {
      const u = h(upper);
      const l = h(lower);
      const e = h(end);
      const pu = new THREE.Vector3();
      const pl = new THREE.Vector3();
      const pe = new THREE.Vector3();
      const qe = new THREE.Quaternion();
      rigTransform(u, rigRoot, pu, _q);
      rigTransform(l, rigRoot, pl, _q);
      rigTransform(e, rigRoot, pe, qe);
      return {
        upper: u,
        lower: l,
        end: e,
        l1: pu.distanceTo(pl),
        l2: pl.distanceTo(pe),
        oldEnd: o(oldEnd),
        oldMid: o(oldMid),
        endRide: qe,
        midOffset: pl.clone().sub(restHead(oldMid)),
      };
    };
    for (const s of SIDES) {
      const hs = HUMAN_SIDE[s];
      this.legs.push(limb(`${hs}UpLeg`, `${hs}Leg`, `${hs}Foot`, `riderShin${s}`, `riderFoot${s}`));
      const arm = limb(`${hs}Arm`, `${hs}ForeArm`, `${hs}Hand`, `riderForearm${s}`, `riderHand${s}`);
      // Hand-local frame from the bones: metacarpals toward the middle knuckle, the palm on the side the riding pose's
      // curled fingertips moved to (from the straight bind pose).
      const middle = h(`${hs}HandMiddle1`);
      const dir = middle.position.clone().normalize();
      const across = h(`${hs}HandIndex1`).position.clone().sub(h(`${hs}HandPinky1`).position);
      across.addScaledVector(dir, -across.dot(dir)).normalize();
      const palm = new THREE.Vector3().crossVectors(dir, across).normalize();
      const tipRide = this.tipLocal(bones, hs, (b) => this.base.get(b) ?? b.quaternion);
      const tipBind = this.tipLocal(bones, hs, (b) => bindLocal.get(b) ?? b.quaternion);
      if (palm.dot(tipRide.sub(tipBind)) < 0) {
        palm.negate();
      }
      const channel = dir.clone().multiplyScalar(middle.position.length() * CHANNEL_ALONG).addScaledVector(palm, CHANNEL_PALM);
      const fingers: Hand['fingers'] = [];
      for (const f of FINGERS) {
        const list: THREE.Bone[] = [];
        for (let i = 1; i <= 3; i++) {
          const b = bones.get(`${hs}Hand${f}${i}`);
          if (b) {
            list.push(b);
          }
        }
        fingers.push({ bones: list, bind: list.map((b) => (bindLocal.get(b) ?? b.quaternion).clone()), thumb: f === 'Thumb', pinky: f === 'Pinky' });
      }
      this.hands.push({ side: s, arm, dir, palm, channel, fist: fistFrame(s), fingers, oldFingerA: o(`riderFingerA${s}`) });
    }
  }

  /** Middle fingertip (last joint's head) in hand-local space, for the given finger rotations. */
  private tipLocal(bones: Map<string, THREE.Bone>, hs: string, rot: (b: THREE.Bone) => THREE.Quaternion): THREE.Vector3 {
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (let i = 1; i <= 4; i++) {
      const b = bones.get(`${hs}HandMiddle${i}`);
      if (!b) {
        break;
      }
      p.add(_a.copy(b.position).applyQuaternion(q));
      q.multiply(rot(b));
    }
    return p;
  }

  /** First person: the head (and the helmet on it) collapses so the camera at the eyes sees out. */
  setFirstPerson(on: boolean): void {
    this.hidden = on;
  }

  update(): void {
    if (!this.enabled) {
      return;
    }
    const root = this.rigRoot;
    for (const [b, q] of this.base) {
      b.quaternion.copy(q);
    }
    // Pelvis: position and rotation.
    rigTransform(this.old.bone('riderPelvis'), root, _a, _q);
    _p.copy(this.hipsOffset).applyQuaternion(_q).add(_a);
    _qa.copy(_q).multiply(this.hipsRide);
    this.setRig(this.hips, _p, _qa);
    // Spine to head: each bone between two old bones.
    for (const s of this.spine) {
      rigTransform(s.from, root, _a, _qa);
      rigTransform(s.to, root, _a, _qb);
      _qa.slerp(_qb, s.t).multiply(s.ride);
      this.setRig(s.bone, null, _qa);
    }
    if (this.head) {
      this.head.scale.setScalar(this.hidden ? 1e-3 : 1);
    }
    // Legs: ankles into the stirrups.
    for (const l of this.legs) {
      rigTransform(l.oldEnd, root, _target, _q);
      _qd.copy(_q).multiply(l.endRide);
      rigTransform(l.oldMid, root, _pole, _qa);
      _pole.add(l.midOffset);
      this.solveLimb(l, _target, _pole);
      this.setRig(l.end, null, _qd);
    }
    // Hands: the human fist on the old fist, the rope's channel through both.
    for (const hd of this.hands) {
      const l = hd.arm;
      rigTransform(l.oldEnd, root, _a, _q);
      _fwd.copy(hd.fist.fwd).applyQuaternion(_q);
      _med.copy(hd.fist.medial).applyQuaternion(_q);
      // Rig rotation of the hand: its local (dir, palm) onto the old fist's (fwd, medial).
      frameToFrame(hd.dir, hd.palm, _fwd, _med, _qd);
      // The human wrist: the old channel now, minus the human channel offset turned into place.
      _target.copy(hd.fist.channel).sub(hd.fist.wrist).applyQuaternion(_q).add(_a);
      _target.sub(_c.copy(hd.channel).applyQuaternion(_qd));
      rigTransform(l.oldMid, root, _pole, _qa);
      _pole.add(l.midOffset);
      this.solveLimb(l, _target, _pole);
      this.setRig(l.end, null, _qd);
      this.curlFingers(hd);
    }
  }

  /** Fingers from straight, curled around the grip axis toward the palm, opened as far as the old hand is open. */
  private curlFingers(hd: Hand): void {
    const qa = hd.oldFingerA.quaternion;
    const open = THREE.MathUtils.clamp((2 * Math.acos(Math.min(1, Math.abs(qa.w)))) / OPEN_A, 0, 1);
    const close = 1 - open * 0.9;
    // Hand-local axis about which +angle turns `dir` toward the palm.
    _axis.crossVectors(hd.dir, hd.palm).normalize();
    for (const f of hd.fingers) {
      // Rotation of the finger's parent relative to the hand, accumulated from the base.
      _q.identity();
      f.bones.forEach((b, i) => {
        b.quaternion.copy(f.bind[i]);
        const angle = (f.thumb ? THUMB_CURL[i] : CURL[i] + (f.pinky ? PINKY_EXTRA : 0)) * close;
        _qb.setFromAxisAngle(f.thumb ? hd.palm : _axis, angle);
        // local' = P⁻¹ · R · P · local, with R about the hand-local axis and P = parent relative to the hand.
        _qa.copy(_q).invert().multiply(_qb).multiply(_q);
        b.quaternion.premultiply(_qa);
        _q.multiply(b.quaternion);
      });
    }
  }

  /** Two-bone IK: the middle joint on the side of the pole, both segments aimed with the smallest turn. */
  private solveLimb(l: Limb, target: THREE.Vector3, pole: THREE.Vector3): void {
    rigTransform(l.upper, this.rigRoot, _a, _q);
    const reach = l.l1 + l.l2;
    _d1.subVectors(target, _a);
    let dist = _d1.length();
    dist = Math.min(dist, reach * 0.999);
    dist = Math.max(dist, Math.abs(l.l1 - l.l2) + 1e-4);
    _d1.normalize();
    // Bend plane: from the chain's axis toward the pole.
    _n.subVectors(pole, _a);
    _n.addScaledVector(_d1, -_n.dot(_d1));
    if (_n.lengthSq() < 1e-10) {
      _n.set(0, 1, 0).addScaledVector(_d1, -_d1.y);
    }
    _n.normalize();
    const cosA = (l.l1 * l.l1 + dist * dist - l.l2 * l.l2) / (2 * l.l1 * dist);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _mid.copy(_a).addScaledVector(_d1, cosA * l.l1).addScaledVector(_n, sinA * l.l1);
    _b.copy(_a).addScaledVector(_d1, dist);
    this.aim(l.upper, l.lower, _mid);
    this.aim(l.lower, l.end, _b);
  }

  /** Turns `bone` (smallest rotation) so its child's head moves onto `to`. */
  private aim(bone: THREE.Bone, child: THREE.Bone, to: THREE.Vector3): void {
    rigTransform(bone, this.rigRoot, _pp, _pq);
    rigTransform(child, this.rigRoot, _c, _q);
    _d1.subVectors(_c, _pp).normalize();
    _d2.subVectors(to, _pp).normalize();
    _qa.setFromUnitVectors(_d1, _d2).multiply(_pq);
    this.setRig(bone, null, _qa);
  }

  /** Sets a bone's rig-space rotation (and position, if given) through its parent's rig transform. */
  private setRig(bone: THREE.Bone, pos: THREE.Vector3 | null, rot: THREE.Quaternion): void {
    const parent = bone.parent!;
    rigTransform(parent, this.rigRoot, _pp, _pq);
    _pq.invert();
    bone.quaternion.copy(_pq).multiply(rot);
    if (pos) {
      bone.position.copy(pos).sub(_pp).applyQuaternion(_pq);
    }
  }
}
