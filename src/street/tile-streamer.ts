import * as THREE from 'three';
import { GLTFLoader, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { fetchJson, fetchStats, GROUND_MATERIALS, loadGlb, type LightRec, SHADOW_CASTER_MATERIALS, type StreetIndex, type StreetTileManifest, type StreetTileRef } from './format';
import { type PropDistances, PropBatches, type PropStats } from './props';
import { ModuleExpander } from './modules/expander';
import type { FadeTable } from './fade';
import { batchCounters, textureBudget, textureBytes, textureReady, textureUploaded, type TilePart, TileBatches, uploadTexture } from './tile-batches';

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
  /** Anisotropic filtering of the shared textures (ground at grazing angles). */
  anisotropy?: number;
  /** Prop LOD and cull distances (format 1). */
  propDistances: PropDistances;
  /**
   * Called before a tile that brings a material not seen before enters the scene, e.g.
   * `(o) => renderer.compileAsync(o, camera, scene)`, so a new program never compiles mid-frame.
   */
  compile?: (object: THREE.Object3D) => Promise<unknown>;
  /** Prop assets whose instances are not placed (e.g. placeholders a host draws itself: people, parked cars). */
  excludeAssets?: readonly string[];
  /** Called once for every material the streamer introduces (tiles and props), before it is first compiled. */
  adaptMaterial?: (material: THREE.Material) => void;
  /** Seconds a tile takes to fade in once it is ready and out before it is dropped (0 = instant, the default). */
  fadeSeconds?: number;
  /**
   * A ready tile fades in only once this returns true (e.g. the host has cut its own geometry under the tile, keyed by
   * the tile's fade slot).
   */
  gate?: (ref: StreetTileRef, slot: number) => boolean;
  /** Main-thread time (ms) per update spent copying loaded tiles into the draw batches. */
  workBudgetMs?: number;
  /**
   * Uploads a texture ahead of its first use (e.g. `(t) => renderer.initTexture(t)`): shared textures are uploaded one
   * per update as they load, instead of several at once (with their mipmaps) in the frame their tiles or props appear.
   */
  initTexture?: (texture: THREE.Texture) => void;
  /** Object layer of the tile batches that draw small detail (see TileBatches) and of the props; default 0. */
  detailLayer?: number;
  /**
   * Emissive tile materials share batches (their emissive colour baked per vertex). Off by default: a host that sets
   * each emissive material's intensity itself (emissiveMaterials()) needs them apart.
   */
  mergeEmissive?: boolean;
  /**
   * Fade table shared with other streamers: their tiles then draw from one slot space, so a host can key one hole mask
   * by slot across several areas. Default: the streamer's own.
   */
  fade?: FadeTable;
  /**
   * Texture cache shared with other streamers (URL -> texture): areas that reference the same files (the web profile's
   * shared store) then decode and upload each texture once. The owner of a shared cache disposes its textures.
   */
  textureCache?: Map<string, Promise<THREE.Texture | null>>;
  /**
   * Draw batches shared with other streamers (areas of one compiler run use the same material names): a new area then
   * fills the free ranges of pages already on the GPU instead of creating, compiling and uploading its own. The owner
   * adds `group` to the scene, calls `work()` once per frame and disposes them; `fade` is theirs (the option above is
   * ignored).
   */
  batches?: TileBatches;
  /** Materials by name shared with other streamers (see `batches`); the owner disposes them. */
  materials?: Map<string, THREE.Material>;
}

interface LoadedLod {
  level: number;
  glb: string;
  /** Key of the tile's entry in the draw batches. */
  key: string;
  /** Walkable surface meshes (ground height queries). */
  ground: TilePart[];
}

/** A tile in the scene as the host sees it. */
export interface LiveTile {
  ref: StreetTileRef;
  manifest: StreetTileManifest | null;
  /** Fade slot (fade.ts) the host's own geometry under the tile should follow; 0 = none. */
  slot: number;
  /** Current fade (0..1). */
  fade: number;
  /** Fading out before it is dropped. */
  retiring: boolean;
  /** Drawn (fade > 0 and in the batches). */
  shown: boolean;
}

