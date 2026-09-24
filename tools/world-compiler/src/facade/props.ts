/**
 * Procedural props of the façade kit (format 1, registered in registry.ts PROP_SETS and PROP_MATERIALS-like
 * material list FACADE_PROP_MATERIALS): outdoor AC units, satellite dishes, rooftop water tanks and TV aerials, and
 * the fish / produce stall displays of the market end (facade/stalls.ts). Low-poly stand-ins built here (no external
 * model): the approved Poly Haven AC unit is ~10k triangles and hundreds hang on the strip's façades.
 *
 * Prop convention: metres, foot at the origin, the front (the side facing away from the wall / the lane) along +Z.
 * Procedural props carry no vertex colours, so every colour is its own material.
 */
import type { MaterialDef, MaterialName } from '../materials';
import type { TileMesh, Vec3 } from '../mesh';
import { box, type PropDef } from '../props';
import { fishStall, produceStall } from './stalls';

const flat = (id: string, color: number, roughness = 0.6, metallic = 0, surface: MaterialDef['surface'] = 'other'): MaterialDef => ({ id, color, roughness, metallic, surface, castShadow: true });

export const FACADE_PROP_MATERIALS: MaterialDef[] = [
  flat('fp_ac_body', 0xe6e5df, 0.45),
  flat('fp_ac_grille', 0x2a2b2c, 0.7),
  flat('fp_steel', 0x9a9ea1, 0.4, 0.8, 'metal'),
  flat('fp_dish', 0xecebe6, 0.5),
  flat('fp_tank_steel', 0xb7babc, 0.45, 0.75, 'metal'),
  flat('fp_tank_white', 0xe7e5de, 0.55),
  flat('fp_tank_blue', 0x2c5c96, 0.5),
  flat('fp_tank_yellow', 0xd6b03a, 0.5),
  { id: 'fp_ice', color: 0xeef2f4, roughness: 0.25, surface: 'other', castShadow: false },
  flat('fp_fish', 0x9aa5ad, 0.3, 0.45),
  flat('fp_fish_red', 0xb4584c, 0.4),
  flat('fp_poly', 0xf3f3f0, 0.8),
  flat('fp_grass', 0x2e7a3c, 0.95),
  flat('fp_table', 0x8b9095, 0.4, 0.7, 'metal'),
  flat('fp_crate', 0xa57a4c, 0.85, 0, 'wood'),
  flat('fp_red', 0xb0261c, 0.5),
  flat('fp_orange', 0xe0861c, 0.55),
  flat('fp_green', 0x4d8a2e, 0.6),
  flat('fp_yellow', 0xdcbf2a, 0.55),
  flat('fp_purple', 0x43203f, 0.4),
  flat('fp_jar', 0xb9a24c, 0.2),
  flat('fp_tag', 0xf6d418, 0.55),
  flat('fp_barrel', 0x2a56a6, 0.5),
  flat('fp_pepper', 0x8e1a12, 0.6),
  /* Market stalls (facade/stalls.ts). */
  flat('fp_fish_dark', 0x3c4650, 0.35, 0.35),
  flat('fp_fish_blue', 0x2f4c63, 0.3, 0.4),
  flat('fp_fish_gold', 0xb7ab86, 0.3, 0.45),
  flat('fp_greens', 0x3f7a2a, 0.8),
  flat('fp_stick', 0xd9c9a3, 0.8, 0, 'wood'),
  flat('fp_ink', 0x1b1b1b, 0.7),
  flat('fp_scale', 0xf2f0ea, 0.3),
  flat('fp_scale_body', 0xc9ccce, 0.35, 0.6, 'metal'),
  flat('fp_bowl_steel', 0xb8bcbf, 0.3, 0.8, 'metal'),
  flat('fp_bowl_grey', 0x9aa3a6, 0.55),
  flat('fp_bowl_blue', 0x3b72b8, 0.5),
  flat('fp_crate_dark', 0x7a5a3a, 0.9, 0, 'wood'),
  flat('fp_tomato', 0xb3261a, 0.35),
  flat('fp_lemon', 0xe2c53a, 0.45),
  flat('fp_apple', 0x8fb33a, 0.4),
  flat('fp_potato', 0xa3875c, 0.85),
  flat('fp_onion', 0xc0873e, 0.5),
  flat('fp_aubergine', 0x2e1433, 0.25),
  flat('fp_pepper_green', 0x3f8a24, 0.35),
  flat('fp_cucumber', 0x2d5a22, 0.45),
  flat('fp_apricot', 0xd68a2c, 0.7),
  flat('fp_olive_black', 0x1d1a1c, 0.25),
  flat('fp_olive_green', 0x6b7a2c, 0.3),
  flat('fp_cheese', 0xeddca0, 0.6),
  flat('fp_pickle_green', 0x6f8a3a, 0.15),
  flat('fp_pickle_red', 0xb0452a, 0.15),
  flat('fp_pickle_yellow', 0xd8b640, 0.15),
  flat('fp_pickle_mixed', 0x9a6a38, 0.15),
  flat('fp_jar_glass', 0xd8e2e0, 0.08),
  flat('fp_lid', 0xc9a13a, 0.4, 0.6, 'metal'),
  flat('fp_twine', 0x9c8660, 0.9),
  flat('fp_dried_pepper', 0x5e140e, 0.55),
  flat('fp_dried_aub', 0x3a2622, 0.7),
  flat('fp_garlic', 0xe6dfcc, 0.6),
];

