import * as THREE from 'three';
import type { DragonPose } from '../../../core/contracts';
import { LANDMARKS, RIDER, SIDES, fistFrame, mirror, sideSign, type FistFrame, type Side } from '../anatomy';
import type { RigSkeleton } from '../skeleton';
import { mapFrame, rigTransform, setEuler, solveLimb, Spring, twistAngle } from './kinematics';

/** A point on the dragon's skin (bind space) with its skin weights, to place the rider's hand on the moving surface. */
export interface SurfaceAnchor {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  bones: number[];
  weights: number[];
}

/** Smoothed rider cue values (0..1, reins -1..1) after this frame's update. */
export interface RiderCues {
  reinLeft: number;
  reinRight: number;
  tuck: number;
  point: number;
  cheer: number;
  pet: number;
  stand: number;
  /** Bond cues (phase 06): laughing, pointing at what the dragon looks at, patting the neck (V). */
  laugh: number;
  show: number;
  pat: number;
}

/** Pelvis rise (m) and forward shift (rig z) when standing on the saddle with soft knees. */
const STAND_RISE = 0.94;
const STAND_SHIFT = -0.07;
/** Saddle seat top (rig y) where the standing feet rest, and the ankle height above the sole. */
const SEAT_TOP = 1.1;
const ANKLE_ABOVE_SOLE = 0.055;
/** Petting strokes (forward + back) per second. */
const STROKE_HZ = 0.62;
/** Patting (V): taps per second, how far the palm lifts off between taps (m), and where on the track it pats. */
const PAT_HZ = 3.2;
const PAT_LIFT = 0.055;
const PAT_U = 0.4;
/** Laughing: shoulder bob frequency (Hz). */
const LAUGH_HZ = 5.5;
/** Showing: the pointing arm's yaw range (rad, + = to the left across the body) and pitch range. */
const SHOW_YAW = { min: -1.7, max: 0.8 };
const SHOW_PITCH = { min: -0.5, max: 0.6 };
/** Share of the wrist twist the forearm takes over (the rest stays at the wrist). */
const FOREARM_TWIST = 0.55;
/** Open-hand finger angles (rad, extension about the grip axis) for joints A, B, C and the thumb spread. */
const OPEN_FINGERS = [0.6, 1.2, 0.72];
const THUMB_OPEN = { roll: 0.55, spread: 0.35 };

const clamp = THREE.MathUtils.clamp;
const smoothstep = THREE.MathUtils.smoothstep;

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Right-side offsets (mirrored for the left), in the dragon's chest frame relative to the rest grip. */
const REIN_PULL = v(0.015, -0.035, 0.255);
const REIN_GIVE = v(0.005, -0.1, -0.13);
/**
 * First person only (the rider's body is hidden there): the rein fists are carried higher and a little forward so
 * they sit just below the bottom of the view; a pull lifts the hand up and out (an opening rein) and giving rein
 * pushes both fists forward along the neck, so every rein command rises into the frame instead of dropping out of it.
 * Third person keeps the offsets above.
 */
const POV_GRIP = v(0.02, 0.2, -0.07);
const POV_REIN_PULL = v(0.075, 0.16, 0.05);
const POV_REIN_GIVE = v(-0.02, 0.08, -0.1);
/** Hands on the pommel (tuck, pushing up to stand), dragon chest frame, rig rest coordinates. */
const POMMEL_GRIP = v(0.075, 1.33, -2.99);
/** Standing: fists holding the reins in front of the hips, a little out for balance (rider chest frame, from the shoulder). */
const STAND_HAND = v(0.13, -0.42, -0.3);
/** Cheer: fist pumped up in front of the face (rider chest frame, from the shoulder; in view of the POV camera). */
const CHEER_HAND = v(0.02, 0.4, -0.42);
/** Point: arm straight ahead and up (dragon frame direction), high enough to show in first person. */
const POINT_DIR = v(0.06, 0.42, -1).normalize();

/** Elbow pole directions (rider chest frame, right side). */
const POLE_PULL = v(0.55, -0.35, 0.75);
const POLE_TUCK = v(1, -0.15, 0.25);
const POLE_STAND = v(0.85, -0.45, 0.35);
const POLE_POINT = v(0.4, -1, 0.15);
const POLE_CHEER = v(1, 0.05, -0.25);
const POLE_PET = v(0.85, 0.25, 0.45);

interface ArmRig {
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  fingers: THREE.Bone[];
  thumb: THREE.Bone;
  upperLocal: THREE.Vector3;
  upperDir: THREE.Vector3;
  foreDir: THREE.Vector3;
  bendNormal: THREE.Vector3;
  restPole: THREE.Vector3;
  l1: number;
  l2: number;
  /** Rest grip (wrist) relative to the dragon chest landmark. */
  grip: THREE.Vector3;
  fist: FistFrame;
}

