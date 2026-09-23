import * as THREE from 'three';
import type { DragonPose, DragonState } from '../../../core/contracts';
import { FINGERS, NECK_BONES, TAIL_BONES, SIDES, RIDER, LANDMARKS, fingerJoints, mirror, sideSign, thumbTip, type Side } from '../anatomy';
import { STANDING_ROOT_HEIGHT } from '../constants';
import type { RigSkeleton } from '../skeleton';
import { aimBone, aimBoneUp, damp, rigTransform, setEuler, solveTwoBone, Spring } from './kinematics';
import { computeWingAngles, createWingAngles, strokeLoad, strokePhase, type Angles, type WingAngles } from './wing-pose';

interface WingBones {
  humerus: THREE.Bone;
  forearm: THREE.Bone;
  hand: THREE.Bone;
  thumb: THREE.Bone;
  fingerA: THREE.Bone[];
  fingerB: THREE.Bone[];
}

interface LegBones {
  thigh: THREE.Bone;
  shin: THREE.Bone;
  meta: THREE.Bone;
  foot: THREE.Bone;
  list: THREE.Bone[];
}

interface ArmBones {
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
}

/** Outputs other systems (materials) consume each frame. */
export interface AnimatorOutputs {
  breath: number;
  billowLeft: number;
  billowRight: number;
  flutter: number;
  flutterFreq: number;
  airspeed: number;
  /** Relative airflow direction in rig space (where the air goes), unit. */
  airflow: THREE.Vector3;
  /** Pleat depth (m) of the folded wing membranes. */
  foldSlack: number;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _hip = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _ankle = new THREE.Vector3();
const _ball = new THREE.Vector3();
const _target = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _end = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _stash: THREE.Quaternion[] = Array.from({ length: 16 }, () => new THREE.Quaternion());
const _blend = new THREE.Quaternion();
/** Share of the neck yaw/pitch taken by each neck bone (base to skull); sums to 1. */
const NECK_WEIGHTS = [0.15, 0.14, 0.12, 0.11, 0.1, 0.09, 0.09, 0.09, 0.11];
/** Height of the wrist joint above the ground in the quadrupedal stance (the knuckle pad rests on the ground). */
const WRIST_CLEARANCE = 0.13;
/** Hind foot stance: ball-of-foot joint height and rig-space toe pitch that put pads and claw tips on the ground. */
const BALL_CLEARANCE = 0.06;
const FOOT_STANCE_PITCH = 0.33;
/** Clamp for the body-frame acceleration fed to secondary motion (teleports, collisions). */
const MAX_ACCEL = 40;
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _dir2 = new THREE.Vector3();
const _restUp = new THREE.Vector3(0, 1, 0);
const _qc = new THREE.Quaternion();
const _thumbTarget = new THREE.Vector3();
const _air = new THREE.Vector3();
const FAN_MID = (FINGERS[0].angle + FINGERS[FINGERS.length - 1].angle) * 0.5;

/** bone.quaternion = slerp(from, bone.quaternion, t). */
function blendFrom(bone: THREE.Object3D, from: THREE.Quaternion, t: number): void {
  _blend.copy(bone.quaternion);
  bone.quaternion.copy(from).slerp(_blend, t);
}

/** Procedural animation: maps DragonPose (+ flight state) to bone rotations every frame. */
export class DragonAnimator {
  readonly outputs: AnimatorOutputs = {
    breath: 0,
    billowLeft: 0.1,
    billowRight: 0.1,
    flutter: 0.01,
    flutterFreq: 20,
    airspeed: 0,
    airflow: new THREE.Vector3(0, 0, 1),
    foldSlack: 0,
  };
  private readonly rigRoot: THREE.Object3D;
  private readonly root: THREE.Bone;
  private readonly chest: THREE.Bone;
  private readonly lumbar: THREE.Bone;
  private readonly pelvis: THREE.Bone;
  private readonly neck: THREE.Bone[];
  private readonly head: THREE.Bone;
  private readonly jaw: THREE.Bone;
  private readonly tail: THREE.Bone[];
  private readonly wings: Record<Side, WingBones>;
  private readonly legs: Record<Side, LegBones>;
  private readonly riderPelvis: THREE.Bone;
  private readonly riderSpine: THREE.Bone;
  private readonly riderChest: THREE.Bone;
  private readonly riderHead: THREE.Bone;
  private readonly arms: Record<Side, ArmBones>;
  private readonly rootRest: THREE.Vector3;
  private readonly wingAngles = createWingAngles();

