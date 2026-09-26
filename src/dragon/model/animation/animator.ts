import * as THREE from 'three';
import type { DragonPose, DragonState } from '../../../core/contracts';
import { FINGERS, HEAD_FWD, HEAD_UP, NECK_BONES, TAIL_BONES, SIDES, fingerJoints, sideSign, thumbTip, type Side } from '../anatomy';
import { STANDING_ROOT_HEIGHT } from '../constants';
import type { RigSkeleton } from '../skeleton';
import { aimBone, aimBoneUp, damp, rigTransform, setEuler, solveTwoBone, Spring } from './kinematics';
import { RiderAnimator, type SurfaceAnchor } from './rider-pose';
import { computeWingAngles, createWingAngles, strokeLoad, strokePhase, type Angles, type WingAngles } from './wing-pose';
import { footfallOffsets } from '../../../core/gait';

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
const _gn = new THREE.Vector3();
const _gp = new THREE.Vector3();
const _euler = new THREE.Euler();
const _stash: THREE.Quaternion[] = Array.from({ length: 16 }, () => new THREE.Quaternion());
const _blend = new THREE.Quaternion();
/** Share of the neck yaw/pitch taken by each neck bone (base to skull); sums to 1. */
const NECK_WEIGHTS = [0.15, 0.14, 0.12, 0.11, 0.1, 0.09, 0.09, 0.09, 0.11];
/** Height of the wrist joint above the ground in the quadrupedal stance (the knuckle pad rests on the ground). */
const WRIST_CLEARANCE = 0.13;
/** Hind foot stance: ball-of-foot joint height and rig-space toe pitch that put pads and claw tips on the ground. */
const BALL_CLEARANCE = 0.08;
const FOOT_STANCE_PITCH = 0.33;
/**
 * Gait geometry. The feet are planted on the ground plane (DragonPose.groundY / groundNx / groundNz) and swept
 * back through the stance by min(sweep max, stride × MAX_DUTY): with the stride the flight model reports, a planted
 * foot moves back exactly as fast as the body moves forward (no foot skate). Centres are the stance mid-points
 * (rig z); the hind sweep is what the legs reach at the standing height.
 */
const HIND_Z = 1.85;
const HIND_X = 0.76;
const HIND_SWEEP = 1.75;
const FORE_Z = -2.55;
const FORE_X = 1.5;
const FORE_SWEEP = 2.0;
const MAX_DUTY = 0.68;
/** Stride used without DragonPose.stride (m per cycle). */
const DEFAULT_STRIDE = 2.6;
/** Swing lift (m) at a walk and extra at a gallop. */
const HIND_LIFT = 0.3;
const FORE_LIFT = 0.34;
const GALLOP_LIFT = 0.16;
/** Legs hanging clear of the ground sit this much lower than standing (they meet the ground first, then give). */
const HANG_EXTRA = 0.08;
/** Hanging legs reach forward for a touchdown / trail back after a push-off (m). */
const REACH_FORWARD = 0.6;
const REACH_BACK = 0.75;
/** Hind feet braced forward in a braking skid (m). */
const SKID_BRACE = 0.7;
/** Wrist of a raised wing lifting off the ground, relative to the shoulder (rig, right side). */
const RAISED_WRIST = [2.2, 2.6, 0.9];
/** Tail pitch limits (total curl, rad): up to lift it clear of the ground, down to droop. */
const TAIL_UP_LIMIT = 1.6;
const TAIL_DOWN_LIMIT = 1.0;
/**
 * First-person posture: with the rider looking over its head, the dragon flies with its neck stretched forward and
 * slightly down like a goose (lower neck pitched down, upper neck raised back towards level), so the skull sits
 * below the saddle eye line and the flight path stays clear above it. The top of the resting head slopes down
 * about as steeply as the rider's line of sight, so from the saddle it foreshortens to a sliver behind the brow;
 * the head is therefore carried looking ahead, nose raised by POV_HEAD_RAISE, which turns the brow, horns and the
 * whole snout top towards the rider. While it breathes fire or roars (jaw open) the head levels out again, so the
 * fire goes where it does in third person.
 */
const POV_NECK_DROP = 0.4;
const POV_NECK_LIFT = 0.3;
const POV_HEAD_RAISE = 0.22;
/**
 * Looking back at the rider (gazeRider): the neck swings round to one side in a C that tightens toward the head (the
 * first two bones sit under the saddle and barely move) while the lower neck lifts the head to the rider's eye level
 * about 2.5 m away; the head then turns toward the rider's eyes. Yaw / pitch per bone for a left turn (tuned
 * headlessly: joint bends <= 28 deg, head-to-neck turn ~53 deg, snout ~1.6 m from the rider's face).
 */
