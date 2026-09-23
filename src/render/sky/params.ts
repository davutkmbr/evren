/**
 * Physical parameters of the Istanbul atmosphere model (Hillaire 2020 Earth defaults + a humid
 * Marmara boundary-layer haze). Shared by the GPU LUTs, the analytic aerial perspective in the
 * shared GLSL and the CPU key-light transmittance, so every consumer sees the same medium.
 * GPU LUT shaders work in kilometres; the shared GLSL and the CPU code work in metres.
 */
export const ATMOSPHERE = {
  groundRadiusKm: 6360,
  topRadiusKm: 6460,

  rayleighScatteringPerKm: [5.802e-3, 13.558e-3, 33.1e-3] as const,
  rayleighScaleHeightKm: 8.0,

  mieScatteringPerKm: 3.996e-3,
  mieExtinctionPerKm: 4.44e-3,
  mieScaleHeightKm: 1.2,
  mieG: 0.8,

  /**
   * Chappuis band averaged over the sRGB primaries' bandwidths (R ~590-700 nm, G ~500-600 nm, B ~420-500 nm) for a
   * ~340 DU autumn column over the Balkans/Anatolia. Ozone is what keeps the zenith blue at golden hour and in the blue
   * hour (Hulburt 1953): the grazing solar path through the ozone layer strips red/green light.
   */
  ozoneAbsorptionPerKm: [2.7e-3, 2.55e-3, 0.135e-3] as const,
  ozoneCenterKm: 25,
  ozoneHalfWidthKm: 15,

  /** Humid urban/maritime haze (Angstrom exponent ~0.8, single scattering albedo ~0.93). */
  hazeScatteringPerKm: [0.128, 0.152, 0.182] as const,
  hazeAbsorptionPerKm: [0.0096, 0.0114, 0.0137] as const,
  hazeScaleHeightKm: 0.85,
  /** Forward lobe of the two-term haze phase function (see phaseHaze). */
  hazeG: 0.8,

  /** Mean albedo of the Marmara sea + city seen from above (multiple scattering bounce). */
  groundAlbedo: [0.1, 0.105, 0.1] as const,
} as const;

/** Solar irradiance at the top of the atmosphere, in the engine's light units (ground noon sun ~4-5). */
export const SUN_ILLUMINANCE = 6.2;

/** Sun disk radiance cap (physically ~7e4 x irradiance; capped for the half-float HDR target and bloom). */
export const SUN_DISK_RADIANCE = 1800;

/** Angular radii (radians). */
export const SUN_ANGULAR_RADIUS = 0.004653;
export const MOON_ANGULAR_RADIUS_MEAN = 0.004521;

/**
 * Night is artistically compressed: a full moon lights the scene at ~1/18 of the sun (real ratio ~4e5),
 * so the city at night reads as dim moonlight + bright emissives with a plausible auto exposure.
 */
export const MOON_ILLUMINANCE_FULL = SUN_ILLUMINANCE / 18;

/**
 * The moon's contribution to the sky relative to its (compressed) key light. Sky-to-ground contrast stays close to the
 * daytime ratio (moonlit zenith ~1/3 of moonlit grey ground; day ~1/2.5) so the sky reads deep blue instead of black,
 * while moon + city skyglow together stay below the sunset sky level (see twilight.ts nightSkyWeight).
 */
export const MOON_SKY_SCALE = 0.45;

/**
 * Upward light flux of the city at night (skyglow source, sodium + LED mix), in scattering units of the sky-view LUT.
 * Shaped by cityLightDensity() in the LUT shader (dark Black Sea to the north). Tuned for a Bortle 8-9 megacity:
 * zenith comparable to the moonlit zenith, an orange-brown dome that dominates the horizon even under a bright moon.
 */
export const LIGHT_POLLUTION = { color: [1.0, 0.58, 0.32] as const, strength: 0.5, scaleHeightKm: 3.5 };

/** Faint 557.7 nm airglow + unresolved starlight floor (natural dark-sky zenith ~22 mag/arcsec^2). */
export const AIRGLOW = { color: [0.55, 0.85, 0.6] as const, strength: 0.00006 };

/** Peak Milky Way radiance (Sagittarius star clouds ~3x the airglow floor), before moon/twilight fading. */
export const MILKY_WAY_RADIANCE = 2.5e-4;

/** Star flux scale (pixel energy of a magnitude 0 star). */
export const STAR_BRIGHTNESS = 4;

/** Haze multipliers: clean Black Sea air under poyraz, humid Marmara air under lodos; humid mornings on top. */
export const HAZE = { poyraz: 0.4, lodos: 1.15, morningBoost: 0.35 } as const;

/** Key-light altitude levels (m) for the height dependent sun/moon transmittance table. */
export const KEY_LIGHT_HEIGHTS = [0, 100, 300, 700, 1500, 4000] as const;

export const SKY_VIEW_LUT_SIZE = { width: 256, height: 128 } as const;
export const TRANSMITTANCE_LUT_SIZE = { width: 256, height: 64 } as const;
export const MULTI_SCATTERING_LUT_SIZE = 32;

/** Istanbul (world origin) and time zone. */
export const OBSERVER = { latDeg: 41.045, lonDeg: 29.02, utcOffsetHours: 3 } as const;
