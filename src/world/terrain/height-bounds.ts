import { GEO_HEIGHT_CELL, GEO_HEIGHT_SIZE, LEAF_SIZE, LOD_COUNT, ROOT_MIN, ROOT_SIZE, WORLD_HALF } from './config';

/** Conservative elevation range (m) of the horizon extension until its baked heights are read back. */
const DEFAULT_EXT_MIN = -120;
const DEFAULT_EXT_MAX = 1100;
/** Extra margin (m) for vertex-shader micro relief on the horizon ring. */
const EXT_MARGIN = 40;
/** World leaves this close to the edge (in leaves) get a wider range: their heights blend into the extension. */
const EDGE_BAND_LEAVES = 5;

/**
 * Min/max elevation pyramid of the rendered terrain, one level per quadtree LOD.
 * Level 0 has one entry per leaf node (512² over the root square), level k has 512 / 2^k entries per side.
 */
export class HeightBounds {
  readonly levels: { size: number; min: Float32Array; max: Float32Array }[] = [];

  constructor() {
    for (let k = 0; k < LOD_COUNT; k++) {
      const n = ROOT_SIZE / (LEAF_SIZE * 2 ** k);
      this.levels.push({ size: n, min: new Float32Array(n * n).fill(DEFAULT_EXT_MIN), max: new Float32Array(n * n).fill(DEFAULT_EXT_MAX) });
    }
  }

  /** Fills world leaves from the geo height grid (bilinear footprint: one extra cell on each side). */
  setWorldHeights(data: Float32Array): void {
    const leaf = this.levels[0];
    const n = leaf.size;
    const cellsPerLeaf = LEAF_SIZE / GEO_HEIGHT_CELL;
    const first = Math.round((-WORLD_HALF - ROOT_MIN) / LEAF_SIZE);
    const count = Math.round((2 * WORLD_HALF) / LEAF_SIZE);
    for (let lz = 0; lz < count; lz++) {
      for (let lx = 0; lx < count; lx++) {
        const c0 = Math.max(0, Math.floor(lx * cellsPerLeaf) - 1);
        const c1 = Math.min(GEO_HEIGHT_SIZE - 1, Math.ceil((lx + 1) * cellsPerLeaf));
        const r0 = Math.max(0, Math.floor(lz * cellsPerLeaf) - 1);
        const r1 = Math.min(GEO_HEIGHT_SIZE - 1, Math.ceil((lz + 1) * cellsPerLeaf));
        let lo = Infinity;
        let hi = -Infinity;
        for (let r = r0; r <= r1; r++) {
          const row = r * GEO_HEIGHT_SIZE;
          for (let c = c0; c <= c1; c++) {
            const h = data[row + c];
            if (h < lo) {
              lo = h;
            }
            if (h > hi) {
              hi = h;
            }
          }
        }
        const i = (first + lz) * n + first + lx;
        // Leaves near the world edge blend toward the extension relief.
        const edge = Math.min(lx, lz, count - 1 - lx, count - 1 - lz);
        const margin = edge < EDGE_BAND_LEAVES ? 25 : 1;
        leaf.min[i] = lo - margin;
        leaf.max[i] = hi + margin;
      }
    }
    this.rebuildPyramid();
  }

  /**
   * Fills leaves outside the world from the baked extension heights (RGBA float, `size`² over the root square,
   * height in channel 0). Leaves inside the world keep their geo bounds.
   */
  setExtensionHeights(rgba: Float32Array, size: number): void {
    const leaf = this.levels[0];
    const n = leaf.size;
    const texPerLeaf = size / n;
    const worldFirst = Math.round((-WORLD_HALF - ROOT_MIN) / LEAF_SIZE);
    const worldLast = worldFirst + Math.round((2 * WORLD_HALF) / LEAF_SIZE);
    for (let lz = 0; lz < n; lz++) {
      for (let lx = 0; lx < n; lx++) {
        if (lx >= worldFirst && lx < worldLast && lz >= worldFirst && lz < worldLast) {
          continue;
        }
        const c0 = Math.max(0, Math.floor(lx * texPerLeaf) - 1);
        const c1 = Math.min(size - 1, Math.ceil((lx + 1) * texPerLeaf));
        const r0 = Math.max(0, Math.floor(lz * texPerLeaf) - 1);
        const r1 = Math.min(size - 1, Math.ceil((lz + 1) * texPerLeaf));
        let lo = Infinity;
        let hi = -Infinity;
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const h = rgba[(r * size + c) * 4];
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        }
        const i = lz * n + lx;
        leaf.min[i] = lo - EXT_MARGIN;
        leaf.max[i] = hi + EXT_MARGIN;
      }
    }
    this.rebuildPyramid();
  }

  private rebuildPyramid(): void {
    for (let k = 1; k < LOD_COUNT; k++) {
      const child = this.levels[k - 1];
      const lvl = this.levels[k];
      const n = lvl.size;
      const cn = child.size;
      for (let z = 0; z < n; z++) {
        for (let x = 0; x < n; x++) {
          const a = z * 2 * cn + x * 2;
          const b = a + cn;
          lvl.min[z * n + x] = Math.min(child.min[a], child.min[a + 1], child.min[b], child.min[b + 1]);
          lvl.max[z * n + x] = Math.max(child.max[a], child.max[a + 1], child.max[b], child.max[b + 1]);
        }
      }
    }
  }
}
