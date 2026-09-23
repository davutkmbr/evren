/**
 * Starts a layer's source nodes only while the layer is audible. Silent-but-running sources still cost
 * audio-thread DSP (every downstream filter keeps processing); stopped sources let Chrome propagate silence.
 * `hold` must exceed the layer's fade-out (gain smoothing) so sources stop only once the gain is ~0.
 */
export class SourceGate {
  private running: AudioScheduledSourceNode[] | null = null;
  /** Per-start helper nodes (e.g. modulators wired into a source's AudioParams): disconnected with the sources. */
  private readonly aux: AudioNode[] = [];
  private lastActive = -Infinity;

  /**
   * `start` creates and starts the layer's sources; nodes it pushes to `aux` live only as long as those sources
   * (anything connected into a started source's params must go there, or it would keep the dead source alive).
   */
  constructor(
    private readonly start: (when: number, aux: AudioNode[]) => AudioScheduledSourceNode[],
    private readonly hold = 4,
  ) {}

  get isRunning(): boolean {
    return this.running !== null;
  }

  update(active: boolean, now: number): void {
    if (active) {
      this.lastActive = now;
      if (!this.running) {
        this.running = this.start(now, this.aux);
      }
    } else if (this.running && now - this.lastActive > this.hold) {
      this.stopAll(now);
    }
  }

  private stopAll(now: number): void {
    for (const s of this.running ?? []) {
      try {
        s.stop(now);
      } catch {
        /* already stopped */
      }
      s.onended = () => s.disconnect();
    }
    for (const n of this.aux.splice(0)) {
      n.disconnect();
    }
    this.running = null;
  }

  dispose(now: number): void {
    this.stopAll(now);
  }
}

/** Looping noise source helper for gate factories. */
export function loopSource(ctx: BaseAudioContext, buffer: AudioBuffer, when: number, rate: number, rng: () => number): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(when, rng() * buffer.duration);
  return s;
}
