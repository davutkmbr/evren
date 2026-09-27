/**
 * Wall material of the city-wall kit. Masonry is textured with the approved CC0 sets (public/textures/LICENSES.md,
 * decision .docs/assets/candidates/wall-scans.md): Bricks102 for the limestone facing, castle_brick_broken_06 for the
 * brick bands, repairs and buttresses, Rocks025 for the rubble core; the layout (band spacing, lost facing, repairs)
 * comes from the kit geometry and per-vertex fields, the wear passes from the heritage surface library plus wall
 * weathering (grime, stains, crusts, salt, algae). Foliage cards are alpha-tested LeafSet029 ivy leaves (or procedural
 * grass blades), with a matching depth material so they cast leaf-shaped shadows.
 *
 * Vertex channels (heritage vertex format): surface id, tint, weather, height above ground, AO; the floodlight
 * channel carries the lost-facing field on masonry (constant floodlight there).
 */
import * as THREE from 'three';
import { patchMaterial } from '../../../../core/uniforms';
import { FACADE_GLSL } from '../../heritage/render/glsl/facade.glsl';
import { SURFACES_GLSL } from '../../heritage/render/glsl/surfaces.glsl';
import { Surf } from '../../heritage/build/surfaces';
import { WALL_FOLIAGE } from '../kit/detail';
import { loadImage, maxAnisotropy, pixels } from '../../../osm/shared/textures';

const BASE = `${import.meta.env?.BASE_URL ?? "/"}textures/`;
/** Texture array layers: 0 facing, 1 brick, 2 core. */
const LAYERS = ['wall_stone', 'wall_brick', 'wall_core'] as const;
/** Real-world size (m) of one repeat per layer [u, v]: Bricks102 is 2:1, courses ~0.34 m at 2.4 m height. */
const REPEAT: readonly [number, number][] = [
  [4.8, 2.4],
  [3.0, 3.3],
  [1.9, 1.9],
];
const ARRAY_SIZE = 1024;

const VERTEX_PARS = /* glsl */ `
attribute vec4 aHCol;
attribute vec4 aHSurf;
varying vec4 vHCol;
varying vec4 vHSurf;
varying vec2 vHUv;
varying vec3 vHWorld;
varying vec3 vHNormalW;
`;

const VERTEX_MAIN = /* glsl */ `
vHCol = vec4(aHCol.rgb * aHCol.rgb, aHCol.a);
vHSurf = vec4(aHSurf.x, aHSurf.y / 255.0, aHSurf.z * 0.25, aHSurf.w / 255.0);
vHUv = uv;
vHWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vHNormalW = normalize(mat3(modelMatrix) * objectNormal);
`;

/** Foliage cut-out shared by the main and the depth material (no dependency on the shared GLSL library). */
const LEAF_GLSL = /* glsl */ `
uniform sampler2D uLeafTex;
float wlH12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 wlH22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

/* Ivy leaves scattered over a card (p in metres): up to one leaf per 0.17 m cell and its neighbours, rotated and
   scaled, each a random tile of the 3 x 3 LeafSet029 atlas. rgb = leaf colour, a = coverage. */
vec4 wLeaf(vec2 p) {
  vec2 q = p * 6.0;
  vec2 ip = floor(q);
  vec2 fp = fract(q);
  vec2 gx = dFdx(q) / 4.5;
  vec2 gy = dFdy(q) / 4.5;
  vec4 best = vec4(0.0);
  float bestZ = -1.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cid = ip + g;
      vec2 r = fp - g - wlH22(cid);
      float ang = wlH12(cid + 3.3) * 6.2832;
      float sc = 0.85 + 0.6 * wlH12(cid + 7.1);
      vec2 lr = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * r / sc;
      vec2 luv = lr / 1.5 + 0.5;
      if (luv.x < 0.0 || luv.y < 0.0 || luv.x > 1.0 || luv.y > 1.0) continue;
      float tile = floor(wlH12(cid + 11.0) * 8.99);
      vec2 t = vec2(mod(tile, 3.0), floor(tile / 3.0));
      vec4 c = textureGrad(uLeafTex, (t + luv) / 3.0, gx, gy);
      float z = wlH12(cid + 5.0);
      if (c.a > 0.5 && z > bestZ) {
        bestZ = z;
        best = vec4(c.rgb, 1.0);
      }
    }
  }
  return best;
}

/* Grass blades on a tuft card (p: u along the card, v up from its base, metres). */
float wGrass(vec2 p) {
  float bx = p.x * 22.0;
  float blade = abs(fract(bx) - 0.5);
  float hgt = 0.45 + 0.55 * wlH12(vec2(floor(bx) * 1.7, 0.3));
  float taper = mix(0.45, 0.05, clamp(p.y / max(hgt * 0.55, 0.05), 0.0, 1.0));
  return (blade > taper || p.y > hgt * 0.55) ? 0.0 : 1.0;
}
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec4 vHCol;
varying vec4 vHSurf;
varying vec2 vHUv;
varying vec3 vHWorld;
varying vec3 vHNormalW;
uniform sampler2DArray uWallAlb;
uniform sampler2DArray uWallNrm;
uniform float uWallTex;
uniform vec2 uWallRep[3];
uniform vec3 uWallMean;
vec3 wTexN;
float wTexK;
${LEAF_GLSL}
`;

