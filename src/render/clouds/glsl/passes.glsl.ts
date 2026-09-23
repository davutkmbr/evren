/**
 * Full-screen passes of the cloud renderer:
 *   march     (low-res, MRT)  -> radiance/transmittance + aux (cloud distance, scene distance, front distance,
 *                                extinction just behind the front)
 *   temporal  (low-res, MRT)  -> reprojected accumulation with depth-aware history, per-pixel sample age and
 *                                variance clipping; spatial fallback where the history is missing
 *   composite (full-res)      -> Catmull-Rom upsample where depth is continuous, depth-corrected joint-bilateral
 *                                upsample at depth edges; scene * T + L
 * Distances in aux are stored in kilometres and extinction in 1/km (half-float precision). The low-res buffers may
 * be larger than the active region (dynamic resolution renders into a viewport): uLowSize is the active size.
 */

const RAY_HELPERS = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCloudCamPos;

vec3 cloudViewRay(vec2 uv) {
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return normalize(v.xyz / v.w);
}
vec3 cloudWorldRay(vec3 viewDir) {
  return normalize(mat3(uCamWorld) * viewDir);
}
/* Where the visible cloud of a sample ends (km): exponential medium from the front whose mean scattering depth is
   aux.x, so ~98 % opacity is reached ~4 mean depths behind the front. Geometry beyond it cannot change the sample. */
float cloudEndKm(vec4 aux) {
  return aux.z >= 999.0 ? aux.x : aux.x + 3.0 * max(aux.x - aux.z, 0.0);
}
/* Ray distance (m) of a reversed-Z depth sample along a unit view ray; 1e9 for sky. */
float cloudSceneDistance(float d, vec3 viewDir) {
  if (d <= 0.0) return 1e9;
  float lz = linearDepth(d);
  if (lz >= uCamFar * 0.985) return 1e9;
  return lz / max(-viewDir.z, 1e-4);
}
`;

export const MARCH_FRAGMENT = /* glsl */ `
${RAY_HELPERS}
uniform sampler2D tDepth;
uniform sampler2D tBlueNoise;
uniform vec2 uLowSize;
uniform float uFrame;
uniform float uPixelAngle;
/* 1x1 texture holding cloudSkyAmbient() for this frame (see AMBIENT_FRAGMENT). */
uniform sampler2D tSkyAmbient;
/* Sub-pixel offset of the low-res sample (low-res pixel units), cycled per frame for temporal supersampling. */
uniform vec2 uSubPixel;

varying vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outAux;

/* Void-and-cluster blue noise, advanced per frame by an additive golden-ratio (R1) sequence. */
float cloudJitter(ivec2 px, ivec2 offset, float frame, float rate) {
  float bn = texelFetch(tBlueNoise, (px + offset) & 63, 0).r;
  return fract(bn + rate * mod(frame, 1024.0));
}

void main() {
  ivec2 lp = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(lp) + 0.5 + uSubPixel) / uLowSize;
#ifdef CLOUD_DEBUG_NOMARCH
  outColor = vec4(0.0, 0.0, 0.0, 1.0);
  outAux = vec4(1000.0, 1000.0, 1000.0, 0.0);
  return;
#endif

  ivec2 dsize = textureSize(tDepth, 0);
  vec2 fp = uv * vec2(dsize);
  float q = 0.25 * float(dsize.x) / uLowSize.x;
  ivec2 dmax = dsize - 1;
  float d0 = texelFetch(tDepth, clamp(ivec2(fp + vec2(-q, -q)), ivec2(0), dmax), 0).r;
  float d1 = texelFetch(tDepth, clamp(ivec2(fp + vec2(q, -q)), ivec2(0), dmax), 0).r;
  float d2 = texelFetch(tDepth, clamp(ivec2(fp + vec2(-q, q)), ivec2(0), dmax), 0).r;
  float d3 = texelFetch(tDepth, clamp(ivec2(fp + vec2(q, q)), ivec2(0), dmax), 0).r;
  /* Checkerboard nearest/farthest depth: both sides of a depth edge are represented in every 2x2 block. */
  bool pickNear = ((lp.x + lp.y) & 1) == 0;
#ifdef CLOUD_DEBUG_NOCHECKER
  pickNear = false;
