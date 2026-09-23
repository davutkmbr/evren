import * as THREE from 'three';
import { clamp, lerp } from '../../core/math/noise';
import {
  airDensity,
  attachedLift,
  ceilingFactor,
  evaluateWingShape,
  groundEffectInduced,
  groundEffectLift,
  liftCoefficient,
  separatedDrag,
  staticAttachment,
} from './aero';
import { integrateOrientation } from './body';
import { enterGrounded, enterSwimming } from './locomotion';
import { BODY, ENVELOPE, FLAP, GRAVITY, MASS, MOMENTS, PROXIMITY, SEA_LEVEL_DENSITY, WATER_DENSITY, WING } from './params';
import type { FlightSim } from './sim';
import type { PilotCommand } from './types';
import { maxAmplitudeForClearance } from './wingtip';

const _invQ = new THREE.Quaternion();
const _airBody = new THREE.Vector3();
const _flow = new THREE.Vector3();
const _liftDir = new THREE.Vector3();
const _sideDir = new THREE.Vector3();
const _force = new THREE.Vector3();
const _flapDir = new THREE.Vector3();
const _aeroMoment = new THREE.Vector3();
const _angMomentum = new THREE.Vector3();
const _gyro = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _splashPoint = new THREE.Vector3();

function approach(current: number, target: number, rate: number, h: number): number {
  const d = target - current;
  const step = rate * h;
  return current + (d > step ? step : d < -step ? -step : d);
}

