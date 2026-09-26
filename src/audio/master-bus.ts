import { softClipCurve } from './dsp/curves';
import { createImpulseResponse } from './dsp/impulse';

/**
 * Master mix:
 *   sfx / wind / ambience / reverb-return -> air -> underwater muffle (LP, open above water) -> mix
 *   underwater (sounds in the water with the listener: bubbles, the water bed) --------------> mix
 *   mix -> subsonic HP (24 Hz, 4th order) -> pause duck (gain + LP) -> pre
 *   ui ----------------------------------------------------------------------------------------------------> pre
 *   music (src/audio/music: own volume and duck) -> music muffle (the same under-water LP) ----------------> pre
 *   pre (input trim) -> glue compressor (2:1 from -22 dBFS) + makeup -> limiter (safety net, -2 dBFS) -> soft clipper
 *   -> master volume -> destination
 *   reverbSend -> high-pass -> convolver (procedural open-air IR) -> reverb return
 *
 * Gain staging: sources are levelled so the loudest in-game moment (POV dive + roar + fire) peaks around -6 dBFS
 * at `pre`; the glue then works a few dB on loud moments and the limiter only catches rare overs (< 2 dB).
 */
export interface MasterBus {
  readonly sfx: GainNode;
  readonly wind: GainNode;
  readonly ambience: GainNode;
  /** UI sounds: dry, never ducked by pause. */
  readonly ui: GainNode;
  /**
   * Adaptive music (src/audio/music): muffled under water like the air sounds, but not ducked by pause (the music
   * keeps playing, a little quieter, in menus; the music player ducks itself).
   */
  readonly music: GainNode;
  /** Sounds in the water with an under-water listener (bubbles, the water bed): not muffled. */
  readonly underwater: GainNode;
  /** Reverb input shared by every voice's send. */
  readonly reverbSend: GainNode;
  /** The signal entering the dynamics stage (measurement tap for the offline analysis). */
  readonly preDynamics: AudioNode;
  readonly output: AudioNode;
  setVolume(volume: number, now: number): void;
  /** 0 = normal, 1 = fully ducked (paused): quieter and muffled. */
  setDuck(amount: number, now: number): void;
  /** 0 = listener above water, 1 = under water: everything from the air is low-passed and a little quieter. */
  setUnderwater(amount: number, now: number): void;
  /** Reverb return level (open sky at altitude has almost nothing to reflect from). */
  setReverbLevel(level: number, now: number): void;
  /** Disconnecting the convolver input lets it go idle (saves audio-thread CPU on low-end devices). */
  setReverbEnabled(enabled: boolean): void;
  /** Current gain reduction in dB (<= 0) of the glue compressor and the limiter. */
  readReduction(out: GainReduction): void;
  dispose(): void;
}

export interface GainReduction {
  glue: number;
  limiter: number;
}

const DUCK_GAIN = 0.28;
const REVERB_RETURN = 0.55;
const DUCK_CUTOFF = 900;
/** Under water: cutoff (Hz) and level of the sounds from the air (the listener's ears in the water). */
const UNDERWATER_CUTOFF = 380;
const UNDERWATER_AIR_GAIN = 0.55;
/** 4th-order Butterworth high-pass as two biquads (Q of the pole pairs). */
const SUBSONIC_HZ = 24;
const BUTTERWORTH4_Q = [0.5412, 1.3066] as const;

/**
 * Absolute level entering the dynamics: the sources are balanced against each other (audio-engine MIX) and this
 * trim places the loudest in-game moment (POV dive + roar + fire, or a dive into the water) around -6 dBFS.
 */
const INPUT_TRIM_DB = -10.5;
/** Level restored after the glue: quiet material ends up +MAKEUP_DB louder, loud moments are compressed 2:1. */
const MAKEUP_DB = 8.5;
/**
 * DynamicsCompressorNode applies automatic makeup gain ((1 / full-range gain) ^ 0.6, per the Web Audio spec).
 * Measured small-signal gains of the two stages below (Chrome, OfflineAudioContext); replaced by MAKEUP_DB and
 * trimmed out of the limiter so its threshold is the real output ceiling.
 */
const GLUE_AUTO_MAKEUP_DB = 5.081;
const LIMITER_AUTO_MAKEUP_DB = 1.14;
const dbToGain = (db: number): number => Math.pow(10, db / 20);

