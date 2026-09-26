import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../../core/math/noise';
import { MANEUVER_LABELS } from './maneuvers';
import { GRAVITY, GROUND, SWIM } from './params';
import type { FlightSim } from './sim';
import type { PilotCommand } from './types';

const TWO_PI = Math.PI * 2;
const _normal = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _targetQ = new THREE.Quaternion();
const _extraQ = new THREE.Quaternion();
const _step = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _column = { floor: 0, ceiling: Infinity };
const _waterVelocity = new THREE.Vector3();
const _float = { height: 0, slopeForward: 0, slopeRight: 0, vx: 0, vy: 0, vz: 0 };

/** Where the floating body samples the water, as fractions of the rig length: forward, right. */
const FLOAT_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.3, 0],
  [-0.3, 0],
  [0, 0.12],
  [0, -0.12],
];

function approach(current: number, target: number, rate: number, h: number): number {
  const d = target - current;
  const step = rate * h;
  return current + (d > step ? step : d < -step ? -step : d);
}

function forwardSpeed(sim: FlightSim): number {
  const v = sim.body.velocity;
  const yaw = sim.groundYaw;
  return v.x * -Math.sin(yaw) + v.z * -Math.cos(yaw);
}

function relaxWings(sim: FlightSim, spread: number, sweep: number, h: number): void {
  sim.spread = approach(sim.spread, spread, 1.4, h);
  sim.sweep = approach(sim.sweep, sweep, 2, h);
  sim.legsOut = approach(sim.legsOut, 1, 2, h);
  sim.hoverBlend = approach(sim.hoverBlend, 0, 2, h);
  sim.brake = approach(sim.brake, 0, 3, h);
  sim.attachment = 1;
  sim.updateInertia();
  sim.beat.update(h, 0, 0);
}

function fillLocomotionTelemetry(sim: FlightSim): void {
  sim.airspeed = Math.abs(sim.groundSpeed);
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
}

/** Leap into the air with strong beats (from the ground or water). */
function leap(sim: FlightSim, up: number, forward: number): void {
  const yaw = sim.groundYaw;
  const speed = Math.max(sim.groundSpeed, 0) + forward;
  sim.body.velocity.set(-Math.sin(yaw) * speed, up, -Math.cos(yaw) * speed);
  sim.body.angularVelocity.set(0, 0, 0);
  sim.spread = Math.max(sim.spread, 0.5);
  sim.legsOut = 1;
  sim.hoverBlend = 0.8;
  sim.beat.phase = Math.max(sim.beat.phase, 5.6);
  sim.leapCharge = 0;
  sim.runTakeoff = 0;
  sim.setMode('takeoff');
  sim.emit({ type: 'maneuver', id: 'takeoff', label: MANEUVER_LABELS.takeoff });
}

/** The jump off the ground: dust kicked up by the hind legs and a small camera kick. */
function groundLeap(sim: FlightSim, up: number, forward: number, dust: number): void {
  const p = sim.body.position;
  sim.emit({ type: 'dust', point: new THREE.Vector3(p.x, sim.surfaceY, p.z), strength: dust });
  sim.emit({ type: 'shake', amount: 0.14 });
  leap(sim, up, forward);
}

/** Crouch before the leap: the dragon rears a little and lifts its wings through the upstroke, ready to beat. */
function crouch(sim: FlightSim, h: number): number {
  const k = 1 - sim.leapCharge / GROUND.leapCrouch;
  sim.spread = approach(sim.spread, 0.8, 3.5, h);
  sim.sweep = approach(sim.sweep, 0, 3, h);
  sim.legsOut = 1;
  sim.hoverBlend = approach(sim.hoverBlend, 0.6, 2, h);
  sim.brake = 0;
  sim.attachment = 1;
  sim.updateInertia();
  const beat = sim.beat;
  beat.amplitude = approach(beat.amplitude, 0.9, 4, h);
  beat.effort = approach(beat.effort, 0.6, 3, h);
  beat.phase = 4.2 + 1.95 * k;
  beat.downstrokeStarted = false;
  return GROUND.leapRear * Math.sin(Math.min(k, 1) * Math.PI * 0.5);
}

export function enterGrounded(sim: FlightSim): void {
  sim.groundYaw = sim.axes.yaw();
  sim.groundSpeed = clamp(forwardSpeed(sim), -GROUND.backSpeed, GROUND.runSpeed);
  sim.body.angularVelocity.set(0, 0, 0);
  sim.body.velocity.y = 0;
  sim.legsOut = 1;
  sim.hoverBlend = 0;
  sim.brake = 0;
  sim.attachment = 1;
  sim.leapCharge = 0;
  sim.runTakeoff = 0;
  sim.maneuvers.cancel();
  sim.setMode('grounded');
}

