/** Main-thread side of the placement data flow: the one-off init payload and per-tile geo windows. */
import { LandUse, type GeoQuery, type GridData, type RoadKind, type WorldBounds } from '../../../core/contracts';
import { OSM_OWNS_PARK_TREES } from '../../osm/area';
import type { SpeciesInfo } from '../assets';
import type { GridWindow, MosqueRingSite, PlacementInitMessage, TileRequestMessage } from './protocol';

const ROAD_KIND: Record<RoadKind, number> = { highway: 0, avenue: 1, street: 2, bridge: 3, coastal: 4 };

export function buildPlacementInit(geo: GeoQuery, species: SpeciesInfo[], crownRadius: number[]): PlacementInitMessage {
  const mosques: MosqueRingSite[] = [];
  for (const l of geo.landmarks) {
    if (l.kind === 'mosque') {
      mosques.push({ x: l.x, z: l.z, radius: l.radius, size: 1 });
    }
  }
  for (const m of geo.smallMosqueSites) {
    mosques.push({ x: m.x, z: m.z, radius: m.radius, size: m.size * 0.5 });
  }
  return {
    type: 'init',
    mosques,
    roads: geo.roads.map((r) => {
      const pts = new Float32Array(r.points.length * 2);
      r.points.forEach((p, i) => {
        pts[i * 2] = p.x;
        pts[i * 2 + 1] = p.z;
      });
      return { kind: ROAD_KIND[r.kind] ?? 2, width: r.width, pts };
    }),
    crownRadius,
    height: species.map((s) => s.height),
  };
}

/** Copies the cells of `grid` covering [x0 - m, x1 + m] × [z0 - m, z1 + m]. */
function cutWindow<T extends Float32Array | Uint8Array>(grid: GridData<T>, data: T, x0: number, z0: number, x1: number, z1: number, margin: number): GridWindow<T> {
  const cell = grid.cellSize;
  const c0 = Math.max(0, Math.floor((x0 - margin - grid.originX) / cell));
  const c1 = Math.min(grid.width - 1, Math.ceil((x1 + margin - grid.originX) / cell));
  const r0 = Math.max(0, Math.floor((z0 - margin - grid.originZ) / cell));
  const r1 = Math.min(grid.height - 1, Math.ceil((z1 + margin - grid.originZ) / cell));
  const w = Math.max(2, c1 - c0 + 1);
  const h = Math.max(2, r1 - r0 + 1);
  const Ctor = data.constructor as { new (n: number): T };
  const out = new Ctor(w * h);
  for (let r = 0; r < h; r++) {
    const src = Math.min(r0 + r, grid.height - 1) * grid.width;
    for (let c = 0; c < w; c++) {
      out[r * w + c] = data[src + Math.min(c0 + c, grid.width - 1)];
    }
  }
  return { data: out, w, h, x0: grid.originX + c0 * cell, z0: grid.originZ + r0 * cell, cell };
}

/** Samples geo per tile. The coast distance grid is read straight from its texture when it has the height layout. */
export class GeoWindowCutter {
  private readonly coastData: Float32Array | null;

  /**
   * `exclude`: rectangles (the drawn OSM regions, read at every request) kept free of procedural urban/street trees
   * (land use cut to Industrial, which plants nothing); parks, forests and cemeteries keep theirs unless
   * OSM_OWNS_PARK_TREES.
   */
  constructor(
    private readonly geo: GeoQuery,
    private readonly exclude: readonly WorldBounds[] = [],
  ) {
    let coast: Float32Array | null = null;
    try {
      const tex = geo.getCoastDistanceTexture();
      const data = (tex.image as { data?: unknown }).data;
      if (data instanceof Float32Array && data.length === geo.heightGrid.width * geo.heightGrid.height) {
        coast = data;
      }
    } catch {
      coast = null;
    }
    this.coastData = coast;
  }

  request(id: number, x0: number, z0: number, size: number, densityScale: number): TileRequestMessage {
    const geo = this.geo;
    const x1 = x0 + size;
    const z1 = z0 + size;
    const landUse = cutWindow(geo.landUseGrid, geo.landUseGrid.data, x0, z0, x1, z1, 30);
    for (const ex of this.exclude) {
      for (let r = 0; r < landUse.h; r++) {
        const z = landUse.z0 + r * landUse.cell;
        for (let c = 0; c < landUse.w && z >= ex.minZ && z <= ex.maxZ; c++) {
          const x = landUse.x0 + c * landUse.cell;
          const k = r * landUse.w + c;
          const use = landUse.data[k];
          const green = use === LandUse.Park || use === LandUse.Forest || use === LandUse.Cemetery;
          if (x >= ex.minX && x <= ex.maxX && (OSM_OWNS_PARK_TREES || !green)) {
            landUse.data[k] = LandUse.Industrial;
          }
        }
      }
    }
    const height = cutWindow(geo.heightGrid, geo.heightGrid.data, x0, z0, x1, z1, 30);
    let coast: GridWindow<Float32Array>;
    if (this.coastData) {
      coast = cutWindow(geo.heightGrid, this.coastData, x0, z0, x1, z1, 30);
    } else {
      coast = { ...height, data: new Float32Array(height.w * height.h) };
      for (let r = 0; r < coast.h; r++) {
        for (let c = 0; c < coast.w; c++) {
          coast.data[r * coast.w + c] = geo.coastDistance(coast.x0 + c * coast.cell, coast.z0 + r * coast.cell);
        }
      }
    }
    const step = 32;
    const n = Math.ceil((size + 64) / step) + 1;
    const density: GridWindow<Float32Array> = { data: new Float32Array(n * n), w: n, h: n, x0: x0 - 32, z0: z0 - 32, cell: step };
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        density.data[r * n + c] = geo.densityAt(density.x0 + c * step, density.z0 + r * step);
      }
    }
    return { type: 'tile', id, x0, z0, size, densityScale, landUse, height, coast, density };
  }
}
