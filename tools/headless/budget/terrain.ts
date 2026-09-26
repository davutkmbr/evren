/**
 * Terrain probe: the real CDLOD selection (QuadtreeSelector over the geo height pyramid) for the main frustum and, on
 * planar reflection presets, the mirrored one, exactly as TerrainSystem.preRender feeds it. Horizon extension bounds
 * stay conservative (their GPU readback is skipped), which slightly overestimates far patches.
 */
import { MID_MAX_LOD, terrainQuality, EXT_SIZE, NOISE_TEX_SIZE, CARPET_TILE_RES, NATURE_TILE_RES, DETAIL_TILE_RES, DISTRICT_TEX_SIZE, ROAD_GRID_SIZE } from '../../../src/world/terrain/config';
import { HeightBounds } from '../../../src/world/terrain/height-bounds';
import { PATCH_STRIDE, QuadtreeSelector } from '../../../src/world/terrain/quadtree';
import { frusta, emptyView, MB, probeCamera, texBytes, timeMedian, type ModuleReport, type ProbeContext } from './common';

export function probeTerrain(pc: ProbeContext): ModuleReport {
  const q = terrainQuality(pc.quality.terrainLodScale);
  const bounds = new HeightBounds();
  bounds.setWorldHeights(pc.geo.heightGrid.data);
  const selector = new QuadtreeSelector(bounds, 6144);
  selector.setBaseRange(q.baseRange);
  const quadTris = q.patchQuads * q.patchQuads * 2;
  const planar = pc.quality.waterReflections === 'planar';
  const report: ModuleReport = {
    module: 'terrain',
    materials: 3,
    textureMB: 0,
    views: {},
    notes: [`patch grid ${q.patchQuads}x${q.patchQuads} quads (${quadTris} tris), base range ${q.baseRange} m`],
  };
  const key = (o: number, d: Float32Array): string => `${d[o]},${d[o + 1]},${d[o + 2]}`;
  for (const v of pc.views) {
    const cam = probeCamera(v);
    const { main, mirror } = frusta(cam);
    const pos = cam.position;
    const both = planar && pos.y < 3000;
    const list = both ? [main, mirror] : [main];
    const count = selector.select(pos, list, list.length);
    const tiers = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      const lod = selector.data[i * PATCH_STRIDE + 3];
      tiers[lod < 0.5 ? 0 : lod <= MID_MAX_LOD + 0.5 ? 1 : 2]++;
    }
    // How much of the shared list each pass actually needs.
    const mainCount = selector.select(pos, [main], 1);
    const mainKeys = new Set<string>();
    for (let i = 0; i < mainCount; i++) {
      mainKeys.add(key(i * PATCH_STRIDE, selector.data));
    }
    let mirrorCount = 0;
    let shared = 0;
    if (both) {
      mirrorCount = selector.select(pos, [mirror], 1);
      for (let i = 0; i < mirrorCount; i++) {
        if (mainKeys.has(key(i * PATCH_STRIDE, selector.data))) {
          shared++;
        }
      }
    }
    const cpu = timeMedian(() => selector.select(pos, list, list.length), 25);
    const r = emptyView();
    const drawnTiers = tiers.filter((t) => t > 0).length;
    r.main = { tris: count * quadTris, draws: drawnTiers };
    r.reflection = both ? { tris: count * quadTris, draws: drawnTiers } : { tris: 0, draws: 0 };
    r.cpuMs = cpu;
    r.detail = {
      patches: count,
      near: tiers[0],
      mid: tiers[1],
      far: tiers[2],
      mainOnlyNeeded: mainCount,
      mirrorOnlyNeeded: mirrorCount,
      sharedPatches: shared,
      visitedNodes: selector.visited,
    };
    report.views[v.id] = r;
  }
  // Textures (terrain-system.ts): horizon extension RGBA32F, noise RGBA8, surface tiles (array layers with mips),
  // district raster, road index. Geo textures (height R32F 2048², land use R8 4096², coast) are shared, counted here.
  const geoTex = texBytes(2048, 2048, 4) + texBytes(4096, 4096, 1) + texBytes(2048, 2048, 4);
  const own =
    texBytes(EXT_SIZE, EXT_SIZE, 16) +
    texBytes(NOISE_TEX_SIZE, NOISE_TEX_SIZE, 4, 1, true) +
    texBytes(CARPET_TILE_RES, CARPET_TILE_RES, 4, 5 * 2, true) +
    texBytes(NATURE_TILE_RES, NATURE_TILE_RES, 4, 2 * 2, true) +
    texBytes(DETAIL_TILE_RES, DETAIL_TILE_RES, 4, 7 * 2, true) +
    texBytes(DISTRICT_TEX_SIZE, DISTRICT_TEX_SIZE, 4) +
    texBytes(ROAD_GRID_SIZE, ROAD_GRID_SIZE, 8);
  report.textureMB = (own + geoTex) / MB;
  report.notes.push('texture estimate: surface tiles counted as albedo + normal/height array layers with mips; geo height/land-use/coast textures included');
  return report;
}
