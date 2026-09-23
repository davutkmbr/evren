/**
 * Tileable procedural bark (one texture array layer per species). Periodic value noise / Voronoi keep every
 * pattern seamless in both directions (the tubes wrap u around the branch and repeat v along it).
 * Outputs: albedo (linear, written to an sRGB target) and (normal.xy, cavity AO, roughness).
 */
export const BARK_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BARK_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outAlbedo;
layout(location = 1) out vec4 outNormal;
uniform int uType;
uniform float uTexel;

float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 h22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float pnoise(vec2 p, vec2 per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = h21(mod(i, per));
  float b = h21(mod(i + vec2(1.0, 0.0), per));
  float c = h21(mod(i + vec2(0.0, 1.0), per));
  float d = h21(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pfbm(vec2 p, vec2 per, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * pnoise(p, per);
    n += a;
    p *= 2.0;
    per *= 2.0;
    a *= 0.5;
  }
  return s / n;
}
/* Periodic Voronoi with anisotropic metric: x = F1, y = F2 - F1 (edge distance), z = cell hash. */
vec3 pvoronoi(vec2 p, vec2 per, vec2 stretch, float jitter) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0, f2 = 8.0;
  float id = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 cell = mod(i + g, per);
      vec2 o = 0.5 + (h22(cell) - 0.5) * jitter;
      vec2 r = (g + o - f) * stretch;
      float d = length(r);
      if (d < f1) { f2 = f1; f1 = d; id = h21(cell + 17.0); }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3(f1, f2 - f1, id);
}

