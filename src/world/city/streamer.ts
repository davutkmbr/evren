/**
 * Quadtree LOD streaming of city chunks around the camera.
 * Levels: 0 = 500 m near tiles (full detail), 1 = 1 km mid tiles, 2 = 2 km far tiles. A node is replaced by
 * its children (or its parent) only when the whole replacement set is ready; the swap is a complementary
 * screen-door cross-fade so the two LODs never draw the same pixel. Far tiles are sorted by fade class so their
 * draw range shrinks with distance. Uploads are budgeted per frame.
 */
import * as THREE from 'three';
import { FADE_CLASS_COUNT, LEVEL_COUNT, LEVEL_SIZES, type TileResultMsg } from './protocol';
import type { CityMaterials, FadeHandle } from './materials/building-material';
import type { GeoWindowCutter } from './geo-window';
import type { LampPool, LampRange } from './lamps';
import type { CityWorkerPool } from './worker-pool';

const WORLD_HALF = 24000;
const FADE_SECONDS = 0.75;
/** Worker-side margin (m) around a tile so lots whose centre lies inside can test their corners. */
const WINDOW_MARGIN = 130;
const MAX_PER_WORKER = 2;
/** Fade classes finish sinking at this multiple of their start distance (matches the vertex shader). */
const CLASS_FADE_END = 1.18;

type NodeState = 'queued' | 'loading' | 'ready';

interface CityNode {
  key: number;
  level: number;
  ix: number;
  iz: number;
  x0: number;
  z0: number;
  size: number;
  state: NodeState;
  mesh: THREE.Mesh | null;
  classEnds: number[] | null;
  detailStart: number;
  nearWater: boolean;
  lampPos: Float32Array | null;
  lampCol: Uint8Array | null;
  lampRange: LampRange | null;
  displayed: boolean;
  fade: number;
  target: number;
  fadeHandle: FadeHandle | null;
  wanted: boolean;
  priority: number;
  distance: number;
  triangles: number;
  buildings: number;
  /** Request generation: refresh() bumps it so results of requests cut with an older geo window are dropped. */
  gen: number;
  /** Re-requested by refresh() while its current mesh stays displayed (swapped when the new one arrives). */
  refreshing: boolean;
  /** Start (performance.now()) of a handover cross-fade driving `fade` by time instead of by frame steps. */
  timedFrom: number | null;
}

/**
 * Chunks re-requested together for an OSM region handover (osm/fade.ts): their new meshes are held until all are
 * ready, then swapped at one instant, the old ones fading out as ghosts, and `resolve` gets that instant.
 */
interface Handover {
  nodes: Set<CityNode>;
  /** Refreshed nodes whose new mesh is built, with the old mesh still on screen. */
  held: Map<CityNode, THREE.Mesh | null>;
  resolve: (t0: number) => void;
}

/** An old chunk mesh fading out after a handover swap. */
interface Ghost {
  mesh: THREE.Mesh;
  handle: FadeHandle;
  t0: number;
}

export interface CityLodParams {
  drawDistance: number;
  split0: number;
  split1: number;
  densityScale: number;
  /** Mid tiles cast shadows while nearer than this (m). */
  shadowDistance: number;
  /** Start distance (m) of the far fade per class (Skyline, Large, Mid, Small). */
  classFade: [number, number, number, number];
}

export interface StreamStats {
  nodes: number;
  displayed: number;
  byLevel: number[];
  triangles: number;
  buildings: number;
  queued: number;
  loading: number;
  lamps: number;
  lastJobMs: number;
  trisByLevel: number[];
  buildingsByLevel: number[];
  /** Triangles drawn last frame by the main/reflection passes and by the shadow passes. */
  drawnMain: number;
  drawnShadow: number;
  /** Other cameras (water reflection). */
  drawnOther: number;
}

function nodeKey(level: number, ix: number, iz: number): number {
  return (level * 128 + iz) * 128 + ix;
}

const _box = new THREE.Box3();
const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();

