/**
 * Album encoder worker: turns a captured frame (ImageBitmap, transferred) into the stored WebP and its thumbnail off
 * the main thread, so taking a photo does not hitch the game.
 */
import { encodeFrame, type EncodeOptions, type EncodedPhoto } from './encode-core';

interface EncodeRequest extends EncodeOptions {
  id: number;
  bitmap: ImageBitmap;
}

type EncodeReply = { id: number; ok: true; result: EncodedPhoto } | { id: number; ok: false; error: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<EncodeRequest>) => void) | null;
  postMessage(message: EncodeReply): void;
};

scope.onmessage = (e) => {
  const { id, bitmap, ...options } = e.data;
  encodeFrame(bitmap, options)
    .then((result) => scope.postMessage({ id, ok: true, result }))
    .catch((err: unknown) => scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }))
    .finally(() => bitmap.close());
};
