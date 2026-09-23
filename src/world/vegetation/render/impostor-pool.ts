import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import { INSTANCE_STRIDE } from '../species';
import type { InstanceStream } from './tree-geometry';
import { createPoolGeometry, InstanceStream as Stream } from './tree-geometry';

/** Instances per allocation unit. */
export const CHUNK = 64;

/**
 * One instanced draw of impostor quads for many streaming tiles. Tiles own whole chunks of the instance buffer;
 * writes only upload the touched chunks, free chunks are zeroed (scale 0 = collapsed quad) and the draw range ends at
 * the highest chunk in use.
 */
export class ImpostorPool {
  readonly mesh: THREE.Mesh;
  readonly stream: InstanceStream;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private used: Uint8Array;
  private high = 0;
  private usedCount = 0;

  constructor(
    name: string,
    quad: { index: THREE.BufferAttribute; attributes: Record<string, THREE.BufferAttribute> },
    material: THREE.Material,
    depthMaterial: THREE.Material | null,
    initialChunks: number,
  ) {
    this.stream = new Stream(initialChunks * CHUNK);
    this.geometry = createPoolGeometry(quad, this.stream);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.used = new Uint8Array(initialChunks);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(RenderLayers.NoReflection);
    this.mesh.receiveShadow = true;
    if (depthMaterial) {
      this.mesh.castShadow = true;
      this.mesh.customDepthMaterial = depthMaterial;
    }
  }

  get chunksInUse(): number {
    return this.usedCount;
  }

  get instanceCount(): number {
    return this.geometry.instanceCount;
  }

  /** Allocates `n` chunks, lowest indices first (keeps the draw range compact). */
  allocate(n: number, out: number[]): void {
    out.length = 0;
    for (let i = 0; i < this.used.length && out.length < n; i++) {
      if (!this.used[i]) {
        out.push(i);
      }
    }
    if (out.length < n) {
      const missing = n - out.length;
      const oldLen = this.used.length;
      const newLen = Math.max(oldLen * 2, oldLen + missing + 16);
      const grown = new Uint8Array(newLen);
      grown.set(this.used);
      this.used = grown;
      this.stream.reserve(newLen * CHUNK);
      for (let i = oldLen; out.length < n; i++) {
        out.push(i);
      }
    }
    for (const c of out) {
      this.used[c] = 1;
      this.high = Math.max(this.high, c + 1);
    }
    this.usedCount += out.length;
    this.geometry.instanceCount = this.high * CHUNK;
  }

  /** Frees chunks and zeroes their instances. */
  release(chunks: number[]): void {
    const a = this.stream.array;
    for (const c of chunks) {
      if (!this.used[c]) {
        continue;
      }
      this.used[c] = 0;
      this.usedCount--;
      a.fill(0, c * CHUNK * INSTANCE_STRIDE, (c + 1) * CHUNK * INSTANCE_STRIDE);
      this.stream.markRange(c * CHUNK, CHUNK);
    }
    chunks.length = 0;
    while (this.high > 0 && !this.used[this.high - 1]) {
      this.high--;
    }
    this.geometry.instanceCount = this.high * CHUNK;
  }

  /** Writes `count` instances (stride INSTANCE_STRIDE) into the given chunks; the unused tail is zeroed. */
  write(chunks: number[], src: Float32Array, count: number): void {
    const a = this.stream.array;
    let k = 0;
    for (const c of chunks) {
      const n = Math.min(CHUNK, count - k);
      const dst = c * CHUNK * INSTANCE_STRIDE;
      if (n > 0) {
        a.set(src.subarray(k * INSTANCE_STRIDE, (k + n) * INSTANCE_STRIDE), dst);
      }
      if (n < CHUNK) {
        a.fill(0, dst + Math.max(n, 0) * INSTANCE_STRIDE, dst + CHUNK * INSTANCE_STRIDE);
      }
      this.stream.markRange(c * CHUNK, CHUNK);
      k += CHUNK;
    }
  }

  setBounds(center: THREE.Vector3, radius: number): void {
    const s = this.geometry.boundingSphere!;
    s.center.copy(center);
    s.radius = radius;
  }

  dispose(): void {
    this.geometry.dispose();
    this.stream.dispose();
  }
}