const GAZE_YAW = [0.02, 0.04, 0.08, 0.16, 0.27, 0.38, 0.46, 0.5, 0.5];
const GAZE_PITCH = [0.03, 0.08, 0.1, 0.06, 0.03, 0.02, 0.02, 0.02, 0.02];
/** Extra curl and lift while being petted (the head leans in closer). */
const GAZE_PET_YAW = [0, 0, 0.02, 0.03, 0.03, 0.03, 0.03, 0.02, 0.02];
/** The head turns this far outward from pointing straight at the rider, so its near eye (they sit on the sides) meets his. */
const GAZE_EYE_OFFSET = 0.7;
/** Head up vector while gazing: 0 = the neck end's up (no twist), 1 = the body's up. */
const GAZE_UP_BODY = 0.4;
/** Affectionate head tilt (roll, rad), stronger while petted. */
const GAZE_TILT = 0.2;
const GAZE_PET_TILT = 0.16;
/**
 * Swimming at the surface (DragonPose.swim / swimPhase / swimStroke; the feel tunables live in the flight model's
 * SWIM_POSE). Shape of the stroke on the rig at full strength (rad): the side-to-side undulation of the spine (root,
 * lumbar, pelvis) runs into a travelling wave down the tail (per-bone yaw growing toward the tip, TAIL_LAG rad of phase
 * per bone), the chest and rider stay steady and the neck undoes the body's swing so the head keeps to the course. The
 * neck carries a swan-like S (lower neck up, upper neck forward) and the head is held level. The wings fold tight along
 * the back; the hind legs kick alternately below the body (thigh swinging back and forth around THIGH, the shin
 * flexing on the recovery, the foot feathering).
 */
