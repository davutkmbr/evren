import type { GeoQuery, WorldBounds } from '../../../core/contracts';
import { WORLD_HALF_SIZE } from '../../../core/geo-coords';
import { GeoWindowCutter } from './geo-window';
import { PlacementContext } from './placement';
import type { PlacementInitMessage, TileResultMessage } from './protocol';

export const TileState = { Queued: 0, Loading: 1, Ready: 2 } as const;
export type TileState = (typeof TileState)[keyof typeof TileState];

export interface VegTile {
  readonly key: number;
  readonly x0: number;
  readonly z0: number;
  state: TileState;
  instances: Float32Array;
  count: number;
  minY: number;
  maxY: number;
  /** Nearest horizontal distance (m) from the tile to the camera at the last evaluation. */
  dist: number;
  /** Impostor pool (-1 none, 0 near, 1 far), its chunks and the number of instances written there. */
  pool: number;
  chunks: number[];
  written: number;
  /** Collision ids of the tile's trees (null = not registered). */
  colliders: number[] | null;
  /** True while the tile waits in the impostor write queue. */
  queued: boolean;
}

const EMPTY = new Float32Array(0);
const MAX_IN_FLIGHT_PER_WORKER = 3;

interface WorkerSlot {
  worker: Worker;
  inFlight: number;
}

/**
 * Keeps the set of tiles within the draw radius generated: requests them nearest first from placement workers and
 * drops tiles that fall far behind. Tile keys are stable across quality changes (fixed tile grid).
 */
export class TileStreamer {
  readonly tiles = new Map<number, VegTile>();
  /** Tiles that finished loading since the last `drainLoaded()`. */
  private readonly loaded: VegTile[] = [];
  private readonly queue: VegTile[] = [];
  private readonly slots: WorkerSlot[] = [];
  private readonly cutter: GeoWindowCutter;
  private fallback: PlacementContext | null = null;
  private generation = 0;
  private readonly inFlight = new Map<number, { tile: VegTile; generation: number }>();
  private nextRequestId = 1;
  private lastX = Infinity;
  private lastZ = Infinity;
  private evaluated = false;
  private readonly onRemove: (tile: VegTile) => void;

  constructor(
    private readonly geo: GeoQuery,
    init: PlacementInitMessage,
    readonly tileSize: number,
    onRemove: (tile: VegTile) => void,
    workerCount = 2,
    exclude: readonly WorldBounds[] = [],
  ) {
    this.cutter = new GeoWindowCutter(geo, exclude);
    this.onRemove = onRemove;
    for (let i = 0; i < workerCount; i++) {
      try {
        const worker = new Worker(new URL('./placement.worker.ts', import.meta.url), { type: 'module' });
        const slot: WorkerSlot = { worker, inFlight: 0 };
        worker.onmessage = (e: MessageEvent<TileResultMessage>): void => {
          slot.inFlight--;
          this.accept(e.data);
        };
        worker.onerror = (e): void => {
          console.error('[vegetation] placement worker error', e.message);
        };
        worker.postMessage(init);
        this.slots.push(slot);
      } catch (err) {
        console.warn('[vegetation] placement worker unavailable, placing on the main thread', err);
        break;
      }
    }
    if (this.slots.length === 0) {
      this.fallback = new PlacementContext(init);
    }
  }

  /** Outstanding work (queued + in flight), +1 until the first evaluation happened. */
  pending(): number {
    return this.queue.length + this.inFlight.size + (this.evaluated ? 0 : 1);
  }

  /** Forgets every tile (quality change); `onRemove` runs for each. */
  reset(): void {
    this.generation++;
    for (const t of this.tiles.values()) {
      this.onRemove(t);
    }
    this.tiles.clear();
    this.queue.length = 0;
    this.loaded.length = 0;
    this.lastX = Infinity;
    this.evaluated = false;
  }

  /** Forgets the tiles overlapping `rect` (the exclusion list changed there); the next update requests them again. */
  invalidate(rect: WorldBounds): void {
    const T = this.tileSize;
    for (const [key, t] of this.tiles) {
      if (t.x0 > rect.maxX || t.x0 + T < rect.minX || t.z0 > rect.maxZ || t.z0 + T < rect.minZ) {
        continue;
      }
      this.onRemove(t);
      this.tiles.delete(key);
    }
    this.lastX = Infinity;
  }

  drainLoaded(out: VegTile[]): void {
    out.length = 0;
    for (const t of this.loaded) {
      if (t.state === TileState.Ready && this.tiles.get(t.key) === t) {
        out.push(t);
      }
    }
    this.loaded.length = 0;
  }

