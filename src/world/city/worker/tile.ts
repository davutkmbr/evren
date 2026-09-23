/** Tile builders: turn cached cell layouts into chunk geometry (per LOD) or collider boxes. */
import { BASE_CELL, COLLIDER_STRIDE, FADE_CLASS_COUNT, FadeClass, LEVEL_SIZES, WinType, type ColliderRequestMsg, type ColliderResultMsg, type GeoWindowMsg, type TileRequestMsg, type TileResultMsg } from '../protocol';
import { BF, BType, Roof, type BuildingRec } from './building';
import { emitCompact, emitNear, type LampSink } from './emit';
import { hash01 } from './rng';
import { GeoSampler } from './geo-sampler';
import { layoutCell, type CellLayout } from './layout';
import { MeshWriter } from './mesh-writer';
import type { WorldData } from './world-data';

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

export function buildTile(req: TileRequestMsg, world: WorldData): TileResultMsg {
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
  for (let k = 0; k < FADE_CLASS_COUNT; k++) {
    buckets.push([]);
  }
  let buildings = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const layout = cellLayout(ci0 + i, cj0 + j, req.win, world);
      for (const b of layout.buildings) {
        if (!kept(b, req.densityScale)) {
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
  const classEnds = [0, 0, 0, 0];
  if (far) {
    for (let k = 0; k < FADE_CLASS_COUNT; k++) {
      writer.fadeClass = k;
      for (const b of buckets[k]) {
        emitCompact(b, writer, 2, sink);
      }
      classEnds[k] = writer.icount;
    }
  } else {
    classEnds.fill(writer.icount);
  }
  const detailStart = writer.icount;
  const mesh = writer.finish();
  const geo = new GeoSampler(req.win, world.landUseSpec, world.heightSpec);
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
    lampPos,
    lampCol,
    buildings,
    classEnds,
    detailStart,
    nearWater,
    ms: performance.now() - t0,
  };
}

function roofRise(b: BuildingRec): number {
  if (b.roof === Roof.Hip || b.roof === Roof.Gable) {
    return Math.min(b.w, b.d) * 0.5 * Math.tan(b.pitch) * 0.6;
  }
  return b.roof === Roof.Flat ? 1 : 1.5;
}

export function buildColliders(req: ColliderRequestMsg, world: WorldData): ColliderResultMsg {
  const t0 = performance.now();
  const x0 = -WORLD_HALF + req.ix * req.size;
  const z0 = -WORLD_HALF + req.iz * req.size;
  const n = req.size / BASE_CELL;
  const ci0 = Math.round((x0 + WORLD_HALF) / BASE_CELL);
  const cj0 = Math.round((z0 + WORLD_HALF) / BASE_CELL);
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const layout = cellLayout(ci0 + i, cj0 + j, req.win, world);
      for (const b of layout.buildings) {
        if (!kept(b, req.densityScale)) {
          continue;
        }
        const top = b.groundY + b.height + roofRise(b) + (b.type === BType.Tower ? 5 : 0);
        const cik = b.flags & BF.Cikma ? 1.1 : 0;
        const ca = Math.cos(b.a);
        const sa = Math.sin(b.a);
        // Shift the box centre forward by half the çıkma so it covers the overhang.
        const oz = -cik * 0.5;
        out.push(b.x - oz * sa, (b.baseY + top) * 0.5, b.z + oz * ca, b.w * 0.5, (top - b.baseY) * 0.5, b.d * 0.5 + cik * 0.5, -b.a);
      }
    }
  }
  const boxes = new Float32Array(out);
  void COLLIDER_STRIDE;
  return { type: 'colliders', id: req.id, boxes, ms: performance.now() - t0 };
}
