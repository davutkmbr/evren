import { HIPODROM } from '../../data/sites';
import { regularRing, box, lathe } from '../prims/basic';
import { balustrade, colonnade, dome, obelisk } from '../prims/details';
import type { V2 } from '../geom';
import type { SiteContext } from '../site';
import { M } from './common';

/** Iron railing square of half size `r` round (x, z) at ground g. */
function railing(ctx: SiteContext, x: number, z: number, g: number, r: number): void {
  if (ctx.lod !== 0) {
    return;
  }
  const c: V2[] = [
    [x - r, z - r],
    [x + r, z - r],
    [x + r, z + r],
    [x - r, z + r],
  ];
  for (let i = 0; i < 4; i++) {
    balustrade(ctx.mb, c[i], c[(i + 1) % 4], g, 1.1, M.railing, M.iron);
  }
}

/**
 * Sultanahmet Meydanı, the old Hippodrome: the monuments on its spina, north to south: the Alman Çeşmesi (1900,
 * octagonal neo-Byzantine fountain house with a bronze dome), the Egyptian obelisk of Theodosius (pink granite on a
 * marble relief base), the bronze Serpent Column in its pit, and the Walled Obelisk of rough ashlar.
 */
export function buildHipodrom(ctx: SiteContext): void {
  const p = (k: keyof typeof HIPODROM): V2 => ctx.point(HIPODROM[k].lat, HIPODROM[k].lon);
  const [ax, az] = p('dikilitas');
  ctx.chunk('main', ax, az);
  // Spina axis (compass bearing of the square's long side, from the Walled Obelisk to the fountain).
  const [ox, oz] = p('orme');
  const yaw = Math.atan2(ax - ox, az - oz);

  // Dikilitaş: two-tier marble base with the bronze cube feet, granite shaft.
  {
    const g = ctx.groundOrSea(ax, az);
    box(ctx.mb, ax, g - 1, az, 4.4, 1.6, 4.4, yaw, M.marbleWarm);
    box(ctx.mb, ax, g + 0.6, az, 3.4, 2.5, 3.4, yaw, M.marble);
    box(ctx.mb, ax, g + 3.1, az, 2.7, 0.6, 2.7, yaw, M.bronze);
    const top = obelisk(ctx.mb, ax, az, g + 3.7, 18.6, 2.26, 1.55, yaw, M.granite);
    railing(ctx, ax, az, g, 5.2);
    ctx.collider({ kind: 'box', cx: ax, cy: (g - 1 + top) / 2, cz: az, hx: 2.2, hy: (top - g + 1) / 2, hz: 2.2, yaw });
  }
  // Örme Dikilitaş: rough ashlar shaft on a stepped base.
  {
    const g = ctx.groundOrSea(ox, oz);
    box(ctx.mb, ox, g - 1, oz, 5, 2.4, 5, yaw, M.marbleWarm);
    const top = obelisk(ctx.mb, ox, oz, g + 1.4, 28.5, 3.6, 1.6, yaw, M.rubble);
    railing(ctx, ox, oz, g, 5.6);
    ctx.collider({ kind: 'box', cx: ox, cy: (g - 1 + top) / 2, cz: oz, hx: 2.5, hy: (top - g + 1) / 2, hz: 2.5, yaw });
  }
  // Yılanlı Sütun: bronze twisted column (the serpents' coils as a gently bulging lathe) standing in a sunken pit.
  {
    const [x, z] = p('yilanli');
    const g = ctx.groundOrSea(x, z);
    const prof: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      prof.push([0.42 + 0.05 * Math.sin(i * 2.1), g - 2.2 + (i / 12) * 7.5]);
    }
    prof.push([0, g + 5.3]);
    lathe(ctx.mb, x, z, prof, M.bronze, { seg: ctx.lod === 0 ? 12 : 6, crease: 0.5 });
    railing(ctx, x, z, g, 2.8);
    ctx.collider({ kind: 'cylinder', x, y: g - 2.2, z, r: 0.6, h: 7.5 });
  }
  // Alman Çeşmesi: octagonal marble plinth, eight porphyry-and-marble columns, bronze dome with a gilded rim.
  {
    const [x, z] = p('alman');
    const g = ctx.groundOrSea(x, z);
    const R = 4.2;
    const oct = regularRing(x, z, R, 8, Math.PI / 8);
    lathe(ctx.mb, x, z, [[R + 1.2, g - 0.8], [R + 1.2, g + 0.3], [R + 0.6, g + 0.3], [R + 0.6, g + 0.8], [0, g + 0.8]], M.marbleWarm, { seg: 8, flat: true, phase: Math.PI / 8 });
    for (let i = 0; i < 8; i++) {
      colonnade(ctx.mb, oct[i], oct[(i + 1) % 8], g + 0.8, 5.2, 2, 0.3, M.granite, M.marble, ctx.lod, 0.9);
    }
    const crown = dome(ctx.mb, x, z, g + 6.9, { r: R + 0.4, rise: 3.2, mat: M.bronze, drum: { h: 0.8, sides: 8, mat: M.marble }, alem: 0 }, ctx.lod);
    ctx.collider({ kind: 'cylinder', x, y: g - 0.8, z, r: R + 0.8, h: crown - g + 0.8 });
  }
}
