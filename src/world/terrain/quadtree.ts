import * as THREE from 'three';
import { LEAF_SIZE, LOD_COUNT, ROOT_MIN } from './config';
import type { HeightBounds } from './height-bounds';

/** Floats per patch instance: originX, originZ, size, lod. */
export const PATCH_STRIDE = 4;

const _box = new THREE.Box3();

/**
 * CDLOD node selection (Strugar 2010). Every selected node is emitted as up to four quarter patches that share one
 * instanced grid mesh; a quarter is skipped when a finer level covers it. Children are visited nearest first so the
 * instance list is roughly front-to-back (early-z).
 */
export class QuadtreeSelector {
  /** LOD range (m) per level; level k covers distances below ranges[k]. */
  readonly ranges = new Float32Array(LOD_COUNT);
  readonly rangesSq = new Float64Array(LOD_COUNT);
  /** Morph window per level: x = start distance, y = 1 / (end - start). */
  readonly morph: THREE.Vector2[] = [];
  count = 0;
  readonly data: Float32Array;
  readonly maxPatches: number;
  /** Visited node count of the last selection (stats). */
  visited = 0;

  private camX = 0;
  private camY = 0;
  private camZ = 0;
  private frusta: THREE.Frustum[] = [];
  private frustumCount = 0;

  constructor(
    private readonly bounds: HeightBounds,
    maxPatches = 6144,
  ) {
    this.maxPatches = maxPatches;
    this.data = new Float32Array(maxPatches * PATCH_STRIDE);
    for (let k = 0; k < LOD_COUNT; k++) {
      this.morph.push(new THREE.Vector2());
    }
    this.setBaseRange(1300);
  }

  setBaseRange(baseRange: number): void {
    for (let k = 0; k < LOD_COUNT; k++) {
      const r = baseRange * 2 ** k;
      this.ranges[k] = r;
      this.rangesSq[k] = r * r;
      const prev = k === 0 ? 0 : r * 0.5;
      const start = prev + (r - prev) * 0.62;
      this.morph[k].set(start, 1 / Math.max(r - start, 1));
    }
  }

  /** Selects patches for a camera position; a node is drawn when it intersects any of the given frusta. */
  select(camera: THREE.Vector3, frusta: THREE.Frustum[], frustumCount: number): number {
    this.camX = camera.x;
    this.camY = camera.y;
    this.camZ = camera.z;
    this.frusta = frusta;
    this.frustumCount = frustumCount;
    this.count = 0;
    this.visited = 0;
    this.selectNode(LOD_COUNT - 1, 0, 0);
    return this.count;
  }

  private distSqToNode(level: number, ix: number, iz: number): number {
    const size = LEAF_SIZE * 2 ** level;
    const x0 = ROOT_MIN + ix * size;
    const z0 = ROOT_MIN + iz * size;
    const b = this.bounds.levels[level];
    const i = iz * b.size + ix;
    const dx = this.camX < x0 ? x0 - this.camX : this.camX > x0 + size ? this.camX - x0 - size : 0;
    const dz = this.camZ < z0 ? z0 - this.camZ : this.camZ > z0 + size ? this.camZ - z0 - size : 0;
    const lo = b.min[i];
    const hi = b.max[i];
    const dy = this.camY < lo ? lo - this.camY : this.camY > hi ? this.camY - hi : 0;
    return dx * dx + dy * dy + dz * dz;
  }

  private visible(level: number, ix: number, iz: number): boolean {
    const size = LEAF_SIZE * 2 ** level;
    const x0 = ROOT_MIN + ix * size;
    const z0 = ROOT_MIN + iz * size;
    const b = this.bounds.levels[level];
    const i = iz * b.size + ix;
    _box.min.set(x0, b.min[i], z0);
    _box.max.set(x0 + size, b.max[i], z0 + size);
    for (let f = 0; f < this.frustumCount; f++) {
      if (this.frusta[f].intersectsBox(_box)) {
        return true;
      }
    }
    return false;
  }

  /** Returns false when the node lies outside its own LOD range (the parent then draws that area). */
  private selectNode(level: number, ix: number, iz: number): boolean {
    this.visited++;
    const d2 = this.distSqToNode(level, ix, iz);
    if (d2 > this.rangesSq[level]) {
      return false;
    }
    if (!this.visible(level, ix, iz)) {
      return true;
    }
    if (level === 0 || d2 > this.rangesSq[level - 1]) {
      this.emit(level, ix, iz, 0b1111);
      return true;
    }
    const cl = level - 1;
    const cx = ix * 2;
    const cz = iz * 2;
    // Visit children nearest first (front-to-back instance order).
    const size = LEAF_SIZE * 2 ** level;
    const midX = ROOT_MIN + (ix + 0.5) * size;
    const midZ = ROOT_MIN + (iz + 0.5) * size;
    const east = this.camX >= midX ? 1 : 0;
    const south = this.camZ >= midZ ? 1 : 0;
    let missing = 0;
    for (let n = 0; n < 4; n++) {
      // Order: nearest, the two adjacent, farthest.
      const qx = n === 0 || n === 2 ? east : 1 - east;
      const qz = n === 0 || n === 1 ? south : 1 - south;
      if (!this.selectNode(cl, cx + qx, cz + qz)) {
        missing |= 1 << (qz * 2 + qx);
      }
    }
    if (missing) {
      this.emit(level, ix, iz, missing);
    }
    return true;
  }

  /** Emits the quarters of a node given by `mask` (bit = qz * 2 + qx). */
  private emit(level: number, ix: number, iz: number, mask: number): void {
    const size = LEAF_SIZE * 2 ** level;
    const half = size * 0.5;
    const x0 = ROOT_MIN + ix * size;
    const z0 = ROOT_MIN + iz * size;
    for (let q = 0; q < 4; q++) {
      if (!(mask & (1 << q)) || this.count >= this.maxPatches) {
        continue;
      }
      const o = this.count * PATCH_STRIDE;
      this.data[o] = x0 + (q & 1) * half;
      this.data[o + 1] = z0 + (q >> 1) * half;
      this.data[o + 2] = half;
      this.data[o + 3] = level;
      this.count++;
    }
  }
}
