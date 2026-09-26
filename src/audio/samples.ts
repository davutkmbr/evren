import { NOISE_RMS } from './dsp/noise';

/**
 * Recorded CC0 sounds (public/audio/, built by scripts/audio/prep-sounds.mjs from tools/assets/approved.json).
 * Each group is fetched and decoded only when it is needed: the flight sounds (1.6 MB) before the engine starts, rain
 * (1.3 MB) when it starts raining, thunder (1.4 MB) with the first storm, gulls (1.5 MB) near the water. Voices wait while a group is still loading
 * and synthesize when it failed.
 */
export type SampleGroup = 'flight' | 'rain' | 'storm' | 'coast';

export interface LoopSample {
  readonly buffer: AudioBuffer;
  /** Seamless cycle (s); the buffer carries wrapped margins around it. */
  readonly loopStart: number;
  readonly loopEnd: number;
}

export interface SpriteSample {
  readonly buffer: AudioBuffer;
  /** One-shots as [start, duration] (s). */
  readonly slots: ReadonlyArray<readonly [number, number]>;
}

interface SampleSlots {
  windRush: LoopSample | null;
  windEars: LoopSample | null;
  flaps: SpriteSample | null;
  whoomps: SpriteSample | null;
  rainHeavy: LoopSample | null;
  rainLight: LoopSample | null;
  thunderNear: SpriteSample | null;
  thunderFar: SpriteSample | null;
  gullCalls: SpriteSample | null;
  gullBed: LoopSample | null;
}

export interface SampleBank extends Readonly<SampleSlots> {
  /** Starts decoding a group (idempotent). */
  request(group: SampleGroup): void;
  /** True while a requested group is still loading. */
  pending(group: SampleGroup): boolean;
  /** Resolves once a group has loaded or failed (requests it). */
  ready(group: SampleGroup): Promise<void>;
}

const GROUPS: Record<SampleGroup, ReadonlyArray<readonly [keyof SampleSlots, string]>> = {
  flight: [
    ['windRush', 'wind/rush'],
    ['windEars', 'wind/ears'],
    ['flaps', 'flap/flaps'],
    ['whoomps', 'flap/whoomps'],
  ],
  rain: [
    ['rainHeavy', 'rain/heavy'],
    ['rainLight', 'rain/light'],
  ],
  storm: [
    ['thunderNear', 'thunder/near'],
    ['thunderFar', 'thunder/far'],
  ],
  coast: [
    ['gullCalls', 'gull/calls'],
    ['gullBed', 'gull/bed'],
  ],
};

interface ManifestEntry {
  file: string;
  channels: number;
  loop?: [number, number];
  rms?: number;
  slots?: Array<[number, number]>;
}

interface Manifest {
  sounds: Record<string, ManifestEntry>;
}

/** Fetches the manifest and the encoded files once; banks decode them per context. Safe before the user gesture. */
export class SampleLibrary {
  private manifest: Promise<Manifest | null> | null = null;
  private readonly files = new Map<string, Promise<ArrayBuffer | null>>();

  constructor(private readonly base = `${import.meta.env?.BASE_URL ?? '/'}audio/`) {}

  private getManifest(): Promise<Manifest | null> {
    this.manifest ??= fetch(`${this.base}sounds.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
      .catch(() => null);
    return this.manifest;
  }

  private getFile(file: string): Promise<ArrayBuffer | null> {
    let p = this.files.get(file);
    if (!p) {
      p = fetch(`${this.base}${file}`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
      this.files.set(file, p);
    }
    return p;
  }

  /** A bank whose groups decode with `decoder` (any BaseAudioContext; buffers play in every context). */
  createBank(decoder: BaseAudioContext): SampleBank {
    const slots: SampleSlots = {
      windRush: null,
      windEars: null,
      flaps: null,
      whoomps: null,
      rainHeavy: null,
      rainLight: null,
      thunderNear: null,
      thunderFar: null,
      gullCalls: null,
      gullBed: null,
    };
    const loads = new Map<SampleGroup, Promise<void>>();
    const loading = new Set<SampleGroup>();
    const decodeEntry = async (entry: ManifestEntry | undefined): Promise<LoopSample | SpriteSample | null> => {
      if (!entry) {
        return null;
      }
      const bytes = await this.getFile(entry.file);
      if (!bytes) {
        return null;
      }
      // decodeAudioData detaches its input: keep the fetched bytes for other banks.
      const buffer = await decoder.decodeAudioData(bytes.slice(0));
      if (entry.loop) {
        // Loops replace noise-bank sources, so they get the same RMS (layer gains keep their calibration).
        const k = NOISE_RMS / Math.max(entry.rms ?? NOISE_RMS, 1e-4);
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const d = buffer.getChannelData(c);
          for (let i = 0; i < d.length; i++) {
            d[i] *= k;
          }
        }
        return { buffer, loopStart: entry.loop[0], loopEnd: entry.loop[1] };
      }
      return { buffer, slots: entry.slots ?? [[0, buffer.duration]] };
    };
    const load = (group: SampleGroup): Promise<void> => {
      let p = loads.get(group);
      if (!p) {
        loading.add(group);
        p = this.getManifest()
          .then(async (m) => {
            const decoded = await Promise.all(GROUPS[group].map(([, name]) => decodeEntry(m?.sounds[name])));
            // A group is used whole or not at all (one missing file keeps the whole group synthesized).
            if (decoded.every((d) => d)) {
              GROUPS[group].forEach(([key], i) => {
                (slots as unknown as Record<string, LoopSample | SpriteSample | null>)[key] = decoded[i];
              });
            }
          })
          .catch((err: unknown) => console.warn(`[audio] recorded ${group} sounds unavailable, synthesizing`, err))
          .finally(() => loading.delete(group));
        loads.set(group, p);
      }
      return p;
    };
    const bank = slots as SampleSlots & SampleBank;
    bank.request = (group) => void load(group);
    bank.pending = (group) => loading.has(group);
    bank.ready = (group) => load(group);
    return bank;
  }
}
