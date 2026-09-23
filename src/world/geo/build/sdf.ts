import type { FlatRing } from '../types';
import type { GridSpec } from './grid';

/**
 * Signed distance to the shoreline (m, + on land) for every cell of `mask` (1 = land).
 * Seeds: cells touching the land/water boundary get their exact nearest point on the ring segments
 * (via a segment bucket grid). Then 8SSEDT-style dead reckoning propagates the nearest-point owner in two
 * raster passes, giving sub-cell accurate Euclidean distances everywhere.
 */
export function signedCoastDistance(mask: Uint8Array, rings: readonly FlatRing[], g: GridSpec): Float32Array {
  const n = g.size;
  const total = n * n;
  const bucketCells = 8;
  const nb = Math.ceil(n / bucketCells);
  const bucketSize = bucketCells * g.cell;
  const worldMin = g.origin - g.cell / 2;

  let segCount = 0;
  for (const r of rings) {
    segCount += r.length >> 1;
  }
  const segs = new Float64Array(segCount * 4);
  let si = 0;
  for (const r of rings) {
    const m = r.length >> 1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      segs[si++] = r[i * 2];
      segs[si++] = r[i * 2 + 1];
      segs[si++] = r[j * 2];
      segs[si++] = r[j * 2 + 1];
    }
  }
  const bucketRange = (s: number): [number, number, number, number] => {
    const ax = segs[s * 4];
    const az = segs[s * 4 + 1];
    const bx = segs[s * 4 + 2];
    const bz = segs[s * 4 + 3];
    const clampB = (v: number) => Math.max(0, Math.min(nb - 1, Math.floor((v - worldMin) / bucketSize)));
    return [clampB(Math.min(ax, bx)), clampB(Math.max(ax, bx)), clampB(Math.min(az, bz)), clampB(Math.max(az, bz))];
  };
  const bStart = new Int32Array(nb * nb + 1);
  for (let s = 0; s < segCount; s++) {
    const [x0, x1, z0, z1] = bucketRange(s);
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) {
        bStart[bz * nb + bx + 1]++;
      }
    }
  }
  for (let i = 0; i < nb * nb; i++) {
    bStart[i + 1] += bStart[i];
  }
  const bList = new Int32Array(bStart[nb * nb]);
  const bFill = bStart.slice(0, nb * nb);
  for (let s = 0; s < segCount; s++) {
    const [x0, x1, z0, z1] = bucketRange(s);
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) {
        bList[bFill[bz * nb + bx]++] = s;
      }
    }
  }

  const owner = new Int32Array(total).fill(-1);
  const dist2 = new Float32Array(total).fill(Infinity);
  let seedCap = 65536;
  let seedX = new Float32Array(seedCap);
  let seedZ = new Float32Array(seedCap);
  let seeds = 0;

  for (let r = 0; r < n; r++) {
    const z = g.origin + r * g.cell;
    for (let c = 0; c < n; c++) {
      const k = r * n + c;
      const v = mask[k];
      const boundary =
        (c > 0 && mask[k - 1] !== v) || (c < n - 1 && mask[k + 1] !== v) || (r > 0 && mask[k - n] !== v) || (r < n - 1 && mask[k + n] !== v);
      if (!boundary) {
        continue;
      }
      const x = g.origin + c * g.cell;
      const bx = Math.floor((x - worldMin) / bucketSize);
      const bz = Math.floor((z - worldMin) / bucketSize);
      let best = Infinity;
      let px = x;
      let pz = z;
      for (let oz = -1; oz <= 1; oz++) {
        const zz = bz + oz;
        if (zz < 0 || zz >= nb) {
          continue;
        }
        for (let ox = -1; ox <= 1; ox++) {
          const xx = bx + ox;
          if (xx < 0 || xx >= nb) {
            continue;
          }
          const b = zz * nb + xx;
          for (let q = bStart[b]; q < bStart[b + 1]; q++) {
            const s = bList[q] * 4;
            const ax = segs[s];
            const az = segs[s + 1];
            const dx = segs[s + 2] - ax;
            const dz = segs[s + 3] - az;
            const l2 = dx * dx + dz * dz;
            let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = ax + dx * t;
            const qz = az + dz * t;
            const d2 = (qx - x) * (qx - x) + (qz - z) * (qz - z);
            if (d2 < best) {
              best = d2;
              px = qx;
              pz = qz;
            }
          }
        }
      }
      if (seeds === seedCap) {
        seedCap *= 2;
        const nx = new Float32Array(seedCap);
        const nz = new Float32Array(seedCap);
        nx.set(seedX);
        nz.set(seedZ);
        seedX = nx;
        seedZ = nz;
      }
      seedX[seeds] = px;
      seedZ[seeds] = pz;
      owner[k] = seeds++;
      dist2[k] = best === Infinity ? (g.cell * 0.5) ** 2 : best;
    }
  }

  // Two raster passes (8SSEDT-style). Each cell adopts a neighbor's nearest boundary point when it is closer.
  const offsetsFwd = [-1, -n - 1, -n, -n + 1];
  const offsetsBwd = [1, n + 1, n, n - 1];
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    const offs = fwd ? offsetsFwd : offsetsBwd;
    const o0 = offs[0];
    const o1 = offs[1];
    const o2 = offs[2];
    const o3 = offs[3];
    for (let rr = 0; rr < n; rr++) {
      const r = fwd ? rr : n - 1 - rr;
      const z = g.origin + r * g.cell;
      const row = r * n;
      const hasPrevRow = fwd ? r > 0 : r < n - 1;
      for (let cc = 0; cc < n; cc++) {
        const c = fwd ? cc : n - 1 - cc;
        const k = row + c;
        const x = g.origin + c * g.cell;
        let best = dist2[k];
        let bo = owner[k];
        const firstCol = fwd ? c === 0 : c === n - 1;
        const lastCol = fwd ? c === n - 1 : c === 0;
        let o: number;
        let dx: number;
        let dz: number;
        let d2: number;
        if (!firstCol) {
          o = owner[k + o0];
          if (o >= 0 && o !== bo) {
            dx = x - seedX[o];
            dz = z - seedZ[o];
            d2 = dx * dx + dz * dz;
            if (d2 < best) {
              best = d2;
              bo = o;
            }
          }
        }
        if (hasPrevRow) {
          if (!firstCol) {
            o = owner[k + o1];
            if (o >= 0 && o !== bo) {
              dx = x - seedX[o];
              dz = z - seedZ[o];
              d2 = dx * dx + dz * dz;
              if (d2 < best) {
                best = d2;
                bo = o;
              }
            }
          }
          o = owner[k + o2];
          if (o >= 0 && o !== bo) {
            dx = x - seedX[o];
            dz = z - seedZ[o];
            d2 = dx * dx + dz * dz;
            if (d2 < best) {
              best = d2;
              bo = o;
            }
          }
          if (!lastCol) {
            o = owner[k + o3];
            if (o >= 0 && o !== bo) {
              dx = x - seedX[o];
              dz = z - seedZ[o];
              d2 = dx * dx + dz * dz;
              if (d2 < best) {
                best = d2;
                bo = o;
              }
            }
          }
        }
        dist2[k] = best;
        owner[k] = bo;
      }
      // Reverse sweep along the row (single neighbor).
      const back = fwd ? 1 : -1;
      for (let cc = n - 2; cc >= 0; cc--) {
        const c = fwd ? cc : n - 1 - cc;
        const k = row + c;
        const o = owner[k + back];
        if (o < 0 || o === owner[k]) {
          continue;
        }
        const x = g.origin + c * g.cell;
        const dx = x - seedX[o];
        const dz = z - seedZ[o];
        const d2 = dx * dx + dz * dz;
        if (d2 < dist2[k]) {
          dist2[k] = d2;
          owner[k] = o;
        }
      }
    }
  }

  for (let k = 0; k < total; k++) {
    const d = Math.sqrt(dist2[k]);
    dist2[k] = mask[k] ? d : -d;
  }
  return dist2;
}
