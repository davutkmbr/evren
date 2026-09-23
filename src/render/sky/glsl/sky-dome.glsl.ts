import { SHARED_GLSL } from '../../shaders';
import { MEDIUM_GLSL } from './medium.glsl';

/** Sky dome: drawn first (no depth test/write) so the depth buffer keeps 0 (= far, reversed-Z) behind it. */
export const SKY_DOME_VERTEX = /* glsl */ `
varying vec3 vSkyDir;
void main() {
  vSkyDir = position;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(clip.xy, 0.5 * clip.w, clip.w);
}
`;

export const SKY_DOME_FRAGMENT = /* glsl */ `
#define USE_TRANSMITTANCE_LUT
${SHARED_GLSL}
${MEDIUM_GLSL}
uniform sampler2D uMoonTex;
uniform sampler2D uMilkyWayTex;
uniform vec3 uSunDiskRadiance;
uniform float uSunRadius;
uniform vec3 uSunUp;
uniform float uSunFlatten;
uniform vec3 uMoonDirL;
uniform vec3 uMoonRight;
uniform vec3 uMoonUp;
uniform float uMoonRadius;
uniform vec3 uMoonRadiance;
uniform float uMoonEarthshine;
uniform mat3 uLocalToGalactic;
uniform vec3 uMilkyWayRadiance;
uniform float uDrawDisks;
varying vec3 vSkyDir;

vec3 sunDisk(vec3 dir) {
  vec3 off = dir - uSunDir;
  float vertical = dot(off, uSunUp);
  vec3 horiz = off - uSunUp * vertical;
  float d = length(horiz + uSunUp * vertical * uSunFlatten) / uSunRadius;
  float aa = max(fwidth(d), 1e-3);
  float mask = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
  if (mask <= 0.0) return vec3(0.0);
  float mu = sqrt(max(1.0 - min(d, 1.0) * min(d, 1.0), 0.0));
  vec3 limb = 1.0 - (1.0 - pow(vec3(mu), vec3(0.397, 0.503, 0.652)));
  return uSunDiskRadiance * limb * mask;
}

vec4 moonDisk(vec3 dir) {
  vec2 p = vec2(dot(dir, uMoonRight), dot(dir, uMoonUp)) / uMoonRadius;
  vec2 uv = p * 0.5 + 0.5;
  vec2 uvDx = dFdx(uv);
  vec2 uvDy = dFdy(uv);
  float rr = dot(p, p);
  float d = sqrt(rr);
  float aa = max(fwidth(d), 1e-3);
  float mask = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
  if (mask <= 0.0 || dot(dir, uMoonDirL) < 0.0) return vec4(0.0);
  float mu = sqrt(max(1.0 - min(rr, 1.0), 0.0));
  vec3 n = uMoonRight * p.x + uMoonUp * p.y - uMoonDirL * mu;
  vec4 tex = textureGrad(uMoonTex, uv, uvDx, uvDy);
  // Relief from the height channel: finite differences at the pixel footprint (crater rims catch the light along
  // the terminator; invisible on the full disk).
  float step = max(max(length(uvDx), length(uvDy)), 1.0 / float(textureSize(uMoonTex, 0).x));
  float hx = textureGrad(uMoonTex, uv + vec2(step, 0.0), uvDx, uvDy).a - textureGrad(uMoonTex, uv - vec2(step, 0.0), uvDx, uvDy).a;
  float hy = textureGrad(uMoonTex, uv + vec2(0.0, step), uvDx, uvDy).a - textureGrad(uMoonTex, uv - vec2(0.0, step), uvDx, uvDy).a;
  vec2 slope = vec2(hx, hy) / (4.0 * step) * max(mu, 0.15);
  vec3 nb = normalize(n - (uMoonRight * slope.x + uMoonUp * slope.y) * 3.0);
  float mu0 = dot(nb, uSunDir);
  float mu0s = dot(n, uSunDir);
  float lommel = max(mu0, 0.0) / max(max(mu0s, 0.0) + mu, 1e-3);
  float terminator = smoothstep(-0.02, 0.06, mu0);
  vec3 L = uMoonRadiance * tex.rgb * (lommel * terminator * 2.0 + uMoonEarthshine);
  return vec4(L, mask);
}

vec3 milkyWay(vec3 dir) {
  vec3 g = uLocalToGalactic * dir;
  float l = atan(g.y, g.x);
  float b = asin(clamp(g.z, -1.0, 1.0));
  vec2 uv = vec2(l / (2.0 * PI) + 0.5, b / PI + 0.5);
  return texture(uMilkyWayTex, uv).rgb * uMilkyWayRadiance;
}

void main() {
  vec3 dir = normalize(vSkyDir);
  vec4 sky = atmoSkyViewSample(dir);
  vec3 L = sky.rgb;
  float dip = atmoHorizonDip(uAtmoState.x);
  if (dir.y < -dip) {
    L += sky.a * uAtmoGround;
  } else {
    float rKm = ATMO_RG + max(uAtmoState.x, 1.0) * 0.001;
    vec3 Tview = sampleTransmittance(rKm, dir.y);
    vec3 space = vec3(0.0);
    if (dot(uMilkyWayRadiance, vec3(1.0)) > 0.0) space += milkyWay(dir);
    if (uDrawDisks > 0.5) {
      vec4 moon = moonDisk(dir);
      space = mix(space, moon.rgb, moon.a);
      space += sunDisk(dir);
    }
    L += Tview * space;
  }
  gl_FragColor = vec4(L, 1.0);
}
`;