export function enterSwimming(sim: FlightSim): void {
  sim.groundYaw = sim.axes.yaw();
  sim.groundSpeed = clamp(forwardSpeed(sim) * 0.25, 0, SWIM.fastSpeed);
  sim.body.angularVelocity.set(0, 0, 0);
  // Entry momentum is kept and bled off by hydrodynamic drag in stepSwimming (no dead stop).
  sim.body.velocity.multiplyScalar(0.85);
  sim.hoverBlend = 0;
  sim.brake = 0;
  sim.attachment = 1;
  sim.maneuvers.cancel();
  sim.setMode('swimming');
}

/** Blend the body toward a yaw + surface-aligned attitude. */
function alignBody(sim: FlightSim, up: THREE.Vector3, extraPitch: number, extraRoll: number, rate: number, h: number): void {
  const yaw = sim.groundYaw;
  _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  _forward.addScaledVector(up, -_forward.dot(up)).normalize();
  _right.crossVectors(_forward, up).normalize();
  _back.copy(_forward).negate();
  _basis.makeBasis(_right, up, _back);
  _targetQ.setFromRotationMatrix(_basis);
  if (extraPitch !== 0 || extraRoll !== 0) {
    _euler.set(extraPitch, 0, extraRoll, 'YXZ');
    sim.body.quaternion.slerp(_targetQ.multiply(_extraQ.setFromEuler(_euler)), 1 - Math.exp(-rate * h));
  } else {
    sim.body.quaternion.slerp(_targetQ, 1 - Math.exp(-rate * h));
  }
  sim.axes.update(sim.body.quaternion);
}

/**
 * Quadruped walking on terrain and rooftops (W/S walk, A/D turn, Shift run). Space/L: a crouch, then the leap
 * take-off; V (the rider's "dehh"): a galloping run into a running take-off.
 */
