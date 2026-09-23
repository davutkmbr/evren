/**
 * Per-frame sea state: smooths the wind into a sea regime (poyraz/lodos) and wind speed, and fills the wave uniforms
 * (Gerstner set, detail-band phase coefficients, flow-map phases). All phases are computed in double precision on the
 * CPU relative to the shading origin, so the GPU only sees small arguments.
 */
import * as THREE from 'three';
import {
  BANDS,
  CAPILLARY_MS_SLOPE,
  FLOW_PERIOD,
  GERSTNER_WAVES,
  GRAVITY,
  LODOS_DOWNWIND_DEG,
  MAX_WAVES,
  POYRAZ_DOWNWIND_DEG,
  SWELL_HEADING_DEG,
  WaveGroup,
  type GerstnerSpec,
} from './config';

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const REF_U10 = 7;
/** Max sum of Q*k*A (crest sharpening) so the Gerstner surface never loops. */
const MAX_TOTAL_STEEPNESS = 0.8;

export interface SeaStateUniforms {
  uWaveDir: { value: THREE.Vector4[] };
  uWaveAmp: { value: THREE.Vector4[] };
  uBandA: { value: THREE.Vector4[] };
  uBandB: { value: THREE.Vector4[] };
  uFlowPhase: { value: THREE.Vector4 };
  uFlowJump: { value: THREE.Vector4 };
  /** x = U10 (m/s), y = capillary mean square slope, z = whitecap Jacobian threshold, w = whitecap strength. */
  uSeaParams: { value: THREE.Vector4 };
  /** xy = unit downwind direction, zw = accumulated gust/streak drift (m, wraps every 40 km). */
  uWindParams: { value: THREE.Vector4 };
  uFoamOffset: { value: THREE.Vector4 };
  /** x = lodos weight of the sea (fetch map selection). */
  uSeaRegime: { value: THREE.Vector4 };
}

