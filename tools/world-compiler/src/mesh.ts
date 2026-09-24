/**
 * Per-tile triangle soup merged per material (one glTF primitive each). Positions are world metres on input and are
 * stored relative to the tile origin (the glTF node translation).
 *
 * - Smooth vertices (ground) are welded per material on a 1 mm grid and get area-weighted normals; flat vertices keep
 *   the normal they are given.
 * - UV0 (format 1): world-scale texture coordinates in texture repeats, i.e. metres / the material's tiling. Floors
 *   (|n.y| > 0.7) project on world X/Z (u east, v south); other faces use the face's horizontal tangent (right when
 *   facing the face) and world up (image up), so walls, shutters and tiles stand upright. Callers may pass their own
 *   UVs (`uv` in repeats or `uvm` in metres). Coordinates are shifted by whole repeats per tile, so the texture is
 *   continuous across tiles and float32 keeps sub-texel precision.
 * - UV1 (format 1): a non-overlapping lightmap / AO atlas per tile and LOD. Every emission call is one planar chart
 *   (the whole ground of a tile is one X/Z chart); `addMesh` groups triangles into box-projected charts. takeLod()
 *   packs the charts into a square atlas with padding.
 * - COLOR_0 (optional, linear RGBA): glTF multiplies it into the base colour (grime, wear darkening).
 * - LOD: every triangle carries a LOD mask (bit k = LOD k). Emissions use `lodMask` (default: every LOD), so the
 *   greybox and the ground reach every LOD; façade detail can be limited to LOD0 with `withLod(LOD0, ...)`.
 */
import { hasMaterial, materialOrder, type MaterialName } from './materials';
import { tilingOf } from './textures';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
/** Linear RGBA in [0, 1]. */
export type RGBA = [number, number, number, number];

export const LOD0 = 1;
export const LOD1 = 2;
export const LOD2 = 4;
export const ALL_LODS = LOD0 | LOD1 | LOD2;

export interface EmitOptions {
  /** UV0 per vertex in texture repeats (overrides the projection). */
  uv?: readonly Vec2[];
  /** UV0 per vertex in metres (divided by the material's tiling). */
  uvm?: readonly Vec2[];
  /** COLOR_0 for all vertices, or one per vertex. */
  color?: RGBA | readonly RGBA[];
  /** LOD mask of the emitted triangles (default: the mesh's lodMask). */
  lod?: number;
}

export interface MeshInput {
  /** World positions, flat [x, y, z, ...]. */
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Vertex normals, flat; default: area-weighted smooth normals over the given indexing. */
  normals?: ArrayLike<number>;
  /** UV0 per vertex in repeats (flat [u, v, ...]); default: box projection at world scale. */
  uv?: ArrayLike<number>;
  /** UV0 per vertex in metres (flat). */
  uvm?: ArrayLike<number>;
  /** COLOR_0 for all vertices, or one per vertex. */
  color?: RGBA | readonly RGBA[];
  lod?: number;
}

const GROUND_CHART = 0;

class Part {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  /** Lightmap chart coordinates in metres, and the chart of each vertex. */
  lm: number[] = [];
  chart: number[] = [];
  col: number[] | null = null;
  idx: number[] = [];
  lod: number[] = [];
  readonly weld = new Map<string, number>();
}

export interface PartArrays {
  material: MaterialName;
  position: Float32Array<ArrayBuffer>;
  normal: Float32Array<ArrayBuffer>;
  index: Uint32Array<ArrayBuffer>;
  /** Format 1 only. */
  uv0?: Float32Array<ArrayBuffer>;
  uv1?: Float32Array<ArrayBuffer>;
  color?: Float32Array<ArrayBuffer>;
}

export interface LightmapInfo {
  /** Atlas size in texels (square). */
  size: number;
  /** Texels per metre of the packing. */
  texelsPerM: number;
  /** Empty texels kept around every chart. */
  padding: number;
  charts: number;
  /** Share of the atlas covered by chart boxes (with padding). */
  fill: number;
}