interface TileSlot {
  ref: StreetTileRef;
  /** In the scene. */
  live: LoadedLod | null;
  /** Requested or parsed, not yet in the scene. */
  pending: { level: number; glb: string; loaded: { level: number; glb: string; parts: TilePart[] } | null } | null;
  /** The pending LOD is being copied into the batches (replaces `live` once complete). */
  committing: LoadedLod | null;
  /** Fade slot (0 until the tile first enters the batches) and current fade. */
  fadeSlot: number;
  fade: number;
  /** Out of range: fading out, then dropped. */
  retiring: boolean;
  /** The pending result is no longer wanted (tile left the radius or the wanted LOD changed). */
  cancelled: boolean;
  /** A request failed (e.g. the compiler is rewriting the file): no new request before this time (performance.now). */
  retryAt: number;
  attempts: number;
  ground: GroundGrid | null;
  requestedAt: number;
  /** Format 1: manifest (instances, lights) and the tile's instanced props. */
  manifest: StreetTileManifest | null;
  manifestState: 'none' | 'loading' | 'ready' | 'failed';
  manifestRetryAt: number;
  manifestAttempts: number;
  /** The manifest's instances are handed to the prop batches. */
  propsAdded: boolean;
  distance: number;
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
  /** Format 1: live tiles per LOD level, live prop instances, lights of live tiles. */
  lodLive: Record<number, number>;
  instancesLive: number;
  lightsLive: number;
  /** Prop batches (draw calls before culling), placed / visible instances, instances per visible LOD level. */
  props: PropStats | null;
  /** Tiles, manifests or props waiting for a retry after a failed load. */
  retrying: number;
}

// Decode the meshopt-compressed tiles and props off the main thread (a tile is ~1 MB; decoding it stalls a frame).
MeshoptDecoder.useWorkers(2);


/** Backoff after the n-th failed load of a file (ms). */
const retryDelay = (attempts: number): number => Math.min(30000, 1000 * 2 ** attempts);

/**
 * GLTFLoader plugin: textures with an external URI are loaded once per URL and shared by every tile and prop (the
 * compiler writes them once, to <area>/textures/ or, web profile, to the store all areas share). Anisotropic filtering
 * is set on them.
 */
class SharedTextures {
  readonly name = 'EVREN_shared_textures';
  constructor(
    private readonly parser: GLTFParser,
    private readonly cache: Map<string, Promise<THREE.Texture | null>>,
    private readonly anisotropy: number,
    private readonly onTexture?: (t: THREE.Texture) => void,
  ) {}

  loadTexture(textureIndex: number): Promise<THREE.Texture | null> | null {
    const json = this.parser.json as { textures: { source: number }[]; images: { uri?: string }[] };
    const source = json.textures[textureIndex].source;
    const uri = json.images[source].uri;
    if (!uri || uri.startsWith('data:')) {
      return null;
    }
    // Normalized, so every area's relative path to a shared file gives one key.
    const url = new URL(uri, new URL((this.parser.options as { path: string }).path, window.location.href)).href;
    let p = this.cache.get(url);
    if (!p) {
      const parser = this.parser as unknown as { loadTextureImage(t: number, s: number, loader: unknown): Promise<THREE.Texture | null>; textureLoader: unknown };
      p = parser.loadTextureImage(textureIndex, source, parser.textureLoader).then((t) => {
        if (t) {
          t.anisotropy = this.anisotropy;
          this.onTexture?.(t);
        } else {
          // Failed (e.g. the compiler is rewriting textures/): the next tile or prop that uses it tries again.
          this.cache.delete(url);
        }
        return t;
      });
      this.cache.set(url, p);
    }
    return p;
  }
}

/**
 * Streams compiled street tiles (plain glTF 2.0) around a focus point: loads every tile within `radius`, nearest
 * first, and unloads tiles beyond `radius + unloadMargin`. Format 1 tiles switch LODs by the index's distance bands
 * (LOD0 near, LOD1 far, with hysteresis) and bring their prop instances (drawn within each prop's draw distance) and
 * light lists. Materials are shared by glTF material name across tiles, textures by URL, so each material is one
 * program and one uniform set, and the renderer's material sort keeps state switches to one per material. Props are
 * drawn by PropBatches (a few BatchedMeshes for the whole area). Failed loads (a file being rewritten by the compiler)
 * are retried with backoff; unknown manifest and index fields are ignored.
 */
