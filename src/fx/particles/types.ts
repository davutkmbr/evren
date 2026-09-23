/**
 * Particle type tables shared by the CPU motion mirror (sorting, emitters) and the GLSL
 * (generated const arrays), so both sides always integrate identically.
 */

/** Soft, sorted, half-resolution particles (fire, smoke, spray mist, dust, foam). */
export const VolType = {
  Flame: 0,
  Smoke: 1,
  Steam: 2,
  Mist: 3,
  Dust: 4,
  Foam: 5,
  Ring: 6,
  Spray: 7,
} as const;

/** Small, sharp, full-resolution particles (embers, sparks, droplets, debris). */
export const SharpType = {
  Ember: 0,
  Spark: 1,
  Droplet: 2,
  Debris: 3,
} as const;

export interface MotionProfile {
  /** Constant vertical acceleration (m/s², negative = falls). */
  gravity: number;
  /** Decay rate (1/s) of the per-particle initial buoyancy acceleration. */
  buoyDecay: number;
  /** Fraction of the ambient wind the particle relaxes towards. */
  wind: number;
  /** Curl-noise displacement amplitude (vol: × radius, sharp: meters). */
  turbAmp: number;
  /** Curl-noise spatial frequency (1/m). */
  turbFreq: number;
  /** Curl field scroll speed (1/s). */
  turbScroll: number;
  /** Time constant (s) of size0 -> size1 growth. */
  growTime: number;
  /** Radius growth per meter travelled relative to the air (jet spreading). */
  jetSpread: number;
  /** Linear radius growth (m/s): diffusion. */
  spreadRate: number;
  /** Velocity stretch (motion blur) factor, 0 = round. */
  stretch: number;
  /** Surface clearance as a fraction of radius (vol) or meters (sharp); < 0 = dies at surface. */
  clearance: number;
  /** Max sprite spin (rad/s). */
  spin: number;
}

const p = (m: MotionProfile): MotionProfile => m;

export const VOL_PROFILES: readonly MotionProfile[] = [
  // Flame: fast jet, buoyant while hot, spreads like a turbulent jet then billows into soot.
  p({ gravity: 0.35, buoyDecay: 0.9, wind: 0.7, turbAmp: 0.95, turbFreq: 0.065, turbScroll: 0.7, growTime: 0.45, jetSpread: 0.085, spreadRate: 0.6, stretch: 1.0, clearance: 0.45, spin: 1.4 }),
  // Smoke: persistent billows, slightly buoyant, drifts with the wind.
  p({ gravity: 0.6, buoyDecay: 0.25, wind: 1.0, turbAmp: 0.45, turbFreq: 0.045, turbScroll: 0.22, growTime: 1.6, jetSpread: 0.04, spreadRate: 0.8, stretch: 0.0, clearance: 0.55, spin: 0.3 }),
  // Steam: strongly buoyant, fast dissipation.
  p({ gravity: 0.9, buoyDecay: 0.7, wind: 1.0, turbAmp: 0.5, turbFreq: 0.1, turbScroll: 0.5, growTime: 0.9, jetSpread: 0.05, spreadRate: 1.1, stretch: 0.0, clearance: 0.4, spin: 0.5 }),
  // Mist (spray cloud): hangs above the water, slowly sinks.
  p({ gravity: -0.12, buoyDecay: 1.0, wind: 0.9, turbAmp: 0.35, turbFreq: 0.09, turbScroll: 0.35, growTime: 0.7, jetSpread: 0.06, spreadRate: 0.5, stretch: 0.25, clearance: 0.3, spin: 0.4 }),
  // Dust: rolls outwards along the ground, lingers.
  p({ gravity: -0.05, buoyDecay: 1.0, wind: 0.9, turbAmp: 0.4, turbFreq: 0.07, turbScroll: 0.3, growTime: 1.1, jetSpread: 0.07, spreadRate: 0.7, stretch: 0.0, clearance: 0.5, spin: 0.3 }),
  // Foam patch: flat on the water, drifts slowly.
  p({ gravity: 0, buoyDecay: 1.0, wind: 0.08, turbAmp: 0, turbFreq: 0.1, turbScroll: 0, growTime: 2.5, jetSpread: 0, spreadRate: 0.12, stretch: 0, clearance: 0, spin: 0.05 }),
  // Expanding ring wave: flat on the water.
  p({ gravity: 0, buoyDecay: 1.0, wind: 0.05, turbAmp: 0, turbFreq: 0.1, turbScroll: 0, growTime: 1.3, jetSpread: 0, spreadRate: 0.35, stretch: 0, clearance: 0, spin: 0 }),
  // Whitewater spray clump: ballistic, falls back and sinks below the surface (hidden by the depth test).
  p({ gravity: -9.81, buoyDecay: 1.0, wind: 0.3, turbAmp: 0.1, turbFreq: 0.15, turbScroll: 0.4, growTime: 0.7, jetSpread: 0.02, spreadRate: 0.3, stretch: 4.0, clearance: -1, spin: 0.6 }),
];

