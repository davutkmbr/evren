import { DETAIL_TILE_METERS } from '../config';
import { glslFloat } from './height.glsl';

const f = glslFloat;

/**
 * Mineral grounds (sand, rock, paving, quays, airport, sea floor) and the near-camera detail tiles.
 * Far away every material reduces to its tile's mip average or an analytic mean, so the look stays coherent from
 * a few metres to tens of kilometres.
 */
export const GROUND_GLSL = /* glsl */ `
uniform sampler2DArray uDetail;

#define DETAIL_LAYERS 7.0

float detailTile(float layer) {
  return layer < 0.5 ? ${f(DETAIL_TILE_METERS[0])} : layer < 1.5 ? ${f(DETAIL_TILE_METERS[1])} : layer < 2.5 ? ${f(DETAIL_TILE_METERS[2])} : layer < 3.5 ? ${f(DETAIL_TILE_METERS[3])} : layer < 4.5 ? ${f(DETAIL_TILE_METERS[4])} : layer < 5.5 ? ${f(DETAIL_TILE_METERS[5])} : ${f(DETAIL_TILE_METERS[6])};
}

/* Detail tile with a second rotated, 3.7x larger sample that modulates it (no visible repetition). */
Mat detailSample(float layer, Px px, float scaleMix) {
  float T = detailTile(layer);
  vec2 uv = px.p / T;
  vec4 a = textureGrad(uDetail, vec3(uv, layer), px.dx / T, px.dy / T);
  vec4 n = textureGrad(uDetail, vec3(uv, layer + DETAIL_LAYERS), px.dx / T, px.dy / T);
  mat2 R = rotM(1.1);
  float T2 = T * 3.7;
  vec4 b = textureGrad(uDetail, vec3((R * px.p) / T2 + 0.37, layer), (R * px.dx) / T2, (R * px.dy) / T2);
  float la = max(luma(a.rgb), 0.02);
  vec3 alb = mix(a.rgb, a.rgb * clamp(luma(b.rgb) / la, 0.6, 1.5), scaleMix);
  Mat m = matMake(alb, 0.9);
  m.slope = (n.rg * 2.0 - 1.0) * 1.2;
  return m;
}

float detailFade(Px px) {
  return px.cheap ? 0.0 : smoothstep(uTerrainRanges.z, uTerrainRanges.z * 0.3, px.dist);
}

Mat matSand(Px px, float coast) {
  vec4 n = nTex(px, 240.0);
  vec3 base = vec3(0.44, 0.38, 0.27) * (0.88 + 0.24 * n.r);
  Mat m = matMake(base, 0.9);
#if TERRAIN_TIER == 0
  float fd = detailFade(px);
  if (fd > 0.0) m = matMix(m, detailSample(4.0, px, 0.5), fd);
#endif
  // Swash zone: wet, darker, smoother sand near the water line; wrack line of seaweed above it.
  float wet = 1.0 - smoothstep(2.0, 8.0 + 4.0 * n.g, coast);
  float wrack = smoothstep(1.2, 0.0, abs(coast - 9.0 - 3.0 * n.b)) * 0.5;
  m.alb *= mix(1.0, 0.5, wet) * (1.0 - 0.3 * wrack);
  m.rough = mix(m.rough, 0.25, wet);
  return m;
}

Mat matRock(Px px) {
  vec4 n = nTex(px, 420.0);
  vec3 base = mix(vec3(0.2, 0.19, 0.17), vec3(0.28, 0.23, 0.17), n.r) * (0.85 + 0.3 * n.b);
  Mat m = matMake(base, 0.85);
#if TERRAIN_TIER == 0
  float fd = px.cheap ? 0.0 : smoothstep(uTerrainRanges.z * 1.3, uTerrainRanges.z * 0.3, px.dist);
  if (fd > 0.0) m = matMix(m, detailSample(5.0, px, 0.6), fd);
#endif
  return m;
}

Mat matPaved(Px px) {
  vec4 n = nTex(px, 180.0);
  Mat m = matMake(vec3(0.24, 0.23, 0.21) * (0.85 + 0.3 * n.r), 0.8);
#if TERRAIN_TIER == 0
  float fd = detailFade(px);
  if (fd > 0.0) m = matMix(m, detailSample(1.0, px, 0.4), fd);
#endif
  return m;
}

/* Stone quays / rip-rap along the shore. */
Mat matShore(Px px, float coast) {
  vec4 n = nTex(px, 90.0);
  Mat m = matMake(vec3(0.27, 0.26, 0.24) * (0.8 + 0.4 * n.r), 0.8);
#if TERRAIN_TIER == 0
  float fd = detailFade(px);
  if (fd > 0.0) m = matMix(m, detailSample(5.0, px, 0.3), fd * 0.5);
#endif
  float wet = 1.0 - smoothstep(0.4, 2.2, coast);
  m.alb *= mix(1.0, 0.42, wet);
  // Algae line at the waterline.
  m.alb = mix(m.alb, vec3(0.05, 0.07, 0.035), (1.0 - smoothstep(0.0, 0.8, coast)) * 0.6);
  m.rough = mix(m.rough, 0.22, wet);
  return m;
}

Mat matAirport(Px px, float grassW) {
  vec4 n = nTex(px, 900.0);
  vec2 cell = floor(px.p / 7.5);
  float slab = hash12(cell);
  float near = 1.0 - smoothstep(0.4, 1.2, px.fp);
  vec3 concrete = vec3(0.3, 0.29, 0.27) * (0.92 + 0.16 * mix(0.5, slab, near)) * (0.9 + 0.2 * n.r);
  vec2 j = abs(fract(px.p / 7.5) - 0.5) * 7.5;
  float joint = aaStep(3.62, max(j.x, j.y), px.fp);
  concrete *= 1.0 - 0.22 * joint * near;
  // Tyre marks darken the runway / taxiway centre areas.
  concrete *= 1.0 - 0.25 * smoothstep(0.62, 0.8, n.b);
  Mat m = matMake(concrete, 0.8);
  float gw = smoothstep(0.45, 0.55, n.g + grassW * 0.3);
  vec3 grass = mix(vec3(0.09, 0.1, 0.045), vec3(0.2, 0.17, 0.09), n.a);
  m.alb = mix(m.alb, grass, gw);
  m.rough = mix(m.rough, 0.95, gw);
  return m;
}

/* Sea floor (seen from under water or through wave troughs): sand in the shallows, silt and weed deeper. */
Mat matSeaFloor(Px px, float depth) {
  vec4 n = nTex(px, 300.0);
  vec3 sand = vec3(0.34, 0.3, 0.22);
  vec3 silt = vec3(0.1, 0.095, 0.075);
  vec3 weed = vec3(0.04, 0.06, 0.03);
  float t = smoothstep(1.5, 14.0, depth);
  vec3 c = mix(sand, silt, t);
  c = mix(c, weed, smoothstep(0.58, 0.7, n.a) * (1.0 - t) * 0.7);
  c *= 0.85 + 0.3 * n.r;
  return matMake(c, 0.9);
}
`;
