import * as THREE from 'three';
import type { HardLandingPhase } from '../../core/contracts';
import { clamp, createRng, lerp, smoothstep } from '../../core/math/noise';
import { enterStance, standDepth } from './ground-moves';
import { stepGrounded } from './locomotion';
import { MANEUVER_LABELS } from './maneuvers';
import { GRAVITY, GROUND, HARD_LANDING } from './params';
import type { FlightSim } from './sim';
import { createPilotCommand } from './types';

/*
 * Hard landing (phase 04): the dragon meets the ground too fast, tumbles along it in the direction of travel, slides
 * to a stop, gets up and shakes its head (the bond plays the shake and the grumble or sneeze). No penalty: control
 * comes back grounded after ~3.2-3.6 s. Three variants, never the same twice in a row:
 *   - front: the chest plows in, the nose dips with the head held up and the hindquarters kick up, then it rolls over
 *     its shoulder once and lands on its belly;
 *   - side: it slews sideways and rolls like a log along the ground in the direction of travel, once or twice;
 *   - belly: a fishtailing skid on the belly, wings spread flat like a sled, then up.
 * A scripted, grounded and deterministic motion (not a ragdoll): the body's height is always the lowest at which none
 * of its collision spheres (the head where the raised neck holds it) nor the rider is below the surface under it, and
 * it falls no faster than gravity; the slide stops at walls, ledges and the water's edge. Rolls turn about the body's
 * long axis, so the long neck and tail never have to vault over the ground.
 */

export type HardLandingVariant = 'front' | 'side' | 'belly';
export const HARD_LANDING_VARIANTS: readonly HardLandingVariant[] = ['front', 'side', 'belly'];

const TWO_PI = Math.PI * 2;
const NEUTRAL = createPilotCommand();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _local = new THREE.Quaternion();
const _target = new THREE.Quaternion();
const _yawQ = new THREE.Quaternion();
const _offset = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _column = { floor: 0, ceiling: Infinity };
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** State of the hard landing (owned by the sim) and the cues the pose driver reads. */
export class HardLanding {
  active = false;
  variant: HardLandingVariant = 'front';
  stage: HardLandingPhase = 'tumble';
  /** Seconds since the impact and since the current stage started. */
  time = 0;
  stageTime = 0;
  /** Length of this tumble (s). */
  tumbleTime: number = HARD_LANDING.frontTime;
  /** Variant of the previous hard landing (never repeated back to back) and how many there were since the reset. */
  last: HardLandingVariant | null = null;
  count = 0;
  /** Pose sheets and checks: the next hard landing plays this variant (then it is cleared). */
  forceNext: HardLandingVariant | null = null;
  /* Impact numbers (m/s): sink, speed over the ground, the contact's normal approach. */
  sink = 0;
  horizontal = 0;
  approach = 0;
  /** Travel direction over the ground (unit) and its yaw. */
  dirX = 0;
  dirZ = -1;
  yaw = 0;
  /** Heading the body ends up with (the side roll leaves it lying across its track); the stance gets up facing it. */
  endYaw = 0;
  /** Slide speed at the start (m/s) and now. */
  slide0 = 0;
  slide = 0;
  /** Roll / slew / fishtail side (±1) and the number of turns of the roll. */
  side = 1;
  rolls = 1;
  /** Body pitch at the impact (clamped) the tumble starts from. */
  pitch0 = 0;
  /** Vertical speed of the body's centre (m/s): it falls no faster than gravity. */
  vy = 0;
  /* Pose cues: wings flailing (0..1), the neck's raise (rad, the head held up off the ground), the rider holding on. */
  flail = 0;
  neckRaise = 0;
  hold = 0;
  readonly startQ = new THREE.Quaternion();
  /* Get-up: attitude and lying height it starts from. */
  readonly riseQ = new THREE.Quaternion();
  riseY = 0;
  /** Seconds since the last dust puff of the slide, and the thuds of the tumble so far. */
  dustTimer = 0;
  thuds = 0;
  private rng = createRng(HARD_LANDING.seed);

  reset(): void {
    this.active = false;
    this.stage = 'tumble';
    this.time = 0;
    this.stageTime = 0;
    this.last = null;
    this.count = 0;
    this.flail = 0;
    this.neckRaise = 0;
    this.hold = 0;
    this.vy = 0;
    this.forceNext = null;
    this.rng = createRng(HARD_LANDING.seed);
  }

  /** The phase for the game (DragonState.hardLanding), null when none runs. */
  get phase(): HardLandingPhase | null {
    return this.active ? this.stage : null;
  }

