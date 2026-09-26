/**
 * Vegetation probe: the real species generator (triangles per LOD), the real TileStreamer (placement runs on the main
 * thread headless, as its no-worker fallback does) and the system's pool assignment, keep levels and LOD bands,
 * including the triangle governor (VegetationSystem.govern), iterated to its steady state. Pools are instanced draws
 * with bounding spheres around the camera, so every instance in them is submitted whatever the view direction.
 */
import * as THREE from 'three';
import { SPECIES_SHAPES, SPECIES_COUNT, INSTANCE_STRIDE, TEX_LAYER_COUNT } from '../../../src/world/vegetation/species';
import { generateAllSpecies } from '../../../src/world/vegetation/gen/tree-gen';
import { lodConfigFor, TILE_SIZE, tileKeepLevel } from '../../../src/world/vegetation/config';
import { buildPlacementInit } from '../../../src/world/vegetation/stream/geo-window';
import { TileState, TileStreamer, type VegTile } from '../../../src/world/vegetation/stream/tile-streamer';
import type { SpeciesInfo } from '../../../src/world/vegetation/assets';
import { CHUNK } from '../../../src/world/vegetation/render/impostor-pool';
import { cascadeSplits, cascadesFor, emptyView, MB, probeCamera, texBytes, timeMedian, type ModuleReport, type ProbeContext } from './common';

const POOL_HYSTERESIS = 48;

interface Bands {
  lod0: number;
  lod0Fade: number;
  lod1: number;
  lod1Fade: number;
  shadow: number;
  margin: number;
}

/** Counts of NearPools.rebuild (same classification), per species. */
function classify(tiles: VegTile[], cam: THREE.Vector3, b: Bands, scratch: Float32Array): { lod0: number[]; lod1: number[]; shadow: number[] } {
  const out = { lod0: new Array<number>(SPECIES_COUNT).fill(0), lod1: new Array<number>(SPECIES_COUNT).fill(0), shadow: new Array<number>(SPECIES_COUNT).fill(0) };
  const m = b.margin;
  const l0 = b.lod0 + b.lod0Fade + m;
  const l1lo = Math.max(b.lod0 - b.lod0Fade - m, 0);
  const l1hi = b.lod1 + b.lod1Fade + m;
  const sh = b.shadow + m;
  let w = 0;
  for (const t of tiles) {
    const a = t.instances;
    for (let i = 0, o = 0; i < t.count; i++, o += INSTANCE_STRIDE) {
      const dx = a[o] - cam.x;
      const dy = a[o + 1] - cam.y;
      const dz = a[o + 2] - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > l1hi * l1hi) {
        continue;
      }
      const sp = a[o + 5] % 8 | 0;
      // The copy the real pools do (one record per pool entry).
      for (let k = 0; k < INSTANCE_STRIDE; k++) {
        scratch[(w % 4096) * INSTANCE_STRIDE + k] = a[o + k];
      }
      w++;
      if (d2 < l0 * l0) {
        out.lod0[sp]++;
      }
      if (d2 > l1lo * l1lo) {
        out.lod1[sp]++;
      }
      if (d2 < sh * sh) {
        out.shadow[sp]++;
      }
    }
  }
  return out;
}

