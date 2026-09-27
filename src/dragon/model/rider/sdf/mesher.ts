/**
 * Sparse surface nets over the rider's distance field. The volume is split into bricks of 8^3 cells; only bricks the
 * surface can pass through (conservative distance test) are sampled. Each cell the surface crosses gets one vertex,
 * projected onto the surface with Newton steps (normals from the field gradient); each crossed edge gets a quad.
 *
 * Several regions can be meshed at different resolutions (face and hands finer than the body): the coarse mesh drops
 * its triangles inside a fine region (shrunk by the overlap), and the fine mesh sinks slightly under the coarse one in
 * the overlap band so the seam neither cracks nor z-fights.
 */
import { AttributeEval, FieldEval, gather, type CompiledSculpt } from './field';

export interface MeshRegion {
  min: [number, number, number];
  max: [number, number, number];
  voxel: number;
}

export interface SculptMesh {
  positions: Float32Array;
  normals: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** x material, y channel 0, z hidden in first person, w 0. */
  data: Float32Array;
  /** Channels 1..3. */
  extra: Float32Array;
  indices: Uint32Array;
  stats: { vertices: number; triangles: number; bricks: number; ms: number };
}

const B = 8;
const S1 = B + 1;
const SB = 4;

interface Brick {
  /** Brick coordinates. */
  bx: number;
  by: number;
  bz: number;
  samples: Float32Array;
  list: Int32Array;
}

interface RegionMesh {
  pos: number[];
  nrm: number[];
  si: number[];
  sw: number[];
  data: number[];
  extra: number[];
  idx: number[];
  bricks: number;
}