#endif
  float dSel = pickNear ? max(max(d0, d1), max(d2, d3)) : min(min(d0, d1), min(d2, d3));

  vec3 vdir = cloudViewRay(uv);
  vec3 rd = cloudWorldRay(vdir);
  vec3 ro = uCloudCamPos;
  float sceneDist = cloudSceneDistance(dSel, vdir);

  float jitter = cloudJitter(lp, ivec2(0), uFrame, 0.61803398875);
  float jitter2 = cloudJitter(lp, ivec2(29, 41), uFrame, 0.75487766625);
  float cosT = dot(rd, uCloudLightDir);
  vec3 skyAmb = vec3(0.0);
  /* Inside a thick cloud the radiance field is a diffusion field: brighter looking toward the lit top / the sun,
     darker looking down. Only applies while the camera is inside the layer (scaled by the local density below). */
  float inCloudGrad = 1.0;
  /* Camera inside the layer: the far part (> ~80 m) of the light column is shared by every sample near the camera,
     so those samples only march their own first two light steps. */
  float odCamFar = -1.0;

  vec3 L = vec3(0.0);
  float T = 1.0;
  float dSum = 0.0;
  float wSum = 0.0;
  float front = -1.0;
  float frontOd = 0.0;
  float frontLen = 0.0;
  float frontWindow = 0.0;
  float tMin, tMax;
  float tLimit = min(sceneDist, CLOUD_MAX_DIST);
#ifdef CLOUD_DEBUG_COST
  vec3 cost = vec3(0.0);
