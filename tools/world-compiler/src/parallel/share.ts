/**
 * Setup sharing for worker threads (--jobs): the main thread builds the plain-data part of the area setup once (the
 * terrain windows, coast field and street raster: foundation.ts SharedFoundation, and more below) and hands it to
 * every thread. Large typed arrays move into SharedArrayBuffers first, so the threads read one copy instead of
 * holding one each; structured cloning keeps everything else (objects, arrays, Maps) as it is.
 */
import { parentPort } from 'node:worker_threads';

type Typed = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;

/** Arrays smaller than this are copied with the message (sharing them saves nothing). */
const SHARE_MIN = 1 << 16;

/** A copy of `value` whose large typed arrays live in SharedArrayBuffers (the rest is the same objects). */
export function toShared<T>(value: T, seen = new Map<unknown, unknown>()): T {
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return seen.get(value) as T;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const a = value as unknown as Typed;
    if (a.byteLength < SHARE_MIN || a.buffer instanceof SharedArrayBuffer) {
      return value;
    }
    const C = a.constructor as new (b: SharedArrayBuffer) => Typed;
    const out = new C(new SharedArrayBuffer(a.byteLength));
    out.set(a as never);
    seen.set(value, out);
    return out as unknown as T;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const v of value) {
      out.push(toShared(v, seen));
    }
    return out as T;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [k, v] of Object.entries(value)) {
    out[k] = toShared(v, seen);
  }
  return out as T;
}

/** Jobs a worker runs for the main thread while it waits for the shared setup (TilePool.run jobs). */
export type SetupJobs = Record<string, (payload: never) => unknown>;

const inbox = new Map<string, unknown>();
const waiting = new Map<string, (v: unknown) => void>();
let jobTable: SetupJobs = {};
let listening = false;

/** One listener for the whole worker life: shared setup parts (by tag) and setup jobs; tiles go to serveTiles. */
function listen(): void {
  if (listening) {
    return;
  }
  listening = true;
  const port = parentPort!;
  port.on('message', (m: { type: string; tag?: string; value?: unknown; req?: number; job?: string; payload?: unknown }) => {
    if (m.type === 'share') {
      const w = waiting.get(m.tag!);
      if (w) {
        waiting.delete(m.tag!);
        w(m.value);
      } else {
        inbox.set(m.tag!, m.value);
      }
    } else if (m.type === 'job') {
      const value = jobTable[m.job!](m.payload as never);
      const transfer = ArrayBuffer.isView(value) && !(value.buffer instanceof SharedArrayBuffer) ? [value.buffer as ArrayBuffer] : [];
      port.postMessage({ type: 'jobDone', req: m.req, value }, transfer);
    }
  });
}

/**
 * Worker side: a part of the setup the main thread shares (TilePool.share with the same tag). Meanwhile the worker
 * answers setup jobs (e.g. rows of the coast grids the main thread's foundation needs).
 */
export function receiveShared<T>(tag: string, jobs: SetupJobs = {}): Promise<T> {
  jobTable = { ...jobTable, ...jobs };
  listen();
  if (inbox.has(tag)) {
    const v = inbox.get(tag) as T;
    inbox.delete(tag);
    return Promise.resolve(v);
  }
  return new Promise((resolve) => waiting.set(tag, resolve as (v: unknown) => void));
}