/** Cylinder between a and b (radius r, `seg` sides), flat-shaded sides, capped ends. */
function cyl(mesh: TileMesh, m: MaterialName, a: Vec3, b: Vec3, r: number, seg = 10, caps = true): void {
  const ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(ax[0], ax[1], ax[2]) || 1e-6;
  const u = [ax[0] / len, ax[1] / len, ax[2] / len];
  let s1 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const dp = s1[0] * u[0] + s1[1] * u[1] + s1[2] * u[2];
  s1 = [s1[0] - u[0] * dp, s1[1] - u[1] * dp, s1[2] - u[2] * dp];
  const l1 = Math.hypot(s1[0], s1[1], s1[2]);
  s1 = s1.map((v) => v / l1);
  const s2 = [u[1] * s1[2] - u[2] * s1[1], u[2] * s1[0] - u[0] * s1[2], u[0] * s1[1] - u[1] * s1[0]];
  const ring = (c: Vec3, k: number): Vec3 => {
    const t = (k / seg) * Math.PI * 2;
    return [c[0] + (s1[0] * Math.cos(t) + s2[0] * Math.sin(t)) * r, c[1] + (s1[1] * Math.cos(t) + s2[1] * Math.sin(t)) * r, c[2] + (s1[2] * Math.cos(t) + s2[2] * Math.sin(t)) * r];
  };
  for (let k = 0; k < seg; k++) {
    const p0 = ring(a, k);
    const p1 = ring(a, k + 1);
    const q1 = ring(b, k + 1);
    const q0 = ring(b, k);
    const t = ((k + 0.5) / seg) * Math.PI * 2;
    const n: Vec3 = [s1[0] * Math.cos(t) + s2[0] * Math.sin(t), s1[1] * Math.cos(t) + s2[1] * Math.sin(t), s1[2] * Math.cos(t) + s2[2] * Math.sin(t)];
    mesh.flatPolygon(m, [p0, p1, q1, q0], n);
  }
  if (caps) {
    const capA: Vec3[] = [];
    const capB: Vec3[] = [];
    for (let k = 0; k < seg; k++) {
      capA.push(ring(a, k));
      capB.push(ring(b, k));
    }
    mesh.flatPolygon(m, capA, [-u[0], -u[1], -u[2]]);
    mesh.flatPolygon(m, capB, [u[0], u[1], u[2]]);
  }
}

/** Outdoor AC unit on wall brackets: back against the wall (z = 0), front +Z, foot = bracket bottom. */
function acUnit(mesh: TileMesh): void {
  box(mesh, 'fp_ac_body', [-0.4, 0.06, 0.04], [0.4, 0.6, 0.32], false);
  const c: Vec3 = [-0.1, 0.33, 0.321];
  const disc: Vec3[] = [];
  for (let k = 0; k < 12; k++) {
    const t = (k / 12) * Math.PI * 2;
    disc.push([c[0] + Math.cos(t) * 0.2, c[1] + Math.sin(t) * 0.2, c[2]]);
  }
  mesh.flatPolygon('fp_ac_grille', disc, [0, 0, 1]);
  for (const x of [-0.3, 0.3]) {
    box(mesh, 'fp_steel', [x - 0.02, 0, 0], [x + 0.02, 0.05, 0.38], false);
    box(mesh, 'fp_steel', [x - 0.02, 0, 0], [x + 0.02, 0.3, 0.04], false);
  }
}

