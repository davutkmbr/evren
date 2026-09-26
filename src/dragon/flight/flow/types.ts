/**
 * Generic motion descriptors of the flow system. A "motion" is any stretch of manoeuvring: a named move (announced on
 * the sim's `maneuver` event) or an unnamed one found by the automatic segmenter (a hand-flown carve, a zoom, a dive).
 * Nothing here is move-specific: a motion is described only by the dragon's state at its entry and exit and by a few
 * integrals over it, so a new move participates without registering anything beyond its start / end.
 */

/** The dragon's state at one instant, in plain numbers (copied, never shared). */
export interface MotionSnapshot {
  /** Sim time (s). */
  t: number;
  /** Airspeed (m/s) and the unit air-path direction (world). */
  speed: number;
  pathX: number;
  pathY: number;
  pathZ: number;
  /** Height of the centre of mass (m). */
  height: number;
  /** Total specific energy ½V² + g·h (J/kg), airspeed based. */
  energy: number;
  /** Attitude (rad): bank, pitch and flight-path angle. */
  bank: number;
  pitch: number;
  gamma: number;
  /** Body angular rates (rad/s; x pitch, y yaw, z roll), low-passed. */
  rateX: number;
  rateY: number;
  rateZ: number;
  /** Lift load factor (g), low-passed. */
  load: number;
  /** Active natural rhythm (wing beat in the air, swim stroke, gait): phase (rad), strength 0..1, frequency (Hz). */
  rhythmPhase: number;
  rhythmAmount: number;
  rhythmFreq: number;
  /** Natural breaks of the rhythm (rad): the top and bottom of the wing stroke, the two footfalls / strokes. */
  rhythmBreakA: number;
  rhythmBreakB: number;
  /** Foot clearance above the surface (m) and free height under a ceiling (m, Infinity: open sky). */
  clearance: number;
  ceilingGap: number;
  /** Vertical air motion ridden (thermal + ridge, m/s). */
  updraft: number;
  airborne: boolean;
  stamina: number;
}

export function createSnapshot(): MotionSnapshot {
  return {
    t: 0,
    speed: 0,
    pathX: 0,
    pathY: 0,
    pathZ: -1,
    height: 0,
    energy: 0,
    bank: 0,
    pitch: 0,
    gamma: 0,
    rateX: 0,
    rateY: 0,
    rateZ: 0,
    load: 1,
    rhythmPhase: 0,
    rhythmAmount: 0,
    rhythmFreq: 0,
    rhythmBreakA: 0,
    rhythmBreakB: Math.PI,
    clearance: Infinity,
    ceilingGap: Infinity,
    updraft: 0,
    airborne: true,
    stamina: 1,
  };
}

export function copySnapshot(from: MotionSnapshot, to: MotionSnapshot): MotionSnapshot {
  return Object.assign(to, from);
}

/** A finished motion: entry / exit state and integrals over it (and over the gap before it). */
export interface MotionDescriptor {
  /** Named move id (the `maneuver` event id), or null for an unnamed motion found by the segmenter. */
  id: string | null;
  entry: MotionSnapshot;
  exit: MotionSnapshot;
  duration: number;
  /** Specific energy change net of the dragon's own muscle work (J/kg) over the motion, and over the gap before it. */
  energyNet: number;
  gapEnergyNet: number;
  /** Reference: plain gliding's specific energy change over the same times (J/kg, ≤ 0). */
  energyRef: number;
  gapEnergyRef: number;
  /** Muscle work of the wing beats and pushes (J/kg). */
  muscleWork: number;
  /** Seconds since the previous motion ended (Infinity: none). */
  gap: number;
  /** Rotation amounts about the body axes (∫|ω| dt, rad) and the track's heading change (rad, signed). */
  rotX: number;
  rotY: number;
  rotZ: number;
  headingChange: number;
  meanLoad: number;
  /** Handover: largest jerk of the load (g/s) and of the body rates (rad/s²) within FLOW.handoverWindow of the entry. */
  jerkLoad: number;
  jerkRate: number;
  /** Mean body rates over the first / last FLOW.rateWindow s (rad/s). */
  entryRates: [number, number, number];
  exitRates: [number, number, number];
  /** Mean air-path direction over the first FLOW.earlyPath s (unit, world). */
  earlyPath: [number, number, number];
  /** Highest airspeed within FLOW.speedPeakWindow s before the entry (m/s). */
  prePeakSpeed: number;
  /** Use of the world over the motion: peak and mean proximity 0..1, lowest clean clearance (m), tightest pass 0..1. */
  worldPeak: number;
  worldMean: number;
  minClearance: number;
  passTightness: number;
  /** Touched something (impact, belly in the water, landed while airborne) / stalled during it. */
  contact: boolean;
  stalled: boolean;
  /** The move's own verdict when it reports one (`ended` event), else !contact && !stalled. */
  clean: boolean;
}

/** The harmony terms of one transition (all 0..1 except the raw diagnostics). */
export interface HarmonyTerms {
  energy: number;
  continuity: number;
  alignment: number;
  rhythm: number;
  world: number;
  novelty: number;
  /** Chain factor (1: back to back, 0: separated by steady flight). */
  chain: number;
  /** Weighted harmony (0..1) before novelty. */
  total: number;
  /** Diagnostics: excess energy loss x, rhythm offset (s, NaN without a rhythm), path angle (rad), speed use. */
  excess: number;
  rhythmOffset: number;
  pathAngle: number;
  speedUse: number;
}

export function createTerms(): HarmonyTerms {
  return { energy: 0, continuity: 0, alignment: 0, rhythm: 0, world: 0, novelty: 1, chain: 0, total: 0, excess: 0, rhythmOffset: NaN, pathAngle: 0, speedUse: 1 };
}
