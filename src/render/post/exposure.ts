import * as THREE from 'three';
import { createPostMaterial, type FullscreenRenderer } from './fullscreen';
import { QueryReadout } from './query-readout';
import { createColorTarget } from './targets';
import { ADAPT_FRAG, EXPOSURE_BITS_FRAG, HISTOGRAM_FRAG, METER_FRAG } from './shaders/meter.glsl';

const METER_W = 64;
const METER_H = 36;
const BINS = 128;
const LOG_MIN = -18;
const LOG_MAX = 18;
const KEY = 0.18;
/** Metered log2 luminance at or below this is an exactly black texel (the meter clamps luminance to 1e-7). */
const BLACK_LOG = -22;
/** Frames that jump straight to the target after snap() (teleports, time jumps). */
const SNAP_FRAMES = 3;
/** Seconds between two CPU copies of the exposure state (weather / diagnostics only; never the image). */
const MIRROR_INTERVAL_S = 0.25;
/** Bits of the CPU copy (layout: EXPOSURE_BITS_FRAG). */
const MIRROR_BITS = 30;

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

const GLSL_DEFINES = {
  METER_W,
  METER_H,
  BINS,
  LOG_MIN: LOG_MIN.toFixed(1),
  LOG_MAX: LOG_MAX.toFixed(1),
  BLACK_LOG: BLACK_LOG.toFixed(1),
  KEY: KEY.toFixed(4),
};

/**
 * Eye adaptation, entirely on the GPU. The meter writes a 64x36 log-luminance grid; a 128x1 pass builds the
 * centre-weighted histogram; a 2x1 pass averages the chosen percentile band, maps it to a target EV and adapts the
 * previous exposure toward it (ping-pong state). Bloom and composite read the exposure from that state texture, so no
 * frame ever waits for a readback. The CPU only receives a quantized copy a few times per second through occlusion
 * queries (QueryReadout, never blocks) for the weather's lightning and diagnostics: `exposure` (±0.3 %),
 * `averageLog` and `blackFraction` lag the image by a few frames up to ~0.3 s.
 *
 * State texel 0: (exposure, ev, target ev, has measurement); texel 1: (metered log2 luminance, black fraction, 0, 1).
 */
export class AutoExposure {
  readonly tuning: ExposureTuning = { ...DEFAULT_EXPOSURE_TUNING };
  /** Linear exposure multiplier of the latest CPU copy (the image uses `texture`). */
  exposure = 1;
  /** 0 = day .. 1 = night (from the environment): night is shown darker than middle grey on purpose. */
  nightFactor = 0;
  /** Log2 of the metered average scene luminance (NaN until the first measurement). */
  averageLog = Number.NaN;
  fixedExposure: number | null = null;
  /** Weighted fraction of the last copied measurement that was exactly black (black-frame diagnostics). */
  blackFraction = 0;
  /** Number of CPU copies received so far (lets callers react to each new one). */
  measurements = 0;

  private readonly meterTarget: THREE.WebGLRenderTarget;
  private readonly histogramTarget: THREE.WebGLRenderTarget;
  private readonly state: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private current = 0;
  private readonly meterMaterial: THREE.ShaderMaterial;
  private readonly histogramMaterial: THREE.ShaderMaterial;
  private readonly adaptMaterial: THREE.ShaderMaterial;
  private readonly bitsMaterial: THREE.ShaderMaterial;
  private readonly readout: QueryReadout;
  private snapFrames = SNAP_FRAMES;
  private sinceMirror = Infinity;

