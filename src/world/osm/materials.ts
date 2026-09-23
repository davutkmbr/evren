/**
 * Materials of the OSM prototype. CC0 PBR sets from public/textures (see LICENSES.md):
 * - facades: MeshStandardMaterial per set, patched with a procedural facade (recessed windows with parallax reveals,
 *   sills, lintels, string courses, shutters, shop fronts, night lights) and per-building anti-tiling UVs;
 * - ground: one material that reads the street distance mask and blends five surfaces from texture arrays
 *   (asphalt, cobble, sidewalk pavers, granite slabs, back-lot concrete) with kerbs and night light pools;
 * - decals, rails and instanced props.
 */
import * as THREE from 'three';
import { patchMaterial } from '../../core/uniforms';
import { MASK_RANGE, SIDEWALK_MAX } from './protocol';

type TextureSet = 'plaster' | 'plaster_painted' | 'stone' | 'concrete' | 'brick' | 'roof_tiles' | 'asphalt' | 'cobble' | 'sidewalk' | 'granite' | 'yard';

/** Real-world size (m) of one texture repeat (see scripts/data/fetch-textures.mjs). */
const REPEAT_M: Record<TextureSet, number> = {
  plaster: 2,
  plaster_painted: 2,
  stone: 2,
  concrete: 2.7,
  brick: 1,
  roof_tiles: 2.5,
  asphalt: 2.08,
  cobble: 1.5,
  sidewalk: 2,
  granite: 3,
  yard: 3,
};
const GROUND_LAYERS: TextureSet[] = ['asphalt', 'cobble', 'sidewalk', 'granite', 'yard'];
const ARRAY_SIZE = 1024;

