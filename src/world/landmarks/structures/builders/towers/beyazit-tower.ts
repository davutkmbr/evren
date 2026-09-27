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
import type { MeshBuilder } from '../../build/mesh-builder';
import { band, block, corbel, piercedWall, polygonMaps, ringMap, shade, type Opening } from './masonry';
import { windowRing } from './openings';

const STONE = withEmit(mat(0xd2c8b4, Surf.Ashlar, 0.8, 0, 0.5), Emit.Flood, 1.8, 1, 75);
const LIT = { ...Pal.window, emit: Emit.Windows, ea: 3, eb: 5, ec: 0.7 };
const TRIM = withEmit(mat(0xe0d8c6, Surf.Ashlar, 0.72, 0, 0.5), Emit.Flood, 1.8, 1, 75);
const REVEAL = shade(STONE, 0.66);
const DOOR = mat(0x3a2a1c, Surf.Plain, 0.6);
const DOOR_ANGLE = Math.PI * 1.5;

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
      if (lod === 0) {
        detailedBody(mb, x, z, Y);
      } else {
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
          ],
          seg,
          { cx: x, cz: z },
        );
      }
      // balcony slab of the watch room
      mb.lathe(
        [
          { r: 4.25, y: Y(60.2) },
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
            ...(lod === 0 ? [] : [{ r, y: Y(h0) }]),
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
      if (lod > 0) {
        windowRing(mb, { cx: x, cz: z, radius: 4.25, y0: Y(55.0), height: 3.8, width: 1.2, shape: 'arch' }, 13, 0.2, null, LIT);
        windowRing(mb, { cx: x, cz: z, radius: 3.2, y0: Y(62.4), height: 1.3, width: 1.3, shape: 'round' }, 8, 0, null, LIT);
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

/** Arc length from the ring seam to azimuth a on a ring of radius r. */
function arcAt(a: number, seam: number, r: number): number {
  const t = (((a - seam) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return t * r;
}

/**
 * LOD0 body: the base drum with its recessed door, the shaft between eight pilasters with the stair windows
 * winding up it, a ring of corbels under the moulded capital, the watch room with 13 deep arched windows and
 * consoles under its balcony, and the octagonal storeys with framed oculi and corner pilasters.
 */
function detailedBody(mb: MeshBuilder, x: number, z: number, Y: (h: number) => number): void {
  const opt = { wall: STONE, trim: TRIM, reveal: REVEAL };
  // base drum
  const baseSeam = DOOR_ANGLE + Math.PI;
  const base = ringMap(x, z, 5.6, baseSeam, 36);
  piercedWall(
    mb,
    base,
    Y(-0.6),
    Y(3.6),
    [{ s: arcAt(DOOR_ANGLE, baseSeam, 5.6), sill: Y(0), h: 3.0, w: 1.6, shape: 'arch', depth: 1.2, back: DOOR, frame: 0.3, keystone: true }],
    opt,
  );
  mb.surface(STONE);
  mb.lathe(
    [
      { r: 5.6, y: Y(3.6) },
      { r: 4.9, y: Y(4.4), crease: true },
      { r: 4.3, y: Y(5.2), crease: true },
      { r: 4.0, y: Y(6.0), crease: true },
    ],
    36,
    { cx: x, cz: z },
  );
  // shaft: stair windows between the pilasters, spiralling up
  const seam = Math.PI / 8;
  const shaft = ringMap(x, z, 4.0, seam, 40);
  const ops: Opening[] = [];
  for (let k = 0; k < 14; k++) {
    const a = ((k * 3) % 8) * (Math.PI / 4);
    ops.push({ s: arcAt(a, seam, 4.0), sill: Y(9 + k * 3.1), h: 1.25, w: 0.5, shape: 'segmental', depth: 0.8, back: LIT, frame: 0.13, sillOut: 0.07 });
  }
  piercedWall(mb, shaft, Y(6.0), Y(52.5), ops, opt);
  mb.surface(TRIM);
  for (let k = 0; k < 8; k++) {
    const s = arcAt(seam + (k * Math.PI) / 4, seam, 4.0);
    block(mb, shaft, s - 0.24, s + 0.24, Y(6.0), Y(52.3), 0.02, -0.3);
  }
  band(mb, shaft, Y(6.0), Y(6.5), 0.36);
  // moulded capital on a ring of corbels
  mb.surface(STONE);
  mb.lathe(
    [
      { r: 4.0, y: Y(52.5) },
      { r: 4.45, y: Y(53.2), crease: true },
      { r: 4.6, y: Y(53.8), crease: true },
      { r: 4.25, y: Y(54.0), crease: true },
    ],
    36,
    { cx: x, cz: z },
  );
  mb.surface(TRIM);
  for (let k = 0; k < 24; k++) {
    const s = arcAt(seam + (k + 0.5) * ((Math.PI * 2) / 24), seam, 4.0);
    corbel(mb, shaft, s, 0.34, Y(51.4), Y(52.55), 0.45);
  }
  // watch room: 13 arched windows, consoles between them under the balcony
  const wSeam = 0.2 + Math.PI / 13;
  const watch = ringMap(x, z, 4.25, wSeam, 52);
  const win: Opening[] = [];
  for (let k = 0; k < 13; k++) {
    win.push({ s: arcAt(0.2 + (k / 13) * Math.PI * 2, wSeam, 4.25), sill: Y(55.0), h: 3.8, w: 1.2, shape: 'arch', depth: 0.7, back: LIT, frame: 0.15, sillOut: 0.12, keystone: true });
  }
  piercedWall(mb, watch, Y(54.0), Y(60.2), win, opt);
  mb.surface(TRIM);
  for (let k = 0; k < 13; k++) {
    corbel(mb, watch, arcAt(0.2 + ((k + 0.5) / 13) * Math.PI * 2, wSeam, 4.25), 0.36, Y(58.9), Y(60.25), 0.72);
  }
  // octagonal storeys
  const storeys: Array<{ r: number; h0: number; h1: number; win: number; sill: number }> = [
    { r: 3.45, h0: 61.3, h1: 65.4, win: 1.3, sill: 62.4 },
    { r: 2.75, h0: 66.1, h1: 69.4, win: 1.1, sill: 67.1 },
    { r: 2.1, h0: 70.1, h1: 72.0, win: 0.7, sill: 70.6 },
  ];
  for (const st of storeys) {
    const ring: Array<[number, number]> = [];
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      ring.push([x + Math.cos(a) * st.r, z + Math.sin(a) * st.r]);
    }
    for (const map of polygonMaps(ring)) {
      const o: Opening = { s: map.len / 2, sill: Y(st.sill), h: st.win, w: st.win, shape: 'round', depth: 0.45, back: LIT, frame: st.win * 0.12 };
      piercedWall(mb, map, Y(st.h0), Y(st.h1), [o], { ...opt, archSeg: 7 });
      mb.surface(TRIM);
      block(mb, map, -0.02, 0.22, Y(st.h0), Y(st.h1), 0.02, -0.07);
      block(mb, map, map.len - 0.22, map.len + 0.02, Y(st.h0), Y(st.h1), 0.02, -0.07);
    }
  }
}
