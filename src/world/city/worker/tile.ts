/** Tile builders: turn cached cell layouts into chunk geometry (per LOD) or collider boxes. */
import { BASE_CELL, COLLIDER_STRIDE, FADE_CLASS_COUNT, FadeClass, LEVEL_SIZES, WinType, type ColliderRequestMsg, type ColliderResultMsg, type GeoWindowMsg, type TileRequestMsg, type TileResultMsg } from '../protocol';
import { BF, BType, Roof, type BuildingRec } from './building';
import { emitCompact, emitNear, type LampSink } from './emit';
import { hash01 } from './rng';
import { GeoSampler } from './geo-sampler';
import { layoutCell, type CellLayout } from './layout';
import { MeshWriter } from './mesh-writer';
import type { WorldData } from './world-data';
import type { DecodedBuildings } from '../osm/format';
import { osmCoverageMask } from '../osm/mask';
import { emitOsm, osmCollider, osmFadeClass } from './osm-emit';

const WORLD_HALF = 24000;
const CELLS = (WORLD_HALF * 2) / BASE_CELL;
const CACHE_LIMIT = 900;
const cache = new Map<number, CellLayout>();

function cellLayout(ci: number, cj: number, win: GeoWindowMsg, world: WorldData): CellLayout {
  const key = cj * CELLS + ci;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const geo = new GeoSampler(win, world.landUseSpec, world.heightSpec);
  const layout = layoutCell(ci, cj, geo, world);
  cache.set(key, layout);
  if (cache.size > CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first !== undefined) {
      cache.delete(first);
    }
  }
  return layout;
}

/** Drops the cached layouts of cells within one cell of `rect` (their land use changed). */
export function forgetCells(rect: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
  const i0 = Math.floor((rect.minX + WORLD_HALF) / BASE_CELL) - 1;
  const i1 = Math.floor((rect.maxX + WORLD_HALF) / BASE_CELL) + 1;
  const j0 = Math.floor((rect.minZ + WORLD_HALF) / BASE_CELL) - 1;
  const j1 = Math.floor((rect.maxZ + WORLD_HALF) / BASE_CELL) + 1;
  for (const key of [...cache.keys()]) {
    const ci = key % CELLS;
    const cj = Math.floor(key / CELLS);
    if (ci >= i0 && ci <= i1 && cj >= j0 && cj <= j1) {
      cache.delete(key);
    }
  }
}

/** Whether the far OSM layer draws base cell (ci, cj) (its buildings replace the procedural lots there). */
function osmCell(world: WorldData, ci: number, cj: number): boolean {
  return world.osm !== null && osmCoverageMask()[cj * CELLS + ci] === 1;
}

/**
 * Records of the far OSM block inside the tile [x0, x0 + size) x [z0, z0 + size): owned by their centroid, in an OSM
 * cell, not owned by a loaded region (exclude rects), thinned like the procedural lots (small buildings only).
 */
function osmRecords(block: DecodedBuildings, x0: number, z0: number, size: number, exclude: readonly number[], densityScale: number): number[] {
  const out: number[] = [];
  const mask = osmCoverageMask();
  const tile0 = LEVEL_SIZES[0];
  const i0 = Math.round((x0 + WORLD_HALF) / tile0);
  const j0 = Math.round((z0 + WORLD_HALF) / tile0);
  const span = size / tile0;
  for (const t of block.header.tiles) {
    if (t.i < i0 || t.i >= i0 + span || t.j < j0 || t.j >= j0 + span) {
      continue;
    }
    for (let k = t.first; k < t.first + t.count; k++) {
      // Centroid of the outline (the record's first ring).
      const r0 = block.ringStart[k];
      let cx = 0;
      let cz = 0;
      for (let v = block.start[r0]; v < block.start[r0 + 1]; v++) {
        cx += block.xy[v * 2];
        cz += block.xy[v * 2 + 1];
      }
      cx /= block.nv[r0];
      cz /= block.nv[r0];
      const ci = Math.floor((cx + WORLD_HALF) / BASE_CELL);
      const cj = Math.floor((cz + WORLD_HALF) / BASE_CELL);
      if (ci < 0 || cj < 0 || ci >= CELLS || cj >= CELLS || mask[cj * CELLS + ci] !== 1) {
        continue;
      }
      let owned = false;
      for (let e = 0; e < exclude.length && !owned; e += 4) {
        owned = cx >= exclude[e] && cx < exclude[e + 2] && cz >= exclude[e + 1] && cz < exclude[e + 3];
      }
      if (owned) {
        continue;
      }
      if (osmFadeClass(block, k) === FadeClass.Small && hash01(Math.abs(block.id[k]) % 65536, Math.floor(Math.abs(block.id[k]) / 65536), 91) >= densityScale) {
        continue;
      }
      out.push(k);
    }
  }
  return out;
}

