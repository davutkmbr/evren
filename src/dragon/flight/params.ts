/**
 * Physical and handling parameters of the dragon. Everything the flight model is tuned by lives here.
 * Target envelope: cruise 25-45 m/s, best glide ratio ~10, stall ~14.5 m/s (CLmax 1.5 at ~19.5°),
 * folded-wing dive 80-90 m/s, hover with brake + heavy flapping.
 */
export const DEG = Math.PI / 180;
export const GRAVITY = 9.81;
export const SEA_LEVEL_DENSITY = 1.225;
export const WATER_DENSITY = 1000;

export const PHYSICS_HZ = 120;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
export const MAX_SUBSTEPS = 8;

export const MASS = 1800;

/** Principal moments of inertia (kg m²) about body X (pitch), Y (yaw) and Z (roll). */
export const INERTIA = {
  pitch: 15_000,
  yawSpread: 20_000,
  yawFolded: 15_500,
  rollSpread: 6_500,
  rollFolded: 2_400,
} as const;

export const WING = {
  areaSpread: 90,
  areaFolded: 20,
  spanSpread: 24,
  spanFolded: 8,
  /** Profile drag of the membrane per m² of wing. */
  cd0: 0.022,
  oswald: 0.8,
  /** Camber lift at zero angle of attack. */
  cl0: 0.15,
  /** Soft ceiling of the attached-flow lift curve (the real peak lands at ~1.5). */
  clCeiling: 1.56,
  clFloor: -0.95,
  stall: 19 * DEG,
  stallWidth: 6 * DEG,
  negStall: -12 * DEG,
  negStallWidth: 6 * DEG,
  incidence: 2 * DEG,
  membraneEfficiency: 0.85,
  /** Flat-plate normal force coefficient once the flow is separated. */
  separatedNormal: 1.8,
  separationTau: 0.05,
  reattachTau: 0.3,
  sweepAreaLoss: 0.12,
  /** Wing root height above the center of mass (ground effect reference). */
  rootHeight: 0.6,
} as const;

export const BODY = {
  /** Body + rider + tucked legs + tail drag area (m²). */
  cdA: 1.6,
  legsCdA: 0.8,
  /** Extra drag of folded wing bundles (fully folded). */
  foldedBundleCdA: 1.5,
  /** Membrane cupped against the flow while braking (m²). */
  brakeCdA: 20,
  sideArea: 18,
  sideForceSlope: -0.9,
} as const;

export const MOMENTS = {
  pitchStability: 0.6,
  alphaTrim: 4 * DEG,
  pitchDamping: 6,
  weathervane: 0.12,
  tailArm: 5,
  yawDamping: 0.08,
  dihedral: 0.05,
  rollDamping: 0.3,
  /** Control authority coefficients (muscles, wing warping, tail) scaled by dynamic pressure. */
  controlPitch: 0.5,
  controlYaw: 0.035,
  controlRoll: 0.25,
  /** Differential flapping authority (fraction of weight * arm), works at zero airspeed. */
  flapPitch: 0.35,
  flapYaw: 0.25,
  flapRoll: 0.5,
  flapArm: 3,
  /** Rate-loop bandwidths (1/s). */
  gainPitch: 10,
  gainYaw: 8,
  gainRoll: 14,
  maxAngularSpeed: 4.5,
} as const;

export const FLAP = {
  freqMin: 1.1,
  freqMax: 1.8,
  freqHoverBonus: 0.1,
  /** Mean flapping force at full effort as a fraction of weight: forward flight vs hover stroke. */
  forwardRatio: 0.55,
  hoverRatio: 1.2,
  /** Propulsive efficiency falls off as 1 / (1 + (V / speedFalloff)^2). */
  speedFalloff: 55,
  strokeAngle: 18 * DEG,
  hoverStrokeAngle: 62 * DEG,
  effortExponent: 1.2,
  /** Force profile over the cycle: longer, loaded downstroke; weights give a cycle mean of 1. */
  downstrokeFraction: 0.56,
  downstrokeWeight: (2 - 0.6 * 0.44) / 0.56,
  upstrokeWeight: 0.6,
  riseTau: 0.18,
  fallTau: 0.4,
  ampTau: 0.25,
} as const;

