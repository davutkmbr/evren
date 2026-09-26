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
  /** Below pilotLand with the stick pushed: the floor climbs by pilotLandGain rad per metre missing, up to pilotLandClimb. */
  pilotLandGain: 0.12,
  pilotLandClimb: 0.15,
  /** Over land the stick's push fades out over this much flight path (rad) above the floor. */
  pilotFloorSoften: 6 * DEG,
  pilotWater: -0.3,
  diveLand: 8,
  diveWater: 2,
  idleHorizon: 3,
  lookahead: [0.8, 1.7, 2.8] as readonly number[],
  sampleInterval: 0.05,
  /**
   * Overhead structures (bridge decks, arches, overhangs): height of the raised wings above the center of mass and
   * the safety margin kept below a ceiling. Anything reaching down into that band along the path is an obstacle to
   * climb over; anything entirely above it is a ceiling to pass under.
   */
  headroom: 5,
  ceilingMargin: 3,
  /**
   * Clearance the assist keeps between the raised wings and a ceiling it flies under; larger than ceilingMargin so
   * a dragon held there does not flicker between "pass under" and "climb over".
   */
  ceilingKeep: 6,
  /** Least clearance (lowest body point above the floor) a gap under a ceiling must leave to fly through it. */
  passClearance: 2,
  /**
   * Far look-ahead (hands-off only): tall obstacles (towers, cliffs) beyond the near samples. The track is scanned
   * from the last near sample out to clamp(max(V × farTime, climb needed / tan(farPlanPath)), farMin, farMax) m at
   * farSamples evenly spaced points, farPerUpdate of them per look-ahead refresh (a full sweep every few refreshes).
   */
  farTime: 14,
  farMin: 150,
  farMax: 600,
  farSamples: 20,
  farPerUpdate: 5,
  /** Climb angle the far look-ahead plans with when sizing its reach (rad). */
  farPlanPath: 12 * DEG,
  /**
   * Climb angle to an obstacle's top (plus the hands-off clearance) at which the far samples start to lift the held
   * path, and where they lift it fully: gentler slopes (rolling hills) are left to the near look-ahead, so cruising
   * over terrain keeps its height.
   */
  farIgnorePath: 6 * DEG,
  farFullPath: 10 * DEG,
  /**
   * Climb angle beyond which an obstacle cannot be out-climbed once the dragon's own climb has fallen short of it by
   * farTurnLag for farTurnDelay s: the dragon also turns toward the side with more free space (two probes along
   * headings farProbeAngle to either side), up to farTurnBank at farTurnFullPath.
   */
  farTurnPath: 13 * DEG,
  farTurnLag: 4 * DEG,
  farTurnDelay: 1,
  farTurnFullPath: 20 * DEG,
  farTurnBank: 35 * DEG,
  farProbeAngle: 25 * DEG,
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
  /**
   * The flare starts at (flareBase + LANDING_STYLE.flarePerSink × sink rate + flarePerSpeed × ground speed) × the
   * variant's flareScale, no lower than flareMin (and the variant's own limits), or when slower than flareSpeed.
   */
  flareBase: 1,
  flarePerSpeed: 0.1,
  flareMin: 6,
  flareSpeed: 13,
  /** Gain per m/s of excess speed of the flare's nose-up tilt (the largest tilt is the variant's flareBackTilt). */
  flareGain: 0.1,
  /** Extra nose-up tilt (rad) while the ground speed is still high a few metres up (tailwind). */
  groundSpeedBackTilt: 0.25,
  /** Nose-up tilt allowed over the hover attitude on touchdown (rad): the stroke stays nearly vertical. */
  touchdownBackTilt: 0.12,
  /** Airspeed (m/s) below which the flare's deep tilt is gone (full from 5 m/s above it). */
  flareTiltFadeSpeed: 9,
  /** Flap effort already running as the flare slows through ~12 m/s. */
  flareEffort: 0.6,
  /** Deepest sink (m/s) of the flare while high or still fast (the settle profile: LANDING_STYLE.touchdownSink / settleDecel). */
  maxSink: 5,
  /** Above this ground speed the last 2 m stop sinking until the flare has slowed the dragon (the feet run off less). */
  holdSpeed: 12,
  /** Lift dump in the fast flare (LANDING_STYLE.liftDump of the spread) once the vertical speed rises to liftDumpVy (m/s). */
  liftDumpVy: 0,
  /** Pitch rate limit (rad/s) while rearing up into the fast flare. */
  flarePitchRate: 1.5,
  /** Mean wind at the dragon (m/s) from which the settle turns into the wind (full turn rate at vaneWindFull). */
  vaneWindMin: 9.5,
  vaneWindFull: 12,
} as const;

/** Per-variant shape of a landing (landing.ts). */
export interface LandingVariantParams {
  /** Approach glide slope × pathScale, clamped to pathMax (rad). Run-out variants: the steepest approach path (rad). */
  pathScale: number;
  pathMax: number;
  /** Flare height × flareScale (the slow landing's flare trigger), clamped to [flareMin, flareMax] (m). */
  flareScale: number;
  flareMin: number;
  flareMax: number;
  /** Largest nose-up tilt beyond the hover attitude while fast in the flare (rad). */
  flareBackTilt: number;
  /** Flap effort held through the backstrokes while the ground speed is still above the touchdown speed. */
  beatEffort: number;
  /** Side-to-side weave: bank amplitude (rad) and period range (s). */
  weave: number;
  weavePeriod: readonly [number, number];
  /** A final shallow turn onto the spot: bank (rad) and length (s); 0 = none. */
  turnBank: number;
  turnTime: number;
  /** Braking beats (checks) during the approach: seconds between them (range), 0 = none. */
  checkEvery: readonly [number, number];
  /** Sloppiness 0..1: jitter of the beats' effort and timing, looser weave. */
  sloppy: number;
  /** Run-out variants: the backstroke is kicked off at the latest this long (s) after the flare began. */
  kickLate: number;
}

/**
 * Landing v2: an approach and flare that read as a big flying animal, not a gliding aeroplane (landing.ts, the landing
 * laws in controller.ts, pose cues in pose.ts). A variant is picked when L is pressed (by context and a seeded random,
 * never the same twice in a row): a steep drop-in with a big flare from higher up, a low shallow approach with a weave,
 * a tired one with sloppier beats at low stamina, and for the run-out a flat glide or a steeper swoop. The speed curve
 * comes from the flight model: checks (a nose-up pulse, the airbrake and one deep beat) and the flare's backstrokes
 * (body pitched far back, the stroke force pointing up and back) are real forces.
 */
