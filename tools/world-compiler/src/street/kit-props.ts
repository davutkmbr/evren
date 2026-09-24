/**
 * Procedural street kit props (format 1), built through the prop builder of ../props.ts: metres, +Y up, foot at the
 * origin, front / reach along +Z. Proportions follow s1-strip.md §3 and the reference photos (c01, c02, c05, c07, c09):
 * - st_bollard: black ball-top bollard 0.95 m (lane entrances), square steel quay post 0.9 m, thin crossing post;
 * - st_bin: blue İBB bin 0.9 m (slatted drum, round lid, concrete foot);
 * - st_bench: wooden slats on two concrete mushroom feet, with or without a backrest (seat faces +Z);
 * - st_planter: concrete trough or bowl with a shrub;
 * - st_tree: branch skeleton with mottled bark and geometric leaf clusters (street tree, large plane tree; tree.ts);
 * - st_cabinet: grey utility cabinet;
 * - st_signal: traffic / pedestrian signal pole (heads face +Z);
 * - st_stop_pole: grey pole with an oval tram stop sign or a bus stop plate on a bracket (+X);
 * - st_pendant: lantern hanging from a span wire (warm glass, light template);
 * - st_twin_lantern: junction column with two lanterns;
 * - st_umbrella: café parasol;
 * - st_person: neutral placeholder people (MetaHuman crowd later) in palettes x poses, facing +Z.
 * Street furniture is worn (format 1.1, S1 round 2): `@worn` materials and a wear painter per prop give COLOR_0 and
 * `_WEATHER` (grime and splash at the foot, rust runs under caps and collars, chipped paint on the edges, scuffed and
 * mismatched bench slats); `vertexAttributes` writes them into the prop glbs.
 */

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const h1 = (x: number): number => {
  const v = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * Wear of a standing metal or concrete piece: grime and splash in the bottom 0.35 m, rust runs below the heights in
 * `runs` (0.6 m long, in vertical stripes round the piece), chipped edges (`chip`, more on up-facing tops above `top`).
 */
function wearPainter(o: { top: number; rust: number; chip: number; runs: number[]; seed: number }): Painter {
  return (p, n) => {
    const y = p[1];
    const foot = 1 - smooth(0, 0.35, y);
    const dirt = Math.max(0.9 * foot, 0.18 * h1(Math.floor(y * 6) + o.seed));
    const damp = 0.6 * (1 - smooth(0, 0.12, y));
    const ang = Math.atan2(p[2], p[0]);
    const stripe = Math.max(0, Math.sin(ang * 5 + o.seed * 3.1) * 0.6 + Math.sin(ang * 11 + o.seed) * 0.4);
    let streak = 0;
    for (const h of o.runs) {
      if (y < h && y > h - 0.6) {
        streak = Math.max(streak, (1 - (h - y) / 0.6) * stripe * stripe * o.rust);
      }
    }
    const edge = o.chip * (n[1] > 0.6 && y > o.top - 0.1 ? 1 : 0.6);
    const c = 1 - 0.22 * foot;
    return { weather: [Math.min(1, dirt), Math.min(1, streak), Math.min(1, edge), damp], color: [c, c * 0.98, c * 0.95, 1] };
  };
}
import type { PropDef } from '../props';
import type { TileMesh, Vec3 } from '../mesh';
import { PERSON_BOTTOMS, PERSON_SKIN, PERSON_TOPS } from './materials';
import { aabox, beam, cylinder, ellipsoid, lathe, obox, type Painter, tube, withPaint } from './shapes';
import { buildTree } from './tree';

function bollard(mesh: TileMesh, kind: 'ball' | 'ball_rusty' | 'post' | 'thin' | 'cube'): void {
  if (kind === 'cube') {
    // Granite cube bollard (c07 photo), chamfered top.
    withPaint(wearPainter({ top: 0.5, rust: 0, chip: 0.7, runs: [], seed: 5 }), () => {
      obox(mesh, 'st_kerb', [0, 0.22, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.21, 0.22, 0.21);
      obox(mesh, 'st_kerb', [0, 0.47, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.19, 0.03, 0.19);
    });
    return;
  }
  const rusty = kind === 'ball_rusty';
  withPaint(wearPainter({ top: kind === 'thin' ? 0.84 : 0.95, rust: rusty ? 1 : 0.5, chip: rusty ? 0.6 : 0.28, runs: kind === 'ball' || rusty ? [0.8, 0.07] : [0.86, 0.66], seed: rusty ? 7 : 3 }), () => bollardShape(mesh, kind === 'ball_rusty' ? 'ball' : kind));
}

function bollardShape(mesh: TileMesh, kind: 'ball' | 'post' | 'thin'): void {
  const m = 'st_black_metal@worn';
  if (kind === 'ball') {
    lathe(mesh, m, 0, 0, 0, [
      [0.085, 0],
      [0.085, 0.05],
      [0.065, 0.07],
      [0.06, 0.78],
      [0.075, 0.8],
      [0.075, 0.84],
      [0.06, 0.86],
    ], 12);
    ellipsoid(mesh, m, [0, 0.915, 0], 0.07, 0.07, 0.07, 12, 6);
  } else if (kind === 'post') {
    obox(mesh, m, [0, 0.43, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.055, 0.43, 0.055);
    lathe(mesh, m, 0, 0.86, 0, [
      [0.078, 0],
      [0.07, 0.03],
      [0.035, 0.05],
      [0.0, 0.055],
    ], 8);
  } else {
    lathe(mesh, m, 0, 0, 0, [
      [0.05, 0],
      [0.04, 0.02],
      [0.04, 0.82],
      [0.02, 0.84],
    ], 10);
    lathe(mesh, 'st_sign_white', 0, 0.66, 0, [
      [0.043, 0],
      [0.043, 0.06],
    ], 10, false);
  }
}

function bin(mesh: TileMesh): void {
  withPaint(wearPainter({ top: 0.9, rust: 0.7, chip: 0.5, runs: [0.72, 0.2], seed: 2 }), () => binShape(mesh));
}

function binShape(mesh: TileMesh): void {
  lathe(mesh, 'st_concrete@worn', 0, 0, 0, [
    [0.24, 0],
    [0.24, 0.07],
    [0.2, 0.1],
  ], 14);
  cylinder(mesh, 'st_blue_metal@worn', 0, 0, 0.1, 0.16, 0.05, 8, false);
  cylinder(mesh, 'st_bin_liner', 0, 0, 0.18, 0.72, 0.19, 12, true);
  const slats = 18;
  for (let k = 0; k < slats; k++) {
    const a = (k / slats) * Math.PI * 2;
    const x = Math.cos(a) * 0.2;
    const z = Math.sin(a) * 0.2;
    obox(mesh, 'st_blue_metal@worn', [x, 0.46, z], [-Math.sin(a), 0, Math.cos(a)], [0, 1, 0], [Math.cos(a), 0, Math.sin(a)], 0.018, 0.27, 0.006);
  }
  for (const y of [0.2, 0.7]) {
    lathe(mesh, 'st_blue_metal@worn', 0, y, 0, [
      [0.212, 0],
      [0.212, 0.025],
    ], 16, false);
  }
  cylinder(mesh, 'st_blue_metal@worn', 0, 0, 0.73, 0.8, 0.02, 6, false);
  lathe(mesh, 'st_blue_metal@worn', 0, 0.8, 0, [
    [0.27, 0],
    [0.28, 0.02],
    [0.26, 0.05],
    [0.15, 0.09],
    [0.0, 0.1],
  ], 16);
}

/** Bench slats: scuffed edges, grime, and a tone per slat (repainted or replaced ones). */
const slatPainter =
  (seed: number): Painter =>
  (p, n) => {
    const k = Math.round((p[2] + p[1] * 0.5) / 0.095);
    const tone = 0.7 + 0.3 * h1(k * 3.7 + seed);
    const endWear = smooth(0.7, 0.95, Math.abs(p[0]));
    return { weather: [0.25 + 0.3 * h1(k + seed * 2), 0, Math.min(1, 0.45 + 0.5 * endWear + (n[1] > 0.6 ? 0.2 : 0)), 0], color: [tone, tone * 0.99, tone * 0.97, 1] };
  };

function bench(mesh: TileMesh, back: boolean, steel = false): void {
  const frame = wearPainter({ top: 0.9, rust: 0.8, chip: 0.35, runs: [0.43, 0.85], seed: 4 });
  withPaint(frame, () => benchFrame(mesh, back));
  withPaint(slatPainter(steel ? 9 : 1), () => benchSlats(mesh, back, steel ? 'st_bench_steel@worn' : 'st_bench_wood@worn'));
}

function benchFrame(mesh: TileMesh, back: boolean): void {
  for (const x of [-0.62, 0.62]) {
    lathe(mesh, 'st_concrete@worn', x, 0, 0, [
      [0.2, 0],
      [0.21, 0.05],
      [0.15, 0.16],
      [0.13, 0.3],
      [0.2, 0.38],
      [0.2, 0.4],
    ], 12);
    aabox(mesh, 'st_black_metal@worn', [x - 0.03, 0.4, -0.22], [x + 0.03, 0.43, 0.2]);
  }
  if (back) {
    for (const x of [-0.62, 0.62]) {
      beam(mesh, 'st_black_metal@worn', [x, 0.43, -0.2], [x, 0.85, -0.3], 0.05, 0.03, [0, 0, 1]);
    }
  }
}

function benchSlats(mesh: TileMesh, back: boolean, slat: string): void {
  for (let k = 0; k < 5; k++) {
    const z = -0.2 + k * 0.095;
    aabox(mesh, slat, [-0.95, 0.43, z - 0.04], [0.95, 0.465, z + 0.04]);
  }
  if (back) {
    for (let k = 0; k < 3; k++) {
      const y = 0.55 + k * 0.11;
      const z = -0.23 - (y - 0.45) * 0.24;
      obox(mesh, slat, [0, y, z], [1, 0, 0], [0, 0.97, -0.24], [0, 0.24, 0.97], 0.95, 0.04, 0.017);
    }
  }
}

function planter(mesh: TileMesh, round: boolean): void {
  withPaint(wearPainter({ top: 0.55, rust: 0, chip: 0.5, runs: [], seed: 6 }), () => planterPot(mesh, round));
  planterPlants(mesh, round);
}

function planterPot(mesh: TileMesh, round: boolean): void {
  if (round) {
    lathe(mesh, 'st_concrete@worn', 0, 0, 0, [
      [0.3, 0],
      [0.42, 0.25],
      [0.48, 0.5],
      [0.44, 0.52],
    ], 16);
  } else {
    aabox(mesh, 'st_concrete@worn', [-0.65, 0, -0.35], [0.65, 0.55, 0.35]);
  }
}

function planterPlants(mesh: TileMesh, round: boolean): void {
  if (round) {
    cylinder(mesh, 'st_soil', 0, 0, 0.44, 0.47, 0.42, 16, true);
    ellipsoid(mesh, 'st_leaves', [0, 0.75, 0], 0.42, 0.38, 0.42, 10, 6);
    ellipsoid(mesh, 'st_leaves_dark', [0.15, 0.62, 0.1], 0.3, 0.25, 0.3, 8, 5);
  } else {
    aabox(mesh, 'st_soil', [-0.58, 0.55, -0.28], [0.58, 0.56, 0.28]);
    ellipsoid(mesh, 'st_leaves', [-0.25, 0.8, 0], 0.4, 0.32, 0.3, 10, 6);
    ellipsoid(mesh, 'st_leaves_dark', [0.3, 0.75, 0.02], 0.35, 0.28, 0.28, 10, 6);
  }
}

function cabinet(mesh: TileMesh, wide: boolean): void {
  const hw = wide ? 0.65 : 0.42;
  withPaint(wearPainter({ top: 0.12, rust: 0, chip: 0.5, runs: [], seed: 14 }), () => aabox(mesh, 'st_concrete@worn', [-hw - 0.04, 0, -0.22], [hw + 0.04, 0.12, 0.22]));
  aabox(mesh, 'st_cabinet', [-hw, 0.12, -0.18], [hw, 1.32, 0.18]);
  aabox(mesh, 'st_cabinet', [-hw - 0.02, 1.32, -0.2], [hw + 0.02, 1.36, 0.2]);
  aabox(mesh, 'st_grey_metal', [-hw + 0.05, 0.25, 0.18], [-hw + 0.08, 1.2, 0.19]);
}

/**
 * Signal head of n lenses (red on top, green at the bottom) at y0, facing +Z turned by `yaw` (about +Y) on the pole;
 * only the `lit` lens glows (a real head shows one aspect), the others are dark glass.
 */
function signalHead(mesh: TileMesh, y0: number, n: number, yaw: number, lit: 'red' | 'green' = 'red'): void {
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const R = (p: Vec3): Vec3 => [p[0] * c + p[2] * sn, p[1], -p[0] * sn + p[2] * c];
  const hh = n * 0.3 + 0.06;
  const u: Vec3 = R([1, 0, 0]);
  const w: Vec3 = R([0, 0, 1]);
  obox(mesh, 'st_black_metal@worn', R([0, y0 + hh / 2, 0.18]), u, [0, 1, 0], w, 0.16, hh / 2, 0.12);
  for (let k = 0; k < n; k++) {
    const y = y0 + hh - 0.18 - k * 0.3;
    const aspect = k === 0 ? 'red' : k === n - 1 ? 'green' : 'amber';
    const lens = aspect === lit ? (lit === 'red' ? 'st_signal_lens_red' : 'st_signal_lens_green') : 'st_signal_lens_off';
    mesh.flatPolygon(lens, [...Array(10)].map((_, q): Vec3 => R([Math.cos((q / 10) * Math.PI * 2) * 0.1, y + Math.sin((q / 10) * Math.PI * 2) * 0.1, 0.305])), w);
    obox(mesh, 'st_black_metal', R([0, y + 0.11, 0.36]), u, [0, 1, 0], w, 0.12, 0.01, 0.06);
  }
  obox(mesh, 'st_grey_metal@worn', R([0, y0 + 0.25, 0.035]), u, [0, 1, 0], w, 0.04, 0.05, 0.035);
}

/** Signal pole: traffic (3 lenses, +Z), pedestrian (2 lenses, +Z) or combo (traffic head +Z, pedestrian head -X). */
function signal(mesh: TileMesh, kind: 'traffic' | 'pedestrian' | 'combo'): void {
  withPaint(wearPainter({ top: 3.6, rust: 0.6, chip: 0.25, runs: [2.2, 1.9, 0.3], seed: 8 }), () => signalShape(mesh, kind));
}

function signalShape(mesh: TileMesh, kind: 'traffic' | 'pedestrian' | 'combo'): void {
  cylinder(mesh, 'st_grey_metal@worn', 0, 0, 0, kind === 'combo' ? 3.6 : 3.3, 0.055, 10, true);
  // Traffic heads show red (cars wait at the zebras), the pedestrian heads green.
  if (kind === 'pedestrian') {
    signalHead(mesh, 2.2, 2, 0, 'green');
  } else {
    signalHead(mesh, 2.4, 3, 0, 'red');
  }
  if (kind === 'combo') {
    signalHead(mesh, 1.95, 2, -Math.PI / 2, 'green');
    // Push-button box for pedestrians.
    obox(mesh, 'st_sign_white', [-0.09, 1.1, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.035, 0.08, 0.05);
  }
}

function stopPole(mesh: TileMesh, tram: boolean): void {
  withPaint(wearPainter({ top: 3.8, rust: 0.5, chip: 0.35, runs: [3.2, 0.3], seed: 10 }), () => cylinder(mesh, 'st_grey_metal@worn', 0, 0, 0, 3.8, 0.055, 10, true));
  if (tram) {
    beam(mesh, 'st_black_metal', [0, 3.2, 0], [0.95, 3.2, 0], 0.03, 0.03);
    tube(mesh, 'st_black_metal', [[0.05, 3.05, 0], [0.35, 3.18, 0]], 0.012, 4);
    // Oval sign: navy face with a white rim, hanging under the bracket, faces +-Z.
    const cx = 0.6;
    const cy = 2.8;
    const ring = (rx: number, ry: number, z: number): Vec3[] => [...Array(20)].map((_, q): Vec3 => [cx + Math.cos((q / 20) * Math.PI * 2) * rx, cy + Math.sin((q / 20) * Math.PI * 2) * ry, z]);
    for (const z of [0.012, -0.012]) {
      mesh.flatPolygon('st_sign_white', ring(0.4, 0.24, z), [0, 0, Math.sign(z)]);
      mesh.flatPolygon('st_sign_navy', ring(0.36, 0.2, z * 1.4), [0, 0, Math.sign(z)]);
      mesh.flatPolygon('st_sign_white', ring(0.12, 0.1, z * 1.8), [0, 0, Math.sign(z)]);
    }
    for (const x of [0.4, 0.8]) {
      tube(mesh, 'st_black_metal', [[x, 3.2, 0], [x, 3.04, 0]], 0.006, 4);
    }
  } else {
    aabox(mesh, 'st_sign_blue', [0.06, 2.6, -0.01], [0.66, 3.2, 0.01]);
    aabox(mesh, 'st_sign_white', [0.12, 2.95, -0.012], [0.6, 3.12, 0.012]);
    aabox(mesh, 'st_grey_metal', [0.04, 2.7, -0.015], [0.08, 3.1, 0.015]);
  }
  aabox(mesh, 'st_sign_white', [-0.2, 3.3, -0.01], [0.2, 3.7, 0.01]);
}

/** Pendant lantern: the suspension point (on the span wire) is 0.9 m above the foot, i.e. place it at wire - 0.9. */
function pendant(mesh: TileMesh): void {
  tube(mesh, 'st_cable', [[0, 0.9, 0], [0, 0.55, 0]], 0.006, 4);
  lathe(mesh, 'st_black_metal', 0, 0.3, 0, [
    [0.02, 0.25],
    [0.16, 0.2],
    [0.24, 0.12],
    [0.25, 0.1],
  ], 12);
  lathe(mesh, 'st_lamp_glass_warm', 0, 0.12, 0, [
    [0.06, 0],
    [0.14, 0.05],
    [0.18, 0.2],
    [0.16, 0.28],
  ], 12, true);
}

function twinLantern(mesh: TileMesh): void {
  withPaint(wearPainter({ top: 3.7, rust: 0.6, chip: 0.3, runs: [0.5, 3.6], seed: 12 }), () => lathe(mesh, 'st_black_metal@worn', 0, 0, 0, [
    [0.16, 0],
    [0.16, 0.25],
    [0.1, 0.4],
    [0.075, 0.5],
    [0.07, 3.6],
    [0.09, 3.7],
  ], 12));
  beam(mesh, 'st_black_metal', [-0.62, 3.72, 0], [0.62, 3.72, 0], 0.05, 0.05);
  for (const x of [-0.55, 0.55]) {
    lathe(mesh, 'st_black_metal', x, 3.75, 0, [
      [0.07, 0],
      [0.1, 0.05],
    ], 8);
    lathe(mesh, 'st_lamp_glass_warm', x, 3.8, 0, [
      [0.1, 0],
      [0.16, 0.3],
      [0.14, 0.42],
    ], 8, true);
    lathe(mesh, 'st_black_metal', x, 4.22, 0, [
      [0.17, 0],
      [0.19, 0.03],
      [0.08, 0.14],
      [0.0, 0.2],
    ], 8);
  }
}

function umbrella(mesh: TileMesh, fabric: string): void {
  withPaint(wearPainter({ top: 0.12, rust: 0, chip: 0.5, runs: [], seed: 13 }), () => cylinder(mesh, 'st_concrete@worn', 0, 0, 0, 0.12, 0.28, 12, true));
  cylinder(mesh, 'st_grey_metal', 0, 0, 0.12, 2.55, 0.025, 8, true);
  const canopy: [number, number][] = [
    [1.3, 0],
    [1.28, 0.06],
    [0.6, 0.38],
    [0.0, 0.5],
  ];
  lathe(mesh, fabric, 0, 2.05, 0, canopy, 8, false);
  lathe(mesh, fabric, 0, 2.045, 0, [...canopy].reverse(), 8, false);
}

type Pose = 'standing' | 'walking';

/** Neutral person (1.75 m before instance scale) in a pose with a palette of flat materials, facing +Z. */
function person(mesh: TileMesh, pose: Pose | 'sitting', top: number, bottom: number, skin: number): void {
  const T = `st_person_top${top}`;
  const Bm = `st_person_bottom${bottom}`;
  const S = `st_person_skin${skin}`;
  const hip = pose === 'sitting' ? 0.47 : 0.92;
  const lift = hip - 0.92;
  const up = (v: Vec3): Vec3 => [v[0], v[1] + lift, v[2]];
  ellipsoid(mesh, S, up([0, 1.64, 0.01]), 0.085, 0.11, 0.1, 10, 6);
  ellipsoid(mesh, 'st_person_hair', up([0, 1.69, -0.012]), 0.09, 0.075, 0.1, 10, 5);
  lathe(mesh, S, 0, 1.44 + lift, 0, [
    [0.05, 0],
    [0.05, 0.1],
  ], 8, false);
  // Torso: a lathed jacket (shoulders to hips), pelvis in the trouser colour.
  lathe(mesh, T, 0, 0.88 + lift, 0, [
    [0.16, 0],
    [0.165, 0.12],
    [0.17, 0.3],
    [0.19, 0.45],
    [0.2, 0.52],
    [0.12, 0.58],
    [0.05, 0.6],
  ], 10, true, 0.62);
  lathe(mesh, Bm, 0, 0.84 + lift, 0, [
    [0.15, 0],
    [0.162, 0.08],
    [0.16, 0.12],
  ], 10, false, 0.66);
  for (const side of [-1, 1]) {
    const sx = side * 0.095;
    const swing = pose === 'walking' ? side * 0.2 : 0;
    const legs: [Vec3, Vec3, Vec3] =
      pose === 'sitting'
        ? [
            [sx, 0.47, 0.02],
            [sx, 0.47, 0.44],
            [sx * 1.05, 0.08, 0.46],
          ]
        : [
            [sx, 0.88, 0],
            [sx, 0.5, swing * 0.5],
            [sx * 1.05, 0.08, swing * 0.95],
          ];
    tube(mesh, Bm, [legs[0], legs[1]], 0.075, 8);
    tube(mesh, Bm, [legs[1], legs[2]], 0.058, 8);
    const ank = legs[2];
    ellipsoid(mesh, 'st_person_shoe', [ank[0], 0.045, ank[2] + 0.05], 0.05, 0.045, 0.13, 8, 4);
    const shoulder = up([side * 0.2, 1.38, 0]);
    const armSwing = pose === 'walking' ? -side * 0.18 : 0;
    const elbow: Vec3 = pose === 'sitting' ? up([side * 0.23, 1.12, 0.08]) : up([side * 0.24, 1.1, armSwing * 0.6]);
    const wrist: Vec3 = pose === 'sitting' ? up([side * 0.2, 1.0, 0.3]) : up([side * 0.25, 0.86, armSwing]);
    tube(mesh, T, [shoulder, elbow], 0.05, 8);
    tube(mesh, T, [elbow, wrist], 0.042, 8);
    ellipsoid(mesh, S, [wrist[0], wrist[1] - 0.06, wrist[2] + (pose === 'sitting' ? 0.05 : 0)], 0.035, 0.07, 0.03, 6, 4);
  }
}

/** Palettes of the placeholder people: [top, bottom, skin]. */
export const PERSON_PALETTES: [number, number, number][] = [
  [0, 0, 0],
  [1, 1, 1],
  [2, 3, 0],
  [3, 1, 2],
  [4, 0, 1],
  [5, 2, 0],
  [6, 4, 1],
  [7, 1, 0],
  [8, 3, 2],
  [9, 0, 1],
  [2, 2, 1],
  [6, 1, 0],
];

export const KIT_PROPS: PropDef[] = [
  {
    id: 'st_bollard',
    drawDistance: 80,
    castShadow: true,
    vertexAttributes: true,
    build: (b) => {
      for (const k of ['ball', 'post', 'thin', 'ball_rusty', 'cube'] as const) {
        b.variant(k, (m) => bollard(m, k));
      }
    },
  },
  { id: 'st_bin', drawDistance: 80, castShadow: true, vertexAttributes: true, build: (b) => b.variant('ibb', (m) => bin(m)) },
  {
    id: 'st_bench',
    drawDistance: 90,
    castShadow: true,
    vertexAttributes: true,
    build: (b) => {
      b.variant('back', (m) => bench(m, true));
      b.variant('flat', (m) => bench(m, false));
      b.variant('metal', (m) => bench(m, true, true));
    },
  },
  {
    id: 'st_planter',
    drawDistance: 80,
    castShadow: true,
    vertexAttributes: true,
    build: (b) => {
      b.variant('box', (m) => planter(m, false));
      b.variant('round', (m) => planter(m, true));
    },
  },
  {
    id: 'st_tree',
    drawDistance: 400,
    castShadow: true,
    vertexAttributes: true,
    build: (b) => {
      b.variant('street', (m) => buildTree(m, false));
      b.variant('plane', (m) => buildTree(m, true));
    },
  },
  {
    id: 'st_cabinet',
    vertexAttributes: true,
    drawDistance: 70,
    castShadow: true,
    build: (b) => {
      b.variant('single', (m) => cabinet(m, false));
      b.variant('double', (m) => cabinet(m, true));
    },
  },
  {
    id: 'st_signal',
    vertexAttributes: true,
    drawDistance: 150,
    castShadow: true,
    build: (b) => {
      b.variant('traffic', (m) => signal(m, 'traffic'));
      b.variant('pedestrian', (m) => signal(m, 'pedestrian'));
      b.variant('combo', (m) => signal(m, 'combo'));
    },
  },
  {
    id: 'st_stop_pole',
    vertexAttributes: true,
    drawDistance: 120,
    castShadow: true,
    build: (b) => {
      b.variant('tram', (m) => stopPole(m, true));
      b.variant('bus', (m) => stopPole(m, false));
    },
  },
  {
    id: 'st_pendant',
    drawDistance: 150,
    castShadow: false,
    build: (b) => b.variant('warm', (m) => pendant(m)),
    // A 120° downward pool (the lane under the span wire) and the glowing glass: 4,400 lm (s1-strip.md §3).
    lights: [
      { type: 'spot', position: [0, 0.14, 0], direction: [0, -1, 0], kelvin: 2700, lumens: 3800, cone: { inner: 30, outer: 60 }, night: true, source: 'lamp' },
      { type: 'point', position: 'emissive', kelvin: 2700, lumens: 600, night: true, source: 'lamp' },
    ],
  },
  {
    id: 'st_twin_lantern',
    vertexAttributes: true,
    drawDistance: 200,
    castShadow: true,
    build: (b) => b.variant('warm', (m) => twinLantern(m)),
    lights: [
      { type: 'spot', position: [-0.55, 3.85, 0], direction: [0, -1, 0], kelvin: 3000, lumens: 3800, cone: { inner: 30, outer: 60 }, night: true, source: 'lamp' },
      { type: 'spot', position: [0.55, 3.85, 0], direction: [0, -1, 0], kelvin: 3000, lumens: 3800, cone: { inner: 30, outer: 60 }, night: true, source: 'lamp' },
      { type: 'point', position: [-0.55, 4.0, 0], kelvin: 3000, lumens: 600, night: true, source: 'lamp' },
      { type: 'point', position: [0.55, 4.0, 0], kelvin: 3000, lumens: 600, night: true, source: 'lamp' },
    ],
  },
  {
    id: 'st_umbrella',
    vertexAttributes: true,
    drawDistance: 90,
    castShadow: true,
    build: (b) => {
      b.variant('cream', (m) => umbrella(m, 'st_sign_white'));
      b.variant('red', (m) => umbrella(m, 'st_sign_red'));
    },
  },
  {
    id: 'st_person',
    drawDistance: 150,
    castShadow: true,
    build: (b) => {
      PERSON_PALETTES.forEach(([top, bottom, skin], k) => {
        b.variant(`walking${k}`, (m) => person(m, 'walking', top, bottom, skin));
        b.variant(`standing${k}`, (m) => person(m, 'standing', top, bottom, skin));
        if (k < 6) {
          b.variant(`sitting${k}`, (m) => person(m, 'sitting', top, bottom, skin));
        }
      });
    },
  },
];

void PERSON_TOPS;
void PERSON_BOTTOMS;
void PERSON_SKIN;
