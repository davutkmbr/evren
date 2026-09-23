/**
 * Night lighting helpers shared by the structure shaders (requires SHARED_GLSL before it):
 *   float structLightsOn()                      0 by day .. 1 once the city lights are on (dusk)
 *   vec3  structLed(float group, float u, float v)   animated RGB LED show colour (luminance ~1)
 *   vec3  structKelvin(float idx)               colour-temperature palette for floodlights
 * The Bosphorus bridges run programmable LED shows (Philips, 2007); the programs below cycle every ~26 s with a
 * crossfade and are phase-shifted per group so the bridges never show the same colour at the same time.
 */
export const LED_GLSL = /* glsl */ `
float structLightsOn() {
  return smoothstep(0.18, 0.55, uNight);
}

vec3 structHue(float h) {
  vec3 c = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return c * c * (3.0 - 2.0 * c);
}

vec3 structLedNormalize(vec3 c) {
  return c / max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.08);
}

vec3 structLedProgram(float prog, float u, float v, float t, float seed) {
  if (prog < 0.5) {
    // slow flowing spectrum along the span
    return structHue(fract(u * 1.4 - t * 0.035 + seed));
  } else if (prog < 1.5) {
    // Turkish flag: crimson with white bands travelling outwards from mid-span
    float d = abs(u - 0.5);
    float band = smoothstep(0.30, 0.42, abs(fract(d * 4.0 - t * 0.09) - 0.5) * 2.0);
    return mix(vec3(0.9, 0.012, 0.03), vec3(1.0, 0.92, 0.85), band);
  } else if (prog < 2.5) {
    // Bosphorus blue swell
    float w = 0.5 + 0.5 * sin(u * 34.0 - t * 1.1 + v * 3.0);
    return mix(vec3(0.01, 0.07, 1.0), vec3(0.1, 0.75, 1.0), w * w);
  } else if (prog < 3.5) {
    // magenta - violet vertical gradient, breathing
    float b = 0.75 + 0.25 * sin(t * 0.7);
    return mix(vec3(0.45, 0.02, 1.0), vec3(1.0, 0.05, 0.45), clamp(v, 0.0, 1.0)) * b;
  } else if (prog < 4.5) {
    // warm white with travelling sparkles
    float cell = floor(u * 240.0);
    float s = step(0.965, hash12(vec2(cell, floor(t * 5.0 + hash11(cell) * 7.0))));
    return vec3(1.0, 0.78, 0.52) * 0.8 + vec3(1.0) * s * 2.5;
  }
  // turquoise / green chase
  float w = smoothstep(0.2, 0.8, fract(u * 6.0 + t * 0.12));
  return mix(vec3(0.0, 0.85, 0.55), vec3(0.05, 0.35, 1.0), w);
}

vec3 structLed(float group, float u, float v) {
  float t = uTime + group * 41.0;
  float k = t / 26.0;
  float i = floor(k);
  float f = fract(k);
  float p0 = mod(i + group * 2.0, 6.0);
  float p1 = mod(i + 1.0 + group * 2.0, 6.0);
  vec3 a = structLedProgram(p0, u, v, t, group * 0.173);
  vec3 b = structLedProgram(p1, u, v, t, group * 0.173);
  return structLedNormalize(mix(a, b, smoothstep(0.82, 1.0, f)));
}

vec3 structKelvin(float idx) {
  if (idx < 0.5) return vec3(1.0, 0.72, 0.42);   // ~2700 K sodium-ish warm
  if (idx < 1.5) return vec3(1.0, 0.86, 0.68);   // ~3500 K
  if (idx < 2.5) return vec3(0.92, 0.95, 1.0);   // ~5500 K neutral
  return vec3(0.75, 0.85, 1.0);                  // cool LED
}
`;