#endif
  bool hitsLayer = cloudLayerInterval(ro, rd, CLOUD_BOTTOM, CLOUD_TOP, tLimit, tMin, tMax);
  float cc0, cc1;
  bool hitsCirrus = cloudShell(ro, rd, CLOUD_CIRRUS_H, cc0, cc1);
  if (hitsLayer || hitsCirrus) {
    skyAmb = texelFetch(tSkyAmbient, ivec2(0), 0).rgb;
  }
  if (hitsLayer && tMin <= 0.0) {
    float camReg = -100.0;
    float camHf;
    float camDens = cloudDensityR(ro, cloudAltitude(ro), 1.0, 0.0, vec2(0.0), camReg, camHf);
    float grad = dot(rd, normalize(uCloudLightDir + vec3(0.0, 1.2, 0.0)));
    inCloudGrad = 1.0 + 0.3 * grad * smoothstep(0.0, 0.3, camDens);
    odCamFar = cloudLightDepthFrom(ro, 2, CLOUD_LIGHT_STEPS, 0, jitter2, camReg);
  }
  if (hitsLayer) {
    /* Two-speed march: fine steps (~CLOUD_STEP_REL of the distance) inside clouds, 3.5x coarser through empty air;
       stepping back one coarse step on entry so leading edges are never skipped. */
    bool coarse = true;
    /* True after fine steps inside an envelope found nothing: the next envelope hit continues from there
       instead of stepping back over ground the fine steps already covered. */
    bool covered = false;
    int emptyRun = 0;
    float dt = clamp(tMin * CLOUD_STEP_REL * 3.5, 12.0, 1600.0);
    float t = tMin + dt * jitter;
    /* The regional field varies over tens of km: reuse one lookup for ~3 km of ray. */
    float reg = -100.0;
    float regT = t;
    for (int i = 0; i < CLOUD_STEPS; i++) {
      if (t > tMax) break;
      vec3 p = ro + rd * t;
      float alt = cloudAltitude(p);
      /* ~CLOUD_STEP_REL of the distance, at least 3-27 m close to the camera (flying through) and never much more
         than the smallest cumulus far away (inside cloud envelopes only; empty air uses the coarse steps). */
      float fine = min(max(t * CLOUD_STEP_REL, 3.0 + min(t, 400.0) * 0.06), CLOUD_FINE_CAP + t * 0.012);
#ifdef CLOUD_DEBUG_NOCAP
      fine = min(max(t * CLOUD_STEP_REL, 3.0 + min(t, 400.0) * 0.06), 450.0);
#endif
      /* Filter footprint: the pixel cone, grown faster than linear far away, and never finer than ~half the
         step, so noise octaves finer than the sample spacing are pre-filtered instead of aliasing into grain. */
      float footprint = max(t * uPixelAngle * (1.0 + t * 0.00004), fine * 0.6);
      float hf;
      if (t - regT > 3000.0) {
        reg = -100.0;
        regT = t;
      }
      if (coarse) {
#ifdef CLOUD_DEBUG_COST
        cost.x += 1.0;
#endif
#ifdef CLOUD_DEBUG_OLDPROBE
        if (cloudDensityR(p, alt, footprint, 0.0, vec2(0.0), reg, hf) > 0.0) {
#else
        if (cloudMayExist(p, alt, footprint, reg)) {
#endif
          coarse = false;
          emptyRun = 0;
          if (!covered) {
            float back = min(dt, t - tMin);
            t -= back * (1.0 - jitter * 0.5);
            dt = fine;
            continue;
          }
        } else {
          covered = false;
          dt = clamp(fine * 3.5, 12.0, 1600.0);
          t += dt;
          continue;
        }
      }
      float detail = 1.0 - smoothstep(18000.0, 30000.0, t);
      vec2 near = vec2(1.0 - smoothstep(90.0, 320.0, t), smoothstep(4.0, 22.0, t));
      float dens = cloudDensityR(p, alt, footprint, detail, near, reg, hf);
      float nearShade = gCloudNearShade;
#ifdef CLOUD_DEBUG_COST
      cost.y += 1.0;
#endif
      /* Where a full step would be opaque and the ray is still mostly transparent, the lit surface layer
         (~1/sigma deep) decides the pixel: sample it with steps of ~1.5 optical depths so surfaces stay crisp and
         distant opaque clouds lose most of their per-frame variance. Thin regions and the interior keep full steps. */
      dt = fine;
      if (T > 0.6 && t > 300.0) {
        dt *= clamp(1.5 / max(dens * uCloudShape.y * fine, 1e-3), 0.35, 1.0);
      }
#ifdef CLOUD_DEBUG_NOREFINE
      dt = fine;
#endif
      float stepLen = min(dt, tMax - t + dt * 0.5);
      if (dens > 0.002) {
        emptyRun = 0;
        float sigma = dens * uCloudShape.y;
        /* Light-march LOD: full quality only where the sample is still clearly visible. */
        int lds = (t < 2500.0 && T > 0.35) ? 1 : 0;
#ifdef CLOUD_DEBUG_NOLDS
        lds = 0;
#endif
        bool sharedColumn = odCamFar >= 0.0 && t < 160.0;
        int ls = sharedColumn ? 2 : ((t < 16000.0 && T > 0.45) ? CLOUD_LIGHT_STEPS : (T > 0.12 ? 3 : 2));
        float od = cloudLightDepth(p, ls, lds, jitter2, reg) + (sharedColumn ? odCamFar : 0.0);
#ifdef CLOUD_DEBUG_COST
        cost.z += float(ls);
#endif
#ifdef CLOUD_DEBUG_NOSHADOW
        od = 0.0;
#endif
        vec3 S = (cloudSunLight(cloudKeyLight(p, alt), od, cosT, sigma) + cloudAmbientLight(p, hf, skyAmb)) * nearShade * inCloudGrad;
#ifdef CLOUD_DEBUG_LIGHTOD
        S = vec3(od * 0.001, dens, hf);
#endif
        float tr = exp(-sigma * stepLen);
        float wgt = T * (1.0 - tr);
        L += S * wgt;
        dSum += t * wgt;
        wSum += wgt;
        T *= tr;
        if (front < 0.0 && T < 0.985) {
          front = t;
          frontWindow = 60.0 + t * 0.03;
        }
        if (front >= 0.0 && t - front < frontWindow) {
          frontOd += sigma * stepLen;
          frontLen += stepLen;
        }
        if (T < 0.02) {
          T = 0.0;
          break;
        }
      } else {
        if (front >= 0.0 && t - front < frontWindow) frontLen += stepLen;
        if (++emptyRun > 4) {
          coarse = true;
          covered = true;
        }
      }
      t += dt;
    }
  }

  float alpha = 1.0 - T;
  float cloudDist = wSum > 1e-5 ? dSum / wSum : -1.0;
  if (alpha > 1e-4) {
    vec3 col = L / alpha;
    col = applyAtmosphere(col, ro + rd * cloudDist);
    L = col * alpha;
  }
  /* Mean extinction over the first metres behind the front: lets the composite re-evaluate the cloud in front of
     geometry that the low-res ray did not see (thin wings, masts) instead of borrowing the background's fog. */
  float sigmaFront = front >= 0.0 ? frontOd / max(frontLen, 1.0) : 0.0;

  if (T > 0.005 && hitsCirrus) {
    float camAlt = cloudAltitude(ro);
    float tc = camAlt < CLOUD_CIRRUS_H ? cc1 : cc0;
    if (tc > 0.0 && tc < min(sceneDist, 260000.0)) {
      vec3 pc = ro + rd * tc;
      vec3 ccol;
      float ca = cloudCirrus(pc, rd, cosT, skyAmb, ccol);
      ca *= 1.0 - smoothstep(120000.0, 250000.0, tc);
      if (ca > 0.001) {
        ccol = applyAtmosphere(ccol, pc);
        L += T * ccol * ca;
        if (cloudDist < 0.0 || wSum < 0.02) cloudDist = tc;
        if (front < 0.0 && ca > 0.015) {
          front = tc;
          sigmaFront = 0.1;
        }
        T *= 1.0 - ca;
      }
    }
  }

  outColor = vec4(L, T);
#ifdef CLOUD_DEBUG_COST
  outColor = vec4(cost, 1.0);
#endif
  outAux = vec4(
    cloudDist > 0.0 ? cloudDist * 0.001 : 1000.0,
    min(sceneDist * 0.001, 1000.0),
    front >= 0.0 ? front * 0.001 : 1000.0,
    sigmaFront * 1000.0
  );
}
`;

/** Evaluates the (per-frame constant) hemispherical sky light once into a 1x1 target. */
export const AMBIENT_FRAGMENT = /* glsl */ `
layout(location = 0) out vec4 outColor;
void main() {
  outColor = vec4(cloudSkyAmbient(), 1.0);
}
`;

export const TEMPORAL_FRAGMENT = /* glsl */ `
${RAY_HELPERS}
uniform sampler2D tCur;
uniform sampler2D tCurAux;
uniform sampler2D tHist;
uniform sampler2D tHistAux;
uniform sampler2D tHistAge;
uniform mat4 uPrevViewProj;
uniform vec3 uPrevCamPos;
uniform vec2 uLowSize;
/* Active size of the history buffers (differs from uLowSize for one frame after a resolution change). */
uniform vec2 uHistSize;
uniform float uHistoryValid;
uniform float uBlend;
/* Angle (rad) subtended by one low-res pixel. */
uniform float uPixelAngle;

