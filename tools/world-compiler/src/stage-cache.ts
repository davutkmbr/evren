/**
 * Per-stage tile cache. A tile compiles as a chain of stages: its inputs, then each compile step (registry.ts) in
 * order, then assembly (LODs, glbs, validation, manifest). Each step's effect on the tile is recorded:
 * - the TileMesh calls it made (method, LOD mask, arguments), replayed through the same TileMesh code;
 * - the tile state after it: instances, lights, the lights still to attach, step records, the tile manifest;
 * - the statistics it added to the area (ground totals, placement log) and, for ordered steps, its exit state.
 *
 * Keys chain through the tile: the input key covers the global inputs (sources.ts globalInputs), the setup's source
 * closure, the options, the tile as the area setup made it and the OSM data (the whole file in `strict` scope, the
 * features around the tile in `local` scope); a step's key covers the chain so far (input key plus the digests of
 * the earlier steps' effects), the step's own source closure (sources.ts stepSourceHash) and, for ordered steps, the
 * entry state. Changing one step's code therefore re-runs that step; the steps after it re-run only when its effect
 * changed (their key includes its digest), the steps before it are replayed, and the tile is re-assembled.
 * Assembly is cached as a whole tile (cache.ts TileCache) under a key over the final chain and the assembly closure.
 *
 * Effects are stored per tile and step as zstd-compressed v8 serializations under
 * node_modules/.cache/evren-world/stages/<area>-<options>/<tile>/<step>.<key>.<digest>.bin.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { threadId } from 'node:worker_threads';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { CACHE_ROOT } from './cache';
import type { InstanceRec, LightRec, TileManifest } from './format';
import type { InstanceSink } from './instances';
import type { LightSink } from './lights';
import type { TileMesh } from './mesh';
import { type TileStats, statsDelta, statsOf } from './parallel/tile-out';
import type { AreaContext, CompileStep } from './registry';
import { stepSourceHash } from './sources';

const sha = (...parts: (string | Uint8Array)[]): string => {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('\0');
  }
  return h.digest('hex').slice(0, 24);
};

/** TileMesh methods that change the mesh (outermost calls are recorded; decalOnWall calls decal itself). */
const MESH_WRITES = ['groundPolygon', 'flatPolygon', 'flatTriangles', 'wall', 'decal', 'decalOnWall', 'addMesh'] as const;
type MeshCall = [(typeof MESH_WRITES)[number], number, unknown[]];

/**
 * Mesh calls in a compact binary form, written while recording (no copies of the arguments): a tag stream, a count
 * stream (array lengths, string and key ids), the numbers (float64, exact) and a string table. Typed arrays keep
 * their class. Several times smaller and faster than serializing the argument objects.
 */
const enum Tag {
  Num,
  Str,
  Undef,
  Null,
  True,
  False,
  Arr,
  Obj,
  F32,
  F64,
  U16,
  U32,
  I32,
  U8,
}
const TYPED: [Tag, new (n: number) => ArrayLike<number> & { [i: number]: number }][] = [
  [Tag.F32, Float32Array],
  [Tag.F64, Float64Array],
  [Tag.U16, Uint16Array],
  [Tag.U32, Uint32Array],
  [Tag.I32, Int32Array],
  [Tag.U8, Uint8Array],
];

