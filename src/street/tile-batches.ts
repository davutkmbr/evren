import * as THREE from 'three';
import { FadeTable, STREET_DITHER_GLSL } from './fade';

/**
 * Shadow cameras wider than this (m) draw only the large casters' proxies (walls, roofs, timber and glass):
 * with four cascades (about 110, 430, 1600 and 4900 m wide) the first two, which cover the view up to ~180 m, get
 * every caster and the far ones only the big ones.
 */
const FAR_CASCADE_WIDTH = 1000;
/** Surfaces (material extras `surface`) whose shadows reach the far cascades; format 0 tiles have none (all do). */
const LARGE_CASTER_SURFACES = new Set(['wall', 'roof', 'wood', 'glass']);
const INITIAL_VERTICES = 65536;
const INITIAL_INDICES = 196608;
/** Space reserved per geometry relative to its size, so a later tile's geometry often fits a freed range. */
const SLACK = 1.25;
/** A new batch is sized for this many tiles like its first one. */
const PRESIZE_TILES = 12;

/** One mesh of a loaded tile. */
export interface TilePart {
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}

interface Layout {
  color: boolean;
  uv1: boolean;
  /**
   * Merged material group: each part's base colour (times its vertex colour), roughness and metalness are baked into
   * `color` (uint16, colour / COLOR_RANGE) and `roughMetal` attributes.
   */
  baked: boolean;
  /** Merged emissive group: emissive colour x intensity baked into an `emissiveRGB` attribute. */
  emissive: boolean;
}

type AnyAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function rawArray(a: AnyAttribute): THREE.TypedArray {
  return (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data.array : (a as THREE.BufferAttribute).array;
}

const _v = new THREE.Vector3();

/** Bounding sphere (of the bounding box) of normalized int16 positions, from the raw values. */
function int16Bounds(p: Int16Array): THREE.Sphere {
  let x0 = 32767;
  let y0 = 32767;
  let z0 = 32767;
  let x1 = -32768;
  let y1 = -32768;
  let z1 = -32768;
  for (let i = 0; i < p.length; i += 3) {
    x0 = Math.min(x0, p[i]);
    x1 = Math.max(x1, p[i]);
    y0 = Math.min(y0, p[i + 1]);
    y1 = Math.max(y1, p[i + 1]);
    z0 = Math.min(z0, p[i + 2]);
    z1 = Math.max(z1, p[i + 2]);
  }
  const k = 1 / 32767;
  const box = new THREE.Box3(new THREE.Vector3(Math.max(-1, x0 * k), Math.max(-1, y0 * k), Math.max(-1, z0 * k)), new THREE.Vector3(x1 * k, y1 * k, z1 * k));
  return box.getBoundingSphere(new THREE.Sphere());
}

function indexOf(g: THREE.BufferGeometry): THREE.BufferAttribute {
  if (g.index) {
    return g.index;
  }
  const n = g.attributes.position.count;
  const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    idx[i] = i;
  }
  return new THREE.BufferAttribute(idx, 1);
}

/** Direct reads of an attribute's components (interleaved or not), normalized integers mapped to [-1, 1] / [0, 1]. */
interface Reader {
  array: THREE.TypedArray;
  stride: number;
  offset: number;
  itemSize: number;
  scale: number;
  signed: boolean;
}

