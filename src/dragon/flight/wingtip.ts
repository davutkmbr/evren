import { clamp } from '../../core/math/noise';
import { DEG, WINGTIP } from './params';

/**
 * Height of the wingtip above the center of mass at the bottom of the downstroke, in a frame that is pitched
 * with the body but not banked (forward-swept tips rise when the nose is up). Fitted to the dragon rig.
 */
export function strokeBottomTipHeight(amplitude: number, sweep: number, span: number, pitch: number): number {
  const flare = clamp(-sweep, 0, 1);
  const scale = span / WINGTIP.referenceSpan;
  const y = WINGTIP.base + WINGTIP.flareRaise * flare - (WINGTIP.drop - WINGTIP.flareRelief * flare) * amplitude;
  const forward = WINGTIP.fwd + WINGTIP.fwdFlare * flare + (WINGTIP.fwdStroke + WINGTIP.fwdStrokeFlare * flare) * amplitude;
  return scale * (y * Math.cos(pitch) + forward * Math.sin(pitch));
}

/** Lateral distance of the wingtip from the body axis. */
export function tipLateral(span: number): number {
  return WINGTIP.lateral * span;
}

/** Clearance of the lower wingtip above a flat surface `agl` metres below the center of mass. */
export function wingtipClearance(agl: number, amplitude: number, sweep: number, span: number, pitch: number, bank: number): number {
  const y = strokeBottomTipHeight(amplitude, sweep, span, pitch);
  return agl + y * Math.cos(bank) - tipLateral(span) * Math.abs(Math.sin(bank));
}

/**
 * Largest bank (rad) that keeps the lower wingtip `margin` above the surface with a stroke of `amplitude`:
 * agl + y cos φ − x sin φ = agl + R cos(φ + δ) ≥ margin.
 */
export function maxBankForClearance(agl: number, amplitude: number, sweep: number, span: number, pitch: number, margin: number): number {
  const y = strokeBottomTipHeight(amplitude, sweep, span, pitch);
  const x = tipLateral(span);
  const r = Math.hypot(x, y);
  const c = (margin - agl) / Math.max(r, 1e-3);
  if (c <= -1) {
    return Math.PI / 2;
  }
  if (c >= 1) {
    return 3 * DEG;
  }
  return clamp(Math.acos(c) - Math.atan2(x, y), 3 * DEG, Math.PI / 2);
}

/** Largest stroke amplitude (0..1) whose downstroke keeps the lower wingtip `margin` above the surface at this bank. */
export function maxAmplitudeForClearance(agl: number, sweep: number, span: number, pitch: number, bank: number, margin: number): number {
  const cb = Math.cos(bank);
  if (cb < 0.2) {
    return 1;
  }
  const need = (margin - agl + tipLateral(span) * Math.abs(Math.sin(bank))) / cb;
  const high = strokeBottomTipHeight(0, sweep, span, pitch);
  const low = strokeBottomTipHeight(1, sweep, span, pitch);
  if (low >= need) {
    return 1;
  }
  if (high <= need) {
    return 0;
  }
  return (high - need) / (high - low);
}
