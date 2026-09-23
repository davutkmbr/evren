import { FIRST_LEAF_LAYER, SPECIES_COUNT } from '../species';

const N = SPECIES_COUNT;

/**
 * Instance helpers shared by tree meshes and impostors.
 * Instance: aInst0 = (base xyz, yaw), aInst1 = (scale, species + 8 * variant, rank, width factor).
 * Per-species uniforms: uVegWind = (bend fraction of height, sway Hz, branch amp m, leaf amp m),
 * uVegShape = (height, centre y, bounding radius, 0), uVegLook = (leaf roughness, translucency, yellowing share, normal strength).
 */
export const VEG_INSTANCE_GLSL = /* glsl */ `
uniform vec3 uCamPos;
attribute vec4 aInst0;
attribute vec4 aInst1;
uniform vec4 uVegShape[${N}];
uniform vec4 uVegLook[${N}];
uniform vec4 uVegFade;

vec3 vegRotY(vec3 v, float s, float c) {
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

int vegSpecies() {
  return int(mod(aInst1.y, 8.0) + 0.5);
}

/* Per-instance albedo multiplier: brightness / hue drift, plus early autumn yellowing on some broadleaves. */
vec3 vegTint(float rank, float isLeaf, vec4 look) {
  float h1 = fract(rank * 91.7 + 0.13);
  float h2 = fract(rank * 47.3 + 0.61);
  float h3 = fract(rank * 13.1 + 0.37);
  vec3 tint = vec3(0.8 + 0.36 * h1);
  vec3 leafTint = tint * mix(vec3(0.9, 1.0, 1.14), vec3(1.12, 1.04, 0.82), h2);
  float yellow = step(h3, look.z) * (0.35 + 0.65 * fract(rank * 7.7));
  leafTint = mix(leafTint, leafTint * vec3(1.75, 1.3, 0.5), yellow * 0.55);
  vec3 barkTint = tint * mix(0.9, 1.1, h2);
  return mix(barkTint, leafTint, isLeaf);
}

/* Distance fade: x..y fades in, z..w fades out (x < 0 disables the fade-in). */
float vegFadeFactor(float d) {
  float fin = uVegFade.x < 0.0 ? 1.0 : smoothstep(uVegFade.x, uVegFade.y, d);
  return fin * (1.0 - smoothstep(uVegFade.z, uVegFade.w, d));
}
`;

/** Vertex-side instancing + wind for tree meshes (main and shadow depth programs). */
export const TREE_VERTEX_PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uWind;
attribute vec3 aTex;
attribute vec4 aWind;
attribute vec4 aCard;
attribute vec3 aCorner;
uniform vec4 uVegWind[${N}];
${VEG_INSTANCE_GLSL}
varying vec3 vVegTex;
varying vec3 vVegTint;
varying vec4 vVegMisc;
varying vec3 vVegLook;

void vegTransform(out vec3 wpos, out vec3 wnormal) {
  float s = sin(aInst0.w);
  float c = cos(aInst0.w);
  float scale = aInst1.x;
  float width = aInst1.w;
  int species = vegSpecies();
  vec3 base = aInst0.xyz;
  vec3 sc = vec3(width, 1.0, width) * scale;
  vec3 p = base + vegRotY(position * sc, s, c);
  wnormal = normalize(vegRotY(normal / vec3(width, 1.0, width), s, c));
  if (aCard.w > 0.0) {
    vec3 center = base + vegRotY((position + aCard.xyz) * sc, s, c);
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 bb = center + (camRight * aCorner.x + camUp * aCorner.y) * scale * mix(1.0, width, 0.5);
    p = mix(p, bb, aCard.w);
  }

  vec4 W = uVegWind[species];
  vec4 S = uVegShape[species];
  vec2 wv = uWind.xz;
  float spd = length(wv);
  vec2 wd = spd > 0.05 ? wv / spd : vec2(0.7071);
  float strength = 0.3 + clamp(spd * 0.11, 0.0, 1.8);
  float ph = aInst1.z * 61.0 + base.x * 0.021 + base.z * 0.017;
  float gust = 0.62 + 0.38 * sin(uTime * 0.31 + base.x * 0.0041 + base.z * 0.0023) * sin(uTime * 0.17 + base.z * 0.0031 + 1.3);
  float t = uTime * 6.2832 * W.y;
  float bend = W.x * S.x * scale * strength;
  float h = aWind.x;
  float sway = (0.62 + 0.38 * sin(t + ph)) * gust;
  float lateral = sin(t * 1.37 + ph * 1.9) * 0.28;
  vec3 off = vec3(wd.x, 0.0, wd.y) * (bend * h * sway) + vec3(-wd.y, 0.0, wd.x) * (bend * h * lateral);
  off.y -= bend * h * h * 0.12 * sway;
  float bp = aWind.w * 6.2832 + ph;
  vec3 bdir = vec3(wd.x, 0.0, wd.y) * (0.6 + 0.4 * sin(uTime * 1.9 + bp)) + vec3(sin(uTime * 2.3 + bp * 1.7), 0.4 * sin(uTime * 2.9 + bp * 1.3), cos(uTime * 2.1 + bp * 0.7)) * 0.5;
  off += bdir * (W.z * aWind.y * strength * gust * scale);
  off += wnormal * (W.w * aWind.z * strength * sin(uTime * 9.0 + bp * 3.0 + dot(p, vec3(1.3, 0.7, 1.1))));
  wpos = p + off;

  float isLeaf = aTex.z >= ${FIRST_LEAF_LAYER.toFixed(1)} ? 1.0 : 0.0;
  float variant = floor(aInst1.y / 8.0 + 0.001);
  vVegTex = vec3(aTex.xy, aTex.z + variant * isLeaf);
  vec4 look = uVegLook[species];
  vVegTint = vegTint(aInst1.z, isLeaf, look);
  vVegMisc = vec4(aCorner.z, isLeaf, vegFadeFactor(distance(base, uCamPos)), 0.0);
  vVegLook = look.xyw;
}
`;

export const VEG_DITHER_GLSL = /* glsl */ `
float vegIGN(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

export const TREE_FRAGMENT_PARS = /* glsl */ `
uniform sampler2DArray uVegAlbedo;
uniform sampler2DArray uVegNormal;
uniform float uVegDitherFlip;
varying vec3 vVegTex;
varying vec3 vVegTint;
varying vec4 vVegMisc;
varying vec3 vVegLook;
${VEG_DITHER_GLSL}

/* Alpha boost that keeps mipmapped alpha-tested foliage from thinning out with distance. */
float vegAlphaBoost(vec2 uv) {
  vec2 size = vec2(textureSize(uVegAlbedo, 0).xy);
  vec2 dx = dFdx(uv * size);
  vec2 dy = dFdy(uv * size);
  float mip = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8));
  return 1.0 + max(mip, 0.0) * 0.2;
}

mat3 vegTangentFrame(vec3 eyePos, vec3 n, vec2 uv) {
  vec3 q0 = dFdx(eyePos);
  vec3 q1 = dFdy(eyePos);
  vec2 st0 = dFdx(uv);
  vec2 st1 = dFdy(uv);
  vec3 q1perp = cross(q1, n);
  vec3 q0perp = cross(n, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(T * s, B * s, n);
}
`;

export const TREE_DEPTH_FRAGMENT_PARS = /* glsl */ `
uniform sampler2DArray uVegAlbedo;
varying vec3 vVegTex;
varying vec4 vVegMisc;
`;
