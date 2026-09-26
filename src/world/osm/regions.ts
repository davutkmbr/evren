/**
 * Flight-scale OSM regions: the always-loaded Galata slice (OSM_AREA) plus the regions around every landing spot
 * planned by scripts/data/osm-regions.mjs (regions.json). index.ts streams them in and out by distance.
 *
 * Every region owns its `area` (regions never overlap) and builds over `rect`: the area plus OSM_SEAM on each side
 * whose seam strip stays clear of every other region, so no two rects overlap either. Inside a rect the region's own
 * layers draw everything (ground, buildings by centroid, trees, props); abutting regions meet on a shared edge of the
 * global ground lattice, where both grounds have the same vertices and heights.
 *
 * Procedural content steps aside for OSM content through two exclusion lists:
 * - osmStaticExclusion(): every region rect, always. For consumers that bake it once (car traffic, landmark sites)
 *   and whose content is invisible at the distance where a region is not loaded.
 * - osmActiveExclusion(): the rects of the regions currently drawn (Galata always), with change events. The city and
 *   vegetation streamers rebuild their tiles over a rect when it enters or leaves the list.
 */
import type { WorldBounds } from '../../core/contracts';
import { OSM_DATA_URL, OSM_SEAM, osmAreaRect, osmExclusionRect } from './area';
import manifest from './regions.json';
import { groundRect } from './shared/ground';

export interface OsmRegionDef {
  readonly id: string;
  /** Local-metre rectangle the region owns. */
  readonly area: WorldBounds;
  /** Build rect: area plus the free seams (on the ground lattice). */
  readonly rect: WorldBounds;
  /**
   * Rect of the ground's dithered edge fade (OsmContext.fade): `rect`, pushed far out on every side that touches
   * another region's rect, where the neighbour's ground continues instead of the terrain.
   */
  readonly fade: WorldBounds;
  /** Data URL (schema of data.ts). */
  readonly url: string;
  /** Always loaded (the Galata slice). */
  readonly fixed: boolean;
  /** Download size (bytes, gzip) when indexed. */
  readonly gzipBytes?: number;
}

interface ManifestRegion {
  id: string;
  area: WorldBounds;
  file: string;
  gzipBytes?: number;
}

const overlaps = (a: WorldBounds, b: WorldBounds): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const grow = (r: WorldBounds, m: number): WorldBounds => ({ minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m });

/**
 * Build rect of `area`: each side grows by `seam` unless its strip (extended by `seam` past both corners) would come
 * within `seam` of another region's area or touch a fixed region's rect.
 */
function seamRect(area: WorldBounds, others: readonly WorldBounds[], fixedRects: readonly WorldBounds[], seam: number): WorldBounds {
  const blocked = (strip: WorldBounds): boolean => others.some((o) => overlaps(strip, grow(o, seam))) || fixedRects.some((f) => overlaps(strip, f));
  const { minX, maxX, minZ, maxZ } = area;
  const west = blocked({ minX: minX - seam, maxX: minX, minZ: minZ - seam, maxZ: maxZ + seam });
  const east = blocked({ minX: maxX, maxX: maxX + seam, minZ: minZ - seam, maxZ: maxZ + seam });
  const north = blocked({ minX: minX - seam, maxX: maxX + seam, minZ: minZ - seam, maxZ: minZ });
  const south = blocked({ minX: minX - seam, maxX: maxX + seam, minZ: maxZ, maxZ: maxZ + seam });
  return groundRect({ minX: west ? minX : minX - seam, maxX: east ? maxX : maxX + seam, minZ: north ? minZ : minZ - seam, maxZ: south ? maxZ : maxZ + seam });
}

/** `rect` with every side that touches one of `others` moved FAR out (no edge fade there). */
function fadeRect(rect: WorldBounds, others: readonly WorldBounds[]): WorldBounds {
  const FAR = 1e5;
  const touches = (strip: WorldBounds): boolean => others.some((o) => overlaps(strip, o));
  const e = 1;
  const { minX, maxX, minZ, maxZ } = rect;
  return {
    minX: touches({ minX: minX - e, maxX: minX + e, minZ, maxZ }) ? minX - FAR : minX,
    maxX: touches({ minX: maxX - e, maxX: maxX + e, minZ, maxZ }) ? maxX + FAR : maxX,
    minZ: touches({ minX, maxX, minZ: minZ - e, maxZ: minZ + e }) ? minZ - FAR : minZ,
    maxZ: touches({ minX, maxX, minZ: maxZ - e, maxZ: maxZ + e }) ? maxZ + FAR : maxZ,
  };
}

function buildRegions(): OsmRegionDef[] {
  const galataRect = groundRect(osmExclusionRect());
  // Planned regions without fetched data (no sizes recorded by `osm-regions.mjs index`) are skipped.
  const list = (manifest as { regions: ManifestRegion[] }).regions.filter((r) => r.gzipBytes);
  const defs = [
    { id: 'galata', area: osmAreaRect(), rect: galataRect, url: OSM_DATA_URL, fixed: true },
    ...list.map((r) => ({
      id: r.id,
      area: r.area,
      rect: seamRect(
        r.area,
        list.filter((o) => o !== r).map((o) => o.area),
        [galataRect],
        OSM_SEAM,
      ),
      url: `${import.meta.env.BASE_URL}${r.file}`,
      fixed: false,
      gzipBytes: r.gzipBytes,
    })),
  ];
  return defs.map((d) => ({ ...d, fade: fadeRect(d.rect, defs.filter((o) => o !== d).map((o) => o.rect)) }));
}

let regions: OsmRegionDef[] | null = null;

/** Every region, Galata first. */
export function osmRegions(): readonly OsmRegionDef[] {
  return (regions ??= buildRegions());
}

let staticRects: WorldBounds[] | null = null;

/** Rects of every region (loaded or not). */
export function osmStaticExclusion(): readonly WorldBounds[] {
  return (staticRects ??= osmRegions().map((r) => r.rect));
}

type ExclusionListener = (rect: WorldBounds, active: boolean) => void;

/** Live list behind osmActiveExclusion(): mutated in place, so holders of the array always see the current rects. */
const activeRects: WorldBounds[] = [];
const listeners = new Set<ExclusionListener>();

/** Rects of the regions currently drawn (the same array instance for the whole session; Galata always included). */
export function osmActiveExclusion(): readonly WorldBounds[] {
  if (!activeRects.length) {
    activeRects.push(osmRegions()[0].rect);
  }
  return activeRects;
}

/** Subscribes to rects entering (`active`) or leaving the active list; returns the unsubscribe function. */
export function onOsmExclusionChange(fn: ExclusionListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** index.ts: a region started (true) or stopped (false) drawing. */
export function setOsmRegionActive(def: OsmRegionDef, active: boolean): void {
  const list = osmActiveExclusion() as WorldBounds[];
  const i = list.indexOf(def.rect);
  if (active === i >= 0 || def.fixed) {
    return;
  }
  if (active) {
    list.push(def.rect);
  } else {
    list.splice(i, 1);
  }
  for (const fn of listeners) {
    fn(def.rect, active);
  }
}

/** True when (x, z) lies in one of `rects`. */
export function inRects(rects: readonly WorldBounds[], x: number, z: number): boolean {
  for (const r of rects) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
      return true;
    }
  }
  return false;
}
