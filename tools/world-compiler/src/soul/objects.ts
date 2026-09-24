/**
 * Procedural props of the soul lane (.docs/street/kadikoy-soul.md, section "S1 revision"): improvised cat bowls and
 * cat houses (items 2, 24, 28), pavement spill-over at shop doors (8, 9, 34, 42), the waste corner and a battery box
 * (43), a coiled hose at the fish end (3, 10), a generic cylindrical glass simit cart and its corn conversion (6, 41),
 * courier motorbikes with fictional liveries and shared e-scooters (39), and anglers' kit (30).
 *
 * Nothing here copies a real product or livery: the cart follows the idea of Kadıköy's 2014 cart (a glass cylinder
 * on a blue base) without its logo or exact shape; bike top boxes and scooters use invented colour schemes.
 *
 * Prop convention: metres, foot at the origin, the front (door, customer side, the side facing the lane) along +Z.
 */
import { Batch, Frame } from '../facade/frame';
import type { TileMesh, Vec3 } from '../mesh';
import type { PropDef } from '../props';
import { emitText } from '../shopfront/font';
import { aabox, beam, cylinder, ellipsoid, lathe, obox, tube } from '../street/shapes';
import { cone, cylinderAxis, taperTube, torus } from './geom';

const E = (mesh: TileMesh, m: string, c: Vec3, r: Vec3, seg = 10, rings = 6): void => ellipsoid(mesh, m, c, r[0], r[1], r[2], seg, rings);

