/** A small pool of city generation workers with sticky routing (same region -> same worker -> warm layout cache). */
import type { CityInitMessage, CityWorkerResult, ColliderRequestMsg, ForgetMsg, TileRequestMsg } from './protocol';
import { windowTransfer } from './geo-window';

type Callback = (res: CityWorkerResult) => void;

export class CityWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly inflight: number[] = [];
  private readonly callbacks = new Map<number, { worker: number; cb: Callback }>();
  private nextId = 1;

  constructor(count: number) {
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./worker/city.worker.ts', import.meta.url), { type: 'module', name: `city-${i}` });
      w.onmessage = (ev: MessageEvent<CityWorkerResult>) => this.onResult(ev.data);
      w.onerror = (ev) => console.error('[city] worker error', ev.message);
      this.workers.push(w);
      this.inflight.push(0);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  init(msg: CityInitMessage): void {
    for (const w of this.workers) {
      w.postMessage(msg);
    }
  }

  /** Sends `msg` to every worker (after the jobs already posted to it). */
  broadcast(msg: ForgetMsg): void {
    for (const w of this.workers) {
      w.postMessage(msg);
    }
  }

  /** Number of jobs in flight on the worker a route maps to. */
  load(route: number): number {
    return this.inflight[this.workerFor(route)];
  }

  get totalInflight(): number {
    let n = 0;
    for (const v of this.inflight) {
      n += v;
    }
    return n;
  }

  private workerFor(route: number): number {
    return ((route % this.workers.length) + this.workers.length) % this.workers.length;
  }

  submit(route: number, msg: Omit<TileRequestMsg, 'id'> | Omit<ColliderRequestMsg, 'id'>, cb: Callback): number {
    const id = this.nextId++;
    const wi = this.workerFor(route);
    const full = { ...msg, id } as TileRequestMsg | ColliderRequestMsg;
    this.callbacks.set(id, { worker: wi, cb });
    this.inflight[wi]++;
    this.workers[wi].postMessage(full, windowTransfer(full.win));
    return id;
  }

  private onResult(res: CityWorkerResult): void {
    const entry = this.callbacks.get(res.id);
    if (!entry) {
      return;
    }
    this.callbacks.delete(res.id);
    this.inflight[entry.worker]--;
    entry.cb(res);
  }

  dispose(): void {
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers.length = 0;
    this.callbacks.clear();
  }
}
