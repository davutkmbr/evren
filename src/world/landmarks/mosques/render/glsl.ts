/**
 * GLSL for the mosque uber-material (patched MeshStandardMaterial). One program renders every surface of every mosque:
 * the per-vertex material id selects a procedural texture (ashlar coursing, lead sheets, glazing, brick...), the light
 * profile id selects the night floodlight model. SHARED_GLSL (noise, uNight, uTime...) is available in the fragment.
 */

export const MQ_VERTEX_PARS = /* glsl */ `
attribute vec4 aTint;
attribute vec4 aData;
varying vec3 vMqWorld;
varying vec4 vMqTint;
varying vec2 vMqUv;
varying vec2 vMqLight;
flat varying float vMqMat;
flat varying float vMqLightType;
flat varying float vMqSeed;
flat varying float vMqExtra;
`;

export const MQ_VERTEX_MAIN = /* glsl */ `
{
  mat4 mqModel = modelMatrix;
  #ifdef USE_BATCHING
    mqModel = modelMatrix * batchingMatrix;
  #endif
  #ifdef USE_INSTANCING
    mqModel = mqModel * instanceMatrix;
  #endif
  vMqWorld = (mqModel * vec4(transformed, 1.0)).xyz;
  vec3 mqOrigin = mqModel[3].xyz;
  vMqSeed = fract(sin(dot(floor(mqOrigin.xz * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
  vMqTint = aTint;
  vMqUv = uv;
  float mqCode = aData.z;
  float mqType = floor(mqCode / 4096.0 + 0.0001);
  vMqMat = aData.x;
  vMqLightType = mqType;
  vMqLight = vec2(aData.y * 0.1, (mqCode - mqType * 4096.0) * 0.1);
  vMqExtra = aData.w;
}
`;

