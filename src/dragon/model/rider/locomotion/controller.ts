/**
 * On-foot locomotion for the human character: movement physics plus the animation blend that shows it.
 *
 * Every clip runs as an action whose time and weight are set here each frame (the mixer only applies them), so the
 * blend is deterministic:
 *  - idle, walk and run (and their crouched versions) share one gait phase, advanced by the distance travelled over
 *    the blended cycle length, so the feet stay locked to the ground at any speed and never skip between clips;
 *  - weights ease toward their targets (no pops when a state changes);
 *  - stopping from a run plays the skid while the body brakes along the clip's own speed curve;
 *  - a jump is a take-off squat, then rising / falling poses blended by the vertical speed, then a landing whose depth
 *    follows the impact;
 *  - on top, the body leans into accelerations and turns, and the head looks where it is going.
 * The character's root is `object` (feet at its origin, facing +Z); the controller moves and turns it.
 */
import * as THREE from 'three';
import type { HumanRider } from '../human';
import { CLIPS, STOP_BRAKE, cycleLength } from './clips';
import { FootIK } from './foot-ik';

export interface LocomotionInput {
  /** Desired horizontal direction and strength (world x, z; length 0..1). */
  move: THREE.Vector2;
  run: boolean;
  crouch: boolean;
  /** Pressed this frame. */
  jump: boolean;
  /** Held: spread the wings and glide (in the air). */
  glide?: boolean;
  /** Gliding: pitch (+1 = nose down, W) and roll (+1 = bank right, D) sticks, a flap stroke (pressed), fold the wings
   * and drop (held). */
  flight?: { pitch: number; roll: number; flap: boolean; fold: boolean };
  /** Standing: turn to face this heading (rad about +Y, 0 = +Z); the feet step round. */
  faceYaw?: number;
  /** Pressed this frame: a trick (running: a forward flip). */
  trick?: boolean;
}

/** `act`: a one-shot on the ground that moves the body by itself (a pivot turn, a slide, a landing roll). */
export type LocoState = 'ground' | 'stop' | 'takeoff' | 'air' | 'glide' | 'land' | 'act';

/** Tunables (SI units). */
export const LOCO = {
  walkSpeed: 1.45,
  runSpeed: 5.8,
  crouchSpeed: 1.0,
  /** Horizontal acceleration toward the wanted velocity (m/s²), and braking when letting go. */
  accel: 9,
  decel: 11,
  airAccel: 2.5,
  /** Turning rate of the body toward its travel (rad/s) at a walk, and at a run (wider arcs). */
  turnWalk: 9,
  turnRun: 5.5,
  /** Take-off speed (m/s) and gravity (m/s²; a little above g so jumps feel crisp, not floaty). */
  jumpSpeed: 5.0,
  gravity: 12.5,
  /** A stop plays the skid from above this speed; the full skid (run_stop) from above stopFull, the quick one below. */
  stopMin: 3.4,
  stopFull: 5.3,
  /** Take-off speeds (m/s) of a running jump and a flip. */
  runJumpSpeed: 4.4,
  flipSpeed: 4.2,
  /** Captured moves: pivot on the spot when the wanted heading is this far off (rad) and the body is slower than
   * pivotMaxSpeed; turn round in the run when the wanted direction points back (cos below runTurnDot) above runTurnMin;
   * slide from above slideMin; a landing turns into a roll above rollMin with at least this depth. */
  pivotAngle: 1.0,
  pivotMaxSpeed: 0.6,
  runTurnDot: -0.6,
  runTurnMin: 3.5,
  slideMin: 4.0,
  rollMin: 3.5,
  rollDepth: 0.6,
  /** A fall (not our own jump) turns into flailing after this long, faster than this (m/s down). */
  flailAfter: 1.1,
  flailSpeed: 8,
  /** Crouch in / out time (s). */
  crouchTime: 0.22,
  /** Weight easing rate (1/s) and the faster one for landing and take-off. */
  blendRate: 9,
  blendRateFast: 18,
  /** Lean into acceleration (rad per m/s²) and into turns (rad per m/s² of centripetal acceleration). */
  leanAccel: 0.022,
  leanTurn: 0.045,
  leanMax: 0.32,
  /** Gliding: airspeed it settles at (m/s), sink rate (m/s), turn rate (rad/s), body pitch into the flight line (rad),
   * bank per rad/s of turning, how fast the wings unfurl (spring Hz). */
  glideSpeed: 12,
  glideSink: 1.7,
  glideTurn: 1.1,
  glidePitch: 1.2,
  glideBank: 0.45,
  wingHz: 2.6,
  /** Flight model: the trim glide angle (rad, nose down), how far the stick moves it (dive, climb), the speed held at
   * trim (m/s), the stall speed, the most bank (rad), flap strokes (count, recovery per s, speed and path kick, time). */
  glideTrim: -0.14,
  glideDive: 0.5,
  glideClimb: 0.42,
  glideTrimSpeed: 13,
  glideStall: 8,
  glideMaxBank: 0.8,
  flapStrokes: 4,
  flapRegen: 0.35,
  flapSpeed: 2.4,
  flapLift: 0.14,
  flapTime: 0.7,
};

const GAIT = ['idle', 'walk', 'jog', 'run', 'crouch_idle', 'crouch_walk'] as const;
const ONE_SHOT = ['run_stop', 'jump_start', 'jump_land'] as const;
const AIR = ['jump_rise', 'jump_fall'] as const;

