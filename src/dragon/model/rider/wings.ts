/**
 * Hezarfen's wind wings (tools/humans/wings.py): each is a jointed wooden spar (wing_<S>_1 root → grip, _2 grip →
 * wrist, _3 wrist → tip) with six ribs (wing_<S>_r0..r5) carrying the canvas. The bind pose is spread. Folded, the spar
 * zig-zags down the back and the ribs close onto it like a fan, the canvas gathering between them; opening runs the
 * other way (a spring in the controller gives the snap). Flapping swings the whole wing about the body's long axis,
 * the wrist bending back a little on the up-stroke; the hands hold the grips (two-bone arm IK) while the wings are open.
 * All angles are in the back's frame: the character's own axes (root: +X left, +Y up, -Z back) as carried by the chest
 * bone the wings hang from, so the folded wings stay on the back however the body bends, twists or tumbles.
 */
import * as THREE from 'three';

type Side = 'L' | 'R';
const SIDES: readonly [Side, number][] = [
  ['L', 1],
  ['R', -1],
];
/** Fold angles (rad) about the wing plane's normal (root Z): root down, grip back up, wrist down again. */
const FOLD = [1.45, 2.98, 3.02];
/** Up-stroke wrist bend (rad per rad of flap) and how much the ribs close on the up-stroke. */
const FLAP_WRIST = 0.35;
const FLAP_RIB_CLOSE = 0.25;

const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _fq = new THREE.Quaternion();
const _mq = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1);
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);

interface WingRig {
  side: Side;
  sg: number;
  spar: THREE.Bone[];
  ribs: { bone: THREE.Bone; collapse: number }[];
  rest: Map<THREE.Bone, THREE.Quaternion>;
  /** The mount (the wings' parent bone) in the bind pose, relative to the root: frame = mount · this⁻¹. */
  mountRel: THREE.Quaternion;
  arm?: { upper: THREE.Bone; lower: THREE.Bone; hand: THREE.Bone; l1: number; l2: number };
}

/** Rotates `bone` by `angle` about `axis` given in `frame` (a world rotation; applied in world space, kept in the
 * bone's). */
function rotateInFrame(frame: THREE.Quaternion, bone: THREE.Bone, axis: THREE.Vector3, angle: number): void {
  if (Math.abs(angle) < 1e-6) {
    return;
  }
  _axis.copy(axis).applyQuaternion(frame);
  _q.setFromAxisAngle(_axis, angle);
  bone.parent!.getWorldQuaternion(_pq);
  // local' = P⁻¹ · R · P · local
  bone.quaternion.premultiply(_pq).premultiply(_q).premultiply(_pq.invert());
  bone.updateMatrixWorld(true);
}

/** Smallest rotation of `bone` that brings its child's head toward `to` (world). */
function aim(bone: THREE.Bone, child: THREE.Object3D, to: THREE.Vector3): void {
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  _d1.subVectors(_b, _a).normalize();
  _d2.subVectors(to, _a).normalize();
  _q.setFromUnitVectors(_d1, _d2);
  bone.parent!.getWorldQuaternion(_pq);
  bone.quaternion.premultiply(_pq).premultiply(_q).premultiply(_pq.invert());
  bone.updateMatrixWorld(true);
}

export class Wings {
  private readonly wings: WingRig[] = [];
  /** 0 folded … 1 spread (a little over 1 overshoots as they snap open). */
  amount = 0;
  /** Flap angle (rad, + = down-stroke), set by the controller. */
  flap = 0;
  /** Hands on the grips (0..1): the controller sets it while gliding. */
  grip = 0;
  /** Folded wings swung back from hanging (rad): seated on the dragon they lie back along the spine over the saddle. */
  tuck = 0.25;

