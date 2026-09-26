import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { type InstanceRec, loadGlb, type PropRef } from './format';
import {
  anyInFrustum,
  castsThroughProxy,
  type DrawListCache,
  fastSetGeometryAt,
  resetIndexRing,
  proxyMaterial,
  resetDrawLists,
  shadowOnly,
  shadowSideOf,
  lazyUpload,
  uploadWithinBudget,
  writeDrawList,
} from './tile-batches';

/** Distance policy of the props (from the quality preset). */
export interface PropDistances {
  /** Multiplies every prop's drawDistance. */
  distanceScale: number;
  personDistance: number;
  smallPropDistance: number;
  /** Multiplies the LOD switch distances. */
  lodBias: number;
}

interface PropPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
}

/** Props smaller than this (largest bounds extent, m) use the small-prop cull distance. */
const SMALL_PROP_M = 1.6;
/**
 * Props with fewer triangles per variant keep LOD0 at every distance: the saving is negligible and the decimated
 * levels lose small detail (the chalk menus' lettering turns to noise at LOD1).
 */
const MIN_LOD_TRIANGLES = 500;
/** Instances are re-evaluated (LOD, distance cull) after the camera moved this far (m). */
const REEVALUATE_M = 0.5;

/**
 * One draw batch: a BatchedMesh with one material for every prop part that uses it, across all live tiles. Buffers
 * grow on demand; geometries stay (props are shared), instances come and go with their tiles.
 */
class Batch {
  readonly mesh: THREE.BatchedMesh;
  private vertices = 0;
  private indices = 0;
  private maxVertices = 16384;
  private maxIndices = 49152;
  live = 0;
  /** Per instance: geometry, world bounding sphere (instances never move) and visibility, for the draw list. */
  private readonly instances: ({ geometryId: number; sphere: THREE.Sphere; visible: boolean; matrix: THREE.Matrix4 } | undefined)[] = [];
  private readonly drawLists: DrawListCache = new Map();
  private readonly sortDraws: boolean;
  /** Ids of the visible instances (rebuilt when visibility changed), so culling skips the hidden thousands. */
  private visibleIds: number[] | null = null;
  /** Drawn since its buffers were (re)allocated. */
  private warm = false;

  constructor(key: string, material: THREE.Material, castShadow: boolean, receiveShadow: boolean) {
    this.mesh = new THREE.BatchedMesh(256, this.maxVertices, this.maxIndices, material);
    this.mesh.name = `props:${key}`;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = receiveShadow;
    // The batch spans the whole area: it is drawn when one of its visible instances is in the frustum, and each
    // instance is culled against the camera (and the shadow camera) in the draw list.
    this.mesh.frustumCulled = true;
    // Until its first draw after (re)allocation it is always drawn, so its buffers upload while its props are hidden.
    this.mesh.intersectsFrustum = (frustum: THREE.Frustum | THREE.FrustumArray): boolean => !this.warm || anyInFrustum(this.instances, frustum as THREE.Frustum, this.visible());
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.sortObjects = true;
    this.mesh.matrixAutoUpdate = false;
    // Only transparent parts need depth order; opaque ones are drawn in placement order.
    this.sortDraws = material.transparent;
    this.mesh.onBeforeRender = (_r, _s, camera, geometry, m) => this.cull(camera, geometry, m);
    this.mesh.onBeforeShadow = (_r, _o, _c, shadowCamera, geometry, m) => this.cull(shadowCamera, geometry, m);
    this.mesh.setGeometryAt = (geometryId: number, geometry: THREE.BufferGeometry) => fastSetGeometryAt(this.mesh, geometryId, geometry);
  }

  /** Ids of the visible instances (rebuilt after visibility changed). */
  private visible(): number[] {
    if (!this.visibleIds) {
      this.visibleIds = [];
      this.instances.forEach((inst, id) => inst?.visible && this.visibleIds!.push(id));
    }
    return this.visibleIds;
  }

  private cull(camera: THREE.Camera, geometry: THREE.BufferGeometry, material: THREE.Material): void {
    this.warm = true;
    const cascade = (camera as THREE.OrthographicCamera).isOrthographicCamera ? (this.mesh.userData.shadowFrustum as THREE.Frustum | undefined) : undefined;
    writeDrawList(this.mesh, camera, geometry, material, this.instances, this.sortDraws, this.drawLists, this.visible(), false, cascade);
  }

