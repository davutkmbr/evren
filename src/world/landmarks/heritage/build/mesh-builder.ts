import type { RGB } from './surfaces';

/** Material descriptor written per vertex (surface id + tint + weathering + floodlight). */
export interface Mat {
  surf: number;
  color: RGB;
  /** 0..1 weathering (dirt streaks, damp, patina, ruin). Granite reinterprets it (> 0.5: engraved glyphs). */
  weather: number;
  /** 0..1 strength of the warm night floodlighting on this surface. */
  flood: number;
}

export function mat(surf: number, color: RGB, weather = 0.5, flood = 0): Mat {
  return { surf, color, weather, flood };
}

export function withFlood(m: Mat, flood: number): Mat {
  return { ...m, flood };
}

export function withSurf(m: Mat, surf: number): Mat {
  return { ...m, surf };
}

export function withWeather(m: Mat, weather: number): Mat {
  return { ...m, weather };
}

export function tinted(m: Mat, k: number): Mat {
  return { ...m, color: [m.color[0] * k, m.color[1] * k, m.color[2] * k] };
}

/** Geometry buffers for one LOD of one chunk (positions relative to the chunk origin). */
export interface MeshData {
  positions: Float32Array;
  normals: Int8Array;
  uvs: Float32Array;
  /** sqrt-encoded linear albedo rgb + floodlight (a). */
  colors: Uint8Array;
  /** surface id, weathering, height above ground (0.25 m steps), ambient occlusion. */
  surf: Uint8Array;
  index: Uint32Array | Uint16Array;
  vertexCount: number;
  triangleCount: number;
  /** Local-space bounding box. */
  min: [number, number, number];
  max: [number, number, number];
}

const enc = (v: number): number => Math.round(Math.sqrt(Math.min(Math.max(v, 0), 1)) * 255);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Accumulates indexed triangles with per-vertex material attributes. Positions are given in world metres and stored
 * relative to (originX, 0, originZ) so large sites keep float precision.
 */
export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private srf: number[] = [];
  private idx: number[] = [];

  constructor(
    readonly originX: number,
    readonly originZ: number,
  ) {}

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, m: Mat, ao = 1): number {
    const i = this.pos.length / 3;
    this.pos.push(x - this.originX, y, z - this.originZ);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(enc(m.color[0]), enc(m.color[1]), enc(m.color[2]), Math.round(clamp01(m.flood) * 255));
    this.srf.push(m.surf, Math.round(clamp01(m.weather) * 255), Math.round(clamp01(ao) * 255));
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  isEmpty(): boolean {
    return this.idx.length === 0;
  }

  finalize(groundAt: (x: number, z: number) => number): MeshData {
    const n = this.vertexCount;
    const positions = new Float32Array(this.pos);
    const normals = new Int8Array(n * 3);
    const uvs = new Float32Array(this.uv);
    const colors = new Uint8Array(this.col);
    const surf = new Uint8Array(n * 4);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
      const nx = this.nrm[i * 3];
      const ny = this.nrm[i * 3 + 1];
      const nz = this.nrm[i * 3 + 2];
      const nl = Math.hypot(nx, ny, nz) || 1;
      normals[i * 3] = Math.round((nx / nl) * 127);
      normals[i * 3 + 1] = Math.round((ny / nl) * 127);
      normals[i * 3 + 2] = Math.round((nz / nl) * 127);
      const g = Math.max(groundAt(x + this.originX, z + this.originZ), 0);
      surf[i * 4] = this.srf[i * 3];
      surf[i * 4 + 1] = this.srf[i * 3 + 1];
      surf[i * 4 + 2] = Math.round(Math.min(Math.max((y - g) * 4, 0), 255));
      surf[i * 4 + 3] = this.srf[i * 3 + 2];
    }
    const index = n < 65536 ? new Uint16Array(this.idx) : new Uint32Array(this.idx);
    return { positions, normals, uvs, colors, surf, index, vertexCount: n, triangleCount: this.idx.length / 3, min, max };
  }
}