  // Rest geometry for IK.
  private readonly legRest: Record<Side, { thigh: THREE.Vector3; shin: THREE.Vector3; meta: THREE.Vector3; l1: number; l2: number; metaLen: number }>;
  private readonly wingRest: Record<Side, { upper: THREE.Vector3; fore: THREE.Vector3; hand: THREE.Vector3; l1: number; l2: number }>;
  private readonly armRest: Record<Side, { upper: THREE.Vector3; fore: THREE.Vector3; l1: number; l2: number; grip: THREE.Vector3 }>;
  private readonly fingerRestB = {} as Record<Side, THREE.Vector3[]>;
  private readonly thumbRest = {} as Record<Side, THREE.Vector3>;

  // Dynamics.
  private readonly neckYaw = new Spring(28, 9);
  private readonly neckPitch = new Spring(28, 9);
  private readonly tailYaw: Spring[] = [];
  private readonly tailPitch: Spring[] = [];
  private readonly riderPitch = new Spring(40, 9);
  private readonly riderRoll = new Spring(40, 9);
  private readonly riderHeave = new Spring(70, 11);
  private smoothSpread = 1;
  private smoothTuck = 1;
  private smoothSweep = 0;
  private smoothAmp = 0;
  private smoothWalk = 0;
  private smoothJaw = 0;
  private lastVel = new THREE.Vector3();
  private hasLastVel = false;
  private breathPhase = 0;
  private time = 0;
  private readonly smoothedPose: DragonPose = {
    flapPhase: 0, flapAmplitude: 0, wingSpread: 1, wingSweep: 0, wingTwist: 0, neckYaw: 0, neckPitch: 0, jawOpen: 0,
    tailYaw: 0, tailPitch: 0, legsTuck: 1, walkPhase: 0, walkAmount: 0, breath: 0, riderLeanPitch: 0, riderLeanRoll: 0,
  };