class Grow<T extends Uint8Array | Uint32Array | Float64Array> {
  n = 0;
  constructor(public a: T) {}
  push(v: number): void {
    if (this.n === this.a.length) {
      const b = new (this.a.constructor as new (n: number) => T)(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  done(): T {
    return this.a.slice(0, this.n) as T;
  }
}

interface PackedCalls {
  tags: Uint8Array;
  counts: Uint32Array;
  nums: Float64Array;
  strs: string[];
  calls: number;
}

class CallLog {
  private readonly tags = new Grow(new Uint8Array(1 << 16));
  private readonly counts = new Grow(new Uint32Array(1 << 14));
  private readonly nums = new Grow(new Float64Array(1 << 16));
  private readonly strs = new Map<string, number>();
  private calls = 0;

  private str(v: string): void {
    let i = this.strs.get(v);
    if (i === undefined) {
      i = this.strs.size;
      this.strs.set(v, i);
    }
    this.counts.push(i);
  }

  private enc(v: unknown): void {
    if (typeof v === 'number') {
      this.tags.push(Tag.Num);
      this.nums.push(v);
    } else if (typeof v === 'string') {
      this.tags.push(Tag.Str);
      this.str(v);
    } else if (v === undefined) {
      this.tags.push(Tag.Undef);
    } else if (v === null) {
      this.tags.push(Tag.Null);
    } else if (typeof v === 'boolean') {
      this.tags.push(v ? Tag.True : Tag.False);
    } else if (Array.isArray(v)) {
      this.tags.push(Tag.Arr);
      this.counts.push(v.length);
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        if (typeof x === 'number') {
          this.tags.push(Tag.Num);
          this.nums.push(x);
        } else {
          this.enc(x);
        }
      }
    } else if (ArrayBuffer.isView(v)) {
      const t = TYPED.find(([, C]) => v instanceof C);
      if (!t) {
        throw new Error(`stage cache: cannot record a ${v.constructor.name}`);
      }
      const a = v as unknown as ArrayLike<number>;
      this.tags.push(t[0]);
      this.counts.push(a.length);
      for (let i = 0; i < a.length; i++) {
        this.nums.push(a[i]);
      }
    } else if (typeof v === 'object') {
      const keys = Object.keys(v);
      this.tags.push(Tag.Obj);
      this.counts.push(keys.length);
      for (const k of keys) {
        this.str(k);
        this.enc((v as Record<string, unknown>)[k]);
      }
    } else {
      throw new Error(`stage cache: cannot record a ${typeof v}`);
    }
  }

  push(name: string, mask: number, args: unknown[]): void {
    this.str(name);
    this.nums.push(mask);
    this.enc(args);
    this.calls++;
  }

  packed(): PackedCalls {
    return { tags: this.tags.done(), counts: this.counts.done(), nums: this.nums.done(), strs: [...this.strs.keys()], calls: this.calls };
  }

  static *unpack(p: PackedCalls): Generator<MeshCall> {
    let t = 0;
    let c = 0;
    let n = 0;
    const dec = (): unknown => {
      const tag = p.tags[t++] as Tag;
      switch (tag) {
        case Tag.Num:
          return p.nums[n++];
        case Tag.Str:
          return p.strs[p.counts[c++]];
        case Tag.Undef:
          return undefined;
        case Tag.Null:
          return null;
        case Tag.True:
          return true;
        case Tag.False:
          return false;
        case Tag.Arr: {
          const len = p.counts[c++];
          const out = new Array<unknown>(len);
          for (let i = 0; i < len; i++) {
            out[i] = dec();
          }
          return out;
        }
        case Tag.Obj: {
          const len = p.counts[c++];
          const out: Record<string, unknown> = {};
          for (let i = 0; i < len; i++) {
            const k = p.strs[p.counts[c++]];
            out[k] = dec();
          }
          return out;
        }
        default: {
          const C = TYPED.find(([x]) => x === tag)![1];
          const len = p.counts[c++];
          const out = new C(len);
          for (let i = 0; i < len; i++) {
            out[i] = p.nums[n++];
          }
          return out;
        }
      }
    };
    for (let k = 0; k < p.calls; k++) {
      const name = p.strs[p.counts[c++]] as MeshCall[0];
      const mask = p.nums[n++];
      yield [name, mask, dec() as unknown[]];
    }
  }
}

export interface Pending {
  rec: InstanceRec;
  yaw: number;
  over: unknown;
}

/** The tile state a step can change (cli.ts compileTile). */
export interface TileIO {
  mesh: TileMesh;
  instances: InstanceSink;
  lights: LightSink;
  pending: Pending[];
  extra: Record<string, unknown>;
  manifest: TileManifest;
}

interface Effect {
  calls: PackedCalls;
  instances: InstanceRec[];
  lights: LightRec[];
  pending: { i: number; yaw: number; over: unknown }[];
  extra: Record<string, unknown>;
  manifest: TileManifest;
  stats: TileStats;
  ordered?: unknown;
}

/**
 * Makes `target` deep-equal to `value` in place, keeping the identity of nested objects and arrays that exist on
 * both sides (the manifest's building and door records are the solids' records; later steps may hold them).
 */
function syncInto(target: Record<string, unknown> | unknown[], value: Record<string, unknown> | unknown[]): void {
  const put = (get: unknown, set: (v: unknown) => void, v: unknown): void => {
    if (get && v && typeof get === 'object' && typeof v === 'object' && Array.isArray(get) === Array.isArray(v) && !ArrayBuffer.isView(get)) {
      syncInto(get as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      set(v);
    }
  };
  if (Array.isArray(target)) {
    const v = value as unknown[];
    target.length = Math.min(target.length, v.length);
    for (let i = 0; i < v.length; i++) {
      if (i < target.length) {
        put(target[i], (x) => (target[i] = x), v[i]);
      } else {
        target.push(v[i]);
      }
    }
    return;
  }
  // Objects: the stored key order wins (the manifest is written with JSON.stringify), nested identities stay.
  const v = value as Record<string, unknown>;
  const old: Record<string, unknown> = { ...target };
  for (const k of Object.keys(target)) {
    delete target[k];
  }
  for (const k of Object.keys(v)) {
    put(old[k], (x) => (target[k] = x), v[k]);
    if (!(k in target)) {
      target[k] = old[k];
    }
  }
}

/**
 * Canonical digest of an effect: the call streams' bytes and the JSON of the state (the serialized bytes also encode
 * which objects are shared, which differs between a live and a replayed run of the same step).
 */
function digestOf(e: Effect): string {
  const { calls, ...state } = e;
  const bytes = (a: ArrayBufferView): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  return sha(bytes(calls.tags), bytes(calls.counts), bytes(calls.nums), JSON.stringify(calls.strs), String(calls.calls), JSON.stringify(state));
}

/** Effect files of one area and option set. */
export class StageStore {
  private readonly dir: string;

  constructor(area: string, optionsKey: string) {
    this.dir = join(CACHE_ROOT, 'stages', `${area}-${sha(optionsKey).slice(0, 8)}`);
  }

  tile(id: string): TileStages {
    return new TileStages(join(this.dir, id));
  }
}

/** TileMesh's private helpers (steps cannot call them). */
const PRIVATE_MESH = /^(part|newChart|setColor|setWeather|smoothVertex|flatVertex|smoothTri|flatTri)$/;
/** TileMesh methods that read the mesh: pending writes are applied first. */
const MESH_READS = ['triangles', 'lodsIdentical', 'materials', 'take', 'takeLod'] as const;

/**
 * Lazy mesh writes. While a tile's steps run through the stage cache, TileMesh writes are only logged: replayed
 * effects queue their stored calls, live steps queue the calls they record. The first read of the mesh (a step
 * asking for its triangle count, or assembly) applies the queue in order and switches the tile to direct writes.
 * A tile whose assembly comes from the tile cache never builds its mesh: re-running one step (a lane-paint rule)
 * costs that step, not the replay of ground and façades.
 */
class MeshGate {
  private readonly queue: (PackedCalls | (() => PackedCalls))[] = [];
  private eager = false;
  private log: CallLog | null = null;
  private depth = 0;
  private readonly proto: Record<string, (...args: unknown[]) => unknown>;

  constructor(private readonly mesh: TileMesh) {
    const m = mesh as unknown as Record<string, (...args: unknown[]) => unknown> & { lodMask: number };
    this.proto = Object.getPrototypeOf(mesh) as Record<string, (...args: unknown[]) => unknown>;
    // A new public TileMesh method must be classified, or replays would silently miss (or reorder) what it does.
    const known = new Set<string>(['constructor', 'withLod', ...MESH_WRITES, ...MESH_READS]);
    for (const name of Object.getOwnPropertyNames(this.proto)) {
      if (!known.has(name) && typeof this.proto[name] === 'function' && !Object.getOwnPropertyDescriptor(this.proto, name)?.get) {
        // Private helpers (TypeScript `private`) are not called by steps: they are fine unclassified.
        if (!PRIVATE_MESH.test(name)) {
          throw new Error(`stage cache: TileMesh.${name} is neither in MESH_WRITES, MESH_READS nor PRIVATE_MESH (stage-cache.ts): classify it`);
        }
      }
    }
    for (const name of MESH_WRITES) {
      m[name] = (...args: unknown[]) => {
        if (this.depth === 0) {
          if (this.log) {
            this.log.push(name, m.lodMask, args);
            if (!this.eager) {
              return undefined;
            }
          } else {
            this.flush();
          }
        }
        return this.call(name, args);
      };
    }
    for (const name of MESH_READS) {
      m[name] = (...args: unknown[]) => {
        this.flush();
        return this.proto[name].apply(mesh, args);
      };
    }
  }

  private call(name: string, args: unknown[]): unknown {
    this.depth++;
    try {
      return this.proto[name].apply(this.mesh, args);
    } finally {
      this.depth--;
    }
  }

  private apply(p: PackedCalls): void {
    const m = this.mesh as unknown as { lodMask: number };
    for (const [name, mask, args] of CallLog.unpack(p)) {
      const prev = m.lodMask;
      m.lodMask = mask;
      this.call(name, args);
      m.lodMask = prev;
    }
  }

  /** Applies everything queued (and the live step's calls so far); later writes apply at once. */
  flush(): void {
    if (this.eager) {
      return;
    }
    this.eager = true;
    for (const p of this.queue) {
      this.apply(typeof p === 'function' ? p() : p);
    }
    this.queue.length = 0;
    if (this.log) {
      this.apply(this.log.packed());
    }
  }

  /** A stored effect's calls (loaded when the mesh is built: a tile assembled from the cache never loads them). */
  defer(load: () => PackedCalls): void {
    if (this.eager) {
      this.apply(load());
    } else {
      this.queue.push(load);
    }
  }

  begin(): void {
    this.log = new CallLog();
  }

  /** The live step's calls; queued unless they were applied already. */
  end(): PackedCalls {
    const p = this.log!.packed();
    if (!this.eager) {
      this.queue.push(p);
    }
    this.log = null;
    return p;
  }
}

/** The stage chain of one tile in one run. */
export class TileStages {
  private names: string[] | null = null;
  private readonly used = new Set<string>();
  /** Current chain value (input key, then after each step). */
  chain = '';
  replayed = 0;
  ran = 0;

  private gate: MeshGate | null = null;

  constructor(private readonly dir: string) {}

  /** Puts the tile's mesh behind the lazy write gate (MeshGate). */
  attach(mesh: TileMesh): void {
    this.gate = new MeshGate(mesh);
  }

  private list(): string[] {
    if (!this.names) {
      this.names = existsSync(this.dir) ? readdirSync(this.dir) : [];
    }
    return this.names;
  }

  /** Key of `step` after the current chain (ordered steps: `entry` is their entry state). */
  key(step: CompileStep, entry?: unknown): string {
    return sha(this.chain, step.id, stepSourceHash(step.id), entry === undefined ? '' : serialize(entry));
  }

  /** The stored effect's file name under `key`, or null. */
  find(step: CompileStep, key: string): string | null {
    const prefix = `${step.id}.${key}.`;
    return this.list().find((n) => n.startsWith(prefix) && n.endsWith('.bin') && this.list().includes(`${n}.calls`)) ?? null;
  }

  /**
   * Moves the chain past a stored effect (its digest is in the file name). The chain names the tile state: the state
   * before the step and the step's effect, not the step's code, so a code change that leaves the effect unchanged
   * does not reach the steps after it.
   */
  advance(file: string): void {
    this.used.add(file);
    this.chain = sha(this.chain, file.split('.')[2]);
  }

  /** Applies a stored effect to the tile. */
  replay(file: string, step: CompileStep, io: TileIO, a: AreaContext, addStats: (s: TileStats) => void): void {
    const e = deserialize(zstdDecompressSync(readFileSync(join(this.dir, file)))) as Omit<Effect, 'calls'>;
    const calls = join(this.dir, `${file}.calls`);
    this.gate!.defer(() => deserialize(zstdDecompressSync(readFileSync(calls))) as PackedCalls);
    syncInto(io.instances.list, e.instances);
    syncInto(io.lights.list, e.lights);
    io.pending.length = 0;
    for (const p of e.pending) {
      io.pending.push({ rec: io.instances.list[p.i], yaw: p.yaw, over: p.over });
    }
    syncInto(io.extra, e.extra);
    syncInto(io.manifest as unknown as Record<string, unknown>, e.manifest as unknown as Record<string, unknown>);
    addStats(e.stats);
    if (step.ordered) {
      step.ordered.restore(a, e.ordered);
    }
    this.replayed++;
  }

  /** Runs a step live, records its effect, stores it under `key` and moves the chain. */
  async record(key: string, step: CompileStep, io: TileIO, a: AreaContext, run: () => Promise<void>): Promise<void> {
    const before = statsOf(a);
    this.gate!.begin();
    let calls: PackedCalls;
    try {
      await run();
    } finally {
      calls = this.gate!.end();
    }
    const index = new Map(io.instances.list.map((r, i) => [r, i]));
    const effect: Effect = {
      calls,
      instances: structuredClone(io.instances.list),
      lights: structuredClone(io.lights.list),
      pending: io.pending.map((p) => ({ i: index.get(p.rec) ?? -1, yaw: p.yaw, over: structuredClone(p.over) })).filter((p) => p.i >= 0),
      extra: structuredClone(io.extra),
      manifest: structuredClone(io.manifest),
      stats: statsDelta(before, statsOf(a)),
      ...(step.ordered ? { ordered: structuredClone(step.ordered.state(a)) } : {}),
    };
    const file = `${step.id}.${key}.${digestOf(effect)}.bin`;
    mkdirSync(this.dir, { recursive: true });
    // The mesh calls go to a file of their own, read only when the tile's mesh is built.
    const { calls: _, ...state } = effect;
    for (const [name, value] of [[`${file}.calls`, calls], [file, state]] as const) {
      const tmp = join(this.dir, `.${name}.${process.pid}-${threadId}.tmp`);
      writeFileSync(tmp, zstdCompressSync(serialize(value)));
      renameSync(tmp, join(this.dir, name));
    }
    this.list().push(`${file}.calls`, file);
    this.advance(file);
    this.ran++;
  }

  /** Removes this tile's effects that the run did not use (older keys). */
  prune(): void {
    for (const n of existsSync(this.dir) ? readdirSync(this.dir) : []) {
      if (!this.used.has(n.replace(/\.calls$/, ''))) {
        rmSync(join(this.dir, n), { force: true });
      }
    }
  }
}