interface LegRig {
  thigh: THREE.Bone;
  shin: THREE.Bone;
  foot: THREE.Bone;
  hipLocal: THREE.Vector3;
  thighDir: THREE.Vector3;
  shinDir: THREE.Vector3;
  bendNormal: THREE.Vector3;
  restPole: THREE.Vector3;
  l1: number;
  l2: number;
  /** Seated ankle relative to the dragon chest landmark. */
  seatedAnkle: THREE.Vector3;
  toeDir: THREE.Vector3;
  footUp: THREE.Vector3;
}

/** Exponential ease toward a target with separate rise and fall rates (1/s); snaps when dt = 0. */
class Ease {
  value = 0;
  constructor(
    private readonly up: number,
    private readonly down: number,
  ) {}
  step(target: number, dt: number): number {
    if (dt <= 0) {
      this.value = target;
      return target;
    }
    const rate = target > this.value ? this.up : this.down;
    this.value += (target - this.value) * (1 - Math.exp(-rate * dt));
    return this.value;
  }
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pc = new THREE.Vector3();
const _qc = new THREE.Quaternion();
const _pr = new THREE.Vector3();
const _qr = new THREE.Quaternion();
const _pp = new THREE.Vector3();
const _qp = new THREE.Quaternion();
const _root = new THREE.Vector3();
const _target = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _poleDir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _end = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _handPos: Record<Side, THREE.Vector3> = { R: new THREE.Vector3(), L: new THREE.Vector3() };
const _handRot: Record<Side, THREE.Quaternion> = { R: new THREE.Quaternion(), L: new THREE.Quaternion() };
const _anchorPos = new THREE.Vector3();
const _petWrist = new THREE.Vector3();
/** The wrist sits this far above the skin (palm thickness plus a hair) and behind the palm's contact point (m). */
const PALM_LIFT = 0.026;
const PALM_BACK = 0.058;
/** Half the palm's thickness: the palm's skin side sits this much below the wrist line (m). */
const PALM_THICK = 0.022;
const _anchorNrm = new THREE.Vector3();
const _anchorFwd = new THREE.Vector3();
const _a0 = new THREE.Vector3();
const _a1 = new THREE.Vector3();
const _n0 = new THREE.Vector3();
const _n1 = new THREE.Vector3();

function mirrored(p: THREE.Vector3, side: Side, out: THREE.Vector3): THREE.Vector3 {
  return out.set(p.x * sideSign(side), p.y, p.z);
}

/** q = q * rotation(axis, angle) (rotation in the local frame). */
function postRotate(q: THREE.Quaternion, axis: THREE.Vector3, angle: number): void {
  q.multiply(_qt.setFromAxisAngle(axis, angle));
}

/**
 * Procedural rider: lean springs, rein hands (IK), and the command cues from DragonPose — rein pull / give, tuck,
 * point, cheer, petting the neck and standing on the saddle.
 */
export class RiderAnimator {
  /** Rider eye (rig space) after the last update. */
  readonly eye = new THREE.Vector3().copy(RIDER.eye);
  /**
   * Offset for the first-person eye anchor (riderHead bone frame): while petting, the POV eye stays back and up
   * instead of diving forward with the lean, so the camera looks down onto the stroking hand.
   */
  readonly povOffset = new THREE.Vector3();
  readonly cues: RiderCues = { reinLeft: 0, reinRight: 0, tuck: 0, point: 0, cheer: 0, pet: 0, stand: 0, laugh: 0, show: 0, pat: 0 };
  /**
   * Petting contact after the last update (checks): `active` while the hand is fully on the neck, `error` = distance
   * (m) between the wrist the IK reached and the wrist that puts the palm on the skin, `gap` = the palm's height above
   * the skinned neck surface along its normal (m).
   */
  readonly petContact = { active: false, error: 0, gap: 0 };
  /** First-person blend 0..1 (the animator's POV blend), see POV_GRIP. */
  firstPerson = 0;
  /** Debug override (screenshots): fixed petting stroke phase (rad). */
  debugStrokePhase: number | null = null;

  private readonly rigRoot: THREE.Object3D;
  private readonly dragonChest: THREE.Bone;
  private readonly pelvis: THREE.Bone;
  private readonly spine: THREE.Bone;
  private readonly chest: THREE.Bone;
  private readonly head: THREE.Bone;
  private readonly reinGrip: THREE.Bone;
  private readonly cloak: THREE.Bone;
  private readonly pelvisRest: THREE.Vector3;
  private readonly arms = {} as Record<Side, ArmRig>;
  private readonly legs = {} as Record<Side, LegRig>;
  private readonly boneList: THREE.Bone[];
  private readonly restHeads: THREE.Vector3[];
  private anchors: SurfaceAnchor[] = [];
  private readonly anchorPos = new Map<number, THREE.Vector3>();
  private readonly anchorRot = new Map<number, THREE.Quaternion>();

