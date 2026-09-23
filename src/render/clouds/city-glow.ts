import * as THREE from 'three';
import type { GeoQuery } from '../../core/contracts';
import { LandUse } from '../../core/contracts';
import { GLOW_EXTENT, GLOW_SIZE } from './config';

const ROWS_PER_SLICE = 12;

/**
 * Low-resolution map of urban light emission (from geo density/land use), blurred over ~1.5 km.
 * Used to light cloud bases orange from below at night. Built time-sliced after geo is ready.
 */
export class CityGlowMap {
  readonly texture: THREE.DataTexture;
  private readonly raw = new Float32Array(GLOW_SIZE * GLOW_SIZE);
  private readonly data = new Uint8Array(GLOW_SIZE * GLOW_SIZE);
  private geo: GeoQuery | null = null;
  private nextRow = -1;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, GLOW_SIZE, GLOW_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
  }

  start(geo: GeoQuery): void {
    this.geo = geo;
    this.nextRow = 0;
  }

  get pending(): boolean {
    return this.nextRow >= 0;
  }

  /** Processes a few rows per call (< 1 ms). */
  step(): void {
    const geo = this.geo;
    if (!geo || this.nextRow < 0) {
      return;
    }
    const cell = GLOW_EXTENT / GLOW_SIZE;
    const end = Math.min(GLOW_SIZE, this.nextRow + ROWS_PER_SLICE);
    for (let row = this.nextRow; row < end; row++) {
      for (let col = 0; col < GLOW_SIZE; col++) {
        let sum = 0;
        for (let s = 0; s < 4; s++) {
          const x = -GLOW_EXTENT / 2 + (col + 0.25 + 0.5 * (s & 1)) * cell;
          const z = -GLOW_EXTENT / 2 + (row + 0.25 + 0.5 * (s >> 1)) * cell;
          sum += this.emission(geo, x, z);
        }
        this.raw[row * GLOW_SIZE + col] = sum * 0.25;
      }
    }
    this.nextRow = end;
    if (end >= GLOW_SIZE) {
      this.finish();
      this.nextRow = -1;
    }
  }

  private emission(geo: GeoQuery, x: number, z: number): number {
    const b = geo.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) {
      return 0;
    }
    const use = geo.landUseAt(x, z);
    if (use === LandUse.Water) {
      return 0.04;
    }
    const density = geo.densityAt(x, z);
    const base = use === LandUse.Industrial || use === LandUse.Airport ? 0.8 : use === LandUse.Forest || use === LandUse.Farmland ? 0.05 : 0.25;
    return Math.min(1, base * 0.5 + density);
  }

  private finish(): void {
    const n = GLOW_SIZE;
    const tmp = new Float32Array(n * n);
    const src = this.raw;
    const radius = 2;
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let s = 0;
          let c = 0;
          for (let k = -radius; k <= radius; k++) {
            const xx = x + k;
            if (xx >= 0 && xx < n) {
              s += src[y * n + xx];
              c++;
            }
          }
          tmp[y * n + x] = s / c;
        }
      }
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let s = 0;
          let c = 0;
          for (let k = -radius; k <= radius; k++) {
            const yy = y + k;
            if (yy >= 0 && yy < n) {
              s += tmp[yy * n + x];
              c++;
            }
          }
          src[y * n + x] = s / c;
        }
      }
    }
    for (let i = 0; i < n * n; i++) {
      this.data[i] = Math.round(THREE.MathUtils.clamp(src[i], 0, 1) * 255);
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
