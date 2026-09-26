/**
 * The OSM ground surface: a regular grid of terrain heights (GROUND_STEP) lifted by GROUND_LIFT. The streets layer
 * triangulates exactly this grid into the draped ground mesh, so anything placed with yAt() sits on that mesh.
 */
import type { WorldBounds } from '../../../core/contracts';
import type { GeoSampler } from './geo';

export const GROUND_STEP = 5;
/** Height of the ground mesh above the terrain (covers terrain LOD z-fighting). */
export const GROUND_LIFT = 0.12;

/**
 * `rect` grown outward to the global GROUND_STEP lattice. Every OSM ground (the runtime slice, the compiled street
 * tiles) is built over such a rect, so their grid vertices and street raster texels coincide wherever both exist and
 * the same inputs give the same heights (a grid anchored elsewhere triangulates the terrain differently).
 */
export function groundRect(rect: WorldBounds): WorldBounds {
  const s = GROUND_STEP;
  return { minX: Math.floor(rect.minX / s) * s, maxX: Math.ceil(rect.maxX / s) * s, minZ: Math.floor(rect.minZ / s) * s, maxZ: Math.ceil(rect.maxZ / s) * s };
}

export class GroundGrid {
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  /** Vertex heights, row-major (j * nx + i) at (x0 + i step, z0 + j step). */
  readonly y: Float32Array;

  constructor(rect: WorldBounds, geo: GeoSampler) {
    this.x0 = rect.minX;
    this.z0 = rect.minZ;
    this.nx = Math.ceil((rect.maxX - rect.minX) / GROUND_STEP) + 1;
    this.nz = Math.ceil((rect.maxZ - rect.minZ) / GROUND_STEP) + 1;
    this.y = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        this.y[j * this.nx + i] = geo.height(this.x0 + i * GROUND_STEP, this.z0 + j * GROUND_STEP) + GROUND_LIFT;
      }
    }
  }

  /** Height of the ground mesh surface at (x, z) (triangles split along the (i+1, j)-(i, j+1) diagonal). */
  yAt(x: number, z: number): number {
    let fx = (x - this.x0) / GROUND_STEP;
    let fz = (z - this.z0) / GROUND_STEP;
    fx = Math.min(this.nx - 1.001, Math.max(0, fx));
    fz = Math.min(this.nz - 1.001, Math.max(0, fz));
    const i = fx | 0;
    const j = fz | 0;
    const u = fx - i;
    const v = fz - j;
    const n = this.nx;
    const ya = this.y[j * n + i];
    const yb = this.y[j * n + i + 1];
    const yc = this.y[(j + 1) * n + i];
    const yd = this.y[(j + 1) * n + i + 1];
    return u + v <= 1 ? ya + (yb - ya) * u + (yc - ya) * v : yd + (yc - yd) * (1 - u) + (yb - yd) * (1 - v);
  }

  /** Smooth vertex normal of grid vertex (i, j) (central differences). */
  normalAt(i: number, j: number, out: [number, number, number]): [number, number, number] {
    const n = this.nx;
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const j0 = Math.max(0, j - 1);
    const j1 = Math.min(this.nz - 1, j + 1);
    const gx = (this.y[j * n + i1] - this.y[j * n + i0]) / ((i1 - i0) * GROUND_STEP);
    const gz = (this.y[j1 * n + i] - this.y[j0 * n + i]) / ((j1 - j0) * GROUND_STEP);
    const l = Math.hypot(gx, 1, gz);
    out[0] = -gx / l;
    out[1] = 1 / l;
    out[2] = -gz / l;
    return out;
  }
}