export interface OsmMaterials {
  facades: Record<'plaster' | 'painted' | 'stone' | 'concrete' | 'brick', THREE.MeshStandardMaterial>;
  roof: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  rails: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  prop: THREE.MeshStandardMaterial;
  tree: THREE.MeshStandardMaterial;
  /** Street mask / light pool textures and their placement (set by the system once the worker is done). */
  setStreetMask(mask: THREE.Texture, pool: THREE.Texture, minX: number, minZ: number, extent: number, fade: THREE.Vector4): void;
  ready: Promise<void>;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Facades                                                             */
/* ------------------------------------------------------------------ */

const FACADE_VERTEX_PARS = /* glsl */ `
attribute vec4 aFac;
attribute vec2 aSty;
varying vec4 vOsmFac;
varying vec2 vOsmSty;
varying vec2 vOsmUv;
varying vec3 vOsmN;
varying vec3 vOsmWP;
`;

/** Per-building random offset / mirror of the texture UVs (anti-tiling). */
const FACADE_UV = /* glsl */ `
#ifdef USE_MAP
{
  float s = aFac.w;
  vec2 tuv = vec2(uv.x * (fract(s * 23.17) < 0.5 ? 1.0 : -1.0) + s * 41.0, uv.y + fract(s * 71.3) * 7.0);
  vMapUv = (mapTransform * vec3(tuv, 1.0)).xy;
  #ifdef USE_NORMALMAP
  vNormalMapUv = (normalMapTransform * vec3(tuv, 1.0)).xy;
  #endif
  #ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv = (roughnessMapTransform * vec3(tuv, 1.0)).xy;
  #endif
}
#endif
`;

const FACADE_VERTEX_MAIN = /* glsl */ `
vOsmFac = aFac;
vOsmSty = aSty;
vOsmUv = uv;
vOsmN = normalize(mat3(modelMatrix) * objectNormal);
vOsmWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FACADE_FRAGMENT_PARS = /* glsl */ `
uniform float uAlbedoNorm;
varying vec4 vOsmFac;
varying vec2 vOsmSty;
varying vec2 vOsmUv;
varying vec3 vOsmN;
varying vec3 vOsmWP;
float osmBox(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x);
}
`;

/**
 * aFac = (wall length, local ground above base, wall height, seed); aSty = (floor height, code);
 * code = kind + 4 * style + 16 * street + 32 * pitched (see worker/buildings.ts). uv = (m along wall, m above base).
 */
const FACADE_MAIN = /* glsl */ `
float osmFlat = 0.0;
float osmRough = -1.0;
float osmGlass = 0.0;
vec3 osmEmis = vec3(0.0);
{
  diffuseColor.rgb *= uAlbedoNorm;
  vec3 wn = normalize(vOsmN);
  vec3 wp = vOsmWP;
  float lightsOn = smoothstep(0.06, 0.5, uNight);
  float code = floor(vOsmSty.y + 0.5);
  float kind = mod(code, 4.0);
  float style = mod(floor(code / 4.0), 4.0);
  float street = mod(floor(code / 16.0), 2.0);
  float pitched = floor(code / 32.0);
  float seed = vOsmFac.w;
  float u = vOsmUv.x;
  float v = vOsmUv.y;
  diffuseColor.rgb *= 0.9 + 0.2 * vnoise2(wp.xz * 0.045 + wp.y * 0.03 + seed * 17.0);
  if (kind > 2.5) {
    float railMask = max(max(step(0.92, v), step(v, 0.06)), step(fract(u * 8.0), 0.2));
    if (fwidth(u * 8.0) < 0.7 && railMask < 0.5) discard;
    diffuseColor.rgb = vec3(0.03);
    osmRough = 0.5;
  } else if (abs(wn.y) > 0.5) {
    diffuseColor.rgb *= 0.82 + 0.3 * vnoise2(wp.xz * 0.35) - 0.12 * smoothstep(0.55, 0.8, vnoise2(wp.xz * 0.9 + 3.0));
  } else if (kind < 0.5) {
    float FH = vOsmSty.x;
    float L = vOsmFac.x;
    float gOff = vOsmFac.y;
    float wallH = vOsmFac.z;
    float hist = step(0.5, style) * step(style, 1.5);
    float modern = step(1.5, style);
    float bayW = mix(mix(2.8, 2.6, hist), 3.2, modern);
    float nb = max(1.0, floor(L / bayW + 0.3));
    float bw = L / nb;
    float bu = u / bw;
    float cu = floor(bu);
    float wu = (fract(bu) - 0.5) * bw;
    float r = floor(v / FH);
    float wv = v - r * FH;
    float fwu = max(fwidth(u), 1e-3);
    float fwv = max(fwidth(v), 1e-3);
    float detail = 1.0 - smoothstep(0.06, 0.25, max(fwu, fwv));
    float groundRow = floor((gOff + 0.9) / FH);
    groundRow += step((groundRow + 1.0) * FH - gOff, 2.6);
    float shopTop = (groundRow + 1.0) * FH - gOff;
    float sv = v - gOff;
    float above = step(groundRow + 0.5, r);
    float usable = step(1.6, L) * step((r + 1.0) * FH, wallH - mix(1.0, 0.45, pitched));
    float lowRise = step(wallH, 24.0);
    float hWin = hash13(vec3(cu, r, seed * 97.0));
    float hWin2 = hash13(vec3(cu + 17.0, r, seed * 13.0));
    float halfW = mix(mix(0.62, 0.52, hist), max(0.5, bw * 0.5 - 0.35), modern);
    float sillH = mix(mix(0.9, 0.7, hist), 0.75, modern);
    float headH = mix(mix(2.45, 3.25, hist), FH - 0.4, modern);

    // Wall: street grime, plinth, rustication, string courses, cornice shadow.
    vec3 wall = diffuseColor.rgb;
    wall *= mix(0.6, 1.0, smoothstep(0.0, 1.8, sv));
    float plinth = 1.0 - above;
    wall *= mix(1.0, mix(0.84, 0.78, hist), plinth);
    wall *= 1.0 - 0.3 * hist * plinth * detail * osmBox(mod(v, 0.45), 0.0, 0.035, fwv);
    float courseOn = max(hist, step(fract(seed * 2.9), 0.4) * (1.0 - modern));
    float band = courseOn * above * osmBox(wv, 0.0, 0.2, fwv);
    float bandShadow = courseOn * step(groundRow - 0.5, r) * osmBox(wv, FH - 0.07, FH, fwv);
    wall *= (1.0 + 0.12 * band) * (1.0 - 0.28 * bandShadow * detail);
    float cb = pitched > 0.5 ? wallH - 0.5 : wallH - mix(1.35, 1.55, hist);
    wall *= 1.0 - 0.3 * smoothstep(cb - 0.45, cb, v) * step(v, cb);

    // Recessed windows: parallax into a glass plane 0.12-0.22 m behind the wall; the rest of the opening shows the reveal.
    float inWin = osmBox(wu, -halfW, halfW, fwu) * osmBox(wv, sillH, headH, fwv) * above * usable;
    vec3 V = normalize(wp - cameraPosition);
    vec3 T = normalize(cross(wn, vec3(0.0, 1.0, 0.0)));
    float vn = min(dot(V, wn), -0.05);
    vec2 off = clamp(vec2(dot(V, T), V.y) / (-vn) * mix(0.22, 0.12, modern), vec2(-1.0), vec2(1.0));
    float gu = wu + off.x;
    float gv = wv + off.y;
    float glassHit = step(abs(gu), halfW) * step(sillH, gv) * step(gv, headH);
    float glass = inWin * mix(1.0, glassHit, detail);
    float reveal = max(inWin - glass, 0.0);
    float soffit = reveal * step(headH, gv);
    float mull = (1.0 - step(0.03, abs(gu))) + (1.0 - step(0.03, abs(gv - mix(sillH, headH, 0.7))));
    float edgeF = 1.0 - step(0.055, min(halfW - abs(gu), min(gv - sillH, headH - gv)));
    float casement = clamp(mull * (1.0 - 0.6 * modern) + edgeF, 0.0, 1.0) * glass * detail;

    float dressing = above * usable * (1.0 - modern);
    float sill = dressing * osmBox(wu, -halfW - 0.1, halfW + 0.1, fwu) * osmBox(wv, sillH - 0.1, sillH, fwv);
    float sillShadow = dressing * osmBox(wu, -halfW - 0.08, halfW + 0.08, fwu) * osmBox(wv, sillH - 0.24, sillH - 0.1, fwv);
    float lintel = hist * dressing * (osmBox(wu, -halfW - 0.16, halfW + 0.16, fwu) * osmBox(wv, headH, headH + 0.3, fwv) + osmBox(wu, -0.12, 0.12, fwu) * osmBox(wv, headH + 0.3, headH + 0.42, fwv));
    float surround = (1.0 - hist) * dressing * max(osmBox(wu, -halfW - 0.09, halfW + 0.09, fwu) * osmBox(wv, sillH, headH + 0.09, fwv) - inWin, 0.0);

    float shut = step(fract(seed * 7.13), 0.4) * (1.0 - modern) * lowRise * above * usable;
    float panelW = min(halfW, bw * 0.5 - halfW - 0.06);
    float panels = shut * step(0.1, panelW) * (osmBox(wu, halfW + 0.03, halfW + 0.03 + panelW, fwu) + osmBox(wu, -halfW - 0.03 - panelW, -halfW - 0.03, fwu)) * osmBox(wv, sillH, headH, fwv);
    float closed = shut * step(hWin, 0.2) * inWin;
    float louvre = mix(0.75, 1.0, step(0.5, fract(wv * 9.0)));

    // Street level: shop fronts with sign bands, or a door.
    float shopOn = street * step(fract(seed * 5.31), 0.8) * step(1.6, L) * (1.0 - above);
    float fb = fract(bu);
    float shopGlass = shopOn * osmBox(fb, 0.08, 0.92, fwu / bw) * osmBox(sv, 0.05, shopTop - 0.8, fwv);
    float signBand = shopOn * osmBox(fb, 0.04, 0.96, fwu / bw) * osmBox(sv, shopTop - 0.7, shopTop - 0.2, fwv) * step(hash12(vec2(cu, seed * 53.0)), 0.75);
    vec3 signCol = 0.5 * vec3(hash12(vec2(cu, seed * 11.0)), hash12(vec2(cu + 3.0, seed * 17.0)), hash12(vec2(cu + 7.0, seed * 29.0)));
    float door = street * (1.0 - above) * (1.0 - step(fract(seed * 5.31), 0.8)) * step(abs(cu - floor(nb * 0.5)), 0.1) * osmBox(wu, -0.6, 0.6, fwu) * osmBox(sv, -0.2, 2.4, fwv);

    vec3 glassCol = vec3(0.018, 0.022, 0.028) + vec3(0.025, 0.02, 0.016) * hWin;
    float curtain = step(hWin2, 0.35);
    glassCol = mix(glassCol, vec3(0.11, 0.1, 0.085), curtain * 0.8);
    vec3 frameCol = modern > 0.5 ? vec3(0.07) : mix(vec3(0.82, 0.8, 0.76), vec3(0.2, 0.13, 0.08), step(fract(seed * 3.7), 0.35 + 0.3 * hist));
    vec3 shutterCol = mix(vec3(0.08, 0.18, 0.12), vec3(0.22, 0.13, 0.07), step(fract(seed * 11.3), 0.5)) * louvre;

    vec3 c = wall;
    c = mix(c, wall * 1.12, surround * detail);
    c = mix(c, vec3(0.6, 0.57, 0.51), clamp(sill + lintel, 0.0, 1.0) * mix(0.5, 1.0, detail));
    c *= 1.0 - 0.3 * sillShadow * detail;
    c = mix(c, shutterCol, clamp(panels, 0.0, 1.0) * mix(0.5, 1.0, detail));
    c = mix(c, wall * 0.55, reveal);
    c = mix(c, wall * 0.38, soffit);
    c = mix(c, glassCol, glass);
    c = mix(c, frameCol, casement);
    c = mix(c, shutterCol, closed);
    c = mix(c, vec3(0.03, 0.028, 0.026) + 0.05 * hWin, shopGlass);
    c = mix(c, signCol, signBand);
    c = mix(c, vec3(0.14, 0.09, 0.05), door);
    diffuseColor.rgb = c;

    float glassOnly = glass * (1.0 - casement) * (1.0 - closed);
    osmFlat = clamp(inWin + shopGlass + signBand + door, 0.0, 1.0);
    osmRough = glassOnly + shopGlass > 0.5 ? 0.1 : -1.0;
    osmGlass = clamp(glassOnly + shopGlass, 0.0, 1.0);
    float lit = step(hWin, 0.06 + 0.22 * lightsOn);
    vec3 warm = mix(vec3(1.0, 0.55, 0.25), vec3(1.0, 0.75, 0.5), hWin2);
    osmEmis += warm * (1.0 + 2.0 * hWin2) * lit * glassOnly * lightsOn * mix(1.0, 0.5, curtain);
    osmEmis += vec3(1.0, 0.78, 0.5) * 3.0 * shopGlass * step(hWin, 0.75) * lightsOn;
    osmEmis += signCol * 2.5 * signBand * lightsOn;
  }
}
`;

function makeFacadeMaterial(name: string, albedoNorm: THREE.IUniform<number>): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name, vertexColors: true, roughness: 1, metalness: 0 });
  m.normalScale.setScalar(0.7);
  patchMaterial(m, `osm-facade-v2-${name}`, (shader) => {
    shader.uniforms.uAlbedoNorm = albedoNorm;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FACADE_VERTEX_PARS}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${FACADE_UV}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${FACADE_VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FACADE_MAIN}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  if (osmRough > 0.0) roughnessFactor = osmRough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n  normal = normalize(mix(normal, normalize(vNormal) * faceDirection, osmFlat));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance += osmEmis;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n  reflectedLight.indirectSpecular *= 1.0 - 0.45 * osmGlass;`);
  });
  return m;
}

