/**
 * Walls and fences of the street edges from OSM lines, built into the masonry mesh: garden and consulate walls
 * (barrier=wall), retaining walls with their parapet (typical of the steep Cihangir and Galata lanes), the remnants
 * of the Genoese Galata walls (barrier=city_wall, historic=citywalls), metal railings (barrier=fence) and the
 * hoardings of construction sites (fences around landuse=construction, plus hoardings along the street sides of
 * construction areas that have none). Pieces that fall on a carriageway or a footpath are left open (gates,
 * crossings); lines inside landmark pads are the landmarks' own.
 */
import type { WorldBounds } from '../../../core/contracts';
import type { OsmArea, OsmData } from '../data';
import type { MeshBuf } from '../shared/buffers';
import { pointInRing, segDist } from '../shared/geometry';
import type { StreetSurface } from '../shared/street-surface';
import { GROUND_LAYER_INDEX } from './layers';
import { beam, type Rgb, slab } from './masonry';
import type { PadTest } from './pads';

const WALL: Rgb = [0.66, 0.62, 0.55];
const CITY_WALL: Rgb = [0.52, 0.48, 0.42];
const RETAINING: Rgb = [0.58, 0.56, 0.52];
const RAILING: Rgb = [0.12, 0.14, 0.13];
const HOARDING: Rgb = [0.86, 0.86, 0.83];
const HOARDING_BAND: Rgb = [0.1, 0.22, 0.42];

type Kind = 'wall' | 'city' | 'retaining' | 'fence' | 'hoarding';

interface Spec {
  height: number;
  half: number;
  col: Rgb;
  layer: number;
}

const SPECS: Record<Kind, Spec> = {
  wall: { height: 2.3, half: 0.2, col: WALL, layer: GROUND_LAYER_INDEX.stone },
  city: { height: 7, half: 1.2, col: CITY_WALL, layer: GROUND_LAYER_INDEX.stone },
  retaining: { height: 1.2, half: 0.25, col: RETAINING, layer: GROUND_LAYER_INDEX.stone },
  fence: { height: 1.7, half: 0.03, col: RAILING, layer: GROUND_LAYER_INDEX.concrete },
  hoarding: { height: 2.5, half: 0.05, col: HOARDING, layer: GROUND_LAYER_INDEX.concrete },
};

function kindOf(kind: string): Kind | null {
  switch (kind) {
    case 'barrier=wall':
      return 'wall';
    case 'barrier=city_wall':
    case 'historic=citywalls':
      return 'city';
    case 'barrier=retaining_wall':
      return 'retaining';
    case 'barrier=fence':
      return 'fence';
    default:
      return null;
  }
}

/** Splits a polyline into pieces of at most `max` m: [ax, az, bx, bz] each. */
function pieces(pts: readonly number[], closed: boolean, max: number): number[][] {
  const p = closed ? [...pts, pts[0], pts[1]] : pts;
  const out: number[][] = [];
  for (let k = 2; k < p.length; k += 2) {
    const ax = p[k - 2];
    const az = p[k - 1];
    const l = Math.hypot(p[k] - ax, p[k + 1] - az);
    const n = Math.max(1, Math.ceil(l / max));
    for (let i = 0; i < n; i++) {
      out.push([ax + ((p[k] - ax) * i) / n, az + ((p[k + 1] - az) * i) / n, ax + ((p[k] - ax) * (i + 1)) / n, az + ((p[k + 1] - az) * (i + 1)) / n]);
    }
  }
  return out;
}

