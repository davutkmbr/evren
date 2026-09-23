import { SHARED_GLSL } from '../../render/shaders';

export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Full-resolution composite: scene (optionally heat-distorted) under the half-resolution premultiplied
 * particle layer, joint-bilateral upsampled with the full-resolution depth (no halos at silhouettes).
 */
export const COMPOSITE_FRAGMENT = /* glsl */ `
${SHARED_GLSL}

uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tVol;
uniform sampler2D tHeat;
uniform highp sampler3D tNoise;
uniform vec2 uLowSize;
uniform vec2 uFullSize;
uniform float uHasVol;
uniform float uHazeStrength;
uniform float uFxTime;

varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec4 vol = vec4(0.0);
  float heat = 0.0;
  if (uHasVol > 0.5) {
    float z = linearDepth(texture2D(tDepth, uv).r);
    vec2 f = uv * uLowSize - 0.5;
    vec2 i0 = floor(f);
    vec2 w = f - i0;
    vec2 tc[4];
    float zi[4];
    float bw[4];
    float izLerp = 0.0;
    for (int j = 0; j < 4; j++) {
      vec2 o = vec2(float(j & 1), float(j >> 1));
      tc[j] = (i0 + o + 0.5) / uLowSize;
      zi[j] = linearDepth(texture2D(tDepth, tc[j]).r);
      vec2 b2 = mix(1.0 - w, w, o);
      bw[j] = b2.x * b2.y;
      izLerp += bw[j] / zi[j];
    }
    // Inverse depth is linear in screen space on any plane: when the pixel matches the bilinear blend of the four
    // low-res taps it lies on the same smooth surface (even at grazing angles far away) and plain bilinear
    // filtering is right. Otherwise (a silhouette crosses the footprint) weight the taps by depth similarity.
    float iz = 1.0 / z;
    bool smoothSurface = abs(izLerp - iz) <= 0.035 * iz;
    float wsum = 0.0;
    for (int j = 0; j < 4; j++) {
      float ww = smoothSurface ? bw[j] : bw[j] * exp(-abs(zi[j] - z) / (0.03 * z + 0.08)) + 1e-6;
      vol += texture2D(tVol, tc[j]) * ww;
      heat += texture2D(tHeat, tc[j]).r * ww;
      wsum += ww;
    }
    vol = clamp(vol / wsum, vec4(0.0), vec4(60000.0, 60000.0, 60000.0, 1.0));
    heat = clamp(heat / wsum, 0.0, 4.0);
  }
  vec2 offset = vec2(0.0);
  if (heat > 1e-3) {
    float aspect = uFullSize.x / uFullSize.y;
    vec3 q = vec3(uv.x * aspect * 5.0, uv.y * 5.0 - uFxTime * 1.1, uFxTime * 0.35);
    vec2 n = texture(tNoise, q).ga - 0.5;
    n += (texture(tNoise, q * vec3(2.3, 2.3, 1.0) + 0.31).ga - 0.5) * 0.5;
    offset = n * min(heat, 1.5) * uHazeStrength / uFullSize;
  }
  vec4 scene = texture2D(tScene, uv + offset);
  gl_FragColor = vec4(vol.rgb + scene.rgb * (1.0 - vol.a), scene.a);
}
`;