export const SHARP_PROFILES: readonly MotionProfile[] = [
  // Ember: glowing soot flake, rises with the plume then drifts down.
  p({ gravity: -2.2, buoyDecay: 0.6, wind: 1.0, turbAmp: 1.1, turbFreq: 0.16, turbScroll: 0.8, growTime: 1, jetSpread: 0, spreadRate: 0, stretch: 1.0, clearance: 0.03, spin: 0 }),
  // Spark: hot fast fleck with a bright streak.
  p({ gravity: -6.5, buoyDecay: 2.5, wind: 0.6, turbAmp: 0.35, turbFreq: 0.2, turbScroll: 0.8, growTime: 1, jetSpread: 0, spreadRate: 0, stretch: 1.0, clearance: 0.02, spin: 0 }),
  // Droplet: ballistic water drop, dies when it falls back into the water.
  p({ gravity: -9.81, buoyDecay: 1, wind: 0.35, turbAmp: 0.05, turbFreq: 0.3, turbScroll: 0.3, growTime: 1, jetSpread: 0, spreadRate: 0, stretch: 1.0, clearance: -1, spin: 0 }),
  // Debris: grit/pebbles kicked up by a landing.
  p({ gravity: -9.81, buoyDecay: 1, wind: 0.1, turbAmp: 0, turbFreq: 0.3, turbScroll: 0, growTime: 1, jetSpread: 0, spreadRate: 0, stretch: 0.6, clearance: 0.02, spin: 0 }),
];

function glslArray(name: string, values: number[]): string {
  const list = values.map((v) => (Number.isInteger(v) ? v.toFixed(1) : String(v))).join(', ');
  return `const float ${name}[${values.length}] = float[${values.length}](${list});`;
}

/** GLSL const arrays for a profile table, prefixed (e.g. VOL_GRAVITY[type]). */
export function profileGlsl(prefix: string, table: readonly MotionProfile[]): string {
  const keys: Array<[keyof MotionProfile, string]> = [
    ['gravity', 'GRAVITY'],
    ['buoyDecay', 'BUOY_DECAY'],
    ['wind', 'WIND'],
    ['turbAmp', 'TURB_AMP'],
    ['turbFreq', 'TURB_FREQ'],
    ['turbScroll', 'TURB_SCROLL'],
    ['growTime', 'GROW_TIME'],
    ['jetSpread', 'JET_SPREAD'],
    ['spreadRate', 'SPREAD_RATE'],
    ['stretch', 'STRETCH'],
    ['clearance', 'CLEARANCE'],
    ['spin', 'SPIN'],
  ];
  return keys.map(([key, name]) => glslArray(`${prefix}_${name}`, table.map((m) => m[key]))).join('\n');
}

/** Packs an albedo (0..1 per channel) into one float (exact in fp32). */
export function packColor(r: number, g: number, b: number): number {
  const q = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  return q(r) * 65536 + q(g) * 256 + q(b);
}