const SWIM_RIG = {
  rootYaw: 0.035,
  lumbarYaw: 0.08,
  pelvisYaw: 0.12,
  roll: 0.03,
  tailYawBase: 0.035,
  tailYawTip: 0.11,
  tailLag: 0.32,
  neckCurve: [0.11, 0.09, 0.06, 0.02, -0.02, -0.05, -0.07, -0.07, -0.07],
  headLevel: 0.55,
  thigh: -0.55,
  thighKick: 0.4,
  thighKickIdle: 0.12,
  thighOut: 0.18,
  shin: 0.55,
  shinFlex: 0.4,
  meta: -0.35,
  foot: -0.45,
  footFeather: 0.4,
} as const;
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
const _gazeHead = new THREE.Vector3();
const _gazeDir = new THREE.Vector3();
const _gazeUp = new THREE.Vector3();
const _gazeAxis = new THREE.Vector3();

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
  private readonly rider: RiderAnimator;
  private readonly rootRest: THREE.Vector3;
  private readonly wingAngles = createWingAngles();

  // Rest geometry for IK.
  private readonly legRest: Record<Side, { thigh: THREE.Vector3; shin: THREE.Vector3; meta: THREE.Vector3; l1: number; l2: number; metaLen: number }>;
  private readonly wingRest: Record<Side, { upper: THREE.Vector3; fore: THREE.Vector3; hand: THREE.Vector3; l1: number; l2: number }>;
  private readonly fingerRestB = {} as Record<Side, THREE.Vector3[]>;
  private readonly thumbRest = {} as Record<Side, THREE.Vector3>;

  // Dynamics.
  private readonly neckYaw = new Spring(28, 9);
  private readonly neckPitch = new Spring(28, 9);
  private readonly tailYaw: Spring[] = [];
  private readonly tailPitch: Spring[] = [];
  /** gazeRider, sprung so the neck swings round and back organically (~1 s). */
  private readonly gaze = new Spring(9, 6);
  private gazeSide = 1;
  private gazeSideTarget = 1;
  private smoothSpread = 1;
  private smoothTuck = 1;
  private smoothSweep = 0;
  private smoothAmp = 0;
  private smoothWalk = 0;
  private smoothJaw = 0;
  /* Swimming this frame: posture weight (eased), stroke strength (weighted) and phase. */
  private swimW = 0;
  private swimStroke = 0;
  private swimPhase = 0;
  private povTarget = 0;
  private povBlend = 0;
  /** 1 while the head is raised to breathe fire (jaw open), eased so the head does not snap. */
  private povAim = 0;
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
    this.legRest = {} as DragonAnimator['legRest'];
    this.wingRest = {} as DragonAnimator['wingRest'];
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
    }
    this.rider = new RiderAnimator(skel, this.rigRoot);
  }

  /** Surface points of the petting stroke on the neck (see RiderAnimator.setPetTrack). */
  setPetTrack(anchors: SurfaceAnchor[]): void {
    this.rider.setPetTrack(anchors);
  }

  /** Side the head comes round on when it looks at the rider: +1 left, -1 right (applied while the head is forward). */
  setGazeSide(side: number, immediate = false): void {
    this.gazeSideTarget = side < 0 ? -1 : 1;
    if (immediate) {
      this.gazeSide = this.gazeSideTarget;
    }
  }

  /** First-person eye anchor offset in the riderHead bone frame (see RiderAnimator.povOffset). */
  /** True once per rein crack of the rider's urge gesture. */
  consumeReinSnap(): boolean {
    return this.rider.consumeReinSnap();
  }

  get povEyeOffset(): THREE.Vector3 {
    return this.rider.povOffset;
  }

  /** Debug (screenshots): freeze the urge snap phase (0..1) and the petting stroke phase (rad); null = animate. */
  setDebugPhases(urge: number | null, stroke: number | null): void {
    this.rider.debugUrgePhase = urge;
    this.rider.debugStrokePhase = stroke;
  }

  /** Blends the first-person neck posture in (true) or out (false). */
  setFirstPerson(enabled: boolean): void {
    this.povTarget = enabled ? 1 : 0;
  }

  update(pose: Readonly<DragonPose>, dt: number, state: DragonState | undefined): void {
    this.time += dt;
    this.povBlend += (this.povTarget - this.povBlend) * (dt > 0 ? damp(4, dt) : 1);
    const k = dt > 0 ? damp(10, dt) : 1;
    // Opening follows quicker than folding (a leap snaps the wings open into its first downstroke).
    this.smoothSpread += (pose.wingSpread - this.smoothSpread) * (dt > 0 ? damp(pose.wingSpread > this.smoothSpread ? 14 : 7, dt) : 1);
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
    this.readGround(pose, state);
    const psi = strokePhase(pose.flapPhase);
    const amp = THREE.MathUtils.clamp(this.smoothAmp, 0, 1.5) * this.smoothSpread;
    // Floating: no ground plane, no planted feet; the swim stroke takes over from the stance.
    const swimRaw = THREE.MathUtils.clamp(pose.swim ?? 0, 0, 1);
    const swimW = swimRaw * swimRaw * (3 - 2 * swimRaw);
    this.swimW = swimW;
    this.swimStroke = THREE.MathUtils.clamp(pose.swimStroke ?? 0, 0, 1.2) * swimW;
    this.swimPhase = pose.swimPhase ?? 0;
    const grounded = (1 - THREE.MathUtils.clamp(this.smoothTuck, 0, 1)) * (1 - swimW);
    const walk = this.smoothWalk * grounded;
    const swPh = this.swimPhase;
    const swSt = this.swimStroke;
    const swimRoot = SWIM_RIG.rootYaw * swSt * Math.sin(swPh + 0.6);

    // --- Body: heave counter to the wing stroke, slight pitching; walking sway. ---
    const heave = -0.13 * amp * Math.cos(psi - 0.35);
    const bodyPitch = 0.025 * amp * Math.sin(psi - 0.2);
    const wp = pose.walkPhase;
    // Gaits: a walk sways and bobs twice per cycle; a gallop bounds once per cycle (up in the suspension after the
    // hind push, nose down onto the fore feet) with the spine flexing.
    const gallop = THREE.MathUtils.clamp(this.gait - 1, 0, 1);
    const trot = THREE.MathUtils.clamp(this.gait, 0, 1) * (1 - gallop);
    const walkSway = walk * 0.05 * Math.sin(wp) * (1 - 0.6 * trot - 0.8 * gallop);
    const walkBob = walk * ((0.05 + 0.03 * trot) * Math.cos(wp * 2) * (1 - gallop) + 0.1 * gallop * Math.cos(wp - 2.2));
    const gaitPitch = walk * gallop * 0.05 * Math.sin(wp - 2.2);
    const spineFlex = walk * gallop * 0.09 * Math.sin(wp - 1.2);
    this.root.position.set(this.rootRest.x + walkSway * 0.6, this.rootRest.y + heave + walkBob, this.rootRest.z);
    setEuler(this.root, bodyPitch + gaitPitch, walkSway * 0.8 + swimRoot, walk * 0.03 * Math.sin(wp) * (1 - gallop) + SWIM_RIG.roll * swSt * Math.sin(swPh), 'YXZ');
    setEuler(this.chest, -bodyPitch * 0.4 + grounded * 0.05 - spineFlex * 0.5, -walkSway * 0.9 - swimRoot * 0.5, 0, 'YXZ');
    setEuler(this.lumbar, -bodyPitch * 0.3 + spineFlex, -walkSway * 0.5 + SWIM_RIG.lumbarYaw * swSt * Math.sin(swPh - 0.4), 0, 'YXZ');
    setEuler(this.pelvis, -0.02 * grounded - spineFlex * 0.5, walkSway * 0.6 + SWIM_RIG.pelvisYaw * swSt * Math.sin(swPh - 0.9), 0, 'YXZ');

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
    // Looking back at the rider: blends the whole neck from the flight posture into the gaze curve.
    const gazeTarget = THREE.MathUtils.clamp(pose.gazeRider ?? 0, 0, 1);
    const gRaw = THREE.MathUtils.clamp(dt > 0 ? this.gaze.step(gazeTarget, dt) : (this.gaze.reset(gazeTarget), gazeTarget), 0, 1);
    const g = gRaw * gRaw * (3 - 2 * gRaw);
    if (g < 0.03) {
      this.gazeSide = this.gazeSideTarget;
    }
    const side = this.gazeSide;
    const pet = this.rider.cues.pet;
    const petSway = 0.035 * pet * Math.sin(this.time * 0.9);
    // The first-person neck posture gives way to the gaze, and to petting (the rider reaches down to the neck).
    const povKeep = 1 - Math.max(g, pet);
    for (let i = 0; i < NECK_BONES; i++) {
      const w = NECK_WEIGHTS[i];
      const osc = -bodyPitch * (i < 3 ? 0.5 : 0);
      const lift = groundNeck * (i < 4 ? 0.9 : -0.6);
      const pov = this.povBlend * povKeep * (i < 5 ? -POV_NECK_DROP * (w / 0.62) : POV_NECK_LIFT * (w / 0.38));
      const flightPitch = np * w + osc + lift * w + walkNod * w + pov + SWIM_RIG.neckCurve[i] * swimW;
      // Swimming: the neck undoes the chest's swing so the head keeps to the course.
      const flightYaw = ny * w + 0.02 * Math.sin(this.time * 0.7 - i * 0.4) * grounded - swimRoot * 0.5 * w;
      const gazePitch = GAZE_PITCH[i] + osc * 0.5;
      const gazeYaw = side * (GAZE_YAW[i] + GAZE_PET_YAW[i] * pet) + petSway * (i > 3 ? 1 : 0);
      setEuler(this.neck[i], flightPitch + (gazePitch - flightPitch) * g, flightYaw + (gazeYaw - flightYaw) * g, 0, 'YXZ');
    }
    this.smoothJaw += (THREE.MathUtils.clamp(pose.jawOpen, 0, 1) - this.smoothJaw) * (dt > 0 ? damp(14, dt) : 1);
    const aimTarget = THREE.MathUtils.smoothstep(this.smoothJaw, 0.05, 0.4);
    this.povAim += (aimTarget - this.povAim) * (dt > 0 ? damp(aimTarget > this.povAim ? 9 : 3, dt) : 1);
    // Head stabilization: counter body pitch/heave so the gaze stays steady. In first person the head undoes the
    // neck's net pitch (level, as in third person) and raises its nose unless it is breathing fire.
    const headStab = -bodyPitch * 0.6 - heave * 0.25;
    const povHead = this.povBlend * povKeep * (POV_NECK_DROP - POV_NECK_LIFT + POV_HEAD_RAISE * (1 - this.povAim));
    setEuler(this.head, headStab - groundNeck * 0.25 + povHead - SWIM_RIG.headLevel * Math.max(0, np) * swimW, 0, 0, 'YXZ');
    if (g > 0.001) {
      this.aimHeadAtRider(g, side, pet);
    }
    setEuler(this.jaw, -this.smoothJaw * 0.62, 0, 0, 'YXZ');

    // --- Tail with lagging springs ---
    this.updateTail(pose, dt, amp, psi, walk, wp, grounded, pet, side);

    // --- Wings ---
    for (const side of SIDES) {
      const sgn = sideSign(side);
      computeWingAngles(smoothed, sgn, this.wingAngles);
      this.applyWing(side, this.wingAngles);
    }
    const fold = 1 - THREE.MathUtils.clamp(this.smoothSpread, 0, 1);
    if (fold > 0.001) {
      for (const side of SIDES) {
        this.applyWingFold(side, fold, grounded * Math.max(this.foreGround, this.wingRaise), walk, wp);
      }
    }

    // --- Legs ---
    for (const side of SIDES) {
      this.applyLeg(side, grounded, walk, wp, amp, psi);
    }

    // --- Rider (after the neck: the petting hand follows the neck surface) ---
    this.rider.gazeSide = side;
    this.rider.firstPerson = this.povBlend;
    this.rider.update(pose, dt, this.time, heave);

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

  private updateTail(pose: Readonly<DragonPose>, dt: number, amp: number, psi: number, walk: number, wp: number, grounded: number, pet: number, side: number): void {
    const state = this.skelState;
    const yawRate = state ? state.y : 0;
    const pitchRate = state ? state.x : 0;
    const n = TAIL_BONES;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const baseYaw = THREE.MathUtils.clamp(pose.tailYaw, -1.4, 1.4) / n;
      // Lifting (negative pitch) is carried more by the root, so the tail rises as a whole rather than curling.
      const tailPitch = THREE.MathUtils.clamp(pose.tailPitch, -TAIL_UP_LIMIT, TAIL_DOWN_LIMIT);
      const basePitch = tailPitch < 0 ? (tailPitch * (1.5 - k)) / (n * (1.5 - 0.5)) : tailPitch / n;
      const inertialYaw = -yawRate * 0.045 * (0.3 + k);
      const inertialPitch = pitchRate * 0.035 * (0.3 + k) - _acc.y * 0.0012 * k;
      const wave = amp * 0.05 * Math.sin(psi - 1.3 - i * 0.32) * (0.4 + k);
      const idle = 0.035 * Math.sin(this.time * 0.8 - i * 0.42) * (0.3 + k) * (0.4 + 0.6 * grounded);
      const walkSwing = walk * 0.06 * Math.sin(wp - i * 0.35 - 0.8) * (0.3 + k);
      const lateralAcc = -_acc.x * 0.0015 * k;
      // Swimming: the travelling wave of the stroke down the tail (the main paddle).
      const swimWave = this.swimStroke * (SWIM_RIG.tailYawBase + (SWIM_RIG.tailYawTip - SWIM_RIG.tailYawBase) * k) * Math.sin(this.swimPhase - 1.3 - SWIM_RIG.tailLag * i);
      const droop = grounded * (i < 4 ? -0.03 : 0.012);
      // Contentment while petted: the tail tip curls up and to one side, slowly swaying.
      const tip = THREE.MathUtils.smoothstep(k, 0.45, 1);
      const curlYaw = pet * tip * (0.2 * side + 0.07 * Math.sin(this.time * 0.55 - i * 0.35));
      const curlPitch = -pet * tip * 0.1;
      const ty = baseYaw + inertialYaw + idle + walkSwing + lateralAcc + curlYaw + swimWave;
      const tp = basePitch + inertialPitch + wave + droop + curlPitch + 0.012 * Math.sin(this.time * 0.6 - i * 0.3) * grounded;
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

    // Flight fold (swimming: folded tighter and higher, along the back).
    const sw = this.swimW;
    _up.set((0.35 - 0.1 * sw) * sgn, 1, 0);
    aimBoneUp(bones.humerus, _q, rest.upper, _restUp, _dir.set((0.3 - 0.14 * sw) * sgn, -0.16 + 0.14 * sw, 1), _up, _qa);
    aimBoneUp(bones.forearm, _qa, rest.fore, _restUp, _dir.set((0.07 - 0.04 * sw) * sgn, 0.1 + 0.05 * sw, -1), _up, _qb);
    aimBoneUp(bones.hand, _qb, rest.hand, _restUp, _dir.set((0.06 - 0.03 * sw) * sgn, 0.06 + 0.08 * sw, 1), _up);
    if (grounded > 0.001) {
      _stash[4].copy(bones.humerus.quaternion);
      _stash[5].copy(bones.forearm.quaternion);
      _stash[6].copy(bones.hand.quaternion);
      // Ground stance: IK the wrist onto the ground plane (footfall of the gait), elbow folded back and up beside
      // the flank.
      const fore = this.sweepFor(FORE_SWEEP);
      const lift = FORE_LIFT + GALLOP_LIFT * THREE.MathUtils.clamp(this.gait - 1, 0, 1);
      this.footCycle(wp + Math.PI * 2 * this.footfall[side === 'L' ? 2 : 3], fore.sweep, fore.duty, lift);
      const fz = FORE_Z + this.footOffset * walk;
      _target.set(FORE_X * sgn, this.planeY(FORE_X * sgn, fz) + WRIST_CLEARANCE + this.footLift * walk, fz);
      // Raised wings leaving the ground (the push-off): the wrist rises up and out beside the shoulder, so the arm
      // lifts straight into the opening wing instead of sagging through a folded pose.
      const rise = this.wingRaise * (1 - this.foreGround);
      if (rise > 0.001) {
        _target.lerp(_dir2.copy(shoulder).add(_dir.set(RAISED_WRIST[0] * sgn, RAISED_WRIST[1], RAISED_WRIST[2])), rise);
      }
      _pole.copy(shoulder).add(_dir.set(0.5 * sgn, 0.75, 1.8));
      solveTwoBone(shoulder, _target, rest.l1, rest.l2, _pole, _mid, _end);
      _up.set(sgn, 0.15, 0.1);
      aimBoneUp(bones.humerus, _q, rest.upper, _restUp, _dir.subVectors(_mid, shoulder), _up, _qa);
      aimBoneUp(bones.forearm, _qa, rest.fore, _restUp, _dir.subVectors(_end, _mid), _up, _qb);
      // Z-fold: the hand and first phalanges run back up along the forearm, the outer phalanges fold down and
      // back along the flank (bat / pterosaur quadrupedal stance), so no finger bundle sticks up like a sail.
      // Raised (the crouch before a leap): hand and fingers stand high and back, half spread, ready to open.
      const raise = this.wingRaise;
      _dir.subVectors(_mid, _end).normalize().add(_dir2.set(0.06 * sgn, -0.05, 0.3)).normalize();
      if (raise > 0.001) {
        _dir2.set(0.5 * sgn, 1, 0.4).normalize();
        _dir.lerp(_dir2, raise).normalize();
      }
      aimBoneUp(bones.hand, _qb, rest.hand, _restUp, _dir, _up, _qc);
      for (let f = 0; f < FINGERS.length; f++) {
        _euler.set(0, (FINGERS[f].angle - FAN_MID) * sgn * 0.97 * (1 - 0.55 * raise), 0, 'YZX');
        _q2.copy(_qc).multiply(_q3.setFromEuler(_euler));
        _dir2.set((0.1 + 0.015 * f) * sgn, 0.06 - 0.03 * f, 1).normalize();
        aimBone(bones.fingerB[f], _q2, this.fingerRestB[side][f], _dir2);
        if (raise > 0.001) {
          // Outer phalanges carry on from the first ones instead of folding down.
          bones.fingerB[f].quaternion.slerp(_qa.identity(), raise * 0.85);
        }
      }
      // Thumb points forward along the ground, its claw resting on it ahead of the wrist.
      aimBone(bones.thumb, _qc, this.thumbRest[side], _thumbTarget.set(0.3 * sgn, 0.12 + this.planeNz / this.planeNy, -1));
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
    // Fingers close like a fan (half open while raised).
    const fan = 0.97 * (1 - 0.55 * this.wingRaise * grounded);
    for (let f = 0; f < FINGERS.length; f++) {
      setEuler(bones.fingerA[f], 0, (FINGERS[f].angle - FAN_MID) * sgn * fan, 0, 'YZX');
      blendFrom(bones.fingerA[f], _stash[8 + f], e);
      blendFrom(bones.fingerB[f], _stash[12 + f], e);
    }
  }

  private footOffset = 0;
  private footLift = 0;
  /** 0 in the stance, rising to 1 mid-swing (toe curl). */
  private footSwing = 0;
  /* Ground plane in the rig frame (n · p = -planeD) and gait of the current frame. */
  private planeNx = 0;
  private planeNy = 1;
  private planeNz = 0;
  private planeD = STANDING_ROOT_HEIGHT;
  private gait = 0;
  private stride = DEFAULT_STRIDE;
  private readonly footfall = [0, 0.5, 0.25, 0.75];
  private foreGround = 0;
  private wingRaise = 0;
  private heelLift = 0;
  private legReach = 0;
  private skid = 0;

  /** Height (rig y) of the ground plane at rig (x, z). */
  private planeY(x: number, z: number): number {
    return (-this.planeD - this.planeNx * x - this.planeNz * z) / this.planeNy;
  }

  /**
   * Reads the ground plane and the gait from the pose (defaults: standing plane, walk). The plane comes in world
   * terms and is turned into the rig frame with the rendered transform (the physics state may be a substep ahead).
   */
  private readGround(pose: Readonly<DragonPose>, state: DragonState | undefined): void {
    const groundY = pose.groundY;
    if (state && groundY !== undefined && Number.isFinite(groundY)) {
      const wx = THREE.MathUtils.clamp(pose.groundNx ?? 0, -0.9, 0.9);
      const wz = THREE.MathUtils.clamp(pose.groundNz ?? 0, -0.9, 0.9);
      _invQ.copy(state.quaternion).invert();
      _gn.set(wx, Math.sqrt(Math.max(0.05, 1 - wx * wx - wz * wz)), wz).applyQuaternion(_invQ);
      // A point of the plane (the ground straight below the origin) in the rig frame.
      _gp.set(0, groundY - state.position.y, 0).applyQuaternion(_invQ);
      if (_gn.y < 0.2) {
        _gn.set(0, 1, 0);
      }
      this.planeNx = _gn.x;
      this.planeNy = _gn.y;
      this.planeNz = _gn.z;
      this.planeD = -_gn.dot(_gp);
    } else {
      this.planeNx = 0;
      this.planeNy = 1;
      this.planeNz = 0;
      this.planeD = STANDING_ROOT_HEIGHT;
    }
    this.gait = THREE.MathUtils.clamp(pose.gait ?? 0, 0, 2);
    this.stride = Math.max(0, pose.stride ?? DEFAULT_STRIDE);
    footfallOffsets(this.gait, this.footfall);
    this.foreGround = THREE.MathUtils.clamp(pose.foreGround ?? 1, 0, 1);
    this.wingRaise = THREE.MathUtils.clamp(pose.wingRaise ?? 0, 0, 1);
    this.heelLift = THREE.MathUtils.clamp(pose.heelLift ?? 0, 0, 1);
    this.legReach = THREE.MathUtils.clamp(pose.legReach ?? 0, -1, 1);
    this.skid = THREE.MathUtils.clamp(pose.skid ?? 0, 0, 1);
  }

  /**
   * Foot trajectory for a phase (rad): sets footOffset (m, + = backward), footLift (m) and footSwing. The stance
   * sweeps back by `sweep` in the `duty` share of the cycle; the swing brings the foot forward, lifted by `lift`.
   */
  private footCycle(phase: number, sweep: number, duty: number, lift: number): void {
    const TWO_PI = Math.PI * 2;
    const p = (((phase % TWO_PI) + TWO_PI) % TWO_PI) / TWO_PI;
    if (p < duty) {
      this.footOffset = (p / duty - 0.5) * sweep;
      this.footLift = 0;
      this.footSwing = 0;
      return;
    }
    const t = (p - duty) / (1 - duty);
    const s = t * t * (3 - 2 * t);
    this.footOffset = (0.5 - s) * sweep;
    this.footSwing = Math.sin(t * Math.PI);
    this.footLift = this.footSwing * lift;
  }

  /** Stance sweep (m) and duty factor for a leg whose longest planted sweep is `maxSweep`. */
  private sweepFor(maxSweep: number): { sweep: number; duty: number } {
    const stride = this.stride;
    if (stride < 1e-3) {
      return { sweep: 0, duty: MAX_DUTY };
    }
    const sweep = Math.min(maxSweep, stride * MAX_DUTY);
    return { sweep, duty: sweep / stride };
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
      this.applySwimKick(side);
      return;
    }
    for (let i = 0; i < 4; i++) {
      _stash[4 + i].copy(bones.list[i].quaternion);
    }
    const hind = this.sweepFor(HIND_SWEEP);
    const liftHeight = HIND_LIFT + GALLOP_LIFT * THREE.MathUtils.clamp(this.gait - 1, 0, 1);
    this.footCycle(wp + Math.PI * 2 * this.footfall[side === 'L' ? 0 : 1], hind.sweep, hind.duty, liftHeight);
    // Braking skid: both feet braced forward, planted (the claws dig and slide).
    const skid = this.skid;
    const gaitW = walk * (1 - skid);
    const lift = this.footLift * gaitW;
    const x = HIND_X * sgn;
    const zStance = HIND_Z + this.footOffset * gaitW - SKID_BRACE * skid;
    const groundY = this.planeY(x, zStance) + BALL_CLEARANCE;
    // Clear of the ground (flight with the legs down, the leap after the push) the legs hang a little lower than
    // standing, reaching forward for a touchdown or trailing back after a push-off.
    const hangY = -STANDING_ROOT_HEIGHT + BALL_CLEARANCE - HANG_EXTRA;
    const air = THREE.MathUtils.smoothstep(hangY - groundY, 0, 0.6);
    const reach = this.legReach > 0 ? -REACH_FORWARD * this.legReach : -REACH_BACK * this.legReach;
    rigTransform(this.pelvis, this.rigRoot, _p, _q);
    _hip.copy(bones.thigh.position).applyQuaternion(_q).add(_p);
    _ball.set(x, Math.max(groundY + lift, hangY), zStance + reach * air);
    // Push-off: the heel rises (the metatarsal stands up) and the toes push; a hanging foot points its toes.
    const heel = this.heelLift;
    _dir.set(0, 0.46 + 0.5 * heel, 0.22 - 0.12 * heel).normalize();
    _ankle.copy(_ball).addScaledVector(_dir, rest.metaLen);
    _pole.copy(_hip).add(_dir.set(0.15 * sgn, -0.3, -1.0));
    solveTwoBone(_hip, _ankle, rest.l1, rest.l2, _pole, _knee, _end);
    aimBone(bones.thigh, _q, rest.thigh, _dir.subVectors(_knee, _hip));
    _q2.copy(_q).multiply(bones.thigh.quaternion);
    aimBone(bones.shin, _q2, rest.shin, _dir.subVectors(_end, _knee));
    _q2.multiply(bones.shin.quaternion);
    aimBone(bones.meta, _q2, rest.meta, _dir.subVectors(_ball, _end));
    _q2.multiply(bones.meta.quaternion);
    // Foot: toes flat on the ground plane (rest toes point forward-down); in the swing the toes curl up so the claws
    // clear the ground; hanging feet point their toes a little.
    const planePitch = Math.atan2(this.planeNz, this.planeNy);
    _euler.set(FOOT_STANCE_PITCH + planePitch * (1 - air) + 0.45 * this.footSwing * gaitW - 0.35 * air, 0, 0, 'YXZ');
    _q3.setFromEuler(_euler);
    bones.foot.quaternion.copy(_q2).invert().multiply(_q3);
    const e = grounded * grounded * (3 - 2 * grounded);
    for (let i = 0; i < 4; i++) {
      blendFrom(bones.list[i], _stash[4 + i], e);
    }
    this.applySwimKick(side);
  }

  /**
   * Swimming: the hind legs kick alternately below the body (no ground plane): the thigh swings back in the power
   * stroke and forward in the recovery with the shin flexed and the foot feathered, blended over the leg's pose by the
   * swim weight.
   */
  private applySwimKick(side: Side): void {
    const w = this.swimW;
    if (w < 0.001) {
      return;
    }
    const sgn = sideSign(side);
    const bones = this.legs[side];
    for (let i = 0; i < 4; i++) {
      _stash[4 + i].copy(bones.list[i].quaternion);
    }
    // The left leg kicks back while the tail sweeps right, the right one half a cycle later.
    const ph = this.swimPhase + (side === 'L' ? 0 : Math.PI);
    const kick = Math.sin(ph);
    const recover = 0.5 + 0.5 * Math.cos(ph);
    const amp = SWIM_RIG.thighKickIdle + (SWIM_RIG.thighKick - SWIM_RIG.thighKickIdle) * Math.min(1, this.swimStroke / Math.max(w, 1e-3));
    setEuler(bones.thigh, SWIM_RIG.thigh - amp * kick, 0.05 * sgn, SWIM_RIG.thighOut * sgn, 'YXZ');
    setEuler(bones.shin, SWIM_RIG.shin + SWIM_RIG.shinFlex * recover * (amp / SWIM_RIG.thighKick), 0, 0, 'YXZ');
    setEuler(bones.meta, SWIM_RIG.meta, 0, 0, 'YXZ');
    setEuler(bones.foot, SWIM_RIG.foot + SWIM_RIG.footFeather * recover, 0, 0, 'YXZ');
    for (let i = 0; i < 4; i++) {
      blendFrom(bones.list[i], _stash[4 + i], w);
    }
  }

  /**
   * Turns the head to look at the rider's eyes (blended by g over its flight orientation): turned a little outward so
   * the near eye meets his, upright in the body frame with an affectionate tilt.
   */
  private aimHeadAtRider(g: number, side: number, pet: number): void {
    const last = this.neck[NECK_BONES - 1];
    rigTransform(last, this.rigRoot, _p, _q);
    _gazeHead.copy(this.head.position).applyQuaternion(_q).add(_p);
    _gazeDir.subVectors(this.rider.eye, _gazeHead).normalize();
    _gazeDir.applyAxisAngle(_gazeAxis.set(0, 1, 0), -side * GAZE_EYE_OFFSET);
    // Up: between the body's up and the neck end's own up (less twist at the skull base), then the tilt.
    _gazeUp.set(0, 1, 0).applyQuaternion(_q).lerp(_gazeAxis.set(0, 1, 0), GAZE_UP_BODY).normalize();
    _gazeUp.applyAxisAngle(_gazeDir, side * (GAZE_TILT + GAZE_PET_TILT * pet));
    _qa.copy(this.head.quaternion);
    aimBoneUp(this.head, _q, HEAD_FWD, HEAD_UP, _gazeDir, _gazeUp);
    _qb.copy(this.head.quaternion);
    this.head.quaternion.copy(_qa).slerp(_qb, g);
  }

}
