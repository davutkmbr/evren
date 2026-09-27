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

export interface LocomotionInput {
  /** Desired horizontal direction and strength (world x, z; length 0..1). */
  move: THREE.Vector2;
  run: boolean;
  crouch: boolean;
  /** Pressed this frame. */
  jump: boolean;
  /** Held: spread the wings and glide (in the air). */
  glide?: boolean;
  /** Standing: turn to face this heading (rad about +Y, 0 = +Z); the feet step round. */
  faceYaw?: number;
}

export type LocoState = 'ground' | 'stop' | 'takeoff' | 'air' | 'glide' | 'land';

/** Tunables (SI units). */
export const LOCO = {
  walkSpeed: 1.45,
  runSpeed: 5.2,
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
  /** A stop plays the skid from above this speed. */
  stopMin: 3.4,
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
};

const GAIT = ['idle', 'walk', 'run', 'crouch_idle', 'crouch_walk'] as const;
const ONE_SHOT = ['run_stop', 'jump_start', 'jump_land'] as const;
const AIR = ['jump_rise', 'jump_fall'] as const;

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
  /** Glide: body pitch and bank (rad), wing spread spring (value, velocity). */
  private pitch = 0;
  private bank = 0;
  private wing = 0;
  private wingVel = 0;
  /** Standing still: time so far, the idle variation playing (if any) and its time, when the next one comes. */
  private still = 0;
  private variant: string | null = null;
  private variantTime = 0;
  private nextVariant = 7;
  private variantIndex = 0;
  /** Turning on the spot (rad/s, smoothed): drives stepping feet. */
  private spin = 0;

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
    // --- crouch ---
    const wantCrouch = input.crouch && grounded && !input.run ? 1 : 0;
    this.crouch += clamp(wantCrouch - this.crouch, -dt / LOCO.crouchTime, dt / LOCO.crouchTime);
    // --- horizontal movement ---
    const m = Math.min(1, input.move.length());
    const top = THREE.MathUtils.lerp(input.run ? LOCO.runSpeed : LOCO.walkSpeed, LOCO.crouchSpeed, this.crouch);
    _want.copy(input.move).normalize().multiplyScalar(m * top);
    if (m < 1e-3) {
      _want.set(0, 0);
    }
    if (this.state === 'stop') {
      // The skid: speed follows the clip (1 - t/T)², in the direction of travel.
      const u = Math.min(1, this.stateTime / STOP_BRAKE);
      const s = this.stopSpeed * (1 - u) * (1 - u);
      if (this.velocity.lengthSq() > 1e-6) {
        this.velocity.setLength(s);
      }
      if (this.stateTime >= CLIPS.run_stop.duration * 0.8 || m > 0.2) {
        this.enter('ground');
      }
    } else if (this.state === 'glide') {
      // Gliding: the wings carry the body forward along its heading at the glide speed; the stick turns it.
      const fwdX = Math.sin(this.yaw);
      const fwdZ = Math.cos(this.yaw);
      _want.set(fwdX, fwdZ).multiplyScalar(LOCO.glideSpeed);
      this.approach(_want, 4, dt);
    } else if (this.state === 'land' || this.state === 'takeoff') {
      // Planted: little steering, the landing absorbs.
      this.approach(_want, (this.state === 'land' ? 0.5 : 0.2) * LOCO.decel, dt);
    } else {
      const rate = !grounded ? LOCO.airAccel : _want.lengthSq() > this.velocity.lengthSq() ? LOCO.accel : LOCO.decel;
      this.approach(_want, rate, dt);
    }
    // --- the stop ---
    if (this.state === 'ground' && m < 0.05 && this.prevVel.length() > LOCO.stopMin && this.crouch < 0.3) {
      this.stopSpeed = this.prevVel.length();
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
      let turn = 0;
      if (m > 0.1) {
        let d = Math.atan2(input.move.x, input.move.y) - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        turn = clamp(d * 2, -1, 1) * LOCO.glideTurn;
      }
      this.yaw += turn * dt;
      this.bank += (clamp(-turn * LOCO.glideBank, -0.7, 0.7) - this.bank) * (1 - Math.exp(-3 * dt));
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
      if (input.jump) {
        this.enter('takeoff');
      }
    }
    if (this.state === 'takeoff' && this.stateTime >= CLIPS.jump_start.duration) {
      this.vy = LOCO.jumpSpeed;
      this.enter('air');
    }
    if (this.state === 'air' && input.glide && this.vy < 2 && this.human.wings.present) {
      this.enter('glide');
    } else if (this.state === 'glide' && !input.glide) {
      this.enter('air');
    }
    if (this.state === 'glide') {
      // Lift holds the sink near the glide rate (a stall's worth of drop first if it was falling fast).
      this.vy += (-LOCO.glideSink - this.vy) * (1 - Math.exp(-2.2 * dt));
      pos.y += this.vy * dt;
      if (pos.y <= ground) {
        pos.y = ground;
        this.landDepth = clamp((-this.vy - 1.0) / 4 + 0.35, 0.3, 1);
        this.vy = 0;
        this.enter('land');
      }
    } else if (this.state === 'air') {
      this.vy -= LOCO.gravity * dt;
      pos.y += this.vy * dt;
      if (pos.y <= ground && this.vy < 0) {
        pos.y = ground;
        // Landing depth from the impact speed: a hop barely dips, a fall from height crouches deep.
        this.landDepth = clamp((-this.vy - 1.5) / 6, 0.25, 1);
        this.vy = 0;
        this.enter('land');
      }
    } else {
      pos.y = ground;
      if (this.state === 'land' && this.stateTime >= CLIPS.jump_land.duration * (0.55 + 0.45 * this.landDepth)) {
        this.enter('ground');
      }
    }
    pos.x += this.velocity.x * dt;
    pos.z += this.velocity.y * dt;
    // Body pitched into the flight line and banked while gliding, upright otherwise (fast on landing).
    const gl = this.state === 'glide';
    const pk = 1 - Math.exp(-(gl ? 2.5 : this.state === 'land' ? 14 : 5) * dt);
    this.pitch += ((gl ? LOCO.glidePitch : 0) - this.pitch) * pk;
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
    const gait = { idle: (1 - walkIn) * stand, walk: walkIn * (1 - runIn) * stand, run: walkIn * runIn * stand, crouch_idle: (1 - walkIn) * this.crouch, crouch_walk: walkIn * this.crouch };
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
    const moving = gait.walk + gait.run + gait.crouch_walk;
    if (moving > 1e-3 && stepIn < 1e-3) {
      const len = (gait.walk * cycleLength('walk') + gait.run * cycleLength('run') + gait.crouch_walk * cycleLength('crouch_walk')) / moving;
      this.phase = (this.phase + (sp * dt) / len) % 1;
    }
    this.idleTime = (this.idleTime + dt) % CLIPS.idle.duration;
    this.crouchIdleTime = (this.crouchIdleTime + dt) % CLIPS.crouch_idle.duration;
    let gaitShare = 1;
    let fast = false;
    switch (this.state) {
      case 'stop': {
        const k = 1 - smoothstep(this.stateTime, CLIPS.run_stop.duration * 0.6, CLIPS.run_stop.duration * 0.8);
        t.set('run_stop', k);
        gaitShare = 1 - k;
        this.setTime('run_stop', this.stateTime);
        break;
      }
      case 'takeoff':
        t.set('jump_start', 1);
        gaitShare = 0;
        fast = true;
        this.setTime('jump_start', this.stateTime);
        break;
      case 'glide':
        t.set('glide', 1);
        gaitShare = 0;
        this.setTime('glide', this.stateTime % CLIPS.glide.duration);
        break;
      case 'air': {
        const fall = smoothstep(-this.vy, -1.5, 2.5);
        t.set('jump_rise', 1 - fall);
        t.set('jump_fall', fall);
        gaitShare = 0;
        this.setTime('jump_rise', this.stateTime % CLIPS.jump_rise.duration);
        this.setTime('jump_fall', this.stateTime % CLIPS.jump_fall.duration);
        break;
      }
      case 'land': {
        // Deep landings play the whole absorb; a running landing runs on after the first dip.
        const runOn = smoothstep(sp, 1.5, 4.0);
        const k = this.landDepth * (1 - 0.6 * runOn);
        t.set('jump_land', k);
        gaitShare = 1 - k;
        fast = true;
        this.setTime('jump_land', this.stateTime);
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
      const names = ['idle_look', 'idle_shoulders'].filter((n) => this.actions.has(n));
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
    this.human.mixer.update(0);
    // After the mixer (the clips key every bone's scale at 1).
    this.human.wings.set(this.wing);
    for (const [bone, q] of this.layered) {
      q.copy(bone.quaternion);
    }
    if (this.layers) {
      this.leanLayer(dt, sp);
    }
    void ONE_SHOT;
    void AIR;
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
