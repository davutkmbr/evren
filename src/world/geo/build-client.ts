import { buildWorld } from './build/build-world';
import { prepareBuildInput } from './prepare';
import type { BuildOutput } from './types';
import type { GeoWorkerRequest, GeoWorkerResponse } from './worker-protocol';

type ResponseOf<T extends GeoWorkerResponse['type']> = Extract<GeoWorkerResponse, { type: T }>;

/** Thin promise wrapper around a geo worker: send requests, await typed responses. */
class GeoWorkerHandle {
  private readonly worker: Worker;
  private readonly waiting = new Map<string, (msg: GeoWorkerResponse) => void>();
  private readonly failures = new Set<(err: Error) => void>();
  /** Sticky: a worker error rejects every pending and every later expect() (an error between two awaits was lost). */
  private error: Error | null = null;

  constructor() {
    this.worker = new Worker(new URL('./geo.worker.ts', import.meta.url), { type: 'module', name: 'geo-build' });
    this.worker.onmessage = (e: MessageEvent<GeoWorkerResponse>) => {
      const resolve = this.waiting.get(e.data.type);
      this.waiting.delete(e.data.type);
      resolve?.(e.data);
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.error ??= new Error(e.message || 'geo worker failed');
      for (const reject of this.failures) {
        reject(this.error);
      }
      this.failures.clear();
    };
  }

  send(msg: GeoWorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  expect<T extends GeoWorkerResponse['type']>(type: T): Promise<ResponseOf<T>> {
    return new Promise((resolve, reject) => {
      if (this.error) {
        reject(this.error);
        return;
      }
      this.failures.add(reject);
      this.waiting.set(type, (msg) => {
        this.failures.delete(reject);
        (resolve as (msg: GeoWorkerResponse) => void)(msg);
      });
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}

/**
 * Runs the geo pipeline on two workers in parallel (A: coast → districts + land use, B: relief → heights → sites).
 * Wall time ≈ max(coast + land use, relief + heights) + sites.
 */
async function buildParallel(): Promise<BuildOutput> {
  const a = new GeoWorkerHandle();
  const b = new GeoWorkerHandle();
  try {
    const coastP = a.expect('coast');
    const reliefP = b.expect('relief');
    a.send({ type: 'coast' });
    b.send({ type: 'relief' });
    const coast = await coastP;
    const luP = a.expect('landuse');
    a.send({ type: 'landuse' });
    await reliefP;
    b.send({ type: 'height', coast: coast.coast, lakeDepth: coast.lakeDepth }, [coast.coast.buffer, coast.lakeDepth.buffer]);
    const lu = await luP;
    const doneP = b.expect('full');
    b.send({ type: 'finish', landUse: lu.landUse, density: lu.density, district: lu.district, timings: lu.timings }, [
      lu.landUse.buffer,
      lu.density.buffer,
      lu.district.buffer,
    ]);
    return (await doneP).out;
  } finally {
    a.terminate();
    b.terminate();
  }
}

/** Starts the geography build; falls back to the main thread when module workers are unavailable. */
export async function buildGeography(): Promise<BuildOutput> {
  const t0 = performance.now();
  try {
    const out = await buildParallel();
    out.timings.wall = Math.round(performance.now() - t0);
    return out;
  } catch (err) {
    console.warn('[geo] workers unavailable, building on the main thread', err);
    const out = buildWorld(prepareBuildInput().input);
    out.timings.wall = Math.round(performance.now() - t0);
    return out;
  }
}
