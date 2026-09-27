import { AYA_YORGI_FOOTPRINTS } from '../../data/others';
import { centroid, obb, rectRing, type V2 } from '../geom';
import { Facade } from '../surfaces';
import type { SiteContext } from '../site';
import { footprintBuilding, M } from './common';
import { box, lathe } from '../prims/basic';
import { squareTower } from '../prims/fort';
import { pyramidRoof } from '../prims/roofs';

/**
 * Aya Yorgi Manastırı on Yücetepe, Büyükada's summit (OSM way 746217504): the church of 1905–1909 (architect
 * Kapetanakis) in cut stone under a tile roof, with a round apse to the east and the bell tower seen from all over the
 * island at its west front; the old church of 1751, two storeys under a tile roof; and the whitewashed monastery ranges
 * around the courtyard. Footprints from OpenStreetMap; heights and roofs assigned here.
 */
export function buildAyaYorgi(ctx: SiteContext): void {
  const fp = new Map(AYA_YORGI_FOOTPRINTS.map((f) => [f.key, ctx.ring(f.ll)]));
  const church = fp.get('church')!;
  const c = centroid(church);
  ctx.chunk('main', c[0], c[1]);

  // The church: cut stone, gable tile roof along its long (east–west) axis.
  const base = ctx.groundRange(church).max;
  const wallH = 8.2;
  footprintBuilding(ctx, church, {
    base,
    wallH,
    wall: M.ashlarLight,
    facade: Facade.OttomanHall2,
    plinth: 0.8,
    plinthMat: M.ashlar,
    cornice: { h: 0.4, proj: 0.25, mat: M.ashlar },
    roof: 'gable',
    roofMat: M.tile,
    pitchDeg: 26,
  });
  const b = obb(church);
  // Long axis pointing east (+x).
  const east = Math.cos(b.angle) >= 0 ? 1 : -1;
  const ax: V2 = [Math.cos(b.angle) * east, Math.sin(b.angle) * east];

  // Apse: a half-round drum at the east end under a low tile cone.
  const ar = Math.min(3.2, b.wid * 0.3);
  const ac: V2 = [b.cx + ax[0] * (b.len / 2), b.cz + ax[1] * (b.len / 2)];
  const apseH = wallH * 0.78;
  lathe(ctx.mb, ac[0], ac[1], [[ar, base - 1], [ar, base + apseH]], M.ashlarLight, { seg: 14 });
  lathe(ctx.mb, ac[0], ac[1], [[ar + 0.3, base + apseH], [0, base + apseH + 1.6]], M.tile, { seg: 14 });
  ctx.collider({ kind: 'cylinder', x: ac[0], y: base - 1, z: ac[1], r: ar, h: apseH + 2.6 });

  // Bell tower in front of the west door: stone shaft, belfry with an opening on each face, tile pyramid, iron cross.
  const tw = 4.2;
  const tc: V2 = [b.cx - ax[0] * (b.len / 2 + tw / 2 - 0.4), b.cz - ax[1] * (b.len / 2 + tw / 2 - 0.4)];
  const shaft = 12.2;
  const belfry = 3.4;
  const yaw = -Math.atan2(ax[1], ax[0]);
  squareTower(ctx.mb, tc[0], tc[1], yaw, tw, tw, base, shaft + belfry, M.ashlarLight, M.ashlar, ctx.lod, null, 1.5);
  // Cornice band between shaft and belfry, and the openings (dark insets through the belfry, both axes).
  box(ctx.mb, tc[0], base + shaft, tc[1], tw + 0.35, 0.3, tw + 0.35, yaw, M.ashlar, { top: true, bottom: true });
  if (ctx.lod === 0) {
    box(ctx.mb, tc[0], base + shaft + 0.6, tc[1], tw + 0.06, 2.2, 1.2, yaw, M.void, { top: false, bottom: false });
    box(ctx.mb, tc[0], base + shaft + 0.6, tc[1], 1.2, 2.2, tw + 0.06, yaw, M.void, { top: false, bottom: false });
  }
  const roofY = base + shaft + belfry;
  const top = pyramidRoof(ctx.mb, rectRing(tc[0], tc[1], tw + 0.5, tw + 0.5, Math.atan2(ax[1], ax[0])), roofY, 3.2, M.tile, { overhang: 0.3, soffitMat: M.ashlar });
  box(ctx.mb, tc[0], top - 0.1, tc[1], 0.14, 1.6, 0.14, yaw, M.iron, { top: true });
  box(ctx.mb, tc[0], top + 0.9, tc[1], 0.8, 0.12, 0.12, yaw, M.iron, { top: true, bottom: true });
  ctx.boxCollider(tc[0], tc[1], tw, tw, Math.atan2(ax[1], ax[0]), base - 1, top);

  // The old church (1751): two storeys, whitewashed, tile hip roof.
  footprintBuilding(ctx, fp.get('old-church')!, {
    wallH: 6.8,
    wall: M.plasterWhite,
    facade: Facade.Harem,
    plinth: 0.6,
    plinthMat: M.ashlar,
    roof: 'hip',
    roofMat: M.tile,
    pitchDeg: 24,
  });
  // The monastery ranges: whitewashed, one or two storeys by size, tile hip roofs.
  for (const f of AYA_YORGI_FOOTPRINTS) {
    if (f.key === 'church' || f.key === 'old-church') continue;
    const ring = fp.get(f.key)!;
    const ob = obb(ring);
    const area = ob.len * ob.wid;
    footprintBuilding(ctx, ring, {
      wallH: area > 90 ? 6.2 : area > 20 ? 3.6 : 2.8,
      wall: M.plasterWhite,
      facade: area > 20 ? Facade.Harem : null,
      plinth: 0.5,
      plinthMat: M.ashlar,
      roof: 'hip',
      roofMat: M.tile,
      pitchDeg: 24,
      overhang: 0.5,
    });
  }
}