  /** Total length (s) of the running hard landing: tumble, get-up and head shake. */
  get duration(): number {
    return this.tumbleTime + HARD_LANDING.riseTime + HARD_LANDING.shakeTime;
  }

  /**
   * Picks a variant other than the last one (seeded): a fast, flat hit (sink m/s, speed over the ground m/s) likes the
   * belly skid, a steep slow one the plow over the shoulder; otherwise any.
   */
  pick(sink: number, horizontal: number): HardLandingVariant {
    const options = HARD_LANDING_VARIANTS.filter((v) => v !== this.last);
    const liked: HardLandingVariant | null = horizontal >= 24 && sink < 6 ? 'belly' : sink >= 10 && horizontal < 12 ? 'front' : null;
    if (liked && options.includes(liked) && this.rng() < 0.6) {
      return liked;
    }
    return options[Math.min(options.length - 1, Math.floor(this.rng() * options.length))];
  }

  random(): number {
    return this.rng();
  }
}

/**
 * Is a contact on land hard enough for a hard landing? `sink` = vertical speed into the ground (m/s, > 0 down),
 * `approach` = the contact's normal approach speed (body contacts; the sink for the feet), `horizontal` = speed over
 * the ground, `legs` = the feet met the ground (legs out).
 */
export function isHardImpact(sink: number, approach: number, horizontal: number, legs: boolean): boolean {
  const c = HARD_LANDING;
  if (legs) {
    return sink >= c.legSink;
  }
  return approach >= c.bellySink || (approach >= c.glanceSink && horizontal >= c.glanceSpeed);
}

/**
 * Starts a hard landing from a contact with the pre-contact velocity (vx, vy, vz) and the contact's normal approach
 * speed. `variant` forces one (debug hook, checks). Returns false (nothing done) when the dragon is not somewhere a hard
 * landing can happen (over water, perching, already tumbling).
 */
export function startHardLanding(sim: FlightSim, vx: number, vy: number, vz: number, approach: number, variant?: HardLandingVariant): boolean {
  const hl = sim.hard;
  if (hl.active || sim.overWater || sim.perch.phase !== 'free') {
    return false;
  }
  const c = HARD_LANDING;
  const b = sim.body;
  const p = b.position;
  hl.active = true;
  hl.stage = 'tumble';
  hl.time = 0;
  hl.stageTime = 0;
  hl.variant = variant ?? hl.forceNext ?? hl.pick(Math.max(-vy, 0), Math.hypot(vx, vz));
  hl.forceNext = null;
  hl.last = hl.variant;
  hl.count++;
  hl.sink = Math.max(-vy, 0);
  hl.horizontal = Math.hypot(vx, vz);
  hl.approach = Math.max(approach, hl.sink);
  if (hl.horizontal > 1) {
    hl.dirX = vx / hl.horizontal;
    hl.dirZ = vz / hl.horizontal;
  } else {
    const f = sim.axes.forward;
    const l = Math.hypot(f.x, f.z);
    hl.dirX = l > 1e-3 ? f.x / l : 0;
    hl.dirZ = l > 1e-3 ? f.z / l : -1;
  }
  hl.yaw = Math.atan2(-hl.dirX, -hl.dirZ);
  hl.slide0 = Math.min(hl.horizontal * c.slideKeep, c.slideMax);
  hl.slide = hl.slide0;
  const bank = sim.axes.bank();
  hl.side = Math.abs(bank) > 0.2 ? Math.sign(bank) : hl.random() < 0.5 ? -1 : 1;
  hl.rolls = hl.variant === 'side' && hl.horizontal >= c.sideDoubleSpeed ? 2 : 1;
  hl.tumbleTime = hl.variant === 'front' ? c.frontTime : hl.variant === 'belly' ? c.bellyTime : hl.rolls > 1 ? c.sideDoubleTime : c.sideTime;
  hl.endYaw = hl.yaw + (hl.variant === 'side' ? hl.side * c.sideSlew : 0);
  hl.pitch0 = clamp(sim.axes.pitch(), -0.9, 0.35);
  hl.startQ.copy(b.quaternion);
  // The body bounces off the ground a little (the rest of the sink goes into the tumble).
  hl.vy = Math.min(c.bounce * hl.sink, c.bounceMax);
  hl.flail = 1;
  hl.neckRaise = 0;
  hl.hold = 1;
  hl.dustTimer = 0;
  hl.thuds = 0;

  // Everything airborne stops: no trick, no leap, no run-out; the stance is set up again at the get-up.
  sim.maneuvers.cancel(sim);
  sim.leapCharge = 0;
  sim.runTakeoff = 0;
  sim.moves.leap = null;
  sim.moves.runOut = false;
  sim.moves.takeoffVariant = null;
  sim.groundYaw = hl.yaw;
  sim.groundSpeed = 0;
  sim.groundYawRate = 0;
  sim.walkAmount = 0;
  sim.hoverBlend = 0;
  sim.brake = 0;
  sim.attachment = 1;
  b.angularVelocity.set(0, 0, 0);
  sim.setMode('grounded');
  // A ground contact breaks the flow chain the way any airborne contact does.
  sim.flow.hardContact();

  const point = new THREE.Vector3(p.x, sim.surfaceY, p.z);
  sim.impactCooldown = 0.4;
  sim.emit({ type: 'impact', point, speed: Math.max(hl.approach, 6), surface: 'ground' });
  sim.emit({ type: 'dust', point: point.clone(), strength: c.impactDust });
  sim.emit({ type: 'shake', amount: c.shake });
  sim.emit({ type: 'maneuver', id: 'hardland', label: MANEUVER_LABELS.hardland });
  return true;
}

