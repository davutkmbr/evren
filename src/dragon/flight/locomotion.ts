import * as THREE from 'three';
import { clamp, smoothstep } from '../../core/math/noise';
import { enterStance, stepStance } from './ground-moves';
import { MANEUVER_LABELS } from './maneuvers';
import { FLAP, GRAVITY, GROUND, SWIM, SWIM_POSE, SWIM_SEA } from './params';
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
const _float = { height: 0, centre: 0, saddle: 0, slopeForward: 0, slopeRight: 0, vx: 0, vy: 0, vz: 0 };

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
  sim.leapCharge = 0;
  sim.runTakeoff = 0;
  sim.runDuration = 0;
  // The rocking starts level and picks up the waves (the settle-in blends the body toward it).
  sim.seaPitch = 0;
  sim.seaRoll = 0;
  sim.seaPitchRate = 0;
  sim.seaRollRate = 0;
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
    f.centre = 0;
    f.saddle = 0;
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
    if (i === 0) f.centre = height;
    else if (i === 1) front = height;
    else if (i === 2) back = height;
    else if (i === 3) right = height;
    else if (i === 4) left = height;
  }
  const n = FLOAT_POINTS.length;
  f.height = hSum / n;
  // Under the saddle (between the chest and the head-end point, approximately): the rider's water.
  f.saddle = Math.max(f.centre, 0.5 * (f.centre + front));
  f.vx = vx / n;
  f.vy = vy / n;
  f.vz = vz / n;
  f.slopeForward = (front - back) / (2 * FLOAT_POINTS[1][0] * L);
  f.slopeRight = (right - left) / (2 * FLOAT_POINTS[3][1] * L);
  return f;
}

/** Wading water turns into swimming here: the seabed is deeper than the floating body's legs reach (SWIM_POSE). */
export function floatsHere(sim: FlightSim): boolean {
  return sim.terrainY < sim.waterY - (sim.standHeight + SWIM.floatDepth + SWIM_POSE.floatMargin);
}

/** A swimming dragon's feet reach the seabed here (or it has left the water): it stands up and wades. */
function wadesHere(sim: FlightSim): boolean {
  if (!sim.overWater) {
    return sim.terrainY > -0.6;
  }
  return sim.terrainY > sim.waterY - (sim.standHeight + SWIM.floatDepth - SWIM_POSE.wadeMargin);
}

/** Wing-beat phase at which a running take-off's downstroke slaps the water (late in the downstroke). */
const SLAP_PHASE = TWO_PI * FLAP.downstrokeFraction * 0.85;

/**
 * Floating and swimming on the sea (W/S swim, Shift fast, A/D turn, Space/L the take-off run into the leap).
 * The body floats on the wave surface of the water service, pitches and rolls with it and is carried by the orbital
 * motion and the current. The stroke (swimPhase / swimStroke) is the whole-body swim of the rig (the wave down the body
 * and tail, the paddling wings, the kicking hind legs); its frequency and strength follow the speed through the water,
 * and each wing's power stroke surges the body forward.
 */
