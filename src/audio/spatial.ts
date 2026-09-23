import { clamp, finiteOr, smoothstep } from './dsp/math';
import type { Placement } from './sfx/voice';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Listener (= render camera) pose. Unit vectors. */
export interface ListenerPose {
  position: Vec3;
  forward: Vec3;
  right: Vec3;
}

export const SPEED_OF_SOUND = 343;

/**
 * Air absorption as a single low-pass cutoff: ISO 9613-1 at 20 C / 60 % RH gives roughly 0.1 dB/m at 8 kHz and
 * 0.03 dB/m at 4 kHz, i.e. ~10 kHz at 200 m, ~3.5 kHz at 1 km, ~1.5 kHz at 3 km.
 */
export function airAbsorptionCutoff(distance: number): number {
  return Math.min(20000, 21000 / (1 + distance / 190));
}

export interface PlaceOptions {
  /** Distance (m) at or below which the gain is 1. */
  refDistance: number;
  /** Base reverb send at refDistance. */
  reverb: number;
  /** Physical size of the source (m): controls stereo width when near. */
  size: number;
  /** Direction the source radiates to (e.g. dragon mouth). Omit for omnidirectional. */
  facing?: Vec3;
  /** Low-pass factor when the listener is directly behind a directional source (0..1). */
  backCutoffFactor?: number;
  /** Include propagation delay for distances above this (m). */
  delayAbove?: number;
}

/** Computes a one-shot placement for a source at `pos` heard by `listener` (writes into `out`). */
export function placeSource(listener: ListenerPose, pos: Vec3, opts: PlaceOptions, out: Placement): Placement {
  let dx = pos.x - listener.position.x;
  let dy = pos.y - listener.position.y;
  let dz = pos.z - listener.position.z;
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!Number.isFinite(d)) {
    // Degenerate pose (NaN/Infinity from a camera or flight glitch): place the source at the reference distance, centred.
    dx = 0;
    dy = 0;
    dz = 0;
    d = opts.refDistance;
  }
  const inv = d > 1e-3 ? 1 / d : 0;
  const side = finiteOr((dx * listener.right.x + dy * listener.right.y + dz * listener.right.z) * inv, 0);
  const near = 1 - smoothstep(opts.size * 0.3, opts.size * 1.5, d);
  out.gain = opts.refDistance / Math.max(d, opts.refDistance);
  out.pan = clamp(side * 0.85 * (1 - near * 0.7), -1, 1);
  let cutoff = airAbsorptionCutoff(d);
  if (opts.facing && d > 1e-3) {
    const toListener = clamp(-(dx * opts.facing.x + dy * opts.facing.y + dz * opts.facing.z) * inv, -1, 1);
    const back = opts.backCutoffFactor ?? 0.3;
    cutoff *= back + (1 - back) * Math.pow(Math.max(0, (1 + toListener) * 0.5), 1.5);
  }
  out.cutoff = Math.max(250, cutoff);
  out.reverb = clamp(opts.reverb * Math.pow(1 / Math.max(out.gain, 1e-3), 0.55), 0, 3);
  out.closeness = near;
  out.width = clamp((opts.size * 0.8) / Math.max(d, 1), 0.2, 1);
  out.delay = d > (opts.delayAbove ?? 80) ? Math.min(d / SPEED_OF_SOUND, 2.5) : 0;
  return out;
}

/** Placement for an ambient source at a horizontal bearing (rad, relative to listener right/forward) and distance. */
export function placeAmbient(horizontal: number, heightDiff: number, bearingSin: number, refDistance: number, reverb: number, out: Placement): Placement {
  const d = finiteOr(Math.hypot(horizontal, heightDiff), refDistance);
  out.gain = refDistance / Math.max(d, refDistance);
  out.pan = clamp(bearingSin * 0.85, -1, 1);
  out.cutoff = Math.max(250, airAbsorptionCutoff(d));
  out.reverb = clamp(reverb * Math.pow(1 / Math.max(out.gain, 1e-3), 0.5), 0, 3);
  out.closeness = 0;
  out.width = 0.3;
  out.delay = 0;
  return out;
}
