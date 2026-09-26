/**
 * Tile workers (`--jobs N`): worker threads that each run cli.ts's area setup (deterministic, so every thread holds
 * the same foundation, solids, graphs, plans and tile manifests) and then compile the tiles the main thread hands
 * them, one at a time from a shared queue (tiles differ ~20x in cost, so a static split would leave threads idle).
 * Each result is a TileOut record; the tile's glbs and manifest are already written to the output folder. The main
 * thread applies the records in tile order, so the output is byte-identical to a serial compile (`--check` compares).
 *
 * Sizing (autoJobs): cores - 1, capped by memory (each thread holds a full area setup; the estimate grows with the
 * area) and by the number of tiles.
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { perfSnapshot } from '../perf';
import type { TileOut } from './tile-out';

export interface WorkerInput {
  evrenCompileWorker: true;
  args: string[];
  /** Private folder for the thread's texture and prop bakers (their files are rebuilt by the main thread). */
  bakeDir: string;
}

/** Questions a worker asks the main thread: `state` (ordered steps, ordered.ts: the entry state of a tile). */
type AskKind = 'state';
type ToWorker = { type: 'tile'; id: string } | { type: 'exit' } | { type: 'answer'; req: number; value: unknown; error?: string } | { type: 'share' | 'job' };
type FromWorker =
  | { type: 'ready' }
  | { type: 'tile'; out: TileOut }
  | { type: 'error'; id: string | null; message: string; stack?: string }
  | { type: 'perf'; perf: Record<string, number> }
  | { type: 'ask'; req: number; kind: AskKind; args: string[] }
  /** Ordered steps: the exit state of a tile. */
  | { type: 'state'; step: string; tile: string; state: unknown }
  /** A setup job's result (runJobs). */
  | { type: 'jobDone'; req: number; value: unknown };

/** Main-thread answers to the workers' questions. */
export interface PoolServices {
  state(step: string, tile: string): Promise<unknown>;
  putState(step: string, tile: string, state: unknown): void;
}

const asked = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let nextReq = 0;

function ask(kind: AskKind, args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = nextReq++;
    asked.set(req, { resolve, reject });
    parentPort!.postMessage({ type: 'ask', req, kind, args } satisfies FromWorker);
  });
}

/** Worker side: the entry state of `tile` at ordered step `step`. */
export const askState = (step: string, tile: string): Promise<unknown> => ask('state', [step, tile]);

/** Worker side: reports the exit state of `tile` at ordered step `step`. */
export function tellState(step: string, tile: string, state: unknown): void {
  parentPort!.postMessage({ type: 'state', step, tile, state } satisfies FromWorker);
}

/** Inputs of a worker thread, or null on the main thread. */
export function workerInput(): WorkerInput | null {
  const d = workerData as Partial<WorkerInput> | null;
  return !isMainThread && d?.evrenCompileWorker ? (d as WorkerInput) : null;
}

/**
 * Memory one thread needs for an area of `tiles` grid tiles: the flight world's geo build and the code (~0.4 GB) plus
 * the area rasters and plans (~40 B per m²: the street field alone keeps 24 B per 1 m texel). Measured: Eminönü
 * (64 tiles) ~0.45 GB per thread.
 */
export function workerMemory(tiles: number): number {
  return 400e6 + tiles * 4e5;
}

/**
 * Memory the pool may use: on macOS free + inactive + speculative + purgeable pages (vm_stat; freemem() counts only
 * free pages, far too pessimistic with the file cache full), elsewhere freemem(); never more than half the RAM when
 * the system reports plenty (other programs run too), never less than 2 GB.
 */