function kept(b: BuildingRec, densityScale: number): boolean {
  return b.keep < densityScale;
}

function fadeClassOf(b: BuildingRec): number {
  if (b.type === BType.Tower || b.winType === WinType.Curtain || b.height >= 30) {
    return FadeClass.Skyline;
  }
  if (b.height >= 18 || b.w * b.d >= 700 || b.type === BType.Yali || b.type === BType.Mass || b.type === BType.Industrial) {
    return FadeClass.Large;
  }
  return b.height >= 12 ? FadeClass.Mid : FadeClass.Small;
}

export function buildTile(req: TileRequestMsg, world: WorldData, block: DecodedBuildings | null = null): TileResultMsg {
  const t0 = performance.now();
  const size = LEVEL_SIZES[req.level];
  const x0 = -WORLD_HALF + req.ix * size;
  const z0 = -WORLD_HALF + req.iz * size;
  const cx = x0 + size * 0.5;
  const cz = z0 + size * 0.5;
  const writer = new MeshWriter(cx, cz, req.level === 0 ? 65536 : 32768);
  const sink: LampSink = { pos: [], col: [] };
  const n = size / BASE_CELL;
  const ci0 = Math.round((x0 + WORLD_HALF) / BASE_CELL);
  const cj0 = Math.round((z0 + WORLD_HALF) / BASE_CELL);
  const far = req.level === 2;
  const buckets: BuildingRec[][] = [];
  const osmBuckets: number[][] = [];
  for (let k = 0; k < FADE_CLASS_COUNT; k++) {
    buckets.push([]);
    osmBuckets.push([]);
  }
  const geo = new GeoSampler(req.win, world.landUseSpec, world.heightSpec);
  let buildings = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const layout = cellLayout(ci0 + i, cj0 + j, req.win, world);
      // Far OSM cells: the real buildings below replace the lots (the street lights stay).
      const osm = osmCell(world, ci0 + i, cj0 + j);
      for (const b of layout.buildings) {
        if (osm || !kept(b, req.densityScale)) {
          continue;
        }
        buildings++;
        if (far) {
          buckets[fadeClassOf(b)].push(b);
        } else if (req.level === 0) {
          emitNear(b, writer, sink);
        } else {
          emitCompact(b, writer, 1, sink);
        }
      }
      for (let k = 0; k < layout.lampCol.length; k++) {
        const col = layout.lampCol[k];
        // Far tiles keep every road light but only half of the neighbourhood street lights.
        if (far && (col & 255) === 1 && hash01(ci0 + i, cj0 + j, k, 77) < 0.5) {
          continue;
        }
        sink.pos.push(layout.lampPos[k * 3], layout.lampPos[k * 3 + 1], layout.lampPos[k * 3 + 2]);
        sink.col.push(col);
      }
    }
  }
  if (block) {
    for (const k of osmRecords(block, x0, z0, size, req.exclude, req.densityScale)) {
      buildings++;
      if (far) {
        osmBuckets[osmFadeClass(block, k)].push(k);
      } else {
        emitOsm(block, k, writer, req.level, geo);
      }
    }
  }
  const classEnds = [0, 0, 0, 0];
  if (far) {
    for (let k = 0; k < FADE_CLASS_COUNT; k++) {
      writer.fadeClass = k;
      for (const b of buckets[k]) {
        emitCompact(b, writer, 2, sink);
      }
      for (const r of osmBuckets[k]) {
        emitOsm(block!, r, writer, 2, geo);
      }
      classEnds[k] = writer.icount;
    }
  } else {
    classEnds.fill(writer.icount);
  }
  const detailStart = writer.icount;
  const mesh = writer.finish();
  let nearWater = false;
  for (let j = 0; j <= 6 && !nearWater; j++) {
    for (let i = 0; i <= 6; i++) {
      if (geo.coast(x0 + (i / 6) * size, z0 + (j / 6) * size) < 450) {
        nearWater = true;
        break;
      }
    }
  }
  const bx = (writer.minX + writer.maxX) * 0.5;
  const by = (writer.minY + writer.maxY) * 0.5;
  const bz = (writer.minZ + writer.maxZ) * 0.5;
  const r = mesh ? Math.hypot(writer.maxX - writer.minX, writer.maxY - writer.minY, writer.maxZ - writer.minZ) * 0.5 : 0;
  const lampPos = new Float32Array(sink.pos);
  const lampCol = new Uint8Array(sink.col.length * 4);
  for (let k = 0; k < sink.col.length; k++) {
    const c = sink.col[k];
    lampCol[k * 4] = Math.floor(c / 16777216) & 255;
    lampCol[k * 4 + 1] = (c >>> 16) & 255;
    lampCol[k * 4 + 2] = (c >>> 8) & 255;
    lampCol[k * 4 + 3] = c & 255;
  }
  return {
    type: 'tile',
    id: req.id,
    mesh,
    sphere: mesh ? [bx, by, bz, r] : [0, 0, 0, 0],
    top: mesh ? writer.maxY : 0,
    lampPos,
    lampCol,
    buildings,
    classEnds,
    detailStart,
    nearWater,
    ms: performance.now() - t0,
  };
}

