/** AudioParam envelope helpers. Every envelope starts and ends at 0 to avoid clicks. */

/** Attack (linear) to `peak`, then exponential decay; reaches ~-60 dB after `decay` seconds. */
export function percEnv(param: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(0, t + attack, decay / 6.9);
}

/** Schedules a piecewise-linear envelope from [time, value] points relative to t (values scaled by `scale`). */
export function linearPoints(param: AudioParam, t: number, points: ReadonlyArray<readonly [number, number]>, scale = 1): void {
  param.setValueAtTime(points[0][1] * scale, t + points[0][0]);
  for (let i = 1; i < points.length; i++) {
    param.linearRampToValueAtTime(points[i][1] * scale, t + points[i][0]);
  }
}

/** Exponential glide through [time, value] points (values must be > 0), e.g. for frequencies. */
export function expPoints(param: AudioParam, t: number, points: ReadonlyArray<readonly [number, number]>, scale = 1): void {
  param.setValueAtTime(Math.max(1e-4, points[0][1] * scale), t + points[0][0]);
  for (let i = 1; i < points.length; i++) {
    param.exponentialRampToValueAtTime(Math.max(1e-4, points[i][1] * scale), t + points[i][0]);
  }
}
