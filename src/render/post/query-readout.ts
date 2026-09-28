import * as THREE from 'three';
import type { FullscreenRenderer } from './fullscreen';
import { createColorTarget } from './targets';

/**
 * Non-blocking GPU -> CPU transport of a few quantized bits through occlusion queries. One 1x1 draw per bit, each
 * inside its own ANY_SAMPLES_PASSED query; the shader (uniform int uBit) discards when the bit is 0. Query results
 * arrive asynchronously, and polling them never waits for the GPU.
 *
 * Why not a fenced pixel-pack readback: in Chrome, getBufferSubData is a synchronous round trip to the GPU process that
 * waits until every command flushed before it has been processed, even after the fence signalled (measured 40-110 ms
 * on an over-budget GPU, READ and COPY usage alike; .docs/planning/28-frame-budget.md).
 */
export class QueryReadout {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly queries: WebGLQuery[] = [];
  private pending = false;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    /** Encoding material: draws its fragment only where bit `uBit` (uniform int) of the value is set. */
    private readonly material: THREE.ShaderMaterial,
    readonly bits: number,
  ) {
    this.target = createColorTarget(1, 1, { name: 'post.queryReadout', type: THREE.UnsignedByteType, filter: THREE.NearestFilter });
    for (let i = 0; i < bits; i++) {
      this.queries.push(gl.createQuery()!);
    }
  }

  get busy(): boolean {
    return this.pending;
  }

  /** Queues one sample of every bit. Returns false while the previous sample is still in flight. */
  request(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer): boolean {
    if (this.pending) {
      return false;
    }
    const gl = this.gl;
    for (let i = 0; i < this.bits; i++) {
      this.material.uniforms.uBit.value = i;
      gl.beginQuery(gl.ANY_SAMPLES_PASSED, this.queries[i]);
      fs.draw(renderer, this.material, this.target);
      gl.endQuery(gl.ANY_SAMPLES_PASSED);
    }
    this.pending = true;
    return true;
  }

  /** The sampled bits (bit i = 2^i) once every query result is available, else -1. Never waits. */
  poll(): number {
    if (!this.pending) {
      return -1;
    }
    const gl = this.gl;
    for (let i = this.bits - 1; i >= 0; i--) {
      if (!gl.getQueryParameter(this.queries[i], gl.QUERY_RESULT_AVAILABLE)) {
        return -1;
      }
    }
    let value = 0;
    for (let i = 0; i < this.bits; i++) {
      if (gl.getQueryParameter(this.queries[i], gl.QUERY_RESULT)) {
        value += 2 ** i;
      }
    }
    this.pending = false;
    return value;
  }

  dispose(): void {
    for (const q of this.queries) {
      this.gl.deleteQuery(q);
    }
    this.queries.length = 0;
    this.target.dispose();
  }
}
