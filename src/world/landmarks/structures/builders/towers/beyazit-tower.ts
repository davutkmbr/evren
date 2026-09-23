/**
 * Beyazıt Kulesi (1828, Senekerim Balyan; top storeys added 1849): 85 m fire-watch tower in the Istanbul University
 * garden. Circular stone base and shaft, a watch room with 13 round-arched windows, three receding octagonal storeys
 * with round windows (the setbacks form terraces), a stone roof and the 13 m iron signal pole. At night its top
 * shows the weather-signal light (blue = clear).
 */
import * as THREE from 'three';
import type { StructureBuild } from '../../build/context';
import { Emit, Surf } from '../../build/surfaces';
import { Color, mat, Pal, withEmit } from '../palette';
import { windowRing } from './openings';

const STONE = withEmit(mat(0xd2c8b4, Surf.Ashlar, 0.8, 0, 0.5), Emit.Flood, 1.8, 1, 75);
const LIT = { ...Pal.window, emit: Emit.Windows, ea: 3, eb: 5, ec: 0.7 };

export function buildBeyazitTower(b: StructureBuild): void {
  const { x, z } = b.def;
  let ground = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ground = Math.min(ground, b.ground(x + Math.cos(a) * 5.5, z + Math.sin(a) * 5.5));
  }
  const y0 = ground - 0.4;
  const Y = (h: number): number => y0 + h;

  b.opaque(
    (mb, lod) => {
      const seg = lod === 0 ? 36 : 14;
      mb.vBase = y0;
      mb.surface(STONE);
      mb.lathe(
        [
          { r: 5.6, y: Y(-0.6) },
          { r: 5.6, y: Y(3.6), crease: true },
          { r: 4.9, y: Y(4.4), crease: true },
          { r: 4.3, y: Y(5.2), crease: true },
          { r: 4.0, y: Y(52.5) },
          { r: 4.45, y: Y(53.2), crease: true },
          { r: 4.6, y: Y(53.8), crease: true },
          { r: 4.25, y: Y(54.0), crease: true },
          { r: 4.25, y: Y(60.2), crease: true },
          { r: 5.0, y: Y(60.8), crease: true },
          { r: 5.0, y: Y(61.3), crease: true },
        ],
        seg,
        { cx: x, cz: z, capTop: true },
      );
      // receding octagonal storeys
      const oct = (r: number, h0: number, h1: number, cornice: number): void => {
        mb.lathe(
          [
            { r, y: Y(h0) },
            { r, y: Y(h1), crease: true },
            { r: r + cornice, y: Y(h1 + 0.35), crease: true },
            { r: r + cornice, y: Y(h1 + 0.7) },
          ],
          8,
          { cx: x, cz: z, phase: Math.PI / 8, capTop: true },
        );
      };
      oct(3.45, 61.3, 65.4, 0.35);
      oct(2.75, 66.1, 69.4, 0.3);
      oct(2.1, 70.1, 72.0, 0.25);
      // stone roof
      mb.lathe(
        [
          { r: 2.3, y: Y(72.7) },
          { r: 0.35, y: Y(74.4) },
        ],
        8,
        { cx: x, cz: z, phase: Math.PI / 8 },
      );
      // signal pole
      mb.surface(mat(0x2e3133, Surf.Steel, 0.5, 0.6, 0));
      mb.cylinder(x, Y(74.2), z, 0.16, 0.07, 10.8, 6, true, false);
      if (lod === 0) {
        windowRing(mb, { cx: x, cz: z, radius: 4.25, y0: Y(55.0), height: 3.8, width: 1.2, shape: 'arch' }, 13, 0.2, STONE, LIT);
        windowRing(mb, { cx: x, cz: z, radius: 3.2, y0: Y(62.4), height: 1.3, width: 1.3, shape: 'round' }, 8, 0, null, LIT);
        windowRing(mb, { cx: x, cz: z, radius: 2.55, y0: Y(67.1), height: 1.1, width: 1.1, shape: 'round' }, 8, 0, null, LIT);
        // pilaster strips on the shaft
        mb.surface(STONE);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
          const px = x + Math.cos(a) * 4.05;
          const pz = z + Math.sin(a) * 4.05;
          mb.box(px, Y(28.8), pz, 0.22, 23.6, 0.35, -a, true, true);
        }
        // door
        windowRing(mb, { cx: x, cz: z, radius: 5.6, y0: Y(0), height: 3.0, width: 1.6, shape: 'arch' }, 1, Math.PI * 1.5, null, mat(0x3a2a1c, Surf.Plain, 0.6));
      }
      mb.vBase = 0;
    },
    { detailScale: 0.6 },
  );

  // weather signal light (blue: clear) around the top storey + terrace railing
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.lights.add(new THREE.Vector3(x + Math.cos(a) * 2.45, Y(71.0), z + Math.sin(a) * 2.45), [1.2, 4, 26], 0.25);
  }
  b.lights.obstruction(new THREE.Vector3(x, Y(85.2), z));
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    pts.push(new THREE.Vector3(x + Math.cos(a) * 4.9, Y(62.3), z + Math.sin(a) * 4.9));
  }
  b.wires.polyline(pts, 0.03, Color.railing, { fade: [800, 1600] });
  b.cylinderCollider(x, y0, z, 5.2, 61.3);
  b.cylinderCollider(x, Y(61.3), z, 3.6, 13);
  b.cylinderCollider(x, Y(74.3), z, 0.4, 10.7);
}