export function stepGrounded(sim: FlightSim, cmd: PilotCommand, h: number): void {
  const b = sim.body;
  const p = b.position;
  const collision = sim.world.collision;
  if (cmd.urgePressed && sim.leapCharge <= 0 && sim.runTakeoff <= 0 && sim.maneuvers.tryUrge(sim)) {
    sim.runTakeoff = h;
  }
  if (sim.leapCharge <= 0 && sim.runTakeoff <= 0 && (cmd.flapPressed || cmd.flap || cmd.landPressed)) {
    sim.leapCharge = GROUND.leapCrouch;
  }
  let rear = 0;
  if (sim.leapCharge > 0) {
    sim.leapCharge -= h;
    if (sim.leapCharge <= 0) {
      groundLeap(sim, GROUND.leapUp, GROUND.leapForward, 0.9);
      return;
    }
    rear = crouch(sim, h);
  }
  if (sim.runTakeoff > 0) {
    sim.runTakeoff += h;
    if (sim.runTakeoff > GROUND.runTakeoffTime || sim.groundSpeed > GROUND.runTakeoffSpeed - 0.5) {
      groundLeap(sim, GROUND.leapUp * 0.85, GROUND.leapForward * 0.5, 0.7);
      return;
    }
  }

  const run = cmd.dive;
  const fwd = clamp(cmd.pitch, -1, 1);
  const target = fwd > 0 ? fwd * (run ? GROUND.runSpeed : GROUND.walkSpeed) : fwd * GROUND.backSpeed;
  const settling = Math.abs(sim.groundSpeed) > Math.abs(target) + 1.5 && Math.abs(sim.groundSpeed) > GROUND.walkSpeed;
  if (sim.runTakeoff > 0) {
    // Galloping run-up: accelerate hard whatever W/S say.
    sim.groundSpeed = Math.min(GROUND.runTakeoffSpeed, sim.groundSpeed + GROUND.runTakeoffAccel * h);
  } else if (sim.leapCharge > 0) {
    sim.groundSpeed *= 1 - Math.min(1, 2.5 * h);
  } else {
    sim.groundSpeed += (target - sim.groundSpeed) * (1 - Math.exp(-h * (settling ? 0.9 : run ? 1.4 : 2.4)));
  }
  const turn = clamp(cmd.roll + cmd.yaw, -1, 1);
  sim.groundYawRate = (-turn * GROUND.turnRate) / (1 + Math.abs(sim.groundSpeed) * 0.08);
  sim.groundYaw += sim.groundYawRate * h;

  const fx = -Math.sin(sim.groundYaw);
  const fz = -Math.cos(sim.groundYaw);
  const nx = p.x + fx * sim.groundSpeed * h;
  const nz = p.z + fz * sim.groundSpeed * h;
  // Next ground under the standing body: a deck or an overhang above the dragon's back is not a step.
  const nextSurface = collision ? collision.columnAt(nx, nz, sim.surfaceY + sim.standHeight + sim.contacts.bellyDepth, _column).floor : sim.surfaceY;
  if (nextSurface - sim.surfaceY > GROUND.maxStep) {
    sim.groundSpeed *= 0.2;
    if (collision && sim.contacts.onWall) {
      _step.set(nx, nextSurface, nz);
      sim.contacts.onWall(collision.surfaceSource(nx, nz), 'step', -1, _step);
    }
  } else {
    p.x = nx;
    p.z = nz;
  }
  sim.sampleSurface();
  const targetY = sim.surfaceY + sim.standHeight;
  if (p.y - targetY > GROUND.dropToFall) {
    // Walked off a ledge (roof edge, cliff, quay): open the wings and fly.
    b.velocity.set(fx * sim.groundSpeed, 0, fz * sim.groundSpeed);
    sim.legsOut = 1;
    sim.setMode('takeoff');
    return;
  }
  if (sim.surfaceIsWater() && sim.terrainY < -1.2) {
    enterSwimming(sim);
    return;
  }
  const prevY = p.y;
  p.y += (targetY - p.y) * (1 - Math.exp(-h * 14));
  p.y = Math.max(p.y, targetY - 0.3);
  b.velocity.set(fx * sim.groundSpeed, (p.y - prevY) / h, fz * sim.groundSpeed);

  const onTerrain = sim.surfaceY - Math.max(sim.terrainY, 0) < 0.3;
  if (onTerrain && sim.world.geo) {
    sim.world.geo.normalAt(p.x, p.z, _normal);
  } else {
    _normal.set(0, 1, 0);
  }
  _up.set(0, 1, 0).lerp(_normal, 0.7).normalize();
  alignBody(sim, _up, rear, 0, 8, h);
  b.angularVelocity.set(0, sim.groundYawRate, 0);

  if (collision && sim.contacts.resolveWalls(b, collision, sim.impact, sim.surfaceY + GROUND.maxStep)) {
    sim.groundSpeed *= 0.4;
    if (sim.impact.speed > 2.5 && sim.impactCooldown <= 0) {
      sim.impactCooldown = 0.4;
      sim.emit({ type: 'impact', point: sim.impact.point.clone(), speed: sim.impact.speed, surface: sim.impact.surface });
    }
  }

  const speed = Math.abs(sim.groundSpeed);
  const stride = lerp(GROUND.strideWalk, GROUND.strideRun, clamp((speed - GROUND.walkSpeed) / (GROUND.runSpeed - GROUND.walkSpeed), 0, 1));
  const cadence = speed / stride + Math.abs(sim.groundYawRate) * 0.35;
  sim.walkPhase = (sim.walkPhase + Math.sign(sim.groundSpeed || 1) * TWO_PI * cadence * h + TWO_PI) % TWO_PI;
  sim.walkAmount += (clamp((speed + Math.abs(sim.groundYawRate) * 2.5) / 2.2, 0, 1) - sim.walkAmount) * (1 - Math.exp(-h * 6));

  if (sim.leapCharge > 0) {
    // crouch() already set the wings.
  } else if (sim.runTakeoff > 0) {
    // The wings open and start beating over the last strides.
    const k = smoothstep(0.3, GROUND.runTakeoffTime, sim.runTakeoff);
    sim.spread = approach(sim.spread, 0.3 + 0.6 * k, 2, h);
    sim.sweep = approach(sim.sweep, 0.2 * (1 - k), 2, h);
    sim.legsOut = 1;
    sim.brake = 0;
    sim.attachment = 1;
    sim.updateInertia();
    sim.beat.update(h, 0.25 + 0.6 * k, 0.3);
  } else {
    relaxWings(sim, 0.06, 0, h);
  }
  fillLocomotionTelemetry(sim);
}

/**
 * The water under a floating body of the dragon's size: the surface height and water velocity averaged over five
 * points (chest, head end, tail end, both flanks; a low-pass over the body, so chop much shorter than the dragon
 * rocks it little) and the surface slopes along and across the heading. Flat still water without a water service.
 */
function sampleFloat(sim: FlightSim, fx: number, fz: number): typeof _float {
  const f = _float;
  const water = sim.world.water;
  const p = sim.body.position;
  if (!water) {
    f.height = 0;
    f.slopeForward = 0;
    f.slopeRight = 0;
    f.vx = 0;
    f.vy = 0;
    f.vz = 0;
    return f;
  }
  // Right of the heading is (-fz, fx).
  const L = sim.rigLength;
  let hSum = 0;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  let front = 0;
  let back = 0;
  let right = 0;
  let left = 0;
  for (let i = 0; i < FLOAT_POINTS.length; i++) {
    const a = FLOAT_POINTS[i][0] * L;
    const r = FLOAT_POINTS[i][1] * L;
    const x = p.x + fx * a - fz * r;
    const z = p.z + fz * a + fx * r;
    const height = water.heightAt(x, z);
    water.velocityAt(x, z, _waterVelocity);
    hSum += height;
    vx += _waterVelocity.x;
    vy += _waterVelocity.y;
    vz += _waterVelocity.z;
    if (i === 1) front = height;
    else if (i === 2) back = height;
    else if (i === 3) right = height;
    else if (i === 4) left = height;
  }
  const n = FLOAT_POINTS.length;
  f.height = hSum / n;
  f.vx = vx / n;
  f.vy = vy / n;
  f.vz = vz / n;
  f.slopeForward = (front - back) / (2 * FLOAT_POINTS[1][0] * L);
  f.slopeRight = (right - left) / (2 * FLOAT_POINTS[3][1] * L);
  return f;
}

