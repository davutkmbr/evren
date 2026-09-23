import { EXT_BLEND_OUTSIDE, GEO_HEIGHT_CELL, GEO_HEIGHT_ORIGIN, GEO_HEIGHT_SIZE, ROOT_SIZE, WORLD_HALF } from '../config';

export const glslFloat = (n: number): string => {
  const s = Number(n.toPrecision(9)).toString();
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

/**
 * Terrain elevation shared by the vertex and fragment stages.
 * Inside the world square the geo grid is reproduced exactly (same cell-centred bilinear as GeoQuery.heightAt,
 * via texelFetch so no filtering precision is lost). Outside, the geo edge profile relaxes into the baked horizon
 * extension over EXT_BLEND_OUTSIDE metres, so the transition is continuous at the world edge.
 */
export const HEIGHT_GLSL = /* glsl */ `
uniform sampler2D uGeoHeight;
uniform sampler2D uExtMap;

#define WORLD_HALF ${glslFloat(WORLD_HALF)}
#define GEO_N ${glslFloat(GEO_HEIGHT_SIZE)}
#define GEO_CELL ${glslFloat(GEO_HEIGHT_CELL)}
#define GEO_ORIGIN ${glslFloat(GEO_HEIGHT_ORIGIN)}
#define ROOT_SIZE ${glslFloat(ROOT_SIZE)}
#define EXT_BLEND ${glslFloat(EXT_BLEND_OUTSIDE)}

float geoHeightExact(vec2 p) {
  vec2 f = clamp((p - GEO_ORIGIN) / GEO_CELL, vec2(0.0), vec2(GEO_N - 1.0001));
  vec2 fi = floor(f);
  ivec2 i = ivec2(fi);
  vec2 t = f - fi;
  float a = texelFetch(uGeoHeight, i, 0).r;
  float b = texelFetch(uGeoHeight, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uGeoHeight, i + ivec2(0, 1), 0).r;
  float d = texelFetch(uGeoHeight, i + ivec2(1, 1), 0).r;
  return (a + (b - a) * t.x) * (1.0 - t.y) + (c + (d - c) * t.x) * t.y;
}

/* Hardware-filtered geo height (fragment normals). */
float geoHeightFiltered(vec2 p) {
  return textureLod(uGeoHeight, (p + WORLD_HALF) / (2.0 * WORLD_HALF), 0.0).r;
}

vec4 extSample(vec2 p) {
  return textureLod(uExtMap, p / ROOT_SIZE + 0.5, 0.0);
}

/* Signed distance to the world square edge: negative inside. */
float worldEdgeDistance(vec2 p) {
  vec2 q = abs(p) - WORLD_HALF;
  return max(q.x, q.y);
}

/* Ridged micro relief for the horizon ring (the 187 m extension raster is too smooth for mountain silhouettes). */
float extRelief(vec2 p, float h) {
  if (h <= 2.0) return 0.0;
  vec2 q = p * 0.0011;
  float r = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(vnoise2(q) * 2.0 - 1.0);
    r += a * n * n;
    q = mat2(1.6, 1.2, -1.2, 1.6) * q;
    a *= 0.5;
  }
  return (r - 0.35) * clamp(h * 0.16, 0.0, 60.0);
}

float extHeight(vec2 p) {
  float h = extSample(p).r;
  return h + extRelief(p, h);
}

/* Blend weight of the extension at p (0 inside the world). */
float extWeight(vec2 p) {
  float e = worldEdgeDistance(p);
  return e <= 0.0 ? 0.0 : smoothstep(0.0, EXT_BLEND, e);
}

/* Filtered (hardware bilinear) version for per-pixel normals. */
float terrainHeightFiltered(vec2 p) {
  float e = worldEdgeDistance(p);
  if (e <= 0.0) return geoHeightFiltered(p);
  float w = smoothstep(0.0, EXT_BLEND, e);
  float edge = geoHeightFiltered(clamp(p, vec2(-WORLD_HALF), vec2(WORLD_HALF)));
  return mix(edge, extHeight(p), w);
}

float terrainHeight(vec2 p) {
  float e = worldEdgeDistance(p);
  if (e <= 0.0) return geoHeightExact(p);
  float w = smoothstep(0.0, EXT_BLEND, e);
  float edge = geoHeightExact(clamp(p, vec2(-WORLD_HALF), vec2(WORLD_HALF)));
  return mix(edge, extHeight(p), w);
}
`;