  /** Returns true when tile distances were re-evaluated this call. */
  update(camX: number, camZ: number, radius: number, densityScale: number): boolean {
    const moved = Math.hypot(camX - this.lastX, camZ - this.lastZ);
    const evaluate = moved > 40 || !this.evaluated;
    if (evaluate) {
      this.evaluate(camX, camZ, radius);
    }
    this.dispatch(densityScale);
    return evaluate;
  }

  private evaluate(camX: number, camZ: number, radius: number): void {
    this.lastX = camX;
    this.lastZ = camZ;
    this.evaluated = true;
    const T = this.tileSize;
    const keepRadius = radius + 350;
    for (const [key, t] of this.tiles) {
      t.dist = this.tileDistance(t.x0, t.z0, camX, camZ);
      if (t.dist > keepRadius) {
        this.onRemove(t);
        this.tiles.delete(key);
      }
    }
    const limit = WORLD_HALF_SIZE / T;
    const i0 = Math.max(Math.floor((camX - radius) / T), -Math.ceil(limit));
    const i1 = Math.min(Math.floor((camX + radius) / T), Math.ceil(limit) - 1);
    const j0 = Math.max(Math.floor((camZ - radius) / T), -Math.ceil(limit));
    const j1 = Math.min(Math.floor((camZ + radius) / T), Math.ceil(limit) - 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x0 = i * T;
        const z0 = j * T;
        const d = this.tileDistance(x0, z0, camX, camZ);
        if (d > radius) {
          continue;
        }
        const key = (j + 512) * 1024 + (i + 512);
        if (this.tiles.has(key)) {
          continue;
        }
        const tile: VegTile = {
          key,
          x0,
          z0,
          state: TileState.Queued,
          instances: EMPTY,
          count: 0,
          minY: 0,
          maxY: 0,
          dist: d,
          pool: -1,
          chunks: [],
          written: 0,
          colliders: null,
          queued: false,
        };
        this.tiles.set(key, tile);
        if (this.isOpenWater(x0, z0)) {
          tile.state = TileState.Ready;
          continue;
        }
        this.queue.push(tile);
      }
    }
    // Nearest first (popped from the end).
    this.queue.sort((a, b) => b.dist - a.dist);
  }

  private tileDistance(x0: number, z0: number, x: number, z: number): number {
    const T = this.tileSize;
    const dx = Math.max(x0 - x, x - (x0 + T), 0);
    const dz = Math.max(z0 - z, z - (z0 + T), 0);
    return Math.hypot(dx, dz);
  }

  private isOpenWater(x0: number, z0: number): boolean {
    const h = this.tileSize * 0.5;
    const c = this.geo.coastDistance(x0 + h, z0 + h);
    return c < -(h * Math.SQRT2 + 30);
  }

  private dispatch(densityScale: number): void {
    if (this.fallback) {
      const tile = this.popQueued();
      if (tile) {
        const req = this.cutter.request(0, tile.x0, tile.z0, this.tileSize, densityScale);
        this.apply(tile, this.fallback.placeTile(req));
      }
      return;
    }
    for (const slot of this.slots) {
      while (slot.inFlight < MAX_IN_FLIGHT_PER_WORKER) {
        const tile = this.popQueued();
        if (!tile) {
          return;
        }
        const id = this.nextRequestId++;
        const req = this.cutter.request(id, tile.x0, tile.z0, this.tileSize, densityScale);
        tile.state = TileState.Loading;
        this.inFlight.set(id, { tile, generation: this.generation });
        slot.inFlight++;
        slot.worker.postMessage(req, [req.landUse.data.buffer, req.height.data.buffer, req.coast.data.buffer, req.density.data.buffer]);
      }
    }
  }

  private popQueued(): VegTile | null {
    while (this.queue.length > 0) {
      const t = this.queue.pop()!;
      if (this.tiles.get(t.key) === t && t.state === TileState.Queued) {
        return t;
      }
    }
    return null;
  }

  private accept(msg: TileResultMessage): void {
    const job = this.inFlight.get(msg.id);
    if (!job) {
      return;
    }
    this.inFlight.delete(msg.id);
    if (job.generation !== this.generation || this.tiles.get(job.tile.key) !== job.tile) {
      return;
    }
    this.apply(job.tile, msg);
  }

  private apply(tile: VegTile, msg: TileResultMessage): void {
    tile.instances = msg.instances;
    tile.count = msg.count;
    tile.minY = msg.minY;
    tile.maxY = msg.maxY;
    tile.state = TileState.Ready;
    this.loaded.push(tile);
  }

  dispose(): void {
    for (const s of this.slots) {
      s.worker.terminate();
    }
    this.slots.length = 0;
    this.tiles.clear();
    this.queue.length = 0;
    this.inFlight.clear();
  }
}
