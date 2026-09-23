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
  /** Terminates the worker; the promise rejects with "cancelled". */
  cancel(): void;
}

/**
 * Posts `request` to `worker` and resolves with its single reply; the worker is terminated afterwards.
 * `transfer` lists buffers the main thread gives away (never shared data such as OsmContext.base, which is cloned).
 */
export function runWorker<Req, Res>(worker: Worker, request: Req, transfer: Transferable[] = []): WorkerJob<Res> {
  let reject: (e: Error) => void = () => undefined;
  const promise = new Promise<Res>((res, rej) => {
    reject = rej;
    worker.onmessage = (e: MessageEvent<{ ok: boolean; res?: Res; error?: string }>) => {
      worker.terminate();
      if (e.data.ok) {
        res(e.data.res as Res);
      } else {
        rej(new Error(e.data.error));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      rej(new Error(e.message || 'worker error'));
    };
    worker.postMessage(request, transfer);
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      reject(new Error('cancelled'));
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
