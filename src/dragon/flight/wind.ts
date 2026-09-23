import * as THREE from 'three';
import { clamp, createRng, SimplexNoise, smoothstep } from '../../core/math/noise';
import type { EnvironmentState, GeoQuery } from '../../core/contracts';

const DEFAULT_WIND = new THREE.Vector3(4, 0, 2);
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
 * (intensity from wind speed, urban roughness, slopes and convection), daytime thermals over land
 * drifting with the wind, and orographic (ridge) lift on windward slopes.
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
  private readonly noise = new SimplexNoise(9127);
  private rng = createRng(4711);
  private spareGaussian = 0;
  private hasSpare = false;
  private slowTimer = 0;
  private roughness = 0;
  private slope = 0;
  private ridge = 0;
  private thermalCore = 0;

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
      this.sampleTerrain(position, agl, overWater, time, geo);
    }

    const convective = this.thermalsEnabled ? sun * (overWater ? 0 : 1) * smoothstep(20, 150, agl) * (1 - smoothstep(1400, 2400, agl)) : 0;
    const thermal = 3.2 * this.thermalCore * convective - (overWater && this.thermalsEnabled ? 0.25 * sun * smoothstep(20, 200, agl) : 0);
    const ridgeLift = overWater ? 0 : this.ridge * Math.exp(-agl / 180) * 0.85;
    this.updraft = thermal + ridgeLift;

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

  private sampleTerrain(position: THREE.Vector3, agl: number, overWater: boolean, time: number, geo: GeoQuery | undefined): void {
    const x = position.x;
    const z = position.z;
    // Thermal cells drift downwind; cores are the peaks of a coarse noise field.
    const n =
      this.noise.noise2((x - this.mean.x * time * 0.8) / 850, (z - this.mean.z * time * 0.8) / 850) * 0.75 +
      this.noise.noise2(x / 310 + 17.3, z / 310 - 4.1) * 0.25;
    this.thermalCore = smoothstep(0.35, 0.8, n) - 0.12 * smoothstep(0.0, -0.6, n);

    if (!geo || overWater) {
      this.roughness = 0;
      this.slope = 0;
      this.ridge = 0;
      return;
    }
    this.roughness = agl < 400 ? geo.densityAt(x, z) : 0;
    if (agl < 900) {
      geo.normalAt(x, z, _normal);
      const ny = Math.max(_normal.y, 0.3);
      this.slope = 1 - ny;
      // Air following the surface: w = wind · ∇h = -(wind_h · n_h) / n_y
      this.ridge = -(this.mean.x * _normal.x + this.mean.z * _normal.z) / ny;
    } else {
      this.slope = 0;
      this.ridge = 0;
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
