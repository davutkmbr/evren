/**
 * City surface shading (patched into MeshStandardMaterial). Everything is procedural and evaluated from the
 * per-vertex building constants: window grids with frames, reveals, sills, shutters, curtains and per-window
 * night lighting; shop fronts; party walls; weathering; curtain walls; terracotta tiles; flat-roof membranes.
 * Detail fades to analytic averages when a window/tile is smaller than a few pixels (no shimmer at distance).
 */
import { Face, KIND_MASK, Kind, WinType } from '../protocol';

const d = (n: number): string => n.toFixed(1);

export const CITY_VERTEX_PARS = /* glsl */ `
uniform sampler2D uCityHeight;
uniform vec4 uCityHeightXform;
uniform vec4 uCityClassFade;
attribute vec4 aFacade;
attribute vec4 aColor;
attribute vec4 aParams;
varying vec3 vCityLocal;
varying vec3 vCityWorld;
varying vec2 vCityUV;
flat varying vec2 vCityFace;
flat varying vec4 vCityColor;
flat varying vec4 vCityParams;
`;

export const CITY_VERTEX_MAIN = /* glsl */ `
{
  // Far chunks: buildings of each fade class sink into the terrain (whose city carpet takes over) past their distance.
  float cityClass = floor(aColor.w / 32.0 + 0.001);
  float cityStart = cityClass < 0.5 ? uCityClassFade.x : cityClass < 1.5 ? uCityClassFade.y : cityClass < 2.5 ? uCityClassFade.z : uCityClassFade.w;
  vec3 cityWp = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float citySink = smoothstep(cityStart, cityStart * 1.18, distance(cityWp, cameraPosition));
  if (citySink > 0.0 && uCityHeightXform.w > 0.5) {
    float g = textureLod(uCityHeight, (cityWp.xz - uCityHeightXform.xy) * uCityHeightXform.z, 0.0).r - 1.5;
    transformed.y = mix(transformed.y, min(transformed.y, g), citySink);
  }
}
vCityLocal = position;
vCityUV = aFacade.xy * 0.0625;
vCityFace = aFacade.zw;
vCityColor = aColor;
vCityParams = aParams;
`;

export const CITY_VERTEX_WORLD = /* glsl */ `
vCityWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

export const CITY_FRAGMENT_PARS = /* glsl */ `
varying vec3 vCityLocal;
varying vec3 vCityWorld;
varying vec2 vCityUV;
flat varying vec2 vCityFace;
flat varying vec4 vCityColor;
flat varying vec4 vCityParams;
uniform sampler2D uCityHeight;
uniform vec4 uCityHeightXform;
uniform vec4 uCityClassFade;
uniform float uCityDebug;
#ifdef CITY_FADE
uniform float uCityFade;
uniform float uCityFadeInvert;
#endif

#define K_WALL ${d(Kind.Wall)}
#define K_STONE ${d(Kind.Stone)}
#define K_WOOD ${d(Kind.Wood)}
#define K_CURTAIN ${d(Kind.Curtain)}
#define K_ROOFTILE ${d(Kind.RoofTile)}
#define K_ROOFFLAT ${d(Kind.RoofFlat)}
#define K_ROOFMETAL ${d(Kind.RoofMetal)}
#define K_SLAB ${d(Kind.Slab)}
#define K_RAILING ${d(Kind.Railing)}
#define K_SOLAR ${d(Kind.Solar)}
#define K_METAL ${d(Kind.Metal)}
#define K_BEACON ${d(Kind.Beacon)}
#define K_GLAZED ${d(Kind.Glazed)}
#define K_AWNING ${d(Kind.Awning)}
#define K_CHIMNEY ${d(Kind.Chimney)}
#define K_DARK ${d(Kind.Dark)}
#define K_SOFFIT ${d(Kind.Soffit)}

#define W_APT ${WinType.Apartment}
#define W_HIST ${WinType.Historic}
#define W_CURTAIN ${WinType.Curtain}
#define W_RIBBON ${WinType.Ribbon}
#define W_IND ${WinType.Industrial}
#define W_VILLA ${WinType.Villa}
#define W_YALI ${WinType.Yali}
#define W_MASS ${WinType.Mass}

#define F_SHOP ${Face.Shop}
#define F_DOOR ${Face.Door}
#define F_BALCDOORS ${Face.BalconyDoors}
#define F_WORLDU ${Face.WorldU}
#define F_BALCONIES ${Face.Balconies}
#define F_OLD ${Face.Old}

struct CitySurf {
  vec3 albedo;
  float rough;
  float metal;
  vec3 n;
  vec3 emissive;
  float ao;
  float dbg;
};

vec3 citySrgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

float cityTerrain(vec2 xz) {
  if (uCityHeightXform.w < 0.5) return -1e4;
  vec2 uv = (xz - uCityHeightXform.xy) * uCityHeightXform.z;
  return textureLod(uCityHeight, uv, 0.0).r;
}

/* Linear-RGB colour of a warm..cool interior light, t = 0 (2400 K) .. 1 (5000 K). */
vec3 cityKelvin(float t) {
  vec3 c2400 = vec3(1.0, 0.33, 0.06);
  vec3 c3000 = vec3(1.0, 0.47, 0.16);
  vec3 c4000 = vec3(1.0, 0.64, 0.37);
  vec3 c5000 = vec3(1.0, 0.77, 0.62);
  return t < 0.33 ? mix(c2400, c3000, t / 0.33) : t < 0.66 ? mix(c3000, c4000, (t - 0.33) / 0.33) : mix(c4000, c5000, (t - 0.66) / 0.34);
}

/* Fraction of lit rooms by local hour: residential evening peak ~21h, morning bump ~6.7h; offices 8-20h. */
float cityOccupancy(float hour, int usage) {
  float dh = abs(hour - 21.0); dh = min(dh, 24.0 - dh);
  float dm = abs(hour - 6.7); dm = min(dm, 24.0 - dm);
  float res = 0.07 + 0.47 * exp(-dh * dh / 9.7) + 0.14 * exp(-dm * dm / 1.3);
  float dOff = abs(hour - 14.0); dOff = min(dOff, 24.0 - dOff);
  float off = 0.1 + 0.62 * smoothstep(7.5, 5.0, dOff);
  return usage == 1 ? off : usage == 3 ? off * 0.5 : res;
}

