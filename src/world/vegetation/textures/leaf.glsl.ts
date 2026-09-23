/**
 * Foliage card texture baking: every leaf, needle, scale segment and twig is an instanced quad drawn in
 * painter's order (no depth test) into one texture array layer. Shapes are analytic (per fragment inside test).
 *   iA = (base.x, base.y, angle, length)      texture space [0, 1]
 *   iB = (half width, shape, roll, pitch)     shape: 0 lanceolate, 1 oak, 2 palmate, 3 needle, 4 scale, 5 leaflet, 6 twig
 *   iC = (colour mix, brightness, order, fold)
 */
export const LEAF_VERTEX = /* glsl */ `
in vec4 iA;
in vec4 iB;
in vec4 iC;
out vec2 vLocal;
flat out vec4 vB;
flat out vec4 vC;
flat out vec2 vDir;
void main() {
  vec2 dir = vec2(cos(iA.z), sin(iA.z));
  vec2 perp = vec2(-dir.y, dir.x);
  // position.xy in [-0.5, 0.5]: x along the leaf (0..1), y across (-1..1) with a small margin.
  float x = position.x * 1.04 + 0.5;
  float y = position.y * 2.0 * 1.15;
  vec2 p = iA.xy + dir * (x * iA.w) + perp * (y * iB.x);
  vLocal = vec2(x, y);
  vB = iB;
  vC = iC;
  vDir = dir;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const LEAF_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vLocal;
flat in vec4 vB;
flat in vec4 vC;
flat in vec2 vDir;
layout(location = 0) out vec4 outAlbedo;
layout(location = 1) out vec4 outNormal;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uTwigColor;
uniform float uTranslucency;

float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/* Signed margin (> 0 inside) of the blade at leaf-local l = (x along 0..1, y across in half widths). */
float leafMargin(vec2 l, int shape, out float vein, out float width, out bool petiole) {
  float x = l.x;
  float y = l.y;
  vein = 0.0;
  petiole = false;
  width = 1.0;
  if (shape == 0) {
    if (x < 0.07) { petiole = true; width = 0.07; return 0.07 - abs(y); }
    float t = (x - 0.07) / 0.93;
    width = pow(sin(3.14159 * pow(t, 0.85)), 0.8) * (1.0 - 0.08 * fract(t * 26.0));
    vein = 1.0 - smoothstep(0.0, 0.05, abs(fract(t * 13.0 - abs(y) * 0.9) - 0.5) - 0.42);
    return width - abs(y);
  }
  if (shape == 1) {
    if (x < 0.06) { petiole = true; width = 0.08; return 0.08 - abs(y); }
    float t = (x - 0.06) / 0.94;
    float w0 = pow(sin(3.14159 * pow(t, 0.75)), 0.85) * (0.55 + 0.45 * t);
    width = w0 * (0.6 + 0.4 * abs(sin(t * 3.14159 * 4.5 + 0.4)));
    vein = 1.0 - smoothstep(0.0, 0.06, abs(fract(t * 4.5 - abs(y) * 0.5) - 0.5) - 0.4);
    return width - abs(y);
  }
  if (shape == 2) {
    // Palmate plane leaf: five pointed lobes around the petiole junction at x = 0.24 (half width = 0.76 length).
    vec2 p = vec2((x - 0.24) / 0.76, y);
    float r = length(p);
    float th = atan(p.y, p.x);
    float lobe = 0.0;
    float nearest = 9.0;
    for (int i = -2; i <= 2; i++) {
      float c = float(i) * 0.95;
      lobe = max(lobe, pow(max(cos((th - c) * 1.9), 0.0), 1.6));
      nearest = min(nearest, abs(th - c));
    }
    float R = (0.4 + 0.6 * lobe) * (1.0 - 0.05 * fract(th * 9.0));
    if (abs(th) > 2.45) R = 0.22;
    vein = 1.0 - smoothstep(0.0, 0.05, nearest * r);
    width = R;
    float blade = R - r;
    if (blade < 0.0 && x < 0.24 && x > 0.0 && abs(y) < 0.045) { petiole = true; width = 0.045; return 0.045 - abs(y); }
    return blade;
  }
  if (shape == 3) {
    width = 1.0 - pow(x, 6.0);
    return width - abs(y);
  }
  if (shape == 4) {
    float t = x * 2.0 - 1.0;
    width = sqrt(max(1.0 - t * t, 0.0)) * (0.85 + 0.15 * sin(x * 20.0));
    return width - abs(y);
  }
  if (shape == 5) {
    width = x < 0.03 ? 0.3 : pow(sin(3.14159 * x), 0.45) * (1.0 - 0.35 * x);
    return width - abs(y);
  }
  width = 1.0 - 0.45 * x;
  return width - abs(y);
}

void main() {
  int shape = int(vB.y + 0.5);
  float vein;
  float w;
  bool petiole;
  if (vLocal.x < -0.01 || vLocal.x > 1.0) discard;
  float margin = leafMargin(vLocal, shape, vein, w, petiole);
  if (margin < 0.0) discard;
  bool twig = shape == 6;
  // Tilted leaf plane (roll about the midrib, pitch along it) plus a V fold across the midrib.
  vec2 perp = vec2(-vDir.y, vDir.x);
  float side = vLocal.y >= 0.0 ? 1.0 : -1.0;
  vec2 tiltXY = perp * sin(vB.z) + vDir * sin(vB.w);
  vec2 foldXY = perp * side * vC.w * (1.0 - 0.5 * min(abs(vLocal.y), 1.0));
  vec3 n = normalize(vec3(tiltXY + foldXY, 1.0));
  if (twig || petiole) {
    n = normalize(vec3(perp * clamp(vLocal.y / max(w, 1e-3), -1.0, 1.0) * 0.9, 1.0));
  }
  vec3 col = mix(uColorA, uColorB, clamp(vC.x, 0.0, 1.0)) * vC.y;
  // Lighter midrib and veins, darker margins, slightly paler tip.
  float mid = shape == 2 ? 0.0 : 1.0 - smoothstep(0.0, 0.1, abs(vLocal.y) / max(w, 1e-3));
  col *= 1.0 + 0.3 * mid * (shape <= 2 ? 1.0 : 0.3) + 0.14 * vein;
  col *= 0.9 + 0.1 * smoothstep(0.0, 0.25, margin / max(w, 1e-3));
  col *= 0.88 + 0.12 * smoothstep(0.0, 1.0, vLocal.x);
  col *= 0.92 + 0.16 * h21(floor(gl_FragCoord.xy * 0.5));
  if (twig || petiole) {
    col = uTwigColor * vC.y * (0.8 + 0.4 * (1.0 - min(abs(vLocal.y) / max(w, 1e-3), 1.0)));
  }
  float ao = mix(0.5, 1.0, vC.z) * (twig ? 0.85 : 1.0);
  float trans = twig || petiole ? 0.0 : uTranslucency;
  outAlbedo = vec4(col, 1.0);
  outNormal = vec4(n.xy * 0.5 + 0.5, ao, trans);
}
`;
