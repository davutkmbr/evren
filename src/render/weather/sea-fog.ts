/**
 * Fog banks lying on the sea (phase 21 stage 6): a thin, height-limited fog layer over the water on calm poyraz
 * mornings and in fog weather, the "morning Bosphorus fog" the bridge towers rise out of. It forms before dawn, holds
 * through the early morning and lifts as the day warms (the layer thins and rises); a lodos, a strong wind or rain
 * clears it. The weather pass draws it as a second exponential fog layer (scale height ~16 m) with drifting banks;
 * while it is off the pass skips its branch (zero cost).
 *
 * Not every calm morning is foggy: a "foggy morning" is drawn once per game day (a hash of the day of year, so the same
 * day always gives the same answer and a reload does not reroll it); about a third of the days get one, each with its
 * own thickness. Fog weather and humid air still make fog on the other days.
 *
 * `seaFogTarget` is the pure activation logic; `SeaFogModel` smooths it and switches the layer on and off with
 * hysteresis so it never flickers at the threshold.
 */

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

export const SEA_FOG = {
  /** Extinction at the sea surface at full amount (1/m): ~330 m visibility on the water. */
  density: 0.009,
  /** Scale height of the layer (m) and how much it grows while the fog lifts (share). */
  height: 16,
  liftHeight: 1.2,
  /** How much thinner the layer gets while it lifts (share of the density). */
  liftThin: 0.55,
  /** Morning window (hours): forms from formStart to formFull, lifts from liftStart to liftEnd. */
  formStart: 2,
  formFull: 5,
  liftStart: 8.5,
  liftEnd: 11.5,
  /** Fog weather keeps this share of its sea fog outside the morning window. */
  allDayShare: 0.3,
  /** Weather fog setting that starts / saturates the sea fog (haze 0.3 gives a quarter). */
  fogLo: 0.1,
  fogHi: 0.9,
  /** Humid air (EnvironmentState.humidity) makes morning sea fog even without a fog setting, at most this much. */
  humidLo: 0.72,
  humidHi: 0.86,
  humidMax: 0.6,
  /** Share of game days that get a foggy morning on their own, and the range of its amount. */
  morningChance: 0.3,
  morningMin: 0.45,
  morningMax: 0.85,
  /** A lodos clears it (regime blend), and so do a strong wind (U10, m/s) and rain. */
  lodosLo: 0.35,
  lodosHi: 0.65,
  windLo: 7,
  windHi: 12,
  rainLo: 0.15,
  rainHi: 0.5,
  /** Hysteresis: the layer turns on above `on` (target) and off below `off` (smoothed amount and target). */
  on: 0.08,
  off: 0.02,
  /** Time constant (s) of the fog forming and clearing. */
  tau: 20,
  /** Patchiness of the banks (0 = uniform layer) and their size (m); the banks drift with this share of the wind. */
  patches: 0.75,
  bankSize: 420,
  drift: 0.5,
  /** The layer is integrated over at most this distance (m) along a view ray. */
  maxDistance: 9000,
} as const;

export interface SeaFogInputs {
  /** Weather settings in use (weather.current): fog and rain, 0..1. */
  fog: number;
  rain: number;
  /** Local time of day (hours). */
  hours: number;
  /** Sea regime blend (water.seaState.lodos): 0 = poyraz, 1 = lodos. */
  lodos: number;
  /** Wind the sea feels (water.seaState.windSpeed, U10 m/s). */
  u10: number;
  /** Near-ground relative humidity 0..1 (env.humidity). */
  humidity: number;
  /** Game day of year (time.dayOfYear): picks the foggy mornings. */
  day: number;
}

/** Deterministic hash of an integer to [0, 1). */
function hash01(n: number, salt: number): number {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Amount 0..1 of the day's own foggy morning (0 on the days without one). */
export function seaFogDayAmount(day: number): number {
  const d = Math.round(finite(day, 1));
  if (hash01(d, 1) >= SEA_FOG.morningChance) {
    return 0;
  }
  return SEA_FOG.morningMin + (SEA_FOG.morningMax - SEA_FOG.morningMin) * hash01(d, 2);
}

/** Morning factor 0..1: forming before dawn, full through the early morning, lifting as the day warms. */
export function seaFogMorning(hours: number): number {
  const h = ((finite(hours, 12) % 24) + 24) % 24;
  return smoothstep(SEA_FOG.formStart, SEA_FOG.formFull, h) * (1 - smoothstep(SEA_FOG.liftStart, SEA_FOG.liftEnd, h));
}

/** 0..1 how far the morning fog has lifted (thins and rises). */
export function seaFogLift(hours: number): number {
  const h = ((finite(hours, 12) % 24) + 24) % 24;
  return smoothstep(SEA_FOG.liftStart, SEA_FOG.liftEnd, h);
}

/** Target amount 0..1 of sea fog for the weather, time, regime, wind and humidity. */
export function seaFogTarget(i: Readonly<SeaFogInputs>): number {
  const fogK = smoothstep(SEA_FOG.fogLo, SEA_FOG.fogHi, finite(i.fog, 0));
  const humidK = SEA_FOG.humidMax * smoothstep(SEA_FOG.humidLo, SEA_FOG.humidHi, finite(i.humidity, 0));
  const morning = seaFogMorning(i.hours);
  const dayK = seaFogDayAmount(i.day);
  // Fog weather: a morning bank plus a thinner one all day; humid air or the day's foggy morning: morning only.
  const time = Math.max(fogK * (SEA_FOG.allDayShare + (1 - SEA_FOG.allDayShare) * morning), Math.max(humidK, dayK) * morning);
  const regime = 1 - smoothstep(SEA_FOG.lodosLo, SEA_FOG.lodosHi, finite(i.lodos, 0));
  const wind = 1 - smoothstep(SEA_FOG.windLo, SEA_FOG.windHi, finite(i.u10, 0));
  const rain = 1 - smoothstep(SEA_FOG.rainLo, SEA_FOG.rainHi, finite(i.rain, 0));
  return clamp01(time * regime * wind * rain);
}

/** The smoothed, hysteretic sea fog layer; `density` / `height` feed the weather pass (density 0 = off). */
export class SeaFogModel {
  /** Smoothed amount 0..1. */
  amount = 0;
  /** Latest target (diagnostics). */
  target = 0;
  /** The layer is drawn. */
  active = false;
  /** Extinction at the sea surface (1/m; 0 while off) and scale height (m) for the pass. */
  density = 0;
  height: number = SEA_FOG.height;
  /** Debug override of the target (?seafog=0..1), null = follow the weather. */
  forced: number | null = null;
  private started = false;

  update(dt: number, inputs: Readonly<SeaFogInputs>): void {
    const target = this.forced !== null ? clamp01(this.forced) : seaFogTarget(inputs);
    this.target = target;
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (!this.started) {
      // Start in the settled state (no fog rolling in on the first frames of a foggy morning).
      this.amount = target;
      this.started = true;
    } else {
      this.amount += (target - this.amount) * (1 - Math.exp(-step / SEA_FOG.tau));
    }
    if (!this.active && target > SEA_FOG.on) {
      this.active = true;
    } else if (this.active && target < SEA_FOG.on && this.amount < SEA_FOG.off) {
      this.active = false;
    }
    const lift = seaFogLift(inputs.hours);
    this.height = SEA_FOG.height * (1 + SEA_FOG.liftHeight * lift);
    this.density = this.active ? SEA_FOG.density * this.amount * (1 - SEA_FOG.liftThin * lift) : 0;
  }
}
