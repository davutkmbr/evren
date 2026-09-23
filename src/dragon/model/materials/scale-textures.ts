import * as THREE from 'three';
import type { TextureBaker } from './texture-baker';

/**
 * Procedural scale maps for the dragon skin, baked on the GPU.
 *
 * Texture space: u runs once around the body (0 = dorsal midline, 0.5 = belly midline), v runs along the body and
 * tiles (the loft maps v conformally: one tile = one local circumference). Three scale layers are blended by u:
 * large keeled dorsal osteoderm plates, overlapping shingled flank scales and broad transverse belly scutes.
 */

const HASH = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoiseP(vec2 p, vec2 period) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, period));
  float b = hash12(mod(i + vec2(1.0, 0.0), period));
  float c = hash12(mod(i + vec2(0.0, 1.0), period));
  float d = hash12(mod(i + vec2(1.0, 1.0), period));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/* Tileable fbm over the unit square (period in cells at the base octave). */
float fbmP(vec2 uv, vec2 period, int oct) {
  float s = 0.0, a = 0.5;
  vec2 p = uv * period;
  vec2 per = period;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * vnoiseP(p, per);
    p *= 2.0; per *= 2.0; a *= 0.5;
  }
  return s;
}
`;

const FIELD = /* glsl */ `
precision highp float;
varying vec2 vUv;
${HASH}

const float NU_F = 116.0;
const float NV_F = 150.0;
const float NU_D = 40.0;
const float NV_D = 44.0;
const float NU_B = 26.0;
const float NV_B = 34.0;

/*
 * Jittered Voronoi scales (tileable: cell ids wrap by the grid period). Returns height and cell id.
 * edge = F2 - F1 (0 on borders) gives rounded pebble domes; the tail-ward (+v) half of each scale is lifted
 * so scales read as overlapping shingles.
 */
void voronoiScales(vec2 uv, vec2 period, float jitter, float lift, float roundness, float seed, out float h, out float id) {
  vec2 g = uv * period;
  vec2 cell = floor(g);
  float f1 = 9.0, f2 = 9.0;
  vec2 c1 = vec2(0.0);
  vec2 id1 = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 c = cell + vec2(float(x), float(y));
      vec2 cid = mod(c, period);
      vec2 j = (hash22(cid + seed) - 0.5) * jitter;
      vec2 pnt = c + 0.5 + j;
      vec2 dv = g - pnt;
      float d = dot(dv, dv);
      if (d < f1) { f2 = f1; f1 = d; c1 = pnt; id1 = cid; }
      else if (d < f2) { f2 = d; }
    }
  }
  f1 = sqrt(f1);
  f2 = sqrt(f2);
  float edge = f2 - f1;
  float rnd = hash12(id1 + seed * 1.7);
  vec2 local = g - c1;
  float dome = sqrt(smoothstep(0.0, roundness, edge));
  float tilt = clamp(local.y * 0.9 + 0.5, 0.0, 1.0);
  h = dome * (0.55 + 0.3 * rnd + lift * (tilt - 0.5));
  id = rnd;
}