function readerOf(a: AnyAttribute): Reader {
  const inter = (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute;
  const array = rawArray(a);
  const bits: Record<string, number> = { Int8Array: 127, Uint8Array: 255, Int16Array: 32767, Uint16Array: 65535, Int32Array: 2147483647, Uint32Array: 4294967295 };
  const max = a.normalized ? (bits[array.constructor.name] ?? 1) : 1;
  return {
    array,
    stride: inter ? (a as THREE.InterleavedBufferAttribute).data.stride : a.itemSize,
    offset: inter ? (a as THREE.InterleavedBufferAttribute).offset : 0,
    itemSize: a.itemSize,
    scale: 1 / max,
    signed: array instanceof Int8Array || array instanceof Int16Array || array instanceof Int32Array,
  };
}

function read(r: Reader, i: number, k: number): number {
  const v = r.array[i * r.stride + r.offset + k] * r.scale;
  return r.signed && r.scale !== 1 ? Math.max(v, -1) : v;
}

/** Vertices converted per step of a CanonicalJob (a tile's interior primitive has 200k+). */
const CHUNK_VERTICES = 32768;
/** Baked colours are stored as unsigned 16-bit normalized values of colour / COLOR_RANGE (graded albedos exceed 1). */
const COLOR_RANGE = 4;

/**
 * Converts a tile primitive into its batch's layout, a chunk of vertices per step so a large primitive is spread over
 * frames: int16 positions and normals, float uv, colours (uint8 RGBA, white where a primitive has none, when the
 * material uses vertex colours; or the merged groups' baked colour, roughness, metalness and emissive), uv1 only when
 * a map reads it. Attributes the game does not read (the compiler's lightmap uv1, `_WEATHER`) are left out.
 */
class CanonicalJob {
  private readonly n: number;
  private done = 0;
  private readonly pos: Int16Array;
  private readonly nor = new Int16Array(0);
  private readonly uv: Float32Array[] = [];
  private readonly color: Uint8Array | Uint16Array | null = null;
  private readonly roughMetal: Uint8Array | null = null;
  private readonly emissive: Float32Array | null = null;
  private readonly readers: { pos: Reader; nor: Reader | null; uv: (Reader | null)[]; color: Reader | null };
  /** Float positions: quantization centre and half extent. */
  private readonly quant: { c: THREE.Vector3; h: number } | null = null;
  private readonly factors: { color: THREE.Color; rough: number; metal: number; emissive: THREE.Color };

  constructor(
    readonly part: TilePart,
    private readonly layout: Layout,
  ) {
    const src = part.geometry;
    const pos = src.attributes.position as AnyAttribute;
    const n = (this.n = pos.count);
    this.pos = new Int16Array(n * 3);
    this.nor = new Int16Array(n * 3);
    const std = part.material as THREE.MeshStandardMaterial;
    const colorAttr = src.attributes.color as AnyAttribute | undefined;
    const useColor = layout.baked ? std.vertexColors && !!colorAttr : layout.color && !!colorAttr;
    this.readers = {
      pos: readerOf(pos),
      nor: src.attributes.normal ? readerOf(src.attributes.normal as AnyAttribute) : null,
      uv: (layout.uv1 ? ['uv', 'uv1'] : ['uv']).map((k) => (src.attributes[k] ? readerOf(src.attributes[k] as AnyAttribute) : null)),
      color: useColor ? readerOf(colorAttr!) : null,
    };
    this.uv = this.readers.uv.map(() => new Float32Array(n * 2));
    if (layout.baked) {
      this.color = new Uint16Array(n * 4);
      this.roughMetal = new Uint8Array(n * 2);
      this.emissive = layout.emissive ? new Float32Array(n * 3) : null;
    } else if (layout.color) {
      this.color = new Uint8Array(n * 4);
    }
    this.factors = {
      color: std.color ?? new THREE.Color(1, 1, 1),
      rough: Math.round(THREE.MathUtils.clamp(std.roughness ?? 1, 0, 1) * 255),
      metal: Math.round(THREE.MathUtils.clamp(std.metalness ?? 0, 0, 1) * 255),
      emissive: std.emissive ? std.emissive.clone().multiplyScalar(std.emissiveIntensity ?? 1) : new THREE.Color(0, 0, 0),
    };
    if (!(rawArray(pos) instanceof Int16Array && pos.normalized)) {
      const box = new THREE.Box3();
      for (let i = 0; i < n; i++) {
        box.expandByPoint(_v.fromBufferAttribute(pos, i));
      }
      const size = box.getSize(new THREE.Vector3());
      this.quant = { c: box.getCenter(new THREE.Vector3()), h: Math.max(size.x, size.y, size.z, 1e-3) / 2 };
    }
  }

  /** Converts the next chunk; returns whether all vertices are done. */
  step(): boolean {
    const from = this.done;
    const to = Math.min(this.n, from + CHUNK_VERTICES);
    const r = this.readers;
    const q = this.quant;
    for (let i = from; i < to; i++) {
      for (let k = 0; k < 3; k++) {
        const o = i * r.pos.stride + r.pos.offset + k;
        this.pos[i * 3 + k] = q ? Math.round(((r.pos.array[o] * r.pos.scale - q.c.getComponent(k)) / q.h) * 32767) : r.pos.array[o];
      }
    }
    const nr = r.nor;
    if (nr && nr.array instanceof Int16Array && nr.scale !== 1) {
      for (let i = from; i < to; i++) {
        const o = i * nr.stride + nr.offset;
        this.nor[i * 3] = nr.array[o];
        this.nor[i * 3 + 1] = nr.array[o + 1];
        this.nor[i * 3 + 2] = nr.array[o + 2];
      }
    } else {
      for (let i = from; i < to; i++) {
        if (nr) {
          _v.set(read(nr, i, 0), read(nr, i, 1), read(nr, i, 2)).normalize();
        } else {
          _v.set(0, 1, 0);
        }
        this.nor[i * 3] = Math.round(_v.x * 32767);
        this.nor[i * 3 + 1] = Math.round(_v.y * 32767);
        this.nor[i * 3 + 2] = Math.round(_v.z * 32767);
      }
    }
    r.uv.forEach((ur, u) => {
      if (ur) {
        const out = this.uv[u];
        for (let i = from; i < to; i++) {
          out[i * 2] = read(ur, i, 0);
          out[i * 2 + 1] = read(ur, i, 1);
        }
      }
    });
    const cr = r.color;
    if (this.layout.baked) {
      const c = this.factors.color;
      const col = this.color as Uint16Array;
      const s = 65535 / COLOR_RANGE;
      for (let i = from; i < to; i++) {
        col[i * 4] = Math.min(65535, Math.round((cr ? read(cr, i, 0) : 1) * c.r * s));
        col[i * 4 + 1] = Math.min(65535, Math.round((cr ? read(cr, i, 1) : 1) * c.g * s));
        col[i * 4 + 2] = Math.min(65535, Math.round((cr ? read(cr, i, 2) : 1) * c.b * s));
        col[i * 4 + 3] = Math.round((cr && cr.itemSize === 4 ? read(cr, i, 3) : 1) * 65535);
        this.roughMetal![i * 2] = this.factors.rough;
        this.roughMetal![i * 2 + 1] = this.factors.metal;
      }
      if (this.emissive) {
        const e = this.factors.emissive;
        for (let i = from; i < to; i++) {
          this.emissive[i * 3] = e.r;
          this.emissive[i * 3 + 1] = e.g;
          this.emissive[i * 3 + 2] = e.b;
        }
      }
    } else if (this.color) {
      const col = this.color as Uint8Array;
      for (let i = from; i < to; i++) {
        for (let k = 0; k < 4; k++) {
          col[i * 4 + k] = cr && k < cr.itemSize ? Math.round(THREE.MathUtils.clamp(read(cr, i, k), 0, 1) * 255) : 255;
        }
      }
    }
    this.done = to;
    return to >= this.n;
  }

  /** The converted geometry and its instance matrix (after the last step). */
  finish(): { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 } {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3, true));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3, true));
    this.uv.forEach((a, u) => g.setAttribute(u === 0 ? 'uv' : 'uv1', new THREE.BufferAttribute(a, 2)));
    if (this.layout.baked) {
      g.setAttribute('color', new THREE.BufferAttribute(this.color!, 4, true));
      g.setAttribute('roughMetal', new THREE.BufferAttribute(this.roughMetal!, 2, true));
      if (this.emissive) {
        g.setAttribute('emissiveRGB', new THREE.BufferAttribute(this.emissive, 3));
      }
    } else if (this.color) {
      g.setAttribute('color', new THREE.BufferAttribute(this.color, 4, true));
    }
    g.setIndex(indexOf(this.part.geometry));
    g.boundingSphere = int16Bounds(this.pos);
    const q = this.quant;
    const matrix = q ? this.part.matrix.clone().multiply(new THREE.Matrix4().makeScale(q.h, q.h, q.h).setPosition(q.c)) : this.part.matrix.clone();
    return { geometry: g, matrix };
  }
}