  constructor(private readonly skel: RigSkeleton) {
    const b = (n: string): THREE.Bone => skel.bone(n);
    this.rigRoot = skel.rootBone.parent ?? skel.rootBone;
    this.root = skel.rootBone;
    this.rootRest = this.root.position.clone();
    this.chest = b('chest');
    this.lumbar = b('lumbar');
    this.pelvis = b('pelvis');
    this.neck = Array.from({ length: NECK_BONES }, (_, i) => b(`neck${i}`));
    this.head = b('head');
    this.jaw = b('jaw');
    this.tail = Array.from({ length: TAIL_BONES }, (_, i) => b(`tail${i}`));
    for (let i = 0; i < TAIL_BONES; i++) {
      const k = i / (TAIL_BONES - 1);
      const stiff = THREE.MathUtils.lerp(70, 18, k);
      const dampC = 2 * Math.sqrt(stiff) * 0.62;
      this.tailYaw.push(new Spring(stiff, dampC));
      this.tailPitch.push(new Spring(stiff, dampC));
    }
    this.wings = {} as Record<Side, WingBones>;
    this.legs = {} as Record<Side, LegBones>;
    this.arms = {} as Record<Side, ArmBones>;
    this.legRest = {} as DragonAnimator['legRest'];
    this.wingRest = {} as DragonAnimator['wingRest'];
    this.armRest = {} as DragonAnimator['armRest'];
    const head = (n: string): THREE.Vector3 => skel.restHeads[skel.id(n)];
    for (const side of SIDES) {
      this.wings[side] = {
        humerus: b(`humerus${side}`),
        forearm: b(`forearm${side}`),
        hand: b(`hand${side}`),
        thumb: b(`thumb${side}`),
        fingerA: FINGERS.map((_, f) => b(`finger${f}a${side}`)),
        fingerB: FINGERS.map((_, f) => b(`finger${f}b${side}`)),
      };
      const legList = [b(`thigh${side}`), b(`shin${side}`), b(`meta${side}`), b(`foot${side}`)];
      this.legs[side] = { thigh: legList[0], shin: legList[1], meta: legList[2], foot: legList[3], list: legList };
      this.arms[side] = { upper: b(`riderUpperArm${side}`), fore: b(`riderForearm${side}`), hand: b(`riderHand${side}`) };
      const hip = head(`thigh${side}`);
      const knee = head(`shin${side}`);
      const ankle = head(`meta${side}`);
      const ball = head(`foot${side}`);
      this.legRest[side] = {
        thigh: knee.clone().sub(hip),
        shin: ankle.clone().sub(knee),
        meta: ball.clone().sub(ankle),
        l1: knee.distanceTo(hip),
        l2: ankle.distanceTo(knee),
        metaLen: ball.distanceTo(ankle),
      };
      const sh = head(`humerus${side}`);
      const el = head(`forearm${side}`);
      const wr = head(`hand${side}`);
      const handDir = new THREE.Vector3(Math.cos(FAN_MID) * sideSign(side), 0, Math.sin(FAN_MID));
      this.wingRest[side] = { upper: el.clone().sub(sh), fore: wr.clone().sub(el), hand: handDir, l1: el.distanceTo(sh), l2: wr.distanceTo(el) };
      this.fingerRestB[side] = fingerJoints(side).map((j) => j[2].clone().sub(j[1]).normalize());
      this.thumbRest[side] = thumbTip(side).sub(wr).normalize();
      const ash = head(`riderUpperArm${side}`);
      const ael = head(`riderForearm${side}`);
      const awr = head(`riderHand${side}`);
      this.armRest[side] = {
        upper: ael.clone().sub(ash),
        fore: awr.clone().sub(ael),
        l1: ael.distanceTo(ash),
        l2: awr.distanceTo(ael),
        grip: mirror(RIDER.wrist, side).sub(LANDMARKS.chest),
      };
    }
    this.riderPelvis = b('riderPelvis');
    this.riderSpine = b('riderSpine');
    this.riderChest = b('riderChest');
    this.riderHead = b('riderHead');
  }

