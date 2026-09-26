import { SIRKECI_RECT } from '../../data/sites';
import { centroid, headingDir, obb, rectRing, type V2 } from '../geom';
import { Facade } from '../surfaces';
import type { SiteContext } from '../site';
import { footprintBuilding, M } from './common';
import { squareTower } from '../prims/fort';
import { pyramidRoof } from '../prims/roofs';

/**
 * Sirkeci Garı (1890, August Jachmund): the orientalist terminus of the Orient Express, a long two-storey block of
 * cream stone with brick banding, the taller entrance pavilion in the middle flanked by two slim clock turrets, and
 * end pavilions.
 */
export function buildSirkeci(ctx: SiteContext): void {
  const ring = ctx.ring(SIRKECI_RECT);
  const b = obb(ring);
  const c = centroid(ring);
  ctx.chunk('main', c[0], c[1]);
  const base = ctx.groundRange(ring).max;
  footprintBuilding(ctx, ring, {
    base,
    wallH: 11,
    wall: M.plasterCream,
    facade: Facade.StationOrientalist,
    plinth: 1.0,
    plinthMat: M.ashlar,
    cornice: { h: 0.7, proj: 0.4, mat: M.brick },
    roof: 'hip',
    roofMat: M.tile,
    pitchDeg: 16,
  });
  const ax: V2 = [Math.cos(b.angle), Math.sin(b.angle)];
  const sd: V2 = [-ax[1], ax[0]];
  // The front faces the landmark heading: pavilions stand forward on that side.
  const f = headingDir(ctx.def.headingDeg);
  const front = sd[0] * f[0] + sd[1] * f[1] >= 0 ? 1 : -1;
  const pav = (l: number, len: number, h: number): void => {
    const pc: V2 = [b.cx + ax[0] * l + sd[0] * front * 1.5, b.cz + ax[1] * l + sd[1] * front * 1.5];
    footprintBuilding(ctx, rectRing(pc[0], pc[1], len, b.wid + 3, b.angle), {
      base,
      wallH: h,
      wall: M.plasterCream,
      facade: Facade.StationOrientalist,
      plinth: 1.0,
      plinthMat: M.ashlar,
      cornice: { h: 0.8, proj: 0.5, mat: M.brick },
      roof: 'hip',
      roofMat: M.tile,
      pitchDeg: 20,
    });
  };
  pav(0, 20, 15);
  pav(-b.len / 2 + 7, 14, 13);
  pav(b.len / 2 - 7, 14, 13);
  // Clock turrets at the front corners of the entrance pavilion.
  for (const s of [-1, 1]) {
    const tc: V2 = [b.cx + ax[0] * s * 11 + sd[0] * front * (b.wid / 2 + 3), b.cz + ax[1] * s * 11 + sd[1] * front * (b.wid / 2 + 3)];
    squareTower(ctx.mb, tc[0], tc[1], -b.angle, 3.6, 3.6, base, 19, M.plasterCream, M.tile, ctx.lod, null, 1);
    const top = pyramidRoof(ctx.mb, rectRing(tc[0], tc[1], 4.2, 4.2, b.angle), base + 19, 4.5, M.lead, { overhang: 0.3, soffitMat: M.wood });
    ctx.boxCollider(tc[0], tc[1], 3.6, 3.6, b.angle, base - 1, top);
  }
}