export class CityStreamer {
  readonly group = new THREE.Group();
  private readonly nodes = new Map<number, CityNode>();
  private readonly handovers: Handover[] = [];
  private readonly ghosts: Ghost[] = [];
  private readonly results: CityNode[] = [];
  private readonly pendingResults = new Map<CityNode, TileResultMsg>();
  private readonly wantedKeys = new Set<number>();
  private splitKeys = new Set<number>();
  private readonly lastCam = new THREE.Vector3(1e9, 0, 0);
  private readonly replacements: CityNode[] = [];
  private framesSinceSelect = 1e9;
  private lastJobMs = 0;
  private drawnMain = 0;
  private drawnShadow = 0;
  private frameMain = 0;
  private frameShadow = 0;
  private frameOther = 0;
  private drawnOther = 0;
  private mainCamera: THREE.Camera | null = null;
  /** Per-pass index ranges: every draw sets its own range right before it is issued (-1 skips the draw). */
  private readonly beforeRender = (_r: unknown, _s: unknown, camera: THREE.Camera, geometry: THREE.BufferGeometry): void => {
    const c = geometry.userData as PassCounts;
    if (camera === this.mainCamera) {
      geometry.drawRange.count = c.main;
      this.frameMain += Math.max(c.main, 0) / 3;
    } else {
      geometry.drawRange.count = c.reflect;
      this.frameOther += Math.max(c.reflect, 0) / 3;
    }
  };
  private readonly beforeShadow = (_r: unknown, _o: unknown, _c: unknown, _sc: unknown, geometry: THREE.BufferGeometry): void => {
    const c = geometry.userData as PassCounts;
    geometry.drawRange.count = c.shadow;
    this.frameShadow += Math.max(c.shadow, 0) / 3;
  };
  params: CityLodParams;

  /**
   * Debug (?keepGeometry=1, set by scripts/walk-test.mjs): keep the CPU copies of chunk geometry after upload so test
   * tools can ray-test the rendered buildings. Off for players (the arrays are released after upload).
   */
  keepCpuGeometry = false;

  constructor(
    private readonly pool: CityWorkerPool,
    private readonly cutter: GeoWindowCutter,
    private readonly materials: CityMaterials,
    private readonly lamps: LampPool,
    private readonly occupied: (level: number, ix: number, iz: number) => boolean,
    params: CityLodParams,
  ) {
    this.params = params;
    this.group.name = 'city';
    this.group.matrixAutoUpdate = false;
    this.applyClassFade();
  }

  setParams(p: CityLodParams): void {
    const densityChanged = p.densityScale !== this.params.densityScale;
    this.params = p;
    this.framesSinceSelect = 1e9;
    this.applyClassFade();
    if (densityChanged) {
      this.clear();
    }
  }

