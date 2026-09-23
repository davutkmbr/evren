import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GROUND_MATERIALS, SHADOW_CASTER_MATERIALS, type StreetIndex, type StreetTileRef } from './format';

export interface TileStreamerOptions {
  /** URL of the area folder that holds index.json (e.g. "/world/kadikoy/"). */
  baseUrl: string;
  index: StreetIndex;
  /** Tiles whose square lies within this horizontal distance of the focus are loaded. */
  radius?: number;
  /** Extra distance before a loaded tile is dropped again (hysteresis). */
  unloadMargin?: number;
  maxInFlight?: number;
  /** Parsed tiles added to the scene per update (spreads GPU uploads over frames). */
  maxAddsPerUpdate?: number;
  shadows?: boolean;
  /**
   * Called before a tile that brings a material not seen before enters the scene, e.g.
   * `(o) => renderer.compileAsync(o, camera, scene)`, so a new program never compiles mid-frame.
   */
  compile?: (object: THREE.Object3D) => Promise<unknown>;
}

type TileState = 'idle' | 'loading' | 'ready' | 'live';

interface TileSlot {
  ref: StreetTileRef;
  state: TileState;
  /** Set when the tile left the radius while its request was in flight. */
  cancelled: boolean;
  /** The request failed; the tile is not retried (a missing file would otherwise be fetched every frame). */
  failed?: boolean;
  object: THREE.Object3D | null;
  ground: GroundGrid | null;
  requestedAt: number;
  loadMs: number;
}

/** Triangles of a tile's walkable surfaces bucketed on a coarse xz grid, for eye-height queries. */
interface GroundGrid {
  minX: number;
  minZ: number;
  cell: number;
  nx: number;
  nz: number;
  /** World-space triangle corners, 9 floats per triangle. */
  tris: Float32Array;
  cells: Int32Array[];
}

export interface StreamerStats {
  tilesTotal: number;
  tilesLive: number;
  tilesLoading: number;
  tilesQueued: number;
  loads: number;
  unloads: number;
  failures: number;
  bytesLive: number;
  trianglesLive: number;
  /** Request-to-scene latency of the loads so far (ms). */
  loadMsMedian: number;
  loadMsMax: number;
  /** Tiles added to the scene in the last update. */
  addedLastUpdate: number;
}

/**
 * Streams compiled street tiles (plain glTF 2.0) around a focus point: loads every tile within `radius`, nearest
 * first, and unloads tiles beyond `radius + unloadMargin`. Materials are shared by glTF material name across tiles, so
 * each material is one program and one uniform set. No custom shaders: tiles render with the loader's standard
 * materials in any three.js renderer.
 */
export class TileStreamer {
  readonly root = new THREE.Group();
  private readonly slots = new Map<string, TileSlot>();
  private readonly loader = new GLTFLoader();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly radius: number;
  private readonly unloadMargin: number;
  private readonly maxInFlight: number;
  private readonly maxAdds: number;
  private readonly shadows: boolean;
  private readonly tileSize: number;
  private readonly readyQueue: TileSlot[] = [];
  private readonly loadTimes: number[] = [];
  private inFlight = 0;
  private loads = 0;
  private unloads = 0;
  private failures = 0;
  private addedLastUpdate = 0;
  private focusX = NaN;
  private focusZ = NaN;

  constructor(private readonly opts: TileStreamerOptions) {
    this.root.name = `street:${opts.index.area}`;
    this.radius = opts.radius ?? 300;
    this.unloadMargin = opts.unloadMargin ?? 40;
    this.maxInFlight = opts.maxInFlight ?? 4;
    this.maxAdds = opts.maxAddsPerUpdate ?? 2;
    this.shadows = opts.shadows ?? true;
    this.tileSize = opts.index.tileSize;
    for (const ref of opts.index.tiles) {
      this.slots.set(ref.id, { ref, state: 'idle', cancelled: false, object: null, ground: null, requestedAt: 0, loadMs: 0 });
    }
  }

  private static distanceToBounds(ref: StreetTileRef, x: number, z: number): number {
    const b = ref.bounds;
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    return Math.hypot(dx, dz);
  }

