import type { GeoQuery, RoadKind, WorldBounds } from '../../core/contracts';
import { WORLD_BOUNDS } from '../../core/geo-coords';
import { paintMapRaster, ROAD_CLASS, type PolylineSet, type RasterInput } from './map-painter';

export type MapImage = ImageBitmap | HTMLCanvasElement;

const ROAD_KIND_CLASS: Partial<Record<RoadKind, number>> = {
  highway: ROAD_CLASS.Highway,
  avenue: ROAD_CLASS.Avenue,
  coastal: ROAD_CLASS.Avenue,
  bridge: ROAD_CLASS.Bridge,
};

function flatten(lines: ReadonlyArray<ReadonlyArray<{ x: number; z: number }>>): PolylineSet {
  let total = 0;
  for (const line of lines) {
    total += line.length;
  }
  const points = new Float32Array(total * 2);
  const offsets = new Uint32Array(lines.length + 1);
  let p = 0;
  lines.forEach((line, i) => {
    offsets[i] = p;
    for (const v of line) {
      points[p * 2] = v.x;
      points[p * 2 + 1] = v.z;
      p++;
    }
  });
  offsets[lines.length] = p;
  return { points, offsets };
}

/** Pre-renders the whole world into one image once (in a worker), shared by the minimap and the full map. */
export class MapRaster {
  readonly bounds: WorldBounds = WORLD_BOUNDS;
  image: MapImage | null = null;
  /** World-space vector paths for crisp overlays on the zoomable map. */
  coastPath: Path2D | null = null;
  highwayPath: Path2D | null = null;
  private building = false;
  private readonly listeners: Array<(image: MapImage) => void> = [];

  get pending(): boolean {
    return this.building;
  }

  onReady(fn: (image: MapImage) => void): void {
    if (this.image) {
      fn(this.image);
    } else {
      this.listeners.push(fn);
    }
  }

  build(geo: GeoQuery, size: number): void {
    if (this.building || this.image) {
      return;
    }
    this.building = true;
    this.buildPaths(geo);
    const roads = geo.roads.filter((r) => ROAD_KIND_CLASS[r.kind] !== undefined);
    const roadSet = flatten(roads.map((r) => r.points));
    const kinds = new Uint8Array(roads.map((r) => ROAD_KIND_CLASS[r.kind] ?? ROAD_CLASS.Avenue));
    const input: RasterInput = {
      size,
      bounds: { ...this.bounds },
      landUse: { ...geo.landUseGrid },
      height: { ...geo.heightGrid },
      coast: flatten(geo.coastlines),
      roads: { ...roadSet, kinds },
    };
    const canUseWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
    if (!canUseWorker) {
      this.paintOnMainThread(input);
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./map-raster.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.paintOnMainThread(input);
      return;
    }
    worker.onmessage = (event: MessageEvent<{ ok: boolean; bitmap?: ImageBitmap; error?: string }>) => {
      worker.terminate();
      if (event.data.ok && event.data.bitmap) {
        this.finish(event.data.bitmap);
      } else {
        console.warn('[ui] map worker failed, painting on the main thread', event.data.error);
        this.paintOnMainThread(input);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      console.warn('[ui] map worker error, painting on the main thread', event.message);
      this.paintOnMainThread(input);
    };
    // Structured clone (no transfer): the grids stay owned by geo and the input stays valid for the fallback.
    worker.postMessage(input);
  }

  private paintOnMainThread(input: RasterInput): void {
    const canvas = document.createElement('canvas');
    canvas.width = input.size;
    canvas.height = input.size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      paintMapRaster(ctx, input);
    }
    this.finish(canvas);
  }

  private finish(image: MapImage): void {
    this.image = image;
    this.building = false;
    for (const fn of this.listeners.splice(0)) {
      fn(image);
    }
  }

  private buildPaths(geo: GeoQuery): void {
    const coast = new Path2D();
    for (const ring of geo.coastlines) {
      ring.forEach((v, i) => (i === 0 ? coast.moveTo(v.x, v.z) : coast.lineTo(v.x, v.z)));
      coast.closePath();
    }
    this.coastPath = coast;
    const highways = new Path2D();
    for (const road of geo.roads) {
      if (road.kind !== 'highway' && road.kind !== 'bridge') {
        continue;
      }
      road.points.forEach((v, i) => (i === 0 ? highways.moveTo(v.x, v.z) : highways.lineTo(v.x, v.z)));
    }
    this.highwayPath = highways;
  }

  dispose(): void {
    if (this.image && 'close' in this.image) {
      this.image.close();
    }
    this.image = null;
  }
}
