const STEP = 0.05;
/**
 * Fraction of the frame budget the measured GPU work may use. The timer spans the whole frame's GPU work (all
 * systems' update/preRender passes, scene, HDR passes, post); the rest is headroom for the browser compositor.
 */
const GPU_BUDGET_FRACTION = 0.8;

export interface DynamicResolutionInput {
  /** Real frame delta (s). */
  dt: number;
  /** Robust recent GPU time of the whole frame (ms) or -1 when unavailable. */
  gpuMs: number;
  /** Wall-clock frame time (ms). */
  frameMs: number;
  /** Main-thread time spent from frame start to the end of command submission (ms, diagnostics). */
  cpuMs: number;
  targetFrameMs: number;
  minScale: number;
  maxScale: number;
  /** Paused = photo mode: render at the maximum scale. */
  paused: boolean;
}

/**
 * Picks the internal render scale with hysteresis. Prefers GPU timer measurements (resolution only helps when
 * the GPU is the bottleneck); falls back to frame time with verified (undo-if-useless) step-downs.
 */
export class DynamicResolution {
  scale = 1;
  enabled = true;
  forcedScale: number | null = null;
  private gpuEma = -1;
  private frameEma = -1;
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

  reset(scale: number): void {
    this.scale = scale;
    this.overTime = 0;
    this.underTime = 0;
    this.cooldown = 1;
    this.gpuEma = -1;
    this.frameEma = -1;
  }

  /** Returns true when `scale` changed. */
  update(input: DynamicResolutionInput): boolean {
    const min = Math.min(input.minScale, input.maxScale);
    const max = input.maxScale;
    const previous = this.scale;

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
      this.frameEma = this.frameEma < 0 ? input.frameMs : this.frameEma + (input.frameMs - this.frameEma) * 0.05;
    }
    if (input.cpuMs > 0) {
      this.cpuEma = this.cpuEma < 0 ? input.cpuMs : this.cpuEma + (input.cpuMs - this.cpuEma) * 0.05;
    }
    if (input.gpuMs > 0) {
      this.gpuEma = this.gpuEma < 0 ? input.gpuMs : this.gpuEma + (input.gpuMs - this.gpuEma) * 0.12;
    }
    this.cooldown -= dt;
    this.sinceUp += dt;

    const target = input.targetFrameMs;
    let over: boolean;
    let under: boolean;
    let predictedScaleDown: number;
    if (this.gpuEma > 0) {
      const budget = target * GPU_BUDGET_FRACTION;
      over = this.gpuEma > budget;
      const next = Math.min(max, this.scale + STEP);
      const predictedNext = this.gpuEma * (next * next) / (this.scale * this.scale);
      under = predictedNext < budget * 0.88;
      predictedScaleDown = this.scale * Math.sqrt((budget * 0.9) / this.gpuEma);
    } else if (this.frameEma > 0) {
      // Frame-time fallback (no GPU timer). A lower resolution only helps when GPU bound, so every step down is
      // verified: if the frame time did not improve, the step is undone and further drops are held off.
      this.cpuBoundHold -= dt;
      if (this.verifyTime > 0) {
        this.verifyTime -= dt;
        if (this.verifyTime <= 0 && this.frameEma > this.frameBeforeDrop * 0.95) {
          this.scale = this.scaleBeforeDrop;
          this.cpuBoundHold = 12;
          this.cooldown = 1.2;
          return this.scale !== previous;
        }
      }
      over = this.cpuBoundHold <= 0 && this.verifyTime <= 0 && this.frameEma > target * 1.15;
      under = this.frameEma < target * 1.04;
      predictedScaleDown = this.scale * Math.sqrt(target / this.frameEma);
    } else {
      return false;
    }

    this.overTime = over ? this.overTime + dt : Math.max(0, this.overTime - dt * 2);
    this.underTime = under && !over ? this.underTime + dt : 0;

    if (this.overTime > 0.4 && this.cooldown <= 0 && this.scale > min) {
      const next = clamp(Math.floor(predictedScaleDown / STEP) * STEP, min, this.scale - STEP);
      if (this.gpuEma <= 0) {
        this.scaleBeforeDrop = this.scale;
        this.frameBeforeDrop = this.frameEma;
        this.verifyTime = 1.5;
      }
      this.scale = Math.max(min, round2(next));
      this.overTime = 0;
      this.underTime = 0;
      this.cooldown = 1.2;
      if (this.sinceUp < 4) {
        this.upDelay = Math.min(this.upDelay * 2, 20);
      }
      this.stableTime = 0;
    } else if (this.underTime > this.upDelay && this.cooldown <= 0 && this.scale < max) {
      this.scale = round2(Math.min(max, this.scale + STEP));
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
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