  private readonly pitch = new Spring(40, 9);
  private readonly roll = new Spring(40, 9);
  private readonly heaveSpring = new Spring(70, 11);
  private readonly ease = {
    reinL: new Ease(9, 7),
    reinR: new Ease(9, 7),
    tuck: new Ease(7, 4),
    point: new Ease(8, 5),
    cheer: new Ease(7, 4),
    pet: new Ease(4.5, 4),
    stand: new Ease(9, 9),
    laugh: new Ease(6, 3),
    show: new Ease(5, 4),
    pat: new Ease(9, 6),
    /** The head looks down at the petting hand and comes back up slowly (the POV camera follows it). */
    petLook: new Ease(3, 0.9),
    gazeLook: new Ease(2.5, 2),
  };
  private strokePhase = 0;

  constructor(skel: RigSkeleton, rigRoot: THREE.Object3D) {
    const b = (n: string): THREE.Bone => skel.bone(n);
    const head = (n: string): THREE.Vector3 => skel.restHeads[skel.id(n)];
    this.rigRoot = rigRoot;
    this.boneList = skel.bones;
    this.restHeads = skel.restHeads;
    this.dragonChest = b('chest');
    this.pelvis = b('riderPelvis');
    this.spine = b('riderSpine');
    this.chest = b('riderChest');
    this.head = b('riderHead');
    this.reinGrip = b('riderReinR');
    this.cloak = b('riderCloak');
    this.pelvisRest = this.pelvis.position.clone();
    for (const side of SIDES) {
      const sh = head(`riderUpperArm${side}`);
      const el = head(`riderForearm${side}`);
      const wr = head(`riderHand${side}`);
      const armBend = restBend(sh, el, wr);
      this.arms[side] = {
        upper: b(`riderUpperArm${side}`),
        fore: b(`riderForearm${side}`),
        hand: b(`riderHand${side}`),
        fingers: [b(`riderFingerA${side}`), b(`riderFingerB${side}`), b(`riderFingerC${side}`)],
        thumb: b(`riderThumb${side}`),
        upperLocal: b(`riderUpperArm${side}`).position.clone(),
        upperDir: el.clone().sub(sh).normalize(),
        foreDir: wr.clone().sub(el).normalize(),
        bendNormal: armBend.normal,
        restPole: armBend.pole,
        l1: el.distanceTo(sh),
        l2: wr.distanceTo(el),
        grip: wr.clone().sub(LANDMARKS.chest),
        fist: fistFrame(side),
      };
      const hip = head(`riderThigh${side}`);
      const knee = head(`riderShin${side}`);
      const ankle = head(`riderFoot${side}`);
      const legBend = restBend(hip, knee, ankle);
      const toe = mirror(RIDER.toe, side);
      const toeDir = toe.clone().sub(ankle).normalize();
      this.legs[side] = {
        thigh: b(`riderThigh${side}`),
        shin: b(`riderShin${side}`),
        foot: b(`riderFoot${side}`),
        hipLocal: b(`riderThigh${side}`).position.clone(),
        thighDir: knee.clone().sub(hip).normalize(),
        shinDir: ankle.clone().sub(knee).normalize(),
        bendNormal: legBend.normal,
        restPole: legBend.pole,
        l1: knee.distanceTo(hip),
        l2: ankle.distanceTo(knee),
        seatedAnkle: ankle.clone().sub(LANDMARKS.chest),
        toeDir,
        footUp: new THREE.Vector3(0, 1, 0).addScaledVector(toeDir, -toeDir.y).normalize(),
      };
    }
  }

  /** Surface points along the petting stroke on the right side of the neck, ordered back (saddle) to front. */
  setPetTrack(anchors: SurfaceAnchor[]): void {
    this.anchors = anchors;
    this.anchorPos.clear();
    this.anchorRot.clear();
    for (const a of anchors) {
      for (const id of a.bones) {
        this.anchorPos.set(id, new THREE.Vector3());
        this.anchorRot.set(id, new THREE.Quaternion());
      }
    }
  }