export interface TakeResult {
  parts: PartArrays[];
  triangles: number;
  lightmap: LightmapInfo | null;
}

type Frame = { ux: number; uy: number; uz: number; vx: number; vy: number; vz: number };

/** Plane frame of a face: u = right (horizontal tangent), v = down (image rows) for walls; east / south for floors. */
function faceFrame(n: Vec3): Frame {
  if (Math.abs(n[1]) > 0.7) {
    return { ux: 1, uy: 0, uz: 0, vx: 0, vy: 0, vz: 1 };
  }
  const h = Math.hypot(n[0], n[2]) || 1;
  // Right when facing the face (looking along -n): r = (nz, 0, -nx) / h. Up' = n x r; v runs down: -up'.
  const rx = n[2] / h;
  const rz = -n[0] / h;
  const upx = n[1] * rz;
  const upy = n[2] * rx - n[0] * rz;
  const upz = -n[1] * rx;
  return { ux: rx, uy: 0, uz: rz, vx: -upx, vy: -upy, vz: -upz };
}

export class TileMesh {
  private readonly parts = new Map<MaterialName, Part>();
  private charts = 1;
  /** LOD mask of new emissions (see withLod). */
  lodMask = ALL_LODS;

  constructor(
    readonly ox: number,
    readonly oz: number,
  ) {}

  /** Runs `fn` with emissions limited to the LODs in `mask`. */
  withLod<T>(mask: number, fn: () => T): T {
    const prev = this.lodMask;
    this.lodMask = mask;
    try {
      return fn();
    } finally {
      this.lodMask = prev;
    }
  }

  private part(m: MaterialName): Part {
    let p = this.parts.get(m);
    if (!p) {
      if (!hasMaterial(m)) {
        throw new Error(`unknown material '${m}': add its definition to a list in registry.ts (MATERIAL_SETS)`);
      }
      p = new Part();
      this.parts.set(m, p);
    }
    return p;
  }

  private newChart(): number {
    return this.charts++;
  }

  private setColor(p: Part, vi: number, c: RGBA | undefined): void {
    if (!c && !p.col) {
      return;
    }
    if (!p.col) {
      p.col = new Array((p.pos.length / 3) * 4).fill(1);
    }
    while (p.col.length < (vi + 1) * 4) {
      p.col.push(1);
    }
    const o = vi * 4;
    const v = c ?? [1, 1, 1, 1];
    p.col[o] = v[0];
    p.col[o + 1] = v[1];
    p.col[o + 2] = v[2];
    p.col[o + 3] = v[3];
  }

  private static colorAt(c: RGBA | readonly RGBA[] | undefined, k: number): RGBA | undefined {
    if (!c) {
      return undefined;
    }
    return typeof c[0] === 'number' ? (c as RGBA) : (c as readonly RGBA[])[k];
  }

  /** Welded vertex (normal accumulated from the faces that use it). Ground chart, X/Z projection. */
  private smoothVertex(p: Part, m: MaterialName, v: Vec3, c: RGBA | undefined): number {
    const x = v[0] - this.ox;
    const z = v[2] - this.oz;
    const key = `${Math.round(x * 1000)},${Math.round(v[1] * 1000)},${Math.round(z * 1000)}`;
    let i = p.weld.get(key);
    if (i === undefined) {
      i = p.pos.length / 3;
      p.pos.push(x, v[1], z);
      p.nrm.push(0, 0, 0);
      const [tw, th] = tilingOf(m);
      p.uv.push((x + (this.ox % tw)) / tw, (z + (this.oz % th)) / th);
      p.lm.push(x, z);
      p.chart.push(GROUND_CHART);
      this.setColor(p, i, c);
      p.weld.set(key, i);
    }
    return i;
  }

