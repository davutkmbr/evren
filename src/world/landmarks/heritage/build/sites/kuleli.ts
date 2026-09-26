import { KULELI_FOOTPRINTS } from '../../data/others';
import { centroid, obb, type V2 } from '../geom';
import { Facade } from '../surfaces';
import type { SiteContext } from '../site';
import { coastRuns, footprintBuilding, M, quay } from './common';
import { squareTower } from '../prims/fort';
import { pyramidRoof } from '../prims/roofs';
import { rectRing } from '../geom';

/**
 * Kuleli Askerî Lisesi (1845, rebuilt 1871): long neoclassical school block on the Çengelköy shore, three floors
 * under a lead hip roof, with the two slender towers that give it its name at the ends of the sea front, each with a
 * tall pyramidal spire; a stone quay in front.
 */
export function buildKuleli(ctx: SiteContext): void {
  const ring = ctx.ring(KULELI_FOOTPRINTS[0].ll);
  const c = centroid(ring);
  ctx.chunk('main', c[0], c[1]);
  const gr = ctx.groundRange(ring);
  const base = gr.max;
  const wallH = 17;
  footprintBuilding(ctx, ring, {
    base,
    wallH,
    wall: M.plasterWhite,
    facade: Facade.Barracks,
    plinth: 1.6,
    plinthMat: M.ashlar,
    cornice: { h: 0.8, proj: 0.5, mat: M.stucco },
    roof: 'hip',
    roofMat: M.lead,
    pitchDeg: 18,
  });
  // The two towers at the ends of the long axis, on the sea side of the block.
  const b = obb(ring);
  const ax: V2 = [Math.cos(b.angle), Math.sin(b.angle)];
  const sd: V2 = [-ax[1], ax[0]];
  const sea = ctx.coast(c[0] + sd[0] * 30, c[1] + sd[1] * 30) < ctx.coast(c[0] - sd[0] * 30, c[1] - sd[1] * 30) ? 1 : -1;
  for (const end of [-1, 1]) {
    const tc: V2 = [b.cx + ax[0] * end * (b.len / 2 - 4.5) + sd[0] * sea * (b.wid / 2 - 4.5), b.cz + ax[1] * end * (b.len / 2 - 4.5) + sd[1] * sea * (b.wid / 2 - 4.5)];
    const h = 31;
    squareTower(ctx.mb, tc[0], tc[1], -b.angle, 8.5, 8.5, base, h, M.plasterWhite, M.lead, ctx.lod, null, 2);
    const top = pyramidRoof(ctx.mb, rectRing(tc[0], tc[1], 9.2, 9.2, b.angle), base + h, 11, M.lead, { overhang: 0.4, soffitMat: M.stucco });
    ctx.boxCollider(tc[0], tc[1], 8.5, 8.5, b.angle, base - 1, top);
  }
  quay(ctx, coastRuns(ctx, c[0], c[1], 90), { top: 1.4, thick: 2.2, mat: M.ashlarLight, topMat: M.ashlar, rail: 'railing', lamps: 20 });
}
