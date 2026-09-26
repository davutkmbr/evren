/**
 * The sea as a place (phase 21 stage 3): the plunge dive, under-water movement and the breach.
 *
 * - Plunge ("dalış"): a steep dive with folded wings (Shift dive, free fall) toward water that is fit for it arms the
 *   plunge: the dive floor of the assist then lets the dragon into the water instead of pulling out 2 m above it, and
 *   at the first contact it enters the water (splash column and crown, an impact on 'water') instead of skimming.
 *   Water that is not fit (seabed closer than PLUNGE.minDepth at the entry and along the next PLUNGE.reach m, a hull,
 *   a pier or a quay within PLUNGE.hullMargin, the coastline within PLUNGE.shoreMargin) refuses it: the assist pulls
 *   out as before (or a forced entry skims), and the hint says why.
 * - Under water ('underwater' mode): a streamlined, slightly buoyant body with the water's added mass and anisotropic
 *   quadratic drag, so the entry momentum carries it 5–15 m down along the entry path and the flanks turn the path
 *   after the nose. W/S pitch, A/D/Q/E turn, Space strokes (a strong wing sweep), hands-off the nose comes up and the
 *   wings scull gently; the surface current carries it; the seabed and structures (vessel hulls, piers, quays) push it
 *   out softly. Air (stamina) drains; after PLUNGE.maxTime, at low air or over shoaling water it surfaces on its own.
 * - Breach ("fırlama"): Space within PLUNGE.breachDepth of the surface, or rising fast through it, bursts out: the
 *   wings snap open on the way up, the body clears the water with a sheet of spray, and the dragon climbs away in the
 *   take-off mode keeping PLUNGE.retention of its underwater speed. Rising slowly just surfaces into swimming.
 *
 * Flow hooks (phase 20): 'maneuver' events 'plunge' (entry) and 'breach' (exit) are announced with their captions;
 * the plunge's end is marked with `ended` and `clean` (no seabed / hull contact, not surfaced by force).
 */
import * as THREE from 'three';
import type { ContactResult } from '../../core/collision';
import { clamp, smoothstep } from '../../core/math/noise';
import { enterSwimming } from './locomotion';
import { MANEUVER_LABELS } from './maneuvers';
import { GRAVITY, MASS, PLUNGE, SWIM, TRICKS, WATER_DENSITY } from './params';
import type { FlightSim } from './sim';
import type { PilotCommand } from './types';

/** Why a plunge is refused here. */
export type PlungeRefusal = 'shallow' | 'vessel' | 'pier' | 'shore' | 'structure';

/** Turkish hints for a refused plunge (the maneuver caption's hint style). */
export const PLUNGE_HINTS: Record<PlungeRefusal, string> = {
  shallow: 'Burası dalış için çok sığ',
  vessel: 'Gemiye çok yakın, dalış yok',
  pier: 'İskeleye çok yakın, dalış yok',
  shore: 'Kıyıya çok yakın, dalış yok',
  structure: 'Yapıya çok yakın, dalış yok',
};

/** How the last dive ended (headless checks and diagnostics). */
export interface DiveExit {
  kind: 'breach' | 'surface';
  /** Seconds under water. */
  time: number;
  /** Speed through the water the breach was committed at (m/s). */
  underSpeed: number;
  /** Speed leaving the water (m/s). */
  exitSpeed: number;
  maxDepth: number;
  contacts: number;
  /** Surfaced on its own (time, air or shoaling water). */
  forced: boolean;
}

const _contact: ContactResult = { normal: new THREE.Vector3(), depth: 0, surface: '' };
const _center = new THREE.Vector3();
const _lever = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _force = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _lateral = new THREE.Vector3();
const _current = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _targetQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _prevAccel = new THREE.Vector3();

function approach(current: number, target: number, rate: number, h: number): number {
  const d = target - current;
  const step = rate * h;
  return current + (d > step ? step : d < -step ? -step : d);
}

