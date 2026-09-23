import * as THREE from 'three';
import { AsyncReadback } from './async-readback';
import { createPostMaterial, type FullscreenRenderer } from './fullscreen';
import { createColorTarget } from './targets';
import { METER_FRAG } from './shaders/meter.glsl';

const METER_W = 64;
const METER_H = 36;
const BINS = 128;
const LOG_MIN = -18;
const LOG_MAX = 18;
const KEY = 0.18;

export interface ExposureTuning {
  /** Stops of compensation (?ev=). */
  evBias: number;
  /** Adaptation clamp in log2 scene luminance: darker scenes are not brightened beyond this. */
  minLog: number;
  maxLog: number;
  /** Histogram percentiles averaged for metering (ignore deep shadows and the sun). */
  lowPercent: number;
  highPercent: number;
  /** Time constants (s): exposure rising (scene got darker) / falling (scene got brighter). */
  tauUp: number;
  tauDown: number;
}

export const DEFAULT_EXPOSURE_TUNING: ExposureTuning = {
  evBias: 0,
  minLog: -6.5,
  maxLog: 6.0,
  lowPercent: 0.35,
  highPercent: 0.93,
  tauUp: 1.5,
  tauDown: 0.7,
};

/**
 * Eye adaptation. The GPU writes a 64x36 log-luminance grid; it is read back asynchronously (no stall) and
 * the CPU builds a centre-weighted histogram, averages the chosen percentile band and adapts in EV space.
 */
export class AutoExposure {
  readonly tuning: ExposureTuning = { ...DEFAULT_EXPOSURE_TUNING };
  /** Linear exposure multiplier currently applied. */
  exposure = 1;
  /** 0 = day .. 1 = night (from the environment): night is shown darker than middle grey on purpose. */
  nightFactor = 0;
  /** Log2 of the metered average scene luminance (NaN until the first measurement). */
  averageLog = Number.NaN;
  targetEv = 0;
  fixedExposure: number | null = null;

  private ev = 0;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly readback: AsyncReadback;
  private readonly histogram = new Float32Array(BINS);
  private readonly weights = new Float32Array(METER_W * METER_H);
  private snapCount = 3;
  private hasMeasurement = false;
  private pendingMeasurement = false;

  constructor(gl: WebGL2RenderingContext) {
    this.target = createColorTarget(METER_W, METER_H, { name: 'post.meter', filter: THREE.NearestFilter });
    this.material = createPostMaterial({
      name: 'post.meter',
      fragmentShader: METER_FRAG,
      uniforms: { tSource: { value: null }, uFootprint: { value: new THREE.Vector2(1 / METER_W, 1 / METER_H) } },
    });
    this.readback = new AsyncReadback(gl, METER_W, METER_H, 4);
    for (let y = 0; y < METER_H; y++) {
      for (let x = 0; x < METER_W; x++) {
        const u = (x + 0.5) / METER_W - 0.5;
        const v = (y + 0.5) / METER_H - 0.5;
        // Centre-weighted with a slight bias toward the lower half (ground/city rather than open sky).
        const vb = v + 0.06;
        this.weights[y * METER_W + x] = 0.35 + Math.exp(-(u * u * 1.6 + vb * vb * 2.2) * 4.0);
      }
    }
  }

  /** Jump straight to the target on the next measurements (teleports, time jumps). */
  snap(): void {
    this.snapCount = 3;
  }

  get meterTexture(): THREE.Texture {
    return this.target.texture;
  }

  meter(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, source: THREE.Texture): void {
    this.material.uniforms.tSource.value = source;
    fs.draw(renderer, this.material, this.target);
    this.readback.request(renderer, this.target);
  }

  /** Collects finished readbacks. Call at the start of a frame (see AsyncReadback). */
  poll(): void {
    if (this.readback.poll()) {
      this.pendingMeasurement = true;
    }
  }

  update(realDt: number): void {
    if (this.pendingMeasurement) {
      this.pendingMeasurement = false;
      this.averageLog = this.measure(this.readback.data);
      this.targetEv = this.computeTargetEv(this.averageLog);
      if (!this.hasMeasurement || this.snapCount > 0) {
        this.ev = this.targetEv;
        this.snapCount = Math.max(0, this.snapCount - 1);
        this.hasMeasurement = true;
      }
    }
    if (this.hasMeasurement) {
      const dt = Math.min(Math.max(realDt, 0), 0.25);
      const tau = this.targetEv > this.ev ? this.tuning.tauUp : this.tuning.tauDown;
      this.ev += (this.targetEv - this.ev) * (1 - Math.exp(-dt / tau));
    }
    this.exposure = this.fixedExposure ?? Math.pow(2, this.ev);
  }

  private measure(data: Float32Array): number {
    const hist = this.histogram;
    hist.fill(0);
    let total = 0;
    const scale = BINS / (LOG_MAX - LOG_MIN);
    for (let i = 0, n = METER_W * METER_H; i < n; i++) {
      const lg = data[i * 4];
      if (!(lg === lg)) {
        continue;
      }
      let bin = Math.floor((lg - LOG_MIN) * scale);
      bin = bin < 0 ? 0 : bin >= BINS ? BINS - 1 : bin;
      const w = this.weights[i];
      hist[bin] += w;
      total += w;
    }
    if (total <= 0) {
      return 0;
    }
    const lo = total * this.tuning.lowPercent;
    const hi = total * this.tuning.highPercent;
    let acc = 0;
    let sum = 0;
    let wsum = 0;
    for (let b = 0; b < BINS; b++) {
      const w = hist[b];
      if (w <= 0) {
        continue;
      }
      const start = acc;
      const end = acc + w;
      acc = end;
      const overlap = Math.min(end, hi) - Math.max(start, lo);
      if (overlap > 0) {
        const center = LOG_MIN + (b + 0.5) / scale;
        sum += center * overlap;
        wsum += overlap;
      }
    }
    return wsum > 0 ? sum / wsum : 0;
  }

  /**
   * Maps metered log luminance to exposure EV: middle grey key, clamped adaptation range, and a
   * perceptual compensation so dark scenes stay dark (night) and very bright ones read bright.
   */
  private computeTargetEv(avgLog: number): number {
    const t = this.tuning;
    const clamped = Math.min(Math.max(avgLog, t.minLog), t.maxLog);
    const dark = smoothstep(-1.5, -7.0, avgLog);
    const bright = smoothstep(0.5, 3.5, avgLog);
    const compensation = -1.6 * dark + 0.35 * bright - 1.3 * this.nightFactor;
    return Math.log2(KEY) - clamped + compensation + t.evBias;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.readback.dispose();
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