export class TileStreamer {
  readonly root = new THREE.Group();
  private readonly slots = new Map<string, TileSlot>();
  /** Compiled glbs are meshopt-compressed and quantized (tools/world-compiler/src/compress.ts). */
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly materials: Map<string, THREE.Material>;
  private readonly emissive = new Set<THREE.Material>();
  private readonly textureCache: Map<string, Promise<THREE.Texture | null>>;
  private readonly excluded: ReadonlySet<string>;
  readonly props: PropBatches | null;
  /** Draw batches of the tiles' meshes (per material) and their shadow proxies. */
  readonly batches: TileBatches;
  private lastUpdate = NaN;
  /** Loaded shared textures not yet uploaded (see TileStreamerOptions.initTexture). */
  private readonly textureQueue: THREE.Texture[] = [];
  private readonly initWaits = new WeakMap<THREE.Texture, number>();
  private keySeq = 0;
  private radius: number;
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
  private lightsCache: LightRec[] | null = null;
  /** Bumped when tiles enter or leave the scene (the sandbox re-renders the shadow map then). */
  version = 0;
  readonly format: number;
  /** Format 1.2: assembles the tiles' façade module slots off the main thread (modules/). */
  private readonly modules: ModuleExpander | null;

  constructor(private readonly opts: TileStreamerOptions) {
    this.root.name = `street:${opts.index.area}`;
    // Debug access from the page (e.g. scene.getObjectByName('street:eminonu').userData.streamer.stats()).
    this.root.userData.streamer = this;
    this.root.userData.batchCounters = batchCounters;
    this.root.userData.fetchStats = fetchStats;
    this.textureCache = opts.textureCache ?? new Map();
    this.radius = opts.radius ?? 300;
    this.unloadMargin = opts.unloadMargin ?? 40;
    this.maxInFlight = opts.maxInFlight ?? 4;
    this.maxAdds = opts.maxAddsPerUpdate ?? 2;
    this.shadows = opts.shadows ?? true;
    this.tileSize = opts.index.tileSize;
    this.format = opts.index.format;
    this.excluded = new Set(opts.excludeAssets ?? []);
    const aniso = opts.anisotropy ?? 8;
    this.loader.register((parser) => new SharedTextures(parser, this.textureCache, aniso, (t) => this.textureQueue.push(t)) as never);
    this.materials = opts.materials ?? new Map();
    this.batches = opts.batches ?? new TileBatches(this.shadows, opts.compile, opts.detailLayer, opts.mergeEmissive, opts.fade, opts.initTexture);
    if (!opts.batches) {
      this.root.add(this.batches.group);
    }
    this.props = opts.index.props
      ? new PropBatches(opts.baseUrl, opts.index.props, this.loader, opts.propDistances, this.shadows, (m) => this.noteMaterial(m), opts.compile, opts.initTexture)
      : null;
    if (this.props) {
      this.props.layer = opts.detailLayer ?? 0;
      this.root.add(this.props.group);
    }
    this.modules = opts.index.modules ? new ModuleExpander(opts.baseUrl, opts.index.modules, this.loader) : null;
    this.root.userData.moduleStats = this.modules?.stats;
    for (const ref of opts.index.tiles) {
      this.slots.set(ref.id, {
        ref,
        live: null,
        pending: null,
        committing: null,
        fadeSlot: 0,
        fade: 0,
        retiring: false,
        cancelled: false,
        retryAt: 0,
        attempts: 0,
        ground: null,
        requestedAt: 0,
        manifest: null,
        manifestState: 'none',
        manifestRetryAt: 0,
        manifestAttempts: 0,
        propsAdded: false,
        distance: Infinity,
      });
    }
  }

  private static distanceToBounds(ref: StreetTileRef, x: number, z: number): number {
    const b = ref.bounds;
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    return Math.hypot(dx, dz);
  }