  /** Shows an instance with the given geometry, or hides it (geometry < 0). */
  show(id: number, geometryId: number): void {
    const inst = this.instances[id]!;
    if (inst.visible !== geometryId >= 0) {
      this.visibleIds = null;
    }
    if (geometryId < 0) {
      inst.visible = false;
      return;
    }
    if (inst.geometryId !== geometryId) {
      this.mesh.setGeometryIdAt(id, geometryId);
      inst.geometryId = geometryId;
      this.mesh.getBoundingSphereAt(geometryId, inst.sphere)!.applyMatrix4(inst.matrix);
    }
    inst.visible = true;
  }

  addGeometry(g: THREE.BufferGeometry): number {
    const v = g.attributes.position.count;
    const i = g.index!.count;
    if (this.vertices + v > this.maxVertices || this.indices + i > this.maxIndices) {
      this.maxVertices = Math.max(this.maxVertices * 2, this.vertices + v);
      this.maxIndices = Math.max(this.maxIndices * 2, this.indices + i);
      this.mesh.setGeometrySize(this.maxVertices, this.maxIndices);
      resetIndexRing(this.mesh);
      this.warm = false;
    }
    const id = this.mesh.addGeometry(g);
    // Its buffers (new after setGeometrySize) upload only their filled part when created.
    lazyUpload(this.mesh);
    this.vertices += v;
    this.indices += i;
    return id;
  }

  addInstance(geometryId: number, matrix: THREE.Matrix4): number {
    if (this.live >= this.mesh.maxInstanceCount) {
      this.mesh.setInstanceCount(this.mesh.maxInstanceCount * 2);
      resetDrawLists(this.drawLists);
    }
    const id = this.mesh.addInstance(geometryId);
    this.mesh.setMatrixAt(id, matrix);
    this.mesh.setVisibleAt(id, false);
    const sphere = this.mesh.getBoundingSphereAt(geometryId, new THREE.Sphere())!.applyMatrix4(matrix);
    this.instances[id] = { geometryId, sphere, visible: false, matrix: matrix.clone() };
    this.live++;
    return id;
  }

  deleteInstance(id: number): void {
    this.mesh.deleteInstance(id);
    if (this.instances[id]?.visible) {
      this.visibleIds = null;
    }
    this.instances[id] = undefined;
    this.live--;
  }
}

/** One (prop, variant): its switch distances and, per batch it draws into, the geometry of each LOD level. */
interface Model {
  key: string;
  /** Distance from which each level index is drawn (unscaled); [0, d1, d2, ...]. */
  switchAt: number[];
  slots: { batch: Batch; geometry: number[] }[];
  kind: 'person' | 'small' | 'other';
  drawDistance: number;
}

interface Placed {
  model: Model;
  x: number;
  z: number;
  /** Level index drawn, or -1 (culled). */
  level: number;
  /** Instance id per model slot. */
  ids: number[];
}

interface TileProps {
  placed: Placed[];
  /** Placed but not drawn (the tile is loaded ahead and not shown yet). */
  hidden: boolean;
  /** Instances whose prop is still loading, keyed by asset. */
  waiting: Map<string, InstanceRec[]>;
}

interface AssetState {
  state: 'loading' | 'ready' | 'failed';
  /** Loaded scene per level index (LOD0 first). */
  scenes: THREE.Object3D[];
  switchAt: number[];
  models: Map<string, Model | null>;
  attempts: number;
  retryAt: number;
}

export interface PropStats {
  batches: number;
  placed: number;
  visible: number;
  waiting: number;
  /** Visible instances per LOD level index. */
  levels: number[];
}

/** Whether a material can be baked into the shared vertex-colour material (untextured, opaque, not glowing). */
function isFlat(m: THREE.Material): boolean {
  const s = m as THREE.MeshStandardMaterial;
  return (
    s.isMeshStandardMaterial === true &&
    !s.map &&
    !s.normalMap &&
    !s.roughnessMap &&
    !s.metalnessMap &&
    !s.aoMap &&
    !s.emissiveMap &&
    !s.alphaMap &&
    !s.transparent &&
    s.alphaTest === 0 &&
    s.side === THREE.FrontSide &&
    !m.userData.emissive &&
    s.emissive.r + s.emissive.g + s.emissive.b === 0
  );
}