/** Turns on the move (captured one way only; the other side steers as usual). */
const MOVING_TURNS = ['walk_turn_left', 'run_turn_right'];

/** A curve of even steps over 0..1, linearly interpolated. */
function curveAt(c: number[], u: number): number {
  const x = THREE.MathUtils.clamp(u, 0, 1) * (c.length - 1);
  const i = Math.min(c.length - 2, Math.floor(x));
  return THREE.MathUtils.lerp(c[i], c[i + 1], x - i);
}

const smoothstep = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;
const _v = new THREE.Vector2();
const _want = new THREE.Vector2();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

export class LocomotionController {
  readonly velocity = new THREE.Vector2(); // world x, z
  vy = 0;
  yaw = 0;
  state: LocoState = 'ground';
  crouch = 0;
  /** Procedural layers (lean, look) on top of the clips. */
  layers = true;
  private stateTime = 0;
  private phase = 0;
  private idleTime = 0;
  private crouchIdleTime = 0;
  private landDepth = 1;
  private stopSpeed = 0;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly weights = new Map<string, number>();
  private readonly target = new Map<string, number>();
  private readonly lean = new THREE.Vector2(); // x = forward (+), y = side (+ = to the character's right)
  private prevVel = new THREE.Vector2();
  private prevYaw = 0;
  private readonly spine: THREE.Bone[] = [];
  private readonly hips?: THREE.Bone;
  private readonly neck?: THREE.Bone;
  private readonly head?: THREE.Bone;
  private look = 0;
  /** The layered bones' rotations as the clips left them: restored before each mixer update (the mixer only writes
   * values that changed, so a layer would otherwise compound). */
  private readonly layered: [THREE.Bone, THREE.Quaternion][] = [];
  private readonly hipsPos = new THREE.Vector3();
  private readonly footIK: FootIK;
  /** Glide: body pitch and bank (rad), wing spread spring (value, velocity). */
  private pitch = 0;
  private bank = 0;
  private wing = 0;
  private wingVel = 0;
  /** Flight: airspeed (m/s), path angle (rad, + climbing), bank (uses `bank`), flap stock and the stroke clock. */
  airspeed = 0;
  private path = 0;
  flapStock = LOCO.flapStrokes;
  private flapT = -1;
  /** Standing still: time so far, the idle variation playing (if any) and its time, when the next one comes. */
  private still = 0;
  private variant: string | null = null;
  private variantTime = 0;
  private nextVariant = 7;
  private variantIndex = 0;
  /** Turning on the spot (rad/s, smoothed): drives stepping feet. */
  private spin = 0;
  /** In the air after our own take-off (not a fall or a leap off the dragon): the take-off clip plays on. */
  private launched = false;
  /** The take-off clip of this jump (jump_start, run_jump, run_flip) and the take-off speed it left with. */
  private jumpClip = 'jump_start';
  private jumpVy = LOCO.jumpSpeed;
  /** The skid clip of this stop and how long it brakes (s). */
  private stopClip = 'run_stop';
  private stopBrake = STOP_BRAKE;
  /** The current `act`: its clip, heading at the start and the scale of the clip's own turn, the speed it entered
   * with and the exponent of its braking curve (speed = v0·(1 - t/T)^p, matched to the clip's travel), or (curve > 0)
   * the clip's own speed curve times `curve`; the heading asked for. */
  private act = { clip: '', yaw0: 0, turnScale: 0, v0: 0, p: 1, exit: 0.85, ik: false, t0: 0, curve: 0, want: 0 };
  private prevCrouchIn = false;
  private landClipName = 'jump_land';

  constructor(
    private readonly human: HumanRider,
    private readonly object: THREE.Object3D,
    private readonly groundHeight: (x: number, z: number) => number = () => 0,
  ) {
    for (const name of Object.keys(CLIPS)) {
      const clip = human.clips.get(name);
      if (!clip) {
        continue;
      }
      const a = human.mixer.clipAction(clip);
      a.play();
      a.timeScale = 0;
      a.setEffectiveWeight(0);
      this.actions.set(name, a);
      this.weights.set(name, 0);
    }
    this.weights.set('idle', 1);
    for (const n of ['Spine', 'Spine1', 'Spine2']) {
      const b = human.bones.get(n);
      if (b) {
        this.spine.push(b);
      }
    }
    this.hips = human.bones.get('Hips');
    this.neck = human.bones.get('Neck');
    this.head = human.bones.get('Head');
    for (const b of [...this.spine, this.neck, this.head]) {
      if (b) {
        this.layered.push([b, b.quaternion.clone()]);
      }
    }
    // Feet on the ground: the legs and the pelvis are layered too.
    for (const s of ['Left', 'Right']) {
      for (const n of ['UpLeg', 'Leg', 'Foot']) {
        const b = human.bones.get(s + n);
        if (b) {
          this.layered.push([b, b.quaternion.clone()]);
        }
      }
    }
    this.footIK = new FootIK(human);
    if (this.hips) {
      this.hipsPos.copy(this.hips.position);
    }
    this.yaw = object.rotation.y;
    this.prevYaw = this.yaw;
  }

  get speed(): number {
    return this.velocity.length();
  }