  update(pose: Readonly<DragonPose>, dt: number, time: number, heave: number): void {
    const e = this.ease;
    const c = this.cues;
    c.reinLeft = e.reinL.step(clamp(pose.riderReinLeft ?? 0, -1, 1), dt);
    c.reinRight = e.reinR.step(clamp(pose.riderReinRight ?? 0, -1, 1), dt);
    c.tuck = e.tuck.step(clamp(pose.riderTuck ?? 0, 0, 1), dt);
    c.point = e.point.step(clamp(pose.riderPoint ?? 0, 0, 1), dt);
    c.cheer = e.cheer.step(clamp(pose.riderCheer ?? 0, 0, 1), dt);
    c.pet = e.pet.step(clamp(pose.riderPet ?? 0, 0, 1), dt);
    c.stand = e.stand.step(clamp(pose.riderStand ?? 0, 0, 1), dt);
    c.laugh = e.laugh.step(clamp(pose.riderLaugh ?? 0, 0, 1), dt);
    c.show = e.show.step(clamp(pose.riderShow ?? 0, 0, 1), dt);
    c.pat = e.pat.step(clamp(pose.riderPat ?? 0, 0, 1), dt);
    const petLook = e.petLook.step(c.pet, dt);
    const gazeLook = e.gazeLook.step(clamp(pose.gazeRider ?? 0, 0, 1), dt);

    // Right-hand gestures take turns: cheer over point over showing over petting / patting.
    const cheer = c.cheer;
    const point = c.point * (1 - cheer);
    const show = c.show * (1 - Math.max(cheer, point)) * (1 - c.tuck) * (1 - c.stand);
    const pat = c.pat * (1 - Math.max(cheer, point, show)) * (1 - c.tuck);
    const pet = Math.max(c.pet, pat) * (1 - Math.max(cheer, point, show)) * (1 - c.tuck);
    const patOnly = pet > 1e-4 ? clamp((pat - c.pet) / pet, 0, 1) : 0;
    const laugh = c.laugh;
    const showYaw = clamp(pose.riderShowYaw ?? 0, SHOW_YAW.min, SHOW_YAW.max);
    const showPitch = clamp(pose.riderShowPitch ?? 0, SHOW_PITCH.min, SHOW_PITCH.max);
    const tuck = c.tuck * (1 - c.stand);
    const stand = c.stand;
    const feet = smoothstep(stand, 0.04, 0.6);
    const lift = smoothstep(stand, 0.18, 0.95);
    // Getting up (and sitting down) the hands push on the pommel.
    const push = 4 * stand * (1 - stand) * 0.85;

    // Petting stroke position along the neck (0 = saddle end, 1 = front); the body rocks forward with it.
    const strokes = this.anchors.length > 1 && pet > 0.001;
    if (strokes && dt > 0) {
      this.strokePhase += dt * Math.PI * 2 * STROKE_HZ;
    }
    // Patting holds one spot on the neck instead of stroking along it.
    const strokeU = THREE.MathUtils.lerp(0.5 + 0.44 * Math.sin(this.debugStrokePhase ?? this.strokePhase), PAT_U, patOnly);
    const patLift = patOnly * PAT_LIFT * Math.max(0, Math.sin(time * Math.PI * 2 * PAT_HZ));

    // --- Torso: lean springs + cues (pitch > 0 leans back, yaw > 0 brings the right shoulder forward, roll > 0 leans left).
    const leanPitch = clamp(pose.riderLeanPitch, -0.6, 0.6);
    const leanRoll = clamp(pose.riderLeanRoll, -0.6, 0.6);
    const lp = dt > 0 ? this.pitch.step(leanPitch, dt) : (this.pitch.reset(leanPitch), leanPitch);
    const lr = dt > 0 ? this.roll.step(leanRoll, dt) : (this.roll.reset(leanRoll), leanRoll);
    const hv = dt > 0 ? this.heaveSpring.step(heave, dt) : (this.heaveSpring.reset(heave), heave);
    const lag = clamp((hv - heave) * 1.4, -0.08, 0.08) * (1 - 0.6 * stand);

    let pelP = lp * 0.15;
    const pelY = 0;
    let pelR = -lr * 0.3;
    let spP = lp * 0.4 + lag;
    let spY = 0;
    let spR = -lr * 0.35;
    let chP = lp * 0.35 + lag * 0.5;
    let chY = 0;
    let chR = -lr * 0.25;
    let hdP = -lp * 0.6 - lag * 1.2;
    let hdY = 0;
    let hdR = lr * 0.5;

    const sym = (c.reinLeft + c.reinRight) * 0.5;
    const asym = c.reinRight - c.reinLeft;
    spP += 0.07 * sym;
    chP += 0.05 * sym;
    hdP -= 0.12 * sym;
    spY -= 0.04 * asym;
    chY -= 0.08 * asym;
    // The head keeps most of the shoulder turn: the rider looks into the turn (also in first person).
    hdY += 0.02 * asym;

    pelP -= 0.2 * tuck;
    spP -= 0.42 * tuck;
    chP -= 0.3 * tuck;
    hdP += 0.74 * tuck;

    spY += 0.08 * point;
    chY += 0.12 * point;
    chP -= 0.05 * point;
    hdY -= 0.2 * point;
    hdP += 0.05 * point;

    chR += 0.07 * cheer;
    spP += 0.03 * cheer;
    hdR -= 0.06 * cheer;
    hdP -= 0.03 * cheer;

    // Petting: lean in toward the right side of the neck, look down at the hand.
    pelP -= 0.12 * pet;
    spP -= 0.36 * pet;
    chP -= 0.24 * pet;
    spR -= 0.09 * pet;
    spY += 0.08 * pet;
    chY += 0.2 * pet;
    spP -= 0.1 * strokeU * pet;
    chP -= 0.08 * strokeU * pet;
    hdP += (0.72 + 0.18 * strokeU) * pet - 0.9 * petLook;
    hdY -= 0.28 * pet;
    hdR += 0.06 * pet;

    // Laughing: the shoulders bob, the head goes back a little (less in first person: the view is the head).
    const fpKeep = 1 - 0.75 * this.firstPerson;
    const bob = Math.sin(time * Math.PI * 2 * LAUGH_HZ) * (0.6 + 0.4 * Math.sin(time * 1.9));
    chP += 0.035 * bob * laugh;
    spP += 0.04 * laugh;
    hdP -= 0.14 * laugh * fpKeep;
    hdR += 0.04 * laugh * Math.sin(time * 2.3);
    // Showing: the torso turns toward the arm, the head looks along it (third person only: in POV the player looks).
    chY += 0.3 * showYaw * show;
    spY += 0.12 * showYaw * show;
    hdY += 0.45 * showYaw * show * (1 - this.firstPerson);
    hdP -= 0.3 * showPitch * show * (1 - this.firstPerson);

    // Standing: upright with a slight forward lean, the knees absorb part of the heave; slow balance sway.
    const sway = Math.sin(time * 0.83) * 0.6 + Math.sin(time * 1.37 + 1.1) * 0.4;
    pelP += 0.12 * lift - 0.35 * push * (1 - lift);
    spP += 0.05 * lift - 0.2 * push;
    hdP -= 0.17 * lift - 0.45 * push;
    pelR += 0.035 * sway * lift;
    hdR -= 0.03 * sway * lift;

    // Look back at the dragon when it looks at the rider (less while watching the petting hand).
    hdY += 0.28 * gazeLook * this.gazeSide * (1 - petLook);
    hdP -= 0.05 * gazeLook * (1 - petLook);

    setEuler(this.pelvis, pelP, pelY, pelR, 'YXZ');
    setEuler(this.spine, spP, spY, spR, 'YXZ');
    setEuler(this.chest, chP, chY, chR, 'YXZ');
    setEuler(this.head, hdP, hdY, hdR, 'YXZ');
    // The cloak keeps streaming back along the dragon when a cue folds the torso forward (the lean springs stay in).
    const cuePitch = pelP + spP + chP - (lp * 0.9 + lag * 1.5);
    setEuler(this.cloak, -0.8 * Math.min(cuePitch, 0.1), 0, 0, 'YXZ');
    const pos = this.pelvis.position.copy(this.pelvisRest);
    pos.y += STAND_RISE * lift - 0.5 * heave * lift + 0.05 * push;
    pos.z += STAND_SHIFT * lift - 0.06 * push;
    pos.x += 0.02 * sway * lift;

    // --- Arms ---
    rigTransform(this.dragonChest, this.rigRoot, _pc, _qc);
    rigTransform(this.chest, this.rigRoot, _pr, _qr);
    if (strokes) {
      this.evalPetAnchor(strokeU);
    }
    for (const side of SIDES) {
      const sgn = sideSign(side);
      const arm = this.arms[side];
      const shoulder = _root.copy(arm.upperLocal).applyQuaternion(_qr).add(_pr);
      const rein = side === 'R' ? c.reinRight : c.reinLeft;

      // Target (wrist) in the dragon chest frame: rest grip + rein.
      const fp = this.firstPerson;
      _tmp.copy(arm.grip).addScaledVector(mirrored(POV_GRIP, side, _tmp2), fp);
      if (rein > 0) {
        _tmp.addScaledVector(mirrored(REIN_PULL, side, _tmp2), rein * (1 - fp));
        _tmp.addScaledVector(mirrored(POV_REIN_PULL, side, _tmp2), rein * fp);
      } else {
        _tmp.addScaledVector(mirrored(REIN_GIVE, side, _tmp2), -rein * (1 - fp));
        _tmp.addScaledVector(mirrored(POV_REIN_GIVE, side, _tmp2), -rein * fp);
      }
      _target.copy(_tmp).applyQuaternion(_qc).add(_pc);
      _poleDir.copy(arm.restPole).lerp(mirrored(POLE_PULL, side, _tmp2), Math.max(rein, 0));
      // Hand orientation: fist fixed on the reins (dragon frame), wrists cock with pulls.
      const tilt = 0.3 * Math.max(rein, 0) - 0.2 * Math.max(-rein, 0);
      _qh.copy(_qc).multiply(_qa.setFromAxisAngle(_axis.set(1, 0, 0), tilt));

      // Tuck / pushing up from the saddle: fists on the pommel.
      const pommel = Math.max(tuck, push);
      if (pommel > 0.001) {
        mirrored(POMMEL_GRIP, side, _tmp).sub(LANDMARKS.chest).applyQuaternion(_qc).add(_pc);
        _target.lerp(_tmp, pommel);
        _poleDir.lerp(mirrored(POLE_TUCK, side, _tmp2), pommel);
        _qh.slerp(_qa.copy(_qc).multiply(_qb.setFromAxisAngle(_axis.set(1, 0, 0), -0.45)), pommel);
      }
      // Standing: fists in front of the hips, a little out.
      if (lift > 0.001) {
        _tmp.copy(mirrored(STAND_HAND, side, _tmp2)).applyQuaternion(_qr).add(shoulder);
        _target.lerp(_tmp, lift);
        _poleDir.lerp(mirrored(POLE_STAND, side, _tmp2), lift);
      }
      let open = 0;
      if (side === 'R') {
        if (pet > 0.001 && strokes) {
          // Palm on the scales, fingers along the neck and a little down the flank; wrist behind the palm. A pat lifts
          // the palm off between taps.
          _dir.copy(_anchorFwd);
          _tmp.copy(_anchorPos).addScaledVector(_anchorNrm, PALM_LIFT + patLift).addScaledVector(_dir, -PALM_BACK);
          _petWrist.copy(_tmp);
          _target.lerp(_tmp, pet);
          _poleDir.lerp(POLE_PET, pet);
          this.handFrame(arm.fist, sgn, _dir, _tmp2.copy(_anchorNrm).negate(), _qa);
          _qh.slerp(_qa, pet);
          open = Math.max(open, pet);
        }
        if (point > 0.001) {
          _dir.copy(POINT_DIR).applyQuaternion(_qc);
          _tmp.copy(shoulder).addScaledVector(_dir, arm.l1 + arm.l2 + 0.05);
          _target.lerp(_tmp, point);
          _poleDir.lerp(POLE_POINT, point);
          _up.set(0, 1, 0).applyQuaternion(_qc);
          mapFrame(arm.fist.fwd, arm.fist.up, _dir, _up, _qa);
          _qh.slerp(_qa, point);
          open = Math.max(open, point * 0.9);
        }
        if (show > 0.001) {
          // Pointing at what the dragon looks at: POINT_DIR turned by the target's yaw and pitch (dragon frame).
          _dir.copy(POINT_DIR).applyAxisAngle(_axis.set(1, 0, 0), showPitch).applyAxisAngle(_axis.set(0, 1, 0), showYaw).applyQuaternion(_qc);
          _tmp.copy(shoulder).addScaledVector(_dir, arm.l1 + arm.l2 + 0.05);
          _target.lerp(_tmp, show);
          _poleDir.lerp(POLE_POINT, show);
          _up.set(0, 1, 0).applyQuaternion(_qc);
          mapFrame(arm.fist.fwd, arm.fist.up, _dir, _up, _qa);
          _qh.slerp(_qa, show);
          open = Math.max(open, show * 0.9);
        }
        if (cheer > 0.001) {
          _tmp.copy(CHEER_HAND);
          _tmp.y += 0.05 * Math.sin(time * 13);
          _tmp.applyQuaternion(_qr).add(shoulder);
          _target.lerp(_tmp, cheer);
          _poleDir.lerp(POLE_CHEER, cheer);
          _dir.set(0.08, 1, -0.45).applyQuaternion(_qr);
          _up.set(-1, 0, -0.4).applyQuaternion(_qr);
          mapFrame(arm.fist.fwd, arm.fist.up, _dir, _up, _qa);
          _qh.slerp(_qa, cheer);
          open *= 1 - cheer;
        }
      }
      _pole.copy(_poleDir).applyQuaternion(_qr).add(shoulder);
      this.solveArm(arm, shoulder, _target, _pole, _qh, side);
      this.setFingers(arm, sgn, open);
      if (side === 'R') {
        // Contact check: the reached wrist against the one that lays the palm on the skin.
        const pc = this.petContact;
        pc.active = strokes && pet > 0.97 && patOnly < 0.01 && Math.max(cheer, point, show) < 0.01;
        if (pc.active) {
          pc.error = _handPos.R.distanceTo(_petWrist);
          _tmp.copy(_handPos.R).addScaledVector(_anchorFwd, PALM_BACK).sub(_anchorPos);
          pc.gap = _tmp.dot(_anchorNrm) - PALM_THICK;
        }
      }
    }
    this.placeReinGrip(Math.max(pet, point, cheer, show));

    // --- Legs ---
    rigTransform(this.pelvis, this.rigRoot, _pp, _qp);
    for (const side of SIDES) {
      this.poseLeg(side, feet, stand);
    }

    // Eye position for the dragon's gaze.
    rigTransform(this.head, this.rigRoot, _p, _q);
    this.eye.copy(RIDER.eye).sub(RIDER.head).applyQuaternion(_q).add(_p);
    this.povOffset.set(0, 0.06, 0.3).multiplyScalar(petLook).applyQuaternion(_qc).applyQuaternion(_q.invert());
  }

