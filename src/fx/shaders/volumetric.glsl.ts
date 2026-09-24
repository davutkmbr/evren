import { SHARED_GLSL } from '../../render/shaders';
import { PARTICLE_COMMON_GLSL, PARTICLE_FRAG_GLSL } from './particle-common.glsl';

/**
 * Soft volumetric particles (flame, smoke, steam, mist, dust, foam, ring) rendered back-to-front into a
 * half-resolution premultiplied RGBA16F target (+ heat-haze attachment). Each sprite is treated as a
 * sphere of emitting/absorbing/scattering medium: depth-aware visible chord, Beer-Lambert opacity,
 * blackbody emission, wrapped-diffuse + Henyey-Greenstein sun scattering, fire light, aerial perspective.
 */
export const VOLUMETRIC_VERTEX = /* glsl */ `
${SHARED_GLSL}
${PARTICLE_COMMON_GLSL}

attribute float aSlot;
uniform float uNearFade;

/* Flame shear: sprite half-extension along the flow per m/s of flow speed (s), capped at this multiple of the radius. */
#define FLAME_SHEAR_TIME 0.085
#define FLAME_MAX_ASPECT 12.0
uniform vec3 uFireLightPos0;
uniform vec3 uFireLightCol0;
uniform vec3 uFireLightPos1;
uniform vec3 uFireLightCol1;

varying vec4 vQuad;    // profile uv, medium half-depth along the view (radius for round sprites), view depth
varying vec4 vState;   // age, lifeN, seed, heat
varying vec4 vExt;     // glow extinction, scatter extinction, noise uv
flat varying int vType;
varying vec3 vAlbedo;
varying vec3 vWorldPos;
varying vec3 vAxX;
varying vec3 vAxY;
varying vec3 vSun;
varying vec3 vAmb;
varying vec3 vFire;
varying vec3 vFireDir;
varying vec3 vAtmoT;
varying vec3 vAtmoIn;

void main() {
  Particle P = fetchParticle(int(aSlot + 0.5));
  float age = uNow - P.birth;
  int t = P.type;
  vType = t;
  if (age < 0.0 || age >= P.life) {
    gl_Position = vec4(0.0, 0.0, -10.0, 1.0);
    return;
  }
  vec3 pos;
  vec3 vel;
  float rel;
  particleMotion(P, age, VOL_GRAVITY[t], VOL_BUOY_DECAY[t], VOL_WIND[t], pos, vel, rel);
  float lifeN = age / P.life;
  float growth = 1.0 - exp(-age / VOL_GROW_TIME[t]);
  float radius = mix(P.size0, P.size1, growth) + VOL_JET_SPREAD[t] * rel + VOL_SPREAD_RATE[t] * age;

  float turb = VOL_TURB_AMP[t] * radius * (1.0 - exp(-age * 3.0));
  if (turb > 0.0) {
    float scroll = uNow * VOL_TURB_SCROLL[t];
    vec3 q = pos * VOL_TURB_FREQ[t] + vec3(P.seed * 0.37, -scroll, scroll * 0.41 + P.seed * 0.13);
    pos += curlNoise(q) * turb;
  }
  bool flatType = t == 5 || t == 6;
  if (!flatType && VOL_CLEARANCE[t] >= 0.0) {
    pos = clampAbovePlane(pos, P.planeN, P.planeD, VOL_CLEARANCE[t] * radius);
  }

  float spinAngle = P.seed * 6.2831853 + (P.seed - 0.5) * 2.0 * VOL_SPIN[t] * age;
  vec3 axX;
  vec3 axY;
  vec2 halfSize = vec2(radius);
  // Half-depth of the medium along the view ray through the centre, and noise stretch along the sprite's long axis.
  float halfDepth = radius;
  float noiseStretch = 1.0;
  float shearDilute = 1.0;
  if (flatType) {
    float c = cos(spinAngle);
    float s = sin(spinAngle);
    axX = vec3(c, 0.0, s);
    axY = vec3(s, 0.0, -c);
  } else {
    vec3 cr = camRightWS();
    vec3 cu = camUpWS();
    vec3 relV = vel - uCamVel;
    vec2 sv = vec2(dot(relV, cr), dot(relV, cu));
    float svl = length(sv);
    float streak = VOL_STRETCH[t] * svl * uShutter;
    if (t == 7) {
      // Whitewater clumps are torn into sheets and streaks along their flight path.
      streak = max(streak, radius * clamp(svl * 0.14, 0.0, 3.2));
    }
    vec2 dir = vec2(cos(spinAngle), sin(spinAngle));
    if (t == 0) {
      // Flame tongues are sheared out along their flow through the entrained air (not motion blur): each sprite is
      // an ellipsoid along the flow. Both ends of its axis are projected with perspective onto the plane through
      // the centre, so a jet seen from behind shows streaks converging on its vanishing point (and a dense column
      // along the view) instead of a pile of round puffs.
      vec3 flow = vel - uWindFx * VOL_WIND[0] - P.carrier;
      float fs = length(flow);
      float ext = min(fs * FLAME_SHEAR_TIME, radius * FLAME_MAX_ASPECT + 0.6);
      // The tongue trails back at most to where it was born (in the moving air): a young flame would otherwise
      // reach back into the mouth and show over the jaw.
      float extBack = min(ext, fs * age);
      if (ext > 0.02 * radius) {
        vec3 axis = flow / fs;
        vec3 pv = (viewMatrix * vec4(pos, 1.0)).xyz;
        vec3 av = mat3(viewMatrix) * axis * ext;
        vec3 ab = mat3(viewMatrix) * axis * extBack;
        float d = max(-pv.z, 1e-3);
        float dMin = max(0.4 * d, uNearFade);
        vec2 q1 = (pv.xy + av.xy) * (d / max(d - av.z, dMin));
        vec2 q0 = (pv.xy - ab.xy) * (d / max(d + ab.z, dMin));
        vec2 seg = q1 - q0;
        float segL = length(seg);
        vec2 mid = (q0 + q1) * 0.5 - pv.xy;
        pos += cr * mid.x + cu * mid.y;
        if (segL > 1e-4) {
          dir = seg / segL;
        }
        halfSize.x = radius + 0.5 * segL;
        float a = radius + 0.5 * (ext + extBack);
        float ca = dot(axis, normalize(pos - cameraPosition));
        halfDepth = radius * inversesqrt(ca * ca * (radius * radius) / (a * a) + 1.0 - ca * ca);
        noiseStretch = 1.0 + min(0.35 * segL / radius, 2.5);
        shearDilute = pow(radius / a, 0.35);
      }
    } else if (streak > 0.03 * radius) {
      dir = sv / svl;
      halfSize.x = radius + streak * 0.5;
      if (t == 7) {
        halfSize.y = radius * 0.7;
      }
    }
    axX = cr * dir.x + cu * dir.y;
    axY = -cr * dir.y + cu * dir.x;
  }
  vec2 corner = position.xy;
  vec3 worldPos = pos + axX * (corner.x * halfSize.x) + axY * (corner.y * halfSize.y);
  vec4 mv = viewMatrix * vec4(worldPos, 1.0);
  gl_Position = projectionMatrix * mv;

  float centerDepth = max(dot(pos - cameraPosition, camFwdWS()), 1e-3);
  float projected = radius / (centerDepth * uTanHalfFov);
  float cover = 1.0 - smoothstep(0.6, 1.5, projected);
  if (cover <= 0.0 || centerDepth + radius < uNearFade) {
    // Engulfs the camera or entirely behind the near fade: skip the whole sprite (all corners agree).
    gl_Position = vec4(0.0, 0.0, -10.0, 1.0);
    return;
  }

  /* Per-type medium parameters. */
  float heat = 0.0;
  float glow = 0.0;
  float scatter = 0.0;
  vec3 albedo = vec3(0.8);
  // Soot and smoke fade out as they close in on the camera (a rider flying through the plume sees it thin out
  // instead of a flat veil across the view).
  float nearSoot = smoothstep(3.0, 16.0, distance(pos, cameraPosition));
  if (t == 0) {
    // Flame: auxA = cooling time, auxB = soot amount, auxC = peak heat, auxD = premixed (fast-burning) fraction.
    // Two-phase cooling: fast white -> yellow (premixed core burns out), then yellow -> orange -> soot.
    heat = P.auxC * (P.auxD * exp(-age / 0.1) + (1.0 - P.auxD) * exp(-age / max(P.auxA, 0.05)));
    float compress = pow(P.size0 / max(radius, 1e-3), 0.55);
    glow = 1.4 * compress * shearDilute * smoothstep(0.05, 0.4, heat);
    // Cooling gas turns into grey-black soot that gets denser as the tongue dies (then the smoke billows take over).
    float sootDark = smoothstep(0.36, 0.06, heat);
    scatter = (P.auxB * (0.12 + 0.88 * sootDark) * 0.9 / max(radius, 0.5) * (1.0 - smoothstep(0.6, 1.0, lifeN)) + 0.01) * nearSoot * shearDilute;
    albedo = mix(vec3(0.045, 0.04, 0.036), vec3(0.11, 0.105, 0.1), smoothstep(0.3, 1.0, lifeN));
  } else if (t == 1) {
    // auxC = appear delay (s): billows spawned with the jet stay hidden until the flames have burnt out.
    albedo = unpackColor(P.auxA);
    albedo = mix(albedo, min(albedo * 2.2 + 0.06, vec3(0.6)), smoothstep(0.1, 1.0, lifeN));
    float appear = smoothstep(P.auxC, P.auxC + 0.7, age) * smoothstep(0.0, 0.1, lifeN);
    // Soot mass is (roughly) conserved while the billow entrains air: optical depth across it falls as it grows
    // (exponent below the ideal 2 to account for soot still being produced/entrained early on).
    float dilute = pow(2.6 / max(radius, 2.6), 1.2);
    scatter = P.auxB * appear * dilute * pow(1.0 - lifeN, 1.1) / max(radius, 0.5) * nearSoot;
  } else if (t == 2) {
    albedo = vec3(0.92);
    scatter = P.auxB * smoothstep(0.0, 0.05, lifeN) * pow(1.0 - lifeN, 2.2) / max(radius, 0.5);
    heat = 0.05 * (1.0 - lifeN);
  } else if (t == 3) {
    albedo = vec3(0.9, 0.93, 0.95);
    scatter = P.auxB * smoothstep(0.0, 0.04, lifeN) * pow(1.0 - lifeN, 1.5) / max(radius, 0.5);
  } else if (t == 4) {
    albedo = unpackColor(P.auxA);
    scatter = P.auxB * smoothstep(0.0, 0.05, lifeN) * pow(1.0 - lifeN, 1.3) / max(radius, 0.5);
  } else if (t == 7) {
    albedo = vec3(0.93, 0.95, 0.96);
    scatter = P.auxB * smoothstep(0.0, 0.03, lifeN) * pow(1.0 - lifeN, 2.2) / max(radius, 0.3);
  } else if (t == 5) {
    albedo = vec3(0.82, 0.85, 0.86);
    scatter = P.auxB * smoothstep(0.0, 0.05, lifeN) * pow(1.0 - lifeN, 1.1);
  } else {
    albedo = vec3(0.8, 0.84, 0.86);
    scatter = P.auxB * smoothstep(0.0, 0.03, lifeN) * pow(1.0 - lifeN, 1.4);
  }

  vQuad = vec4(corner, halfDepth, -mv.z);
  vState = vec4(age, lifeN, P.seed, heat);
  vExt = vec4(glow * cover, scatter * cover, corner * vec2(halfSize.x / (radius * noiseStretch), 1.0));
  vAlbedo = albedo;
  vWorldPos = worldPos;
  vAxX = axX;
  vAxY = axY;

  float sunUp = smoothstep(-0.04, 0.06, uSunDir.y);
  vSun = uSunColor * cloudShadow(pos) * sunUp;
  vec3 moon = vec3(0.04, 0.05, 0.07) * uNight * smoothstep(0.0, 0.2, uMoonDir.y);
  vAmb = uAmbient + moon;
  vec3 d0 = uFireLightPos0 - pos;
  vec3 d1 = uFireLightPos1 - pos;
  // The fire is a volume, not a point: soften the inverse-square falloff over a few metres.
  float l0 = dot(d0, d0) + 9.0;
  float l1 = dot(d1, d1) + 9.0;
  vec3 f0 = uFireLightCol0 / l0;
  vec3 f1 = uFireLightCol1 / l1;
  // Smoke outside the flames only catches a fraction (self-shadowed by the soot between it and the fire).
  vFire = min((f0 + f1) * (t == 1 ? 0.4 : 1.0), vec3(t == 1 ? 8.0 : 25.0));
  vFireDir = normalize(d0 * (luma(f0) * inversesqrt(l0)) + d1 * (luma(f1) * inversesqrt(l1)) + vec3(0.0, 1e-6, 0.0));
  vAtmoIn = applyAtmosphere(vec3(0.0), pos);
  vAtmoT = applyAtmosphere(vec3(1.0), pos) - vAtmoIn;
}
`;

