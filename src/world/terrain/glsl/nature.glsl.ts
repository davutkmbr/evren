import { NATURE_HEIGHT_RANGE, NATURE_TILE_METERS } from '../config';
import { glslFloat } from './height.glsl';

const f = glslFloat;

/**
 * Vegetated ground: forest canopy (mixed Istanbul broadleaf/pine seen from above), parks with scattered trees, lawns
 * (irrigated green vs. dry summer grass), Thrace farmland patchwork and Muslim cemeteries (cypress, grave rows).
 * Near: two rotated canopy samples with height-blend and micro shadows; far: one mip sample + statistical shadowing.
 */
export const NATURE_GLSL = /* glsl */ `
uniform sampler2DArray uNature;

#define NATURE_LAYERS 2.0
#define NATURE_RANGE ${f(NATURE_HEIGHT_RANGE)}
#define FOREST_T ${f(NATURE_TILE_METERS[0])}
#define CEMETERY_T ${f(NATURE_TILE_METERS[1])}
/* Cemetery rows face the qibla (graves lie across the 151° bearing). */
#define CEMETERY_ANGLE 2.077

/* Key-light visibility from a tile height channel: marches toward the light in tile space (micro shadows). */
float tileShadow(sampler2DArray tex, float layer, vec2 uv, mat2 R, Px px, float T, float h0, float range) {
  if (px.keyDir.y <= 0.0 || px.cheap) return 1.0;
  vec2 dir = (R * px.keyXZ) / T;
  vec2 gx = (R * px.dx) / T;
  vec2 gy = (R * px.dy) / T;
  float vis = 1.0;
  for (int i = 0; i < 3; i++) {
    float d = i == 0 ? 2.5 : i == 1 ? 7.0 : 16.0;
    float hi = textureGrad(tex, vec3(uv + dir * d, layer), gx, gy).a * range;
    float occl = hi - (h0 + d * px.keyTan);
    vis *= 1.0 - smoothstep(0.0, 1.5 + d * 0.15, occl);
  }
  return vis;
}

/* Statistical canopy shadowing (gaps between crowns in shade) once the crowns are sub-pixel. */
float canopyStatShadow(Px px) {
  float tanA = max(px.keyDir.y, 0.0) / max(length(px.keyDir.xz), 0.05);
  return 1.0 - 0.42 * (1.0 - exp(-7.0 / (9.0 * max(tanA, 0.03))));
}

/* Canopy with coverage masking (1 = closed forest, 0.3 = park with scattered trees) over a ground material. */
Mat matCanopy(Px px, float coverage, Mat ground) {
  vec4 nm = nTex(px, 2300.0);
  float T = FOREST_T;
  mat2 R1 = mat2(1.0);
  vec2 uv1 = px.p / T;
  vec4 alb = textureGrad(uNature, vec3(uv1, 0.0), px.dx / T, px.dy / T);
  vec4 aux = textureGrad(uNature, vec3(uv1, NATURE_LAYERS), px.dx / T, px.dy / T);
  mat2 R = R1;
  vec2 uv = uv1;
#if TERRAIN_TIER == 0
  // Second rotated copy; per pixel the taller crown wins (height blend => no ghosting, no visible repetition).
  mat2 R2 = rotM(2.2);
  vec2 uv2 = (R2 * px.p) / T + 0.43;
  vec4 a2 = textureGrad(uNature, vec3(uv2, 0.0), (R2 * px.dx) / T, (R2 * px.dy) / T);
  vec4 x2 = textureGrad(uNature, vec3(uv2, NATURE_LAYERS), (R2 * px.dx) / T, (R2 * px.dy) / T);
  float sel = smoothstep(-0.03, 0.03, a2.a - alb.a + (nm.b - 0.5) * 0.25);
  alb = mix(alb, a2, sel);
  aux = mix(aux, x2, sel);
  if (sel > 0.5) {
    R = R2;
    uv = uv2;
  }
#endif
  // Species / age patches: darker pine stands, lighter young broadleaf, first autumn yellowing (late September).
  vec3 tint = mix(vec3(0.82, 0.9, 0.95), vec3(1.12, 1.08, 0.92), nm.r);
  tint = mix(tint, vec3(1.3, 1.15, 0.7), smoothstep(0.72, 0.9, nm.g) * 0.35);
  Mat m = matMake(alb.rgb * tint, 0.85);
  float far = smoothstep(0.8, 3.0, px.fp);
  m.slope = transpose(R) * (aux.rg * 2.0 - 1.0) * 1.3 * (1.0 - far);
  float h0 = alb.a * NATURE_RANGE;
#if TERRAIN_TIER == 0
  m.vis = mix(tileShadow(uNature, 0.0, uv, R, px, T, h0, NATURE_RANGE), canopyStatShadow(px), far);
#else
  m.vis = canopyStatShadow(px);
#endif
  m.ao = mix(mix(0.55, 1.0, smoothstep(0.15, 0.6, alb.a)), 0.8, far);
  if (coverage >= 0.999) return m;
  // Coverage: crowns whose id is above the coverage are removed (ground shows); far away use the statistics.
  float crown = aux.a;
  float keep = crown * step(aux.b, coverage);
  float w = mix(keep, coverage * (0.6 + 0.4 * crown), far);
  ground.vis = mix(ground.vis, m.vis, 0.5);
  return matMix(ground, m, clamp(w, 0.0, 1.0));
}

Mat matGrass(Px px, float irrigation) {
  vec4 n = nTex(px, 380.0);
  vec3 lush = vec3(0.05, 0.085, 0.028);
  vec3 dry = vec3(0.19, 0.16, 0.09);
  float dryness = clamp(1.0 - irrigation + (n.r - 0.5) * 0.7, 0.0, 1.0);
  vec3 base = mix(lush, dry, dryness) * (0.8 + 0.4 * n.b);
  Mat m = matMake(base, 0.95);
#if TERRAIN_TIER == 0
  float fd = detailFade(px);
  if (fd > 0.0) {
    Mat dm = detailSample(2.0, px, 0.5);
    m.alb = mix(m.alb, dm.alb * (base / vec3(0.075, 0.105, 0.04)), fd * 0.8);
    m.slope = dm.slope * fd;
  }
#endif
  return m;
}

Mat matForestFloor(Px px) {
  Mat m = matMake(vec3(0.05, 0.043, 0.03), 0.95);
#if TERRAIN_TIER == 0
  float fd = detailFade(px);
  if (fd > 0.0) m = matMix(m, detailSample(6.0, px, 0.4), fd);
#endif
  return m;
}

/* Field patchwork (Thrace / Kocaeli plateau): Voronoi fields with stubble, ploughed soil, late crops, fallow; hedgerows. */
Mat matFarm(Px px) {
  vec2 g = px.p / 140.0;
  vec2 i = floor(g);
  vec2 fr = fract(g);
  float d1 = 9.0;
  float d2 = 9.0;
  vec2 r1 = vec2(0.0);
  vec2 r2 = vec2(0.0);
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + hash22(i + o + 91.0) * vec2(0.9, 0.4) + vec2(0.05, 0.3) - fr;
      r.x *= 0.6;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        r2 = r1;
        d1 = d;
        r1 = r;
        id = hash12(i + o + 13.0);
      } else if (d < d2) {
        d2 = d;
        r2 = r;
      }
    }
  }
  float edge = dot(0.5 * (r1 + r2), normalize(r2 - r1)) * 140.0;
  vec3 c;
  if (id < 0.32) c = vec3(0.3, 0.25, 0.145);
  else if (id < 0.5) c = vec3(0.14, 0.1, 0.063);
  else if (id < 0.62) c = vec3(0.07, 0.1, 0.035);
  else if (id < 0.84) c = vec3(0.21, 0.18, 0.1);
  else c = vec3(0.12, 0.1, 0.06);
  vec4 n = nTexAt(px, px.p + id * 900.0, 190.0);
  c *= 0.85 + 0.3 * n.r;
  Mat m = matMake(c, 0.95);
#if TERRAIN_TIER == 0
  if (id >= 0.32 && id < 0.5) {
    float fd = detailFade(px);
    if (fd > 0.0) {
      mat2 R = rotM(id * 12.0);
      float T = detailTile(3.0);
      vec2 uv = (R * px.p) / T;
      vec4 s = textureGrad(uDetail, vec3(uv, 3.0), (R * px.dx) / T, (R * px.dy) / T);
      vec4 nn = textureGrad(uDetail, vec3(uv, 3.0 + DETAIL_LAYERS), (R * px.dx) / T, (R * px.dy) / T);
      m.alb = mix(m.alb, s.rgb * (c / vec3(0.14, 0.1, 0.065)), fd);
      m.slope = transpose(R) * (nn.rg * 2.0 - 1.0) * fd;
    }
  }
#endif
  float hedge = (1.0 - aaStep(2.2, edge, px.fp)) * clamp(4.4 / max(px.fp, 1e-3), 0.0, 1.0);
  vec3 border = hash12(i + 5.0) < 0.5 ? vec3(0.035, 0.05, 0.022) : vec3(0.26, 0.23, 0.17);
  m.alb = mix(m.alb, border, hedge);
  return m;
}

Mat matCemetery(Px px) {
  float T = CEMETERY_T;
  mat2 R = rotM(CEMETERY_ANGLE);
  vec2 uv = (R * px.p) / T;
  vec2 gx = (R * px.dx) / T;
  vec2 gy = (R * px.dy) / T;
  vec4 alb = textureGrad(uNature, vec3(uv, 1.0), gx, gy);
  Mat m = matMake(alb.rgb, 0.85);
  float far = smoothstep(0.8, 3.0, px.fp);
#if TERRAIN_TIER < 2
  vec4 aux = textureGrad(uNature, vec3(uv, 1.0 + NATURE_LAYERS), gx, gy);
  m.slope = transpose(R) * (aux.rg * 2.0 - 1.0) * 1.3 * (1.0 - far);
#endif
#if TERRAIN_TIER == 0
  m.vis = mix(tileShadow(uNature, 1.0, uv, R, px, T, alb.a * NATURE_RANGE, NATURE_RANGE), canopyStatShadow(px), far);
#else
  m.vis = canopyStatShadow(px);
#endif
  m.ao = mix(0.6, 1.0, smoothstep(0.05, 0.5, alb.a));
  return m;
}
`;