  update(pose: Readonly<DragonPose>, dt: number, state: DragonState | undefined): void {
    this.time += dt;
    const k = dt > 0 ? damp(10, dt) : 1;
    this.smoothSpread += (pose.wingSpread - this.smoothSpread) * (dt > 0 ? damp(7, dt) : 1);
    this.smoothTuck += (pose.legsTuck - this.smoothTuck) * (dt > 0 ? damp(4, dt) : 1);
    this.smoothSweep += (pose.wingSweep - this.smoothSweep) * k;
    this.smoothAmp += (pose.flapAmplitude - this.smoothAmp) * k;
    this.smoothWalk += (pose.walkAmount - this.smoothWalk) * (dt > 0 ? damp(5, dt) : 1);
    const smoothed = this.smoothedPose;
    Object.assign(smoothed, pose);
    smoothed.wingSpread = this.smoothSpread;
    smoothed.legsTuck = this.smoothTuck;
    smoothed.wingSweep = this.smoothSweep;
    smoothed.flapAmplitude = this.smoothAmp;
    smoothed.walkAmount = this.smoothWalk;

    this.updateFlightState(state, dt);
    const psi = strokePhase(pose.flapPhase);
    const amp = THREE.MathUtils.clamp(this.smoothAmp, 0, 1.5) * this.smoothSpread;
    const grounded = 1 - THREE.MathUtils.clamp(this.smoothTuck, 0, 1);
    const walk = this.smoothWalk * grounded;

    // --- Body: heave counter to the wing stroke, slight pitching; walking sway. ---
    const heave = -0.13 * amp * Math.cos(psi - 0.35);
    const bodyPitch = 0.025 * amp * Math.sin(psi - 0.2);
    const wp = pose.walkPhase;
    const walkSway = walk * 0.05 * Math.sin(wp);
    const walkBob = walk * 0.05 * Math.cos(wp * 2);
    this.root.position.set(this.rootRest.x + walkSway * 0.6, this.rootRest.y + heave + walkBob, this.rootRest.z);
    setEuler(this.root, bodyPitch, walkSway * 0.8, walk * 0.03 * Math.sin(wp), 'YXZ');
    setEuler(this.chest, -bodyPitch * 0.4 + grounded * 0.05, -walkSway * 0.9, 0, 'YXZ');
    setEuler(this.lumbar, -bodyPitch * 0.3, -walkSway * 0.5, 0, 'YXZ');
    setEuler(this.pelvis, -0.02 * grounded, walkSway * 0.6, 0, 'YXZ');

    // --- Neck & head ---
    const neckYawTarget = THREE.MathUtils.clamp(pose.neckYaw, -1.3, 1.3);
    const neckPitchTarget = THREE.MathUtils.clamp(pose.neckPitch, -0.9, 0.9);
    if (dt > 0) {
      this.neckYaw.step(neckYawTarget, dt);
      this.neckPitch.step(neckPitchTarget, dt);
    } else {
      this.neckYaw.reset(neckYawTarget);
      this.neckPitch.reset(neckPitchTarget);
    }
    const ny = this.neckYaw.value;
    const np = this.neckPitch.value;
    const groundNeck = grounded * 0.12;
    const walkNod = walk * 0.03 * Math.sin(wp * 2 + 0.5);
    for (let i = 0; i < NECK_BONES; i++) {
      const w = NECK_WEIGHTS[i];
      const osc = -bodyPitch * (i < 3 ? 0.5 : 0);
      const lift = groundNeck * (i < 4 ? 0.9 : -0.6);
      setEuler(this.neck[i], np * w + osc + lift * w + walkNod * w, ny * w + 0.02 * Math.sin(this.time * 0.7 - i * 0.4) * grounded, 0, 'YXZ');
    }
    // Head stabilization: counter body pitch/heave so the gaze stays steady.
    const headStab = -bodyPitch * 0.6 - heave * 0.25;
    setEuler(this.head, headStab - groundNeck * 0.25, 0, 0, 'YXZ');
    this.smoothJaw += (THREE.MathUtils.clamp(pose.jawOpen, 0, 1) - this.smoothJaw) * (dt > 0 ? damp(14, dt) : 1);
    setEuler(this.jaw, -this.smoothJaw * 0.62, 0, 0, 'YXZ');

    // --- Tail with lagging springs ---
    this.updateTail(pose, dt, amp, psi, walk, wp, grounded);

    // --- Wings ---
    for (const side of SIDES) {
      const sgn = sideSign(side);
      computeWingAngles(smoothed, sgn, this.wingAngles);
      this.applyWing(side, this.wingAngles);
    }
    const fold = 1 - THREE.MathUtils.clamp(this.smoothSpread, 0, 1);
    if (fold > 0.001) {
      for (const side of SIDES) {
        this.applyWingFold(side, fold, grounded, walk, wp);
      }
    }

    // --- Legs ---
    for (const side of SIDES) {
      this.applyLeg(side, grounded, walk, wp, amp, psi);
    }

    // --- Rider ---
    this.applyRider(pose, dt, heave);

    // --- Material-driven outputs ---
    this.breathPhase += dt * (0.9 + 1.4 * amp + 0.6 * walk);
    this.outputs.breath = THREE.MathUtils.clamp(pose.breath, 0, 1) * 0.025 * Math.sin(this.breathPhase * Math.PI * 0.5) + amp * 0.01 * Math.sin(this.breathPhase * 3.1);
    const q = Math.min(this.outputs.airspeed / 40, 1.6);
    const load = strokeLoad(pose.flapPhase);
    const baseCamber = (0.06 + 0.12 * q) * this.smoothSpread;
    const flapBillow = amp * (load > 0 ? 0.32 * load : 0.14 * load);
    const twist = pose.wingTwist;
    this.outputs.billowRight = baseCamber + flapBillow - 0.03 * twist;
    this.outputs.billowLeft = baseCamber + flapBillow + 0.03 * twist;
    this.outputs.flutter = (0.006 + 0.022 * q) * this.smoothSpread;
    this.outputs.flutterFreq = 14 + 16 * q;
    const folded = 1 - THREE.MathUtils.clamp(this.smoothSpread, 0, 1);
    this.outputs.foldSlack = 0.16 * folded * folded;
  }