/** Plunge look-ahead and under-water state of the flight simulation. */
export class DiveState {
  /** A plunge is armed (steep folded dive, water entry within PLUNGE.armTime). */
  armed = false;
  /** Armed and the entry ahead is fit to plunge into: the dive floor lets the dragon into the water. */
  clear = false;
  /** Why the last armed look-ahead (or contact) refused the plunge, null when fit. */
  refusal: PlungeRefusal | null = null;
  private lookTimer = 0;
  private hintTimer = 0;

  /* Under water. */
  time = 0;
  pitch = 0;
  yaw = 0;
  bank = 0;
  /** Seconds since the current stroke started (large when none). */
  strokeAge = 99;
  breaching = false;
  /** Surfacing on its own (time, air, shoaling water). */
  auto = false;
  /** 0..1: the wings half open as a brake (hands-off while fast). */
  brake = 0;
  /** Speed through the water when the breach was committed (m/s). */
  underSpeed = 0;
  entrySpeed = 0;
  entryPath = 0;
  maxDepth = 0;
  /** Seabed and structure contacts during this dive. */
  contacts = 0;
  bubbleTimer = 0;
  private stuck = 0;
  private escapeTimer = 0;
  readonly escape = new THREE.Vector3();
  lastExit: DiveExit | null = null;
  /** Seconds left in which the water skim leaves a breaching body alone (it is leaving the water, not skimming). */
  exitGrace = 0;

  resetLook(): void {
    this.armed = false;
    this.clear = false;
    this.lookTimer = 0;
    this.exitGrace = 0;
  }

  /** Emits a refusal hint, at most every TRICKS.hintInterval s. */
  hint(sim: FlightSim, refusal: PlungeRefusal): void {
    this.refusal = refusal;
    if (this.hintTimer > 0) {
      return;
    }
    this.hintTimer = TRICKS.hintInterval;
    sim.emit({ type: 'maneuver', id: 'hint', label: PLUNGE_HINTS[refusal] });
  }

  tick(h: number): void {
    this.hintTimer = Math.max(0, this.hintTimer - h);
    this.exitGrace = Math.max(0, this.exitGrace - h);
    this.lookTimer -= h;
  }

  lookDue(): boolean {
    if (this.lookTimer > 0) {
      return false;
    }
    this.lookTimer = PLUNGE.lookInterval;
    return true;
  }

  beginDive(speed: number, path: number, yaw: number): void {
    this.time = 0;
    this.pitch = Math.max(path, PLUNGE.entryPitch);
    this.yaw = yaw;
    this.bank = 0;
    this.strokeAge = 99;
    this.breaching = false;
    this.auto = false;
    this.brake = 0;
    this.underSpeed = 0;
    this.entrySpeed = speed;
    this.entryPath = path;
    this.maxDepth = 0;
    this.contacts = 0;
    this.bubbleTimer = 0;
    this.stuck = 0;
    this.escapeTimer = 0;
    this.escape.set(0, 0, 0);
    this.resetLook();
  }

  /** Under-hull escape bookkeeping (time pressed up under a structure, escape push left). */
  updateStuck(pressedUp: boolean, h: number): void {
    this.stuck = pressedUp ? this.stuck + h : Math.max(0, this.stuck - 0.5 * h);
    this.escapeTimer = Math.max(0, this.escapeTimer - h);
  }

  /** An escape push toward open water is active. */
  get escaping(): boolean {
    return this.escapeTimer > 0;
  }

  get stuckLong(): boolean {
    return this.stuck > PLUNGE.stuckTime && this.escapeTimer <= 0;
  }

  setEscape(x: number, z: number): void {
    this.escape.set(x, 0, z);
    this.escapeTimer = 2.5;
    this.stuck = 0;
  }
}

/** Seabed height (m, negative below sea level) at x, z; a deep sea without geography. */
function seabedAt(sim: FlightSim, x: number, z: number): number {
  const col = sim.world.collision;
  if (col?.geo) {
    return col.terrainHeight(x, z);
  }
  return sim.world.geo ? sim.world.geo.heightAt(x, z) : -100;
}

