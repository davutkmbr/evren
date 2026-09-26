/**
 * City walls in the game: streams the baked wall tiles (npm run compile:walls, data/baked.ts) by distance with the
 * kit's three LODs, so the ~20 km of walls read from the air everywhere and hold up at eye level.
 * - LOD 2 (silhouettes) of every tile is one BatchedMesh, loaded at start (one draw call).
 * - LOD 1 is one BatchedMesh too, filled cell by cell (CELL_TILES^2 tiles per file) as the camera approaches.
 * - LOD 0 tiles are plain meshes (wall + foliage cards) streamed within NEAR m and dropped again far away.
 * Each tile shows exactly one LOD (per-instance visibility in the batches), falling back to a coarser one while the
 * finer one loads. The walls stay visible where compiled street tiles are live: the street layer's hole mask only
 * cuts the flight-scale ground and buildings, and the street compiler leaves the wall-owned buildings out
 * (tools/world-compiler/src/osm-street.ts). Colliders: box colliders from the bake, tag 'heritage', sources
 * "city-wall:<osm id>". Foliage casts no shadows. `?walls=0` turns the system off.
 */
import * as THREE from 'three';
import type { CollisionWorld } from '../../../../core/collision';
import { UpdateOrder, type EngineContext, type System } from '../../../../core/contracts';
import type { QualityPreset } from '../../../../core/quality';
import { fetchBytes, fetchJson } from '../../../../street/format';
import { decodeMeshes, type DecodedMesh, type WallsColliders, type WallsIndex, type WallsTile } from '../data/baked';
import { createWallsMaterial, type WallsMaterial } from '../render/material';
import { wallsIndex, WALLS_BASE } from './owned';

/** LOD distances (m, camera to the tile's box) at "high". */
const NEAR = 260;
const FAR = 1000;
const HYSTERESIS = 0.06;
const SCALE: Record<QualityPreset, number> = { low: 0.6, medium: 0.8, high: 1, ultra: 1.3 };
/** LOD 0 tiles farther than DROP x NEAR are dropped; at most CACHE of them stay loaded. */
const DROP = 2.2;
const CACHE = 36;
/** Concurrent LOD 0 downloads. */
const PARALLEL = 3;
/** LOD 1 cells load while a tile of theirs is within PREFETCH x FAR. */
const PREFETCH = 1.25;

interface TileState {
  def: WallsTile;
  box: THREE.Box3;
  cell: string;
  level: number;
  l0: { state: 'none' | 'loading' | 'ready' | 'failed'; group: THREE.Group | null; used: number };
  b1: number;
  b2: number;
  dist: number;
}

