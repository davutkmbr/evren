/**
 * Harmony terms of the flow system: pure functions of generic motion descriptors (no sim, no move ids), unit-tested on
 * synthetic descriptors in tools/headless/flow-check.ts. Each term is continuous in 0..1:
 *
 *   energy      energy stewardship: the net specific energy loss (muscle work left out) against plain gliding over the
 *               same time (the sim's own drag model); banking lift or cutting drag scores, wasting energy does not.
 *   continuity  no jerk spikes across the handover (load factor and body rates within FLOW.handoverWindow).
 *   alignment   momentum carried into the next motion: its early path along the handover velocity, rotations in the
 *               same sense, speed used at its peak.
 *   rhythm      the next motion starts on a natural break of the active rhythm (wing beat, swim stroke, gait).
 *   world       tight, clean proximity (low over the surface, under a deck, in an updraft, through a tight ring).
 *   novelty     distance of the motion's signature from the recent ones (variety decay).
 *
 * The handover terms are weighted by the chain factor (how close the two motions follow each other).
 */
import { clamp, smoothstep } from '../../../core/math/noise';
import { GRAVITY } from '../params';
import { FLOW } from './params';
import type { HarmonyTerms, MotionDescriptor, MotionSnapshot } from './types';

const TWO_PI = Math.PI * 2;

/** Excess energy loss x (see FLOW.energyMid) and its score. `net` and `ref` are energy changes (J/kg); `ref` ≤ 0. */
export function energyStewardship(net: number, ref: number, duration: number): { score: number; excess: number } {
  const refLoss = Math.max(-ref, FLOW.energyRefFloor * Math.max(duration, 0.1));
  const excess = (-net - refLoss) / refLoss;
  const score = 1 / (1 + Math.exp((excess - FLOW.energyMid) / FLOW.energyWidth));
  return { score, excess };
}

/**
 * Smoothness of a handover from the largest jerks around it. An abrupt reversal is forgiven in part when it is itself
 * energy-efficient (`energyScore` near 1).
 */
export function continuity(jerkLoad: number, jerkRate: number, energyScore: number): number {
  const a = jerkLoad / FLOW.jerkLoad;
  const b = jerkRate / FLOW.jerkRate;
  const smooth = Math.exp(-0.5 * (a * a + b * b));
  return smooth + (1 - smooth) * FLOW.reversalCredit * smoothstep(0.8, 1, energyScore);
}

/** 0..1 agreement of two body-rate vectors: 1 same sense, 0 opposite; FLOW.rateNeutral when either hardly rotates. */
export function rateAgreement(a: readonly number[], b: readonly number[]): number {
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  const weight = smoothstep(FLOW.rateFloor * 0.5, FLOW.rateFloor * 2, Math.min(la, lb));
  const cos = la > 1e-6 && lb > 1e-6 ? (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb) : 0;
  return FLOW.rateNeutral + (0.5 * (1 + cos) - FLOW.rateNeutral) * weight;
}

/**
 * Momentum alignment of motion `next` after the handover state `handover` (the previous motion's exit rates are
 * `prevExitRates`): early path along the handover velocity, rotation continuing, entry speed near the recent peak.
 */
export function alignment(
  handover: MotionSnapshot,
  earlyPath: readonly number[],
  prevExitRates: readonly number[],
  entryRates: readonly number[],
  entrySpeed: number,
  prePeakSpeed: number,
): { score: number; pathAngle: number; speedUse: number } {
  const dot = clamp(handover.pathX * earlyPath[0] + handover.pathY * earlyPath[1] + handover.pathZ * earlyPath[2], -1, 1);
  const pathAngle = Math.acos(dot);
  const carry = Math.exp(-((pathAngle / FLOW.pathAngle) ** 2));
  const rates = rateAgreement(prevExitRates, entryRates);
  const speedUse = prePeakSpeed > 1 ? clamp(entrySpeed / prePeakSpeed, 0, 1) ** FLOW.speedUseExponent : 1;
  return { score: 0.4 * carry + 0.3 * rates + 0.3 * speedUse, pathAngle, speedUse };
}

/** Seconds from the snapshot's rhythm phase to its nearest natural break (NaN: no active rhythm). */
export function rhythmOffset(s: MotionSnapshot): number {
  if (s.rhythmAmount < FLOW.rhythmMinAmount || s.rhythmFreq <= 0.05) {
    return NaN;
  }
  const d = (a: number): number => {
    const x = (((s.rhythmPhase - a) % TWO_PI) + TWO_PI) % TWO_PI;
    return Math.min(x, TWO_PI - x);
  };
  const phase = Math.min(d(s.rhythmBreakA), d(s.rhythmBreakB));
  return phase / (TWO_PI * s.rhythmFreq);
}

/** Rhythm score from the offset (s); neutral without a rhythm. */
export function rhythm(offset: number): number {
  if (!Number.isFinite(offset)) {
    return FLOW.rhythmNeutral;
  }
  const u = offset / FLOW.rhythmSigma;
  return Math.exp(-0.5 * u * u);
}