  /** Adds a flat vertex with UV0 from the face frame (or the caller's UVs) and chart coordinates in metres. */
  private flatVertex(p: Part, m: MaterialName, v: Vec3, n: Vec3, chart: number, opts: EmitOptions | undefined, k: number, f: Frame): number {
    const i = p.pos.length / 3;
    const x = v[0] - this.ox;
    const z = v[2] - this.oz;
    p.pos.push(x, v[1], z);
    p.nrm.push(n[0], n[1], n[2]);
    const su = x * f.ux + v[1] * f.uy + z * f.uz;
    const sv = x * f.vx + v[1] * f.vy + z * f.vz;
    if (opts?.uv) {
      p.uv.push(opts.uv[k][0], opts.uv[k][1]);
    } else {
      const [tw, th] = tilingOf(m);
      if (opts?.uvm) {
        p.uv.push(opts.uvm[k][0] / tw, opts.uvm[k][1] / th);
      } else {
        // Shift by whole repeats of the tile origin's projection so tiles stay continuous.
        const ou = (this.ox * f.ux + this.oz * f.uz) % tw;
        const ov = (this.ox * f.vx + this.oz * f.vz) % th;
        p.uv.push((su + ou) / tw, (sv + ov) / th);
      }
    }
    p.lm.push(su, sv);
    p.chart.push(chart);
    this.setColor(p, i, TileMesh.colorAt(opts?.color, k));
    return i;
  }

  /** Convex polygon facing up (+Y), welded and smooth-shaded (ground). */
  groundPolygon(m: MaterialName, pts: readonly Vec3[], opts?: EmitOptions): void {
    if (pts.length < 3) {
      return;
    }
    const p = this.part(m);
    const lod = opts?.lod ?? this.lodMask;
    const ids = pts.map((v, k) => this.smoothVertex(p, m, v, TileMesh.colorAt(opts?.color, k)));
    for (let k = 1; k + 1 < pts.length; k++) {
      this.smoothTri(p, ids[0], ids[k], ids[k + 1], true, lod);
    }
  }