function toGeometry(d: DecodedMesh, dx = 0, dz = 0): THREE.BufferGeometry {
  let pos = d.positions;
  if (dx !== 0 || dz !== 0) {
    pos = new Float32Array(d.positions);
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] += dx;
      pos[i + 2] += dz;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
  g.setAttribute('aHCol', new THREE.BufferAttribute(d.colors, 4, true));
  g.setAttribute('aHSurf', new THREE.BufferAttribute(d.surf, 4, false));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

class WallsSystem implements System {
  readonly name = 'walls';
  readonly order = UpdateOrder.World;
  private readonly root = new THREE.Group();
  private ctx: EngineContext | null = null;
  private mat: WallsMaterial | null = null;
  private index: WallsIndex | null = null;
  private tiles: TileState[] = [];
  private readonly byKey = new Map<string, TileState>();
  private readonly cells = new Map<string, 'loading' | 'ready' | 'failed'>();
  private batch1: THREE.BatchedMesh | null = null;
  private batch2: THREE.BatchedMesh | null = null;
  private origin = new THREE.Vector3();
  private starting = 1;
  private loading = 0;
  private collision: CollisionWorld | null = null;
  private colliderIds: number[] = [];
  private disposed = false;
  private frame = 0;

  init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.root.name = 'city-walls';
    if (ctx.debug.params.get('walls') === '0') {
      this.starting = 0;
      return;
    }
    ctx.scene.add(this.root);
    this.collision = ctx.services.tryGet('collision') ?? null;
    void this.start(ctx).catch((e: unknown) => {
      console.error('[walls] failed to start', e);
      this.starting = 0;
    });
  }

  private async start(ctx: EngineContext): Promise<void> {
    const index = await wallsIndex();
    if (!index || this.disposed) {
      this.starting = 0;
      return;
    }
    this.index = index;
    const mat = createWallsMaterial(ctx.renderer);
    this.mat = mat;
    const T = index.tileSize;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const def of index.tiles) {
      const [x0, y0, z0, x1, y1, z1] = def.box;
      const box = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
      const cell = `${Math.floor(def.i / index.cellTiles)}_${Math.floor(def.j / index.cellTiles)}`;
      const t: TileState = { def, box, cell, level: -1, l0: { state: def.lod0 ? 'none' : 'failed', group: null, used: 0 }, b1: -1, b2: -1, dist: Infinity };
      this.tiles.push(t);
      this.byKey.set(`${def.i}_${def.j}`, t);
      minX = Math.min(minX, def.i * T);
      minZ = Math.min(minZ, def.j * T);
      maxX = Math.max(maxX, (def.i + 1) * T);
      maxZ = Math.max(maxZ, (def.j + 1) * T);
    }
    // Batches share one origin near the walls' centre (float precision of the batched positions).
    this.origin.set(Math.round((minX + maxX) / 2 / T) * T, 0, Math.round((minZ + maxZ) / 2 / T) * T);
    const totals1 = index.lod1.reduce((a, c) => ({ v: a.v + c.vertices, i: a.i + c.indices }), { v: 0, i: 0 });
    // One instance per tile (coarse LODs keep their few foliage cards inline).
    this.batch1 = this.makeBatch('walls-lod1', index.tiles.length, totals1.v, totals1.i, mat.material, true);
    this.batch2 = this.makeBatch('walls-lod2', index.tiles.length, index.lod2.vertices, index.lod2.indices, mat.material, false);
    const [lod2, colliders] = await Promise.all([fetchBytes(`${WALLS_BASE}${index.lod2.file}`), fetchJson<WallsColliders>(`${WALLS_BASE}${index.colliders}`).catch(() => null), mat.ready]);
    if (this.disposed) {
      return;
    }
    for (const m of decodeMeshes(lod2)) {
      const t = this.byKey.get(`${m.record.tile[0]}_${m.record.tile[1]}`);
      if (t) {
        t.b2 = this.addToBatch(this.batch2, m);
      }
    }
    if (colliders) {
      this.addColliders(colliders);
    }
    this.starting = 0;
    (window as unknown as { __walls: unknown }).__walls = { stats: () => this.stats(), system: this };
  }

  private makeBatch(name: string, instances: number, vertices: number, indices: number, material: THREE.Material, shadows: boolean): THREE.BatchedMesh {
    const b = new THREE.BatchedMesh(Math.max(1, instances), Math.max(3, vertices), Math.max(3, indices), material);
    b.name = name;
    b.position.copy(this.origin);
    b.castShadow = shadows;
    b.receiveShadow = true;
    b.sortObjects = false;
    b.frustumCulled = false;
    this.root.add(b);
    return b;
  }

  /** Adds one tile mesh to a batch (hidden); returns the instance id. */
  private addToBatch(batch: THREE.BatchedMesh, m: DecodedMesh): number {
    const T = this.index!.tileSize;
    const g = toGeometry(m, m.record.tile[0] * T - this.origin.x, m.record.tile[1] * T - this.origin.z);
    const id = batch.addInstance(batch.addGeometry(g));
    batch.setVisibleAt(id, false);
    g.dispose();
    return id;
  }

  private addColliders(c: WallsColliders): void {
    const col = this.collision;
    if (!col) {
      return;
    }
    const b = c.boxes;
    for (let k = 0; k + 7 < b.length; k += 8) {
      this.colliderIds.push(col.add({ kind: 'box', center: new THREE.Vector3(b[k], b[k + 1], b[k + 2]), halfSize: new THREE.Vector3(b[k + 3], b[k + 4], b[k + 5]), yaw: b[k + 6] }, 'heritage', c.sources[b[k + 7]]));
    }
  }

  private loadCell(key: string): void {
    const entry = this.index!.lod1.find((c) => `${c.cell[0]}_${c.cell[1]}` === key);
    if (!entry) {
      this.cells.set(key, 'failed');
      return;
    }
    this.cells.set(key, 'loading');
    void fetchBytes(`${WALLS_BASE}${entry.file}`)
      .then((buf) => {
        if (this.disposed) {
          return;
        }
        for (const m of decodeMeshes(buf)) {
          const t = this.byKey.get(`${m.record.tile[0]}_${m.record.tile[1]}`);
          if (t && t.b1 < 0) {
            t.b1 = this.addToBatch(this.batch1!, m);
          }
        }
        this.cells.set(key, 'ready');
      })
      .catch((e: unknown) => {
        console.warn(`[walls] LOD 1 cell ${key} failed`, e);
        this.cells.set(key, 'failed');
      });
  }

  private loadTile(t: TileState): void {
    t.l0.state = 'loading';
    this.loading++;
    void fetchBytes(`${WALLS_BASE}${t.def.lod0!}`)
      .then((buf) => {
        this.loading--;
        if (this.disposed) {
          return;
        }
        const T = this.index!.tileSize;
        const group = new THREE.Group();
        group.name = `walls:${t.def.i}_${t.def.j}`;
        group.position.set(t.def.i * T, 0, t.def.j * T);
        for (const m of decodeMeshes(buf)) {
          const mesh = new THREE.Mesh(toGeometry(m), this.mat!.material);
          mesh.name = `${group.name}:${m.record.kind}`;
          mesh.castShadow = m.record.kind === 'wall';
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();
          group.add(mesh);
        }
        group.visible = false;
        group.updateMatrixWorld(true);
        this.root.add(group);
        t.l0.group = group;
        t.l0.state = 'ready';
      })
      .catch((e: unknown) => {
        this.loading--;
        console.warn(`[walls] tile ${t.def.i}_${t.def.j} failed`, e);
        t.l0.state = 'failed';
      });
  }

  private dropTile(t: TileState): void {
    const g = t.l0.group;
    if (g) {
      g.removeFromParent();
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
        }
      });
    }
    t.l0.group = null;
    t.l0.state = 'none';
    if (t.level === 0) {
      t.level = -1;
    }
  }

  private show(t: TileState, level: number): void {
    if (level === t.level) {
      return;
    }
    if (t.l0.group) {
      t.l0.group.visible = level === 0;
    }
    if (t.b1 >= 0) {
      this.batch1!.setVisibleAt(t.b1, level === 1);
    }
    if (t.b2 >= 0) {
      this.batch2!.setVisibleAt(t.b2, level === 2);
    }
    t.level = level;
  }

  update(_dt: number, ctx: EngineContext): void {
    if (!this.index || this.starting) {
      return;
    }
    this.frame++;
    const cam = ctx.camera.position;
    const k = SCALE[ctx.quality.settings.preset] ?? 1;
    const near = NEAR * k;
    const far = FAR * k;
    const want0: TileState[] = [];
    for (const t of this.tiles) {
      const d = t.box.distanceToPoint(cam);
      t.dist = d;
      // Hysteresis around the current level.
      const n = t.level === 0 ? near * (1 + HYSTERESIS) : near * (1 - HYSTERESIS);
      const f = t.level === 1 || t.level === 0 ? far * (1 + HYSTERESIS) : far * (1 - HYSTERESIS);
      let want = d < n ? 0 : d < f ? 1 : 2;
      if (d < far * PREFETCH && !this.cells.has(t.cell)) {
        this.loadCell(t.cell);
      }
      if (want === 0) {
        if (t.l0.state === 'ready') {
          t.l0.used = this.frame;
        } else {
          if (t.l0.state === 'none') {
            want0.push(t);
          }
          want = 1;
        }
      }
      if (want === 1 && t.b1 < 0) {
        want = 2;
      }
      this.show(t, want);
    }
    // Nearest missing LOD 0 tiles first.
    want0.sort((a, b) => a.dist - b.dist);
    for (const t of want0) {
      if (this.loading >= PARALLEL) {
        break;
      }
      this.loadTile(t);
    }
    // Drop far LOD 0 tiles (and the least recently used beyond the cache size).
    if (this.frame % 30 === 0) {
      const loaded = this.tiles.filter((t) => t.l0.state === 'ready');
      for (const t of loaded) {
        if (t.dist > near * DROP) {
          this.dropTile(t);
        }
      }
      const rest = loaded.filter((t) => t.l0.state === 'ready' && t.level !== 0).sort((a, b) => a.l0.used - b.l0.used);
      for (let i = 0; i < rest.length - CACHE; i++) {
        this.dropTile(rest[i]);
      }
    }
  }

  pending(): number {
    if (this.starting) {
      return 1;
    }
    let n = this.loading;
    if (this.ctx && this.index) {
      const k = SCALE[this.ctx.quality.settings.preset] ?? 1;
      for (const t of this.tiles) {
        if (t.dist < NEAR * k && t.l0.state === 'none') {
          n++;
        }
        if (t.dist < FAR * k && this.cells.get(t.cell) === 'loading') {
          n++;
        }
      }
    }
    return n;
  }

  /** Diagnostics: tiles per shown LOD and their triangles. */
  stats(): { tiles: number[]; triangles: number[]; loaded0: number; cells: number; colliders: number } {
    const tiles = [0, 0, 0];
    const triangles = [0, 0, 0];
    for (const t of this.tiles) {
      if (t.level >= 0) {
        tiles[t.level]++;
        triangles[t.level] += t.def.tris[t.level];
      }
    }
    return { tiles, triangles, loaded0: this.tiles.filter((t) => t.l0.state === 'ready').length, cells: [...this.cells.values()].filter((s) => s === 'ready').length, colliders: this.colliderIds.length };
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.tiles) {
      this.dropTile(t);
    }
    this.batch1?.dispose();
    this.batch2?.dispose();
    this.collision?.removeMany(this.colliderIds);
    this.colliderIds = [];
    this.mat?.dispose();
    this.root.removeFromParent();
  }
}

export function createWallsSystem(): System {
  return new WallsSystem();
}