export const LANDING_STYLE = {
  seed: 4127,
  /** Stamina below which the tired landing applies. */
  tiredStamina: 0.3,
  /** Foot clearance at L from which the steep drop-in applies (m); the shallow approach below shallowMaxHeight. */
  dropMinHeight: 22,
  shallowMaxHeight: 45,
  /**
   * Approach path shape over the progress p (0 at L, 1 at the flare): the glide slope × a factor rising from shapeStart
   * to shapePeak at p = peakAt and falling to shapeEnd at the flare (sine / cosine quarter waves) — the drop is steepest
   * in the middle and rounds out towards the flare.
   */
  shapeStart: 0.9,
  shapePeak: 1.3,
  shapeEnd: 0.85,
  peakAt: 0.45,
  /**
   * Checks: the path pulled up to checkPath (rad, a slight climb) over checkTime (s) at up to checkPitchRate (rad/s),
   * airbrake on, one deep beat at checkEffort with the stroke tilted forward (checkHover) once the nose is up.
   */
  checkPath: 0.08,
  checkTime: 1.1,
  checkEffort: 0.85,
  checkHover: 1,
  checkPitchRate: 1.3,
  /** No checks, weave or turn below this foot clearance (m) or within this clearance of the flare height. */
  quietBelow: 12,
  quietAboveFlare: 3,
  /** The run-out approach flies low from the start: its checks and weave go on down to this foot clearance (m). */
  runOutQuietBelow: 3.5,
  /** Wing sweep / spread breathing during the approach (seeded slow waves): amplitude of each. */
  sweepWave: 0.18,
  spreadWave: 0.06,
  /** The slow landing's touchdown ground speed (m/s): the backstrokes nearly stop the dragon (W / S adjust it). */
  touchdownSpeed: 2.2,
  /** The slow landing's sink profile: sqrt(touchdownSink² + 2 × settleDecel × clearance) (m/s), gentler than LANDING's. */
  touchdownSink: 0.25,
  settleDecel: 1,
  /** ... and no faster than nearSink + nearSinkPerMetre × clearance: the last metre is nearly a hover (the beat's bob stays small). */
  nearSink: 0.55,
  nearSinkPerMetre: 0.7,
  /** Extra force of the cushioning beats in the last cushionHeight metres (fraction). */
  cushionBoost: 0.35,
  cushionHeight: 2.5,
  /** Largest sink-hold integral (effort) of the hover law in the last metre (it winds up while the flare lags its profile). */
  nearIntegral: 0.02,
  /** Deepest sink (m/s) of the slow landing's final descent once the ground speed is down (full LANDING.maxSink from 10 m/s). */
  slowMaxSink: 3.2,
  /** The slow flare starts at (LANDING.flareBase + flarePerSink × sink + LANDING.flarePerSpeed × ground speed) × the variant's scale (m). */
  flarePerSink: 0.65,
  /**
   * Flare: the backstrokes start as the body pitches through rearedFrom..rearedFull (rad); until then, still fast, the
   * effort stays at most rearEffort unless a fast sink needs arresting (the wing's lift does the rest).
   */
  rearedFrom: 18 * DEG,
  rearedFull: 38 * DEG,
  rearEffort: 0.3,
  /** The slow flare's lift dump (spread given up while it stops sinking at speed): small, the wings stay forward and open. */
  liftDump: 0.18,
  /** While the ground speed is still well above the touchdown speed the flare sinks no faster than this (m/s). */
  floatSink: 1.4,
  /** Dust from the downwash of a backstroke below this foot clearance (m) over land. */
  dustHeight: 9,
  /** Sink (m/s) below which feet close to the ground count as a touchdown (faster: only on contact, 2 cm). */
  touchSink: 1.2,
  /** ... below this ground speed (m/s) ... */
  touchSpeed: 3,
  /** ... and how close (m): the legs reach down the rest (the stance's settle takes it without a jump). */
  touchReach: 0.6,
  /** Leg flex on contact: the settle starts this much faster downward (m/s) as the wings unload onto the legs. */
  absorbExtra: 1,
  /** Run-out flare: from runOutFlareHeight × the variant's flareScale (m) the body pitches back and the wings backstroke. */
  runOutFlareHeight: 1.7,
  /** Run-out round-out: sink RUNOUT.touchdownSink + runOutRoundOut × clearance (m/s), earlier than stage A's float. */
  runOutRoundOut: 0.45,
  /** Run-out flare sink target: runOutFlareSink + runOutFlareSinkPerMetre × clearance (m/s), and its lift dump (spread given up). */
  runOutFlareSink: 0.7,
  runOutFlareSinkPerMetre: 0.45,
  runOutLiftDump: 0.35,
  /** The run-out's backstrokes start as the body pitches through these (rad). */
  runOutRearedFrom: 8 * DEG,
  runOutRearedFull: 18 * DEG,
  /** ... at least one: a downstroke kicked off at this share of the way up (or after the variant's kickLate), at full beat effort for runOutKickTime (s). */
  runOutKickAt: 0.15,
  runOutKickTime: 0.45,
  /** The run-out flare pitches back less while fast: runOutPitchPerSpeed (rad per m/s) above runOutPitchSpeed (m/s). */
  runOutPitchPerSpeed: 1.6 * DEG,
  runOutPitchSpeed: 14,
  /** ... and less while it sinks slower than wanted (rad per m/s): a balloon is caught by easing the nose forward. */
  runOutPitchPerClimb: 0.3,
  /** The run-out flare may begin this much faster than RUNOUT.maxSpeed (m/s): it bleeds that much itself. */
  runOutFlareBleed: 2,
  variants: {
    drop: {
      pathScale: 1.3,
      pathMax: 0.85,
      flareScale: 1.35,
      flareMin: 9,
      flareMax: 12,
      flareBackTilt: 0.78,
      beatEffort: 0.8,
      weave: 0,
      weavePeriod: [3, 4],
      turnBank: 24 * DEG,
      turnTime: 1.8,
      checkEvery: [2, 2.8],
      sloppy: 0,
      kickLate: 0,
    },
    shallow: {
      pathScale: 1,
      pathMax: 0.55,
      flareScale: 1,
      flareMin: 6.5,
      flareMax: 14,
      flareBackTilt: 0.62,
      beatEffort: 0.72,
      weave: 9 * DEG,
      weavePeriod: [2.8, 3.8],
      turnBank: 0,
      turnTime: 0,
      checkEvery: [2.6, 3.4],
      sloppy: 0,
      kickLate: 0,
    },
    tired: {
      pathScale: 1,
      pathMax: 0.65,
      flareScale: 1.1,
      flareMin: 6.5,
      flareMax: 16,
      flareBackTilt: 0.55,
      beatEffort: 0.7,
      weave: 6 * DEG,
      weavePeriod: [2.2, 3.4],
      turnBank: 0,
      turnTime: 0,
      checkEvery: [2.2, 3.4],
      sloppy: 1,
      kickLate: 0,
    },
    glide: {
      pathScale: 1,
      pathMax: 9 * DEG,
      flareScale: 0.85,
      flareMin: 0,
      flareMax: 0,
      flareBackTilt: 0,
      beatEffort: 0.6,
      weave: 3 * DEG,
      weavePeriod: [3, 4],
      turnBank: 0,
      turnTime: 0,
      checkEvery: [1.2, 1.8],
      sloppy: 0,
      kickLate: 0.12,
    },
    swoop: {
      pathScale: 1,
      pathMax: 13 * DEG,
      flareScale: 1.2,
      flareMin: 0,
      flareMax: 0,
      flareBackTilt: 0.1,
      beatEffort: 0.75,
      weave: 0,
      weavePeriod: [3, 4],
      turnBank: 0,
      turnTime: 0,
      checkEvery: [1.1, 1.6],
      sloppy: 0,
      kickLate: 0.3,
    },
  } satisfies Record<string, LandingVariantParams>,
} as const;