  private applyClassFade(): void {
    const f = this.params.classFade;
    this.materials.classFade.value.set(f[0], f[1], f[2], f[3]);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, uploadBudgetMs: number): void {
    this.mainCamera = camera;
    this.drawnMain = this.frameMain;
    this.drawnShadow = this.frameShadow;
    this.drawnOther = this.frameOther;
    this.frameMain = 0;
    this.frameShadow = 0;
    this.frameOther = 0;
    const cam = camera.position;
    this.framesSinceSelect++;
    if (this.lastCam.distanceToSquared(cam) > 64 || this.framesSinceSelect > 20) {
      _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_m, camera.coordinateSystem, camera.reversedDepth);
      this.select(cam);
      this.lastCam.copy(cam);
      this.framesSinceSelect = 0;
      this.refreshRanges();
    }
    this.dispatch();
    this.upload(uploadBudgetMs);
    this.resolve();
    this.animate(dt);
  }

  private tileDistance(level: number, ix: number, iz: number, cam: THREE.Vector3): number {
    const size = LEVEL_SIZES[level];
    const x0 = -WORLD_HALF + ix * size;
    const z0 = -WORLD_HALF + iz * size;
    const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + size));
    const dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + size));
    const dy = Math.max(cam.y - 80, 0);
    return Math.sqrt(dx * dx + dz * dz + dy * dy);
  }

  private inFrustum(level: number, ix: number, iz: number): boolean {
    const size = LEVEL_SIZES[level];
    const x0 = -WORLD_HALF + ix * size;
    const z0 = -WORLD_HALF + iz * size;
    _box.min.set(x0, -20, z0);
    _box.max.set(x0 + size, 350, z0 + size);
    return _frustum.intersectsBox(_box);
  }

  private want(level: number, ix: number, iz: number, dist: number): void {
    const key = nodeKey(level, ix, iz);
    this.wantedKeys.add(key);
    let n = this.nodes.get(key);
    if (!n) {
      const size = LEVEL_SIZES[level];
      n = {
        key,
        level,
        ix,
        iz,
        x0: -WORLD_HALF + ix * size,
        z0: -WORLD_HALF + iz * size,
        size,
        state: 'queued',
        mesh: null,
        classEnds: null,
        detailStart: 0,
        nearWater: false,
        lampPos: null,
        lampCol: null,
        lampRange: null,
        displayed: false,
        fade: 0,
        target: 1,
        fadeHandle: null,
        timedFrom: null,
        wanted: true,
        priority: 0,
        distance: dist,
        triangles: 0,
        buildings: 0,
        gen: 0,
        refreshing: false,
      };
      this.nodes.set(key, n);
    }
    n.distance = dist;
    n.priority = dist * (this.inFrustum(level, ix, iz) ? 1 : 3) * (level === 2 ? 0.8 : 1);
  }

  private select(cam: THREE.Vector3): void {
    const { drawDistance, split0, split1 } = this.params;
    this.wantedKeys.clear();
    const newSplit = new Set<number>();
    const s2 = LEVEL_SIZES[2];
    const n2 = (WORLD_HALF * 2) / s2;
    const i0 = Math.max(0, Math.floor((cam.x - drawDistance + WORLD_HALF) / s2));
    const i1 = Math.min(n2 - 1, Math.floor((cam.x + drawDistance + WORLD_HALF) / s2));
    const j0 = Math.max(0, Math.floor((cam.z - drawDistance + WORLD_HALF) / s2));
    const j1 = Math.min(n2 - 1, Math.floor((cam.z + drawDistance + WORLD_HALF) / s2));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!this.occupied(2, i, j)) {
          continue;
        }
        const d2 = this.tileDistance(2, i, j, cam);
        if (d2 > drawDistance) {
          continue;
        }
        const k2 = nodeKey(2, i, j);
        if (d2 < split1 * (this.splitKeys.has(k2) ? 1.12 : 1)) {
          newSplit.add(k2);
          for (let cj = 0; cj < 2; cj++) {
            for (let ci = 0; ci < 2; ci++) {
              const i1c = i * 2 + ci;
              const j1c = j * 2 + cj;
              if (!this.occupied(1, i1c, j1c)) {
                continue;
              }
              const d1 = this.tileDistance(1, i1c, j1c, cam);
              const k1 = nodeKey(1, i1c, j1c);
              if (d1 < split0 * (this.splitKeys.has(k1) ? 1.12 : 1)) {
                newSplit.add(k1);
                for (let gj = 0; gj < 2; gj++) {
                  for (let gi = 0; gi < 2; gi++) {
                    const i0c = i1c * 2 + gi;
                    const j0c = j1c * 2 + gj;
                    if (this.occupied(0, i0c, j0c)) {
                      this.want(0, i0c, j0c, this.tileDistance(0, i0c, j0c, cam));
                    }
                  }
                }
              } else {
                this.want(1, i1c, j1c, d1);
              }
            }
          }
        } else {
          this.want(2, i, j, d2);
        }
      }
    }
    this.splitKeys = newSplit;
    for (const n of this.nodes.values()) {
      n.wanted = this.wantedKeys.has(n.key);
      if (!n.wanted) {
        n.distance = this.tileDistance(n.level, n.ix, n.iz, cam);
      }
    }
  }

  /**
   * Per-pass ranges. Near tiles: shadows and water reflections skip the fine details. Far tiles: only the fade
   * classes that can still be visible; reflections keep the skyline (and large buildings near the water).
   * Tiles away from the water are skipped by the reflection pass. Mid tiles cast shadows only when close.
   */
  private refreshRanges(): void {
    const fade = this.params.classFade;
    for (const n of this.nodes.values()) {
      if (!n.mesh) {
        continue;
      }
      const c = n.mesh.geometry.userData as PassCounts;
      const total = n.triangles * 3;
      if (n.level === 2 && n.classEnds) {
        let count = 0;
        for (let k = 0; k < FADE_CLASS_COUNT; k++) {
          if (n.distance < fade[k] * CLASS_FADE_END) {
            count = n.classEnds[k];
          }
        }
        c.main = count;
        c.reflect = Math.min(count, n.classEnds[n.nearWater ? 1 : 0]);
        c.shadow = 0;
        n.mesh.visible = count > 0;
      } else {
        c.main = total;
        c.shadow = n.level === 0 ? n.detailStart : total;
        c.reflect = n.nearWater ? c.shadow : -1;
        n.mesh.castShadow = n.level === 0 || n.distance < this.params.shadowDistance;
      }
    }
  }

  private dispatch(): void {
    const queued: CityNode[] = [];
    for (const n of this.nodes.values()) {
      if (n.state === 'queued' && n.wanted) {
        queued.push(n);
      }
    }
    if (!queued.length) {
      return;
    }
    queued.sort((a, b) => a.priority - b.priority);
    const t0 = performance.now();
    let sent = 0;
    for (const n of queued) {
      // Near and mid tiles of the same 1 km square share a worker (warm cell-layout cache).
      const shift = n.level === 2 ? 0 : 1 - n.level;
      const route = (n.ix >> shift) * 7 + (n.iz >> shift) * 13 + n.level * 5;
      if (this.pool.load(route) >= MAX_PER_WORKER) {
        continue;
      }
      const win = this.cutter.cut(n.x0 - WINDOW_MARGIN, n.z0 - WINDOW_MARGIN, n.x0 + n.size + WINDOW_MARGIN, n.z0 + n.size + WINDOW_MARGIN);
      n.state = 'loading';
      const gen = n.gen;
      const exclude = this.cutter.excludedIn(n.x0, n.z0, n.x0 + n.size, n.z0 + n.size);
      this.pool.submit(route, { type: 'tile', level: n.level, ix: n.ix, iz: n.iz, densityScale: this.params.densityScale, win, exclude }, (res) => {
        if (res.type !== 'tile' || this.nodes.get(n.key) !== n || n.gen !== gen) {
          return;
        }
        this.lastJobMs = res.ms;
        this.pendingResults.set(n, res);
        this.results.push(n);
      });
      sent++;
      if (sent >= 4 || performance.now() - t0 > 1.5) {
        break;
      }
    }
  }

  private upload(budgetMs: number): void {
    if (!this.results.length) {
      return;
    }
    const t0 = performance.now();
    let count = 0;
    this.results.sort((a, b) => a.priority - b.priority);
    while (this.results.length && count < 3) {
      const n = this.results.shift()!;
      const res = this.pendingResults.get(n);
      this.pendingResults.delete(n);
      if (!res || this.nodes.get(n.key) !== n) {
        continue;
      }
      const old = n.refreshing ? n.mesh : null;
      if (old) {
        n.mesh = null;
      }
      this.buildMesh(n, res);
      n.state = 'ready';
      const h = n.refreshing ? this.handovers.find((q) => q.nodes.has(n)) : undefined;
      if (h) {
        // Held until the whole handover is ready (startHandover).
        h.held.set(n, old);
      } else if (n.refreshing) {
        this.swapRefreshed(n, old);
      }
      count++;
      if (performance.now() - t0 > budgetMs) {
        break;
      }
    }
    this.checkHandovers();
    this.refreshRanges();
  }

  private buildMesh(n: CityNode, res: TileResultMsg): void {
    n.lampPos = res.lampPos;
    n.lampCol = res.lampCol;
    n.buildings = res.buildings;
    n.classEnds = res.classEnds;
    n.detailStart = res.detailStart;
    n.nearWater = res.nearWater;
    const m = res.mesh;
    if (!m) {
      return;
    }
    const g = new THREE.BufferGeometry();
    const counts: PassCounts = { main: m.index.length, shadow: m.index.length, reflect: m.index.length };
    g.userData = counts;
    const release = function (this: THREE.BufferAttribute): void {
      (this as unknown as { array: ArrayLike<number> | null }).array = null;
    };
    const keep = this.keepCpuGeometry;
    const attr = (name: string, a: THREE.BufferAttribute): void => {
      if (!keep) {
        a.onUpload(release);
      }
      g.setAttribute(name, a);
    };
    attr('position', new THREE.BufferAttribute(m.position, 3));
    attr('normal', new THREE.BufferAttribute(m.normal, 4, true));
    attr('aFacade', new THREE.BufferAttribute(m.facade, 4, false));
    attr('aColor', new THREE.BufferAttribute(m.color, 4, false));
    attr('aParams', new THREE.BufferAttribute(m.params, 4, false));
    const index = new THREE.BufferAttribute(m.index, 1);
    if (!keep) {
      index.onUpload(release);
    }
    g.setIndex(index);
    const [sx, sy, sz, r] = res.sphere;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(sx, sy, sz), r);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(sx - r, sy - r, sz - r), new THREE.Vector3(sx + r, sy + r, sz + r));
    const mesh = new THREE.Mesh(g, this.materials.opaque);
    mesh.name = `city-L${n.level}-${n.ix}-${n.iz}`;
    mesh.position.set(n.x0 + n.size * 0.5, 0, n.z0 + n.size * 0.5);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.castShadow = n.level === 0 || (n.level === 1 && n.distance < this.params.shadowDistance);
    mesh.receiveShadow = true;
    // Opt-in for the cascaded shadow's height cull (render/sky/cascaded-shadow.ts): the tile sphere reaches ~350 m
    // up, the buildings rarely 60 m, so cascades whose receivers all lie above the roofs can skip the chunk.
    mesh.userData.shadowTop = res.top;
    mesh.onBeforeRender = this.beforeRender as unknown as THREE.Mesh['onBeforeRender'];
    mesh.onBeforeShadow = this.beforeShadow as unknown as THREE.Mesh['onBeforeShadow'];
    n.mesh = mesh;
    n.triangles = m.index.length / 3;
  }

  /**
   * Regenerates every chunk overlapping `rect` with the cutter's current exclusion list (an OSM region started or
   * stopped drawing there). Displayed chunks keep their mesh until the new one is uploaded, then swap in place.
   */
  refresh(rect: { minX: number; maxX: number; minZ: number; maxZ: number }): Promise<number> {
    const group = new Set<CityNode>();
    for (const n of this.nodes.values()) {
      if (n.x0 > rect.maxX || n.x0 + n.size < rect.minX || n.z0 > rect.maxZ || n.z0 + n.size < rect.minZ) {
        continue;
      }
      // A node still held by an earlier handover: start that one now (its new mesh is replaced below anyway).
      for (const h of this.handovers) {
        if (h.held.has(n) || h.nodes.has(n)) {
          this.startHandover(h);
        }
      }
      n.gen++;
      this.pendingResults.delete(n);
      if (n.state === 'ready') {
        n.refreshing = true;
        if (n.displayed) {
          group.add(n);
        }
      }
      n.state = 'queued';
    }
    // Only chunks on screen need a synchronised swap; the others simply come back with the new content.
    if (!group.size) {
      return Promise.resolve(performance.now());
    }
    return new Promise<number>((resolve) => {
      this.handovers.push({ nodes: group, held: new Map(), resolve });
    });
  }

  /** Swaps every held chunk of `h` at one instant: old meshes become fading ghosts, new ones fade in by time. */
  private startHandover(h: Handover): void {
    const i = this.handovers.indexOf(h);
    if (i < 0) {
      return;
    }
    this.handovers.splice(i, 1);
    const t0 = performance.now();
    for (const [n, old] of h.held) {
      n.refreshing = false;
      if (old && old !== n.mesh) {
        if (n.displayed && this.group.children.includes(old)) {
          const handle = this.materials.acquireFade();
          handle.fade.value = 1;
          handle.invert.value = 1;
          old.material = handle.material;
          this.ghosts.push({ mesh: old, handle, t0 });
        } else {
          this.group.remove(old);
          old.geometry.dispose();
        }
      }
      if (!n.displayed) {
        continue;
      }
      if (n.fadeHandle) {
        this.materials.releaseFade(n.fadeHandle);
        n.fadeHandle = null;
      }
      if (n.mesh) {
        n.fade = 0;
        n.target = 1;
        n.timedFrom = t0;
        this.group.add(n.mesh);
      }
      this.removeLamps(n);
      if (n.target > 0) {
        this.addLamps(n);
      }
    }
    h.resolve(t0);
  }

  /** Starts the handovers whose chunks are all built (or gone). */
  private checkHandovers(): void {
    for (const h of [...this.handovers]) {
      let ready = true;
      for (const n of h.nodes) {
        if (this.nodes.get(n.key) !== n || !n.displayed) {
          // Gone meanwhile (LOD change, dropped): its old mesh, still on screen, goes with it.
          const old = h.held.get(n);
          if (old && old !== n.mesh) {
            this.group.remove(old);
            old.geometry.dispose();
          }
          h.held.delete(n);
          h.nodes.delete(n);
          n.refreshing = false;
          continue;
        }
        if (!h.held.has(n)) {
          ready = false;
        }
      }
      if (ready) {
        this.startHandover(h);
      }
    }
  }

  /** Puts the freshly built mesh of a refreshed chunk in place of `old` (same fade state and lamps). */
  private swapRefreshed(n: CityNode, old: THREE.Mesh | null): void {
    n.refreshing = false;
    if (old && old !== n.mesh) {
      this.group.remove(old);
      old.geometry.dispose();
    }
    if (!n.displayed) {
      return;
    }
    if (n.mesh) {
      n.mesh.material = n.fadeHandle ? n.fadeHandle.material : this.materials.opaque;
      this.group.add(n.mesh);
    } else if (n.fadeHandle) {
      this.materials.releaseFade(n.fadeHandle);
      n.fadeHandle = null;
    }
    this.removeLamps(n);
    if (n.target > 0) {
      this.addLamps(n);
    }
  }

  private overlapsDisplayedStale(n: CityNode): boolean {
    let found = false;
    this.forOverlaps(n, (o) => {
      if (o.displayed && !o.wanted && o.target > 0) {
        found = true;
      }
    });
    return found;
  }

  /** Calls fn for every existing node that overlaps n at another level (ancestors and descendants). */
  private forOverlaps(n: CityNode, fn: (o: CityNode) => void): void {
    for (let l = n.level + 1; l < LEVEL_COUNT; l++) {
      const s = l - n.level;
      const o = this.nodes.get(nodeKey(l, n.ix >> s, n.iz >> s));
      if (o) {
        fn(o);
      }
    }
    for (let l = n.level - 1; l >= 0; l--) {
      const s = n.level - l;
      const span = 1 << s;
      for (let j = 0; j < span; j++) {
        for (let i = 0; i < span; i++) {
          const o = this.nodes.get(nodeKey(l, (n.ix << s) + i, (n.iz << s) + j));
          if (o) {
            fn(o);
          }
        }
      }
    }
  }

  private resolve(): void {
    for (const n of this.nodes.values()) {
      if (n.state !== 'ready' || !n.wanted) {
        continue;
      }
      if (n.displayed) {
        if (n.target === 0) {
          // Wanted again while fading out: reverse.
          n.target = 1;
          this.addLamps(n);
        }
        continue;
      }
      if (!this.overlapsDisplayedStale(n)) {
        this.show(n);
      }
    }
    const replacements = this.replacements;
    for (const f of this.nodes.values()) {
      if (!f.displayed || f.wanted || f.target === 0) {
        continue;
      }
      replacements.length = 0;
      let ready = true;
      this.forOverlaps(f, (o) => {
        if (o.wanted) {
          replacements.push(o);
          if (o.state !== 'ready') {
            ready = false;
          }
        }
      });
      if (!ready) {
        continue;
      }
      f.target = 0;
      this.removeLamps(f);
      for (const r of replacements) {
        if (!r.displayed) {
          this.show(r);
        } else if (r.target === 0) {
          r.target = 1;
          this.addLamps(r);
        }
      }
    }
    for (const [key, n] of this.nodes) {
      if (!n.wanted && !n.displayed) {
        this.disposeNode(n);
        this.nodes.delete(key);
        this.pendingResults.delete(n);
      }
    }
  }

  private show(n: CityNode): void {
    n.displayed = true;
    n.target = 1;
    if (n.mesh) {
      n.fade = 0;
      this.group.add(n.mesh);
    } else {
      n.fade = 1;
    }
    this.addLamps(n);
  }

  private addLamps(n: CityNode): void {
    if (!n.lampRange && n.lampPos && n.lampCol && n.lampPos.length) {
      n.lampRange = this.lamps.add(n.lampPos, n.lampCol);
    }
  }

  private removeLamps(n: CityNode): void {
    if (n.lampRange) {
      this.lamps.remove(n.lampRange);
      n.lampRange = null;
    }
  }

  private animate(dt: number): void {
    const step = Math.min(dt > 0 ? dt : 1 / 60, 0.1) / FADE_SECONDS;
    const now = performance.now();
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      const f = Math.min(1, (now - g.t0) / (FADE_SECONDS * 1000));
      g.handle.fade.value = 1 - f;
      if (f >= 1) {
        this.group.remove(g.mesh);
        g.mesh.geometry.dispose();
        this.materials.releaseFade(g.handle);
        this.ghosts.splice(i, 1);
      }
    }
    for (const n of this.nodes.values()) {
      if (n.timedFrom !== null) {
        // Handover: the same clock as the region fading in or out (osm/fade.ts).
        n.fade = Math.min(1, (now - n.timedFrom) / (FADE_SECONDS * 1000));
        if (n.fade >= 1) {
          n.timedFrom = null;
        }
      }
      if (!n.displayed) {
        continue;
      }
      if (!n.mesh) {
        if (n.target === 0) {
          n.displayed = false;
          this.removeLamps(n);
        }
        continue;
      }
      if (n.timedFrom === null && n.fade !== n.target) {
        n.fade = n.target > n.fade ? Math.min(1, n.fade + step) : Math.max(0, n.fade - step);
      }
      if (n.fade < 1) {
        if (!n.fadeHandle) {
          n.fadeHandle = this.materials.acquireFade();
          n.mesh.material = n.fadeHandle.material;
        }
        n.fadeHandle.fade.value = n.fade;
        n.fadeHandle.invert.value = n.target === 0 ? 1 : 0;
      } else if (n.fadeHandle) {
        this.materials.releaseFade(n.fadeHandle);
        n.fadeHandle = null;
        n.mesh.material = this.materials.opaque;
      }
      if (n.fade <= 0 && n.target === 0) {
        this.group.remove(n.mesh);
        n.displayed = false;
        if (n.fadeHandle) {
          this.materials.releaseFade(n.fadeHandle);
          n.fadeHandle = null;
          n.mesh.material = this.materials.opaque;
        }
        this.removeLamps(n);
      }
    }
  }

  private disposeNode(n: CityNode): void {
    if (n.mesh) {
      this.group.remove(n.mesh);
      n.mesh.geometry.dispose();
      n.mesh = null;
    }
    if (n.fadeHandle) {
      this.materials.releaseFade(n.fadeHandle);
      n.fadeHandle = null;
    }
    this.removeLamps(n);
  }

  clear(): void {
    for (const h of [...this.handovers]) {
      this.startHandover(h);
    }
    for (const g of this.ghosts) {
      this.group.remove(g.mesh);
      g.mesh.geometry.dispose();
      this.materials.releaseFade(g.handle);
    }
    this.ghosts.length = 0;
    for (const n of this.nodes.values()) {
      this.disposeNode(n);
    }
    this.nodes.clear();
    this.results.length = 0;
    this.pendingResults.clear();
    this.splitKeys.clear();
    this.framesSinceSelect = 1e9;
  }

  pending(): number {
    let n = 0;
    for (const node of this.nodes.values()) {
      if (node.refreshing && node.wanted) {
        n++;
      } else if (node.wanted && (!node.displayed || node.fade < 1)) {
        n++;
      } else if (!node.wanted && node.displayed) {
        n++;
      }
    }
    return n;
  }

  stats(): StreamStats {
    const byLevel = [0, 0, 0];
    const trisByLevel = [0, 0, 0];
    const buildingsByLevel = [0, 0, 0];
    let triangles = 0;
    let buildings = 0;
    let queued = 0;
    let loading = 0;
    let displayed = 0;
    for (const n of this.nodes.values()) {
      if (n.state === 'queued') {
        queued++;
      } else if (n.state === 'loading') {
        loading++;
      }
      if (n.displayed) {
        displayed++;
        byLevel[n.level]++;
        const t = n.mesh ? Math.max((n.mesh.geometry.userData as PassCounts).main, 0) / 3 : 0;
        trisByLevel[n.level] += t;
        buildingsByLevel[n.level] += n.buildings;
        triangles += t;
        buildings += n.buildings;
      }
    }
    return {
      nodes: this.nodes.size,
      displayed,
      byLevel,
      triangles,
      buildings,
      queued,
      loading,
      lamps: this.lamps.count,
      lastJobMs: Math.round(this.lastJobMs * 10) / 10,
      trisByLevel,
      buildingsByLevel,
      drawnMain: Math.round(this.drawnMain),
      drawnShadow: Math.round(this.drawnShadow),
      drawnOther: Math.round(this.drawnOther),
    };
  }
}

interface PassCounts {
  main: number;
  shadow: number;
  reflect: number;
}
