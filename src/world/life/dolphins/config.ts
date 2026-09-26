/**
 * Tunables of the dolphins of the Bosphorus (phase 13 natural phenomena, phase 21 sea). Pure data: the simulation,
 * the spawn director and the headless check (tools/headless/dolphins-check.ts) read the same numbers.
 */

export const DOLPHIN_SPAWN = {
  /** Seconds between two spawn rolls (the idle cost is one timer decrement per frame in between). */
  checkEvery: 2,
  /** Neutral pods per second somewhere within view (one every ~3.5 minutes before the time and sea weights). */
  baseRate: 1 / 210,
  /** Shortest gap between two spawns (s) and the most pods alive at once. */
  minGap: 70,
  maxPods: 2,
  /** Pod size (individuals). */
  podMin: 3,
  podMax: 8,
  /** Where a pod may surface, relative to the camera: distance band (m) and half angle around the view (rad). */
  nearDistance: 260,
  farDistance: 900,
  halfAngle: 1.2,
  /** Candidates tried per successful roll. */
  tries: 14,
  /** The camera this high above the sea sees no dolphins worth spawning (m). */
  maxAltitude: 650,
  /** Open water only: at least this far from the shore (m) and this deep (m). */
  minShore: 140,
  minDepth: 8,
  /** Away from the traffic lanes and the ferry routes (m) and from vessels (m). */
  minLane: 160,
  minVessel: 260,
  /** Within this distance of the strait's centreline (the Bosphorus and the Marmara near its mouth, m). */
  maxFromStrait: 4200,
} as const;

/** Time-of-day weight of the spawn rate (hours → factor, linear in between; wraps at 24). */
export const DOLPHIN_TIME_WEIGHT: readonly (readonly [number, number])[] = [
  [0, 0.2],
  [5, 0.25],
  [6.5, 1.8],
  [9.5, 1.8],
  [12, 1.0],
  [17, 0.9],
  [19.5, 0.8],
  [21.5, 0.25],
  [24, 0.2],
];

export const DOLPHIN_SEA = {
  /** Significant wave height (m): full rate below `calm` (with a bonus), none above `rough`. */
  calm: 0.35,
  calmBonus: 1.3,
  rough: 1.7,
  /** 10 m wind (m/s) above which no pod shows. */
  maxWind: 13.5,
  /** Weather: storm activity above this is "a storm" (no dolphins); rain and fog thin them out. */
  stormCut: 0.25,
  rainCut: 0.6,
  fogCut: 0.35,
} as const;

export const DOLPHIN_POD = {
  /** Cruise speed (m/s) and its variation per pod; bursts while accompanying or scattering. */
  cruise: 3.6,
  cruiseJitter: 1.2,
  maxSpeed: 10.5,
  /** Life of a pod (s); after it the pod stops surfacing and leaves under water. */
  life: [150, 240] as const,
  /** Removed at once when the camera is this far away (m, e.g. a teleport). */
  dropDistance: 3200,
  /** Shore avoidance: look-ahead (m), the clearance the pod keeps (m) and the steering rate (rad/s). */
  lookAhead: 90,
  keepShore: 150,
  turnRate: 0.35,
  /** Loose formation: spacing (m) between neighbours, wander of each offset (m) and its relaxation rate (1/s). */
  spacing: 5.5,
  wander: 2.2,
  relax: 0.35,
  /** Group surfacing pulses (s between) and the share of the pod that rises with each pulse. */
  pulse: [4.5, 9] as const,
  pulseShare: [0.45, 1] as const,
  /** Depth of the travel between breaths (m) and of the scatter (m). */
  travelDepth: 2.2,
  scatterDepth: 4.5,
} as const;

/** Surfacing acts: duration (s) and height (m) ranges, and their weights (calm travel / accompanying / fast). */
export const DOLPHIN_ACTS = {
  porpoise: { time: [0.85, 1.1] as const, peak: [0.3, 0.8] as const },
  roll: { time: [1.5, 2.1] as const, peak: [0.08, 0.22] as const },
  /** Leap: vertical take-off speed (m/s); the air time follows (2 v / g). */
  leap: { vy: [4.8, 7.4] as const, lead: 0.28, tail: 0.3 },
  /** Chance of a full leap per act: travelling, accompanying the dragon, right after a scare. */
  leapChance: 0.08,
  leapChanceAccompany: 0.25,
  leapChanceExcited: 0.16,
  /** Above this pod speed (m/s) most acts are porpoising arcs. */
  porpoiseSpeed: 6,
} as const;

export const DOLPHIN_ACCOMPANY = {
  /** The dragon within this horizontal distance (m), this low over the water (m) and not faster (m/s). */
  range: 40,
  maxHeight: 12,
  maxDragonSpeed: 16,
  /** Top speed of a pod riding along (m/s): bow-riding dolphins surf the pressure wave faster than they cruise. */
  maxSpeed: 14,
  /** Acceleration while riding along (m/s²). */
  accel: 4,
  /** Side offset (m) and lead (m) the pod keeps beside the dragon (bow-riding its pressure wave). */
  side: 11,
  lead: 5,
  /** Longest company (s), then the pod goes its way for `rest` s. */
  maxTime: [45, 80] as const,
  rest: 45,
  /** The company ends when the dragon is this far off (m). */
  lose: 90,
} as const;

export const DOLPHIN_SCATTER = {
  /** The dragon diving within this range of a dolphin (m), or a splash of `splashStrength` within `splashRange`. */
  range: 60,
  splashRange: 75,
  splashStrength: 1.4,
  /** Flight speed away (m/s), the time they stay away (s) and the time the formation takes to come back (s). */
  speed: 8.5,
  time: [5, 8] as const,
  regroup: 10,
} as const;

/** Level of detail (camera distance, m). */
export const DOLPHIN_LOD = {
  near: 140,
  far: 1400,
  /** Deeper than this below the surface and farther than `deepRange` from an above-water camera: not drawn. */
  deepHide: 1.4,
  deepRange: 70,
} as const;

/** The dragon notices and the discovery toast. */
export const DOLPHIN_NOTICE = {
  /** A surfacing within this distance of the dragon may draw its gaze (m); at most once per `every` s per pod. */
  gazeRange: 480,
  every: 3.5,
  /** The first surfacing this close to the camera (m) is the discovery ("Yunuslar!"). */
  discoverRange: 130,
} as const;

/** Sounds (positional cues, silent until the recordings are approved). */
export const DOLPHIN_SOUND = {
  breathRange: 120,
  splashRange: 260,
  whistleRange: 220,
  /** Seconds between whistles of a pod near the camera (travelling / accompanying). */
  whistleEvery: [7, 16] as const,
  whistleEveryAccompany: [3, 7] as const,
} as const;