/** Landing v2 pose cues (pose.ts; the rig reads DragonPose.landFlare). Angles in rad. */
export const LANDING_POSE = {
  /** Approach: the head looks lookBelowPath under the flight path (clamped), with lookGain of it in the neck, the neck undoing lookPitchCounter of the body pitch. */
  lookBelowPath: 0.1,
  lookMin: 0.12,
  lookMax: 0.95,
  lookGain: 0.75,
  lookPitchCounter: 0.7,
  /** Neck yaw into the weave / final turn per rad of bank. */
  lookIntoTurn: 0.7,
  /** Flare: neck pitch neckFlare − neckFlareCounter × body pitch, allowed down to −neckLowFlare. */
  neckFlare: -0.12,
  neckFlareCounter: 0.95,
  neckLowFlare: 0.9,
  /** Tail: yaw per rad/s of the style's bank rate (steering), a slow wander, lowered by tailBrake × airbrake; the flare's tail pitch. */
  tailSteer: 0.35,
  tailWander: 0.06,
  tailBrake: 0.2,
  tailFlare: 0.4,
  /** Legs reach forward from this foot clearance (m) in the flare. */
  reachFrom: 10,
  /** Rate (1/s) at which the flare cue fades after the touchdown (the wings fold over ~0.6 s). */
  flareFade: 3,
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
  leapUp: 8,
  leapForward: 4,
  /** Crouch before the leap (s): the dragon rears a little and raises its wings for the first big downstroke. */
  leapCrouch: 0.3,
  leapRear: 0.09,
  /**
   * Stance geometry shared with the rig: fore-aft distance (m) of the hind feet behind and of the fore feet (the
   * wing wrists) ahead of the centre of mass. A body pitched nose-up stands on its hind feet, nose-down on its fore
   * feet, so the centre of mass sits standHeight·cos θ + z·|sin θ| above the ground.
   */
  hindFootZ: 1.85,
  foreFootZ: 2.55,
  /** Touchdown settle: spring (1/s, damping ratio) that brings the landing pitch and sink into the stance. */
  settleOmega: 6.5,
  settleZeta: 0.95,
  /** Deepest the legs give on a touchdown (m below the standing height). */
  settleCompress: 0.45,
} as const;

/**
 * Ground gaits. The stride frequency follows the speed (table, linear in between); the rig plants each foot for a
 * sweep its legs can reach, so the stance time shrinks with speed. Gait blend: 0 walk (lateral sequence), 1 trot,
 * 2 gallop (hind pair, then the fore pair, with suspension phases at speed).
 */
export const GAIT = {
  cadenceSpeeds: [0, 3.5, 6, 9, 14, 22] as readonly number[],
  cadenceHz: [0.6, 1.05, 1.3, 1.45, 1.6, 1.8] as readonly number[],
  trotFrom: 4.3,
  trotTo: 5.5,
  gallopFrom: 7,
  gallopTo: 8.5,
} as const;

/**
 * Run-out landing ("koşarak iniş"): a shallow, fast touchdown on walkable ground turns into a decelerating run
 * that stops (Ctrl/X brakes harder), steers (A/D) or flies out again (Space, or W pressed with speed: touch-and-go).
 * Speeds m/s, decelerations m/s², heights m (foot clearance), times s.
 */
export const RUNOUT = {
  /** Touchdown ground speed from which the dragon runs the landing out (slower: the normal settle). */
  minSpeed: 8,
  /** Fastest touchdown the legs take; faster contacts skid until below it. */
  maxSpeed: 22,
  /** Hardest sink (m/s) a running touchdown takes. */
  maxSink: 6,
  /* Approach: L pressed fast and low over land flies a shallow approach instead of the steep braked one + flare. */
  approachMinSpeed: 14,
  approachMaxHeight: 25,
  /** Steepest glide path of the approach (rad). */
  approachPath: 10 * DEG,
  /** Airbrake speed schedule: touchdownSpeed + clearance × approachSpeedPerMetre. */
  touchdownSpeed: 17,
  approachSpeedPerMetre: 0.9,
  /** Sink-rate profile of the round-out: touchdownSink + roundOutGain × clearance (m/s). */
  touchdownSink: 0.9,
  roundOutGain: 0.5,
  /** Still faster than maxSpeed this low: float at this clearance until the airbrake has taken the speed out. */
  floatHeight: 1.2,
  /* The run. */
  decel: 3.2,
  /** Drag of the half-open wings and body: extra deceleration per (m/s)². */
  dragPerV2: 0.004,
  /** Ctrl/X: skid, claws dig, wings flared as air brakes; the skid comes in at skidRate (1/s), sat back skidPitch. */
  brakeDecel: 7.5,
  skidRate: 5,
  skidPitch: 6 * DEG,
  /** The run-out ends (ordinary walking / running) below this speed or the pilot's own target speed. */
  endSpeed: 3,
  turnRate: 0.75,
  /** Lean into a turn at speed (rad at full A/D). */
  lean: 9 * DEG,
  /** Nose-up of the first, hind-legged strides (rad), and how long they last at least (s). */
  pitchUp: 7 * DEG,
  foreDelay: 0.35,
  /** Wings: half open for balance above openSpeed, folded (fore feet down) below foldSpeed. */
  openSpeed: 15,
  foldSpeed: 10,
  /* Fly-out (touch-and-go): a two-beat run-up and a leap straight back into flight. */
  flyOutMinSpeed: 8,
  flyOutGather: 0.32,
  flyOutPush: 0.12,
  flyOutUp: 4.5,
  /** Gather of the fly-out: a slight dip (m) and the pitch through it and at lift-off (rad). */
  flyOutDepth: 0.12,
  flyOutCrouchPitch: 3 * DEG,
  flyOutPushPitch: 11 * DEG,
  /** Fraction of the ground speed kept through the leap. */
  flyOutKeep: 0.97,
  /* The path ahead (edge, water, obstacle): looked at lookTime × speed + lookMin m ahead; leaps on its own. */
  lookTime: 0.7,
  lookMin: 4,
  autoLeapMinSpeed: 6,
  autoGather: 0.14,
} as const;

/**
 * Leaping take-off ("sıçrayarak kalkış"): a crouch (chest low, wings raised high and back, tail down), a push-off
 * that ramps the velocity up through the legs (hind first, the fore legs a beat later), then full downstrokes from
 * lift-off with the legs tucked only after tuckBeats strokes. Variants are picked by context and never repeat when
 * several apply. Times s, speeds m/s, depths m, angles rad.
 */