/** One airborne substep: assist controller, aerodynamics, flapping, rigid-body integration, contacts, water. */
export function stepAirborne(sim: FlightSim, cmd: PilotCommand, h: number): void {
  const b = sim.body;
  const axes = sim.axes;
  const p = b.position;
  const v = b.velocity;
  const w = b.angularVelocity;

  // --- air data -------------------------------------------------------------------------
  const wind = sim.wind;
  wind.baseEnabled = sim.options.wind;
  wind.gustsEnabled = sim.options.turbulence;
  wind.thermalsEnabled = sim.options.thermals;
  wind.sample(h, p, Math.max(sim.agl, 0), sim.overWater, sim.airspeed, sim.time, sim.world.env, sim.world.geo);
  sim.airVelocity.copy(v).sub(wind.velocity);
  const V = sim.airVelocity.length();
  sim.airspeed = V;
  _invQ.copy(b.quaternion).invert();
  _airBody.copy(sim.airVelocity).applyQuaternion(_invQ);
  sim.alpha = Math.atan2(-_airBody.y, -_airBody.z);
  sim.beta = V > 0.5 ? Math.asin(clamp(_airBody.x / V, -1, 1)) : 0;
  sim.bank = axes.bank();
  sim.pitch = axes.pitch();
  sim.gamma = V > 6 ? Math.asin(clamp(sim.airVelocity.y / V, -1, 1)) : sim.pitch;

  // --- assist layer -----------------------------------------------------------------------
  sim.controller.update(sim, cmd, h);
  const t = sim.targets;

  // --- wing configuration dynamics (muscle-limited) ---------------------------------------
  sim.spread = approach(sim.spread, t.spread, t.spread < sim.spread ? 2.6 : 1.8, h);
  sim.sweep = approach(sim.sweep, t.sweep, 3, h);
  sim.brake = approach(sim.brake, t.brake, 4, h);
  sim.legsOut = approach(sim.legsOut, t.legsOut, 1.3, h);
  sim.hoverBlend = approach(sim.hoverBlend, t.hover, 1.6, h);
  sim.updateInertia();
  const shape = evaluateWingShape(sim.spread, sim.sweep, sim.legsOut, sim.wing);

  // --- lift / drag ------------------------------------------------------------------------
  const alphaWing = sim.alpha + WING.incidence;
  const attachTarget = staticAttachment(alphaWing);
  const tau = attachTarget < sim.attachment ? WING.separationTau : WING.reattachTau;
  sim.attachment += (attachTarget - sim.attachment) * (1 - Math.exp(-h / tau));

  const rho = airDensity(p.y);
  const thin = ceilingFactor(p.y);
  const qbar = 0.5 * rho * V * V;
  const wingHeight = sim.agl + WING.rootHeight;
  const geInduced = groundEffectInduced(wingHeight, shape.span);
  const geLift = sim.overWater || sim.agl < 60 ? groundEffectLift(wingHeight, shape.span) : 0;

  const clAttached = attachedLift(alphaWing, shape.liftSlope) * sim.attachment;
  const cl = liftCoefficient(alphaWing, sim.attachment, shape.liftSlope) * (1 + geLift) * thin;
  const cdi = shape.inducedFactor * clAttached * clAttached * geInduced;
  const cdSep = (1 - sim.attachment) * separatedDrag(alphaWing);
  const liftMag = qbar * shape.area * cl;
  const dragMag = qbar * (shape.area * (cdi + cdSep) + shape.parasiteArea + sim.brake * BODY.brakeCdA);
  const sideMag = qbar * BODY.sideArea * BODY.sideForceSlope * sim.beta;
  sim.lift = liftMag;
  sim.drag = dragMag;

  _force.set(0, 0, 0);
  if (V > 0.05) {
    _flow.copy(sim.airVelocity).divideScalar(V);
    _liftDir.crossVectors(axes.right, _flow);
    const ll = _liftDir.length();
    if (ll > 1e-3) {
      _force.addScaledVector(_liftDir, liftMag / ll);
    }
    _force.addScaledVector(_flow, -dragMag);
    _sideDir.copy(axes.right).addScaledVector(_flow, -axes.right.dot(_flow));
    const sl = _sideDir.length();
    if (sl > 1e-3) {
      _force.addScaledVector(_sideDir, sideMag / sl);
    }
  }

  sim.aeroVertical = _force.y;

  // --- flapping ---------------------------------------------------------------------------
  const beat = sim.beat;
  // Near a surface the stroke gets shallower so the lower wingtip clears it at the bottom of the downstroke
  // (every airborne mode: cruising, hovering, landing and take-off).
  const cruising = sim.mode === 'flying' || sim.mode === 'gliding' || sim.mode === 'diving' || sim.mode === 'stalling';
  const clearAmplitude = maxAmplitudeForClearance(sim.agl, sim.sweep, shape.span, sim.pitch, sim.bank, PROXIMITY.strokeMargin);
  const ampLimit = Math.max(clearAmplitude, cruising ? PROXIMITY.minAmplitudeCruise : PROXIMITY.minAmplitudeHover);
  beat.update(h, t.effort, sim.hoverBlend, ampLimit);
  if (beat.downstrokeStarted) {
    sim.emit({ type: 'flap', strength: clamp(beat.amplitude * (0.45 + 0.55 * beat.effort), 0, 1) });
  }
  const forwardAir = Math.max(0, -_airBody.z);
  const efficiency = 1 / (1 + (forwardAir / FLAP.speedFalloff) ** 2);
  const ratio = lerp(FLAP.forwardRatio, FLAP.hoverRatio, sim.hoverBlend);
  const flapMean = MASS * GRAVITY * ratio * beat.forceScale() * efficiency * thin * Math.sqrt(rho / SEA_LEVEL_DENSITY);
  const flapNow = flapMean * beat.profile();
  sim.flapForce = flapMean;
  const stroke = lerp(FLAP.strokeAngle, FLAP.hoverStrokeAngle, sim.hoverBlend);
  _flapDir.copy(axes.forward).multiplyScalar(Math.cos(stroke)).addScaledVector(axes.up, Math.sin(stroke));
  _force.addScaledVector(_flapDir, flapNow);

  // --- water skim --------------------------------------------------------------------------
  if (applyWaterSkim(sim, h)) {
    return;
  }

  // --- soft world boundary -------------------------------------------------------------------
  const outX = Math.abs(p.x) - ENVELOPE.boundaryHard;
  const outZ = Math.abs(p.z) - ENVELOPE.boundaryHard;
  if (outX > 0) {
    _force.x -= Math.sign(p.x) * MASS * Math.min(outX * 0.02, 3);
  }
  if (outZ > 0) {
    _force.z -= Math.sign(p.z) * MASS * Math.min(outZ * 0.02, 3);
  }

  sim.specificForce.copy(_force).divideScalar(MASS);
  sim.loadFactor = sim.specificForce.dot(axes.up) / GRAVITY;
  _force.y -= MASS * GRAVITY;

  // --- moments -----------------------------------------------------------------------------
  const Vd = Math.max(V, 5);
  const chord = shape.chord;
  const span = shape.span;
  const S = shape.area;
  _aeroMoment.set(
    -qbar * S * chord * (MOMENTS.pitchStability * Math.sin(sim.alpha - MOMENTS.alphaTrim) * (0.4 + 0.6 * sim.attachment) + (MOMENTS.pitchDamping * w.x * chord) / (2 * Vd)),
    -qbar * BODY.sideArea * MOMENTS.tailArm * MOMENTS.weathervane * sim.beta - (qbar * S * span * MOMENTS.yawDamping * w.y * span) / (2 * Vd),
    qbar * S * span * (MOMENTS.dihedral * sim.beta - (MOMENTS.rollDamping * w.z * span) / (2 * Vd) + 0.02 * wind.rollGust),
  );

  const weightArm = MASS * GRAVITY * MOMENTS.flapArm * beat.amplitude;
  const controlScale = thin * (0.35 + 0.65 * sim.attachment);
  sim.controlCapacity.set(
    qbar * S * chord * MOMENTS.controlPitch * controlScale + weightArm * MOMENTS.flapPitch + 4000,
    qbar * S * span * MOMENTS.controlYaw * controlScale + weightArm * MOMENTS.flapYaw + 3000,
    qbar * S * span * MOMENTS.controlRoll * controlScale + weightArm * MOMENTS.flapRoll + 2000,
  );

  const I = sim.inertia;
  _angMomentum.set(w.x * I.x, w.y * I.y, w.z * I.z);
  _gyro.crossVectors(w, _angMomentum);
  _desired.set(
    I.x * MOMENTS.gainPitch * (t.rate.x - w.x) + _gyro.x - _aeroMoment.x,
    I.y * MOMENTS.gainYaw * (t.rate.y - w.y) + _gyro.y - _aeroMoment.y,
    I.z * MOMENTS.gainRoll * (t.rate.z - w.z) + _gyro.z - _aeroMoment.z,
  );
  const cap = sim.controlCapacity;
  sim.controlMoment.set(clamp(_desired.x, -cap.x, cap.x), clamp(_desired.y, -cap.y, cap.y), clamp(_desired.z, -cap.z, cap.z));

  // Body pitching with the wing beat (a disturbance the rate loop only partly cancels).
  const beatPitch = I.x * 3 * beat.amplitude * beat.effort * Math.cos(beat.phase);

  // --- integrate ---------------------------------------------------------------------------
  w.x += ((_aeroMoment.x + sim.controlMoment.x + beatPitch - _gyro.x) / I.x) * h;
  w.y += ((_aeroMoment.y + sim.controlMoment.y - _gyro.y) / I.y) * h;
  w.z += ((_aeroMoment.z + sim.controlMoment.z - _gyro.z) / I.z) * h;
  v.addScaledVector(_force, h / MASS);
  p.addScaledVector(v, h);
  integrateOrientation(b.quaternion, w, h);
  axes.update(b.quaternion);

  // --- contacts ----------------------------------------------------------------------------
  const collision = sim.world.collision;
  if (collision) {
    sim.contacts.tailEnabled = sim.mode !== 'landing' && sim.mode !== 'hovering' && sim.mode !== 'takeoff';
    sim.contacts.resolveAirborne(b, collision, sim.invInertia, MASS, sim.impact);
    const n = sim.impact.normal;
    if (sim.impact.speed > 4 && Math.abs(n.y) < 0.7) {
      // Bounced off a wall: remember a heading that leads away from it (mirror of the approach).
      const fx = axes.forward.x;
      const fz = axes.forward.z;
      const nl = Math.hypot(n.x, n.z);
      const nx = n.x / nl;
      const nz = n.z / nl;
      const d = fx * nx + fz * nz;
      sim.escapeDirection.set(fx - 2 * Math.min(d, 0) * nx, 0, fz - 2 * Math.min(d, 0) * nz).normalize();
      sim.escapeTimer = 3;
    }
    if (sim.impact.speed > 2.5 && sim.impactCooldown <= 0) {
      sim.impactCooldown = 0.3;
      sim.emit({ type: 'impact', point: sim.impact.point.clone(), speed: sim.impact.speed, surface: sim.impact.surface });
      if (sim.impact.speed > 6) {
        sim.attachment = Math.min(sim.attachment, 0.5);
      }
    } else if (sim.impact.touched && sim.dustTimer > 0.2) {
      // Sliding contact (belly or tail dragging over ground/roofs): a trail of dust.
      const slide = Math.hypot(v.x, v.z);
      if (slide > 4) {
        sim.dustTimer = 0;
        sim.emit({ type: 'dust', point: new THREE.Vector3(p.x, sim.surfaceY, p.z), strength: clamp(slide / 30, 0.15, 0.7) });
      }
    }
  }

  checkTouchdown(sim, h);
}