  constructor(private readonly root: THREE.Object3D, bones: Map<string, THREE.Bone>) {
    root.updateMatrixWorld(true);
    for (const [side, sg] of SIDES) {
      const spar = [1, 2, 3].map((k) => bones.get(`wing_${side}_${k}`)).filter((b): b is THREE.Bone => !!b);
      if (spar.length !== 3) {
        continue;
      }
      const rest = new Map<THREE.Bone, THREE.Quaternion>();
      for (const b of spar) {
        rest.set(b, b.quaternion.clone());
      }
      // Each rib closes onto its spar segment: the angle (about the wing plane's normal) from the rib to the segment.
      const ribs: WingRig['ribs'] = [];
      root.getWorldQuaternion(_rq);
      const inv = _rq.clone().invert();
      for (let n = 0; n < 8; n++) {
        const rib = bones.get(`wing_${side}_r${n}`);
        if (!rib) {
          continue;
        }
        rest.set(rib, rib.quaternion.clone());
        // Directions from the bones' own Y axes (Blender exports bones with +Y along their length).
        const parent = rib.parent as THREE.Bone;
        parent.getWorldQuaternion(_pq);
        _d1.set(0, 1, 0).applyQuaternion(_pq).applyQuaternion(inv).setZ(0).normalize();
        rib.getWorldQuaternion(_pq);
        _d2.set(0, 1, 0).applyQuaternion(_pq).applyQuaternion(inv).setZ(0).normalize();
        const ang = Math.atan2(_d2.x * _d1.y - _d2.y * _d1.x, _d2.x * _d1.x + _d2.y * _d1.y);
        // On the middle segment (it points up once folded) the ribs close the other way round, onto its reverse, so
        // they hang down the back with the rest instead of rising over the head.
        let collapse = ang;
        if (parent === spar[1]) {
          collapse = collapse > 0 ? collapse - Math.PI : collapse + Math.PI;
        }
        ribs.push({ bone: rib, collapse: collapse * 0.95 });
      }
      const s = side === 'L' ? 'Left' : 'Right';
      const upper = bones.get(`${s}Arm`);
      const lower = bones.get(`${s}ForeArm`);
      const hand = bones.get(`${s}Hand`);
      let arm: WingRig['arm'];
      if (upper && lower && hand) {
        upper.getWorldPosition(_a);
        lower.getWorldPosition(_b);
        hand.getWorldPosition(_c);
        arm = { upper, lower, hand, l1: _a.distanceTo(_b), l2: _b.distanceTo(_c) };
      }
      const mountRel = inv.clone().multiply(spar[0].parent!.getWorldQuaternion(new THREE.Quaternion()));
      this.wings.push({ side, sg, spar, ribs, rest, arm, mountRel });
    }
    this.apply();
  }

  get present(): boolean {
    return this.wings.length > 0;
  }

  /** Kept for callers of the old API: sets how far the wings are open and poses them. */
  set(amount: number): void {
    this.amount = amount;
    this.apply();
  }

  /** Poses the wing bones (call after anything that resets the skeleton: the mixer, the retarget). */
  apply(): void {
    const fold = THREE.MathUtils.clamp(1 - this.amount, 0, 1);
    // Folding runs root-first: the ribs close early, the spar folds after (like a fan being shut, then laid back).
    const ribFold = THREE.MathUtils.smoothstep(fold, 0, 0.55);
    const sparFold = THREE.MathUtils.smoothstep(fold, 0.2, 1);
    const over = Math.max(0, this.amount - 1);
    const up = Math.max(0, -this.flap);
    for (const w of this.wings) {
      for (const [b, q] of w.rest) {
        b.quaternion.copy(q);
      }
      const mount = w.spar[0].parent!;
      mount.updateMatrixWorld(true);
      // The back's frame now: the root's axes carried along by the mount bone's pose.
      const f = mount.getWorldQuaternion(_fq).multiply(_mq.copy(w.mountRel).invert());
      const sg = w.sg;
      // Flap about the body's long axis (Y): + = down-stroke (the tip toward the belly, +Z).
      rotateInFrame(f, w.spar[0], _Y, -sg * this.flap * (1 - sparFold));
      rotateInFrame(f, w.spar[0], _Z, -sg * (FOLD[0] * sparFold - over * 0.15));
      rotateInFrame(f, w.spar[0], _X, this.tuck * sparFold);
      rotateInFrame(f, w.spar[1], _Z, sg * (FOLD[1] * sparFold + up * FLAP_WRIST));
      rotateInFrame(f, w.spar[2], _Z, -sg * (FOLD[2] * sparFold + up * FLAP_WRIST * 0.6));
      for (const r of w.ribs) {
        rotateInFrame(f, r.bone, _Z, r.collapse * Math.min(1, ribFold + up * FLAP_RIB_CLOSE));
      }
      if (w.arm && this.grip > 1e-3) {
        this.holdGrip(w, this.grip * (1 - sparFold));
      }
    }
  }

  /** Two-bone IK: the hand onto the grip (the spar's first joint), the elbow back and down. */
  private holdGrip(w: WingRig, k: number): void {
    const arm = w.arm!;
    w.spar[1].getWorldPosition(_t); // grip = the joint between the root and grip segments
    arm.hand.getWorldPosition(_c);
    _t.lerp(_c, 1 - k);
    arm.upper.getWorldPosition(_a);
    const reach = arm.l1 + arm.l2;
    _d1.subVectors(_t, _a);
    const dist = THREE.MathUtils.clamp(_d1.length(), Math.abs(arm.l1 - arm.l2) + 1e-3, reach * 0.999);
    _d1.normalize();
    // Bend toward the back and down (root -Z, -Y).
    this.root.getWorldQuaternion(_rq);
    _n.set(0, -0.4, -1).applyQuaternion(_rq);
    _n.addScaledVector(_d1, -_n.dot(_d1)).normalize();
    const cosA = (arm.l1 * arm.l1 + dist * dist - arm.l2 * arm.l2) / (2 * arm.l1 * dist);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _mid.copy(_a).addScaledVector(_d1, cosA * arm.l1).addScaledVector(_n, sinA * arm.l1);
    const end = _a.clone().addScaledVector(_d1, dist);
    aim(arm.upper, arm.lower, _mid);
    aim(arm.lower, arm.hand, end);
  }
}