export const LEAP = {
  /* Standing: straight up. */
  crouch: 0.7,
  crouchDepth: 0.85,
  crouchPitch: -10 * DEG,
  push: 0.2,
  pushPitch: 18 * DEG,
  up: 12,
  forward: 4,
  /* Standing: a forward bound. */
  boundCrouch: 0.6,
  boundDepth: 0.7,
  boundPush: 0.19,
  boundUp: 10,
  boundForward: 8,
  boundPitch: 12 * DEG,
  /* From a walk or run: blends into the stride. */
  runMinSpeed: 2.5,
  runCrouch: 0.16,
  runDepth: 0.2,
  runPush: 0.13,
  runUp: 6.5,
  runForward: 2.5,
  runCrouchPitch: -2 * DEG,
  runPushPitch: 12 * DEG,
  /* Off an edge or a roof: a short hop, the wings snap open, a dive to gain speed. */
  dropMin: 5,
  dropLook: [3, 5.5, 8] as readonly number[],
  dropCrouch: 0.26,
  dropDepth: 0.3,
  dropPush: 0.14,
  dropUp: 2.5,
  dropForward: 6,
  dropCrouchPitch: -7 * DEG,
  dropPushPitch: 4 * DEG,
  dropDive: -20 * DEG,
  dropTime: 0.8,
  /* Tired (low stamina): slower, weaker, an extra stroke before the legs tuck. */
  tiredCrouch: 0.85,
  tiredDepth: 0.55,
  tiredPush: 0.23,
  tiredUp: 7,
  tiredForward: 3,
  tiredPushPitch: 12 * DEG,
  tiredEffort: 0.75,
  tiredBoostTime: 2.2,
  /** Downstrokes before the legs tuck (tired: one more). */
  tuckBeats: 2,
  /** Forward-reaching stroke of the first beats (wing sweep): full amplitude with the tips clear of the ground. */
  strokeSweep: -0.6,
  /** Seed of the variant picker. */
  seed: 2027,
} as const;

export const SWIM = {
  /** Depth of the centre of mass below the body-averaged wave surface (m): the waterline runs along the back. */
  floatDepth: 0.6,
  /** Swim speeds (m/s): W and W + Shift. The wings row a big body: brisker than a swan, a pedal boat at full stroke. */
  paddleSpeed: 5,
  fastSpeed: 8.5,
  turnRate: 0.6,
  leapUp: 4.5,
  leapForward: 2,
} as const;

/**
 * Swimming at the surface (locomotion.ts drives it, pose.ts turns it into DragonPose.swim / swimPhase / swimStroke,
 * the animator shapes the rig with its SWIM_RIG). The dragon floats low with the head and neck raised and swims like a
 * big animal: a travelling wave from the shoulders down the tail, the wings paddling alternately (left wing's catch at
 * swimPhase 0, the right one's at pi), the chest surging and lifting with each power stroke, the hind legs kicking.
 * Speeds m/s, times s, frequencies Hz, angles rad.
 */
export const SWIM_POSE = {
  /** Stroke cycle frequency (one wave of body and tail, one stroke of each wing): idle + per m/s; Shift multiplies it. */
  freqIdle: 0.2,
  freqPerSpeed: 0.07,
  fastFreq: 1.05,
  /** Stroke strength 0..1: the idle sway, the strength at paddle speed, and with Shift. */
  strokeIdle: 0.22,
  strokePaddle: 0.7,
  strokeFast: 1,
  /** Rate (1/s) at which the stroke strength follows the swim speed. */
  strokeRate: 1.6,
  /**
   * Surge: each wing's power stroke pushes the body forward, so the speed through the water swings by this share of the
   * swim speed (± amplitude, two surges per cycle, zero mean: the average speed is unchanged). surgePhase is the stroke
   * phase (rad) of the left wing's peak thrust (its mid power stroke); the right wing's comes half a cycle later.
   */
  surge: 0.14,
  surgePhase: 1.35,
  /** Rate (1/s) at which the swim posture blends in (a landing settles into the float) and out. */
  blendIn: 2.2,
  blendOut: 5,
  /**
   * Settling into the float (a landing onto the water, surfacing from a plunge): for settleTime the body sinks no
   * faster than settleSink (m/s) and levels out at settleAlign (1/s) instead of flopping flat.
   */
  settleTime: 1.5,
  settleSink: 2,
  settleAlign: 1.6,
  /**
   * Riding the bow wave: with speed (0 at rest, 1 at SWIM.fastSpeed) the body rises this far (m) in the water and trims
   * this much nose-up (rad), like a duck pushing on.
   */
  speedRise: 0.12,
  speedTrim: 0.035,
  /** Neck raise (pose neckPitch, + = up) while floating, and extra with the stroke (the head pushes forward). */
  neckRaise: 0.55,
  neckStroke: -0.1,
  /**
   * Tail: carried at the surface (pitch, + = down; slightly lifted so the sweeping tail shows at the waterline) and how
   * far it trails into a turn (pose tailYaw per rad/s of turn rate).
   */
  tailPitch: -0.02,
  tailTurn: 0.6,
  /** Idle look-around: seconds between head turns (random within) and the largest turn (rad). */
  lookEvery: [3.5, 8] as const,
  lookYaw: 0.55,
  /**
   * Water take-off run (Space / L while swimming): the body rises onto the surface and speeds up with the wings
   * beating and slapping the water (a splash at each wingtip per downstroke), then leaps into the air.
   */
  runTime: 1.2,
  runSpeed: 11,
  runAccel: 7,
  runEffort: 0.95,
  /** Stroke amplitude limit through the run: the downstrokes slap the surface instead of plunging deep. */
  runAmplitude: 0.7,
  /** Leg kick frequency (Hz) through the run: the hind feet paddle the surface quickly. */
  runFreq: 1.5,
  runSpread: 0.85,
  /** Float depth (m) the running body rises to by the end of the run. */
  runRiseDepth: 0.05,
  /** Wingtip slap splash strength and lateral offset (fraction of the rig length). */
  runSlap: 0.35,
  runSlapSpan: 0.42,
  /**
   * Shore: swimming turns into wading (grounded, feet on the seabed) where the seabed is within the legs' reach,
   * standHeight + floatDepth - wadeMargin below the surface; wading turns back into swimming beyond
   * standHeight + floatDepth + floatMargin (hysteresis, so the switch never flickers).
   */
  wadeMargin: 0.3,
  floatMargin: 0.45,
  /*
   * Visible spray of the stroke (no sound events): the catch beside the shoulder, the lift-out behind it, the tail's
   * churn at a fast swim. Positions in rig lengths (lateral, forward); strengths scale with the stroke.
   */
  sprayMinStroke: 0.3,
  /** End of a wing's power stroke after its catch (rad): the rig's SWIM_RIG.paddlePower share of the cycle. */
  paddlePowerPhase: 0.45 * Math.PI * 2,
  sprayCatch: 0.45,
  sprayCatchOut: 0.26,
  sprayCatchForward: 0.12,
  sprayLift: 0.3,
  sprayLiftOut: 0.24,
  sprayLiftForward: -0.12,
  sprayTail: 0.35,
  sprayTailBack: 0.85,
} as const;