/**
 * Is the water at (x, z) and along `PLUNGE.reach` m in the direction (dx, dz) fit for a plunge along flight path
 * `path` (rad, negative down)? Returns the refusal, or null when it is.
 */
export function plungeSite(sim: FlightSim, x: number, z: number, dx: number, dz: number, path: number): PlungeRefusal | null {
  const n = PLUNGE.reachSamples;
  const sinMin = Math.sin(-PLUNGE.minPath);
  const steep = clamp((Math.sin(-path) - sinMin) / (1 - sinMin), 0, 1);
  for (let k = 0; k <= n; k++) {
    const d = (PLUNGE.reach * k) / n;
    const px = x + dx * d;
    const pz = z + dz * d;
    const need = PLUNGE.minDepth + (k === 0 ? PLUNGE.steepDepth * steep : 0);
    if (seabedAt(sim, px, pz) > sim.waterHeight(px, pz) - need) {
      return 'shallow';
    }
  }
  const geo = sim.world.geo;
  if (geo && geo.coastDistance(x, z) > -PLUNGE.shoreMargin) {
    return 'shore';
  }
  const col = sim.world.collision;
  if (col) {
    for (let k = 0; k <= 2; k++) {
      const d = (PLUNGE.reach * k) / 2;
      const px = x + dx * d;
      const pz = z + dz * d;
      _probe.set(px, sim.waterHeight(px, pz) - 4, pz);
      const c = col.resolveSphere(_probe, PLUNGE.hullMargin, _contact, false);
      if (c) {
        return c.surface === 'vessel' ? 'vessel' : c.surface === 'pier' ? 'pier' : c.surface === 'structure' ? 'structure' : 'shore';
      }
    }
  }
  return null;
}

/**
 * Plunge look-ahead (airborne substeps): arms the plunge in a steep folded dive (Shift or free fall) whose water entry
 * is near, and checks the entry site at PLUNGE.lookInterval. While armed and clear, the dive floor over water drops to
 * PLUNGE.floorWater and the free fall's automatic catch waits (see controller / maneuvers); a refused site hints why.
 */
export function updatePlungeLook(sim: FlightSim, cmd: PilotCommand, h: number): void {
  const d = sim.dive;
  d.tick(h);
  const v = sim.body.velocity;
  const p = sim.body.position;
  const intent = sim.maneuvers.kind === 'drop' || (cmd.dive && !sim.maneuvers.diveMasked);
  const speed = v.length();
  if (!intent || v.y > -2 || v.y / speed > Math.sin(PLUNGE.minPath)) {
    d.armed = false;
    d.clear = false;
    return;
  }
  const feet = p.y - sim.footDepth();
  const tEntry = (feet - sim.waterHeight(p.x, p.z)) / -v.y;
  if (tEntry > PLUNGE.armTime + speed / PLUNGE.armSpeed) {
    d.armed = false;
    d.clear = false;
    return;
  }
  if (tEntry < 0 || !d.lookDue()) {
    return;
  }
  const ex = p.x + v.x * tEntry;
  const ez = p.z + v.z * tEntry;
  if (seabedAt(sim, ex, ez) > -0.4) {
    // Diving at land: not a plunge at all.
    d.armed = false;
    d.clear = false;
    return;
  }
  const horizontal = Math.hypot(v.x, v.z);
  const dx = horizontal > 0.5 ? v.x / horizontal : sim.axes.forward.x;
  const dz = horizontal > 0.5 ? v.z / horizontal : sim.axes.forward.z;
  const refusal = plungeSite(sim, ex, ez, dx, dz, Math.asin(clamp(v.y / speed, -1, 1)));
  d.armed = true;
  d.clear = refusal === null;
  d.refusal = refusal;
  if (refusal) {
    d.hint(sim, refusal);
  }
}

