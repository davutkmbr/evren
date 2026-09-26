import { TOPKAPI_FOOTPRINTS } from '../../data/topkapi';
import { centroid, obb, signedArea, type V2 } from '../geom';
import { Facade } from '../surfaces';
import type { SiteContext } from '../site';
import { footprintBuilding, M, minaret, ottomanHall } from './common';
import { chimney, dome } from '../prims/details';
import { roundTower, squareTower } from '../prims/fort';
import { prism, regularRing } from '../prims/basic';

/** Footprints smaller than this (m²) are gate piers and wall stubs the city-wall bake draws. */
const MIN_AREA = 30;

type Kind = 'kitchens' | 'justice' | 'gate-towers' | 'gate' | 'kiosk' | 'domed-kiosk' | 'european' | 'treasury' | 'mosque' | 'harem' | 'canopy' | 'hall';

/** Building type from the OSM name / kind (data/topkapi.ts). */
function kindOf(name: string | undefined, osmKind: string | undefined): Kind {
  const n = (name ?? '').toLocaleLowerCase('tr');
  if (osmKind === 'mosque' || /cami/.test(n)) return 'mosque';
  if (osmKind === 'roof') return 'canopy';
  if (/mutfak/.test(n)) return 'kitchens';
  if (/adalet/.test(n)) return 'justice';
  if (/bâbüsselâm|babusselam/.test(n)) return 'gate-towers';
  if (/bâbüssaâde|babussaade/.test(n)) return 'gate';
  if (/bağdad|revan/.test(n)) return 'domed-kiosk';
  if (/mecidiye/.test(n)) return 'european';
  if (/fatih köşkü|hazine/.test(n)) return 'treasury';
  if (/köşk|arz odası|kütüphane/.test(n)) return 'kiosk';
  if (/harem/.test(n)) return 'harem';
  return 'hall';
}

/**
 * Topkapı Sarayı (1478, Mehmed II): the palace's courts on Sarayburnu, built from the OSM buildings inside the
 * landmark polygon (data/topkapi.ts), each by its type: the kitchens' row of domes and chimneys, the Adalet Kulesi
 * over the Divan, the Bâbüsselâm gate between its two conical towers, the broad-eaved Bâbüssaâde, domed and
 * broad-eaved kiosks, the treasury under its domes, the Harem and the plastered halls under lead hip roofs.
 * The outer walls (Sur-u Sultani) come from the city-wall bake.
 */