function mapsUseUv1(m: THREE.Material): boolean {
  for (const v of Object.values(m)) {
    if ((v as THREE.Texture | null)?.isTexture && (v as THREE.Texture).channel === 1) {
      return true;
    }
  }
  return false;
}

/** The parts of three's BatchedMesh the draw list is written into (r186). */
interface BatchedInternals {
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount: number;
  _multiDrawBytesPerElement: number;
  _indirectTexture: THREE.DataTexture;
  _geometryInfo: GeometryInfo[];
  _visibilityChanged: boolean;
}

interface GeometryInfo {
  vertexStart: number;
  vertexCount: number;
  reservedVertexCount: number;
  indexStart: number;
  indexCount: number;
  reservedIndexCount: number;
  start: number;
  count: number;
  boundingBox: THREE.Box3 | null;
  boundingSphere: THREE.Sphere | null;
}

/**
 * BatchedMesh.setGeometryAt with typed-array copies: three's version copies indices and zero-fills the reserved rest
 * one component call at a time, which takes tens of milliseconds for a tile's 200k-vertex interior primitive. Needs the
 * geometry in the batch's exact layout (same attributes and array types) and an index.
 */
export function fastSetGeometryAt(mesh: THREE.BatchedMesh, geometryId: number, geometry: THREE.BufferGeometry): number {
  const info = (mesh as unknown as BatchedInternals)._geometryInfo[geometryId];
  const dstGeometry = mesh.geometry;
  const srcIndex = geometry.index!;
  const vertexCount = geometry.attributes.position.count;
  if (srcIndex.count > info.reservedIndexCount || vertexCount > info.reservedVertexCount) {
    throw new Error('THREE.BatchedMesh: Reserved space not large enough for provided geometry.');
  }
  const v0 = info.vertexStart;
  for (const name in dstGeometry.attributes) {
    const dst = dstGeometry.attributes[name] as THREE.BufferAttribute;
    const src = geometry.attributes[name] as THREE.BufferAttribute;
    const n = dst.itemSize;
    dst.array.set(src.array.subarray(0, vertexCount * n), v0 * n);
    dst.array.fill(0, (v0 + vertexCount) * n, (v0 + info.reservedVertexCount) * n);
    dst.addUpdateRange(v0 * n, info.reservedVertexCount * n);
    dst.needsUpdate = true;
  }
  const dstIndex = dstGeometry.index!;
  const di = dstIndex.array;
  const si = srcIndex.array;
  const i0 = info.indexStart;
  for (let k = 0; k < srcIndex.count; k++) {
    di[i0 + k] = si[k] + v0;
  }
  di.fill(v0, i0 + srcIndex.count, i0 + info.reservedIndexCount);
  dstIndex.addUpdateRange(i0, info.reservedIndexCount);
  dstIndex.needsUpdate = true;
  info.vertexCount = vertexCount;
  info.indexCount = srcIndex.count;
  info.start = i0;
  info.count = srcIndex.count;
  info.boundingBox = geometry.boundingBox?.clone() ?? null;
  info.boundingSphere = geometry.boundingSphere?.clone() ?? null;
  (mesh as unknown as BatchedInternals)._visibilityChanged = true;
  return geometryId;
}

interface BatchInstance {
  geometryId: number;
  /** World bounding sphere (the instances never move). */
  sphere: THREE.Sphere;
  visible: boolean;
  /** Shadow proxies: a small caster, left out of the wide (far) cascades. */
  small?: boolean;
}

const _frustum = new THREE.Frustum();
const _projView = new THREE.Matrix4();
const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _order: { id: number; z: number }[] = [];

/**
 * A BatchedMesh whose buffers grow on demand and reuse the space of removed geometries (compacted when needed). Its
 * draw list is built by its own cull: the instances (one per tile) never move, so their world bounding spheres are
 * kept instead of being rebuilt from the matrix texture per camera, and the indirect texture is uploaded only when
 * the list changed.
 */