varying vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outAux;
layout(location = 2) out vec4 outAge;

#define MAX_AGE 32.0

/* Scene-depth similarity; depth is irrelevant (similarity 1) when both depths lie well behind the cloud's end. */
float depthSimilarity(float a, float b, float k, float cloudEnd) {
  float relevant = smoothstep(cloudEnd * 1.6, cloudEnd * 1.1, min(a, b));
  return exp(-abs(log(max(a, 1e-4) / max(b, 1e-4))) * k * relevant);
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 imax = ivec2(uLowSize) - 1;
  vec4 c = texelFetch(tCur, ip, 0);
  vec4 a = texelFetch(tCurAux, ip, 0);

  /* Depth-aware 3x3 statistics: moments for variance clipping, a small Gaussian for the spatial fallback. */
  vec4 m1 = vec4(0.0);
  vec4 m2 = vec4(0.0);
  vec4 blur = vec4(0.0);
  float wn = 0.0;
  float wg = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 np = clamp(ip + ivec2(x, y), ivec2(0), imax);
      vec4 nc = texelFetch(tCur, np, 0);
      float nd = texelFetch(tCurAux, np, 0).y;
      bool center = x == 0 && y == 0;
      float w = center ? 1.0 : step(0.5, depthSimilarity(nd, a.y, 6.0, cloudEndKm(a)));
      m1 += nc * w;
      m2 += nc * nc * w;
      wn += w;
      float g = w * (center ? 4.0 : (x == 0 || y == 0 ? 2.0 : 1.0));
      blur += nc * g;
      wg += g;
    }
  }
  vec4 mean = m1 / wn;
  vec4 sigma = sqrt(max(m2 / wn - mean * mean, 0.0));
  blur /= wg;

  vec2 uv = (vec2(ip) + 0.5) / uLowSize;
  vec3 vdir = cloudViewRay(uv);
  vec3 rd = cloudWorldRay(vdir);
  float cloudDistM = min(a.x, 150.0) * 1000.0;
  vec4 pc = uPrevViewProj * vec4(uCloudCamPos + rd * cloudDistM, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;

#ifdef CLOUD_DEBUG_NOTAA
  outColor = c;
  outAux = a;
  outAge = vec4(1.0);
  return;
#endif
  bool valid = uHistoryValid > 0.5 && pc.w > 0.0 && all(greaterThanEqual(puv, vec2(0.0))) && all(lessThanEqual(puv, vec2(1.0)));
  if (!valid) {
    /* No history (screen edge while turning, disocclusion, reset): a filtered sample, never the raw jitter. */
    outColor = blur;
    outAux = a;
    outAge = vec4(1.0);
    return;
  }

  float sceneM = min(a.y, 500.0) * 1000.0;
  float expectedPrev = a.y >= 999.0 ? 1000.0 : length(uCloudCamPos + rd * sceneM - uPrevCamPos) * 0.001;

  ivec2 hmax = ivec2(uHistSize) - 1;
  vec2 hp = puv * uHistSize - 0.5;
  vec2 hb = floor(hp);
  vec2 hf = hp - hb;
  vec4 hsum = vec4(0.0);
  vec4 hasum = vec4(0.0);
  float agesum = 0.0;
  float hw = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 tp = clamp(ivec2(hb) + ivec2(i, j), ivec2(0), hmax);
      vec4 hc = texelFetch(tHist, tp, 0);
      vec4 ha = texelFetch(tHistAux, tp, 0);
      float hage = texelFetch(tHistAge, tp, 0).r;
      float wb = (i == 0 ? 1.0 - hf.x : hf.x) * (j == 0 ? 1.0 - hf.y : hf.y);
      float w = wb * depthSimilarity(ha.y, expectedPrev, 12.0, min(cloudEndKm(a), cloudEndKm(ha))) + 1e-6 * wb;
      hsum += hc * w;
      hasum += ha * w;
      agesum += hage * w;
      hw += w;
    }
  }
  vec4 h = hsum / hw;
  vec4 ha = hasum / hw;
  float conf = clamp(hw * 1.6, 0.0, 1.0);

  /* Parallax uncertainty: when the cloud front and the mean scattering depth reproject to different places the
     history is smeared along the motion, so the pixel is treated as younger (faster response, less ghosting).
     Pure rotation reprojects exactly and keeps the full history. */
  float spread = 0.0;
  if (a.z < 999.0 && a.x < 999.0) {
    vec3 move = uCloudCamPos - uPrevCamPos;
    float movePerp = length(move - rd * dot(move, rd));
    float dFront = max(a.z * 1000.0, 1.0);
    float dMean = max(a.x * 1000.0, dFront);
    spread = movePerp * (1.0 / dFront - 1.0 / dMean) / uPixelAngle;
  }
  float age = min((agesum / hw) * conf + 1.0, MAX_AGE);
  age = min(age, mix(MAX_AGE, 3.0, clamp(spread / 5.0, 0.0, 1.0)));

  float k = mix(1.5, 2.5, clamp((age - 2.0) / 8.0, 0.0, 1.0));
  h = clamp(h, mean - sigma * k - vec4(0.002), mean + sigma * k + vec4(0.002));
  /* Young pixels take a pre-filtered sample so the per-pixel jitter pattern never shows through. */
  vec4 cs = mix(blur, c, 0.35 + 0.65 * clamp((age - 1.0) / 6.0, 0.0, 1.0));
  float alpha = max(1.0 / age, uBlend);
  outColor = mix(h, cs, alpha);

  float auxBlend = max(alpha, 0.3);
  float dist = (a.x >= 999.0 || ha.x >= 999.0) ? a.x : mix(ha.x, a.x, auxBlend);
  float front = (a.z >= 999.0 || ha.z >= 999.0) ? min(a.z, ha.z) : mix(ha.z, a.z, auxBlend);
  float sigmaFront = (a.z >= 999.0 || ha.z >= 999.0) ? max(a.w, ha.w) : mix(ha.w, a.w, auxBlend);
  outAux = vec4(dist, a.y, front, sigmaFront);
  outAge = vec4(age, 0.0, 0.0, 1.0);
}
`;

export const COMPOSITE_FRAGMENT = /* glsl */ `
${RAY_HELPERS}
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tCloud;
uniform sampler2D tCloudAux;
uniform vec2 uLowSize;
uniform vec2 uAllocSize;

