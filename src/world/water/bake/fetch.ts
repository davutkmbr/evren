/**
 * Wind fetch (distance over open water upwind) for the two Istanbul wind regimes. Wind-sea height and period are
 * fetch limited, so this decides where the chop and the longer wind sea develop and which beaches get surf:
 * Kilyos and the Black Sea shore in a poyraz, Florya / Caddebostan / the islands' southern shores in a lodos, while
 * the Golden Horn and the lee of every headland stay calm.
 */
import { LODOS_DOWNWIND_DEG, POYRAZ_DOWNWIND_DEG } from '../config';

/** Rays per regime around the mean wind (the wind veers +-20 deg). */
const RAY_OFFSETS_DEG = [-22, 0, 22];
const RAY_WEIGHTS = [0.25, 0.5, 0.25];
/** Fetch added when a ray leaves the world over water: Black Sea to the north/north-east, Marmara elsewhere (m). */
const BLACK_SEA_FETCH = 300_000;
const MARMARA_FETCH = 110_000;
/** Exposure = log fetch normalised between these (m). */
const FETCH_MIN = 150;
const FETCH_MAX = 300_000;

/** 0..1 log-fetch exposure: 0 at <= 150 m, 0.3 at 1.5 km, 0.6 at 15 km, 1 at the open Black Sea. */
export function fetchExposure(fetch: number): number {
  const e = Math.log(Math.max(fetch, FETCH_MIN) / FETCH_MIN) / Math.log(FETCH_MAX / FETCH_MIN);
  return Math.min(1, Math.max(0, e));
}

function marchFetch(water: Uint8Array, size: number, cell: number, cx: number, cy: number, dirX: number, dirZ: number): number {
  let x = cx + 0.5;
  let y = cy + 0.5;
  for (let step = 1; step <= size * 2; step++) {
    x += dirX;
    y += dirZ;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= size || iy >= size) {
      const northOrEast = iy < 0 || (ix >= size && iy < size * 0.55);
      return step * cell + (northOrEast ? BLACK_SEA_FETCH : MARMARA_FETCH);
    }
    if (!water[iy * size + ix]) {
      return (step - 0.5) * cell;
    }
  }
  return size * 2 * cell;
}

/**
 * @param sea fine water mask (connected to the open sea), n x n, row-major, rows toward +Z (south)
 * @returns [poyraz, lodos] exposure grids at the fine resolution (0..1)
 */
export function bakeFetchExposure(sea: Uint8Array, n: number, worldSize: number): [Float32Array, Float32Array] {
  const size = n >> 1;
  const cell = worldSize / size;
  const coarse = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * 2 * n + x * 2;
      coarse[y * size + x] = sea[i] + sea[i + 1] + sea[i + n] + sea[i + n + 1] >= 2 ? 1 : 0;
    }
  }
  const upwindDeg = [POYRAZ_DOWNWIND_DEG + 180, LODOS_DOWNWIND_DEG + 180];
  const result: [Float32Array, Float32Array] = [new Float32Array(n * n), new Float32Array(n * n)];
  const grid = new Float32Array(size * size);
  const tmp = new Float32Array(size * size);
  for (let r = 0; r < 2; r++) {
    const dirs = RAY_OFFSETS_DEG.map((o) => {
      const a = ((upwindDeg[r] + o) * Math.PI) / 180;
      return [Math.sin(a), -Math.cos(a)];
    });
    grid.fill(-1);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!coarse[y * size + x]) {
          continue;
        }
        let f = 0;
        for (let k = 0; k < dirs.length; k++) {
          f += RAY_WEIGHTS[k] * marchFetch(coarse, size, cell, x, y, dirs[k][0], dirs[k][1]);
        }
        grid[y * size + x] = fetchExposure(f);
      }
    }
    // Land cells take the mean of their water neighbours so bilinear sampling keeps windward shores exposed.
    tmp.set(grid);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (grid[i] >= 0) {
          continue;
        }
        let s = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= size || yy >= size) {
              continue;
            }
            const v = grid[yy * size + xx];
            if (v >= 0) {
              s += v;
              c++;
            }
          }
        }
        tmp[i] = c > 0 ? s / c : 0;
      }
    }
    const out = result[r];
    for (let y = 0; y < n; y++) {
      const fy = Math.min(Math.max((y + 0.5) / 2 - 0.5, 0), size - 1);
      const y0 = Math.floor(fy);
      const y1 = Math.min(y0 + 1, size - 1);
      const ty = fy - y0;
      for (let x = 0; x < n; x++) {
        const fx = Math.min(Math.max((x + 0.5) / 2 - 0.5, 0), size - 1);
        const x0 = Math.floor(fx);
        const x1 = Math.min(x0 + 1, size - 1);
        const tx = fx - x0;
        const a = tmp[y0 * size + x0] + (tmp[y0 * size + x1] - tmp[y0 * size + x0]) * tx;
        const b = tmp[y1 * size + x0] + (tmp[y1 * size + x1] - tmp[y1 * size + x0]) * tx;
        out[y * n + x] = a + (b - a) * ty;
      }
    }
  }
  return result;
}
