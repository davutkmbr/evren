/**
 * Display transforms. All return DISPLAY-ENCODED (sRGB-like, gamma) values in [0,1].
 * TONEMAPPER: 0 = AgX (default, with ASC-CDL style look), 1 = ACES fitted (Hill), 2 = Khronos PBR Neutral.
 */
export const TONEMAP_GLSL = /* glsl */ `
vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

/* AgX (Troy Sobotka), polynomial fit of the default contrast sigmoid (Benjamin Wrensch). */
vec3 agxContrastApprox(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 agxTonemap(vec3 color, vec3 slope, float power, float saturation) {
  const mat3 agxInset = mat3(
    0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 agxOutset = mat3(
    1.19687900512017, -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  vec3 v = agxInset * max(color, vec3(1e-10));
  v = clamp(log2(max(v, vec3(1e-10))), minEv, maxEv);
  v = (v - minEv) / (maxEv - minEv);
  v = agxContrastApprox(v);
  // Look (ASC CDL: slope / power / saturation) in the encoded domain.
  v = pow(max(v * slope, vec3(0.0)), vec3(power));
  float l = dot(v, vec3(0.2126, 0.7152, 0.0722));
  v = l + saturation * (v - l);
  v = agxOutset * v;
  return clamp(v, 0.0, 1.0);
}

vec3 acesFittedTonemap(vec3 color) {
  const mat3 acesIn = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777);
  const mat3 acesOut = mat3(
    1.60475, -0.10208, -0.00327,
    -0.53108, 1.10813, -0.07276,
    -0.07367, -0.00605, 1.07602);
  vec3 v = acesIn * (color / 0.6);
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  v = acesOut * (a / b);
  return linearToSrgb(clamp(v, 0.0, 1.0));
}

vec3 pbrNeutralTonemap(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak >= startCompression) {
    const float d = 1.0 - startCompression;
    float newPeak = 1.0 - d * d / (peak + d - startCompression);
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    color = mix(color, vec3(newPeak), g);
  }
  return linearToSrgb(clamp(color, 0.0, 1.0));
}

vec3 displayTransform(vec3 color, vec3 slope, float power, float saturation) {
#if TONEMAPPER == 1
  vec3 c = acesFittedTonemap(color);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return clamp(l + saturation * (c - l), 0.0, 1.0);
#elif TONEMAPPER == 2
  vec3 c = pbrNeutralTonemap(color);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return clamp(l + saturation * (c - l), 0.0, 1.0);
#else
  return agxTonemap(color, slope, power, saturation);
#endif
}
`;
