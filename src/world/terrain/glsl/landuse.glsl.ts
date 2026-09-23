import { DISTRICT_TEX_SIZE, GEO_LANDUSE_SIZE } from '../config';
import { glslFloat } from './height.glsl';

/**
 * Land-use descriptor blending: bilinear over the 4096² land-use raster with a domain-warped lookup (organic zone
 * edges instead of 11.7 m stair steps), plus the district map (density, style) and the horizon extension classes.
 * Zone interiors (all four cells equal, the vast majority of pixels) take a single table lookup.
 */
export const LANDUSE_GLSL = /* glsl */ `
uniform sampler2D uLandUse;
uniform sampler2D uDistrictMap;
uniform vec4 uLandUseTable[48];

#define LU_N ${glslFloat(GEO_LANDUSE_SIZE)}
#define DISTRICT_N ${glslFloat(DISTRICT_TEX_SIZE)}

/*
 * a = (built fabric, paved, tree canopy, lawn)
 * b = (sand, farmland, bare/rock, quay stone)
 * c = (airport, cemetery, night-light density, irrigation)
 * style = carpet style weights (dense, historic, modern, villa); ind = industrial; generic = plain Urban class
 */
struct Land {
  vec4 a;
  vec4 b;
  vec4 c;
  vec4 style;
  float ind;
  float road;
  float generic;
  float density;
  float highrise;
};

Land landZero() {
  Land d;
  d.a = vec4(0.0);
  d.b = vec4(0.0);
  d.c = vec4(0.0);
  d.style = vec4(0.0);
  d.ind = 0.0;
  d.road = 0.0;
  d.generic = 0.0;
  d.density = 0.0;
  d.highrise = 0.0;
  return d;
}

void landAdd(inout Land d, int cls, float w) {
  d.a += uLandUseTable[cls * 3] * w;
  d.b += uLandUseTable[cls * 3 + 1] * w;
  d.c += uLandUseTable[cls * 3 + 2] * w;
  d.generic += cls == 2 ? w : 0.0;
  d.style.y += cls == 3 ? w : 0.0;
  d.style.z += cls == 4 ? w : 0.0;
  d.highrise += cls == 4 ? w : 0.0;
  d.ind += cls == 5 ? w : 0.0;
  d.style.w += cls == 13 ? w : 0.0;
  d.road += cls == 12 ? w : 0.0;
}

int landClass(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(int(LU_N) - 1));
  return int(texelFetch(uLandUse, c, 0).r * 255.0 + 0.5);
}

Land landWorld(vec2 p, vec2 warp) {
  Land d = landZero();
  vec2 f = (p + warp + WORLD_HALF) / (2.0 * WORLD_HALF) * LU_N - 0.5;
  vec2 fi = floor(f);
  vec2 t = smoothstep(0.2, 0.8, f - fi);
  ivec2 i = ivec2(fi);
  int c00 = landClass(i);
  int c10 = landClass(i + ivec2(1, 0));
  int c01 = landClass(i + ivec2(0, 1));
  int c11 = landClass(i + ivec2(1, 1));
  if (c00 == c10 && c00 == c01 && c00 == c11) {
    landAdd(d, c00, 1.0);
  } else {
    landAdd(d, c00, (1.0 - t.x) * (1.0 - t.y));
    landAdd(d, c10, t.x * (1.0 - t.y));
    landAdd(d, c01, (1.0 - t.x) * t.y);
    landAdd(d, c11, t.x * t.y);
  }
  d.density = textureLod(uDistrictMap, (p + WORLD_HALF) / (2.0 * WORLD_HALF), 0.0).r;
  return d;
}

/* District style code at a world point (nearest): 0 historic, 1 dense, 2 modern, 3 highrise, 4 villa, 5 yali, 6 industrial, 7 suburban. */
int districtStyleAt(vec2 p) {
  ivec2 c = clamp(ivec2((p + WORLD_HALF) / (2.0 * WORLD_HALF) * DISTRICT_N), ivec2(0), ivec2(int(DISTRICT_N) - 1));
  vec4 t = texelFetch(uDistrictMap, c, 0);
  if (t.a < 0.5) return 1;
  return int(t.g * 255.0 / 32.0 + 0.5);
}

/* Horizon ring classes from the baked extension: ext = (height, town cover, forest cover, signed coast distance). */
Land landExt(vec4 ext) {
  Land d = landZero();
  float land = step(0.0, ext.a);
  float urban = ext.g * land;
  float forest = ext.b * land;
  float farm = max(land - urban - forest, 0.0);
  float shore = land * (1.0 - smoothstep(4.0, 30.0, ext.a));
  d.a = vec4(urban, 0.0, forest, farm * 0.3);
  d.b = vec4(shore * 0.6, farm * 0.7, 0.0, shore * 0.4);
  d.c = vec4(0.0, 0.0, urban * 0.8, 0.2);
  d.style = vec4(urban * 0.5, 0.0, urban * 0.2, urban * 0.3);
  d.density = urban * 0.65;
  return d;
}

Land landMix(Land a, Land b, float t) {
  a.a = mix(a.a, b.a, t);
  a.b = mix(a.b, b.b, t);
  a.c = mix(a.c, b.c, t);
  a.style = mix(a.style, b.style, t);
  a.ind = mix(a.ind, b.ind, t);
  a.road = mix(a.road, b.road, t);
  a.generic = mix(a.generic, b.generic, t);
  a.density = mix(a.density, b.density, t);
  a.highrise = mix(a.highrise, b.highrise, t);
  return a;
}
`;