class Batch {
  readonly mesh: THREE.BatchedMesh;
  private readonly internals: BatchedInternals;
  private readonly instances: (BatchInstance | undefined)[] = [];
  /** Reserved ranges of removed geometries, reused by later geometries that fit (no compaction, no re-upload). */
  private readonly free: { geometryId: number; vertices: number; indices: number }[] = [];
  private live = 0;
  private boundsDirty = false;
  private maxVertices: number;
  private maxIndices: number;
  /** Largest geometry added so far (growth reserves room for PRESIZE_TILES of them). */
  private largest = { vertices: 0, indices: 0 };
  private readonly drawLists: DrawListCache = new Map();

  constructor(
    name: string,
    material: THREE.Material,
    /** Size hint: the first geometry's vertex and index counts. */
    first: { vertices: number; indices: number },
    /** Shadow proxy: small instances skip the wide cascades. */
    private readonly proxy = false,
  ) {
    this.maxVertices = Math.max(INITIAL_VERTICES, Math.ceil(first.vertices * SLACK * PRESIZE_TILES));
    this.maxIndices = Math.max(INITIAL_INDICES, Math.ceil(first.indices * SLACK * PRESIZE_TILES));
    this.mesh = new THREE.BatchedMesh(64, this.maxVertices, this.maxIndices, material);
    this.internals = this.mesh as unknown as BatchedInternals;
    this.mesh.name = name;
    this.mesh.matrixAutoUpdate = false;
    // Culled as a whole by its bounding sphere (kept current in refreshBounds), then per tile.
    this.mesh.frustumCulled = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1);
    this.mesh.onBeforeRender = (_r, _s, camera, geometry, material) => this.cull(camera, geometry, material);
    this.mesh.onBeforeShadow = (_r, _o, _c, shadowCamera, geometry, depthMaterial) => this.cull(shadowCamera, geometry, depthMaterial);
    this.mesh.setGeometryAt = (geometryId: number, geometry: THREE.BufferGeometry) => fastSetGeometryAt(this.mesh, geometryId, geometry);
  }

  /** Adds a geometry and one instance of it (hidden until setVisible). */
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, slot: number | null, small = false): { geometryId: number; instanceId: number } {
    const mesh = this.mesh;
    const v = geometry.attributes.position.count;
    const i = geometry.index!.count;
    this.largest.vertices = Math.max(this.largest.vertices, v);
    this.largest.indices = Math.max(this.largest.indices, i);
    let best = -1;
    for (let k = 0; k < this.free.length; k++) {
      const f = this.free[k];
      if (f.vertices >= v && f.indices >= i && (best < 0 || f.vertices < this.free[best].vertices)) {
        best = k;
      }
    }
    let geometryId: number;
    if (best >= 0) {
      geometryId = this.free.splice(best, 1)[0].geometryId;
      mesh.setGeometryAt(geometryId, geometry);
    } else {
      const rv = Math.ceil(v * SLACK);
      const ri = Math.ceil(i * SLACK);
      if (rv > mesh.unusedVertexCount || ri > mesh.unusedIndexCount) {
        const freeV = this.free.reduce((n, f) => n + f.vertices, 0);
        const freeI = this.free.reduce((n, f) => n + f.indices, 0);
        if (rv <= mesh.unusedVertexCount + freeV && ri <= mesh.unusedIndexCount + freeI) {
          batchCounters.compactions++;
          for (const f of this.free) {
            mesh.deleteGeometry(f.geometryId);
          }
          this.free.length = 0;
          mesh.optimize();
        }
        if (rv > mesh.unusedVertexCount || ri > mesh.unusedIndexCount) {
          const usedV = this.maxVertices - mesh.unusedVertexCount;
          const usedI = this.maxIndices - mesh.unusedIndexCount;
          // Growing copies and re-uploads the whole batch: make room for many more tiles like the largest so far.
          this.maxVertices = Math.max(this.maxVertices * 2, Math.ceil((usedV + rv) * 1.5), Math.ceil(this.largest.vertices * SLACK * PRESIZE_TILES));
          this.maxIndices = Math.max(this.maxIndices * 2, Math.ceil((usedI + ri) * 1.5), Math.ceil(this.largest.indices * SLACK * PRESIZE_TILES));
          mesh.setGeometrySize(this.maxVertices, this.maxIndices);
          batchCounters.growths++;
        }
      }
      geometryId = mesh.addGeometry(geometry, rv, ri);
    }
    if (this.live >= mesh.maxInstanceCount) {
      mesh.setInstanceCount(mesh.maxInstanceCount * 2);
    }
    const instanceId = mesh.addInstance(geometryId);
    mesh.setMatrixAt(instanceId, matrix);
    if (slot !== null) {
      mesh.setColorAt(instanceId, _slotColor.setRGB(slot, 0, 0));
    }
    this.instances[instanceId] = { geometryId, sphere: geometry.boundingSphere!.clone().applyMatrix4(matrix), visible: false, small };
    this.live++;
    this.boundsDirty = true;
    return { geometryId, instanceId };
  }

  setVisible(instanceId: number, visible: boolean): void {
    const inst = this.instances[instanceId];
    if (inst && inst.visible !== visible) {
      inst.visible = visible;
      this.boundsDirty = true;
    }
  }

  /** Removes an instance; its geometry's range is kept for reuse. */
  remove(geometryId: number, instanceId: number): void {
    this.mesh.deleteInstance(instanceId);
    this.instances[instanceId] = undefined;
    const info = this.internals._geometryInfo[geometryId];
    this.free.push({ geometryId, vertices: info.reservedVertexCount, indices: info.reservedIndexCount });
    this.live--;
    this.boundsDirty = true;
  }

  get empty(): boolean {
    return this.live === 0;
  }

  /** Bounding sphere of the visible instances (an empty batch is culled as a whole). */
  refreshBounds(): void {
    if (!this.boundsDirty) {
      return;
    }
    this.boundsDirty = false;
    const bs = this.mesh.boundingSphere!;
    bs.makeEmpty();
    for (const inst of this.instances) {
      if (inst?.visible) {
        bs.union(inst.sphere);
      }
    }
  }

  private cull(camera: THREE.Camera, geometry: THREE.BufferGeometry, material: THREE.Material): void {
    const o = camera as THREE.OrthographicCamera;
    const skipSmall = this.proxy && o.isOrthographicCamera && (o.right - o.left) / o.zoom > FAR_CASCADE_WIDTH;
    const cascade = o.isOrthographicCamera ? (this.mesh.userData.shadowFrustum as THREE.Frustum | undefined) : undefined;
    writeDrawList(this.mesh, camera, geometry, material, this.instances, !this.proxy, this.drawLists, undefined, skipSmall, cascade);
  }
}