  private wind: THREE.Vector3 | null = null;

  /** World wind (m/s) for the relative airflow over the rider's cloak. */
  setWind(wind: THREE.Vector3 | null): void {
    this.wind = wind;
  }

  private updateFlightState(state: DragonState | undefined, dt: number): void {
    if (!state) {
      this.outputs.airspeed = 0;
      this.outputs.airflow.set(0, -0.3, 1).normalize();
      return;
    }
    _invQ.copy(state.quaternion).invert();
    _vel.copy(state.velocity).applyQuaternion(_invQ);
    // Relative wind = wind - ground velocity; it blows the cloak (rig space).
    _air.copy(state.velocity).multiplyScalar(-1);
    if (this.wind) {
      _air.add(this.wind);
    }
    const airSpeed = _air.length();
    this.outputs.airspeed = airSpeed;
    if (airSpeed > 0.3) {
      this.outputs.airflow.copy(_air).applyQuaternion(_invQ).normalize();
    } else {
      this.outputs.airflow.set(0, -0.3, 1).normalize();
    }
    if (dt > 0) {
      if (this.hasLastVel) {
        _acc.subVectors(_vel, this.lastVel).divideScalar(dt);
        if (_acc.lengthSq() > MAX_ACCEL * MAX_ACCEL) {
          _acc.setLength(MAX_ACCEL);
        }
      } else {
        _acc.set(0, 0, 0);
      }
      this.lastVel.copy(_vel);
      this.hasLastVel = true;
    }
  }

  private updateTail(pose: Readonly<DragonPose>, dt: number, amp: number, psi: number, walk: number, wp: number, grounded: number): void {
    const state = this.skelState;
    const yawRate = state ? state.y : 0;
    const pitchRate = state ? state.x : 0;
    const n = TAIL_BONES;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const baseYaw = THREE.MathUtils.clamp(pose.tailYaw, -1.4, 1.4) / n;
      const basePitch = THREE.MathUtils.clamp(pose.tailPitch, -1.0, 1.0) / n;
      const inertialYaw = -yawRate * 0.045 * (0.3 + k);
      const inertialPitch = pitchRate * 0.035 * (0.3 + k) - _acc.y * 0.0012 * k;
      const wave = amp * 0.05 * Math.sin(psi - 1.3 - i * 0.32) * (0.4 + k);
      const idle = 0.035 * Math.sin(this.time * 0.8 - i * 0.42) * (0.3 + k) * (0.4 + 0.6 * grounded);
      const walkSwing = walk * 0.06 * Math.sin(wp - i * 0.35 - 0.8) * (0.3 + k);
      const lateralAcc = -_acc.x * 0.0015 * k;
      const droop = grounded * (i < 4 ? -0.03 : 0.012);
      const ty = baseYaw + inertialYaw + idle + walkSwing + lateralAcc;
      const tp = basePitch + inertialPitch + wave + droop + 0.012 * Math.sin(this.time * 0.6 - i * 0.3) * grounded;
      let yaw: number;
      let pitch: number;
      if (dt > 0) {
        yaw = this.tailYaw[i].step(ty, dt);
        pitch = this.tailPitch[i].step(tp, dt);
      } else {
        this.tailYaw[i].reset(ty);
        this.tailPitch[i].reset(tp);
        yaw = ty;
        pitch = tp;
      }
      setEuler(this.tail[i], pitch, yaw, 0, 'YXZ');
    }
  }

  private skelState: THREE.Vector3 | null = null;