/** Feet/belly/tail skimming the sea surface: hydrodynamic drag, planing lift, splashes, or plunging in. */
function applyWaterSkim(sim: FlightSim, h: number): boolean {
  if (!sim.overWater) {
    return false;
  }
  const p = sim.body.position;
  const v = sim.body.velocity;
  const immersion = sim.footDepth() - p.y;
  if (immersion <= 0) {
    // Primed: the first contact of a skim always throws spray.
    sim.splashDistance = 1e3;
    return false;
  }
  sim.touchingWater = true;
  const speed = v.length();
  const depth = Math.min(immersion, 1.5);
  const area = 0.04 + 0.5 * depth * depth;
  const dragMag = 0.5 * WATER_DENSITY * speed * speed * area * 0.35;
  if (speed > 0.1) {
    _force.addScaledVector(v, -dragMag / speed);
  }
  const planing = 0.5 * WATER_DENSITY * speed * speed * 0.012 * depth;
  _force.y += MASS * GRAVITY * Math.min(depth * 1.1, 2.2) + planing - v.y * MASS * 1.5;

  // Spray spaced by distance travelled; its size grows with immersion depth and speed², so light skims leave a
  // thin trail and only deep, fast contacts throw big bursts.
  sim.splashDistance += speed * h;
  const spacing = 4 + speed * 0.12;
  if (sim.splashDistance > spacing && sim.splashTimer > 0.12 && speed > 3) {
    sim.splashDistance = 0;
    sim.splashTimer = 0;
    _splashPoint.set(p.x, 0, p.z).addScaledVector(v, -0.06);
    const strength = clamp(0.06 + 0.85 * depth * (speed / 28) ** 2, 0.06, 1.1);
    sim.emit({ type: 'splash', point: _splashPoint.clone(), strength });
  }
  const horizontal = Math.hypot(v.x, v.z);
  const grace = sim.mode === 'takeoff' && sim.modeTime < 2.5;
  // Hovering or landing onto the sea: settle into swimming as soon as the feet are wet.
  const settling = (sim.mode === 'landing' || sim.mode === 'hovering') && horizontal < 9 && immersion > 0.05;
  if (!grace && (settling || (horizontal < 9 && immersion > 0.3) || immersion > 1.8)) {
    const point = new THREE.Vector3(p.x, 0, p.z);
    sim.emit({ type: 'splash', point, strength: clamp(0.3 + speed / 12, 0.4, 2) });
    if (speed > 8) {
      sim.emit({ type: 'impact', point: point.clone(), speed, surface: 'water' });
    }
    sim.emit({ type: 'landed', point: point.clone(), speed: Math.max(-v.y, 0), water: true });
    enterSwimming(sim);
    return true;
  }
  return false;
}

