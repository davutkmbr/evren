/**
 * Galata Kulesi (1348, Genoese "Christea Turris"): coursed rubble cylinder of 16.45 m outer diameter (3.75 m walls),
 * 62.59 m to the roof / 66.9 m with the finial, observation gallery at 51.65 m around the upper drum, arched windows
 * of the café storey below it and a pointed lead cone.
 */
import * as THREE from 'three';
import type { StructureBuild } from '../../build/context';
import type { ProfilePoint } from '../../build/mesh-builder';
import { Emit, Surf } from '../../build/surfaces';
import { Color, mat, Pal, withEmit } from '../palette';
import { archWindow, windowRing } from './openings';

const STONE = withEmit(mat(0xa99a82, Surf.Rubble, 0.86, 0, 0.42), Emit.Flood, 2.2, 0, 70);
const ASHLAR = withEmit(mat(0xc4b79f, Surf.Ashlar, 0.8, 0, 0.42), Emit.Flood, 2.0, 0, 70);
const LEAD = withEmit(mat(0x6d7879, Surf.Lead, 0.45, 0.3, 0.6), Emit.Flood, 0.8, 0, 70);
const GLASS_LIT = { ...Pal.window, emit: Emit.Windows, ea: 4.5, eb: 7, ec: 1 };

export function buildGalataTower(b: StructureBuild): void {
  const { x, z } = b.def;
  const R = 8.225;
  let ground = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ground = Math.min(ground, b.ground(x + Math.cos(a) * R, z + Math.sin(a) * R));
  }
  const y0 = ground - 0.5;
  const Y = (h: number): number => y0 + h;

  b.opaque(
    (mb, lod) => {
      const seg = lod === 0 ? 56 : 20;
      mb.vBase = y0;
      // plinth + shaft
      mb.surface(ASHLAR);
      mb.lathe(
        [
          { r: R + 0.55, y: Y(-1) },
          { r: R + 0.55, y: Y(1.8), crease: true },
          { r: R, y: Y(2.1), crease: true },
        ],
        seg,
        { cx: x, cz: z },
      );
      mb.surface(STONE);
      mb.lathe(
        [
          { r: R, y: Y(2.1) },
          { r: R - 0.08, y: Y(45.8) },
        ],
        seg,
        { cx: x, cz: z },
      );
      // string course, café storey, gallery slab
      mb.surface(ASHLAR);
      mb.lathe(
        [
          { r: R - 0.08, y: Y(45.8) },
          { r: R + 0.3, y: Y(46.1), crease: true },
          { r: R + 0.3, y: Y(46.4), crease: true },
          { r: R, y: Y(46.5), crease: true },
          { r: R, y: Y(51.0), crease: true },
          { r: R + 1.45, y: Y(51.2), crease: true },
          { r: R + 1.45, y: Y(51.6), crease: true },
          { r: 7.3, y: Y(51.6), crease: true },
          { r: 7.3, y: Y(56.3), crease: true },
          { r: 7.95, y: Y(56.5), crease: true },
          { r: 7.95, y: Y(56.9), crease: true },
        ],
        seg,
        { cx: x, cz: z },
      );
      // pointed cone with a slight ogee flare at the eaves
      const cone: ProfilePoint[] = [];
      const coneBase = 56.9;
      const coneTop = 65.6;
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const r = 7.95 * (1 - t) * (1 - 0.18 * Math.sin(Math.PI * t * 0.9)) + 0.25 * t;
        cone.push({ r, y: Y(coneBase + (coneTop - coneBase) * Math.pow(t, 0.92)) });
      }
      mb.surface(LEAD);
      mb.lathe(cone, seg, { cx: x, cz: z });
      // finial
      mb.surface(mat(0x9c8a5a, Surf.Steel, 0.35, 0.8, 0));
      mb.lathe(
        [
          { r: 0.25, y: Y(65.6) },
          { r: 0.42, y: Y(66.0) },
          { r: 0.3, y: Y(66.35) },
          { r: 0.05, y: Y(66.9) },
        ],
        lod === 0 ? 10 : 6,
        { cx: x, cz: z },
      );
      if (lod > 0) {
        // windows as a dark band suggestion at distance
        windowRing(mb, { cx: x, cz: z, radius: R, y0: Y(47.2), height: 3.2, width: 1.5, shape: 'arch' }, 16, 0.1, null, GLASS_LIT);
        return;
      }
      windowRing(mb, { cx: x, cz: z, radius: R, y0: Y(47.0), height: 3.5, width: 1.55, shape: 'arch' }, 16, 0.1, ASHLAR, GLASS_LIT);
      windowRing(mb, { cx: x, cz: z, radius: 7.3, y0: Y(52.6), height: 2.6, width: 1.1, shape: 'arch' }, 16, 0.1 + Math.PI / 16, ASHLAR, GLASS_LIT);
      // stair slits winding up the shaft and the door
      for (let k = 0; k < 26; k++) {
        const a = 0.7 + k * 2.39;
        const h = 6 + k * 1.52;
        archWindow(mb, { cx: x, cz: z, radius: R - 0.05, angle: a, y0: Y(h), height: 1.4, width: 0.42, shape: 'arch' }, ASHLAR, Pal.window);
      }
      for (const a of [0.9, 0.9 + Math.PI * 0.5, 0.9 + Math.PI, 0.9 + Math.PI * 1.5]) {
        archWindow(mb, { cx: x, cz: z, radius: R - 0.05, angle: a, y0: Y(38.5), height: 2.2, width: 0.8, shape: 'arch' }, ASHLAR, GLASS_LIT);
      }
      archWindow(mb, { cx: x, cz: z, radius: R + 0.55, angle: Math.PI * 0.5, y0: Y(0.4), height: 3.2, width: 1.9, shape: 'arch' }, ASHLAR, mat(0x3a2a1c, Surf.Plain, 0.6));
    },
    { detailScale: 0.7 },
  );

  // gallery railing and lamps
  const rr = R + 1.35;
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    pts.push(new THREE.Vector3(x + Math.cos(a) * rr, Y(52.7), z + Math.sin(a) * rr));
  }
  b.wires.polyline(pts, 0.035, Color.railing, { fade: [1500, 3000] });
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    b.wires.add(new THREE.Vector3(x + Math.cos(a) * rr, Y(51.6), z + Math.sin(a) * rr), new THREE.Vector3(x + Math.cos(a) * rr, Y(52.7), z + Math.sin(a) * rr), 0.025, Color.railing, {
      fade: [300, 600],
    });
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    b.lights.add(new THREE.Vector3(x + Math.cos(a) * (R + 0.9), Y(51.9), z + Math.sin(a) * (R + 0.9)), [14, 10, 6], 0.15);
  }
  b.lights.obstruction(new THREE.Vector3(x, Y(67.1), z));
  b.cylinderCollider(x, y0, z, R + 0.3, 56.9);
  b.cylinderCollider(x, Y(56.9), z, 5.5, 5);
  b.cylinderCollider(x, Y(61.9), z, 2.5, 3.7); // ends at the cone tip (65.6)
}