/**
 * Swimming in weather (phase 21 stage 6, locomotion.ts): how the floating dragon rides big waves and how rough seas
 * change its water take-off. Times s, angles rad, heights m (Hs = the local significant wave height of the water
 * service), stamina 0..1.
 */
export const SWIM_SEA = {
  /**
   * Rocking: the body's pitch and roll follow the plane through the wave surface under it (sampled over its length and
   * beam, so chop much shorter than the dragon hardly moves it) as a lightly damped oscillator with these natural
   * periods and damping ratio: long lodos waves (periods near and above the body's) rock it more than their slope,
   * short chop less. Bounded so the rider stays on top.
   */
  pitchPeriod: 2.8,
  rollPeriod: 3.4,
  damping: 0.3,
  maxPitch: 16 * DEG,
  maxRoll: 20 * DEG,
  /** Rate (1/s) at which the body follows the rocking attitude (after settling in). */
  alignRate: 10,
  /** The body's centre never sits deeper than floatDepth + dryMargin under the local surface (a crest lifts it). */
  dryMargin: 0.05,
  /** Rough sea for the take-off: 0 at roughLo, 1 at roughHi (local Hs, m). */
  roughLo: 0.3,
  roughHi: 2,
  /** The run lasts runTime x (1 + runLonger x rough), accelerates runAccelLoss less and costs extra stamina. */
  runLonger: 0.9,
  runAccelLoss: 0.3,
  runStamina: 0.12,
  /**
   * A wave crest helps the leap: once the run is crestMinRun x its calm length old, in a sea of at least crestMinHs,
   * the leap comes as soon as the body rides a crest (body-averaged surface above crestShare x Hs, not falling faster
   * than crestSink); the rising water adds crestLift x its vertical speed to the leap.
   */
  crestMinHs: 0.5,
  crestMinRun: 0.6,
  crestShare: 0.2,
  crestSink: 0.3,
  crestLift: 1,
  /**
   * Wave surfing: on a wave's front face (the surface falling away ahead) gravity along the slope pushes the swimming
   * dragon on (surfGain x g x slope, m/s²); the extra speed builds up while it stays on the face (a wave moving with it)
   * and bleeds away at surfDecay (1/s) behind the crest, up to surfMax m/s. From surfLo to surfHi m/s of it the dragon
   * rides: it eases off its stroke (surfEase), stretches its neck forward and down (surfNeck, rad), lifts its tail
   * (surfTail) and opens its jaw a little in delight (surfJaw); spray bursts off its chest every surfSprayEvery s.
   */
  surfGain: 1.3,
  surfDecay: 0.45,
  surfMax: 7,
  surfLo: 0.6,
  surfHi: 3,
  surfEase: 0.7,
  surfNeck: -0.18,
  surfTail: -0.12,
  surfJaw: 0.1,
  surfSpray: 0.5,
  surfSprayEvery: 0.3,
  surfSprayForward: 0.3,
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

/**
 * Tricks and rider-driven maneuvers (maneuvers.ts). Speeds m/s, clearances m (lowest body point above the surface),
 * times s, rates rad/s, accelerations rad/s², loads g.
 */
export const TRICKS = {
  /* Barrel roll (A / D double tap): a velocity-axis roll with the wings half folded. */
  rollRate: 6.2,
  rollAccel: 24,
  rollDecel: 22,
  rollSpread: 0.55,
  rollSweep: 0.45,
  rollMinSpeed: 22,
  rollMinClearance: 30,
  /** Extra revolutions stop once the clearance gets below this. */
  rollKeepClearance: 45,
  rollMaxRevolutions: 6,
  /** Angular speed limit while rolling (rad/s; otherwise MOMENTS.maxAngularSpeed keeps collision tumbles sane). */
  rollMaxSpin: 7.5,
  /** Control authority multipliers while rolling (pitch, yaw, roll). */
  rollAuthority: [5, 12, 4] as readonly [number, number, number],
  /* Loop (S double tap). */
  loopMinSpeed: 23,
  loopMinClearance: 60,
  /** A loop starts from roughly level flight (flight path within this, rad). */
  loopMaxEntryPath: 35 * (Math.PI / 180),
  /** Loop loads (g): the pull-up, over the top (inverted, into the saddle) and the pull-out. */
  loopLoad: 3.8,
  loopTopLoad: 2.6,
  loopExitLoad: 4,
  loopMaxLoad: 4.5,
  loopLiftBoost: 0.35,
  loopThrust: 1.2,
  loopMaxTime: 9,
  /* Free fall (Shift slow / hovering / double tap) and the catch (Shift released, Space). */
  dropMaxSpeed: 20,
  dropMinClearance: 35,
  /** A double-tapped drop lasts at least this long before releasing Shift catches. */
  dropMinTime: 1.1,
  /** Space catches a drop only after this long (the tap that started a flap must not end it at once). */
  dropSpaceDelay: 0.25,
  catchLoad: 2.6,
  /** Catch load at dive speed (from ~75 m/s). */
  fastCatchLoad: 3,
  urgentCatchLoad: 3.1,
  /** Falling room (m) a drop needs on top of the pull-out before it starts. */
  dropMinFall: 12,
  /** Seconds for the pull-out load to build (jerk limit: a firm but comfortable squeeze). */
  catchOnset: 0.3,
  /** Height kept in hand by the automatic catch (m) and the reaction time it assumes (s). */
  catchMargin: 22,
  catchDelay: 0.45,
  /** Longest catch (s), plus V / 25 (a dive-speed swoop takes longer). */
  catchMaxTime: 2.5,
  /** A released Shift dive this steep (rad), fast (m/s) and long (s) ends in a catch too. */
  diveCatchPath: -20 * (Math.PI / 180),
  diveCatchSpeed: 30,
  diveCatchTime: 0.6,
  /** Seconds the rider cheers after a finished trick. */
  cheer: 1.3,
  /** Refused-trick hints repeat at most this often (s). */
  hintInterval: 6,
} as const;

/**
 * Phase 20 stage B air moves (maneuvers.ts, skim.ts). Every move reports its end on the flight-internal 'maneuver'
 * event (`ended`, `clean`): clean = no contact, no stall, exit speed at least the entry speed − cleanTolerance.
 * Speeds m/s, times s, clearances m (lowest body point above the surface), angles rad, stamina 0..1.
 */
export const POWER_STROKE = {
  /** Two deep, full-amplitude downstrokes (Space double tap); the move ends after `beats` of them or maxTime. */
  beats: 2,
  maxTime: 1.2,
  /** Flap force multiplier of the strokes, faded out as the surge reaches entry speed + gain. */
  thrust: 2.6,
  gain: 5,
  /** Stamina the strokes cost up front, and the least stamina left for one (refused below, and while tired). */
  stamina: 0.07,
  minStamina: 0.12,
  /** Wing sweep of the strokes (negative = reaching forward: a deeper stroke). */
  sweep: -0.25,
  /** A new power stroke needs this long after the last one ended. */
  cooldown: 0.25,
  cleanTolerance: 1,
} as const;

export const DART = {
  /** Shift double tap faster than this (slower: the free fall, as before), from a flight path within maxEntryPath. */
  minSpeed: 30,
  maxEntryPath: 25 * DEG,
  maxEntryBank: 50 * DEG,
  /** Wings half folded (spread, sweep) for `time`, then open again over `open` on their own. */
  time: 1,
  open: 0.35,
  spread: 0.5,
  sweep: 0.8,
  foldRate: 5,
  /** Streamlined body (neck stretched, legs and tail in line): parasite drag multiplier while folded. */
  dragScale: 0.6,
  /** Shallow dive: flight path aimed for (rad), reached over pathTime; shallower below levelClearance + 8 m, level below it. */
  path: -15 * DEG,
  pathTime: 0.3,
  levelClearance: 4,
  /** Path gain (1/s) and load limits (g) of the push-over and the round-out. */
  pathGain: 3.5,
  minLoad: -0.2,
  maxLoad: 2,
  /** Bank A / D may steer with during the dart. */
  bank: 30 * DEG,
  /** Refused below this clearance (and ended early if it gets this low). */
  minClearance: 3,
  cleanTolerance: 1,
} as const;

export const SLIP = {
  /**
   * Sideways shift (Q / E double tap) of `lengths` body lengths (the rig's nose-to-tail length, 18.5 m) over `time`
   * s, heading kept: a sine-shaped lateral acceleration (out, then back to zero lateral speed; peak 2π·d / T²) made of
   * the lift of a quick bank into the slip (then out of it) and the flick of the outer wing's asymmetric downstroke
   * and the tail (a muscle push, capped at maxPush × weight).
   */
  lengths: 1.1,
  time: 1.7,
  bank: 35 * DEG,
  /** Lead (s) of the bank on the lateral profile. */
  bankLead: 0.15,
  maxPush: 4,
  /** Feedback on the lateral offset (1/s²) and speed (1/s) that keeps the shift on its profile. */
  offsetGain: 12,
  speedGain: 6,
  /** Heading hold (1/s) and the yaw / roll authority multipliers while slipping. */
  headingGain: 3,
  authority: [2, 4, 2] as readonly [number, number, number],
  minSpeed: 16,
  stamina: 0.04,
  /** Least clearance below (now and at the destination) and beside (m beyond the outer wingtip) to allow one. */
  minClearance: 3,
  sideMargin: 4,
  /** Headroom above the centre of mass at the destination (raised wings). */
  headroom: 6,
  cleanTolerance: 2,
} as const;

/**
 * Phase 20 stage C energy-trading reversals (maneuvers.ts). Each one ends on the reverse heading and reports its end on
 * the 'maneuver' event (`ended`, `clean`): clean = no contact, no stall, not cut short, upright, the track within
 * headingTolerance of the reverse heading, and its energy trade: the wingover keeps cleanEnergy of the entry's specific
 * energy (½V² + g·Δh, height measured from the entry), the Immelmann ends higher (keeping cleanEnergy), the Split-S
 * ends lower and faster (exit speed ≥ entry − cleanTolerance). Speeds m/s, heights and clearances m, angles rad, loads
 * g, times s.
 */
export const WINGOVER = {
  /**
   * S double tap while banked more than minBank (up to minBank it stays the loop): a climbing turn toward the low wing,
   * a pivot over the high wing at low speed with the nose slicing through the horizon, a dive out on the reverse
   * heading. The path follows a planned flight-path angle over the heading turned (p = heading turned / 180°):
   * γ(p) = climb · f(p) up to the top (p = 0.5, heading +90°), dive · f(p) after it, with f(p) = sin(2πp) eased in
   * over easeIn and out over easeOut (level at both ends, steepest through the top).
   */
  minBank: 45 * DEG,
  minSpeed: 24,
  /** Roughly level entry (flight path within this). */
  maxEntryPath: 30 * DEG,
  /** Peak climb and dive angles of the planned path. */
  climb: 50 * DEG,
  dive: 45 * DEG,
  easeIn: 0.3,
  easeOut: 0.3,
  /** Horizontal lift (g) that turns the path: from tan(entry bank) to `turnLoad` over the first quarter ... */
  turnLoad: 1.15,
  /** ... lighter in the dive (a longer dive: the height comes back as speed), and endLoad as it rolls out. */
  diveLoad: 0.7,
  endLoad: 0.6,
  /** Least vertical part of the lift (g) over the top: the bank passes 90° by this much and no more. */
  topLift: -0.3,
  /** Least bank through the climb (a climbing turn, not a straight pull-up), fading out toward the top. */
  climbBank: 34 * DEG,
  /** ... and in the dive after it (from p 0.55 to 0.7). */
  diveLift: -0.45,
  /** Flight-path gain (1/s) around the planned path, the largest load (g) and the dynamic lift of hard beats. */
  pathGain: 2.2,
  maxLoad: 3.6,
  /** Largest load of the pull out of the dive (softer: the dive runs a little deeper and comes out faster). */
  exitLoad: 2.2,
  liftBoost: 0.3,
  /**
   * Wing-beat effort on the climb and in the dive (the dragon's drag is high, L/D ≈ 6.5: a turn this long without beats
   * would lose half its energy); full beats while slow over the top.
   */
  climbEffort: 0.9,
  diveEffort: 0.6,
  /** Bank rate limit (rad/s) and gain (1/s) of the roll about the flight path. */
  rollRate: 2.2,
  rollGain: 3.5,
  /** The move ends at this progress (the normal law rolls the last few degrees out level); cut short after maxTime. */
  endProgress: 0.95,
  maxTime: 12,
  /** Room: headroom for the climb above the entry, clearance below now and along the turn, a margin beyond the wingtip. */
  headroom: 45,
  minClearance: 25,
  sideMargin: 6,
  /** The dive out gets shallower from this clearance down (level at minClearance − 10). */
  diveClearance: 40,
  stamina: 0.03,
  headingTolerance: 15 * DEG,
  cleanEnergy: 0.9,
} as const;

export const IMMELMANN = {
  /**
   * A / D pressed during the top of a loop (loop angle between windowStart and windowEnd, measured from the entry
   * path): the loop pulls on until the path is level on its back (rollStart short of the top), then a half roll toward
   * the key's side brings it out upright on top, on the reverse heading and higher than the entry.
   */
  windowStart: 0.55 * Math.PI,
  windowEnd: 1.08 * Math.PI,
  rollStart: 4 * DEG,
  /** Half roll: rate (rad/s), acceleration and deceleration (rad/s²), wing spread / sweep, authority (pitch, yaw, roll). */
  rollRate: 3.6,
  rollAccel: 14,
  rollDecel: 12,
  spread: 0.8,
  sweep: 0.2,
  authority: [4, 8, 4] as readonly [number, number, number],
  /** Pressing the key on the axis past this counts as a press (a fresh press: released below `release` first). */
  press: 0.5,
  release: 0.2,
  maxTime: 3,
  headingTolerance: 15 * DEG,
  cleanEnergy: 0.75,
} as const;

export const SPLIT_S = {
  /**
   * A / D double tap in a steep dive (flight path below maxPath; shallower it stays the barrel roll, and from level
   * flight too: dive first, with W or Shift): a half roll onto the back about the flight path, then a pull through the
   * bottom of a half loop to level flight on the reverse heading (lower and faster). The key still held when the half
   * roll ends keeps spinning instead: the diving barrel roll finishes the revolution (and more while held).
   */
  maxPath: -30 * DEG,
  minSpeed: 20,
  /** Half roll (rad/s, rad/s², rad/s²) with the wings half folded. */
  rollRate: 4.2,
  rollAccel: 18,
  rollDecel: 16,
  rollSpread: 0.6,
  rollSweep: 0.35,
  rollAuthority: [5, 12, 4] as readonly [number, number, number],
  /** Pull through: load (g), its onset (s), the load the pull may go up to when the ground is close, and the exit path. */
  load: 4,
  onset: 0.35,
  maxLoad: 4.8,
  exitPath: 2 * DEG,
  /** Room: the predicted lowest point of the half roll and pull through stays this far above the surface below. */
  margin: 18,
  maxTime: 8,
  headingTolerance: 15 * DEG,
  cleanTolerance: 0,
} as const;

/**
 * Pose cues of the stage C reversals (pose.ts, from Maneuvers.reversalCue): rad of the pose channel per unit of cue.
 * pull (0..1): the loop-like pull of the loop, the Immelmann and the Split-S (and the wingover's climb); roll (±1):
 * a half roll toward that side; pivot (±1): around the wingover's top, toward the turn.
 */
export const REVERSAL_POSE = {
  /** Wing twist into the pivot / the half roll (the high wing pushed over). */
  pivotTwist: 0.35,
  rollTwist: 0.3,
  /** Neck pitch held through a pull (raised into it), raised and turned into the pivot, turned toward a half roll. */
  pullNeck: 0.25,
  pivotNeckPitch: 0.22,
  pivotNeckYaw: 0.45,
  rollNeckYaw: 0.2,
  /** Tail swept out opposite the pivot and the half roll; its pitch held through a pull (trailing in line, a little low). */
  pivotTail: 0.4,
  rollTail: 0.3,
  pullTail: 0.06,
  /** Rider lean (riderLeanRoll) into the pivot and with a half roll. */
  riderLean: 0.3,
} as const;

export const SKIM = {
  /**
   * Surface skim / ground effect ("sıyırma"), automatic: foot clearance below `height` (full from fullHeight) over water
   * or flat open ground, at least minSpeed (full from minSpeed + 4), wings level (bank below maxBank) and spread.
   */
  height: 6,
  fullHeight: 3,
  minSpeed: 20,
  maxBank: 12 * DEG,
  minSpread: 0.7,
  /** Flat ground: the surface ahead within this of the surface below, no structure underneath. */
  flatness: 1.5,
  /** Rate (1/s) the skim builds and fades. */
  rate: 3,
  /** Induced drag cut (fraction, on top of the physical ground effect) and parasite drag cut at full skim. */
  inducedCut: 0.45,
  dragCut: 0.1,
  /** The caption and the start of the move: skim above 0.6 for announceTime; ends below 0.2 for endTime. */
  announceTime: 0.5,
  endTime: 0.35,
  /** Captions no more often than this (s). */
  captionInterval: 8,
  /** Wingtips and tail within kissHeight of the surface throw spray (water) or dust (land), spaced by kissSpacing m. */
  kissHeight: 1.3,
  /** Extra wingtip margin (m) of the stroke amplitude limit at full skim (on top of PROXIMITY.strokeMargin). */
  strokeMargin: 0.6,
  kissSpacing: 6,
  /** Tail tip lowered to this height over land / water (m), with the tail pitch capped at tailMax (rad). */
  tailKissLand: 0.45,
  tailKissWater: -0.05,
  tailMax: 0.9,
  cleanTolerance: 3,
} as const;

/**
 * Plunge dive, under-water movement and breach (phase 21 stage 3, underwater.ts). Angles rad, speeds m/s, depths and
 * distances m (depths below the local wave surface), times s, forces as multiples of the dragon's weight.
 */
export const PLUNGE = {
  /* Entry: a steep dive (flight path at least this steep) with folded wings (Shift dive or free fall). */
  minPath: -35 * DEG,
  /** Path tolerance at the moment of contact (the path may shallow a little on the last metres). */
  contactSlack: 5 * DEG,
  maxSpread: 0.5,
  minSpeed: 16,
  /**
   * Seabed at least minDepth below the surface at the entry point and along `reach` m beyond it; up to steepDepth
   * more at the entry point for steeper entries (from minPath to vertical: the 18 m body goes in head first).
   */
  minDepth: 6,
  steepDepth: 5,
  reach: 20,
  reachSamples: 5,
  /** Clear radius around the entry (and along the reach) from vessel hulls, piers and quay structures. */
  hullMargin: 12,
  /** Entry at least this far out from the coastline. */
  shoreMargin: 30,
  /**
   * The plunge is armed (the dive floor lets the dragon into the water) when the entry is armTime + V / armSpeed s
   * away or closer (beyond the dive floor's own look-ahead, so it never starts pulling out first).
   */
  armTime: 3.5,
  armSpeed: 25,
  /** Look-ahead refresh interval. */
  lookInterval: 0.1,
  /** Clearance the dive floor keeps over water that is fit to plunge into: none (land ahead still counts). */
  floorWater: -1000,
  /** Speed kept through the slam of the entry: entryKeepSlow at entrySlow m/s down to entryKeepFast at entryFast. */
  entryKeepSlow: 0.9,
  entryKeepFast: 0.66,
  entrySlow: 20,
  entryFast: 85,

  /* Under water: a streamlined body (wings folded), slightly buoyant, with the water's added mass. */
  /** Net upward acceleration when fully submerged (fraction of g). */
  buoyancy: 0.14,
  addedMass: 0.25,
  /**
   * Drag areas (m²) along the body with the wings folded (streamlined), along it with the wings half open as a brake
   * (hands-off while fast: the plunge stops within a few metres), and across it (flanks, folded wings).
   */
  cdaAxial: 0.25,
  cdaBrake: 2.4,
  cdaLateral: 14,
  /** The brake opens over this long once the hands-off delay has passed, and only above scullSpeed + 1 m/s. */
  brakeRamp: 0.25,
  /** Space: one strong wing-sweep stroke; peak force (× weight), power phase and stroke period. */
  strokeForce: 3,
  strokeTime: 0.45,
  strokePeriod: 0.8,
  strokeStamina: 0.008,
  /** Gentle wing sculling toward this speed when the pilot gives no strokes (and the thrust gain per m/s). */
  scullSpeed: 3.2,
  scullGain: 1.2,
  /** Pitch rate (rad/s) at rest, growing with speed through the water (1 + speed / pitchRateSpeed) up to maxPitchRate. */
  pitchRate: 1.1,
  pitchRateSpeed: 12,
  maxPitchRate: 3,
  yawRate: 0.8,
  maxPitch: 70 * DEG,
  /** Steepest nose-down attitude right after the entry (the body starts along the entry path). */
  entryPitch: -85 * DEG,
  /** Hands-off: after idleDelay the nose comes up to idlePitch (buoyancy and sculling bring the dragon back). */
  idlePitch: 25 * DEG,
  idleDelay: 0.15,
  idlePitchRate: 0.9,
  /** Surfacing on its own: after maxTime, at low air or over shoaling water; nose up to surfacePitch. */
  maxTime: 9,
  lowAir: 0.1,
  shoalDepth: 3,
  surfacePitch: 45 * DEG,
  surfaceSpeed: 5,
  /** Air (stamina) drained per second under water. */
  airDrain: 0.02,
  /** Surface current felt at depth: full at the surface, reduced by this fraction at currentDepth m and below. */
  currentLoss: 0.3,
  currentDepth: 15,
  /** Seabed look-ahead (s along the velocity) and the clearance it keeps for the body spheres (m). */
  seabedLook: 1.2,
  seabedKeep: 2.5,
  /** Bubbles reaching the surface above the head (fx splash strength and interval). */
  bubbleInterval: 0.55,
  bubbleStrength: 0.05,
  /** A body pressed up under a hull for this long looks for the nearest way out (probes out to escapeReach). */
  stuckTime: 0.4,
  escapeReach: 64,
  escapeForce: 0.35,

  /** A slow rise surfaces into swimming once the centre is within this of the surface. */
  surfaceBand: 1,

  /* Breach: Space within breachDepth of the surface, or rising faster than breachRise through it. */
  breachDepth: 2,
  breachRise: 4.5,
  /** Commit window: rising this fast within breachWindow m of the surface pre-opens the wings. */
  breachWindow: 3,
  /** Share of the underwater speed kept as flight speed, the least exit speed and its least upward part. */
  retention: 0.6,
  breachMinSpeed: 8,
  breachMinUp: 7,
  /** Push of the breaching stroke toward the surface (× weight), and the climb angle range at the exit. */
  breachThrust: 1.6,
  breachMinPath: 30 * DEG,
  breachMaxPath: 75 * DEG,
  /** For this long after the breach the water skim leaves the body alone (it is leaving the water, not skimming). */
  exitGrace: 0.5,
} as const;

/**
 * Hard landing (phase 04, hard-landing.ts): meeting the ground too fast tumbles the dragon along it, then it gets up,
 * shakes its head and grumbles. No penalty. Speeds m/s, times s, heights m, angles rad.
 *
 * Thresholds against the sim's own touchdowns (headless checks, hard-landing-check.ts): the slow landing (landing v2)
 * touches down sinking 0.3-1.6 m/s at 0.3-2 m/s, the running landing sinking 0.3-1.6 m/s at 12-18 m/s, and the run-out
 * takes up to RUNOUT.maxSink = 6 m/s; the only body contact a normal landing makes is a hip meeting a slope at ~2.4 m/s.
 * A floor-like contact (normal y > floorNormal) on land at or above these numbers is a hard landing.
 */
export const HARD_LANDING = {
  seed: 9151,
  /** Legs out (the feet meet the ground first): sinking this fast or faster. */
  legSink: 8,
  /** Legs tucked (the belly, chest or head meets the ground): a normal approach speed this fast or faster... */
  bellySink: 6,
  /** ...or a glancing belly contact at glanceSink or more while this fast over the ground (no flare, a botched landing). */
  glanceSink: 3,
  glanceSpeed: 24,
  /** Contacts with a normal steeper than this (y component) are walls, not the ground. */
  floorNormal: 0.7,
  /** The slide starts at the horizontal speed × slideKeep, at most slideMax, and stops at the end of the tumble. */
  slideKeep: 0.55,
  slideMax: 16,
  /** Tumble length per variant; the side roll rolls twice from sideDoubleSpeed (m/s at impact) up. */
  frontTime: 1.3,
  sideTime: 1.3,
  sideDoubleTime: 1.7,
  sideDoubleSpeed: 20,
  bellyTime: 1.5,
  /** Getting up (legs out, lying → standing), then the head shake while standing (the bond plays it). */
  riseTime: 0.7,
  shakeTime: 1.3,
  /** Blend from the impact attitude into the scripted tumble. */
  blendIn: 0.18,
  /** The body bounces off the impact at this share of the sink (m/s), at most bounceMax; it falls back under gravity. */
  bounce: 0.3,
  bounceMax: 3.5,
  /** Carried up by the ground (a roll over the back), the body keeps at most this much upward speed as a hop (m/s). */
  carryMax: 2,
  /** The slide stops when the ground ends this far ahead of the centre (share of the rig length: the head's front). */
  leadReach: 0.52,
  /**
   * Front: the nose dips this far (peaking at frontDipAt of the tumble) with the head held up frontNeckRaise, then the
   * roll over the shoulder starts at frontRollStart. Side: slews sideSlew across the track, the roll starts at
   * sideRollStart. The wings are folded by then (they flail for rollFlailTime; the belly skid's for flailTime).
   */
  frontDip: 0.38,
  frontDipAt: 0.2,
  frontNeckRaise: 0.6,
  frontRollStart: 0.25,
  sideSlew: 1.35,
  sideRollStart: 0.2,
  rollFlailTime: 0.22,
  flailTime: 0.45,
  /** Belly skid: fishtail yaw and roll wobble amplitudes, and the chin held up off the ground. */
  skidYaw: 0.32,
  skidRoll: 0.05,
  bellyNeckRaise: 0.3,
  /** The neck's raise follows its cue at this rate (1/s, as the pose driver's neck); its base (share of the length ahead). */
  neckRate: 6,
  neckBase: 0.2,
  /** Nose-down of the lying body at the end of the tumble. */
  lyingPitch: -0.06,
  /** Dust puffs along the slide (s apart) and the impact's dust burst and camera jolt. */
  dustEvery: 0.12,
  impactDust: 1.3,
  shake: 0.55,
  /** The rider's sphere above the saddle (fractions of the rig length: up, forward) and its radius (m). */
  riderUp: 0.13,
  riderForward: 0.17,
  riderRadius: 0.55,
} as const;
