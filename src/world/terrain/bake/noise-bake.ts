import * as THREE from 'three';
import { COMMON_GLSL } from '../../../render/shaders';
import { NOISE_TEX_SIZE } from '../config';
import { bakeMaterial, type GpuBaker } from './gpu-baker';

/**
 * Tiling multi-octave noise (NOISE_TEX_SIZE² RGBA8, linear, mipmapped). Every channel is an independent periodic
 * field in [0, 1] with mean ~0.5: R/G value-noise fbm (base period 4, 6 octaves), B fbm (base period 8, 5 octaves),
 * A cellular "blob" field (1 - F1, period 8). One filtered fetch replaces several ALU noise octaves and never aliases.
 */
const NOISE_FRAG = /* glsl */ `
${COMMON_GLSL}
varying vec2 vUv;

float hashP(vec2 c, float period, float seed) {
  c = mod(c, period);
  return hash12(c + vec2(seed * 37.1, seed * 11.7));
}

float valueP(vec2 p, float period, float seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hashP(i, period, seed);
  float b = hashP(i + vec2(1.0, 0.0), period, seed);
  float c = hashP(i + vec2(0.0, 1.0), period, seed);
  float d = hashP(i + vec2(1.0, 1.0), period, seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbmP(vec2 uv, float period, int octaves, float seed) {
  float s = 0.0;
  float a = 0.5;
  float n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    s += a * valueP(uv * period, period, seed + float(i) * 3.1);
    n += a;
    period *= 2.0;
    a *= 0.5;
  }
  return s / n;
}

float cellP(vec2 uv, float period, float seed) {
  vec2 p = uv * period;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 9.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 c = mod(i + o, period);
      vec2 r = o + 0.15 + 0.7 * hash22(c + seed * 13.0) - f;
      d1 = min(d1, dot(r, r));
    }
  }
  return 1.0 - clamp(sqrt(d1), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  float r = fbmP(uv, 4.0, 6, 1.0);
  float g = fbmP(uv, 4.0, 6, 7.0);
  float b = fbmP(uv, 8.0, 5, 13.0);
  float a = cellP(uv, 8.0, 19.0) * 0.75 + fbmP(uv, 32.0, 3, 23.0) * 0.25;
  // Stretch toward [0, 1] (fbm of value noise concentrates around 0.5).
  vec4 n = clamp((vec4(r, g, b, a) - 0.5) * vec4(1.9, 1.9, 1.8, 1.4) + 0.5, 0.0, 1.0);
  gl_FragColor = n;
}
`;

export function bakeNoiseTexture(baker: GpuBaker): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(NOISE_TEX_SIZE, NOISE_TEX_SIZE, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    generateMipmaps: true,
    depthBuffer: false,
    anisotropy: 4,
  });
  target.texture.name = 'terrain-noise';
  const material = bakeMaterial(NOISE_FRAG, {});
  baker.render(material, target);
  material.dispose();
  return target;
}
