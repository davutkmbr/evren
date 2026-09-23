import * as THREE from 'three';
import { LandUse } from '../../core/contracts';
import type { District, GeoQuery, GridData, LandmarkDef, RoadDef, Vec2Like, WorldBounds } from '../../core/contracts';
import { WORLD_BOUNDS } from '../../core/geo-coords';
import { DENSITY_GRID, DISTRICT_GRID, HEIGHT_GRID, LANDUSE_GRID, NO_DISTRICT, sampleBilinear } from './build/grid';
import type { GridSpec } from './build/grid';
import type { BuildOutput } from './types';
import { WaterNames } from './water-names';

type MosqueSites = GeoQuery['smallMosqueSites'];

const BUILDABLE = new Uint8Array(16);
for (const u of [LandUse.Urban, LandUse.HistoricUrban, LandUse.Highrise, LandUse.Industrial, LandUse.Suburban]) {
  BUILDABLE[u] = 1;
}
const NO_DENSITY = new Uint8Array(16);
for (const u of [LandUse.Water, LandUse.Beach, LandUse.Park, LandUse.Forest, LandUse.Cemetery, LandUse.Landmark, LandUse.Airport, LandUse.Road]) {
  NO_DENSITY[u] = 1;
}

/** Minimum distance from the shoreline (m) for procedural buildings. */
const SHORE_SETBACK = 6;

function gridData<T extends Float32Array | Uint8Array>(data: T, g: GridSpec): GridData<T> {
  return { data, width: g.size, height: g.size, cellSize: g.cell, originX: g.origin, originZ: g.origin };
}

export interface GeoQueryParts {
  out: BuildOutput;
  landmarks: LandmarkDef[];
  roads: RoadDef[];
  districts: District[];
  coastlines: Vec2Like[][];
  mosqueSites: MosqueSites;
}

/**
 * O(1) geography queries over the grids built by the worker. Grids use cell-center sampling:
 * texel (0,0) of every texture is the north-west corner cell, u grows east (+X), v grows south (+Z),
 * uv = ((x − minX) / 48 km, (z − minZ) / 48 km).
 */
export class GeoQueryImpl implements GeoQuery {
  readonly bounds: WorldBounds = WORLD_BOUNDS;
  readonly landmarks: readonly LandmarkDef[];
  readonly roads: readonly RoadDef[];
  readonly districts: readonly District[];
  readonly coastlines: readonly Vec2Like[][];
  readonly smallMosqueSites: MosqueSites;
  readonly heightGrid: GridData<Float32Array>;
  readonly landUseGrid: GridData<Uint8Array>;
  /** Signed coast distance grid (same layout as heightGrid). */
  readonly coastGrid: GridData<Float32Array>;
  /** Building density 0..255 (1024²). */
  readonly densityGrid: GridData<Uint8Array>;
  readonly buildTimings: Record<string, number>;

  private readonly height: Float32Array;
  private readonly coast: Float32Array;
  private readonly landUse: Uint8Array;
  private readonly density: Uint8Array;
  private readonly district: Uint8Array;
  private readonly byId = new Map<string, LandmarkDef>();
  private readonly waterNames = new WaterNames();
  private heightTex: THREE.DataTexture | null = null;
  private landUseTex: THREE.DataTexture | null = null;
  private coastTex: THREE.DataTexture | null = null;

  constructor(parts: GeoQueryParts) {
    const { out } = parts;
    this.height = out.height;
    this.coast = out.coast;
    this.landUse = out.landUse;
    this.density = out.density;
    this.district = out.district;
    this.buildTimings = out.timings;
    this.landmarks = parts.landmarks;
    this.roads = parts.roads;
    this.districts = parts.districts;
    this.coastlines = parts.coastlines;
    this.smallMosqueSites = parts.mosqueSites;
    for (const l of parts.landmarks) {
      this.byId.set(l.id, l);
    }
    this.heightGrid = gridData(out.height, HEIGHT_GRID);
    this.coastGrid = gridData(out.coast, HEIGHT_GRID);
    this.landUseGrid = gridData(out.landUse, LANDUSE_GRID);
    this.densityGrid = gridData(out.density, DENSITY_GRID);
  }