export const STAMINA = {
  drain: 0.022,
  hoverExtra: 1.2,
  fire: 0.012,
  regenAir: 0.03,
  regenGround: 0.1,
  regenWater: 0.05,
  tiredBelow: 0.03,
  recoverAbove: 0.2,
  tiredEffortCap: 0.35,
} as const;

export const ENVELOPE = {
  cruiseSpeed: 32,
  maxBank: 65 * DEG,
  /** Bank added by full rudder (Q/E) so yaw input gives a flat, coordinated turn. */
  rudderBank: 0.3,
  /** Sideslip commanded by full rudder. */
  rudderSideslip: 8 * DEG,
  autoLevelRollRate: 0.5,
  /** Auto-level roll rate once past knife-edge (recovering from inverted). */
  invertedRollRate: 1.6,
  maxRollRate: 1.95,
  maxPitchRate: 50 * DEG,
  /** Assisted pitch attitude limit (stick and dive never pass it). */
  maxPitchAttitude: 70 * DEG,
  /** Steepest flight path the idle hold keeps after the stick is released. */
  maxHoldPath: 45 * DEG,
  /** Flight path held by a hands-off folded-wing dive. */
  divePath: -60 * DEG,
  maxLoadFactor: 5,
  /** Assisted push-over limit (rider stays in the saddle). */
  minLoadFactor: -0.5,
  stallProtect: 20.5 * DEG,
  /** Lift coefficient used to estimate the stall speed for the low-speed protection. */
  clMaxProtect: 1.45,
  /** Protected minimum speed as a multiple of the stall speed at the current turn load factor. */
  minSpeedFactor: 1.3,
  /** Extra climb angle allowed per m/s above the protected minimum speed (zoom climbs). */
  zoomGain: 0.035,
  /** Look-ahead (s) on the speed trend for the low-speed protection. */
  speedLead: 0.8,
  /** Bank is limited so the turn load factor needs no more than (V / (this x Vs1))². */
  bankSpeedFactor: 1.25,
  hoverEnterSpeed: 15.5,
  landingMaxSpeed: 16,
  landingMaxAgl: 4,
  boundarySoft: 22_500,
  boundaryHard: 24_000,
  /** Absolute position clamp for every mode (inside the 48 km world). */
  boundaryClamp: 23_900,
  ceilingFade: 300,
} as const;

/** Ground-proximity assist: clearances (m, lowest body point above the surface) and look-ahead times (s). */
export const PROXIMITY = {
  idleLand: 18,
  idleWater: 6,
  pilotLand: 1.5,
  pilotWater: -0.3,
  diveLand: 8,
  diveWater: 2,
  idleHorizon: 3,
  lookahead: [0.8, 1.7, 2.8] as readonly number[],
  sampleInterval: 0.05,
  /** Lower wingtip must stay this far above the surface when banking. */
  wingtipMargin: 1,
  /** Wingtip clearance kept at the bottom of the downstroke (limits the stroke amplitude). */
  strokeMargin: 0.6,
  /** Smallest stroke amplitude the near-surface limit may shrink the beat to (the bank limits assume it). */
  minAmplitudeCruise: 0.25,
  minAmplitudeHover: 0.2,
} as const;

/**
 * Wingtip position at the bottom of the downstroke relative to the center of mass, measured on the dragon rig
 * (24 m span): height = base + flareRaise·f - (drop - flareRelief·f)·amplitude, fore-aft = -(fwd + fwdFlare·f)
 * - (fwdStroke + fwdStrokeFlare·f)·amplitude, lateral ≈ 0.46 span; f = flare (−sweep, 0..1).
 */
export const WINGTIP = {
  referenceSpan: 24.1,
  base: 1.9,
  flareRaise: 2.9,
  drop: 6.8,
  flareRelief: 1.9,
  fwd: 0.1,
  fwdFlare: 3.8,
  fwdStroke: 2.6,
  fwdStrokeFlare: 2.5,
  lateral: 0.46,
} as const;

/**
 * Hover: brake (Ctrl/X) to a stop, then it holds until the pilot flies out. W/S creep forward/back while the brake
 * is held, A/D turn on the spot, Q/E strafe, Space/Shift climb/descend; W with the brake released flies out.
 */
