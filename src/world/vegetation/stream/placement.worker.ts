/// <reference lib="webworker" />
import { PlacementContext } from './placement';
import type { PlacementRequest } from './protocol';

let context: PlacementContext | null = null;

self.onmessage = (e: MessageEvent<PlacementRequest>): void => {
  const msg = e.data;
  if (msg.type === 'init') {
    context = new PlacementContext(msg);
    return;
  }
  if (!context) {
    return;
  }
  const result = context.placeTile(msg);
  (self as unknown as Worker).postMessage(result, [result.instances.buffer as ArrayBuffer]);
};
