/** Registers building boxes of the tiles around the player in the shared collision world (budgeted per frame). */
import * as THREE from 'three';
import type { CollisionWorld } from '../../core/collision';
import { COLLIDER_STRIDE, LEVEL_SIZES } from './protocol';

const TILE = LEVEL_SIZES[0];
const WORLD_HALF = 24000;
const TILES = (WORLD_HALF * 2) / TILE;

interface ColliderTile {
  key: number;
  ix: number;
  iz: number;
  state: 'queued' | 'loading' | 'adding' | 'done' | 'discard';
  boxes: Float32Array | null;
  cursor: number;
  ids: number[];
}

export interface ColliderRequester {
  (ix: number, iz: number, done: (boxes: Float32Array) => void): boolean;
}

export class CityColliders {
  private readonly tiles = new Map<number, ColliderTile>();
  private readonly removals: number[][] = [];
  private readonly scratchCenter = new THREE.Vector3();
  private radius = 2800;

  constructor(
    private readonly world: CollisionWorld,
    private readonly occupied: (ix: number, iz: number) => boolean,
  ) {}

  setRadius(r: number): void {
    this.radius = r;
  }

  /** Updates the wanted tile set around `center`; issues at most `maxRequests` new requests through `request`. */
  update(center: THREE.Vector3, request: ColliderRequester, budgetMs: number): void {
    const r = this.radius;
    const i0 = Math.max(0, Math.floor((center.x - r + WORLD_HALF) / TILE));
    const i1 = Math.min(TILES - 1, Math.floor((center.x + r + WORLD_HALF) / TILE));
    const j0 = Math.max(0, Math.floor((center.z - r + WORLD_HALF) / TILE));
    const j1 = Math.min(TILES - 1, Math.floor((center.z + r + WORLD_HALF) / TILE));
    const want = new Set<number>();
    const candidates: [number, number, number][] = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = -WORLD_HALF + (i + 0.5) * TILE;
        const cz = -WORLD_HALF + (j + 0.5) * TILE;
        const d = Math.hypot(cx - center.x, cz - center.z) - TILE * 0.7;
        if (d > r || !this.occupied(i, j)) {
          continue;
        }
        const key = j * TILES + i;
        want.add(key);
        if (!this.tiles.has(key)) {
          candidates.push([d, i, j]);
        }
      }
    }
    candidates.sort((a, b) => a[0] - b[0]);
    for (const [, i, j] of candidates) {
      const key = j * TILES + i;
      const tile: ColliderTile = { key, ix: i, iz: j, state: 'queued', boxes: null, cursor: 0, ids: [] };
      const ok = request(i, j, (boxes) => {
        if (tile.state === 'discard') {
          return;
        }
        tile.boxes = boxes;
        tile.state = 'adding';
      });
      if (!ok) {
        break;
      }
      tile.state = 'loading';
      this.tiles.set(key, tile);
    }
    // Drop tiles well outside the radius.
    for (const [key, tile] of this.tiles) {
      if (want.has(key)) {
        continue;
      }
      const cx = -WORLD_HALF + (tile.ix + 0.5) * TILE;
      const cz = -WORLD_HALF + (tile.iz + 0.5) * TILE;
      if (Math.hypot(cx - center.x, cz - center.z) - TILE * 0.7 < r * 1.2) {
        continue;
      }
      if (tile.ids.length) {
        this.removals.push(tile.ids);
      }
      tile.state = 'discard';
      this.tiles.delete(key);
    }
    this.pump(budgetMs);
  }

  private pump(budgetMs: number): void {
    const t0 = performance.now();
    while (this.removals.length && performance.now() - t0 < budgetMs * 0.5) {
      this.world.removeMany(this.removals.pop()!);
    }
    for (const tile of this.tiles.values()) {
      if (tile.state !== 'adding' || !tile.boxes) {
        continue;
      }
      const b = tile.boxes;
      while (tile.cursor < b.length) {
        const k = tile.cursor;
        this.scratchCenter.set(b[k], b[k + 1], b[k + 2]);
        tile.ids.push(
          this.world.add(
            {
              kind: 'box',
              center: new THREE.Vector3(b[k], b[k + 1], b[k + 2]),
              halfSize: new THREE.Vector3(b[k + 3], b[k + 4], b[k + 5]),
              yaw: b[k + 6],
            },
            'building',
          ),
        );
        tile.cursor += COLLIDER_STRIDE;
        if ((tile.cursor / COLLIDER_STRIDE) % 64 === 0 && performance.now() - t0 > budgetMs) {
          return;
        }
      }
      tile.state = 'done';
      tile.boxes = null;
      if (performance.now() - t0 > budgetMs) {
        return;
      }
    }
  }

  /** Tiles still loading or being registered. */
  pending(): number {
    let n = 0;
    for (const t of this.tiles.values()) {
      if (t.state !== 'done') {
        n++;
      }
    }
    return n;
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  clear(): void {
    for (const t of this.tiles.values()) {
      if (t.ids.length) {
        this.world.removeMany(t.ids);
      }
      t.state = 'discard';
    }
    for (const ids of this.removals) {
      this.world.removeMany(ids);
    }
    this.removals.length = 0;
    this.tiles.clear();
  }
}
