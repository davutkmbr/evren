/**
 * Galata Kulesi (1348, Genoese "Christea Turris"): coursed rubble cylinder of 16.45 m outer diameter (3.75 m walls),
 * 62.59 m to the roof / 66.9 m with the finial, observation gallery at 51.65 m around the upper drum, arched windows
 * of the café storey below it and a pointed lead cone.
 */
import * as THREE from 'three';
import type { StructureBuild } from '../../build/context';
import type { MeshBuilder, ProfilePoint } from '../../build/mesh-builder';
import { Emit, Surf } from '../../build/surfaces';
import { Color, mat, Pal, withEmit } from '../palette';
import { band, block, corbel, piercedWall, ringMap, shade, type Opening } from './masonry';
import { archWindow, windowRing } from './openings';

const STONE = withEmit(mat(0xa99a82, Surf.Rubble, 0.86, 0, 0.42), Emit.Flood, 2.2, 0, 70);
const ASHLAR = withEmit(mat(0xc4b79f, Surf.Ashlar, 0.8, 0, 0.42), Emit.Flood, 2.0, 0, 70);
const LEAD = withEmit(mat(0x6d7879, Surf.Lead, 0.45, 0.3, 0.6), Emit.Flood, 0.8, 0, 70);
const GLASS_LIT = { ...Pal.window, emit: Emit.Windows, ea: 4.5, eb: 7, ec: 1 };
const DOOR = mat(0x3a2a1c, Surf.Plain, 0.6);
/** Door and window seam azimuths (radians from +X toward +Z); s = 0 of the shaft ring lies between openings. */
const DOOR_ANGLE = Math.PI * 0.5;
const SEAM = -0.35;

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
      // stepped plinth
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
      if (lod === 0) {
        detailedBody(mb, x, z, R, Y);
      } else {
        mb.surface(STONE);
        mb.lathe(
          [
            { r: R, y: Y(2.1) },
            { r: R - 0.08, y: Y(45.8) },
          ],
          seg,
          { cx: x, cz: z },
        );
        mb.surface(ASHLAR);
        mb.lathe(
          [
            { r: R, y: Y(46.5) },
            { r: R, y: Y(51.0), crease: true },
          ],
          seg,
          { cx: x, cz: z },
        );
        mb.lathe(
          [
            { r: 7.3, y: Y(51.6) },
            { r: 7.3, y: Y(56.3), crease: true },
          ],
          seg,
          { cx: x, cz: z },
        );
      }
      // string course, gallery slab, top cornice
      mb.surface(ASHLAR);
      mb.lathe(
        [
          { r: R - 0.08, y: Y(45.8) },
          { r: R + 0.3, y: Y(46.1), crease: true },
          { r: R + 0.3, y: Y(46.4), crease: true },
          { r: R, y: Y(46.5), crease: true },
        ],
        seg,
        { cx: x, cz: z },
      );
      mb.lathe(
        [
          { r: R, y: Y(51.0) },
          { r: R + 1.45, y: Y(51.2), crease: true },
          { r: R + 1.45, y: Y(51.6), crease: true },
          { r: 7.3, y: Y(51.6), crease: true },
        ],
        seg,
        { cx: x, cz: z },
      );
      mb.lathe(
        [
          { r: 7.3, y: Y(56.3) },
          { r: 7.65, y: Y(56.4), crease: true },
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
      if (lod === 0) {
        coneRibs(mb, x, z, cone, 32);
      }
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
        windowRing(mb, { cx: x, cz: z, radius: R, y0: Y(47.0), height: 3.5, width: 1.55, shape: 'arch' }, 16, 0.1, null, GLASS_LIT);
        windowRing(mb, { cx: x, cz: z, radius: 7.3, y0: Y(52.6), height: 2.6, width: 1.1, shape: 'arch' }, 16, 0.1 + Math.PI / 16, null, GLASS_LIT);
        archWindow(mb, { cx: x, cz: z, radius: R + 0.55, angle: Math.PI * 0.5, y0: Y(0.4), height: 3.2, width: 1.9, shape: 'arch' }, null, DOOR);
      }
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

/**
 * LOD0 body: the rubble shaft with its recessed pointed-arch door (steps up the plinth), the stair slits winding up
 * the wall thickness and four upper windows; the café storey with 16 deep arched windows between piers, the stone
 * consoles carrying the gallery and the upper drum with its own ring of windows.
 */
function detailedBody(mb: MeshBuilder, x: number, z: number, R: number, Y: (h: number) => number): void {
  const shaft = ringMap(x, z, R, SEAM, 56);
  const sOf = (a: number): number => arcAt(a, SEAM, R);
  const trim = ASHLAR;
  const ops: Opening[] = [];
  const upper: Array<{ a: number; y: number }> = [0.9, 0.9 + Math.PI * 0.5, 0.9 + Math.PI, 0.9 + Math.PI * 1.5].map((a) => ({ a, y: 38.5 }));
  for (const w of upper) {
    ops.push({ s: sOf(w.a), sill: Y(w.y), h: 2.2, w: 0.85, shape: 'arch', depth: 1.1, back: GLASS_LIT, frame: 0.2, sillOut: 0.14, keystone: true });
  }
  ops.push({ s: sOf(DOOR_ANGLE), sill: Y(2.1), h: 3.7, w: 1.9, shape: 'pointed', depth: 1.5, back: DOOR, frame: 0.38, keystone: true });
  // stair slits: narrow, deep and framed by a few dressed stones
  for (let k = 0; k < 26; k++) {
    const a = 0.7 + k * 2.39;
    const h = 6 + k * 1.52;
    const s = sOf(a);
    const clash = ops.some((o) => Math.abs(o.s - s) < o.w / 2 + 0.9 && Math.abs(o.sill - Y(h)) < 3.2);
    if (clash || s < 0.6 || s > shaft.len - 0.6) {
      continue;
    }
    ops.push({ s, sill: Y(h), h: 1.35, w: 0.36, shape: 'rect', depth: 0.9, back: Pal.window, frame: 0.14, sillOut: 0.06 });
  }
  piercedWall(mb, shaft, Y(2.1), Y(45.8), ops, { wall: STONE, trim, reveal: shade(STONE, 0.62) });

  // entrance steps up the plinth
  mb.surface(trim);
  const plinth = ringMap(x, z, R + 0.55, SEAM, 56);
  const ds = arcAt(DOOR_ANGLE, SEAM, R + 0.55);
  for (let i = 0; i < 5; i++) {
    const top = 1.8 - i * 0.36;
    block(mb, plinth, ds - 1.6 - i * 0.12, ds + 1.6 + i * 0.12, Y(-1), Y(top), 0.02, -0.4 - i * 0.38);
  }

  // café storey: 16 deep arched windows, piers between them
  // each ring has its seam between two openings
  const cafeSeam = 0.1 + Math.PI / 16;
  const cafe = ringMap(x, z, R, cafeSeam, 64);
  const win: Opening[] = [];
  for (let k = 0; k < 16; k++) {
    win.push({ s: arcAt(0.1 + (k / 16) * Math.PI * 2, cafeSeam, R), sill: Y(47.0), h: 3.5, w: 1.55, shape: 'arch', depth: 0.9, back: GLASS_LIT, frame: 0.18, sillOut: 0.16, keystone: true });
  }
  win.sort((p, q) => p.s - q.s);
  piercedWall(mb, cafe, Y(46.5), Y(51.0), win, { wall: ASHLAR, trim, reveal: shade(ASHLAR, 0.66) });
  // consoles under the gallery, one per pier
  mb.surface(ASHLAR);
  for (let k = 0; k < 16; k++) {
    corbel(mb, cafe, arcAt(0.1 + ((k + 0.5) / 16) * Math.PI * 2, cafeSeam, R), 0.6, Y(49.4), Y(51.02), 1.4);
  }
  // upper drum: 16 windows offset half a bay, a sill band below them
  const drum = ringMap(x, z, 7.3, 0.1, 64);
  const top: Opening[] = [];
  for (let k = 0; k < 16; k++) {
    top.push({ s: arcAt(0.1 + Math.PI / 16 + (k / 16) * Math.PI * 2, 0.1, 7.3), sill: Y(52.6), h: 2.6, w: 1.1, shape: 'arch', depth: 0.6, back: GLASS_LIT, frame: 0.13, keystone: true });
  }
  top.sort((p, q) => p.s - q.s);
  piercedWall(mb, drum, Y(51.6), Y(56.3), top, { wall: ASHLAR, trim, reveal: shade(ASHLAR, 0.66) });
  mb.surface(ASHLAR);
  band(mb, drum, Y(52.3), Y(52.55), 0.1);
}

/** Arc length from the ring seam to azimuth a on a ring of radius r. */
function arcAt(a: number, seam: number, r: number): number {
  const t = (((a - seam) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return t * r;
}

/** Standing-seam ribs down the lead cone (one per sheet), riding 4 cm above the cone surface. */
function coneRibs(mb: MeshBuilder, x: number, z: number, cone: readonly ProfilePoint[], count: number): void {
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    const path: THREE.Vector3[] = [];
    for (let i = 0; i < cone.length - 1; i++) {
      const r = cone[i].r + 0.04;
      path.push(new THREE.Vector3(x + Math.cos(a) * r, cone[i].y + 0.02, z + Math.sin(a) * r));
    }
    mb.tube(path, 0.045, 4);
  }
}
