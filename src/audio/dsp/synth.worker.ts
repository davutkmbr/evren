/// <reference lib="webworker" />
import { generateImpulseData, type ImpulseData } from './impulse';
import { generateNoiseData, type NoiseData } from './noise';

export interface SynthRequest {
  sampleRate: number;
  seed: number;
}

export interface SynthResult {
  noise: NoiseData;
  impulse: ImpulseData;
}

/** Generates the shared noise bank and reverb impulse response off the main thread (~60 ms of DSP). */
self.onmessage = (e: MessageEvent<SynthRequest>) => {
  const { sampleRate, seed } = e.data;
  const noise = generateNoiseData(sampleRate, seed);
  const impulse = generateImpulseData(sampleRate);
  const result: SynthResult = { noise, impulse };
  const transfer = [noise.white, noise.pink, noise.brown, noise.crackle, noise.gust, noise.buffet, impulse.left, impulse.right].map((a) => a.buffer);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(result, transfer);
};