  /** Side (+1 left, -1 right) the dragon's head comes around on; the rider glances that way. */
  gazeSide = 1;

  /** Fist rotation (rig space) that puts `fwd` along the fingers and the palm facing `palm`. */
  private handFrame(fist: FistFrame, sgn: number, fwd: THREE.Vector3, palm: THREE.Vector3, out: THREE.Quaternion): void {
    // medial = up x fwd on the right hand, fwd x up on the left (see fistFrame), so up = fwd x medial (R) / medial x fwd (L).
    if (sgn > 0) {
      _up.crossVectors(fwd, palm);
    } else {
      _up.crossVectors(palm, fwd);
    }
    mapFrame(fist.fwd, fist.up, fwd, _up, out);
  }

  private solveArm(arm: ArmRig, shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, handRig: THREE.Quaternion, side: Side): void {
    solveLimb(shoulder, target, arm.l1, arm.l2, pole, _mid, _end, _normal);
    mapFrame(arm.upperDir, arm.bendNormal, _dir.subVectors(_mid, shoulder), _normal, _qa);
    mapFrame(arm.foreDir, arm.bendNormal, _dir.subVectors(_end, _mid), _normal, _qb);
    // The forearm takes over part of the wrist twist (pronation), so the wrist does not wring.
    _qi.copy(_qb).invert().multiply(handRig);
    const twist = twistAngle(_qi, arm.foreDir);
    postRotate(_qb, arm.foreDir, twist * FOREARM_TWIST);
    arm.upper.quaternion.copy(_qr).invert().multiply(_qa);
    arm.fore.quaternion.copy(_qa).invert().multiply(_qb);
    arm.hand.quaternion.copy(_qb).invert().multiply(handRig);
    _handPos[side].copy(_end);
    _handRot[side].copy(handRig);
  }