  update(dt: number, input: LocomotionInput): void {
    dt = Math.min(dt, 1 / 20);
    this.stateTime += dt;
    const grounded = this.state !== 'air' && this.state !== 'takeoff' && this.state !== 'glide';
    const crouchPressed = input.crouch && !this.prevCrouchIn;
    this.prevCrouchIn = input.crouch;
    // --- crouch ---
    const wantCrouch = input.crouch && grounded && !input.run && this.state !== 'act' ? 1 : 0;
    this.crouch += clamp(wantCrouch - this.crouch, -dt / LOCO.crouchTime, dt / LOCO.crouchTime);
    // --- horizontal movement ---
    const m = Math.min(1, input.move.length());
    const top = THREE.MathUtils.lerp(input.run ? LOCO.runSpeed : LOCO.walkSpeed, LOCO.crouchSpeed, this.crouch);
    _want.copy(input.move).normalize().multiplyScalar(m * top);
    if (m < 1e-3) {
      _want.set(0, 0);
    }
    // --- captured one-shots started from the ground ---
    if (this.state === 'ground') {
      this.startAct(input, m, crouchPressed);
    }
    if (this.state === 'act') {
      this.acting(dt, m);
    } else if (this.state === 'stop') {
      // The skid: speed follows the clip (1 - t/T)², in the direction of travel.
      const u = Math.min(1, this.stateTime / this.stopBrake);
      const s = this.stopSpeed * (1 - u) * (1 - u);
      if (this.velocity.lengthSq() > 1e-6) {
        this.velocity.setLength(s);
      }
      if (this.stateTime >= CLIPS[this.stopClip].duration * 0.8 || m > 0.2) {
        this.enter('ground');
      }
    } else if (this.state === 'glide') {
      this.fly(dt, input);
    } else if (this.state === 'land' || (this.state === 'takeoff' && this.jumpClip === 'jump_start')) {
      // Planted: little steering, the landing absorbs (a running take-off keeps its speed).
      this.approach(_want, (this.state === 'land' ? 0.5 : 0.2) * LOCO.decel, dt);
    } else if (this.state === 'takeoff') {
      // Running take-off: carried on.
    } else {
      const rate = !grounded ? LOCO.airAccel : _want.lengthSq() > this.velocity.lengthSq() ? LOCO.accel : LOCO.decel;
      this.approach(_want, rate, dt);
    }
    // --- the stop ---
    if (this.state === 'ground' && m < 0.05 && this.prevVel.length() > LOCO.stopMin && this.crouch < 0.3) {
      this.stopSpeed = this.prevVel.length();
      // A full run skids long; slower, the quick stop (when captured).
      this.stopClip = this.stopSpeed < LOCO.stopFull && this.actions.has('run_stop_quick') ? 'run_stop_quick' : 'run_stop';
      // Brake time so the (1 - t/T)² slide covers the clip's own travel from this speed (procedural: STOP_BRAKE).
      const travel = CLIPS[this.stopClip].measured?.travel;
      this.stopBrake = travel ? clamp((3 * travel) / this.stopSpeed, 0.3, CLIPS[this.stopClip].duration) : STOP_BRAKE;
      this.enter('stop');
    }
    // --- facing: turn toward the travel ---
    const sp = this.speed;
    if (this.state === 'ground' && sp <= 0.15 && input.faceYaw !== undefined) {
      // Turning on the spot toward a heading: at most 3 rad/s, eased.
      let d = input.faceYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = clamp(d * 4, -3, 3) * dt;
      this.yaw += turn;
    }
    if (this.state === 'glide') {
      // Turning comes from the bank (fly()).
    } else if (this.state === 'act') {
      // Heading from the clip's turn (acting()).
    } else if (sp > 0.15 && this.state !== 'stop') {
      const want = Math.atan2(this.velocity.x, this.velocity.y);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const rate = THREE.MathUtils.lerp(LOCO.turnWalk, LOCO.turnRun, smoothstep(sp, LOCO.walkSpeed, LOCO.runSpeed));
      this.yaw += clamp(d, -rate * dt, rate * dt);
    }
    // --- vertical ---
    const pos = this.object.position;
    const ground = this.groundHeight(pos.x, pos.z);
    if (this.state === 'ground' || this.state === 'stop' || this.state === 'land') {
      // Standing, a jump; running, the running jump; the trick key running, a flip (when captured).
      const flip = !!input.trick && sp > 3 && this.actions.has('run_flip');
      if (input.jump || flip) {
        this.jumpClip = flip ? 'run_flip' : sp > 3 && this.actions.has('run_jump') ? 'run_jump' : 'jump_start';
        this.jumpVy = flip ? LOCO.flipSpeed : this.jumpClip === 'run_jump' ? LOCO.runJumpSpeed : LOCO.jumpSpeed;
        this.enter('takeoff');
      }
    }
    const jc = CLIPS[this.jumpClip];
    if (this.state === 'takeoff' && this.stateTime >= (jc.takeoff ?? jc.duration)) {
      this.vy = this.jumpVy;
      this.enter('air');
      this.launched = true;
    }
    if (this.state === 'air' && input.glide && this.vy < 2 && this.human.wings.present) {
      // Wings open: the flight starts from the fall's own speed and angle.
      const h = this.velocity.length();
      this.airspeed = Math.max(LOCO.glideStall - 1, Math.hypot(h, this.vy));
      this.path = Math.atan2(this.vy, Math.max(h, 1));
      this.enter('glide');
    } else if (this.state === 'glide' && input.flight?.fold) {
      this.enter('air');
    }
    if (this.state === 'glide') {
      pos.y += this.vy * dt;
      if (pos.y <= ground) {
        pos.y = ground;
        // Touch-down: the fall rate sets the landing's depth; the speed runs on (the controller slows it).
        this.landDepth = clamp((-this.vy - 1.0) / 4 + 0.35, 0.3, 1);
        this.landClipName = this.landDepth > 0.75 && this.actions.has('jump_land_hard') ? 'jump_land_hard' : 'jump_land';
        this.vy = 0;
        this.velocity.multiplyScalar(0.55);
        this.enter('land');
      }
    } else if (this.state === 'air') {
      this.vy -= LOCO.gravity * dt;
      pos.y += this.vy * dt;
      if (pos.y <= ground && this.vy < 0) {
        pos.y = ground;
        // Landing depth from the impact speed: a hop barely dips, a fall from height crouches deep.
        const impact = -this.vy;
        this.landDepth = clamp((impact - 1.5) / 6, 0.25, 1);
        this.vy = 0;
        // Coming down fast while running: roll it out (when captured); else the landing for the impact.
        if (this.speed > LOCO.rollMin && this.landDepth >= LOCO.rollDepth && this.actions.has('run_roll')) {
          this.beginAct('run_roll', 0);
        } else {
          this.landClipName = this.landDepth >= 1 && impact > 13 && this.actions.has('jump_land_heavy') ? 'jump_land_heavy' : this.landDepth > 0.75 && this.actions.has('jump_land_hard') ? 'jump_land_hard' : 'jump_land';
          this.enter('land');
        }
      }
    } else {
      pos.y = ground;
      const land = this.landClip();
      const landLeft = CLIPS[land].duration - (CLIPS[land].contact ?? 0);
      if (this.state === 'land' && this.stateTime >= landLeft * (0.55 + 0.45 * this.landDepth)) {
        this.enter('ground');
      }
    }
    pos.x += this.velocity.x * dt;
    pos.z += this.velocity.y * dt;
    // Body pitched into the flight line and banked while gliding, upright otherwise (fast on landing).
    const gl = this.state === 'glide';
    const pk = 1 - Math.exp(-(gl ? 4 : this.state === 'land' ? 14 : 5) * dt);
    // Gliding the body lies along the flight path (head down in a dive, raised in a climb).
    this.pitch += ((gl ? LOCO.glidePitch - this.path * 0.9 : 0) - this.pitch) * pk;
    if (!gl) {
      this.bank += (0 - this.bank) * pk;
    }
    this.object.rotation.set(this.pitch, this.yaw, this.bank, 'YXZ');
    // Wings: a spring toward spread (gliding) or stowed; overshoots a little as they snap open.
    const w0 = 2 * Math.PI * LOCO.wingHz;
    const wantWing = gl ? 1 : 0;
    this.wingVel += ((wantWing - this.wing) * w0 * w0 - 2 * 0.45 * w0 * this.wingVel) * dt;
    this.wing = clamp(this.wing + this.wingVel * dt, 0, 1.12);
    this.animate(dt, sp);
    this.prevVel.copy(this.velocity);
    this.prevYaw = this.yaw;
  }

