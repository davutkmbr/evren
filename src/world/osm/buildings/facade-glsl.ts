/**
 * Facade shader chunks (patched into a MeshStandardMaterial, see materials.ts). One material draws every wall, trim,
 * bay window and flat roof slab of the slice; the per-vertex state written by facade.ts selects the texture layer
 * (facade texture array), the archetype and the window layout.
 *
 * Openings are exact ray-box recesses: the view ray enters the opening on the wall plane and hits the glass, a side
 * reveal, the soffit or the sill floor at the archetype's depth; the key light is traced back out of the opening for
 * the recess shadow. Behind the glass an interior-mapped room (walls, floor, ceiling, lamp) gives lit windows depth
 * at night; curtains (tulle, drapes), blinds, roller shutters and louvred shutters sit on the glass plane. Street
 * floors get shop fronts (glass, fascia, rolling shutters), Han arcades, doors and grilled windows. Weathering: grime
 * and damp at the foot, streaks under sills and cornices, flaking paint, soot on stone.
 */
import { Arch, ARCHETYPES, Flag, Head, Kind, LAYOUT_GLSL } from './archetypes';

const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);

export const FACADE_VERTEX_PARS = /* glsl */ `
attribute vec4 aFac;
attribute vec2 aGnd;
attribute vec4 aSty;
attribute vec4 aWin;
varying vec4 vFac;
varying vec2 vGnd;
varying vec4 vSty;
varying vec4 vWin;
varying vec2 vFUv;
varying vec3 vFN;
varying vec3 vFW;
`;

export const FACADE_VERTEX_MAIN = /* glsl */ `
vFac = aFac;
vGnd = aGnd;
vSty = aSty;
vWin = aWin;
vFUv = uv;
vFN = normalize(mat3(modelMatrix) * objectNormal);
vFW = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

export const FACADE_FRAGMENT_PARS = /* glsl */ `
uniform highp sampler2DArray uFacAlb;
uniform highp sampler2DArray uFacNrm;
uniform float uLayerNorm[5];
uniform float uLayerRep[5];
uniform float uLayerNrm[5];
varying vec4 vFac;
varying vec2 vGnd;
varying vec4 vSty;
varying vec4 vWin;
varying vec2 vFUv;
varying vec3 vFN;
varying vec3 vFW;
${LAYOUT_GLSL}
const float F_DEPTH[7] = float[7](${Object.values(ARCHETYPES)
  .map((a) => f(a.depth))
  .join(', ')});

float fBit(float flags, float b) { return mod(floor(flags / b), 2.0); }
float fBox(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }
float fLine(float x, float w, float fw) { return 1.0 - smoothstep(w - fw, w + fw, abs(x)); }

vec4 fTex(float layer, vec2 uv, out vec3 tn) {
  int li = int(layer + 0.5);
  vec2 t = uv / uLayerRep[li];
  vec4 a = texture(uFacAlb, vec3(t, layer));
  tn = texture(uFacNrm, vec3(t, layer)).xyz * 2.0 - 1.0;
  tn.xy *= uLayerNrm[li];
  a.rgb *= uLayerNorm[li];
  return a;
}

// Opening test: rect below the springing line, ellipse above it (rise 0 = flat head).
float fOpen(vec2 p, float halfW, float bottom, float spring, float rise, float fw) {
  float inX = fBox(p.x, -halfW, halfW, fw);
  float rect = inX * fBox(p.y, bottom, spring, fw);
  if (rise < 0.01) return rect;
  vec2 q = vec2(p.x / halfW, (p.y - spring) / rise);
  float e = 1.0 - smoothstep(1.0 - fw * 3.0 / halfW, 1.0 + fw * 3.0 / halfW, length(q));
  return max(rect, e * step(spring, p.y) * inX);
}

// Ray-box recess. Returns (x, y, depth, face): face 0 glass plane, 1 side reveal, 2 soffit, 3 sill floor.
vec4 fRecess(vec2 p0, vec3 d, float halfW, float bottom, float top, float depth) {
  float dz = max(-d.z, 0.02);
  float tb = depth / dz;
  float tx = d.x > 1e-4 ? (halfW - p0.x) / d.x : d.x < -1e-4 ? (-halfW - p0.x) / d.x : 1e9;
  float ty = d.y > 1e-4 ? (top - p0.y) / d.y : d.y < -1e-4 ? (bottom - p0.y) / d.y : 1e9;
  tx = max(tx, 0.0);
  ty = max(ty, 0.0);
  float t = min(tb, min(tx, ty));
  float face = t == tb ? 0.0 : t == tx ? 1.0 : (d.y > 0.0 ? 2.0 : 3.0);
  return vec4(p0 + d.xy * t, dz * t, face);
}

// Interior-mapped room behind the glass: returns albedo-ish colour and the lamp falloff in .a.
vec4 fRoom(vec2 g, vec3 d, float halfBay, float floorH, float roomD, float h) {
  float dz = max(-d.z, 0.02);
  float tb = roomD / dz;
  float tx = d.x > 1e-4 ? (halfBay - g.x) / d.x : d.x < -1e-4 ? (-halfBay - g.x) / d.x : 1e9;
  float ty = d.y > 1e-4 ? (floorH - 0.1 - g.y) / d.y : d.y < -1e-4 ? (0.05 - g.y) / d.y : 1e9;
  float t = min(tb, min(max(tx, 0.0), max(ty, 0.0)));
  vec3 hit = vec3(g + d.xy * t, dz * t);
  vec3 wallpaper = mix(vec3(0.62, 0.55, 0.45), vec3(0.72, 0.7, 0.66), h) * (0.8 + 0.2 * fract(h * 7.3));
  vec3 col = wallpaper;
  if (t == ty) {
    col = d.y > 0.0 ? vec3(0.8, 0.79, 0.76) : mix(vec3(0.32, 0.2, 0.12), vec3(0.45, 0.4, 0.36), fract(h * 3.1));
  } else if (t == tb) {
    col = wallpaper * 0.95;
    // A picture / shelf / wardrobe silhouette on the back wall.
    float furn = fBox(hit.x, -halfBay * 0.6 + h, halfBay * 0.1 + h, 0.02) * step(hit.y, 1.9 + h);
    col = mix(col, vec3(0.25, 0.18, 0.12) * (0.7 + h), furn * step(0.35, h));
  } else {
    col = wallpaper * 0.85;
  }
  vec3 lamp = vec3(0.0, floorH - 0.35, roomD * 0.45);
  float dist = length(hit - lamp);
  float fall = 1.0 / (1.0 + dist * dist * 0.22);
  return vec4(col, fall);
}