export const MQ_FRAGMENT_PARS = /* glsl */ `
varying vec3 vMqWorld;
varying vec4 vMqTint;
varying vec2 vMqUv;
varying vec2 vMqLight;
flat varying float vMqMat;
flat varying float vMqLightType;
flat varying float vMqSeed;
flat varying float vMqExtra;

uniform float uMqFlood;
uniform float uMqWindowGlow;

struct MqSurf {
  vec3 albedo;
  float rough;
  float metal;
  float height;
  vec3 emit;
  float ao;
};

vec3 mqLin(vec3 c) { return c * c * (c * 0.305 + 0.683) + c * 0.012; }

/* Coverage of a line of half-width w at distance d, filtered by the pixel footprint fw. */
float mqLine(float d, float w, float fw) {
  float cov = 1.0 - smoothstep(w - fw, w + fw, d);
  return cov * clamp(w * 3.0 / max(fw, 1e-5), 0.0, 1.0);
}

/* Running-bond ashlar. Returns joint coverage; block id in blockId, bevel distance in edgeD. */
float mqAshlar(vec2 p, float courseH, float minW, float varW, float jw, float seed, out vec2 blockId, out float edgeD) {
  float row = floor(p.y / courseH);
  float rh = hash11(row * 7.131 + seed * 31.7);
  float bw = minW + rh * varW;
  float xx = p.x + rh * bw * 3.1;
  float col = floor(xx / bw);
  float fx = fract(xx / bw) * bw;
  float fy = fract(p.y / courseH) * courseH;
  float dx = min(fx, bw - fx);
  float dy = min(fy, courseH - fy);
  edgeD = min(dx, dy);
  blockId = vec2(col, row);
  float fw = max(fwidth(p.x), fwidth(p.y));
  return mqLine(edgeD, jw, fw);
}

MqSurf mqStone(vec2 p, vec3 tint, float h, bool fine, bool weather) {
  MqSurf s;
  vec2 bid; float ed;
  float course = fine ? 0.46 : 0.54;
  float joint = mqAshlar(p, course, fine ? 0.7 : 0.85, fine ? 0.5 : 0.75, fine ? 0.005 : 0.008, vMqSeed, bid, ed);
  float bh = hash12(bid + vMqSeed * 17.0);
  float bh2 = hash12(bid.yx * 1.37 + 3.1);
  vec3 wp = vMqWorld;
  float macro = fbm2(wp.xz * 0.045 + wp.y * vec2(0.021, 0.034), 3);
  float mid = vnoise2(p * vec2(1.7, 2.3) + bh * 9.0);
  float grain = vnoise2(p * 9.0 + bh * 5.0);
  // Kufeki limestone: blocks range from cream to cool grey; a few much paler replacement blocks from restorations.
  vec3 warmTone = tint * vec3(1.04, 1.0, 0.92);
  vec3 coolTone = tint * vec3(0.95, 0.97, 1.0);
  vec3 c = mix(coolTone, warmTone, bh2) * (0.9 + 0.16 * bh) * (0.88 + 0.22 * macro) * (0.95 + 0.08 * mid) * (0.97 + 0.05 * grain);
  c = mix(c, tint * 1.1, step(0.965, bh) * 0.6);
  if (weather) {
    float streak = vnoise2(vec2(p.x * 2.3 + vMqSeed * 11.0, p.y * 0.09));
    float streak2 = vnoise2(vec2(p.x * 7.1, p.y * 0.35 + 5.0));
    float dark = smoothstep(0.52, 0.95, streak) * 0.24 + smoothstep(0.6, 1.0, streak2) * 0.09;
    c *= 1.0 - dark;
    float grime = fbm2(wp.xz * 0.11 + vec2(wp.y * 0.07, 0.0), 3);
    float low = 1.0 - smoothstep(0.0, 7.0 + 4.0 * grime, h);
    c *= mix(vec3(1.0), vec3(0.8, 0.78, 0.74), low * (0.35 + 0.4 * grime));
    float damp = 1.0 - smoothstep(0.0, 1.6 + 1.2 * streak2, h);
    c *= mix(vec3(1.0), vec3(0.64, 0.62, 0.57), damp * 0.55);
    float soot = smoothstep(0.55, 0.85, fbm2(wp.xz * 0.03 + wp.yy * 0.05 + 7.0, 3));
    c *= 1.0 - soot * 0.16;
  }
  c = mix(c, c * vec3(0.62, 0.6, 0.56), joint * 0.85);
  s.albedo = c;
  s.rough = 0.78 + 0.12 * mid + 0.06 * grain - joint * 0.05;
  s.metal = 0.0;
  float bevel = smoothstep(0.0, 0.035, ed);
  s.height = bevel * 0.004 + (grain - 0.5) * 0.0022 - joint * 0.004 + (bh - 0.5) * 0.002;
  s.emit = vec3(0.0);
  s.ao = 1.0;
  return s;
}

MqSurf mqLead(vec2 p) {
  MqSurf s;
  float su = p.x;
  float sheet = floor(su);
  float lapLen = 1.9;
  float lapOff = hash11(sheet * 3.7 + vMqSeed * 5.0);
  float lapT = p.y / lapLen + lapOff;
  float lapRow = floor(lapT);
  float fwu = fwidth(su);
  float sd = abs(fract(su + 0.5) - 0.5);
  float seam = mqLine(sd, 0.035, fwu);
  float lapF = fract(lapT);
  float fwv = fwidth(lapT);
  float lapEdge = mqLine(min(lapF, 1.0 - lapF), 0.012, fwv);
  float var = hash12(vec2(sheet, lapRow) + vMqSeed * 13.0);
  vec3 wp = vMqWorld;
  float patina = fbm2(wp.xz * 0.18 + wp.y * 0.11, 3);
  float streak = vnoise2(vec2(su * 1.3, p.y * 0.12 + vMqSeed * 7.0));
  float streakFine = vnoise2(vec2(su * 5.1 + 3.0, p.y * 0.35));
  // Weathered lead: dull blue-grey patina, paler carbonate wash streaks, darker fresh sheets here and there.
  vec3 base = vec3(0.15, 0.158, 0.172);
  vec3 c = base * (0.82 + 0.3 * var) * (0.86 + 0.28 * patina);
  c = mix(c, vec3(0.3, 0.31, 0.315), smoothstep(0.6, 0.95, streak) * 0.35 + smoothstep(0.7, 1.0, streakFine) * 0.12);
  c = mix(c, c * 0.75, lapEdge * 0.6);
  c = mix(c, c * 1.22, seam * 0.6);
  s.albedo = c;
  s.metal = 0.06;
  s.rough = 0.5 + 0.18 * patina + 0.1 * var - seam * 0.06;
  s.height = seam * 0.02 * (1.0 - smoothstep(0.02, 0.035, sd)) + lapF * 0.003;
  s.emit = vec3(0.0);
  s.ao = 1.0;
  return s;
}

MqSurf mqGlass(vec2 p, vec3 tintRaw) {
  MqSurf s;
  float seed = tintRaw.r;
  float kind = tintRaw.g;
  vec2 fw = fwidth(p);
  float frame = 0.0;
  vec3 frameCol = vec3(0.025, 0.024, 0.022);
  if (kind < 0.33) {
    float bx = abs(fract(p.x / 0.15 + 0.5) - 0.5) * 0.15;
    float by = abs(fract(p.y / 0.5 + 0.5) - 0.5) * 0.5;
    frame = max(mqLine(bx, 0.012, fw.x), mqLine(by, 0.012, fw.y));
  } else if (kind < 0.6 || kind > 0.85) {
    vec2 q = p / 0.2;
    vec2 cell = fract(q) - 0.5;
    float d = length(cell) * 0.2;
    frame = 1.0 - mqLine(d, 0.068, max(fw.x, fw.y));
    frameCol = vec3(0.07, 0.068, 0.062);
  } else {
    float bx = abs(fract(p.x / 0.45 + 0.5) - 0.5) * 0.45;
    float by = abs(fract(p.y / 0.6 + 0.5) - 0.5) * 0.6;
    frame = max(mqLine(bx, 0.025, fw.x), mqLine(by, 0.025, fw.y));
    frameCol = vec3(0.5, 0.48, 0.44);
  }
  s.albedo = mix(vec3(0.012, 0.014, 0.016), frameCol, frame);
  s.rough = mix(0.06, 0.55, frame);
  s.metal = 0.0;
  s.height = -frame * 0.004;
  float lit = step(0.12, fract(seed * 7.31));
  float inten = (2.6 + 4.0 * fract(seed * 13.7)) * lit;
  vec3 warm = vec3(1.0, 0.6, 0.28);
  if (kind > 0.85) {
    vec2 cell = floor(p / 0.2);
    float hc = hash12(cell + seed * 19.0);
    warm = hc < 0.33 ? vec3(1.0, 0.35, 0.18) : hc < 0.6 ? vec3(0.3, 0.55, 1.0) : hc < 0.8 ? vec3(0.4, 0.9, 0.45) : vec3(1.0, 0.8, 0.4);
  }
  float lampsOn = smoothstep(0.18, 0.6, uNight);
  s.emit = warm * inten * (1.0 - frame * 0.85) * uMqWindowGlow * lampsOn;
  s.ao = 1.0;
  return s;
}

MqSurf mqMarble(vec2 p, vec3 tint) {
  MqSurf s;
  vec3 wp = vMqWorld;
  float n = fbm2(p * 0.9 + wp.xz * 0.05, 4);
  float vein = 1.0 - smoothstep(0.0, 0.035, abs(sin((p.x * 0.8 + p.y * 1.3 + n * 6.0) * 2.1)));
  vec3 c = tint * (0.93 + 0.1 * n);
  c = mix(c, c * vec3(0.72, 0.73, 0.76), vein * 0.5 * clamp(0.06 / max(fwidth(p.x), 1e-4), 0.0, 1.0));
  s.albedo = c;
  s.rough = 0.32 + 0.12 * n;
  s.metal = 0.0;
  s.height = (n - 0.5) * 0.001;
  s.emit = vec3(0.0);
  s.ao = 1.0;
  return s;
}

MqSurf mqBrick(vec2 p, float mortarRatio) {
  MqSurf s;
  float course = 0.075 + 0.075 * mortarRatio;
  float row = floor(p.y / course);
  float off = mod(row, 2.0) * 0.17;
  float bw = 0.34;
  float col = floor((p.x + off) / bw);
  float fy = fract(p.y / course) * course;
  float fx = fract((p.x + off) / bw) * bw;
  float mortarY = course - 0.075;
  vec2 fw = fwidth(p);
  float m = max(mqLine(fy, mortarY * 0.5, fw.y), mqLine(min(fx, bw - fx), 0.012, fw.x));
  float h = hash12(vec2(col, row) + vMqSeed);
  vec3 brick = mix(vec3(0.3, 0.095, 0.05), vec3(0.46, 0.2, 0.1), h) * (0.85 + 0.3 * vnoise2(p * 3.0));
  vec3 mortar = vec3(0.5, 0.46, 0.39);
  s.albedo = mix(brick, mortar, m);
  s.rough = mix(0.82, 0.92, m);
  s.metal = 0.0;
  s.height = -m * 0.008 + (h - 0.5) * 0.002;
  s.emit = vec3(0.0);
  s.ao = 1.0;
  return s;
}

MqSurf mqPlaster(vec2 p, vec3 tint, float h) {
  MqSurf s;
  vec3 wp = vMqWorld;
  float n = fbm2(wp.xz * 0.12 + wp.y * vec2(0.09, 0.13), 4);
  float n2 = vnoise2(p * 0.6 + 3.0);
  float streak = vnoise2(vec2(p.x * 1.1, p.y * 0.07 + vMqSeed * 9.0));
  vec3 c = tint * (0.86 + 0.24 * n) * (0.95 + 0.08 * n2);
  c *= 1.0 - smoothstep(0.55, 0.95, streak) * 0.18;
  float damp = 1.0 - smoothstep(0.0, 2.8, h);
  c *= mix(1.0, 0.72, damp);
  s.albedo = c;
  s.rough = 0.88;
  s.metal = 0.0;
  s.height = (vnoise2(p * 6.0) - 0.5) * 0.002;
  s.emit = vec3(0.0);
  s.ao = 1.0;
  return s;
}

MqSurf mqPaving(vec2 p) {
  MqSurf s;
  vec2 bid; float ed;
  float joint = mqAshlar(p, 0.9, 0.9, 0.7, 0.006, vMqSeed + 3.0, bid, ed);
  float h = hash12(bid);
  float dirt = fbm2(vMqWorld.xz * 0.25, 3);
  vec3 c = vec3(0.5, 0.49, 0.46) * (0.85 + 0.25 * h) * (0.8 + 0.3 * dirt);
  c = mix(c, c * 0.6, joint);
  s.albedo = c;
  s.rough = 0.72 + 0.15 * dirt;
  s.metal = 0.0;
  s.height = -joint * 0.004;
  s.emit = vec3(0.0);
  s.ao = 1.0;
  return s;
}

MqSurf mqTile(vec2 p) {
  MqSurf s;
  float ridge = abs(sin(3.14159 * p.x / 0.22));
  float row = floor(p.y / 0.32);
  float fr = fract(p.y / 0.32);
  float h = hash12(vec2(floor(p.x / 0.22), row) + vMqSeed);
  vec3 c = mix(vec3(0.34, 0.11, 0.055), vec3(0.5, 0.2, 0.1), h) * (0.75 + 0.35 * ridge);
  float moss = smoothstep(0.55, 0.9, fbm2(vMqWorld.xz * 0.3, 3));
  c = mix(c, vec3(0.12, 0.12, 0.08), moss * 0.35);
  s.albedo = c;
  s.rough = 0.72;
  s.metal = 0.0;
  s.height = ridge * 0.03 + fr * 0.01;
  s.emit = vec3(0.0);
  s.ao = 1.0;
  return s;
}

MqSurf mqCarved(vec2 p, vec3 tint, float h) {
  MqSurf s = mqStone(p, tint, h, true, false);
  vec2 q = p * 3.2;
  float g = abs(fract(q.x + q.y) - 0.5) + abs(fract(q.x - q.y) - 0.5);
  float star = smoothstep(0.35, 0.5, g);
  float fw = fwidth(g);
  float groove = 1.0 - smoothstep(0.42 - fw, 0.46 + fw, g);
  s.albedo *= mix(0.72, 1.0, star);
  s.height = s.height * 0.3 + star * 0.012 * clamp(0.3 / max(fwidth(q.x), 1e-4), 0.0, 1.0);
  s.ao = mix(0.75, 1.0, star) + groove * 0.0;
  return s;
}

MqSurf mqBanded(vec2 p, vec3 tint, float h) {
  float band = fract(p.y / 1.25);
  if (band < 0.52) {
    return mqBrick(vec2(p.x, band * 1.25), 0.55);
  }
  return mqStone(vec2(p.x, p.y), tint, h, false, true);
}

/* Night floodlighting irradiance factor for the light profile. */
float mqFlood(float type, float h, float dBelow, vec2 uv) {
  if (type < 0.5) return 0.0;
  if (type < 1.5) {
    float spot = 0.5 + 0.5 * cos(6.2831853 * uv.x / 7.0);
    float cone = mix(spot * spot, 1.0, smoothstep(1.5, 12.0, h));
    return 1.7 * exp(-h / 12.0) * cone + 0.1;
  }
  if (type < 2.5) return 0.6 * exp(-h / 7.0) + 0.22;
  if (type < 3.5) return 1.25 * exp(-dBelow / 4.5) + 0.8 * exp(-h / 16.0) + 0.1;
  if (type < 4.5) return 0.0;
  if (type < 5.5) return 1.1 * exp(-h / 3.2) + 0.12;
  if (type < 6.5) return 0.8;
  return 0.3;
}

vec3 mqPerturb(vec3 pos, vec3 n, float hgt) {
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

MqSurf mqSurface() {
  float mat = floor(vMqMat + 0.5);
  vec3 tint = mqLin(vMqTint.rgb);
  float h = vMqLight.x;
  vec2 p = vMqUv;
  MqSurf s;
  if (mat < 0.5) s = mqStone(p, tint, h, false, true);
  else if (mat < 1.5) s = mqStone(p, tint, h, true, true);
  else if (mat < 2.5) s = mqCarved(p, tint, h);
  else if (mat < 3.5) s = mqLead(p);
  else if (mat < 4.5) s = mqGlass(p, vMqTint.rgb);
  else if (mat < 5.5) {
    s.albedo = vec3(1.0, 0.74, 0.32) * (0.88 + 0.12 * vnoise2(p * 4.0));
    s.rough = 0.24; s.metal = 1.0; s.height = 0.0; s.emit = vec3(0.0); s.ao = 1.0;
  }
  else if (mat < 6.5) s = mqPlaster(p, tint, h);
  else if (mat < 7.5) s = mqBrick(p, 0.35);
  else if (mat < 8.5) s = mqMarble(p, tint);
  else if (mat < 9.5) s = mqPaving(p);
  else if (mat < 10.5) {
    s.albedo = vec3(0.8, 0.78, 0.72); s.rough = 0.35; s.metal = 0.0; s.height = 0.0; s.ao = 1.0;
    float bulbs = pow(0.5 + 0.5 * cos(6.2831853 * p.x / 0.42), 6.0);
    s.emit = vec3(1.0, 0.72, 0.42) * (0.25 + bulbs) * 24.0 * smoothstep(0.18, 0.6, uNight) * uMqFlood;
  }
  else if (mat < 11.5) {
    float grain = vnoise2(vec2(p.x * 40.0, p.y * 2.0));
    s.albedo = tint * tint * (0.7 + 0.3 * grain) * 0.6; s.rough = 0.6; s.metal = 0.0;
    s.height = grain * 0.001; s.emit = vec3(0.0); s.ao = 1.0;
  }
  else if (mat < 12.5) s = mqTile(p);
  else s = mqBanded(p, tint, h);
  s.ao *= vMqTint.a;
  float lampsOn = smoothstep(0.18, 0.6, uNight) * uMqFlood;
  if (lampsOn > 0.0 && mat != 4.0 && mat != 10.0) {
    float fl = mqFlood(vMqLightType, h, vMqLight.y, p);
    s.emit += s.albedo * vec3(1.0, 0.69, 0.4) * fl * lampsOn * 2.2;
  }
  return s;
}
`;

/** Replaces the diffuse/roughness/metalness/normal/emissive/AO stages of meshphysical.glsl. */
export const MQ_FRAGMENT_REPLACEMENTS: [string, string][] = [
  [
    '#include <color_fragment>',
    `#include <color_fragment>
  MqSurf mqS = mqSurface();
  diffuseColor.rgb = mqS.albedo;`,
  ],
  [
    '#include <metalnessmap_fragment>',
    `#include <metalnessmap_fragment>
  roughnessFactor = clamp(mqS.rough, 0.04, 1.0);
  metalnessFactor = mqS.metal;`,
  ],
  [
    '#include <normal_fragment_maps>',
    `#include <normal_fragment_maps>
  normal = mqPerturb(-vViewPosition, normal, mqS.height);`,
  ],
  [
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
  totalEmissiveRadiance = mqS.emit;`,
  ],
  [
    '#include <aomap_fragment>',
    `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= mqS.ao;
  reflectedLight.indirectSpecular *= mqS.ao;
  reflectedLight.directDiffuse *= mix(1.0, mqS.ao, 0.4);`,
  ],
];
