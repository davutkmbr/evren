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
  leapUp: 8,
  leapForward: 4,
  /** Crouch before the leap (s): the dragon rears a little and raises its wings for the first big downstroke. */
  leapCrouch: 0.3,
  leapRear: 0.09,
  /** Running take-off (the urge on the ground): gallop up to this speed (m/s) within runTime (s), then leap. */
  runTakeoffSpeed: 12,
  runTakeoffTime: 1.3,
  runTakeoffAccel: 7,
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
  paddleSpeed: 2.6,
  fastSpeed: 4.5,
  turnRate: 0.6,
  leapUp: 4.5,
  leapForward: 2,
} as const;

/**
 * Swimming at the surface (locomotion.ts drives it, pose.ts turns it into DragonPose.swim / swimPhase / swimStroke,
 * the animator shapes the rig). The dragon floats low with the head and neck raised, the wings folded tight along the
 * back, the hind legs kicking slowly under the body; the side-to-side undulation of the body and tail is the stroke.
 * Speeds m/s, times s, frequencies Hz, angles rad.
 */
export const SWIM_POSE = {
  /** Stroke (tail undulation) frequency: idle + per m/s of swim speed; Shift (fast swim) multiplies it. */
  freqIdle: 0.2,
  freqPerSpeed: 0.13,
  fastFreq: 1.3,
  /** Stroke strength 0..1: the idle sway, the strength at paddle speed, and with Shift. */
  strokeIdle: 0.22,
  strokePaddle: 0.7,
  strokeFast: 1,
  /** Rate (1/s) at which the stroke strength follows the swim speed. */
  strokeRate: 1.6,
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
  /** Neck raise (pose neckPitch, + = up) while floating, and extra with the stroke (the head pushes forward). */
  neckRaise: 0.42,
  neckStroke: -0.1,
  /** Tail: carried at the surface (pitch, + = down), its lateral sweep (pose tailYaw) per unit of stroke. */
  tailPitch: 0.04,
  tailSweep: 0.28,
  /** Idle look-around: seconds between head turns (random within) and the largest turn (rad). */
  lookEvery: [3.5, 8] as const,
  lookYaw: 0.55,
  /** Paddle cue: a small splash at the tail on each stroke reversal above this speed, strength base + per m/s. */
  splashSpeed: 1.2,
  splashBase: 0.05,
  splashPerSpeed: 0.025,
  /**
   * Water take-off run (Space / L while swimming): the body rises onto the surface and speeds up with the wings
   * beating and slapping the water (a splash at each wingtip per downstroke), then leaps into the air.
   */
  runTime: 1.2,
  runSpeed: 8,
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
  /* Urge "dehh" (V): strong beats and a surge. */
  urgeDuration: 1.7,
  urgeCooldown: 2.5,
  urgeGain: 11,
  urgeThrust: 2.3,
  urgeStamina: 0.03,
  /** The rider's gesture envelope (s). */
  urgeGesture: 1.2,
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