  private smoothTri(p: Part, a: number, b: number, c: number, up: boolean, lod: number): void {
    if (a === b || b === c || a === c) {
      return;
    }
    const P = p.pos;
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3];
    const vy = P[c * 3 + 1] - P[a * 3 + 1];
    const vz = P[c * 3 + 2] - P[a * 3 + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-9) {
      return;
    }
    if (up && ny < 0) {
      [b, c] = [c, b];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const i of [a, b, c]) {
      p.nrm[i * 3] += nx;
      p.nrm[i * 3 + 1] += ny;
      p.nrm[i * 3 + 2] += nz;
    }
    p.idx.push(a, b, c);
    p.lod.push(lod);
  }

  /** Planar convex polygon with a flat normal; the winding is fixed so the front face matches `n`. One chart. */
  flatPolygon(m: MaterialName, pts: readonly Vec3[], n: Vec3, opts?: EmitOptions): void {
    if (pts.length < 3) {
      return;
    }
    const p = this.part(m);
    const lod = opts?.lod ?? this.lodMask;
    const chart = this.newChart();
    const f = faceFrame(n);
    const ids = pts.map((v, k) => this.flatVertex(p, m, v, n, chart, opts, k, f));
    for (let k = 1; k + 1 < pts.length; k++) {
      this.flatTri(p, ids[0], ids[k], ids[k + 1], n, lod);
    }
  }

  /** Triangles of a triangulated planar shape (index triples into `pts`) with a flat normal. One chart. */
  flatTriangles(m: MaterialName, pts: readonly Vec3[], tris: readonly number[], n: Vec3, opts?: EmitOptions): void {
    const p = this.part(m);
    const lod = opts?.lod ?? this.lodMask;
    const chart = this.newChart();
    const f = faceFrame(n);
    const ids = pts.map((v, k) => this.flatVertex(p, m, v, n, chart, opts, k, f));
    for (let k = 0; k < tris.length; k += 3) {
      this.flatTri(p, ids[tris[k]], ids[tris[k + 1]], ids[tris[k + 2]], n, lod);
    }
  }

  private flatTri(p: Part, a: number, b: number, c: number, n: Vec3, lod: number): void {
    const P = p.pos;
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3];
    const vy = P[c * 3 + 1] - P[a * 3 + 1];
    const vz = P[c * 3 + 2] - P[a * 3 + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const d = cx * n[0] + cy * n[1] + cz * n[2];
    if (Math.abs(d) < 1e-10) {
      return;
    }
    if (d < 0) {
      p.idx.push(a, c, b);
    } else {
      p.idx.push(a, b, c);
    }
    p.lod.push(lod);
  }

  /** Vertical quad between a bottom edge (a, b) and heights (top at a, b); normal horizontal `n`. */
  wall(m: MaterialName, ax: number, az: number, bx: number, bz: number, ya0: number, ya1: number, yb0: number, yb1: number, n: Vec3, opts?: EmitOptions): void {
    if (ya1 - ya0 < 0.005 && yb1 - yb0 < 0.005) {
      return;
    }
    this.flatPolygon(
      m,
      [
        [ax, ya0, az],
        [bx, yb0, bz],
        [bx, yb1, bz],
        [ax, ya1, az],
      ],
      n,
      opts,
    );
  }

  /**
   * Any indexed triangle mesh in world metres (railings, profiles, curved parts). Triangles are grouped into
   * box-projected charts (dominant axis of the face normal, connected through shared vertices); vertices shared by
   * two charts are split. UV0 defaults to the same box projection at world scale.
   */
  addMesh(m: MaterialName, input: MeshInput): void {
    const P = input.positions;
    const I = input.indices;
    const nv = P.length / 3;
    const nt = Math.floor(I.length / 3);
    if (!nt) {
      return;
    }
    const lod = input.lod ?? this.lodMask;
    let N = input.normals;
    if (!N) {
      const acc = new Float64Array(nv * 3);
      for (let t = 0; t < nt; t++) {
        const a = I[t * 3];
        const b = I[t * 3 + 1];
        const c = I[t * 3 + 2];
        const ux = P[b * 3] - P[a * 3];
        const uy = P[b * 3 + 1] - P[a * 3 + 1];
        const uz = P[b * 3 + 2] - P[a * 3 + 2];
        const vx = P[c * 3] - P[a * 3];
        const vy = P[c * 3 + 1] - P[a * 3 + 1];
        const vz = P[c * 3 + 2] - P[a * 3 + 2];
        const fx = uy * vz - uz * vy;
        const fy = uz * vx - ux * vz;
        const fz = ux * vy - uy * vx;
        for (const i of [a, b, c]) {
          acc[i * 3] += fx;
          acc[i * 3 + 1] += fy;
          acc[i * 3 + 2] += fz;
        }
      }
      for (let i = 0; i < nv; i++) {
        const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]) || 1;
        acc[i * 3] /= l;
        acc[i * 3 + 1] /= l;
        acc[i * 3 + 2] /= l;
      }
      N = acc;
    }
    // Dominant axis of every face (0..5 = +X -X +Y -Y +Z -Z); union-find over vertices shared within one axis.
    const axis = new Uint8Array(nt);
    const parent = Int32Array.from({ length: nt }, (_, k) => k);
    const find = (k: number): number => {
      while (parent[k] !== k) {
        parent[k] = parent[parent[k]];
        k = parent[k];
      }
      return k;
    };
    const firstByVertexAxis = new Map<number, number>();
    for (let t = 0; t < nt; t++) {
      const a = I[t * 3];
      const b = I[t * 3 + 1];
      const c = I[t * 3 + 2];
      const ux = P[b * 3] - P[a * 3];
      const uy = P[b * 3 + 1] - P[a * 3 + 1];
      const uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3];
      const vy = P[c * 3 + 1] - P[a * 3 + 1];
      const vz = P[c * 3 + 2] - P[a * 3 + 2];
      const f = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const ax = Math.abs(f[0]) >= Math.abs(f[1]) && Math.abs(f[0]) >= Math.abs(f[2]) ? 0 : Math.abs(f[1]) >= Math.abs(f[2]) ? 1 : 2;
      axis[t] = ax * 2 + (f[ax] < 0 ? 1 : 0);
      for (const v of [a, b, c]) {
        const key = v * 6 + axis[t];
        const o = firstByVertexAxis.get(key);
        if (o === undefined) {
          firstByVertexAxis.set(key, t);
        } else {
          parent[find(t)] = find(o);
        }
      }
    }
    const chartOfRoot = new Map<number, number>();
    const p = this.part(m);
    const remap = new Map<number, number>();
    const [tw, th] = tilingOf(m);
    for (let t = 0; t < nt; t++) {
      const root = find(t);
      let chart = chartOfRoot.get(root);
      if (chart === undefined) {
        chart = this.newChart();
        chartOfRoot.set(root, chart);
      }
      const ax = axis[t];
      const n: Vec3 = [0, 0, 0];
      n[ax >> 1] = ax & 1 ? -1 : 1;
      const f = faceFrame(n);
      const tri: number[] = [];
      for (let k = 0; k < 3; k++) {
        const v = I[t * 3 + k];
        const key = v * 1e6 + chart;
        let i = remap.get(key);
        if (i === undefined) {
          i = p.pos.length / 3;
          const x = P[v * 3] - this.ox;
          const y = P[v * 3 + 1];
          const z = P[v * 3 + 2] - this.oz;
          p.pos.push(x, y, z);
          p.nrm.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
          const su = x * f.ux + y * f.uy + z * f.uz;
          const sv = x * f.vx + y * f.vy + z * f.vz;
          if (input.uv) {
            p.uv.push(input.uv[v * 2], input.uv[v * 2 + 1]);
          } else if (input.uvm) {
            p.uv.push(input.uvm[v * 2] / tw, input.uvm[v * 2 + 1] / th);
          } else {
            const ou = (this.ox * f.ux + this.oz * f.uz) % tw;
            const ov = (this.ox * f.vx + this.oz * f.vz) % th;
            p.uv.push((su + ou) / tw, (sv + ov) / th);
          }
          p.lm.push(su, sv);
          p.chart.push(chart);
          this.setColor(p, i, TileMesh.colorAt(input.color, v));
          remap.set(key, i);
        }
        tri.push(i);
      }
      p.idx.push(tri[0], tri[1], tri[2]);
      p.lod.push(lod);
    }
  }

  /** Triangles emitted so far (every LOD, or those in the mask `lod`). */
  triangles(lod = ALL_LODS): number {
    let t = 0;
    for (const p of this.parts.values()) {
      if (lod === ALL_LODS) {
        t += p.idx.length / 3;
      } else {
        for (const l of p.lod) {
          if (l & lod) {
            t++;
          }
        }
      }
    }
    return t;
  }

  /** True when every triangle reaches both LODs or neither (the two LOD meshes are the same). */
  lodsIdentical(a: number, b: number): boolean {
    const both = a | b;
    for (const p of this.parts.values()) {
      for (const l of p.lod) {
        const m = l & both;
        if (m !== 0 && m !== both) {
          return false;
        }
      }
    }
    return true;
  }

  /** Material ids with at least one triangle in `lod`. */
  materials(lod = ALL_LODS): MaterialName[] {
    return materialOrder().filter((m) => {
      const p = this.parts.get(m);
      return !!p && p.lod.some((l) => (l & lod) !== 0);
    });
  }

  /**
   * Format 0: every vertex as emitted (positions and normals only), primitives in registration order. Same as the
   * format 0 compiler, so format 0 output stays byte-identical.
   */
  take(): PartArrays[] {
    const out: PartArrays[] = [];
    for (const m of materialOrder()) {
      const p = this.parts.get(m);
      if (!p || !p.idx.length) {
        continue;
      }
      out.push({ material: m, position: new Float32Array(p.pos), normal: normalized(p.nrm), index: new Uint32Array(p.idx) });
    }
    return out;
  }

  /**
   * Format 1: the triangles of one LOD (bit mask) with compacted vertices, UV0, UV1 packed into a `lightmapSize`
   * atlas (grown up to 8192 when the charts do not fit) and COLOR_0 where set.
   */
  takeLod(lod: number, lightmapSize: number, padding = 2): TakeResult {
    interface Sel {
      m: MaterialName;
      p: Part;
      verts: number[];
      idx: number[];
    }
    const sel: Sel[] = [];
    for (const m of materialOrder()) {
      const p = this.parts.get(m);
      if (!p || !p.idx.length) {
        continue;
      }
      const map = new Int32Array(p.pos.length / 3).fill(-1);
      const verts: number[] = [];
      const idx: number[] = [];
      for (let t = 0; t < p.lod.length; t++) {
        if (!(p.lod[t] & lod)) {
          continue;
        }
        for (let k = 0; k < 3; k++) {
          const v = p.idx[t * 3 + k];
          if (map[v] < 0) {
            map[v] = verts.length;
            verts.push(v);
          }
          idx.push(map[v]);
        }
      }
      if (idx.length) {
        sel.push({ m, p, verts, idx });
      }
    }
    // Chart extents (metres) over the selected vertices.
    const box = new Map<number, [number, number, number, number]>();
    for (const s of sel) {
      for (const v of s.verts) {
        const c = s.p.chart[v];
        const u = s.p.lm[v * 2];
        const w = s.p.lm[v * 2 + 1];
        const b = box.get(c);
        if (!b) {
          box.set(c, [u, w, u, w]);
        } else {
          b[0] = Math.min(b[0], u);
          b[1] = Math.min(b[1], w);
          b[2] = Math.max(b[2], u);
          b[3] = Math.max(b[3], w);
        }
      }
    }
    const ids = [...box.keys()].sort((a, b) => a - b);
    const packed = packCharts(
      ids.map((c) => {
        const b = box.get(c)!;
        return [b[2] - b[0], b[3] - b[1]] as Vec2;
      }),
      lightmapSize,
      padding,
    );
    const place = new Map<number, number>();
    ids.forEach((c, k) => place.set(c, k));
    const parts: PartArrays[] = [];
    let triangles = 0;
    for (const s of sel) {
      const n = s.verts.length;
      const position = new Float32Array(n * 3);
      const normal = new Float32Array(n * 3);
      const uv0 = new Float32Array(n * 2);
      const uv1 = new Float32Array(n * 2);
      const P = s.p;
      const color = P.col ? new Float32Array(n * 4) : undefined;
      for (let k = 0; k < n; k++) {
        const v = s.verts[k];
        position[k * 3] = P.pos[v * 3];
        position[k * 3 + 1] = P.pos[v * 3 + 1];
        position[k * 3 + 2] = P.pos[v * 3 + 2];
        let nx = P.nrm[v * 3];
        let ny = P.nrm[v * 3 + 1];
        let nz = P.nrm[v * 3 + 2];
        const l = Math.hypot(nx, ny, nz);
        if (l > 1e-12) {
          nx /= l;
          ny /= l;
          nz /= l;
        } else {
          nx = 0;
          ny = 1;
          nz = 0;
        }
        normal[k * 3] = nx;
        normal[k * 3 + 1] = ny;
        normal[k * 3 + 2] = nz;
        uv0[k * 2] = P.uv[v * 2];
        uv0[k * 2 + 1] = P.uv[v * 2 + 1];
        const c = P.chart[v];
        const b = box.get(c)!;
        const pl = packed.placements[place.get(c)!];
        let a = (P.lm[v * 2] - b[0]) * packed.scale + 0.5;
        let w = (P.lm[v * 2 + 1] - b[1]) * packed.scale + 0.5;
        if (pl.rotated) {
          [a, w] = [w, a];
        }
        uv1[k * 2] = (pl.x + a) / packed.size;
        uv1[k * 2 + 1] = (pl.y + w) / packed.size;
        if (color) {
          for (let q = 0; q < 4; q++) {
            color[k * 4 + q] = P.col![v * 4 + q] ?? 1;
          }
        }
      }
      triangles += s.idx.length / 3;
      parts.push({ material: s.m, position, normal, index: new Uint32Array(s.idx), uv0, uv1, ...(color ? { color } : {}) });
    }
    return {
      parts,
      triangles,
      lightmap: ids.length ? { size: packed.size, texelsPerM: Math.round(packed.scale * 1000) / 1000, padding, charts: ids.length, fill: Math.round(packed.fill * 1000) / 1000 } : null,
    };
  }
}