export const HOVER = {
  climb: 4,
  descend: -5,
  /** Forward creep (m/s) with W while braking. */
  creep: 4,
  back: 3,
  strafe: 4,
  yawRate: 0.8,
  /** Hover attitude (body pitch with a horizontal stroke plane). */
  attitude: 28 * (Math.PI / 180),
  /** Largest nose-down tilt below the hover attitude (rad) for translating / holding against wind. */
  maxForwardTilt: 0.62,
  maxBackTilt: 0.3,
  /** Height hold of the idle hover (1/s). */
  heightGain: 0.6,
  /** Final landing descent: turn into the mean wind at up to this yaw rate (rad/s). */
  weathervaneRate: 0.5,
  /** Below this foot clearance over land an idle hover settles into a landing. */
  settleClearance: 15,
} as const;

/**
 * Assisted landing (L): a steep braked approach, a decisive flare and a short settle; ~7 s from 45 m.
 * Heights are foot clearances (m), speeds m/s, paths rad.
 */
export const LANDING = {
  /** Approach speed schedule: approachSpeed + clearance × perMetre, clamped. */
  approachSpeed: 15,
  approachSpeedPerMetre: 0.1,
  approachSpeedMin: 17,
  approachSpeedMax: 26,
  /** Approach glide slope: −(pathBase + clearance / pathReach), clamped to [pathMin, pathMax]. */
  pathBase: 0.25,
  pathReach: 130,
  pathMin: 0.3,
  pathMax: 0.65,
  /** Pitch rate (rad/s) of the push-over onto the glide slope. */
  approachPitchRate: 0.8,
  /** The flare starts at flareBase + flarePerSink × sink rate + flarePerSpeed × ground speed (clamped), or when slow. */
  flareBase: 1,
  flarePerSink: 0.55,
  flarePerSpeed: 0.1,
  flareMin: 6,
  flareMax: 16,
  flareSpeed: 13,
  /** Largest nose-up tilt beyond the hover attitude while fast in the flare (rad) and its gain per m/s of excess speed. */
  flareBackTilt: 0.72,
  flareGain: 0.1,
  /** Extra nose-up tilt (rad) while the ground speed is still high a few metres up (tailwind). */
  groundSpeedBackTilt: 0.25,
  /** Nose-up tilt allowed over the hover attitude on touchdown (rad): the stroke stays nearly vertical. */
  touchdownBackTilt: 0.12,
  /** Airspeed (m/s) below which the flare's deep tilt is gone (full from 5 m/s above it). */
  flareTiltFadeSpeed: 9,
  /** Flap effort already running as the flare slows through ~12 m/s. */
  flareEffort: 0.6,
  /** Settle: sink rate sqrt(touchdownSink² + 2 × settleDecel × clearance), capped at maxSink; forward creep up to touchdownSpeed. */
  settleDecel: 1.6,
  touchdownSink: 0.7,
  maxSink: 5,
  touchdownSpeed: 6,
  /** Above this ground speed the last 2 m stop sinking until the flare has slowed the dragon (the feet run off less). */
  holdSpeed: 12,
  /** Lift dump in the fast flare: wing spread given up (0..1) once the vertical speed rises to liftDumpVy (m/s). */
  liftDump: 0.45,
  liftDumpVy: 0,
  /** Pitch rate limit (rad/s) while rearing up into the fast flare. */
  flarePitchRate: 1.5,
  /** Mean wind at the dragon (m/s) from which the settle turns into the wind (full turn rate at vaneWindFull). */
  vaneWindMin: 9.5,
  vaneWindFull: 12,
} as const;

export const GROUND = {
  walkSpeed: 3.5,
  runSpeed: 9,
  backSpeed: 1.5,
  turnRate: 0.9,
  maxStep: 1.4,
  dropToFall: 2.2,
  strideWalk: 3.4,
  strideRun: 7.5,
  leapUp: 5.5,
  leapForward: 3,
} as const;

export const SWIM = {
  floatDepth: 0.35,
  paddleSpeed: 2.6,
  fastSpeed: 4.5,
  turnRate: 0.6,
  leapUp: 4.5,
  leapForward: 2,
} as const;

/** Body collision spheres as fractions of the rig length (x, y, z, radius). */
export const BODY_SPHERES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, -0.1, 0.09],
  [0, 0, 0.14, 0.08],
  [0, 0.04, -0.42, 0.05],
  [0, -0.01, 0.4, 0.045],
];

export const DEFAULT_RIG_LENGTH = 18;
export const DEFAULT_RIG_HEIGHT = 4;