// Muted merchandise colour (textiles, packaging) from a hash.
vec3 fGoods(float h) {
  vec3 c = 0.5 + 0.5 * cos(6.2832 * (h + vec3(0.0, 0.33, 0.67)));
  return mix(vec3(0.4), c, 0.62) * (0.45 + 0.5 * fract(h * 7.13));
}

// Shop interior behind the glass, interior-mapped: g = point on the glass (x across the unit, y above the shop floor
// line fy), d = view ray in wall space. kind: 0 clothing (rails, mannequins), 1 shelves (grocery, pharmacy, books),
// 2 cafe / restaurant (warm, tables), 3 bright showroom (phones, jewellery). Returns radiance for a unit light level
// in .rgb and the ceiling lamp term in .a.
vec4 fShop(vec2 g, vec3 d, float halfW, float fy, float roomH, float roomD, float kind, float h) {
  float dz = max(-d.z, 0.02);
  float tb = roomD / dz;
  float tx = d.x > 1e-4 ? (halfW + 0.4 - g.x) / d.x : d.x < -1e-4 ? (-halfW - 0.4 - g.x) / d.x : 1e9;
  float ty = d.y > 1e-4 ? (fy + roomH - g.y) / d.y : d.y < -1e-4 ? (fy - g.y) / d.y : 1e9;
  float t = min(tb, min(max(tx, 0.0), max(ty, 0.0)));
  vec3 p = vec3(g + d.xy * t, dz * t);
  float y = p.y - fy;
  vec3 wallCol = kind > 2.5 ? vec3(0.86, 0.86, 0.84) : kind > 1.5 ? mix(vec3(0.45, 0.3, 0.2), vec3(0.62, 0.52, 0.4), h) : mix(vec3(0.78, 0.76, 0.72), vec3(0.6, 0.62, 0.64), h);
  vec3 col = wallCol;
  float lamps = 0.0;
  if (t == ty && d.y > 0.0) {
    // Ceiling: white with rows of light panels / spots.
    col = vec3(0.8);
    vec2 q = vec2(p.x, p.z);
    vec2 cell = fract(q / vec2(1.2, 1.5)) - 0.5;
    lamps = kind > 1.5 && kind < 2.5 ? exp(-dot(cell, cell) * 60.0) * 2.5 : step(abs(cell.x), 0.28) * step(abs(cell.y), 0.08) * 1.6;
  } else if (t == ty) {
    // Floor: polished tiles / wood.
    vec2 tile = floor(vec2(p.x, p.z) / 0.6);
    col = kind > 1.5 && kind < 2.5 ? vec3(0.32, 0.2, 0.12) : vec3(0.55, 0.54, 0.52) * (0.9 + 0.1 * hash12(tile + h * 17.0));
  } else {
    // Walls: the back wall and the side walls carry the merchandise.
    float along = t == tb ? p.x : p.z;
    float side = t == tb ? 1.0 : 0.8;
    if (kind < 0.5) {
      // Clothes on rails (0.9 - 1.9 m), shelves of folded stock above.
      float strip = floor(along / 0.11);
      float onRail = step(0.95, y) * step(y, 1.85 - 0.25 * hash12(vec2(strip, 5.0 + h)));
      col = mix(col, fGoods(hash12(vec2(strip, h * 31.0))), onRail * 0.95);
      float shelf = step(2.1, y) * step(y, 2.9) * step(0.3, fract(y / 0.4));
      col = mix(col, fGoods(hash12(vec2(floor(along / 0.3), floor(y / 0.4) + h * 7.0))), shelf * 0.8);
    } else if (kind < 1.5) {
      // Gondola shelving: boards every 0.42 m with packed products.
      float fy2 = fract(y / 0.42);
      float board = step(fy2, 0.07);
      float item = floor(along / (0.09 + 0.12 * hash12(vec2(floor(y / 0.42), h))));
      vec3 prod = fGoods(hash12(vec2(item, floor(y / 0.42) + h * 13.0)));
      col = mix(prod, vec3(0.75, 0.74, 0.7), board);
      col = mix(wallCol, col, step(0.25, y) * step(y, 2.3));
    } else if (kind < 2.5) {
      // Café: wainscot, framed pictures / menu board, bottles behind the counter.
      col = mix(col, vec3(0.28, 0.17, 0.1), step(y, 1.05));
      float frame = step(1.5, y) * step(y, 2.1) * step(0.55, fract(along / 1.3 + h));
      col = mix(col, fGoods(hash12(vec2(floor(along / 1.3), h))) * 0.7, frame);
    } else {
      // Showroom: white walls, backlit panels.
      float panel = step(1.2, y) * step(y, 2.4) * step(0.3, fract(along / 1.6 + h));
      col = mix(col, vec3(0.95), panel);
      lamps += panel * 0.6;
    }
    col *= side;
  }
  // Display plane 1.1 m behind the glass: mannequins (clothing), tables and chairs (cafés), counters (others).
  float tp = 1.1 / dz;
  if (tp < t) {
    vec2 q = g + d.xy * tp;
    float qy = q.y - fy;
    float slot = floor(q.x / 1.5 + 0.5);
    float cx = q.x - slot * 1.5 - (hash12(vec2(slot, h * 3.0)) - 0.5) * 0.4;
    float here = step(0.35, hash12(vec2(slot, h * 9.0)));
    if (kind < 0.5) {
      float body = step(length(vec2(cx, (qy - 1.62) * 0.8)), 0.1) + step(abs(cx), 0.2 - 0.05 * step(1.1, qy)) * step(0.85, qy) * step(qy, 1.5) + step(abs(abs(cx) - 0.08), 0.045) * step(0.1, qy) * step(qy, 0.9);
      if (min(body, 1.0) * here > 0.5) {
        col = qy > 0.85 && qy < 1.5 ? fGoods(hash12(vec2(slot, h * 5.0))) : vec3(0.85, 0.83, 0.8);
      }
    } else if (kind < 2.5 && kind > 1.5) {
      float table = step(abs(cx), 0.4) * step(abs(qy - 0.74), 0.03) + step(abs(cx), 0.03) * step(qy, 0.74);
      float chair = step(abs(abs(cx) - 0.55), 0.18) * step(abs(qy - 0.46), 0.03) + step(abs(abs(cx) - 0.7), 0.025) * step(qy, 0.95);
      if (min(table + chair, 1.0) * here > 0.5) {
        col = vec3(0.12, 0.08, 0.05);
      }
    } else {
      float counter = step(abs(cx), 0.6) * step(qy, 0.95);
      if (counter * here > 0.5) {
        col = kind > 2.5 ? vec3(0.9) : vec3(0.35, 0.3, 0.26);
      }
    }
  }
  return vec4(col, lamps);
}

