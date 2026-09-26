import type { GeoQuery, PerchPoint, PerchService } from '../../core/contracts';
import { PERCH_DATA, type PerchData } from './data';
import { resolvePerch } from './resolve';
import { validatePerch } from './rules';
import { wallTowerPerches } from './walls';

export class PerchServiceImpl implements PerchService {
  private readonly byId = new Map<string, PerchPoint>();

  constructor(readonly points: readonly PerchPoint[]) {
    for (const p of points) {
      this.byId.set(p.id, p);
    }
  }

  get(id: string): PerchPoint | undefined {
    return this.byId.get(id);
  }

  nearest(x: number, z: number, maxDistance = Infinity): { point: PerchPoint; distance: number } | null {
    let best: PerchPoint | null = null;
    let bestD = maxDistance;
    for (const p of this.points) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? { point: best, distance: bestD } : null;
  }
}

/**
 * Resolves the catalogue against the world. An entry whose landmark or spec is missing is skipped with an error
 * instead of taking the whole service down; one that breaks the placement rules (rules.ts) is not offered either.
 * The city-wall tower perches are picked by rule from the walls bake's candidates (walls.ts, already validated).
 */
export function buildPerchService(geo: GeoQuery, data: readonly PerchData[] = PERCH_DATA, walls = true): PerchServiceImpl {
  const points: PerchPoint[] = [];
  for (const d of data) {
    try {
      const p = resolvePerch(geo, d);
      const broken = validatePerch(geo, p);
      if (broken.length > 0) {
        console.warn(`[perches] ${d.id} skipped: ${broken.join('; ')}`);
        continue;
      }
      points.push(p);
    } catch (e) {
      console.error(`[perches] ${d.id} skipped`, e);
    }
  }
  if (walls) {
    try {
      points.push(...wallTowerPerches(geo).map((w) => w.point));
    } catch (e) {
      console.error('[perches] wall towers skipped', e);
    }
  }
  return new PerchServiceImpl(points);
}