/** Renders one Z slice of a tileable 3D noise volume. uMode 0 = cloud-like noise (RGBA), 1 = curl field. */
export const NOISE_GEN_FRAGMENT = /* glsl */ `
${SHARED_GLSL}

uniform float uZ;
uniform int uMode;
varying vec2 vUv;

vec3 gradP(vec3 cell, float period) {
  vec3 h = hash33(mod(cell, period) + vec3(0.137, 0.731, 0.411)) * 2.0 - 1.0;
  return normalize(h + vec3(1e-4));
}

float gradNoise(vec3 x, float period) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(gradP(i, period), f);
  float n100 = dot(gradP(i + vec3(1, 0, 0), period), f - vec3(1, 0, 0));
  float n010 = dot(gradP(i + vec3(0, 1, 0), period), f - vec3(0, 1, 0));
  float n110 = dot(gradP(i + vec3(1, 1, 0), period), f - vec3(1, 1, 0));
  float n001 = dot(gradP(i + vec3(0, 0, 1), period), f - vec3(0, 0, 1));
  float n101 = dot(gradP(i + vec3(1, 0, 1), period), f - vec3(1, 0, 1));
  float n011 = dot(gradP(i + vec3(0, 1, 1), period), f - vec3(0, 1, 1));
  float n111 = dot(gradP(i + vec3(1, 1, 1), period), f - vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float gradFbm(vec3 p, float freq, int octaves) {
  float s = 0.0;
  float a = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    s += a * gradNoise(p * freq, freq);
    norm += a;
    freq *= 2.0;
    a *= 0.5;
  }
  return s / norm;
}

float worley(vec3 p, float period) {
  vec3 x = p * period;
  vec3 i = floor(x);
  vec3 f = fract(x);
  float d = 1e9;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int xx = -1; xx <= 1; xx++) {
        vec3 o = vec3(float(xx), float(y), float(z));
        vec3 fp = o + hash33(mod(i + o, period) + vec3(3.1, 7.7, 1.3)) - f;
        d = min(d, dot(fp, fp));
      }
    }
  }
  return clamp(sqrt(d), 0.0, 1.0);
}

float remap(float v, float lo, float hi, float nlo, float nhi) {
  return nlo + (v - lo) / max(hi - lo, 1e-4) * (nhi - nlo);
}

void main() {
  vec3 p = vec3(vUv, uZ);
  if (uMode == 0) {
    float perlin = gradFbm(p, 4.0, 5) * 0.5 + 0.5;
    float w1 = 1.0 - worley(p, 4.0);
    float w2 = 1.0 - worley(p, 8.0);
    float w3 = 1.0 - worley(p, 16.0);
    float wfbm = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
    float perlinWorley = clamp(remap(perlin, wfbm - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
    float detail = gradFbm(p, 8.0, 4) * 0.5 + 0.5;
    float cells = (1.0 - worley(p, 6.0)) * 0.6 + (1.0 - worley(p, 12.0)) * 0.3 + (1.0 - worley(p, 24.0)) * 0.1;
    float fine = gradFbm(p, 16.0, 3) * 0.5 + 0.5;
    gl_FragColor = vec4(
      smoothstep(0.1, 0.9, perlinWorley),
      smoothstep(0.15, 0.85, detail),
      smoothstep(0.2, 0.95, cells),
      smoothstep(0.15, 0.85, fine));
  } else {
    float e = 1.0 / 64.0;
    float period = 4.0;
    vec3 q = p * period;
    vec3 o1 = vec3(0.0);
    vec3 o2 = vec3(1.7, 9.2, 3.3);
    vec3 o3 = vec3(8.3, 2.8, 5.1);
    vec3 dx = vec3(e * period, 0.0, 0.0);
    vec3 dy = vec3(0.0, e * period, 0.0);
    vec3 dz = vec3(0.0, 0.0, e * period);
    // psi = (A, B, C) with offsets in lattice space kept inside the period by gradP's mod.
    float Ay1 = gradNoise(q + o1 + dy, period), Ay0 = gradNoise(q + o1 - dy, period);
    float Az1 = gradNoise(q + o1 + dz, period), Az0 = gradNoise(q + o1 - dz, period);
    float Bx1 = gradNoise(q + o2 + dx, period), Bx0 = gradNoise(q + o2 - dx, period);
    float Bz1 = gradNoise(q + o2 + dz, period), Bz0 = gradNoise(q + o2 - dz, period);
    float Cx1 = gradNoise(q + o3 + dx, period), Cx0 = gradNoise(q + o3 - dx, period);
    float Cy1 = gradNoise(q + o3 + dy, period), Cy0 = gradNoise(q + o3 - dy, period);
    float inv = 1.0 / (2.0 * e * period);
    vec3 curl = vec3((Cy1 - Cy0) - (Bz1 - Bz0), (Az1 - Az0) - (Cx1 - Cx0), (Bx1 - Bx0) - (Ay1 - Ay0)) * inv;
    gl_FragColor = vec4(clamp(curl / 2.2 * 0.5 + 0.5, 0.0, 1.0), 1.0);
  }
}
`;
