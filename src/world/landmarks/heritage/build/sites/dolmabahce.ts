import { DOLMABAHCE_FOOTPRINTS } from '../../data/dolmabahce';
import { centroid, obb } from '../geom';
import { Facade } from '../surfaces';
import type { SiteContext } from '../site';
import { coastRuns, footprintBuilding, M, quay, type FootprintOptions } from './common';
import { dome } from '../prims/details';
import { squareTower } from '../prims/fort';

type Kind = 'hall' | 'palace' | 'wing' | 'gate' | 'kiosk' | 'service' | 'tower';

/** How each footprint is built (keys of DOLMABAHCE_FOOTPRINTS; anything else is a service building). */
const KINDS: Record<string, Kind> = {
  muayede: 'hall',
  selamlik: 'palace',
  harem: 'palace',
  veliaht: 'wing',
  musahiban: 'wing',
  'hazine-i-hassa': 'wing',
  mefrusat: 'wing',
  'saat-kulesi': 'tower',
  'saltanat-kapisi': 'gate',
  'hazine-kapisi': 'gate',
  'koltuk-kapisi': 'gate',
  'camli-kosk': 'kiosk',
  kusluk: 'kiosk',
};

const MARBLE: Omit<FootprintOptions, 'wallH'> = {
  wall: M.marble,
  facade: Facade.PalaceMarble,
  plinth: 2.2,
  plinthMat: M.marbleWarm,
  cornice: { h: 1.2, proj: 0.6, mat: M.marbleWarm },
  roof: 'terrace',
  roofMat: M.lead,
  balustrade: { h: 1.1, mat: M.balustrade, coping: M.marble },
};

/**
 * Dolmabahçe Sarayı (1856, Garabet & Nigoğos Balyan): the Selamlık and Harem in white marble with balustraded
 * roofs, the Muayede (ceremonial) hall between them under its great dome, the crown prince's and service wings,
 * the monumental gates and the clock tower, all along a 600 m marble quay.
 */
export function buildDolmabahce(ctx: SiteContext): void {
  for (const fp of DOLMABAHCE_FOOTPRINTS) {
    const ring = ctx.ring(fp.ll);
    const c = centroid(ring);
    ctx.chunk(fp.key, c[0], c[1]);
    const kind = KINDS[fp.key] ?? 'service';
    const b = obb(ring);
    switch (kind) {
      case 'hall': {
        const base = ctx.groundRange(ring).max;
        const wallH = 24;
        footprintBuilding(ctx, ring, { ...MARBLE, base, wallH });
        const r = Math.min(18, b.wid * 0.3);
        const crown = dome(ctx.mb, b.cx, b.cz, base + wallH + 1.1, { r, rise: r * 0.72, mat: M.lead, drum: { h: 4, sides: 16, mat: M.marble }, alem: 3 }, ctx.lod);
        ctx.collider({ kind: 'cylinder', x: b.cx, y: base + wallH, z: b.cz, r, h: crown - base - wallH });
        break;
      }
      case 'palace':
        footprintBuilding(ctx, ring, { ...MARBLE, wallH: 20 });
        break;
      case 'wing':
        footprintBuilding(ctx, ring, { ...MARBLE, wall: M.plasterWhite, facade: Facade.PalacePlaster, wallH: 15, roof: 'flat', balustrade: null, pitchDeg: 16 });
        break;
      case 'kiosk':
        footprintBuilding(ctx, ring, { ...MARBLE, wallH: 8, plinth: 1.2 });
        break;
      case 'gate': {
        const base = ctx.groundRange(ring).max;
        footprintBuilding(ctx, ring, { ...MARBLE, base, wallH: 14, facade: null, balustrade: null, roof: 'terrace' });
        if (ctx.lod === 0 && fp.key === 'saltanat-kapisi') {
          dome(ctx.mb, b.cx, b.cz, base + 14, { r: 2.2, rise: 2.4, mat: M.lead, alem: 1.4, alemMat: M.gold }, ctx.lod);
        }
        break;
      }
      case 'tower': {
        // Clock tower: four tapering stages with a lead cupola.
        const base = ctx.groundRange(ring).max;
        let y = base;
        let w = Math.min(b.len, b.wid);
        for (const [h, k] of [[9, 1], [8, 0.86], [6, 0.74], [3, 0.62]] as const) {
          squareTower(ctx.mb, b.cx, b.cz, -b.angle, w * k, w * k, y, h, M.marble, M.lead, ctx.lod, null, y === base ? 1.5 : 0.1);
          y += h;
        }
        w *= 0.62;
        const crown = dome(ctx.mb, b.cx, b.cz, y, { r: w / 2, rise: w * 0.55, mat: M.lead, alem: 1.2, alemMat: M.gold }, ctx.lod);
        ctx.boxCollider(b.cx, b.cz, b.len, b.wid, b.angle, base - 1, crown);
        break;
      }
      default:
        footprintBuilding(ctx, ring, { ...MARBLE, wall: M.plasterCream, facade: Facade.PalacePlaster, wallH: 11, roof: 'hip', roofMat: M.lead, balustrade: null, cornice: { h: 0.6, proj: 0.4, mat: M.stucco }, pitchDeg: 20 });
    }
  }
  // Marble quay along the whole front.
  const all = DOLMABAHCE_FOOTPRINTS.flatMap((f) => ctx.ring(f.ll));
  const c = centroid(all);
  ctx.chunk('quay', c[0], c[1]);
  quay(ctx, coastRuns(ctx, c[0], c[1], 360), { top: 1.8, thick: 3, mat: M.marbleWarm, topMat: M.marble, rail: 'balustrade', lamps: 14 });
}