export function createMasterBus(ctx: BaseAudioContext, destination: AudioNode = ctx.destination, impulse?: AudioBuffer): MasterBus {
  const gain = (v: number): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const sfx = gain(1);
  const wind = gain(1);
  const ambience = gain(1);
  const ui = gain(1);
  const music = gain(1);
  const underwater = gain(1);
  const air = gain(1);
  const mix = gain(1);
  const reverbSend = gain(1);
  const reverbReturn = gain(REVERB_RETURN);

  const reverbHp = ctx.createBiquadFilter();
  reverbHp.type = 'highpass';
  reverbHp.frequency.value = 160;
  reverbHp.Q.value = 0.6;
  const convolver = ctx.createConvolver();
  convolver.normalize = false;
  convolver.buffer = impulse ?? createImpulseResponse(ctx);
  reverbSend.connect(reverbHp).connect(convolver).connect(reverbReturn).connect(air);
  let reverbEnabled = true;

  sfx.connect(air);
  wind.connect(air);
  ambience.connect(air);
  const nyquistHz = ctx.sampleRate / 2;
  const waterFilter = ctx.createBiquadFilter();
  waterFilter.type = 'lowpass';
  waterFilter.Q.value = 0.6;
  waterFilter.frequency.value = nyquistHz;
  air.connect(waterFilter).connect(mix);
  underwater.connect(mix);

  const subsonic = BUTTERWORTH4_Q.map((q) => {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = SUBSONIC_HZ;
    f.Q.value = q;
    return f;
  });

  const duck = gain(1);
  const duckFilter = ctx.createBiquadFilter();
  duckFilter.type = 'lowpass';
  duckFilter.Q.value = 0.5;
  const nyquist = ctx.sampleRate / 2;
  duckFilter.frequency.value = nyquist;
  const pre = gain(dbToGain(INPUT_TRIM_DB));

  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -22;
  glue.knee.value = 10;
  glue.ratio.value = 2;
  glue.attack.value = 0.015;
  glue.release.value = 0.25;

  const glueTrim = gain(dbToGain(MAKEUP_DB - GLUE_AUTO_MAKEUP_DB));

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  const limiterTrim = gain(dbToGain(-LIMITER_AUTO_MAKEUP_DB));

  const clipper = ctx.createWaveShaper();
  clipper.curve = softClipCurve(4096, 0.8, 0.98);
  clipper.oversample = '2x';

  const volume = gain(1);

  mix.connect(subsonic[0]).connect(subsonic[1]).connect(duck).connect(duckFilter).connect(pre);
  ui.connect(pre);
  const musicFilter = ctx.createBiquadFilter();
  musicFilter.type = 'lowpass';
  musicFilter.Q.value = 0.6;
  musicFilter.frequency.value = nyquistHz;
  music.connect(musicFilter).connect(pre);
  pre.connect(glue).connect(glueTrim).connect(limiter).connect(limiterTrim).connect(clipper).connect(volume).connect(destination);

  const all: AudioNode[] = [sfx, wind, ambience, ui, music, musicFilter, underwater, air, waterFilter, mix, reverbSend, reverbReturn, reverbHp, convolver, ...subsonic, duck, duckFilter, pre, glue, glueTrim, limiter, limiterTrim, clipper, volume];

  return {
    sfx,
    wind,
    ambience,
    ui,
    music,
    underwater,
    reverbSend,
    preDynamics: pre,
    output: volume,
    setVolume(v: number, now: number): void {
      const g = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
      // Perceptual taper: slider position -> amplitude.
      volume.gain.setTargetAtTime(g * g, now, 0.03);
    },
    setDuck(amount: number, now: number): void {
      const a = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
      duck.gain.setTargetAtTime(1 + (DUCK_GAIN - 1) * a, now, 0.12);
      duckFilter.frequency.setTargetAtTime(a > 0.01 ? DUCK_CUTOFF + (nyquist - DUCK_CUTOFF) * Math.pow(1 - a, 3) : nyquist, now, 0.12);
    },
    setUnderwater(amount: number, now: number): void {
      const a = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
      // Exponential sweep: the cutoff falls fast at first, like ears going under.
      const cutoff = a > 0.001 ? nyquistHz * Math.pow(UNDERWATER_CUTOFF / nyquistHz, Math.pow(a, 0.5)) : nyquistHz;
      waterFilter.frequency.setTargetAtTime(cutoff, now, 0.05);
      musicFilter.frequency.setTargetAtTime(cutoff, now, 0.05);
      air.gain.setTargetAtTime(1 + (UNDERWATER_AIR_GAIN - 1) * a, now, 0.08);
    },
    setReverbEnabled(enabled: boolean): void {
      if (enabled === reverbEnabled) {
        return;
      }
      reverbEnabled = enabled;
      if (enabled) {
        reverbSend.connect(reverbHp);
      } else {
        reverbSend.disconnect(reverbHp);
      }
    },
    setReverbLevel(level: number, now: number): void {
      if (Number.isFinite(level)) {
        reverbReturn.gain.setTargetAtTime(REVERB_RETURN * Math.max(0, level), now, 0.5);
      }
    },
    readReduction(out: GainReduction): void {
      out.glue = glue.reduction;
      out.limiter = limiter.reduction;
    },
    dispose(): void {
      for (const n of all) {
        n.disconnect();
      }
    },
  };
}
