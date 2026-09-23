import * as THREE from 'three';
import { patchMaterial } from '../../../../core/uniforms';
import { FACADE_BASE, Surf } from '../build/surfaces';
import { FACADE_GLSL } from './glsl/facade.glsl';
import { SURFACES_GLSL } from './glsl/surfaces.glsl';

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

const FRAGMENT_PARS = /* glsl */ `
varying vec4 vHCol;
varying vec4 vHSurf;
varying vec2 vHUv;
varying vec3 vHWorld;
varying vec3 vHNormalW;
`;

/** Main dispatch: surface id -> procedural surface, then night floodlighting and contact occlusion. */
const DISPATCH_GLSL = /* glsl */ `
const vec3 H_FLOOD = vec3(1.0, 0.74, 0.47);

vec3 hPerturb(vec3 pos, vec3 n, float hgt) {
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

HS heritageSurface() {
  float id = floor(vHSurf.x + 0.5);
  vec2 p = vHUv;
  vec3 wp = vHWorld;
  vec3 tint = vHCol.rgb;
  float w = vHSurf.y;
  float hag = vHSurf.z;
  vec3 nW = normalize(vHNormalW);
  float vert = 1.0 - abs(nW.y);
  float fw = max(max(fwidth(p.x), fwidth(p.y)), 1e-4);
  HS s;
  if (id > ${FACADE_BASE}.0 - 0.5) {
    vec3 dpx = dFdx(wp);
    vec3 dpy = dFdy(wp);
    vec2 dux = dFdx(p);
    vec2 duy = dFdy(p);
    float det = dux.x * duy.y - dux.y * duy.x;
    vec3 T = (dpx * duy.y - dpy * dux.y) * (abs(det) > 1e-12 ? 1.0 / det : 0.0);
    T = dot(T, T) > 1e-12 ? normalize(T) : vec3(1.0, 0.0, 0.0);
    s = hFacade(id, p, wp, tint, w, hag, vert, fw, T);
  } else if (id < ${Surf.Brick}.5) {
    s = hBase(id, p, wp, tint, w, hag, vert, fw);
  } else if (id == ${Surf.Lead}.0) {
    s = hLead(p, wp, tint, w, fw);
  } else if (id == ${Surf.Slate}.0) {
    s = hSlate(p, tint, fw);
  } else if (id == ${Surf.Tile}.0) {
    s = hTile(p, wp, tint, w, fw);
  } else if (id == ${Surf.Glass}.0) {
    s = hsInit(tint, 0.06);
  } else if (id == ${Surf.Granite}.0) {
    s = hGranite(p, tint, w, fw);
    s.albedo = hWeather(s.albedo, p, wp, hag, 0.35, vert);
  } else if (id == ${Surf.Bronze}.0) {
    s = hBronze(p, tint, fw);
  } else if (id == ${Surf.Gold}.0) {
    s = hsInit(tint, 0.24);
    s.metal = 1.0;
  } else if (id == ${Surf.Wood}.0) {
    s = hWood(p, tint, fw);
  } else if (id == ${Surf.Earth}.0) {
    s = hEarth(p, wp, tint, fw);
  } else if (id == ${Surf.Paving}.0) {
    s = hPaving(p, tint, fw);
  } else if (id == ${Surf.Iron}.0) {
    s = hsInit(tint, 0.5);
    s.metal = 0.5;
  } else if (id == ${Surf.Void}.0) {
    s = hsInit(tint, 1.0);
    s.ao = 0.2;
  } else if (id == ${Surf.Stucco}.0) {
    s = hStucco(p, tint, fw);
    s.albedo = hWeather(s.albedo, p, wp, hag, w * 0.6, vert);
  } else if (id == ${Surf.BandedStone}.0) {
    s = hBanded(p, wp, tint, w, hag, vert, fw);
  } else if (id == ${Surf.Lamp}.0) {
    s = hsInit(vec3(0.85, 0.82, 0.75), 0.15);
    s.emit = vec3(1.0, 0.72, 0.42) * 22.0 * hLightsOn();
  } else if (id == ${Surf.Balustrade}.0) {
    s = hBalustrade(p, tint, fw);
  } else if (id == ${Surf.Clock}.0) {
    s = hClock(p, fw);
  } else {
    s = hRailing(p, tint, fw);
  }
  float on = hLightsOn();
  float fl = vHCol.a;
  if (on > 0.0 && fl > 0.0) {
    float prof = 1.05 * exp(-hag / 13.0) + 0.45 * exp(-hag / 2.5) + 0.1;
    float pools = 0.62 + 0.38 * cos(6.2831853 * p.x / 7.5);
    prof *= mix(1.0, pools, vert * (1.0 - smoothstep(6.0, 16.0, hag)));
    s.emit += s.albedo * H_FLOOD * fl * prof * on * 2.1;
  }
  s.ao *= vHSurf.w * mix(mix(0.55, 1.0, smoothstep(0.0, 1.4, hag)), 1.0, 1.0 - vert);
  return s;
}
`;

function requireChunk(source: string, chunk: string): void {
  if (!source.includes(chunk)) {
    console.warn(`[heritage] material patch could not find ${chunk}`);
  }
}

/** The single heritage material: patched MeshStandardMaterial with the procedural surface library. */
export function createHeritageMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  material.name = 'heritage';
  material.shadowSide = THREE.DoubleSide;
  patchMaterial(material, 'heritage-v1', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
    const fs = shader.fragmentShader;
    for (const c of ['#include <color_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>', '#include <normal_fragment_maps>', '#include <emissivemap_fragment>', '#include <aomap_fragment>', '#include <fog_pars_fragment>']) {
      requireChunk(fs, c);
    }
    shader.fragmentShader = fs
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${SURFACES_GLSL}\n${FACADE_GLSL}\n${DISPATCH_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  HS hs = heritageSurface();
  if (hs.cut > 0.5) discard;
  diffuseColor.rgb = hs.albedo;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(hs.rough, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = hs.metal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n  normal = hPerturb(-vViewPosition, normal, hs.height);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance = hs.emit;`)
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= hs.ao;
  reflectedLight.indirectSpecular *= hs.ao;
  reflectedLight.directDiffuse *= mix(1.0, hs.ao, 0.35);`,
      );
  });
  return material;
}
