import { BEYLERBEYI_FOOTPRINTS } from '../../data/others';
import { centroid, obb, rectRing, type V2 } from '../geom';
import { Facade } from '../surfaces';
import type { SiteContext } from '../site';
import { footprintBuilding, coastRuns, M, nearestOnRuns, quay } from './common';
import { pyramidRoof } from '../prims/roofs';
import { facadeWalls } from '../prims/building';
import { prism } from '../prims/basic';
import { alem } from '../prims/details';

/**
 * Beylerbeyi Sarayı (1865, Sarkis & Agop Balyan): white marble summer palace on the Asian shore just north of the
 * 15 Temmuz bridge. Main block (basement + two floors), marble quay with two tented sea pavilions.
 */
export function buildBeylerbeyi(ctx: SiteContext): void {
  const fp = BEYLERBEYI_FOOTPRINTS[0];
  const ring = ctx.ring(fp.ll);
  const c = centroid(ring);
  ctx.chunk('main', c[0], c[1]);
  const top = footprintBuilding(ctx, ring, {
    wallH: 17.2,
    wall: M.marble,
    facade: Facade.PalaceBeylerbeyi,
    plinth: 3.0,
    plinthMat: M.marbleWarm,
    cornice: { h: 1.1, proj: 0.55, mat: M.stucco },
    roof: 'flat',
    roofMat: M.lead,
    pitchDeg: 16,
    balustrade: null,
  });
  void top;

  // Quay and sea pavilions (Harem and Selamlık deniz köşkleri) at both ends of the waterfront.
  const runs = coastRuns(ctx, c[0], c[1], 170);
  quay(ctx, runs, { top: 1.6, thick: 2.4, mat: M.ashlarLight, topMat: M.marbleWarm, rail: 'balustrade', lamps: 18 });
  const b = obb(ring);
  const ax: V2 = [Math.cos(b.angle), Math.sin(b.angle)];
  for (const side of [-1, 1]) {
    const target: V2 = [c[0] + ax[0] * side * (b.len / 2 + 30), c[1] + ax[1] * side * (b.len / 2 + 30)];
    const spot = nearestOnRuns(runs, target);
    if (!spot) {
      continue;
    }
    const [p, n] = spot;
    const kc: V2 = [p[0] - n[0] * 7.5, p[1] - n[1] * 7.5];
    const ang = Math.atan2(n[1], n[0]);
    const k = rectRing(kc[0], kc[1], 11, 11, ang);
    const g = Math.max(ctx.groundOrSea(kc[0], kc[1]), 1.6);
    ctx.chunk('main', c[0], c[1]);
    prism(ctx.mb, k, g - 3, g + 1.2, M.marbleWarm, { cap: false, vRef: g - 3 });
    facadeWalls(ctx.mb, k, g + 1.2, g + 7.5, M.marble, Facade.PalaceBeylerbeyi);
    const apex = pyramidRoof(ctx.mb, k, g + 7.5, 5.2, M.lead, { overhang: 1.2, soffitMat: M.stucco });
    if (ctx.lod === 0) {
      alem(ctx.mb, kc[0], kc[1], apex - 0.1, 1.6, M.gold);
    }
    ctx.boxCollider(kc[0], kc[1], 11, 11, ang, g - 1, apex);
  }
}