  private setFingers(arm: ArmRig, sgn: number, open: number): void {
    // Extension about the grip axis: rotating fwd toward -medial is -angle on the right hand, +angle on the left.
    for (let i = 0; i < 3; i++) {
      arm.fingers[i].quaternion.setFromAxisAngle(arm.fist.up, -sgn * OPEN_FINGERS[i] * open);
    }
    // Thumb: rolls off the index toward the back of the hand and spreads up.
    arm.thumb.quaternion.setFromAxisAngle(arm.fist.fwd, sgn * THUMB_OPEN.roll * open).multiply(_qt.setFromAxisAngle(arm.fist.medial, -sgn * THUMB_OPEN.spread * open));
  }

  /**
   * Right rein grip: on the right fist, or passed into the left fist while the right hand is busy. The grip bone's
   * rest pose equals the right hand's, so matching its rig transform reproduces the hand's skinning.
   */
  private placeReinGrip(busy: number): void {
    const fR = this.arms.R.fist;
    const fL = this.arms.L.fist;
    _p.copy(_handPos.R);
    // _handPos holds the wrist (IK end) of each arm; the grip bone's head is the right wrist.
    _q.copy(_handRot.R);
    if (busy > 0.001) {
      // channelL + a small offset, expressed as a right-fist point carried by the left fist.
      _tmp.copy(fL.fwd).multiplyScalar(0.1).addScaledVector(fL.medial, 0.02).addScaledVector(fL.fwd, 0.014);
      _tmp.addScaledVector(fR.fwd, -0.1).addScaledVector(fR.medial, -0.02);
      _tmp.applyQuaternion(_handRot.L).add(_handPos.L);
      _p.lerp(_tmp, busy);
      _q.slerp(_handRot.L, busy);
    }
    _qi.copy(_qc).invert();
    this.reinGrip.quaternion.copy(_qi).multiply(_q);
    this.reinGrip.position.copy(_p).sub(_pc).applyQuaternion(_qi);
  }

