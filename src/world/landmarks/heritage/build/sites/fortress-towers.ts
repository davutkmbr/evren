import { ANADOLU_KEEP, YEDIKULE_TOWERS } from '../../data/fortresses';
import { centroid, obb } from '../geom';
import type { SiteContext } from '../site';
import { dim, M } from './common';

/** Masonry for the city-wall material (registry.ts WALL_MATERIAL_SITES): no floodlight channel. */
const RUBBLE = dim(M.rubble, 0);
const ASHLAR = dim(M.ashlar, 0);
const ASHLAR_GREY = dim(M.ashlarGrey, 0);
const LEAD = dim(M.lead, 0);
import { roundTower, squareTower, type MerlonSpec } from '../prims/fort';

const MERLONS: MerlonSpec = { w: 1.3, gap: 0.9, h: 1.5, depth: 0.8 };

/**
 * Yedikule Hisarı (1458): the three great round towers Mehmed II added to the Theodosian wall's Golden Gate
 * stretch. The pentagonal enclosure, the Byzantine wall towers and the Golden Gate pylons are drawn by the city-wall
 * bake, which leaves these three spots to this builder (data/fortresses.ts HERITAGE_FORTRESS_TOWERS).
 */
export function buildYedikule(ctx: SiteContext): void {
  ctx.chunk('main', ctx.def.x, ctx.def.z);
  for (const t of YEDIKULE_TOWERS) {
    if (t.r <= 0) {
      continue;
    }
    const [x, z] = ctx.point(t.lat, t.lon);
    let g = Infinity;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g = Math.min(g, ctx.groundOrSea(x + Math.cos(a) * t.r, z + Math.sin(a) * t.r));
    }
    const top = roundTower(ctx.mb, x, z, g, { r: t.r, h: t.h ?? 26, seg: ctx.lod === 0 ? 28 : 12, mat: ASHLAR_GREY, topMat: ASHLAR, batter: 0.5, merlons: MERLONS, corbel: true, sink: 4 }, ctx.lod);
    ctx.collider({ kind: 'cylinder', x, y: g - 2, z, r: t.r + 0.4, h: top - g + 2 });
  }
}

/**
 * Anadolu Hisarı (1395, Bayezid I): the square keep (Hisarpeçe) on the rock above the Göksu mouth. The citadel and
 * outer walls with their towers come from the city-wall bake.
 */
export function buildAnadoluHisari(ctx: SiteContext): void {
  const ring = ctx.ring(ANADOLU_KEEP);
  const c = centroid(ring);
  ctx.chunk('main', c[0], c[1]);
  const b = obb(ring);
  const g = ctx.groundRange(ring).min;
  const h = 25;
  squareTower(ctx.mb, b.cx, b.cz, -b.angle, b.len + 0.6, b.wid + 0.6, g, h, RUBBLE, ASHLAR_GREY, ctx.lod, MERLONS, 4);
  ctx.boxCollider(b.cx, b.cz, b.len + 0.6, b.wid + 0.6, b.angle, g - 2, g + h + MERLONS.h);
}