export function stepSwimming(sim: FlightSim, cmd: PilotCommand, h: number): void {
  const b = sim.body;
  const p = b.position;
  const v = b.velocity;
  // The sea the dragon swims in (phase 21 stage 6): the local significant wave height (0 on flat stand-in water).
  const hs = sim.world.water?.significantHeightAt?.(p.x, p.z) ?? 0;
  sim.seaHs = Number.isFinite(hs) ? Math.max(hs, 0) : 0;
  const rough = seaRoughness(sim.seaHs);
  // Space / L: the take-off run on the surface (wings beating the water), then the leap. Rough seas make it longer.
  if (sim.runTakeoff <= 0 && (cmd.flapPressed || cmd.flap || cmd.landPressed)) {
    sim.runTakeoff = h;
    sim.runDuration = waterRunDuration(sim.seaHs);
  }
  const running = sim.runTakeoff > 0;
  const runLength = sim.runDuration > 0 ? sim.runDuration : SWIM_POSE.runTime;
  const run = running ? clamp(sim.runTakeoff / runLength, 0, 1) : 0;
  if (running) {
    sim.runTakeoff += h;
    // Beating through big waves costs stamina on top of the beats' own effort.
    sim.stamina = Math.max(0, sim.stamina - (SWIM_SEA.runStamina * rough * h) / runLength);
    const crest = crestLift(sim, runLength);
    if (sim.runTakeoff >= runLength || crest >= 0) {
      sim.emit({ type: 'splash', point: new THREE.Vector3(p.x, sim.waterY, p.z), strength: 1.2 });
      leap(sim, SWIM.leapUp + Math.max(crest, 0), SWIM.leapForward);
      return;
    }
  }
  const fast = cmd.dive;
  const fwd = clamp(cmd.pitch, -1, 1);
  if (running) {
    sim.groundSpeed = Math.min(SWIM_POSE.runSpeed, sim.groundSpeed + SWIM_POSE.runAccel * (1 - SWIM_SEA.runAccelLoss * rough) * h);
  } else {
    const target = fwd > 0 ? fwd * (fast ? SWIM.fastSpeed : SWIM.paddleSpeed) : fwd * 1;
    sim.groundSpeed += (target - sim.groundSpeed) * (1 - Math.exp(-h * 0.9));
  }
  const turn = clamp(cmd.roll + cmd.yaw, -1, 1);
  sim.groundYawRate = -turn * SWIM.turnRate * (running ? 0.5 : 1);
  sim.groundYaw += sim.groundYawRate * h;
  const fx = -Math.sin(sim.groundYaw);
  const fz = -Math.cos(sim.groundYaw);
  const float = sampleFloat(sim, fx, fz);

  // Swimming toward the target velocity through the water (which itself moves: orbital motion + current); quadratic
  // hydrodynamic drag bleeds a fast plunge in ~0.4 s.
  const dx = fx * sim.groundSpeed + float.vx - v.x;
  const dz = fz * sim.groundSpeed + float.vz - v.z;
  const drag = 1 - Math.exp(-h * (1.6 + 0.15 * Math.hypot(dx, dz)));
  v.x += dx * drag;
  v.z += dz * drag;
  // Surge: each wing's power stroke pushes the body on (two per cycle), a zero-mean thrust on top of the drag toward the
  // swim speed, so the average speed is unchanged and the speed swings by about ±SWIM_POSE.surge of it.
  if (!running && sim.swimStroke > 0.05) {
    const omega = 2 * TWO_PI * sim.swimFreq;
    const thrust = SWIM_POSE.surge * Math.abs(sim.groundSpeed) * omega * Math.cos(2 * (sim.swimPhase - SWIM_POSE.surgePhase));
    v.x += fx * thrust * h;
    v.z += fz * thrust * h;
  }
  // Buoyancy toward the float depth under the (body-averaged) wave surface, damped relative to the water's heave. The
  // take-off run lifts the body onto the surface.
  // Swimming on, the chest rides up on its bow wave.
  const speedK = smoothstep(0, SWIM.fastSpeed, Math.abs(sim.groundSpeed));
  const swimDepth = SWIM.floatDepth - SWIM_POSE.speedRise * speedK;
  const depth = swimDepth + (SWIM_POSE.runRiseDepth - swimDepth) * run * run * (3 - 2 * run);
  const floatY = float.height - depth;
  const vDrag = 1 - Math.exp(-h * (4 + 0.4 * Math.abs(v.y - float.vy)));
  v.y += 10 * (floatY - p.y) * h;
  v.y -= (v.y - float.vy) * vDrag;
  // Settling in after a landing or a plunge's surfacing: the body sinks into the float no faster than this.
  if (sim.modeTime < SWIM_POSE.settleTime) {
    v.y = Math.max(v.y, float.vy - SWIM_POSE.settleSink);
  }
  p.addScaledVector(v, h);
  p.y = Math.max(p.y, float.height - 2.5);
  // A crest passing under the chest and saddle lifts the body (the body-averaged float lags a short steep crest): the
  // rider stays dry.
  const dryY = float.saddle - depth - SWIM_SEA.dryMargin;
  if (sim.modeTime >= SWIM_POSE.settleTime && p.y < dryY) {
    p.y = dryY;
    v.y = Math.max(v.y, float.vy);
  }

  sim.sampleSurface();
  if (!running && wadesHere(sim)) {
    // The feet reach the seabed: stand up and wade (the stance starts from the floating height and settles).
    if (sim.overWater) {
      sim.surfaceY = sim.terrainY;
    }
    enterGrounded(sim);
    return;
  }

  // Attitude: the body rocks about the plane through the sampled surface (a damped oscillator: big long waves rock it
  // more than their slope, short chop less), a slight head-up trim (more while running on the water).
  rockOnWaves(sim, float.slopeForward, float.slopeRight, h);
  const tp = Math.tan(sim.seaPitch);
  const tr = Math.tan(sim.seaRoll);
  _up.set(-tp * fx + tr * fz, 1, -tp * fz - tr * fx).normalize();
  alignBody(sim, _up, 0.06 + SWIM_POSE.speedTrim * speedK + 0.1 * run, 0, sim.modeTime < SWIM_POSE.settleTime ? SWIM_POSE.settleAlign : SWIM_SEA.alignRate, h);
  b.angularVelocity.set(0, sim.groundYawRate, 0);

  const collision = sim.world.collision;
  if (collision && sim.contacts.resolveWalls(b, collision, sim.impact)) {
    sim.groundSpeed *= 0.5;
  }

  // The stroke: frequency and strength from the speed through the water (Shift's fast swim beats harder and quicker);
  // no walk cycle while floating.
  const speed = Math.abs(sim.groundSpeed);
  const fastK = smoothstep(SWIM.paddleSpeed, SWIM.fastSpeed, speed);
  const freq = running ? SWIM_POSE.runFreq : (SWIM_POSE.freqIdle + SWIM_POSE.freqPerSpeed * speed) * (1 + (SWIM_POSE.fastFreq - 1) * fastK);
  const strokeTarget = running
    ? SWIM_POSE.strokeFast
    : SWIM_POSE.strokeIdle + (SWIM_POSE.strokePaddle - SWIM_POSE.strokeIdle) * smoothstep(0, SWIM.paddleSpeed, speed) + (SWIM_POSE.strokeFast - SWIM_POSE.strokePaddle) * fastK;
  sim.swimStroke += (strokeTarget - sim.swimStroke) * (1 - Math.exp(-h * SWIM_POSE.strokeRate));
  sim.swimFreq = freq;
  const prevPhase = sim.swimPhase;
  sim.swimPhase = (sim.swimPhase + TWO_PI * freq * h) % TWO_PI;
  if (!running) {
    paddleSpray(sim, prevPhase, sim.swimPhase, fx, fz, fastK);
  }
  sim.walkAmount = 0;
  // No splash events while swimming: the stroke's water sounds (the wing paddles, the lapping along the flanks) are the
  // audio system's, driven from the pose.
  sim.touchingWater = speed > 1.5 || running;

  if (running) {
    // Wings open and beat, the downstrokes slapping the water at both tips.
    const prevBeat = sim.beat.phase;
    sim.spread = approach(sim.spread, SWIM_POSE.runSpread, 3, h);
    sim.sweep = approach(sim.sweep, 0, 2, h);
    sim.legsOut = approach(sim.legsOut, 1, 2, h);
    sim.hoverBlend = approach(sim.hoverBlend, 0.4, 2, h);
    sim.brake = 0;
    sim.attachment = 1;
    sim.updateInertia();
    sim.beat.update(h, SWIM_POSE.runEffort, sim.hoverBlend, SWIM_POSE.runAmplitude);
    const beat = sim.beat.phase;
    if (prevBeat < SLAP_PHASE && beat >= SLAP_PHASE && sim.beat.amplitude > 0.3) {
      const span = SWIM_POSE.runSlapSpan * sim.rigLength;
      for (const side of [-1, 1]) {
        const sx = p.x - fz * span * side;
        const sz = p.z + fx * span * side;
        sim.emit({ type: 'splash', point: new THREE.Vector3(sx, sim.waterHeight(sx, sz), sz), strength: SWIM_POSE.runSlap });
      }
    }
  } else {
    // Wings folded tight along the back.
    relaxWings(sim, 0, 0.3, h);
  }
  fillLocomotionTelemetry(sim);
}

