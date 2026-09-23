/**
 * Shared helpers for the tile generators. Every pattern is periodic over the tile (hashes wrap cell indices), so the
 * baked textures repeat seamlessly. Coordinates are metres inside the tile, [0, T).
 */
export const TILE_COMMON_GLSL = /* glsl */ `
uniform float uTile;
uniform float uRes;
uniform int uPass;
varying vec2 vUv;

struct Gen {
  vec3 alb;
  float h;
  float warm;
  float cool;
  float id;
  float mask;
};

Gen genInit(vec3 alb, float h) {
  Gen g;
  g.alb = alb;
  g.h = h;
  g.warm = 0.0;
  g.cool = 0.0;
  g.id = 0.0;
  g.mask = 0.0;
  return g;
}

float hP(vec2 c, float period, float seed) {
  c = mod(c, period);
  return hash12(c * 1.0 + vec2(seed * 17.31, seed * 3.77));
}
vec2 h2P(vec2 c, float period, float seed) {
  c = mod(c, period);
  return hash22(c + vec2(seed * 31.7, seed * 11.3));
}
float noiseP(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hP(i, period, 0.0);
  float b = hP(i + vec2(1.0, 0.0), period, 0.0);
  float c = hP(i + vec2(0.0, 1.0), period, 0.0);
  float d = hP(i + vec2(1.0, 1.0), period, 0.0);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/* Periodic fbm: p in "base cells", period = cells per tile at the base octave. */
float fbmP(vec2 p, float period, int oct) {
  float s = 0.0;
  float a = 0.5;
  float n = 0.0;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    s += a * noiseP(p, period);
    n += a;
    p = p * 2.0 + vec2(13.1, 7.7);
    period *= 2.0;
    a *= 0.5;
  }
  return s / n;
}
/* Noise with a given feature size (m) over the tile T (period snapped so it tiles). */
float tnoise(vec2 q, float feature, int oct) {
  float period = max(1.0, floor(uTile / feature + 0.5));
  return fbmP(q / uTile * period, period, oct);
}

/* Periodic Voronoi (F1, F2, id) with cells of size "cell" metres. */
vec4 voronoiP(vec2 q, float cell, float jitter, float seed) {
  float period = max(1.0, floor(uTile / cell + 0.5));
  vec2 p = q / uTile * period;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + 0.5 + (h2P(i + o, period, seed) - 0.5) * jitter - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hP(i + o, period, seed + 5.0);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  float scale = uTile / period;
  return vec4(sqrt(d1) * scale, sqrt(d2) * scale, id, 0.0);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdRoundBox(vec2 p, vec2 b, float r) {
  return sdBox(p, b - r) - r;
}
mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}
vec3 srgbToLinear(vec3 c) {
  return pow(c, vec3(2.2));
}
vec3 hueJitter(vec3 c, float r, float amount) {
  return c * (1.0 + amount * (vec3(r, fract(r * 7.13), fract(r * 13.7)) - 0.5));
}

/* Car seen from above centred at p (local frame: x along the car). Returns coverage, writes albedo/height. */
float carTopDown(vec2 p, float seed, inout vec3 alb, inout float h) {
  float len = 4.2 + 0.5 * fract(seed * 7.1);
  float wid = 1.78;
  float d = sdRoundBox(p, vec2(len * 0.5, wid * 0.5), 0.45);
  if (d > 0.0) return 0.0;
  float r = fract(seed * 13.37);
  vec3 paint;
  if (r < 0.32) paint = vec3(0.62, 0.62, 0.6);
  else if (r < 0.52) paint = vec3(0.28, 0.29, 0.3);
  else if (r < 0.66) paint = vec3(0.025, 0.025, 0.028);
  else if (r < 0.74) paint = vec3(0.35, 0.03, 0.025);
  else if (r < 0.82) paint = vec3(0.04, 0.08, 0.2);
  else if (r < 0.88) paint = vec3(0.45, 0.38, 0.25);
  else if (r < 0.94) paint = vec3(0.55, 0.42, 0.05);
  else paint = vec3(0.12, 0.2, 0.3);
  float xn = p.x / len;
  float glass = step(abs(p.y), wid * 0.36) * (step(0.12, xn) * step(xn, 0.24) + step(-0.36, xn) * step(xn, -0.27));
  alb = mix(paint, vec3(0.02, 0.025, 0.03), glass);
  h = 1.45 - 0.25 * smoothstep(0.1, 0.5, abs(xn)) - 0.3 * smoothstep(0.6, 0.9, abs(p.y) / (wid * 0.5));
  return 1.0;
}

/* Deciduous/pine crown: returns dome height above ground or -1 outside. */
float crownDome(vec2 d, float r, float top) {
  float t = dot(d, d) / (r * r);
  if (t > 1.0) return -1.0;
  return top - t * r * 0.85;
}
`;
