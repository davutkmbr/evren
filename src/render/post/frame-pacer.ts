/** Longest run of skipped animation frames before a frame is submitted anyway (a lost fence must not freeze the game). */
const MAX_CONSECUTIVE_SKIPS = 6;
/** Fences kept at most (older ones are dropped unsignalled). */
const MAX_FENCES = 8;

/**
 * Bounds how far the CPU runs ahead of the GPU. One fence per submitted frame; while the fences of the last
 * `maxInFlight` frames are all unsignalled, the next animation frame is skipped (not blocked on): the browser keeps
 * presenting the previous image and the next submitted frame takes the whole elapsed time step.
 * Fence status is polled with clientWaitSync(timeout 0), which never waits for the GPU process.
 */
export class FramePacer {
  /** Animation frames skipped so far (diagnostics). */
  skipped = 0;
  private readonly fences: WebGLSync[] = [];
  private consecutive = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    /** Frames the GPU may still be working on when a new one starts; 0 disables pacing. */
    readonly maxInFlight: number,
  ) {}

  get inFlight(): number {
    return this.fences.length;
  }

  /** Retires the fences of completed frames. */
  poll(): void {
    const gl = this.gl;
    while (this.fences.length > 0) {
      const status = gl.clientWaitSync(this.fences[0], 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) {
        break;
      }
      gl.deleteSync(this.fences.shift()!);
    }
  }

  /** True when this animation frame should be skipped. */
  behind(): boolean {
    this.poll();
    if (this.maxInFlight <= 0) {
      return false;
    }
    if (this.fences.length >= this.maxInFlight && this.consecutive < MAX_CONSECUTIVE_SKIPS) {
      this.consecutive++;
      this.skipped++;
      return true;
    }
    this.consecutive = 0;
    return false;
  }

  /** Marks the end of a submitted frame. */
  endFrame(): void {
    if (this.maxInFlight <= 0) {
      return;
    }
    const gl = this.gl;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (sync) {
      this.fences.push(sync);
    }
    while (this.fences.length > MAX_FENCES) {
      gl.deleteSync(this.fences.shift()!);
    }
  }

  dispose(): void {
    for (const sync of this.fences) {
      this.gl.deleteSync(sync);
    }
    this.fences.length = 0;
  }
}
