/** Percentile of an ascending array (nearest rank). */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

/** Frame times over a sliding window of wall-clock time, for the on-screen readout. */
export class FrameTimeWindow {
  private times: number[] = [];
  private stamps: number[] = [];

  constructor(private readonly windowMs = 3000) {}

  push(nowMs: number, frameMs: number): void {
    this.times.push(frameMs);
    this.stamps.push(nowMs);
    let drop = 0;
    while (drop < this.stamps.length && nowMs - this.stamps[drop] > this.windowMs) {
      drop++;
    }
    if (drop > 0) {
      this.times.splice(0, drop);
      this.stamps.splice(0, drop);
    }
  }

  summary(): { frames: number; medianMs: number; p99Ms: number; maxMs: number } {
    const sorted = [...this.times].sort((a, b) => a - b);
    return {
      frames: sorted.length,
      medianMs: percentile(sorted, 0.5),
      p99Ms: percentile(sorted, 0.99),
      maxMs: sorted.length ? sorted[sorted.length - 1] : 0,
    };
  }
}

export interface FrameSample {
  /** Page time at the start of the frame (ms). */
  t: number;
  /** Interval since the previous rendered frame (ms). */
  frameMs: number;
  /** Main-thread time spent in update + render submission (ms). */
  cpuMs: number;
  drawCalls: number;
  triangles: number;
  tilesLive: number;
  /** Tiles added to the scene this frame. */
  added: number;
  /** Distance walked along the route (m), or -1 off route. */
  s: number;
}

/** Every frame of a measured run (walk-test), with a summary for the report. */
export class FrameRecorder {
  private samples: FrameSample[] = [];
  recording = false;

  start(): void {
    this.samples = [];
    this.recording = true;
  }

  stop(): void {
    this.recording = false;
  }

  push(sample: FrameSample): void {
    if (this.recording) {
      this.samples.push(sample);
    }
  }

  report(hitchMs = 50): Record<string, unknown> {
    const s = this.samples;
    const col = (f: (x: FrameSample) => number) => Float64Array.from(s, f).sort();
    const frame = col((x) => x.frameMs);
    const cpu = col((x) => x.cpuMs);
    const calls = col((x) => x.drawCalls);
    const tris = col((x) => x.triangles);
    const tiles = col((x) => x.tilesLive);
    const r = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
    const hitches = s.filter((x) => x.frameMs > hitchMs);
    const duration = s.length ? (s[s.length - 1].t - s[0].t) / 1000 : 0;
    return {
      frames: s.length,
      durationS: r(duration, 1),
      frameMs: { median: r(percentile(frame, 0.5)), p99: r(percentile(frame, 0.99)), max: r(percentile(frame, 1)) },
      fpsMedian: frame.length ? r(1000 / percentile(frame, 0.5), 1) : 0,
      cpuMs: { median: r(percentile(cpu, 0.5)), p99: r(percentile(cpu, 0.99)), max: r(percentile(cpu, 1)) },
      hitchesOver50ms: hitches.length,
      hitches: hitches.slice(0, 12).map((x) => ({ atS: r((x.t - s[0].t) / 1000, 2), frameMs: r(x.frameMs, 1), cpuMs: r(x.cpuMs, 1), added: x.added, walkedM: r(x.s, 1) })),
      framesWithTileAdds: s.filter((x) => x.added > 0).length,
      drawCalls: { median: percentile(calls, 0.5), max: percentile(calls, 1) },
      triangles: { median: percentile(tris, 0.5), max: percentile(tris, 1) },
      tilesLive: { median: percentile(tiles, 0.5), max: percentile(tiles, 1) },
    };
  }
}