float roundedBox(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

/*
 * Dorsal scales: large keeled, imbricate (overlapping) almond-shaped scales in staggered rows, longer than wide.
 * Each scale rises toward its free rear tip, which lies over the front of the next row; a keel runs along its
 * rear half, so the keels line up into longitudinal ridges down the neck and back.
 */
void dorsalPlates(vec2 uv, out float h, out float id) {
  float a = uv.x > 0.5 ? uv.x - 1.0 : uv.x;
  vec2 g = vec2(a * NU_D, uv.y * NV_D);
  float row = floor(g.y);
  h = 0.0;
  id = 0.0;
  for (int dy = -2; dy <= 1; dy++) {
    float r = row + float(dy);
    float rowId = mod(r, NV_D);
    float off = mod(r, 2.0) * 0.5;
    float col = floor(g.x - off);
    for (int dx = -1; dx <= 1; dx++) {
      float c = col + float(dx);
      vec2 cid = vec2(c + 50.0, rowId);
      vec2 rnd = hash22(cid + 21.3);
      vec2 center = vec2(c + off + 0.5 + (rnd.x - 0.5) * 0.14, r + 0.5 + (rnd.y - 0.5) * 0.12);
      vec2 d = g - center;
      float len = 0.95 + 0.12 * rnd.y;
      float w = (0.64 + 0.08 * rnd.x) * (1.0 - 0.38 * clamp(d.y / len, 0.0, 1.0));
      float e = length(vec2(d.x / w, d.y / len));
      if (e < 1.0) {
        float dome = sqrt(1.0 - e * e);
        float rear = smoothstep(-len, len * 0.85, d.y);
        float keel = (1.0 - smoothstep(0.0, 0.16, abs(d.x))) * smoothstep(-0.5, 0.35, d.y);
        float hh = dome * (0.28 + 0.52 * rear) + keel * dome * 0.3 + 0.06 * rnd.x;
        if (hh > h) { h = hh; id = 0.3 + 0.6 * rnd.x; }
      }
    }
  }
}

/*
 * Ventral scutes: rows of broad rectangular scales (about 1.3:1), columns centred on the belly midline with a
 * slight alternating stagger. Rows vary in length; each scute rises toward its free rear edge, which overlaps the
 * next row like a shingle.
 */
void bellyScutes(vec2 uv, out float h, out float id) {
  float gy = uv.y * NV_B + 0.2 * sin(uv.y * 6.2831853 * 3.0) + 0.12 * sin(uv.y * 6.2831853 * 7.0 + 1.3);
  float gx = (uv.x - 0.5) * NU_B + 0.5;
  float row = floor(gy);
  h = 0.0; id = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    float r = row + float(dy);
    float rowId = mod(r, NV_B);
    float off = mod(r, 2.0) * 0.18 + (hash12(vec2(rowId, 9.1)) - 0.5) * 0.08;
    float col = floor(gx - off);
    for (int dx = -1; dx <= 1; dx++) {
      float c = col + float(dx);
      vec2 cid = vec2(mod(c + 40.0, NU_B), rowId);
      vec2 rnd = hash22(cid + 11.9);
      vec2 center = vec2(c + off + 0.5 + (rnd.x - 0.5) * 0.06, r + 0.5);
      vec2 d = vec2(gx, gy) - center;
      // Rear edges bow slightly toward the tail away from the midline.
      d.y -= 0.06 * d.x * d.x;
      float sd = roundedBox(d + vec2(0.0, 0.03), vec2(0.47, 0.5), 0.16);
      if (sd < 0.0) {
        float dome = sqrt(clamp(-sd * 6.0, 0.0, 1.0));
        float rear = smoothstep(-0.55, 0.45, d.y);
        float hh = dome * (0.34 + 0.12 * rnd.y + 0.36 * rear);
        if (hh > h) { h = hh; id = rnd.x; }
      }
    }
  }
}

void main() {
  vec2 uv = fract(vUv);
  float d = min(uv.x, 1.0 - uv.x);
  float n = fbmP(uv, vec2(10.0, 10.0), 3) - 0.5;
  float wD = 1.0 - smoothstep(0.06, 0.085, d + n * 0.02);
  float wB = smoothstep(0.34, 0.37, d + n * 0.03);
  float hF, iF, hD, iD, hB, iB;
  voronoiScales(uv, vec2(NU_F, NV_F), 0.85, 0.35, 0.3, 7.3, hF, iF);
  dorsalPlates(uv, hD, iD);
  bellyScutes(uv, hB, iB);
  float wF = clamp(1.0 - wD - wB, 0.0, 1.0);
  float h = hF - (1.0 - wF) * 2.0;
  float id = iF;
  float hd = hD * 1.05 - (1.0 - wD) * 2.0;
  if (hd > h) { h = hd; id = iD; }
  float hb = hB - (1.0 - wB) * 2.0;
  if (hb > h) { h = hb; id = iB; }
  h = max(h, 0.0);
  float micro = fbmP(uv, vec2(300.0, 300.0), 3);
  h += (micro - 0.5) * 0.07 * smoothstep(0.02, 0.3, h);
  gl_FragColor = vec4(h, id, wD, wB);
}
`;

const NORMAL = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tField;
uniform vec2 uTexel;
uniform float uStrength;
void main() {
  vec2 uv = vUv;
  float hl = texture2D(tField, uv - vec2(uTexel.x, 0.0)).r;
  float hr = texture2D(tField, uv + vec2(uTexel.x, 0.0)).r;
  float hd = texture2D(tField, uv - vec2(0.0, uTexel.y)).r;
  float hu = texture2D(tField, uv + vec2(0.0, uTexel.y)).r;
  vec3 n = normalize(vec3((hl - hr) * uStrength, (hd - hu) * uStrength, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}
`;

