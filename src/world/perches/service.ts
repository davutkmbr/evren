import type { GeoQuery, PerchPoint, PerchService } from '../../core/contracts';
import { PERCH_DATA, type PerchData } from './data';
import { resolvePerch } from './resolve';

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
 * instead of taking the whole service down.
 */
export function buildPerchService(geo: GeoQuery, data: readonly PerchData[] = PERCH_DATA): PerchServiceImpl {
  const points: PerchPoint[] = [];
  for (const d of data) {
    try {
      points.push(resolvePerch(geo, d));
    } catch (e) {
      console.error(`[perches] ${d.id} skipped`, e);
    }
  }
  return new PerchServiceImpl(points);
}
