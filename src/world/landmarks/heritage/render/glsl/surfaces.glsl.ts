/**
 * Procedural surface library of the heritage material. Every function works in metres (p = uv: u along the surface,
 * v up / down-slope) and fades its high-frequency detail with the pixel footprint `fw` so distant walls converge to
 * their mean colour instead of shimmering. SHARED_GLSL (hash12, vnoise2, fbm2, uNight...) is available.
 */
export const SURFACES_GLSL = /* glsl */ `
struct HS {
  vec3 albedo;
  float rough;
  float metal;
  float height;
  vec3 emit;
  float ao;
  float cut;
};

HS hsInit(vec3 albedo, float rough) {
  HS s;
  s.albedo = albedo;
  s.rough = rough;
  s.metal = 0.0;
  s.height = 0.0;
  s.emit = vec3(0.0);
  s.ao = 1.0;
  s.cut = 0.0;
  return s;
}

/* 1 on periodic lines of the given width (period and width in the same units), antialiased with fw. */
float hGrid(float x, float period, float width, float fw) {
  float d = abs(fract(x / period + 0.5) - 0.5) * period;
  return 1.0 - smoothstep(width * 0.5 - fw, width * 0.5 + fw, d);
}

/* Detail visibility: 1 when a feature of size \`scale\` spans several pixels, 0 when it is sub-pixel. */
float hDetail(float fw, float scale) {
  return 1.0 - smoothstep(0.18, 0.55, fw / scale);
}

vec3 hSat(vec3 c, float k) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return max(mix(vec3(l), c, k), 0.0);
}

/* Weathering shared by the masonry surfaces: rising damp, run-off streaks, mottling, biological growth. */
vec3 hWeather(vec3 alb, vec2 p, vec3 wp, float hag, float w, float vert) {
  float nz = vnoise2(p * vec2(0.7, 0.9) + wp.xz * 0.01);
  float damp = 1.0 - smoothstep(0.1, 0.7 + 1.1 * nz, hag);
  alb *= 1.0 - 0.3 * damp * (0.4 + w) * vert;
  float st = vnoise2(vec2(p.x * 1.9, p.y * 0.07)) * vnoise2(vec2(p.x * 0.43 + 7.1, p.y * 0.21));
  alb *= 1.0 - vert * w * 0.42 * smoothstep(0.18, 0.62, st);
  alb *= 0.88 + 0.24 * fbm2(wp.xz * 0.035 + vec2(p.y * 0.05, wp.y * 0.02), 3);
  float moss = smoothstep(0.55, 0.95, w) * smoothstep(0.52, 0.78, fbm2(p * 0.35 + wp.xz * 0.02, 3));
  alb = mix(alb, vec3(0.055, 0.065, 0.035), moss * 0.55);
  return alb;
}

HS hPlaster(vec2 p, vec3 wp, vec3 tint, float w, float hag, float vert, float fw) {
  float n = fbm2(p * 0.9, 3);
  HS s = hsInit(tint * (0.9 + 0.16 * n), 0.88);
  float stain = smoothstep(0.55, 0.75, fbm2(p * 0.18 + 3.0, 3));
  s.albedo *= 1.0 - 0.1 * stain * w;
  s.albedo = hWeather(s.albedo, p, wp, hag, w * 0.8, vert);
  s.height = (vnoise2(p * 7.0) - 0.5) * 0.002 * hDetail(fw, 0.1);
  return s;
}

HS hAshlar(vec2 p, vec3 wp, vec3 tint, float w, float hag, float vert, float fw) {
  float ch = 0.46;
  float row = floor(p.y / ch);
  float rh = hash11(row * 1.31 + 0.7);
  float bl = mix(0.75, 1.25, rh);
  float x = p.x + rh * 3.7;
  float col = floor(x / bl);
  float bh = hash12(vec2(col, row));
  float det = hDetail(fw, 0.4);
  float joint = max(hGrid(p.y, ch, 0.014, fw), hGrid(x, bl, 0.014, fw)) * det;
  vec3 stone = tint * (0.84 + 0.3 * bh) * mix(vec3(1.0), vec3(1.04, 1.0, 0.94), hash11(bh * 17.0));
  stone *= 0.93 + 0.12 * vnoise2(p * 3.0 + bh * 11.0);
  HS s = hsInit(mix(stone, tint * 0.72, joint), mix(0.72, 0.9, hash11(bh * 5.0)));
  s.albedo = mix(tint * (0.95 + 0.04 * bh), s.albedo, det);
  s.albedo = hWeather(s.albedo, p, wp, hag, w, vert);
  float fx = fract(x / bl) * bl;
  float fy = fract(p.y / ch) * ch;
  float edge = min(min(fx, bl - fx), min(fy, ch - fy));
  s.height = (smoothstep(0.0, 0.05, edge) * 0.006 + (vnoise2(p * 9.0) - 0.5) * 0.0025) * det;
  s.ao = 1.0 - joint * 0.35;
  return s;
}

/* Theodosian walls: five courses of limestone blocks, then a band of five brick courses in thick pink mortar. */
HS hByzantine(vec2 p, vec3 wp, vec3 tint, float w, float hag, float vert, float fw) {
  float period = 2.05;
  float band = mod(p.y + 0.35, period);
  float det = hDetail(fw, 0.3);
  vec3 mortar = vec3(0.56, 0.44, 0.37);
  HS s;
  if (band < 1.4) {
    float ch = 0.28;
    float row = floor((p.y + 0.35) / ch);
    float rh = hash11(row * 2.13);
    float bl = mix(0.42, 0.75, rh);
    float x = p.x + rh * 5.3;
    float col = floor(x / bl);
    float bh = hash12(vec2(col, row) + 0.37);
    float joint = max(hGrid(p.y + 0.35, ch, 0.03, fw), hGrid(x, bl, 0.03, fw)) * det;
    vec3 stone = tint * (0.78 + 0.38 * bh) * mix(vec3(1.0), vec3(0.95, 0.97, 1.02), hash11(bh * 9.0));
    s = hsInit(mix(stone, mortar * 0.8, joint), 0.86);
    float fx = fract(x / bl) * bl;
    float fy = fract((p.y + 0.35) / ch) * ch;
    float edge = min(min(fx, bl - fx), min(fy, ch - fy));
    s.height = (smoothstep(0.0, 0.06, edge) * 0.012 + (vnoise2(p * 6.0 + bh) - 0.5) * 0.008) * det;
    s.ao = 1.0 - joint * 0.4;
  } else {
    float by = band - 1.4;
    float ch = 0.13;
    float row = floor(by / ch);
    float fy = by - row * ch;
    float brickH = 0.048;
    float x = p.x + hash11(row + floor(p.y / period) * 7.0) * 1.3;
    float col = floor(x / 0.36);
    float bh = hash12(vec2(col, row + floor(p.y / period) * 13.0));
    float inBrick = smoothstep(ch * 0.5 - brickH * 0.5 - fw, ch * 0.5 - brickH * 0.5 + fw, fy) * (1.0 - smoothstep(ch * 0.5 + brickH * 0.5 - fw, ch * 0.5 + brickH * 0.5 + fw, fy));
    inBrick *= 1.0 - hGrid(x, 0.36, 0.025, fw);
    vec3 brick = vec3(0.42, 0.17, 0.1) * (0.7 + 0.55 * bh);
    vec3 bandMean = mix(mortar, vec3(0.42, 0.19, 0.11), 0.4);
    s = hsInit(mix(bandMean, mix(mortar, brick, inBrick), det), 0.9);
    s.height = (inBrick * 0.008 - 0.004) * det;
    s.ao = 0.85 + 0.15 * inBrick;
  }
  s.albedo = hWeather(s.albedo, p, wp, hag, w, vert);
  return s;
}

/* Irregular rubble masonry (Rumeli / Anadolu Hisarı): Voronoi stones in lime mortar with occasional brick. */
HS hRubble(vec2 p, vec3 wp, vec3 tint, float w, float hag, float vert, float fw) {
  vec2 q = p * vec2(1.9, 2.8);
  vec2 ip = floor(q);
  vec2 fp = fract(q);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(ip + g) * 0.8 + 0.1;
      vec2 r = g + o - fp;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = ip + g;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  float edge = sqrt(d2) - sqrt(d1);
  float det = hDetail(fw, 0.3);
  float h = hash12(id);
  vec3 stone = tint * (0.7 + 0.55 * h);
  stone = mix(stone, vec3(0.43, 0.3, 0.22), step(0.9, hash12(id + 3.1)) * 0.7);
  stone = mix(stone, stone * vec3(1.05, 1.0, 0.9), hash12(id + 7.7));
  float mortarMask = (1.0 - smoothstep(0.06, 0.16, edge)) * det;
  vec3 mortar = vec3(0.6, 0.57, 0.5);
  HS s = hsInit(mix(tint * 0.95, mix(stone, mortar, mortarMask), det), 0.92);
  s.height = (smoothstep(0.0, 0.3, edge) * 0.03 + (vnoise2(p * 5.0 + h * 9.0) - 0.5) * 0.01) * det;
  s.ao = 1.0 - mortarMask * 0.45;
  s.albedo = hWeather(s.albedo, p, wp, hag, w, vert);
  return s;
}

HS hMarble(vec2 p, vec3 wp, vec3 tint, float w, float hag, float vert, float fw) {
  float det = hDetail(fw, 0.5);
  float warp = fbm2(p * 0.35 + wp.xz * 0.01, 4);
  float vein = abs(sin(p.x * 0.8 + p.y * 0.55 + warp * 7.0));
  float veins = (1.0 - smoothstep(0.0, 0.05, vein)) * det;
  vec2 slab = vec2(1.6, 0.8);
  float row = floor(p.y / slab.y);
  float x = p.x + hash11(row) * slab.x;
  float joint = max(hGrid(p.y, slab.y, 0.006, fw), hGrid(x, slab.x, 0.006, fw)) * det;
  float sh = hash12(vec2(floor(x / slab.x), row));
  vec3 alb = tint * (0.95 + 0.07 * sh) * (1.0 - 0.25 * veins);
  alb = mix(alb, alb * 0.75, joint);
  HS s = hsInit(alb, mix(0.28, 0.42, sh));
  s.albedo = hWeather(s.albedo, p, wp, hag, w * 0.7, vert);
  s.height = -joint * 0.002;
  return s;
}

HS hBrick(vec2 p, vec3 wp, vec3 tint, float w, float hag, float vert, float fw) {
  float ch = 0.085;
  float row = floor(p.y / ch);
  float x = p.x + mod(row, 2.0) * 0.17;
  float col = floor(x / 0.34);
  float bh = hash12(vec2(col, row));
  float det = hDetail(fw, 0.08);
  float joint = max(hGrid(p.y, ch, 0.03, fw), hGrid(x, 0.34, 0.025, fw)) * det;
  vec3 brick = tint * (0.72 + 0.5 * bh) * mix(vec3(1.0), vec3(1.1, 0.9, 0.8), hash11(bh * 3.3));
  vec3 mortar = vec3(0.55, 0.47, 0.4);
  HS s = hsInit(mix(mix(tint * 0.95 + mortar * 0.15, brick, det), mortar, joint), 0.85);
  s.height = (1.0 - joint) * 0.005 * det;
  s.ao = 1.0 - joint * 0.3;
  s.albedo = hWeather(s.albedo, p, wp, hag, w, vert);
  return s;
}

/* Lead sheets: strips along v (down the slope / dome meridians), rolled seams, overlaps, white carbonate patina. */
HS hLead(vec2 p, vec3 wp, vec3 tint, float w, float fw) {
  float det = hDetail(fw, 0.5);
  float strip = 0.62;
  float sx = p.x / strip;
  float sid = floor(sx);
  float fx = fract(sx) - 0.5;
  float seam = (1.0 - smoothstep(0.0, 0.07, abs(abs(fx) - 0.5))) * det;
  float lap = hGrid(p.y + hash11(sid) * 1.3, 2.1, 0.03, fw) * det;
  float patina = smoothstep(0.35, 0.8, fbm2(vec2(p.x * 0.6, p.y * 0.25) + wp.xz * 0.02, 4));
  float streak = vnoise2(vec2(p.x * 3.0, p.y * 0.12));
  vec3 alb = tint * (0.92 + 0.12 * hash11(sid * 1.7));
  alb = mix(alb, vec3(0.6, 0.61, 0.6), patina * 0.45);
  alb = mix(alb, alb * 0.72, smoothstep(0.55, 0.9, streak) * 0.6 * w);
  HS s = hsInit(alb, mix(0.48, 0.66, patina));
  s.metal = mix(0.45, 0.12, patina);
  s.height = (seam * 0.02 + lap * 0.004) * det;
  s.ao = 1.0 - lap * 0.2;
  return s;
}

HS hSlate(vec2 p, vec3 tint, float fw) {
  float det = hDetail(fw, 0.15);
  float ch = 0.24;
  float row = floor(p.y / ch);
  float x = p.x + mod(row, 2.0) * 0.11;
  float col = floor(x / 0.22);
  float h = hash12(vec2(col, row));
  float fy = fract(p.y / ch);
  float gap = hGrid(x, 0.22, 0.012, fw) * det;
  vec3 alb = tint * (0.75 + 0.5 * h) * mix(vec3(1.0), vec3(0.92, 0.97, 1.08), hash11(h * 7.0));
  HS s = hsInit(mix(tint, alb, det) * (1.0 - gap * 0.6), mix(0.38, 0.55, h));
  s.height = (fy * 0.01 - gap * 0.004) * det;
  s.ao = mix(0.75, 1.0, fy);
  return s;
}

/* Ottoman canal tiles (alaturka kiremit): ribbed rows with overlaps, varied fired colours, lichen. */
HS hTile(vec2 p, vec3 wp, vec3 tint, float w, float fw) {
  float det = hDetail(fw, 0.2);
  float rowL = 0.34;
  float row = floor(p.y / rowL);
  float x = p.x + mod(row, 2.0) * 0.105;
  float col = floor(x / 0.21);
  float h = hash12(vec2(col, row));
  float fx = fract(x / 0.21);
  float fy = fract(p.y / rowL);
  float rib = sin(fx * 3.14159);
  vec3 alb = tint * (0.72 + 0.5 * h) * mix(vec3(1.0), vec3(1.15, 0.9, 0.75), hash11(h * 5.0));
  float lichen = smoothstep(0.62, 0.85, fbm2(p * 0.5 + wp.xz * 0.05, 3)) * w;
  alb = mix(alb, vec3(0.3, 0.28, 0.2), lichen * 0.6);
  HS s = hsInit(mix(tint * 0.95, alb, det), 0.8);
  s.height = (rib * 0.03 + fy * 0.012) * det;
  s.ao = mix(0.72, 1.0, rib) * mix(0.8, 1.0, fy);
  return s;
}

HS hGranite(vec2 p, vec3 tint, float glyphs, float fw) {
  float det = hDetail(fw, 0.02);
  float n1 = vnoise2(p * 38.0);
  float n2 = vnoise2(p * 91.0 + 3.0);
  vec3 alb = tint * (0.85 + 0.3 * n1);
  alb = mix(alb, vec3(0.08, 0.07, 0.07), smoothstep(0.72, 0.9, n2) * det);
  alb = mix(alb, vec3(0.75, 0.7, 0.66), smoothstep(0.8, 0.95, n1) * 0.5 * det);
  HS s = hsInit(alb, 0.42);
  if (glyphs > 0.5) {
    // Hieroglyph column down the centre of each face: cells of engraved strokes.
    float cx = fract(p.x / 1.0);
    float inCol = step(0.2, cx) * step(cx, 0.8);
    vec2 cell = vec2(floor(p.x / 0.2), floor(p.y / 0.32));
    vec2 f = vec2(fract(p.x / 0.2), fract(p.y / 0.32));
    float h = hash12(cell);
    float stroke = 0.0;
    stroke = max(stroke, step(0.5, h) * (1.0 - smoothstep(0.05, 0.09, abs(f.y - 0.5))) * step(0.2, f.x) * step(f.x, 0.8));
    stroke = max(stroke, step(0.3, fract(h * 7.0)) * (1.0 - smoothstep(0.05, 0.09, abs(f.x - 0.5))) * step(0.15, f.y) * step(f.y, 0.85));
    stroke = max(stroke, step(0.6, fract(h * 13.0)) * (1.0 - smoothstep(0.02, 0.06, abs(length(f - 0.5) - 0.25))));
    float g = stroke * inCol * hDetail(fw, 0.08);
    s.albedo *= 1.0 - 0.45 * g;
    s.height = -g * 0.008;
  }
  return s;
}

HS hBronze(vec2 p, vec3 tint, float fw) {
  float n = fbm2(p * 2.5, 3);
  vec3 alb = mix(vec3(0.12, 0.08, 0.05), tint * 1.2, smoothstep(0.35, 0.7, n));
  HS s = hsInit(alb, 0.55);
  s.metal = 0.55;
  return s;
}

HS hWood(vec2 p, vec3 tint, float fw) {
  float det = hDetail(fw, 0.12);
  float plank = floor(p.x / 0.18);
  float h = hash11(plank);
  float grain = vnoise2(vec2(p.x * 30.0, p.y * 1.5 + h * 9.0));
  vec3 alb = tint * (0.8 + 0.35 * h) * (0.9 + 0.2 * grain * det);
  float gap = hGrid(p.x, 0.18, 0.01, fw) * det;
  HS s = hsInit(alb * (1.0 - gap * 0.6), 0.72);
  s.height = -gap * 0.003;
  return s;
}

HS hEarth(vec2 p, vec3 wp, vec3 tint, float fw) {
  float n = fbm2(wp.xz * 0.12, 4);
  float n2 = vnoise2(wp.xz * 1.7);
  vec3 grass = vec3(0.07, 0.085, 0.035) * (0.8 + 0.5 * n2);
  vec3 soil = tint * (0.8 + 0.4 * n2);
  vec3 alb = mix(soil, grass, smoothstep(0.35, 0.6, n));
  HS s = hsInit(alb, 0.95);
  s.height = (n2 - 0.5) * 0.02 * hDetail(fw, 0.3);
  return s;
}

HS hPaving(vec2 p, vec3 tint, float fw) {
  float det = hDetail(fw, 0.3);
  float row = floor(p.y / 0.45);
  float x = p.x + hash11(row) * 0.6;
  float col = floor(x / 0.7);
  float h = hash12(vec2(col, row));
  float joint = max(hGrid(p.y, 0.45, 0.012, fw), hGrid(x, 0.7, 0.012, fw)) * det;
  vec3 alb = tint * (0.8 + 0.35 * h);
  HS s = hsInit(mix(tint, alb, det) * (1.0 - joint * 0.4), 0.8);
  s.height = -joint * 0.004;
  return s;
}

HS hStucco(vec2 p, vec3 tint, float fw) {
  float det = hDetail(fw, 0.08);
  float m = sin(p.y * 28.0) * 0.5 + 0.5;
  float m2 = sin(p.y * 9.0 + 1.0) * 0.5 + 0.5;
  HS s = hsInit(tint * (0.92 + 0.06 * m2) * (0.95 + 0.08 * vnoise2(p * 3.0)), 0.6);
  s.height = (m * 0.006 + m2 * 0.012) * det;
  s.ao = mix(0.75, 1.0, m2);
  return s;
}

HS hBanded(vec2 p, vec3 wp, vec3 tint, float w, float hag, float vert, float fw) {
  HS s = hAshlar(p, wp, tint, w, hag, vert, fw);
  float band = step(0.5, fract(p.y / 0.92));
  s.albedo *= mix(vec3(1.0), vec3(0.72, 0.62, 0.55), band * hDetail(fw, 0.6));
  return s;
}

/* Marble balustrade band (v = 0 at the foot): plinth, vase balusters, handrail. Returns cut > 0.5 for gaps. */
HS hBalustrade(vec2 p, vec3 tint, float fw) {
  float det = hDetail(fw, 0.12);
  HS s = hsInit(tint * (0.95 + 0.05 * vnoise2(p * 4.0)), 0.5);
  float v = p.y;
  if (v > 0.16 && v < 0.84) {
    float lx = (fract(p.x / 0.3) - 0.5) * 0.3;
    float t = (v - 0.16) / 0.68;
    float r = 0.045 + 0.05 * sin(t * 3.14159) * (0.6 + 0.4 * sin(t * 6.28 + 1.2)) + 0.025 * smoothstep(0.85, 1.0, t);
    float inside = 1.0 - smoothstep(r - fw, r + fw, abs(lx));
    s.cut = (1.0 - inside) * det;
    s.albedo = mix(s.albedo, s.albedo * 0.2, (1.0 - inside) * (1.0 - det) * 0.6);
    s.height = inside * 0.01 * det;
  } else {
    s.height = 0.004;
  }
  return s;
}

/* Iron railing: bars every 12 cm, top and bottom rails; cut > 0.5 for gaps. */
HS hRailing(vec2 p, vec3 tint, float fw) {
  float det = hDetail(fw, 0.05);
  HS s = hsInit(tint, 0.5);
  s.metal = 0.4;
  float v = p.y;
  float rail = step(v, 0.08) + step(0.95, v) + (1.0 - smoothstep(0.02, 0.03, abs(v - 0.55)));
  float bar = hGrid(p.x, 0.12, 0.022, fw);
  float solid = clamp(rail + bar, 0.0, 1.0);
  s.cut = (1.0 - solid) * det;
  s.albedo = mix(tint, tint * 0.6, (1.0 - solid) * (1.0 - det));
  return s;
}

HS hClock(vec2 p, float fw) {
  vec2 c = p - 0.5;
  float r = length(c);
  HS s = hsInit(vec3(0.06, 0.06, 0.07), 0.4);
  float dial = 1.0 - smoothstep(0.43 - fw, 0.43 + fw, r);
  float ring = (1.0 - smoothstep(0.012, 0.02, abs(r - 0.4))) * dial;
  float a = atan(c.x, c.y);
  float tick = step(0.34, r) * step(r, 0.39) * (1.0 - smoothstep(0.02, 0.05, abs(fract(a / 6.2831853 * 12.0 + 0.5) - 0.5)));
  float hrs = mod(uTimeOfDay, 12.0);
  float ah = hrs / 12.0 * 6.2831853;
  float am = fract(uTimeOfDay) * 6.2831853;
  vec2 dh = vec2(sin(ah), cos(ah));
  vec2 dm = vec2(sin(am), cos(am));
  float hand = 0.0;
  float th = dot(c, dh);
  hand = max(hand, step(0.0, th) * step(th, 0.22) * (1.0 - smoothstep(0.01, 0.02, abs(dot(c, vec2(dh.y, -dh.x))))));
  float tm = dot(c, dm);
  hand = max(hand, step(0.0, tm) * step(tm, 0.33) * (1.0 - smoothstep(0.006, 0.014, abs(dot(c, vec2(dm.y, -dm.x))))));
  float ink = max(max(ring, tick), hand);
  s.albedo = mix(s.albedo, mix(vec3(0.85, 0.83, 0.78), vec3(0.03), ink), dial);
  s.rough = mix(0.4, 0.2, dial);
  float on = smoothstep(0.05, 0.45, uNight);
  s.emit = vec3(1.0, 0.86, 0.62) * 3.5 * dial * (1.0 - ink) * on;
  return s;
}
`;
