/** Small helpers shared by the post shaders (kept independent from SHARED_GLSL on purpose). */
export const POST_COMMON_GLSL = /* glsl */ `
#ifndef POST_COMMON
#define POST_COMMON
const vec3 LUMA_REC709 = vec3(0.2126, 0.7152, 0.0722);

float postLuma(vec3 c) { return dot(c, LUMA_REC709); }

float postHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float postHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

/* Jimenez interleaved gradient noise: low-discrepancy per-pixel jitter. */
float interleavedGradientNoise(vec2 pixel, float frame) {
  pixel += 5.588238 * mod(frame, 64.0);
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

vec3 sanitizeHdr(vec3 c) {
  bvec3 bad = bvec3(isnan(c.r) || isinf(c.r), isnan(c.g) || isinf(c.g), isnan(c.b) || isinf(c.b));
  if (any(bad)) {
    return vec3(0.0);
  }
  return clamp(c, vec3(0.0), vec3(60000.0));
}

/* Reversed-Z float depth (1 = near, 0 = far) -> positive view distance along -Z. */
float postLinearDepth(float d, float near, float far) {
  return (far * near) / (d * (far - near) + near);
}
#endif
`;
