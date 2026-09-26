import { RUMELI_CURTAIN, RUMELI_GREAT_TOWERS, RUMELI_SMALL_TOWERS, type TowerSpot } from '../../data/fortresses';
import { centroid, offsetRing } from '../geom';
import type { SiteContext } from '../site';
import { dim, M } from './common';

/** Masonry for the city-wall material (registry.ts WALL_MATERIAL_SITES): no floodlight channel. */
const RUBBLE = dim(M.rubble, 0);
const ASHLAR = dim(M.ashlar, 0);
const ASHLAR_GREY = dim(M.ashlarGrey, 0);
const LEAD = dim(M.lead, 0);
import { curtainWall, roundTower, samplePath, type MerlonSpec } from '../prims/fort';

/** Curtain thickness and height above the ground (m), crenellation. */
const THICK = 4.5;
const CURTAIN_H = 11;
const MERLONS: MerlonSpec = { w: 1.3, gap: 0.9, h: 1.5, depth: 0.8 };

/**
 * Rumeli Hisarı (1452, Mehmed II): the fortress on the steep European shore at the Bosphorus' narrowest point. A
 * crenellated curtain climbs the hillside between the three great towers (Saruca, Halil and Zağanos Paşa, each under
 * a lead cone) and ten smaller round towers. Plan from OpenStreetMap, tower sizes from the heritage fact sheets
 * (data/fortresses.ts).
 */
export function buildRumeliHisari(ctx: SiteContext): void {
  const inner = ctx.ring(RUMELI_CURTAIN);
  const c = centroid(inner);
  ctx.chunk('main', c[0], c[1]);
  // The data traces the courtyard face: the wall's centre line lies half its thickness outside.
  const centre = offsetRing(inner, THICK / 2);
  const smp = samplePath(centre, ctx.lod === 0 ? 3 : 8, (x, z) => ctx.groundOrSea(x, z), true);
  curtainWall(
    ctx.mb,
    smp,
    { thick: THICK, height: () => CURTAIN_H, sink: 4, outer: RUBBLE, inner: RUBBLE, top: ASHLAR_GREY, merlons: MERLONS, vMode: 'world' },
    ctx.lod,
  );
  for (let i = 0; i + 1 < smp.length; i += 4) {
    const a = smp[i];
    const b = smp[Math.min(i + 4, smp.length - 1)];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const gy = Math.min(a.ground, b.ground);
    ctx.boxCollider((a.x + b.x) / 2, (a.z + b.z) / 2, len + 0.5, THICK, Math.atan2(b.z - a.z, b.x - a.x), gy - 2, Math.max(a.ground, b.ground) + CURTAIN_H);
  }
  const tower = (t: TowerSpot, great: boolean): void => {
    const [x, z] = ctx.point(t.lat, t.lon);
    let g = Infinity;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g = Math.min(g, ctx.groundOrSea(x + Math.cos(a) * t.r, z + Math.sin(a) * t.r));
    }
    const h = t.h ?? CURTAIN_H + 4;
    const top = roundTower(
      ctx.mb,
      x,
      z,
      g,
      great
        ? { r: t.r, h, seg: ctx.lod === 0 ? 32 : 14, mat: RUBBLE, topMat: ASHLAR_GREY, batter: 0.6, cone: { rise: t.r * 0.95, overhang: 0.5, mat: LEAD }, corbel: true, sink: 5 }
        : { r: t.r, h, seg: ctx.lod === 0 ? 18 : 10, mat: RUBBLE, topMat: ASHLAR_GREY, batter: 0.3, merlons: MERLONS, sink: 4 },
      ctx.lod,
    );
    ctx.collider({ kind: 'cylinder', x, y: g - 2, z, r: t.r + 0.4, h: top - g + 2 });
  };
  for (const t of RUMELI_GREAT_TOWERS) {
    tower(t, true);
  }
  for (const t of RUMELI_SMALL_TOWERS) {
    tower(t, false);
  }
}
