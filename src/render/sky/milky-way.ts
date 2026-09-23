import * as THREE from 'three';
import { renderFullscreen } from './moon-texture';

/**
 * Milky Way surface brightness in galactic coordinates (equirectangular, l = -180..180 deg, b = -90..90 deg), rendered
 * once on the GPU: thin disk + central bulge toward Sagittarius, Cygnus star clouds, the Great Rift dust lane and
 * clumpy dark nebulae. Values are relative (peak ~1).
 */
const FRAGMENT = /* glsl */ `
uniform vec2 uSize;
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 7; i++) { s += a * vnoise(p); p = p * 2.07 + 5.3; a *= 0.5; } return s; }

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float l = (uv.x - 0.5) * 6.2831853;
  float b = (uv.y - 0.5) * 3.1415927;
  vec3 g = vec3(cos(b) * cos(l), cos(b) * sin(l), sin(b));
  float lc = l;
  float bulge = exp(-pow(lc / 0.45, 2.0) - pow(b / 0.24, 2.0));
  float width = 0.1 + 0.09 * exp(-pow(lc / 0.9, 2.0));
  float along = 0.35 + 0.5 * exp(-pow(lc / 1.1, 2.0)) + 0.35 * exp(-pow((lc - 1.35) / 0.35, 2.0)) + 0.12 * exp(-pow((abs(lc) - 2.8) / 0.4, 2.0));
  float disk = exp(-pow(b / width, 2.0)) * along;
  float clouds = fbm(g * 9.0);
  float fine = fbm(g * 34.0 + 3.0);
  float brightness = disk * (0.55 + 0.9 * clouds * clouds) * (0.75 + 0.5 * fine) + bulge * 0.9;
  float riftCenter = 0.035 + 0.02 * sin(lc * 3.0);
  float rift = exp(-pow((b - riftCenter) / 0.03, 2.0)) * smoothstep(-0.2, 0.15, lc) * (1.0 - smoothstep(1.35, 1.6, lc));
  float dust = smoothstep(0.45, 0.75, fbm(g * 14.0 + 17.0)) * exp(-pow(b / (width * 1.3), 2.0));
  brightness *= 1.0 - 0.75 * rift * (0.6 + 0.8 * fbm(g * 20.0));
  brightness *= 1.0 - 0.55 * dust;
  float halo = 0.05 * exp(-pow(b / 0.5, 2.0));
  vec3 warm = vec3(1.0, 0.86, 0.72);
  vec3 cool = vec3(0.82, 0.88, 1.0);
  vec3 color = mix(cool, warm, clamp(bulge * 1.5 + 0.25 * exp(-pow(lc / 1.2, 2.0)), 0.0, 1.0));
  gl_FragColor = vec4(color * (brightness + halo), 1.0);
}
`;

export function createMilkyWayTexture(renderer: THREE.WebGLRenderer, width = 1024, height = 512): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
    wrapS: THREE.RepeatWrapping,
  });
  const material = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FRAGMENT,
    uniforms: { uSize: { value: new THREE.Vector2(width, height) } },
    depthTest: false,
    depthWrite: false,
  });
  renderFullscreen(renderer, material, target);
  material.dispose();
  return target;
}

/** J2000 equatorial -> galactic rotation (rows: galactic x toward the centre, y toward l = 90 deg, z = north pole). */
export const EQUATORIAL_TO_GALACTIC = new THREE.Matrix3().set(
  -0.0548755604,
  -0.8734370902,
  -0.4838350155,
  0.4941094279,
  -0.44482963,
  0.7469822445,
  -0.867666149,
  -0.1980763734,
  0.4559837762,
);