/**
 * First contact with the water in a steep, fast, folded dive over fit water: enter it (called by the water skim).
 * Returns false (skim / splash as before) when the entry does not qualify or the site refuses it.
 */
export function tryPlunge(sim: FlightSim): boolean {
  const v = sim.body.velocity;
  const p = sim.body.position;
  const speed = v.length();
  if (speed < PLUNGE.minSpeed) {
    return false;
  }
  const path = Math.asin(clamp(v.y / speed, -1, 1));
  if (path > PLUNGE.minPath + PLUNGE.contactSlack) {
    return false;
  }
  if (sim.maneuvers.kind !== 'drop' && sim.spread > PLUNGE.maxSpread) {
    return false;
  }
  const horizontal = Math.hypot(v.x, v.z);
  const dx = horizontal > 0.5 ? v.x / horizontal : sim.axes.forward.x;
  const dz = horizontal > 0.5 ? v.z / horizontal : sim.axes.forward.z;
  const refusal = plungeSite(sim, p.x, p.z, dx, dz, path);
  if (refusal) {
    sim.dive.hint(sim, refusal);
    return false;
  }
  enterUnderwater(sim, speed, path, horizontal > 0.5 ? Math.atan2(-v.x, -v.z) : sim.axes.yaw());
  return true;
}

/** Into the water: splash column and crown, the thud, and the under-water mode along the entry path. */
function enterUnderwater(sim: FlightSim, speed: number, path: number, yaw: number): void {
  const p = sim.body.position;
  const point = new THREE.Vector3(p.x, sim.waterHeight(p.x, p.z), p.z);
  const hard = smoothstep(20, 80, speed);
  sim.emit({ type: 'splash', point, strength: clamp(1.5 + speed / 45, 1.8, 3) });
  sim.emit({ type: 'impact', point: point.clone(), speed, surface: 'water' });
  sim.emit({ type: 'shake', amount: 0.2 + 0.35 * hard });
  sim.emit({ type: 'maneuver', id: 'plunge', label: MANEUVER_LABELS.plunge });
  sim.body.velocity.multiplyScalar(PLUNGE.entryKeepSlow + (PLUNGE.entryKeepFast - PLUNGE.entryKeepSlow) * smoothstep(PLUNGE.entrySlow, PLUNGE.entryFast, speed));
  sim.body.angularVelocity.set(0, 0, 0);
  sim.dive.beginDive(speed, path, yaw);
  sim.maneuvers.cancel(sim);
  sim.setMode('underwater');
}

/** Ends the dive record and the plunge move (flow hook). */
function endDive(sim: FlightSim, kind: DiveExit['kind'], exitSpeed: number): void {
  const d = sim.dive;
  d.lastExit = { kind, time: d.time, underSpeed: d.underSpeed, exitSpeed, maxDepth: d.maxDepth, contacts: d.contacts, forced: d.auto };
  sim.emit({ type: 'maneuver', id: 'plunge', label: MANEUVER_LABELS.plunge, ended: true, clean: d.contacts === 0 && !d.auto });
}

/** Commits a breach: the wings start to open and the stroke drives the body up through the surface. */
function commitBreach(sim: FlightSim, speed: number): void {
  const d = sim.dive;
  if (d.breaching) {
    return;
  }
  d.breaching = true;
  d.underSpeed = speed;
  d.strokeAge = 0;
}

