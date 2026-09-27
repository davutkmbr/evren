/**
 * One-shot module worker plumbing for OSM layers. The main side creates the worker itself (Vite needs the literal
 * `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` in the layer's own file) and hands it
 * to runWorker(); the worker file calls serveWorker(build) once.
 */

/** Every distinct ArrayBuffer behind the typed arrays in `value` (for zero-copy transfer). */
export function collectTransferables(value: unknown, out: Set<ArrayBuffer> = new Set()): ArrayBuffer[] {
  if (value && typeof value === 'object') {
    if (ArrayBuffer.isView(value)) {
      if (value.buffer instanceof ArrayBuffer) {
        out.add(value.buffer);
      }
    } else if (value instanceof ArrayBuffer) {
      out.add(value);
    } else if (Array.isArray(value)) {
      for (const v of value) {
        collectTransferables(v, out);
      }
    } else {
      for (const v of Object.values(value as Record<string, unknown>)) {
        collectTransferables(v, out);
      }
    }
  }
  return [...out];
}

export interface WorkerJob<Res> {
  readonly promise: Promise<Res>;
  /**
   * Terminates the worker; the promise rejects with "cancelled". Register it as `onDispose(job.cancel)`: a closure
   * over `job` would keep `job.promise` and with it the whole result alive.
   */
  cancel(): void;
}

/**
 * Posts `request` to `worker` and resolves with its single reply; the worker is terminated afterwards.
 * `transfer` lists buffers the main thread gives away (never shared data such as OsmContext.base, which is cloned).
 */
export function runWorker<Req, Res>(worker: Worker, request: Req, transfer: Transferable[] = []): WorkerJob<Res> {
  // `cancel` outlives the job (layers keep it until dispose): once settled it must not reach the promise, whose
  // resolved value (every array of the worker result) would otherwise stay alive until the layer is disposed.
  let reject: ((e: Error) => void) | null = null;
  const promise = new Promise<Res>((res, rej) => {
    reject = rej;
    const settle = (): void => {
      worker.terminate();
      // The worker object stays reachable from `cancel`; its handlers hold `res` / `rej` and through them the promise.
      worker.onmessage = null;
      worker.onerror = null;
      reject = null;
    };
    worker.onmessage = (e: MessageEvent<{ ok: boolean; res?: Res; error?: string }>) => {
      settle();
      if (e.data.ok) {
        res(e.data.res as Res);
      } else {
        rej(new Error(e.data.error));
      }
    };
    worker.onerror = (e) => {
      settle();
      rej(new Error(e.message || 'worker error'));
    };
    worker.postMessage(request, transfer);
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      reject?.(new Error('cancelled'));
      reject = null;
    },
  };
}

/** Worker side: answers each request with build(request), transferring every typed-array buffer of the result. */
export function serveWorker<Req, Res>(build: (req: Req) => Res | Promise<Res>): void {
  const scope = self as unknown as Worker;
  scope.onmessage = async (e: MessageEvent<Req>) => {
    try {
      const res = await build(e.data);
      scope.postMessage({ ok: true, res }, collectTransferables(res));
    } catch (err) {
      scope.postMessage({ ok: false, error: String((err as Error)?.stack ?? err) });
    }
  };
}
