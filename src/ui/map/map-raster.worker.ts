/// <reference lib="webworker" />
import { paintMapRaster, type RasterInput } from './map-painter';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<RasterInput>) => {
  try {
    const input = event.data;
    const canvas = new OffscreenCanvas(input.size, input.size);
    // CPU-backed canvas: a GPU-backed bitmap would be lost when the worker terminates.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('OffscreenCanvas 2D unavailable');
    }
    paintMapRaster(ctx, input);
    const bitmap = canvas.transferToImageBitmap();
    scope.postMessage({ ok: true, bitmap }, [bitmap]);
  } catch (err) {
    scope.postMessage({ ok: false, error: String(err) });
  }
};