  /** Body-frame angular velocity of the flight body (x = pitch rate, y = yaw rate). */
  setAngularVelocity(v: THREE.Vector3 | null): void {
    this.skelState = v;
  }

  private applyAngles(bone: THREE.Bone, a: Angles, sgn: number): void {
    setEuler(bone, a.x, a.y * sgn, a.z * sgn, 'YZX');
  }

  private applyWing(side: Side, w: WingAngles): void {
    const sgn = sideSign(side);
    const bones = this.wings[side];
    this.applyAngles(bones.humerus, w.humerus, sgn);
    this.applyAngles(bones.forearm, w.forearm, sgn);
    this.applyAngles(bones.hand, w.hand, sgn);
    this.applyAngles(bones.thumb, w.thumb, sgn);
    for (let f = 0; f < FINGERS.length; f++) {
      this.applyAngles(bones.fingerA[f], w.fingerA[f], sgn);
      this.applyAngles(bones.fingerB[f], w.fingerB[f], sgn);
    }
  }

  /**
   * Folded wings: in flight they close like an umbrella along the flank (humerus back, forearm forward,
   * fingers back); on the ground the wrists become front feet (IK onto the ground, fingers folded up).
   */
  private applyWingFold(side: Side, fold: number, grounded: number, walk: number, wp: number): void {
    const sgn = sideSign(side);
    const bones = this.wings[side];
    const rest = this.wingRest[side];
    _stash[0].copy(bones.humerus.quaternion);
    _stash[1].copy(bones.forearm.quaternion);
    _stash[2].copy(bones.hand.quaternion);
    _stash[3].copy(bones.thumb.quaternion);
    for (let f = 0; f < FINGERS.length; f++) {
      _stash[8 + f].copy(bones.fingerA[f].quaternion);
      _stash[12 + f].copy(bones.fingerB[f].quaternion);
    }
    rigTransform(this.chest, this.rigRoot, _p, _q);
    const shoulder = _hip.copy(bones.humerus.position).applyQuaternion(_q).add(_p);
    _restUp.set(0, 1, 0);

    // Flight fold.
    _up.set(0.35 * sgn, 1, 0);
    aimBoneUp(bones.humerus, _q, rest.upper, _restUp, _dir.set(0.3 * sgn, -0.16, 1), _up, _qa);
    aimBoneUp(bones.forearm, _qa, rest.fore, _restUp, _dir.set(0.07 * sgn, 0.1, -1), _up, _qb);
    aimBoneUp(bones.hand, _qb, rest.hand, _restUp, _dir.set(0.06 * sgn, 0.06, 1), _up);
    if (grounded > 0.001) {
      _stash[4].copy(bones.humerus.quaternion);
      _stash[5].copy(bones.forearm.quaternion);
      _stash[6].copy(bones.hand.quaternion);
      // Ground stance: IK the wrist onto the ground (lateral-sequence walk: LH, LF, RH, RF), elbow folded back
      // and up beside the flank.
      const phase = wp + (side === 'L' ? Math.PI * 0.5 : Math.PI * 1.5);
      this.footCycle(phase, 1.5);
      const ground = -STANDING_ROOT_HEIGHT + WRIST_CLEARANCE;
      _target.set(1.5 * sgn, ground + this.footLift * walk, -2.55 + this.footOffset * walk);
      _pole.copy(shoulder).add(_dir.set(0.5 * sgn, 0.75, 1.8));
      solveTwoBone(shoulder, _target, rest.l1, rest.l2, _pole, _mid, _end);
      _up.set(sgn, 0.15, 0.1);
      aimBoneUp(bones.humerus, _q, rest.upper, _restUp, _dir.subVectors(_mid, shoulder), _up, _qa);
      aimBoneUp(bones.forearm, _qa, rest.fore, _restUp, _dir.subVectors(_end, _mid), _up, _qb);
      // Z-fold: the hand and first phalanges run back up along the forearm, the outer phalanges fold down and
      // back along the flank (bat / pterosaur quadrupedal stance), so no finger bundle sticks up like a sail.
      _dir.subVectors(_mid, _end).normalize().add(_dir2.set(0.06 * sgn, -0.05, 0.3)).normalize();
      aimBoneUp(bones.hand, _qb, rest.hand, _restUp, _dir, _up, _qc);
      for (let f = 0; f < FINGERS.length; f++) {
        _euler.set(0, (FINGERS[f].angle - FAN_MID) * sgn * 0.97, 0, 'YZX');
        _q2.copy(_qc).multiply(_q3.setFromEuler(_euler));
        _dir2.set((0.1 + 0.015 * f) * sgn, 0.06 - 0.03 * f, 1).normalize();
        aimBone(bones.fingerB[f], _q2, this.fingerRestB[side][f], _dir2);
      }
      // Thumb points forward, its claw resting on the ground ahead of the wrist.
      aimBone(bones.thumb, _qc, this.thumbRest[side], _thumbTarget.set(0.3 * sgn, 0.12, -1));
      blendFrom(bones.humerus, _stash[4], grounded);
      blendFrom(bones.forearm, _stash[5], grounded);
      blendFrom(bones.hand, _stash[6], grounded);
      blendFrom(bones.thumb, _stash[3], grounded);
      for (let f = 0; f < FINGERS.length; f++) {
        blendFrom(bones.fingerB[f], _stash[12 + f], grounded);
      }
    }
    const e = fold * fold * (3 - 2 * fold);
    blendFrom(bones.humerus, _stash[0], e);
    blendFrom(bones.forearm, _stash[1], e);
    blendFrom(bones.hand, _stash[2], e);
    blendFrom(bones.thumb, _stash[3], e);
    // Fingers close like a fan.
    for (let f = 0; f < FINGERS.length; f++) {
      setEuler(bones.fingerA[f], 0, (FINGERS[f].angle - FAN_MID) * sgn * 0.97, 0, 'YZX');
      blendFrom(bones.fingerA[f], _stash[8 + f], e);
      blendFrom(bones.fingerB[f], _stash[12 + f], e);
    }
  }