  /** Call every frame with the camera (or player) position. */
  update(x: number, z: number): void {
    this.focusX = x;
    this.focusZ = z;
    const wanted: { slot: TileSlot; d: number }[] = [];
    for (const slot of this.slots.values()) {
      const d = TileStreamer.distanceToBounds(slot.ref, x, z);
      const inside = d <= this.radius;
      const keep = d <= this.radius + this.unloadMargin;
      if (slot.state === 'live') {
        if (!keep) {
          this.unload(slot);
        }
      } else if (slot.state === 'loading' || slot.state === 'ready') {
        slot.cancelled = !keep;
      } else if (inside && !slot.failed) {
        wanted.push({ slot, d });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    for (const { slot } of wanted) {
      if (this.inFlight >= this.maxInFlight) {
        break;
      }
      this.request(slot);
    }
    this.addedLastUpdate = 0;
    this.readyQueue.sort(
      (a, b) => TileStreamer.distanceToBounds(a.ref, x, z) - TileStreamer.distanceToBounds(b.ref, x, z),
    );
    while (this.readyQueue.length && this.addedLastUpdate < this.maxAdds) {
      const slot = this.readyQueue.shift()!;
      if (slot.cancelled) {
        this.disposeObject(slot);
        slot.state = 'idle';
        continue;
      }
      this.root.add(slot.object!);
      slot.state = 'live';
      slot.loadMs = performance.now() - slot.requestedAt;
      this.loadTimes.push(slot.loadMs);
      this.loads++;
      this.addedLastUpdate++;
    }
  }

  private request(slot: TileSlot): void {
    slot.state = 'loading';
    slot.cancelled = false;
    slot.requestedAt = performance.now();
    this.inFlight++;
    const url = new URL(slot.ref.glb, new URL(this.opts.baseUrl, window.location.href)).href;
    this.loader
      .loadAsync(url)
      .then(async (gltf) => {
        const introduced = this.prepare(gltf.scene);
        if (introduced && this.opts.compile) {
          await this.opts.compile(gltf.scene).catch(() => undefined);
        }
        this.inFlight--;
        slot.object = gltf.scene;
        slot.state = 'ready';
        this.readyQueue.push(slot);
      })
      .catch((err: unknown) => {
        this.inFlight--;
        this.failures++;
        slot.state = 'idle';
        slot.failed = true;
        console.error(`[street] tile ${slot.ref.id} failed`, err);
      });
  }

  /**
   * Shares materials by name, sets shadow flags and freezes the (static) transforms. Returns whether the tile
   * introduced a material name not seen before.
   */
  private prepare(scene: THREE.Object3D): boolean {
    let introduced = false;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      const own = mesh.material as THREE.Material;
      const name = own.name;
      const shared = this.materials.get(name);
      if (shared) {
        own.dispose();
        mesh.material = shared;
      } else {
        this.materials.set(name, own);
        introduced = true;
      }
      mesh.castShadow = this.shadows && SHADOW_CASTER_MATERIALS.has(name);
      mesh.receiveShadow = this.shadows;
    });
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      o.matrixAutoUpdate = false;
    });
    return introduced;
  }

  private unload(slot: TileSlot): void {
    this.root.remove(slot.object!);
    this.disposeObject(slot);
    slot.state = 'idle';
    this.unloads++;
  }

  private disposeObject(slot: TileSlot): void {
    slot.object?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
      }
    });
    slot.object = null;
    slot.ground = null;
  }

  /** Outstanding work within the radius: queued, in flight or parsed but not yet in the scene. */
  pending(): number {
    if (!Number.isFinite(this.focusX)) {
      return 1;
    }
    let n = 0;
    for (const slot of this.slots.values()) {
      if (slot.state === 'live') {
        continue;
      }
      if (slot.state === 'loading' || slot.state === 'ready') {
        n++;
      } else if (!slot.failed && TileStreamer.distanceToBounds(slot.ref, this.focusX, this.focusZ) <= this.radius) {
        n++;
      }
    }
    return n;
  }

  stats(): StreamerStats {
    let live = 0;
    let loading = 0;
    let queued = 0;
    let bytes = 0;
    let tris = 0;
    for (const slot of this.slots.values()) {
      if (slot.state === 'live') {
        live++;
        bytes += slot.ref.bytes;
        tris += slot.ref.triangles;
      } else if (slot.state === 'loading' || slot.state === 'ready') {
        loading++;
      } else if (!slot.failed && Number.isFinite(this.focusX) && TileStreamer.distanceToBounds(slot.ref, this.focusX, this.focusZ) <= this.radius) {
        queued++;
      }
    }
    const sorted = [...this.loadTimes].sort((a, b) => a - b);
    return {
      tilesTotal: this.slots.size,
      tilesLive: live,
      tilesLoading: loading,
      tilesQueued: queued,
      loads: this.loads,
      unloads: this.unloads,
      failures: this.failures,
      bytesLive: bytes,
      trianglesLive: tris,
      loadMsMedian: sorted.length ? Math.round(sorted[sorted.length >> 1]) : 0,
      loadMsMax: sorted.length ? Math.round(sorted[sorted.length - 1]) : 0,
      addedLastUpdate: this.addedLastUpdate,
    };
  }

  /** Materials shared by name across all tiles (e.g. for a debug view). */
  sharedMaterials(): ReadonlyMap<string, THREE.Material> {
    return this.materials;
  }

  /**
   * Height of the highest walkable surface at (x, z) that lies at or below `maxY`, or null where no loaded ground
   * is found (inside a building, over water, tile not loaded).
   */
  groundHeight(x: number, z: number, maxY = Infinity): number | null {
    const id = `${Math.floor(x / this.tileSize)}_${Math.floor(z / this.tileSize)}`;
    const slot = this.slots.get(id);
    if (!slot || slot.state !== 'live') {
      return null;
    }
    const grid = (slot.ground ??= buildGroundGrid(slot.object!));
    const cx = Math.floor((x - grid.minX) / grid.cell);
    const cz = Math.floor((z - grid.minZ) / grid.cell);
    if (cx < 0 || cz < 0 || cx >= grid.nx || cz >= grid.nz) {
      return null;
    }
    const list = grid.cells[cz * grid.nx + cx];
    const t = grid.tris;
    let best: number | null = null;
    for (let k = 0; k < list.length; k++) {
      const o = list[k] * 9;
      const ax = t[o];
      const ay = t[o + 1];
      const az = t[o + 2];
      const bx = t[o + 3];
      const by = t[o + 4];
      const bz = t[o + 5];
      const qx = t[o + 6];
      const qy = t[o + 7];
      const qz = t[o + 8];
      const det = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
      if (Math.abs(det) < 1e-9) {
        continue;
      }
      const l1 = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / det;
      const l2 = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) {
        continue;
      }
      const y = l1 * ay + l2 * by + l3 * qy;
      if (y <= maxY && (best === null || y > best)) {
        best = y;
      }
    }
    return best;
  }

  dispose(): void {
    for (const slot of this.slots.values()) {
      if (slot.state === 'live') {
        this.unload(slot);
      }
    }
    for (const m of this.materials.values()) {
      m.dispose();
    }
    this.materials.clear();
  }
}

