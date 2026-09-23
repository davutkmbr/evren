import { POST_COMMON_GLSL } from './common.glsl';

/**
 * Output pass at display resolution: Catmull-Rom (5-tap, 2x2 anti-ringing clamp) upscale when the internal resolution differs,
 * contrast-adaptive sharpening (AMD CAS weights on the source neighbourhood), luminance-shaped film grain
 * and triangular dithering before 8-bit quantisation.
 */
export const FINAL_FRAG = /* glsl */ `
${POST_COMMON_GLSL}
uniform sampler2D tSource;
uniform vec2 uSrcSize;
uniform vec2 uSrcTexel;
uniform float uUpscale;
uniform float uSharpness;
uniform float uGrain;
uniform float uFrame;
varying vec2 vUv;

vec3 catmullRom(vec2 uv) {
  vec2 samplePos = uv * uSrcSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 offset12 = w2 / w12;
  vec2 tc0 = (texPos1 - 1.0) * uSrcTexel;
  vec2 tc3 = (texPos1 + 2.0) * uSrcTexel;
  vec2 tc12 = (texPos1 + offset12) * uSrcTexel;
  vec3 r = textureLod(tSource, vec2(tc12.x, tc0.y), 0.0).rgb * (w12.x * w0.y);
  r += textureLod(tSource, vec2(tc0.x, tc12.y), 0.0).rgb * (w0.x * w12.y);
  r += textureLod(tSource, tc12, 0.0).rgb * (w12.x * w12.y);
  r += textureLod(tSource, vec2(tc3.x, tc12.y), 0.0).rgb * (w3.x * w12.y);
  r += textureLod(tSource, vec2(tc12.x, tc3.y), 0.0).rgb * (w12.x * w3.y);
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  // Anti-ringing: clamp to the range of the 2x2 source texels around the sample (no halos at hard edges).
  ivec2 base = ivec2(texPos1 - 0.5);
  ivec2 maxP = ivec2(uSrcSize) - 1;
  vec3 c00 = texelFetch(tSource, clamp(base, ivec2(0), maxP), 0).rgb;
  vec3 c10 = texelFetch(tSource, clamp(base + ivec2(1, 0), ivec2(0), maxP), 0).rgb;
  vec3 c01 = texelFetch(tSource, clamp(base + ivec2(0, 1), ivec2(0), maxP), 0).rgb;
  vec3 c11 = texelFetch(tSource, clamp(base + ivec2(1, 1), ivec2(0), maxP), 0).rgb;
  vec3 mn = min(min(c00, c10), min(c01, c11));
  vec3 mx = max(max(c00, c10), max(c01, c11));
  return clamp(r / wsum, mn, mx);
}

void main() {
  vec3 e;
  vec3 b;
  vec3 d;
  vec3 f;
  vec3 h;
  if (uUpscale > 0.5) {
    e = catmullRom(vUv);
    b = textureLod(tSource, vUv + vec2(0.0, uSrcTexel.y), 0.0).rgb;
    h = textureLod(tSource, vUv - vec2(0.0, uSrcTexel.y), 0.0).rgb;
    d = textureLod(tSource, vUv - vec2(uSrcTexel.x, 0.0), 0.0).rgb;
    f = textureLod(tSource, vUv + vec2(uSrcTexel.x, 0.0), 0.0).rgb;
  } else {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 maxP = ivec2(uSrcSize) - 1;
    e = texelFetch(tSource, p, 0).rgb;
    b = texelFetch(tSource, min(p + ivec2(0, 1), maxP), 0).rgb;
    h = texelFetch(tSource, max(p - ivec2(0, 1), ivec2(0)), 0).rgb;
    d = texelFetch(tSource, max(p - ivec2(1, 0), ivec2(0)), 0).rgb;
    f = texelFetch(tSource, min(p + ivec2(1, 0), maxP), 0).rgb;
  }
  vec3 col = e;
  if (uSharpness > 0.0) {
    vec3 mn = min(min(min(d, e), min(f, b)), h);
    vec3 mx = max(max(max(d, e), max(f, b)), h);
    vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
    vec3 w = amp * (-1.0 / mix(8.0, 5.0, uSharpness));
    col = clamp((b * w + d * w + f * w + h * w + e) / (1.0 + 4.0 * w), 0.0, 1.0);
  }

  vec2 px = gl_FragCoord.xy;
  if (uGrain > 0.0) {
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    float n = postHash13(vec3(px, mod(uFrame, 1024.0))) + postHash13(vec3(px + 17.3, mod(uFrame, 1024.0) + 0.5)) - 1.0;
    float shape = 4.0 * sqrt(max(l, 0.0)) * (1.0 - l) + 0.15;
    col += n * uGrain * shape;
  }
  float dither = postHash12(px + fract(uFrame * 0.618034) * 131.0) + postHash12(px * 1.37 + 57.0 - fract(uFrame * 0.618034) * 71.0) - 1.0;
  col += dither / 255.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/** Debug visualisations drawn instead of the final pass (?postdebug=...). */
export const DEBUG_FRAG = /* glsl */ `
${POST_COMMON_GLSL}
uniform sampler2D tSource;
uniform sampler2D tDepth;
uniform int uMode;
uniform float uExposure;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;

vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  return clamp(vec3(1.5 - abs(4.0 * t - 3.0), 1.5 - abs(4.0 * t - 2.0), 1.5 - abs(4.0 * t - 1.0)), 0.0, 1.0);
}

void main() {
  if (uMode == 1) {
    vec3 c = textureLod(tSource, vUv, 0.0).rgb * uExposure;
    gl_FragColor = vec4(pow(c / (1.0 + c), vec3(1.0 / 2.2)), 1.0);
  } else if (uMode == 2) {
    float l = postLuma(textureLod(tSource, vUv, 0.0).rgb);
    gl_FragColor = vec4(heat((log2(max(l, 1e-6)) + 10.0) / 16.0), 1.0);
  } else if (uMode == 3) {
    float d = textureLod(tDepth, vUv, 0.0).r;
    float z = d <= 0.0 ? uFar : postLinearDepth(d, uNear, uFar);
    gl_FragColor = vec4(vec3(1.0 - log2(z) / log2(uFar)), 1.0);
  } else {
    gl_FragColor = vec4(textureLod(tSource, vUv, 0.0).rgb, 1.0);
  }
}
`;