/** Untextured prop parts share one material; colour, roughness and metalness travel as vertex attributes. */
function createFlatMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'props-flat', vertexColors: true, roughness: 1, metalness: 0 });
  // The host's default hook runs first (the flight game injects its global uniforms there: without them the
  // atmosphere's samplers stay unbound and clash with the BatchedMesh data textures).
  m.onBeforeCompile = function (shader, renderer) {
    THREE.Material.prototype.onBeforeCompile.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 roughMetal;\nvarying vec2 vRoughMetal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoughMetal = roughMetal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoughMetal;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRoughMetal.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRoughMetal.y;');
  };
  return m;
}

/**
 * Merges prop parts into one indexed geometry in the prop's frame (part transforms baked). `flat` bakes each part's
 * material into `color` and `roughMetal`; otherwise `uv` and, when `color` is set, vertex colours are kept.
 */
function mergeParts(parts: PropPart[], opts: { flat: boolean; color: boolean }): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const p of parts) {
    vCount += p.geometry.attributes.position.count;
    iCount += p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = opts.flat ? null : new Float32Array(vCount * 2);
  const col = opts.flat || opts.color ? new Float32Array(vCount * 3) : null;
  const rm = opts.flat ? new Float32Array(vCount * 2) : null;
  const idx = new Uint32Array(iCount);
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const g = p.geometry;
    const P = g.attributes.position;
    const N = g.attributes.normal as THREE.BufferAttribute | undefined;
    const U = g.attributes.uv as THREE.BufferAttribute | undefined;
    const C = g.attributes.color as THREE.BufferAttribute | undefined;
    const s = p.material as THREE.MeshStandardMaterial;
    const base = opts.flat ? s.color : null;
    nm.getNormalMatrix(p.matrix);
    for (let i = 0; i < P.count; i++) {
      const o = vo + i;
      v.fromBufferAttribute(P, i).applyMatrix4(p.matrix);
      pos[o * 3] = v.x;
      pos[o * 3 + 1] = v.y;
      pos[o * 3 + 2] = v.z;
      if (N) {
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      } else {
        v.set(0, 1, 0);
      }
      nor[o * 3] = v.x;
      nor[o * 3 + 1] = v.y;
      nor[o * 3 + 2] = v.z;
      if (uv) {
        uv[o * 2] = U ? U.getX(i) : 0;
        uv[o * 2 + 1] = U ? U.getY(i) : 0;
      }
      if (col) {
        col[o * 3] = (C ? C.getX(i) : 1) * (base ? base.r : 1);
        col[o * 3 + 1] = (C ? C.getY(i) : 1) * (base ? base.g : 1);
        col[o * 3 + 2] = (C ? C.getZ(i) : 1) * (base ? base.b : 1);
      }
      if (rm) {
        rm[o * 2] = s.roughness ?? 1;
        rm[o * 2 + 1] = s.metalness ?? 0;
      }
    }
    const I = g.index;
    const n = I ? I.count : P.count;
    const mirrored = p.matrix.determinant() < 0;
    for (let j = 0; j + 2 < n; j += 3) {
      const a = I ? I.getX(j) : j;
      const b = I ? I.getX(j + 1) : j + 1;
      const c = I ? I.getX(j + 2) : j + 2;
      idx[io + j] = vo + a;
      idx[io + j + 1] = vo + (mirrored ? c : b);
      idx[io + j + 2] = vo + (mirrored ? b : c);
    }
    vo += P.count;
    io += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) {
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  if (col) {
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  if (rm) {
    out.setAttribute('roughMetal', new THREE.BufferAttribute(rm, 2));
  }
  out.setIndex(new THREE.BufferAttribute(vCount > 65535 ? idx : Uint16Array.from(idx), 1));
  return out;
}

function collectParts(root: THREE.Object3D): PropPart[] {
  const parts: PropPart[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      parts.push({ geometry: mesh.geometry, material: mesh.material as THREE.Material, matrix: mesh.matrixWorld.clone() });
    }
  });
  return parts;
}

