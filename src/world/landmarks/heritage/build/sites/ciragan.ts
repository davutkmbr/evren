import { CIRAGAN_FOOTPRINTS } from '../../data/others';
import { centroid } from '../geom';
import { Facade } from '../surfaces';
import type { SiteContext } from '../site';
import { coastRuns, footprintBuilding, M, quay } from './common';

/**
 * Çırağan Sarayı (1871, Nigoğos Balyan; restored as a hotel): long white marble palace on the Beşiktaş shore, three
 * floors under a flat roof with a balustrade, the later hotel wing beside it, and the marble quay with lamps.
 */
export function buildCiragan(ctx: SiteContext): void {
  const [palace, hotel] = CIRAGAN_FOOTPRINTS;
  const pr = ctx.ring(palace.ll);
  const c = centroid(pr);
  ctx.chunk('main', c[0], c[1]);
  footprintBuilding(ctx, pr, {
    wallH: 19,
    wall: M.marble,
    facade: Facade.PalaceMarble,
    plinth: 2.4,
    plinthMat: M.marbleWarm,
    cornice: { h: 1.2, proj: 0.6, mat: M.marbleWarm },
    roof: 'terrace',
    roofMat: M.lead,
    balustrade: { h: 1.1, mat: M.balustrade, coping: M.marble },
  });
  if (hotel) {
    const hr = ctx.ring(hotel.ll);
    const hc = centroid(hr);
    ctx.chunk('hotel', hc[0], hc[1]);
    footprintBuilding(ctx, hr, {
      wallH: 22,
      wall: M.plasterWhite,
      facade: Facade.PalacePlaster,
      plinth: 1.2,
      plinthMat: M.marbleWarm,
      cornice: { h: 0.8, proj: 0.4, mat: M.stucco },
      roof: 'flat',
      roofMat: M.lead,
      pitchDeg: 14,
    });
  }
  ctx.chunk('main', c[0], c[1]);
  quay(ctx, coastRuns(ctx, c[0], c[1], 200), { top: 1.6, thick: 2.6, mat: M.ashlarLight, topMat: M.marbleWarm, rail: 'balustrade', lamps: 16 });
}