  private footOffset = 0;
  private footLift = 0;

  /** Foot trajectory for a phase: sets footOffset (m, + = backward) and footLift (m). */
  private footCycle(phase: number, stride: number): void {
    const TWO_PI = Math.PI * 2;
    const p = (((phase % TWO_PI) + TWO_PI) % TWO_PI) / TWO_PI;
    const stance = 0.64;
    if (p < stance) {
      this.footOffset = (p / stance - 0.5) * stride;
      this.footLift = 0;
      return;
    }
    const t = (p - stance) / (1 - stance);
    const s = t * t * (3 - 2 * t);
    this.footOffset = (0.5 - s) * stride;
    this.footLift = Math.sin(t * Math.PI) * 0.28;
  }

  private applyLeg(side: Side, grounded: number, walk: number, wp: number, amp: number, psi: number): void {
    const sgn = sideSign(side);
    const bones = this.legs[side];
    const rest = this.legRest[side];
    // Flight: legs trail back under the tail, toes curled.
    const trail = 0.05 * amp * Math.sin(psi - 1.0);
    setEuler(bones.thigh, -1.0 + trail, 0.06 * sgn, 0.05 * sgn, 'YXZ');
    setEuler(bones.shin, 0.3, 0, 0, 'YXZ');
    setEuler(bones.meta, -0.25, 0, 0, 'YXZ');
    setEuler(bones.foot, -0.55, 0, 0, 'YXZ');
    if (grounded < 0.001) {
      return;
    }
    for (let i = 0; i < 4; i++) {
      _stash[4 + i].copy(bones.list[i].quaternion);
    }
    const phase = wp + (side === 'L' ? 0 : Math.PI);
    this.footCycle(phase, 1.7);
    const offset = this.footOffset;
    const lift = this.footLift;
    const ground = -STANDING_ROOT_HEIGHT;
    rigTransform(this.pelvis, this.rigRoot, _p, _q);
    _hip.copy(bones.thigh.position).applyQuaternion(_q).add(_p);
    _ball.set(0.76 * sgn, ground + BALL_CLEARANCE + lift * walk, 2.02 + offset * walk);
    _ankle.copy(_ball).add(_dir.set(0.0, 0.46, 0.22).normalize().multiplyScalar(rest.metaLen));
    _pole.copy(_hip).add(_dir.set(0.15 * sgn, -0.3, -1.0));
    solveTwoBone(_hip, _ankle, rest.l1, rest.l2, _pole, _knee, _end);
    aimBone(bones.thigh, _q, rest.thigh, _dir.subVectors(_knee, _hip));
    _q2.copy(_q).multiply(bones.thigh.quaternion);
    aimBone(bones.shin, _q2, rest.shin, _dir.subVectors(_end, _knee));
    _q2.multiply(bones.shin.quaternion);
    aimBone(bones.meta, _q2, rest.meta, _dir.subVectors(_ball, _end));
    _q2.multiply(bones.meta.quaternion);
    // Foot: toes flat on the ground (rest toes point forward-down), lifted foot pitches toes down.
    _euler.set(FOOT_STANCE_PITCH - lift * walk * 1.2, 0, 0, 'YXZ');
    _q3.setFromEuler(_euler);
    bones.foot.quaternion.copy(_q2).invert().multiply(_q3);
    const e = grounded * grounded * (3 - 2 * grounded);
    for (let i = 0; i < 4; i++) {
      blendFrom(bones.list[i], _stash[4 + i], e);
    }
  }