/** Per camera: the indirect texture holding that camera's draw list and a hash of the list. */
export type DrawListCache = Map<THREE.Camera, { texture: THREE.DataTexture; hash: number }>;

/**
 * Writes a BatchedMesh's draw list for a camera from cached world bounding spheres: the visible instances in the
 * frustum, sorted by depth when `sort` (front to back, back to front if transparent). Each camera (main, reflection,
 * shadow cascades) keeps its own indirect texture, re-uploaded only when its list changed, so a still camera uploads
 * nothing.
 */
export function writeDrawList(
  mesh: THREE.BatchedMesh,
  camera: THREE.Camera,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  instances: readonly ({ geometryId: number; sphere: THREE.Sphere; visible: boolean; small?: boolean } | undefined)[],
  sort: boolean,
  cache: DrawListCache,
  /** Instance ids to consider (default: all). */
  ids?: readonly number[],
  /** Leave out instances flagged small. */
  skipSmall = false,
  /**
   * Frustum that tests objects (e.g. a shadow cascade's, which also drops casters too small for it or whose shadow
   * lands outside its range); instances are tested with it as bounding-sphere objects instead of the plain frustum.
   */
  objectFrustum?: THREE.Frustum,
): void {
  const m = mesh as unknown as BatchedInternals;
  _projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projView, camera.coordinateSystem, (camera as { reversedDepth?: boolean }).reversedDepth);
  _camPos.setFromMatrixPosition(camera.matrixWorld);
  _camDir.set(0, 0, -1).transformDirection(camera.matrixWorld);
  _order.length = 0;
  const n = ids ? ids.length : instances.length;
  for (let k = 0; k < n; k++) {
    const id = ids ? ids[k] : k;
    const inst = instances[id];
    if (!inst?.visible || (skipSmall && inst.small)) {
      continue;
    }
    _probe.boundingSphere = inst.sphere;
    if (objectFrustum ? objectFrustum.intersectsObject(_probe) : _frustum.intersectsSphere(inst.sphere)) {
      _order.push({ id, z: sort ? _camDir.dot(_v.subVectors(inst.sphere.center, _camPos)) : 0 });
    }
  }
  if (sort) {
    const sign = material.transparent ? -1 : 1;
    _order.sort((a, b) => sign * (a.z - b.z));
  }
  const size = Math.ceil(Math.sqrt(mesh.maxInstanceCount));
  let entry = cache.get(camera);
  if (!entry || entry.texture.image.width !== size) {
    entry?.texture.dispose();
    const texture = new THREE.DataTexture(new Uint32Array(size * size), size, size, THREE.RedIntegerFormat, THREE.UnsignedIntType);
    entry = { texture, hash: -1 };
    cache.set(camera, entry);
  }
  const index = geometry.getIndex();
  const bytes = index ? index.array.BYTES_PER_ELEMENT : 1;
  const indirect = entry.texture.image.data as Uint32Array;
  let hash = 2166136261 ^ _order.length;
  for (let k = 0; k < _order.length; k++) {
    const id = _order[k].id;
    const info = m._geometryInfo[instances[id]!.geometryId];
    m._multiDrawStarts[k] = info.start * bytes;
    m._multiDrawCounts[k] = info.count;
    indirect[k] = id;
    hash = Math.imul(hash ^ id, 16777619);
  }
  m._multiDrawCount = _order.length;
  m._multiDrawBytesPerElement = bytes;
  m._indirectTexture = entry.texture;
  if (hash !== entry.hash) {
    entry.hash = hash;
    entry.texture.needsUpdate = true;
    batchCounters.listUploads++;
  }
}

/** Invalidates the cached draw lists (instances were added or removed). */
export function resetDrawLists(cache: DrawListCache): void {
  for (const e of cache.values()) {
    e.hash = -1;
  }
}

const _slotColor = new THREE.Color();

/** Buffer events of all batches (debug stats). */
export const batchCounters = { growths: 0, compactions: 0, listUploads: 0 };

/** Whether a caster's shadow can come from a position-only proxy (no cut-outs). */
export function castsThroughProxy(m: THREE.Material): boolean {
  return !(m.alphaTest > 0) && !(m as THREE.MeshStandardMaterial).alphaMap;
}

/** The side a material renders into the shadow map (three's default flips single-sided materials). */
export function shadowSideOf(m: THREE.Material): THREE.Side {
  if (m.shadowSide !== null && m.shadowSide !== undefined) {
    return m.shadowSide;
  }
  return m.side === THREE.FrontSide ? THREE.BackSide : m.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide;
}

