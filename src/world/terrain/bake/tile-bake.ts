import * as THREE from 'three';
import { COMMON_GLSL } from '../../../render/shaders';
import {
  CARPET_HEIGHT_RANGE,
  CARPET_TILE_METERS,
  CARPET_TILE_RES,
  DETAIL_HEIGHT_RANGE,
  DETAIL_TILE_METERS,
  DETAIL_TILE_RES,
  NATURE_HEIGHT_RANGE,
  NATURE_TILE_METERS,
  NATURE_TILE_RES,
} from '../config';
import { bakeMaterial, type GpuBaker } from './gpu-baker';
import { TILE_CARPETS_GLSL } from './tile-carpets.glsl';
import { TILE_COMMON_GLSL } from './tile-common.glsl';
import { TILE_NATURE_GLSL } from './tile-nature.glsl';

/** Generator ids (uGen). */
const GEN = {
  dense: 0,
  historic: 1,
  modern: 2,
  villa: 3,
  industrial: 4,
  forest: 5,
  cemetery: 6,
  asphalt: 7,
  pavers: 8,
  grass: 9,
  soil: 10,
  sand: 11,
  rock: 12,
  forestFloor: 13,
} as const;

const TILE_FRAG = /* glsl */ `
${COMMON_GLSL}
${TILE_COMMON_GLSL}
${TILE_CARPETS_GLSL}
${TILE_NATURE_GLSL}
uniform int uGen;
uniform float uHeightRange;
uniform int uAuxMode;

Gen generate(vec2 q) {
  if (uGen == 0) return genDenseCarpet(q, 0.0);
  if (uGen == 1) return genDenseCarpet(q, 1.0);
  if (uGen == 2) return genModernCarpet(q);
  if (uGen == 3) return genVillaCarpet(q);
  if (uGen == 4) return genIndustrialCarpet(q);
  if (uGen == 5) return genForest(q);
  if (uGen == 6) return genCemetery(q);
  if (uGen == 7) return genAsphalt(q);
  if (uGen == 8) return genPavers(q);
  if (uGen == 9) return genGrass(q);
  if (uGen == 10) return genSoil(q);
  if (uGen == 11) return genSand(q);
  if (uGen == 12) return genRock(q);
  return genForestFloor(q);
}

void main() {
  vec2 q = vUv * uTile;
  Gen g = generate(q);
  if (uPass == 0) {
    gl_FragColor = vec4(clamp(g.alb, 0.0, 1.0), clamp(g.h / uHeightRange, 0.0, 1.0));
    return;
  }
  float e = uTile / uRes;
  float hl = generate(q - vec2(e, 0.0)).h;
  float hr = generate(q + vec2(e, 0.0)).h;
  float hn = generate(q - vec2(0.0, e)).h;
  float hs = generate(q + vec2(0.0, e)).h;
  vec3 n = normalize(vec3(hl - hr, 2.0 * e, hn - hs));
  vec2 extra = uAuxMode == 0 ? vec2(g.warm, g.cool) : uAuxMode == 1 ? vec2(g.id, g.mask) : vec2(0.0);
  gl_FragColor = vec4(n.x * 0.5 + 0.5, n.z * 0.5 + 0.5, clamp(extra, 0.0, 1.0));
}
`;

export interface SurfaceTiles {
  carpets: THREE.WebGLArrayRenderTarget;
  nature: THREE.WebGLArrayRenderTarget;
  detail: THREE.WebGLArrayRenderTarget;
}

function createArray(res: number, layers: number, anisotropy: number, name: string): THREE.WebGLArrayRenderTarget {
  const target = new THREE.WebGLArrayRenderTarget(res, res, layers * 2, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.SRGBColorSpace,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    generateMipmaps: false,
    depthBuffer: false,
    anisotropy,
  });
  target.texture.name = name;
  return target;
}

interface LayerJob {
  target: THREE.WebGLArrayRenderTarget;
  gen: number;
  layer: number;
  layers: number;
  tile: number;
  res: number;
  heightRange: number;
  auxMode: number;
}

/**
 * Bakes the procedural surface tile arrays on the GPU (sRGB RGBA8 arrays with mipmaps; hardware decodes to linear, so
 * albedo averages correctly with distance). Each array holds N albedo layers (rgb, a = height / range) followed by
 * N aux layers (normal.xz, two extra channels: night lights warm/cool for carpets, crown id/mask for canopies).
 */
export async function bakeSurfaceTiles(baker: GpuBaker, anisotropy: number): Promise<SurfaceTiles> {
  const tiles: SurfaceTiles = {
    carpets: createArray(CARPET_TILE_RES, 5, anisotropy, 'terrain-carpets'),
    nature: createArray(NATURE_TILE_RES, 2, anisotropy, 'terrain-nature'),
    detail: createArray(DETAIL_TILE_RES, 7, anisotropy, 'terrain-detail'),
  };
  const uniforms: Record<string, THREE.IUniform> = {
    uTile: { value: 1 },
    uRes: { value: 1 },
    uPass: { value: 0 },
    uGen: { value: 0 },
    uHeightRange: { value: 1 },
    uAuxMode: { value: 0 },
  };
  const material = bakeMaterial(TILE_FRAG, uniforms);
  await baker.prepare(material);

  const jobs: LayerJob[] = [];
  const carpetGens = [GEN.dense, GEN.historic, GEN.modern, GEN.villa, GEN.industrial];
  carpetGens.forEach((gen, i) =>
    jobs.push({ target: tiles.carpets, gen, layer: i, layers: 5, tile: CARPET_TILE_METERS[i], res: CARPET_TILE_RES, heightRange: CARPET_HEIGHT_RANGE, auxMode: 0 }),
  );
  [GEN.forest, GEN.cemetery].forEach((gen, i) =>
    jobs.push({ target: tiles.nature, gen, layer: i, layers: 2, tile: NATURE_TILE_METERS[i], res: NATURE_TILE_RES, heightRange: NATURE_HEIGHT_RANGE, auxMode: 1 }),
  );
  [GEN.asphalt, GEN.pavers, GEN.grass, GEN.soil, GEN.sand, GEN.rock, GEN.forestFloor].forEach((gen, i) =>
    jobs.push({ target: tiles.detail, gen, layer: i, layers: 7, tile: DETAIL_TILE_METERS[i], res: DETAIL_TILE_RES, heightRange: DETAIL_HEIGHT_RANGE, auxMode: 2 }),
  );

  for (let j = 0; j < jobs.length; j++) {
    const job = jobs[j];
    const lastOfTarget = j === jobs.length - 1 || jobs[j + 1].target !== job.target;
    uniforms.uGen.value = job.gen;
    uniforms.uTile.value = job.tile;
    uniforms.uRes.value = job.res;
    uniforms.uHeightRange.value = job.heightRange;
    uniforms.uAuxMode.value = job.auxMode;
    uniforms.uPass.value = 0;
    baker.render(material, job.target, job.layer);
    // Mipmaps are generated once, after the final layer of each array.
    job.target.texture.generateMipmaps = lastOfTarget;
    uniforms.uPass.value = 1;
    baker.render(material, job.target, job.layer + job.layers);
    job.target.texture.generateMipmaps = false;
    // Spread the GPU work over frames so the loading screen stays responsive.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  material.dispose();
  return tiles;
}