/**
 * Floating and paddling on the sea (W/S paddle, A/D turn, Space/L take off with a splash). The body floats on the
 * wave surface of the water service, pitches and rolls with it and is carried by the orbital motion and the current.
 */
export function stepSwimming(sim: FlightSim, cmd: PilotCommand, h: number): void {
  const b = sim.body;
  const p = b.position;
  const v = b.velocity;
  const urged = cmd.urgePressed && sim.maneuvers.tryUrge(sim);
  if (urged || cmd.flapPressed || cmd.flap || cmd.landPressed) {
    sim.emit({ type: 'splash', point: new THREE.Vector3(p.x, sim.waterY, p.z), strength: 1.2 });
    leap(sim, SWIM.leapUp, SWIM.leapForward);
    return;
  }
  const fast = cmd.dive;
  const fwd = clamp(cmd.pitch, -1, 1);
  const target = fwd > 0 ? fwd * (fast ? SWIM.fastSpeed : SWIM.paddleSpeed) : fwd * 1;
  sim.groundSpeed += (target - sim.groundSpeed) * (1 - Math.exp(-h * 0.9));
  const turn = clamp(cmd.roll + cmd.yaw, -1, 1);
  sim.groundYawRate = -turn * SWIM.turnRate;
  sim.groundYaw += sim.groundYawRate * h;
  const fx = -Math.sin(sim.groundYaw);
  const fz = -Math.cos(sim.groundYaw);
  const float = sampleFloat(sim, fx, fz);

  // Paddling toward the target velocity through the water (which itself moves: orbital motion + current); quadratic
  // hydrodynamic drag bleeds a fast plunge in ~0.4 s.
  const dx = fx * sim.groundSpeed + float.vx - v.x;
  const dz = fz * sim.groundSpeed + float.vz - v.z;
  const drag = 1 - Math.exp(-h * (1.6 + 0.15 * Math.hypot(dx, dz)));
  v.x += dx * drag;
  v.z += dz * drag;
  // Buoyancy toward the float depth under the (body-averaged) wave surface, damped relative to the water's heave.
  const floatY = float.height - SWIM.floatDepth;
  const vDrag = 1 - Math.exp(-h * (4 + 0.4 * Math.abs(v.y - float.vy)));
  v.y += 10 * (floatY - p.y) * h;
  v.y -= (v.y - float.vy) * vDrag;
  p.addScaledVector(v, h);
  p.y = Math.max(p.y, float.height - 2.5);

  sim.sampleSurface();
  if (!sim.overWater && sim.terrainY > -0.6) {
    enterGrounded(sim);
    return;
  }

  // Attitude: the plane through the sampled surface, a slight head-up trim.
  _up.set(-float.slopeForward * fx + float.slopeRight * fz, 1, -float.slopeForward * fz - float.slopeRight * fx).normalize();
  alignBody(sim, _up, 0.06, 0, 5, h);
  b.angularVelocity.set(0, sim.groundYawRate, 0);

  const collision = sim.world.collision;
  if (collision && sim.contacts.resolveWalls(b, collision, sim.impact)) {
    sim.groundSpeed *= 0.5;
  }

  const speed = Math.abs(sim.groundSpeed);
  sim.walkPhase = (sim.walkPhase + TWO_PI * (0.35 + speed / 1.8) * h) % TWO_PI;
  sim.walkAmount += (clamp(0.35 + speed / 3, 0, 1) - sim.walkAmount) * (1 - Math.exp(-h * 4));
  if (speed > 1.5 && sim.splashTimer > 0.7) {
    sim.splashTimer = 0;
    const sx = p.x + fx * 3;
    const sz = p.z + fz * 3;
    sim.emit({ type: 'splash', point: new THREE.Vector3(sx, sim.waterHeight(sx, sz), sz), strength: 0.12 + speed * 0.03 });
  }
  sim.touchingWater = speed > 1.5;

  relaxWings(sim, 0.22, 0.3, h);
  fillLocomotionTelemetry(sim);
}