export const VOLUMETRIC_FRAGMENT = /* glsl */ `
${SHARED_GLSL}
${PARTICLE_FRAG_GLSL}

layout(location = 1) out highp vec4 pc_fragHeat;

uniform highp sampler3D tNoise;
uniform sampler2D tBlackbody;
uniform float uNearFade;

varying vec4 vQuad;
varying vec4 vState;
varying vec4 vExt;
flat varying int vType;
varying vec3 vAlbedo;
varying vec3 vWorldPos;
varying vec3 vAxX;
varying vec3 vAxY;
varying vec3 vSun;
varying vec3 vAmb;
varying vec3 vFire;
varying vec3 vFireDir;
varying vec3 vAtmoT;
varying vec3 vAtmoIn;

vec3 blackbody(float T) {
  return texture2D(tBlackbody, vec2(clamp((T - 500.0) / 11500.0, 0.0, 1.0), 0.5)).rgb;
}

vec3 shadeMedium(vec3 albedo, vec3 n, float thin, float g) {
  vec3 viewDir = normalize(vWorldPos - cameraPosition);
  float diffuse = clamp(dot(n, uSunDir) * 0.55 + 0.45, 0.0, 1.0);
  float ph = phaseHG(dot(viewDir, uSunDir), g);
  // Dark media (soot) are single-scattering; bright media (spray, steam, dust) stay luminous from every side
  // through multiple scattering (diffuse transmission floor), with forward-scattered silver linings.
  float single = mix(diffuse, 0.5 * ph, thin);
  float multi = max(mix(diffuse, 0.62, thin * 0.6), 0.36) + (0.3 * thin + 0.07) * ph;
  vec3 sun = vSun * mix(single, multi, smoothstep(0.15, 0.85, luma(albedo)));
  vec3 amb = vAmb * (0.72 + 0.28 * n.y);
  vec3 fire = vFire * clamp(dot(n, vFireDir) * 0.55 + 0.45, 0.0, 1.0);
  return albedo * (sun + amb + fire) * (1.0 / PI);
}

/* Sphere normal perturbed by the gradient of the billow noise (two extra taps; smooth at half resolution). */
vec3 lumpyNormal(vec2 uv, vec3 nc, float nscale, float base, float amount) {
  const float e = 0.16;
  float bx = texture(tNoise, nc + vec3(e * nscale, 0.0, 0.0)).r;
  float by = texture(tNoise, nc + vec3(0.0, e * nscale, 0.0)).r;
  vec2 grad = vec2(bx - base, by - base) * (amount / e);
  float z = sqrt(max(1.0 - dot(uv, uv), 0.0));
  vec3 nb = normalize(vec3(uv - grad, max(z, 0.08)));
  vec3 toCam = normalize(cameraPosition - vWorldPos);
  return normalize(vAxX * nb.x + vAxY * nb.y + toCam * nb.z);
}

void main() {
  vec2 uv = vQuad.xy;
  float r2 = dot(uv, uv);
  if (r2 >= 1.0) discard;
  float halfDepth = vQuad.z;
  float depth = vQuad.w;
  float sceneZ = sceneViewDepth();
  int t = vType;
  float age = vState.x;
  float lifeN = vState.y;
  float seed = vState.z;
  float heat = vState.w;
  vec2 nuv = vExt.zw;

  float chord;
  if (t == 5 || t == 6) {
    chord = clamp((sceneZ - depth) / 0.8 + 1.0, 0.0, 1.0) * smoothstep(uNearFade, uNearFade + 1.0, depth);
  } else {
    float hh = sqrt(max(1.0 - r2, 0.0)) * halfDepth;
    chord = max(min(depth + hh, sceneZ) - max(depth - hh, uNearFade), 0.0);
  }
  if (chord <= 1e-4) discard;

  float r = sqrt(r2);
  float nscale = t == 0 ? 0.19 : (t == 3 ? 0.28 : (t == 7 ? 0.3 : 0.22));
  vec3 nc = vec3(nuv * nscale + vec2(seed * 17.31, seed * 5.87), seed * 3.71 + age * 0.16);
  vec4 n1 = texture(tNoise, nc);
  // Domain-warped radius: irregular, billowing silhouettes instead of discs.
  vec2 warp = vec2(n1.r, n1.g) - 0.5;
  float rw = length(uv + warp * (0.55 + 0.35 * lifeN));
  // Early out for empty fragments of the soft types before the remaining taps (overdraw is the main cost).
  if (t != 5 && t != 6) {
    float bodyMax = 1.0 - smoothstep(0.0, 1.0, rw);
    if (bodyMax * (0.82 + 0.68 * n1.r) < 0.05) discard;
  }
  vec4 n2 = texture(tNoise, nc * vec3(1.9, 1.9, 1.4) + vec3(0.37, 0.61, 0.13 + age * 0.09));

  vec3 rgb = vec3(0.0);
  float alpha = 0.0;
  float haze = 0.0;

  if (t == 0) {
    // Flame tongues: ridged noise, stretched along the flow and scrolling back through the sprite, so the jet
    // keeps licks and filaments even when seen end-on.
    vec3 fc = vec3(nuv * vec2(0.13, 0.24) + vec2(seed * 17.31 + age * 0.6, seed * 5.87), seed * 3.71 + age * 0.75);
    float fa = texture(tNoise, fc).r;
    float fd = texture(tNoise, fc * vec3(2.1, 2.1, 1.6) + vec3(0.37, 0.61, 0.13)).a;
    float ridge = 1.0 - abs(2.0 * (fa * 0.78 + fd * 0.22) - 1.0);
    ridge *= ridge;
    float body = 1.0 - smoothstep(0.0, 1.0, rw);
    float erode = mix(0.0, 0.5, smoothstep(0.1, 0.9, lifeN));
    float dens = smoothstep(0.14, 0.5, body * (0.42 + 0.9 * fa) + 0.35 * ridge - erode);
    // Hot filaments vs cooler gaps: with radiance ~exp(-c/T) this gives several-fold brightness contrast, which
    // survives the overlap of many sprites when the jet is seen end-on.
    float localHeat = clamp(heat * (0.18 + 0.95 * ridge + 0.35 * body + 0.35 * (n2.a - 0.5)), 0.0, 1.1);
    // Visible-band blackbody radiance falls off roughly like exp(-c/T): white-yellow core (~3400 K, radiance ~36),
    // orange at ~2000 K (a few units), dull red below ~1400 K that only shows against a dark night sky.
    float T = 1000.0 + 2400.0 * localHeat;
    float I = min(36.0 * exp(-11000.0 * (1.0 / T - 1.0 / 3400.0)), 48.0);
    // Premixed root: blue before soot forms (first ~2 m of the jet).
    float sootOn = smoothstep(0.012, 0.07, age);
    vec3 emit = blackbody(T) * I * sootOn + vec3(0.28, 0.5, 1.0) * 9.0 * exp(-age / 0.035) * body;
    float tauG = dens * vExt.x * chord;
    float tauS = dens * vExt.y * chord * (0.6 + 0.8 * n2.b);
    float tau = tauG + tauS;
    alpha = 1.0 - exp(-tau);
    // Soot extinction grows towards short wavelengths: light from inside a sooty tongue comes out redder.
    emit *= exp(-tauS * vec3(0.0, 0.45, 1.1));
    vec3 soot = vec3(0.0);
    if (tauS > 0.004) {
      vec3 n = lumpyNormal(uv, nc, nscale, n1.r, 0.6);
      soot = shadeMedium(vAlbedo, n, 1.0 - dens, 0.3);
    }
    vec3 L = (emit * tauG + soot * tauS) / max(tau, 1e-5);
    rgb = (L * vAtmoT + vAtmoIn) * alpha;
    // Hot gas refracts beyond the visible flame: shimmer around the silhouette and in the rising plume.
    haze = (1.0 - smoothstep(0.35, 1.0, r)) * (0.3 + smoothstep(0.02, 0.3, heat)) * (1.0 - lifeN) * 0.55;
  } else if (t == 7) {
    // Whitewater: clusters of drops with lacy gaps (cellular noise stretched along the streak), crisp edges,
    // bright multiple scattering and sun glints on the drops.
    vec3 sc = vec3(nuv * vec2(0.3, 0.75) + vec2(seed * 9.1, seed * 4.3), seed * 2.9 + age * 0.5);
    float cells = texture(tNoise, sc).b;
    float fine = texture(tNoise, sc * vec3(2.1, 2.1, 1.0) + vec3(0.27, 0.53, 0.11)).a;
    float body = 1.0 - smoothstep(0.1, 1.0, rw);
    float erode = mix(0.08, 0.75, lifeN);
    float dens = smoothstep(0.22, 0.5, body * (0.55 + 0.75 * cells) + 0.25 * fine - erode);
    float tau = dens * vExt.y * chord;
    alpha = 1.0 - exp(-tau);
    vec3 n = lumpyNormal(uv, nc, nscale, n1.r, 0.25);
    vec3 L = shadeMedium(vAlbedo, n, clamp(1.0 - dens, 0.0, 1.0), 0.7);
    vec3 viewDir = normalize(vWorldPos - cameraPosition);
    L += vSun * pow(max(dot(viewDir, uSunDir), 0.0), 20.0) * 1.2 * fine;
    rgb = (L * vAtmoT + vAtmoIn) * alpha;
  } else if (t <= 4) {
    float billow;
    float g;
    if (t == 3) {
      billow = n1.g * 0.5 + n2.a * 0.5;
      g = 0.72;
    } else if (t == 2) {
      billow = n1.r * 0.55 + n2.g * 0.45;
      g = 0.55;
    } else {
      billow = n1.r * 0.6 + n2.g * 0.25 + n2.b * 0.15;
      g = t == 4 ? 0.4 : 0.3;
    }
    float body = 1.0 - smoothstep(0.0, 1.0, rw);
    float erode = mix(0.05, 0.45, lifeN);
    float contrast = t == 1 ? 1.8 : 1.5;
    float dens = clamp((body * 1.25 + (billow - 0.5) * contrast - erode) * 1.8, 0.0, 1.0);
    float tau = dens * vExt.y * chord;
    alpha = 1.0 - exp(-tau);
    vec3 n = lumpyNormal(uv, nc, nscale, n1.r, 0.75);
    vec3 L = shadeMedium(vAlbedo, n, clamp(1.0 - dens * 1.2, 0.0, 1.0), g);
    rgb = (L * vAtmoT + vAtmoIn) * alpha;
    if (t == 2) {
      haze = dens * 0.15 * (1.0 - lifeN);
    }
  } else {
    // Flat foam on the water: a lacy network along bubble-cell borders that thins out as the foam decays.
    vec3 fc = vec3(nuv * 0.85 + vec2(seed * 7.3, seed * 3.1), seed * 5.1 + age * 0.04);
    float c1 = texture(tNoise, fc).b;
    float c2 = texture(tNoise, fc * vec3(2.3, 2.3, 1.0) + vec3(0.41, 0.17, 0.0)).b;
    // Manual LOD: foreshortened lace at grazing angles / distance would alias, so it fades to its mean.
    float grazing = abs(normalize(vWorldPos - cameraPosition).y);
    float detail = smoothstep(0.05, 0.3, grazing) * (1.0 - smoothstep(30.0, 110.0, depth));
    float border = mix(0.5, 1.0 - (c1 * 0.7 + c2 * 0.3), detail);
    // Analytic AA: the lace threshold is never sharper than the half-res pixel footprint (no blocky holes after
    // upsampling).
    float band = max(mix(0.45, 0.12, detail), fwidth(border) * 2.0);
    float youth = 1.0 - lifeN;
    float foam;
    if (t == 5) {
      float edge = 1.0 - smoothstep(0.25, 1.0, rw);
      float thr = mix(0.64, 0.28, youth * youth * edge);
      foam = smoothstep(thr - band * 0.5, thr + band * 0.5, border) * edge * (0.55 + 0.45 * mix(0.5, n1.g, detail));
    } else {
      float ringR = 0.8 + (n1.r - 0.5) * 0.1;
      float width = mix(0.05, 0.16, lifeN);
      float dr = (rw - ringR) / width;
      float crest = exp(-dr * dr);
      float wake = smoothstep(ringR, 0.1, rw) * 0.35 * youth;
      foam = crest * smoothstep(0.3, 0.55, border + 0.2 * youth) + wake * smoothstep(0.5, 0.7, border);
    }
    alpha = clamp(foam * vExt.y * chord, 0.0, 1.0) * 0.92;
    vec3 L = vAlbedo * (vSun * (0.3 + 0.7 * max(uSunDir.y, 0.0)) + vAmb * 1.1 + vFire * 0.5) * (1.0 / PI);
    rgb = (L * vAtmoT + vAtmoIn) * alpha;
  }

  // clamp() also sanitizes NaN on GPUs (min/max return the non-NaN operand); isnan() is unreliable under fast-math.
  float a = clamp(alpha, 0.0, 1.0);
  gl_FragColor = vec4(clamp(rgb, 0.0, 60000.0), a);
  // Heat target (alpha 0 = additive): r haze, g/b = sum of alpha * log depth / sum of alpha, i.e. where the particle
  // layer's opacity sits in depth. The full-resolution ribbons drawn after the composite use it to hide behind smoke.
  pc_fragHeat = vec4(clamp(haze, 0.0, 4.0), a * log2(1.0 + depth), a, 0.0);
}
`;
