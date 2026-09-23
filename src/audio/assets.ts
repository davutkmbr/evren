import { generateImpulseData, impulseFromData, type ImpulseData } from './dsp/impulse';
import { generateNoiseData, noiseBankFromData, type NoiseBank, type NoiseData } from './dsp/noise';
import type { SynthRequest, SynthResult } from './dsp/synth.worker';

export interface AudioAssets {
  noise: NoiseBank;
  impulse: AudioBuffer;
}

const PRELOAD_RATE = 48000;
const SEED = 1337;

/**
 * Procedural audio assets (noise bank + reverb IR). Generated in a worker as soon as the system initializes,
 * i.e. before the user gesture that unlocks audio, so unlocking only wraps ready typed arrays into AudioBuffers.
 */
export class AudioAssetLoader {
  private data: SynthResult | null = null;
  private worker: Worker | null = null;
  private waiting: Array<(r: SynthResult | null) => void> = [];
  private busy = false;
  private disposed = false;

  /** Starts background generation at the most likely device rate. */
  preload(sampleRate = PRELOAD_RATE): void {
    if (this.disposed || this.busy || this.data?.noise.sampleRate === sampleRate) {
      return;
    }
    try {
      this.worker ??= new Worker(new URL('./dsp/synth.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.worker = null;
      return;
    }
    this.busy = true;
    this.worker.onmessage = (e: MessageEvent<SynthResult>) => {
      this.busy = false;
      this.data = e.data;
      this.flush(e.data);
    };
    this.worker.onerror = () => {
      this.busy = false;
      this.worker?.terminate();
      this.worker = null;
      this.flush(null);
    };
    const req: SynthRequest = { sampleRate, seed: SEED };
    this.worker.postMessage(req);
  }

  get pending(): number {
    return this.busy ? 1 : 0;
  }

  private flush(r: SynthResult | null): void {
    const w = this.waiting;
    this.waiting = [];
    for (const fn of w) {
      fn(r);
    }
  }

  /** Terminates the worker and drops the generated data; pending and later loads reject. */
  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.data = null;
    this.flush(null);
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new Error('[audio] asset loader disposed');
    }
  }

  /** Resolves assets for `ctx`; falls back to synchronous generation if the worker is unavailable. */
  async load(ctx: BaseAudioContext): Promise<AudioAssets> {
    this.assertAlive();
    if (this.busy) {
      await new Promise<SynthResult | null>((resolve) => this.waiting.push(resolve));
      this.assertAlive();
    }
    let noise: NoiseData;
    let impulseData: ImpulseData;
    if (this.data && this.data.impulse.sampleRate === ctx.sampleRate) {
      noise = this.data.noise;
      impulseData = this.data.impulse;
    } else if (this.worker) {
      this.preload(ctx.sampleRate);
      const r = await new Promise<SynthResult | null>((resolve) => this.waiting.push(resolve));
      this.assertAlive();
      noise = r?.noise ?? generateNoiseData(ctx.sampleRate, SEED);
      impulseData = r?.impulse ?? generateImpulseData(ctx.sampleRate);
    } else {
      noise = generateNoiseData(ctx.sampleRate, SEED);
      impulseData = generateImpulseData(ctx.sampleRate);
    }
    const assets = { noise: noiseBankFromData(ctx, noise), impulse: impulseFromData(ctx, impulseData)! };
    this.data = null;
    this.worker?.terminate();
    this.worker = null;
    return assets;
  }
}