const WALLS_GLSL = /* glsl */ `
const vec3 W_FLOOD = vec3(1.0, 0.74, 0.47);

vec3 wPerturb(vec3 pos, vec3 n, float hgt) {
  vec3 dpdx = dFdx(pos);
  vec3 dpdy = dFdy(pos);
  float dhdx = dFdx(hgt);
  float dhdy = dFdy(hgt);
  vec3 r1 = cross(dpdy, n);
  vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  if (abs(det) < 1e-12) return n;
  vec3 grad = (dhdx * r1 + dhdy * r2) / det;
  return normalize(n - grad);
}

/* One layer of the wall texture array at p (metres) with an offset (in repeats). */
vec4 wAlbL(vec2 p, int L, vec2 off) { return texture(uWallAlb, vec3(p / uWallRep[L] + off, float(L))); }
vec3 wNrmL(vec2 p, int L, vec2 off) { return texture(uWallNrm, vec3(p / uWallRep[L] + off, float(L))).xyz * 2.0 - 1.0; }

/* Tint-normalised texture colour: keeps the texture's own stone-to-stone variation, sets the overall colour. */
vec3 wRecolour(vec3 c, vec3 tint, float mean, float keepHue) {
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return tint * mix(vec3(lum), c, keepHue) / max(mean, 0.02);
}

/*
 * Limestone facing (Bricks102): a different part of the texture per 19 m stretch, cross-faded over ~2.5 m across a
 * noisy stretch boundary so no seam shows.
 */
vec2 wStretchOff(float k) { return vec2(hash11(k * 1.7), hash11(k * 2.3)); }
HS wFacing(vec2 p, vec3 tint, float fw, float field) {
  float xs = p.x / 19.0 + (vnoise2(vec2(p.y * 0.35, field)) - 0.5) * 0.08;
  float stretch = floor(xs);
  float t = fract(xs);
  float w = smoothstep(0.87, 1.0, t);
  vec2 offA = wStretchOff(stretch + field * 13.0);
  vec2 offB = wStretchOff(stretch + 1.0 + field * 13.0);
  vec4 a = wAlbL(p, 0, offA);
  vec3 nA = wNrmL(p, 0, offA);
  if (w > 0.001) {
    vec4 b = wAlbL(p, 0, offB);
    vec3 nB = wNrmL(p, 0, offB);
    // Height-aware blend: the brighter (stone) texel wins, so the join follows the stones instead of a smear.
    float la = dot(a.rgb, vec3(0.33));
    float lb = dot(b.rgb, vec3(0.33));
    float k = smoothstep(-0.08, 0.08, (lb - la) * 0.5 + (w - 0.5));
    a = mix(a, b, k);
    nA = mix(nA, nB, k);
  }
  HS s = hsInit(wRecolour(a.rgb, tint, uWallMean.x, 0.55), mix(0.72, 0.98, a.a));
  float lum = dot(a.rgb, vec3(0.2126, 0.7152, 0.0722)) / max(uWallMean.x, 0.02);
  s.height = (lum - 1.0) * 0.012 * hDetail(fw, 0.1);
  wTexN = nA;
  wTexK = 1.0 - smoothstep(0.03, 0.1, fw);
  return s;
}

/* Mortar-ness of a brick texel: the joints are low-saturation grey, the bricks saturated red. */
float wMortar(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float sat = (mx - min(c.r, min(c.g, c.b))) / max(mx, 1e-3);
  return 1.0 - smoothstep(0.2, 0.36, sat);
}

/*
 * Brick (castle_brick_broken_06): old brick shifted to the photos' dull pink-brown, courses stretched to ~9 cm, and
 * the texture's own joints widened (dilated over neighbouring texels) into the thick pale lime mortar of Byzantine
 * brickwork, where joints are about as thick as the bricks.
 */
HS wBrickTex(vec2 p, float fw, vec2 off) {
  vec4 a = wAlbL(p, 1, off);
  float m = wMortar(a.rgb);
  float det = hDetail(fw, 0.03);
  if (det > 0.01) {
    float d = 0.009;
    m = max(m, wMortar(wAlbL(p + vec2(0.0, d), 1, off).rgb));
    m = max(m, wMortar(wAlbL(p - vec2(0.0, d), 1, off).rgb));
    m = max(m, wMortar(wAlbL(p + vec2(d * 1.4, 0.0), 1, off).rgb) * 0.8);
  }
  m = mix(0.3, m, det);
  float l = dot(a.rgb, vec3(0.2126, 0.7152, 0.0722)) / max(uWallMean.y, 0.02);
  vec3 brick = vec3(0.32, 0.18, 0.13) * mix(vec3(l), a.rgb / max(uWallMean.y, 0.02), 0.3);
  vec3 mortar = vec3(0.56, 0.5, 0.44) * (0.85 + 0.25 * vnoise2(p * 6.0));
  HS s = hsInit(mix(brick, mortar, m), mix(mix(0.82, 0.97, a.a), 0.98, m));
  s.height = ((1.0 - m) * 0.012 - 0.006) * det;
  s.ao = mix(1.0, 0.75, m);
  wTexN = wNrmL(p, 1, off);
  wTexK = (1.0 - m * 0.7) * (1.0 - smoothstep(0.02, 0.08, fw));
  return s;
}

/* Rubble core (Rocks025): irregular stones in lime mortar, darkened, recessed look. */
HS wCore(vec2 p, vec3 tint, float fw) {
  vec4 a = wAlbL(p, 2, vec2(0.0));
  HS s = hsInit(wRecolour(a.rgb, tint * 0.8, uWallMean.z, 0.5), mix(0.85, 1.0, a.a));
  float lum = dot(a.rgb, vec3(0.2126, 0.7152, 0.0722)) / max(uWallMean.z, 0.02);
  s.albedo *= mix(0.75, 1.0, smoothstep(0.5, 1.0, lum));
  s.ao = mix(0.75, 1.0, smoothstep(0.4, 1.0, lum));
  s.height = (lum - 1.0) * 0.03 * hDetail(fw, 0.1);
  wTexN = wNrmL(p, 2, vec2(0.0));
  wTexK = 1.0 - smoothstep(0.03, 0.1, fw);
  return s;
}

/*
 * Byzantine banded masonry: limestone facing with bands of 4-7 brick courses. Band spacing and thickness vary per
 * 19 m stretch, band levels wobble along the wall, bands break off. (Brick repair patches are geometry: Surf.Brick.)
 */
HS wByzantine(vec2 p, vec3 wp, vec3 tint, float w, float hag, float vert, float fw) {
  float stretch = floor(p.x / 19.0);
  float period = mix(1.3, 2.4, hash11(stretch * 1.7 + 0.3));
  float wob = (vnoise2(vec2(p.x * 0.08, stretch)) - 0.5) * 0.3 + (vnoise2(vec2(p.x * 0.4, stretch + 3.0)) - 0.5) * 0.06;
  float yb = p.y + 0.35 + wob;
  float band = mod(yb, period);
  float bandIdx = floor(yb / period);
  float bh = hash12(vec2(bandIdx, stretch));
  float brickH = 0.088 * floor(mix(4.0, 7.99, hash11(bandIdx * 7.1 + stretch)));
  bool noBand = bh < 0.12 || fract(hash11(stretch * 3.1) * 7.0) < 0.1;
  float brk = vnoise2(vec2(floor((p.x + hash11(floor(yb / 0.088)) * 0.8) / 0.34) * 0.12, bandIdx * 3.0));
  noBand = noBand || brk < 0.14;
  HS s;
  if (band >= period - brickH && !noBand) {
    s = wBrickTex(vec2(p.x, yb), fw, vec2(hash11(bandIdx), hash11(bandIdx + 0.5)));
    // Band brick is the original fabric: warmer and redder than later repairs, so the bands read from afar.
    s.albedo *= vec3(1.25, 0.92, 0.8);
    // Thick pale mortar lines at the band edges.
    float edge = min(band - (period - brickH), period - band);
    s.albedo = mix(s.albedo, vec3(0.5, 0.45, 0.39), (1.0 - smoothstep(0.0, 0.03, edge)) * 0.8);
  } else {
    s = wFacing(vec2(p.x, yb), tint, fw, 0.0);
  }
  float drift = fbm2(vec2(p.x * 0.02, p.y * 0.05) + wp.xz * 0.001, 3);
  s.albedo *= 0.78 + 0.4 * drift;
  return s;
}

/*
 * Wall wear shared by the masonry surfaces. loss (vertex, 0..1) is the lost-facing field of the relief grid: facing
 * stones drop out one by one around its edge (the ones that remain hang over the hole), the core shows inside.
 */
void wWear(inout HS s, vec2 p, vec3 wp, vec3 tint, float w, float hag, float vert, float fw, float loss) {
  if (loss > 0.01) {
    float ln = loss + (fbm2(p * 0.8, 3) - 0.5) * 0.35;
    float row = floor(p.y / 0.34);
    float col = floor((p.x + hash11(row) * 2.7) / 0.62);
    float hb = hash12(vec2(col, row) + 17.0);
    float coreM = smoothstep(0.44, 0.5, ln + (hb - 0.5) * 0.4);
    float k = wTexK;
    vec3 n = wTexN;
    HS r = wCore(p, tint, fw);
    float rim = smoothstep(0.25, 0.45, ln) * (1.0 - coreM);
    s.albedo = mix(s.albedo * (1.0 - 0.15 * rim), r.albedo, coreM);
    s.rough = mix(s.rough, r.rough, coreM);
    s.height = mix(s.height, r.height, coreM);
    s.ao = mix(s.ao * (1.0 - 0.15 * rim), r.ao, coreM);
    wTexN = normalize(mix(n, wTexN, coreM));
    wTexK = mix(k, wTexK, coreM);
  }
  s.albedo = hWeather(s.albedo, p, wp, hag, w, vert);
  // Soil splash and grime at the foot.
  float foot = (1.0 - smoothstep(0.0, 2.2 + 1.4 * vnoise2(vec2(p.x * 0.2, 5.0)), hag)) * vert;
  s.albedo = mix(s.albedo, s.albedo * vec3(0.55, 0.49, 0.4), foot * 0.75);
  // Water stains: long dark tongues from the top and from joints.
  float stain = smoothstep(0.58, 0.8, vnoise2(vec2(p.x * 0.35, p.y * 0.03) + 9.0)) * smoothstep(2.0, 6.0, hag);
  s.albedo *= 1.0 - 0.35 * stain * vert;
  // Salt bloom on sea-facing walls above the waterline.
  float salt = smoothstep(0.55, 0.75, vnoise2(p * vec2(0.9, 1.4) + 4.0)) * (1.0 - smoothstep(2.0, 6.0, wp.y)) * smoothstep(0.6, 1.4, wp.y) * vert;
  s.albedo = mix(s.albedo, vec3(0.7, 0.69, 0.64), salt * 0.35);
  s.rough = mix(s.rough, 0.98, salt);
  // Algae at the sea line.
  float sea = (1.0 - smoothstep(0.6, 3.2 + 1.5 * vnoise2(p * vec2(0.3, 0.1)), wp.y)) * vert;
  s.albedo = mix(s.albedo, vec3(0.05, 0.06, 0.04), sea * 0.55);
  s.rough = mix(s.rough, 0.55, sea * 0.4);
  // Run-off streaks from the top.
  float run = vnoise2(vec2(p.x * 1.6, p.y * 0.04) + 3.0) * vnoise2(vec2(p.x * 0.37, 2.0)) * 1.6;
  s.albedo *= 1.0 - 0.35 * smoothstep(0.3, 0.75, run) * vert * smoothstep(1.0, 8.0, hag);
  // Black crusts in sheltered patches, a general dirty grey film.
  float crust = smoothstep(0.5, 0.78, fbm2(vec2(p.x * 0.045, p.y * 0.12) + 7.0, 4));
  s.albedo *= 1.0 - 0.45 * crust * vert;
  s.albedo = mix(s.albedo, vec3(dot(s.albedo, vec3(0.3, 0.59, 0.11))) * 0.9, 0.18);
  // Plants in the joints.
  float tuft = smoothstep(0.8, 0.92, vnoise2(p * 1.7 + wp.xz * 0.05)) * smoothstep(0.55, 0.8, fbm2(p * 0.2 + 5.0, 3)) * vert;
  s.albedo = mix(s.albedo, vec3(0.03, 0.05, 0.02), tuft * 0.8 * (0.5 + w * 0.5));
  // Tops: dirt, lichen, grass.
  s.albedo *= mix(1.0, 0.72 + 0.25 * vnoise2(wp.xz * 0.9), 1.0 - vert);
  s.albedo = mix(s.albedo, vec3(0.06, 0.08, 0.03), (1.0 - vert) * smoothstep(0.55, 0.75, vnoise2(wp.xz * 0.35)) * 0.8);
}

/* Vegetation cards: ivy leaves (atlas) or grass blades (weather < 0.3), alpha-tested. */
HS wFoliage(vec2 p, vec3 wp, vec3 tint, float w, float fw) {
  HS s;
  if (w < 0.3) {
    float bx = floor(p.x * 22.0);
    s = hsInit(tint * (0.7 + 0.6 * hash11(bx)) * mix(0.55, 1.15, clamp(p.y * 2.0, 0.0, 1.0)), 0.8);
    s.cut = 1.0 - wGrass(p);
    s.ao = mix(0.5, 1.0, clamp(p.y * 2.5, 0.0, 1.0));
    return s;
  }
  vec4 l = wLeaf(p);
  // Ivy in the photos is darker and bluer than the scanned leaves; the vertex tint varies it per sheet.
  vec3 c = l.rgb * vec3(0.24, 0.3, 0.2) * (tint / vec3(0.03, 0.055, 0.02));
  s = hsInit(c, 0.45);
  s.cut = 1.0 - l.a;
  s.ao = 0.75;
  // Thin leaves: some light comes through.
  s.emit = c * 0.08;
  return s;
}

HS wallsSurface() {
  float id = floor(vHSurf.x + 0.5);
  vec2 p = vHUv;
  vec3 wp = vHWorld;
  vec3 tint = vHCol.rgb;
  float w = vHSurf.y;
  float hag = vHSurf.z;
  vec3 nW = normalize(vHNormalW);
  float vert = 1.0 - abs(nW.y);
  float fw = max(max(fwidth(p.x), fwidth(p.y)), 1e-4);
  wTexN = vec3(0.0, 0.0, 1.0);
  wTexK = 0.0;
  HS s;
  bool masonry = false;
  if (id == ${WALL_FOLIAGE}.0) {
    return wFoliage(p, wp, tint, w, fw);
  }
  if (uWallTex > 0.5 && id == ${Surf.Byzantine}.0) {
    s = wByzantine(p, wp, tint, w, hag, vert, fw);
    masonry = true;
  } else if (uWallTex > 0.5 && id == ${Surf.Ashlar}.0) {
    s = wFacing(p * vec2(0.62, 0.7), tint, fw, 7.0);
    masonry = true;
  } else if (uWallTex > 0.5 && id == ${Surf.Rubble}.0) {
    s = wCore(p, tint * 1.15, fw);
    masonry = true;
  } else if (uWallTex > 0.5 && id == ${Surf.Brick}.0) {
    // Brick repairs and buttresses: courses slightly irregular.
    s = wBrickTex(vec2(p.x + (vnoise2(vec2(p.y * 0.7, 2.0)) - 0.5) * 0.4, p.y + (vnoise2(vec2(p.x * 0.35, 5.0)) - 0.5) * 0.12), fw, vec2(0.37, 0.61));
    s.albedo *= 0.85 + 0.25 * vnoise2(p * 0.8);
    masonry = true;
  } else if (id < ${Surf.Brick}.5) {
    s = hBase(id, p, wp, tint, w, hag, vert, fw);
  } else if (id == ${Surf.Earth}.0) {
    s = hEarth(p, wp, tint, fw);
  } else if (id == ${Surf.Paving}.0) {
    s = hPaving(p, tint, fw);
  } else if (id == ${Surf.Wood}.0) {
    s = hWood(p, tint, fw);
  } else if (id == ${Surf.Lead}.0) {
    // Lead roofs of the heritage fortress towers drawn with this material (heritage WALL_MATERIAL_SITES).
    s = hLead(p, wp, tint, w, fw);
  } else {
    s = hsInit(tint, 0.9);
  }
  if (masonry) {
    wWear(s, p, wp, tint, w, hag, vert, fw, vHCol.a);
  }
  float on = hLightsOn();
  // Masonry uses the floodlight channel for the lost-facing field: constant floodlight there.
  float fl = masonry ? 0.3 : vHCol.a;
  if (on > 0.0 && fl > 0.0) {
    float prof = 1.05 * exp(-hag / 13.0) + 0.45 * exp(-hag / 2.5) + 0.1;
    float pools = 0.62 + 0.38 * cos(6.2831853 * p.x / 9.0);
    prof *= mix(1.0, pools, vert * (1.0 - smoothstep(6.0, 16.0, hag)));
    s.emit += s.albedo * W_FLOOD * fl * prof * on * 2.1;
  }
  s.ao *= vHSurf.w * mix(mix(0.55, 1.0, smoothstep(0.0, 1.4, hag)), 1.0, 1.0 - vert);
  return s;
}
`;

