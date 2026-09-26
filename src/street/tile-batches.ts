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
/**
 * Batches are made of fixed-size pages (BatchedMeshes) that never grow: growing a BatchedMesh reallocates and
 * re-uploads its whole buffers (up to ~230 MB in one frame when several batches grew at once, a 100-150 ms frame).
 * A material page holds about PAGE_TILES tiles like its first primitive; a full page gets a sibling page.
 */
const PAGE_TILES = 3;
/**
 * New pages enter the scene within this many megabytes of buffers per frame: a page's first draw uploads its whole
 * buffers, so dozens of pages appearing together (the layer switching on) would upload ~100 MB in one frame.
 */
const PAGE_UPLOAD_MB_PER_FRAME = 4;
/** Time (ms) an empty page other than a batch's first is kept for later tiles before it is freed. */
const EMPTY_PAGE_KEEP_MS = 60000;
/**
 * Shadow proxy pages (every caster primitive of its shadow side): vertices and indices. A page's first draw uploads
 * its buffers whole, and its index ring once per slot: at 1M vertices / 3M indices (19 MB) each of those was a frame
 * of 10-25 ms; half that keeps them under the frame budget for a few more shadow draw calls.
 */
const PROXY_PAGE_VERTICES = 1 << 19;
const PROXY_PAGE_INDICES = 3 << 19;

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
    } else if (nr && nr.array instanceof Int8Array && nr.scale !== 1) {
      // Octahedral normals (web profile) arrive decoded as unit int8 vectors: widen without renormalizing.
      const k = 32767 / 127;
      for (let i = from; i < to; i++) {
        const o = i * nr.stride + nr.offset;
        this.nor[i * 3] = Math.max(-32767, Math.round(nr.array[o] * k));
        this.nor[i * 3 + 1] = Math.max(-32767, Math.round(nr.array[o + 1] * k));
        this.nor[i * 3 + 2] = Math.max(-32767, Math.round(nr.array[o + 2] * k));
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

/** Whether a visible instance's bounding sphere is in the frustum (tile pages hold a handful of instances). */
export function anyInFrustum(instances: readonly ({ sphere: THREE.Sphere; visible: boolean } | undefined)[], frustum: THREE.Frustum, ids?: readonly number[]): boolean {
  const n = ids ? ids.length : instances.length;
  for (let k = 0; k < n; k++) {
    const inst = instances[ids ? ids[k] : k];
    if (inst?.visible && frustum.intersectsSphere(inst.sphere)) {
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
  _nextVertexStart: number;
  _nextIndexStart: number;
}

/**
 * Buffers that are created with only their filled part uploaded: array -> the element count in use (from its start).
 * A batch's buffers are sized for its whole capacity (a page, a prop batch after growing), and three creates a GL
 * buffer with the whole array (gl.bufferData(array)): a new page's first draw sent 20-36 MB of mostly zeros through
 * the command buffer in one frame, and each index ring slot 6-12 MB more. See installLazyBufferUploads.
 */
const lazyArrays = new WeakMap<ArrayBufferView, () => number>();

/**
 * Registers a BatchedMesh's current buffers (vertex attributes and index, the index ring's slots share the index
 * array) for lazy creation: only the ranges up to the batch's next free vertex / index are uploaded when three creates
 * their GL buffers. Call again after its geometry was reallocated (setGeometrySize).
 */
export function lazyUpload(mesh: THREE.BatchedMesh, paced = false): void {
  const m = mesh as unknown as BatchedInternals;
  const g = mesh.geometry;
  for (const name in g.attributes) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    if (!lazyArrays.has(a.array)) {
      const size = a.itemSize;
      const array = a.array;
      lazyArrays.set(array, paced ? () => releasedEnd.get(array) ?? 0 : () => m._nextVertexStart * size);
      a.onUpload(clearRangesOnUpload);
    }
  }
  if (g.index && !lazyArrays.has(g.index.array)) {
    const array = g.index.array;
    lazyArrays.set(array, paced ? () => releasedEnd.get(array) ?? 0 : () => m._nextIndexStart);
    g.index.onUpload(clearRangesOnUpload);
  }
}

/**
 * Batches whose writes are all paced (tile pages): the end of the part of each array released for upload so far. A
 * buffer created lazily holds that part only; the rest reaches it through the paced ranges, so a page whose first
 * tile part is 15 MB no longer uploads it whole with its first draw.
 */
const releasedEnd = new WeakMap<ArrayLike<number>, number>();

function noteReleased(array: ArrayLike<number>, end: number): void {
  releasedEnd.set(array, Math.max(releasedEnd.get(array) ?? 0, end));
}

/**
 * Upload callback of lazily created buffers: three keeps the update ranges written before a buffer's creation (the
 * creation uploads the data they cover) and would upload them again with the next change.
 */
function clearRangesOnUpload(this: THREE.BufferAttribute): void {
  this.clearUpdateRanges();
}

/** Whether an array is one of the batches' buffers (debug: attributing uploads in tests). */
export const ownsBufferArray = (array: unknown): boolean => !!array && typeof array === 'object' && lazyArrays.has(array as ArrayBufferView);

const lazyInstalled = new WeakSet<WebGL2RenderingContext>();
let lazyInstalledAny = false;

/**
 * Makes gl.bufferData with a registered array (lazyUpload) allocate the buffer at full size (zeroed by WebGL) and
 * upload only its filled part. Installed once per context by the host (street/index.ts) before any batch is drawn;
 * without it batches upload whole arrays as before.
 */
export function installLazyBufferUploads(gl: WebGL2RenderingContext): void {
  if (lazyInstalled.has(gl)) {
    return;
  }
  lazyInstalled.add(gl);
  lazyInstalledAny = true;
  const bufferData = gl.bufferData;
  // The size-only and sub-data calls go through the context's current methods (a profiler may wrap them).
  gl.bufferData = function (this: WebGL2RenderingContext, target: GLenum, src: unknown, usage: GLenum, ...rest: unknown[]): void {
    const used = src && typeof src === 'object' ? lazyArrays.get(src as ArrayBufferView) : undefined;
    const array = src as THREE.TypedArray;
    if (!used || rest.length) {
      (bufferData as (...a: unknown[]) => void).call(gl, target, src, usage, ...rest);
      return;
    }
    gl.bufferData(target, array.byteLength, usage);
    const n = Math.min(array.length, used());
    if (n > 0) {
      gl.bufferSubData(target, 0, array, 0, n);
    }
  } as typeof gl.bufferData;
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

/** GL index buffers per batch that take turns (see IndexRing). */
const RING_SLOTS = 4;
/** Ranges a ring slot queues before the closest ones are joined. */
const MAX_PENDING_RANGES = 32;

/** Adds [start, start + count) to a list of disjoint ranges sorted by start, merging what it touches. */
function addRange(list: [number, number][], start: number, count: number): void {
  let end = start + count;
  let i = 0;
  while (i < list.length && list[i][0] + list[i][1] < start) {
    i++;
  }
  let j = i;
  while (j < list.length && list[j][0] <= end) {
    start = Math.min(start, list[j][0]);
    end = Math.max(end, list[j][0] + list[j][1]);
    j++;
  }
  list.splice(i, j - i, [start, end - start]);
  if (list.length > MAX_PENDING_RANGES) {
    let best = 0;
    for (let k = 1; k + 1 < list.length; k++) {
      if (list[k + 1][0] - (list[k][0] + list[k][1]) < list[best + 1][0] - (list[best][0] + list[best][1])) {
        best = k;
      }
    }
    const a = list[best];
    const b = list[best + 1];
    list.splice(best, 2, [a[0], b[0] + b[1] - a[0]]);
  }
}

/**
 * Index buffer ring of a BatchedMesh. On ANGLE/Metal, writing into an element array buffer that the GPU may still be
 * reading (bufferSubData into the index buffer drawn last frame) stalls the GPU process until the GPU is done: every
 * tile part added to a shared batch cost a 35-50 ms frame (vertex buffers do not stall). So the batch keeps RING_SLOTS
 * index attributes over one CPU array: before the first index write after a draw, the geometry switches to the slot
 * drawn longest ago (at least RING_SLOTS - 1 draws back) and uploads only the ranges written since that slot was last
 * current. The other slots' GL buffers are released by the WebGL context when their attributes are collected.
 */
export class IndexRing {
  private slots: THREE.BufferAttribute[] = [];
  /** Per slot: index ranges written since the slot was last current ('all' = re-upload everything). */
  private pending: ([number, number][] | 'all')[] = [];
  private current = 0;
  /** The current slot was drawn (so it may be in flight). */
  drawn = false;

  constructor(private readonly mesh: THREE.BatchedMesh) {
    this.reset();
  }

  /** Rebuilds the ring over the geometry's (new) index, e.g. after setGeometrySize. */
  reset(): void {
    const index = this.mesh.geometry.index!;
    this.slots = [index];
    this.pending = [[]];
    for (let k = 1; k < RING_SLOTS; k++) {
      const slot = new THREE.BufferAttribute(index.array, 1);
      // Created from the whole current data (lazily, see lazyUpload): the ranges queued before are in it.
      slot.onUpload(clearRangesOnUpload);
      this.slots.push(slot);
      this.pending.push('all');
    }
    this.current = 0;
    this.drawn = false;
  }

  /** Call before writing index data: moves to a slot the GPU is done with once the current one has been drawn. */
  beginWrite(): void {
    if (!this.drawn) {
      return;
    }
    this.current = (this.current + 1) % RING_SLOTS;
    const slot = this.slots[this.current];
    const pending = this.pending[this.current];
    slot.clearUpdateRanges();
    if (pending === 'all') {
      // An explicit range, not just needsUpdate: three uploads everything only while no range is set, and the writes
      // that follow in this frame add ranges (which then made it upload those alone and left the slot stale). Only the
      // filled part: nothing is drawn beyond the batch's next free index.
      slot.addUpdateRange(0, Math.max(1, (this.mesh as unknown as BatchedInternals)._nextIndexStart));
      slot.needsUpdate = true;
    } else if (pending.length) {
      for (const [start, count] of pending) {
        slot.addUpdateRange(start, count);
      }
      slot.needsUpdate = true;
    }
    this.pending[this.current] = [];
    this.mesh.geometry.setIndex(slot);
    this.drawn = false;
  }

  /**
   * Records a written index range: uploaded with the current slot, queued for the others. Queued ranges are merged
   * with the ones they touch (a tile's parts land back to back in a page); past MAX_PENDING_RANGES the two closest
   * are joined. Letting a slot fall back to a full re-upload made every tile added to a 12 MB shadow proxy page
   * re-upload the whole index three times over the next frames.
   */
  touch(start: number, count: number): void {
    const slot = this.slots[this.current];
    slot.addUpdateRange(start, count);
    slot.needsUpdate = true;
    for (let k = 0; k < RING_SLOTS; k++) {
      const p = this.pending[k];
      if (k !== this.current && p !== 'all') {
        addRange(p, start, count);
      }
    }
  }

  /** After a write the ring could not track range by range (e.g. BatchedMesh.optimize on the current slot). */
  touchAll(): void {
    for (let k = 0; k < RING_SLOTS; k++) {
      if (k !== this.current) {
        this.pending[k] = 'all';
      }
    }
  }
}

const rings = new WeakMap<THREE.BatchedMesh, IndexRing>();

/** Rebuilds a batch's index ring after BatchedMesh.setGeometrySize (a new index buffer). */
export function resetIndexRing(mesh: THREE.BatchedMesh): void {
  rings.get(mesh)?.reset();
}

/** The index ring of a batch (created on its first index write, when the geometry exists). */
export function indexRingOf(mesh: THREE.BatchedMesh): IndexRing {
  let ring = rings.get(mesh);
  if (!ring) {
    ring = new IndexRing(mesh);
    rings.set(mesh, ring);
    mesh.userData.indexRing = ring;
  }
  return ring;
}

/**
 * Buffer bytes of paced geometry writes (fastSetGeometryAt with `paced`) released for upload per frame, at least one
 * chunk. A tile's interior primitive is up to 500k vertices (15 MB of attributes and 6 MB of index): written in one
 * frame, its bufferSubData calls took 20-50 ms. Large ranges are split into PACE_CHUNK_BYTES pieces. An index range
 * reaches every slot of its ring (up to four uploads), so a frame's share stays small: 6 MB still let frames with
 * 12-13 MB of the layer's uploads through.
 */
const PACE_BYTES_PER_FRAME = 3e6;
const PACE_CHUNK_BYTES = 1e6;
const paceQueue: { seq: number; start: number; count: number; bytes: number; apply: (start: number, count: number) => void }[] = [];
/** Sequence numbers of the last queued and the last released paced write. */
const paceSeq = { queued: 0, released: 0 };

function paceUpload(start: number, count: number, bytesPerElement: number, apply: (start: number, count: number) => void): void {
  const step = Math.max(1, Math.floor(PACE_CHUNK_BYTES / bytesPerElement));
  for (let s = start; s < start + count; s += step) {
    const n = Math.min(step, start + count - s);
    paceQueue.push({ seq: ++paceSeq.queued, start: s, count: n, bytes: n * bytesPerElement, apply });
  }
}

/** Releases paced writes for upload within the per-frame budget (TileBatches.work calls it once per frame). */
function releasePacedUploads(): void {
  let bytes = 0;
  while (paceQueue.length && (bytes === 0 || bytes + paceQueue[0].bytes <= PACE_BYTES_PER_FRAME)) {
    const u = paceQueue.shift()!;
    bytes += u.bytes;
    u.apply(u.start, u.count);
    paceSeq.released = u.seq;
  }
}

/**
 * BatchedMesh.setGeometryAt with typed-array copies: three's version copies indices and zero-fills the reserved rest
 * one component call at a time, which takes tens of milliseconds for a tile's 200k-vertex interior primitive. Needs the
 * geometry in the batch's exact layout (same attributes and array types) and an index.
 */
export function fastSetGeometryAt(mesh: THREE.BatchedMesh, geometryId: number, geometry: THREE.BufferGeometry, paced = false): number {
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
    if (paced) {
      paceUpload(v0 * n, info.reservedVertexCount * n, dst.array.BYTES_PER_ELEMENT, (start, count) => {
        noteReleased(dst.array, start + count);
        dst.addUpdateRange(start, count);
        dst.needsUpdate = true;
      });
    } else {
      dst.addUpdateRange(v0 * n, info.reservedVertexCount * n);
      dst.needsUpdate = true;
    }
  }
  const ring = indexRingOf(mesh);
  ring.beginWrite();
  const dstIndex = dstGeometry.index!;
  const di = dstIndex.array;
  const si = srcIndex.array;
  const i0 = info.indexStart;
  for (let k = 0; k < srcIndex.count; k++) {
    di[i0 + k] = si[k] + v0;
  }
  di.fill(v0, i0 + srcIndex.count, i0 + info.reservedIndexCount);
  if (paced) {
    // After the vertex ranges (the queue is in order): an index range never reaches the GPU before its vertices.
    paceUpload(i0, info.reservedIndexCount, di.BYTES_PER_ELEMENT, (start, count) => {
      noteReleased(di, start + count);
      ring.beginWrite();
      ring.touch(start, count);
    });
  } else {
    ring.touch(i0, info.reservedIndexCount);
  }
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
  private readonly drawLists: DrawListCache = new Map();
  /** Drawn at least once (its buffers are uploaded); until then it is never culled. */
  warm = false;
  /** Time (performance.now) since which the page is empty, 0 while it holds geometry (see PagedBatch.refresh). */
  emptySince = 0;

  constructor(
    name: string,
    material: THREE.Material,
    /** Fixed capacity (vertices, indices). */
    capacity: { vertices: number; indices: number },
    /** Shadow proxy: small instances skip the wide cascades. */
    private readonly proxy = false,
  ) {
    this.mesh = new THREE.BatchedMesh(64, capacity.vertices, capacity.indices, material);
    this.internals = this.mesh as unknown as BatchedInternals;
    this.mesh.name = name;
    this.mesh.matrixAutoUpdate = false;
    // Culled as a whole by its bounding sphere (kept current in refreshBounds), then per tile.
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1);
    // Not culled until its first draw: a page enters the scene before any of its tiles is shown, and that first
    // (empty) draw uploads its buffers then, spread over frames (see PAGE_UPLOAD_MB_PER_FRAME).
    // Past that, drawn only when one of its shown tiles is in the frustum: an empty draw still costs its state setup.
    this.mesh.intersectsFrustum = (frustum: THREE.Frustum | THREE.FrustumArray): boolean => !this.warm || anyInFrustum(this.instances, frustum as THREE.Frustum);
    this.mesh.onBeforeRender = (_r, _s, camera, geometry, material) => this.cull(camera, geometry, material);
    this.mesh.onBeforeShadow = (_r, _o, _c, shadowCamera, geometry, depthMaterial) => this.cull(shadowCamera, geometry, depthMaterial);
    // Paced: a tile's parts reach the GPU over a few frames (the tile shows once they have, see TileBatches.ready).
    this.mesh.setGeometryAt = (geometryId: number, geometry: THREE.BufferGeometry) => fastSetGeometryAt(this.mesh, geometryId, geometry, true);
  }

  /** A free range of removed geometry that fits, else -1. */
  private freeFit(v: number, i: number): number {
    let best = -1;
    for (let k = 0; k < this.free.length; k++) {
      const f = this.free[k];
      if (f.vertices >= v && f.indices >= i && (best < 0 || f.vertices < this.free[best].vertices)) {
        best = k;
      }
    }
    return best;
  }

  /** Whether a geometry of this size fits without compacting the page (in a freed range or the unused tail). */
  fitsInPlace(v: number, i: number): boolean {
    return this.freeFit(v, i) >= 0 || (Math.ceil(v * SLACK) <= this.mesh.unusedVertexCount && Math.ceil(i * SLACK) <= this.mesh.unusedIndexCount);
  }

  /**
   * Adds a geometry that fits (see fitsInPlace; else the page is compacted first) and one instance of it (hidden
   * until setVisible).
   */
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, slot: number | null, small = false): { geometryId: number; instanceId: number } {
    const mesh = this.mesh;
    const v = geometry.attributes.position.count;
    const i = geometry.index!.count;
    const best = this.freeFit(v, i);
    let geometryId: number;
    if (best >= 0) {
      geometryId = this.free.splice(best, 1)[0].geometryId;
      mesh.setGeometryAt(geometryId, geometry);
    } else {
      let rv = Math.ceil(v * SLACK);
      let ri = Math.ceil(i * SLACK);
      if (rv > mesh.unusedVertexCount || ri > mesh.unusedIndexCount) {
        // Compact the page (moves ranges within its buffers; the index goes through the ring).
        batchCounters.compactions++;
        for (const f of this.free) {
          mesh.deleteGeometry(f.geometryId);
        }
        this.free.length = 0;
        const ring = indexRingOf(mesh);
        ring.beginWrite();
        mesh.optimize();
        ring.touchAll();
      }
      rv = Math.min(rv, mesh.unusedVertexCount);
      ri = Math.min(ri, mesh.unusedIndexCount);
      geometryId = mesh.addGeometry(geometry, rv, ri);
      lazyUpload(mesh, true);
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
    this.warm = true;
    const o = camera as THREE.OrthographicCamera;
    const skipSmall = this.proxy && o.isOrthographicCamera && (o.right - o.left) / o.zoom > FAR_CASCADE_WIDTH;
    const cascade = o.isOrthographicCamera ? (this.mesh.userData.shadowFrustum as THREE.Frustum | undefined) : undefined;
    writeDrawList(this.mesh, camera, geometry, material, this.instances, !this.proxy, this.drawLists, undefined, skipSmall, cascade);
  }
}

/**
 * One batch as a list of fixed-size pages (see PAGE_TILES): a geometry goes into the first page it fits, a new page is
 * made when none does, and pages left empty (beyond the first) are dropped.
 */
class PagedBatch {
  readonly pages: Batch[] = [];

  constructor(
    private readonly name: string,
    private readonly material: THREE.Material,
    private readonly capacity: { vertices: number; indices: number },
    private readonly proxy: boolean,
    /** Sets up a new page (flags, layers) and puts it in the scene. */
    private readonly onPage: (page: Batch, first: boolean) => void,
  ) {}

  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, slot: number | null, small = false): PlacedGeometry {
    const v = geometry.attributes.position.count;
    const i = geometry.index!.count;
    // A page with room as it is, else a new page: compacting one moves its ranges and re-uploads all its live data
    // (20-30 MB of vertex and ring index copies, 20-50 ms frames), while a new page uploads only what it holds (lazy
    // buffers). Pages left empty are freed (see refresh), so fragmentation does not accumulate.
    let page = this.pages.find((p) => p.fitsInPlace(v, i));
    if (!page) {
      // A merge group mixes small and large primitives: size new pages for PAGE_TILES of the largest seen so far.
      this.capacity.vertices = Math.max(this.capacity.vertices, Math.ceil(v * SLACK * PAGE_TILES));
      this.capacity.indices = Math.max(this.capacity.indices, Math.ceil(i * SLACK * PAGE_TILES));
      const capacity = { ...this.capacity };
      page = new Batch(`${this.name}#${this.pages.length}`, this.material, capacity, this.proxy);
      this.pages.push(page);
      batchCounters.pages++;
      this.onPage(page, this.pages.length === 1);
    }
    return { batch: page, ...page.add(geometry, matrix, slot, small) };
  }

  /**
   * Bounds of every page; pages other than the first that stayed empty for EMPTY_PAGE_KEEP_MS are removed from the
   * scene and freed (flying on, the next tiles usually fill them again: a new page costs its first upload).
   */
  refresh(): void {
    const now = performance.now();
    for (let k = this.pages.length - 1; k >= 0; k--) {
      const page = this.pages[k];
      if (!page.empty || !page.mesh.parent) {
        page.emptySince = 0;
      } else if (!page.emptySince) {
        page.emptySince = now;
      }
      if (k > 0 && page.emptySince && now - page.emptySince > EMPTY_PAGE_KEEP_MS) {
        page.mesh.removeFromParent();
        page.mesh.dispose();
        this.pages.splice(k, 1);
      } else {
        page.refreshBounds();
      }
    }
  }

  dispose(): void {
    for (const p of this.pages) {
      p.mesh.removeFromParent();
      p.mesh.dispose();
    }
    this.pages.length = 0;
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
  if (mesh.geometry.index) {
    indexRingOf(mesh).drawn = true;
  }
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

/** Textures handed to an initTexture hook (by the streamers' queues or a page's admission): uploaded once. */
const uploadedTextures = new WeakSet<THREE.Texture>();

/** Whether the texture's image is decoded (it can be uploaded). */
export function textureReady(t: THREE.Texture): boolean {
  const image = t.image as { width?: number; complete?: boolean } | undefined;
  return !!image && (image.width ?? 0) > 0 && image.complete !== false;
}

/** GPU bytes of a texture's upload (RGBA8, with mipmaps). */
export function textureBytes(t: THREE.Texture): number {
  const image = t.image as { width?: number; height?: number } | undefined;
  return (image?.width ?? 0) * (image?.height ?? 0) * 4 * (t.generateMipmaps ? 4 / 3 : 1);
}

/**
 * Texture bytes (with mipmaps) uploaded ahead of their first use per frame, shared by every streamer and batch set
 * (reset by TileBatches.work, which the owner calls once per frame): at least one texture per frame, else up to
 * `bytes`. The GPU side is the limit, not the call: four to eight 1024^2 textures in one frame (the streamers' and the
 * page admissions' own budgets added up) made 10-15 ms of upload calls and 50 ms frames at prefetch.
 */
export const textureBudget = {
  bytes: 6e6,
  used: 0,
  fits(bytes: number): boolean {
    return this.used === 0 || this.used + bytes <= this.bytes;
  },
};

/** Uploads a decoded texture through `init` once (counted in textureBudget); returns whether this call uploaded it. */
export function uploadTexture(t: THREE.Texture, init: (t: THREE.Texture) => void): boolean {
  if (uploadedTextures.has(t) || !textureReady(t)) {
    return false;
  }
  uploadedTextures.add(t);
  textureBudget.used += Math.max(1, textureBytes(t));
  init(t);
  return true;
}

/** Decoded textures of a material not uploaded yet. */
export function pendingTextures(m: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const v of Object.values(m)) {
    const t = v as THREE.Texture | null;
    if (t?.isTexture && !uploadedTextures.has(t) && textureReady(t) && !out.includes(t)) {
      out.push(t);
    }
  }
  return out;
}

/**
 * Uploads a material's pending textures one by one while they fit the frame's budget; returns whether none is left
 * (the object using the material may join the scene).
 */
export function uploadWithinBudget(m: THREE.Material, init: (t: THREE.Texture) => void): boolean {
  for (const t of pendingTextures(m)) {
    if (!textureBudget.fits(textureBytes(t))) {
      return false;
    }
    uploadTexture(t, init);
  }
  return true;
}

/** Whether the texture went through uploadTexture. */
export function textureUploaded(t: THREE.Texture): boolean {
  return uploadedTextures.has(t);
}

/** Bytes a batch's first draw uploads: the filled part of its buffers when they are lazy (lazyUpload), else all. */
function firstUploadBytes(mesh: THREE.BatchedMesh): number {
  const g = mesh.geometry;
  const part = (a: THREE.BufferAttribute): number => {
    const used = lazyInstalledAny ? lazyArrays.get(a.array) : undefined;
    return used ? Math.min(a.array.length, used()) * a.array.BYTES_PER_ELEMENT : a.array.byteLength;
  };
  let bytes = g.index ? part(g.index) : 0;
  for (const name in g.attributes) {
    bytes += part(g.attributes[name] as THREE.BufferAttribute);
  }
  return bytes;
}

/** Buffer events of all batches (debug stats). */
export const batchCounters = { pages: 0, compactions: 0, listUploads: 0 };

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
 * FAR_CASCADE_WIDTH draw it. The mesh must be frustum culled (it may have an infinite bounding sphere). While `warm`
 * returns false it is drawn by every cascade whatever its bounds (its first, empty draw uploads its buffers).
 */
export function shadowOnly(mesh: THREE.Object3D, far: boolean | null, warm?: () => boolean): void {
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
    return (warm !== undefined && !warm()) || !!intersects(frustum);
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
  /** Last paced write of its parts (see paceUpload): the tile is ready once it was released for upload. */
  uploadSeq: number;
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
  /** Fade table of the tiles' slots: the owner's (disposed with the batches) unless one is shared across streamers. */
  readonly fade: FadeTable;
  private readonly ownsFade: boolean;
  /** Batch per material; materials that merge (see mergeKey) share one. */
  private readonly batches = new Map<THREE.Material, { batch: PagedBatch; layout: Layout }>();
  private readonly merged = new Map<string, { batch: PagedBatch; layout: Layout }>();
  private readonly mergedMaterials: THREE.Material[] = [];
  private readonly proxies = new Map<string, PagedBatch>();
  private readonly proxyMaterials = new Map<THREE.Side, THREE.Material>();
  private readonly patched = new WeakSet<THREE.Material>();
  private readonly tiles = new Map<string, TileBatchEntry>();
  /** Pages not in the scene yet (compiling, or waiting in uploadQueue). Tiles are shown once there are none. */
  private readonly pendingBatches: THREE.BatchedMesh[] = [];
  /** Compiled pages that enter the scene within the per-frame upload budget. */
  private readonly uploadQueue: THREE.BatchedMesh[] = [];

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
    /** A fade table shared with other streamers (one slot space, e.g. for one host hole mask over several areas). */
    fade?: FadeTable,
    /**
     * Uploads a texture (e.g. `(t) => renderer.initTexture(t)`): a page's textures are uploaded within the page upload
     * budget before it joins the scene, instead of all at once by its first draw.
     */
    private readonly initTexture?: (texture: THREE.Texture) => void,
  ) {
    this.fade = fade ?? new FadeTable();
    this.ownsFade = !fade;
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
    this.tiles.set(key, { slot, placed: [], proxies: [], queue, job: null, shown: false, proxiesShown: false, uploadSeq: 0 });
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

  /**
   * Whether all parts of the tile are in the batches and every page it uses is in the scene. Only the tile's own pages
   * count: a page another tile is waiting for must never hide (or hold back) this one.
   */
  isComplete(key: string): boolean {
    const e = this.tiles.get(key);
    return !!e && TileBatches.ready(e);
  }

  /** Whether the tile is drawn (see setShown). */
  isShown(key: string): boolean {
    return this.tiles.get(key)?.shown ?? false;
  }

  private static ready(e: TileBatchEntry): boolean {
    const on = (p: PlacedGeometry): boolean => !!p.batch.mesh.parent;
    return e.queue.length === 0 && !e.job && e.uploadSeq <= paceSeq.released && e.placed.every(on) && e.proxies.every(on);
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
    // Once shown a tile stays drawn until its fade reaches 0 (its pages never leave the scene while it uses them).
    const show = fade > 0 && (e.shown || TileBatches.ready(e));
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
    // A new frame's texture upload budget (see textureBudget), and this frame's share of paced geometry uploads.
    textureBudget.used = 0;
    releasePacedUploads();
    this.admitPages();
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
        entry.placed.push(batch.add(geometry, matrix, entry.slot));
        const m = part.material;
        if (m.userData.castShadow === true && castsThroughProxy(m)) {
          // Its shadow comes from the proxy batch of its shadow side (positions and index only).
          const shadow = new THREE.BufferGeometry();
          shadow.setAttribute('position', geometry.attributes.position);
          shadow.setIndex(geometry.index);
          shadow.boundingSphere = geometry.boundingSphere;
          const proxy = this.proxyBatch(shadowSideOf(m));
          const small = m.userData.surface !== undefined && !LARGE_CASTER_SURFACES.has(m.userData.surface as string);
          entry.proxies.push(proxy.add(shadow, matrix, null, small));
        }
        entry.uploadSeq = paceSeq.queued;
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
      for (const page of batch.pages) {
        page.mesh.receiveShadow = on;
      }
    }
    for (const p of this.proxies.values()) {
      for (const page of p.pages) {
        page.mesh.castShadow = on;
      }
    }
  }

  batchCount(): number {
    let n = 0;
    for (const { batch } of new Set(this.batches.values())) {
      n += batch.pages.length;
    }
    for (const p of this.proxies.values()) {
      n += p.pages.length;
    }
    return n;
  }

  dispose(): void {
    for (const key of [...this.tiles.keys()]) {
      this.removeTile(key);
    }
    for (const { batch } of new Set(this.batches.values())) {
      batch.dispose();
    }
    for (const m of this.mergedMaterials) {
      m.dispose();
    }
    for (const p of this.proxies.values()) {
      p.dispose();
    }
    for (const m of this.proxyMaterials.values()) {
      m.dispose();
    }
    this.batches.clear();
    this.proxies.clear();
    if (this.ownsFade) {
      this.fade.dispose();
    }
  }

  /** Updates the batches' bounding spheres after tiles were added, removed, shown or hidden. */
  refresh(): void {
    for (const { batch } of new Set(this.batches.values())) {
      batch.refresh();
    }
    for (const p of this.proxies.values()) {
      p.refresh();
    }
  }

  private batchOf(part: TilePart): { batch: PagedBatch; layout: Layout } {
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
      const v = part.geometry.attributes.position.count;
      const i = part.geometry.index?.count ?? v;
      const capacity = { vertices: Math.max(INITIAL_VERTICES, Math.ceil(v * SLACK * PAGE_TILES)), indices: Math.max(INITIAL_INDICES, Math.ceil(i * SLACK * PAGE_TILES)) };
      const detail = this.detailLayerOf(material);
      // Casters with cut-outs keep casting from their own batch (the proxies have no alpha).
      const casts = material.userData.castShadow === true && !TileBatches.proxyable(material);
      const batch = new PagedBatch(`tiles:${host.name}`, host, capacity, false, (page, first) => {
        if (detail) {
          page.mesh.layers.set(this.detailLayer);
        }
        page.mesh.receiveShadow = this.shadows;
        page.mesh.castShadow = this.shadows && casts;
        // Later pages share the first page's program (same material and attribute layout).
        if (first) {
          this.join(page.mesh);
        } else {
          this.pendingBatches.push(page.mesh);
          this.uploadQueue.push(page.mesh);
        }
      });
      b = { batch, layout };
      if (key) {
        this.merged.set(key, b);
      }
    }
    this.batches.set(material, b);
    return b;
  }

  private detailLayerOf(m: THREE.Material): boolean {
    return m.userData.surface !== undefined && !LARGE_CASTER_SURFACES.has(m.userData.surface as string);
  }

  /** Adds a new batch to the scene, after its program is compiled when a compile hook is given. */
  private join(mesh: THREE.BatchedMesh): void {
    this.pendingBatches.push(mesh);
    if (!this.compile) {
      this.uploadQueue.push(mesh);
      return;
    }
    // The program depends on the batch's attributes and batching colour: compile once the first tile part is in.
    queueMicrotask(() => {
      void this.compile!(mesh)
        .catch(() => undefined)
        .then(() => this.uploadQueue.push(mesh));
    });
  }

  /**
   * Moves compiled pages into the scene within the per-frame upload budget (at least one page), their material's
   * textures not uploaded yet included.
   */
  private admitPages(): void {
    let mb = 0;
    while (this.uploadQueue.length) {
      const mesh = this.uploadQueue[0];
      const bytes = firstUploadBytes(mesh);
      if (mb > 0 && mb + bytes / 1e6 > PAGE_UPLOAD_MB_PER_FRAME) {
        break;
      }
      if (this.initTexture && !uploadWithinBudget(mesh.material as THREE.Material, this.initTexture)) {
        break;
      }
      mb += bytes / 1e6;
      this.uploadQueue.shift();
      this.group.add(mesh);
      this.pendingBatches.splice(this.pendingBatches.indexOf(mesh), 1);
    }
  }

  private static proxyable = castsThroughProxy;

  private proxyBatch(side: THREE.Side): PagedBatch {
    const key = String(side);
    let b = this.proxies.get(key);
    if (!b) {
      let material = this.proxyMaterials.get(side);
      if (!material) {
        material = proxyMaterial(side);
        this.proxyMaterials.set(side, material);
      }
      b = new PagedBatch(`tiles:shadow:${key}`, material, { vertices: PROXY_PAGE_VERTICES, indices: PROXY_PAGE_INDICES }, true, (page) => {
        shadowOnly(page.mesh, null, () => page.warm);
        page.mesh.castShadow = this.shadows;
        page.mesh.receiveShadow = false;
        this.pendingBatches.push(page.mesh);
        this.uploadQueue.push(page.mesh);
      });
      this.proxies.set(key, b);
    }
    return b;
  }
}