  /**
   * Gliding flight. Along the path, gravity trades height for speed and drag bleeds it (so at the trim angle the speed
   * settles at glideTrimSpeed); the pitch stick moves the path angle (W dives, S climbs; below the stall speed the nose
   * drops by itself); the roll stick banks and the bank turns (rate g·tan(bank)/V); a flap stroke adds speed and lifts
   * the path, a few in a row, recovering with time.
   */
  private fly(dt: number, input: LocomotionInput): void {
    const f = input.flight ?? { pitch: 0, roll: 0, flap: false, fold: false };
    const g = LOCO.gravity * 0.8;
    const drag = (g * Math.sin(-LOCO.glideTrim)) / (LOCO.glideTrimSpeed * LOCO.glideTrimSpeed);
    let target = LOCO.glideTrim - f.pitch * (f.pitch > 0 ? LOCO.glideDive : LOCO.glideClimb);
    const stall = clamp((LOCO.glideStall - this.airspeed) / 3, 0, 1);
    target = THREE.MathUtils.lerp(target, -0.55, stall);
    this.path += (target - this.path) * (1 - Math.exp(-1.6 * dt));
    // Bank and turn.
    const wantBank = clamp(f.roll, -1, 1) * LOCO.glideMaxBank;
    this.bank += (-wantBank - this.bank) * (1 - Math.exp(-3 * dt));
    this.yaw += ((g * Math.tan(this.bank)) / Math.max(this.airspeed, 4)) * dt;
    // Speed: gravity along the path, drag (more in a bank).
    const bankDrag = 1 + 0.6 * this.bank * this.bank;
    this.airspeed += (-g * Math.sin(this.path) - drag * bankDrag * this.airspeed * this.airspeed) * dt;
    this.airspeed = Math.max(this.airspeed, 3);
    // Flap strokes.
    this.flapStock = Math.min(LOCO.flapStrokes, this.flapStock + LOCO.flapRegen * dt);
    if (f.flap && this.flapT < 0 && this.flapStock >= 1) {
      this.flapStock -= 1;
      this.flapT = 0;
    }
    if (this.flapT >= 0) {
      const u = this.flapT / LOCO.flapTime;
      // The push is in the down-stroke (the first third).
      const push = u < 0.35 ? Math.sin((u / 0.35) * Math.PI) : 0;
      this.airspeed += push * LOCO.flapSpeed * 4.5 * dt;
      this.path += push * LOCO.flapLift * 4.5 * dt;
      this.flapT += dt;
      if (this.flapT >= LOCO.flapTime) {
        this.flapT = -1;
      }
    }
    const h = this.airspeed * Math.cos(this.path);
    this.velocity.set(Math.sin(this.yaw) * h, Math.cos(this.yaw) * h);
    this.vy = this.airspeed * Math.sin(this.path);
  }