function normalized(nrm: readonly number[]): Float32Array<ArrayBuffer> {
  const normal = new Float32Array(nrm);
  for (let i = 0; i < normal.length; i += 3) {
    const l = Math.hypot(normal[i], normal[i + 1], normal[i + 2]);
    if (l > 1e-12) {
      normal[i] /= l;
      normal[i + 1] /= l;
      normal[i + 2] /= l;
    } else {
      normal[i + 1] = 1;
    }
  }
  return normal;
}

interface Placement {
  x: number;
  y: number;
  rotated: boolean;
}

/**
 * Shelf packing of chart rectangles (metres) into a square atlas: charts taller than wide are turned 90°, sorted by
 * height, and the texel scale is the largest (binary search) at which every chart plus padding fits. The atlas grows
 * (x2, up to 8192) when even the smallest scale does not fit.
 */
export function packCharts(sizes: readonly Vec2[], atlas: number, padding: number): { size: number; scale: number; placements: Placement[]; fill: number } {
  const n = sizes.length;
  const rot = sizes.map(([w, h]) => h > w);
  const dims = sizes.map(([w, h], k) => (rot[k] ? [h, w] : [w, h]) as Vec2);
  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => dims[b][1] - dims[a][1] || dims[b][0] - dims[a][0] || a - b);
  let maxDim = 1e-6;
  for (const d of dims) {
    maxDim = Math.max(maxDim, d[0], d[1]);
  }
  const box = (d: number, s: number): number => Math.ceil(d * s + 1) + 2 * padding;
  const tryPack = (size: number, s: number, out: Placement[] | null): boolean => {
    let x = 0;
    let y = 0;
    let shelf = 0;
    for (const k of order) {
      const bw = box(dims[k][0], s);
      const bh = box(dims[k][1], s);
      if (bw > size) {
        return false;
      }
      if (x + bw > size) {
        y += shelf;
        x = 0;
        shelf = 0;
      }
      if (y + bh > size) {
        return false;
      }
      if (out) {
        out[k] = { x: x + padding, y: y + padding, rotated: rot[k] };
      }
      x += bw;
      shelf = Math.max(shelf, bh);
    }
    return true;
  };
  let size = atlas;
  for (;;) {
    let lo = 0;
    let hi = (size - 2 * padding - 1) / maxDim;
    if (!tryPack(size, lo, null)) {
      if (size >= 8192) {
        throw new Error(`lightmap: ${n} charts do not fit an 8192 atlas`);
      }
      size *= 2;
      continue;
    }
    for (let it = 0; it < 24; it++) {
      const mid = (lo + hi) / 2;
      if (tryPack(size, mid, null)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const placements: Placement[] = new Array(n);
    tryPack(size, lo, placements);
    let area = 0;
    for (let k = 0; k < n; k++) {
      area += box(dims[k][0], lo) * box(dims[k][1], lo);
    }
    return { size, scale: lo, placements, fill: area / (size * size) };
  }
}
