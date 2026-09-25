interface TimerQueryExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

const RING_SIZE = 6;

/**
 * Measures GPU time between begin()/end() with EXT_disjoint_timer_query_webgl2.
 * Results arrive a few frames late; `lastMs` holds the newest valid measurement (or -1).
 * Caveat: on ANGLE/Metal (Chrome/Safari on macOS) TIME_ELAPSED is not the time between begin and end. ANGLE sums
 * `GPUEndTime - GPUStartTime` of every Metal command buffer committed while the query is active
 * (libANGLE/renderer/metal/mtl_command_buffer.mm, recordCommandBufferTimeElapsed). Command buffers queued back to
 * back overlap in time, so the sum grows with the number of flushes rather than the GPU work: measured on an Apple
 * GPU, 16 draws in 16 command buffers read 62 ms for 8 ms of wall time, the same 16 draws in one command buffer
 * 0.6 ms (4 ms wall), and whole frames read 50-150 ms for 18-50 ms frame intervals. `reliable` is false there;
 * the values remain useful only as relative diagnostics (?postprof, ?postbench).
 */
export class GpuTimer {
  readonly supported: boolean;
  /** False where TIME_ELAPSED is known not to measure GPU time (ANGLE's Metal backend, see above). */
  readonly reliable: boolean;
  lastMs = -1;
  /** performance.now() of the newest result. */
  lastResultTime = 0;
  private readonly ext: TimerQueryExt | null;
  private readonly queries: (WebGLQuery | null)[] = [];
  private readonly pending: boolean[] = [];
  private readonly discarded: boolean[] = [];
  private writeIndex = 0;
  private readIndex = 0;
  private active = false;
  private readonly history = new Float32Array(120);
  private readonly sorted = new Float32Array(120);
  private historyCount = 0;
  private historyIndex = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    enabled = true,
  ) {
    this.ext = enabled ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null) : null;
    this.supported = !!this.ext;
    this.reliable = this.supported && !isAngleMetal(gl);
    for (let i = 0; i < RING_SIZE; i++) {
      this.queries.push(this.ext ? gl.createQuery() : null);
      this.pending.push(false);
      this.discarded.push(false);
    }
  }

  begin(): void {
    if (!this.ext || this.active) {
      return;
    }
    const slot = this.writeIndex;
    const query = this.queries[slot];
    if (!query || this.pending[slot]) {
      return;
    }
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = true;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Ends the open query. `discard` = the span is not representative (its result is dropped when it arrives). */
  end(discard = false): void {
    if (!this.ext || !this.active) {
      return;
    }
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.active = false;
    this.pending[this.writeIndex] = true;
    this.discarded[this.writeIndex] = discard;
    this.writeIndex = (this.writeIndex + 1) % RING_SIZE;
  }

  /** Collects finished queries (oldest first). Returns true when a new measurement arrived. */
  poll(): boolean {
    if (!this.ext) {
      return false;
    }
    const gl = this.gl;
    let updated = false;
    for (let n = 0; n < RING_SIZE; n++) {
      const slot = this.readIndex;
      if (!this.pending[slot]) {
        break;
      }
      const query = this.queries[slot]!;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        break;
      }
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      this.pending[slot] = false;
      this.readIndex = (this.readIndex + 1) % RING_SIZE;
      if (!disjoint && ns > 0 && !this.discarded[slot]) {
        this.lastMs = ns / 1e6;
        this.lastResultTime = performance.now();
        this.history[this.historyIndex] = this.lastMs;
        this.historyIndex = (this.historyIndex + 1) % this.history.length;
        this.historyCount = Math.min(this.historyCount + 1, this.history.length);
        updated = true;
      }
    }
    return updated;
  }

  /** Percentile (0..1) of all retained measurements (up to 120), -1 when none. */
  percentile(p: number): number {
    return this.recentPercentile(p, this.history.length);
  }

  /**
   * Percentile (0..1) of the newest `count` measurements, -1 when none. Allocation free (insertion sort of a copy);
   * a low percentile of a short window rejects one-off spikes (GPU shared with other processes) but follows
   * sustained load.
   */
  recentPercentile(p: number, count: number): number {
    const n = Math.min(count, this.historyCount, this.sorted.length);
    if (n === 0) {
      return -1;
    }
    const len = this.history.length;
    const out = this.sorted;
    for (let i = 0; i < n; i++) {
      const v = this.history[(this.historyIndex - 1 - i + len) % len];
      let j = i - 1;
      while (j >= 0 && out[j] > v) {
        out[j + 1] = out[j];
        j--;
      }
      out[j + 1] = v;
    }
    return out[Math.min(n - 1, Math.floor(p * n))];
  }

  dispose(): void {
    if (this.active && this.ext) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.active = false;
    }
    for (const q of this.queries) {
      if (q) {
        this.gl.deleteQuery(q);
      }
    }
    this.queries.length = 0;
  }
}

function isAngleMetal(gl: WebGL2RenderingContext): boolean {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /metal/i.test(renderer);
}