  private applyRider(pose: Readonly<DragonPose>, dt: number, heave: number): void {
    const leanPitch = THREE.MathUtils.clamp(pose.riderLeanPitch, -0.6, 0.6);
    const leanRoll = THREE.MathUtils.clamp(pose.riderLeanRoll, -0.6, 0.6);
    const lp = dt > 0 ? this.riderPitch.step(leanPitch, dt) : (this.riderPitch.reset(leanPitch), leanPitch);
    const lr = dt > 0 ? this.riderRoll.step(leanRoll, dt) : (this.riderRoll.reset(leanRoll), leanRoll);
    // The rider's torso lags the dragon's heave a little (secondary motion).
    const hv = dt > 0 ? this.riderHeave.step(heave, dt) : (this.riderHeave.reset(heave), heave);
    const lag = THREE.MathUtils.clamp((hv - heave) * 1.4, -0.08, 0.08);
    setEuler(this.riderPelvis, lp * 0.15, 0, -lr * 0.3, 'YXZ');
    setEuler(this.riderSpine, lp * 0.4 + lag, 0, -lr * 0.35, 'YXZ');
    setEuler(this.riderChest, lp * 0.35 + lag * 0.5, 0, -lr * 0.25, 'YXZ');
    setEuler(this.riderHead, -lp * 0.6 - lag * 1.2, 0, lr * 0.5, 'YXZ');
    // Arms: two-bone IK to the reins grip above the pommel (fixed in the dragon's chest frame).
    rigTransform(this.chest, this.rigRoot, _p, _q);
    rigTransform(this.riderChest, this.rigRoot, _vel, _q2);
    for (const side of SIDES) {
      const sgn = sideSign(side);
      const arm = this.arms[side];
      const rest = this.armRest[side];
      _target.copy(rest.grip).applyQuaternion(_q).add(_p);
      const shoulder = _hip.copy(arm.upper.position).applyQuaternion(_q2).add(_vel);
      _pole.copy(shoulder).add(_dir.set(0.55 * sgn, -0.5, 0.35));
      solveTwoBone(shoulder, _target, rest.l1, rest.l2, _pole, _mid, _end);
      aimBone(arm.upper, _q2, rest.upper, _dir.subVectors(_mid, shoulder));
      _q3.copy(_q2).multiply(arm.upper.quaternion);
      aimBone(arm.fore, _q3, rest.fore, _dir.subVectors(_end, _mid));
      _q3.multiply(arm.fore.quaternion);
      arm.hand.quaternion.copy(_q3).invert().multiply(_q);
    }
  }
}