// Environment seen in window glass: sky above the horizon, the opposite facades / street below it; per-pane tilt.
vec3 fGlassEnv(vec3 R, float tilt) {
  float day = 1.0 - 0.94 * uNight;
  float ry = R.y + tilt;
  vec3 sky = mix(uFogColor, vec3(0.32, 0.46, 0.72), smoothstep(0.05, 0.7, ry)) * day;
  vec3 street = mix(vec3(0.07, 0.07, 0.075), uFogColor * 0.35, smoothstep(-0.4, 0.05, ry)) * day;
  return mix(street, sky, smoothstep(-0.02, 0.12, ry));
}
`;

/** Facade fragment body, inserted after <color_fragment>; outputs fSurfN, fT, fB, fTN, fFlat, fRough, fEmis, fShadow, fAO. */
export const FACADE_MAIN = /* glsl */ `
vec3 fSurfN = normalize(vFN);
vec3 fT = vec3(1.0, 0.0, 0.0);
vec3 fB = vec3(0.0, 1.0, 0.0);
vec3 fTN = vec3(0.0, 0.0, 1.0);
float fFlat = 0.0;
float fRough = -1.0;
vec3 fEmis = vec3(0.0);
float fShadow = 0.0;
float fAO = 1.0;
{
  vec3 wn = normalize(vFN);
  vec3 wp = vFW;
  float FH = vSty.x;
  float code = floor(vSty.y + 0.5);
  float arch = mod(code, 8.0);
  float wallLayer = mod(floor(code / 8.0), 8.0);
  float plinthLayer = floor(code / 64.0);
  float flags = floor(vSty.z + 0.5);
  float kind = mod(flags, 4.0);
  float street = fBit(flags, ${f(Flag.Street)});
  float pitched = fBit(flags, ${f(Flag.Pitched)});
  float shop = fBit(flags, ${f(Flag.Shop)});
  float shutters = fBit(flags, ${f(Flag.Shutters)});
  float headType = mod(floor(flags / ${f(Flag.HeadShift)}), 4.0);
  float roller = fBit(flags, ${f(Flag.Roller)});
  float court = fBit(flags, ${f(Flag.Court)});
  float office = fBit(flags, ${f(Flag.Office)});
  float plinthOn = fBit(flags, ${f(Flag.Plinth)});
  float balMode = mod(floor(flags / ${f(Flag.BalconyShift)}), 8.0);
  float banded = fBit(flags, ${f(Flag.Banded)});
  float clap = fBit(flags, ${f(Flag.Clapboard)});
  float busy = fBit(flags, ${f(Flag.Busy)});
  float L = vFac.x;
  float wallTopV = vFac.y;
  float seed = vFac.z;
  float wear = vFac.w;
  float u = vFUv.x;
  float v = vFUv.y;
  float lightsOn = smoothstep(0.06, 0.5, uNight);
  float hour = uTimeOfDay < 12.0 ? uTimeOfDay + 24.0 : uTimeOfDay;
  float occupancy = mix(0.5, 0.08, smoothstep(23.0, 26.5, hour));
  bool horiz = abs(wn.y) > 0.5;
  vec3 tint = diffuseColor.rgb;

  if (!horiz) {
    fT = normalize(cross(wn, vec3(0.0, 1.0, 0.0)));
  } else {
    fT = vec3(1.0, 0.0, 0.0);
    fB = vec3(0.0, 0.0, -1.0) * sign(wn.y);
  }
  float mirror = fract(seed * 23.17) < 0.5 ? 1.0 : -1.0;
  vec2 tuv = horiz ? vec2(wp.x, -wp.z) : vec2(u * mirror + seed * 41.0, v + fract(seed * 71.3) * 7.0);
  if (!horiz) {
    fT *= mirror;
  }
  float fwu = max(fwidth(u), 1e-3);
  float fwv = max(fwidth(v), 1e-3);
  float det = 1.0 - smoothstep(0.05, 0.22, max(fwu, fwv));

  // ---- Wall layout (shared with facade.ts / archetypes.ts).
  float nb = max(1.0, vWin.x);
  float halfW = vWin.y;
  float sillH = vWin.z;
  float headH = vWin.w;
  float bw = L / nb;
  float cu = clamp(floor(u / bw), 0.0, nb - 1.0);
  float wu = u - (cu + 0.5) * bw;
  float gHere = mix(vGnd.x, vGnd.y, clamp(u / max(L, 1e-3), 0.0, 1.0));
  float gBay = mix(vGnd.x, vGnd.y, clamp((cu + 0.5) * bw / max(L, 1e-3), 0.0, 1.0));
  float gRow = osmGroundRow(gBay, FH);
  float row = floor(v / FH);
  float wv = v - row * FH;
  float topRow = osmTopRow(wallTopV, vSty.w, headH, FH);
  float sv = v - gHere;
  float shopLine = (gRow + 1.0) * FH;
  float streetFloor = step(v, shopLine) * step(0.0, sv);
  float upper = step(gRow + 0.5, row) * step(row, topRow + 0.5);

  // ---- Base material: texture layer (plinth, almaşık bands, clapboard) and tint.
  float layer = wallLayer;
  bool wall = kind < 0.5 || kind > 1.5 && kind < 2.5;
  if (kind > 2.5) {
    layer = 3.0;
  } else if (wall && plinthOn > 0.5 && v < shopLine - 0.05 && arch != ${f(Arch.Modern)}) {
    layer = plinthLayer;
  } else if (banded > 0.5 && !horiz && fract(v / 1.25) > 0.7) {
    layer = 4.0;
  }
  vec3 tn;
  vec4 tex = fTex(layer, tuv, tn);
  vec3 base = tex.rgb * (layer > 3.5 ? mix(vec3(1.0), tint, 0.25) : tint);
  float rough = tex.a;
  fTN = tn;
  if (layer != wallLayer && layer == plinthLayer) {
    base = tex.rgb * mix(vec3(0.93, 0.9, 0.85), tint, 0.3);
  }
  if (clap > 0.5 && !horiz && layer == wallLayer) {
    float bv = fract(v / 0.19);
    base *= 0.82 + 0.2 * smoothstep(0.0, 0.25, bv) - 0.18 * (1.0 - smoothstep(0.0, 0.06, bv)) * det;
    fTN = normalize(vec3(tn.x * 0.3, (bv - 0.5) * 0.6, 1.0));
    base *= 0.94 + 0.12 * vnoise2(vec2(u * 0.7, floor(v / 0.19)) * 3.0);
  }

  // ---- Weathering.
  float n1 = vnoise2(vec2(u * 0.35 + seed * 13.0, v * 0.3));
  float n2 = vnoise2(vec2(u * 3.1 + seed * 7.0, v * 0.22));
  base *= 0.93 + 0.14 * vnoise2(wp.xz * 0.05 + v * 0.04 + seed * 17.0);
  if (!horiz) {
    // Grime and damp at the foot of the wall.
    base *= mix(0.58, 1.0, smoothstep(0.0, 1.4 + wear, sv + 0.4 * n1));
    float damp = (1.0 - smoothstep(0.3, 1.1, sv - 0.35 * n2)) * wear * step(0.0, sv + 0.3);
    base = mix(base, base * vec3(0.72, 0.72, 0.7), damp);
    // Streaks under the cornice.
    float fromTop = wallTopV - v;
    base *= 1.0 - 0.28 * wear * smoothstep(0.45, 0.8, n2) * exp(-fromTop * 0.35);
    // Flaking paint on tired stucco: small irregular flakes exposing the render, clustered low and under the cornice.
    if ((layer == 0.0 || layer == 1.0) && clap < 0.5 && kind != 1.0) {
      float zone = max(1.0 - smoothstep(0.5, 3.5, sv), smoothstep(3.0, 0.5, fromTop)) * 0.5 + 0.5 * n1;
      float flake = smoothstep(0.73, 0.76, fbm2(vec2(u, v) * 1.6 + seed * 31.0, 4) + 0.25 * (wear - 0.5) + 0.2 * (zone - 0.5));
      vec3 under = mix(vec3(0.55, 0.53, 0.5), base, 0.5) * (0.85 + 0.3 * n2);
      base = mix(base, under, flake * step(0.4, wear) * 0.85);
    }
    if (layer == 2.0) {
      // Soot and black crust on stone, washed clean where rain runs.
      base *= 1.0 - 0.3 * wear * smoothstep(0.4, 0.9, vnoise2(vec2(u * 0.8, v * 0.25) + seed * 5.0));
    }
  } else {
    base *= 0.88 + 0.14 * vnoise2(wp.xz * 0.4) - 0.08 * smoothstep(0.6, 0.85, vnoise2(wp.xz * 1.3 + 3.0));
  }

  vec3 c = base;
  float glassMask = 0.0;

  if (kind > 2.5) {
    // ---- Flat roof slab (vSty.w): bitumen membrane (black or silver-painted), terrace tiles, concrete screed, gravel.
    // Low-contrast weathering only: water stains towards the drains, seams, patches.
    float fin = floor(vSty.w + 0.5);
    vec2 p = wp.xz;
    float grime = vnoise2(p * 0.22 + seed * 9.0);
    float stain = smoothstep(0.45, 0.8, fbm2(p * 0.09 + seed * 5.0, 3));
    if (fin < 0.5) {
      // Membrane rolls 1 m wide with lapped seams; 45 % carry aluminium paint.
      float silver = step(0.55, fract(seed * 4.1));
      vec2 q = vec2(p.x * 0.8 + p.y * 0.6, -p.x * 0.6 + p.y * 0.8) + seed * 20.0;
      float seam = fLine(fract(q.x) - 0.5, 0.485, 0.01);
      vec3 mem = mix(vec3(0.11, 0.105, 0.1), vec3(0.5, 0.51, 0.52), silver);
      c = mem * (0.92 + 0.12 * grime) * (1.0 - 0.18 * seam * det);
      c = mix(c, c * mix(0.75, 0.85, silver), stain * 0.6);
      rough = mix(0.85, 0.55, silver);
    } else if (fin < 1.5) {
      // Terrace tiles: terracotta or beige, 33 cm, grey grout.
      vec2 tp = p / 0.33;
      vec2 cell = floor(tp);
      vec2 fr = fract(tp);
      float grout = 1.0 - fBox(fr.x, 0.04, 0.96, 0.02) * fBox(fr.y, 0.04, 0.96, 0.02);
      vec3 tileA = step(0.5, fract(seed * 7.3)) > 0.5 ? vec3(0.5, 0.3, 0.2) : vec3(0.6, 0.55, 0.47);
      vec3 tile = tileA * (0.9 + 0.12 * hash12(cell + seed));
      c = mix(tile, vec3(0.42, 0.4, 0.37), grout * det * 0.8) * (0.9 + 0.12 * grime);
      c = mix(c, c * 0.8, stain * 0.5);
      rough = 0.7;
    } else if (fin < 2.5) {
      // Concrete screed with shrinkage cracks.
      float crack = fLine(vnoise2(p * 0.5 + seed) - 0.5, 0.012, 0.01) * det;
      c = vec3(0.5, 0.49, 0.47) * (0.88 + 0.16 * grime) * (1.0 - 0.3 * crack);
      c = mix(c, c * 0.78, stain * 0.6);
      rough = 0.9;
    } else {
      float speck = hash12(floor(p * 18.0));
      c = mix(vec3(0.36, 0.35, 0.33), vec3(0.55, 0.53, 0.5), speck) * (0.88 + 0.16 * grime);
      c = mix(c, c * 0.8, stain * 0.5);
      rough = 0.95;
    }
    fFlat = 0.4;
  } else if (kind > 0.5 && kind < 1.5) {
    // ---- Trim: cornices, soffits, parapets, bay slabs. Tops collect dirt, undersides stay in shade.
    if (wn.y > 0.5) c *= 0.72 + 0.2 * n1;
    if (wn.y < -0.5) c *= 0.9;
  } else if (kind > 1.5 && kind < 2.5) {
    // ---- Blank party wall (exposed above a lower neighbour): bare cement render or faded paint, floor slab lines,
    // rain streaks from the top, patched repairs, bitumen stains and brick where the render fell off.
    float bare0 = step(0.45, fract(seed * 6.7));
    c = mix(c, vec3(0.6, 0.58, 0.55) * (0.9 + 0.2 * n1), 0.45 * bare0 + 0.15);
    float slabLine = fBox(fract(v / FH) * FH, 0.0, 0.22, fwv);
    c *= 1.0 - 0.1 * slabLine * det;
    float streak = smoothstep(0.35, 0.85, vnoise2(vec2(u * 2.2 + seed * 9.0, v * 0.06)));
    c *= 1.0 - (0.12 + 0.22 * wear) * streak * exp(-(wallTopV - v) * 0.12);
    vec2 pc = floor(vec2(u / 2.3, v / 1.7));
    float repair = step(0.86, hash12(pc + seed * 13.0));
    c = mix(c, c * vec3(1.12, 1.1, 1.06), repair * 0.8);
    float tar = step(0.94, hash12(pc * 1.7 + seed * 3.0)) * smoothstep(0.5, 0.6, vnoise2(vec2(u, v) * 1.3 + seed));
    c = mix(c, vec3(0.08, 0.08, 0.08), tar * 0.7);
    if (wear > 0.35) {
      vec3 btn;
      vec4 brick = fTex(4.0, tuv, btn);
      float bare = smoothstep(0.76, 0.79, fbm2(vec2(u, v) * 0.45 + seed * 9.0, 3) + 0.15 * (wear - 0.5));
      c = mix(c, brick.rgb * vec3(0.9, 0.8, 0.74), bare);
      fTN = mix(fTN, btn, bare);
    }
  } else {
    // ---- Windowed wall.
    float isLev = step(abs(arch - ${f(Arch.Levantine)}), 0.1);
    float isHan = step(abs(arch - ${f(Arch.Han)}), 0.1);
    float isModern = step(abs(arch - ${f(Arch.Modern)}), 0.1);
    float isWood = step(abs(arch - ${f(Arch.Wood)}), 0.1);
    float isCivic = max(step(abs(arch - ${f(Arch.Civic)}), 0.1), step(abs(arch - ${f(Arch.Mosque)}), 0.1));
    float classical = max(isLev, max(isHan, isCivic));
    float hWin = hash13(vec3(cu, row, seed * 97.0));
    float hWin2 = hash13(vec3(cu + 17.0, row, seed * 13.0));
    float k = row - gRow - 1.0;
    float bal = osmBalconyAt(balMode, cu, nb, k, 99.0) * upper * (1.0 - court);
    float bottom = mix(sillH, 0.04, bal);
    float rise = headType > 2.5 ? halfW : headType > 1.5 ? halfW * 0.38 : 0.0;
    float spring = headH - rise;
    vec3 V = normalize(wp - cameraPosition);
    vec3 Tn = normalize(cross(wn, vec3(0.0, 1.0, 0.0)));
    vec3 d = vec3(dot(V, Tn), V.y, dot(V, wn));
    vec3 Ls = uKeyLightDir;
    vec3 Ld = vec3(dot(Ls, Tn), Ls.y, dot(Ls, wn));
    float depth = F_DEPTH[int(arch + 0.5)];

    // Painted dressings (far LOD; near LOD adds real geometry on top).
    float dress = upper * (1.0 - court) * classical;
    float surround = dress * max(fBox(wu, -halfW - 0.14, halfW + 0.14, fwu) * fBox(wv, bottom - 0.02, headH + 0.14, fwv) - fBox(wu, -halfW, halfW, fwu) * fBox(wv, bottom, headH, fwv), 0.0);
    float capBand = dress * (1.0 - step(1.5, headType)) * fBox(wu, -halfW - 0.24, halfW + 0.24, fwu) * fBox(wv, headH + 0.14, headH + 0.36, fwv);
    float sillBand = upper * (1.0 - bal) * fBox(wu, -halfW - 0.1, halfW + 0.1, fwu) * fBox(wv, bottom - 0.12, bottom, fwv);
    c = mix(c, base * 1.12 + 0.02, (surround + capBand) * 0.8);
    c = mix(c, base * 1.08, sillBand * 0.7);
    c *= 1.0 - 0.3 * dress * fBox(wu, -halfW - 0.24, halfW + 0.24, fwu) * fBox(wv, headH + 0.08, headH + 0.14, fwv) * det;
    // Rain streaks under the sills.
    float under = upper * fBox(wu, -halfW + 0.05, halfW - 0.05, fwu) * step(wv, bottom - 0.12) * exp(-(bottom - 0.12 - wv) * 0.9);
    c *= 1.0 - 0.3 * wear * under * smoothstep(0.35, 0.75, vnoise2(vec2(u * 6.0, v * 0.35)));
    // Levantine rustication, quoins and pilasters.
    if (isLev + isCivic > 0.5) {
      float plinth = streetFloor * plinthOn;
      float groove = fLine(fract(v / 0.42) - 0.5, 0.47, fwv * 2.4 / 0.42) + fLine(fract(u / 1.1 + 0.5 * floor(v / 0.42)) - 0.5, 0.485, fwu * 2.4 / 1.1);
      c *= 1.0 - 0.32 * plinth * clamp(groove, 0.0, 1.0) * det;
      float edgeU = min(u, L - u);
      float quoin = (1.0 - streetFloor) * step(edgeU, mix(0.55, 0.8, step(0.5, fract(v / 0.9)))) * step(1.6, L) * step(fract(seed * 5.7), 0.6) * step(wallLayer, 1.5);
      c = mix(c, base * 1.18 + 0.03, quoin * 0.9);
      c *= 1.0 - 0.25 * quoin * fLine(fract(v / 0.45) - 0.5, 0.47, fwv * 2.0) * det;
    }
    if (isModern > 0.5) {
      // Spandrel panels between ribbon windows.
      float spand = upper * (1.0 - fBox(wv, bottom - 0.05, headH + 0.05, fwv));
      c = mix(c, c * mix(0.85, 1.12, step(0.5, fract(seed * 3.3))), spand * 0.6);
    }
    // Roller-shutter boxes over post-war windows.
    float rbox = roller * upper * fBox(wu, -halfW - 0.03, halfW + 0.03, fwu) * fBox(wv, headH, headH + 0.22, fwv);
    vec3 rollCol = mix(vec3(0.82, 0.8, 0.74), vec3(0.45, 0.33, 0.24), step(0.72, fract(seed * 9.1)));
    c = mix(c, rollCol * 0.9, rbox);

    // ---- Upper-floor openings.
    float usable = upper * step(1.5, L);
    float inWin = usable * fOpen(vec2(wu, wv), halfW, bottom, spring, rise, fwu);
    // ---- Street floor: shops, Han arcades, doors, grilled windows.
    float base0 = gRow * FH;
    float inShop = 0.0;
    float fascia = 0.0;
    float door = 0.0;
    float gWin = 0.0;
    float gHalf = halfW;
    float gBottom = gHere + 0.03 - base0;
    float gTop = FH - 0.95;
    float gSpring = gTop;
    float gRise = 0.0;
    float gSill = max(gHere + 1.35, base0 + sillH) - base0;
    if (streetFloor > 0.5 && court < 0.5) {
      if (shop > 0.5) {
        if (isHan > 0.5) {
          gHalf = bw * 0.5 - 0.42;
          gRise = gHalf;
          gTop = FH - 0.45;
          gSpring = gTop - gRise;
        } else {
          gHalf = bw * 0.5 - 0.22;
          fascia = fBox(wu, -bw * 0.5 + 0.1, bw * 0.5 - 0.1, fwu) * fBox(v, shopLine - 0.9, shopLine - 0.22, fwv);
        }
        inShop = fOpen(vec2(wu, v - base0), gHalf, gBottom, gSpring, gRise, fwu);
      } else if (street > 0.5 || classical > 0.5) {
        float isDoor = step(abs(cu - floor(nb * 0.5)), 0.1) * street;
        door = isDoor * fBox(wu, -0.72, 0.72, fwu) * fBox(sv, -0.2, 2.75, fwv);
        gWin = (1.0 - isDoor) * fOpen(vec2(wu, v - base0), halfW, gSill, spring, rise, fwu) * step(gSill + 0.6, headH);
      }
    }

    // ---- Recess (ray-box) for windows and shop fronts.
    float opening = max(inWin, max(inShop, gWin));
    if (opening > 0.01) {
      vec2 p0;
      float ob;
      float ot;
      float oh;
      float od = depth;
      float isShopHit = step(0.5, inShop);
      if (isShopHit > 0.5) {
        p0 = vec2(wu, v - base0);
        ob = gBottom;
        ot = gTop;
        oh = gHalf;
        od = isHan > 0.5 ? 0.45 : 0.18;
      } else if (gWin > 0.5) {
        p0 = vec2(wu, v - base0);
        ob = gSill;
        ot = headH;
        oh = halfW;
      } else {
        p0 = vec2(wu, wv);
        ob = bottom;
        ot = headH;
        oh = halfW;
      }
      vec4 hit = fRecess(p0, d, oh, ob, ot, od);
      float face = hit.w;
      float dep = hit.z;
      // Key-light shadow: trace from the hit point back out of the opening.
      float lz = max(Ld.z, 1e-3);
      vec2 ex = hit.xy + Ld.xy * (dep / lz);
      float lit = fBox(ex.x, -oh, oh, 0.03) * fBox(ex.y, ob, ot, 0.03);
      fShadow = opening * (1.0 - lit) * step(0.0, Ld.z) * 0.92;
      fAO = mix(1.0, 0.55 + 0.3 * (1.0 - dep / max(od, 1e-3)), opening);
      vec3 revealCol = mix(base, vec3(0.8, 0.78, 0.74), 0.25) * 0.9;
      if (face > 0.5) {
        // Reveals, soffit, sill floor.
        vec3 rn = face < 1.5 ? -sign(d.x) * Tn : face < 2.5 ? vec3(0.0, -1.0, 0.0) : vec3(0.0, 1.0, 0.0);
        fSurfN = normalize(mix(fSurfN, rn, opening));
        c = mix(c, revealCol * (face > 2.5 ? 0.85 : 1.0), opening);
        fFlat = opening;
      } else {
        // Glass plane: frames, curtains, shutters, interior.
        vec2 g = hit.xy;
        fFlat = opening;
        float hA = hash13(vec3(floor(cu / (1.0 + floor(fract(seed * 3.9) * 2.5))), row, seed * 31.0));
        vec3 glass = vec3(0.02, 0.024, 0.028);
        vec3 emis = vec3(0.0);
        float frameW = 0.055;
        float fr;
        if (isShopHit > 0.5) {
          // Shop window: slim mullions, a glass door, interior-mapped shop behind it, rolling shutter (kepenk) when closed.
          float hShop = hash13(vec3(cu, 7.0, seed * 5.0));
          float closedDay = step(hShop, 0.1);
          float closedNight = step(hShop, busy > 0.5 ? 0.2 : 0.7);
          float closed = mix(closedDay, closedNight, smoothstep(0.3, 0.7, uNight));
          float mull = 1.25 + 0.5 * fract(hShop * 13.0);
          fr = max(fLine(g.x - floor(g.x / mull + 0.5) * mull, 0.03, fwu), 1.0 - fBox(g.x, -oh + 0.06, oh - 0.06, fwu));
          fr = max(fr, 1.0 - fBox(g.y, ob + 0.2, ot - 0.06, fwv));
          // Glass door in one unit of three: transom bar, push bar.
          float doorU = step(fract(hShop * 5.3), 0.4) * fBox(g.x, -0.55, 0.55, fwu);
          fr = max(fr, doorU * max(fLine(g.y - (ob + 2.2), 0.035, fwv), fLine(g.y - (ob + 1.05), 0.02, fwv) * fBox(g.x, -0.4, 0.4, fwu)));
          fr = max(fr, doorU * fLine(abs(g.x) - 0.55, 0.03, fwu));
          fr *= det;
          float shopKind = busy > 0.5 && fract(hShop * 3.7) < 0.55 ? 2.0 : floor(fract(hShop * 11.3) * 3.99);
          if (shopKind > 1.5 && shopKind < 2.5 && busy < 0.5) shopKind = 1.0;
          vec4 room = fShop(g, d, oh, ob, 3.3, 6.0, shopKind, fract(hShop * 7.7));
          vec3 shopLight = mix(vec3(1.0, 0.84, 0.64), vec3(0.95, 0.97, 1.0), step(0.55, fract(hShop * 2.9)));
          float level = mix(0.1, 0.38, lightsOn);
          emis = (room.rgb * level + room.a * mix(0.3, 0.8, lightsOn)) * shopLight;
          // Glass: interior plus reflected street and sky (Fresnel), stronger along the street.
          float cosV = abs(d.z);
          float fres = 0.05 + 0.95 * pow(1.0 - cosV, 5.0);
          vec3 R = reflect(V, wn);
          emis = mix(emis, fGlassEnv(R, 0.0), fres * 0.9);
          c = mix(vec3(0.015), vec3(0.08, 0.08, 0.085), fr);
          if (isHan > 0.5) {
            // Iron doors of Han arcades, painted dark green or black.
            float ironClosed = max(closed, step(hShop, 0.3));
            vec3 iron = mix(vec3(0.07, 0.12, 0.09), vec3(0.06), step(0.5, fract(seed * 4.3)));
            float panel = fLine(fract(g.x / 0.6) - 0.5, 0.47, fwu * 2.0) + fLine(fract(g.y / 0.9) - 0.5, 0.47, fwv * 2.0);
            c = mix(c, iron * (1.0 - 0.3 * clamp(panel, 0.0, 1.0) * det), ironClosed);
            emis *= 1.0 - ironClosed;
          } else {
            float ribs = 0.8 + 0.2 * step(0.5, fract(g.y / 0.09));
            vec3 kep = mix(vec3(0.42, 0.43, 0.44), vec3(0.5, 0.47, 0.42), step(0.6, fract(hShop * 17.0))) * ribs * (0.85 + 0.2 * vnoise2(g * 2.0 + seed));
            // Graffiti tags on closed shutters.
            kep = mix(kep, fGoods(hash12(vec2(cu, seed))) * 0.8, step(0.72, vnoise2(g * vec2(1.6, 3.0) + seed * 9.0)) * step(g.y, ob + 1.8) * step(0.5, wear));
            c = mix(c, kep, closed);
            emis *= 1.0 - closed;
          }
          emis *= 1.0 - fr;
          fRough = mix(0.05, 0.6, max(closed, fr));
          glassMask = (1.0 - closed) * (1.0 - fr);
        } else {
          // Window: casement frame, transom, curtains / blinds / roller / shutters.
          float frameDark = step(fract(seed * 3.7), classical > 0.5 ? 0.55 : 0.2);
          vec3 frameCol = isModern > 0.5 ? mix(vec3(0.08), vec3(0.75), step(0.5, fract(seed * 6.1))) : mix(vec3(0.86, 0.85, 0.82), mix(vec3(0.24, 0.15, 0.09), vec3(0.12), isHan), frameDark);
          float transom = oh > 0.4 && classical > 0.5 ? (rise > 0.01 ? spring : headH - 0.55) : 99.0;
          fr = 1.0 - fBox(g.x, -oh + frameW, oh - frameW, fwu) * fBox(g.y, ob + frameW, ot - frameW * 0.5, fwv);
          fr = max(fr, step(0.42, oh) * fLine(g.x, 0.035, fwu));
          fr = max(fr, fLine(g.y - transom, 0.035, fwv) * (1.0 - isModern));
          fr *= det;
          float curtainK = office > 0.5 ? 3.0 : hA < 0.42 ? 1.0 : hA < 0.58 ? 2.0 : hA < 0.7 ? 4.0 : 0.0;
          vec4 room = fRoom(g, d, bw * 0.5, FH, 4.2 + 1.5 * hWin, hWin2);
          // Occupancy: whole flats (1-3 bays) share the switch and the dimmer; offices mostly dark at night. On busy
          // commercial streets the lower upper floors hold cafés, bars and hotels that stay lit.
          float onP = office > 0.5 ? 0.12 : occupancy;
          onP = max(onP, busy * street * (k < 1.5 ? 0.62 : 0.3));
          float litRoom = step(hA, onP) * step(0.18, hWin);
          float flatH = fract(hA * 13.7 + seed * 5.1);
          float tv = step(0.9, flatH) * litRoom;
          vec3 lampCol = flatH < 0.45 ? vec3(1.0, 0.56, 0.26) : flatH < 0.7 ? vec3(1.0, 0.72, 0.46) : vec3(0.84, 0.9, 1.0);
          float flick = 0.75 + 0.25 * sin(uTime * 7.0 + hWin * 40.0) * sin(uTime * 2.3 + hWin2 * 13.0);
          lampCol = mix(lampCol, vec3(0.45, 0.6, 1.0) * flick, tv);
          float lampI = mix(0.3, 2.1, flatH * flatH) * (0.75 + 0.5 * hWin) * mix(1.0, 0.35, tv) * litRoom * lightsOn;
          vec3 interior = room.rgb * (0.035 * (1.0 - uNight) + lampCol * lampI * (0.2 + 1.4 * room.a));
          emis = interior;
          c = glass;
          float cover = 0.0;
          float outer = 0.0;
          if (curtainK > 0.5 && curtainK < 1.5) {
            // Tulle: sheer white with vertical folds.
            float fold = 0.85 + 0.15 * sin(g.x * 38.0 + hWin * 9.0) * det;
            vec3 tulle = vec3(0.62, 0.61, 0.58) * fold;
            cover = 0.78;
            c = mix(c, tulle, cover);
            emis = emis * 0.45 + lampCol * lampI * 0.32 * fold;
          } else if (curtainK < 2.5 && curtainK > 1.5) {
            // Drapes drawn to the sides, sheer in the middle.
            float side = smoothstep(oh * 0.35, oh * 0.5, abs(g.x));
            vec3 drape = mix(vec3(0.45, 0.2, 0.15), vec3(0.55, 0.5, 0.38), hWin2) * (0.8 + 0.2 * sin(g.x * 30.0));
            c = mix(c, drape, side);
            emis *= 1.0 - side * 0.8;
            cover = side;
          } else if (curtainK > 2.5 && curtainK < 3.5) {
            // Office blinds.
            float slat = 0.7 + 0.3 * step(0.5, fract(g.y / 0.07));
            float blindDown = step(hWin, 0.6) * step(g.y, ot - (ot - ob) * hWin2);
            c = mix(c, vec3(0.6, 0.6, 0.58) * slat, blindDown * 0.9);
            emis *= 1.0 - blindDown * 0.6;
            cover = blindDown;
          }
          // Roller shutter: slats lowered from the top by a per-window amount.
          if (roller > 0.5) {
            float amount = hWin2 < 0.3 ? 0.0 : hWin2 < 0.75 ? 0.15 + 0.55 * hWin : hWin2 < 0.92 ? 1.0 : 0.35;
            amount = mix(amount, max(amount, 0.8 * step(0.5, hWin)), uNight * 0.6);
            float rolled = step(ot - (ot - ob) * amount, g.y);
            vec3 slats = rollCol * (0.8 + 0.2 * step(0.5, fract(g.y / 0.05)));
            c = mix(c, slats, rolled);
            emis *= 1.0 - rolled * 0.95;
            fr *= 1.0 - rolled;
            cover = max(cover, rolled);
            outer = rolled;
          }
          // Closed louvred shutters.
          if (shutters > 0.5 && hWin < 0.14) {
            vec3 sc = mix(vec3(0.16, 0.26, 0.19), vec3(0.3, 0.19, 0.11), step(0.5, fract(seed * 5.3)));
            float louv = 0.72 + 0.28 * step(0.45, fract(g.y / 0.07));
            c = sc * louv;
            emis *= 0.05;
            fr = fLine(g.x, 0.02, fwu);
            cover = 1.0;
            outer = 1.0;
          }
          c = mix(c, frameCol, fr);
          emis *= 1.0 - fr;
          // Reflections in the pane (old glass is never quite flat: per-pane tilt).
          float fres = 0.04 + 0.96 * pow(1.0 - abs(d.z), 5.0);
          emis += fGlassEnv(reflect(V, wn), (hWin - 0.5) * 0.16) * fres * (1.0 - fr) * (1.0 - outer);
          glassMask = (1.0 - fr) * (1.0 - cover * 0.8);
          fRough = mix(0.06, 0.7, clamp(fr + cover, 0.0, 1.0));
        }
        fEmis += emis * opening;
        c = mix(base, c, opening);
      }
    }
    // Shop fascia (the near LOD adds a sign box) and a lamp over apartment doors.
    if (fascia > 0.01) {
      vec3 fcol = mix(vec3(0.12, 0.12, 0.13), vec3(0.55, 0.12, 0.1), step(0.6, hash12(vec2(cu, seed * 3.0))));
      c = mix(c, fcol, fascia);
      fEmis += fcol * fascia * lightsOn * 1.2;
    }
    if (door > 0.01) {
      float dx = wu;
      float dy = sv;
      float glassPanel = fBox(dx, -0.5, 0.5, fwu) * fBox(dy, 0.9, 2.1, fwv);
      float bars = fLine(fract(dx / 0.14) - 0.5, 0.42, fwu * 2.0 / 0.14) * glassPanel * det;
      vec3 doorCol = mix(vec3(0.2, 0.13, 0.08), vec3(0.09, 0.09, 0.1), step(0.5, fract(seed * 8.3)));
      vec3 dc = mix(doorCol, vec3(0.03), glassPanel * (1.0 - bars));
      c = mix(c, dc * (0.9 + 0.1 * n1), door);
      fFlat = max(fFlat, door);
      fShadow = max(fShadow, door * 0.4);
      float lampSpot = exp(-length(vec2(dx, dy - 2.95)) * 3.0);
      fEmis += vec3(1.0, 0.7, 0.4) * lampSpot * lightsOn * 1.5 * street;
      fEmis += vec3(1.0, 0.75, 0.45) * 0.4 * lightsOn * glassPanel * (1.0 - bars) * door * step(0.5, hash12(vec2(seed, 3.0)));
    }
    // Iron grilles over street-floor windows.
    if (gWin > 0.01) {
      float grille = max(fLine(fract(wu / 0.12) - 0.5, 0.42, fwu * 2.0 / 0.12), fLine(fract(sv / 0.9) - 0.5, 0.46, fwv * 2.0 / 0.9)) * det;
      c = mix(c, vec3(0.04), grille * gWin);
      fShadow = max(fShadow, grille * gWin * 0.5);
    }
    // Far field: once a bay spans only a few pixels, windows converge to their average (glass fraction, lit or dark
    // per window) instead of shimmering.
    float farMix = smoothstep(0.22, 0.6, max(fwu / bw, fwv / FH)) * upper * step(1.5, L);
    if (farMix > 0.001) {
      float wf = clamp((2.0 * halfW) * (headH - bottom) / (bw * FH), 0.05, 0.6);
      float hCell = hash13(vec3(floor(cu / (1.0 + floor(fract(seed * 3.9) * 2.5))), row, seed * 31.0));
      float cellLit = step(hCell, max(office > 0.5 ? 0.12 : occupancy, busy * street * (k < 1.5 ? 0.62 : 0.3)));
      float cellH = fract(hCell * 13.7 + seed * 5.1);
      vec3 cellCol = cellH < 0.45 ? vec3(1.0, 0.56, 0.26) : cellH < 0.7 ? vec3(1.0, 0.72, 0.46) : vec3(0.84, 0.9, 1.0);
      vec3 farC = mix(base, vec3(0.045, 0.05, 0.055), wf * 0.85);
      vec3 farE = cellCol * mix(0.35, 2.2, cellH * cellH) * wf * cellLit * lightsOn;
      c = mix(c, farC, farMix);
      fEmis = mix(fEmis, farE, farMix);
      fShadow *= 1.0 - farMix;
    }
  }
  if (!horiz && kind < 1.5) {
    // Night: street lamps wash the foot of street walls, lit shop windows spill onto the floor above them.
    float lampWash = street * exp(-max(sv, 0.0) / 5.0) * 0.08;
    float spill = shop * (1.0 - court) * step(shopLine, v) * exp(-(v - shopLine) / mix(2.6, 4.5, busy)) * mix(0.12, 0.42, busy);
    fEmis += base * vec3(1.0, 0.8, 0.55) * (lampWash + spill) * lightsOn;
  }
  diffuseColor.rgb = c;
  if (fRough < 0.0) fRough = rough;
  fTN.xy *= mix(0.6, 1.0, det);
}
`;

/** After <lights_fragment_end>: recess shadows and ambient occlusion. */
export const FACADE_LIGHT = /* glsl */ `
reflectedLight.directDiffuse *= 1.0 - fShadow;
reflectedLight.directSpecular *= 1.0 - fShadow;
reflectedLight.indirectDiffuse *= fAO;
reflectedLight.indirectSpecular *= mix(fAO, 1.0, 0.5);
`;

/** After <normal_fragment_maps>: visible-surface normal (reveals) and the texture array normal. */
export const FACADE_NORMAL = /* glsl */ `
{
  vec3 nv = normalize((viewMatrix * vec4(fSurfN, 0.0)).xyz);
  vec3 tv = normalize((viewMatrix * vec4(fT, 0.0)).xyz);
  vec3 bv = normalize((viewMatrix * vec4(fB, 0.0)).xyz);
  vec3 tn = fTN;
  tn.xy *= 0.8 * (1.0 - fFlat);
  normal = normalize(mat3(tv, bv, nv) * normalize(tn));
}
`;

export { Head, Kind };
