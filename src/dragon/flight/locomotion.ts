import * as THREE from 'three';
import { clamp } from '../../core/math/noise';
import { enterStance, stepStance } from './ground-moves';
import { MANEUVER_LABELS } from './maneuvers';
import { GRAVITY, GROUND, SWIM } from './params';
import type { FlightSim } from './sim';
import type { PilotCommand } from './types';

const TWO_PI = Math.PI * 2;
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _targetQ = new THREE.Quaternion();
const _extraQ = new THREE.Quaternion();
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

export function enterGrounded(sim: FlightSim): void {
  sim.groundYaw = sim.axes.yaw();
  sim.groundSpeed = clamp(forwardSpeed(sim), -GROUND.backSpeed, GROUND.runSpeed);
  sim.legsOut = 1;
  sim.hoverBlend = 0;
  sim.brake = 0;
  sim.attachment = 1;
  sim.leapCharge = 0;
  sim.runTakeoff = 0;
  sim.maneuvers.cancel(sim);
  // The stance starts from the touchdown's pitch, height and sink (ground-moves.ts), then settles.
  enterStance(sim, false);
  sim.body.angularVelocity.set(0, 0, 0);
  sim.body.velocity.y = 0;
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
  sim.maneuvers.cancel(sim);
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
 * Quadruped on terrain and rooftops, the run-out landing and the leaping take-off (ground-moves.ts).
 */
export function stepGrounded(sim: FlightSim, cmd: PilotCommand, h: number): void {
  stepStance(sim, cmd, h);
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
