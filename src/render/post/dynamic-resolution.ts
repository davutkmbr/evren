const STEP = 0.05;
/**
 * Fraction of the frame budget the measured GPU work may use. The timer spans the whole frame's GPU work (all
 * systems' update/preRender passes, scene, HDR passes, post); the rest is headroom for the browser compositor.
 */
const GPU_BUDGET_FRACTION = 0.8;
/**
 * Engine frame intervals kept for the frame-time signal: the mean after dropping the slowest FRAME_TRIM share.
 * Not the median: on ANGLE/Metal an overloaded GPU shows up as most frames still at vsync plus long stalls (measured
 * with extra GPU load: median 16.7 ms, mean 53 ms, p90 167 ms), which a median never sees. The trim removes isolated
 * hitches (streaming, GC); drops that do not help are undone by the step-down verification.
 */
const FRAME_WINDOW = 60;
const FRAME_TRIM = 0.1;
/**
 * A pipelined GPU cannot spend more time per frame than the frame interval. A timer that reads above this ratio
 * (plus FRAME_SLACK_MS) for GPU_DISTRUST_S is inflated, and the GPU signal is dropped for good.
 */
const GPU_PLAUSIBLE_RATIO = 1.25;
const FRAME_SLACK_MS = 1;
const GPU_DISTRUST_S = 2;

export interface DynamicResolutionInput {
  /** Real frame delta (s). */
  dt: number;
  /** Robust recent GPU time of the whole frame (ms) or -1 when unavailable. */
  gpuMs: number;
  /** Wall-clock frame time (ms). */
  frameMs: number;
  /**
   * Shortest frame interval the page can reach regardless of load (ms): the display refresh interval, or the
   * ?fps cap rounded up to whole refresh intervals. Frames at this pace are never a reason to drop resolution.
   */
  paceFloorMs: number;
  /** Main-thread time spent from frame start to the end of command submission (ms, diagnostics). */
  cpuMs: number;
  targetFrameMs: number;
  minScale: number;
  maxScale: number;
  /** Paused = photo mode: render at the maximum scale. */
  paused: boolean;
}

export interface DynamicResolutionStats {
  scale: number;
  /** Which signal drives the scale: the GPU timer, the frame time, or nothing yet / held (paused, forced, off). */
  mode: 'gpu' | 'frame' | 'hold';
  /** Trimmed-mean engine frame interval (ms) and the frame time aimed for (max of the preset target and the pace floor). */
  frameMs: number;
  targetMs: number;
  /** Smoothed GPU timer reading (ms, -1 = none) and whether it is still trusted. */
  gpuMs: number;
  gpuTrusted: boolean;
  /** Seconds of frame-time step-downs blocked after one did not help (CPU bound). */
  cpuBoundHoldS: number;
  drops: number;
  raises: number;
}

/**
 * Picks the internal render scale with hysteresis. Prefers GPU timer measurements (resolution only helps when
 * the GPU is the bottleneck) while they are plausible; otherwise follows the (trimmed mean) frame time against the pace
 * floor with verified (undo-if-useless) step-downs. Frames that already run at the pace floor (vsync or ?fps cap)
 * never lower the scale, whatever the GPU timer says.
 */
export class DynamicResolution {
  scale = 1;
  enabled = true;
  forcedScale: number | null = null;
  private gpuEma = -1;
  private cpuEma = -1;
  private overTime = 0;
  private underTime = 0;
  private cooldown = 0;
  private upDelay = 2.5;
  private sinceUp = 1e9;
  private stableTime = 0;
  private verifyTime = 0;
  private scaleBeforeDrop = 1;
  private frameBeforeDrop = 0;
  private cpuBoundHold = 0;
  private cpuBoundHoldLength = 12;
  private readonly frames = new Float32Array(FRAME_WINDOW);
  private readonly framesSorted = new Float32Array(FRAME_WINDOW);
  private frameCount = 0;
  private frameIndex = 0;
  private frameTrimmed = -1;
  private gpuTrusted = true;
  private implausibleTime = 0;
  private mode: DynamicResolutionStats['mode'] = 'hold';
  private target = 0;
  private drops = 0;
  private raises = 0;

  reset(scale: number): void {
    this.scale = scale;
    this.overTime = 0;
    this.underTime = 0;
    this.cooldown = 1;
    this.gpuEma = -1;
    this.frameCount = 0;
    this.frameTrimmed = -1;
    this.verifyTime = 0;
  }

