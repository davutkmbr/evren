/** Spatial tiling of worker-built meshes (streets ground, building facades and roofs). */
/**
 * Reorders a mesh index by tile (TILES x TILES over the vertex extent) and returns the tile table: per tile the first
 * index, index count and bounding sphere (cx, cy, cz, r), 6 floats each; empty tiles are left out. Drawn as one mesh
 * per tile over shared buffers (three.ts addTiledMesh), each tile is culled on its own by the camera and by every
 * shadow cascade, instead of one mesh the size of the whole area being drawn everywhere.
 */
export function tileIndex(positions: Float32Array, index: Uint32Array, TILES = 6): { index: Uint32Array; tiles: Float32Array } {
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
  const sx = TILES / Math.max(1e-3, x1 - x0);
  const sz = TILES / Math.max(1e-3, z1 - z0);
  const n = index.length / 3;
  const tileOf = new Uint8Array(n);
  const counts = new Uint32Array(TILES * TILES);
  for (let t = 0; t < n; t++) {
    const a = index[t * 3] * 3;
    const i = Math.min(TILES - 1, Math.floor((positions[a] - x0) * sx));
    const j = Math.min(TILES - 1, Math.floor((positions[a + 2] - z0) * sz));
    tileOf[t] = j * TILES + i;
    counts[j * TILES + i]++;
  }
  const starts = new Uint32Array(TILES * TILES);
  for (let k = 1; k < starts.length; k++) {
    starts[k] = starts[k - 1] + counts[k - 1];
  }
  const fill = starts.slice();
  const out = new Uint32Array(index.length);
  const lo = new Float32Array(TILES * TILES * 3).fill(Infinity);
  const hi = new Float32Array(TILES * TILES * 3).fill(-Infinity);
  for (let t = 0; t < n; t++) {
    const k = tileOf[t];
    const o = fill[k]++ * 3;
    for (let c = 0; c < 3; c++) {
      const v = index[t * 3 + c];
      out[o + c] = v;
      for (let q = 0; q < 3; q++) {
        const p = positions[v * 3 + q];
        lo[k * 3 + q] = Math.min(lo[k * 3 + q], p);
        hi[k * 3 + q] = Math.max(hi[k * 3 + q], p);
      }
    }
  }
  const tiles: number[] = [];
  for (let k = 0; k < TILES * TILES; k++) {
    if (!counts[k]) {
      continue;
    }
    const cx = (lo[k * 3] + hi[k * 3]) / 2;
    const cy = (lo[k * 3 + 1] + hi[k * 3 + 1]) / 2;
    const cz = (lo[k * 3 + 2] + hi[k * 3 + 2]) / 2;
    const r = Math.hypot(hi[k * 3] - cx, hi[k * 3 + 1] - cy, hi[k * 3 + 2] - cz);
    tiles.push(starts[k] * 3, counts[k] * 3, cx, cy, cz, r);
  }
  return { index: out, tiles: Float32Array.from(tiles) };
}
