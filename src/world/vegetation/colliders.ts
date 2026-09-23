import * as THREE from 'three';
import type { CollisionWorld } from '../../core/collision';
import { INSTANCE_STRIDE, SPECIES_SHAPES } from './species';
import type { VegTile } from './stream/tile-streamer';

/** Trunk colliders (m) of the tiles near the camera; crowns stay soft so the dragon brushes through foliage. */
const ADD_RADIUS = 420;
const REMOVE_RADIUS = 560;
/** Collision world operations per frame (keeps registration of a forest tile from spiking a frame). */
const OPS_PER_FRAME = 300;

interface Job {
  tile: VegTile;
  next: number;
}

export class TreeColliders {
  private readonly adding: Job[] = [];
  private readonly removing: number[][] = [];
  private readonly active = new Set<VegTile>();

  constructor(private readonly collision: CollisionWorld) {}

  get pendingOps(): number {
    let n = 0;
    for (const j of this.adding) {
      n += j.tile.count - j.next;
    }
    for (const r of this.removing) {
      n += r.length;
    }
    return n;
  }

  /** Called when a tile is dropped by the streamer. */
  release(tile: VegTile): void {
    if (tile.colliders) {
      this.removing.push(tile.colliders);
      tile.colliders = null;
    }
    this.active.delete(tile);
    const i = this.adding.findIndex((j) => j.tile === tile);
    if (i >= 0) {
      this.adding.splice(i, 1);
    }
  }

  /** `tiles` is scanned only when given (after the streamer re-evaluated distances); queued work runs every call. */
  update(tiles: Iterable<VegTile> | null): void {
    for (const t of tiles ?? []) {
      if (t.count === 0) {
        continue;
      }
      if (!this.active.has(t) && t.dist < ADD_RADIUS && t.instances.length > 0) {
        this.active.add(t);
        t.colliders = [];
        this.adding.push({ tile: t, next: 0 });
      } else if (this.active.has(t) && t.dist > REMOVE_RADIUS) {
        this.release(t);
      }
    }
    let budget = OPS_PER_FRAME;
    while (budget > 0 && this.removing.length > 0) {
      const ids = this.removing[this.removing.length - 1];
      while (budget > 0 && ids.length > 0) {
        this.collision.remove(ids.pop()!);
        budget--;
      }
      if (ids.length === 0) {
        this.removing.pop();
      }
    }
    while (budget > 0 && this.adding.length > 0) {
      const job = this.adding[this.adding.length - 1];
      const t = job.tile;
      const a = t.instances;
      while (budget > 0 && job.next < t.count) {
        const o = job.next * INSTANCE_STRIDE;
        const shape = SPECIES_SHAPES[a[o + 5] % 8 | 0];
        const scale = a[o + 4];
        const id = this.collision.add(
          {
            kind: 'cylinder',
            base: new THREE.Vector3(a[o], a[o + 1], a[o + 2]),
            radius: Math.max(0.3, shape.trunkRadius * scale * 1.6),
            height: Math.max(2, Math.min(shape.crownBase + 1.5, shape.height * 0.6) * scale),
          },
          'tree',
        );
        t.colliders!.push(id);
        job.next++;
        budget--;
      }
      if (job.next >= t.count) {
        this.adding.pop();
      }
    }
  }

  dispose(): void {
    for (const t of this.active) {
      if (t.colliders) {
        this.collision.removeMany(t.colliders);
        t.colliders = null;
      }
    }
    for (const ids of this.removing) {
      this.collision.removeMany(ids);
    }
    this.removing.length = 0;
    this.adding.length = 0;
    this.active.clear();
  }
}
