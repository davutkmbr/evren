import { SourceGate, loopSource } from '../dsp/gate';
import { clamp01, smoothstep } from '../dsp/math';
import type { NoiseBank } from '../dsp/noise';
import { SmoothParam } from '../dsp/param';
import type { Rng } from '../dsp/rng';

/** Levels of the under-water bed (linear, into the master bus's `underwater` input). */
export const UNDERWATER_BED = {
  /** The deep, slowly breathing water pressure bed. */
  bed: 0.55,
  /** Low resonant rumble (the sea's swell heard through the water). */
  rumble: 0.35,
  /** Water rushing past the ears when moving fast under water. */
  rush: 0.4,
  /** Darker and quieter with depth: dB per metre, down to this floor. */
  depthDb: -0.5,
  depthFloorDb: -6,
} as const;

/**
 * The listener's ears under water: three noise layers, started only while audible (SourceGate).
 *  bed     brown noise low-passed at ~260 Hz, its level breathing with a slow random control signal
 *  rumble  pink noise through a resonant band-pass around 110 Hz (distant swell and ship engines)
 *  rush    pink noise band-passed around 450 Hz, rising with the listener's speed through the water
 */
export class UnderwaterVoice {
  private readonly bedGain: SmoothParam;
  private readonly rumbleGain: SmoothParam;
  private readonly rushGain: SmoothParam;
  private readonly rushFreq: SmoothParam;
  private readonly bedGate: SourceGate;
  private readonly nodes: AudioNode[] = [];

  constructor(ctx: BaseAudioContext, noise: NoiseBank, destination: AudioNode, rng: Rng) {
    const node = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };
    const filter = (type: BiquadFilterType, f: number, q: number): BiquadFilterNode => {
      const b = node(ctx.createBiquadFilter());
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const out = (): GainNode => {
      const g = node(ctx.createGain());
      g.gain.value = 0;
      g.connect(destination);
      return g;
    };

    const bedOut = out();
    const bedLp = filter('lowpass', 260, 0.8);
    const bedHp = filter('highpass', 35, 0.7);
    // Breathing: a slow random control signal adds +-40 % to the bed level.
    const breath = node(ctx.createGain());
    breath.gain.value = 1;
    bedHp.connect(bedLp).connect(breath).connect(bedOut);
    this.bedGain = new SmoothParam(bedOut.gain, 0, 0.25);

    const rumbleOut = out();
    const rumbleBp = filter('bandpass', 110, 2.2);
    rumbleBp.connect(rumbleOut);
    this.rumbleGain = new SmoothParam(rumbleOut.gain, 0, 0.3);

    const rushOut = out();
    const rushBp = filter('bandpass', 450, 0.9);
    rushBp.connect(rushOut);
    this.rushGain = new SmoothParam(rushOut.gain, 0, 0.2);
    this.rushFreq = new SmoothParam(rushBp.frequency, 450, 0.3);

    this.bedGate = new SourceGate((t, aux) => {
      const bed = loopSource(ctx, noise.brown, t, 0.8, rng);
      bed.connect(bedHp);
      const mod = loopSource(ctx, noise.gust, t, 0.35, rng);
      const depth = ctx.createGain();
      depth.gain.value = 0.4;
      mod.connect(depth).connect(breath.gain);
      aux.push(depth);
      const rumble = loopSource(ctx, noise.pink, t, 0.7, rng);
      rumble.connect(rumbleBp);
      const rush = loopSource(ctx, noise.pink, t, 1.1, rng);
      rush.connect(rushBp);
      return [bed, mod, rumble, rush];
    }, 1.5);
  }

  /** `amount` 0..1 under water, `depth` m below the surface, `speed` m/s of the listener through the water. */
  update(amount: number, depth: number, speed: number, now: number): void {
    const a = clamp01(amount);
    const depthDb = Math.max(UNDERWATER_BED.depthFloorDb, UNDERWATER_BED.depthDb * Math.max(0, depth));
    const k = a * Math.pow(10, depthDb / 20);
    const fast = smoothstep(2, 16, speed);
    this.bedGain.set(UNDERWATER_BED.bed * k, now);
    this.rumbleGain.set(UNDERWATER_BED.rumble * k, now);
    this.rushGain.set(UNDERWATER_BED.rush * k * fast, now);
    this.rushFreq.set(380 + 380 * fast, now);
    this.bedGate.update(a > 1e-3, now);
  }

  dispose(now: number): void {
    this.bedGate.dispose(now);
    for (const n of this.nodes) {
      n.disconnect();
    }
  }
}
