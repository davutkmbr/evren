/**
 * Fetches compiled street files and inflates gzipped ones (web profile, `.gz`) off the main thread: a landing's tiles
 * inflate to tens of megabytes, which would stall frames if DecompressionStream ran on the main thread.
 * Message in: `{ id, url }`; out: `{ id, bytes, wire }` (bytes transferred, wire = size fetched) or `{ id, error }`.
 */
import { inflate } from './format';

self.onmessage = async (e: MessageEvent<{ id: number; url: string }>) => {
  const { id, url } = e.data;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${url}`);
    }
    const wire = await res.arrayBuffer();
    const size = wire.byteLength;
    const bytes = await inflate(wire);
    (self as unknown as Worker).postMessage({ id, bytes, wire: size }, [bytes]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
