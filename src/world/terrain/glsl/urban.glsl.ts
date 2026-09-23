import { CARPET_HEIGHT_RANGE, CARPET_TILE_METERS } from '../config';
import { glslFloat } from './height.glsl';

const f = glslFloat;

/**
 * Built-up ground.
 * - Near (inside the city module's building radius): neutral streetscape ground between the 3D buildings.
 * - Far ("city carpet"): top-down urban fabric tiles, rotated per ~650 m neighbourhood, with a statistical facade model:
 *   from oblique views a large share of what one sees in a city is facades, lit by the sun from the side. The carpet
 *   therefore blends in facade albedo/lighting by view elevation (and window light at night), so the far city keeps the
 *   brightness and golden-hour glow of the city module's 3D buildings instead of reading as a dim painted floor.
 */
export const URBAN_GLSL = /* glsl */ `
uniform sampler2DArray uCarpets;

#define CARPET_LAYERS 5.0
#define CARPET_RANGE ${f(CARPET_HEIGHT_RANGE)}

float carpetTile(float layer) {
  return layer < 0.5 ? ${f(CARPET_TILE_METERS[0])} : layer < 1.5 ? ${f(CARPET_TILE_METERS[1])} : layer < 2.5 ? ${f(CARPET_TILE_METERS[2])} : layer < 3.5 ? ${f(CARPET_TILE_METERS[3])} : ${f(CARPET_TILE_METERS[4])};
}

/* Facade share of the visible surface (per unit of cot(view elevation)) and street-light density (1/m²) per style. */
float carpetFacadeK(float layer) {
  return layer < 0.5 ? 0.85 : layer < 1.5 ? 0.5 : layer < 2.5 ? 1.05 : layer < 3.5 ? 0.24 : 0.28;
}
float carpetLampRho(float layer) {
  return layer < 0.5 ? 1.0 / 420.0 : layer < 1.5 ? 1.0 / 380.0 : layer < 2.5 ? 1.0 / 700.0 : layer < 3.5 ? 1.0 / 900.0 : 1.0 / 1100.0;
}

/* Voronoi neighbourhoods (~650 m): x = hash, y = orientation, z = distance to the cell border (m), w = second hash. */
vec4 hoodAt(vec2 p, out vec2 centre) {
  float cell = 650.0;
  vec2 g = p / cell;
  vec2 i = floor(g);
  vec2 fr = fract(g);
  float d1 = 9.0;
  float d2 = 9.0;
  vec2 r1 = vec2(0.0);
  vec2 r2 = vec2(0.0);
  vec2 c1 = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + 0.15 + 0.7 * hash22(i + o + 31.0) - fr;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        r2 = r1;
        d1 = d;
        r1 = r;
        c1 = i + o;
      } else if (d < d2) {
        d2 = d;
        r2 = r;
      }
    }
  }
  float edge = dot(0.5 * (r1 + r2), normalize(r2 - r1)) * cell;
  centre = (c1 + 0.15 + 0.7 * hash22(c1 + 31.0)) * cell;
  float h = hash12(c1 + 7.7);
  return vec4(h, h * 6.2831853, edge, hash12(c1 + 3.3));
}

/* Facade layer of the far city (see file comment). */
struct Facade {
  float frac;
  vec3 alb;
  /* Direct key-light factor of the visible facades (like N·L), including mutual shadowing. */
  float lit;
  vec3 emit;
};

Facade facadeNone() {
  Facade fc;
  fc.frac = 0.0;
  fc.alb = vec3(0.0);
  fc.lit = 0.0;
  fc.emit = vec3(0.0);
  return fc;
}

/* Mean over facade orientations facing the viewer (weighted by projected area) of max(0, n·L) for a horizontal light. */
float facadeLightFactor(vec2 toViewer, Px px) {
  float cosA = length(px.keyDir.xz);
  if (cosA < 1e-3) return 0.0;
  float c = clamp(dot(toViewer, px.keyXZ), -1.0, 1.0);
  float th = acos(c);
  float g = ((PI - th) * c + sin(th)) * 0.25;
  float sinA = max(px.keyDir.y, 0.0);
  // Lower floors sit in the neighbours' shadow when the light is low.
  float mutual = mix(0.5, 0.92, smoothstep(0.05, 0.6, sinA));
  return cosA * g * mutual;
}

vec3 facadeAlbedo(float layer, float h, float h2, float n) {
  vec3 cream = vec3(0.6, 0.53, 0.4);
  vec3 offWhite = vec3(0.64, 0.62, 0.57);
  vec3 beige = vec3(0.5, 0.42, 0.31);
  vec3 salmon = vec3(0.6, 0.4, 0.3);
  vec3 grey = vec3(0.42, 0.41, 0.39);
  vec3 c = mix(cream, offWhite, smoothstep(0.2, 0.8, h));
  c = mix(c, beige, smoothstep(0.55, 0.9, h2) * 0.6);
  c = mix(c, salmon, step(0.9, fract(h * 7.3)) * 0.5);
  c = mix(c, grey, smoothstep(0.3, 0.9, n) * 0.35);
  if (layer > 1.5 && layer < 2.5) c = mix(c, vec3(0.24, 0.27, 0.29), 0.35 + 0.3 * h2);
  if (layer > 0.5 && layer < 1.5) c = mix(c, vec3(0.36, 0.26, 0.19), 0.3 * h2);
  if (layer > 3.5) c = mix(c, vec3(0.36, 0.37, 0.37), 0.6);
  // Windows (~28 % of the wall, dark by day) and weathering.
  return c * mix(0.66, 0.78, n);
}

/* ------------------------------------------------------------------ */
/* Near: streetscape between the city's 3D buildings                   */
/* ------------------------------------------------------------------ */

Mat matUrbanGround(Px px, Land d, float lightDensity) {
  vec4 n1 = nTex(px, 520.0);
  vec4 n2 = nTex(px, 97.0);
  float plaza = smoothstep(0.55, 0.61, n1.a * 0.65 + n2.b * 0.35);
  float lot = smoothstep(0.74, 0.8, n1.b * 0.6 + n2.a * 0.4) * (1.0 - plaza);
  float green = smoothstep(0.6, 0.67, n1.g * 0.55 + n2.g * 0.45 + (0.3 - d.density) * 0.6) * (1.0 - plaza);
  vec3 asphalt = vec3(0.071, 0.071, 0.075) * (0.86 + 0.28 * n2.r);
  vec3 concrete = vec3(0.235, 0.228, 0.212) * (0.82 + 0.34 * n2.g);
  vec3 dirt = vec3(0.165, 0.138, 0.1) * (0.85 + 0.3 * n2.r);
  vec3 grass = mix(vec3(0.045, 0.07, 0.028), vec3(0.12, 0.11, 0.065), smoothstep(0.35, 0.75, n2.b));
  Mat m = matMake(asphalt, 0.88);
#if TERRAIN_TIER == 0
  if (px.dist < uTerrainRanges.z && !px.cheap) {
    float fade = smoothstep(uTerrainRanges.z, uTerrainRanges.z * 0.35, px.dist);
    Mat da = detailSample(0.0, px, 0.6);
    Mat dp = detailSample(1.0, px, 0.4);
    m = matMix(m, da, fade);
    Mat pm = matMix(matMake(concrete, 0.8), dp, fade);
    m = matMix(m, pm, plaza);
  } else {
    m = matMix(m, matMake(concrete, 0.8), plaza);
  }
#else
  m = matMix(m, matMake(concrete, 0.8), plaza);
#endif
  m.alb = mix(m.alb, dirt, lot);
  m.alb = mix(m.alb, grass, green * 0.85);
  m.rough = mix(m.rough, 0.95, lot + green);
  m.alb *= 0.92 + 0.16 * nTex(px, 2600.0).r;
  // Street lighting spill on the ground (the city draws the lamp heads).
  m.emit = mix(LAMP_SODIUM, LAMP_WARM, 0.35) * (0.012 + 0.03 * n2.r) * lightDensity * (1.0 - green);
  return m;
}

/* ------------------------------------------------------------------ */
/* Far: city carpet                                                    */
/* ------------------------------------------------------------------ */

struct CarpetTap {
  vec4 alb;
  vec4 aux;
  float T;
  float lod;
  /* Height below the local mean (fraction of CARPET_RANGE). */
  float cavity;
};

CarpetTap carpetTap(float layer, Px px, vec4 hood, bool wantAux) {
  CarpetTap t;
  t.T = carpetTile(layer);
  mat2 R = rotM(hood.y);
  vec2 uv = (R * px.p) / t.T + hood.wx * 7.0;
  vec2 gx = (R * px.dx) / t.T;
  vec2 gy = (R * px.dy) / t.T;
  t.alb = textureGrad(uCarpets, vec3(uv, layer), gx, gy);
  t.aux = wantAux ? textureGrad(uCarpets, vec3(uv, layer + CARPET_LAYERS), gx, gy) : vec4(0.5, 0.5, 0.0, 0.0);
  t.lod = log2(max(px.fp / t.T * 512.0, 1.0));
  t.cavity = 0.0;
#if TERRAIN_TIER < 2
  // Cavity: height below the local mean (two mips coarser) -> streets / courtyards see less sky and more shadow.
  float hb = textureGrad(uCarpets, vec3(uv, layer), gx * 4.0, gy * 4.0).a;
  t.cavity = clamp(hb - t.alb.a, 0.0, 1.0);
#endif
  return t;
}

/* Carpet ground layer (roofs, streets, yards) + the facade layer, for one style. */
Mat carpetStyle(float layer, Px px, vec4 hood, vec3 wp, float lightDensity, float night, float vegetation, out Facade fc) {
  bool wantAux = night > 0.0 || px.fp < 6.0;
  CarpetTap t = carpetTap(layer, px, hood, wantAux);
  Mat m = matMake(t.alb.rgb, mix(0.84, 0.62, smoothstep(0.3, 0.55, luma(t.alb.rgb))));
  float sinA = max(px.keyDir.y, 0.0);
  float tanA = sinA / max(length(px.keyDir.xz), 0.05);
  // Mean built height of this fabric (top mip) -> statistical street shadowing, exact once averaged by the mips.
  float hMean = textureLod(uCarpets, vec3(0.5, 0.5, layer), 12.0).a * CARPET_RANGE;
  float shadowFrac = 0.5 * (1.0 - exp(-hMean / (16.0 * max(tanA, 0.03))));
#if TERRAIN_TIER < 2
  float cavity = t.cavity * CARPET_RANGE;
  float detailW = 1.0 - smoothstep(1.5, 3.5, t.lod);
  float localShadow = smoothstep(0.5, 4.0, cavity / max(tanA * 5.0, 0.2));
  m.vis = mix(1.0 - shadowFrac, 1.0 - 0.85 * localShadow, detailW);
  m.ao = clamp(1.0 - cavity * 0.03, 0.5, 1.0);
  if (wantAux) m.slope = (t.aux.rg * 2.0 - 1.0) * detailW;
#else
  m.vis = 1.0 - shadowFrac;
  m.ao = 1.0 - 0.3 * shadowFrac;
#endif
  vec4 nMacro = nTex(px, 1300.0);
  // Facades.
  vec2 toViewer = normalize(cameraPosition.xz - wp.xz + vec2(1e-3, 0.0));
  float sinB = clamp((cameraPosition.y - wp.y) / max(px.dist, 1.0), 0.02, 1.0);
  float cosB = sqrt(1.0 - sinB * sinB);
  float K = carpetFacadeK(layer) * mix(0.45, 1.15, clamp(lightDensity, 0.0, 1.3) * 0.8) * (1.0 - vegetation);
  fc.frac = K * cosB / (K * cosB + sinB);
  fc.alb = facadeAlbedo(layer, hood.x, hood.w, nMacro.b);
  fc.lit = facadeLightFactor(toViewer, px);
  fc.emit = vec3(0.0);
  if (night > 0.0) {
    float lampRho = carpetLampRho(layer) * lightDensity;
    // Street-light pools baked in the tile (mip-averaged) + stable far-field lamp sparkles.
    vec3 pools = (t.aux.b * mix(LAMP_SODIUM, LAMP_WARM, 0.4) + t.aux.a * LAMP_COOL) * 0.55;
    float sp = sparkle(px.p, px.fp, lampRho, floor(layer) * 3.7 + hood.x * 11.0);
    vec3 sparkCol = mix(LAMP_SODIUM, LAMP_COOL, step(0.62, fract(hood.w * 5.3)));
    m.emit = (pools * lightDensity + sparkCol * sp * 3.2 * smoothstep(1.0, 4.0, px.fp)) * night;
    float windows = 8.5 * 0.28 * uTerrainLights.y * (0.55 + 0.9 * nTex(px, 180.0).b);
    fc.emit = WINDOW_LIGHT * windows * night * clamp(lightDensity, 0.0, 1.2);
  }
  return m;
}

/*
 * Carpet for the land-use style mix. Generic urban cells follow the district style at the neighbourhood centre; the two
 * strongest styles are blended with a per-neighbourhood dither so zone edges follow neighbourhood borders.
 */
Mat matCarpet(Px px, Land d, vec3 wp, float lightDensity, float night, out Facade fc) {
  vec2 centre;
  vec4 hood = hoodAt(px.p, centre);
  vec4 st = d.style;
  float ind = d.ind;
  if (d.generic > 0.0) {
    int code = districtStyleAt(centre);
    if (code == 0) st.y += d.generic;
    else if (code == 2 || code == 3) st.z += d.generic;
    else if (code == 4 || code == 5 || code == 7) st.w += d.generic;
    else if (code == 6) ind += d.generic;
    else st.x += d.generic;
  }
  float sparse = 1.0 - smoothstep(0.16, 0.38, d.density);
  st.w += (st.x + st.z) * sparse * 0.8;
  st.x *= 1.0 - sparse * 0.8;
  st.z *= 1.0 - sparse * 0.8;
  // Strongest two of (dense, historic, modern, villa, industrial) without dynamic array indexing.
  float w1 = st.x;
  float l1 = 0.0;
  if (st.y > w1) { w1 = st.y; l1 = 1.0; }
  if (st.z > w1) { w1 = st.z; l1 = 2.0; }
  if (st.w > w1) { w1 = st.w; l1 = 3.0; }
  if (ind > w1) { w1 = ind; l1 = 4.0; }
  float w2 = -1.0;
  float l2 = 0.0;
  if (l1 != 0.0 && st.x > w2) { w2 = st.x; l2 = 0.0; }
  if (l1 != 1.0 && st.y > w2) { w2 = st.y; l2 = 1.0; }
  if (l1 != 2.0 && st.z > w2) { w2 = st.z; l2 = 2.0; }
  if (l1 != 3.0 && st.w > w2) { w2 = st.w; l2 = 3.0; }
  if (l1 != 4.0 && ind > w2) { w2 = ind; l2 = 4.0; }
  float t = smoothstep(0.3, 0.7, w2 / max(w1 + w2, 1e-4) + (hood.x - 0.5) * 0.25);

  // Street trees, courtyard gardens and small parks.
  float green = smoothstep(0.64, 0.71, nTex(px, 1500.0).a * 0.5 + nTex(px, 260.0).r * 0.5 + (hood.w - 0.5) * 0.14 + (0.3 - d.density) * 0.3);

  Mat m = carpetStyle(l1, px, hood, wp, lightDensity, night, green, fc);
  if (t > 0.02) {
    Facade f2;
    Mat m2 = carpetStyle(l2, px, hood, wp, lightDensity, night, green, f2);
    m = matMix(m, m2, t);
    fc.frac = mix(fc.frac, f2.frac, t);
    fc.alb = mix(fc.alb, f2.alb, t);
    fc.emit = mix(fc.emit, f2.emit, t);
  }
  // Per-neighbourhood roof mix (redder / greyer / brighter) and large-scale tone drift.
  vec4 nMacro = nTex(px, 5200.0);
  m.alb *= mix(vec3(1.07, 0.97, 0.92), vec3(0.94, 1.0, 1.05), hood.x) * (0.88 + 0.24 * hood.w) * (0.9 + 0.2 * nMacro.g);
  vec3 canopy = vec3(0.036, 0.055, 0.022) * (0.75 + 0.5 * nTex(px, 64.0).r);
  m.alb = mix(m.alb, canopy, green);
  m.vis = mix(m.vis, 0.8, green);
  m.emit *= 1.0 - green * 0.8;

  // Arterials on neighbourhood borders.
  float hw = 6.0 + 5.0 * hood.w;
  float road = aaStep(-hw, -hood.z, px.fp) * clamp(2.0 * hw / max(px.fp, 1e-3), 0.0, 1.0);
  if (road > 0.0) {
    Mat r = matMake(vec3(0.068, 0.068, 0.072), 0.86);
    if (night > 0.0) {
      vec3 lc = mix(LAMP_SODIUM, LAMP_COOL, step(0.5, hood.w));
      float sp = sparkle(px.p, px.fp, 2.0 / (38.0 * max(hw * 2.0, px.fp)), 5.3);
      r.emit = lc * (0.35 + sp * 3.2 * smoothstep(1.0, 4.0, px.fp)) * night;
    }
    m = matMix(m, r, road);
    fc.frac *= 1.0 - road;
  }
  return m;
}
`;
