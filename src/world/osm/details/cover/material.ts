/**
 * Ground cover material (cover/cover.ts raster): procedural lawns with dry patches and worn rims, trodden soil,
 * paver paths (CC0 pavement_03) and asphalt parking lots (CC0 asphalt_01), blended over the streets ground with
 * anti-aliased signed-distance edges and faded out at the build rect like the streets ground.
 */
import * as THREE from 'three';
import type { WorldBounds } from '../../../../core/contracts';
import { patchMaterial, streetHole } from '../../../../core/uniforms';
import { loadPbrArrays, maxAnisotropy, REPEAT_M } from '../../shared/textures';
import type { CoverRaster } from '../protocol';

const COVER_PARS = /* glsl */ `
uniform sampler2D uCover;
uniform highp sampler2DArray uCoverAlb;
uniform highp sampler2DArray uCoverNrm;
uniform vec4 uCoverXf;
uniform vec4 uCoverFade;
uniform vec2 uCoverRep;
varying vec3 vCW;
varying vec3 vCN;
vec4 cvLayer(float layer, float rep, vec2 p, vec2 gx, vec2 gy, out vec3 n) {
  vec2 uv = vec2(p.x, -p.y) / rep;
  n = textureGrad(uCoverNrm, vec3(uv, layer), gx / rep, gy / rep).xyz * 2.0 - 1.0;
  return textureGrad(uCoverAlb, vec3(uv, layer), gx / rep, gy / rep);
}
`;

const COVER_MAIN = /* glsl */ `
vec3 cvN = normalize(vCN);
float cvRough = 0.95;
float cvAlpha = 1.0;
{
  vec2 p = vCW.xz;
  vec2 gx = dFdx(p);
  vec2 gy = dFdy(p);
  vec4 c = texture2D(uCover, (p - uCoverXf.xy) * uCoverXf.zw);
  vec4 fw = max(fwidth(c), vec4(0.004));
  vec4 w = smoothstep(0.5 - fw, 0.5 + fw, c);
  float path = w.b;
  float park = w.a * (1.0 - path);
  float green = w.r * (1.0 - path) * (1.0 - park);
  float soil = w.g * (1.0 - path) * (1.0 - park) * (1.0 - green);
  cvAlpha = path + park + green + soil;
  float edge = min(min(p.x - uCoverFade.x, uCoverFade.z - p.x), min(p.y - uCoverFade.y, uCoverFade.w - p.y));
  if (cvAlpha < 0.01 || edge < 34.0 * vnoise2(p * 0.035)) discard;

  // Lawn: large dry / lush patches, clumps, fine blades; a trodden rim along the edges.
  float n1 = fbm2(p * 0.045, 4);
  float n2 = vnoise2(p * 0.55);
  float n3 = vnoise2(p * 3.7);
  vec3 lush = vec3(0.085, 0.15, 0.038);
  vec3 mid = vec3(0.15, 0.2, 0.06);
  vec3 dry = vec3(0.3, 0.27, 0.12);
  vec3 grass = mix(lush, mid, smoothstep(0.35, 0.65, n1));
  grass = mix(grass, dry, smoothstep(0.6, 0.85, n1 + 0.25 * n2 - 0.08) * 0.85);
  grass *= (0.78 + 0.4 * n2) * (0.88 + 0.24 * n3);
  // Compacted earth and gravel of yards and vacant lots: dusty, mottled, with pebbles and darker damp patches.
  float s1 = vnoise2(p * 0.21);
  float s2 = vnoise2(p * 1.3 + 7.0);
  vec3 soilCol = mix(vec3(0.3, 0.26, 0.2), vec3(0.42, 0.37, 0.29), s1) * (0.9 + 0.2 * s2);
  soilCol *= 1.0 - 0.18 * smoothstep(0.62, 0.8, fbm2(p * 0.08 + 3.0, 3));
  soilCol = mix(soilCol, vec3(0.5, 0.48, 0.44), step(0.9, hash12(floor(p * 7.0))) * 0.6);
  soilCol = mix(soilCol, vec3(0.2, 0.18, 0.15), step(0.95, hash12(floor(p * 11.0) + 3.0)) * 0.5);
  // Green over earth is weeds: drier, yellower and patchier than a watered lawn.
  vec3 weeds = mix(vec3(0.2, 0.22, 0.09), vec3(0.34, 0.31, 0.15), n2) * (0.8 + 0.35 * n3);
  grass = mix(grass, weeds, w.g);
  float rim = 1.0 - smoothstep(0.5, 0.56, c.r);
  grass = mix(grass, soilCol, rim * 0.5 * (1.0 - w.g));

  vec3 nPath;
  vec3 nPark;
  vec4 aPath = cvLayer(0.0, uCoverRep.x, p, gx, gy, nPath);
  vec4 aPark = cvLayer(1.0, uCoverRep.y, p, gx, gy, nPark);
  // Pavers: pulled towards the grey-beige granite of the city's squares and quays.
  vec3 pathCol = mix(aPath.rgb, vec3(dot(aPath.rgb, vec3(0.3, 0.55, 0.15))), 0.6) * vec3(1.06, 1.02, 0.96) * (0.85 + 0.25 * vnoise2(p * 0.2));
  vec3 parkCol = aPark.rgb * 0.8 * (0.85 + 0.25 * vnoise2(p * 0.07 + 3.0));

  vec3 alb = (grass * green + soilCol * soil + pathCol * path + parkCol * park) / max(cvAlpha, 1e-3);
  diffuseColor.rgb = alb;
  cvRough = mix(0.95, 0.8, path + park);
  vec3 tn = vec3(0.0, 0.0, 1.0) * (green + soil) + nPath * path + nPark * park;
  tn.xy += vec2(n3 - 0.5, n2 - 0.5) * 0.3 * green;
  tn = normalize(tn + vec3(0.0, 0.0, 1e-3));
  vec3 N = normalize(vCN);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 Bt = cross(N, T);
  cvN = normalize(T * tn.x + Bt * tn.y + N * max(tn.z, 0.2));
  diffuseColor.a = clamp(cvAlpha, 0.0, 1.0);
}
`;