  heightAt(x: number, z: number): number {
    return sampleBilinear(this.height, HEIGHT_GRID, x, z);
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = HEIGHT_GRID.cell * 0.5;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hn = this.heightAt(x, z - e);
    const hs = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hn - hs).normalize();
  }

  isWater(x: number, z: number): boolean {
    return this.heightAt(x, z) < 0;
  }

  waterNameAt(x: number, z: number): string | null {
    return this.isWater(x, z) ? this.waterNames.nameAt(x, z) : null;
  }

  coastDistance(x: number, z: number): number {
    return sampleBilinear(this.coast, HEIGHT_GRID, x, z);
  }

  landUseAt(x: number, z: number): LandUse {
    const g = LANDUSE_GRID;
    let c = Math.floor((x - g.origin) / g.cell + 0.5);
    let r = Math.floor((z - g.origin) / g.cell + 0.5);
    c = c < 0 ? 0 : c >= g.size ? g.size - 1 : c;
    r = r < 0 ? 0 : r >= g.size ? g.size - 1 : r;
    return this.landUse[r * g.size + c] as LandUse;
  }

  densityAt(x: number, z: number): number {
    if (NO_DENSITY[this.landUseAt(x, z)]) {
      return 0;
    }
    const g = DENSITY_GRID;
    const n = g.size;
    let fx = (x - g.origin) / g.cell;
    let fz = (z - g.origin) / g.cell;
    fx = fx < 0 ? 0 : fx > n - 1.0001 ? n - 1.0001 : fx;
    fz = fz < 0 ? 0 : fz > n - 1.0001 ? n - 1.0001 : fz;
    const ix = fx | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const i = iz * n + ix;
    const d = this.density;
    const top = d[i] + (d[i + 1] - d[i]) * tx;
    const bottom = d[i + n] + (d[i + n + 1] - d[i + n]) * tx;
    return (top + (bottom - top) * tz) / 255;
  }

  districtAt(x: number, z: number): District | null {
    if (this.isWater(x, z)) {
      return null;
    }
    const g = DISTRICT_GRID;
    const c = Math.floor((x - g.origin) / g.cell + 0.5);
    const r = Math.floor((z - g.origin) / g.cell + 0.5);
    if (c < 0 || r < 0 || c >= g.size || r >= g.size) {
      return null;
    }
    const i = this.district[r * g.size + c];
    return i === NO_DISTRICT ? null : this.districts[i] ?? null;
  }

  buildableAt(x: number, z: number): boolean {
    return BUILDABLE[this.landUseAt(x, z)] === 1 && this.coastDistance(x, z) > SHORE_SETBACK;
  }

  landmark(id: string): LandmarkDef | undefined {
    return this.byId.get(id);
  }

  getHeightTexture(): THREE.DataTexture {
    if (!this.heightTex) {
      this.heightTex = floatTexture(this.height, HEIGHT_GRID.size, 'geo-height');
    }
    return this.heightTex;
  }

  getLandUseTexture(): THREE.DataTexture {
    if (!this.landUseTex) {
      const t = new THREE.DataTexture(this.landUse, LANDUSE_GRID.size, LANDUSE_GRID.size, THREE.RedFormat, THREE.UnsignedByteType);
      t.name = 'geo-landuse';
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.unpackAlignment = 1;
      t.needsUpdate = true;
      this.landUseTex = t;
    }
    return this.landUseTex;
  }

  getCoastDistanceTexture(): THREE.DataTexture {
    if (!this.coastTex) {
      this.coastTex = floatTexture(this.coast, HEIGHT_GRID.size, 'geo-coast-distance');
    }
    return this.coastTex;
  }

  dispose(): void {
    this.heightTex?.dispose();
    this.landUseTex?.dispose();
    this.coastTex?.dispose();
    this.heightTex = null;
    this.landUseTex = null;
    this.coastTex = null;
  }
}

function floatTexture(data: Float32Array, size: number, name: string): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.FloatType);
  t.name = name;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