function checkTouchdown(sim: FlightSim, h: number): void {
  if (sim.legsOut < 0.5 || sim.overWater || sim.mode === 'takeoff') {
    return;
  }
  sim.sampleSurface();
  // A settling landing touches down within a hand's breadth (the wing-beat bob would otherwise keep it hanging).
  const touch = sim.mode === 'landing' && sim.body.velocity.y < 0.6 ? 0.15 : 0.02;
  if (sim.footClearance > touch) {
    return;
  }
  const b = sim.body;
  const v = b.velocity;
  const horizontal = Math.hypot(v.x, v.z);
  if (v.y < -9) {
    return;
  }
  if (horizontal < 8) {
    sim.emit({ type: 'landed', point: new THREE.Vector3(b.position.x, sim.surfaceY, b.position.z), speed: Math.max(-v.y, 0), water: false });
    enterGrounded(sim);
    return;
  }
  // Running touchdown: the hind feet take the weight and skid/run the speed off.
  b.position.y -= sim.footClearance;
  if (v.y < -3 && sim.impactCooldown <= 0) {
    sim.impactCooldown = 0.3;
    sim.emit({ type: 'impact', point: new THREE.Vector3(b.position.x, sim.surfaceY, b.position.z), speed: -v.y, surface: 'ground' });
  }
  v.y = Math.max(v.y, 0);
  const decel = Math.exp(-h * 0.9);
  v.x *= decel;
  v.z *= decel;
  if (sim.splashTimer > 0.18) {
    sim.splashTimer = 0;
    sim.emit({ type: 'dust', point: new THREE.Vector3(b.position.x, sim.surfaceY, b.position.z), strength: clamp(horizontal / 20, 0.15, 0.6) });
  }
}