export interface CoverMaterial {
  material: THREE.MeshStandardMaterial;
  ready: Promise<void>;
  dispose(): void;
}

export function createCoverMaterial(renderer: THREE.WebGLRenderer, raster: CoverRaster, fade: WorldBounds): CoverMaterial {
  const mask = new THREE.DataTexture(raster.rgba, raster.w, raster.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  mask.minFilter = THREE.LinearFilter;
  mask.magFilter = THREE.LinearFilter;
  mask.generateMipmaps = false;
  mask.needsUpdate = true;
  const uniforms = {
    uCover: { value: mask as THREE.Texture },
    uCoverAlb: { value: null as THREE.Texture | null },
    uCoverNrm: { value: null as THREE.Texture | null },
    uCoverXf: { value: new THREE.Vector4(raster.minX, raster.minZ, 1 / (raster.w * raster.px), 1 / (raster.h * raster.px)) },
    uCoverFade: { value: new THREE.Vector4(fade.minX, fade.minZ, fade.maxX, fade.maxZ) },
    uCoverRep: { value: new THREE.Vector2(REPEAT_M.sidewalk, REPEAT_M.asphalt) },
  };
  const material = streetHole(new THREE.MeshStandardMaterial({
    name: 'osm-cover',
    roughness: 1,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  }));
  patchMaterial(material, 'osm-cover-v3', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCW;\nvarying vec3 vCN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COVER_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${COVER_MAIN}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = cvRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize((viewMatrix * vec4(cvN, 0.0)).xyz);');
  });
  const textures: THREE.Texture[] = [mask];
  const ready = loadPbrArrays(['sidewalk', 'asphalt'], 512, maxAnisotropy(renderer)).then(([a, n]) => {
    uniforms.uCoverAlb.value = a;
    uniforms.uCoverNrm.value = n;
    textures.push(a, n);
  });
  return {
    material,
    ready,
    dispose() {
      for (const t of textures) t.dispose();
      material.dispose();
    },
  };
}
