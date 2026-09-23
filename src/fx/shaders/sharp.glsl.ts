import { SHARED_GLSL } from '../../render/shaders';
import { PARTICLE_COMMON_GLSL, PARTICLE_FRAG_GLSL } from './particle-common.glsl';

/**
 * Small full-resolution particles drawn as motion-blurred capsules (embers, sparks, droplets, debris; instances
 * [0, uSharpCount) index the live slot list) plus procedural speed motes (the instances after them) that live in a
 * box wrapped around the camera.
 * Sub-pixel sizes are clamped to ~1.2 px with alpha compensation (no shimmering). Premultiplied output;
 * emissive kinds write alpha 0 (additive).
 */
export const SHARP_VERTEX = /* glsl */ `
${SHARED_GLSL}
${PARTICLE_COMMON_GLSL}

attribute float aSlot;
uniform int uSharpCount;
uniform float uMoteBox;
uniform vec3 uMoteOffset;
uniform float uMoteStrength;
uniform float uMoteSize;
uniform sampler2D tBlackbody;

varying vec4 vQuad;     // local x/y (m), half segment length, radius
varying float vDepth;
varying float vAlpha;
flat varying int vKind;
varying vec3 vColor;
varying vec3 vAtmoT;
varying vec3 vAtmoIn;

vec3 blackbodyV(float T) {
  return textureLod(tBlackbody, vec2(clamp((T - 500.0) / 11500.0, 0.0, 1.0), 0.5), 0.0).rgb;
}

void cull() {
  gl_Position = vec4(0.0, 0.0, -10.0, 1.0);
  vAlpha = 0.0;
}

void main() {
  int id = gl_InstanceID;
  vec3 pos;
  vec3 vel;
  float size;
  float alpha = 1.0;
  float stretchK = 1.0;
  int kind;
  float seed;
  float age = 0.0;
  float lifeN = 0.0;
  float auxA = 0.0;
  float auxB = 0.0;

  if (id >= uSharpCount) {
    id -= uSharpCount;
    kind = 4;
    vec3 h = hash33(vec3(float(id) * 1.731, 17.13, 3.37));
    seed = h.x;
    vec3 rel = fract((h * uMoteBox + uMoteOffset - cameraPosition) / uMoteBox + 0.5) - 0.5;
    // Pull a third of the motes closer to the camera (denser near field, where streaks are long and readable).
    rel *= h.z < 0.33 ? 0.45 : 1.0;
    pos = cameraPosition + rel * uMoteBox;
    float dist = length(rel) * uMoteBox;
    alpha = uMoteStrength * smoothstep(1.6, 3.6, dist) * (1.0 - smoothstep(0.28 * uMoteBox, 0.5 * uMoteBox, dist));
    // Sparse and uneven: most motes are barely there, a few catch the light.
    alpha *= 0.12 + 0.88 * h.z * h.z;
    vel = uWindFx;
    size = uMoteSize * (0.5 + h.y);
    stretchK = 0.3 + 0.6 * fract(h.x * 7.31);
    if (alpha <= 0.002) {
      cull();
      return;
    }
  } else {
    Particle P = fetchParticle(int(aSlot + 0.5));
    age = uNow - P.birth;
    if (age < 0.0 || age >= P.life) {
      cull();
      return;
    }
    kind = P.type;
    seed = P.seed;
    auxA = P.auxA;
    auxB = P.auxB;
    lifeN = age / P.life;
    float rel;
    particleMotion(P, age, SHARP_GRAVITY[kind], SHARP_BUOY_DECAY[kind], SHARP_WIND[kind], pos, vel, rel);
    float amp = SHARP_TURB_AMP[kind] * (1.0 - exp(-age * 2.0));
    if (amp > 0.0) {
      float scroll = uNow * SHARP_TURB_SCROLL[kind];
      pos += curlNoise(pos * SHARP_TURB_FREQ[kind] + vec3(seed, -scroll, scroll * 0.3)) * amp;
    }
    float clearance = SHARP_CLEARANCE[kind];
    float s = dot(pos, P.planeN) - P.planeD;
    // auxC > 0.5: the collision surface is water (embers and sparks are quenched instead of resting on it).
    if (clearance < 0.0 || P.auxC > 0.5) {
      if (s < 0.0) {
        cull();
        return;
      }
    } else if (s < clearance) {
      pos -= P.planeN * (s - clearance);
      vel *= 0.0;
    }
    size = mix(P.size0, P.size1, lifeN);
    stretchK = SHARP_STRETCH[kind];
  }

  float depth = dot(pos - cameraPosition, camFwdWS());
  if (depth < 0.05) {
    cull();
    return;
  }
  // Perspective-correct motion blur: the streak joins the projections of the current position and of the
  // position one shutter interval ago (relative to the moving camera), so forward flight streaks radially.
  vec3 relV = vel - uCamVel;
  vec3 prevPos = pos - relV * (uShutter * stretchK);
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  vec4 ca = projectionMatrix * mv;
  vec4 mvPrev = viewMatrix * vec4(prevPos, 1.0);
  mvPrev.z = min(mvPrev.z, -0.05);
  vec4 cb = projectionMatrix * mvPrev;
  float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
  vec2 sa = ca.xy / ca.w * vec2(aspect, 1.0);
  vec2 sb = cb.xy / cb.w * vec2(aspect, 1.0);
  vec2 d = sa - sb;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  float ndcPerMeter = 1.0 / (depth * uTanHalfFov);
  float minRadius = 1.2 / uTargetHeight;
  float radius = max(size * ndcPerMeter, minRadius);
  alpha *= min(1.0, size * ndcPerMeter / radius);
  float halfSeg = 0.5 * len;
  // Motion blur spreads the energy along the streak; motes keep a floor so the streaks stay readable.
  float spread = radius / (radius + halfSeg);
  alpha *= kind == 4 ? max(spread, 0.1 + 0.2 * fract(seed * 13.7)) : spread;
  vec2 local = position.xy * vec2(halfSeg + radius, radius);
  vec2 center = (sa + sb) * 0.5;
  vec2 ndc = (center + dir * local.x + vec2(-dir.y, dir.x) * local.y) / vec2(aspect, 1.0);
  gl_Position = vec4(ndc * ca.w, ca.z, ca.w);

  vec3 viewDir = normalize(pos - cameraPosition);
  float sunUp = smoothstep(-0.04, 0.06, uSunDir.y);
  vec3 sun = uSunColor * sunUp * cloudShadow(pos);
  vec3 amb = uAmbient + vec3(0.04, 0.05, 0.07) * uNight * smoothstep(0.0, 0.2, uMoonDir.y);
  float cosT = dot(viewDir, uSunDir);
  vec3 color;
  if (kind == 0 || kind == 1) {
    // auxA = start temperature (K), auxB = brightness.
    float cool = kind == 0 ? pow(lifeN, 0.7) : pow(lifeN, 0.5);
    float T = mix(auxA, 820.0, cool);
    float flick = 0.6 + 0.4 * sin(age * (18.0 + seed * 23.0) + seed * 61.0);
    float I = auxB * (0.15 + 0.85 * (1.0 - cool)) * (kind == 0 ? flick * smoothstep(0.25, 0.8, age) : 1.0);
    color = blackbodyV(T) * I;
  } else if (kind == 2) {
    // Water drop: sky reflection + refracted forward glint towards the sun + a faint rainbow-angle sparkle.
    float forward = pow(max(cosT, 0.0), 16.0) * 6.0;
    float sparkle = step(0.93, fract(seed * 91.7 + age * 7.3)) * 2.5;
    color = sun * (0.08 + forward + sparkle * 0.25) + amb * 0.7;
    alpha *= 0.9;
  } else if (kind == 3) {
    vec3 albedo = unpackColor(auxA);
    color = albedo * (sun * 0.55 + amb) * (1.0 / PI);
  } else {
    // Airborne moisture/dust: strongly forward scattering (glints when looking towards the sun), faint otherwise.
    float ph = (1.0 - 0.49) / pow(max(1.0 + 0.49 - 1.4 * cosT, 1e-4), 1.5);
    color = (sun * (0.12 + 0.6 * ph) + amb * 1.1) * (1.0 / PI);
  }

  vQuad = vec4(local, halfSeg, radius);
  vDepth = depth;
  vAlpha = alpha;
  vKind = kind;
  vColor = color;
  vAtmoIn = applyAtmosphere(vec3(0.0), pos);
  vAtmoT = applyAtmosphere(vec3(1.0), pos) - vAtmoIn;
}
`;

export const SHARP_FRAGMENT = /* glsl */ `
${SHARED_GLSL}
${PARTICLE_FRAG_GLSL}

varying vec4 vQuad;
varying float vDepth;
varying float vAlpha;
flat varying int vKind;
varying vec3 vColor;
varying vec3 vAtmoT;
varying vec3 vAtmoIn;

void main() {
  float ax = max(abs(vQuad.x) - vQuad.z, 0.0);
  float d2 = (ax * ax + vQuad.y * vQuad.y) / (vQuad.w * vQuad.w);
  if (d2 >= 1.0) discard;
  float prof = 1.0 - d2;
  prof *= prof;
  float sceneZ = sceneViewDepth();
  float vis = clamp((sceneZ - vDepth) / 0.3 + 0.5, 0.0, 1.0) * smoothstep(0.1, 0.35, vDepth);
  float a = prof * vis * vAlpha;
  if (a <= 1e-4) discard;
  vec4 outColor = vKind <= 1 ? vec4(vColor * vAtmoT * a, 0.0) : vec4((vColor * vAtmoT + vAtmoIn) * a, a);
  gl_FragColor = clamp(outColor, 0.0, 60000.0);
}
`;