/** 0..1 how rough the sea is for a water take-off (local significant wave height, SWIM_SEA.roughLo..roughHi). */
export function seaRoughness(hs: number): number {
  return Number.isFinite(hs) ? smoothstep(SWIM_SEA.roughLo, SWIM_SEA.roughHi, hs) : 0;
}

/** Length (s) of a water take-off run in a sea of significant wave height `hs` (m): longer in rough seas. */
export function waterRunDuration(hs: number): number {
  return SWIM_POSE.runTime * (1 + SWIM_SEA.runLonger * seaRoughness(hs));
}

/**
 * A wave crest under the running dragon: once the run is old enough (SWIM_SEA.crestMinRun of the calm run) in a sea
 * with real crests, riding one (the body-averaged surface high and not falling fast) gives the leap early. Returns the
 * extra upward speed the rising water adds to the leap (m/s, >= 0), or -1 without a crest.
 */
function crestLift(sim: FlightSim, runLength: number): number {
  if (sim.seaHs < SWIM_SEA.crestMinHs || sim.runTakeoff < SWIM_SEA.crestMinRun * SWIM_POSE.runTime || sim.runTakeoff >= runLength) {
    return -1;
  }
  const f = _float;
  if (f.height > SWIM_SEA.crestShare * sim.seaHs && f.vy > -SWIM_SEA.crestSink) {
    return SWIM_SEA.crestLift * Math.max(f.vy, 0);
  }
  return -1;
}