/* Height in [0, 1] and colour for each bark type. */
float barkHeight(vec2 uv, out vec3 col, out float rough) {
  rough = 0.9;
  if (uType == 0) {
    // Stone pine: large elongated orange-brown plates split by deep dark fissures, flaking grey skins.
    vec2 w = uv + 0.035 * vec2(pfbm(uv * vec2(6.0, 4.0), vec2(6.0, 4.0), 3) - 0.5, 0.0);
    vec3 v = pvoronoi(w * vec2(4.0, 3.0), vec2(4.0, 3.0), vec2(1.0, 0.55), 0.85);
    float edge = smoothstep(0.02, 0.16, v.y);
    float flakes = pfbm(uv * vec2(16.0, 40.0), vec2(16.0, 40.0), 4);
    float strata = pnoise(uv * vec2(3.0, 64.0) + v.z * 7.0, vec2(3.0, 64.0));
    float h = edge * (0.62 + 0.25 * flakes + 0.13 * strata);
    vec3 plate = mix(vec3(0.2, 0.085, 0.042), vec3(0.15, 0.115, 0.09), smoothstep(0.35, 0.75, flakes + v.z * 0.25));
    plate = mix(plate, vec3(0.27, 0.12, 0.06), smoothstep(0.7, 0.95, strata) * 0.6);
    col = mix(vec3(0.035, 0.022, 0.016), plate, smoothstep(0.08, 0.5, h));
    return h;
  }
  if (uType == 1) {
    // Black / red pine: grey-black plates, reddish inner layers in the fissures.
    vec3 v = pvoronoi(uv * vec2(5.0, 3.0), vec2(5.0, 3.0), vec2(1.0, 0.5), 0.9);
    float edge = smoothstep(0.01, 0.13, v.y);
    float n = pfbm(uv * vec2(12.0, 24.0), vec2(12.0, 24.0), 4);
    float h = edge * (0.6 + 0.4 * n);
    vec3 plate = mix(vec3(0.1, 0.09, 0.085), vec3(0.2, 0.19, 0.18), smoothstep(0.3, 0.8, n + v.z * 0.3));
    vec3 inner = vec3(0.16, 0.06, 0.03);
    col = mix(mix(vec3(0.025, 0.02, 0.018), inner, smoothstep(0.02, 0.1, h)), plate, smoothstep(0.15, 0.5, h));
    return h;
  }
  if (uType == 2) {
    // Cypress: fibrous longitudinal strips, grey over red-brown.
    vec2 w = uv + vec2(0.02 * pnoise(uv * vec2(2.0, 3.0), vec2(2.0, 3.0)), 0.0);
    float strips = pfbm(w * vec2(26.0, 2.0), vec2(26.0, 2.0), 5);
    float fine = pnoise(w * vec2(90.0, 6.0), vec2(90.0, 6.0));
    float h = pow(strips, 1.5) * 0.85 + fine * 0.15;
    vec3 base = mix(vec3(0.16, 0.08, 0.045), vec3(0.27, 0.24, 0.21), smoothstep(0.35, 0.7, h));
    col = base * (0.8 + 0.3 * fine);
    return h;
  }
  if (uType == 3) {
    // Plane: smooth bark shedding in jigsaw patches (cream, olive, grey-brown).
    float n1 = pfbm(uv * 3.0, vec2(3.0), 5);
    float n2 = pfbm(uv * 5.0 + 7.3, vec2(5.0), 4);
    float fine = pnoise(uv * 48.0, vec2(48.0));
    float layer = n1 + 0.35 * n2;
    float step1 = smoothstep(0.47, 0.5, layer);
    float step2 = smoothstep(0.66, 0.69, layer);
    float step3 = smoothstep(0.34, 0.37, layer);
    vec3 c = vec3(0.1, 0.085, 0.065);
    c = mix(c, vec3(0.15, 0.145, 0.095), step3);
    c = mix(c, vec3(0.34, 0.31, 0.2), step1);
    c = mix(c, vec3(0.22, 0.225, 0.17), step2);
    col = c * (0.92 + 0.12 * fine);
    rough = 0.72;
    return 0.5 + 0.12 * (step1 + step2 + step3) + 0.04 * fine;
  }
  if (uType == 4) {
    // Oak / chestnut: deep vertical furrows between interlaced ridges, grey with lichen.
    vec2 w = uv + vec2(0.08 * (pfbm(uv * vec2(3.0, 2.0), vec2(3.0, 2.0), 3) - 0.5), 0.0);
    float ridge = 1.0 - abs(pnoise(w * vec2(10.0, 1.5), vec2(10.0, 1.5)) * 2.0 - 1.0);
    ridge = pow(ridge, 1.8);
    vec3 v = pvoronoi(uv * vec2(8.0, 5.0), vec2(8.0, 5.0), vec2(1.0, 0.7), 0.9);
    float crack = smoothstep(0.0, 0.06, v.y);
    float fine = pfbm(uv * vec2(30.0, 30.0), vec2(30.0), 4);
    float h = ridge * mix(0.75, 1.0, crack) * (0.8 + 0.2 * fine);
    vec3 c = mix(vec3(0.04, 0.035, 0.03), mix(vec3(0.17, 0.15, 0.13), vec3(0.26, 0.24, 0.21), fine), smoothstep(0.1, 0.55, h));
    float lichen = smoothstep(0.62, 0.72, pfbm(uv * 6.0 + 3.1, vec2(6.0), 4)) * smoothstep(0.4, 0.7, h);
    col = mix(c, vec3(0.33, 0.36, 0.26), lichen * 0.6);
    return h;
  }
  // Palm (Phoenix): diamond lattice of old leaf-base scars with fibrous grooves.
  vec2 q = uv * vec2(1.0, 1.0);
  vec2 a = fract(q) - 0.5;
  vec2 b = fract(q + 0.5) - 0.5;
  float da = abs(a.x) * 1.0 + abs(a.y) * 1.25;
  float db = abs(b.x) * 1.0 + abs(b.y) * 1.25;
  float d = min(da, db);
  float cellId = da < db ? h21(floor(q) + 3.0) : h21(floor(q + 0.5) + 9.0);
  float fib = pnoise(uv * vec2(40.0, 6.0), vec2(40.0, 6.0));
  float groove = smoothstep(0.44, 0.52, 0.62 - d + 0.04 * fib);
  float h = (1.0 - d * 1.2) * 0.8 * groove + 0.2 * fib;
  vec3 c = mix(vec3(0.06, 0.045, 0.03), mix(vec3(0.24, 0.19, 0.13), vec3(0.34, 0.3, 0.24), cellId * 0.6 + fib * 0.4), groove);
  col = c;
  return clamp(h, 0.0, 1.0);
}

void main() {
  vec3 col;
  float rough;
  float h = barkHeight(vUv, col, rough);
  vec3 cx, cy;
  float rx, ry;
  float hx = barkHeight(vUv + vec2(uTexel, 0.0), cx, rx);
  float hy = barkHeight(vUv + vec2(0.0, uTexel), cy, ry);
  float depth = uType == 3 ? 2.5 : uType == 5 ? 6.0 : 9.0;
  vec3 n = normalize(vec3((h - hx) * depth, (h - hy) * depth, 1.0));
  float cavity = mix(0.45, 1.0, smoothstep(0.0, 0.55, h));
  outAlbedo = vec4(col, 1.0);
  outNormal = vec4(n.xy * 0.5 + 0.5, cavity, rough);
}
`;