/**
 * Collider boxes of one building, shaped like the drawn one (emit.ts emitNear) so no box stands where nothing is
 * drawn: walls up to the roof line; a pitched roof adds a second box inset from the sloped sides by as much as it
 * rises, so its top edge meets the drawn roof slope (a single box to the roof height stood up to 2 m above the eaves,
 * an invisible ledge along the walls); a flat roof adds the parapet only where one is drawn. Towers (setbacks, spire)
 * and industrial halls (sawtooth) keep one box over their roof line.
 */
function pushBuildingColliders(b: BuildingRec, out: number[]): void {
  const cik = b.flags & BF.Cikma ? 1.1 : 0;
  const ca = Math.cos(b.a);
  const sa = Math.sin(b.a);
  // Local frame (emit.ts): x along the width, z along the depth; the front (çıkma side) is -z. A box centred at local
  // (0, lz) with half extents (hx, hz): shift its centre by lz along the depth axis.
  const box = (lz: number, y0: number, y1: number, hx: number, hz: number): void => {
    out.push(b.x - lz * sa, (y0 + y1) * 0.5, b.z + lz * ca, hx, (y1 - y0) * 0.5, hz, -b.a);
  };
  const top = b.groundY + b.height;
  const hw = b.w * 0.5;
  const hd = b.d * 0.5 + cik * 0.5;
  // Shift the box centre forward by half the çıkma so it covers the overhang.
  const lz = -cik * 0.5;
  if (b.type === BType.Tower || b.type === BType.Industrial) {
    const rise = (b.roof === Roof.Hip || b.roof === Roof.Gable ? Math.min(b.w, b.d) * 0.5 * Math.tan(b.pitch) * 0.6 : b.roof === Roof.Flat ? 1 : 1.5) + (b.type === BType.Tower ? 5 : 0);
    box(lz, b.baseY, top + rise, hw, hd);
    return;
  }
  if (b.roof === Roof.Hip || b.roof === Roof.Gable) {
    box(lz, b.baseY, top, hw, hd);
    const tanP = Math.tan(b.pitch);
    // emit.ts: a gable (ridge along x) only when the building is wider than deep; otherwise a hip roof.
    const hip = b.roof === Roof.Hip || b.w < b.d;
    const t = Math.min(hw, hd) * 0.6;
    if (t * tanP > 0.3) {
      box(lz, top, top + t * tanP, hip ? hw - t : hw, hd - t);
    }
    return;
  }
  box(lz, b.baseY, top + (b.roof === Roof.Flat ? (b.flags & BF.Parapet ? 0.8 : 0) : 1.5), hw, hd);
}

export function buildColliders(req: ColliderRequestMsg, world: WorldData, block: DecodedBuildings | null = null): ColliderResultMsg {
  const t0 = performance.now();
  const x0 = -WORLD_HALF + req.ix * req.size;
  const z0 = -WORLD_HALF + req.iz * req.size;
  const n = req.size / BASE_CELL;
  const ci0 = Math.round((x0 + WORLD_HALF) / BASE_CELL);
  const cj0 = Math.round((z0 + WORLD_HALF) / BASE_CELL);
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (osmCell(world, ci0 + i, cj0 + j)) {
        continue;
      }
      const layout = cellLayout(ci0 + i, cj0 + j, req.win, world);
      for (const b of layout.buildings) {
        if (kept(b, req.densityScale)) {
          pushBuildingColliders(b, out);
        }
      }
    }
  }
  if (block) {
    const geo = new GeoSampler(req.win, world.landUseSpec, world.heightSpec);
    for (const k of osmRecords(block, x0, z0, req.size, req.exclude, req.densityScale)) {
      osmCollider(block, k, geo, out);
    }
  }
  const boxes = new Float32Array(out);
  void COLLIDER_STRIDE;
  return { type: 'colliders', id: req.id, boxes, ms: performance.now() - t0 };
}
