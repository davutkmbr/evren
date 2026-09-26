import { SELIMIYE_CORNERS } from '../../data/sites';
import { centroid, obb, offsetRing, rectRing, type V2 } from '../geom';
import { Facade } from '../surfaces';
import type { SiteContext } from '../site';
import { footprintBuilding, M } from './common';
import { squareTower } from '../prims/fort';
import { pyramidRoof } from '../prims/roofs';

/** Wing depth (m), wall height and corner tower size / height of the barracks. */
const WING = 24;
const WALL_H = 18;
const TOWER = 17;
const TOWER_H = 27;

/**
 * Selimiye Kışlası (1800 / 1828, Krikor Balyan): the great barracks above Harem, a rectangle of three-storey wings
 * round a parade court, a tower with a lead pyramid roof at each corner (the one holding the Florence Nightingale
 * museum among them).
 */
export function buildSelimiye(ctx: SiteContext): void {
  const outer = ctx.ring(SELIMIYE_CORNERS);
  const b = obb(outer);
  const c = centroid(outer);
  const ax: V2 = [Math.cos(b.angle), Math.sin(b.angle)];
  const sd: V2 = [-ax[1], ax[0]];
  const at = (l: number, s: number): V2 => [b.cx + ax[0] * l + sd[0] * s, b.cz + ax[1] * l + sd[1] * s];
  // Four wings (long sides full length, short sides between them), each on its own ground level.
  const wings: { cx: V2; len: number; wid: number; ang: number }[] = [
    { cx: at(0, -b.wid / 2 + WING / 2), len: b.len, wid: WING, ang: b.angle },
    { cx: at(0, b.wid / 2 - WING / 2), len: b.len, wid: WING, ang: b.angle },
    { cx: at(-b.len / 2 + WING / 2, 0), len: b.wid - 2 * WING, wid: WING, ang: b.angle + Math.PI / 2 },
    { cx: at(b.len / 2 - WING / 2, 0), len: b.wid - 2 * WING, wid: WING, ang: b.angle + Math.PI / 2 },
  ];
  wings.forEach((w, i) => {
    ctx.chunk(`wing${i}`, w.cx[0], w.cx[1]);
    footprintBuilding(ctx, rectRing(w.cx[0], w.cx[1], w.len, w.wid, w.ang), {
      wallH: WALL_H,
      wall: M.plasterCream,
      facade: Facade.Barracks,
      plinth: 1.4,
      plinthMat: M.ashlar,
      cornice: { h: 0.7, proj: 0.45, mat: M.stucco },
      roof: 'hip',
      roofMat: M.tile,
      pitchDeg: 22,
    });
  });
  for (const [sl, ss] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const tc = at(sl * (b.len / 2 - TOWER / 2 + 1.5), ss * (b.wid / 2 - TOWER / 2 + 1.5));
    ctx.chunk('main', c[0], c[1]);
    const g = ctx.groundRange(rectRing(tc[0], tc[1], TOWER, TOWER, b.angle)).max;
    squareTower(ctx.mb, tc[0], tc[1], -b.angle, TOWER, TOWER, g, TOWER_H, M.plasterCream, M.lead, ctx.lod, null, 3);
    const top = pyramidRoof(ctx.mb, offsetRing(rectRing(tc[0], tc[1], TOWER, TOWER, b.angle), 0.5), g + TOWER_H, 7, M.lead, { overhang: 0.3, soffitMat: M.stucco });
    ctx.boxCollider(tc[0], tc[1], TOWER, TOWER, b.angle, g - 1, top);
  }
}