  /** LOD level wanted at distance d (the live level is kept inside its band plus hysteresis). */
  private wantedLevel(slot: TileSlot, d: number): number {
    const lod = this.opts.index.lod;
    const levels = slot.ref.lods;
    if (!lod || !levels || levels.length < 2) {
      return 0;
    }
    const cur = slot.live?.level;
    if (cur !== undefined) {
      const band = lod.bands.find((b) => b.level === cur);
      if (band && d >= band.min - lod.hysteresis && d < band.max + lod.hysteresis) {
        return cur;
      }
    }
    const band = lod.bands.find((b) => d >= b.min && d < b.max) ?? lod.bands[lod.bands.length - 1];
    return levels.some((l) => l.level === band.level) ? band.level : levels[levels.length - 1].level;
  }

  private glbOf(slot: TileSlot, level: number): string {
    return slot.ref.lods?.find((l) => l.level === level)?.glb ?? slot.ref.glb;
  }

  /** Load radius (m); tiles beyond radius + unloadMargin are dropped on the next update. */
  setRadius(radius: number): void {
    this.radius = radius;
  }

  /** Call every frame with the camera (or player) position. */
  update(x: number, z: number): void {
    this.focusX = x;
    this.focusZ = z;
    const now = performance.now();
    const dt = Number.isFinite(this.lastUpdate) ? Math.min(0.25, (now - this.lastUpdate) / 1000) : 0;
    this.lastUpdate = now;
    const fading = (this.opts.fadeSeconds ?? 0) > 0;
    const wanted: { slot: TileSlot; level: number; glb: string; d: number }[] = [];
    for (const slot of this.slots.values()) {
      const d = TileStreamer.distanceToBounds(slot.ref, x, z);
      slot.distance = d;
      const keep = d <= this.radius + this.unloadMargin;
      if (!keep) {
        if (slot.pending) {
          slot.cancelled = true;
        }
        if (slot.committing) {
          this.batches.removeTile(slot.committing.key);
          slot.committing = null;
        }
        if (slot.live && fading) {
          slot.retiring = true;
        } else if (slot.live || slot.fadeSlot) {
          this.unload(slot);
        }
        continue;
      }
      // A tile fading out comes back only well inside the radius, so a focus moving along the edge never cycles fades.
      if (slot.retiring && d > this.radius) {
        continue;
      }
      slot.retiring = false;
      const level = this.wantedLevel(slot, d);
      const glb = this.glbOf(slot, level);
      const have = slot.committing?.glb ?? slot.live?.glb;
      if (have === glb) {
        if (slot.live && slot.live.glb === glb) {
          slot.live.level = level;
        }
        if (slot.pending) {
          slot.cancelled = true;
        }
      } else if (slot.pending) {
        slot.cancelled = slot.pending.glb !== glb;
      } else if (now >= slot.retryAt && (d <= this.radius || slot.live)) {
        wanted.push({ slot, level, glb, d });
      }
      if (slot.live && this.format >= 1) {
        // Props load with the tile (hidden until it fades in), so their batches and uploads are ready by then.
        this.ensureProps(slot, now);
      }
    }
    this.props?.update(x, z);
    wanted.sort((a, b) => a.d - b.d);
    for (const w of wanted) {
      if (this.inFlight >= this.maxInFlight) {
        break;
      }
      this.request(w.slot, w.level, w.glb);
    }
    // Loaded tiles enter the draw batches (copied over the next updates within the work budget).
    this.addedLastUpdate = 0;
    this.readyQueue.sort((a, b) => a.distance - b.distance);
    while (this.readyQueue.length && this.addedLastUpdate < this.maxAdds) {
      const slot = this.readyQueue.shift()!;
      const loaded = slot.pending?.loaded;
      if (!loaded || slot.cancelled) {
        slot.pending = null;
        slot.cancelled = false;
        continue;
      }
      if (slot.committing) {
        this.batches.removeTile(slot.committing.key);
      }
      if (!slot.fadeSlot) {
        slot.fadeSlot = fading ? this.batches.fade.acquire() : 0;
        slot.fade = 0;
      }
      const key = `${this.opts.index.area}:${slot.ref.id}#${this.keySeq++}`;
      this.batches.addTile(key, loaded.parts, slot.fadeSlot);
      const format = this.format;
      slot.committing = { level: loaded.level, glb: loaded.glb, key, ground: loaded.parts.filter((p) => isGround(p.material, format)) };
      slot.pending = null;
      this.addedLastUpdate++;
    }
    // Texture uploads within the per-frame byte budget shared with the other streamers and the batches' page
    // admissions (textureBudget). The loop counts the queue it started with: textures still decoding go back to its
    // end and are not revisited in this update.
    for (let n = this.textureQueue.length; n > 0 && this.opts.initTexture; n--) {
      const texture = this.textureQueue.shift()!;
      if (textureReady(texture)) {
        // Already uploaded (shared with another area's streamer, or with a page admitted by the batches): skipped.
        if (!textureUploaded(texture)) {
          if (!textureBudget.fits(textureBytes(texture))) {
            this.textureQueue.unshift(texture);
            break;
          }
          uploadTexture(texture, this.opts.initTexture);
        }
      } else if ((this.initWaits.get(texture) ?? 0) < 600) {
        // Image still decoding: try again later (it uploads on first use anyway).
        this.initWaits.set(texture, (this.initWaits.get(texture) ?? 0) + 1);
        this.textureQueue.push(texture);
      }
    }
    if (!this.opts.batches) {
      this.batches.work(this.opts.workBudgetMs ?? 3);
    }
    for (const slot of this.slots.values()) {
      if (slot.committing && this.batches.isComplete(slot.committing.key)) {
        if (slot.live) {
          this.batches.removeTile(slot.live.key);
        } else {
          this.lightsCache = null;
        }
        slot.live = slot.committing;
        slot.committing = null;
        slot.ground = null;
        this.version++;
        this.loadTimes.push(performance.now() - slot.requestedAt);
        this.loads++;
      }
      if (!slot.live) {
        continue;
      }
      const target = !slot.retiring && (!this.opts.gate || this.opts.gate(slot.ref, slot.fadeSlot)) ? 1 : 0;
      if (!fading) {
        slot.fade = target;
      } else if (slot.fade !== target) {
        const step = dt / (this.opts.fadeSeconds ?? 1);
        slot.fade = target > slot.fade ? Math.min(target, slot.fade + step) : Math.max(target, slot.fade - step);
      }
      this.batches.fade.set(slot.fadeSlot, slot.fade);
      this.props?.setTileVisible(slot.ref.id, slot.fade > 0);
      this.batches.setShown(slot.live.key, slot.fadeSlot ? slot.fade : target);
      if (slot.retiring && slot.fade <= 0) {
        this.unload(slot);
      }
    }
    this.batches.refresh();
  }