varying vec2 vUv;
layout(location = 0) out vec4 outColor;

vec4 cloudTap(vec2 texel) {
  return textureLod(tCloud, clamp(texel, vec2(0.5), uLowSize - 0.5) / uAllocSize, 0.0);
}

/* Catmull-Rom reconstruction from 9 bilinear taps (the two middle taps per axis merge into one). */
vec4 cloudCatmullRom(vec2 uv) {
  vec2 pos = uv * uLowSize;
  vec2 tc = floor(pos - 0.5) + 0.5;
  vec2 f = pos - tc;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = tc - 1.0;
  vec2 t12 = tc + w2 / w12;
  vec2 t3 = tc + 2.0;
  return (cloudTap(vec2(t0.x, t0.y)) * w0.x + cloudTap(vec2(t12.x, t0.y)) * w12.x + cloudTap(vec2(t3.x, t0.y)) * w3.x) * w0.y
       + (cloudTap(vec2(t0.x, t12.y)) * w0.x + cloudTap(vec2(t12.x, t12.y)) * w12.x + cloudTap(vec2(t3.x, t12.y)) * w3.x) * w12.y
       + (cloudTap(vec2(t0.x, t3.y)) * w0.x + cloudTap(vec2(t12.x, t3.y)) * w12.x + cloudTap(vec2(t3.x, t3.y)) * w3.x) * w3.y;
}