  /** The wings' flap angle now (rad, + = down-stroke): a quick down-stroke, a slower recovery, a small rest wave. */
  private flapAngle(): number {
    if (this.flapT < 0) {
      // Holding the glide: the canvas breathes with the air.
      return 0.03 * Math.sin(this.stateTime * 5.3) - 0.02;
    }
    const u = this.flapT / LOCO.flapTime;
    if (u < 0.35) {
      const k = u / 0.35;
      return THREE.MathUtils.lerp(-0.35, 0.6, k * k * (3 - 2 * k));
    }
    const k = (u - 0.35) / 0.65;
    return THREE.MathUtils.lerp(0.6, -0.02, k * k * (3 - 2 * k)) - 0.3 * Math.sin(Math.PI * k);
  }

  /**
   * Starts a captured one-shot from the ground when the input asks for it: a slide (crouch pressed while running), a
   * turn round in the run (the wanted direction points back), a pivot on the spot (the wanted heading far off while
   * slow; the wary turn when walking, the brisk one when running).
   */
  private startAct(input: LocomotionInput, m: number, crouchPressed: boolean): void {
    const sp = this.speed;
    if (crouchPressed && sp > LOCO.slideMin && this.actions.has('run_slide')) {
      this.beginAct('run_slide', 0);
      return;
    }
    if (m < 0.5) {
      return;
    }
    const want = Math.atan2(input.move.x, input.move.y);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.act.want = want;
    // Crouched, standing up to go the other way: rises turning (it turns to the left, the long way round for a sharp
    // right).
    if (this.crouch > 0.25 && !input.crouch && sp < 0.3 && this.actions.has('crouch_to_stand') && (d > 1.2 || Math.abs(d) > 2.4)) {
      this.crouch = 0;
      this.beginAct('crouch_to_stand', d);
      return;
    }
    // Sharp turns on the move: walking to the left, running to the right (the captured ones; the other sides steer).
    if (!input.run && this.crouch < 0.1 && sp > 1.0 && sp < 2.6 && d > 0.45 && d < 1.2 && this.actions.has('walk_turn_left')) {
      this.beginAct('walk_turn_left', d);
      return;
    }
    if (sp > 4.0 && d < -0.45 && d > -1.2 && this.actions.has('run_turn_right')) {
      this.beginAct('run_turn_right', d);
      return;
    }
    // Setting off from standing a while, ahead: the first steps.
    if (!input.run && this.crouch < 0.1 && sp < 0.1 && this.still > 0.5 && Math.abs(d) < LOCO.pivotAngle && this.actions.has('walk_start')) {
      this.beginAct('walk_start', 0);
      return;
    }
    if (sp > LOCO.runTurnMin && Math.cos(d) < LOCO.runTurnDot && this.actions.has('run_turn_180')) {
      this.beginAct('run_turn_180', d);
      return;
    }
    if (sp > LOCO.pivotMaxSpeed || Math.abs(d) < LOCO.pivotAngle) {
      return;
    }
    let clip: string;
    if (Math.abs(d) > 2.4) {
      clip = input.run ? 'run_turn_180' : 'walk_turn_180';
    } else {
      const side = d > 0 ? 'left' : 'right';
      clip = input.run ? `turn_${side}` : `turn_${side}_wary`;
      if (!this.actions.has(clip)) {
        clip = `turn_${side}`;
      }
    }
    if (this.actions.has(clip) && CLIPS[clip].turn) {
      this.beginAct(clip, d);
    }
  }