/** Depth-only material of a shadow proxy (never drawn to colour). */
export function proxyMaterial(side: THREE.Side): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ name: 'street-shadow-proxy', colorWrite: false, depthWrite: false });
  m.shadowSide = side;
  return m;
}

/**
 * Makes a mesh a shadow proxy: drawn only by orthographic shadow cameras (their side planes are parallel), culled by
 * the main and reflection cameras (perspective). With `far` set, only cascades wider (true) or narrower (false) than
 * FAR_CASCADE_WIDTH draw it. The mesh must be frustum culled (it may have an infinite bounding sphere).
 */
export function shadowOnly(mesh: THREE.Object3D, far: boolean | null): void {
  mesh.frustumCulled = true;
  mesh.castShadow = true;
  const intersects = mesh.intersectsFrustum.bind(mesh);
  mesh.intersectsFrustum = (frustum: THREE.Frustum | THREE.FrustumArray): boolean => {
    const planes = (frustum as THREE.Frustum).planes;
    if (!planes || planes[0].normal.dot(planes[1].normal) > -0.9999) {
      return false;
    }
    if (far !== null && planes[0].constant + planes[1].constant > FAR_CASCADE_WIDTH !== far) {
      return false;
    }
    // The cascade's own frustum (with its caster size and receiver range tests) culls the instances too.
    mesh.userData.shadowFrustum = frustum;
    return !!intersects(frustum);
  };
}

const _probe = new THREE.Object3D() as THREE.Object3D & { boundingSphere: THREE.Sphere | null };
_probe.updateMatrixWorld();

const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'bumpMap', 'displacementMap', 'envMap', 'lightMap', 'emissiveMap'] as const;

/**
 * Materials that draw alike except for their base colour, roughness, metalness (and, with `emissive`, emissive colour)
 * share one batch: same class and textures, same blending and depth state, same shader patches (program cache key).
 * Emissive materials merge only when `emissive` is set (a host that dims each emissive material itself, like the
 * street sandbox, keeps them apart). Returns the group key, or null for a material that keeps its own batch.
 */
function glows(m: THREE.Material): boolean {
  const e = (m as THREE.MeshStandardMaterial).emissive;
  return !!m.userData.emissive || (!!e && e.r + e.g + e.b > 0);
}

function mergeKey(m: THREE.Material, detail: boolean, emissive: boolean): string | null {
  const s = m as THREE.MeshStandardMaterial;
  if (s.type !== 'MeshStandardMaterial' || s.emissiveMap || (glows(m) && !emissive)) {
    return null;
  }
  const maps = MAP_KEYS.map((k) => (s[k] as THREE.Texture | null)?.uuid ?? '-');
  return [
    ...maps,
    s.side,
    s.transparent,
    s.opacity,
    s.alphaTest,
    s.alphaToCoverage,
    s.depthWrite,
    s.depthTest,
    s.blending,
    s.premultipliedAlpha,
    s.polygonOffset ? `${s.polygonOffsetFactor}/${s.polygonOffsetUnits}` : '-',
    s.normalScale.x,
    s.normalScale.y,
    s.normalMapType,
    s.aoMapIntensity,
    s.envMapIntensity,
    s.flatShading,
    s.fog,
    s.toneMapped,
    s.userData.castShadow === true && !castsThroughProxy(m),
    detail,
    glows(m),
    m.customProgramCacheKey(),
  ].join('|');
}

/**
 * The shared material of a merge group: a copy of the first member with white base colour and vertex colours on,
 * whose roughness and metalness factors come from the `roughMetal` attribute (the maps still multiply them).
 */
function mergedMaterial(first: THREE.Material, emissive: boolean): THREE.Material {
  const src = first as THREE.MeshStandardMaterial;
  const m = new THREE.MeshStandardMaterial().copy(src);
  m.name = `merged:${first.name}`;
  m.color.setRGB(1, 1, 1);
  m.vertexColors = true;
  m.forceSinglePass = true;
  m.userData = { ...first.userData };
  const base = first.onBeforeCompile;
  const baseKey = first.customProgramCacheKey();
  m.onBeforeCompile = function (shader, renderer) {
    base.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 roughMetal;\nvarying vec2 vRoughMetal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoughMetal = roughMetal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoughMetal;')
      .replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment.replace('float roughnessFactor = roughness;', 'float roughnessFactor = vRoughMetal.x;'))
      .replace('#include <metalnessmap_fragment>', THREE.ShaderChunk.metalnessmap_fragment.replace('float metalnessFactor = metalness;', 'float metalnessFactor = vRoughMetal.y;'))
      .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.rgb *= ${COLOR_RANGE.toFixed(1)};`);
    if (emissive) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 emissiveRGB;\nvarying vec3 vEmissiveRGB;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmissiveRGB = emissiveRGB;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vEmissiveRGB;')
        .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vEmissiveRGB;');
    }
  };
  m.customProgramCacheKey = () => `${baseKey}|merged${emissive ? '-emissive' : ''}`;
  return m;
}

/** Tile fade on the street side: the instance's slot (batching colour red) reads the fade table, see fade.ts. */
function addFadePatch(m: THREE.Material, table: THREE.Texture): void {
  const prevKey = m.customProgramCacheKey();
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    shader.uniforms.uStreetTileFade = { value: table };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n#ifdef USE_BATCHING_COLOR\nuniform sampler2D uStreetTileFade;\nvarying float vStreetFade;\n#endif`)
      .replace(
        '#include <color_vertex>',
        THREE.ShaderChunk.color_vertex.replace(
          'vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );',
          `float streetSlot = getBatchingColor( getIndirectIndex( gl_DrawID ) ).r;
  vStreetFade = streetSlot > 0.5 ? texture2D( uStreetTileFade, vec2( ( streetSlot + 0.5 ) / 256.0, 0.5 ) ).r : 1.0;`,
        ),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n#ifdef USE_BATCHING_COLOR\nvarying float vStreetFade;\n${STREET_DITHER_GLSL}\n#endif`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n#ifdef USE_BATCHING_COLOR\n  if (vStreetFade < 0.999 && vStreetFade <= streetDither()) discard;\n#endif`);
  };
  m.customProgramCacheKey = () => `${prevKey}|street-tile-fade`;
  m.needsUpdate = true;
}

