import { SHARED_GLSL } from '../../render/shaders';
import { PARTICLE_FRAG_GLSL } from './particle-common.glsl';

/**
 * Wing-tip vortex condensation ribbons. History points live in a small RGBA32F texture
 * (row = trail, 2 texels per point: pos.xyz age | intensity arcLength width valid), newest first.
 * The ribbon is expanded camera-facing in the vertex shader; the vortex sinks and drifts with the wind.
 */
export const TRAIL_VERTEX = /* glsl */ `
${SHARED_GLSL}

uniform highp sampler2D tTrail;
uniform int uPoints;
uniform vec3 uWindFx;
uniform float uSink;
uniform float uTanHalfFov;
uniform float uTargetHeight;

varying vec4 vRib;      // across (-1..1), age, intensity, arc length
varying float vDepth;
varying vec3 vWorldPos;
varying vec3 vLight;
varying vec3 vAtmoT;
varying vec3 vAtmoIn;

vec3 pointPos(int k, int row, out vec4 meta) {
  k = clamp(k, 0, uPoints - 1);
  vec4 a = texelFetch(tTrail, ivec2(k * 2, row), 0);
  meta = texelFetch(tTrail, ivec2(k * 2 + 1, row), 0);
  return a.xyz + (uWindFx * 0.85 + vec3(0.0, -uSink, 0.0)) * a.w;
}

void main() {
  int k = int(position.x + 0.5);
  float side = position.y;
  int row = gl_InstanceID;
  vec4 a = texelFetch(tTrail, ivec2(k * 2, row), 0);
  vec4 meta;
  vec3 p = pointPos(k, row, meta);
  vec4 mPrev;
  vec4 mNext;
  vec3 prev = pointPos(k - 1, row, mPrev);
  vec3 next = pointPos(k + 1, row, mNext);
  if (k == uPoints - 1 || mNext.w < 0.5) next = p + (p - prev);
  if (k == 0) prev = p + (p - next);
  float age = a.w;
  vec3 tangent = next - prev;
  float tl = length(tangent);
  tangent = tl > 1e-4 ? tangent / tl : vec3(1.0, 0.0, 0.0);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 sideDir = cross(tangent, toCam);
  float sl = length(sideDir);
  sideDir = sl > 1e-4 ? sideDir / sl : vec3(0.0, 1.0, 0.0);
  float width = meta.z + 0.28 * age + 0.02 * age * age;
  // Never thinner than ~1.3 px (a sub-pixel ribbon breaks up into a crawling hairline); keep the energy constant.
  vec3 camFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float pixel = 2.0 * max(dot(p - cameraPosition, camFwd), 0.05) * uTanHalfFov / uTargetHeight;
  float drawWidth = max(width, 1.3 * pixel);
  vec3 wp = p + sideDir * side * drawWidth;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;

  vRib = vec4(side, age, meta.w > 0.5 ? meta.x * (width / drawWidth) : 0.0, meta.y);
  vDepth = -mv.z;
  vWorldPos = wp;
  vec3 viewDir = -toCam;
  float cosT = dot(viewDir, uSunDir);
  float ph = (1.0 - 0.49) / pow(max(1.0 + 0.49 - 1.4 * cosT, 1e-4), 1.5);
  float sunUp = smoothstep(-0.04, 0.06, uSunDir.y);
  vec3 amb = uAmbient + vec3(0.04, 0.05, 0.07) * uNight * smoothstep(0.0, 0.2, uMoonDir.y);
  // High-albedo vapour: multiple scattering keeps it brighter than the sky behind it, silver towards the sun.
  vLight = 0.95 * (uSunColor * sunUp * cloudShadow(p) * (0.7 + 0.5 * ph) + amb * 1.2) * (1.0 / PI);
  vAtmoIn = applyAtmosphere(vec3(0.0), p);
  vAtmoT = applyAtmosphere(vec3(1.0), p) - vAtmoIn;
}
`;

export const TRAIL_FRAGMENT = /* glsl */ `
${SHARED_GLSL}
${PARTICLE_FRAG_GLSL}

uniform highp sampler3D tNoise;
uniform float uTrailLife;
uniform sampler2D tVol;
uniform sampler2D tHeat;
uniform float uHasVol;

varying vec4 vRib;
varying float vDepth;
varying vec3 vWorldPos;
varying vec3 vLight;
varying vec3 vAtmoT;
varying vec3 vAtmoIn;

void main() {
  float across = vRib.x;
  float age = vRib.y;
  float intensity = vRib.z;
  float arc = vRib.w;
  float core = exp(-across * across * 3.2);
  vec3 nc = vec3(arc * 0.045, across * 0.18 + 0.5, age * 0.25);
  float n = texture(tNoise, nc).r * 0.65 + texture(tNoise, nc * vec3(3.1, 2.0, 1.3) + 0.21).g * 0.35;
  float lifeN = age / uTrailLife;
  float breakup = smoothstep(lifeN * 0.9 - 0.05, lifeN * 0.9 + 0.35, n);
  float fadeIn = smoothstep(0.0, 3.5, arc);
  float fade = exp(-age * 2.4 / uTrailLife) * (1.0 - smoothstep(0.7, 1.0, lifeN));
  float sceneZ = sceneViewDepth();
  float vis = clamp((sceneZ - vDepth) / 0.6 + 0.3, 0.0, 1.0) * smoothstep(0.2, 0.8, vDepth);
  float a = clamp(core * breakup * fadeIn * fade * intensity * vis * 0.8, 0.0, 1.0);
  if (a <= 1e-4) discard;
  if (uHasVol > 0.5) {
    // The soft particle layer is already composited under the ribbons: hide the ribbon by the opacity of the smoke
    // that lies in front of it (alpha-weighted mean depth of the layer, soft over a few metres).
    vec2 suv = gl_FragCoord.xy * uInvTarget;
    float smokeA = texture2D(tVol, suv).a;
    vec2 wd = texture2D(tHeat, suv).gb;
    if (smokeA > 0.003 && wd.y > 1e-4) {
      float smokeZ = exp2(wd.x / wd.y) - 1.0;
      float front = smoothstep(-1.0, 1.0, (vDepth - smokeZ) / (2.0 + 0.05 * smokeZ));
      a *= 1.0 - smokeA * front;
    }
  }
  gl_FragColor = clamp(vec4((vLight * vAtmoT + vAtmoIn) * a, a), 0.0, 60000.0);
}
`;
