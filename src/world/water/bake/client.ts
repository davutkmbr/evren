/**
 * Runs the water bakes in a module worker (falls back to the main thread if workers are unavailable).
 */
import type { SpectrumJobResult, WaterJobRequest, WaterJobResponse } from './protocol';
import type { RegionBakeInput, RegionBakeResult } from './region-bake';

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void };

export class WaterBakeClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly jobs = new Map<number, Pending>();
  private outstanding = 0;

  constructor() {
    try {
      this.worker = new Worker(new URL('./water.worker.ts', import.meta.url), { type: 'module', name: 'water-bake' });
      this.worker.onmessage = (e: MessageEvent<WaterJobResponse>) => this.onMessage(e.data);
      this.worker.onerror = (e) => {
        console.error('[water] bake worker error', e.message);
        for (const job of this.jobs.values()) {
          job.reject(new Error(e.message || 'worker error'));
        }
        this.jobs.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    } catch (err) {
      console.warn('[water] module worker unavailable, baking on the main thread', err);
      this.worker = null;
    }
  }

  get pending(): number {
    return this.outstanding;
  }

  spectrum(): Promise<SpectrumJobResult> {
    return this.run<SpectrumJobResult>({ id: 0, kind: 'spectrum' }, async () => {
      const t0 = performance.now();
      const [{ bakeBands }, { bakeFoam }] = await Promise.all([import('./spectrum-bake'), import('./foam-bake')]);
      return { bands: bakeBands(), foam: bakeFoam(), ms: Math.round(performance.now() - t0) };
    });
  }

  regions(input: RegionBakeInput): Promise<RegionBakeResult> {
    return this.run<RegionBakeResult>({ id: 0, kind: 'regions', input }, async () => {
      const { bakeRegions } = await import('./region-bake');
      return bakeRegions(input);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.jobs.clear();
  }

  private async run<T>(request: WaterJobRequest, fallback: () => Promise<T>): Promise<T> {
    this.outstanding++;
    try {
      if (!this.worker) {
        return await fallback();
      }
      const id = this.nextId++;
      const job = { ...request, id } as WaterJobRequest;
      const result = await new Promise<unknown>((resolve, reject) => {
        this.jobs.set(id, { resolve, reject });
        // Inputs are copied (not transferred) so the main-thread fallback can still use them.
        this.worker!.postMessage(job);
      }).catch(async (err: Error) => {
        console.warn('[water] worker bake failed, retrying on the main thread', err.message);
        return fallback();
      });
      return result as T;
    } finally {
      this.outstanding--;
    }
  }

  private onMessage(msg: WaterJobResponse): void {
    const job = this.jobs.get(msg.id);
    if (!job) {
      return;
    }
    this.jobs.delete(msg.id);
    if (msg.ok) {
      job.resolve(msg.result);
    } else {
      job.reject(new Error(msg.error));
    }
  }
}