/**
 * Street props of format 1 (index.props) for the whole loaded area: every prop part is drawn through a handful of
 * BatchedMeshes (one per material; the untextured parts of every prop share one vertex-colour material), so the draw
 * calls do not grow with tiles, props or variants. Each instance picks its LOD level (props[id].lods, with
 * hysteresis) and is culled by distance (drawDistance, with tighter caps for people and small props); the batches
 * cull the remaining instances against the camera and the sun's shadow camera per instance. Casting props draw into the
 * shadow maps through position-only proxy batches (one per shadow side, tile-batches.ts shadowOnly), not per material.
 * Loads that fail (e.g. a file being rewritten by the compiler) are retried with backoff.
 */
export class PropBatches {
  readonly group = new THREE.Group();
  private readonly assets = new Map<string, AssetState>();
  private readonly tiles = new Map<string, TileProps>();
  private readonly batches = new Map<string, Batch>();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly flatMaterial = createFlatMaterial();
  private readonly warned = new Set<string>();
  private readonly matrix = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private lastX = NaN;
  private lastZ = NaN;
  private dirty = true;
  private visibleCount = 0;
  private levelCounts: number[] = [];
  /** Bumped when instances are placed or removed (the sandbox re-renders the shadow map then). */
  version = 0;
  /** LOD or cull switches so far. */
  lodChanges = 0;
  /** Batches waiting for their program, or for their textures' upload, before they join the scene. */
  private compiling = 0;
  /** Compiled batches that join the scene once their textures fit the frame's upload budget (textureBudget). */
  private readonly joinQueue: Batch[] = [];
  /** Object layer of every prop batch (e.g. one a planar reflection camera skips). */
  layer = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly refs: Readonly<Record<string, PropRef>>,
    private readonly loader: GLTFLoader,
    private distances: PropDistances,
    private shadows: boolean,
    /** Called once per material of a newly loaded prop (emissive bookkeeping). */
    private readonly onMaterial: (m: THREE.Material) => void,
    /** Called before a batch with a new material is first drawn (e.g. renderer.compileAsync). */
    private readonly compile?: (o: THREE.Object3D) => Promise<unknown>,
    /**
     * Uploads a texture (e.g. `(t) => renderer.initTexture(t)`): a new batch's textures are uploaded within the frame's
     * budget before it joins the scene, instead of all at once by its first draw.
     */
    private readonly initTexture?: (texture: THREE.Texture) => void,
  ) {
    this.group.name = 'props';
    this.group.matrixAutoUpdate = false;
  }

  setDistances(d: PropDistances): void {
    this.distances = d;
    this.dirty = true;
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    for (const b of this.batches.values()) {
      b.mesh.castShadow = on && b.mesh.userData.castShadow === true;
      b.mesh.receiveShadow = on;
    }
  }

  /** Places a tile's instances (props load on first use). */
  addTile(tileId: string, instances: readonly InstanceRec[]): void {
    this.removeTile(tileId);
    // Hidden until the owner shows the tile (setTileVisible).
    const tile: TileProps = { placed: [], waiting: new Map(), hidden: true };
    this.tiles.set(tileId, tile);
    for (const inst of instances) {
      if (!this.refs[inst.asset]) {
        this.warnOnce(`asset:${inst.asset}`, `[street] unknown prop '${inst.asset}' (index older than the tile manifest?)`);
        continue;
      }
      let list = tile.waiting.get(inst.asset);
      if (!list) {
        list = [];
        tile.waiting.set(inst.asset, list);
      }
      list.push(inst);
    }
    for (const asset of tile.waiting.keys()) {
      this.ensureAsset(asset);
    }
    this.flush();
  }

  removeTile(tileId: string): void {
    const tile = this.tiles.get(tileId);
    if (!tile) {
      return;
    }
    for (const pl of tile.placed) {
      pl.model.slots.forEach((slot, k) => slot.batch.deleteInstance(pl.ids[k]));
    }
    this.tiles.delete(tileId);
    this.dirty = true;
    this.version++;
  }

  /** Shows or hides a tile's props (e.g. loaded ahead of the tile's fade-in). */
  setTileVisible(tileId: string, visible: boolean): void {
    const tile = this.tiles.get(tileId);
    if (tile && tile.hidden === visible) {
      tile.hidden = !visible;
      this.dirty = true;
    }
  }

  /** Moves compiled batches into the scene, their textures uploaded within the frame's budget. */
  private join(): void {
    while (this.joinQueue.length) {
      const b = this.joinQueue[0];
      if (this.initTexture && !uploadWithinBudget(b.mesh.material as THREE.Material, this.initTexture)) {
        return;
      }
      this.joinQueue.shift();
      this.compiling--;
      this.group.add(b.mesh);
    }
  }

  /** Whether the tile still waits for props that are loading (props in failure backoff do not count). */
  isPending(tileId: string): boolean {
    const tile = this.tiles.get(tileId);
    if (!tile) {
      return false;
    }
    if (this.compiling > 0) {
      return true;
    }
    for (const asset of tile.waiting.keys()) {
      if (this.assets.get(asset)?.state === 'loading') {
        return true;
      }
    }
    return false;
  }

  /** LOD and distance culling of every instance; cheap unless the camera moved or instances changed. */
  update(x: number, z: number): void {
    this.join();
    const now = performance.now();
    for (const [id, a] of this.assets) {
      if (a.state === 'failed' && now >= a.retryAt && this.isWanted(id)) {
        this.loadAsset(id, a);
      }
    }
    if (!this.dirty && Math.hypot(x - this.lastX, z - this.lastZ) < REEVALUATE_M) {
      return;
    }
    this.dirty = false;
    this.lastX = x;
    this.lastZ = z;
    const bias = this.distances.lodBias;
    let visible = 0;
    let changed = 0;
    const levels: number[] = [];
    for (const tile of this.tiles.values()) {
      for (const pl of tile.placed) {
        const m = pl.model;
        const sw = m.switchAt;
        const d = Math.hypot(pl.x - x, pl.z - z);
        const maxD = tile.hidden ? -1 : this.cullDistance(m);
        let k = pl.level;
        if (k < 0) {
          if (d < maxD) {
            k = 0;
            while (k + 1 < sw.length && d >= sw[k + 1] * bias) {
              k++;
            }
          }
        } else if (d > maxD + 2) {
          k = -1;
        } else {
          while (k + 1 < sw.length && d >= sw[k + 1] * bias * 1.08 + 0.5) {
            k++;
          }
          while (k > 0 && d < sw[k] * bias * 0.92 - 0.5) {
            k--;
          }
        }
        if (k !== pl.level) {
          this.show(pl, k);
          changed++;
        }
        if (k >= 0) {
          visible++;
          levels[k] = (levels[k] ?? 0) + 1;
        }
      }
    }
    this.visibleCount = visible;
    this.levelCounts = Array.from(levels, (n) => n ?? 0);
    this.lodChanges += changed;
  }

  stats(): PropStats {
    let placed = 0;
    let waiting = 0;
    for (const t of this.tiles.values()) {
      placed += t.placed.length;
      for (const l of t.waiting.values()) {
        waiting += l.length;
      }
    }
    return { batches: this.batches.size, placed, visible: this.visibleCount, waiting, levels: this.levelCounts };
  }

  dispose(): void {
    for (const b of this.batches.values()) {
      b.mesh.dispose();
    }
    this.batches.clear();
    this.tiles.clear();
    this.flatMaterial.dispose();
  }

  private cullDistance(m: Model): number {
    const d = this.distances;
    const base = m.drawDistance * d.distanceScale;
    return m.kind === 'person' ? Math.min(base, d.personDistance) : m.kind === 'small' ? Math.min(base, d.smallPropDistance) : base;
  }

  private show(pl: Placed, k: number): void {
    pl.model.slots.forEach((slot, s) => slot.batch.show(pl.ids[s], k >= 0 ? slot.geometry[k] : -1));
    pl.level = k;
  }

  private isWanted(asset: string): boolean {
    for (const t of this.tiles.values()) {
      if (t.waiting.has(asset)) {
        return true;
      }
    }
    return false;
  }

  private warnOnce(key: string, msg: string): void {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      console.warn(msg);
    }
  }

  private ensureAsset(id: string): void {
    if (!this.assets.has(id)) {
      const a: AssetState = { state: 'loading', scenes: [], switchAt: [], models: new Map(), attempts: 0, retryAt: 0 };
      this.assets.set(id, a);
      this.loadAsset(id, a);
    }
  }

  private loadAsset(id: string, a: AssetState): void {
    const ref = this.refs[id];
    const useLods = ref.triangles / Math.max(1, ref.variants?.length ?? 1) >= MIN_LOD_TRIANGLES;
    const lods = useLods ? [...(ref.lods ?? [])].sort((x, y) => x.distance - y.distance) : [];
    const levels = [{ glb: ref.glb, distance: 0 }, ...lods];
    const base = new URL(this.baseUrl, window.location.href);
    a.state = 'loading';
    Promise.all(levels.map((l) => loadGlb(this.loader, new URL(l.glb, base).href)))
      .then((gltfs) => {
        a.scenes = gltfs.map((g) => {
          g.scene.updateMatrixWorld(true);
          return g.scene;
        });
        a.switchAt = levels.map((l) => l.distance);
        a.models.clear();
        a.state = 'ready';
        a.attempts = 0;
        this.flush();
      })
      .catch((err: unknown) => {
        a.attempts++;
        a.state = 'failed';
        a.retryAt = performance.now() + Math.min(30000, 1000 * 2 ** a.attempts);
        if (a.attempts === 1 || a.attempts % 10 === 0) {
          console.warn(`[street] prop ${id} failed (attempt ${a.attempts}, will retry): ${String((err as Error)?.message ?? err).slice(0, 120)}`);
        }
      });
  }

  /** Places every waiting instance whose prop is ready. */
  private flush(): void {
    const fresh = new Set<Batch>();
    for (const tile of this.tiles.values()) {
      for (const [asset, list] of tile.waiting) {
        const a = this.assets.get(asset);
        if (a?.state !== 'ready') {
          continue;
        }
        tile.waiting.delete(asset);
        for (const inst of list) {
          const model = this.model(asset, inst.variant ?? '', a, fresh);
          if (model) {
            tile.placed.push(this.place(model, inst));
          }
        }
      }
    }
    for (const b of fresh) {
      if (this.compile) {
        // Joins the scene once its program is compiled (it would otherwise link synchronously on its first draw).
        this.compiling++;
        void this.compile(b.mesh)
          .catch(() => undefined)
          .then(() => this.joinQueue.push(b));
      } else {
        this.compiling++;
        this.joinQueue.push(b);
      }
    }
    this.dirty = true;
    this.version++;
  }

  private place(model: Model, inst: InstanceRec): Placed {
    this.p.set(inst.position[0], inst.position[1], inst.position[2]);
    this.q.set(inst.rotation[0], inst.rotation[1], inst.rotation[2], inst.rotation[3]);
    const sc = inst.scale ?? 1;
    if (typeof sc === 'number') {
      this.s.setScalar(sc);
    } else {
      this.s.set(sc[0], sc[1], sc[2]);
    }
    this.matrix.compose(this.p, this.q, this.s);
    const ids = model.slots.map((slot) => slot.batch.addInstance(slot.geometry.find((g) => g >= 0)!, this.matrix));
    return { model, x: inst.position[0], z: inst.position[2], level: -1, ids };
  }

  /**
   * The shadow proxy batch of one shadow side: every casting prop's parts merged into positions only, so the cascades
   * draw one batch per side instead of every casting material.
   */
  private proxyBatch(side: THREE.Side, fresh: Set<Batch>): Batch {
    const key = `shadow|${side}`;
    let b = this.batches.get(key);
    if (!b) {
      b = new Batch(key, proxyMaterial(side), this.shadows, false);
      // Prop shadows are small: the near cascades only.
      shadowOnly(b.mesh, false);
      b.mesh.castShadow = this.shadows;
      b.mesh.userData.castShadow = true;
      b.mesh.layers.set(this.layer);
      this.batches.set(key, b);
      fresh.add(b);
    }
    return b;
  }

  private batch(key: string, material: THREE.Material, cast: boolean, fresh: Set<Batch>): Batch {
    let b = this.batches.get(key);
    if (!b) {
      b = new Batch(key, material, this.shadows && cast, this.shadows);
      b.mesh.userData.castShadow = cast;
      b.mesh.layers.set(this.layer);
      this.batches.set(key, b);
      fresh.add(b);
    }
    return b;
  }

  private sharedMaterial(m: THREE.Material): THREE.Material {
    let shared = this.materials.get(m.name);
    if (!shared) {
      shared = m;
      // Double-sided glass and the like in one pass instead of two (back then front faces).
      m.forceSinglePass = true;
      this.materials.set(m.name, m);
      this.onMaterial(m);
    }
    return shared;
  }

  /** Builds (once) the batches' geometries of one prop variant, for every LOD level. */
  private model(asset: string, variant: string, a: AssetState, fresh: Set<Batch>): Model | null {
    const key = `${asset}|${variant}`;
    if (a.models.has(variant)) {
      return a.models.get(variant)!;
    }
    const ref = this.refs[asset];
    const roots = a.scenes.map((scene) => (variant ? scene.children.find((c) => c.name === variant) : scene));
    if (!roots[0]) {
      this.warnOnce(key, `[street] prop '${asset}' has no variant '${variant}'`);
      a.models.set(variant, null);
      return null;
    }
    const cast = ref.castShadow;
    const slots = new Map<Batch, number[]>();
    const levels = a.scenes.length;
    const put = (b: Batch, level: number, g: THREE.BufferGeometry) => {
      let ids = slots.get(b);
      if (!ids) {
        ids = new Array<number>(levels).fill(-1);
        slots.set(b, ids);
      }
      ids[level] = b.addGeometry(g);
    };
    roots.forEach((root, level) => {
      if (!root) {
        return;
      }
      const parts = collectParts(root);
      // Casters without cut-outs cast through the shadow proxies; the others from their own batch.
      const bySide = new Map<THREE.Side, PropPart[]>();
      for (const p of cast ? parts.filter((q) => castsThroughProxy(q.material)) : []) {
        const side = shadowSideOf(p.material);
        bySide.set(side, [...(bySide.get(side) ?? []), p]);
      }
      for (const [side, list] of bySide) {
        const g = mergeParts(list, { flat: false, color: false });
        g.deleteAttribute('normal');
        g.deleteAttribute('uv');
        put(this.proxyBatch(side, fresh), level, g);
      }
      const flat = parts.filter((p) => isFlat(p.material));
      if (flat.length) {
        put(this.batch('flat|noshadow', this.flatMaterial, false, fresh), level, mergeParts(flat, { flat: true, color: false }));
      }
      const byMaterial = new Map<string, PropPart[]>();
      for (const p of parts) {
        if (!isFlat(p.material)) {
          const list = byMaterial.get(p.material.name) ?? [];
          list.push(p);
          byMaterial.set(p.material.name, list);
        }
      }
      for (const [name, list] of byMaterial) {
        const material = this.sharedMaterial(list[0].material);
        const color = (material as THREE.MeshStandardMaterial).vertexColors === true;
        const own = cast && !castsThroughProxy(material);
        put(this.batch(`${name}${own ? '' : '|noshadow'}`, material, own, fresh), level, mergeParts(list, { flat: false, color }));
      }
    });
    // A level missing from a batch falls back to the next finer one (LOD glbs share nodes and materials).
    for (const ids of slots.values()) {
      for (let k = 1; k < ids.length; k++) {
        if (ids[k] < 0) {
          ids[k] = ids[k - 1];
        }
      }
    }
    const b = ref.bounds;
    const extent = b ? Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) : Infinity;
    const kind: Model['kind'] = /person|mannequin/.test(asset) ? 'person' : extent < SMALL_PROP_M ? 'small' : 'other';
    const model: Model | null = slots.size
      ? { key, switchAt: a.switchAt, slots: [...slots].map(([batch, geometry]) => ({ batch, geometry })), kind, drawDistance: ref.drawDistance }
      : null;
    a.models.set(variant, model);
    return model;
  }
}
