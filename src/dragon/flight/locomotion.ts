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
  sim.maneuvers.cancel();
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
 * Quadruped on terrain and rooftops, the run-out landing and the leaping take-off (ground-moves.ts).
 */
export function stepGrounded(sim: FlightSim, cmd: PilotCommand, h: number): void {
  stepStance(sim, cmd, h);
}

/** Floating and paddling on the sea (W/S paddle, A/D turn, Space/L take off with a splash). */
export function stepSwimming(sim: FlightSim, cmd: PilotCommand, h: number): void {
  const b = sim.body;
  const p = b.position;
  const v = b.velocity;
  const urged = cmd.urgePressed && sim.maneuvers.tryUrge(sim);
  if (urged || cmd.flapPressed || cmd.flap || cmd.landPressed) {
    sim.emit({ type: 'splash', point: new THREE.Vector3(p.x, 0, p.z), strength: 1.2 });
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

  // Paddling toward the target velocity; quadratic hydrodynamic drag bleeds a fast plunge in ~0.4 s.
  const dx = fx * sim.groundSpeed - v.x;
  const dz = fz * sim.groundSpeed - v.z;
  const drag = 1 - Math.exp(-h * (1.6 + 0.15 * Math.hypot(dx, dz)));
  v.x += dx * drag;
  v.z += dz * drag;
  const bob = 0.12 * Math.sin(sim.time * 1.35) + 0.05 * Math.sin(sim.time * 2.9 + 1.3);
  const floatY = -SWIM.floatDepth + bob;
  const vDrag = 1 - Math.exp(-h * (4 + 0.4 * Math.abs(v.y)));
  v.y += 10 * (floatY - p.y) * h;
  v.y -= v.y * vDrag;
  p.addScaledVector(v, h);
  p.y = Math.max(p.y, -2.5);

  sim.sampleSurface();
  if (!sim.overWater && sim.terrainY > -0.6) {
    enterGrounded(sim);
    return;
  }

  _up.set(0, 1, 0);
  alignBody(sim, _up, 0.06 + 0.035 * Math.sin(sim.time * 1.35 + 0.8), 0.045 * Math.sin(sim.time * 0.95), 5, h);
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
    sim.emit({ type: 'splash', point: new THREE.Vector3(p.x + fx * 3, 0, p.z + fz * 3), strength: 0.12 + speed * 0.03 });
  }
  sim.touchingWater = speed > 1.5;

  relaxWings(sim, 0.22, 0.3, h);
  fillLocomotionTelemetry(sim);
}
