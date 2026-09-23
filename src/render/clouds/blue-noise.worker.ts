/// <reference lib="webworker" />
import { generateBlueNoise } from './blue-noise-gen';

self.onmessage = (event: MessageEvent<{ size: number; seed: number }>): void => {
  const { size, seed } = event.data;
  const data = generateBlueNoise(size, seed);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ size, data }, [data.buffer]);
};