/* A low-res sample re-evaluated for geometry at dKm: its ray saw farther than this pixel, so only the cloud in front
   of dKm counts (exponential medium from the front with the stored front extinction, radiance per opacity kept). */
vec4 cloudAtDepth(vec4 c, vec4 a, float dKm) {
  if (a.y <= dKm * 1.03 || a.z >= 999.0) return c;
  if (dKm <= a.z) return vec4(0.0, 0.0, 0.0, 1.0);
  float Tp = max(c.a, exp(-a.w * (dKm - a.z)));
  return vec4(c.rgb * clamp((1.0 - Tp) / max(1.0 - c.a, 1e-4), 0.0, 1.0), Tp);
}

void main() {
  vec3 scene = texture(tScene, vUv).rgb;
  float d = texture(tDepth, vUv).r;
  vec3 vdir = cloudViewRay(vUv);
  float sceneKm = min(cloudSceneDistance(d, vdir) * 0.001, 1000.0);

  vec2 lp = vUv * uLowSize - 0.5;
  vec2 b = floor(lp);
  vec2 f = lp - b;
  ivec2 imax = ivec2(uLowSize) - 1;
  float minFront = 1000.0;
  float maxErr = 0.0;
  vec4 cmin = vec4(1e9);
  vec4 cmax = vec4(-1e9);
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 tp = clamp(ivec2(b) + ivec2(i, j), ivec2(0), imax);
      vec4 c = texelFetch(tCloud, tp, 0);
      vec4 a = texelFetch(tCloudAux, tp, 0);
      /* Depth only matters when geometry is in front of / inside the cloud (far behind it the value is identical),
         or when the sample stopped at nearer geometry and may have missed cloud this pixel sees. A cloud-free
         sample that reached at least this deep is exact for this pixel. */
      float cloudEnd = cloudEndKm(a);
      float relevant = smoothstep(cloudEnd * 1.6, cloudEnd * 1.1, min(a.y, sceneKm));
      bool matters = c.a < 0.998 || a.y < sceneKm * 0.97;
      maxErr = max(maxErr, matters ? abs(log(max(a.y, 1e-4) / max(sceneKm, 1e-4))) * relevant : 0.0);
      minFront = min(minFront, a.z);
      cmin = min(cmin, c);
      cmax = max(cmax, c);
    }
  }
  if (cmin.a > 0.998 && maxErr < 0.08) {
    /* Cloud-free neighbourhood: pass the scene through untouched. */
    outColor = vec4(scene, 1.0);
    return;
  }
  vec4 cloud;