export function buildBarriers(m: MeshBuf, data: Pick<OsmData, 'lines' | 'areas'>, surface: StreetSurface, padded: PadTest, rect: WorldBounds): Record<string, number> {
  const sites = data.areas.filter((a) => a.kind === 'landuse=construction' && !padded(a.ring[0], a.ring[1]));
  const nearSite = (x: number, z: number): OsmArea | undefined =>
    sites.find((a) => {
      if (pointInRing(a.ring, x, z)) {
        return true;
      }
      const r = a.ring;
      for (let k = 0; k < r.length; k += 2) {
        const j = (k + 2) % r.length;
        if (segDist(x, z, r[k], r[k + 1], r[j], r[j + 1]) < 3) {
          return true;
        }
      }
      return false;
    });
  const stats: Record<string, number> = { walls: 0, cityWalls: 0, retaining: 0, fences: 0, hoardings: 0 };
  const fenced = new Set<OsmArea>();

  // Keep clear of the fade-out margin, where the OSM ground dissolves into the procedural city (`rect` is the fade
  // rect: pushed far out on sides shared with another region, whose own walls continue beyond the build rect).
  const inside = (x: number, z: number): boolean => surface.covers(x, z) && Math.min(x - rect.minX, rect.maxX - x, z - rect.minZ, rect.maxZ - z) > 40;
  const open = (x: number, z: number): boolean =>
    !inside(x, z) || surface.distance(x, z) < 0.3 || surface.pathDistance(x, z) < -0.2 || surface.geo.isWater(x, z) || padded(x, z);

  const build = (kind: Kind, pts: readonly number[], closed: boolean, height?: number): number => {
    const spec = SPECS[kind];
    const h = height ?? spec.height;
    let metres = 0;
    for (const [ax, az, bx, bz] of pieces(pts, closed, 2.5)) {
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (open(mx, mz)) {
        continue;
      }
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 0.05) {
        continue;
      }
      // Extend each piece a little so neighbours overlap at bends.
      const ex = ((bx - ax) / l) * spec.half;
      const ez = ((bz - az) / l) * spec.half;
      const ya = surface.heightAt(ax, az);
      const yb = surface.heightAt(bx, bz);
      const y0 = Math.min(ya, yb) - 0.3;
      if (kind === 'fence') {
        // Railing: post at the piece start, bottom / middle / top rails.
        slab(m, ax - 0.03, az, ax + 0.03, az, 0.03, y0, ya + h + 0.05, ya + h + 0.05, spec.col, spec.layer);
        for (const [lo, hi] of [
          [0.12, 0.16],
          [0.95, 0.99],
          [h - 0.05, h],
        ]) {
          beam(m, ax - ex, az - ez, bx + ex, bz + ez, 0.02, ya + lo, ya + hi, yb + lo, yb + hi, spec.col, spec.layer);
        }
      } else if (kind === 'hoarding') {
        beam(m, ax - ex, az - ez, bx + ex, bz + ez, spec.half, ya - 0.3, ya + h - 0.55, yb - 0.3, yb + h - 0.55, HOARDING, spec.layer);
        beam(m, ax - ex, az - ez, bx + ex, bz + ez, spec.half + 0.005, ya + h - 0.55, ya + h, yb + h - 0.55, yb + h, HOARDING_BAND, spec.layer);
      } else {
        beam(m, ax - ex, az - ez, bx + ex, bz + ez, spec.half, ya - 0.3, ya + h, yb - 0.3, yb + h, spec.col, spec.layer);
        if (kind === 'wall' || kind === 'retaining') {
          // Coping stones on top.
          beam(m, ax - ex, az - ez, bx + ex, bz + ez, spec.half + 0.05, ya + h, ya + h + 0.08, yb + h, yb + h + 0.08, [0.78, 0.76, 0.72], GROUND_LAYER_INDEX.granite);
        }
      }
      metres += l;
    }
    return metres;
  };

  for (const line of data.lines) {
    let kind = kindOf(line.kind);
    if (!kind || line.pts.length < 4) {
      continue;
    }
    if (kind === 'fence') {
      const n = line.pts.length / 2;
      const mid = Math.floor(n / 2) * 2;
      const site = nearSite(line.pts[mid], line.pts[mid + 1]) ?? nearSite(line.pts[0], line.pts[1]);
      if (site) {
        kind = 'hoarding';
        fenced.add(site);
      }
    }
    const metres = build(kind, line.pts, !!line.closed, kind === 'city' ? Math.min(line.height ?? 7, 9) : line.height);
    const key = kind === 'wall' ? 'walls' : kind === 'city' ? 'cityWalls' : kind === 'retaining' ? 'retaining' : kind === 'fence' ? 'fences' : 'hoardings';
    stats[key] += Math.round(metres);
  }

  // Construction sites without a mapped fence: hoardings along their street sides.
  for (const a of sites) {
    if (fenced.has(a)) {
      continue;
    }
    const r = a.ring;
    const n = r.length / 2;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const mx = (r[k * 2] + r[j * 2]) / 2;
      const mz = (r[k * 2 + 1] + r[j * 2 + 1]) / 2;
      if (surface.distance(mx, mz) < 10) {
        stats.hoardings += Math.round(build('hoarding', [r[k * 2], r[k * 2 + 1], r[j * 2], r[j * 2 + 1]], false));
      }
    }
  }
  return stats;
}
