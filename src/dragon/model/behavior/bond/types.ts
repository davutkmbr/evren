import type { BondAudioCue, DragonMood, FlightMode } from '../../../../core/contracts';

/**
 * Phase 06 bond core: shared types and the feel tunables. Everything in this folder except `bond-behavior.ts` is pure
 * logic (no engine, no DOM), so the headless check (tools/headless/bond-check.ts) runs the exact code the game runs.
 */

export const MOODS: readonly DragonMood[] = ['content', 'curious', 'playful', 'tired', 'excited'];

/** A world thing worth a look, already turned into the dragon's body frame by the adapter. */
export interface AttentionCandidate {
  kind: 'landmark' | 'horn' | 'bird' | 'stork' | 'ferry' | 'sound';
  /** Stable key (landmark id, vessel id, "bird") for the per-target cooldown. */
  key: string;
  /** Body-relative direction (rad): yaw > 0 = to the dragon's left, pitch > 0 = up. */
  yaw: number;
  pitch: number;
  /** Distance (m). */
  distance: number;
  /** 0..1 how interesting (the adapter's ranking inside a kind). */
  strength: number;
}

/** Everything the bond core reads each frame (the adapter fills it from the engine, the check from scripts). */
export interface BondInputs {
  dt: number;
  mode: FlightMode;
  airspeed: number;
  /** Horizontal ground speed (m/s). */
  groundSpeed: number;
  /** Height above the surface below (m). */
  agl: number;
  stamina: number;
  /** Flight's "tired" state (stamina ran out) or heavy effort. */
  flapEffort: number;
  flow: number;
  firing: boolean;
  /** A trick, a hard bank or g, a tuck: the rider and the dragon are busy flying. */
  maneuvering: boolean;
  /** Seconds until the dragon would reach an obstacle along its path (Infinity: nothing ahead). */
  obstacleTime: number;
  perched: boolean;
  /** Perch approach or leaving (guided, the dragon watches its feet). */
  perchBusy: boolean;
  /** A race is prepared, running or its result is open. */
  racing: boolean;
  /** The POV camera is on. */
  pov: boolean;
  /** POV: the rider's view rests on the dragon's neck / head; sign of the view's yaw (+1 left, -1 right). */
  povLookAtNeck: boolean;
  povLookSide: number;
  /** 0..1 the rider's hand is on the neck (smoothed petting cue) and whether the petting key is being honoured. */
  petting: number;
  petActive: boolean;
  riderStanding: boolean;
  /** The V "encourage" press this frame (the adapter already checked the rider can pat). */
  encourage: boolean;
  /** Local hour 0..24, day of year, 0 day .. 1 night, 0..1 light at the dragon. */
  hours: number;
  dayOfYear: number;
  nightFactor: number;
  light: number;
  humidity: number;
  rain: number;
  /** Estimated air temperature at the dragon (°C). */
  airTempC: number;
  /** Things to look at this frame (may be empty); `discovery` is a landmark discovered this frame. */
  attention: readonly AttentionCandidate[];
  discovery: AttentionCandidate | null;
  /** One-shot events this frame. */
  maneuverGlance: boolean;
  trickDone: boolean;
}

/** What one frame of the bond core asks of the rig, the sound and the effects. */
export interface BondOutputs {
  gazeRider: number;
  /** +1 the head comes round on the left, -1 on the right. */
  gazeSide: number;
  /** Additive offsets on the flight pose (rad unless noted). */
  neckYaw: number;
  neckPitch: number;
  neckShake: number;
  headRoll: number;
  jawMin: number;
  bodyRoll: number;
  tailYaw: number;
  tailPitch: number;
  tailCurl: number;
  /** Wings: blend weight toward `wingSpread` (0 = flight pose), extra raise, and a visual wing beat. */
  wingWeight: number;
  wingSpread: number;
  wingRaise: number;
  beatWeight: number;
  beatPhase: number;
  eyeLid: number;
  pupil: number;
  neckPlates: number;
  nostrilSteam: number;
  exhale: number;
  riderLaugh: number;
  riderShow: number;
  riderShowYaw: number;
  riderShowPitch: number;
  riderPat: number;
  /** 0..1 continuous gamepad rumble wanted this frame (petting purr). */
  rumble: number;
  /** One-shots this frame. */
  sounds: BondSound[];
  puffs: BondPuff[];
  captions: string[];
  mood: DragonMood;
  moodLevel: number;
  /** "id:variant" of the playing behaviour, or null. */
  behavior: string | null;
}

