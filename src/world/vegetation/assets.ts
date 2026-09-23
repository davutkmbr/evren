import * as THREE from 'three';
import type { VegetationLodConfig } from './config';
import type { SpeciesMeshes } from './gen/tree-gen';
import { generateAllSpecies } from './gen/tree-gen';
import type { ImpostorAtlas } from './impostor/impostor-bake';
import { bakeImpostors } from './impostor/impostor-bake';
import type { ImpostorMaterialSet } from './impostor/impostor-material';
import { createImpostorMaterials } from './impostor/impostor-material';
import type { TreeLodSource } from './render/tree-geometry';
import { createLodSource, createQuadSource } from './render/tree-geometry';
import type { TreeMaterialSet, VegetationSharedUniforms } from './render/tree-material';
import { createSharedUniforms, createTreeMaterials } from './render/tree-material';
import { SPECIES_COUNT } from './species';
import type { VegetationTextureSet } from './textures/bake-textures';
import { bakeVegetationTextures } from './textures/bake-textures';

export interface SpeciesInfo {
  /** Model height (m), bounding sphere centre height and radius (all LODs, reference scale). */
  height: number;
  centerY: number;
  radius: number;
  /** Half size of the impostor frames (tight projected extent). */
  impostorRadius: number;
  triangles: [number, number];
}

/** Everything that is generated once at init and shared by every pool. */
export interface VegetationAssets {
  readonly species: SpeciesInfo[];
  readonly lod0: TreeLodSource[];
  readonly lod1: TreeLodSource[];
  readonly quad: ReturnType<typeof createQuadSource>;
  readonly shared: VegetationSharedUniforms;
  readonly trees: TreeMaterialSet;
  readonly impostors: ImpostorMaterialSet;
  textures: VegetationTextureSet;
  atlas: ImpostorAtlas;
  /** Texture / atlas resolution the current bake was made with. */
  bakeKey: string;
  generationMs: number;
  dispose(): void;
}

function runSpeciesWorker(): Promise<{ meshes: SpeciesMeshes[]; ms: number }> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./gen/tree-gen.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(err);
      return;
    }
    worker.onmessage = (e: MessageEvent<{ meshes: SpeciesMeshes[]; ms: number }>): void => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e): void => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({});
  });
}

async function generateMeshes(): Promise<{ meshes: SpeciesMeshes[]; ms: number }> {
  try {
    return await runSpeciesWorker();
  } catch (err) {
    console.warn('[vegetation] species worker failed, generating on the main thread', err);
    const t0 = performance.now();
    const meshes = generateAllSpecies();
    return { meshes, ms: performance.now() - t0 };
  }
}

function bakeKeyOf(cfg: VegetationLodConfig): string {
  return `${cfg.textureSize}/${cfg.impostorFrames}/${cfg.impostorFrame}/${cfg.anisotropy}`;
}

function bakeGeometry(source: TreeLodSource): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setIndex(source.index);
  for (const [name, attr] of Object.entries(source.attributes)) {
    g.setAttribute(name, attr);
  }
  return g;
}

function bakeAll(renderer: THREE.WebGLRenderer, cfg: VegetationLodConfig, species: SpeciesInfo[], lod0: TreeLodSource[]): { textures: VegetationTextureSet; atlas: ImpostorAtlas } {
  const textures = bakeVegetationTextures(renderer, cfg.textureSize, cfg.anisotropy);
  const geometries = lod0.map(bakeGeometry);
  const atlas = bakeImpostors(
    renderer,
    geometries.map((geometry, s) => ({ geometry, centerY: species[s].centerY, radius: species[s].impostorRadius, sphere: species[s].radius })),
    textures,
    cfg.impostorFrames,
    cfg.impostorFrame,
    Math.min(cfg.anisotropy, 4),
  );
  // The shared attributes stay alive (pools use them); only the temporary geometry wrappers go.
  for (const g of geometries) {
    g.index = null;
    for (const name of Object.keys(g.attributes)) {
      g.deleteAttribute(name);
    }
    g.dispose();
  }
  return { textures, atlas };
}

export async function createVegetationAssets(renderer: THREE.WebGLRenderer, cfg: VegetationLodConfig): Promise<VegetationAssets> {
  const { meshes, ms } = await generateMeshes();
  meshes.sort((a, b) => a.species - b.species);
  if (meshes.length !== SPECIES_COUNT) {
    throw new Error(`[vegetation] expected ${SPECIES_COUNT} species meshes, got ${meshes.length}`);
  }
  const species: SpeciesInfo[] = meshes.map((m) => ({ height: m.maxY, centerY: m.centerY, radius: m.radius, impostorRadius: m.impostorRadius, triangles: m.triangles }));
  const lod0 = meshes.map((m) => createLodSource(m.lod0));
  const lod1 = meshes.map((m) => createLodSource(m.lod1));
  const baked = bakeAll(renderer, cfg, species, lod0);
  const shared = createSharedUniforms(baked.textures.albedo, baked.textures.normal, species);
  const trees = createTreeMaterials(shared);
  const impostors = createImpostorMaterials(shared, baked.atlas);
  const assets: VegetationAssets = {
    species,
    lod0,
    lod1,
    quad: createQuadSource(),
    shared,
    trees,
    impostors,
    textures: baked.textures,
    atlas: baked.atlas,
    bakeKey: bakeKeyOf(cfg),
    generationMs: ms,
    dispose() {
      trees.dispose();
      impostors.dispose();
      assets.textures.dispose();
      assets.atlas.dispose();
    },
  };
  return assets;
}

/** Re-bakes textures and impostors when the quality preset changes their resolution. */
export function rebakeIfNeeded(renderer: THREE.WebGLRenderer, assets: VegetationAssets, cfg: VegetationLodConfig): void {
  const key = bakeKeyOf(cfg);
  if (key === assets.bakeKey) {
    return;
  }
  const old = { textures: assets.textures, atlas: assets.atlas };
  const baked = bakeAll(renderer, cfg, assets.species, assets.lod0);
  assets.textures = baked.textures;
  assets.atlas = baked.atlas;
  assets.shared.uVegAlbedo.value = baked.textures.albedo;
  assets.shared.uVegNormal.value = baked.textures.normal;
  assets.impostors.uniforms.uImpAlbedo.value = baked.atlas.albedo;
  assets.impostors.uniforms.uImpNormal.value = baked.atlas.normal;
  assets.impostors.uniforms.uImpFrames.value = baked.atlas.frames;
  assets.bakeKey = key;
  old.textures.dispose();
  old.atlas.dispose();
}
