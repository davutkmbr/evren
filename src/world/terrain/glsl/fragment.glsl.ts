import { GROUND_GLSL } from './ground.glsl';
import { HEIGHT_GLSL } from './height.glsl';
import { LANDUSE_GLSL } from './landuse.glsl';
import { NATURE_GLSL } from './nature.glsl';
import { PIXEL_GLSL } from './pixel.glsl';
import { ROADS_GLSL } from './roads.glsl';
import { URBAN_GLSL } from './urban.glsl';

/**
 * Fragment declarations, appended after three's pars chunks (SHARED_GLSL is available here).
 * TERRAIN_TIER (0 near, 1 mid, 2 far) strips code that cannot contribute at that distance.
 */
export const FRAGMENT_PARS_GLSL = /* glsl */ `
${HEIGHT_GLSL}
${PIXEL_GLSL}
${LANDUSE_GLSL}
${GROUND_GLSL}
${NATURE_GLSL}
${URBAN_GLSL}
#if TERRAIN_TIER < 2
${ROADS_GLSL}
#endif
uniform sampler2D uCoast;
/* x = debug view (1 lod, 2 land use, 3 grey, 4 lighting only), y = resources ready, z = profiling mask. */
uniform vec4 uTerrainDebug;
varying vec3 vTerrainPos;
varying float vTerrainLod;

struct TerrainSurface {
  vec3 albedo;
  float roughness;
  vec3 normal;
  vec3 macroNormal;
  vec3 emissive;
  float ao;
  /* Multiplies the key light: micro / statistical shadows and the far city's facade lighting. */
  vec3 directScale;
};

vec3 terrainMacroNormal(vec2 p, float fp) {
  float e = max(GEO_CELL, fp);
  float l = terrainHeightFiltered(p - vec2(e, 0.0));
  float r = terrainHeightFiltered(p + vec2(e, 0.0));
  float n = terrainHeightFiltered(p - vec2(0.0, e));
  float s = terrainHeightFiltered(p + vec2(0.0, e));
  return normalize(vec3(l - r, 2.0 * e, n - s));
}

vec3 debugPalette(float x) {
  return 0.5 + 0.5 * cos(6.2831 * (x + vec3(0.0, 0.33, 0.67)));
}

TerrainSurface evalTerrain(vec3 wp) {
  TerrainSurface s;
  Px px = pxMake(wp);
  px.cheap = cameraPosition.y < -0.5 || uTerrainDebug.y < 0.5;
  vec2 p = px.p;
  float night = uTerrainLights.z * uTerrainLights.x;

  vec3 macroN = terrainMacroNormal(p, px.fp);
  float slope = 1.0 - macroN.y;

  float extW = extWeight(p);
  vec4 nw = nTex(px, 260.0);
  vec2 warp = (nw.rg - 0.5) * 26.0;
  Land d = landZero();
  float coast = 0.0;
  if (extW < 1.0) {
    d = landWorld(p, warp);
    coast = textureLod(uCoast, (p + WORLD_HALF) / (2.0 * WORLD_HALF), 0.0).r;
  }
  if (extW > 0.0) {
    vec4 ext = extSample(p);
    Land de = landExt(ext);
    if (extW >= 1.0) d = de;
    else d = landMix(d, de, extW);
    coast = mix(coast, ext.a, extW);
  }

  float lightDensity = d.c.z;
  Facade fc = facadeNone();
  float facadeShare = 0.0;
  Mat acc;
  if (wp.y < -0.05 && coast < 0.0) {
    acc = matSeaFloor(px, -wp.y);
  } else {
    float wBuilt = d.a.x;
    float wPaved = d.a.y;
    float wCanopy = d.a.z;
    float wLawn = d.a.w;
    float wSand = d.b.x;
    float wFarm = d.b.y;
    float wBare = d.b.z;
    float wShore = d.b.w;
    float wAirport = d.c.x;
    float wCem = d.c.y;
    // Steep natural slopes shed their soil: rock and scree.
    float natural = wCanopy + wLawn + wFarm;
    float steep = smoothstep(0.3, 0.52, slope + (nw.b - 0.5) * 0.25) * 0.85;
    wBare += natural * steep;
    wCanopy *= 1.0 - steep;
    wLawn *= 1.0 - steep;
    wFarm *= 1.0 - steep;

    acc = matZero();
    float total = 0.0;
    if (wBuilt > 0.01) {
      Mat m;
#if TERRAIN_TIER == 0
      m = matUrbanGround(px, d, lightDensity);
#else
      float carpetT = clamp((px.dist - uTerrainRanges.x) * uTerrainRanges.y, 0.0, 1.0);
      if (carpetT < 1.0) m = matUrbanGround(px, d, lightDensity);
      if (carpetT > 0.0) {
        Mat mc = matCarpet(px, d, wp, lightDensity, night, fc);
        if (carpetT < 1.0) m = matMix(m, mc, carpetT);
        else m = mc;
        fc.frac *= carpetT;
      }
#endif
      matAccum(acc, m, wBuilt);
      total += wBuilt;
    }
    if (wPaved > 0.01) {
      Mat m = matPaved(px);
      // Road land-use cells beyond the analytic road range read as asphalt ribbons.
      float asphaltFar = d.road / max(wPaved, 1e-3) * smoothstep(uTerrainRanges.w * 0.8, uTerrainRanges.w, px.dist);
      m.alb = mix(m.alb, vec3(0.07, 0.07, 0.074), clamp(asphaltFar, 0.0, 1.0));
      if (night > 0.0) m.emit = mix(LAMP_SODIUM, LAMP_COOL, 0.3) * (0.05 + 0.25 * asphaltFar) * lightDensity * night;
      matAccum(acc, m, wPaved);
      total += wPaved;
    }
    float wVeg = wCanopy + wLawn;
    if (wVeg > 0.01) {
      float coverage = wCanopy / wVeg;
      Mat m;
      if (coverage > 0.9) m = matForestFloor(px);
      else m = matGrass(px, d.c.w);
      if (coverage > 0.02) m = matCanopy(px, coverage, m);
      matAccum(acc, m, wVeg);
      total += wVeg;
    }
    if (wFarm > 0.01) {
      matAccum(acc, matFarm(px), wFarm);
      total += wFarm;
    }
    if (wSand > 0.01) {
      matAccum(acc, matSand(px, coast), wSand);
      total += wSand;
    }
    if (wBare > 0.01) {
      matAccum(acc, matRock(px), wBare);
      total += wBare;
    }
    if (wShore > 0.01) {
      matAccum(acc, matShore(px, coast), wShore);
      total += wShore;
    }
    if (wAirport > 0.01) {
      matAccum(acc, matAirport(px, wLawn), wAirport);
      total += wAirport;
    }
    if (wCem > 0.01) {
      matAccum(acc, matCemetery(px), wCem);
      total += wCem;
    }
    float inv = 1.0 / max(total, 1e-4);
    acc.alb *= inv;
    acc.slope *= inv;
    acc.rough *= inv;
    acc.ao *= inv;
    acc.vis *= inv;
    acc.emit *= inv;
    facadeShare = fc.frac * wBuilt * inv;
    if (total < 1e-3) acc = matMake(vec3(0.2, 0.18, 0.15), 0.9);

    // Quay / shore band on every non-sand coast.
    float band = (1.0 - smoothstep(2.5, 7.0 + 4.0 * nw.a, coast)) * (1.0 - clamp(wSand * 2.0, 0.0, 1.0));
    if (band > 0.01) {
      acc = matMix(acc, matShore(px, coast), band);
      facadeShare *= 1.0 - band;
    }

#if TERRAIN_TIER < 2
    // Analytic roads.
    if (!px.cheap && px.dist < uTerrainRanges.w && wp.y > 0.2 && extW < 1.0) {
      RoadHit r;
      if (roadQuery(p, r)) {
        vec3 asphalt = vec3(0.066, 0.066, 0.07);
#if TERRAIN_TIER == 0
        float fd = detailFade(px);
        if (fd > 0.0) asphalt = mix(asphalt, detailSample(0.0, px, 0.5).alb, fd);
#endif
        RoadShade rs = shadeRoad(r, px, wBuilt, asphalt, night);
        float fade = smoothstep(uTerrainRanges.w, uTerrainRanges.w * 0.8, px.dist);
        float c = rs.cover * fade;
        acc.alb = mix(acc.alb, rs.alb, c);
        acc.rough = mix(acc.rough, rs.rough, c);
        acc.slope *= 1.0 - c;
        acc.ao = mix(acc.ao, 1.0, c * 0.5);
        acc.vis = mix(acc.vis, 1.0, c * 0.5);
        acc.emit = mix(acc.emit, vec3(0.0), c * 0.8) + rs.emit * fade;
        facadeShare *= 1.0 - c;
      }
    }
#endif
  }

  vec3 n = normalize(vec3(macroN.x + acc.slope.x, macroN.y, macroN.z + acc.slope.y));
  vec3 gAlb = clamp(acc.alb, 0.0, 1.0);
  float ff = clamp(facadeShare, 0.0, 0.95);
  vec3 alb = mix(gAlb, fc.alb, ff);
  // Key light: ground part with N·L and its shadowing, facade part with the facade light factor.
  float nl = dot(n, px.keyDir);
  vec3 desired = (1.0 - ff) * gAlb * max(nl, 0.0) * clamp(acc.vis, 0.0, 1.0) + ff * fc.alb * fc.lit;
  s.directScale = clamp(desired / max(alb * max(nl, 0.04), vec3(1e-4)), 0.0, 40.0);
  s.macroNormal = macroN;
  s.normal = n;
  s.albedo = alb;
  s.roughness = clamp(acc.rough, 0.04, 1.0);
  s.ao = clamp(mix(acc.ao, 0.62, ff), 0.0, 1.0);
  s.emissive = mix(acc.emit, fc.emit, ff);

  int dbg = int(uTerrainDebug.x + 0.5);
  if (dbg == 1) {
    s.albedo = debugPalette(vTerrainLod / 10.0);
    s.directScale = vec3(1.0);
  } else if (dbg == 2) {
    s.albedo = vec3(d.a.x, d.a.z + d.a.w, d.b.y + d.b.x) * 0.5;
    s.normal = macroN;
    s.directScale = vec3(1.0);
  } else if (dbg == 3) {
    s.albedo = vec3(0.18);
  }
  return s;
}
`;

export const FRAGMENT_MAIN_GLSL = /* glsl */ `
TerrainSurface terrainSurf = evalTerrain(vTerrainPos);
vec3 terrainDirectScale = terrainSurf.directScale;
diffuseColor.rgb = terrainSurf.albedo;
`;