  constructor(gl: WebGL2RenderingContext) {
    this.meterTarget = createColorTarget(METER_W, METER_H, { name: 'post.meter', filter: THREE.NearestFilter });
    this.histogramTarget = createColorTarget(BINS, 1, { name: 'post.meterHistogram', filter: THREE.NearestFilter, type: THREE.FloatType });
    // Float32: per-frame EV steps (~1e-3) vanish in half precision and the adaptation would stall.
    this.state = [
      createColorTarget(2, 1, { name: 'post.exposureA', filter: THREE.NearestFilter, type: THREE.FloatType }),
      createColorTarget(2, 1, { name: 'post.exposureB', filter: THREE.NearestFilter, type: THREE.FloatType }),
    ];
    this.meterMaterial = createPostMaterial({
      name: 'post.meter',
      fragmentShader: METER_FRAG,
      uniforms: { tSource: { value: null }, uFootprint: { value: new THREE.Vector2(1 / METER_W, 1 / METER_H) } },
    });
    this.histogramMaterial = createPostMaterial({
      name: 'post.meterHistogram',
      fragmentShader: HISTOGRAM_FRAG,
      defines: GLSL_DEFINES,
      uniforms: { tMeter: { value: this.meterTarget.texture } },
    });
    this.adaptMaterial = createPostMaterial({
      name: 'post.exposureAdapt',
      fragmentShader: ADAPT_FRAG,
      defines: GLSL_DEFINES,
      uniforms: {
        tHistogram: { value: this.histogramTarget.texture },
        tPrevious: { value: null },
        uDt: { value: 0 },
        uTauUp: { value: 1 },
        uTauDown: { value: 1 },
        uMinLog: { value: 0 },
        uMaxLog: { value: 0 },
        uLowPercent: { value: 0 },
        uHighPercent: { value: 1 },
        uNight: { value: 0 },
        uEvBias: { value: 0 },
        uSnap: { value: 0 },
        uFixed: { value: -1 },
      },
    });
    this.bitsMaterial = createPostMaterial({
      name: 'post.exposureBits',
      fragmentShader: EXPOSURE_BITS_FRAG,
      uniforms: { tState: { value: null }, uBit: { value: 0 } },
    });
    this.readout = new QueryReadout(gl, this.bitsMaterial, MIRROR_BITS);
  }

  /** Jump straight to the target on the next measurements (teleports, time jumps). */
  snap(): void {
    this.snapFrames = SNAP_FRAMES;
  }

  get meterTexture(): THREE.Texture {
    return this.meterTarget.texture;
  }

  /** Exposure state written by the last update(): sample texel (0, 0).r for the linear exposure. */
  get texture(): THREE.Texture {
    return this.state[this.current].texture;
  }

  /** Meters `source`, then adapts the exposure state on the GPU (call once per frame after the source exists). */
  update(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, source: THREE.Texture, realDt: number): void {
    this.meterMaterial.uniforms.tSource.value = source;
    fs.draw(renderer, this.meterMaterial, this.meterTarget);
    fs.draw(renderer, this.histogramMaterial, this.histogramTarget);

    const t = this.tuning;
    const u = this.adaptMaterial.uniforms;
    const previous = this.state[this.current];
    this.current = 1 - this.current;
    u.tPrevious.value = previous.texture;
    u.uDt.value = Math.min(Math.max(realDt, 0), 0.25);
    u.uTauUp.value = t.tauUp;
    u.uTauDown.value = t.tauDown;
    u.uMinLog.value = t.minLog;
    u.uMaxLog.value = t.maxLog;
    u.uLowPercent.value = t.lowPercent;
    u.uHighPercent.value = t.highPercent;
    u.uNight.value = this.nightFactor;
    u.uEvBias.value = t.evBias;
    u.uSnap.value = this.snapFrames > 0 ? 1 : 0;
    u.uFixed.value = this.fixedExposure ?? -1;
    fs.draw(renderer, this.adaptMaterial, this.state[this.current]);
    this.snapFrames = Math.max(0, this.snapFrames - 1);

    this.sinceMirror += Math.max(realDt, 0);
    if (this.sinceMirror >= MIRROR_INTERVAL_S && !this.readout.busy) {
      this.bitsMaterial.uniforms.tState.value = this.state[this.current].texture;
      this.readout.request(renderer, fs);
      this.sinceMirror = 0;
    }
  }

  /** Collects a finished CPU copy of the state, if one arrived (never waits). */
  poll(): void {
    const bits = this.readout.poll();
    if (bits < 0) {
      return;
    }
    const field = (from: number, count: number): number => Math.floor(bits / 2 ** from) % 2 ** count;
    this.exposure = Math.pow(2, (field(0, 12) / 4095) * 32 - 16);
    this.averageLog = field(29, 1) === 1 ? (field(12, 10) / 1023) * 48 - 24 : Number.NaN;
    this.blackFraction = field(22, 7) / 127;
    this.measurements++;
  }

  dispose(): void {
    this.meterTarget.dispose();
    this.histogramTarget.dispose();
    this.state[0].dispose();
    this.state[1].dispose();
    this.meterMaterial.dispose();
    this.histogramMaterial.dispose();
    this.adaptMaterial.dispose();
    this.bitsMaterial.dispose();
    this.readout.dispose();
  }
}