  /** Enters `act` with this clip; `turnBy` the heading change wanted (rad; the clip's own turn is scaled to it). */
  private beginAct(clip: string, turnBy: number): void {
    const c = CLIPS[clip];
    const a = this.act;
    a.clip = clip;
    a.yaw0 = this.yaw;
    a.turnScale = 0;
    if (c.turn) {
      // Turn the way the clip turns: a half turn the other way round becomes the long way (at most ~1.25×).
      let d = turnBy;
      if (Math.sign(d) !== Math.sign(c.turn) && Math.abs(d) > 2.4) {
        d -= Math.sign(d) * 2 * Math.PI;
      }
      a.turnScale = Math.sign(d) === Math.sign(c.turn) ? clamp(d / c.turn, 0.6, MOVING_TURNS.includes(clip) ? 1.8 : 1.3) : 1;
    }
    a.v0 = this.speed;
    a.t0 = c.start ?? 0;
    const travel = c.measured?.travel ?? 0;
    const T = c.duration - a.t0;
    // speed = v0·(1 - u)^p covers v0·T/(p + 1): p so the distance matches the clip's travel (its share after t0).
    a.p = travel > 0.2 && a.v0 > 0.1 ? clamp((a.v0 * T) / (travel * (T / c.duration)) - 1, 0, 6) : 6;
    a.exit = clip.includes('turn') ? 0.8 : 0.88;
    // Moving on the clip's own speed curve: the first steps as they are, a turn on the move scaled to the speed it
    // entered with.
    a.curve = 0;
    if (c.speed_curve && (clip === 'walk_start' || MOVING_TURNS.includes(clip))) {
      a.curve = clip === 'walk_start' ? 1 : clamp(a.v0 / Math.max(0.3, curveAt(c.speed_curve, 0)), 0.6, 1.6);
    }
    // The feet stay on uneven ground in a pivot; a slide or roll rides the body.
    a.ik = clip.includes('turn');
    this.enter('act');
  }

  /** Runs the current `act`: heading from the clip's turn curve, speed along the heading on the braking curve. */
  private acting(dt: number, m: number): void {
    const a = this.act;
    const c = CLIPS[a.clip];
    const u = Math.min(1, this.stateTime / (c.duration - a.t0));
    if (c.turn_curve && a.turnScale) {
      this.yaw = a.yaw0 + curveAt(c.turn_curve, (a.t0 + this.stateTime) / c.duration) * a.turnScale;
    }
    const clipU = (a.t0 + this.stateTime) / c.duration;
    const s = a.curve > 0 && c.speed_curve ? curveAt(c.speed_curve, clipU) * a.curve : a.v0 * Math.pow(1 - u, a.p);
    this.velocity.set(Math.sin(this.yaw) * s, Math.cos(this.yaw) * s);
    let d = a.want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const onTheMove = a.clip === 'walk_start' || MOVING_TURNS.includes(a.clip);
    // Ends near the clip's end (blending into the gait); a slide or roll can be broken off late by moving. On the move:
    // letting go ends it, a turn once it faces the way asked, the first steps once up to a walk.
    if (
      u >= a.exit ||
      (u > 0.6 && m > 0.2 && !c.turn && !onTheMove) ||
      (onTheMove && m < 0.2) ||
      (MOVING_TURNS.includes(a.clip) && u > 0.45 && Math.abs(d) < 0.2) ||
      (a.clip === 'walk_start' && u > 0.25 && s > 0.85)
    ) {
      this.enter('ground');
    }
    void dt;
  }

  /** Leaves the ground (or the saddle) with this velocity (world, m/s): into the air, e.g. to glide. */
  launch(velocity: THREE.Vector3, yaw = this.yaw): void {
    this.velocity.set(velocity.x, velocity.z);
    this.vy = velocity.y;
    this.yaw = yaw;
    this.prevYaw = yaw;
    this.enter('air');
  }

  private approach(want: THREE.Vector2, rate: number, dt: number): void {
    _v.subVectors(want, this.velocity);
    const len = _v.length();
    const step = rate * dt;
    if (len <= step) {
      this.velocity.copy(want);
    } else {
      this.velocity.addScaledVector(_v, step / len);
    }
  }

  private enter(s: LocoState): void {
    if (s === 'air' || s === 'glide') {
      this.launched = false;
    }
    this.state = s;
    this.stateTime = 0;
  }