export function probeVegetation(pc: ProbeContext): ModuleReport {
  const cfg = lodConfigFor(pc.quality);
  const t0 = performance.now();
  const meshes = generateAllSpecies().sort((a, b) => a.species - b.species);
  const genMs = performance.now() - t0;
  const species: SpeciesInfo[] = meshes.map((m) => ({ height: m.maxY, centerY: m.centerY, radius: m.radius, impostorRadius: m.impostorRadius, triangles: m.triangles }));
  const crown = SPECIES_SHAPES.map((s) => s.crownWidth * 0.5);
  const init = buildPlacementInit(pc.geo, species, crown);
  const report: ModuleReport = {
    module: 'vegetation',
    // Tree LOD0 / LOD1 / depth, impostor near / far / depth.
    materials: 6,
    textureMB: 0,
    views: {},
    notes: [
      `species triangles LOD0/LOD1: ${species.map((s) => `${s.triangles[0]}/${s.triangles[1]}`).join(', ')} (generated in ${(genMs / 1000).toFixed(1)} s)`,
      `bands (before governor): LOD0 < ${cfg.lod0} m, LOD1 < ${cfg.lod1} m, mesh shadows < ${cfg.meshShadowRange} m, shadow impostors < ${cfg.impostorShadowRange} m, draw ${cfg.drawDistance} m`,
      'all vegetation is on NoReflection (0 reflection cost); pools are drawn whole (no per-instance frustum culling)',
    ],
  };
  const scratch = new Float32Array(4096 * INSTANCE_STRIDE);
  let placementMs = 0;
  for (const v of pc.views) {
    const cam = probeCamera(v);
    const streamer = new TileStreamer(pc.geo, init, TILE_SIZE, () => undefined, 0, []);
    const ts = performance.now();
    for (let i = 0; i < 20000; i++) {
      streamer.update(cam.position.x, cam.position.z, cfg.drawDistance, cfg.densityScale);
      if (streamer.pending() === 0) {
        break;
      }
    }
    placementMs += performance.now() - ts;
    const tiles = [...streamer.tiles.values()].filter((t) => t.state === TileState.Ready && t.count > 0);
    // Pools (assignPool / flushWrites): near ring keeps everything, far ring the quantised keep level.
    let nearInst = 0;
    let farInst = 0;
    let nearSlots = 0;
    let farSlots = 0;
    let trees = 0;
    for (const t of tiles) {
      trees += t.count;
      const near = t.dist < cfg.impostorShadowRange;
      const keep = near ? 1 : tileKeepLevel(t.dist, cfg);
      const want = Math.min(t.count, Math.ceil(t.count * keep));
      const slots = Math.ceil(want / CHUNK) * CHUNK;
      if (near) {
        nearInst += want;
        nearSlots += slots;
      } else {
        farInst += want;
        farSlots += slots;
      }
    }
    // Governor steady state (VegetationSystem.applyConfig / govern).
    let k = 1;
    let counts = { lod0: [0], lod1: [0], shadow: [0] };
    let bands: Bands = { lod0: 0, lod0Fade: 0, lod1: 0, lod1Fade: 0, shadow: 0, margin: 4 };
    let tris = 0;
    for (let it = 0; it < 60; it++) {
      bands = {
        lod0: cfg.lod0 * k,
        lod0Fade: cfg.lod0Fade * Math.max(k, 0.6),
        lod1: Math.max(cfg.lod1 * Math.sqrt(k), cfg.lod0 * k + 30),
        lod1Fade: cfg.lod1Fade,
        shadow: cfg.meshShadowRange * k,
        margin: 4,
      };
      const reach = bands.lod1 + bands.lod1Fade + bands.margin + 40;
      const nearTiles = tiles.filter((t) => {
        const dx = Math.max(t.x0 - cam.position.x, cam.position.x - (t.x0 + TILE_SIZE), 0);
        const dz = Math.max(t.z0 - cam.position.z, cam.position.z - (t.z0 + TILE_SIZE), 0);
        return dx * dx + dz * dz < reach * reach;
      });
      counts = classify(nearTiles, cam.position, bands, scratch);
      tris = 0;
      for (let s = 0; s < SPECIES_COUNT; s++) {
        const [a, b] = species[s].triangles;
        tris += counts.lod0[s] * a + counts.lod1[s] * b + counts.shadow[s] * b * 2;
      }
      tris += nearSlots * 2 * 3 + farSlots * 2;
      const prev = k;
      if (tris > cfg.triangleBudget) {
        k = Math.max(0.35, k * 0.93);
      } else if (tris < cfg.triangleBudget * 0.75) {
        k = Math.min(1, k * 1.02);
      }
      if (k === prev) {
        break;
      }
    }
    const reach = bands.lod1 + bands.lod1Fade + bands.margin + 40;
    const nearTiles = tiles.filter((t) => {
      const dx = Math.max(t.x0 - cam.position.x, cam.position.x - (t.x0 + TILE_SIZE), 0);
      const dz = Math.max(t.z0 - cam.position.z, cam.position.z - (t.z0 + TILE_SIZE), 0);
      return dx * dx + dz * dz < reach * reach;
    });
    const rebuildMs = timeMedian(() => classify(nearTiles, cam.position, bands, scratch), 15);
    const evalMs = timeMedian(() => {
      for (const t of streamer.tiles.values()) {
        const dx = Math.max(t.x0 - cam.position.x, cam.position.x - (t.x0 + TILE_SIZE), 0);
        const dz = Math.max(t.z0 - cam.position.z, cam.position.z - (t.z0 + TILE_SIZE), 0);
        t.dist = Math.hypot(dx, dz);
      }
    }, 15);
    const r = emptyView();
    let meshTris = 0;
    let meshDraws = 0;
    let shadowMeshTris = 0;
    let shadowMeshPools = 0;
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const [a, b] = species[s].triangles;
      meshTris += counts.lod0[s] * a + counts.lod1[s] * b;
      meshDraws += (counts.lod0[s] > 0 ? 1 : 0) + (counts.lod1[s] > 0 ? 1 : 0);
      shadowMeshTris += counts.shadow[s] * b;
      shadowMeshPools += counts.shadow[s] > 0 ? 1 : 0;
    }
    r.main.tris = meshTris + (nearSlots + farSlots) * 2;
    r.main.draws = meshDraws + (nearSlots > 0 ? 1 : 0) + (farSlots > 0 ? 1 : 0);
    const splits = cascadeSplits(pc.quality, cam.position.y);
    const { main } = { main: new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)) };
    const nearPoolCascades = cascadesFor(splits, main, cam, cam.position, cfg.impostorShadowRange + POOL_HYSTERESIS + TILE_SIZE * 1.5, 0);
    const meshPoolCascades = cascadesFor(splits, main, cam, cam.position, bands.shadow + 20, 0);
    r.shadow.tris = nearSlots * 2 * nearPoolCascades + shadowMeshTris * meshPoolCascades;
    r.shadow.draws = (nearSlots > 0 ? nearPoolCascades : 0) + shadowMeshPools * meshPoolCascades;
    r.cpuMs = evalMs + rebuildMs / 3;
    r.detail = {
      tiles: tiles.length,
      trees,
      lod0: counts.lod0.reduce((x, y) => x + y, 0),
      lod1: counts.lod1.reduce((x, y) => x + y, 0),
      meshShadow: counts.shadow.reduce((x, y) => x + y, 0),
      impNear: nearInst,
      impFar: farInst,
      impSlots: nearSlots + farSlots,
      governor: Math.round(k * 100) / 100,
      estTris: tris,
      rebuildMs: Math.round(rebuildMs * 1000) / 1000,
    };
    report.views[v.id] = r;
    streamer.dispose();
  }
  report.notes.push(`placement (worker time, not frame time): ${(placementMs / 1000).toFixed(1)} s for all views`);
  report.notes.push('cpu = tile distance pass + a third of a near-pool rebuild (rebuilds run when the camera moved, at most every frame)');
  // Textures: bark/leaf albedo + normal arrays (textureSize², 14 layers, mips); impostor atlas per species
  // (frames x frame px)², albedo + normal (+ depth), mips.
  const atlas = cfg.impostorFrames * cfg.impostorFrame;
  report.textureMB = (texBytes(cfg.textureSize, cfg.textureSize, 4, TEX_LAYER_COUNT * 2, true) + texBytes(atlas, atlas, 4, SPECIES_COUNT * 2, true)) / MB;
  return report;
}
