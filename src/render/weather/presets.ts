import type { WeatherPreset, WeatherSettings } from '../../core/contracts';

/** Weather presets (the look setting `farBlur` is not part of a preset). */
export const WEATHER_PRESETS: Record<WeatherPreset, Omit<WeatherSettings, 'farBlur'>> = {
  clear: { fog: 0, rain: 0, storm: 0 },
  haze: { fog: 0.3, rain: 0, storm: 0 },
  fog: { fog: 1, rain: 0, storm: 0 },
  rain: { fog: 0.2, rain: 0.8, storm: 0 },
  storm: { fog: 0.3, rain: 1, storm: 1 },
};

export const WEATHER_ORDER: readonly WeatherPreset[] = ['clear', 'haze', 'fog', 'rain', 'storm'];

/** Player-facing names (Turkish). */
export const WEATHER_LABELS: Record<WeatherPreset | 'custom', string> = {
  clear: 'Açık',
  haze: 'Pus',
  fog: 'Sis',
  rain: 'Yağmur',
  storm: 'Fırtına',
  custom: 'Özel',
};

/** Default distance softening (0..1). */
export const DEFAULT_FAR_BLUR = 0.6;

/**
 * Multiplier on the sky's haze (boundary-layer aerosol) density: fog and rain thicken the air everywhere, so distant
 * shores fade out long before they would on a clear day (~10 km in rain). Kept moderate for fog: the haze model
 * absorbs a little (humid city aerosol) and turns brown when pushed far; the white fog itself is the ground layer
 * of the weather pass.
 */
export function weatherHazeFactor(w: Readonly<WeatherSettings>): number {
  return 1 + 3.5 * w.fog + 2.5 * w.rain;
}

/** Cloud coverage bias added by the weather (clouds module range -0.5..0.5; 0 = fair weather). */
export function weatherCloudCoverage(w: Readonly<WeatherSettings>): number {
  return 0.5 * w.rain + 0.12 * w.storm;
}

/**
 * Direct light left under the weather's cloud deck (0..1): rain and storms mean a closed overcast that takes most of
 * the sun (and the sky's brightness with it); fog is a low layer the pass itself shades, the sun above it stays.
 */
export function weatherSunFactor(w: Readonly<WeatherSettings>): number {
  return Math.max(0.12, 1 - 0.72 * w.rain - 0.12 * w.storm);
}
