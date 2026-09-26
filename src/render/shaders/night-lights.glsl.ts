/**
 * One night for every building (phase 24, S5): the lit-window model of the procedural city (city/materials/
 * city.glsl.ts), shared with the OSM facades (osm/buildings/facade-glsl.ts) and matched by the terrain's far city
 * carpet (terrain/terrain-system.ts, the same residential curve on the CPU). The far OSM layer draws real buildings
 * with the city's shader, so a building must light the same windows before and after its region loads.
 * Needs uNight (render/shaders/common.glsl.ts).
 */
export const NIGHT_LIGHTS_GLSL = /* glsl */ `
/* Linear-RGB colour of a warm..cool interior light, t = 0 (2400 K) .. 1 (5000 K). */
vec3 cityKelvin(float t) {
  vec3 c2400 = vec3(1.0, 0.33, 0.06);
  vec3 c3000 = vec3(1.0, 0.47, 0.16);
  vec3 c4000 = vec3(1.0, 0.64, 0.37);
  vec3 c5000 = vec3(1.0, 0.77, 0.62);
  return t < 0.33 ? mix(c2400, c3000, t / 0.33) : t < 0.66 ? mix(c3000, c4000, (t - 0.33) / 0.33) : mix(c4000, c5000, (t - 0.66) / 0.34);
}

/* Fraction of lit rooms by local hour: residential evening peak ~21h, morning bump ~6.7h; offices 8-20h. */
float cityOccupancy(float hour, int usage) {
  float dh = abs(hour - 21.0); dh = min(dh, 24.0 - dh);
  float dm = abs(hour - 6.7); dm = min(dm, 24.0 - dm);
  float res = 0.07 + 0.47 * exp(-dh * dh / 9.7) + 0.14 * exp(-dm * dm / 1.3);
  float dOff = abs(hour - 14.0); dOff = min(dOff, 24.0 - dOff);
  float off = 0.1 + 0.62 * smoothstep(7.5, 5.0, dOff);
  return usage == 1 ? off : usage == 3 ? off * 0.5 : res;
}

float cityLightsOn() { return smoothstep(0.06, 0.5, uNight); }

/* Far-field window light of a facade: pixel-sized cells of lit windows at the city's colour and strength. */
vec3 cityFarWindowLight(float winFrac, float lit) {
  return cityKelvin(0.28) * 6.0 * winFrac * lit;
}
`;
