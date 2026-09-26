import * as THREE from 'three';
import { clamp, createRng, smoothstep } from '../../core/math/noise';
import type { EnvironmentState, GeoQuery } from '../../core/contracts';
import { createLiftSample, sampleLift } from './lift';

const DEFAULT_WIND = new THREE.Vector3(4, 0, 2);
/** Afternoon sun used without an environment (tests, sandboxes). */
const DEFAULT_SUN = new THREE.Vector3(-0.45, 0.72, 0.53).normalize();
const _normal = new THREE.Vector3();

export interface WindSample {
  /** Total air velocity at the dragon (m/s, world). */
  readonly velocity: THREE.Vector3;
  /** Standard deviation of the current gust field (m/s). */
  turbulence: number;
  /** Vertical air motion from thermals + ridge lift (m/s). */
  updraft: number;
  /** Normalized roll gust (-1..1-ish), drives a rolling moment. */
  rollGust: number;
}

/**
 * Local wind model: environment wind with a boundary-layer profile, Ornstein-Uhlenbeck gusts
 * (intensity from wind speed, urban roughness, slopes and convection), and the vertical air motion of
 * the lift field (./lift.ts): daytime thermals from sun-heated ground, released at summits and in
 * drifting cells, and orographic (ridge) lift on windward slopes.
 */
export class WindField implements WindSample {
  readonly velocity = new THREE.Vector3();
  turbulence = 0;
  updraft = 0;
  rollGust = 0;
  baseEnabled = true;
  gustsEnabled = true;
  thermalsEnabled = true;
  /** Fixed wind (m/s at 100 m) replacing the environment's wind (tests); null = use env. */
  override: THREE.Vector3 | null = null;
  /** Mean wind at the dragon (boundary-layer profile applied, no gusts or updrafts). */
  readonly mean = new THREE.Vector3();

  private readonly gust = new THREE.Vector3();
  private rng = createRng(4711);
  private spareGaussian = 0;
  private hasSpare = false;
  private slowTimer = 0;
  private roughness = 0;
  private slope = 0;
  private ridge = 0;
  private thermal = 0;
  private readonly lift = createLiftSample();
  private readonly liftWind = new THREE.Vector3();
  private readonly liftConditions = { sunDirection: DEFAULT_SUN, wind: this.liftWind, time: 0 };

  reseed(seed: number): void {
    this.rng = createRng(seed);
    this.gust.set(0, 0, 0);
    this.rollGust = 0;
    this.hasSpare = false;
    this.slowTimer = 0;
  }

  sample(
    h: number,
    position: THREE.Vector3,
    agl: number,
    overWater: boolean,
    airspeed: number,
    time: number,
    env: EnvironmentState | undefined,
    geo: GeoQuery | undefined,
  ): WindSample {
    const envWind = this.override ?? (env ? env.wind : DEFAULT_WIND);
    const height = Math.max(agl, 2);
    const profile = this.baseEnabled ? clamp(Math.pow(height / 100, 0.22), 0.3, 1.6) : 0;
    this.mean.set(envWind.x * profile, 0, envWind.z * profile);
    const windSpeed = Math.hypot(this.mean.x, this.mean.z);

    const sun = env ? clamp(env.sunDirection.y * 2.5, 0, 1) * (1 - env.nightFactor) : 0.6;

    this.slowTimer -= h;
    if (this.slowTimer <= 0) {
      this.slowTimer = 0.05;
      this.liftWind.set(envWind.x, 0, envWind.z).multiplyScalar(this.baseEnabled ? 1 : 0);
      this.liftConditions.sunDirection = env ? env.sunDirection : DEFAULT_SUN;
      this.liftConditions.time = time;
      this.sampleTerrain(position, agl, overWater, geo);
    }

    // Convection drives the gust level (kept independent of the lift field's cells).
    const convective = this.thermalsEnabled ? sun * (overWater ? 0 : 1) * smoothstep(20, 150, agl) * (1 - smoothstep(1400, 2400, agl)) : 0;
    this.updraft = (this.thermalsEnabled ? this.thermal : 0) + this.ridge;

    const sigma =
      0.18 +
      0.07 * windSpeed +
      1.3 * this.roughness * Math.exp(-agl / 90) +
      0.9 * this.slope * Math.exp(-agl / 220) * (0.3 + windSpeed * 0.1) +
      0.55 * convective;
    this.turbulence = sigma;

    const lengthScale = 40 + Math.min(agl, 1000) * 0.35;
    const tau = clamp(lengthScale / (airspeed + 4), 0.25, 3);
    if (!this.gustsEnabled) {
      this.gust.set(0, 0, 0);
      this.rollGust = 0;
      this.velocity.copy(this.mean);
      this.velocity.y += this.updraft;
      return this;
    }
    const decay = Math.exp(-h / tau);
    const drive = sigma * Math.sqrt(1 - decay * decay);
    this.gust.x = this.gust.x * decay + drive * this.gaussian();
    this.gust.y = this.gust.y * decay + drive * 0.7 * this.gaussian();
    this.gust.z = this.gust.z * decay + drive * this.gaussian();
    const rollDecay = Math.exp(-h / 0.45);
    this.rollGust = this.rollGust * rollDecay + Math.min(sigma, 3) * 0.35 * Math.sqrt(1 - rollDecay * rollDecay) * this.gaussian();

    this.velocity.copy(this.mean).add(this.gust);
    this.velocity.y += this.updraft;
    return this;
  }

  private sampleTerrain(position: THREE.Vector3, agl: number, overWater: boolean, geo: GeoQuery | undefined): void {
    const x = position.x;
    const z = position.z;
    if (!geo) {
      this.roughness = 0;
      this.slope = 0;
      this.ridge = 0;
      this.thermal = 0;
      return;
    }
    sampleLift(geo, x, z, agl, this.liftConditions, this.lift);
    this.thermal = this.lift.thermal;
    this.ridge = this.lift.ridge;
    if (overWater) {
      this.roughness = 0;
      this.slope = 0;
      return;
    }
    this.roughness = agl < 400 ? geo.densityAt(x, z) : 0;
    if (agl < 900) {
      geo.normalAt(x, z, _normal);
      this.slope = 1 - Math.max(_normal.y, 0.3);
    } else {
      this.slope = 0;
    }
  }

  private gaussian(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spareGaussian;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.rng() * 2 - 1;
      v = this.rng() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spareGaussian = v * m;
    this.hasSpare = true;
    return u * m;
  }
}