  private poseLeg(side: Side, feet: number, stand: number): void {
    const leg = this.legs[side];
    const sgn = sideSign(side);
    // Seated: legs follow the pelvis.
    leg.thigh.quaternion.identity();
    leg.shin.quaternion.identity();
    leg.foot.quaternion.identity();
    if (stand < 0.001) {
      return;
    }
    _qa.copy(leg.thigh.quaternion);
    _qb.copy(leg.shin.quaternion);
    // Standing: feet travel from the stirrups (out and over the saddle skirt) onto the seat; knees forward and soft.
    const hip = _root.copy(leg.hipLocal).applyQuaternion(_qp).add(_pp);
    const s = feet;
    _tmp.copy(leg.seatedAnkle).multiplyScalar((1 - s) * (1 - s));
    _tmp2.set(0.62 * sgn, 1.08, -2.62).sub(LANDMARKS.chest);
    _tmp.addScaledVector(_tmp2, 2 * s * (1 - s));
    _tmp2.set(0.13 * sgn, SEAT_TOP + ANKLE_ABOVE_SOLE, side === 'L' ? -2.66 : -2.56).sub(LANDMARKS.chest);
    _tmp.addScaledVector(_tmp2, s * s);
    _target.copy(_tmp).applyQuaternion(_qc).add(_pc);
    _poleDir.copy(leg.restPole).lerp(_tmp2.set(0.22 * sgn, 0.05, -1), s).applyQuaternion(_qc);
    _pole.copy(hip).add(_poleDir);
    solveLimb(hip, _target, leg.l1, leg.l2, _pole, _mid, _end, _normal);
    const thighRig = mapFrame(leg.thighDir, leg.bendNormal, _dir.subVectors(_mid, hip), _normal, _q);
    const shinRig = mapFrame(leg.shinDir, leg.bendNormal, _dir.subVectors(_end, _mid), _normal, _qh);
    leg.thigh.quaternion.copy(_qp).invert().multiply(thighRig);
    leg.shin.quaternion.copy(thighRig).invert().multiply(shinRig);
    // Foot flat on the seat, toes forward and slightly out.
    _dir.set(0.18 * sgn, 0, -1).applyQuaternion(_qc);
    _up.set(0, 1, 0).applyQuaternion(_qc);
    mapFrame(leg.toeDir, leg.footUp, _dir, _up, _qi);
    _qt.copy(shinRig).invert().multiply(_qi);
    leg.foot.quaternion.slerp(_qt, s);
    const w = smoothstep(stand, 0, 0.12);
    leg.thigh.quaternion.copy(_qa.slerp(leg.thigh.quaternion, w));
    leg.shin.quaternion.copy(_qb.slerp(leg.shin.quaternion, w));
  }

