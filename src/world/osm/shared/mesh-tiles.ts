/** Spatial tiling of worker-built meshes (streets ground, building facades and roofs). */
/** Triangle classes of a two-level mesh (lodTileIndex): in both versions, only near, only far. */
export const TriLod = { Both: 0, Near: 1, Far: 2 } as const;

/** Floats per leaf in the lodTileIndex table. */
export const LOD_LEAF_STRIDE = 10;

/**
 * Two-level tiling for meshes with a simplified far version (shared/lod-tiles.ts draws it). Triangles are bucketed
 * by centroid into a 2^levels x 2^levels grid of leaves in quadtree (Morton) order, so every quadtree node covers a
 * contiguous index range. The index holds a near section (per leaf: Both + Near triangles) followed by a far section
 * (per leaf: Both + Far triangles); Both triangles are listed twice. Per leaf the table has near start, near count,
 * far start, far count (in indices) and the leaf's bounds (min xyz, max xyz); empty leaves keep their slot.
 */
export function lodTileIndex(positions: Float32Array, index: Uint32Array, triLod: Uint8Array, levels = 3): { index: Uint32Array; leaves: Float64Array } {
  const side = 1 << levels;
  const leafCount = side * side;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let k = 0; k < positions.length; k += 3) {
    x0 = Math.min(x0, positions[k]);
    x1 = Math.max(x1, positions[k]);
    z0 = Math.min(z0, positions[k + 2]);
    z1 = Math.max(z1, positions[k + 2]);
  }
  const sx = side / Math.max(1e-3, x1 - x0);
  const sz = side / Math.max(1e-3, z1 - z0);
  const morton = (i: number, j: number): number => {
    let m = 0;
    for (let b = 0; b < levels; b++) {
      m |= ((i >> b) & 1) << (2 * b);
      m |= ((j >> b) & 1) << (2 * b + 1);
    }
    return m;
  };
  const n = index.length / 3;
  const leafOf = new Uint16Array(n);
  const nearCounts = new Uint32Array(leafCount);
  const farCounts = new Uint32Array(leafCount);
  const lo = new Float32Array(leafCount * 3).fill(Infinity);
  const hi = new Float32Array(leafCount * 3).fill(-Infinity);
  for (let t = 0; t < n; t++) {
    const a = index[t * 3] * 3;
    const b = index[t * 3 + 1] * 3;
    const c = index[t * 3 + 2] * 3;
    const cx = (positions[a] + positions[b] + positions[c]) / 3;
    const cz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    const i = Math.min(side - 1, Math.max(0, Math.floor((cx - x0) * sx)));
    const j = Math.min(side - 1, Math.max(0, Math.floor((cz - z0) * sz)));
    const leaf = morton(i, j);
    leafOf[t] = leaf;
    const cls = triLod[t];
    if (cls !== TriLod.Far) {
      nearCounts[leaf]++;
    }
    if (cls !== TriLod.Near) {
      farCounts[leaf]++;
    }
    for (const v of [a, b, c]) {
      for (let q = 0; q < 3; q++) {
        lo[leaf * 3 + q] = Math.min(lo[leaf * 3 + q], positions[v + q]);
        hi[leaf * 3 + q] = Math.max(hi[leaf * 3 + q], positions[v + q]);
      }
    }
  }
  const nearStart = new Uint32Array(leafCount);
  const farStart = new Uint32Array(leafCount);
  let acc = 0;
  for (let k = 0; k < leafCount; k++) {
    nearStart[k] = acc;
    acc += nearCounts[k];
  }
  for (let k = 0; k < leafCount; k++) {
    farStart[k] = acc;
    acc += farCounts[k];
  }
  const out = new Uint32Array(acc * 3);
  const nearFill = nearStart.slice();
  const farFill = farStart.slice();
  for (let t = 0; t < n; t++) {
    const leaf = leafOf[t];
    const cls = triLod[t];
    if (cls !== TriLod.Far) {
      out.set(index.subarray(t * 3, t * 3 + 3), nearFill[leaf]++ * 3);
    }
    if (cls !== TriLod.Near) {
      out.set(index.subarray(t * 3, t * 3 + 3), farFill[leaf]++ * 3);
    }
  }
  const leaves = new Float64Array(leafCount * LOD_LEAF_STRIDE);
  for (let k = 0; k < leafCount; k++) {
    const o = k * LOD_LEAF_STRIDE;
    leaves[o] = nearStart[k] * 3;
    leaves[o + 1] = nearCounts[k] * 3;
    leaves[o + 2] = farStart[k] * 3;
    leaves[o + 3] = farCounts[k] * 3;
    for (let q = 0; q < 3; q++) {
      const empty = !(lo[k * 3 + q] <= hi[k * 3 + q]);
      leaves[o + 4 + q] = empty ? 0 : lo[k * 3 + q];
      leaves[o + 7 + q] = empty ? 0 : hi[k * 3 + q];
    }
  }
  return { index: out, leaves };
}