const ALBEDO_ORM = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tField;
uniform vec2 uTexel;
uniform int uMode;
${HASH}
void main() {
  vec2 uv = vUv;
  vec4 f = texture2D(tField, uv);
  float h = f.r;
  float id = f.g;
  float wD = f.b;
  float wB = f.a;
  // Cavity: how far below the local average this texel sits (crevices between scales).
  float avg = 0.0;
  float maxH = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 2.39996;
    float r = (1.5 + float(i) * 0.9);
    float s = texture2D(tField, uv + vec2(cos(a), sin(a)) * uTexel * r).r;
    avg += s;
    maxH = max(maxH, s);
  }
  avg /= 12.0;
  float cavity = clamp((avg - h) * 2.2, 0.0, 1.0);
  // Plates and scutes sit tight: shallower, cleaner crevices than the pebbly flank scales.
  cavity *= 1.0 - 0.5 * wB - 0.4 * wD;
  float edge = clamp((maxH - h) * 1.6, 0.0, 1.0);
  float d = min(uv.x, 1.0 - uv.x);
  float big = fbmP(uv, vec2(6.0, 6.0), 4);
  float mid = fbmP(uv, vec2(40.0, 40.0), 3);
  float flankToBelly = smoothstep(0.25, 0.38, d + (big - 0.5) * 0.06);

  if (uMode == 0) {
    // Albedo (linear; stored sRGB). Obsidian-bronze back, warmer flanks, ember belly.
    vec3 back = vec3(0.034, 0.029, 0.026);
    vec3 flank = vec3(0.05, 0.036, 0.027);
    vec3 belly = vec3(0.25, 0.115, 0.048);
    float backToFlank = smoothstep(0.04, 0.22, d + (big - 0.5) * 0.05);
    vec3 c = mix(back, flank, backToFlank);
    c = mix(c, belly, flankToBelly);
    // Mottling: large soft blotches and per-scale variation (value + slight hue).
    c *= 0.8 + 0.4 * big;
    c *= 0.9 + 0.2 * mid;
    float v = 0.8 + 0.4 * id;
    c *= v;
    c = mix(c, c * vec3(1.12, 1.0, 0.86), smoothstep(0.6, 0.95, id) * 0.6);
    // Crevices collect grime; raised edges very slightly worn.
    c *= 1.0 - 0.45 * cavity;
    float worn = smoothstep(0.75, 1.1, h) * (0.3 + 0.1 * wD);
    c = mix(c, c * 1.3 + vec3(0.005, 0.004, 0.003), worn * 0.4);
    // Dust and weathering settle on the back plates in large patches (breaks up the row pattern).
    float dust = smoothstep(0.45, 0.8, fbmP(uv + vec2(0.37, 0.11), vec2(4.0, 12.0), 4)) * wD;
    c = mix(c, vec3(0.075, 0.066, 0.056) * (0.8 + 0.4 * mid), dust * 0.45 * smoothstep(0.2, 0.7, h));
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  } else {
    // ORM: R = AO, G = roughness, B = belly colour weight (limbs remap it), A = wear mask.
    float ao = clamp(1.0 - cavity * 0.9 - edge * 0.12, 0.3, 1.0);
    float rough = 0.44 - 0.1 * smoothstep(0.4, 1.0, h) + 0.28 * cavity + (id - 0.5) * 0.1 + (mid - 0.5) * 0.1;
    rough = mix(rough, rough + 0.06, wB);
    rough = mix(rough, rough + 0.14, wD);
    float worn = smoothstep(0.6, 1.0, h);
    gl_FragColor = vec4(ao, clamp(rough, 0.2, 0.95), flankToBelly, worn);
  }
}
`;

export interface ScaleTextures {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  orm: THREE.Texture;
  targets: THREE.WebGLRenderTarget[];
}

export function bakeScaleTextures(baker: TextureBaker, size: number, anisotropy: number): ScaleTextures {
  const field = baker.createTarget({ width: size, height: size, type: THREE.HalfFloatType, mipmaps: false });
  field.texture.magFilter = THREE.NearestFilter;
  field.texture.minFilter = THREE.NearestFilter;
  baker.bake(field, FIELD, {});
  const texel = new THREE.Vector2(1 / size, 1 / size);
  const normal = baker.createTarget({ width: size, height: size, anisotropy });
  baker.bake(normal, NORMAL, { tField: { value: field.texture }, uTexel: { value: texel }, uStrength: { value: (size / 1024) * 2.4 } });
  const albedo = baker.createTarget({ width: size, height: size, srgb: true, anisotropy });
  baker.bake(albedo, ALBEDO_ORM, { tField: { value: field.texture }, uTexel: { value: texel }, uMode: { value: 0 } });
  const orm = baker.createTarget({ width: size, height: size, anisotropy });
  baker.bake(orm, ALBEDO_ORM, { tField: { value: field.texture }, uTexel: { value: texel }, uMode: { value: 1 } });
  field.dispose();
  return { albedo: albedo.texture, normal: normal.texture, orm: orm.texture, targets: [albedo, normal, orm] };
}
