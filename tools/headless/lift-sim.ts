/**
 * Headless flight harness for the lift checks: the real FlightSim stepped at the fixed physics rate (the same loop as
 * window.__flightTest.simulate), with the real GeoQuery, a terrain-only CollisionWorld (no building colliders) and a
 * stub EnvironmentState whose sun comes from the sky module's ephemeris for Istanbul.
 */
import * as THREE from 'three';
import { CollisionWorld } from '../../src/core/collision';
import type { EnvironmentState, GeoQuery } from '../../src/core/contracts';
import { headingToYaw } from '../../src/core/geo-coords';
import { smoothstep } from '../../src/core/math/noise';
import { PHYSICS_DT } from '../../src/dragon/flight/params';
import { FlightSim } from '../../src/dragon/flight/sim';
import type { AssistOverrides, PilotCommand } from '../../src/dragon/flight/types';
import { clearPilotEdges, createPilotCommand } from '../../src/dragon/flight/types';
import { computeCelestial, createCelestialState } from '../../src/render/sky/astronomy';
import { OBSERVER } from '../../src/render/sky/params';

/** Engine default calendar day (late September). */
const YEAR = 2026;
const DAY_OF_YEAR = 266;

export type WindRegime = 'calm' | 'poyraz' | 'lodos';

/** Compass direction the wind blows FROM (render/sky/wind.ts). */
const WIND_FROM_DEG: Record<WindRegime, number> = { calm: 0, poyraz: 32, lodos: 218 };

/** Stub environment: sun/moon for the hour, night factor as in render/sky, a fixed wind at 100 m. */
export class LiftEnv implements EnvironmentState {
  readonly sunDirection = new THREE.Vector3(0, 1, 0);
  readonly moonDirection = new THREE.Vector3(0, -1, 0);
  readonly sunColor = new THREE.Color(1, 1, 1);
  readonly ambientColor = new THREE.Color(0.3, 0.35, 0.45);
  readonly light = new THREE.DirectionalLight();
  readonly wind = new THREE.Vector3();
  nightFactor = 0;
  sunElevationDeg = 0;
  private readonly celestial = createCelestialState();

  constructor(hours: number, regime: WindRegime = 'calm', speed = 8) {
    this.setTimeOfDay(hours);
    this.setWind(regime, speed);
  }

  setTimeOfDay(hours: number): void {
    computeCelestial(this.celestial, YEAR, DAY_OF_YEAR, hours, OBSERVER.latDeg, OBSERVER.lonDeg, OBSERVER.utcOffsetHours);
    this.sunDirection.copy(this.celestial.sunDirection);
    this.moonDirection.copy(this.celestial.moonDirection);
    this.sunElevationDeg = this.celestial.sunElevationDeg;
    this.nightFactor = 1 - smoothstep(-9, 3, this.sunElevationDeg);
  }

  setWind(regime: WindRegime, speed: number): void {
    if (regime === 'calm') {
      this.wind.set(0, 0, 0);
      return;
    }
    const to = THREE.MathUtils.degToRad(WIND_FROM_DEG[regime] + 180);
    this.wind.set(Math.sin(to) * speed, 0, -Math.cos(to) * speed);
  }
}

export function createHeadlessSim(geo: GeoQuery, env: EnvironmentState): FlightSim {
  const collision = new CollisionWorld();
  collision.setGeo(geo);
  const sim = new FlightSim();
  sim.world.collision = collision;
  sim.world.geo = geo;
  sim.world.env = env;
  return sim;
}

export function teleport(sim: FlightSim, x: number, y: number, z: number, headingDeg: number, speed: number, pitchDeg = 0): void {
  sim.teleport(x, y, z, headingToYaw(headingDeg), THREE.MathUtils.degToRad(pitchDeg), speed);
}

export type LiftScript = (t: number, sim: FlightSim, cmd: PilotCommand, overrides: AssistOverrides) => void;

/** Steps the simulation for `seconds` (fixed step, neutral stick unless the script sets it). */
export function simulate(sim: FlightSim, seconds: number, script?: LiftScript, every?: (t: number, sim: FlightSim) => void): void {
  const steps = Math.round(seconds / PHYSICS_DT);
  const cmd = createPilotCommand();
  sim.queueEvents = false;
  for (let i = 0; i < steps; i++) {
    cmd.pitch = 0;
    cmd.roll = 0;
    cmd.yaw = 0;
    cmd.flap = false;
    cmd.dive = false;
    cmd.brake = false;
    cmd.fire = false;
    clearPilotEdges(cmd);
    const t = i * PHYSICS_DT;
    script?.(t, sim, cmd, sim.overrides);
    sim.step(PHYSICS_DT, cmd);
    every?.(t, sim);
  }
}