/* ------------------------------------------------------------------ */
/* Ground                                                              */
/* ------------------------------------------------------------------ */

const GROUND_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uStreetMask;
uniform sampler2D uStreetPool;
uniform highp sampler2DArray uGroundAlb;
uniform highp sampler2DArray uGroundNrm;
uniform vec4 uMaskXf;
uniform vec4 uFade;
uniform vec4 uRepA;
uniform float uRepB;
varying vec3 vGW;
varying vec3 vGN;
float gBox(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x);
}
void gLayer(float w, float layer, float rep, vec2 p, vec2 gx, vec2 gy, inout vec3 alb, inout float rough, inout vec3 tn) {
  if (w < 0.002) return;
  vec2 uv = vec2(p.x, -p.y) / rep;
  vec2 dx = vec2(gx.x, -gx.y) / rep;
  vec2 dy = vec2(gy.x, -gy.y) / rep;
  vec4 a = textureGrad(uGroundAlb, vec3(uv, layer), dx, dy);
  vec3 n = textureGrad(uGroundNrm, vec3(uv, layer), dx, dy).xyz * 2.0 - 1.0;
  alb += a.rgb * w;
  rough += a.a * w;
  tn += n * w;
}
`;

const GROUND_MAIN = /* glsl */ `
vec3 gN = normalize(vGN);
float gRough = 0.9;
vec3 gEmis = vec3(0.0);
{
  vec2 p = vGW.xz;
  vec2 gx = dFdx(p);
  vec2 gy = dFdy(p);
  vec2 muv = (p - uMaskXf.xy) * uMaskXf.z;
  vec4 m = texture2D(uStreetMask, muv);
  float d = m.r * ${2 * MASK_RANGE}.0 - ${MASK_RANGE}.0;
  float ddx = dFdx(d);
  float ddy = dFdy(d);
  float fwd = max(abs(ddx) + abs(ddy), 0.02);
  float cob = m.g;
  float gra = m.b;
  float asp = clamp(1.0 - cob - gra, 0.0, 1.0);
  float swW = m.a * ${SIDEWALK_MAX}.0 * asp;
  float hasWalk = step(0.1, swW);
  float onRoad = 1.0 - smoothstep(-fwd, fwd, d - cob * 0.7);
  float walk = hasWalk * (1.0 - onRoad) * (1.0 - smoothstep(swW - fwd, swW + fwd, d));
  float yard = clamp(1.0 - onRoad - walk, 0.0, 1.0);
  vec3 alb = vec3(0.0);
  float rough = 0.0;
  vec3 tn = vec3(0.0);
  gLayer(onRoad * asp, 0.0, uRepA.x, p, gx, gy, alb, rough, tn);
  gLayer(onRoad * cob, 1.0, uRepA.y, p, gx, gy, alb, rough, tn);
  gLayer(walk, 2.0, uRepA.z, p, gx, gy, alb, rough, tn);
  gLayer(onRoad * gra, 3.0, uRepA.w, p, gx, gy, alb, rough, tn);
  gLayer(yard, 4.0, uRepB, p, gx, gy, alb, rough, tn);
  alb *= 0.86 + 0.28 * vnoise2(p * 0.06);
  alb *= mix(vec3(1.0), vec3(1.1, 0.97, 0.82), yard * vnoise2(p * 0.13 + 7.0));
  alb *= mix(1.0, 0.88, onRoad * asp * smoothstep(0.5, 0.75, vnoise2(p * 0.08 + 3.0)));

  // Kerb: light granite edge with a shaded face towards the carriageway, dark gutter in front of it.
  float kerbTop = hasWalk * gBox(d, 0.0, 0.24, fwd);
  float kerbFace = hasWalk * gBox(d, -0.1, 0.0, fwd);
  float gutter = hasWalk * onRoad * (1.0 - smoothstep(-0.5, 0.0, d));
  alb = mix(alb, vec3(0.34, 0.34, 0.32), max(kerbTop, kerbFace));
  alb *= 1.0 - 0.4 * gutter;

  vec3 N = normalize(vGN);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = cross(N, T);
  vec3 pn = normalize(T * tn.x + B * tn.y + N * max(tn.z, 0.2));
  float det = gx.x * gy.y - gx.y * gy.x;
  vec2 gd = abs(det) > 1e-10 ? vec2(gy.y * ddx - gx.y * ddy, -gy.x * ddx + gx.x * ddy) / det : vec2(0.0);
  float gl = length(gd);
  if (gl > 1e-4) {
    vec2 g2 = gd / gl;
    pn = normalize(mix(pn, normalize(vec3(-g2.x, 0.5, -g2.y)), kerbFace));
  }
  gN = pn;
  gRough = clamp(rough, 0.25, 1.0);
  diffuseColor.rgb = alb;
  float pool = texture2D(uStreetPool, muv).r;
  gEmis = alb * vec3(1.0, 0.72, 0.42) * pool * 2.4 * smoothstep(0.06, 0.5, uNight);

  float edge = min(min(p.x - uFade.x, uFade.z - p.x), min(p.y - uFade.y, uFade.w - p.y));
  if (edge < 34.0 * vnoise2(p * 0.035)) discard;
}
`;

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

function textureUrl(set: TextureSet, map: 'albedo' | 'normal' | 'rough'): string {
  return `${import.meta.env.BASE_URL}textures/${set}/${map}.jpg`;
}

function loadTexture(loader: THREE.TextureLoader, set: TextureSet, map: 'albedo' | 'normal' | 'rough', anisotropy: number): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      textureUrl(set, map),
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.setScalar(1 / REPEAT_M[set]);
        tex.anisotropy = anisotropy;
        tex.colorSpace = map === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function pixels(img: CanvasImageSource, size: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, size, size);
  return g.getImageData(0, 0, size, size).data;
}

/** Albedo (RGB) + roughness (A) and normal texture arrays of the ground layers. */
async function loadGroundArrays(anisotropy: number): Promise<[THREE.DataArrayTexture, THREE.DataArrayTexture]> {
  const n = GROUND_LAYERS.length;
  const layer = ARRAY_SIZE * ARRAY_SIZE * 4;
  const alb = new Uint8Array(layer * n);
  const nrm = new Uint8Array(layer * n);
  await Promise.all(
    GROUND_LAYERS.map(async (set, i) => {
      const [a, r, nm] = await Promise.all([loadImage(textureUrl(set, 'albedo')), loadImage(textureUrl(set, 'rough')), loadImage(textureUrl(set, 'normal'))]);
      const pa = pixels(a, ARRAY_SIZE);
      const pr = pixels(r, ARRAY_SIZE);
      const pn = pixels(nm, ARRAY_SIZE);
      const o = i * layer;
      for (let k = 0; k < layer; k += 4) {
        alb[o + k] = pa[k];
        alb[o + k + 1] = pa[k + 1];
        alb[o + k + 2] = pa[k + 2];
        alb[o + k + 3] = pr[k + 1];
        nrm[o + k] = pn[k];
        nrm[o + k + 1] = pn[k + 1];
        nrm[o + k + 2] = pn[k + 2];
        nrm[o + k + 3] = 255;
      }
    }),
  );
  const make = (data: Uint8Array, srgb: boolean): THREE.DataArrayTexture => {
    const t = new THREE.DataArrayTexture(data, ARRAY_SIZE, ARRAY_SIZE, n);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return [make(alb, true), make(nrm, false)];
}

/** Mean linear luminance of a texture image (normalises tinted facade albedo to ~1). */
function meanLuminance(tex: THREE.Texture): number {
  const d = pixels(tex.image as CanvasImageSource, 16);
  let sum = 0;
  const lin = (c: number) => Math.pow(c / 255, 2.2);
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
  }
  return Math.max(0.05, sum / (d.length / 4));
}

export function createOsmMaterials(renderer: THREE.WebGLRenderer): OsmMaterials {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const textures: THREE.Texture[] = [];
  const norms: Record<string, THREE.IUniform<number>> = {};
  const facadeSets: Record<keyof OsmMaterials['facades'], TextureSet> = { plaster: 'plaster', painted: 'plaster_painted', stone: 'stone', concrete: 'concrete', brick: 'brick' };
  const facades = {} as OsmMaterials['facades'];
  for (const key of Object.keys(facadeSets) as (keyof OsmMaterials['facades'])[]) {
    norms[key] = { value: 1 };
    facades[key] = makeFacadeMaterial(key, norms[key]);
  }
  const roof = new THREE.MeshStandardMaterial({ name: 'roof', vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });

  const groundUniforms = {
    uStreetMask: { value: null as THREE.Texture | null },
    uStreetPool: { value: null as THREE.Texture | null },
    uGroundAlb: { value: null as THREE.Texture | null },
    uGroundNrm: { value: null as THREE.Texture | null },
    uMaskXf: { value: new THREE.Vector4() },
    uFade: { value: new THREE.Vector4() },
    uRepA: { value: new THREE.Vector4(...GROUND_LAYERS.slice(0, 4).map((s) => REPEAT_M[s])) },
    uRepB: { value: REPEAT_M[GROUND_LAYERS[4]] },
  };
  const ground = new THREE.MeshStandardMaterial({ name: 'ground', roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  patchMaterial(ground, 'osm-ground-v1', (shader) => {
    Object.assign(shader.uniforms, groundUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;\nvarying vec3 vGN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND_MAIN}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += gEmis;');
  });

  const paint = new THREE.MeshStandardMaterial({ name: 'paint', vertexColors: true, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const rails = new THREE.MeshStandardMaterial({ name: 'rails', vertexColors: true, color: 0x8c8c8c, roughness: 0.28, metalness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const lamp = new THREE.MeshStandardMaterial({ name: 'lamp', vertexColors: true, roughness: 0.45, metalness: 0.4 });
  patchMaterial(lamp, 'osm-lamp-v1', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(1.0, 0.74, 0.42) * 14.0 * vGlow * smoothstep(0.06, 0.5, uNight);');
  });
  const prop = new THREE.MeshStandardMaterial({ name: 'prop', vertexColors: true, roughness: 0.65, metalness: 0.05 });
  const tree = new THREE.MeshStandardMaterial({ name: 'tree', vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });

  const bind = async (m: THREE.MeshStandardMaterial, set: TextureSet): Promise<THREE.Texture> => {
    const [albedo, normal, rough] = await Promise.all([loadTexture(loader, set, 'albedo', aniso), loadTexture(loader, set, 'normal', aniso), loadTexture(loader, set, 'rough', aniso)]);
    m.map = albedo;
    m.normalMap = normal;
    m.roughnessMap = rough;
    m.needsUpdate = true;
    textures.push(albedo, normal, rough);
    return albedo;
  };

  const ready = Promise.all([
    ...(Object.keys(facadeSets) as (keyof OsmMaterials['facades'])[]).map((key) =>
      bind(facades[key], facadeSets[key]).then((t) => {
        norms[key].value = key === 'brick' ? 1 : 1 / meanLuminance(t);
      }),
    ),
    bind(roof, 'roof_tiles'),
    loadGroundArrays(aniso).then(([a, n]) => {
      groundUniforms.uGroundAlb.value = a;
      groundUniforms.uGroundNrm.value = n;
      textures.push(a, n);
    }),
  ]).then(() => undefined);

  return {
    facades,
    roof,
    ground,
    paint,
    rails,
    lamp,
    prop,
    tree,
    setStreetMask(mask, pool, minX, minZ, extent, fade) {
      groundUniforms.uStreetMask.value = mask;
      groundUniforms.uStreetPool.value = pool;
      groundUniforms.uMaskXf.value.set(minX, minZ, 1 / extent, extent);
      groundUniforms.uFade.value.copy(fade);
      textures.push(mask, pool);
    },
    ready,
    dispose() {
      for (const t of textures) {
        t.dispose();
      }
      for (const m of [...Object.values(facades), roof, ground, paint, rails, lamp, prop, tree]) {
        m.dispose();
      }
    },
  };
}