/** Out of the water: the body clears it with a sheet of spray, the wings snap open, a take-off climb. */
function exitBreach(sim: FlightSim, waterY: number): void {
  const d = sim.dive;
  const b = sim.body;
  const v = b.velocity;
  const p = b.position;
  const horizontal = Math.hypot(v.x, v.z);
  const under = Math.max(d.underSpeed, 0.1);
  const speed = Math.max(PLUNGE.retention * under, PLUNGE.breachMinSpeed);
  // The climb angle of the exit: the path it came up on, steepened when needed so the body clears the water.
  let path = clamp(Math.atan2(v.y, horizontal), PLUNGE.breachMinPath, PLUNGE.breachMaxPath);
  if (speed * Math.sin(path) < PLUNGE.breachMinUp) {
    path = Math.min(PLUNGE.breachMaxPath, Math.asin(Math.min(1, PLUNGE.breachMinUp / speed)));
  }
  const fx = -Math.sin(d.yaw);
  const fz = -Math.cos(d.yaw);
  v.set(fx * Math.cos(path) * speed, Math.sin(path) * speed, fz * Math.cos(path) * speed);
  v.y = Math.max(v.y, PLUNGE.breachMinUp);
  const point = new THREE.Vector3(p.x, waterY, p.z);
  sim.emit({ type: 'splash', point, strength: clamp(1.3 + speed / 25, 1.5, 2.6) });
  sim.emit({ type: 'sound', name: 'wing-snap', volume: 0.9 });
  sim.emit({ type: 'shake', amount: 0.22 });
  endDive(sim, 'breach', v.length());
  sim.emit({ type: 'maneuver', id: 'breach', label: MANEUVER_LABELS.breach, clean: d.contacts === 0 && !d.auto });
  sim.spread = Math.max(sim.spread, 0.45);
  sim.sweep = Math.min(sim.sweep, 0.3);
  sim.legsOut = 0;
  sim.hoverBlend = 0.3;
  sim.brake = 0;
  sim.attachment = 1;
  sim.beat.phase = Math.max(sim.beat.phase, 5.6);
  sim.updateInertia();
  b.angularVelocity.set(0, 0, 0);
  sim.leapCharge = 0;
  sim.runTakeoff = 0;
  sim.controller.holdPath(path);
  d.exitGrace = PLUNGE.exitGrace;
  sim.setMode('takeoff');
}

/** Rising slowly to the surface: float and swim. */
function surface(sim: FlightSim, waterY: number): void {
  const p = sim.body.position;
  sim.emit({ type: 'splash', point: new THREE.Vector3(p.x, waterY, p.z), strength: 0.45 });
  endDive(sim, 'surface', sim.body.velocity.length());
  enterSwimming(sim);
}

/**
 * Under water: pilot steering (W/S pitch, A/D/Q/E turn), strokes, buoyancy, drag and the current, soft contacts with
 * the seabed and structures, auto-surfacing, bubbles, and the exits (breach, surfacing).
 */
