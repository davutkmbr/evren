import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import type { VegetationAssets } from '../assets';
import { SHADOW_ONLY_LAYER } from '../config';
import { INSTANCE_STRIDE, SPECIES_COUNT } from '../species';
import { createPoolGeometry, InstanceStream } from './tree-geometry';

/** Distance bands (m) of the mesh LODs, already scaled by the LOD governor. */
export interface NearBands {
  lod0: number;
  lod0Fade: number;
  lod1: number;
  lod1Fade: number;
  shadow: number;
  /** Extra classification margin for camera motion between rebuilds. */
  margin: number;
}

interface Pool {
  stream: InstanceStream;
  geometry: THREE.InstancedBufferGeometry;
  mesh: THREE.Mesh;
  count: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface NearCounts {
  lod0: number[];
  lod1: number[];
  shadow: number[];
}

/** A source of tree instances near the camera (tiles). */
export interface InstanceSource {
  instances: Float32Array;
  count: number;
}

/**
 * Per species mesh pools rebuilt from the tiles around the camera: LOD0 (full mesh), LOD1 (simplified) and a
 * shadow-only LOD1 pool for the trees that cast mesh shadows. Everything farther is drawn by the impostor pools.
 */
export class NearPools {
  readonly group = new THREE.Group();
  private readonly lod0: Pool[] = [];
  private readonly lod1: Pool[] = [];
  private readonly shadow: Pool[] = [];
  readonly counts: NearCounts = { lod0: [], lod1: [], shadow: [] };

  constructor(assets: VegetationAssets) {
    this.group.name = 'vegetation-near';
    this.group.matrixAutoUpdate = false;
    for (let s = 0; s < SPECIES_COUNT; s++) {
      this.lod0.push(this.createPool(`veg-lod0-${s}`, assets.lod0[s], assets.trees.lod0, null, 256));
      this.lod1.push(this.createPool(`veg-lod1-${s}`, assets.lod1[s], assets.trees.lod1, null, 1024));
      const sh = this.createPool(`veg-shadow-${s}`, assets.lod1[s], assets.trees.lod1, assets.trees.depth, 512);
      sh.mesh.layers.set(SHADOW_ONLY_LAYER);
      this.shadow.push(sh);
      this.counts.lod0.push(0);
      this.counts.lod1.push(0);
      this.counts.shadow.push(0);
    }
  }

  private createPool(name: string, source: VegetationAssets['lod0'][number], material: THREE.Material, depth: THREE.Material | null, capacity: number): Pool {
    const stream = new InstanceStream(capacity);
    const geometry = createPoolGeometry(source, stream);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.layers.set(RenderLayers.NoReflection);
    mesh.receiveShadow = true;
    mesh.visible = false;
    if (depth) {
      mesh.castShadow = true;
      mesh.customDepthMaterial = depth;
    }
    this.group.add(mesh);
    return { stream, geometry, mesh, count: 0, minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  }

  private static reset(p: Pool): void {
    p.count = 0;
    p.minX = p.minY = p.minZ = Infinity;
    p.maxX = p.maxY = p.maxZ = -Infinity;
  }

  private static push(p: Pool, src: Float32Array, o: number, top: number): void {
    if (p.count >= p.stream.capacity) {
      p.stream.reserve(p.count + 1);
    }
    const a = p.stream.array;
    const d = p.count * INSTANCE_STRIDE;
    for (let k = 0; k < INSTANCE_STRIDE; k++) {
      a[d + k] = src[o + k];
    }
    p.count++;
    const x = src[o];
    const y = src[o + 1];
    const z = src[o + 2];
    if (x < p.minX) p.minX = x;
    if (x > p.maxX) p.maxX = x;
    if (z < p.minZ) p.minZ = z;
    if (z > p.maxZ) p.maxZ = z;
    if (y < p.minY) p.minY = y;
    if (y + top > p.maxY) p.maxY = y + top;
  }

  private static finish(p: Pool, reach: number): void {
    p.geometry.instanceCount = p.count;
    p.mesh.visible = p.count > 0;
    if (p.count === 0) {
      return;
    }
    p.stream.markRange(0, p.count);
    const s = p.geometry.boundingSphere!;
    s.center.set((p.minX + p.maxX) * 0.5, (p.minY + p.maxY) * 0.5, (p.minZ + p.maxZ) * 0.5);
    s.radius = Math.hypot(p.maxX - p.minX, p.maxY - p.minY, p.maxZ - p.minZ) * 0.5 + reach;
  }

  /**
   * Classifies every tree of `sources` by its distance to the camera. `heights` / `radii` are the per species
   * reference sizes (bounding reach of an instance = radius * scale).
   */
  rebuild(sources: Iterable<InstanceSource>, cam: THREE.Vector3, bands: NearBands, heights: number[], radii: number[]): void {
    for (let s = 0; s < SPECIES_COUNT; s++) {
      NearPools.reset(this.lod0[s]);
      NearPools.reset(this.lod1[s]);
      NearPools.reset(this.shadow[s]);
    }
    const m = bands.margin;
    const l0 = bands.lod0 + bands.lod0Fade + m;
    const l1lo = Math.max(bands.lod0 - bands.lod0Fade - m, 0);
    const l1hi = bands.lod1 + bands.lod1Fade + m;
    const sh = bands.shadow + m;
    const l0Sq = l0 * l0;
    const l1loSq = l1lo * l1lo;
    const l1hiSq = l1hi * l1hi;
    const shSq = sh * sh;
    const cx = cam.x;
    const cy = cam.y;
    const cz = cam.z;
    for (const src of sources) {
      const a = src.instances;
      for (let i = 0, o = 0; i < src.count; i++, o += INSTANCE_STRIDE) {
        const dx = a[o] - cx;
        const dy = a[o + 1] - cy;
        const dz = a[o + 2] - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > l1hiSq) {
          continue;
        }
        const sp = a[o + 5] % 8 | 0;
        const top = heights[sp] * a[o + 4];
        if (d2 < l0Sq) {
          NearPools.push(this.lod0[sp], a, o, top);
        }
        if (d2 > l1loSq) {
          NearPools.push(this.lod1[sp], a, o, top);
        }
        if (d2 < shSq) {
          NearPools.push(this.shadow[sp], a, o, top);
        }
      }
    }
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const reach = radii[s] * 1.5;
      NearPools.finish(this.lod0[s], reach);
      NearPools.finish(this.lod1[s], reach);
      NearPools.finish(this.shadow[s], reach);
      this.counts.lod0[s] = this.lod0[s].count;
      this.counts.lod1[s] = this.lod1[s].count;
      this.counts.shadow[s] = this.shadow[s].count;
    }
  }

  dispose(): void {
    for (const p of [...this.lod0, ...this.lod1, ...this.shadow]) {
      p.geometry.dispose();
      p.stream.dispose();
    }
    this.group.clear();
  }
}
