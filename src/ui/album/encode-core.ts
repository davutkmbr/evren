/**
 * Encodes a captured frame into the stored image and its thumbnail (WebP, JPEG where WebP encoding is missing).
 * Runs inside the encoder worker (encode.worker.ts), or on the main thread as a fallback without workers.
 */

export interface EncodeOptions {
  /** WebP / JPEG quality 0..1. */
  quality: number;
  /** Longest side of the stored image in px (0 = keep). */
  maxSide: number;
  /** Longest side of the thumbnail in px. */
  thumbSide: number;
}

export interface EncodedPhoto {
  image: Blob;
  thumb: Blob;
  width: number;
  height: number;
  mime: string;
}

type Canvas2D = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(canvas: Canvas2D, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality);
  });
}

/** Encodes as WebP; if the browser silently produced something else (PNG), as JPEG instead. */
async function encode(canvas: Canvas2D, quality: number): Promise<Blob> {
  const webp = await toBlob(canvas, 'image/webp', quality);
  if (webp.type === 'image/webp') {
    return webp;
  }
  return toBlob(canvas, 'image/jpeg', quality);
}

function fit(w: number, h: number, maxSide: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (maxSide <= 0 || longest <= maxSide) {
    return { w, h };
  }
  const s = maxSide / longest;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function draw(source: CanvasImageSource, sw: number, sh: number, w: number, h: number): Canvas2D {
  const canvas = makeCanvas(w, h);
  const g = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!g) {
    throw new Error('2d context unavailable');
  }
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, sw, sh, 0, 0, w, h);
  return canvas;
}

export async function encodeFrame(source: ImageBitmap, options: EncodeOptions): Promise<EncodedPhoto> {
  const sw = source.width;
  const sh = source.height;
  const size = fit(sw, sh, options.maxSide);
  const full = draw(source, sw, sh, size.w, size.h);
  const image = await encode(full, options.quality);
  const t = fit(size.w, size.h, options.thumbSide);
  const thumb = await encode(draw(full, size.w, size.h, t.w, t.h), 0.8);
  return { image, thumb, width: size.w, height: size.h, mime: image.type || 'image/webp' };
}
