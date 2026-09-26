import type { GeoQuery, LandmarkDef } from '../../../core/contracts';
import { latLonToLocal } from '../../../core/geo-coords';
import { visibleGround } from '../visible-ground';
import CROSSINGS from './data/crossings.json';
import { DOLMABAHCE_FOOTPRINTS } from './data/dolmabahce';
import { CIRAGAN_FOOTPRINTS } from './data/others';
import { ANADOLU_SITE, SELIMIYE_CORNERS } from './data/sites';
import type { GridWindow, SiteDef, SiteJob } from './protocol';

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function include(b: Bounds, x: number, z: number, r = 0): void {
  b.minX = Math.min(b.minX, x - r);
  b.maxX = Math.max(b.maxX, x + r);
  b.minZ = Math.min(b.minZ, z - r);
  b.maxZ = Math.max(b.maxZ, z + r);
}

function includeLatLon(b: Bounds, ll: readonly number[], r = 0): void {
  for (let i = 0; i + 1 < ll.length; i += 2) {
    const p = latLonToLocal(ll[i], ll[i + 1]);
    include(b, p.x, p.z, r);
  }
}

/** Extra extents for sites whose buildings reach beyond the geo reservation disc. */
function extraExtent(id: string, b: Bounds): void {
  if (id === 'dolmabahce-sarayi') {
    for (const f of DOLMABAHCE_FOOTPRINTS) {
      includeLatLon(b, f.ll, 60);
    }
  } else if (id === 'ciragan-sarayi') {
    for (const f of CIRAGAN_FOOTPRINTS) {
      includeLatLon(b, f.ll, 60);
    }
  } else if (id === 'anadolu-hisari') {
    includeLatLon(b, [ANADOLU_SITE.lat, ANADOLU_SITE.lon], 140);
  } else if (id === 'selimiye-kislasi') {
    includeLatLon(b, SELIMIYE_CORNERS, 60);
  } else if (id === 'kuleli') {
    include(b, b.minX, b.minZ, 160);
    include(b, b.maxX, b.maxZ, 160);
  }
}

/**
 * The visible ground over the cells covering `b` (cell-centred, same layout as the geo height grid): the geo terrain,
 * or the OSM street ground inside the OSM regions (landmarks/visible-ground.ts), so a site meets the drawn surface.
 */
function heightWindow(geo: GeoQuery, b: Bounds): GridWindow {
  const g = geo.heightGrid;
  const i0 = Math.max(0, Math.floor((b.minX - g.originX) / g.cellSize) - 1);
  const i1 = Math.min(g.width - 1, Math.ceil((b.maxX - g.originX) / g.cellSize) + 1);
  const j0 = Math.max(0, Math.floor((b.minZ - g.originZ) / g.cellSize) - 1);
  const j1 = Math.min(g.height - 1, Math.ceil((b.maxZ - g.originZ) / g.cellSize) + 1);
  const w = i1 - i0 + 1;
  const h = j1 - j0 + 1;
  const data = new Float32Array(w * h);
  const ground = visibleGround(geo);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const src = (j0 + j) * g.width + i0 + i;
      data[j * w + i] = ground(g.originX + (i0 + i) * g.cellSize, g.originZ + (j0 + j) * g.cellSize, g.data[src]);
    }
  }
  return { originX: g.originX + i0 * g.cellSize, originZ: g.originZ + j0 * g.cellSize, cell: g.cellSize, w, h, data };
}

function coastWindow(geo: GeoQuery, hw: GridWindow): GridWindow {
  const data = new Float32Array(hw.w * hw.h);
  for (let j = 0; j < hw.h; j++) {
    for (let i = 0; i < hw.w; i++) {
      data[j * hw.w + i] = geo.coastDistance(hw.originX + i * hw.cell, hw.originZ + j * hw.cell);
    }
  }
  return { ...hw, data };
}

function coastlinesIn(geo: GeoQuery, b: Bounds): Float64Array[] {
  const out: Float64Array[] = [];
  const m = 50;
  for (const ring of geo.coastlines) {
    let run: number[] = [];
    const flush = (): void => {
      if (run.length >= 4) {
        out.push(new Float64Array(run));
      }
      run = [];
    };
    for (const p of ring) {
      if (p.x >= b.minX - m && p.x <= b.maxX + m && p.z >= b.minZ - m && p.z <= b.maxZ + m) {
        run.push(p.x, p.z);
      } else {
        flush();
      }
    }
    flush();
  }
  return out;
}

export function siteDef(l: LandmarkDef): SiteDef {
  return {
    id: l.id,
    kind: l.kind,
    x: l.x,
    z: l.z,
    y: l.y,
    headingDeg: l.headingDeg,
    radius: l.radius,
    height: l.height,
    anchors: (l.anchors ?? []).map((a) => ({ x: a.x, z: a.z })),
    bodyWidth: l.bodyWidth,
    crossings: ((CROSSINGS as Record<string, (number | string)[][]>)[l.id] ?? []).map((c) => Number(c[0])),
  };
}

/** Prepares the worker job (terrain / coast windows, local coastlines) for one landmark. */
export function makeJob(geo: GeoQuery, l: LandmarkDef, lods: number): SiteJob {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  include(b, l.x, l.z, l.radius + 60);
  for (const a of l.anchors ?? []) {
    include(b, a.x, a.z, 120);
  }
  extraExtent(l.id, b);
  const heights = heightWindow(geo, b);
  return { def: siteDef(l), heights, coast: coastWindow(geo, heights), coastlines: coastlinesIn(geo, b), lods };
}
