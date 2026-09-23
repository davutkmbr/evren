/**
 * Wraps an AudioParam that is driven from the game loop. Only schedules a new smoothed target when the value
 * moved more than a relative/absolute threshold, which keeps the automation timeline short (no per-frame spam)
 * and avoids zipper noise.
 */
export class SmoothParam {
  private last: number;

  constructor(
    private param: AudioParam,
    initial: number,
    private readonly timeConstant = 0.06,
    private readonly relThreshold = 0.015,
    private readonly absThreshold = 1e-4,
  ) {
    this.last = initial;
    param.value = initial;
  }

  get value(): number {
    return this.last;
  }

  set(target: number, now: number, timeConstant = this.timeConstant): void {
    // setTargetAtTime throws on non-finite values: a bad frame must never break the voice.
    if (!Number.isFinite(target) || !Number.isFinite(now)) {
      return;
    }
    const d = Math.abs(target - this.last);
    if (d <= this.absThreshold || d <= Math.abs(this.last) * this.relThreshold) {
      return;
    }
    this.last = target;
    this.param.setTargetAtTime(target, now, timeConstant);
  }

  /** Moves control to another AudioParam (e.g. on a freshly started source), carrying the current value. */
  bind(param: AudioParam): void {
    this.param = param;
    param.value = this.last;
  }
}

export interface ParamTarget {
  set(target: number, now: number): void;
}

/** Drives several params from one value, each with its own multiplier (e.g. detuned L/R filters). */
export class ParamGroup implements ParamTarget {
  private readonly params: SmoothParam[];

  constructor(
    params: AudioParam[],
    initial: number,
    private readonly scales: number[],
    timeConstant = 0.1,
  ) {
    this.params = params.map((p, i) => new SmoothParam(p, initial * scales[i], timeConstant));
  }

  set(target: number, now: number): void {
    for (let i = 0; i < this.params.length; i++) {
      this.params[i].set(target * this.scales[i], now);
    }
  }
}