export function stepUnderwater(sim: FlightSim, cmd: PilotCommand, h: number): void {
  const d = sim.dive;
  const b = sim.body;
  const p = b.position;
  const v = b.velocity;
  d.time += h;
  d.strokeAge += h;
  const waterY = sim.waterHeight(p.x, p.z);
  const depth = waterY - p.y;
  d.maxDepth = Math.max(d.maxDepth, depth);
  const speedNow = v.length();

  // --- surfacing on its own ---------------------------------------------------------------
  if (!d.auto && (d.time > PLUNGE.maxTime || sim.stamina < PLUNGE.lowAir || seabedAt(sim, p.x, p.z) > waterY - PLUNGE.shoalDepth)) {
    d.auto = true;
  }

  // --- strokes and the breach -------------------------------------------------------------
  const strokeReady = d.strokeAge > PLUNGE.strokePeriod;
  if (!d.breaching && d.time > 0.2 && (cmd.flapPressed || cmd.urgePressed || (cmd.flap && strokeReady))) {
    if (depth <= PLUNGE.breachDepth) {
      commitBreach(sim, speedNow);
    } else if (strokeReady) {
      d.strokeAge = 0;
      sim.stamina = Math.max(0, sim.stamina - PLUNGE.strokeStamina);
    }
  }
  if (!d.breaching && depth < PLUNGE.breachWindow && v.y > PLUNGE.breachRise) {
    // Rising fast toward the surface: the breach is on its way.
    commitBreach(sim, speedNow);
    d.strokeAge = 99;
  }

  // --- attitude -----------------------------------------------------------------------------
  const pitchInput = clamp(cmd.pitch, -1, 1);
  const turn = clamp(cmd.roll + cmd.yaw, -1, 1);
  let pitchRate = 0;
  let yawRate = -turn * PLUNGE.yawRate;
  if (d.escaping) {
    // Out from under a hull: turn toward the open water the probes found and swim there level.
    const want = Math.atan2(-d.escape.x, -d.escape.z);
    const err = Math.atan2(Math.sin(want - d.yaw), Math.cos(want - d.yaw));
    yawRate = clamp(2 * err, -1.2, 1.2);
    pitchRate = clamp(2 * -d.pitch, -1, 1);
  } else if (d.breaching) {
    pitchRate = clamp(2.5 * (Math.max(d.pitch, 40 * (Math.PI / 180)) - d.pitch), -2.5, 2.5);
  } else if (d.auto) {
    pitchRate = clamp(2 * (PLUNGE.surfacePitch - d.pitch), -PLUNGE.idlePitchRate, PLUNGE.idlePitchRate);
  } else if (Math.abs(pitchInput) > 0.04) {
    pitchRate = -pitchInput * Math.min(PLUNGE.pitchRate * (1 + speedNow / PLUNGE.pitchRateSpeed), PLUNGE.maxPitchRate);
  } else if (d.time > PLUNGE.idleDelay) {
    pitchRate = clamp(2 * (PLUNGE.idlePitch - d.pitch), -PLUNGE.idlePitchRate, PLUNGE.idlePitchRate);
  }
  // Seabed ahead along the velocity: the nose comes up in time (the pilot cannot fly into the mud).
  const look = Math.min(PLUNGE.seabedLook, 20 / Math.max(speedNow, 1));
  const qx = p.x + v.x * look;
  const qz = p.z + v.z * look;
  const qy = p.y + Math.min(v.y, 0) * look - 0.42 * sim.rigLength * Math.max(0, -Math.sin(d.pitch));
  const lowRoom = qy - seabedAt(sim, qx, qz) - PLUNGE.seabedKeep - sim.contacts.bellyDepth;
  if (lowRoom < 0) {
    pitchRate = Math.max(pitchRate, clamp(-lowRoom * 0.6, 0.6, 2.2));
  }
  const prevPitch = d.pitch;
  d.pitch = clamp(d.pitch + pitchRate * h, Math.min(-PLUNGE.maxPitch, d.pitch), PLUNGE.maxPitch);
  d.yaw += yawRate * h;
  d.bank = approach(d.bank, turn * 0.35, 2, h);
  _euler.set(d.pitch, d.yaw, -d.bank, 'YXZ');
  _targetQ.setFromEuler(_euler);
  b.quaternion.slerp(_targetQ, 1 - Math.exp(-12 * h));
  sim.axes.update(b.quaternion);
  b.angularVelocity.set((d.pitch - prevPitch) / h, yawRate, 0);
  const F = sim.axes.forward;

  // --- forces -------------------------------------------------------------------------------
  const water = sim.world.water;
  if (water) {
    water.currentAt(p.x, p.z, _current);
    _current.multiplyScalar(1 - PLUNGE.currentLoss * clamp(depth / PLUNGE.currentDepth, 0, 1));
  } else {
    _current.set(0, 0, 0);
  }
  _rel.copy(v).sub(_current);
  const u = _rel.dot(F);
  _lateral.copy(_rel).addScaledVector(F, -u);
  const w = _lateral.length();
  // Submerged share of the body (its centre at the surface = half).
  const submerged = clamp((depth + 1.2) / 2.4, 0, 1);
  const q = 0.5 * WATER_DENSITY * submerged;
  // Hands-off while fast the wings open half way as a brake; any stick, stroke or breach keeps them folded.
  const handsOff = Math.abs(pitchInput) < 0.04 && !d.breaching && d.strokeAge > PLUNGE.strokeTime * 1.6 && !cmd.flap;
  const brakeWant = handsOff ? smoothstep(PLUNGE.idleDelay, PLUNGE.idleDelay + PLUNGE.brakeRamp, d.time) * smoothstep(PLUNGE.scullSpeed + 0.5, PLUNGE.scullSpeed + 2, u) : 0;
  d.brake = approach(d.brake, brakeWant, 4, h);
  const cda = PLUNGE.cdaAxial + (PLUNGE.cdaBrake - PLUNGE.cdaAxial) * d.brake;
  _force.copy(F).multiplyScalar(-q * cda * Math.abs(u) * u);
  _force.addScaledVector(_lateral, -q * PLUNGE.cdaLateral * w);
  _force.y += MASS * GRAVITY * ((1 + PLUNGE.buoyancy) * submerged - 1);
  let thrust = 0;
  if (d.strokeAge < PLUNGE.strokeTime) {
    thrust = MASS * GRAVITY * PLUNGE.strokeForce * Math.sin((Math.PI * d.strokeAge) / PLUNGE.strokeTime);
  }
  if (d.breaching) {
    thrust = Math.max(thrust, MASS * GRAVITY * PLUNGE.breachThrust * submerged);
  } else if (d.time > PLUNGE.idleDelay) {
    const want = d.auto || d.escaping ? PLUNGE.surfaceSpeed : PLUNGE.scullSpeed;
    thrust = Math.max(thrust, MASS * PLUNGE.scullGain * clamp(want - u, 0, want));
  }
  _force.addScaledVector(F, thrust * submerged);
  if (d.escaping) {
    // Leaving the underside of a hull: a push toward the nearest open water found by the probes.
    _force.addScaledVector(d.escape, MASS * GRAVITY * PLUNGE.escapeForce);
  }
  const mEff = MASS * (1 + PLUNGE.addedMass);
  _prevAccel.copy(_force).divideScalar(mEff);
  v.addScaledVector(_prevAccel, h);
  p.addScaledVector(v, h);

  // --- contacts: seabed and structures (soft pushes) -----------------------------------------
  let pressedUp = false;
  const col = sim.world.collision;
  const geo = sim.world.geo;
  for (let i = 0; i < sim.contacts.offsets.length; i++) {
    const r = sim.contacts.radii[i];
    _lever.copy(sim.contacts.offsets[i]).applyQuaternion(b.quaternion);
    _center.copy(p).add(_lever);
    const floor = seabedAt(sim, _center.x, _center.z);
    const pen = floor + r - _center.y;
    if (pen > 0) {
      if (geo) {
        geo.normalAt(_center.x, _center.z, _normal);
      } else {
        _normal.set(0, 1, 0);
      }
      p.y += pen;
      _center.y += pen;
      const vn = v.dot(_normal);
      if (vn < 0) {
        v.addScaledVector(_normal, -vn * 1.1);
        v.multiplyScalar(1 - Math.min(1, 1.5 * h));
        noteContact(sim, _center, -vn, 'seabed', r);
      }
    }
    if (col) {
      const c = col.resolveSphere(_center, r, _contact, false);
      if (c) {
        const n = c.normal;
        p.addScaledVector(n, c.depth);
        const vn = v.dot(n);
        if (vn < 0) {
          v.addScaledVector(n, -vn * 1.1);
          noteContact(sim, _center, -vn, c.surface, r);
        }
        if (n.y < -0.5) {
          pressedUp = true;
        }
      }
    }
  }
  d.updateStuck(pressedUp, h);
  if (d.stuckLong && col) {
    findEscape(sim);
  }

  // --- exits --------------------------------------------------------------------------------
  const top = waterY - Math.max(PLUNGE.surfaceBand, SWIM.floatDepth);
  if (p.y >= top && d.time > 0.3) {
    if (!d.breaching && v.y < PLUNGE.breachRise) {
      surface(sim, waterY);
      return;
    }
    if (p.y >= waterY + 0.6) {
      exitBreach(sim, waterY);
      return;
    }
    if (v.y <= 0.5) {
      // A breach that ran out of push in the surface: it floats instead.
      surface(sim, waterY);
      return;
    }
  }

  // --- bubbles from the nostrils, seen where they reach the surface --------------------------
  d.bubbleTimer += h;
  if (d.bubbleTimer > PLUNGE.bubbleInterval && depth > 1) {
    d.bubbleTimer = 0;
    const hx = p.x + F.x * 0.45 * sim.rigLength;
    const hz = p.z + F.z * 0.45 * sim.rigLength;
    sim.emit({ type: 'splash', point: new THREE.Vector3(hx, sim.waterHeight(hx, hz), hz), strength: PLUNGE.bubbleStrength });
  }

  // --- wings, legs, telemetry ----------------------------------------------------------------
  let spread = 0.06 + 0.32 * d.brake;
  let sweep = 1 - 0.5 * d.brake;
  if (d.breaching) {
    spread = 0.5;
    sweep = 0.3;
  } else if (d.strokeAge < PLUNGE.strokeTime * 1.6) {
    // A stroke: the half-open wings sweep back along the flanks.
    const s = Math.sin(Math.PI * Math.min(1, d.strokeAge / (PLUNGE.strokeTime * 1.6)));
    spread = 0.1 + 0.38 * s;
    sweep = 1 - 0.7 * s;
  }
  sim.spread = approach(sim.spread, spread, d.breaching ? 4 : 3, h);
  sim.sweep = approach(sim.sweep, sweep, 4, h);
  sim.legsOut = approach(sim.legsOut, 0, 2, h);
  sim.hoverBlend = approach(sim.hoverBlend, 0, 2, h);
  sim.brake = 0;
  sim.attachment = 1;
  sim.updateInertia();
  sim.beat.update(h, 0, 0);
  sim.touchingWater = false;
  const speed = _rel.length();
  sim.airspeed = speed;
  sim.alpha = 0;
  sim.beta = 0;
  sim.bank = sim.axes.bank();
  sim.pitch = sim.axes.pitch();
  sim.gamma = speedNow > 0.5 ? Math.asin(clamp(v.y / Math.max(v.length(), 1e-6), -1, 1)) : sim.pitch;
  sim.specificForce.copy(_prevAccel);
  sim.specificForce.y += GRAVITY;
  sim.loadFactor = sim.specificForce.dot(sim.axes.up) / GRAVITY;
  sim.controlMoment.set(0, 0, 0);
  sim.lift = 0;
  sim.drag = 0;
  sim.flapForce = thrust;
  sim.groundSpeed = u;
  sim.groundYaw = d.yaw;
}