const NORMAL_GLSL = /* glsl */ `
  // The reveals of lost facing and openings are steep quads whose uv (u along the wall, v = height) barely changes
  // across them: the derivative frames degenerate there, so both perturbations are skipped (they rendered black).
  vec2 du1 = dFdx(vHUv);
  vec2 du2 = dFdy(vHUv);
  vec3 dp1 = dFdx(-vViewPosition);
  vec3 dp2 = dFdy(-vViewPosition);
  float uvArea = abs(du1.x * du2.y - du1.y * du2.x);
  float posArea = length(cross(dp1, dp2));
  bool frameOk = uvArea > posArea * 0.05 && posArea > 1e-12;
  if (frameOk) {
    vec3 np = wPerturb(-vViewPosition, normal, hs.height);
    normal = (np == np) ? np : normal;
  }
  if (frameOk && wTexK > 0.001) {
    vec3 dp2perp = cross(dp2, normal);
    vec3 dp1perp = cross(normal, dp1);
    vec3 T = dp2perp * du1.x + dp1perp * du2.x;
    vec3 B = dp2perp * du1.y + dp1perp * du2.y;
    float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
    vec3 tn = normalize(vec3(wTexN.xy * 1.2, max(wTexN.z, 0.2)));
    vec3 nt = normalize(T * invmax * tn.x + B * invmax * tn.y + normal * tn.z);
    vec3 nn = normalize(mix(normal, nt, wTexK));
    normal = (nn == nn && dot(nn, normal) > 0.2) ? nn : normal;
  }
`;

