import { PARTICLES_PER_ROW, TEXELS_PER_PARTICLE } from '../particles/particle-pool';
import { profileGlsl, SHARP_PROFILES, VOL_PROFILES } from '../particles/types';

/**
 * Vertex-side particle helpers: data fetch, closed-form motion (mirrors particles/motion.ts), curl turbulence,
 * camera helpers. Requires SHARED_GLSL before it.
 */
export const PARTICLE_COMMON_GLSL = /* glsl */ `
#define PPR ${PARTICLES_PER_ROW}
#define TPP ${TEXELS_PER_PARTICLE}

${profileGlsl('VOL', VOL_PROFILES)}
${profileGlsl('SHARP', SHARP_PROFILES)}

uniform highp sampler2D tData;
uniform highp sampler3D tCurl;
uniform float uNow;
uniform vec3 uWindFx;
uniform vec3 uCamVel;
uniform float uShutter;
uniform float uTanHalfFov;
uniform float uTargetHeight;

struct Particle {
  vec3 p0; float birth;
  vec3 v0; float life;
  float size0; float size1; float drag; float buoy;
  float seed; int type; float auxA; float auxB;
  vec3 planeN; float planeD; float auxC;
  vec3 carrier; float auxD;
};

Particle fetchParticle(int slot) {
  ivec2 base = ivec2((slot % PPR) * TPP, slot / PPR);
  vec4 t0 = texelFetch(tData, base, 0);
  vec4 t1 = texelFetch(tData, base + ivec2(1, 0), 0);
  vec4 t2 = texelFetch(tData, base + ivec2(2, 0), 0);
  vec4 t3 = texelFetch(tData, base + ivec2(3, 0), 0);
  vec4 t4 = texelFetch(tData, base + ivec2(4, 0), 0);
  vec4 t5 = texelFetch(tData, base + ivec2(5, 0), 0);
  Particle P;
  P.p0 = t0.xyz; P.birth = t0.w;
  P.v0 = t1.xyz; P.life = t1.w;
  P.size0 = t2.x; P.size1 = t2.y; P.drag = t2.z; P.buoy = t2.w;
  P.seed = t3.x; P.type = int(t3.y + 0.5); P.auxA = t3.z; P.auxB = t3.w;
  P.planeN = vec3(t4.x, sqrt(max(1.0 - t4.x * t4.x - t4.y * t4.y, 0.0)), t4.y);
  P.planeD = t4.z; P.auxC = t4.w;
  P.carrier = t5.xyz; P.auxD = t5.w;
  return P;
}

/* v' = -k(v - w) + g + B e^{-ct} (vertical). relDist = distance travelled relative to the air (jet spreading). */
void particleMotion(Particle P, float age, float gravity, float buoyDecay, float windF,
                    out vec3 pos, out vec3 vel, out float relDist) {
  float k = max(P.drag, 0.02);
  vec3 vinf = uWindFx * windF + P.carrier + vec3(0.0, gravity / k, 0.0);
  float ek = exp(-k * age);
  float fk = (1.0 - ek) / k;
  pos = P.p0 + vinf * age + (P.v0 - vinf) * fk;
  vel = vinf + (P.v0 - vinf) * ek;
  relDist = length(P.v0 - vinf) * fk;
  if (P.buoy != 0.0) {
    float c = buoyDecay;
    if (abs(k - c) < 0.01) c += 0.02;
    float ec = exp(-c * age);
    float kc = P.buoy / (k - c);
    pos.y += kc * ((1.0 - ec) / c - fk);
    vel.y += kc * (ec - ek);
  }
}

vec3 curlNoise(vec3 p) {
  vec3 a = textureLod(tCurl, p, 0.0).xyz * 2.0 - 1.0;
  vec3 b = textureLod(tCurl, p * 2.37 + vec3(0.43, 0.11, 0.77), 0.0).xyz * 2.0 - 1.0;
  return a + b * 0.5;
}

/* Soft clamp above a plane (n·p >= d + clearance). */
vec3 clampAbovePlane(vec3 pos, vec3 n, float d, float clearance) {
  float s = dot(pos, n) - d - clearance;
  return s < 0.0 ? pos - n * s : pos;
}

vec3 camRightWS() { return vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); }
vec3 camUpWS() { return vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); }
vec3 camFwdWS() { return -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]); }

/* World-space size of one pixel at view depth z. */
float pixelWorldSize(float z) { return 2.0 * z * uTanHalfFov / uTargetHeight; }

vec3 unpackColor(float packed) {
  float r = floor(packed / 65536.0);
  float g = floor((packed - r * 65536.0) / 256.0);
  float b = packed - r * 65536.0 - g * 256.0;
  return vec3(r, g, b) / 255.0;
}
`;

/** Fragment-side helpers shared by the particle programs. */
export const PARTICLE_FRAG_GLSL = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uInvTarget;

float sceneViewDepth() {
  return linearDepth(texture2D(tDepth, gl_FragCoord.xy * uInvTarget).r);
}

/* Henyey-Greenstein, normalized so that isotropic scattering = 1. */
float phaseHG(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5);
}
`;