function buildGroundGrid(tile: THREE.Object3D): GroundGrid {
  const meshes: THREE.Mesh[] = [];
  tile.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && GROUND_MATERIALS.has((mesh.material as THREE.Material).name)) {
      meshes.push(mesh);
    }
  });
  let count = 0;
  for (const m of meshes) {
    count += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
  }
  const tris = new Float32Array(count * 9);
  const v = new THREE.Vector3();
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let t = 0;
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    const index = m.geometry.index;
    const n = index ? index.count : pos.count;
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(m.matrixWorld);
      tris[t++] = v.x;
      tris[t++] = v.y;
      tris[t++] = v.z;
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minZ = Math.min(minZ, v.z);
      maxZ = Math.max(maxZ, v.z);
    }
  }
  const cell = 2;
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  const buckets: number[][] = Array.from({ length: nx * nz }, () => []);
  for (let i = 0; i < count; i++) {
    const o = i * 9;
    const x0 = Math.min(tris[o], tris[o + 3], tris[o + 6]);
    const x1 = Math.max(tris[o], tris[o + 3], tris[o + 6]);
    const z0 = Math.min(tris[o + 2], tris[o + 5], tris[o + 8]);
    const z1 = Math.max(tris[o + 2], tris[o + 5], tris[o + 8]);
    const cx0 = Math.max(0, Math.floor((x0 - minX) / cell));
    const cx1 = Math.min(nx - 1, Math.floor((x1 - minX) / cell));
    const cz0 = Math.max(0, Math.floor((z0 - minZ) / cell));
    const cz1 = Math.min(nz - 1, Math.floor((z1 - minZ) / cell));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        buckets[cz * nx + cx].push(i);
      }
    }
  }
  return { minX, minZ, cell, nx, nz, tris, cells: buckets.map((b) => Int32Array.from(b)) };
}
