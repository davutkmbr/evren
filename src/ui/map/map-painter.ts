/**
 * Rasterises the geography into a dark cartographic base map (land use palette, bathymetry, hillshade, roads,
 * coastline). Runs inside the map worker (OffscreenCanvas) or, as a fallback, on the main thread.
 */
import { LandUse, type WorldBounds } from '../../core/contracts';

export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface RasterGrid<T extends Uint8Array | Float32Array> {
  data: T;
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originZ: number;
}

export interface PolylineSet {
  /** Flattened x, z pairs. */
  points: Float32Array;
  /** Start index (in pairs) of every line, plus a final entry = total pairs. */
  offsets: Uint32Array;
}

export interface RasterInput {
  size: number;
  bounds: WorldBounds;
  landUse: RasterGrid<Uint8Array>;
  height: RasterGrid<Float32Array>;
  coast: PolylineSet;
  roads: PolylineSet & { kinds: Uint8Array };
}

/** Road classes passed to the painter. */
export const ROAD_CLASS = { Highway: 0, Avenue: 1, Bridge: 2 } as const;

const LAND_RGB: Record<number, [number, number, number]> = {
  [LandUse.Beach]: [70, 64, 50],
  [LandUse.Urban]: [46, 46, 49],
  [LandUse.HistoricUrban]: [56, 50, 43],
  [LandUse.Highrise]: [50, 48, 58],
  [LandUse.Industrial]: [45, 44, 42],
  [LandUse.Park]: [36, 51, 40],
  [LandUse.Forest]: [30, 46, 35],
  [LandUse.Farmland]: [47, 48, 38],
  [LandUse.Airport]: [51, 52, 56],
  [LandUse.Cemetery]: [35, 48, 38],
  [LandUse.Landmark]: [72, 60, 44],
  [LandUse.Road]: [60, 59, 60],
  [LandUse.Suburban]: [42, 43, 44],
};
const DEFAULT_LAND: [number, number, number] = [44, 44, 46];
const WATER_SHALLOW: [number, number, number] = [27, 53, 70];
const WATER_DEEP: [number, number, number] = [11, 24, 35];

/** Lambert shade of the height grid lit from the north-west (cartographic convention), 0..1. */
function hillshade(grid: RasterGrid<Float32Array>): Float32Array {
  const { data, width, height, cellSize } = grid;
  const out = new Float32Array(width * height);
  const az = (315 * Math.PI) / 180;
  const alt = (42 * Math.PI) / 180;
  const lx = Math.sin(az) * Math.cos(alt);
  const lz = -Math.cos(az) * Math.cos(alt);
  const ly = Math.sin(alt);
  const exaggeration = 2.2;
  for (let row = 0; row < height; row++) {
    const r0 = Math.max(0, row - 1) * width;
    const r1 = Math.min(height - 1, row + 1) * width;
    const rc = row * width;
    for (let col = 0; col < width; col++) {
      const c0 = Math.max(0, col - 1);
      const c1 = Math.min(width - 1, col + 1);
      const hl = Math.max(0, data[rc + c0]);
      const hr = Math.max(0, data[rc + c1]);
      const hu = Math.max(0, data[r0 + col]);
      const hd = Math.max(0, data[r1 + col]);
      const dx = ((hr - hl) * exaggeration) / (2 * cellSize);
      const dz = ((hd - hu) * exaggeration) / (2 * cellSize);
      const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1);
      const shade = (-dx * lx - dz * lz + ly) * inv;
      out[rc + col] = shade < 0 ? 0 : shade;
    }
  }
  return out;
}

function sampleBilinear(values: Float32Array, grid: RasterGrid<Float32Array>, x: number, z: number): number {
  const gx = (x - grid.originX) / grid.cellSize;
  const gz = (z - grid.originZ) / grid.cellSize;
  const w = grid.width;
  const h = grid.height;
  const cx = gx < 0 ? 0 : gx > w - 1.001 ? w - 1.001 : gx;
  const cz = gz < 0 ? 0 : gz > h - 1.001 ? h - 1.001 : gz;
  const ix = cx | 0;
  const iz = cz | 0;
  const fx = cx - ix;
  const fz = cz - iz;
  const i = iz * w + ix;
  const a = values[i] + (values[i + 1] - values[i]) * fx;
  const b = values[i + w] + (values[i + w + 1] - values[i + w]) * fx;
  return a + (b - a) * fz;
}

