/**
 * Global tuning knobs of the flow system ("Akış", phase 20 stage D). These are the only numbers flow is tuned by: term
 * weights, response scales, gain / decay, the payback caps and the "Kusursuz" moment thresholds. None of them names a
 * move or a pair of moves; every motion (named or hand-flown) is judged by the same physical harmony terms (harmony.ts).
 */
import { DEG } from '../params';

export const FLOW = {
  /* ------------------------------------------------------------ harmony weights (flow/harmony.ts) */
  /** Weight of energy stewardship (always counts, chained or not). */
  weightEnergy: 0.35,
  /** Weights of the handover terms (scaled by the chain factor: they only mean something between close motions). */
  weightContinuity: 0.2,
  weightAlignment: 0.2,
  weightRhythm: 0.15,
  /** Weight of the use of the world (a bonus: total harmony is clamped to 1). */
  weightWorld: 0.2,

  /* ------------------------------------------------------------ energy stewardship */
  /**
   * Excess loss x = (net loss − reference loss) / reference loss, where the net loss leaves out the dragon's own muscle
   * work and the reference is plain gliding over the same time. Score = 1 / (1 + exp((x − mid) / width)).
   */
  energyMid: 0.5,
  energyWidth: 0.3,
  /** Reference loss floor (J/kg per s) so a near-zero reference never divides by nothing. */
  energyRefFloor: 12,
  /** A transition's gain is gated by smoothstep(lo, hi, energy score): wasteful flying never builds flow. */
  energyGateLo: 0.3,
  energyGateHi: 0.65,

  /* ------------------------------------------------------------ continuity */
  /** Jerk scales across a handover: load factor (g/s) and body rates (rad/s²). */
  jerkLoad: 12,
  jerkRate: 25,
  /** Window around the handover (s) the jerk is measured over, each side. */
  handoverWindow: 0.3,
  /** Share of the remaining continuity an energy-efficient reversal earns back (0..1). */
  reversalCredit: 0.5,

  /* ------------------------------------------------------------ alignment */
  /** Path carry: exp(−(angle / pathAngle)²) between the handover velocity and the next motion's early path. */
  pathAngle: 22 * DEG,
  /** Length of the "early path" / "entry rates" / "exit rates" windows (s). */
  earlyPath: 0.6,
  rateWindow: 0.3,
  /** Body rates below this (rad/s) count as "no rotation" (neutral rate alignment). */
  rateFloor: 0.25,
  /** Speed use: (entry speed / recent peak speed) ^ speedUseExponent, the peak over the last speedPeakWindow s. */
  speedUseExponent: 6,
  speedPeakWindow: 1.5,

  /* ------------------------------------------------------------ rhythm */
  /** Offset from the nearest natural break of the active rhythm (s) for score 1/e^0.5. */
  rhythmSigma: 0.07,
  /** Score without an active rhythm (gliding, standing). */
  rhythmNeutral: 0.6,
  /** Rhythm amplitude below which there is no active rhythm. */
  rhythmMinAmount: 0.2,

  /* ------------------------------------------------------------ use of the world */
  /** Surface proximity: full at nearClearance (m), none from farClearance; only at flyingSpeed or faster. */
  nearClearance: 3,
  farClearance: 22,
  /** Below this clearance (m) it is contact territory: proximity fades back out (never reward touching). */
  contactClearance: 0.6,
  /** Ceiling proximity (flying under a deck): full at nearCeiling (m of gap above the raised wings), none from farCeiling. */
  nearCeiling: 5,
  farCeiling: 40,
  /** Updraft ridden (thermal / ridge, m/s): none at updraftLo, full at updraftHi. */
  updraftLo: 0.6,
  updraftHi: 3,
  flyingSpeed: 18,
  /** A gate or speed ring pass counts this long (s) for the motion it falls into (or the next one). */
  passHold: 2,

  /* ------------------------------------------------------------ variety */
  /** Motions remembered for novelty, and how fast they are forgotten (s, e-folding). */
  historySize: 8,
  historyForget: 12,
  /** Width of the similarity kernel on the signature vector. */
  signatureSigma: 0.35,

  /* ------------------------------------------------------------ chaining */
  /** Chain factor exp(−(gap / chainGap)²) on the handover terms; gap = time between two motions (s). */
  chainGap: 2.6,
  /** A previous motion older than this (s) is no longer the other half of a transition. */
  maxGap: 6,

  /* ------------------------------------------------------------ automatic segmentation (flow/segmenter.ts) */
  /** Activity = max(|ω| / rotationScale, |n − 1| / loadScale, |γ| / pathScale), low-passed over activityTau s. */
  rotationScale: 0.4,
  loadScale: 0.55,
  pathScale: 20 * DEG,
  activityTau: 0.15,
  /** Unnamed motion: starts above 1 held for startHold s, ends below endLevel held for endHold s. */
  startHold: 0.2,
  endLevel: 0.6,
  endHold: 0.4,
  /** Unnamed motions shorter than this (s) or turning less than minRotation (rad) are not motions. */
  minDuration: 0.5,
  minRotation: 25 * DEG,
  /** Any motion is closed after this long (s). */
  maxDuration: 10,
  /** Low-pass of the lift load factor (s) and the body rates (s) for jerk and activity. */
  loadTau: 0.1,
  rateTau: 0.05,

  /* ------------------------------------------------------------ flow value */
  /**
   * Harmony above threshold builds flow: gain × (H − threshold) × novelty gate × energy gate; below it a handover costs
   * loss × (H − threshold) × chain factor.
   */
  threshold: 0.58,
  gain: 0.9,
  loss: 0.3,
  /** Steady flight: flow decays at decay per s after grace s without a motion; faster on the ground / in the water. */
  grace: 2.5,
  decay: 0.02,
  decayGround: 0.15,
  /** Flow always leaks this much per s in the air: it has to be kept alive by new, harmonious motions. */
  leak: 0.005,
  /** Novelty gate of a gain: smoothstep(noveltyLo, noveltyHi, novelty) (a repeated motion adds nothing). */
  noveltyLo: 0.15,
  noveltyHi: 0.75,
  /** Neutral rate agreement (either motion hardly rotating). */
  rateNeutral: 0.6,
  /** Multipliers on a stall, on contact (impact, belly in the water) and on an unclean motion end. */
  stallKeep: 0.5,
  contactKeep: 0.35,
  uncleanKeep: 0.7,
  /** Sustained waste: net energy loss faster than wasteFactor × plain gliding drains wasteDrain per s. */
  wasteFactor: 2.5,
  wasteTau: 0.8,
  wasteDrain: 0.12,

  /* ------------------------------------------------------------ payback (capped, physical) */
  /** Drag multiplier at full flow: 1 − dragCut (all aerodynamic drag). */
  dragCut: 0.12,
  /** Flap force multiplier at full flow: 1 + thrustGain (with dragCut: top cruise 48.3 → ~55.5 m/s, checked by flow-check). */
  thrustGain: 0.3,
  /** Power stroke at full flow: surge gain × (1 + powerGain), thrust × (1 + powerThrust). */
  powerGain: 0.4,
  powerThrust: 0.25,

  /* ------------------------------------------------------------ "Kusursuz" moments */
  /** Extra flow step of a moment and the least time between two captions (s). */
  momentStep: 0.06,
  momentCooldown: 3,
  /** A moment needs this much total harmony and novelty. */
  momentHarmony: 0.55,
  momentNovelty: 0.5,
  /** Rhythm: offset (s) at most, with the rhythm at least this strong and the chain at least momentChain. */
  momentRhythm: 0.035,
  momentRhythmAmount: 0.3,
  momentChain: 0.6,
  /** Energy: excess loss at most (x ≤ −0.5: lost half of what plain gliding would have, or gained), motion ≥ 1 s. */
  momentEnergy: -0.5,
  momentEnergyDuration: 1,
  /** Handover: continuity and alignment both at least this, chain at least 0.8. */
  momentHandover: 0.9,
  /** World: a clean pass at most this clearance (m) at speed, or a pass through a gate at least this tight. */
  momentClearance: 3.5,
  momentTightness: 0.85,
} as const;