/** Corner offsets of a cell and the 12 edges as corner pairs. */
const CORNERS: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];
const EDGES: [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

function meshRegion(S: CompiledSculpt, boneCount: number, region: MeshRegion, hidden: Set<number>, drop: MeshRegion[], overlap: number, insetBand: number): RegionMesh {
  const h = region.voxel;
  const [x0, y0, z0] = region.min;
  const nx = Math.max(1, Math.ceil((region.max[0] - x0) / h));
  const ny = Math.max(1, Math.ceil((region.max[1] - y0) / h));
  const nz = Math.max(1, Math.ceil((region.max[2] - z0) / h));
  const nbx = Math.ceil(nx / B);
  const nby = Math.ceil(ny / B);
  const nbz = Math.ceil(nz / B);
  const field = new FieldEval(S);
  const attr = new AttributeEval(S, boneCount);
  const scratch = new Int32Array(S.count);
  const superList = new Int32Array(S.count);
  const bricks: Brick[] = [];
  const brickRadius = (B * h * Math.sqrt(3)) / 2;
  const margin = 0.012;

  for (let sz = 0; sz < nbz; sz += SB) {
    for (let sy = 0; sy < nby; sy += SB) {
      for (let sx = 0; sx < nbx; sx += SB) {
        const span = SB * B * h;
        const scx = x0 + sx * B * h + span / 2;
        const scy = y0 + sy * B * h + span / 2;
        const scz = z0 + sz * B * h + span / 2;
        const sn = gather(S, scx, scy, scz, (span * Math.sqrt(3)) / 2, margin, superList);
        if (sn === 0) {
          continue;
        }
        for (let bz = sz; bz < Math.min(sz + SB, nbz); bz++) {
          for (let by = sy; by < Math.min(sy + SB, nby); by++) {
            for (let bx = sx; bx < Math.min(sx + SB, nbx); bx++) {
              const ox = x0 + bx * B * h;
              const oy = y0 + by * B * h;
              const oz = z0 + bz * B * h;
              const cx = ox + (B * h) / 2;
              const cy = oy + (B * h) / 2;
              const cz = oz + (B * h) / 2;
              const n = gather(S, cx, cy, cz, brickRadius, margin, scratch, superList, sn);
              if (n === 0) {
                continue;
              }
              const d0 = field.distance(cx, cy, cz, scratch, n);
              if (!(globalThis as { __noCull?: boolean }).__noCull && Math.abs(d0) > brickRadius * 1.3 + 0.003) {
                continue;
              }
              const samples = new Float32Array(S1 * S1 * S1);
              // Coarse pass (every other sample), then the in-between samples only in 2x2x2-cell blocks the surface
              // can reach; elsewhere they take the (same-signed) coarse value.
              const at = (i: number, j: number, k: number): number => i + S1 * (j + S1 * k);
              for (let k = 0; k < S1; k += 2) {
                for (let j = 0; j < S1; j += 2) {
                  for (let i = 0; i < S1; i += 2) {
                    samples[at(i, j, k)] = field.distance(ox + i * h, oy + j * h, oz + k * h, scratch, n);
                  }
                }
              }
              const reach = 2 * h * Math.sqrt(3) * 1.25;
              let neg = false;
              let pos = false;
              for (let bk = 0; bk < B; bk += 2) {
                for (let bj = 0; bj < B; bj += 2) {
                  for (let bi = 0; bi < B; bi += 2) {
                    let far = true;
                    let sign = 0;
                    for (let c = 0; c < 8 && far; c++) {
                      const d = samples[at(bi + (c & 1) * 2, bj + ((c >> 1) & 1) * 2, bk + ((c >> 2) & 1) * 2)];
                      const sg = d < 0 ? -1 : 1;
                      if (Math.abs(d) < reach || (sign !== 0 && sg !== sign)) {
                        far = false;
                      }
                      sign = sg;
                    }
                    for (let k = bk; k <= bk + 2; k++) {
                      for (let j = bj; j <= bj + 2; j++) {
                        for (let i = bi; i <= bi + 2; i++) {
                          if ((i & 1) === 0 && (j & 1) === 0 && (k & 1) === 0) {
                            continue;
                          }
                          samples[at(i, j, k)] = far ? sign * reach : field.distance(ox + i * h, oy + j * h, oz + k * h, scratch, n);
                        }
                      }
                    }
                  }
                }
              }
              for (let q = 0; q < samples.length; q++) {
                if (samples[q] < 0) {
                  neg = true;
                } else {
                  pos = true;
                }
              }
              if (!neg || !pos) {
                continue;
              }
              bricks.push({ bx, by, bz, samples, list: scratch.slice(0, n) });
            }
          }
        }
      }
    }
  }

  const out: RegionMesh = { pos: [], nrm: [], si: [], sw: [], data: [], extra: [], idx: [], bricks: bricks.length };
  const cellVertex = new Map<number, number>();
  const key = (ci: number, cj: number, ck: number): number => ci + nx * (cj + ny * ck);
  const corner = new Float64Array(8);
  const pSum = [0, 0, 0];

  const grad = (list: Int32Array, x: number, y: number, z: number, g: number[]): number => {
    const e = h * 0.2;
    const n = list.length;
    g[0] = field.distance(x + e, y, z, list, n) - field.distance(x - e, y, z, list, n);
    g[1] = field.distance(x, y + e, z, list, n) - field.distance(x, y - e, z, list, n);
    g[2] = field.distance(x, y, z + e, list, n) - field.distance(x, y, z - e, list, n);
    const l = Math.hypot(g[0], g[1], g[2]);
    if (l > 1e-12) {
      g[0] /= l;
      g[1] /= l;
      g[2] /= l;
    }
    return (l / (2 * e)) || 1;
  };
  const g = [0, 0, 0];

  // Vertices.
  for (const br of bricks) {
    const s = br.samples;
    for (let k = 0; k < B; k++) {
      for (let j = 0; j < B; j++) {
        for (let i = 0; i < B; i++) {
          let neg = 0;
          for (let c = 0; c < 8; c++) {
            const [a, b, cc] = CORNERS[c];
            const d = s[i + a + S1 * (j + b + S1 * (k + cc))];
            corner[c] = d;
            if (d < 0) {
              neg++;
            }
          }
          if (neg === 0 || neg === 8) {
            continue;
          }
          const ci = br.bx * B + i;
          const cj = br.by * B + j;
          const ck = br.bz * B + k;
          if (ci >= nx || cj >= ny || ck >= nz) {
            continue;
          }
          pSum[0] = pSum[1] = pSum[2] = 0;
          let cnt = 0;
          for (const [e0, e1] of EDGES) {
            const d0 = corner[e0];
            const d1 = corner[e1];
            if (d0 < 0 === d1 < 0) {
              continue;
            }
            const t = d0 / (d0 - d1);
            const a = CORNERS[e0];
            const b = CORNERS[e1];
            pSum[0] += a[0] + (b[0] - a[0]) * t;
            pSum[1] += a[1] + (b[1] - a[1]) * t;
            pSum[2] += a[2] + (b[2] - a[2]) * t;
            cnt++;
          }
          const cx0 = x0 + ci * h;
          const cy0 = y0 + cj * h;
          const cz0 = z0 + ck * h;
          let px = cx0 + (pSum[0] / cnt) * h;
          let py = cy0 + (pSum[1] / cnt) * h;
          let pz = cz0 + (pSum[2] / cnt) * h;
          // Project onto the surface (one Newton step along the gradient, which is also the normal), near the cell.
          {
            const d = field.distance(px, py, pz, br.list, br.list.length);
            const gl = grad(br.list, px, py, pz, g);
            const step = d / gl;
            px = Math.min(Math.max(px - g[0] * step, cx0 - 0.5 * h), cx0 + 1.5 * h);
            py = Math.min(Math.max(py - g[1] * step, cy0 - 0.5 * h), cy0 + 1.5 * h);
            pz = Math.min(Math.max(pz - g[2] * step, cz0 - 0.5 * h), cz0 + 1.5 * h);
          }
          // Soft occlusion from the field (stylized ambient occlusion): how much of a few steps along the normal is
          // swallowed by nearby surfaces.
          let occ = 0;
          for (let q = 1; q <= 3; q++) {
            const dq = 0.008 * q;
            const dd = field.distance(px + g[0] * dq, py + g[1] * dq, pz + g[2] * dq, br.list, br.list.length);
            occ += Math.max(0, dq - dd) / dq / (1 << q);
          }
          const ao = Math.min(1, Math.max(0, 1 - 1.5 * occ));
          const a = attr.evaluate(px, py, pz, br.list, br.list.length);
          let hide = 0;
          for (let q = 0; q < 4; q++) {
            if (hidden.has(a.bones[q])) {
              hide += a.weights[q];
            }
          }
          // Fine regions: sink the vertex under the coarse surface near the region's faces.
          if (insetBand > 0) {
            const dist = Math.min(px - region.min[0], region.max[0] - px, py - region.min[1], region.max[1] - py, pz - region.min[2], region.max[2] - pz);
            if (dist < insetBand) {
              const inset = 0.0009 * (1 - Math.max(dist, 0) / insetBand);
              px -= g[0] * inset;
              py -= g[1] * inset;
              pz -= g[2] * inset;
            }
          }
          const vi = out.pos.length / 3;
          out.pos.push(px, py, pz);
          out.nrm.push(g[0], g[1], g[2]);
          out.si.push(a.bones[0], a.bones[1], a.bones[2], a.bones[3]);
          out.sw.push(a.weights[0], a.weights[1], a.weights[2], a.weights[3]);
          out.data.push(a.mat, a.ch[0], hide > 0.5 ? 1 : 0, -ao);
          out.extra.push(a.ch[1], a.ch[2], a.ch[3]);
          cellVertex.set(key(ci, cj, ck), vi);
        }
      }
    }
  }

  // Quads for every crossed edge (edges owned by their lower corner).
  const P = out.pos;
  const quad = (a: number, b: number, c: number, d: number): void => {
    const d02 = (P[a * 3] - P[c * 3]) ** 2 + (P[a * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[c * 3 + 2]) ** 2;
    const d13 = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
    const tris = d02 < d13 ? [a, b, c, a, c, d] : [a, b, d, b, c, d];
    for (let t = 0; t < 6; t += 3) {
      const cx = (P[tris[t] * 3] + P[tris[t + 1] * 3] + P[tris[t + 2] * 3]) / 3;
      const cy = (P[tris[t] * 3 + 1] + P[tris[t + 1] * 3 + 1] + P[tris[t + 2] * 3 + 1]) / 3;
      const cz = (P[tris[t] * 3 + 2] + P[tris[t + 1] * 3 + 2] + P[tris[t + 2] * 3 + 2]) / 3;
      let skip = false;
      for (const r of drop) {
        if (cx > r.min[0] + overlap && cx < r.max[0] - overlap && cy > r.min[1] + overlap && cy < r.max[1] - overlap && cz > r.min[2] + overlap && cz < r.max[2] - overlap) {
          skip = true;
          break;
        }
      }
      if (!skip) {
        out.idx.push(tris[t], tris[t + 1], tris[t + 2]);
      }
    }
  };
  const look = (ci: number, cj: number, ck: number): number => {
    if (ci < 0 || cj < 0 || ck < 0 || ci >= nx || cj >= ny || ck >= nz) {
      return -1;
    }
    return cellVertex.get(key(ci, cj, ck)) ?? -1;
  };
  for (const br of bricks) {
    const s = br.samples;
    for (let k = 0; k < B; k++) {
      for (let j = 0; j < B; j++) {
        for (let i = 0; i < B; i++) {
          const ci = br.bx * B + i;
          const cj = br.by * B + j;
          const ck = br.bz * B + k;
          const d0 = s[i + S1 * (j + S1 * k)];
          const inside = d0 < 0;
          // x edge
          const dx = s[i + 1 + S1 * (j + S1 * k)];
          if (inside !== dx < 0) {
            const a = look(ci, cj - 1, ck - 1);
            const b = look(ci, cj, ck - 1);
            const c = look(ci, cj, ck);
            const d = look(ci, cj - 1, ck);
            if ((a < 0 || b < 0 || c < 0 || d < 0) && (globalThis as { __meshDebug?: unknown[] }).__meshDebug) {
              (globalThis as { __meshDebug?: unknown[] }).__meshDebug!.push([0, ci, cj, ck, a, b, c, d, br.bx, br.by, br.bz, i, j, k]);
            }
            if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
              if (inside) {
                quad(a, b, c, d);
              } else {
                quad(d, c, b, a);
              }
            }
          }
          // y edge
          const dy = s[i + S1 * (j + 1 + S1 * k)];
          if (inside !== dy < 0) {
            const a = look(ci - 1, cj, ck - 1);
            const b = look(ci - 1, cj, ck);
            const c = look(ci, cj, ck);
            const d = look(ci, cj, ck - 1);
            if ((a < 0 || b < 0 || c < 0 || d < 0) && (globalThis as { __meshDebug?: unknown[] }).__meshDebug) {
              (globalThis as { __meshDebug?: unknown[] }).__meshDebug!.push([1, ci, cj, ck, a, b, c, d, br.bx, br.by, br.bz, i, j, k]);
            }
            if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
              if (inside) {
                quad(a, b, c, d);
              } else {
                quad(d, c, b, a);
              }
            }
          }
          // z edge
          const dz = s[i + S1 * (j + S1 * (k + 1))];
          if (inside !== dz < 0) {
            const a = look(ci - 1, cj - 1, ck);
            const b = look(ci, cj - 1, ck);
            const c = look(ci, cj, ck);
            const d = look(ci - 1, cj, ck);
            if ((a < 0 || b < 0 || c < 0 || d < 0) && (globalThis as { __meshDebug?: unknown[] }).__meshDebug) {
              (globalThis as { __meshDebug?: unknown[] }).__meshDebug!.push([2, ci, cj, ck, a, b, c, d, br.bx, br.by, br.bz, i, j, k]);
            }
            if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
              if (inside) {
                quad(a, b, c, d);
              } else {
                quad(d, c, b, a);
              }
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Meshes the sculpt: regions[0] covers everything at the base resolution, later regions are finer boxes (disjoint).
 * `hiddenBones`: vertices mostly skinned to these are flagged hidden in first person.
 */
export function meshSculpt(S: CompiledSculpt, boneCount: number, regions: MeshRegion[], hiddenBones: number[]): SculptMesh {
  const t0 = performance.now();
  const hidden = new Set(hiddenBones);
  const intersects = (p: MeshRegion, q: MeshRegion): boolean =>
    p.min[0] < q.max[0] && p.max[0] > q.min[0] && p.min[1] < q.max[1] && p.max[1] > q.min[1] && p.min[2] < q.max[2] && p.max[2] > q.min[2];
  const parts: RegionMesh[] = [];
  regions.forEach((r, i) => {
    // Later (finer) regions cut holes in this one; this one sinks under the finest earlier region it meets.
    const drop = regions.slice(i + 1).filter((q) => intersects(r, q));
    let parentVoxel = 0;
    for (let k = 0; k < i; k++) {
      if (intersects(regions[k], r)) {
        parentVoxel = parentVoxel === 0 ? regions[k].voxel : Math.min(parentVoxel, regions[k].voxel);
      }
    }
    const band = parentVoxel > 0 ? parentVoxel * 3 : 0;
    parts.push(meshRegion(S, boneCount, r, hidden, drop, r.voxel * 1.5, band));
  });
  // Compact (drop unreferenced vertices) and merge.
  let vCount = 0;
  let iCount = 0;
  const remaps: Int32Array[] = [];
  for (const p of parts) {
    const remap = new Int32Array(p.pos.length / 3).fill(-1);
    for (const i of p.idx) {
      if (remap[i] < 0) {
        remap[i] = vCount++;
      }
    }
    remaps.push(remap);
    iCount += p.idx.length;
  }
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const skinIndex = new Uint16Array(vCount * 4);
  const skinWeight = new Float32Array(vCount * 4);
  const data = new Float32Array(vCount * 4);
  const extra = new Float32Array(vCount * 3);
  const indices = new Uint32Array(iCount);
  let io = 0;
  let bricks = 0;
  parts.forEach((p, pi) => {
    bricks += p.bricks;
    const remap = remaps[pi];
    for (let v = 0; v < remap.length; v++) {
      const r = remap[v];
      if (r < 0) {
        continue;
      }
      for (let c = 0; c < 3; c++) {
        positions[r * 3 + c] = p.pos[v * 3 + c];
        normals[r * 3 + c] = p.nrm[v * 3 + c];
        extra[r * 3 + c] = p.extra[v * 3 + c];
      }
      for (let c = 0; c < 4; c++) {
        skinIndex[r * 4 + c] = p.si[v * 4 + c];
        skinWeight[r * 4 + c] = p.sw[v * 4 + c];
        data[r * 4 + c] = p.data[v * 4 + c];
      }
    }
    for (const i of p.idx) {
      indices[io++] = remap[i];
    }
  });
  return {
    positions,
    normals,
    skinIndex,
    skinWeight,
    data,
    extra,
    indices,
    stats: { vertices: vCount, triangles: iCount / 3, bricks, ms: performance.now() - t0 },
  };
}