/** Deterministic pseudo-random sequence for prop details. */
function seq(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Planar convex polygon helper: a disc of `n` points in the plane with normal +Z at z (x0, y0 centre). */
function discZ(mesh: TileMesh, m: string, x0: number, y0: number, z: number, r: number, n = 12, ry = r): void {
  const pts: Vec3[] = [...Array(n)].map((_, k): Vec3 => [x0 + Math.cos((k / n) * Math.PI * 2) * r, y0 + Math.sin((k / n) * Math.PI * 2) * ry, z]);
  mesh.flatPolygon(m, pts, [0, 0, 1]);
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Bowls                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

export type BowlKind = 'bottle_water' | 'bottle_kibble' | 'tub_water' | 'tub_kibble' | 'tub_empty' | 'plate_kibble' | 'plate_empty' | 'steel_water' | 'steel_kibble' | 'box_kibble' | 'cardboard_kibble';
export const BOWL_KINDS: BowlKind[] = ['bottle_water', 'bottle_kibble', 'tub_water', 'tub_kibble', 'tub_empty', 'plate_kibble', 'plate_empty', 'steel_water', 'steel_kibble', 'box_kibble', 'cardboard_kibble'];

function kibbleHeap(mesh: TileMesh, y: number, r: number, h: number, spill: number, seed: number): void {
  E(mesh, 'soul_kibble', [0, y, 0], [r, h, r * 0.92], 10, 4);
  const rnd = seq(seed);
  for (let k = 0; k < spill; k++) {
    const a = rnd() * Math.PI * 2;
    const d = r * 1.2 + rnd() * 0.12;
    E(mesh, 'soul_kibble', [Math.cos(a) * d, 0.004, Math.sin(a) * d], [0.006, 0.004, 0.006], 5, 2);
  }
}

function bowl(mesh: TileMesh, kind: BowlKind): void {
  const [shape, fill] = kind.split('_') as [string, string];
  if (shape === 'bottle') {
    // Bottom half of a 5 L water bottle, slightly oblong, cut ragged at 0.1 m.
    lathe(mesh, 'soul_bottle', 0, 0, 0, [
      [0, 0.004],
      [0.07, 0.004],
      [0.082, 0.012],
      [0.086, 0.04],
      [0.084, 0.1],
    ], 8, false, 0.82);
    torus(mesh, 'soul_bottle', [0, 0.1, 0], [0, 1, 0], 0.084, 0.002, 12, 3);
    if (fill === 'water') {
      cylinder(mesh, 'soul_water', 0, 0, 0.005, 0.062, 0.078, 8, true);
    } else {
      kibbleHeap(mesh, 0.03, 0.06, 0.035, 5, 3);
    }
  } else if (shape === 'tub') {
    lathe(mesh, 'soul_tub_white', 0, 0, 0, [
      [0, 0],
      [0.054, 0],
      [0.068, 0.085],
      [0.07, 0.09],
      [0.066, 0.09],
      [0.052, 0.006],
      [0, 0.006],
    ], 12, false);
    torus(mesh, 'soul_tub_rim', [0, 0.078, 0], [0, 1, 0], 0.067, 0.006, 12, 3);
    if (fill === 'water') {
      cylinder(mesh, 'soul_water', 0, 0, 0.006, 0.06, 0.062, 10, true);
    } else if (fill === 'kibble') {
      kibbleHeap(mesh, 0.03, 0.05, 0.04, 4, 7);
    }
  } else if (shape === 'plate') {
    lathe(mesh, 'soul_ceramic', 0, 0, 0, [
      [0, 0],
      [0.07, 0],
      [0.11, 0.018],
      [0.113, 0.021],
      [0.106, 0.021],
      [0.068, 0.007],
      [0, 0.007],
    ], 14, false);
    torus(mesh, 'soul_ceramic_rim', [0, 0.017, 0], [0, 1, 0], 0.1, 0.0035, 16, 3);
    if (fill === 'kibble') {
      kibbleHeap(mesh, 0.01, 0.07, 0.03, 8, 11);
    }
  } else if (shape === 'steel') {
    lathe(mesh, 'soul_steel', 0, 0, 0, [
      [0, 0],
      [0.07, 0],
      [0.095, 0.05],
      [0.1, 0.053],
      [0.092, 0.051],
      [0.068, 0.004],
      [0, 0.004],
    ], 14, false);
    if (fill === 'water') {
      cylinder(mesh, 'soul_water', 0, 0, 0.004, 0.035, 0.082, 12, true);
    } else {
      kibbleHeap(mesh, 0.02, 0.07, 0.035, 5, 13);
    }
  } else if (shape === 'box') {
    // Foil takeaway box.
    aabox(mesh, 'soul_foil', [-0.085, 0, -0.06], [0.085, 0.004, 0.06]);
    for (const [a, b] of [
      [[-0.09, 0, -0.065], [0.09, 0.045, -0.06]],
      [[-0.09, 0, 0.06], [0.09, 0.045, 0.065]],
      [[-0.09, 0, -0.06], [-0.085, 0.045, 0.06]],
      [[0.085, 0, -0.06], [0.09, 0.045, 0.06]],
    ] as [Vec3, Vec3][]) {
      aabox(mesh, 'soul_foil', a, b);
    }
    kibbleHeap(mesh, 0.02, 0.06, 0.03, 4, 17);
  } else {
    // Dry kibble on a flattened piece of cardboard.
    obox(mesh, 'soul_cardboard', [0, 0.004, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.18, 0.004, 0.14);
    kibbleHeap(mesh, 0.008, 0.08, 0.03, 12, 19);
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Cat houses                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------- */

export type CatHouseKind = 'wood' | 'painted' | 'eps' | 'cardboard';

function catHouse(mesh: TileMesh, kind: CatHouseKind): void {
  if (kind === 'wood' || kind === 'painted') {
    const wall = kind === 'wood' ? 'soul_house_wood' : 'soul_house_paint_blue';
    for (const x of [-0.2, 0.2]) {
      aabox(mesh, 'soul_house_roof', [x - 0.03, 0, -0.22], [x + 0.03, 0.04, 0.22]);
    }
    aabox(mesh, wall, [-0.28, 0.04, -0.21], [0.28, 0.42, 0.21]);
    // Gables and a pitched roof along X.
    for (const z of [0.21, -0.21]) {
      mesh.flatPolygon(wall, [[-0.28, 0.42, z], [0.28, 0.42, z], [0, 0.58, z]], [0, 0, Math.sign(z)]);
    }
    const slope = Math.atan2(0.16, 0.28);
    for (const s of [-1, 1]) {
      const c: Vec3 = [s * 0.155, 0.5 + 0.012, 0];
      obox(mesh, 'soul_house_roof', c, [s * Math.cos(slope), -Math.sin(slope), 0], [s * Math.sin(slope), Math.cos(slope), 0], [0, 0, 1], 0.19, 0.012, 0.26);
    }
    discZ(mesh, 'soul_hole', 0, 0.2, 0.213, 0.085, 14);
    if (kind === 'painted') {
      // Children's paint: dots, a stripe and a sun on the sides and the front.
      const rnd = seq(5);
      for (let k = 0; k < 7; k++) {
        const col = ['soul_paint_yellow', 'soul_paint_red', 'soul_paint_green'][k % 3];
        discZ(mesh, col, -0.22 + rnd() * 0.44, 0.08 + rnd() * 0.3, 0.212 + k * 0.0005, 0.02 + rnd() * 0.02, 8);
      }
      aabox(mesh, 'soul_paint_yellow', [-0.282, 0.1, -0.15], [-0.28, 0.14, 0.15]);
      aabox(mesh, 'soul_paint_red', [0.28, 0.28, -0.12], [0.282, 0.36, 0.0]);
    }
  } else if (kind === 'eps') {
    // An EPS fish crate upside down: a door cut in the front, a clear flap, parcel tape and a bin bag over the top.
    aabox(mesh, 'soul_eps', [-0.3, 0, -0.2], [0.3, 0.3, 0.2]);
    mesh.flatPolygon('soul_hole', [[-0.09, 0.0, 0.202], [0.09, 0.0, 0.202], [0.09, 0.17, 0.202], [-0.09, 0.17, 0.202]], [0, 0, 1]);
    obox(mesh, 'soul_flap', [0, 0.11, 0.212], [1, 0, 0], [0, 0.99, 0.12], [0, -0.12, 0.99], 0.1, 0.07, 0.001);
    for (const x of [-0.19, 0.19]) {
      aabox(mesh, 'soul_tape', [x - 0.025, 0, -0.203], [x + 0.025, 0.2, 0.203]);
    }
    aabox(mesh, 'soul_binbag', [-0.315, 0.2, -0.215], [0.315, 0.318, 0.215]);
    E(mesh, 'soul_binbag', [0.27, 0.27, 0.1], [0.08, 0.05, 0.1], 8, 4);
  } else {
    // A cardboard box with a door hole, a clear flap and a blanket.
    aabox(mesh, 'soul_cardboard', [-0.26, 0, -0.18], [0.26, 0.34, 0.18]);
    mesh.flatPolygon('soul_hole', [[-0.08, 0.02, 0.182], [0.08, 0.02, 0.182], [0.08, 0.18, 0.182], [-0.08, 0.18, 0.182]], [0, 0, 1]);
    obox(mesh, 'soul_flap', [0, 0.12, 0.19], [1, 0, 0], [0, 0.99, 0.1], [0, -0.1, 0.99], 0.09, 0.07, 0.001);
    for (const s of [-1, 1]) {
      obox(mesh, 'soul_cardboard_dark', [s * 0.3, 0.33, 0], [Math.cos(0.5) * s, Math.sin(0.5), 0], [-Math.sin(0.5) * s, Math.cos(0.5), 0], [0, 0, 1], 0.08, 0.004, 0.17);
    }
    obox(mesh, 'soul_blanket', [-0.02, 0.35, -0.03], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.2, 0.012, 0.16);
    obox(mesh, 'soul_blanket', [-0.02, 0.26, -0.19], [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.2, 0.012, 0.09);
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Pavement spill-over                                                                                             */
/* ------------------------------------------------------------------------------------------------------------- */

export type SpillKind = 'carboys' | 'gas_cage' | 'clothes_rack' | 'sacks' | 'crates' | 'stools_tray' | 'stools';
export const SPILL_KINDS: SpillKind[] = ['carboys', 'gas_cage', 'clothes_rack', 'sacks', 'crates', 'stools_tray', 'stools'];

function carboy(mesh: TileMesh, x: number, z: number): void {
  lathe(mesh, 'soul_carboy', x, 0, z, [
    [0, 0],
    [0.132, 0],
    [0.137, 0.02],
    [0.137, 0.2],
    [0.13, 0.22],
    [0.137, 0.24],
    [0.137, 0.36],
    [0.115, 0.41],
    [0.055, 0.46],
    [0.03, 0.47],
  ], 12, false);
  cylinder(mesh, 'soul_carboy_cap', x, z, 0.47, 0.51, 0.032, 8, true);
}

function stool(mesh: TileMesh, x: number, z: number, m: string): void {
  aabox(mesh, m, [x - 0.15, 0.27, z - 0.15], [x + 0.15, 0.3, z + 0.15]);
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    beam(mesh, m, [x + sx * 0.12, 0.27, z + sz * 0.12], [x + sx * 0.16, 0, z + sz * 0.16], 0.03, 0.03);
  }
}

function teaGlass(mesh: TileMesh, x: number, y: number, z: number): void {
  lathe(mesh, 'soul_ceramic', x, y, z, [
    [0, 0],
    [0.045, 0],
    [0.048, 0.006],
  ], 10, true);
  lathe(mesh, 'soul_tea', x, y + 0.006, z, [
    [0, 0],
    [0.02, 0],
    [0.026, 0.03],
    [0.02, 0.055],
    [0.026, 0.09],
  ], 10, true);
}

function spill(mesh: TileMesh, kind: SpillKind): void {
  if (kind === 'carboys') {
    for (const [x, z] of [
      [-0.15, -0.15],
      [0.15, -0.15],
      [-0.15, 0.15],
      [0.15, 0.15],
    ]) {
      carboy(mesh, x, z);
    }
    // An empty one on its side in front.
    cylinderAxis(mesh, 'soul_carboy', [-0.2, 0.137, 0.46], [0.16, 0.137, 0.46], 0.137, 12);
    cone(mesh, 'soul_carboy', [0.16, 0.137, 0.46], [0.27, 0.137, 0.46], 0.137, 12);
    cylinderAxis(mesh, 'soul_carboy_cap', [0.27, 0.137, 0.46], [0.31, 0.137, 0.46], 0.032, 8);
  } else if (kind === 'gas_cage') {
    const W = 0.48;
    const D = 0.26;
    const H = 1.25;
    for (const [x, z] of [
      [-W, -D],
      [W, -D],
      [W, D],
      [-W, D],
    ]) {
      aabox(mesh, 'soul_cage', [x - 0.015, 0, z - 0.015], [x + 0.015, H, z + 0.015]);
    }
    for (const y of [0.05, 0.63, H]) {
      aabox(mesh, 'soul_cage', [-W, y - 0.015, -D - 0.015], [W, y + 0.015, D + 0.015]);
    }
    for (let x = -W + 0.08; x < W; x += 0.08) {
      aabox(mesh, 'soul_cage', [x - 0.004, 0.05, D], [x + 0.004, H, D + 0.008]);
    }
    for (let z = -D + 0.08; z < D; z += 0.08) {
      for (const s of [-1, 1]) {
        aabox(mesh, 'soul_cage', [s * W - 0.004, 0.05, z - 0.004], [s * W + 0.004, H, z + 0.004]);
      }
    }
    const cols = ['soul_cyl_blue', 'soul_cyl_grey', 'soul_cyl_orange', 'soul_cyl_blue'];
    let k = 0;
    for (const y of [0.065, 0.645]) {
      for (const x of [-0.22, 0.22]) {
        const m = cols[k++];
        lathe(mesh, m, x, y, 0, [
          [0, 0],
          [0.14, 0],
          [0.15, 0.03],
          [0.15, 0.36],
          [0.12, 0.42],
          [0.05, 0.45],
        ], 12, true);
        torus(mesh, 'soul_cage', [x, y + 0.5, 0], [0, 1, 0], 0.07, 0.008, 10, 3);
        cylinder(mesh, 'soul_cage', x, 0, y + 0.45, y + 0.5, 0.025, 6, true);
      }
    }
  } else if (kind === 'clothes_rack') {
    for (const x of [-0.6, 0.6]) {
      cylinder(mesh, 'soul_chrome', x, 0, 0.02, 1.55, 0.013, 8, true);
      aabox(mesh, 'soul_chrome', [x - 0.02, 0.02, -0.25], [x + 0.02, 0.05, 0.25]);
      for (const z of [-0.23, 0.23]) {
        cylinderAxis(mesh, 'soul_rubber', [x - 0.012, 0.022, z], [x + 0.012, 0.022, z], 0.022, 8);
      }
    }
    cylinderAxis(mesh, 'soul_chrome', [-0.62, 1.52, 0], [0.62, 1.52, 0], 0.012, 8);
    const cloth = ['soul_cloth_a', 'soul_cloth_b', 'soul_cloth_c', 'soul_cloth_d', 'soul_cloth_e'];
    const rnd = seq(23);
    for (let k = 0; k < 11; k++) {
      const x = -0.5 + k * 0.1 + (rnd() - 0.5) * 0.02;
      const len = 0.6 + rnd() * 0.35;
      const turn = (rnd() - 0.5) * 0.35;
      tube(mesh, 'soul_chrome', [[x, 1.52, 0], [x, 1.46, 0]], 0.003, 3);
      obox(mesh, cloth[k % cloth.length], [x, 1.46 - len / 2, 0], [Math.sin(turn), 0, Math.cos(turn)], [0, 1, 0], [Math.cos(turn), 0, -Math.sin(turn)], 0.21, len / 2, 0.018 + rnd() * 0.012);
    }
    // A dress form beside the rack.
    cylinder(mesh, 'soul_chrome', 0.95, 0, 0.02, 1.0, 0.012, 6, true);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      beam(mesh, 'soul_chrome', [0.95, 0.02, 0], [0.95 + Math.cos(a) * 0.25, 0.01, Math.sin(a) * 0.25], 0.02, 0.015);
    }
    lathe(mesh, 'soul_form', 0.95, 0.95, 0, [
      [0.02, 0],
      [0.15, 0.03],
      [0.13, 0.2],
      [0.16, 0.4],
      [0.15, 0.5],
      [0.06, 0.56],
      [0.035, 0.6],
      [0.0, 0.62],
    ], 12, true, 0.7);
    lathe(mesh, 'soul_cloth_b', 0.95, 0.99, 0, [
      [0.16, 0],
      [0.14, 0.18],
      [0.17, 0.4],
      [0.16, 0.48],
    ], 12, false, 0.72);
  } else if (kind === 'sacks') {
    aabox(mesh, 'soul_pallet', [-0.45, 0, -0.3], [0.45, 0.1, 0.3]);
    const fills = ['soul_beans', 'soul_lentils', 'soul_nuts'];
    [-0.24, 0.22].forEach((x, k) => {
      for (const z of k ? [-0.02] : [-0.1, 0.12]) {
        const r = k ? 0.19 : 0.13;
        lathe(mesh, 'soul_jute', x, 0.1, z, [
          [0, 0],
          [r - 0.02, 0],
          [r, 0.08],
          [r, 0.3],
          [r + 0.015, 0.34],
        ], 10, false);
        torus(mesh, 'soul_jute', [x, 0.44, z], [0, 1, 0], r + 0.01, 0.022, 12, 5);
        E(mesh, fills[(k * 2 + (z > 0 ? 1 : 0)) % 3], [x, 0.4, z], [r - 0.005, 0.045, r - 0.005], 10, 4);
      }
    });
    // A scoop in the big sack.
    beam(mesh, 'soul_steel', [0.22, 0.46, -0.02], [0.3, 0.55, 0.06], 0.02, 0.01);
  } else if (kind === 'crates') {
    const crate = (x: number, y: number, z: number, m: string, produce: string | null): void => {
      aabox(mesh, m, [x - 0.3, y, z - 0.2], [x + 0.3, y + 0.03, z + 0.2]);
      for (const [a, b] of [
        [[x - 0.3, y, z - 0.2], [x + 0.3, y + 0.28, z - 0.18]],
        [[x - 0.3, y, z + 0.18], [x + 0.3, y + 0.28, z + 0.2]],
        [[x - 0.3, y, z - 0.18], [x - 0.28, y + 0.28, z + 0.18]],
        [[x + 0.28, y, z - 0.18], [x + 0.3, y + 0.28, z + 0.18]],
      ] as [Vec3, Vec3][]) {
        aabox(mesh, m, a, b);
      }
      if (produce) {
        const rnd = seq(Math.round(x * 100 + y * 1000));
        for (let k = 0; k < 14; k++) {
          E(mesh, produce, [x - 0.22 + rnd() * 0.44, y + 0.22 + rnd() * 0.05, z - 0.13 + rnd() * 0.26], [0.045, 0.04, 0.045], 6, 4);
        }
      }
    };
    crate(-0.32, 0, 0, 'soul_crate_green', 'soul_produce_a');
    crate(0.32, 0, 0.02, 'soul_crate_red', null);
    crate(0.32, 0.28, 0.02, 'soul_crate_wood', 'soul_produce_b');
    crate(-0.3, 0, 0.44, 'soul_crate_wood', 'soul_produce_c');
  } else {
    stool(mesh, -0.3, 0, 'soul_stool_red');
    stool(mesh, 0.32, 0.08, 'soul_stool_blue');
    if (kind === 'stools') {
      stool(mesh, 0.05, 0.55, 'soul_stool_red');
    } else {
      // A hanging tea tray (askılı tepsi) with three glasses on the red stool.
      lathe(mesh, 'soul_tray', -0.3, 0.3, 0, [
        [0, 0],
        [0.14, 0],
        [0.15, 0.012],
      ], 16, true);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.3;
        tube(mesh, 'soul_tray', [[-0.3 + Math.cos(a) * 0.145, 0.31, Math.sin(a) * 0.145], [-0.3, 0.52, 0]], 0.003, 3);
      }
      torus(mesh, 'soul_tray', [-0.3, 0.54, 0], [0, 0, 1], 0.025, 0.004, 10, 3);
      teaGlass(mesh, -0.36, 0.312, -0.04);
      teaGlass(mesh, -0.24, 0.312, -0.03);
      teaGlass(mesh, -0.3, 0.312, 0.07);
    }
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Waste corner, battery box, hose                                                                                 */
/* ------------------------------------------------------------------------------------------------------------- */

export type ContainerKind = 'galvanised' | 'green' | 'glass_bell' | 'bags';

function wheelSet(mesh: TileMesh, hw: number, hd: number): void {
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    cylinderAxis(mesh, 'soul_rubber', [sx * hw - 0.03, 0.09, sz * hd], [sx * hw + 0.03, 0.09, sz * hd], 0.09, 10);
    aabox(mesh, 'soul_metal_dark', [sx * hw - 0.04, 0.09, sz * hd - 0.04], [sx * hw + 0.04, 0.2, sz * hd + 0.04]);
  }
}

function container(mesh: TileMesh, kind: ContainerKind): void {
  if (kind === 'galvanised' || kind === 'green') {
    const body = kind === 'galvanised' ? 'soul_galv' : 'soul_bin_green';
    const lid = kind === 'galvanised' ? 'soul_galv' : 'soul_bin_lid';
    const hw = kind === 'galvanised' ? 0.66 : 0.6;
    const hd = kind === 'galvanised' ? 0.52 : 0.45;
    wheelSet(mesh, hw - 0.12, hd - 0.1);
    // Vertical walls on a skirt that tapers towards the wheels.
    const top = 1.18;
    const pts = (y: number, k: number): Vec3[] => [
      [-hw * k, y, -hd * k],
      [hw * k, y, -hd * k],
      [hw * k, y, hd * k],
      [-hw * k, y, hd * k],
    ];
    const lo = pts(0.2, 0.88);
    const mid = pts(0.38, 1);
    for (let k = 0; k < 4; k++) {
      const a = lo[k];
      const b = lo[(k + 1) % 4];
      const c = mid[(k + 1) % 4];
      const d = mid[k];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      let n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...n);
      n = [n[0] / l, n[1] / l, n[2] / l];
      // Outward: away from the body's axis.
      const c0 = (a[0] + c[0]) / 2;
      const c2 = (a[2] + c[2]) / 2;
      if (n[0] * c0 + n[2] * c2 < 0) {
        n = [-n[0], -n[1], -n[2]];
      }
      mesh.flatPolygon(body, [a, b, c, d], n);
    }
    mesh.flatPolygon(body, lo, [0, -1, 0]);
    aabox(mesh, body, [-hw, 0.38, -hd], [hw, top - 0.08, hd]);
    aabox(mesh, body, [-hw - 0.03, top - 0.08, -hd - 0.03], [hw + 0.03, top, hd + 0.03]);
    // Lid: a shallow dome; the plastic one is cracked and stands a little open.
    const open = kind === 'green' ? 0.12 : 0;
    const axis: Vec3 = [1, 0, 0];
    const up: Vec3 = [0, Math.cos(open), Math.sin(open)];
    const fw: Vec3 = [0, -Math.sin(open), Math.cos(open)];
    const hinge: Vec3 = [0, top, -hd - 0.03];
    const lp = (u: number, v: number, w: number): Vec3 => [hinge[0] + axis[0] * u + up[0] * v + fw[0] * w, hinge[1] + axis[1] * u + up[1] * v + fw[1] * w, hinge[2] + axis[2] * u + up[2] * v + fw[2] * w];
    obox(mesh, lid, lp(0, 0.035, hd + 0.03), axis, up, fw, hw + 0.04, 0.035, hd + 0.05);
    obox(mesh, lid, lp(0, 0.09, hd + 0.03), axis, up, fw, hw - 0.1, 0.02, hd - 0.1);
    if (kind === 'green') {
      mesh.flatPolygon('soul_hole', [lp(0.18, 0.111, 0.5), lp(0.34, 0.111, 0.47), lp(0.36, 0.111, 0.52), lp(0.2, 0.111, 0.54)], up);
    }
    // Handles at the front.
    tube(mesh, 'soul_metal_dark', [[-hw * 0.6, top - 0.2, hd + 0.02], [-hw * 0.6, top - 0.2, hd + 0.08], [hw * 0.6, top - 0.2, hd + 0.08], [hw * 0.6, top - 0.2, hd + 0.02]], 0.015, 5);
  } else if (kind === 'glass_bell') {
    lathe(mesh, 'soul_glass_bin', 0, 0, 0, [
      [0.58, 0],
      [0.6, 0.08],
      [0.58, 0.8],
      [0.47, 1.2],
      [0.25, 1.42],
      [0.06, 1.5],
    ], 16, true);
    for (const s of [-1, 1]) {
      discZ(mesh, 'soul_hole', 0, 1.05, s * 0.55, 0.09, 12);
    }
    torus(mesh, 'soul_metal_dark', [0, 1.6, 0], [1, 0, 0], 0.09, 0.015, 12, 4);
    cylinder(mesh, 'soul_metal_dark', 0, 0, 1.49, 1.52, 0.03, 6, true);
  } else {
    const rnd = seq(29);
    for (let k = 0; k < 5; k++) {
      const x = (rnd() - 0.5) * 0.9;
      const z = (rnd() - 0.5) * 0.6;
      const r = 0.2 + rnd() * 0.08;
      E(mesh, 'soul_binbag', [x, r * 0.8, z], [r, r * 0.85, r * 0.9], 10, 6);
      cone(mesh, 'soul_binbag', [x, r * 1.55, z], [x + 0.03, r * 1.55 + 0.1, z], 0.04, 5);
    }
  }
}

/** Waste-battery box on a pole clamp: the pole axis is the prop origin, the box faces +Z. */
function batteryBox(mesh: TileMesh): void {
  aabox(mesh, 'soul_battery_box', [-0.12, 1.15, 0.08], [0.12, 1.5, 0.22]);
  aabox(mesh, 'soul_rubber', [-0.06, 1.44, 0.219], [0.06, 1.455, 0.222]);
  aabox(mesh, 'soul_cart_white', [-0.09, 1.2, 0.221], [0.09, 1.34, 0.223]);
  for (const y of [1.22, 1.43]) {
    torus(mesh, 'soul_metal_dark', [0, y, 0], [0, 1, 0], 0.08, 0.006, 14, 3);
    aabox(mesh, 'soul_metal_dark', [-0.02, y - 0.01, 0.075], [0.02, y + 0.01, 0.09]);
  }
}

/** Coiled green hose, its free end snaking 1.2 m towards +Z. */
function hose(mesh: TileMesh): void {
  const pts: Vec3[] = [];
  const turns = 3.2;
  const n = 64;
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * turns * Math.PI * 2;
    const r = 0.2 + 0.035 * Math.sin(t * 0.5) + (k / n) * 0.03;
    pts.push([Math.cos(t) * r, 0.013 + (k / n) * 0.05 + Math.max(0, Math.sin(t * 1.7)) * 0.012, Math.sin(t) * r]);
  }
  const last = pts[pts.length - 1];
  pts.push([last[0] + 0.1, 0.015, last[2] + 0.2], [last[0] + 0.25, 0.013, last[2] + 0.55], [last[0] + 0.1, 0.013, last[2] + 0.9], [last[0] + 0.15, 0.013, last[2] + 1.2]);
  taperTube(mesh, 'soul_hose', pts, 0.012, 0.012, 6);
  cylinderAxis(mesh, 'soul_steel', [last[0] + 0.15, 0.013, last[2] + 1.2], [last[0] + 0.16, 0.013, last[2] + 1.28], 0.016, 6);
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Carts                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

function cartBase(mesh: TileMesh, label: string): void {
  for (const x of [-0.52, 0.52]) {
    torus(mesh, 'soul_rubber', [x, 0.25, -0.1], [1, 0, 0], 0.21, 0.04, 16, 6);
    cylinderAxis(mesh, 'soul_cart_steel', [x - 0.03, 0.25, -0.1], [x + 0.03, 0.25, -0.1], 0.08, 10);
  }
  cylinderAxis(mesh, 'soul_cart_steel', [-0.52, 0.25, -0.1], [0.52, 0.25, -0.1], 0.015, 6);
  for (const x of [-0.42, 0.42]) {
    cylinder(mesh, 'soul_cart_steel', x, 0.28, 0, 0.36, 0.018, 6, true);
  }
  aabox(mesh, 'soul_cart_blue', [-0.48, 0.36, -0.32], [0.48, 0.98, 0.32]);
  aabox(mesh, 'soul_cart_white', [-0.4, 0.46, 0.32], [0.4, 0.86, 0.325]);
  aabox(mesh, 'soul_cart_steel', [-0.5, 0.98, -0.34], [0.5, 1.0, 0.46]);
  // Painted name on the front panel (generic, no logo).
  const f = new Frame(-0.4, 0.326, 1, 0, 0, 1, 0.8);
  const batch = new Batch(mesh, f);
  emitText(batch, label, { material: 'soul_cart_blue', color: [1, 1, 1, 1], r: 0.4, y: 0.58, d: 0.001, capH: 0.13, depth: 0 });
  batch.flush();
  // The vendor's step, a half-round board behind the cart.
  lathe(mesh, 'soul_platform', 0, 0.16, -0.55, [
    [0.3, 0],
    [0.3, 0.04],
  ], 10, true);
  for (const x of [-0.2, 0.2]) {
    cylinder(mesh, 'soul_cart_steel', x, -0.55, 0, 0.16, 0.015, 5, false);
  }
  // Umbrella on a pole at the back.
  cylinder(mesh, 'soul_cart_steel', 0.44, -0.3, 0.98, 2.3, 0.018, 6, true);
  const canopy: [number, number][] = [
    [0.95, 0],
    [0.93, 0.05],
    [0.45, 0.28],
    [0, 0.36],
  ];
  lathe(mesh, 'soul_umbrella', 0.44, 1.95, -0.3, canopy, 8, false);
  lathe(mesh, 'soul_umbrella', 0.44, 1.945, -0.3, [...canopy].reverse(), 8, false);
}

function simitCart(mesh: TileMesh): void {
  cartBase(mesh, 'SİMİT');
  // Glass cylinder with steel rings and a blue cap.
  lathe(mesh, 'soul_cart_glass', 0, 1.0, 0, [
    [0.4, 0],
    [0.4, 0.62],
  ], 20, false);
  for (const y of [1.0, 1.62]) {
    torus(mesh, 'soul_cart_steel', [0, y, 0], [0, 1, 0], 0.4, 0.015, 24, 4);
  }
  lathe(mesh, 'soul_cart_blue', 0, 1.62, 0, [
    [0.42, 0],
    [0.42, 0.04],
    [0.3, 0.1],
    [0.0, 0.13],
  ], 20, true);
  // Two shelves of stacked simit.
  for (const y of [1.02, 1.3]) {
    lathe(mesh, 'soul_cart_steel', 0, y, 0, [
      [0.37, 0],
      [0.37, 0.01],
    ], 16, true);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      for (let h = 0; h < (k % 3 === 0 ? 3 : 2); h++) {
        torus(mesh, 'soul_simit', [Math.cos(a) * 0.23, y + 0.03 + h * 0.035, Math.sin(a) * 0.23], [0.1 * Math.cos(a + h), 1, 0.1 * Math.sin(a + h)], 0.06, 0.02, 12, 5, 0.75);
      }
    }
    torus(mesh, 'soul_simit', [0, y + 0.03, 0], [0, 1, 0], 0.06, 0.02, 12, 5, 0.75);
  }
  // Paper bags on the counter.
  for (let k = 0; k < 4; k++) {
    obox(mesh, 'soul_cart_white', [-0.3 + k * 0.012, 1.005 + k * 0.004, 0.4], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.07, 0.002, 0.05);
  }
}

function cornCart(mesh: TileMesh): void {
  cartBase(mesh, 'MISIR');
  // Charcoal grill and a boiling pot.
  aabox(mesh, 'soul_cart_steel', [-0.46, 1.0, -0.3], [0.2, 1.12, 0.3]);
  mesh.flatPolygon('soul_coals', [[-0.43, 1.1, -0.27], [0.17, 1.1, -0.27], [0.17, 1.1, 0.27], [-0.43, 1.1, 0.27]], [0, 1, 0]);
  for (let k = 0; k < 7; k++) {
    const z = -0.22 + k * 0.075;
    capsule2(mesh, [-0.33, 1.14, z], [0.07, 1.14, z + 0.02], 0.03);
  }
  lathe(mesh, 'soul_cart_steel', 0.34, 1.0, 0, [
    [0, 0],
    [0.14, 0],
    [0.15, 0.3],
    [0.155, 0.31],
  ], 14, false);
  cylinder(mesh, 'soul_water', 0.34, 0, 1.26, 1.27, 0.145, 12, true);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    capsule2(mesh, [0.34 + Math.cos(a) * 0.07, 1.2, Math.sin(a) * 0.07], [0.34 + Math.cos(a) * 0.1, 1.42, Math.sin(a) * 0.1], 0.028);
  }
  E(mesh, 'soul_corn_husk', [-0.3, 1.02, 0.4], [0.12, 0.02, 0.06], 8, 3);
}

function capsule2(mesh: TileMesh, a: Vec3, b: Vec3, r: number): void {
  taperTube(mesh, 'soul_corn', [a, b], r, r * 0.8, 8);
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Motorbikes and e-scooters                                                                                       */
/* ------------------------------------------------------------------------------------------------------------- */

export const MOTO_LIVERIES: [string, string, string | null][] = [
  ['red_orange', 'soul_bike_body_red', 'soul_box_orange'],
  ['grey_teal', 'soul_bike_body_grey', 'soul_box_teal'],
  ['black_purple', 'soul_bike_body_black', 'soul_box_purple'],
  ['white_yellow', 'soul_bike_body_white', 'soul_box_yellow'],
  ['black_plain', 'soul_bike_body_black', null],
  ['grey_plain', 'soul_bike_body_grey', null],
];

function moto(mesh: TileMesh, body: string, box: string | null): void {
  for (const z of [0.66, -0.62]) {
    torus(mesh, 'soul_rubber', [0, 0.25, z], [1, 0, 0], 0.19, 0.06, 18, 6);
    cylinderAxis(mesh, 'soul_cart_steel', [-0.035, 0.25, z], [0.035, 0.25, z], 0.12, 12);
  }
  for (const s of [-1, 1]) {
    beam(mesh, 'soul_cart_steel', [s * 0.06, 0.25, 0.66], [s * 0.06, 0.84, 0.46], 0.035, 0.035, [1, 0, 0]);
  }
  E(mesh, body, [0, 0.47, 0.64], [0.08, 0.03, 0.2], 8, 4);
  // Leg shield, floorboard, rear body, seat.
  obox(mesh, body, [0, 0.66, 0.42], [1, 0, 0], [0, 0.94, -0.34], [0, 0.34, 0.94], 0.22, 0.32, 0.05);
  aabox(mesh, body, [-0.17, 0.3, -0.08], [0.17, 0.38, 0.36]);
  E(mesh, body, [0, 0.58, -0.36], [0.19, 0.2, 0.42], 12, 7);
  E(mesh, 'soul_seat', [0, 0.79, -0.28], [0.16, 0.05, 0.33], 10, 5);
  E(mesh, body, [0, 0.9, 0.52], [0.16, 0.1, 0.12], 10, 5);
  E(mesh, 'soul_headlight', [0, 0.9, 0.62], [0.07, 0.05, 0.03], 8, 4);
  cylinderAxis(mesh, 'soul_metal_dark', [-0.36, 1.0, 0.44], [0.36, 1.0, 0.44], 0.013, 6);
  for (const s of [-1, 1]) {
    cylinderAxis(mesh, 'soul_rubber', [s * 0.3, 1.0, 0.44], [s * 0.38, 1.0, 0.44], 0.02, 6);
    tube(mesh, 'soul_metal_dark', [[s * 0.22, 1.0, 0.44], [s * 0.26, 1.18, 0.4]], 0.006, 3);
    E(mesh, 'soul_metal_dark', [s * 0.27, 1.21, 0.4], [0.045, 0.03, 0.01], 6, 3);
  }
  cylinderAxis(mesh, 'soul_cart_steel', [0.14, 0.3, -0.2], [0.16, 0.34, -0.7], 0.04, 8);
  E(mesh, 'soul_gull_red', [0, 0.72, -0.78], [0.08, 0.025, 0.012], 6, 3);
  if (box) {
    aabox(mesh, 'soul_metal_dark', [-0.2, 0.84, -0.7], [0.2, 0.87, -0.36]);
    aabox(mesh, box, [-0.23, 0.87, -0.74], [0.23, 1.3, -0.3]);
    aabox(mesh, 'soul_cart_white', [-0.235, 1.03, -0.745], [0.235, 1.09, -0.295]);
  }
}

export const SCOOTER_LIVERIES = ['lime', 'teal', 'magenta', 'orange'] as const;

function escooter(mesh: TileMesh, colour: string, tipped: boolean): void {
  const th = (80.8 * Math.PI) / 180;
  const T = (p: Vec3): Vec3 => (tipped ? [p[0] * Math.cos(th) - p[1] * Math.sin(th), p[0] * Math.sin(th) + p[1] * Math.cos(th) + 0.065, p[2]] : p);
  const X: Vec3 = tipped ? [Math.cos(th), Math.sin(th), 0] : [1, 0, 0];
  const Y: Vec3 = tipped ? [-Math.sin(th), Math.cos(th), 0] : [0, 1, 0];
  const Z: Vec3 = [0, 0, 1];
  const m = `soul_scooter_${colour}`;
  for (const z of [0.45, -0.45]) {
    torus(mesh, 'soul_rubber', T([0, 0.11, z]), X, 0.08, 0.03, 14, 5);
    cylinderAxis(mesh, 'soul_metal_dark', T([-0.02, 0.11, z]), T([0.02, 0.11, z]), 0.05, 8);
  }
  obox(mesh, 'soul_metal_dark', T([0, 0.15, 0]), X, Y, Z, 0.08, 0.03, 0.4);
  obox(mesh, m, T([0, 0.155, 0]), X, Y, Z, 0.083, 0.02, 0.36);
  obox(mesh, m, T([0, 0.2, -0.46]), X, Y, Z, 0.045, 0.012, 0.1);
  const stemA = T([0, 0.16, 0.42]);
  const stemB = T([0, 1.1, 0.5]);
  cylinderAxis(mesh, m, stemA, stemB, 0.028, 8);
  cylinderAxis(mesh, 'soul_metal_dark', T([-0.25, 1.12, 0.5]), T([0.25, 1.12, 0.5]), 0.014, 6);
  for (const s of [-1, 1]) {
    cylinderAxis(mesh, 'soul_rubber', T([s * 0.18, 1.12, 0.5]), T([s * 0.26, 1.12, 0.5]), 0.02, 6);
  }
  obox(mesh, 'soul_metal_dark', T([0, 1.08, 0.52]), X, Y, Z, 0.06, 0.04, 0.03);
  obox(mesh, 'soul_headlight', T([0, 0.95, 0.52]), X, Y, Z, 0.025, 0.02, 0.012);
  if (!tipped) {
    beam(mesh, 'soul_metal_dark', [0.06, 0.13, -0.1], [0.14, 0.01, -0.16], 0.015, 0.01);
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Anglers' kit                                                                                                    */
/* ------------------------------------------------------------------------------------------------------------- */

function foldingStool(mesh: TileMesh, x: number, z: number): void {
  for (const s of [-1, 1]) {
    beam(mesh, 'soul_metal_dark', [x + s * 0.17, 0, z - 0.14], [x + s * 0.17, 0.42, z + 0.14], 0.018, 0.018, [1, 0, 0]);
    beam(mesh, 'soul_metal_dark', [x + s * 0.17, 0, z + 0.14], [x + s * 0.17, 0.42, z - 0.14], 0.018, 0.018, [1, 0, 0]);
  }
  obox(mesh, 'soul_stool_canvas', [x, 0.42, z], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.18, 0.006, 0.15);
}

function bucket(mesh: TileMesh, x: number, z: number, m: string, fish: number): void {
  lathe(mesh, m, x, 0, z, [
    [0, 0],
    [0.12, 0],
    [0.15, 0.3],
    [0.157, 0.31],
    [0.147, 0.31],
    [0.117, 0.01],
    [0, 0.01],
  ], 14, false);
  cylinder(mesh, 'soul_water', x, z, 0.01, 0.2, 0.134, 12, true);
  for (let k = 0; k < fish; k++) {
    const a = k * 2.1;
    obox(mesh, 'soul_fish', [x + Math.cos(a) * 0.05, 0.205, z + Math.sin(a) * 0.05], [Math.cos(a + 1.2), 0, Math.sin(a + 1.2)], [0, 1, 0], [-Math.sin(a + 1.2), 0, Math.cos(a + 1.2)], 0.07, 0.008, 0.018);
  }
  const hp: Vec3[] = [];
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * Math.PI;
    hp.push([x + Math.cos(a) * 0.155, 0.31 + Math.sin(a) * 0.12 * 0.3, z + Math.sin(a) * 0.05]);
  }
  tube(mesh, 'soul_metal_dark', hp, 0.003, 3);
}

function rod(mesh: TileMesh, butt: Vec3, tip: Vec3): void {
  taperTube(mesh, 'soul_rod', [butt, tip], 0.014, 0.003, 5);
  const dx = tip[0] - butt[0];
  const dy = tip[1] - butt[1];
  const dz = tip[2] - butt[2];
  const at = (f: number): Vec3 => [butt[0] + dx * f, butt[1] + dy * f, butt[2] + dz * f];
  cylinderAxis(mesh, 'soul_cart_steel', [at(0.12)[0] - 0.03, at(0.12)[1] - 0.04, at(0.12)[2]], [at(0.12)[0] + 0.03, at(0.12)[1] - 0.04, at(0.12)[2]], 0.035, 8);
}

function anglerKit(mesh: TileMesh, set: number): void {
  foldingStool(mesh, 0, -0.55);
  bucket(mesh, 0.42, -0.35, set === 1 ? 'soul_bucket_blue' : 'soul_bucket_white', 2 + set);
  aabox(mesh, 'soul_bait_box', [-0.45, 0, -0.3], [-0.2, 0.1, -0.15]);
  rod(mesh, [0.25, 0.05, -0.75], [0.3, 2.85, 1.55]);
  if (set !== 0) {
    cylinder(mesh, 'soul_metal_dark', -0.35, 0.05, 0, 0.55, 0.02, 6, true);
    rod(mesh, [-0.35, 0.2, 0.05], [-0.6, 3.2, 1.9]);
  }
  if (set === 2) {
    aabox(mesh, 'soul_cart_white', [-0.7, 0, -0.7], [-0.3, 0.3, -0.45]);
    aabox(mesh, 'soul_bucket_blue', [-0.71, 0.3, -0.71], [-0.29, 0.34, -0.44]);
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Props                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

export const OBJECT_PROPS: PropDef[] = [
  { id: 'soul_bowl', drawDistance: 30, castShadow: true, build: (b) => BOWL_KINDS.forEach((k) => b.variant(k, (m) => bowl(m, k))) },
  { id: 'soul_cathouse', drawDistance: 60, castShadow: true, build: (b) => (['wood', 'painted', 'eps', 'cardboard'] as CatHouseKind[]).forEach((k) => b.variant(k, (m) => catHouse(m, k))) },
  { id: 'soul_spill', drawDistance: 70, castShadow: true, build: (b) => SPILL_KINDS.forEach((k) => b.variant(k, (m) => spill(m, k))) },
  { id: 'soul_container', drawDistance: 90, castShadow: true, build: (b) => (['galvanised', 'green', 'glass_bell', 'bags'] as ContainerKind[]).forEach((k) => b.variant(k, (m) => container(m, k))) },
  { id: 'soul_battery_box', drawDistance: 40, castShadow: true, build: (b) => b.variant('pole', (m) => batteryBox(m)) },
  { id: 'soul_hose', drawDistance: 40, castShadow: true, build: (b) => b.variant('coil', (m) => hose(m)) },
  {
    id: 'soul_cart',
    drawDistance: 120,
    castShadow: true,
    build: (b) => {
      b.variant('simit', (m) => simitCart(m));
      b.variant('corn', (m) => cornCart(m));
    },
    lights: [{ type: 'point', position: [0, 1.3, 0.1], kelvin: 3000, lumens: 450, night: true, source: 'other' }],
  },
  { id: 'soul_moto', drawDistance: 120, castShadow: true, build: (b) => MOTO_LIVERIES.forEach(([id, body, box]) => b.variant(id, (m) => moto(m, body, box))) },
  {
    id: 'soul_escooter',
    drawDistance: 80,
    castShadow: true,
    build: (b) => {
      for (const c of SCOOTER_LIVERIES) {
        b.variant(`${c}_standing`, (m) => escooter(m, c, false));
        b.variant(`${c}_tipped`, (m) => escooter(m, c, true));
      }
    },
  },
  { id: 'soul_angler_kit', drawDistance: 70, castShadow: true, build: (b) => [0, 1, 2].forEach((k) => b.variant(`set${k}`, (m) => anglerKit(m, k))) },
];