#ifdef CLOUD_DEBUG_NOBICUBIC
  maxErr = 1.0;
#endif
  if (maxErr < 0.08) {
    /* Depth-continuous: sharp cubic reconstruction, clamped to the local range (no ringing). */
#ifdef CLOUD_DEBUG_BILINEAR
    cloud = cloudTap(vUv * uLowSize);
#else
    cloud = clamp(cloudCatmullRom(vUv), cmin, cmax);
#endif
    /* Thin geometry closer than the nearest cloud surface (towers, minarets) is never covered. */
    float vis = smoothstep(minFront * 0.85, minFront * 0.97, sceneKm);
    cloud = mix(vec4(0.0, 0.0, 0.0, 1.0), cloud, vis);
  } else {
    /* Depth edge: joint-bilateral 4x4 gather. Samples whose ray reached farther than this pixel are re-evaluated
       at its depth (always valid); samples that stopped short of it (nearer geometry) are down-weighted. */
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    for (int j = -1; j <= 2; j++) {
      for (int i = -1; i <= 2; i++) {
        ivec2 tp = clamp(ivec2(b) + ivec2(i, j), ivec2(0), imax);
        vec4 c = texelFetch(tCloud, tp, 0);
        vec4 a = texelFetch(tCloudAux, tp, 0);
        vec2 dd = abs(vec2(float(i), float(j)) - f);
        vec2 tent = max(1.0 - dd * 0.5, 0.0);
        float ws = tent.x * tent.x * tent.y * tent.y;
        float cloudEnd = cloudEndKm(a);
        float relevant = smoothstep(cloudEnd * 1.6, cloudEnd * 1.1, min(a.y, sceneKm));
        float shortfall = a.y < sceneKm * 0.97 ? abs(log(max(a.y, 1e-4) / max(sceneKm, 1e-4))) * relevant : 0.0;
        float w = ws * (exp(-shortfall * 12.0) + 1e-4);
        acc += cloudAtDepth(c, a, sceneKm) * w;
        wsum += w;
      }
    }
    cloud = acc / max(wsum, 1e-8);
  }
  outColor = vec4(scene * cloud.a + cloud.rgb, 1.0);
#ifdef CLOUD_DEBUG_NAN
  if (any(isnan(cloud)) || any(isinf(cloud))) outColor = vec4(50.0, 0.0, 50.0, 1.0);
  if (any(lessThan(cloud, vec4(0.0)))) outColor = vec4(0.0, 50.0, 0.0, 1.0);
#endif
}
`;

export const SHADOW_FRAGMENT = /* glsl */ `
uniform vec4 uShadowRegion;
varying vec2 vUv;
layout(location = 0) out vec4 outColor;

void main() {
  vec2 xz = uShadowRegion.xy + (vUv - 0.5) * uShadowRegion.z;
  float sy = max(uSunDir.y, 0.05);
  vec3 sr = vec3(uSunDir.x / sy, 1.0, uSunDir.z / sy);
  float h0 = CLOUD_SHADOW_REF_H;
  float h1 = CLOUD_SHADOW_TOP_H;
  float od = 0.0;
  float dh = (h1 - h0) / float(SHADOW_STEPS);
  float stepLen = dh * length(sr);
  float footprint = uShadowRegion.z / float(SHADOW_SIZE);
  for (int i = 0; i < SHADOW_STEPS; i++) {
    float hh = h0 + (float(i) + 0.5) * dh;
    vec3 p = vec3(xz.x + sr.x * (hh - h0), hh, xz.y + sr.z * (hh - h0));
    float alt = cloudAltitude(p);
    float hf;
    od += cloudDensity(p, alt, footprint, 0.0, vec2(0.0), hf) * stepLen;
  }
  /* Direct beam transmittance, floored by the diffuse light a sunlit cumulus still transmits (~15 %). */
  float T = 0.15 + 0.85 * exp(-od * uCloudShape.y * 0.6);
  outColor = vec4(T, T, T, 1.0);
}
`;