/** Satellite dish on a wall arm, facing +Z tilted up by the Türksat elevation (~40°). */
function dish(mesh: TileMesh): void {
  const el = (40 * Math.PI) / 180;
  const c: Vec3 = [0, 0.45, 0.35];
  const n: Vec3 = [0, Math.sin(el), Math.cos(el)];
  // Dish: a shallow cone of 12 segments (rim radius 0.38, depth 0.08).
  const up: Vec3 = [0, Math.cos(el), -Math.sin(el)];
  const side: Vec3 = [1, 0, 0];
  const rim: Vec3[] = [];
  for (let k = 0; k < 12; k++) {
    const t = (k / 12) * Math.PI * 2;
    rim.push([c[0] + side[0] * Math.cos(t) * 0.38 + up[0] * Math.sin(t) * 0.38 + n[0] * 0.08, c[1] + side[1] * Math.cos(t) * 0.38 + up[1] * Math.sin(t) * 0.38 + n[1] * 0.08, c[2] + side[2] * Math.cos(t) * 0.38 + up[2] * Math.sin(t) * 0.38 + n[2] * 0.08]);
  }
  const pos: number[] = [...c, ...rim.flat()];
  const idx: number[] = [];
  for (let k = 0; k < 12; k++) {
    idx.push(0, 1 + k, 1 + ((k + 1) % 12), 0, 1 + ((k + 1) % 12), 1 + k);
  }
  mesh.addMesh('fp_dish', { positions: pos, indices: idx });
  // LNB arm and wall bracket.
  cyl(mesh, 'fp_steel', [0, 0.3, 0.3], [c[0] + n[0] * 0.45, c[1] + n[1] * 0.45 - 0.05, c[2] + n[2] * 0.45], 0.012, 5, false);
  box(mesh, 'fp_ac_grille', [c[0] + n[0] * 0.45 - 0.03, c[1] + n[1] * 0.45 - 0.06, c[2] + n[2] * 0.45 - 0.05], [c[0] + n[0] * 0.45 + 0.03, c[1] + n[1] * 0.45, c[2] + n[2] * 0.45 + 0.03], false);
  cyl(mesh, 'fp_steel', [0, 0, 0.02], [0, 0.45, 0.3], 0.02, 6, false);
  box(mesh, 'fp_steel', [-0.06, 0, 0], [0.06, 0.16, 0.03], false);
}

function tank(mesh: TileMesh, kind: 'steel' | 'white' | 'blue' | 'yellow'): void {
  if (kind === 'steel') {
    cyl(mesh, 'fp_tank_steel', [-0.8, 0.62, 0], [0.8, 0.62, 0], 0.42, 12);
    for (const x of [-0.5, 0.5]) {
      box(mesh, 'fp_steel', [x - 0.04, 0, -0.35], [x + 0.04, 0.3, 0.35], false);
    }
    return;
  }
  const m = `fp_tank_${kind}`;
  cyl(mesh, m, [0, 0.02, 0], [0, 1.05, 0], 0.5, 12);
  cyl(mesh, m, [0, 1.05, 0], [0, 1.16, 0], 0.18, 8);
  box(mesh, 'fp_steel', [-0.55, 0, -0.55], [0.55, 0.03, 0.55], false);
}

/** TV aerial: a 2.6 m mast with two yagi booms. */
function aerial(mesh: TileMesh): void {
  cyl(mesh, 'fp_steel', [0, 0, 0], [0, 2.6, 0], 0.02, 6, false);
  for (const [y, l] of [
    [2.5, 1.4],
    [2.0, 1.0],
  ] as const) {
    box(mesh, 'fp_steel', [-0.012, y - 0.012, -0.2], [0.012, y + 0.012, l], false);
    for (let z = -0.1; z < l; z += 0.16) {
      const w = 0.28 - (z / l) * 0.12;
      box(mesh, 'fp_steel', [-w, y - 0.006, z - 0.006], [w, y + 0.006, z + 0.006], false);
    }
  }
}

export const FACADE_PROPS: PropDef[] = [
  { id: 'fac_ac', drawDistance: 60, castShadow: true, build: (b) => b.variant('unit', (m) => acUnit(m)) },
  { id: 'fac_dish', drawDistance: 80, castShadow: true, build: (b) => b.variant('dish', (m) => dish(m)) },
  {
    id: 'fac_tank',
    drawDistance: 140,
    castShadow: true,
    build: (b) => {
      for (const k of ['steel', 'white', 'blue', 'yellow'] as const) {
        b.variant(k, (m) => tank(m, k));
      }
    },
  },
  { id: 'fac_aerial', drawDistance: 140, castShadow: true, build: (b) => b.variant('aerial', (m) => aerial(m)) },
  {
    id: 'fac_stall_fish',
    drawDistance: 70,
    castShadow: true,
    build: (b) => {
      b.variant('ice', (m) => fishStall(m, false));
      b.variant('ice_boxes', (m) => fishStall(m, true));
    },
  },
  {
    id: 'fac_stall_produce',
    drawDistance: 70,
    castShadow: true,
    build: (b) => {
      b.variant('produce', (m) => produceStall(m, false));
      b.variant('deli', (m) => produceStall(m, true));
    },
  },
];