  private animate(dt: number, sp: number): void {
    const t = this.target;
    for (const k of this.actions.keys()) {
      t.set(k, 0);
    }
    // Gait weights by speed: idle → walk over the first 0.4 m/s, walk → run from 2.2 to 4.4 m/s.
    const walkIn = smoothstep(sp, 0.05, 0.45);
    const runIn = smoothstep(sp, 2.2, 4.4);
    const stand = 1 - this.crouch;
    // With a captured jog, the fast gait is jog up to its own speed, then the run.
    const hasJog = this.actions.has('jog');
    const sprint = hasJog ? smoothstep(sp, CLIPS.jog.speed * 0.95, Math.max(CLIPS.jog.speed + 0.3, Math.min(CLIPS.run.speed, LOCO.runSpeed))) : 1;
    const fastGait = walkIn * runIn * stand;
    const gait = { idle: (1 - walkIn) * stand, walk: walkIn * (1 - runIn) * stand, jog: fastGait * (1 - sprint), run: fastGait * sprint, crouch_idle: (1 - walkIn) * this.crouch, crouch_walk: walkIn * this.crouch };
    // The shared phase advances by distance over the blended cycle length.
    // Turning on the spot: the feet step round (the walk, a little, its phase driven by the turn).
    let dyawStep = this.yaw - this.prevYaw;
    dyawStep = Math.atan2(Math.sin(dyawStep), Math.cos(dyawStep));
    this.spin += (Math.abs(dyawStep) / Math.max(dt, 1e-4) - this.spin) * (1 - Math.exp(-10 * dt));
    const stepIn = this.state === 'ground' && sp < 0.3 ? smoothstep(this.spin, 0.4, 1.6) * 0.7 : 0;
    if (stepIn > 1e-3) {
      gait.walk += gait.idle * stepIn;
      gait.idle *= 1 - stepIn;
      this.phase = (this.phase + (this.spin * 0.28 * dt) / cycleLength('walk')) % 1;
    }
    const moving = gait.walk + gait.jog + gait.run + gait.crouch_walk;
    if (moving > 1e-3 && stepIn < 1e-3) {
      const len = (gait.walk * cycleLength('walk') + (hasJog ? gait.jog * cycleLength('jog') : 0) + gait.run * cycleLength('run') + gait.crouch_walk * cycleLength('crouch_walk')) / moving;
      this.phase = (this.phase + (sp * dt) / len) % 1;
    }
    this.idleTime = (this.idleTime + dt) % CLIPS.idle.duration;
    this.crouchIdleTime = (this.crouchIdleTime + dt) % CLIPS.crouch_idle.duration;
    let gaitShare = 1;
    let fast = false;
    switch (this.state) {
      case 'stop': {
        const dur = CLIPS[this.stopClip].duration;
        const k = 1 - smoothstep(this.stateTime, dur * 0.6, dur * 0.8);
        t.set(this.stopClip, k);
        gaitShare = 1 - k;
        this.setTime(this.stopClip, this.stateTime);
        break;
      }
      case 'act': {
        const c = CLIPS[this.act.clip];
        const T = c.duration - this.act.t0;
        const k = 1 - smoothstep(this.stateTime, T * (this.act.exit - 0.12), T * this.act.exit);
        t.set(this.act.clip, k);
        gaitShare = 1 - k;
        fast = true;
        this.setTime(this.act.clip, this.act.t0 + this.stateTime);
        break;
      }
      case 'takeoff':
        t.set(this.jumpClip, 1);
        gaitShare = 0;
        fast = true;
        this.setTime(this.jumpClip, this.stateTime);
        break;
      case 'glide':
        t.set('glide', 1);
        gaitShare = 0;
        this.setTime('glide', this.stateTime % CLIPS.glide.duration);
        break;
      case 'air': {
        let fall = smoothstep(-this.vy, -1.5, 2.5);
        const jc = CLIPS[this.jumpClip];
        const takeoff = jc.takeoff;
        if (takeoff !== undefined && this.launched) {
          // A captured jump: the take-off clip plays its flight over ours (its own flight time stretched to the
          // physics' 2·vy/g), then the fall loop takes over if we are still up.
          const air = jc.air ?? 0.4;
          const clipT = takeoff + (this.stateTime * air) / Math.max(0.2, (2 * this.jumpVy) / LOCO.gravity);
          fall *= smoothstep(clipT, takeoff + air * 0.85, takeoff + air * 1.15);
          t.set(this.jumpClip, 1 - fall);
          this.setTime(this.jumpClip, clipT);
        } else {
          t.set('jump_rise', 1 - fall);
          this.setTime('jump_rise', this.stateTime % CLIPS.jump_rise.duration);
        }
        // A long fall that is not our own jump (off a roof, off the dragon without the wings): arms and legs flail.
        const flail = !this.launched && this.actions.has('fall_flail') ? smoothstep(this.stateTime, LOCO.flailAfter, LOCO.flailAfter + 0.6) * smoothstep(-this.vy, LOCO.flailSpeed - 2, LOCO.flailSpeed) : 0;
        t.set('jump_fall', fall * (1 - flail));
        t.set('fall_flail', fall * flail);
        gaitShare = 0;
        this.setTime('jump_fall', this.stateTime % CLIPS.jump_fall.duration);
        if (flail > 0) {
          this.setTime('fall_flail', this.stateTime % CLIPS.fall_flail.duration);
        }
        break;
      }
      case 'land': {
        // Deep landings play the whole absorb; a running landing runs on after the first dip.
        const runOn = smoothstep(sp, 1.5, 4.0);
        const k = this.landDepth * (1 - 0.6 * runOn);
        const land = this.landClip();
        t.set(land, k);
        gaitShare = 1 - k;
        fast = true;
        this.setTime(land, (CLIPS[land].contact ?? 0) + this.stateTime);
        break;
      }
      default:
        break;
    }
    // Idle variations: standing still a while, one plays (looking around, a shoulder roll), then idle again.
    const standing = this.state === 'ground' && sp < 0.05 && this.crouch < 0.1 && stepIn < 0.05;
    this.still = standing ? this.still + dt : 0;
    if (!standing) {
      this.variant = null;
    } else if (!this.variant && this.still > this.nextVariant) {
      const names = ['idle_look', 'idle_warrior', 'idle_look_2', 'idle_shoulders'].filter((n) => this.actions.has(n));
      if (names.length) {
        this.variant = names[this.variantIndex++ % names.length];
        this.variantTime = 0;
      }
    }
    if (this.variant) {
      this.variantTime += dt;
      const dur = CLIPS[this.variant].duration;
      const k = smoothstep(this.variantTime, 0, 0.45) * (1 - smoothstep(this.variantTime, dur - 0.6, dur));
      t.set(this.variant, k * gaitShare);
      this.setTime(this.variant, this.variantTime);
      gait.idle *= 1 - k;
      if (this.variantTime >= dur) {
        this.variant = null;
        this.still = 0;
        this.nextVariant = 8 + ((this.variantIndex * 5.3) % 7);
      }
    }
    for (const [k, w] of Object.entries(gait)) {
      t.set(k, w * gaitShare);
    }
    for (const n of GAIT) {
      if (n === 'idle') {
        this.setTime(n, this.idleTime);
      } else if (n === 'crouch_idle') {
        this.setTime(n, this.crouchIdleTime);
      } else {
        this.setTime(n, this.phase * CLIPS[n].duration);
      }
    }
    // Ease the weights, then normalise so they always sum to 1.
    const rate = fast ? LOCO.blendRateFast : LOCO.blendRate;
    const k = 1 - Math.exp(-rate * dt);
    let sum = 0;
    for (const [n, w] of this.weights) {
      const nw = w + ((t.get(n) ?? 0) - w) * k;
      this.weights.set(n, nw);
      sum += nw;
    }
    for (const [n, a] of this.actions) {
      a.setEffectiveWeight(sum > 1e-6 ? (this.weights.get(n) ?? 0) / sum : n === 'idle' ? 1 : 0);
    }
    for (const [bone, q] of this.layered) {
      bone.quaternion.copy(q);
    }
    this.hips?.position.copy(this.hipsPos);
    this.human.mixer.update(0);
    if (this.hips) {
      this.hipsPos.copy(this.hips.position);
    }
    // After the mixer (the clips key every bone's scale at 1).
    const wings = this.human.wings;
    wings.amount = this.wing;
    wings.flap = this.state === 'glide' ? this.flapAngle() : 0;
    wings.grip = this.state === 'glide' ? 1 : smoothstep(this.wing, 0.3, 1);
    wings.tuck = 0.25;
    wings.apply();
    for (const [bone, q] of this.layered) {
      q.copy(bone.quaternion);
    }
    if (this.layers) {
      this.leanLayer(dt, sp);
      // Feet on uneven ground while standing on it; eased out in the air, gliding, taking off.
      const onGround = this.state === 'ground' || this.state === 'stop' || this.state === 'land' || (this.state === 'act' && this.act.ik);
      this.footIK.weight += ((onGround ? 1 : 0) - this.footIK.weight) * (1 - Math.exp(-10 * dt));
      if (this.footIK.weight > 1e-3) {
        this.footIK.apply(this.object, this.groundHeight, dt);
      }
    }
    void ONE_SHOT;
    void AIR;
  }