  /** Skinned position, normal and forward direction of the petting track at u (0 = saddle end, 1 = front). */
  private evalPetAnchor(u: number): void {
    for (const [id, pos] of this.anchorPos) {
      rigTransform(this.boneList[id], this.rigRoot, pos, this.anchorRot.get(id)!);
    }
    const n = this.anchors.length;
    const x = clamp(u, 0, 1) * (n - 1);
    const i = Math.min(Math.floor(x), n - 2);
    const f = x - i;
    this.skinned(this.anchors[i], _a0, _n0);
    this.skinned(this.anchors[i + 1], _a1, _n1);
    _anchorPos.copy(_a0).lerp(_a1, f);
    _anchorNrm.copy(_n0).lerp(_n1, f).normalize();
    // Fingers point forward along the neck, turned a little down the flank.
    _anchorFwd.subVectors(_a1, _a0);
    _anchorFwd.addScaledVector(_anchorNrm, -_anchorFwd.dot(_anchorNrm)).normalize();
    _tmp.crossVectors(_anchorFwd, _anchorNrm).normalize();
    _anchorFwd.addScaledVector(_tmp, 0.45).normalize();
  }

  private skinned(a: SurfaceAnchor, outPos: THREE.Vector3, outNrm: THREE.Vector3): void {
    outPos.set(0, 0, 0);
    outNrm.set(0, 0, 0);
    for (let k = 0; k < a.bones.length; k++) {
      const id = a.bones[k];
      const w = a.weights[k];
      const rot = this.anchorRot.get(id)!;
      _tmp.copy(a.position).sub(this.restHeads[id]).applyQuaternion(rot).add(this.anchorPos.get(id)!);
      outPos.addScaledVector(_tmp, w);
      outNrm.addScaledVector(_tmp.copy(a.normal).applyQuaternion(rot), w);
    }
    outNrm.normalize();
  }
}

/** Bend-plane normal and pole direction of a rest limb root -> mid -> end (same convention as solveLimb). */
function restBend(root: THREE.Vector3, mid: THREE.Vector3, end: THREE.Vector3): { normal: THREE.Vector3; pole: THREE.Vector3 } {
  const dir = end.clone().sub(root).normalize();
  const pole = mid.clone().sub(root);
  pole.addScaledVector(dir, -pole.dot(dir)).normalize();
  return { normal: pole.clone().cross(dir).normalize(), pole };
}
