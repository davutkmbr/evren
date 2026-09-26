/** Main-thread side of the worker data flow: the one-off init payload and per-request geography windows. */
import { LandUse, type GeoQuery, type RoadKind, type WorldBounds } from '../../core/contracts';
import { STYLE_BY_NAME, Style, type CityInitMessage, type GeoWindowMsg, type GridSpecMsg } from './protocol';

const WORLD_HALF = 24000;
const ROAD_KIND: Record<RoadKind, number> = { highway: 0, avenue: 1, street: 2, bridge: 3, coastal: 4 };

function specOf(grid: { width: number; cellSize: number; originX: number }): GridSpecMsg {
  return { size: grid.width, cell: grid.cellSize, origin: grid.originX };
}

function coarseSpec(size: number): GridSpecMsg {
  const cell = (WORLD_HALF * 2) / size;
  return { size, cell, origin: -WORLD_HALF + cell / 2 };
}

export function buildInitMessage(geo: GeoQuery, osm: CityInitMessage['osm'] = null): CityInitMessage {
  const districtIndex = new Map(geo.districts.map((d, i) => [d, i]));
  const dSpec = coarseSpec(256);
  const dGrid = new Uint8Array(dSpec.size * dSpec.size);
  for (let r = 0; r < dSpec.size; r++) {
    const z = dSpec.origin + r * dSpec.cell;
    for (let c = 0; c < dSpec.size; c++) {
      const d = geo.districtAt(dSpec.origin + c * dSpec.cell, z);
      dGrid[r * dSpec.size + c] = d ? districtIndex.get(d) ?? 255 : 255;
    }
  }
  const hSpec = coarseSpec(512);
  const hGrid = new Float32Array(hSpec.size * hSpec.size);
  for (let r = 0; r < hSpec.size; r++) {
    const z = hSpec.origin + r * hSpec.cell;
    for (let c = 0; c < hSpec.size; c++) {
      hGrid[r * hSpec.size + c] = geo.heightAt(hSpec.origin + c * hSpec.cell, z);
    }
  }
  return {
    type: 'init',
    landUse: specOf(geo.landUseGrid),
    height: specOf(geo.heightGrid),
    roads: geo.roads.map((r) => {
      const pts = new Float32Array(r.points.length * 2);
      r.points.forEach((p, i) => {
        pts[i * 2] = p.x;
        pts[i * 2 + 1] = p.z;
      });
      return { kind: ROAD_KIND[r.kind] ?? 2, width: r.width, pts };
    }),
    coasts: geo.coastlines.map((ring) => {
      const pts = new Float32Array(ring.length * 2);
      ring.forEach((p, i) => {
        pts[i * 2] = p.x;
        pts[i * 2 + 1] = p.z;
      });
      return pts;
    }),
    districts: geo.districts.map((d) => ({
      x: d.x,
      z: d.z,
      style: STYLE_BY_NAME[d.style] ?? Style.Suburban,
      density: d.density,
      floorsMean: d.floorsMean,
      floorsMax: d.floorsMax,
      side: d.side === 'europe' ? 0 : d.side === 'asia' ? 1 : 2,
    })),
    districtGrid: { data: dGrid, spec: dSpec },
    heightCoarse: { data: hGrid, spec: hSpec },
    osm,
  };
}

/** Reads a float grid from a DataTexture when it matches the height-grid layout (fast path for coast distance). */
function floatTextureData(geo: GeoQuery): Float32Array | null {
  try {
    const tex = geo.getCoastDistanceTexture();
    const data = (tex.image as { data?: unknown; width?: number }).data;
    if (data instanceof Float32Array && data.length === geo.heightGrid.width * geo.heightGrid.height) {
      return data;
    }
  } catch {
    /* fall back to point queries */
  }
  return null;
}

export class GeoWindowCutter {
  private readonly coastData: Float32Array | null;

  /**
   * `exclude`: rectangles where no procedural buildings are generated (land use cut to Landmark), read at every cut:
   * the caller may change the list (OSM regions streaming in and out, world/osm/regions.ts osmActiveExclusion()).
   */
  constructor(
    private readonly geo: GeoQuery,
    private readonly exclude: readonly WorldBounds[] = [],
  ) {
    this.coastData = floatTextureData(geo);
  }

