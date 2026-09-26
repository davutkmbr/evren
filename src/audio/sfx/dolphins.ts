import type { SpriteSample } from '../samples';
import { Voice, pickSlot, type Placement, type SfxEnv } from './voice';

/**
 * Recorded dolphin sounds (world/life/dolphins): one slot of a sprite from the audio manifest ('dolphin/calls',
 * 'dolphin/breaths', 'dolphin/splashes'), at a slightly random rate, cut to `maxLength` with a short fade. The owner
 * wants real recordings only, so there is no synthesized fallback: silent (returns 0) while no recording is loaded.
 */
export function playDolphinSample(env: SfxEnv, sprite: SpriteSample | null | undefined, when: number, place: Placement, level: number, maxLength: number, rateJitter = 0.06): number {
  if (!sprite || sprite.slots.length === 0) {
    return 0;
  }
  const v = new Voice(env, place, when, level);
  const slot = pickSlot(sprite, env.rng);
  const rate = 1 - rateJitter + 2 * rateJitter * env.rng();
  const length = Math.min(sprite.slots[slot][1] / rate, maxLength);
  const fade = v.gain(1);
  const fadeTime = Math.min(0.25, length * 0.3);
  fade.gain.setValueAtTime(1, v.t + length - fadeTime);
  fade.gain.linearRampToValueAtTime(0, v.t + length);
  v.slot(sprite, slot, 0, rate).connect(fade).connect(v.input);
  v.end(length + 0.05);
  return length;
}