interface PlacedGeometry {
  batch: Batch;
  geometryId: number;
  instanceId: number;
}

/** A tile's share of the batches. */
export interface TileBatchEntry {
  slot: number;
  placed: PlacedGeometry[];
  /** Shadow proxy instances (shown once the tile is half faded in). */
  proxies: PlacedGeometry[];
  /** Parts still to be copied into the batches. */
  queue: TilePart[];
  /** The part being converted (over several steps). */
  job: CanonicalJob | null;
  shown: boolean;
  proxiesShown: boolean;
}

/**
 * Draws every live street tile through a few BatchedMeshes: one per material group (materials that differ only in
 * factors share one, mergeKey) holding all tiles' primitives of that group, culled per tile, for the cameras; and one
 * position-only shadow proxy batch per shadow side holding every caster primitive, drawn only by the shadow cascades
 * (the wide ones skip the small casters). Draw calls then follow the number of material groups in view, not tiles x
 * materials, and each cascade draws at most two proxies instead of every caster material. Tiles are copied in over
 * several frames (a time budget per update) into reusable buffer ranges and fade in and out by their fade slot.
 */
export class TileBatches {
  readonly group = new THREE.Group();
  readonly fade = new FadeTable();
  /** Batch per material; materials that merge (see mergeKey) share one. */
  private readonly batches = new Map<THREE.Material, { batch: Batch; layout: Layout }>();
  private readonly merged = new Map<string, { batch: Batch; layout: Layout }>();
  private readonly mergedMaterials: THREE.Material[] = [];
  private readonly proxies = new Map<string, Batch>();
  private readonly proxyMaterials = new Map<THREE.Side, THREE.Material>();
  private readonly patched = new WeakSet<THREE.Material>();
  private readonly tiles = new Map<string, TileBatchEntry>();
  private readonly pendingBatches: THREE.BatchedMesh[] = [];

  constructor(
    private shadows: boolean,
    /** Called before a new batch is first drawn (e.g. renderer.compileAsync); the batch joins the scene after it. */
    private readonly compile?: (o: THREE.Object3D) => Promise<unknown>,
    /**
     * Object layer of the batches of small detail (materials that are not walls, roofs, timber or glass), e.g. a layer
     * a planar reflection camera skips; large surfaces stay on layer 0.
     */
    private readonly detailLayer = 0,
    /** Merge emissive materials too (see mergeKey). */
    private readonly mergeEmissive = false,
  ) {
    this.group.name = 'tiles';
    this.group.matrixAutoUpdate = false;
  }

  /**
   * Registers a loaded tile (or one LOD of it) under `key`; its parts are copied in by `work()`. `slot` is the tile's
   * fade slot (see fade.ts; the owner acquires it from `fade`), 0 for an unfaded tile.
   */
  addTile(key: string, parts: TilePart[], slot: number): void {
    this.removeTile(key);
    const queue = parts.filter((p) => p.geometry.attributes.position?.count > 0);
    this.tiles.set(key, { slot, placed: [], proxies: [], queue, job: null, shown: false, proxiesShown: false });
  }

  removeTile(key: string): void {
    const entry = this.tiles.get(key);
    if (!entry) {
      return;
    }
    for (const p of [...entry.placed, ...entry.proxies]) {
      p.batch.remove(p.geometryId, p.instanceId);
    }
    this.tiles.delete(key);
  }

  /** Whether all parts of the tile are in the batches. */
  isComplete(key: string): boolean {
    const e = this.tiles.get(key);
    return !!e && e.queue.length === 0 && !e.job && this.pendingBatches.length === 0;
  }

  /**
   * Shows a tile with the given fade (0..1; the owner writes the slot's value into `fade`): drawn from > 0, casting
   * into the shadow maps from 0.5.
   */
  setShown(key: string, fade: number): void {
    const e = this.tiles.get(key);
    if (!e) {
      return;
    }
    const show = fade > 0 && e.queue.length === 0 && !e.job && this.pendingBatches.length === 0;
    if (show !== e.shown) {
      e.shown = show;
      for (const p of e.placed) {
        p.batch.setVisible(p.instanceId, show);
      }
    }
    const cast = show && fade >= 0.5;
    if (cast !== e.proxiesShown) {
      e.proxiesShown = cast;
      for (const p of e.proxies) {
        p.batch.setVisible(p.instanceId, cast);
      }
    }
  }