  private request(slot: TileSlot, level: number, glb: string): void {
    slot.pending = { level, glb, loaded: null };
    slot.cancelled = false;
    slot.requestedAt = performance.now();
    this.inFlight++;
    const url = new URL(glb, new URL(this.opts.baseUrl, window.location.href)).href;
    // LOD0 of a full-detail tile also gets its façade modules, expanded in a worker while the glb loads.
    Promise.all([loadGlb(this.loader, url), level === 0 ? this.modules?.expand(slot.ref) : null])
      .then(([gltf, modules]) => {
        const parts = this.prepare(gltf.scene);
        if (modules) {
          parts.push(...this.prepare(modules));
        }
        this.inFlight--;
        slot.attempts = 0;
        if (slot.pending && slot.pending.glb === glb) {
          slot.pending.loaded = { level, glb, parts };
          this.readyQueue.push(slot);
        }
      })
      .catch((err: unknown) => {
        this.inFlight--;
        this.failures++;
        slot.pending = null;
        slot.attempts++;
        slot.retryAt = performance.now() + retryDelay(slot.attempts);
        if (slot.attempts === 1 || slot.attempts % 10 === 0) {
          console.warn(`[street] tile ${slot.ref.id} (${glb}) failed, attempt ${slot.attempts}, will retry: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
        }
      });
  }

  /** Format 1: loads the tile manifest once (retrying after failures), then hands its instances to the prop batches. */
  private ensureProps(slot: TileSlot, now: number): void {
    if (slot.manifestState === 'none' || (slot.manifestState === 'failed' && now >= slot.manifestRetryAt)) {
      slot.manifestState = 'loading';
      fetchJson<StreetTileManifest>(new URL(slot.ref.manifest, new URL(this.opts.baseUrl, window.location.href)).href)
        .then((m) => {
          slot.manifest = m;
          slot.manifestState = 'ready';
          slot.manifestAttempts = 0;
          this.lightsCache = null;
        })
        .catch((err: unknown) => {
          slot.manifestState = 'failed';
          slot.manifestAttempts++;
          slot.manifestRetryAt = performance.now() + retryDelay(slot.manifestAttempts);
          if (slot.manifestAttempts === 1 || slot.manifestAttempts % 10 === 0) {
            console.warn(`[street] manifest ${slot.ref.id} failed, attempt ${slot.manifestAttempts}, will retry: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
          }
        });
      return;
    }
    if (slot.manifestState === 'ready' && !slot.propsAdded && this.props) {
      slot.propsAdded = true;
      const instances = this.excluded.size ? slot.manifest?.instances?.filter((i) => !this.excluded.has(i.asset)) : slot.manifest?.instances;
      if (instances?.length) {
        this.props.addTile(slot.ref.id, instances);
      }
    }
  }