export interface BondSound {
  cue: BondAudioCue | 'purr' | 'flap';
  volume: number;
}

export interface BondPuff {
  kind: 'smoke' | 'flame' | 'steam' | 'droplets';
  strength: number;
}

export function createOutputs(): BondOutputs {
  return {
    gazeRider: 0,
    gazeSide: 1,
    neckYaw: 0,
    neckPitch: 0,
    neckShake: 0,
    headRoll: 0,
    jawMin: 0,
    bodyRoll: 0,
    tailYaw: 0,
    tailPitch: 0,
    tailCurl: 0,
    wingWeight: 0,
    wingSpread: 1,
    wingRaise: 0,
    beatWeight: 0,
    beatPhase: 0,
    eyeLid: 0,
    pupil: 0.3,
    neckPlates: 0,
    nostrilSteam: 0,
    exhale: 0,
    riderLaugh: 0,
    riderShow: 0,
    riderShowYaw: 0,
    riderShowPitch: 0,
    riderPat: 0,
    rumble: 0,
    sounds: [],
    puffs: [],
    captions: [],
    mood: 'content',
    moodLevel: 0.4,
    behavior: null,
  };
}

/** A neutral input frame (calm glide at 300 m, midday); scripts and the adapter start from it. */
export function createInputs(): BondInputs {
  return {
    dt: 1 / 60,
    mode: 'gliding',
    airspeed: 28,
    groundSpeed: 28,
    agl: 300,
    stamina: 1,
    flapEffort: 0.1,
    flow: 0,
    firing: false,
    maneuvering: false,
    obstacleTime: Infinity,
    perched: false,
    perchBusy: false,
    racing: false,
    pov: false,
    povLookAtNeck: false,
    povLookSide: 1,
    petting: 0,
    petActive: false,
    riderStanding: false,
    encourage: false,
    hours: 12,
    dayOfYear: 180,
    nightFactor: 0,
    light: 1,
    humidity: 0.6,
    rain: 0,
    airTempC: 20,
    attention: [],
    discovery: null,
    maneuverGlance: false,
    trickDone: false,
  };
}

/**
 * Feel tunables of the bond (owner feel checklist in .docs/planning/06-dragon-bond.md). Times in seconds, speeds in
 * m/s, heights in m, angles in rad.
 */