  /** Flat minX, minZ, maxX, maxZ of the exclusion rects touching the rectangle (the far OSM layer's region ownership). */
  excludedIn(x0: number, z0: number, x1: number, z1: number): number[] {
    const out: number[] = [];
    for (const ex of this.exclude) {
      if (ex.minX < x1 && ex.maxX > x0 && ex.minZ < z1 && ex.maxZ > z0) {
        out.push(ex.minX, ex.minZ, ex.maxX, ex.maxZ);
      }
    }
    return out;
  }

  cut(x0: number, z0: number, x1: number, z1: number): GeoWindowMsg {
    const geo = this.geo;
    const lu = geo.landUseGrid;
    const luC0 = clampIdx(Math.floor((x0 - lu.originX) / lu.cellSize) - 1, lu.width);
    const luC1 = clampIdx(Math.ceil((x1 - lu.originX) / lu.cellSize) + 1, lu.width);
    const luR0 = clampIdx(Math.floor((z0 - lu.originZ) / lu.cellSize) - 1, lu.height);
    const luR1 = clampIdx(Math.ceil((z1 - lu.originZ) / lu.cellSize) + 1, lu.height);
    const luW = luC1 - luC0 + 1;
    const luH = luR1 - luR0 + 1;
    const luData = new Uint8Array(luW * luH);
    for (let r = 0; r < luH; r++) {
      const src = (luR0 + r) * lu.width + luC0;
      luData.set(lu.data.subarray(src, src + luW), r * luW);
    }
    for (const ex of this.exclude) {
      for (let r = 0; r < luH; r++) {
        const z = lu.originZ + (luR0 + r) * lu.cellSize;
        if (z < ex.minZ || z > ex.maxZ) {
          continue;
        }
        for (let c = 0; c < luW; c++) {
          const x = lu.originX + (luC0 + c) * lu.cellSize;
          if (x >= ex.minX && x <= ex.maxX) {
            luData[r * luW + c] = LandUse.Landmark;
          }
        }
      }
    }

    const hg = geo.heightGrid;
    const hC0 = clampIdx(Math.floor((x0 - hg.originX) / hg.cellSize) - 1, hg.width);
    const hC1 = clampIdx(Math.ceil((x1 - hg.originX) / hg.cellSize) + 1, hg.width);
    const hR0 = clampIdx(Math.floor((z0 - hg.originZ) / hg.cellSize) - 1, hg.height);
    const hR1 = clampIdx(Math.ceil((z1 - hg.originZ) / hg.cellSize) + 1, hg.height);
    const hW = hC1 - hC0 + 1;
    const hH = hR1 - hR0 + 1;
    const h = new Float32Array(hW * hH);
    const coast = new Float32Array(hW * hH);
    const dens = new Float32Array(hW * hH);
    for (let r = 0; r < hH; r++) {
      const src = (hR0 + r) * hg.width + hC0;
      h.set(hg.data.subarray(src, src + hW), r * hW);
      if (this.coastData) {
        coast.set(this.coastData.subarray(src, src + hW), r * hW);
      }
      const z = hg.originZ + (hR0 + r) * hg.cellSize;
      for (let c = 0; c < hW; c++) {
        const x = hg.originX + (hC0 + c) * hg.cellSize;
        if (!this.coastData) {
          coast[r * hW + c] = geo.coastDistance(x, z);
        }
        dens[r * hW + c] = geo.densityAt(x, z);
      }
    }
    return { luC0, luR0, luW, luH, lu: luData, hC0, hR0, hW, hH, h, coast, dens };
  }
}

function clampIdx(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

export function windowTransfer(w: GeoWindowMsg): Transferable[] {
  return [w.lu.buffer, w.h.buffer, w.coast.buffer, w.dens.buffer];
}

/** Base-cell occupancy mask (1 = some buildable land) from the land-use grid, sampled every ~23 m. */
export function buildOccupancy(geo: GeoQuery, cell: number): Uint8Array {
  const n = Math.round((WORLD_HALF * 2) / cell);
  const mask = new Uint8Array(n * n);
  const lu = geo.landUseGrid;
  const step = 2;
  for (let r = 0; r < lu.height; r += step) {
    const z = lu.originZ + r * lu.cellSize;
    const cj = Math.floor((z + WORLD_HALF) / cell);
    for (let c = 0; c < lu.width; c += step) {
      const u = lu.data[r * lu.width + c];
      if (u === 2 || u === 3 || u === 4 || u === 5 || u === 13) {
        const x = lu.originX + c * lu.cellSize;
        const ci = Math.floor((x + WORLD_HALF) / cell);
        if (ci >= 0 && cj >= 0 && ci < n && cj < n) {
          mask[cj * n + ci] = 1;
        }
      }
    }
  }
  return mask;
}