function noteContact(sim: FlightSim, point: THREE.Vector3, speed: number, surface: string, r: number): void {
  const d = sim.dive;
  if (speed > 0.8) {
    d.contacts++;
  }
  if (speed > 2.5 && sim.impactCooldown <= 0) {
    sim.impactCooldown = 0.4;
    sim.emit({ type: 'impact', point: point.clone().setY(point.y - r), speed, surface });
  }
}

/**
 * Pressed up under a hull for a while: probe eight directions at growing distances at the body's depth and push toward
 * the nearest open water (the buoyancy alone would keep it pinned under a flat bottom).
 */
function findEscape(sim: FlightSim): void {
  const col = sim.world.collision;
  if (!col) {
    return;
  }
  const p = sim.body.position;
  const r = sim.contacts.radii[0];
  for (let dist = 8; dist <= PLUNGE.escapeReach; dist *= 2) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + sim.dive.yaw;
      const dx = -Math.sin(a);
      const dz = -Math.cos(a);
      _probe.set(p.x + dx * dist, p.y + 2 * r, p.z + dz * dist);
      if (!col.resolveSphere(_probe, r * 1.5, _contact, false)) {
        sim.dive.setEscape(dx, dz);
        return;
      }
    }
  }
  sim.dive.setEscape(-Math.sin(sim.dive.yaw), -Math.cos(sim.dive.yaw));
}
