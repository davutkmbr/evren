/**
 * Procedural surface library for the opaque structure material (patched MeshStandardMaterial).
 * All patterns work in meters (vUvM) and world space so they stay coherent from 2 m to 20 km: every thin line is
 * filtered analytically against its pixel footprint `fw` and bump detail fades out once it would alias.
 */
import { Emit, Surf } from '../../build/surfaces';

const defines = (prefix: string, table: Record<string, number>): string =>
  Object.entries(table)
    .map(([k, v]) => `#define ${prefix}_${k.toUpperCase()} ${v}`)
    .join('\n');

export const SURFACE_DEFINES = `${defines('SURF', Surf)}\n${defines('EMIT', Emit)}\n`;

export const SURFACE_GLSL = /* glsl */ `
${SURFACE_DEFINES}

/* Thin line of half width w (m) at distance d (m), filtered by the pixel footprint fw: returns coverage 0..1
   whose integral is preserved when the line becomes sub-pixel. */
float structLine(float d, float w, float fw) {
  float cov = 1.0 - smoothstep(w, w + fw * 1.2, d);
  return cov * min(1.0, w / max(fw * 0.6, 1e-4)) ;
}

vec3 structCellular(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(i + g) * 0.75 + 0.125;
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash12(i + g);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec3(sqrt(d2) - sqrt(d1), id, sqrt(d1));
}

/* Painted structural steel: bolted/welded panel seams every 'seam' m along v, rain streaks, paint breakup. */
void structSteel(inout vec3 albedo, inout float rough, inout float h, vec2 uv, vec3 wp, float seam, float fw) {
  float n = vnoise2(wp.xz * 0.06 + vec2(wp.y * 0.045, 0.0)) * 0.6 + vnoise2(uv * vec2(0.8, 0.3)) * 0.4;
  albedo *= 0.9 + 0.17 * n;
  if (seam > 0.0) {
    float fy = fract(uv.y / seam + 0.5) - 0.5;
    float d = abs(fy) * seam;
    float line = structLine(d, 0.012, fw);
    h -= line * 0.003;
    albedo *= 1.0 - 0.22 * line;
    // dirt washed down from every horizontal seam
    float below = fract(uv.y / seam);
    float wash = (1.0 - smoothstep(0.0, 0.35, 1.0 - below)) * smoothstep(0.45, 0.9, vnoise2(vec2(uv.x * 1.7, floor(uv.y / seam) * 5.3)));
    albedo *= 1.0 - 0.10 * wash;
  }
  float streak = smoothstep(0.58, 0.95, vnoise2(vec2(uv.x * 2.6, uv.y * 0.05 + wp.x * 0.01)));
  albedo *= 1.0 - 0.09 * streak;
  rough = clamp(rough + (n - 0.5) * 0.14 + streak * 0.08, 0.08, 1.0);
}

/* Cast-in-place concrete: formwork lifts (param m), panel joints, tie holes, streaks, tidal splash zone. */
void structConcrete(inout vec3 albedo, inout float rough, inout float h, vec2 uv, vec3 wp, float lift, float fw) {
  float big = fbm2(wp.xz * 0.018 + vec2(wp.y * 0.021, wp.y * 0.013), 3);
  float fine = vnoise2(uv * 3.3) * 0.5 + vnoise2(uv * 11.0) * 0.5;
  albedo *= 0.8 + 0.3 * big + 0.1 * (fine - 0.5);
  float L = lift > 0.0 ? lift : 3.0;
  float row = floor(uv.y / L);
  float dLift = abs(fract(uv.y / L + 0.5) - 0.5) * L;
  float lineL = structLine(dLift, 0.008, fw);
  float P = 2.4;
  float dPan = abs(fract((uv.x + hash11(row + 3.0) * 1.3) / P + 0.5) - 0.5) * P;
  float lineP = structLine(dPan, 0.005, fw) * 0.55;
  vec2 tie = abs(fract(vec2((uv.x + hash11(row) * 1.3) / 0.6, uv.y / (L / 4.0))) - 0.5) * vec2(0.6, L / 4.0);
  float tieHole = structLine(length(tie), 0.012, fw) * 0.5;
  float lines = max(max(lineL, lineP), tieHole);
  albedo *= 1.0 - 0.22 * lines;
  h -= lines * 0.003;
  float streak = smoothstep(0.62, 1.0, vnoise2(vec2(uv.x * 2.1, uv.y * 0.07 + row * 3.1))) * (0.4 + 0.6 * big);
  albedo *= 1.0 - 0.16 * streak;
  float wet = 1.0 - smoothstep(0.2, 2.4 + 0.6 * big, wp.y);
  albedo = mix(albedo, albedo * vec3(0.36, 0.42, 0.34), wet * step(-40.0, wp.y));
  rough = clamp(rough - wet * 0.4 + (fine - 0.5) * 0.1 + streak * 0.05, 0.15, 1.0);
}

/* Dressed ashlar: courses of height 'course', staggered joints, per-stone tone, recessed mortar, soot. */
void structAshlar(inout vec3 albedo, inout float rough, inout float h, vec2 uv, vec3 wp, float course, float fw) {
  float C = course > 0.0 ? course : 0.45;
  float row = floor(uv.y / C);
  float len = C * (1.7 + 1.3 * hash11(row * 7.13 + 0.5));
  float x = uv.x + hash11(row * 3.71) * len;
  float col = floor(x / len);
  vec2 f = vec2(fract(x / len) * len, fract(uv.y / C) * C);
  float edge = min(min(f.x, len - f.x), min(f.y, C - f.y));
  float joint = structLine(edge, 0.01, fw);
  float id = hash12(vec2(col, row));
  float tone = 0.86 + 0.24 * id;
  vec3 stone = albedo * tone * (0.93 + 0.14 * vnoise2(uv * 5.0 + id * 17.0));
  stone *= mix(vec3(1.0), vec3(1.04, 0.99, 0.93), hash11(id * 31.0));
  float fade = 1.0 - smoothstep(0.02, 0.08, fw);
  h += (smoothstep(0.0, 0.05, edge) * 0.01 + vnoise2(uv * 14.0) * 0.002) * fade;
  albedo = mix(stone, albedo * 0.72 + 0.03, joint);
  float grime = fbm2(wp.xz * 0.11 + uv * vec2(0.25, 0.04), 3);
  float soot = smoothstep(0.45, 0.85, vnoise2(vec2(uv.x * 0.9, uv.y * 0.04)));
  albedo *= (0.82 + 0.24 * grime) * (1.0 - 0.18 * soot);
  rough = clamp(0.74 + 0.16 * id + 0.08 * soot, 0.0, 1.0);
}

/* Coursed rubble (Galata): irregular stones of ~'size' m in wavy courses, deep mortar joints. */
void structRubble(inout vec3 albedo, inout float rough, inout float h, vec2 uv, vec3 wp, float size, float fw) {
  float S = size > 0.0 ? size : 0.42;
  vec3 c = structCellular(uv / vec2(S * 1.7, S));
  float edge = c.x * S * 0.8;
  float joint = structLine(edge, 0.018, fw);
  float id = c.y;
  vec3 tint = mix(vec3(1.0, 0.97, 0.9), vec3(0.93, 0.96, 1.02), hash11(id * 13.0));
  tint *= mix(vec3(1.0), vec3(1.06, 0.98, 0.86), step(0.82, hash11(id * 71.0)));
  vec3 stone = albedo * tint * (0.78 + 0.34 * id) * (0.9 + 0.2 * vnoise2(uv * 6.0 + id * 9.0));
  float fade = 1.0 - smoothstep(0.02, 0.1, fw);
  h += (smoothstep(0.0, 0.12, edge) * 0.03 + vnoise2(uv * 9.0) * 0.004) * fade;
  albedo = mix(stone, albedo * 0.66 + 0.04, joint);
  float grime = fbm2(wp.xz * 0.09 + uv * vec2(0.2, 0.03), 3);
  albedo *= 0.8 + 0.26 * grime;
  rough = clamp(0.82 + 0.12 * id, 0.0, 1.0);
}

/* Asphalt carriageway: lanes per direction 'lanes', median half width 'mHalf'; uv.x = lateral offset. */
void structRoad(inout vec3 albedo, inout float rough, inout float h, vec2 uv, vec3 wp, float lanes, float mHalf, float fw) {
  float agg = vnoise2(uv * 7.0) * 0.5 + vnoise2(uv * 27.0) * 0.5;
  float patchN = fbm2(uv * vec2(0.06, 0.013) + wp.xz * 0.001, 3);
  albedo = vec3(0.062, 0.062, 0.064) * (0.78 + 0.44 * patchN) * (0.9 + 0.2 * agg);
  float laneW = 3.65;
  float ax = abs(uv.x);
  float inner = mHalf + 0.6;
  float k = (ax - inner) / laneW;
  float line = 0.0;
  if (lanes > 0.5) {
    line = max(line, structLine(abs(ax - (inner - 0.25)), 0.075, fw));
    float outer = inner + lanes * laneW + 0.25;
    line = max(line, structLine(abs(ax - outer), 0.075, fw));
    float kr = floor(k + 0.5);
    if (kr >= 1.0 && kr <= lanes - 1.0) {
      float dash = step(fract(uv.y / 12.0 + (uv.x > 0.0 ? 0.0 : 0.5)), 0.334);
      line = max(line, structLine(abs(ax - (inner + kr * laneW)), 0.075, fw) * dash);
    }
    float lp = fract(k) * laneW;
    float inLane = step(0.0, k) * step(k, lanes);
    float wheel = exp(-pow((lp - 0.95) / 0.38, 2.0)) + exp(-pow((lp - 2.7) / 0.38, 2.0));
    albedo *= 1.0 - 0.2 * wheel * inLane;
    rough = 0.9 - 0.14 * wheel * inLane;
  } else {
    rough = 0.88;
  }
  float wornLine = 0.75 + 0.25 * vnoise2(uv * vec2(3.0, 0.4));
  albedo = mix(albedo, vec3(0.6, 0.6, 0.58) * wornLine, line);
  rough = mix(rough, 0.6, line);
}

/* Lead / zinc roofing with standing seams along v (u across the slope). */
void structLead(inout vec3 albedo, inout float rough, inout float metal, inout float h, vec2 uv, vec3 wp, float pitch, float fw) {
  float P = pitch > 0.0 ? pitch : 0.55;
  float seam = abs(fract(uv.x / P + 0.5) - 0.5) * P;
  float s = structLine(seam, 0.012, fw);
  h += s * 0.015 * (1.0 - smoothstep(0.02, 0.08, fw));
  float pat = fbm2(uv * vec2(0.7, 0.25) + wp.xz * 0.05, 3);
  albedo *= 0.82 + 0.34 * pat;
  albedo = mix(albedo, vec3(0.5, 0.52, 0.53), smoothstep(0.55, 0.85, pat) * 0.4);
  albedo *= 1.0 - 0.15 * s;
  rough = 0.42 + 0.22 * pat;
  metal = 0.25;
}

void structPlain(inout vec3 albedo, inout float rough, inout float h, vec2 uv, vec3 wp, float fw) {
  float n = fbm2(wp.xz * 0.08 + vec2(wp.y * 0.07, 0.0), 3);
  float streak = smoothstep(0.6, 0.95, vnoise2(vec2(uv.x * 2.0, uv.y * 0.06)));
  albedo *= (0.9 + 0.18 * n) * (1.0 - 0.1 * streak);
  rough = clamp(rough + (n - 0.5) * 0.12, 0.05, 1.0);
}

/* Slab track: concrete with rails; param = spacing of the two track centres (0 = single track at u = 0). */
void structRail(inout vec3 albedo, inout float rough, inout float metal, inout float h, vec2 uv, vec3 wp, float spacing, float fw) {
  structConcrete(albedo, rough, h, uv, wp, 6.0, fw);
  albedo *= 0.75;
  float x = spacing > 0.0 ? abs(abs(uv.x) - spacing * 0.5) : abs(uv.x);
  float rail = structLine(abs(x - 0.7175), 0.036, fw);
  float sleeper = structLine(abs(fract(uv.y / 0.65 + 0.5) - 0.5) * 0.65, 0.12, fw) * step(x, 1.3);
  albedo = mix(albedo, albedo * 0.7, sleeper);
  albedo = mix(albedo, vec3(0.55, 0.53, 0.5), rail);
  rough = mix(rough, 0.25, rail);
  metal = mix(0.0, 0.9, rail);
  h += rail * 0.03;
}

/* Square pavers / walkway plates. */
void structPaving(inout vec3 albedo, inout float rough, inout float h, vec2 uv, vec3 wp, float size, float fw) {
  float S = size > 0.0 ? size : 0.4;
  vec2 g = fract(uv / S + 0.5) - 0.5;
  vec2 id = floor(uv / S + 0.5);
  float edge = (0.5 - max(abs(g.x), abs(g.y))) * S;
  float joint = structLine(edge, 0.006, fw);
  albedo *= (0.88 + 0.2 * hash12(id)) * (1.0 - 0.3 * joint);
  h -= joint * 0.002;
  rough = 0.8;
}

/* Floodlight / LED / window emission (radiance added to totalEmissiveRadiance). */
vec3 structEmission(vec3 albedo, vec2 uv, vec3 wp, vec3 nW, vec4 e, float lanes, float mHalf) {
  float on = structLightsOn();
  if (on <= 0.0 || e.x < 0.5) return vec3(0.0);
  float mode = e.x;
  if (mode < float(EMIT_FLOOD) + 0.5) {
    float reach = max(e.w, 1.0);
    float hgt = uv.y;
    float fall = smoothstep(reach * 1.08, reach * 0.3, hgt) * (0.55 + 0.45 * smoothstep(0.0, reach * 0.1, hgt));
    float side = 0.3 + 0.7 * clamp(1.0 - abs(nW.y), 0.0, 1.0);
    return albedo * structKelvin(e.z) * e.y * fall * side * on;
  }
  if (mode < float(EMIT_LED) + 0.5) {
    return albedo * structLed(e.y, e.z, uv.y / 170.0) * e.w * on;
  }
  if (mode < float(EMIT_WINDOWS) + 0.5) {
    vec3 cell = floor(wp * vec3(0.45, 0.3, 0.45));
    float lit = step(hash13(cell + e.z * 17.0), e.w);
    vec3 c = mix(vec3(1.0, 0.6, 0.28), vec3(1.0, 0.82, 0.58), hash13(cell * 1.7));
    return c * e.y * lit * on;
  }
  if (mode < float(EMIT_ROADLAMPS) + 0.5) {
    float spacing = max(e.y, 1.0);
    float lampH = 11.0;
    float xl = mHalf + 0.6 + lanes * 3.65 + 0.9;
    float along = uv.y - e.z;
    float dv = (fract(along / spacing + 0.5) - 0.5) * spacing;
    float dvOpp = (fract(along / spacing) - 0.5) * spacing;
    float ax = abs(uv.x);
    float dNear = ax - xl;
    float dFar = ax + xl;
    float i1 = lampH / pow(dv * dv + dNear * dNear + lampH * lampH, 1.5);
    float i2 = lampH / pow(dvOpp * dvOpp + dNear * dNear + lampH * lampH, 1.5);
    float i3 = lampH / pow(dv * dv + dFar * dFar + lampH * lampH, 1.5) * 0.5;
    float irr = (i1 + i2 * 0.6 + i3) * lampH * lampH;
    return albedo * vec3(1.0, 0.8, 0.58) * e.w * irr * on;
  }
  if (mode < float(EMIT_GLOW) + 0.5) {
    return albedo * e.y * on;
  }
  return vec3(0.0);
}

/* Normal perturbation from a procedural height field (screen-space derivatives, as three's perturbNormalArb). */
vec3 structBump(vec3 surfPos, vec3 surfNorm, float h, float faceDir) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;