export function buildTopkapi(ctx: SiteContext): void {
  const site = centroid(TOPKAPI_FOOTPRINTS.flatMap((f) => ctx.ring(f.ll)));
  for (const fp of TOPKAPI_FOOTPRINTS) {
    const ring = ctx.ring(fp.ll);
    if (ring.length < 3 || Math.abs(signedArea(ring)) < MIN_AREA) {
      continue;
    }
    const c = centroid(ring);
    ctx.chunk(fp.key, c[0], c[1]);
    const b = obb(ring);
    const base = ctx.groundRange(ring).max;
    switch (kindOf(fp.name, fp.kind)) {
      case 'kitchens': {
        // Ten kitchen bays, each under a dome with a tall chimney on its crown.
        footprintBuilding(ctx, ring, { base, wallH: 8, wall: M.ashlarLight, facade: null, plinth: 0.6, plinthMat: M.ashlar, roof: 'terrace', roofMat: M.lead });
        const ax: V2 = [Math.cos(b.angle), Math.sin(b.angle)];
        const count = Math.max(2, Math.round(b.len / 13));
        const r = Math.min(4.8, b.len / count / 2 - 0.5, b.wid / 2 - 1);
        for (let i = 0; i < count; i++) {
          const l = -b.len / 2 + (b.len / count) * (i + 0.5);
          const x = b.cx + ax[0] * l;
          const z = b.cz + ax[1] * l;
          const crown = dome(ctx.mb, x, z, base + 8, { r, rise: r * 0.8, mat: M.lead, drum: { h: 1.2, sides: 8, mat: M.ashlarLight } }, ctx.lod);
          chimney(ctx.mb, x, z, crown - 0.3, 5.5, 0.9, M.ashlarLight, M.lead, ctx.lod);
        }
        break;
      }
      case 'justice': {
        // Adalet Kulesi: stone shaft, the octagonal lantern storey with its windows, lead spire (41 m).
        const w = Math.max(6.5, Math.min(b.len, b.wid));
        squareTower(ctx.mb, b.cx, b.cz, -b.angle, w, w, base, 24, M.ashlarLight, M.lead, ctx.lod, null, 2);
        const oct = regularRing(b.cx, b.cz, w * 0.52, 8, Math.PI / 8);
        prism(ctx.mb, oct, base + 24, base + 33, M.plasterWhite, { cap: true, capMat: M.lead });
        const top = roundTower(ctx.mb, b.cx, b.cz, base + 33, { r: w * 0.5, h: 0.4, seg: 8, mat: M.lead, topMat: M.lead, flat: true, cone: { rise: 8, overhang: 0.6, mat: M.lead }, sink: 0 }, ctx.lod);
        ctx.boxCollider(b.cx, b.cz, w, w, b.angle, base - 1, top);
        break;
      }
      case 'gate-towers': {
        ottomanHall(ctx, ring, { base, wallH: 11, overhang: 1.6 });
        // The two octagonal towers stand at the outer corners (away from the palace courts).
        const out: V2 = [c[0] - site[0], c[1] - site[1]];
        const ol = Math.hypot(out[0], out[1]) || 1;
        const corners = [...ring].sort((p, q) => (q[0] * out[0] + q[1] * out[1]) / ol - (p[0] * out[0] + p[1] * out[1]) / ol).slice(0, 2);
        for (const p of corners) {
          const top = roundTower(ctx.mb, p[0], p[1], base, { r: 3.6, h: 17, seg: 8, flat: true, mat: M.ashlarLight, topMat: M.ashlar, cone: { rise: 8, overhang: 0.4, mat: M.lead }, sink: 2 }, ctx.lod);
          ctx.collider({ kind: 'cylinder', x: p[0], y: base - 1, z: p[1], r: 3.8, h: top - base + 1 });
        }
        break;
      }
      case 'gate':
        ottomanHall(ctx, ring, { base, wallH: 9, overhang: 3.2, pitch: 16 });
        break;
      case 'domed-kiosk': {
        const eave = ottomanHall(ctx, ring, { base, wallH: 7, overhang: 2.6, pitch: 14, wall: M.marble });
        const r = Math.min(b.len, b.wid) * 0.28;
        dome(ctx.mb, b.cx, b.cz, eave + 1.2, { r, rise: r * 0.9, mat: M.lead, drum: { h: 2.2, sides: 8, mat: M.marble }, alem: 1.4, alemMat: M.gold }, ctx.lod);
        break;
      }
      case 'kiosk':
        ottomanHall(ctx, ring, { base, wallH: 7, overhang: 2.4, pitch: 15 });
        break;
      case 'european':
        footprintBuilding(ctx, ring, { base, wallH: 12, wall: M.plasterWhite, facade: Facade.PalacePlaster, plinth: 1.2, plinthMat: M.marbleWarm, cornice: { h: 0.7, proj: 0.4, mat: M.stucco }, roof: 'hip', roofMat: M.lead, pitchDeg: 18 });
        break;
      case 'treasury': {
        footprintBuilding(ctx, ring, { base, wallH: 8, wall: M.ashlarLight, facade: Facade.OttomanHall, plinth: 0.8, plinthMat: M.ashlar, roof: 'terrace', roofMat: M.lead });
        const ax: V2 = [Math.cos(b.angle), Math.sin(b.angle)];
        const count = Math.max(1, Math.round(b.len / 14));
        const r = Math.min(6, b.len / count / 2 - 0.6, b.wid / 2 - 0.8);
        for (let i = 0; i < count; i++) {
          const l = -b.len / 2 + (b.len / count) * (i + 0.5);
          dome(ctx.mb, b.cx + ax[0] * l, b.cz + ax[1] * l, base + 8, { r, rise: r * 0.85, mat: M.lead, drum: { h: 1, sides: 8, mat: M.ashlarLight }, alem: 1.2, alemMat: M.gold }, ctx.lod);
        }
        break;
      }
      case 'mosque': {
        const eave = ottomanHall(ctx, ring, { base, wallH: 8, overhang: 1.2, roof: 'flat' });
        const r = Math.min(b.len, b.wid) * 0.36;
        dome(ctx.mb, b.cx, b.cz, eave, { r, rise: r * 0.9, mat: M.lead, drum: { h: 1.6, sides: 8, mat: M.ashlarLight }, alem: 1.6, alemMat: M.gold }, ctx.lod);
        if (Math.abs(signedArea(ring)) > 120) {
          const corner = ring.reduce((p, q) => (q[0] + q[1] > p[0] + p[1] ? q : p));
          minaret(ctx, corner[0], corner[1], base, 22, 1.2);
        }
        break;
      }
      case 'harem':
        footprintBuilding(ctx, ring, { base, wallH: 12, wall: M.plasterWhite, facade: Facade.Harem, plinth: 1.2, plinthMat: M.ashlar, roof: 'flat', roofMat: M.lead, pitchDeg: 18 });
        break;
      case 'canopy':
        ottomanHall(ctx, ring, { base, wallH: 5, facade: null, wall: M.marble, overhang: 1.8, pitch: 14 });
        break;
      default:
        ottomanHall(ctx, ring, { base, wallH: 8, wall: M.plasterWhite, overhang: 1.8 });
    }
  }
}
