/**
 * Per-pixel frame shared by every ground material, the tiling-noise helpers and the Mat accumulator.
 * All texture reads inside material branches use explicit gradients (non-uniform control flow).
 */
export const PIXEL_GLSL = /* glsl */ `
uniform sampler2D uNoise;
/* x = carpet start distance, y = 1 / carpet fade length, z = detail distance, w = analytic road distance. */
uniform vec4 uTerrainRanges;
/* x = emission scale, y = residential window occupancy (time of day), z = lights on (0..1). */
uniform vec4 uTerrainLights;

struct Px {
  vec2 p;
  vec2 dx;
  vec2 dy;
  /* Distance to the rendering camera (m). */
  float dist;
  /* Pixel footprint on the ground (m): geometric mean of the two screen axes, and the larger axis. */
  float fp;
  float fpMax;
  vec3 keyDir;
  vec2 keyXZ;
  float keyTan;
  /* Reflection pass or resources still baking: skip micro detail. */
  bool cheap;
};

Px pxMake(vec3 wp) {
  Px px;
  px.p = wp.xz;
  px.dx = dFdx(wp.xz);
  px.dy = dFdy(wp.xz);
  px.dist = distance(wp, cameraPosition);
  float lx = length(px.dx);
  float ly = length(px.dy);
  px.fp = sqrt(max(lx * ly, 1e-6));
  px.fpMax = max(lx, ly);
  px.keyDir = normalize(uKeyLightDir);
  float kxz = max(length(px.keyDir.xz), 1e-3);
  px.keyXZ = px.keyDir.xz / kxz;
  px.keyTan = px.keyDir.y / kxz;
  px.cheap = false;
  return px;
}

/* Tiling noise, world scale S (m): R/G fbm with features S/4..S/256, B fbm S/8..S/256, A cellular blobs of S/8. */
vec4 nTex(Px px, float S) {
  return textureGrad(uNoise, px.p / S, px.dx / S, px.dy / S);
}
vec4 nTexAt(Px px, vec2 p, float S) {
  return textureGrad(uNoise, p / S, px.dx / S, px.dy / S);
}

mat2 rotM(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

/* Antialiased step: 0 below edge, 1 above, transition over the pixel footprint w. */
float aaStep(float edge, float x, float w) {
  return clamp((x - edge) / max(w, 1e-4) + 0.5, 0.0, 1.0);
}

struct Mat {
  vec3 alb;
  vec2 slope;
  float rough;
  float ao;
  /* Key-light visibility (micro / statistical shadows). */
  float vis;
  vec3 emit;
};

Mat matMake(vec3 alb, float rough) {
  Mat m;
  m.alb = alb;
  m.slope = vec2(0.0);
  m.rough = rough;
  m.ao = 1.0;
  m.vis = 1.0;
  m.emit = vec3(0.0);
  return m;
}

Mat matZero() {
  Mat m = matMake(vec3(0.0), 0.0);
  m.ao = 0.0;
  m.vis = 0.0;
  return m;
}

void matAccum(inout Mat acc, Mat m, float w) {
  acc.alb += m.alb * w;
  acc.slope += m.slope * w;
  acc.rough += m.rough * w;
  acc.ao += m.ao * w;
  acc.vis += m.vis * w;
  acc.emit += m.emit * w;
}

Mat matMix(Mat a, Mat b, float t) {
  a.alb = mix(a.alb, b.alb, t);
  a.slope = mix(a.slope, b.slope, t);
  a.rough = mix(a.rough, b.rough, t);
  a.ao = mix(a.ao, b.ao, t);
  a.vis = mix(a.vis, b.vis, t);
  a.emit = mix(a.emit, b.emit, t);
  return a;
}

/* Warm-white lamp colours (linear): high-pressure sodium, 3000 K LED, 4000 K LED. */
const vec3 LAMP_SODIUM = vec3(1.0, 0.43, 0.1);
const vec3 LAMP_WARM = vec3(1.0, 0.62, 0.3);
const vec3 LAMP_COOL = vec3(0.9, 0.88, 0.8);
/* Window light (matches the city's far-field window colour, ~2900 K incandescent/LED mix). */
const vec3 WINDOW_LIGHT = vec3(1.0, 0.46, 0.15);

/*
 * Stable far-field sparkle: world cells of the pixel footprint's power-of-two size (blended across levels, so lights
 * never swim while the camera moves). Returns the fraction of the pixel lit by point lights of density rho (1/m²),
 * each exaggerated to cover about one pixel like the city's lamp sprites.
 */
float sparkleLevel(vec2 p, float cell, float rho, float seed) {
  vec2 c = floor(p / cell);
  float prob = clamp(rho * cell * cell, 0.0, 0.35);
  return step(hash12(c + seed), prob);
}
float sparkle(vec2 p, float fp, float rho, float seed) {
  float lod = log2(max(fp, 0.5)) + 0.35;
  float l0 = floor(lod);
  float a = sparkleLevel(p, exp2(l0), rho, seed + l0 * 13.1);
  float b = sparkleLevel(p, exp2(l0 + 1.0), rho, seed + (l0 + 1.0) * 13.1);
  return mix(a, b, lod - l0);
}
`;