/**
 * The floating body's rocking on the waves: pitch and roll as lightly damped oscillators (natural periods and damping
 * of SWIM_SEA) driven by the slope of the plane through the body-averaged surface; bounded (the rider stays on top).
 */
function rockOnWaves(sim: FlightSim, slopeForward: number, slopeRight: number, h: number): void {
  const wp = TWO_PI / SWIM_SEA.pitchPeriod;
  const wr = TWO_PI / SWIM_SEA.rollPeriod;
  const z = SWIM_SEA.damping;
  const tp = Number.isFinite(slopeForward) ? Math.atan(slopeForward) : 0;
  const tr = Number.isFinite(slopeRight) ? Math.atan(slopeRight) : 0;
  sim.seaPitchRate += (wp * wp * (tp - sim.seaPitch) - 2 * z * wp * sim.seaPitchRate) * h;
  sim.seaRollRate += (wr * wr * (tr - sim.seaRoll) - 2 * z * wr * sim.seaRollRate) * h;
  sim.seaPitch += sim.seaPitchRate * h;
  sim.seaRoll += sim.seaRollRate * h;
  if (!Number.isFinite(sim.seaPitch + sim.seaRoll + sim.seaPitchRate + sim.seaRollRate)) {
    sim.seaPitch = 0;
    sim.seaRoll = 0;
    sim.seaPitchRate = 0;
    sim.seaRollRate = 0;
  }
  if (Math.abs(sim.seaPitch) > SWIM_SEA.maxPitch) {
    sim.seaPitch = Math.sign(sim.seaPitch) * SWIM_SEA.maxPitch;
    sim.seaPitchRate = 0;
  }
  if (Math.abs(sim.seaRoll) > SWIM_SEA.maxRoll) {
    sim.seaRoll = Math.sign(sim.seaRoll) * SWIM_SEA.maxRoll;
    sim.seaRollRate = 0;
  }
}

/** True when the phase stepped across `at` (radians, both in [0, 2pi)), including across the wrap. */
function crossed(prev: number, cur: number, at: number): boolean {
  return prev <= cur ? prev < at && cur >= at : prev < at || cur >= at;
}

/**
 * Visible water from the swimming stroke (the sounds are the audio's): each wing's catch throws a spray where the hand
 * enters beside the shoulder, the lift-out at the end of its power stroke sheds a trail of drops behind it, and the
 * tail churns the water at each reversal of a fast swim. The phase conventions are the rig's: the left catch at 0, the
 * right at pi, the power stroke ending SWIM_POSE.paddlePowerPhase later.
 */
function paddleSpray(sim: FlightSim, prev: number, cur: number, fx: number, fz: number, fastK: number): void {
  const k = sim.swimStroke;
  if (k < SWIM_POSE.sprayMinStroke) {
    return;
  }
  const L = sim.rigLength;
  const p = sim.body.position;
  const at = (side: number, lateral: number, forward: number, strength: number): void => {
    // right = (-fz, fx) in the ground plane (fx, fz = forward).
    const x = p.x + fx * forward * L - fz * lateral * L * side;
    const z = p.z + fz * forward * L + fx * lateral * L * side;
    sim.emit({ type: 'spray', point: new THREE.Vector3(x, sim.waterHeight(x, z), z), strength });
  };
  const power = SWIM_POSE.paddlePowerPhase;
  for (const [side, catchAt] of [
    [-1, 0],
    [1, Math.PI],
  ] as const) {
    if (crossed(prev, cur, catchAt)) {
      at(side, SWIM_POSE.sprayCatchOut, SWIM_POSE.sprayCatchForward, SWIM_POSE.sprayCatch * k);
    }
    if (crossed(prev, cur, (catchAt + power) % TWO_PI)) {
      at(side, SWIM_POSE.sprayLiftOut, SWIM_POSE.sprayLiftForward, SWIM_POSE.sprayLift * k);
    }
  }
  if (fastK > 0.2 && (crossed(prev, cur, Math.PI / 2) || crossed(prev, cur, 1.5 * Math.PI))) {
    at(0, 0, -SWIM_POSE.sprayTailBack, SWIM_POSE.sprayTail * fastK);
  }
}
