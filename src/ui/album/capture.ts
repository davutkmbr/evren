/**
 * Frame capture for the album. The engine renders without preserveDrawingBuffer, so the canvas is copied in a
 * microtask queued during the UI update: it runs right after this frame's render, inside the same animation-frame
 * task, before the browser presents (and clears) the drawing buffer. The copy is a GPU-side drawImage into an
 * OffscreenCanvas turned into an ImageBitmap; encoding happens in a worker. No network is involved at any step.
 */
import { encodeFrame, type EncodeOptions, type EncodedPhoto } from './encode-core';

/** Copies the canvas as it is now into an ImageBitmap (synchronous copy). Null when the browser cannot. */
export function grabCanvas(canvas: HTMLCanvasElement): ImageBitmap | null {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 2 || h < 2 || typeof OffscreenCanvas === 'undefined') {
    return null;
  }
  try {
    const off = new OffscreenCanvas(w, h);
    const g = off.getContext('2d');
    if (!g) {
      return null;
    }
    g.drawImage(canvas, 0, 0);
    return off.transferToImageBitmap();
  } catch {
    return null;
  }
}

/** Runs `grab` after the frame that is being built now has been rendered (see the module comment). */
export function afterThisFrame<T>(grab: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    queueMicrotask(() => {
      try {
        resolve(grab());
      } catch (e) {
        reject(e);
      }
    });
  });
}

type Reply = { id: number; ok: true; result: EncodedPhoto } | { id: number; ok: false; error: string };

/** Encodes captured frames in a worker; falls back to the main thread when workers or OffscreenCanvas are missing. */
export class PhotoEncoder {
  private worker: Worker | null = null;
  private workerFailed = false;
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (r: EncodedPhoto) => void; reject: (e: Error) => void }>();

  encode(bitmap: ImageBitmap, options: EncodeOptions): Promise<EncodedPhoto> {
    const worker = this.ensureWorker();
    if (!worker) {
      return encodeFrame(bitmap, options).finally(() => bitmap.close());
    }
    const id = ++this.seq;
    return new Promise<EncodedPhoto>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, bitmap, ...options }, [bitmap]);
      } catch (e) {
        this.pending.delete(id);
        encodeFrame(bitmap, options).then(resolve, reject).finally(() => bitmap.close());
      }
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) {
      p.reject(new Error('encoder disposed'));
    }
    this.pending.clear();
  }

  private ensureWorker(): Worker | null {
    if (this.worker || this.workerFailed) {
      return this.worker;
    }
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      this.workerFailed = true;
      return null;
    }
    try {
      const worker = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module', name: 'album-encoder' });
      worker.onmessage = (e: MessageEvent<Reply>) => {
        const p = this.pending.get(e.data.id);
        if (!p) {
          return;
        }
        this.pending.delete(e.data.id);
        if (e.data.ok) {
          p.resolve(e.data.result);
        } else {
          p.reject(new Error(e.data.error));
        }
      };
      worker.onerror = () => {
        this.workerFailed = true;
        this.worker = null;
        for (const p of this.pending.values()) {
          p.reject(new Error('encoder worker failed'));
        }
        this.pending.clear();
      };
      this.worker = worker;
    } catch {
      this.workerFailed = true;
    }
    return this.worker;
  }
}
