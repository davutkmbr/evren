import type { BuiltModel } from '../gen/types';
import type { MosqueJob, MosqueRequest, MosqueResponse } from './protocol';

interface PendingJob {
  resolve: (models: BuiltModel[]) => void;
  reject: (err: Error) => void;
}

/**
 * Small pool of generator workers. Jobs go to the least busy worker; if workers cannot be created the jobs run on the
 * main thread (lazily imported) so the module still works in restricted contexts.
 */
export class MosqueWorkerPool {
  private workers: Worker[] = [];
  private load: number[] = [];
  private pending = new Map<number, PendingJob & { worker: number }>();
  private nextId = 1;
  private fallback = false;
  private disposed = false;

  constructor(size: number) {
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL('./mosque.worker.ts', import.meta.url), { type: 'module', name: `mosques-${i}` });
        const index = i;
        w.onmessage = (e: MessageEvent<MosqueResponse>) => this.onMessage(index, e.data);
        w.onerror = (e) => {
          console.error('[mosques] worker error', e.message);
        };
        this.workers.push(w);
        this.load.push(0);
      }
    } catch (err) {
      console.warn('[mosques] workers unavailable, generating on the main thread', err);
      this.fallback = true;
    }
  }

  get busy(): number {
    return this.pending.size;
  }

  run(job: MosqueJob): Promise<BuiltModel[]> {
    if (this.fallback || this.workers.length === 0) {
      return import('./run').then((m) => m.runMosqueJob(job));
    }
    const id = this.nextId++;
    let best = 0;
    for (let i = 1; i < this.load.length; i++) {
      if (this.load[i] < this.load[best]) {
        best = i;
      }
    }
    this.load[best]++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, worker: best });
      const request: MosqueRequest = { id, job };
      this.workers[best].postMessage(request);
    });
  }

  private onMessage(worker: number, res: MosqueResponse): void {
    const p = this.pending.get(res.id);
    if (!p) {
      return;
    }
    this.pending.delete(res.id);
    this.load[worker] = Math.max(0, this.load[worker] - 1);
    if (this.disposed) {
      return;
    }
    if (res.error) {
      p.reject(new Error(res.error));
    } else {
      p.resolve(res.models);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
    this.pending.clear();
  }
}
