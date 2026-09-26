import { RAIN_RINGS } from './config';

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/**
 * Drop rings of rain on the water (phase 21 stage 6), for the water fragment shader: two staggered layers of cells,
 * one drop per cell and cycle at a random point, its ring (a crest outside, a trough inside) running out while it
 * fades. The JS port is `rainRingSlope` (sea-weather.ts). Needs hash13 / hash33 (render/shaders/common.glsl.ts).
 *
 * uRainParams: x = drop density per cell (0 = no rain: skip), y = rain clock (s), z = multiplier of the detail bands
 * (rain damps the short waves), w = mean square slope of the rings where they are finer than the pixel.
 */
export const RAIN_RING_GLSL = /* glsl */ `
uniform vec4 uRainParams;
#define RAIN_CELL ${f(RAIN_RINGS.cell)}
#define RAIN_PERIOD ${f(RAIN_RINGS.period)}
#define RAIN_RING_MAX ${f(RAIN_RINGS.ringMax)}
#define RAIN_WIDTH ${f(RAIN_RINGS.width)}
#define RAIN_AMP ${f(RAIN_RINGS.amplitude)}
#define RAIN_FADE_START ${f(RAIN_RINGS.fadeStart)}
#define RAIN_FADE_END ${f(RAIN_RINGS.fadeEnd)}

vec2 rainRingSlope(vec2 p, float t, float density) {
  vec2 slope = vec2(0.0);
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    vec2 q = p * (1.0 / RAIN_CELL) + fl * vec2(0.37, 0.61);
    vec2 cell = floor(q);
    float ph = t / RAIN_PERIOD + hash13(vec3(cell, fl * 17.0 + 1.0));
    float cyc = floor(ph);
    float age = ph - cyc;
    vec3 h = hash33(vec3(cell, cyc + fl * 131.0));
    if (h.z >= density) continue;
    vec2 d = (q - cell - (0.3 + 0.4 * h.xy)) * RAIN_CELL;
    float r = length(d);
    float u = (r - age * RAIN_RING_MAX) / RAIN_WIDTH;
    float env = (1.0 - age) * (1.0 - age);
    float dh = (RAIN_AMP / RAIN_WIDTH) * env * (2.0 * u * u - 1.0) * exp(-u * u);
    slope += d * (dh / max(r, 1e-4));
  }
  return slope;
}
`;
