/**
 * Küçük Çamlıca TV-radio tower (2021, Melike Altınışık Architects): 369 m in total (587 m above sea), a 16 x 13 m
 * elliptical reinforced concrete core to ~216 m clad in white GFRC panels, eight 13 m buttress walls at the foot,
 * two panoramic elevator shafts, the "unopened tulip bud" of observation and restaurant floors around 145-200 m
 * above the ground and a 150 m steel antenna mast.
 */
import * as THREE from 'three';
import type { StructureBuild } from '../../build/context';
import type { ProfilePoint } from '../../build/mesh-builder';
import { Emit, Facade, LedGroup, Surf } from '../../build/surfaces';
import { Color, glassMat, mat, withEmit } from '../palette';

const MINOR = 13 / 16;
const GFRC = withEmit(mat(0xdedbd2, Surf.Concrete, 0.6, 0, 4.5), Emit.Led, LedGroup.Camlica, 0.5, 0.45);
const GFRC_TOP = withEmit(mat(0xdedbd2, Surf.Concrete, 0.6, 0, 4.5), Emit.Led, LedGroup.Camlica, 0.9, 0.7);

const PROFILE: Array<[number, number]> = [
  [0, 12.5],
  [6, 11.2],
  [16, 10.0],
  [30, 9.0],
  [60, 8.4],
  [100, 8.05],
  [124, 8.15],
];
const BUD: Array<[number, number]> = [
  [124, 8.15],
  [133, 9.9],
  [143, 12.6],
  [155, 14.5],
  [167, 15.0],
  [179, 14.3],
  [190, 12.2],
  [199, 9.6],
];
const CROWN: Array<[number, number]> = [
  [199, 9.6],
  [206, 7.4],
  [212, 5.3],
  [216, 3.6],
];

export function buildCamlicaTower(b: StructureBuild): void {
  const { x, z } = b.def;
  let ground = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ground = Math.min(ground, b.ground(x + Math.cos(a) * 14, z + Math.sin(a) * 14));
  }
  const y0 = ground - 0.5;
  const toProfile = (list: Array<[number, number]>): ProfilePoint[] => list.map(([h, r]) => ({ r, y: y0 + h }));

  b.opaque(
    (mb, lod) => {
      const seg = lod === 0 ? 56 : 18;
      mb.vBase = y0;
      mb.surface(GFRC);
      mb.lathe(toProfile(PROFILE), seg, { cx: x, cz: z, sz: MINOR });
      mb.surface(GFRC_TOP);
      mb.lathe(toProfile(CROWN), seg, { cx: x, cz: z, sz: MINOR, capTop: true });
      // eight buttress walls at the foot
      mb.surface(GFRC);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
        const ca = Math.cos(a);
        const sa = Math.sin(a) * MINOR;
        const tx = -Math.sin(a);
        const tz = Math.cos(a);
        const r0 = 9.5;
        const r1 = 23;
        const t = 0.7;
        const pts = (off: number): THREE.Vector3[] => [
          new THREE.Vector3(x + ca * r0 + tx * off, y0 + 34, z + sa * r0 + tz * off),
          new THREE.Vector3(x + ca * r1 + tx * off, y0 + 0.5, z + sa * r1 + tz * off),
          new THREE.Vector3(x + ca * r0 + tx * off, y0 + 0.5, z + sa * r0 + tz * off),
        ];
        const L = pts(-t);
        const R = pts(t);
        const inside = new THREE.Vector3(x + ca * 12, y0 + 8, z + sa * 12);
        mb.polygonOutward(L, R[0]);
        mb.polygonOutward(R, L[0]);
        mb.polygonOutward([L[0], L[1], R[1], R[0]], inside.clone().setY(y0 - 20));
        void inside;
      }
      // podium plaza
      mb.surface(mat(0xb9b4aa, Surf.Paving, 0.75, 0, 1.2));
      mb.lathe(
        [
          { r: 40, y: y0 - 2 },
          { r: 40, y: y0 + 0.5, crease: true },
          { r: 0.1, y: y0 + 0.5 },
        ],
        lod === 0 ? 40 : 14,
        { cx: x, cz: z, sz: 0.85 },
      );
      // antenna mast
      mb.surface(mat(0xc7cacb, Surf.Steel, 0.45, 0.4, 8));
      mb.lathe(
        [
          { r: 2.7, y: y0 + 216 },
          { r: 2.2, y: y0 + 250 },
          { r: 1.25, y: y0 + 300 },
          { r: 0.8, y: y0 + 340 },
          { r: 0.35, y: y0 + 369 },
        ],
        lod === 0 ? 14 : 6,
        { cx: x, cz: z, capTop: true },
      );
      if (lod === 0) {
        // antenna platforms
        for (const h of [232, 262, 292, 322]) {
          mb.cylinder(x, y0 + h, z, 3.4 - (h - 232) * 0.02, 3.4 - (h - 232) * 0.02, 0.8, 14, true, true);
        }
      }
      mb.vBase = 0;
    },
    { detailScale: 1.6 },
  );

  // the tulip bud (observation + restaurant floors) and the two panoramic lift shafts
  b.glass(
    (mb, lod) => {
      const seg = lod === 0 ? 56 : 18;
      mb.vBase = y0;
      mb.surface({ ...glassMat(0x9fb4b8, Facade.Ribbed, 4.5, 2.2, 3.1), emit: Emit.Crown, ea: 150, eb: 3, ec: 1.3 });
      mb.lathe(toProfile(BUD), seg, { cx: x, cz: z, sz: MINOR });
      mb.surface(glassMat(0x7d8e92, Facade.DarkGrid, 4.5, 1.6, 7.3));
      for (const side of [-1, 1]) {
        const cz = z + side * (8.05 * MINOR + 1.2);
        mb.box(x, y0 + 80, cz, 1.9, 58, 1.5, 0, true, false);
      }
      mb.vBase = 0;
    },
    { detailScale: 1.6 },
  );

  // aviation lights: blinking at the top, steady levels along mast and shaft
  b.lights.aviation(new THREE.Vector3(x, y0 + 369.6, z), 0, 1.5, 1.4);
  for (const h of [340, 300, 262]) {
    for (const a of [0, Math.PI]) {
      b.lights.obstruction(new THREE.Vector3(x + Math.cos(a) * 1.4, y0 + h, z + Math.sin(a) * 1.4));
    }
  }
  for (const a of [0.3, 0.3 + Math.PI / 2, 0.3 + Math.PI, 0.3 + Math.PI * 1.5]) {
    b.lights.aviation(new THREE.Vector3(x + Math.cos(a) * 3.8, y0 + 216.5, z + Math.sin(a) * 3.8 * MINOR), 0.5, 1.5, 1);
    b.lights.obstruction(new THREE.Vector3(x + Math.cos(a) * 8.6, y0 + 110, z + Math.sin(a) * 8.6 * MINOR));
  }
  // antenna guy / feeder cables as thin wires
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    b.wires.add(
      new THREE.Vector3(x + Math.cos(a) * 3.2, y0 + 232.8, z + Math.sin(a) * 3.2),
      new THREE.Vector3(x + Math.cos(a) * 1.0, y0 + 322.8, z + Math.sin(a) * 1.0),
      0.05,
      Color.mast,
      { fade: [2500, 5000] },
    );
  }

  b.cylinderCollider(x, y0, z, 10, 128);
  b.cylinderCollider(x, y0 + 128, z, 15, 72);
  b.cylinderCollider(x, y0 + 200, z, 8, 16);
  b.cylinderCollider(x, y0 + 216, z, 2.8, 153);
  b.cylinderCollider(x, y0, z, 22, 12);
}