float cityLightsOn() { return smoothstep(0.06, 0.5, uNight); }

/* Fraction of the pixel footprint [x - w/2, x + w/2] covered by the interval [a, b] (1D box filter). */
float cityCover(float x, float w, float a, float b) {
  return clamp((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w, 0.0, 1.0);
}

float cityBox(vec2 p, vec2 lo, vec2 hi, float aa) {
  vec2 a = smoothstep(lo - aa, lo + aa, p) * (1.0 - smoothstep(hi - aa, hi + aa, p));
  return a.x * a.y;
}

/* Lit state of a cell of 2^l x 2^l windows. Cells are all-lit or all-dark with probability = occupancy, so a
   pixel-sized cell keeps the sparkle of individual windows while the average stays energy-conserving. Level 0
   reproduces the per-window decision of the detailed shading exactly. */
float cityLitCell(vec2 wc, float l, float seed, float occ) {
  if (l < 0.5) return step(hash13(vec3(floor(wc), seed + 17.0)), occ);
  float s = exp2(l);
  return step(hash13(vec3(floor(wc / s), seed + 5.0 + l * 7.13)), occ);
}

/* Stable sparkle for pixels covering one or more windows: cells matching the pixel footprint (in windows), blended
   between two levels, so distant facades twinkle without shimmering while the camera moves. */
float cityFarLit(vec2 wc, float footprint, float seed, float occ) {
  float lod = clamp(log2(max(footprint, 1.0)), 0.0, 7.0);
  float l0 = floor(lod);
  return mix(cityLitCell(wc, l0, seed, occ), cityLitCell(wc, l0 + 1.0, seed, occ), smoothstep(0.2, 0.8, lod - l0));
}

/* Windows + everything on plastered / stone / timber facades. */
void cityWall(inout CitySurf s, int kind, vec3 N, vec3 T, float u, float v, float sx, int flags, float fh, float gfh,
              float seed, int winType, int usage, float hAbove, float lightsOn, float occ) {
  vec3 base = s.albedo;
  int role = flags & 3;
  bool shop = (flags & F_SHOP) != 0;
  bool door = (flags & F_DOOR) != 0;
  bool balcDoors = (flags & F_BALCDOORS) != 0;
  bool old = (flags & F_OLD) != 0;
  int floors = (flags >> 8) & 127;
  float age = old ? 1.0 : 0.45 + 0.4 * hash11(seed * 1.37);
  float fwu = fwidth(u) + 1e-4;
  float fwv = fwidth(v) + 1e-4;
  float fw = max(fwu, fwv);

  float fi; float ly; float flH;
  if (v < gfh) {
    if (v >= 0.0) { fi = 0.0; ly = v; flH = gfh; }
    else { float k = floor(v / fh); fi = k; ly = v - k * fh; flH = fh; }
  } else {
    float k = floor((v - gfh) / fh); fi = 1.0 + k; ly = v - gfh - k * fh; flH = fh;
  }
  bool attic = fi >= float(max(floors, 1));

  /* Plaster / stone / timber base texture and weathering. */
  float mott = fbm2(vec2(u, v) * 0.35 + seed * 0.17, 3);
  vec3 alb = base * (0.9 + 0.22 * (mott - 0.5));
  if (kind == int(K_STONE)) {
    // Dressed ashlar courses (0.42 m) with long blocks; joints and per-block tone fade out before they alias.
    float course = 0.42;
    float row = floor(v / course);
    float blockLen = 0.9 + 0.5 * hash11(row * 1.7 + seed);
    vec2 bc = vec2(u / blockLen + hash11(row + seed * 0.37), v / course);
    vec2 bf = fract(bc);
    float stoneDetail = 1.0 - smoothstep(0.12, 0.45, max(fwu / blockLen, fwv / course));
    float joint = max(1.0 - smoothstep(0.0, 0.02 + fwu * 1.5, min(bf.x, 1.0 - bf.x) * blockLen), 1.0 - smoothstep(0.0, 0.02 + fwv * 1.5, min(bf.y, 1.0 - bf.y) * course));
    float blockTone = hash12(floor(bc) + seed);
    alb *= mix(1.0, 0.93 + 0.14 * blockTone, stoneDetail);
    alb = mix(alb, alb * 0.8, joint * stoneDetail);
  } else if (kind == int(K_WOOD)) {
    float board = fract(v / 0.19);
    float edge = 1.0 - smoothstep(0.0, 0.12 + fwv * 5.0, board);
    alb *= 0.93 + 0.12 * hash12(vec2(floor(v / 0.19), floor(u / 3.1)) + seed);
    alb = mix(alb, alb * 0.62, edge * (1.0 - smoothstep(0.03, 0.12, fwv)));
    s.n = normalize(N + vec3(0.0, 1.0, 0.0) * edge * 0.35 * (1.0 - smoothstep(0.03, 0.12, fwv)));
  }
  float streak = fbm2(vec2(u * 1.1, v * 0.07) + seed * 0.31, 3);
  alb *= 1.0 - smoothstep(0.52, 0.82, streak) * 0.28 * age;
  alb *= mix(0.62, 1.0, smoothstep(0.0, 2.2, hAbove));
  alb *= 1.0 + 0.05 * smoothstep(8.0, 30.0, v) * (1.0 - age);
  float rough = 0.88;

  float detail = 1.0 - smoothstep(0.1, 0.32, fw / max(min(sx, flH), 0.5));
  vec3 emis = vec3(0.0);
  float ao = 1.0;
  vec3 n = s.n;

  /* Party walls: blank, often raw plaster or exposed brick. */
  if (role == 3 || sx < 0.4) {
    if (role == 3) {
      float h = hash11(seed * 3.1 + 0.7);
      vec3 raw = h < 0.4 ? vec3(0.42, 0.40, 0.37) : h < 0.6 ? vec3(0.36, 0.17, 0.11) : base;
      if (h >= 0.4 && h < 0.6) {
        vec2 bc = vec2(u / 0.24 + mod(floor(v / 0.075), 2.0) * 0.5, v / 0.075);
        float brickDetail = 1.0 - smoothstep(0.15, 0.5, max(fwu / 0.24, fwv / 0.075));
        float mortar = clamp(step(0.8, fract(bc.y)) + step(0.9, fract(bc.x)), 0.0, 1.0);
        vec3 brick = mix(raw * (0.8 + 0.4 * hash12(floor(bc))), vec3(0.45, 0.43, 0.4), mortar);
        raw = mix(mix(raw, vec3(0.45, 0.43, 0.4), 0.27), brick, brickDetail);
      }
      alb = raw * (0.85 + 0.3 * (mott - 0.5)) * mix(0.7, 1.0, smoothstep(0.0, 2.0, hAbove));
      alb *= 1.0 - smoothstep(0.5, 0.8, streak) * 0.3;
    }
    s.albedo = alb; s.rough = 0.92; s.ao = mix(0.6, 1.0, smoothstep(0.0, 3.0, hAbove));
    return;
  }

  /* Window geometry per type. */
  float cw = sx;
  float col = floor(u / cw);
  float lx = u - col * cw;
  float ww = min(1.45, cw * 0.5);
  float wh = 1.45;
  float sill = 0.9;
  float frameW = 0.065;
  vec3 frameCol = vec3(0.86, 0.86, 0.84);
  bool mullion = true;
  bool grid = false;
  if (winType == W_HIST) { ww = min(1.0, cw * 0.48); wh = min(flH - 1.25, 2.15); sill = 0.78; frameW = 0.085; frameCol = hash11(seed * 7.7) < 0.5 ? vec3(0.34, 0.22, 0.14) : vec3(0.8, 0.78, 0.72); grid = true; }
  else if (winType == W_RIBBON) { ww = cw - 0.12; wh = flH * 0.52; sill = 0.95; frameCol = vec3(0.3, 0.31, 0.32); mullion = false; }
  else if (winType == W_IND) { ww = cw * 0.84; wh = 1.3; sill = flH - 2.3; frameCol = vec3(0.35, 0.37, 0.38); grid = true; }
  else if (winType == W_VILLA) { ww = min(1.35, cw * 0.48); wh = 1.45; sill = 0.9; }
  else if (winType == W_YALI) { ww = min(0.95, cw * 0.56); wh = min(flH - 1.3, 2.0); sill = 0.72; frameW = 0.08; frameCol = vec3(0.9, 0.88, 0.82); grid = true; }
  else if (winType == W_MASS) { ww = min(1.2, cw * 0.44); wh = 1.35; sill = 0.95; }
  float hw1 = hash13(vec3(col, fi, seed));
  float hw2 = hash13(vec3(col + 31.7, fi * 1.7, seed + 5.1));
  float colH = hash12(vec2(col, seed + 13.0));
  // Stairwell column in apartments: small windows at the landing, often lit.
  float stairCol = floor(hash11(seed * 1.91) * 3.0) + 1.0;
  bool stair = (winType == W_APT || winType == W_MASS) && role == 0 && col == stairCol && fi >= 1.0;
  if (stair) { wh = 0.9; sill = flH * 0.5; ww = min(ww, 0.9); }
  // Balcony doors: French doors down to the floor on balcony facades.
  bool isDoor = balcDoors && fi >= 1.0 && !stair && mod(col + floor(seed), 3.0) == 1.0;
  if (isDoor) { sill = 0.08; wh = min(2.2, flH - 0.45); ww = min(ww, 1.0); }
  // Side facades: fewer windows.
  bool blankCol = (role == 2 && colH < 0.45) || (role == 1 && colH < 0.12) || (winType == W_IND && fi > 0.0);

  float wx0 = (cw - ww) * 0.5;
  float wx1 = wx0 + ww;
  float wy0 = sill;
  float wy1 = min(sill + wh, flH - 0.3);
  vec2 lp = vec2(lx, ly);
  float aa = fw * 0.7;

  /* Floor-level bands and ground floor. */
  bool slabBand = fi >= 1.0 && ly < 0.2 && (winType == W_APT || winType == W_MASS || winType == W_RIBBON);
  if (slabBand) { alb *= hash11(seed * 5.3) < 0.5 ? 0.9 : 1.08; }
  if (old && ly > flH - 0.28 && fi >= 1.0) {
    float c = (ly - (flH - 0.28)) / 0.28;
    alb *= 1.06;
    n = normalize(n + vec3(0.0, 1.0, 0.0) * (0.6 - c) * 0.6 * detail);
  }
  if (attic) {
    s.albedo = alb * (ly < 0.12 ? 1.1 : 1.0); s.rough = rough; s.n = n; s.ao = 1.0;
    return;
  }

  float win = 0.0;
  float inner = 0.0;
  vec3 winAlb = vec3(0.02);
  float winRough = 0.06;
  float winMetal = 0.0;
  vec3 winEmis = vec3(0.0);
  float lit = 0.0;

  bool groundShop = shop && fi == 0.0;
  bool groundDoor = door && fi == 0.0 && col == floor(hash11(seed * 2.3) * 2.0) + 1.0;
  if (groundShop) {
    // Shop bays: glass front, signage band, rolling shutters closed on some bays at night.
    float bay = col;
    float bh = hash12(vec2(bay, seed + 71.0));
    float gx0 = 0.12;
    float gx1 = cw - 0.12;
    float g0 = 0.25;
    float g1 = gfh - 0.95;
    win = cityBox(lp, vec2(gx0, g0), vec2(gx1, g1), aa);
    float sign = cityBox(lp, vec2(0.05, gfh - 0.88), vec2(cw - 0.05, gfh - 0.28), aa);
    vec3 signCol = bh < 0.2 ? vec3(0.55, 0.06, 0.05) : bh < 0.35 ? vec3(0.05, 0.14, 0.42) : bh < 0.5 ? vec3(0.8, 0.78, 0.72) : bh < 0.62 ? vec3(0.75, 0.55, 0.05) : bh < 0.72 ? vec3(0.06, 0.3, 0.12) : vec3(0.08, 0.08, 0.09);
    alb = mix(alb * 0.85, signCol, sign);
    bool closed = hash12(vec2(bay, seed + 3.0)) > mix(0.95, 0.45, smoothstep(22.0, 23.5, uTimeOfDay) + smoothstep(4.0, 1.0, uTimeOfDay) * 0.0);
    bool shutter = closed && lightsOn > 0.3 && (uTimeOfDay > 22.5 || uTimeOfDay < 7.0);
    if (shutter) {
      float rib = fract(ly / 0.09);
      winAlb = vec3(0.42, 0.43, 0.44) * (0.8 + 0.3 * smoothstep(0.2, 0.5, rib));
      winRough = 0.5;
      winMetal = 0.6;
    } else {
      float interior = hash12(vec2(bay, seed + 9.0));
      winAlb = mix(vec3(0.03), vec3(0.18, 0.15, 0.12), interior * 0.5);
      winRough = 0.04;
      float shopOpen = uTimeOfDay > 8.5 && uTimeOfDay < 23.3 ? 1.0 : (bh < 0.25 ? 1.0 : 0.0);
      winEmis = cityKelvin(0.55 + 0.4 * interior) * (5.0 + 5.0 * interior) * shopOpen;
    }
    vec3 signGlow = signCol * 6.0 + vec3(0.6);
    emis += sign * signGlow * lightsOn * step(0.35, bh) * step(uTimeOfDay, 23.8) * step(8.0, uTimeOfDay) * 0.9;
    lit = shutter ? 0.0 : 1.0;
  } else if (groundDoor) {
    float dw = 1.5;
    float dx0 = (cw - dw) * 0.5;
    win = cityBox(lp, vec2(dx0, 0.0), vec2(dx0 + dw, 2.4), aa);
    inner = cityBox(lp, vec2(dx0 + 0.1, 0.0), vec2(dx0 + dw - 0.1, 2.3), aa);
    winAlb = mix(vec3(0.16, 0.1, 0.06), vec3(0.03), inner * 0.6);
    winRough = 0.3;
    winEmis = cityKelvin(0.45) * 3.0 * inner;
    lit = hash11(seed * 4.1) < 0.7 ? 1.0 : 0.0;
    // Entrance lamp above the door.
    emis += cityKelvin(0.3) * 14.0 * cityBox(lp, vec2(cw * 0.5 - 0.12, 2.5), vec2(cw * 0.5 + 0.12, 2.68), aa) * lightsOn;
  } else if (!blankCol) {
    win = cityBox(lp, vec2(wx0, wy0), vec2(wx1, wy1), aa);
    // Frame / reveal / glass.
    float dxw = min(lx - wx0, wx1 - lx);
    float dyw = min(ly - wy0, wy1 - ly);
    float din = min(dxw, dyw);
    float reveal = 0.09;
    float revealMask = win * (1.0 - smoothstep(reveal - aa, reveal + aa, din));
    float frameMask = win * (1.0 - revealMask) * (1.0 - smoothstep(reveal + frameW - aa, reveal + frameW + aa, din));
    float glassMask = win * (1.0 - revealMask) * (1.0 - frameMask);
    float cx = (wx0 + wx1) * 0.5;
    if (mullion && ww > 1.05 && !isDoor) {
      float m = 1.0 - smoothstep(0.035 - aa, 0.035 + aa, abs(lx - cx));
      frameMask = max(frameMask, glassMask * m);
      glassMask *= 1.0 - m;
    }
    if (grid) {
      float gy = fract((ly - wy0) / ((wy1 - wy0) / 3.0));
      float gx = abs(lx - cx);
      float bar = max(1.0 - smoothstep(0.02 - aa, 0.02 + aa, gx), 1.0 - smoothstep(0.025, 0.025 + aa * 4.0, min(gy, 1.0 - gy) * ((wy1 - wy0) / 3.0)));
      frameMask = max(frameMask, glassMask * bar);
      glassMask *= 1.0 - bar;
    }
    // Reveal normals (recessed openings catch light on one side).
    if (revealMask > 0.0) {
      vec3 up = vec3(0.0, 1.0, 0.0);
      vec3 rn = dxw < dyw ? (lx - wx0 < wx1 - lx ? T : -T) : (ly - wy0 < wy1 - ly ? up : -up);
      n = normalize(mix(n, normalize(n * 0.35 + rn), revealMask * detail));
    }
    // Rolling shutter box and partially lowered shutters (apartments), timber shutters (historic).
    float shutterDown = (winType == W_APT || winType == W_MASS || winType == W_VILLA) ? step(0.55, hw2) * hash13(vec3(col, fi, seed + 2.0)) : 0.0;
    if (lightsOn > 0.5 && uTimeOfDay > 23.0 || uTimeOfDay < 6.0) shutterDown = max(shutterDown, step(0.7, hw2));
    float shutterY = wy1 - (wy1 - wy0) * shutterDown;
    float shutterMask = glassMask * step(shutterY, ly);
    // Curtains: sheer tül on most residential windows, drapes at the sides.
    float sheer = (usage == 0 && hw1 > 0.28) ? 0.45 + 0.5 * hash13(vec3(col, fi, seed + 7.0)) : 0.0;
    float drape = (usage == 0 && hw2 > 0.5) ? 1.0 - smoothstep(0.18, 0.3, min(lx - wx0, wx1 - lx)) : 0.0;
    vec3 drapeCol = citySrgb(vec3(0.5 + 0.35 * hw2, 0.42 + 0.3 * hw1, 0.35 + 0.25 * hash11(hw1 * 91.0)));
    vec3 interior = vec3(0.015 + 0.02 * hw2);
    vec3 curtainAlb = mix(interior, vec3(0.62, 0.6, 0.55) * 0.55, sheer);
    curtainAlb = mix(curtainAlb, drapeCol * 0.35, drape);
    // Pane tilt: broken reflections between panes.
    vec3 tilt = (hash33(vec3(col, fi, seed)) - 0.5) * 0.035;
    vec3 gn = normalize(N + T * tilt.x + vec3(0.0, tilt.y, 0.0));
    float g = glassMask * (1.0 - shutterMask);
    winAlb = curtainAlb;
    winRough = 0.04 + 0.08 * hw2;
    winMetal = winType == W_RIBBON ? 0.35 : 0.0;
    if (winType == W_RIBBON) winAlb = mix(curtainAlb, citySrgb(base) * 0.25, 0.5);
    vec3 shutterAlb = citySrgb(vec3(0.78, 0.76, 0.72)) * (0.85 + 0.2 * smoothstep(0.3, 0.6, fract(ly / 0.05)));
    vec3 revealAlb = alb * 0.82;
    vec3 wa = frameCol * frameMask + revealAlb * revealMask + shutterAlb * shutterMask;
    // Night: lit rooms.
    float onRand = hash13(vec3(col, fi, seed + 17.0));
    lit = stair ? step(onRand, 0.75) : step(onRand, occ * (fi < 0.0 ? 0.4 : 1.0));
    float temp = hash13(vec3(col, fi, seed + 29.0));
    vec3 lc = cityKelvin(temp < 0.7 ? temp * 0.6 : 0.5 + temp * 0.5);
    float grad = mix(0.7, 1.15, clamp((ly - wy0) / max(wy1 - wy0, 0.1), 0.0, 1.0));
    float tv = step(0.965, hash13(vec3(col, fi, seed + 41.0)));
    vec3 tvCol = vec3(0.35, 0.5, 1.0) * (0.6 + 0.4 * sin(uTime * 7.0 + onRand * 40.0) * sin(uTime * 2.3 + hw2 * 17.0));
    vec3 roomLight = mix(lc * (5.0 + 7.0 * hw1), tvCol * 3.0, tv) * mix(1.0, 0.8 + 0.4 * sheer, sheer) * grad;
    if (stair) roomLight = cityKelvin(0.85) * 4.0;
    winEmis = roomLight * lit * (1.0 - shutterMask);
    // Mix: glass pixels take the interior/curtain albedo and a glossy coat.
    alb = mix(alb, wa + winAlb * g, clamp(frameMask + revealMask + shutterMask + g, 0.0, 1.0) * win);
    rough = mix(rough, winRough, g);
    s.metal = mix(0.0, winMetal, g);
    n = normalize(mix(n, gn, g * detail));
    emis += winEmis * g * lightsOn;
    ao *= mix(1.0, 0.72, revealMask);
    // Sill (stone ledge) and dirt drips below it.
    if (!isDoor) {
      float sillMask = cityBox(lp, vec2(wx0 - 0.08, wy0 - 0.07), vec2(wx1 + 0.08, wy0), aa);
      alb = mix(alb, citySrgb(vec3(0.82, 0.8, 0.76)), sillMask);
      n = normalize(mix(n, normalize(N + vec3(0.0, 1.4, 0.0)), sillMask * detail));
      float below = wy0 - 0.07 - ly;
      float drip = step(0.0, below) * exp(-below * 1.4) * step(wx0, lx) * step(lx, wx1) * (0.5 + 0.5 * vnoise2(vec2(u * 9.0, v)));
      alb *= 1.0 - drip * 0.25 * age;
    }
    // Shutter box above apartment windows.
    if (winType == W_APT || winType == W_MASS) {
      float box = cityBox(lp, vec2(wx0, wy1), vec2(wx1, wy1 + 0.22), aa) * step(0.4, hash11(seed * 9.1));
      alb = mix(alb, alb * 1.07, box);
    }
    // Timber shutters beside historic windows.
    if ((winType == W_HIST || winType == W_YALI) && hash11(seed * 3.3) < 0.45 && !isDoor) {
      float sh = max(cityBox(lp, vec2(wx0 - ww * 0.5, wy0), vec2(wx0 - 0.03, wy1), aa), cityBox(lp, vec2(wx1 + 0.03, wy0), vec2(wx1 + ww * 0.5, wy1), aa));
      vec3 shc = hash11(seed * 5.9) < 0.5 ? citySrgb(vec3(0.2, 0.32, 0.22)) : citySrgb(vec3(0.36, 0.24, 0.16));
      alb = mix(alb, shc * (0.85 + 0.2 * fract(lx * 11.0)), sh);
    }
  }
  if (groundShop || groundDoor) {
    alb = mix(alb, winAlb, win);
    rough = mix(rough, winRough, win);
    s.metal = mix(0.0, winMetal, win);
    emis += winEmis * win * lightsOn * lit;
  }
  // Ground-floor plinth cladding.
  if (fi <= 0.0 && ly < 0.7 && !groundShop) {
    alb = mix(alb, citySrgb(vec3(0.5, 0.48, 0.45)) * (0.9 + 0.2 * mott), 0.75);
  }

  /* Far field. While a window still spans a pixel or more its rectangle is box-filtered against the pixel footprint
     (dark glass by day, lit room by night: exact coverage, no shimmer); once a pixel covers several windows the
     facade converges to the window fraction and lit windows to pixel-sized cells of the same random pattern. */
  float winFrac = clamp(ww * (wy1 - wy0) / (cw * flH), 0.05, 0.6);
  float colBlank = (role == 2 ? 0.45 : role == 1 ? 0.12 : 0.0);
  float footprint = max(fwu / cw, fwv / flH);
  float cellMix = smoothstep(0.55, 1.2, footprint);
  bool shopBay = shop && fi == 0.0;
  vec2 rLo = shopBay ? vec2(0.12, 0.25) : vec2(wx0, wy0);
  vec2 rHi = shopBay ? vec2(cw - 0.12, gfh - 0.95) : vec2(wx1, wy1);
  float cover = cityCover(lx, fwu, rLo.x, rHi.x) * cityCover(ly, fwv, rLo.y, rHi.y) * (blankCol && !shopBay ? 0.0 : 1.0);
  float glassFrac = mix(cover, winFrac * (1.0 - colBlank), cellMix);
  vec3 wallFar = base * (0.9 + 0.22 * (mott - 0.5)) * mix(0.62, 1.0, smoothstep(0.0, 2.2, hAbove));
  vec3 glassFar = mix(vec3(0.03), vec3(0.16, 0.15, 0.13), step(0.45, hw2) * 0.6);
  vec3 farAlb = mix(wallFar, glassFar, glassFrac * 0.92);
  float onW = shopBay ? 1.0 : (stair ? step(hash13(vec3(col, fi, seed + 17.0)), 0.75) : step(hash13(vec3(col, fi, seed + 17.0)), occ));
  float tW = hash13(vec3(col, fi, seed + 29.0));
  vec3 sharpEmis = cityKelvin(shopBay ? 0.65 : (tW < 0.7 ? tW * 0.6 : 0.5 + tW * 0.5)) * (shopBay ? 7.0 : 4.5 + 6.0 * hw1) * onW * cover;
  float farLit = cityFarLit(vec2(col, fi), footprint, seed, occ);
  vec3 cellEmis = cityKelvin(0.28) * 6.0 * winFrac * farLit * (1.0 - colBlank);
  if (shop && v < gfh && v > 0.0) cellEmis = cityKelvin(0.6) * 7.0 * 0.5;
  vec3 farEmis = mix(sharpEmis, cellEmis, cellMix) * lightsOn;
  s.albedo = mix(farAlb, alb, detail);
  s.rough = mix(mix(0.85, 0.12, glassFrac), rough, detail);
  s.metal *= detail;
  s.n = normalize(mix(N, n, detail));
  s.emissive = mix(farEmis, emis, detail);
  s.ao = ao;
  s.dbg = fw / max(min(sx, flH), 0.5);
}

/* Glass curtain wall: mullion grid, spandrels, reflective tinted glass, office lighting at night. */
void cityCurtain(inout CitySurf s, vec3 N, vec3 T, float u, float v, float sx, int flags, float fh, float gfh, float seed, float lightsOn, float occ) {
  vec3 tint = s.albedo;
  float fw = max(fwidth(u), fwidth(v)) + 1e-4;
  float pw = max(sx, 1.0);
  float fi; float ly; float flH;
  if (v < gfh) { fi = 0.0; ly = v; flH = gfh; }
  else { float k = floor((v - gfh) / fh); fi = 1.0 + k; ly = v - gfh - k * fh; flH = fh; }
  float col = floor(u / pw);
  float lx = u - col * pw;
  float aa = fw * 0.7;
  float mull = 1.0 - cityBox(vec2(lx, ly), vec2(0.045, 0.06), vec2(pw - 0.045, flH - 0.06), aa);
  float spandrel = fi >= 1.0 ? 1.0 - smoothstep(0.95 - aa, 0.95 + aa, ly) : 0.0;
  float ph = hash13(vec3(col, fi, seed));
  vec3 glass = tint * (0.5 + 0.12 * ph);
  float detail = 1.0 - smoothstep(0.12, 0.35, fw / pw);
  vec3 tilt = (hash33(vec3(col, fi, seed + 3.0)) - 0.5) * 0.028;
  vec3 gn = normalize(N + T * tilt.x + vec3(0.0, tilt.y, 0.0));
  vec3 alb = mix(glass, tint * 0.35 + vec3(0.03), spandrel);
  alb = mix(alb, vec3(0.28, 0.29, 0.3), mull);
  float rough = mix(mix(0.035 + 0.05 * ph, 0.25, spandrel), 0.35, mull);
  float metal = mix(0.72, 0.8, mull);
  // Office lighting: floors lit in bays, some floors fully lit, lobby always lit.
  float bay = floor(col / 4.0);
  float floorAll = step(hash12(vec2(fi, seed + 5.0)), occ * 0.35);
  float onB = max(step(hash13(vec3(bay, fi, seed + 11.0)), occ), floorAll);
  if (fi == 0.0) onB = 1.0;
  float ceiling = mix(0.55, 1.25, smoothstep(0.9, flH - 0.1, ly));
  vec3 lc = cityKelvin(0.72 + 0.2 * hash12(vec2(bay, seed)));
  vec3 emis = lc * onB * (fi == 0.0 ? 8.0 : 5.0) * ceiling * (1.0 - spandrel) * (1.0 - mull) * lightsOn;
  float footprint = max(fwidth(u) / (pw * 4.0), fwidth(v) / fh);
  float farOn = max(cityFarLit(vec2(bay, fi), footprint, seed + 11.0, occ), step(hash12(vec2(fi, seed + 5.0)), occ * 0.35));
  vec3 farEmis = lc * 5.0 * 0.6 * farOn * lightsOn;
  s.albedo = mix(mix(glass, tint * 0.35, 0.25), alb, detail);
  s.rough = mix(0.08, rough, detail);
  s.metal = mix(0.72, metal, detail);
  s.n = normalize(mix(N, mix(gn, N, mull), detail));
  s.emissive = mix(farEmis, emis, detail);
  s.ao = 1.0;
}

/* Terracotta (Marseille / alaturka) tiles: per-tile tone, ridges, overlap shadows, lichen and soot. */
void cityRoofTile(inout CitySurf s, vec3 N, vec3 P, float seed) {
  vec3 base = s.albedo;
  float sinP = length(N.xz);
  vec2 down = N.xz / max(sinP, 1e-3);
  vec2 along = vec2(-down.y, down.x);
  float tu = dot(P.xz, along) / 0.21;
  float tv = P.y / max(0.34 * sinP, 0.02);
  float fwt = max(fwidth(tu), fwidth(tv)) + 1e-4;
  float detail = 1.0 - smoothstep(0.1, 0.38, fwt);
  vec2 tid = floor(vec2(tu, tv));
  float th = hash13(vec3(tid, seed));
  float fu = fract(tu);
  float fv = fract(tv);
  float lichen = fbm2(P.xz * 0.45 + seed * 0.13, 4);
  float big = fbm2(P.xz * 0.08 + seed * 0.07, 3);
  vec3 alb = base * (0.78 + 0.42 * th);
  if (th > 0.965) alb = base * 1.35;
  if (th < 0.03) alb = base * 0.55;
  alb = mix(alb, alb * vec3(0.62, 0.64, 0.6), smoothstep(0.5, 0.78, lichen) * 0.7);
  alb *= 0.85 + 0.3 * big;
  float overlap = smoothstep(0.78, 1.0, fv);
  alb *= 1.0 - overlap * 0.45;
  vec3 aw = vec3(along.x, 0.0, along.y);
  vec3 dw = normalize(vec3(down.x, 0.0, down.y));
  vec3 n = normalize(N - aw * cos(fu * PI) * 0.55 + dw * (1.0 - fv) * 0.25);
  vec3 avg = base * (0.85 + 0.3 * big) * mix(1.0, 0.72, smoothstep(0.5, 0.78, lichen) * 0.7) * 0.94;
  s.albedo = mix(avg, alb, detail);
  s.rough = 0.78;
  s.n = normalize(mix(N, n, detail));
  s.ao = mix(1.0, 1.0 - overlap * 0.4, detail);
}

void cityRoofFlat(inout CitySurf s, vec3 P, float seed) {
  vec3 base = s.albedo;
  float st = fbm2(P.xz * 0.3 + seed * 0.21, 4);
  float fine = vnoise2(P.xz * 7.0);
  float fw = fwidth(P.x) + fwidth(P.z);
  vec3 alb = base * (0.8 + 0.35 * st) * (0.92 + 0.12 * fine * (1.0 - smoothstep(0.02, 0.1, fw)));
  float seam = 1.0 - smoothstep(0.0, 0.03 + fw, abs(fract(P.x * 1.05 + P.z * 0.02) - 0.5) - 0.47);
  alb *= 1.0 - 0.1 * seam * (1.0 - smoothstep(0.05, 0.3, fw)) * step(0.5, hash11(seed));
  float puddle = smoothstep(0.62, 0.7, fbm2(P.xz * 0.12 + seed, 3));
  s.albedo = alb * (1.0 - puddle * 0.25);
  s.rough = mix(0.9, 0.45, puddle);
}

void cityMetalRoof(inout CitySurf s, vec3 N, vec3 P, float seed) {
  vec3 base = s.albedo;
  vec2 dir = length(N.xz) > 0.05 ? normalize(N.xz) : vec2(1.0, 0.0);
  vec2 along = vec2(-dir.y, dir.x);
  float c = dot(P.xz, along) / 0.2;
  float fw = fwidth(c) + 1e-4;
  float detail = 1.0 - smoothstep(0.3, 0.8, fw);
  vec3 aw = vec3(along.x, 0.0, along.y);
  float rust = smoothstep(0.55, 0.85, fbm2(vec2(dot(P.xz, along) * 0.2, P.y * 0.6 + dot(P.xz, dir) * 0.6) + seed, 4));
  s.albedo = mix(base, vec3(0.3, 0.14, 0.07), rust * 0.6) * (0.9 + 0.1 * vnoise2(P.xz * 0.5));
  s.rough = mix(0.45, 0.8, rust);
  s.metal = 0.35 * (1.0 - rust);
  s.n = normalize(N + aw * sin(c * 2.0 * PI) * 0.25 * detail);
}

void cityRailing(inout CitySurf s, vec3 N, vec3 T, vec3 P, float v, float seed) {
  float h = hash11(seed * 1.7 + 0.3);
  float fw = fwidth(v) + 1e-4;
  float along = dot(P.xz, T.xz);
  float fa = fwidth(along) + 1e-4;
  if (v < 0.17) { s.albedo = citySrgb(vec3(0.8, 0.78, 0.74)); s.rough = 0.85; return; }
  float rail = step(0.94, v) ;
  if (h < 0.4) {
    // Solid parapet in the wall colour.
    s.albedo *= 1.0 + 0.08 * rail; s.rough = 0.85;
  } else if (h < 0.75) {
    // Metal bars: the view through the bars is the dark balcony.
    float bars = 1.0 - smoothstep(0.012, 0.012 + fa, abs(fract(along / 0.12) - 0.5) * 0.12 - 0.045);
    float detail = 1.0 - smoothstep(0.02, 0.06, fa);
    float cover = mix(0.35, bars, detail);
    vec3 barCol = citySrgb(vec3(0.16, 0.16, 0.17));
    vec3 behind = citySrgb(vec3(0.12, 0.11, 0.1));
    s.albedo = mix(behind, barCol, max(cover, rail));
    s.rough = 0.55; s.metal = 0.4 * cover;
  } else {
    // Glass balustrade with a steel top rail.
    s.albedo = mix(vec3(0.03, 0.04, 0.045), vec3(0.5), rail);
    s.rough = mix(0.05, 0.3, rail); s.metal = mix(0.1, 0.8, rail);
  }
  s.ao = 0.85;
}

void cityGlazedBalcony(inout CitySurf s, vec3 N, vec3 T, float u, float v, float seed, float lightsOn, float occ) {
  float fw = max(fwidth(u), fwidth(v)) + 1e-4;
  float pw = 0.9;
  float col = floor(u / pw);
  float lx = u - col * pw;
  float aa = fw * 0.7;
  float panel = 1.0 - smoothstep(0.98 - aa, 0.98 + aa, v);
  float frame = 1.0 - cityBox(vec2(lx, v), vec2(0.05, 1.02), vec2(pw - 0.05, 2.62), aa);
  float h = hash13(vec3(col, floor(v / 3.0), seed));
  float tulle = step(0.35, hash11(seed * 1.3 + floor(col / 3.0)));
  vec3 glass = mix(vec3(0.035, 0.04, 0.045), citySrgb(vec3(0.78, 0.76, 0.7)) * 0.55, tulle * (0.7 + 0.3 * vnoise2(vec2(u * 4.0, v * 0.5))));
  vec3 panelCol = s.albedo * 0.9;
  vec3 alb = mix(glass, citySrgb(vec3(0.88, 0.88, 0.86)), frame);
  alb = mix(alb, panelCol, panel);
  float detail = 1.0 - smoothstep(0.1, 0.3, fw / pw);
  float lit = step(h, occ * 0.8) * (1.0 - max(frame, panel));
  s.albedo = mix(mix(panelCol, citySrgb(vec3(0.5, 0.5, 0.48)), 0.5), alb, detail);
  s.rough = mix(0.45, mix(0.05, 0.45, max(frame, panel)), detail);
  s.emissive = cityKelvin(0.3 + 0.4 * h) * 5.0 * mix(occ * 0.35, lit, detail) * lightsOn * (0.6 + 0.4 * tulle);
}

CitySurf cityEval(vec3 nView) {
  CitySurf s;
  vec3 N = normalize((vec4(nView, 0.0) * viewMatrix).xyz);
  int kind = int(vCityColor.w + 0.5) & ${KIND_MASK};
  vec3 base = citySrgb(vCityColor.rgb / 255.0);
  float seed = vCityParams.x;
  float fh = max(vCityParams.y * 0.1, 2.0);
  float gfh = max(vCityParams.z * 0.1, 2.0);
  int style = int(vCityParams.w + 0.5);
  int winType = style & 15;
  int usage = (style >> 4) & 3;
  int roofTop = (style >> 6) & 3;
  int flags = int(vCityFace.y + 0.5);
  float sx = vCityFace.x * 0.01;
  vec3 P = vCityLocal;
  float ground = cityTerrain(vCityWorld.xz);
  float hAbove = ground < -9000.0 ? max(vCityUV.y + 2.0, 0.0) : vCityWorld.y - ground;
  float lightsOn = cityLightsOn();
  float occ = cityOccupancy(uTimeOfDay, usage);

  s.albedo = base;
  s.rough = 0.85;
  s.metal = 0.0;
  s.n = N;
  s.emissive = vec3(0.0);
  s.ao = 1.0;
  s.dbg = -1.0;

  bool wallLike = kind <= int(K_CURTAIN) || kind == int(K_GLAZED);
  if (wallLike && N.y > 0.7) {
    // Top face of a compact box: roof material from the style bits.
    float h = hash11(seed * 0.73 + 0.1);
    if (roofTop == 1) { kind = int(K_ROOFTILE); s.albedo = citySrgb(mix(vec3(0.66, 0.34, 0.22), vec3(0.55, 0.3, 0.22), h)); }
    else if (roofTop == 2) { kind = int(K_ROOFMETAL); s.albedo = citySrgb(vec3(0.55 + 0.1 * h)); }
    else { kind = int(K_ROOFFLAT); s.albedo = citySrgb(vec3(0.5 + 0.18 * h, 0.49 + 0.17 * h, 0.46 + 0.16 * h)); }
    wallLike = false;
  }
  vec3 T = normalize(vec3(N.z, 0.0, -N.x) + vec3(1e-5, 0.0, 0.0));
  float u = (flags & F_WORLDU) != 0 ? dot(P.xz, T.xz) : vCityUV.x;
  float v = vCityUV.y;

  float ground_ao = mix(0.55, 1.0, smoothstep(0.0, 3.5, hAbove));
  if (kind == int(K_WALL) || kind == int(K_STONE) || kind == int(K_WOOD)) {
    cityWall(s, kind, N, T, u, v, sx, flags, fh, gfh, seed, winType, usage, hAbove, lightsOn, occ);
    // Narrow-street sky occlusion on the lower floors.
    s.ao *= ground_ao * mix(0.75, 1.0, smoothstep(0.0, 16.0, hAbove));
  } else if (kind == int(K_CURTAIN)) {
    cityCurtain(s, N, T, u, v, sx, flags, fh, gfh, seed, lightsOn, cityOccupancy(uTimeOfDay, 1));
    s.ao *= ground_ao;
  } else if (kind == int(K_ROOFTILE)) {
    cityRoofTile(s, N, P, seed);
  } else if (kind == int(K_ROOFFLAT)) {
    cityRoofFlat(s, P, seed);
  } else if (kind == int(K_ROOFMETAL)) {
    cityMetalRoof(s, N, P, seed);
  } else if (kind == int(K_SLAB) || kind == int(K_SOFFIT)) {
    s.albedo = base * (0.92 + 0.1 * vnoise2(P.xz * 2.0 + P.y));
    s.rough = 0.88;
    s.ao = kind == int(K_SOFFIT) ? 0.55 : 0.9;
  } else if (kind == int(K_RAILING)) {
    cityRailing(s, N, T, P, v, seed);
  } else if (kind == int(K_GLAZED)) {
    cityGlazedBalcony(s, N, T, u, v, seed, lightsOn, occ);
  } else if (kind == int(K_SOLAR)) {
    float g = max(abs(fract(dot(P.xz, T.xz) * 1.0) - 0.5), abs(fract(P.y * 2.0) - 0.5));
    s.albedo = mix(vec3(0.015, 0.025, 0.05), vec3(0.4), step(0.46, g));
    s.rough = 0.08;
    s.metal = 0.3;
  } else if (kind == int(K_METAL)) {
    float rust = smoothstep(0.6, 0.9, fbm2(vec2(dot(P.xz, T.xz) * 3.0, P.y * 1.5) + seed, 3));
    s.albedo = mix(base, vec3(0.3, 0.16, 0.08), rust * 0.5);
    s.rough = 0.45;
    s.metal = 0.5;
  } else if (kind == int(K_BEACON)) {
    s.albedo = vec3(0.3, 0.02, 0.02);
    float blink = 0.5 + 0.5 * step(0.5, fract(uTime * 0.5 + seed / 255.0));
    s.emissive = vec3(1.0, 0.03, 0.01) * 30.0 * blink * lightsOn;
  } else if (kind == int(K_AWNING)) {
    float st = step(0.5, fract(dot(P.xz, T.xz) / 0.5));
    s.albedo = hash11(seed * 2.9) < 0.5 ? mix(base, vec3(0.8), st * 0.7) : base;
    s.rough = 0.8;
    s.emissive = base * 0.12 * lightsOn;
  } else if (kind == int(K_CHIMNEY)) {
    s.albedo = base * (0.85 + 0.2 * vnoise2(P.xz * 4.0 + P.y * 3.0));
    s.rough = 0.9;
  } else if (kind == int(K_DARK)) {
    float lou = fract(P.y / 0.3);
    s.albedo = base * (0.7 + 0.4 * smoothstep(0.3, 0.7, lou));
    s.rough = 0.45;
    s.metal = 0.6;
    s.n = normalize(N + vec3(0.0, (lou - 0.5) * 0.8, 0.0) * (1.0 - smoothstep(0.1, 0.3, fwidth(P.y / 0.3))));
  }
  // Street lighting spill on the lower facades at night.
  if (wallLike) {
    vec3 spill = vec3(1.0, 0.55, 0.22) * 0.05 * exp(-max(hAbove, 0.0) / 7.0) * lightsOn;
    s.emissive += s.albedo * spill;
  }
  return s;
}
`;

/** Screen-door fade (complementary dithering between LODs, so cross-faded chunks never overlap). */
export const CITY_FADE_FRAGMENT = /* glsl */ `
#ifdef CITY_FADE
{
  float cityDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (uCityFadeInvert > 0.5 ? cityDither < 1.0 - uCityFade : cityDither >= uCityFade) discard;
}
#endif
`;