  /** Copies queued parts into the batches until `budgetMs` is spent (at least one part per call). */
  work(budgetMs: number): void {
    const t0 = performance.now();
    for (const entry of this.tiles.values()) {
      while (entry.queue.length || entry.job) {
        if (!entry.job) {
          const next = entry.queue.shift()!;
          entry.job = new CanonicalJob(next, this.batchOf(next).layout);
        }
        const job = entry.job;
        if (!job.step()) {
          if (performance.now() - t0 > budgetMs) {
            this.refresh();
            return;
          }
          continue;
        }
        entry.job = null;
        const part = job.part;
        const { batch } = this.batchOf(part);
        const { geometry, matrix } = job.finish();
        entry.placed.push({ batch, ...batch.add(geometry, matrix, entry.slot) });
        const m = part.material;
        if (m.userData.castShadow === true && castsThroughProxy(m)) {
          // Its shadow comes from the proxy batch of its shadow side (positions and index only).
          const shadow = new THREE.BufferGeometry();
          shadow.setAttribute('position', geometry.attributes.position);
          shadow.setIndex(geometry.index);
          shadow.boundingSphere = geometry.boundingSphere;
          const proxy = this.proxyBatch(shadowSideOf(m), shadow);
          const small = m.userData.surface !== undefined && !LARGE_CASTER_SURFACES.has(m.userData.surface as string);
          entry.proxies.push({ batch: proxy, ...proxy.add(shadow, matrix, null, small) });
        }
        if (performance.now() - t0 > budgetMs) {
          this.refresh();
          return;
        }
      }
    }
    this.refresh();
  }

  /** Parts not yet copied, over all tiles. */
  queued(): number {
    let n = 0;
    for (const e of this.tiles.values()) {
      n += e.queue.length + (e.job ? 1 : 0);
    }
    return n + this.pendingBatches.length;
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    for (const { batch } of new Set(this.batches.values())) {
      batch.mesh.receiveShadow = on;
    }
    for (const p of this.proxies.values()) {
      p.mesh.castShadow = on;
    }
  }

  batchCount(): number {
    return new Set(this.batches.values()).size + this.proxies.size;
  }

  dispose(): void {
    for (const key of [...this.tiles.keys()]) {
      this.removeTile(key);
    }
    for (const { batch } of new Set(this.batches.values())) {
      batch.mesh.dispose();
    }
    for (const m of this.mergedMaterials) {
      m.dispose();
    }
    for (const p of this.proxies.values()) {
      p.mesh.dispose();
    }
    for (const m of this.proxyMaterials.values()) {
      m.dispose();
    }
    this.batches.clear();
    this.proxies.clear();
    this.fade.dispose();
  }

  /** Updates the batches' bounding spheres after tiles were added, removed, shown or hidden. */
  refresh(): void {
    for (const { batch } of new Set(this.batches.values())) {
      batch.refreshBounds();
    }
    for (const p of this.proxies.values()) {
      p.refreshBounds();
    }
  }

  private batchOf(part: TilePart): { batch: Batch; layout: Layout } {
    const material = part.material;
    let b = this.batches.get(material);
    if (b) {
      return b;
    }
    const key = mergeKey(material, this.detailLayerOf(material), this.mergeEmissive);
    b = key ? this.merged.get(key) : undefined;
    if (!b) {
      let host = material;
      const emissive = !!key && glows(material);
      if (key) {
        host = mergedMaterial(material, emissive);
        this.mergedMaterials.push(host);
      }
      if (!this.patched.has(host)) {
        this.patched.add(host);
        addFadePatch(host, this.fade.texture);
      }
      const layout: Layout = { color: (host as THREE.MeshStandardMaterial).vertexColors === true, uv1: mapsUseUv1(host), baked: !!key, emissive };
      const first = { vertices: part.geometry.attributes.position.count, indices: part.geometry.index?.count ?? part.geometry.attributes.position.count };
      const batch = new Batch(`tiles:${host.name}`, host, first);
      if (this.detailLayerOf(material)) {
        batch.mesh.layers.set(this.detailLayer);
      }
      batch.mesh.receiveShadow = this.shadows;
      // Casters with cut-outs keep casting from their own batch (the proxies have no alpha).
      batch.mesh.castShadow = this.shadows && material.userData.castShadow === true && !TileBatches.proxyable(material);
      b = { batch, layout };
      if (key) {
        this.merged.set(key, b);
      }
      this.join(batch.mesh);
    } else {
      b.batch.mesh.name += `+${material.name}`;
    }
    this.batches.set(material, b);
    return b;
  }

  private detailLayerOf(m: THREE.Material): boolean {
    return m.userData.surface !== undefined && !LARGE_CASTER_SURFACES.has(m.userData.surface as string);
  }

  /** Adds a new batch to the scene, after its program is compiled when a compile hook is given. */
  private join(mesh: THREE.BatchedMesh): void {
    if (!this.compile) {
      this.group.add(mesh);
      return;
    }
    this.pendingBatches.push(mesh);
    // The program depends on the batch's attributes and batching colour: compile once the first tile part is in.
    queueMicrotask(() => {
      void this.compile!(mesh)
        .catch(() => undefined)
        .then(() => {
          this.group.add(mesh);
          this.pendingBatches.splice(this.pendingBatches.indexOf(mesh), 1);
        });
    });
  }

  private static proxyable = castsThroughProxy;

  private proxyBatch(side: THREE.Side, first: THREE.BufferGeometry): Batch {
    const key = String(side);
    let b = this.proxies.get(key);
    if (!b) {
      let material = this.proxyMaterials.get(side);
      if (!material) {
        material = proxyMaterial(side);
        this.proxyMaterials.set(side, material);
      }
      b = new Batch(`tiles:shadow:${key}`, material, { vertices: first.attributes.position.count * 2, indices: first.index!.count * 2 }, true);
      shadowOnly(b.mesh, null);
      b.mesh.castShadow = this.shadows;
      b.mesh.receiveShadow = false;
      this.proxies.set(key, b);
      this.group.add(b.mesh);
    }
    return b;
  }
}