interface WaveSlot {
  spec: GerstnerSpec;
  dirX: number;
  dirZ: number;
  k: number;
  omega: number;
  lodos: boolean;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function hash(n: number, seed: number): number {
  const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function headingDir(deg: number): [number, number] {
  return [Math.sin(deg * DEG), -Math.cos(deg * DEG)];
}

export class SeaState {
  readonly uniforms: SeaStateUniforms;
  /** Smoothed 10 m wind speed (m/s). */
  u10 = REF_U10;
  /** 0 = poyraz sea, 1 = lodos sea. */
  lodos = 0;
  /** Debug override of the 10 m wind speed (?wu10=12), null = follow the environment wind. */
  forcedU10: number | null = null;
  private readonly slots: WaveSlot[] = [];
  private initialised = false;
  private readonly windDir = new THREE.Vector2(...headingDir(POYRAZ_DOWNWIND_DEG));
  private readonly gustDrift = new THREE.Vector2();

  constructor() {
    for (const spec of GERSTNER_WAVES) {
      const heading = spec.group === WaveGroup.Swell ? SWELL_HEADING_DEG + spec.dirOffsetDeg : POYRAZ_DOWNWIND_DEG + spec.dirOffsetDeg;
      this.slots.push(this.makeSlot(spec, heading, false));
    }
    for (const spec of GERSTNER_WAVES) {
      if (spec.group !== WaveGroup.Swell) {
        this.slots.push(this.makeSlot(spec, LODOS_DOWNWIND_DEG + spec.dirOffsetDeg, true));
      }
    }
    if (this.slots.length > MAX_WAVES) {
      throw new Error('water: too many Gerstner waves');
    }
    const vec4s = (n: number): THREE.Vector4[] => Array.from({ length: n }, () => new THREE.Vector4());
    this.uniforms = {
      uWaveDir: { value: vec4s(MAX_WAVES) },
      uWaveAmp: { value: vec4s(MAX_WAVES) },
      uBandA: { value: vec4s(BANDS.length) },
      uBandB: { value: vec4s(BANDS.length) },
      uFlowPhase: { value: new THREE.Vector4() },
      uFlowJump: { value: new THREE.Vector4() },
      uSeaParams: { value: new THREE.Vector4(REF_U10, CAPILLARY_MS_SLOPE, -1, 0) },
      uWindParams: { value: new THREE.Vector4(this.windDir.x, this.windDir.y, 0, 0) },
      uFoamOffset: { value: new THREE.Vector4() },
      uSeaRegime: { value: new THREE.Vector4() },
    };
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      this.uniforms.uWaveDir.value[i].set(s.dirX, s.dirZ, s.k, s.spec.lambda);
    }
  }

  get waveCount(): number {
    return this.slots.length;
  }

  private makeSlot(spec: GerstnerSpec, headingDeg: number, lodos: boolean): WaveSlot {
    const [dirX, dirZ] = headingDir(headingDeg);
    const k = TWO_PI / spec.lambda;
    return { spec, dirX, dirZ, k, omega: Math.sqrt(GRAVITY * k), lodos };
  }

  /**
   * @param wind world wind vector at 100 m (m/s)
   * @param time simulation time (s)
   * @param originX shading origin (m), multiple of ORIGIN_SNAP
   */
  update(wind: THREE.Vector3, time: number, dt: number, originX: number, originZ: number): void {
    const speed100 = Math.hypot(wind.x, wind.z);
    const targetU10 = this.forcedU10 ?? THREE.MathUtils.clamp(speed100 * 0.78, 1.5, 16);
    const [px, pz] = headingDir(POYRAZ_DOWNWIND_DEG);
    const along = speed100 > 0.1 ? (wind.x * px + wind.z * pz) / speed100 : 1;
    const targetLodos = THREE.MathUtils.smoothstep(-along, -0.35, 0.35);
    if (!this.initialised || dt <= 0 || this.forcedU10 !== null) {
      if (!this.initialised || this.forcedU10 !== null) {
        this.u10 = targetU10;
        this.lodos = targetLodos;
        this.initialised = true;
      }
    } else {
      // Sea state lags the wind: ~40 s for the chop amplitude, ~2 min for a regime change.
      this.u10 += (targetU10 - this.u10) * (1 - Math.exp(-dt / 40));
      this.lodos += (targetLodos - this.lodos) * (1 - Math.exp(-dt / 120));
    }
    if (speed100 > 0.1) {
      const k = dt > 0 ? 1 - Math.exp(-dt / 20) : 0;
      this.windDir.x += (wind.x / speed100 - this.windDir.x) * k;
      this.windDir.y += (wind.z / speed100 - this.windDir.y) * k;
      this.windDir.normalize();
    }

    const ratio = this.u10 / REF_U10;
    const groupFactor = [
      THREE.MathUtils.clamp(ratio ** 1.1, 0.25, 2.0),
      THREE.MathUtils.clamp(ratio ** 1.5, 0.15, 2.4),
      1 + 0.12 * Math.sin(time * 0.0021),
    ];
    this.uniforms.uSeaRegime.value.x = this.lodos;
    const wP = Math.cos(this.lodos * Math.PI * 0.5);
    const wL = Math.sin(this.lodos * Math.PI * 0.5);

    let steepSum = 0;
    for (const s of this.slots) {
      const regime = s.spec.group === WaveGroup.Swell ? 1 : s.lodos ? wL : wP;
      steepSum += s.spec.steepness * groupFactor[s.spec.group] * regime;
    }
    const steepScale = steepSum > MAX_TOTAL_STEEPNESS ? MAX_TOTAL_STEEPNESS / steepSum : 1;

    const dirs = this.uniforms.uWaveDir.value;
    const amps = this.uniforms.uWaveAmp.value;
    for (let i = 0; i < MAX_WAVES; i++) {
      const s = this.slots[i];
      if (!s) {
        amps[i].set(0, 0, 0, 0);
        continue;
      }
      const regime = s.spec.group === WaveGroup.Swell ? 1 : s.lodos ? wL : wP;
      const f = groupFactor[s.spec.group] * regime;
      const phase = fract((s.k * (s.dirX * originX + s.dirZ * originZ) + s.spec.phase - s.omega * time) / TWO_PI) * TWO_PI;
      amps[i].set(s.spec.amplitude * f, s.spec.steepness * f * steepScale, phase, s.spec.group);
      dirs[i].set(s.dirX, s.dirZ, s.k, s.spec.lambda);
    }

    // Detail bands: slope = c * Re(P) + s * Im(P); lodos plays the band backwards in time (waves reverse).
    const norm = 1 / Math.max(Math.hypot(wP, wL), 1e-4);
    const bandA = this.uniforms.uBandA.value;
    const bandB = this.uniforms.uBandB.value;
    for (let b = 0; b < BANDS.length; b++) {
      const band = BANDS[b];
      const ms = band.msSlope * THREE.MathUtils.clamp(ratio, 0.2, 2.2) ** band.windExp;
      const rms = Math.sqrt(ms);
      const wt = fract((band.omega * time) / TWO_PI) * TWO_PI;
      const c = 2 * Math.cos(wt) * (wP + wL) * norm * rms;
      const sn = 2 * Math.sin(wt) * (wP - wL) * norm * rms;
      bandA[b].set(c, sn, 1 / band.tile, ms);
      bandB[b].set(fract(originX / band.tile), fract(originZ / band.tile), band.lambda, 0);
    }

    const phaseA = fract(time / FLOW_PERIOD);
    const phaseB = fract(time / FLOW_PERIOD + 0.5);
    const weightA = 1 - Math.abs(1 - 2 * phaseA);
    this.uniforms.uFlowPhase.value.set((phaseA - 0.5) * FLOW_PERIOD, (phaseB - 0.5) * FLOW_PERIOD, weightA, 1 - weightA);
    const cycleA = Math.floor(time / FLOW_PERIOD);
    const cycleB = Math.floor(time / FLOW_PERIOD + 0.5);
    this.uniforms.uFlowJump.value.set(hash(cycleA, 1) * 211, hash(cycleA, 2) * 211, hash(cycleB, 3) * 211, hash(cycleB, 4) * 211);

    const capillary = CAPILLARY_MS_SLOPE * THREE.MathUtils.clamp(ratio, 0.2, 2.2) ** 1.5;
    // Whitecaps: Monahan coverage ~3.8e-6 U^3.4 -> none below ~4 m/s, a few % in a 12 m/s poyraz.
    const whitecap = THREE.MathUtils.smoothstep(this.u10, 4.2, 13);
    this.uniforms.uSeaParams.value.set(this.u10, capillary, THREE.MathUtils.lerp(0.35, 0.72, whitecap), whitecap);

    this.gustDrift.x = (this.gustDrift.x + this.windDir.x * this.u10 * 0.4 * dt) % 40000;
    this.gustDrift.y = (this.gustDrift.y + this.windDir.y * this.u10 * 0.4 * dt) % 40000;
    this.uniforms.uWindParams.value.set(this.windDir.x, this.windDir.y, this.gustDrift.x, this.gustDrift.y);
    this.uniforms.uFoamOffset.value.set(fract(originX / 9), fract(originZ / 9), fract(originX / 23), fract(originZ / 23));
  }
}