export interface WallsMaterial {
  material: THREE.MeshStandardMaterial;
  /** Depth material for foliage meshes (leaf-shaped shadows): mesh.customDepthMaterial. */
  foliageDepth: THREE.MeshDepthMaterial;
  ready: Promise<void>;
  dispose(): void;
}

function placeholderArray(): THREE.DataArrayTexture {
  const d = new Uint8Array(3 * 4).fill(128);
  const t = new THREE.DataArrayTexture(d, 1, 1, 3);
  t.needsUpdate = true;
  return t;
}

/** Albedo (+ roughness in A, sRGB) and normal texture arrays over the wall layers, plus each layer's mean luminance. */
async function loadWallArrays(aniso: number): Promise<{ alb: THREE.DataArrayTexture; nrm: THREE.DataArrayTexture; mean: number[] }> {
  const n = LAYERS.length;
  const layer = ARRAY_SIZE * ARRAY_SIZE * 4;
  const alb = new Uint8Array(layer * n);
  const nrm = new Uint8Array(layer * n);
  const mean: number[] = [];
  await Promise.all(
    LAYERS.map(async (set, i) => {
      const [a, r, nm] = await Promise.all(['albedo', 'rough', 'normal'].map((m) => loadImage(`${BASE}${set}/${m}.jpg`)));
      const pa = pixels(a, ARRAY_SIZE);
      const pr = pixels(r, ARRAY_SIZE);
      const pn = pixels(nm, ARRAY_SIZE);
      const o = i * layer;
      let sum = 0;
      for (let k = 0; k < layer; k += 4) {
        alb[o + k] = pa[k];
        alb[o + k + 1] = pa[k + 1];
        alb[o + k + 2] = pa[k + 2];
        alb[o + k + 3] = pr[k];
        nrm[o + k] = pn[k];
        nrm[o + k + 1] = pn[k + 1];
        nrm[o + k + 2] = pn[k + 2];
        nrm[o + k + 3] = 255;
        if ((k & 1023) === 0) {
          const lin = (c: number): number => Math.pow(c / 255, 2.2);
          sum += 0.2126 * lin(pa[k]) + 0.7152 * lin(pa[k + 1]) + 0.0722 * lin(pa[k + 2]);
        }
      }
      mean[i] = Math.max(0.02, sum / (layer / 1024));
    }),
  );
  const make = (data: Uint8Array, srgb: boolean): THREE.DataArrayTexture => {
    const t = new THREE.DataArrayTexture(data, ARRAY_SIZE, ARRAY_SIZE, n);
    t.format = THREE.RGBAFormat;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = aniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { alb: make(alb, true), nrm: make(nrm, false), mean };
}

/** LeafSet029 colour + opacity packed into one RGBA texture. */
async function loadLeafTexture(aniso: number): Promise<THREE.Texture> {
  const [c, o] = await Promise.all([loadImage(`${BASE}wall_ivy/albedo.jpg`), loadImage(`${BASE}wall_ivy/opacity.jpg`)]);
  const size = 1024;
  const pc = pixels(c, size);
  const po = pixels(o, size);
  const data = new Uint8Array(size * size * 4);
  for (let k = 0; k < data.length; k += 4) {
    data[k] = pc[k];
    data[k + 1] = pc[k + 1];
    data[k + 2] = pc[k + 2];
    data[k + 3] = po[k];
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

export function createWallsMaterial(renderer: THREE.WebGLRenderer): WallsMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  material.name = 'city-walls';
  material.shadowSide = THREE.DoubleSide;
  const holder = placeholderArray();
  const leafHolder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  leafHolder.needsUpdate = true;
  const uniforms = {
    uWallAlb: { value: holder as THREE.Texture },
    uWallNrm: { value: holder as THREE.Texture },
    uWallTex: { value: 0 },
    uWallRep: { value: REPEAT.map(([u, v]) => new THREE.Vector2(u, v)) },
    uWallMean: { value: new THREE.Vector3(0.2, 0.1, 0.2) },
    uLeafTex: { value: leafHolder as THREE.Texture },
  };
  const textures: THREE.Texture[] = [holder, leafHolder];
  patchMaterial(material, 'city-walls-v4', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${SURFACES_GLSL}\n${FACADE_GLSL}\n${WALLS_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  HS hs = wallsSurface();
  if (hs.cut > 0.5) discard;
  diffuseColor.rgb = hs.albedo;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(hs.rough, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = hs.metal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${NORMAL_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance = hs.emit;`)
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= hs.ao;
  reflectedLight.indirectSpecular *= hs.ao;
  reflectedLight.directDiffuse *= mix(1.0, hs.ao, 0.35);`,
      );
  });

  // Foliage shadow caster: same cut-out, nothing else.
  const foliageDepth = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  foliageDepth.name = 'city-walls-foliage-depth';
  patchMaterial(foliageDepth, 'city-walls-foliage-depth-v1', (shader) => {
    shader.uniforms.uLeafTex = uniforms.uLeafTex;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aHSurf;\nvarying vec2 vHUv;\nvarying float vHW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHUv = uv;\nvHW = aHSurf.y / 255.0;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vHUv;\nvarying float vHW;\n${LEAF_GLSL}`)
      .replace('#include <alphatest_fragment>', 'if ((vHW < 0.3 ? wGrass(vHUv) : wLeaf(vHUv).a) < 0.5) discard;');
  });

  const aniso = maxAnisotropy(renderer);
  const ready = Promise.all([
    loadWallArrays(aniso).then(({ alb, nrm, mean }) => {
      textures.push(alb, nrm);
      uniforms.uWallAlb.value = alb;
      uniforms.uWallNrm.value = nrm;
      uniforms.uWallMean.value.set(mean[0], mean[1], mean[2]);
      uniforms.uWallTex.value = 1;
    }),
    loadLeafTexture(aniso).then((t) => {
      textures.push(t);
      uniforms.uLeafTex.value = t;
    }),
  ])
    .then(() => undefined)
    .catch((e: unknown) => {
      console.warn('[walls] wall textures failed to load, procedural masonry only', e);
    });
  return {
    material,
    foliageDepth,
    ready,
    dispose() {
      material.dispose();
      foliageDepth.dispose();
      for (const t of textures) {
        t.dispose();
      }
    },
  };
}
