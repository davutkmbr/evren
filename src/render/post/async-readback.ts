import type * as THREE from 'three';

interface Slot {
  buffer: WebGLBuffer;
  sync: WebGLSync | null;
  tag: number;
}

/**
 * Non-blocking float readback of a small render target through pixel-pack buffers + fences.
 * `request()` queues a copy; `poll()` copies finished ones into `data`.
 * Chrome's getBufferSubData is a command-buffer round trip that waits for every command queued before it, so
 * poll() should run at the start of a frame (before new work is queued). Buffers use a COPY usage hint: Chrome
 * no longer consumes the READ-usage shadow copies and warns on every fence for READ buffers.
 */
export class AsyncReadback {
  readonly data: Float32Array;
  /** Tag passed to the request() whose result is currently in `data`. */
  dataTag = -1;
  private readonly slots: Slot[] = [];
  private write = 0;
  private read = 0;
  private readonly byteLength: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly width: number,
    readonly height: number,
    slotCount = 3,
  ) {
    this.byteLength = width * height * 4 * 4;
    this.data = new Float32Array(width * height * 4);
    for (let i = 0; i < slotCount; i++) {
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.byteLength, gl.STREAM_COPY);
      this.slots.push({ buffer, sync: null, tag: -1 });
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }

  /**
   * Queues a readback of `target` (RGBA float-readable). Returns false when all slots are in flight.
   * `tag` is handed back as `dataTag` with the result (lets the caller drop results requested before a state change).
   */
  request(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, tag = 0): boolean {
    const slot = this.slots[this.write];
    if (slot.sync) {
      return false;
    }
    const gl = this.gl;
    renderer.setRenderTarget(target);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    slot.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    slot.tag = tag;
    this.write = (this.write + 1) % this.slots.length;
    return true;
  }

  /** Copies the newest finished readback into `data`. Returns true when `data` was updated. */
  poll(): boolean {
    const gl = this.gl;
    let updated = false;
    for (let n = 0; n < this.slots.length; n++) {
      const slot = this.slots[this.read];
      if (!slot.sync) {
        break;
      }
      const status = gl.getSyncParameter(slot.sync, gl.SYNC_STATUS);
      if (status !== gl.SIGNALED) {
        break;
      }
      gl.deleteSync(slot.sync);
      slot.sync = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.dataTag = slot.tag;
      this.read = (this.read + 1) % this.slots.length;
      updated = true;
    }
    return updated;
  }

  dispose(): void {
    const gl = this.gl;
    for (const slot of this.slots) {
      if (slot.sync) {
        gl.deleteSync(slot.sync);
      }
      gl.deleteBuffer(slot.buffer);
    }
    this.slots.length = 0;
  }
}