/** Proximity 0..1 of one instant (surface below, ceiling above, updraft): never for contact, only at flying speed. */
export function proximity(clearance: number, ceilingGap: number, updraft: number, speed: number): number {
  const fast = smoothstep(FLOW.flyingSpeed - 4, FLOW.flyingSpeed, speed);
  const surface = clearance > FLOW.contactClearance ? (1 - smoothstep(FLOW.nearClearance, FLOW.farClearance, clearance)) * smoothstep(FLOW.contactClearance, FLOW.contactClearance + 1, clearance) : 0;
  const ceiling = Number.isFinite(ceilingGap) && ceilingGap > 0 ? 1 - smoothstep(FLOW.nearCeiling, FLOW.farCeiling, ceilingGap) : 0;
  const lift = smoothstep(FLOW.updraftLo, FLOW.updraftHi, updraft);
  return fast * Math.max(surface, ceiling, lift);
}

/** Use of the world over a motion: peak and mean proximity and the tightest pass; 0 after any contact. */
export function worldUse(peak: number, mean: number, passTightness: number, contact: boolean): number {
  if (contact) {
    return 0;
  }
  return clamp(Math.max(0.5 * peak + 0.5 * mean, passTightness), 0, 1);
}

/** Signature vector of a motion (variety): rotation amounts, turn, height and energy change, length, load. */
export function signature(d: MotionDescriptor): number[] {
  const kinetic = 0.5 * (d.exit.speed * d.exit.speed - d.entry.speed * d.entry.speed);
  return [
    Math.min(d.rotX / Math.PI, 2),
    Math.min(d.rotY / Math.PI, 2),
    Math.min(d.rotZ / Math.PI, 2),
    Math.abs(d.headingChange) / Math.PI,
    clamp((d.exit.height - d.entry.height) / 80, -2, 2),
    clamp(kinetic / (GRAVITY * 60), -2, 2),
    Math.min(d.duration / 3, 2),
    clamp(d.meanLoad - 1, -1, 3),
  ];
}

export interface SignatureEntry {
  sig: number[];
  t: number;
}

/**
 * Novelty 0..1 of a signature against the remembered ones: 1 − the sum of their recency-weighted similarities, so a
 * motion repeated back to back and a short cycle of motions repeated over and over both wear out.
 */
export function novelty(sig: readonly number[], history: readonly SignatureEntry[], now: number): number {
  let seen = 0;
  const s2 = 2 * FLOW.signatureSigma * FLOW.signatureSigma;
  for (const h of history) {
    let d2 = 0;
    for (let i = 0; i < sig.length; i++) {
      const d = sig[i] - (h.sig[i] ?? 0);
      d2 += d * d;
    }
    const similar = Math.exp(-d2 / s2) * Math.exp(-Math.max(0, now - h.t) / FLOW.historyForget);
    seen += similar;
  }
  return clamp(1 - seen, 0, 1);
}

/** Chain factor of a gap (s) between two motions. */
export function chainFactor(gap: number): number {
  if (!Number.isFinite(gap) || gap > FLOW.maxGap) {
    return 0;
  }
  const u = Math.max(gap, 0) / FLOW.chainGap;
  return Math.exp(-u * u);
}

/**
 * All terms of the transition into motion `cur` from `prev` (null: from steady flight). `handover` is the state the
 * previous motion left the dragon in (its exit, or `cur.entry` when there is none). `history` excludes `cur`.
 */
export function transitionHarmony(prev: MotionDescriptor | null, cur: MotionDescriptor, history: readonly SignatureEntry[], out: HarmonyTerms): HarmonyTerms {
  const gap = prev ? cur.gap : Infinity;
  out.chain = chainFactor(gap);
  // Energy over the motion and the gap before it (steady flight between two motions counts too).
  const net = cur.energyNet + (prev ? cur.gapEnergyNet : 0);
  const ref = cur.energyRef + (prev ? cur.gapEnergyRef : 0);
  const e = energyStewardship(net, ref, cur.duration + (prev && Number.isFinite(gap) ? gap : 0));
  out.energy = e.score;
  out.excess = e.excess;
  out.continuity = continuity(cur.jerkLoad, cur.jerkRate, e.score);
  const handover = prev ? prev.exit : cur.entry;
  const a = alignment(handover, cur.earlyPath, prev ? prev.exitRates : [0, 0, 0], cur.entryRates, cur.entry.speed, cur.prePeakSpeed);
  out.alignment = a.score;
  out.pathAngle = a.pathAngle;
  out.speedUse = a.speedUse;
  out.rhythmOffset = rhythmOffset(cur.entry);
  out.rhythm = rhythm(out.rhythmOffset);
  out.world = worldUse(cur.worldPeak, cur.worldMean, cur.passTightness, cur.contact);
  out.novelty = novelty(signature(cur), history, cur.exit.t);
  const handoverTerms = FLOW.weightContinuity * out.continuity + FLOW.weightAlignment * out.alignment + FLOW.weightRhythm * out.rhythm;
  out.total = clamp(FLOW.weightEnergy * out.energy + out.chain * handoverTerms + FLOW.weightWorld * out.world, 0, 1);
  return out;
}

/**
 * Flow change of one transition (before moments): gain above the threshold (novelty and energy gated); below it a loss
 * scaled by the chain factor (a clumsy handover costs, a lone motion out of steady flight does not).
 */
export function flowDelta(t: HarmonyTerms): number {
  const d = t.total - FLOW.threshold;
  if (d < 0) {
    return FLOW.loss * d * t.chain;
  }
  return FLOW.gain * d * smoothstep(FLOW.noveltyLo, FLOW.noveltyHi, t.novelty) * smoothstep(FLOW.energyGateLo, FLOW.energyGateHi, t.energy);
}