  /** The landing clip chosen at touch-down (jump_land, the hard one for a deep landing, the heavy one from height). */
  private landClip(): string {
    return this.actions.has(this.landClipName) ? this.landClipName : 'jump_land';
  }

  private setTime(name: string, time: number): void {
    const a = this.actions.get(name);
    if (a) {
      a.time = Math.min(time, CLIPS[name].duration - 1e-4);
    }
  }

  /** Leans the upper body into acceleration (forward / back) and into turns (sideways), on springs. */
  private leanLayer(dt: number, sp: number): void {
    if (dt <= 0) {
      return;
    }
    const grounded = this.state === 'ground' || this.state === 'stop';
    // Acceleration along the facing (forward +) and the turn's centripetal acceleration (to the right +).
    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    const ax = (this.velocity.x - this.prevVel.x) / dt;
    const az = (this.velocity.y - this.prevVel.y) / dt;
    const along = ax * fwdX + az * fwdZ;
    let dyaw = this.yaw - this.prevYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const turn = (dyaw / dt) * sp; // m/s² toward the turn (+ = left)
    const wantF = grounded ? clamp(along * LOCO.leanAccel, -LOCO.leanMax, LOCO.leanMax) : 0;
    const wantS = grounded ? clamp(-turn * LOCO.leanTurn * 0.2, -LOCO.leanMax, LOCO.leanMax) : 0;
    const k = 1 - Math.exp(-6 * dt);
    this.lean.x += (wantF - this.lean.x) * k;
    this.lean.y += (wantS - this.lean.y) * k;
    // Apply about the character's own axes: pitch about its right (−X in its frame), roll about its forward (+Z).
    const share = [0.4, 0.35, 0.25];
    this.spine.forEach((b, i) => {
      b.parent!.getWorldQuaternion(_pq);
      _axis.set(1, 0, 0).applyQuaternion(this.object.quaternion);
      _q.setFromAxisAngle(_axis, this.lean.x * share[i]);
      _axis.set(0, 0, 1).applyQuaternion(this.object.quaternion);
      _q.multiply(new THREE.Quaternion().setFromAxisAngle(_axis, this.lean.y * share[i]));
      // world delta → local: local' = P⁻¹ · R · P · local
      const inv = _pq.clone().invert();
      b.quaternion.premultiply(_pq).premultiply(_q).premultiply(inv);
      b.updateMatrixWorld(true);
    });
    // The head looks into the turn, ahead of the body (a fraction of a second of turning), eased.
    const wantLook = clamp((dyaw / dt) * 0.22, -0.6, 0.6);
    this.look += (wantLook - this.look) * (1 - Math.exp(-5 * dt));
    for (const [b, share] of [
      [this.neck, 0.4],
      [this.head, 0.6],
    ] as const) {
      if (!b) {
        continue;
      }
      b.parent!.getWorldQuaternion(_pq);
      _axis.set(0, 1, 0);
      _q.setFromAxisAngle(_axis, this.look * share);
      const inv = _pq.clone().invert();
      b.quaternion.premultiply(_pq).premultiply(_q).premultiply(inv);
      b.updateMatrixWorld(true);
    }
    void this.hips;
  }
}
