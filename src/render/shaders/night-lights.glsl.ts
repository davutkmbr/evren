/**
 * One night for every building (phase 24, S5): the lit-window model of the procedural city (city/materials/
 * city.glsl.ts), shared with the OSM facades (osm/buildings/facade-glsl.ts) and matched by the terrain's far city
 * carpet (terrain/terrain-system.ts, the same residential curve on the CPU). The far OSM layer draws real buildings
 * with the city's shader, so a building must light the same windows before and after its region loads.
 * Needs uNight and hash13 (render/shaders/common.glsl.ts).
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

/* Lit hash of a window cell at pyramid level l (cells of 2^l x 2^l windows); seeds.x = level 0 (the per-window
   decision of the detailed shading), seeds.y = coarser levels. */
float cityLitHash(vec2 cell, float l, vec2 seeds) {
  return l < 0.5 ? hash13(vec3(cell, seeds.x)) : hash13(vec3(cell, seeds.y + l * 7.13));
}

/* Width (px) of the box filter for lit windows and cells. Point-sampled or 1 px-filtered lights about a pixel wide
   blink as the view turns: a light straddling two pixels drops to half its peak (flicker audit,
   .docs/planning/flicker-audit.md). With a 2 px box the peak of a sub-pixel light no longer depends on its phase. */
#define CITY_LIT_FILTER 2.0

/* Lit fraction (0..1) of level-l cells over the pixel footprint fp (in windows, per axis) around wc (in windows):
   exact box filter over at most 3 x 3 cells. */
float cityLitBox(vec2 wc, vec2 fp, float l, vec2 seeds, float occ) {
  float s = exp2(l);
  vec2 p = wc / s;
  vec2 h = max(fp * (0.5 * CITY_LIT_FILTER) / s, vec2(1e-3));
  vec2 lo = p - h;
  vec2 hi = p + h;
  vec2 c0 = floor(lo);
  float acc = 0.0;
  for (int j = 0; j < 3; j++) {
    float cy = c0.y + float(j);
    float wy = max(min(cy + 1.0, hi.y) - max(cy, lo.y), 0.0);
    for (int i = 0; i < 3; i++) {
      float cx = c0.x + float(i);
      float wx = max(min(cx + 1.0, hi.x) - max(cx, lo.x), 0.0);
      if (wx * wy > 0.0) acc += wx * wy * step(cityLitHash(vec2(cx, cy), l, seeds), occ);
    }
  }
  return acc / (4.0 * h.x * h.y);
}

/* Far-field lit windows: cells of 2^l windows matched to the filter footprint (the sparkle of single windows where a
   pixel still resolves them, energy-conserving blocks further out), box-filtered, blended between two levels. */
float cityFarLit(vec2 wc, vec2 fp, vec2 seeds, float occ) {
  float lod = clamp(log2(max(max(fp.x, fp.y) * CITY_LIT_FILTER, 1.0)), 0.0, 7.0);
  float l0 = floor(lod);
  float t = smoothstep(0.2, 0.8, lod - l0);
  float a = cityLitBox(wc, fp, l0, seeds, occ);
  return t > 0.0 ? mix(a, cityLitBox(wc, fp, l0 + 1.0, seeds, occ), t) : a;
}

/* Far-field window light of a facade: pixel-sized cells of lit windows at the city's colour and strength. */
vec3 cityFarWindowLight(float winFrac, float lit) {
  return cityKelvin(0.28) * 6.0 * winFrac * lit;
}
`;
