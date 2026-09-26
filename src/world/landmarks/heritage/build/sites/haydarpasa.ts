import { HAYDARPASA_FOOTPRINTS } from '../../data/others';
import { centroid, headingDir, offsetRing, rectRing, type V2 } from '../geom';
import { Facade } from '../surfaces';
import type { SiteContext } from '../site';
import { footprintBuilding, frontCorners, M } from './common';
import { roundTower } from '../prims/fort';
import { gableRoof } from '../prims/roofs';
import { facadeWalls } from '../prims/building';

/**
 * Haydarpaşa Garı (1908, Otto Ritter & Helmuth Cuno): German neo-Renaissance terminus on its own breakwater at
 * Kadıköy. Stone block of four floors under a steep slate mansard, the sea front (toward the landmark heading) with
 * a round tower under a slate cone at each corner and a gabled centre bay between them.
 */
export function buildHaydarpasa(ctx: SiteContext): void {
  const ring = ctx.ring(HAYDARPASA_FOOTPRINTS[0].ll);
  const c = centroid(ring);
  ctx.chunk('main', c[0], c[1]);
  const gr = ctx.groundRange(ring);
  const base = gr.max;
  const wallH = 24;
  footprintBuilding(ctx, ring, {
    base,
    wallH,
    wall: M.ashlarLight,
    facade: Facade.StationStone,
    plinth: 2.2,
    plinthMat: M.ashlarGrey,
    cornice: { h: 1.0, proj: 0.6, mat: M.ashlar },
    roof: 'mansard',
    roofMat: M.slate,
    mansard: [
      { inset: 1.4, rise: 5.5 },
      { inset: 5, rise: 1.8 },
    ],
  });
  // Sea-front corner towers and the gabled centre bay.
  const f = headingDir(ctx.def.headingDeg);
  // Tower axes 3.5 m in from the front corners (the towers stand proud of both faces).
  const [a, b] = frontCorners(ring, f, 3.5);
  for (const p of [a, b]) {
    const tc: V2 = [p[0] - f[0] * 3.5, p[1] - f[1] * 3.5];
    const top = roundTower(
      ctx.mb,
      tc[0],
      tc[1],
      base,
      { r: 5.6, h: wallH + 6, seg: ctx.lod === 0 ? 24 : 12, mat: M.ashlarLight, topMat: M.ashlar, cone: { rise: 12, overhang: 0.6, mat: M.slate }, sink: 4 },
      ctx.lod,
    );
    ctx.collider({ kind: 'cylinder', x: tc[0], y: base - 2, z: tc[1], r: 6, h: top - base + 2 });
  }
  const mid: V2 = [(a[0] + b[0]) / 2 - f[0] * 4, (a[1] + b[1]) / 2 - f[1] * 4];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  // 14 m wide across the front, 18 m deep: the gable ridge runs toward the sea, its pediment faces it.
  const bay = rectRing(mid[0], mid[1], 14, 18, ang);
  facadeWalls(ctx.mb, offsetRing(bay, 0.3), base + wallH, base + wallH + 7, M.ashlarLight, Facade.StationStone);
  gableRoof(ctx.mb, offsetRing(bay, 0.3), base + wallH + 7, 38, M.slate, M.ashlarLight, 0.5);
}