function availableMemory(): number {
  let avail = freemem();
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('vm_stat', { encoding: 'utf8' });
      const page = Number(/page size of (\d+)/.exec(out)?.[1] ?? 16384);
      const pages = (name: string): number => Number(new RegExp(`Pages ${name}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
      avail = (pages('free') + pages('inactive') + pages('speculative') + pages('purgeable')) * page;
    } catch {
      avail = totalmem() * 0.5;
    }
  }
  return Math.max(2e9, Math.min(avail, totalmem() * 0.75));
}

/** Default --jobs: cores - 1, capped by memory (half the RAM, or what is free if more) and by the tiles to build. */
export function autoJobs(tiles: number): number {
  const cores = Math.max(1, availableParallelism() - 1);
  const avail = availableMemory();
  const byMemory = Math.max(1, Math.floor(avail / workerMemory(tiles)));
  return Math.max(1, Math.min(cores, byMemory, Math.ceil(tiles / 2)));
}

/** Worker side: answers tile requests with `run` until told to exit. */
export function serveTiles(run: (id: string) => Promise<TileOut>): Promise<void> {
  const port = parentPort!;
  const send = (m: FromWorker): void => port.postMessage(m);
  return new Promise((done) => {
    port.on('message', (m: ToWorker) => {
      if (m.type === 'answer') {
        const a = asked.get(m.req);
        asked.delete(m.req);
        if (m.error) {
          a?.reject(new Error(m.error));
        } else {
          a?.resolve(m.value);
        }
        return;
      }
      if (m.type !== 'tile' && m.type !== 'exit') {
        // Shared setup parts and setup jobs (parallel/share.ts has its own listener).
        return;
      }
      if (m.type === 'exit') {
        send({ type: 'perf', perf: perfSnapshot() });
        port.close();
        done();
        return;
      }
      run(m.id).then(
        (out) => send({ type: 'tile', out }),
        (e: Error) => send({ type: 'error', id: m.id, message: e?.message ?? String(e), stack: e?.stack }),
      );
    });
    send({ type: 'ready' });
  });
}

interface Slot {
  worker: Worker;
  ready: boolean;
  busy: string | null;
}

/** Main side: a pool of `size` workers running `script` (cli.ts) with the run's arguments. */
export class TilePool {
  private readonly slots: Slot[] = [];
  /** Tiles in the order queued (tile order: ordered steps wait for earlier tiles, never later ones). */
  private readonly queue: string[] = [];
  private readonly waiting = new Map<string, { resolve: (o: TileOut) => void; reject: (e: Error) => void }>();
  private readonly perf: Record<string, number>[] = [];
  private readonly bakeDirs: string[] = [];
  private failed: Error | null = null;
  private exited = 0;
  private closing: (() => void) | null = null;
  /** Set before the first tile runs. */
  services: PoolServices | null = null;

  constructor(
    readonly size: number,
    script: URL,
    input: (k: number) => WorkerInput,
  ) {
    for (let k = 0; k < size; k++) {
      const data = input(k);
      this.bakeDirs.push(data.bakeDir);
      // stdout goes to stderr: the summary JSON owns the main thread's stdout.
      const worker = new Worker(script, { workerData: data, stdout: true });
      worker.stdout.pipe(process.stderr);
      const slot: Slot = { worker, ready: false, busy: null };
      this.slots.push(slot);
      worker.on('message', (m: FromWorker) => this.onMessage(slot, m));
      worker.on('error', (e) => this.fail(e));
      worker.on('exit', (code) => {
        this.exited++;
        if (code !== 0 && !this.closing) {
          this.fail(new Error(`tile worker exited with code ${code}`));
        }
        if (this.exited === this.slots.length) {
          this.closing?.();
        }
      });
    }
  }

  private readonly jobsWaiting = new Map<number, (v: unknown) => void>();
  private nextJob = 0;

  /**
   * Setup jobs (parallel/share.ts SetupJobs), spread over the workers before they get the shared setup; resolves
   * with the results in order.
   */
  runJobs(job: string, payloads: unknown[]): Promise<unknown[]> {
    return Promise.all(
      payloads.map(
        (payload, k) =>
          new Promise((resolve) => {
            const req = this.nextJob++;
            this.jobsWaiting.set(req, resolve);
            this.slots[k % this.slots.length].worker.postMessage({ type: 'job', req, job, payload });
          }),
      ),
    );
  }

  /** Sends the shared setup (parallel/share.ts) to every worker; call once, before any tile. */
  share(tag: string, value: unknown): void {
    for (const s of this.slots) {
      s.worker.postMessage({ type: 'share', tag, value });
    }
  }

  /** Compiles one tile on the next free worker. */
  run(id: string): Promise<TileOut> {
    if (this.failed) {
      return Promise.reject(this.failed);
    }
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.queue.push(id);
      this.pump();
    });
  }

  /** Stops the workers and removes their bake folders; returns their stage timers. */
  async close(): Promise<Record<string, number>[]> {
    try {
      return await this.stop();
    } finally {
      for (const d of this.bakeDirs) {
        rmSync(d, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  }

  private async stop(): Promise<Record<string, number>[]> {
    await new Promise<void>((done) => {
      this.closing = done;
      if (this.exited === this.slots.length) {
        done();
        return;
      }
      for (const s of this.slots) {
        s.worker.postMessage({ type: 'exit' } satisfies ToWorker);
      }
    });
    return this.perf;
  }

  private pump(): void {
    for (const s of this.slots) {
      if (!this.queue.length) {
        return;
      }
      if (s.ready && !s.busy) {
        s.busy = this.queue.shift()!;
        s.worker.postMessage({ type: 'tile', id: s.busy } satisfies ToWorker);
      }
    }
  }

  private onMessage(slot: Slot, m: FromWorker): void {
    if (m.type === 'jobDone') {
      this.jobsWaiting.get(m.req)?.(m.value);
      this.jobsWaiting.delete(m.req);
      return;
    }
    if (m.type === 'ready') {
      slot.ready = true;
    } else if (m.type === 'tile') {
      slot.busy = null;
      const w = this.waiting.get(m.out.id);
      this.waiting.delete(m.out.id);
      w?.resolve(m.out);
    } else if (m.type === 'ask') {
      const sv = this.services!;
      sv.state(m.args[0], m.args[1]).then(
        (value) => slot.worker.postMessage({ type: 'answer', req: m.req, value } satisfies ToWorker),
        (e: Error) => slot.worker.postMessage({ type: 'answer', req: m.req, value: null, error: e?.message ?? String(e) } satisfies ToWorker),
      );
      return;
    } else if (m.type === 'state') {
      this.services!.putState(m.step, m.tile, m.state);
      return;
    } else if (m.type === 'perf') {
      this.perf.push(m.perf);
      void slot.worker.terminate();
    } else {
      const e = new Error(`tile ${m.id}: ${m.message}`);
      e.stack = m.stack;
      this.fail(e);
      return;
    }
    this.pump();
  }

  private fail(e: Error): void {
    if (this.failed) {
      return;
    }
    this.failed = e;
    for (const w of this.waiting.values()) {
      w.reject(e);
    }
    this.waiting.clear();
    for (const s of this.slots) {
      void s.worker.terminate();
    }
  }
}