export const BOND = {
  gaze: {
    /** Looking back at the rider needs all of these (see SafetyGate). */
    maxAirspeed: 40,
    /** Airborne below this height the dragon watches the ground (unless hovering slower than hoverSpeed). */
    minAgl: 30,
    hoverSpeed: 4,
    /** Seconds of path ahead that must be clear (blocked below, clear again above the release). */
    obstacleBlock: 7,
    obstacleRelease: 10,
    /** On the ground or in the water: slower than this. */
    surfaceSpeed: 3,
    /** After anything unsafe, calm for this long before a look back may start. */
    calmHold: 1.5,
    /** Gaze level rates (1/s): rising, falling, and falling while unsafe. */
    rateUp: 1.8,
    rateDown: 2.4,
    rateUnsafe: 6.5,
    /** Petting: the head comes round after this much stroking, to this level. */
    petDelay: 0.6,
    petLevel: 0.8,
    /** POV: looking at the neck for this long turns the head back (acceptance: 3 s, head round within 2 s). */
    povDwell: 3,
    povLevel: 0.9,
    povRelease: 1,
    /** Idle glances (s between, random within): gliding, perched, on the ground; duration range. */
    glideEvery: [18, 40] as const,
    perchEvery: [12, 26] as const,
    groundEvery: [25, 50] as const,
    glanceTime: [1.6, 2.8] as const,
    perchGlanceTime: [2.4, 4] as const,
  },
  look: {
    /** Side looks at the world (landmarks, birds, ferries) stop above this airspeed or this close to obstacles. */
    maxAirspeed: 55,
    minAgl: 15,
    obstacleBlock: 5,
    /** Largest neck yaw / pitch offset toward a target, and the share of the offset used. */
    maxYaw: 1.15,
    maxPitchUp: 0.4,
    maxPitchDown: 0.5,
    rate: 2.5,
    /** Durations per kind and cooldowns (per target key / per kind). */
    landmarkTime: 3.6,
    birdTime: 1.6,
    ferryTime: 2.6,
    storkTime: 2.8,
    hornTime: 2.4,
    birdCooldown: 14,
    ferryCooldown: 45,
    storkCooldown: 25,
    hornCooldown: 8,
    /** Ranges (m) a candidate must be within. */
    birdRange: 70,
    ferryRange: 420,
    storkRange: 650,
    hornRange: 1500,
    /** The rider points at a landmark / stork / ferry the dragon looks at, for this long. */
    showTime: 1.6,
  },
  mood: {
    /** A challenger must beat the current mood's score by this margin for `dwell` s (hysteresis). */
    margin: 0.12,
    dwell: 4,
    dwellExcited: 1.5,
    /** Shortest time in one mood (except a strong excitement). */
    minHold: 10,
    /** Fatigue: airborne minutes to full, rest time constant, rise time constant. */
    fatigueFullMinutes: 18,
    fatigueRise: 90,
    fatigueRest: 70,
    affectionUp: 5,
    affectionDecay: 240,
    curiosityDecay: 45,
    excitementUp: 1.5,
    excitementDecay: 22,
    playRise: 40,
    playDecay: 80,
  },
  behavior: {
    /** Global gap between self-driven behaviours (s, random within), scaled by mood. */
    gap: [45, 95] as const,
    /** A triggered one (wing stretch, shake-off) may start this soon after the previous behaviour. */
    triggerGap: 8,
    /** First behaviour of a session not before this. */
    warmup: 25,
    /** Wing stretch after landing from at least this much flight (s); shake-off within this long after a swim. */
    stretchAfterFlight: 150,
    shakeWindow: 6,
    /** Fade out when interrupted (s). */
    abortFade: 0.25,
  },
  pet: {
    /** Eyelids while petted (half-closed), neck plates, rumble strength. */
    lid: 0.55,
    lidDeep: 0.7,
    plates: 1,
    rumble: 0.18,
    /** Seconds between purr phrases, and how much deeper the purr gets with affection. */
    purrEvery: 2.1,
  },
  encourage: {
    /** Shortest gap between two presses honoured, the rider's pat, and the delay to the dragon's answer. */
    cooldown: 2.4,
    patTime: 0.9,
    reactDelay: 0.35,
  },
  eyes: {
    blinkEvery: [2.5, 6] as const,
    blinkTime: 0.16,
    tiredBlinkTime: 0.32,
    doubleBlink: 0.15,
  },
  steam: {
    /** Visible breath: full at or below `cold` °C, none above `mild`; humid air shows it up to `humidMild`. */
    cold: 1,
    mild: 8,
    humidMild: 13,
    /** Breath cycle (s) at rest and after hard flight. */
    breathRest: 3.4,
    breathHard: 1.5,
  },
} as const;

/** Small deterministic LCG (checks and pose sheets reproduce exactly). */
export class BondRng {
  private s: number;
  constructor(seed = 0x0b0d) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.min(list.length - 1, Math.floor(this.next() * list.length))];
  }
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function smooth01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function smoothstep(a: number, b: number, x: number): number {
  return smooth01((x - a) / (b - a));
}

/** Exponential approach of `current` to `target` at `rate` (1/s). */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Envelope that rises over `a`, holds, and falls over `b` inside [0, 1] of a behaviour's normalised time. */
export function envelope(t: number, a: number, b: number): number {
  return smoothstep(0, a, t) * (1 - smoothstep(1 - b, 1, t));
}

/** Bell centred at `c` with half width `w` (0 outside). */
export function bell(t: number, c: number, w: number): number {
  const x = (t - c) / w;
  return Math.abs(x) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x);
}

/**
 * Rough air temperature at the dragon (°C) for the breath steam: Istanbul's seasonal mean (≈5 °C in late January,
 * ≈24 °C in late July), a daily swing peaking mid-afternoon, the standard lapse rate with altitude, and cooling in
 * rain and storms. Not a weather model; it only has to put visible breath in winter mornings and up high.
 */
export function estimateAirTemp(dayOfYear: number, hours: number, altitude: number, rain: number, storm: number): number {
  const seasonal = 14.5 - 9.5 * Math.cos((2 * Math.PI * (dayOfYear - 22)) / 365);
  const daily = 4 * Math.sin((2 * Math.PI * (hours - 9)) / 24);
  const lapse = -0.0065 * Math.max(0, altitude);
  return seasonal + daily + lapse - 3 * clamp(rain, 0, 1) - 2 * clamp(storm, 0, 1);
}