/** Ease in-out 0..1. */
function ease(k: number): number {
  const t = clamp(k, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Surface under a point of the body (roofs, terrain; the sea's surface), no higher than a step above the ground under the centre. */
function floorAt(sim: FlightSim, x: number, z: number): number {
  const col = sim.world.collision;
  if (!col) {
    return sim.surfaceY;
  }
  const floor = col.columnAt(x, z, sim.surfaceY + sim.standHeight + sim.contacts.bellyDepth, _column).floor;
  return Math.min(floor, sim.surfaceY + GROUND.maxStep);
}

/**
 * Offset of body sphere `i` (body frame, into `out`; i = offsets.length is the rider): the head sphere is swung up
 * about the neck's base by `neckRaise` rad.
 */
export function bodySphere(sim: FlightSim, i: number, neckRaise: number, out: THREE.Vector3): number {
  const c = HARD_LANDING;
  const contacts = sim.contacts;
  const L = sim.rigLength;
  if (i >= contacts.offsets.length) {
    out.set(0, c.riderUp * L, -c.riderForward * L);
    return c.riderRadius;
  }
  out.copy(contacts.offsets[i]);
  if (i === 2 && neckRaise !== 0) {
    // About the neck's base (x axis): the head comes up and back.
    const baseZ = -c.neckBase * L;
    const dy = out.y;
    const dz = out.z - baseZ;
    const cs = Math.cos(neckRaise);
    const sn = Math.sin(neckRaise);
    out.y = dy * cs - dz * sn;
    out.z = baseZ + dy * sn + dz * cs;
  }
  return contacts.radii[i];
}

/**
 * Lowest height of the centre at which no collision sphere of the body (the head raised by `neckRaise`) nor the rider
 * is below the surface under it, for attitude `q`.
 */
export function restingHeight(sim: FlightSim, q: THREE.Quaternion, neckRaise: number): number {
  const p = sim.body.position;
  let best = -Infinity;
  for (let i = 0; i <= sim.contacts.offsets.length; i++) {
    const r = bodySphere(sim, i, neckRaise, _offset);
    _offset.applyQuaternion(q);
    const need = floorAt(sim, p.x + _offset.x, p.z + _offset.z) + r - _offset.y;
    if (need > best) {
      best = need;
    }
  }
  return best;
}

/** Progress of the roll (0..1) at tumble progress k: it starts once the wings are folded. */
function rollProgress(hl: HardLanding, k: number): number {
  const start = hl.variant === 'front' ? HARD_LANDING.frontRollStart : HARD_LANDING.sideRollStart;
  return ease((k - start) / (1 - start));
}

/** Scripted attitude of the tumble at progress k (0..1), t s into it (into `out`). */
function tumbleAttitude(hl: HardLanding, k: number, t: number, out: THREE.Quaternion): THREE.Quaternion {
  const c = HARD_LANDING;
  let pitch = 0;
  let yaw = 0;
  let roll = 0;
  if (hl.variant === 'front') {
    // The chest plows in: the nose dips (head held up) and the hindquarters kick up, then a roll over the shoulder.
    const dip = Math.sin(Math.PI * clamp(k / (2 * c.frontDipAt), 0, 1));
    pitch = lerp(hl.pitch0, c.lyingPitch, ease(k / c.frontDipAt)) - c.frontDip * dip;
    roll = hl.side * TWO_PI * rollProgress(hl, k);
  } else if (hl.variant === 'side') {
    // Slews across the track, then rolls like a log along it (the top turning toward the travel direction).
    yaw = hl.side * c.sideSlew * ease(k / c.sideRollStart);
    pitch = lerp(hl.pitch0, c.lyingPitch, ease(k / c.sideRollStart));
    roll = -hl.side * TWO_PI * hl.rolls * rollProgress(hl, k);
  } else {
    // A belly skid: fishtailing and rocking, settling as it slows.
    const fade = Math.pow(1 - clamp(k, 0, 1), 1.5);
    pitch = lerp(hl.pitch0, c.lyingPitch, ease(k / 0.3));
    yaw = hl.side * c.skidYaw * Math.sin(TWO_PI * 1.3 * t) * fade;
    roll = -hl.side * c.skidRoll * Math.sin(TWO_PI * 2.1 * t + 0.6) * fade;
  }
  _euler.set(pitch, yaw, roll, 'YXZ');
  _local.setFromEuler(_euler);
  _yawQ.setFromAxisAngle(Y_AXIS, hl.yaw);
  return out.copy(_yawQ).multiply(_local);
}

/** Height step: follows the resting height up, falls toward it no faster than gravity (vertical speed kept in hl.vy). */
function stepHeight(sim: FlightSim, hl: HardLanding, rest: number, h: number): void {
  const p = sim.body.position;
  const prev = p.y;
  const vy = hl.vy - GRAVITY * h;
  const ball = prev + vy * h;
  if (ball <= rest) {
    p.y = rest;
    // Carried up by the ground (a roll over the back lifts the body): keeps a little of it as a hop.
    hl.vy = clamp((rest - prev) / h, 0, HARD_LANDING.carryMax);
  } else {
    p.y = ball;
    hl.vy = vy;
  }
}

/**
 * Wings through the tumble: flailing after the impact, folded before a roll starts (a half-open wing would sweep
 * through the ground); the belly skid keeps them spread flat like a sled a while.
 */
function tumbleWings(sim: FlightSim, hl: HardLanding, k: number, h: number): void {
  const c = HARD_LANDING;
  const t = hl.stageTime;
  const rolling = hl.variant !== 'belly';
  const flailTime = rolling ? c.rollFlailTime : c.flailTime;
  hl.flail = 1 - smoothstep(flailTime * 0.5, flailTime, t);
  let spread = lerp(0.06, (rolling ? 0.4 : 0.55) + 0.2 * Math.sin(TWO_PI * 3.4 * t), hl.flail);
  if (!rolling) {
    spread = Math.max(spread, 0.5 * (1 - smoothstep(0.5, 0.8, k)));
  }
  const d = spread - sim.spread;
  const step = (rolling ? 9 : 5) * h;
  sim.spread += d > step ? step : d < -step ? -step : d;
  sim.sweep += ((rolling ? 0.6 : 0.2) - sim.sweep) * (1 - Math.exp(-5 * h));
  sim.legsOut = Math.max(0, sim.legsOut - 4 * h);
  sim.hoverBlend = 0;
  sim.brake = 0;
  sim.attachment = 1;
  sim.updateInertia();
  const beat = sim.beat;
  beat.phase = (beat.phase + TWO_PI * 2.8 * hl.flail * h) % TWO_PI;
  beat.amplitude = 0.5 * hl.flail;
  beat.effort = 0;
  beat.downstrokeStarted = false;
}

function fillTelemetry(sim: FlightSim, speed: number): void {
  sim.airspeed = speed;
  sim.alpha = 0;
  sim.beta = 0;
  sim.bank = sim.axes.bank();
  sim.pitch = sim.axes.pitch();
  sim.gamma = 0;
  sim.loadFactor = 1;
  sim.specificForce.set(0, GRAVITY, 0);
  sim.controlMoment.set(0, 0, 0);
  sim.lift = 0;
  sim.drag = 0;
  sim.flapForce = 0;
  sim.groundSpeed = speed;
}

/** One substep of the hard landing (replaces the grounded step while it runs; the pilot's input is ignored). */
export function stepHardLanding(sim: FlightSim, h: number): void {
  const hl = sim.hard;
  hl.time += h;
  hl.stageTime += h;
  if (hl.stage === 'tumble') {
    stepTumble(sim, hl, h);
    if (hl.stageTime >= hl.tumbleTime) {
      hl.stage = 'rise';
      hl.stageTime = 0;
      hl.riseQ.copy(sim.body.quaternion);
      hl.riseY = sim.body.position.y - sim.surfaceY;
      sim.groundYaw = hl.endYaw;
    }
  } else if (hl.stage === 'rise') {
    stepRise(sim, hl, h);
    if (hl.stageTime >= HARD_LANDING.riseTime) {
      hl.stage = 'shake';
      hl.stageTime = 0;
      // Standing: the ordinary stance takes over from here (settle springs from the get-up's attitude and height).
      enterStance(sim, false);
      sim.moves.foreGround = 1;
    }
  } else {
    // Standing still while the bond plays the head shake; the stance keeps the body on the ground.
    hl.hold = Math.max(0, hl.hold - 3 * h);
    stepGrounded(sim, NEUTRAL, h);
    if (hl.stageTime >= HARD_LANDING.shakeTime) {
      hl.active = false;
      hl.hold = 0;
    }
  }
}

function stepTumble(sim: FlightSim, hl: HardLanding, h: number): void {
  const c = HARD_LANDING;
  const b = sim.body;
  const p = b.position;
  const k = clamp(hl.stageTime / hl.tumbleTime, 0, 1);
  const collision = sim.world.collision;

  // --- slide: along the travel direction, slowing to a stop at the end of the tumble; stops at walls, ledges, water --
  hl.slide = hl.slide0 * (1 - k) * (1 - k);
  if (hl.slide > 0 && collision) {
    const nx = p.x + hl.dirX * hl.slide * h;
    const nz = p.z + hl.dirZ * hl.slide * h;
    // The ground under the centre's next position and under the body's leading end.
    let blocked = false;
    for (const reach of [0, c.leadReach * sim.rigLength]) {
      const x = nx + hl.dirX * reach;
      const z = nz + hl.dirZ * reach;
      const floor = collision.columnAt(x, z, sim.surfaceY + sim.standHeight + sim.contacts.bellyDepth, _column).floor;
      const water = collision.terrainHeight(x, z) < -0.4 && floor < 0.05;
      blocked ||= water || floor - sim.surfaceY > GROUND.maxStep || floor < sim.surfaceY - GROUND.dropToFall;
    }
    if (blocked) {
      // A wall, an edge or the water ahead: the slide stops here.
      hl.slide0 = 0;
      hl.slide = 0;
    } else {
      p.x = nx;
      p.z = nz;
    }
  } else if (hl.slide > 0) {
    p.x += hl.dirX * hl.slide * h;
    p.z += hl.dirZ * hl.slide * h;
  }
  sim.sampleSurface();

  // --- attitude: from the impact's into the scripted tumble; the neck raise the pose holds ---
  tumbleAttitude(hl, k, hl.stageTime, _target);
  const blend = smoothstep(0, c.blendIn, hl.stageTime);
  b.quaternion.copy(hl.startQ).slerp(_target, blend);
  sim.axes.update(b.quaternion);
  // Front: the head held up through the plow, the neck straight again before the roll gets far (a raised head points
  // at the ground once the body is on its side).
  const raise = hl.variant === 'front' ? c.frontNeckRaise * (1 - smoothstep(c.frontRollStart - 0.1, c.frontRollStart + 0.05, k)) : hl.variant === 'belly' ? c.bellyNeckRaise : 0;
  hl.neckRaise += (raise - hl.neckRaise) * (1 - Math.exp(-c.neckRate * h));

  // --- height: resting on the lowest points, never through the ground ---
  // The head sphere where the neck holds it (the pose driver hands the same raise to the rig).
  const rest = restingHeight(sim, b.quaternion, hl.neckRaise);
  const prevY = p.y;
  stepHeight(sim, hl, rest, h);
  b.velocity.set(hl.dirX * hl.slide, (p.y - prevY) / h, hl.dirZ * hl.slide);
  b.angularVelocity.set(0, 0, 0);

  if (collision && sim.contacts.resolveWalls(b, collision, sim.impact, sim.surfaceY + GROUND.maxStep)) {
    hl.slide0 *= 0.3;
  }

  // --- wings, dust, the thuds of the body landing on its back and belly again ---
  tumbleWings(sim, hl, k, h);
  hl.dustTimer += h;
  if (hl.dustTimer > c.dustEvery && hl.slide > 2) {
    hl.dustTimer = 0;
    sim.emit({ type: 'dust', point: new THREE.Vector3(p.x, sim.surfaceY, p.z), strength: clamp(hl.slide / 20, 0.2, 0.7) });
  }
  if (hl.variant !== 'belly') {
    // Each half turn (on its back, on its belly again) meets the ground with a thud.
    const turns = 2 * (hl.variant === 'side' ? hl.rolls : 1);
    const due = Math.floor(rollProgress(hl, k) * turns + 0.25);
    if (due > hl.thuds && hl.thuds < turns) {
      hl.thuds = due;
      sim.emit({ type: 'impact', point: new THREE.Vector3(p.x, sim.surfaceY, p.z), speed: clamp(3 + hl.slide * 0.4, 3, 7), surface: 'ground' });
    }
  }
  fillTelemetry(sim, hl.slide);
}

function stepRise(sim: FlightSim, hl: HardLanding, h: number): void {
  const b = sim.body;
  const p = b.position;
  const k = clamp(hl.stageTime / HARD_LANDING.riseTime, 0, 1);
  const e = ease(k);
  sim.sampleSurface();
  // Standing attitude: facing where the tumble left it, aligned with the ground (as the stance does), fore end up first.
  const onTerrain = sim.surfaceY - Math.max(sim.terrainY, 0) < 0.3;
  if (onTerrain && sim.world.geo) {
    sim.world.geo.normalAt(p.x, p.z, _normal);
  } else {
    _normal.set(0, 1, 0);
  }
  sim.moves.groundNormal.copy(_normal);
  _up.set(0, 1, 0).lerp(_normal, 0.7).normalize();
  _forward.set(-Math.sin(hl.endYaw), 0, -Math.cos(hl.endYaw));
  _forward.addScaledVector(_up, -_forward.dot(_up)).normalize();
  _right.crossVectors(_forward, _up).normalize();
  _back.copy(_forward).negate();
  _basis.makeBasis(_right, _up, _back);
  _target.setFromRotationMatrix(_basis);
  const lift = 0.12 * Math.sin(Math.PI * k);
  _euler.set(lift, 0, 0, 'YXZ');
  _target.multiply(_local.setFromEuler(_euler));
  b.quaternion.copy(hl.riseQ).slerp(_target, e);
  sim.axes.update(b.quaternion);
  // Legs out and pushing up from lying to standing height.
  sim.legsOut = Math.max(sim.legsOut, e);
  const stand = standDepth(sim.standHeight, lift);
  const prevY = p.y;
  stepHeight(sim, hl, sim.surfaceY + lerp(hl.riseY, stand, e), h);
  b.velocity.set(0, (p.y - prevY) / h, 0);
  b.angularVelocity.set(0, 0, 0);
  // Wings folded, the beat at rest at the top of the stroke.
  sim.spread += (0.06 - sim.spread) * (1 - Math.exp(-6 * h));
  sim.sweep += (0 - sim.sweep) * (1 - Math.exp(-4 * h));
  sim.updateInertia();
  sim.beat.amplitude = Math.max(0, sim.beat.amplitude - 2 * h);
  sim.beat.downstrokeStarted = false;
  hl.flail = 0;
  hl.neckRaise += (0 - hl.neckRaise) * (1 - Math.exp(-HARD_LANDING.neckRate * h));
  fillTelemetry(sim, 0);
}

/**
 * Debug hook (window.__flightTest.hardLanding, window.__evren.hardLanding): a hard landing right here, as if the dragon
 * had just met the ground below it `speed` m/s fast along its heading (default: its speed, at least 20) sinking `sink`
 * m/s. `variant` forces front / side / belly. False over water, perching, or while one already runs.
 */
export function triggerHardLanding(sim: FlightSim, variant?: HardLandingVariant, speed?: number, sink = 10): boolean {
  if (sim.hard.active || sim.mode === 'swimming' || sim.mode === 'underwater' || sim.perch.phase !== 'free') {
    return false;
  }
  if (variant !== undefined && !HARD_LANDING_VARIANTS.includes(variant)) {
    return false;
  }
  sim.sampleSurface();
  if (sim.overWater) {
    return false;
  }
  const b = sim.body;
  const yaw = sim.mode === 'grounded' ? sim.groundYaw : sim.axes.yaw();
  const h = speed ?? Math.max(Math.hypot(b.velocity.x, b.velocity.z), 20);
  b.position.y = sim.surfaceY + sim.contacts.bellyDepth;
  sim.sampleSurface();
  return startHardLanding(sim, -Math.sin(yaw) * h, -sink, -Math.cos(yaw) * h, sink, variant);
}