  private noteMaterial(m: THREE.Material): void {
    this.opts.adaptMaterial?.(m);
    // Its textures (shared or embedded in a prop) are uploaded ahead too, one per update.
    for (const v of Object.values(m)) {
      if ((v as THREE.Texture | null)?.isTexture && !this.textureQueue.includes(v as THREE.Texture)) {
        this.textureQueue.push(v as THREE.Texture);
      }
    }
    if (m.userData.emissive) {
      this.emissive.add(m);
    }
  }

  /** Shares materials by name (format 0: sets their caster flag) and lists the tile's meshes in world space. */
  private prepare(scene: THREE.Object3D): TilePart[] {
    scene.updateMatrixWorld(true);
    const parts: TilePart[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      const own = mesh.material as THREE.Material;
      const name = own.name;
      let shared = this.materials.get(name);
      if (shared) {
        if (shared !== own) {
          TileStreamer.adoptMaps(shared, own);
          own.dispose();
        }
      } else {
        shared = own;
        if (this.format < 1) {
          own.userData.castShadow = SHADOW_CASTER_MATERIALS.has(name);
        }
        this.materials.set(name, own);
        this.noteMaterial(own);
      }
      parts.push({ material: shared, geometry: mesh.geometry, matrix: mesh.matrixWorld.clone() });
    });
    return parts;
  }

  /** A shared material created while one of its textures was missing (a recompile in progress) takes them later. */
  private static adoptMaps(shared: THREE.Material, own: THREE.Material): void {
    const a = shared as THREE.MeshStandardMaterial;
    const b = own as THREE.MeshStandardMaterial;
    let changed = false;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const) {
      if (k in a && !a[k] && b[k]) {
        a[k] = b[k];
        changed = true;
      }
    }
    if (changed) {
      a.needsUpdate = true;
    }
  }

  private unload(slot: TileSlot): void {
    if (slot.live) {
      this.batches.removeTile(slot.live.key);
      slot.live = null;
      this.version++;
      this.unloads++;
    }
    if (slot.committing) {
      this.batches.removeTile(slot.committing.key);
      slot.committing = null;
    }
    if (slot.propsAdded) {
      this.props?.removeTile(slot.ref.id);
      slot.propsAdded = false;
    }
    this.batches.fade.release(slot.fadeSlot);
    slot.fadeSlot = 0;
    slot.fade = 0;
    slot.retiring = false;
    this.lightsCache = null;
    slot.ground = null;
  }

  /**
   * Outstanding work within the radius: tiles without their wanted LOD in the scene (or still being copied into the
   * batches or fading in), and props being built.
   */
  pending(): number {
    if (!Number.isFinite(this.focusX)) {
      return 1;
    }
    let n = 0;
    const now = performance.now();
    for (const slot of this.slots.values()) {
      if (slot.distance > this.radius || (!slot.pending && now < slot.retryAt)) {
        continue;
      }
      const wantGlb = this.glbOf(slot, this.wantedLevel(slot, slot.distance));
      const fading = slot.live && slot.fade < 1 && (!this.opts.gate || this.opts.gate(slot.ref, slot.fadeSlot));
      if (!slot.live || slot.live.glb !== wantGlb || slot.pending || slot.committing || fading) {
        n++;
      } else if (this.format >= 1 && this.props && slot.manifestState !== 'failed' && (!slot.propsAdded || this.props.isPending(slot.ref.id))) {
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
    let instances = 0;
    let lights = 0;
    let retrying = 0;
    const now = performance.now();
    const lodLive: Record<number, number> = {};
    for (const slot of this.slots.values()) {
      if (slot.live) {
        live++;
        const lod = slot.ref.lods?.find((l) => l.glb === slot.live!.glb);
        bytes += lod?.bytes ?? slot.ref.bytes;
        tris += lod?.triangles ?? slot.ref.triangles;
        lodLive[slot.live.level] = (lodLive[slot.live.level] ?? 0) + 1;
        instances += slot.propsAdded ? (slot.manifest?.instances?.length ?? 0) : 0;
        lights += slot.manifest?.lights?.length ?? 0;
      }
      if (now < slot.retryAt || (slot.manifestState === 'failed' && slot.live)) {
        retrying++;
      }
      if (slot.pending) {
        loading++;
      } else if (!slot.live && now >= slot.retryAt && Number.isFinite(this.focusX) && slot.distance <= this.radius) {
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
      lodLive,
      instancesLive: instances,
      lightsLive: lights,
      props: this.props?.stats() ?? null,
      retrying,
    };
  }

  /**
   * Tiles in the scene or being copied into it, with their manifests (null while a format 1 manifest is still loading),
   * fade slots and fades.
   */
  liveTiles(): LiveTile[] {
    const out: LiveTile[] = [];
    for (const slot of this.slots.values()) {
      if (slot.live || slot.committing) {
        out.push({ ref: slot.ref, manifest: slot.manifest, slot: slot.fadeSlot, fade: slot.live ? slot.fade : 0, retiring: slot.retiring, shown: !!slot.live && this.batches.isShown(slot.live.key) });
      }
    }
    return out;
  }

  /** Materials shared by name across all tiles (e.g. for a debug view). */
  sharedMaterials(): ReadonlyMap<string, THREE.Material> {
    return this.materials;
  }

  /** Materials with an emissive record (material extras `emissive: { nits, night, source }`), tiles and props. */
  emissiveMaterials(): ReadonlySet<THREE.Material> {
    return this.emissive;
  }

  /** Lights of the live tiles (format 1). The array is rebuilt, and changes identity, only when tiles come or go. */
  liveLights(): readonly LightRec[] {
    if (!this.lightsCache) {
      const out: LightRec[] = [];
      for (const slot of this.slots.values()) {
        if (slot.live && slot.manifest?.lights) {
          out.push(...slot.manifest.lights);
        }
      }
      this.lightsCache = out;
    }
    return this.lightsCache;
  }

  /**
   * Height of the highest walkable surface at (x, z) that lies at or below `maxY`, or null where no loaded ground
   * is found (inside a building, over water, tile not loaded).
   */
  groundHeight(x: number, z: number, maxY = Infinity): number | null {
    const id = `${Math.floor(x / this.tileSize)}_${Math.floor(z / this.tileSize)}`;
    const slot = this.slots.get(id);
    if (!slot || !slot.live) {
      return null;
    }
    const grid = (slot.ground ??= buildGroundGrid(slot.live.ground));
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
      if (slot.live || slot.committing || slot.fadeSlot) {
        this.unload(slot);
      }
    }
    if (!this.opts.batches) {
      this.batches.dispose();
    }
    if (!this.opts.materials) {
      for (const m of this.materials.values()) {
        m.dispose();
      }
      this.materials.clear();
    }
    if (!this.opts.textureCache) {
      for (const p of this.textureCache.values()) {
        void p.then((t) => t?.dispose());
      }
      this.textureCache.clear();
    }
    this.props?.dispose();
  }
}

function isGround(m: THREE.Material, format: number): boolean {
  return format >= 1 ? m.userData.surface === 'ground' : GROUND_MATERIALS.has(m.name);
}

function buildGroundGrid(meshes: readonly TilePart[]): GroundGrid {
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
      v.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(m.matrix);
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