function strokeLines(ctx: Ctx2D, set: PolylineSet, toPx: (v: number, axis: 0 | 1) => number, filter?: (index: number) => boolean): void {
  const { points, offsets } = set;
  ctx.beginPath();
  for (let line = 0; line < offsets.length - 1; line++) {
    if (filter && !filter(line)) {
      continue;
    }
    const start = offsets[line];
    const end = offsets[line + 1];
    for (let p = start; p < end; p++) {
      const x = toPx(points[p * 2], 0);
      const y = toPx(points[p * 2 + 1], 1);
      if (p === start) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
  }
  ctx.stroke();
}

export function paintMapRaster(ctx: Ctx2D, input: RasterInput): void {
  const { size, bounds, landUse, height } = input;
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const shade = hillshade(height);
  const flatShade = Math.sin((42 * Math.PI) / 180);
  const image = ctx.createImageData(size, size);
  const px = image.data;
  let seed = 1337;
  for (let row = 0; row < size; row++) {
    const z = bounds.minZ + ((row + 0.5) / size) * spanZ;
    const lr = Math.min(landUse.height - 1, Math.max(0, Math.round((z - landUse.originZ) / landUse.cellSize)));
    for (let col = 0; col < size; col++) {
      const x = bounds.minX + ((col + 0.5) / size) * spanX;
      const lc = Math.min(landUse.width - 1, Math.max(0, Math.round((x - landUse.originX) / landUse.cellSize)));
      const use = landUse.data[lr * landUse.width + lc];
      const h = sampleBilinear(height.data, height, x, z);
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const grain = ((seed >>> 24) / 255 - 0.5) * 3.2;
      let r: number;
      let g: number;
      let b: number;
      if (use === LandUse.Water) {
        const depth = Math.min(1, Math.max(0, -h / 55));
        const t = Math.sqrt(depth);
        r = WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * t;
        g = WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * t;
        b = WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * t;
        const sparkle = grain * 0.5;
        r += sparkle;
        g += sparkle;
        b += sparkle;
      } else {
        const base = LAND_RGB[use] ?? DEFAULT_LAND;
        const s = sampleBilinear(shade, height, x, z);
        const relief = Math.min(1.38, Math.max(0.52, 1 + (s - flatShade) * 1.35));
        const lift = 1 + Math.min(0.14, Math.max(0, h) / 2600);
        const k = relief * lift;
        r = base[0] * k + grain;
        g = base[1] * k + grain;
        b = base[2] * k + grain;
      }
      const o = (row * size + col) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const toPx = (v: number, axis: 0 | 1): number => (axis === 0 ? ((v - bounds.minX) / spanX) * size : ((v - bounds.minZ) / spanZ) * size);
  const metersPerPx = spanX / size;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.strokeStyle = 'rgba(255, 244, 228, 0.075)';
  ctx.lineWidth = Math.max(0.8, 12 / metersPerPx);
  strokeLines(ctx, input.roads, toPx, (i) => input.roads.kinds[i] === ROAD_CLASS.Avenue);

  ctx.strokeStyle = 'rgba(240, 196, 138, 0.26)';
  ctx.lineWidth = Math.max(1.2, 26 / metersPerPx);
  strokeLines(ctx, input.roads, toPx, (i) => input.roads.kinds[i] === ROAD_CLASS.Highway);

  ctx.strokeStyle = 'rgba(246, 206, 150, 0.55)';
  ctx.lineWidth = Math.max(1.4, 30 / metersPerPx);
  strokeLines(ctx, input.roads, toPx, (i) => input.roads.kinds[i] === ROAD_CLASS.Bridge);

  ctx.strokeStyle = 'rgba(150, 190, 214, 0.34)';
  ctx.lineWidth = Math.max(1, 14 / metersPerPx);
  strokeLines(ctx, input.coast, toPx);
}