  /** Returns true when `scale` changed. */
  update(input: DynamicResolutionInput): boolean {
    const min = Math.min(input.minScale, input.maxScale);
    const max = input.maxScale;
    const previous = this.scale;

    this.mode = 'hold';
    if (this.forcedScale !== null) {
      this.scale = clamp(this.forcedScale, 0.25, 2);
      return this.scale !== previous;
    }
    if (!this.enabled || input.paused) {
      this.scale = max;
      this.overTime = 0;
      this.underTime = 0;
      return this.scale !== previous;
    }
    if (this.scale > max || this.scale < min) {
      this.scale = clamp(this.scale, min, max);
      return true;
    }

    const dt = Math.min(input.dt, 0.1);
    if (input.frameMs > 0 && input.frameMs < 250) {
      this.frames[this.frameIndex] = input.frameMs;
      this.frameIndex = (this.frameIndex + 1) % FRAME_WINDOW;
      this.frameCount = Math.min(this.frameCount + 1, FRAME_WINDOW);
      this.frameTrimmed = this.frameCount >= FRAME_WINDOW / 2 ? this.trimmedMeanFrame() : -1;
    }
    if (input.cpuMs > 0) {
      this.cpuEma = this.cpuEma < 0 ? input.cpuMs : this.cpuEma + (input.cpuMs - this.cpuEma) * 0.05;
    }
    if (input.gpuMs > 0) {
      this.gpuEma = this.gpuEma < 0 ? input.gpuMs : this.gpuEma + (input.gpuMs - this.gpuEma) * 0.12;
    }
    this.cooldown -= dt;
    this.sinceUp += dt;

    const target = Math.max(input.targetFrameMs, input.paceFloorMs);
    this.target = target;
    const frameMs = this.frameTrimmed;
    // Frames at (or within vsync jitter of) the pace floor: the GPU keeps up, a lower resolution cannot help.
    const atPace = frameMs > 0 && frameMs <= target * 1.05;
    if (this.gpuTrusted && this.gpuEma > 0 && frameMs > 0) {
      const implausible = this.gpuEma > frameMs * GPU_PLAUSIBLE_RATIO + FRAME_SLACK_MS;
      this.implausibleTime = implausible ? this.implausibleTime + dt : 0;
      if (this.implausibleTime > GPU_DISTRUST_S) {
        this.gpuTrusted = false;
        console.info(
          `[post] GPU timer reads ${this.gpuEma.toFixed(1)} ms for ${frameMs.toFixed(1)} ms frames: ignored, dynamic resolution follows frame pacing`,
        );
      }
    }
    let over: boolean;
    let under: boolean;
    let predictedScaleDown: number;
    if (this.gpuTrusted && this.gpuEma > 0) {
      this.mode = 'gpu';
      const budget = target * GPU_BUDGET_FRACTION;
      over = this.gpuEma > budget && !atPace;
      const next = Math.min(max, this.scale + STEP);
      const predictedNext = this.gpuEma * (next * next) / (this.scale * this.scale);
      under = predictedNext < budget * 0.88;
      predictedScaleDown = this.scale * Math.sqrt((budget * 0.9) / this.gpuEma);
    } else if (frameMs > 0) {
      this.mode = 'frame';
      // Frame-time fallback (no GPU timer). A lower resolution only helps when GPU bound, so every step down is
      // verified: if the frame time did not improve, the step is undone and further drops are held off.
      this.cpuBoundHold -= dt;
      if (this.verifyTime > 0) {
        this.verifyTime -= dt;
        if (this.verifyTime <= 0 && frameMs > this.frameBeforeDrop * 0.95) {
          this.scale = this.scaleBeforeDrop;
          // Repeated useless drops (CPU bound) back off exponentially instead of popping every few seconds.
          this.cpuBoundHold = this.cpuBoundHoldLength;
          this.cpuBoundHoldLength = Math.min(this.cpuBoundHoldLength * 2, 120);
          this.cooldown = 1.2;
          return this.scale !== previous;
        }
        if (this.verifyTime <= 0) {
          this.cpuBoundHoldLength = 12;
        }
      }
      over = this.cpuBoundHold <= 0 && this.verifyTime <= 0 && frameMs > target * 1.15;
      under = atPace;
      predictedScaleDown = this.scale * Math.sqrt(target / frameMs);
    } else {
      return false;
    }

    this.overTime = over ? this.overTime + dt : Math.max(0, this.overTime - dt * 2);
    this.underTime = under && !over ? this.underTime + dt : 0;

    if (this.overTime > 0.4 && this.cooldown <= 0 && this.scale > min) {
      const next = clamp(Math.floor(predictedScaleDown / STEP) * STEP, min, this.scale - STEP);
      if (this.mode === 'frame') {
        this.scaleBeforeDrop = this.scale;
        this.frameBeforeDrop = frameMs;
        this.verifyTime = 2;
      }
      this.scale = Math.max(min, round2(next));
      this.drops++;
      this.overTime = 0;
      this.underTime = 0;
      this.cooldown = 1.2;
      if (this.sinceUp < 4) {
        this.upDelay = Math.min(this.upDelay * 2, 20);
      }
      this.stableTime = 0;
    } else if (this.underTime > this.upDelay && this.cooldown <= 0 && this.scale < max) {
      this.scale = round2(Math.min(max, this.scale + STEP));
      this.raises++;
      this.underTime = 0;
      this.cooldown = 1.2;
      this.sinceUp = 0;
    } else {
      this.stableTime += dt;
      if (this.stableTime > 20 && this.upDelay > 2.5) {
        this.upDelay = Math.max(2.5, this.upDelay * 0.5);
        this.stableTime = 0;
      }
    }
    return this.scale !== previous;
  }

  get gpuMs(): number {
    return this.gpuEma;
  }

  get stats(): DynamicResolutionStats {
    return {
      scale: this.scale,
      mode: this.mode,
      frameMs: round2(this.frameTrimmed),
      targetMs: round2(this.target),
      gpuMs: round2(this.gpuEma),
      gpuTrusted: this.gpuTrusted,
      cpuBoundHoldS: round2(Math.max(0, this.cpuBoundHold)),
      drops: this.drops,
      raises: this.raises,
    };
  }

  private trimmedMeanFrame(): number {
    const n = this.frameCount;
    const out = this.framesSorted;
    for (let i = 0; i < n; i++) {
      const v = this.frames[i];
      let j = i - 1;
      while (j >= 0 && out[j] > v) {
        out[j + 1] = out[j];
        j--;
      }
      out[j + 1] = v;
    }
    const keep = Math.max(1, n - Math.floor(n * FRAME_TRIM));
    let sum = 0;
    for (let i = 0; i < keep; i++) {
      sum += out[i];
    }
    return sum / keep;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
