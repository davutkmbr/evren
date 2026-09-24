/**
 * Soul step (format 1, full-detail tiles): places the street-level Kadıköy details of .docs/street/kadikoy-soul.md
 * (section "S1 revision") on the S1 strip as prop instances and tile geometry, and writes the manifest records the
 * later phases plug life into (`extra.soul` of each tile):
 *
 * - `animals`: cat spots (pose, coat, owned-spot kind, shelter flag), bowl sets, cat houses, dog sun spots, gull
 *   perches and pigeon feeding areas. Every animal instance is a static placeholder for an animated model (S5).
 * - `vendorSlots`: simit / corn cart, midye tray, busker points, angler points, tea ocak.
 * - `ambience`: sound zones (quay, crossing, lane, plaza, fish end, mosque side door).
 * - `counts`: instances and paper / residue items per type.
 *
 * It runs after the street, façade, hero and interior steps (registry.ts), reads the instances they placed in the tile
 * (benches, bins, poles, café chairs, market stalls, people) as anchors and keeps clear of all of them. Area-level
 * targets (a bowl pair every 15–30 m of Yasa Cd, spill-over every 6–9 m of frontage) are fixed in `prepare`, so the
 * result does not depend on the tile order. Tile geometry (stickers, posters, signs, residue) is LOD0 only.
 */
import { headingYaw, rotateYaw } from '../instances';
import type { InstanceRec, XYZ } from '../format';
import { LOD0 } from '../mesh';
import type { AreaContext, CompileStep, TileContext } from '../registry';
import { longestEdgeHeading } from '../hero/pier1926';
import { inTile, streetContext } from '../street/common';
import type { CatPose } from './animals';
import type { CatCoat } from './materials';
import { type BowlKind, MOTO_LIVERIES, SCOOTER_LIVERIES, type SpillKind } from './objects';
import { PIGEON_MODEL, PIGEON_POSES, pigeonClips, pigeonModelAvailable } from './pigeon';
import { butts, type Face, gum, husks, lostCatNotice, newPaperStats, type PoleSpec, posterGrid, rng, runoff, scraps, signWidth, stickersOnFace, stickersOnPole, streetSign } from './paper';

const r2 = (v: number): number => Math.round(v * 100) / 100;
const hash = (x: number, z: number, salt: number): number => {
  const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
};
const pickW = <T>(list: readonly (readonly [T, number])[], u: number): T => {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [v, w] of list) {
    acc += w / total;
    if (u < acc) {
      return v;
    }
  }
  return list[list.length - 1][0];
};
/** Yaw (radians about +Y) that turns a prop's +Z towards the direction (dx, dz). */
const yawTo = (dx: number, dz: number): number => Math.atan2(dx, dz);
/** Yaw of an instance's rotation quaternion (rotation about +Y only). */
const yawOf = (i: InstanceRec): number => 2 * Math.atan2(i.rotation[1], i.rotation[3]);
/** Compass heading (deg) of a prop yaw. */
const headingOf = (yaw: number): number => r2((((Math.atan2(Math.sin(yaw), -Math.cos(yaw)) * 180) / Math.PI) + 360) % 360);

const COATS: [CatCoat, number][] = [
  ['tabby', 25],
  ['tuxedo', 18],
  ['ginger', 15],
  ['greytabby', 12],
  ['calico', 10],
  ['black', 12],
  ['white', 8],
];

/** Mahalle on the corner signs: Yasa Cd runs through Osmanağa (pier end) and Caferağa (market end); addresses from
 * public listings (Yasa Cd 24 Osmanağa, Yasa Cd 56 Caferağa), the OSM street data has no boundaries. */
const JUNCTIONS: { id: string; x: number; z: number; mahalle: string }[] = [
  { id: 'P8', x: 321.9, z: 5985.4, mahalle: 'OSMANAĞA MAH.' },
  { id: 'P9', x: 335.0, z: 5991.3, mahalle: 'OSMANAĞA MAH.' },
  { id: 'P10', x: 405.1, z: 6032.1, mahalle: 'CAFERAĞA MAH.' },
  { id: 'P11', x: 442.2, z: 6052.5, mahalle: 'CAFERAĞA MAH.' },
];
const P0 = { x: 235.8, z: 5944.4 };
const P1 = { x: 262.2, z: 5945.4 };
const P8 = { x: 321.9, z: 5985.4 };
const P11 = { x: 442.2, z: 6052.5 };
/** The c02 camera (cameras.json) and the spot of the simit cart in its reference photo (about 24 m ahead, left of the pier). */
const C02 = { x: 189.8, z: 5937.6, heading: 299.5 };
/** Wind for the gulls (they perch facing into it): a late-September poyraz from the north-east. */
const WIND_FROM = 35;
const PRECINCT_WALL_ID = 179197257;
const WALL_HALF = 0.25;
const WALL_TOP = 3.28;

/* ------------------------------------------------------------------------------------------------------------- */
/* Area plan                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------- */

interface FrontSlot {
  /** Façade foot (ground point just in front of the building or precinct wall). */
  x: number;
  z: number;
  /** Unit normal towards the lane, unit tangent along the frontage. */
  nx: number;
  nz: number;
  tx: number;
  tz: number;
  ch: number;
  side: -1 | 1;
  wall: boolean;
}

interface Target {
  ch: number;
  side: -1 | 1;
  kind: string;
  k: number;
}

interface SoulPlan {
  spine: number[];
  chainage(x: number, z: number): { ch: number; d: number };
  spineAt(ch: number): { x: number; z: number; tx: number; tz: number };
  slots: FrontSlot[];
  bowlTargets: Target[];
  spillTargets: Target[];
  precinct: { ring: number[]; out: number } | null;
  /** Area-wide quotas used up tile by tile (the tile order is fixed, so the result is deterministic). */
  left: { gullPosts: number; kits: number; chairCats: number; doorCats: number; bowlCats: number; goodsCats: number; wallCats: number; benchCats: number; squareBowls: number; kittens: number; pitBowls: number; paintedHouses: number };
  totals: Record<string, number>;
}

function wallRing(a: AreaContext): { ring: number[]; out: number } | null {
  const shared = a.shared.get('precinct') as { ring: number[]; out: number } | null | undefined;
  if (shared) {
    return { ring: shared.ring, out: shared.out };
  }
  const line = a.data.lines.find((l) => l.id === PRECINCT_WALL_ID);
  if (!line) {
    return null;
  }
  let ring = [...line.pts];
  if (Math.hypot(ring[0] - ring[ring.length - 2], ring[1] - ring[ring.length - 1]) < 0.01) {
    ring = ring.slice(0, -2);
  }
  let area = 0;
  for (let k = 0; k < ring.length; k += 2) {
    const j = (k + 2) % ring.length;
    area += ring[k] * ring[j + 1] - ring[j] * ring[k + 1];
  }
  return { ring, out: area > 0 ? 1 : -1 };
}

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

function ringDist(ring: readonly number[], x: number, z: number): number {
  let d = Infinity;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    d = Math.min(d, segDist(x, z, ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]));
  }
  return d;
}

function soulPlan(a: AreaContext): SoulPlan {
  const known = a.shared.get('soul') as SoulPlan | undefined;
  if (known) {
    return known;
  }
  const sc = streetContext(a);
  const s = a.foundation.surface;
  const fp = a.foundation.footprints;
  const spine = sc.spine;
  const acc = [0];
  for (let k = 2; k < spine.length; k += 2) {
    acc.push(acc[acc.length - 1] + Math.hypot(spine[k] - spine[k - 2], spine[k + 1] - spine[k - 1]));
  }
  const chainage = (x: number, z: number): { ch: number; d: number } => {
    let best = { ch: 0, d: Infinity };
    for (let k = 2; k < spine.length; k += 2) {
      const ax = spine[k - 2];
      const az = spine[k - 1];
      const dx = spine[k] - ax;
      const dz = spine[k + 1] - az;
      const l2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d < best.d) {
        best = { ch: acc[k / 2 - 1] + t * Math.sqrt(l2), d };
      }
    }
    return best;
  };
  const spineAt = (ch: number): { x: number; z: number; tx: number; tz: number } => {
    for (let k = 2; k < spine.length; k += 2) {
      const c0 = acc[k / 2 - 1];
      const c1 = acc[k / 2];
      if (ch <= c1 || k === spine.length - 2) {
        const l = c1 - c0 || 1;
        const t = Math.max(0, Math.min(1, (ch - c0) / l));
        const tx = (spine[k] - spine[k - 2]) / l;
        const tz = (spine[k + 1] - spine[k - 1]) / l;
        return { x: spine[k - 2] + (spine[k] - spine[k - 2]) * t, z: spine[k - 1] + (spine[k + 1] - spine[k - 1]) * t, tx, tz };
      }
    }
    return { x: spine[0] ?? 0, z: spine[1] ?? 0, tx: 1, tz: 0 };
  };
  const precinct = wallRing(a);
  // Front slots of Yasa Cd (ch 126-263): march from the centre line to the façade (or the precinct wall) on both sides.
  const slots: FrontSlot[] = [];
  const end = acc[acc.length - 1] ?? 0;
  for (let ch = 126; ch <= Math.min(263, end); ch += 1) {
    const p = spineAt(ch);
    for (const side of [-1, 1] as const) {
      const nx = -p.tz * side;
      const nz = p.tx * side;
      let hit: FrontSlot | null = null;
      for (let d = 0.6; d < 7.5; d += 0.1) {
        const x = p.x + nx * d;
        const z = p.z + nz * d;
        const wall = !!precinct && ringDist(precinct.ring, x, z) < WALL_HALF + 0.12;
        if (wall || s.buildingDistance(x, z) < 0.12 || fp.inside(x, z)) {
          if (d > 0.9) {
            const bx = p.x + nx * (d - 0.1);
            const bz = p.z + nz * (d - 0.1);
            hit = { x: bx, z: bz, nx: -nx, nz: -nz, tx: p.tx, tz: p.tz, ch, side, wall };
          }
          break;
        }
      }
      if (hit) {
        slots.push(hit);
      }
    }
  }
  // Bowl pairs: one every 15-30 m along Yasa Cd, alternating sides; spill-over: every 6-9 m of each side.
  const bowlTargets: Target[] = [];
  let k = 0;
  for (let ch = 132; ch < 262; ch += 15 + hash(ch, 1, 3) * 13) {
    bowlTargets.push({ ch, side: hash(ch, 2, 5) < 0.5 ? -1 : 1, kind: 'bowls', k: k++ });
  }
  const spillTargets: Target[] = [];
  for (const side of [-1, 1] as const) {
    for (let ch = 128 + hash(side, 3, 7) * 4; ch < 262; ch += 6 + hash(ch, side, 9) * 3) {
      spillTargets.push({ ch, side, kind: 'spill', k: k++ });
    }
  }
  const plan: SoulPlan = { spine, chainage, spineAt, slots, bowlTargets, spillTargets, precinct, left: { gullPosts: 5, kits: 3, chairCats: 2, doorCats: 1, bowlCats: 1, goodsCats: 1, wallCats: 1, benchCats: 3, squareBowls: 3, kittens: 1, pitBowls: 2, paintedHouses: 1 }, totals: {} };
  a.shared.set('soul', plan);
  return plan;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Tile                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------- */

interface Disc {
  x: number;
  z: number;
  r: number;
}

/** Clearance radius of an instance on the ground (null: overhead or on a façade, ignored). */
function footprintOf(i: InstanceRec, gy: number): Disc | null {
  const [x, y, z] = i.position;
  if (y > gy + 1.0) {
    return null;
  }
  const a = i.asset;
  if (a.startsWith('fac_stall')) {
    const off = rotateYaw([0, 0, 0.8], yawOf(i));
    return { x: x + off[0], z: z + off[2], r: 1.35 };
  }
  const table: [RegExp, number][] = [
    [/^st_person|^mannequin/, 0.3],
    [/^outdoor_table_chair_set/, 0.9],
    [/^plastic_monobloc/, 0.35],
    [/^standing_chalkboard|^st_chalk/, 0.45],
    [/^st_bench/, 1.0],
    [/^st_bin/, 0.35],
    [/^st_bollard/, 0.15],
    [/^lamp_mast|^street_lamp/, 0.25],
    [/^st_signal|^st_stop_pole/, 0.18],
    [/^st_cabinet/, 0.75],
    [/^st_planter/, 0.7],
    [/^st_twin_lantern|^st_umbrella/, 0.32],
    [/^st_tree/, 0.7],
    [/^st_vehicle/, 2.4],
    [/^hero_/, 0],
    [/^soul_cart/, 1.0],
    [/^soul_moto/, 0.5],
    [/^soul_container/, 0.8],
    [/^soul_spill/, 0.55],
    [/^soul_cathouse/, 0.35],
    [/^soul_bowl/, 0.12],
    [/^soul_dog/, 0.6],
    [/^soul_pigeon/, 0.12],
    [/^soul_/, 0.15],
  ];
  for (const [re, r] of table) {
    if (re.test(a)) {
      return r > 0 ? { x, z, r } : null;
    }
  }
  return { x, z, r: 0.4 };
}

interface Records {
  cats: Record<string, unknown>[];
  bowlSets: Record<string, unknown>[];
  catHouses: Record<string, unknown>[];
  dogSpots: Record<string, unknown>[];
  gullPerches: Record<string, unknown>[];
  pigeonAreas: Record<string, unknown>[];
  vendorSlots: Record<string, unknown>[];
  ambience: Record<string, unknown>[];
}

function tileStep(t: TileContext): void {
  const a = t.area;
  const plan = soulPlan(a);
  const sc = streetContext(a);
  const s = a.foundation.surface;
  const fp = a.foundation.footprints;
  const gy = (x: number, z: number): number => sc.groundY(x, z);
  const anchors = t.instances.list.slice();
  const discs: Disc[] = [];
  for (const i of anchors) {
    const d = footprintOf(i, gy(i.position[0], i.position[2]));
    if (d) {
      discs.push(d);
    }
  }
  const people = anchors.filter((i) => i.asset === 'st_person' || i.asset === 'mannequin');
  const near = (x: number, z: number): boolean => sc.spineDist(x, z) < 45 || sc.inSquare(x, z);
  /** Ground is walkable paving at (x, z): land, outside buildings, off the carriageway (or on a pedestrian lane). */
  const paved = (x: number, z: number, wall = 0.15): boolean => a.land(x, z) > 0.3 && !fp.inside(x, z) && s.buildingDistance(x, z) >= wall && (s.distance(x, z) > 0.3 || s.pedestrianStreet(x, z)) && (!plan.precinct || ringDist(plan.precinct.ring, x, z) > WALL_HALF + 0.08);
  const clear = (x: number, z: number, r: number): boolean => discs.every((d) => Math.hypot(d.x - x, d.z - z) > d.r + r);
  const free = (x: number, z: number, r: number, wall = 0.15, ignore?: readonly number[]): boolean => paved(x, z, wall) && (ignore ? discs.every((d) => Math.hypot(d.x - ignore[0], d.z - ignore[2]) < 0.05 || Math.hypot(d.x - x, d.z - z) > d.r + r) : clear(x, z, r));
  /** The free spot nearest to (x, z) within `reach` m (rings of 0.3 m), or null. */
  const nearFree = (x: number, z: number, r: number, wall: number, reach: number): [number, number] | null => {
    for (let d = 0; d <= reach; d += 0.3) {
      const n = Math.max(1, Math.round((d * Math.PI * 2) / 0.3));
      for (let k = 0; k < n; k++) {
        const px = x + Math.cos((k / n) * Math.PI * 2) * d;
        const pz = z + Math.sin((k / n) * Math.PI * 2) * d;
        if (free(px, pz, r, wall)) {
          return [px, pz];
        }
      }
    }
    return null;
  };
  const claim = (x: number, z: number, r: number): void => {
    discs.push({ x, z, r });
  };
  const counts: Record<string, number> = {};
  const count = (k: string, n = 1): void => {
    counts[k] = (counts[k] ?? 0) + n;
  };
  let seq = 0;
  const place = (asset: string, variant: string, x: number, y: number, z: number, yaw: number, ref: string, scale?: number): InstanceRec => {
    count(`${asset}:${variant.replace(/_(standing|sitting|pecking|walking|tipped|sit|loaf|curl|side|sphinx)$/, '')}`);
    return t.place(asset, [x, y, z], yaw, { variant, ref: `${t.id}/soul/${ref}`, seed: seq++, ...(scale !== undefined ? { scale } : {}) });
  };
  const rec: Records = { cats: [], bowlSets: [], catHouses: [], dogSpots: [], gullPerches: [], pigeonAreas: [], vendorSlots: [], ambience: [] };
  const stats = newPaperStats();
  const trisBefore = t.mesh.triangles(LOD0);

  /* Cats ---------------------------------------------------------------------------------------------------------- */
  let catN = 0;
  const cat = (x: number, y: number, z: number, yaw: number, pose: CatPose, kind: string, shelter: boolean, salt: number, kitten = false): void => {
    const coat = pickW(COATS, hash(x, z, salt));
    const ref = `cat${catN++}`;
    place('soul_cat_placeholder', `${coat}_${pose}`, x, y, z, yaw, ref, kitten ? 0.62 : 0.9 + hash(z, x, salt) * 0.15);
    claim(x, z, 0.25);
    rec.cats.push({ ref: `${t.id}/soul/${ref}`, placeholder: true, position: [r2(x), r2(y), r2(z)], heading: headingOf(yaw), pose, coat, kitten, spot: kind, shelter });
  };

  /* Bowls --------------------------------------------------------------------------------------------------------- */
  let bowlN = 0;
  const WATER: BowlKind[] = ['bottle_water', 'tub_water', 'steel_water'];
  const FOOD: BowlKind[] = ['bottle_kibble', 'tub_kibble', 'plate_kibble', 'box_kibble', 'cardboard_kibble', 'steel_kibble', 'tub_empty', 'plate_empty'];
  const bowlPair = (x: number, z: number, tx: number, tz: number, spot: string, salt: number): [number, number] => {
    const w = WATER[Math.floor(hash(x, z, salt) * WATER.length)];
    const f = FOOD[Math.floor(hash(z, x, salt + 1) * FOOD.length)];
    const gap = f === 'cardboard_kibble' ? 0.32 : 0.24;
    const ref = `bowls${bowlN++}`;
    const ax = x - tx * gap / 2;
    const az = z - tz * gap / 2;
    const bx = x + tx * gap / 2;
    const bz = z + tz * gap / 2;
    place('soul_bowl', w, ax, gy(ax, az), az, hash(x, 3, salt) * 6.28, `${ref}/water`);
    place('soul_bowl', f, bx, gy(bx, bz), bz, hash(z, 4, salt) * 6.28, `${ref}/food`);
    claim(x, z, 0.3);
    rec.bowlSets.push({ ref: `${t.id}/soul/${ref}`, position: [r2(x), r2(gy(x, z)), r2(z)], kinds: [w, f], fill: { water: 'full', food: f.endsWith('empty') ? 'empty' : 'full' }, spot });
    return [bx, bz];
  };

  /* 1. Yasa Cd: bowl pairs at thresholds and the precinct wall base, a cat at some of them ------------------------- */
  const tileSlots = plan.slots.filter((q) => inTile(t, q.x, q.z));
  const bowlSpots: { x: number; z: number; nx: number; nz: number }[] = [];
  for (const tg of plan.bowlTargets) {
    const cands = tileSlots.filter((q) => q.side === tg.side && Math.abs(q.ch - tg.ch) < 5).sort((p, q) => Math.abs(p.ch - tg.ch) - Math.abs(q.ch - tg.ch));
    for (const q of cands) {
      const x = q.x + q.nx * 0.2;
      const z = q.z + q.nz * 0.2;
      if (!free(x, z, 0.3, 0.05)) {
        continue;
      }
      const [fx, fz] = bowlPair(x, z, q.tx, q.tz, q.wall ? 'precinct_wall_base' : 'threshold', tg.k);
      bowlSpots.push({ x, z, nx: q.nx, nz: q.nz });
      // A cat at every other bowl pair, sitting at the food and facing it; kittens at the precinct wall.
      if (q.wall && plan.left.kittens > 0) {
        plan.left.kittens--;
        for (let k = 0; k < 3; k++) {
          const kx = fx + q.nx * (0.48 + k * 0.1) + q.tx * (k - 1) * 0.3;
          const kz = fz + q.nz * (0.48 + k * 0.1) + q.tz * (k - 1) * 0.3;
          if (free(kx, kz, 0.15, 0.05)) {
            cat(kx, gy(kx, kz), kz, yawTo(fx - kx, fz - kz), k === 1 ? 'loaf' : 'sit', 'bowl', false, tg.k * 7 + k, true);
          }
        }
      } else if (tg.k % 3 !== 2 && plan.left.bowlCats > 0) {
        const cx = fx + q.nx * 0.44 + q.tx * 0.2;
        const cz = fz + q.nz * 0.44 + q.tz * 0.2;
        if (free(cx, cz, 0.2, 0.05)) {
          plan.left.bowlCats--;
          cat(cx, gy(cx, cz), cz, yawTo(fx - cx, fz - cz), 'sit', 'bowl', false, tg.k);
        }
      }
      break;
    }
  }

  /* Cats on café chairs and at shop doors (Yasa Cd) ---------------------------------------------------------------- */
  for (const c of anchors) {
    if (c.asset !== 'plastic_monobloc_chair_01' || plan.left.chairCats <= 0) {
      continue;
    }
    const { ch, d } = plan.chainage(c.position[0], c.position[2]);
    if (ch < 125 || d > 10 || hash(c.position[0], c.position[2], 11) > 0.75) {
      continue;
    }
    if (people.some((p) => Math.hypot(p.position[0] - c.position[0], p.position[2] - c.position[2]) < 0.6)) {
      continue;
    }
    const yaw = yawOf(c);
    const off = rotateYaw([0, 0.445, 0.03], yaw);
    cat(c.position[0] + off[0], c.position[1] + off[1], c.position[2] + off[2], yaw + (hash(c.position[0], 1, 2) - 0.5) * 1.2, hash(c.position[2], 2, 3) < 0.5 ? 'curl' : 'loaf', 'cafe_chair', false, 21);
    plan.left.chairCats--;
  }
  for (const door of t.manifest.doors) {
    const [x0, , z0] = door.position;
    const { ch, d } = plan.chainage(x0, z0);
    if (ch < 125 || d > 8 || hash(x0, z0, 13) > 0.55 || plan.left.doorCats <= 0) {
      continue;
    }
    const x = x0 + door.normal[0] * 0.3 + door.normal[2] * 0.45;
    const z = z0 + door.normal[2] * 0.3 - door.normal[0] * 0.45;
    if (free(x, z, 0.2, 0.05)) {
      cat(x, gy(x, z), z, yawTo(door.normal[0], door.normal[2]) + (hash(x, z, 1) - 0.5), 'sit', 'threshold', false, 31);
      plan.left.doorCats--;
    }
  }

  /* Precinct wall top: a cat stretched along the coping (and one where gate B's hood meets the wall) ---------------- */
  if (plan.precinct) {
    const { ring, out } = plan.precinct;
    const n = ring.length / 2;
    let wallCats = 0;
    for (let i = 0; i < n && plan.left.wallCats > 0; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[j * 2];
      const bz = ring[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 5) {
        continue;
      }
      const f = 0.3 + 0.4 * hash(ax, az, 17);
      const x = ax + (bx - ax) * f;
      const z = az + (bz - az) * f;
      if (!inTile(t, x, z) || sc.spineDist(x, z) > 9) {
        continue;
      }
      const nx = ((bz - az) / len) * out;
      const nz = (-(bx - ax) / len) * out;
      const top = Math.max(gy(ax + nx * WALL_HALF, az + nz * WALL_HALF), gy(bx + nx * WALL_HALF, bz + nz * WALL_HALF), gy(ax - nx * WALL_HALF, az - nz * WALL_HALF), gy(bx - nx * WALL_HALF, bz - nz * WALL_HALF)) + WALL_TOP;
      cat(x, top, z, yawTo(bx - ax, bz - az) + (wallCats ? Math.PI : 0), wallCats ? 'curl' : 'loaf', 'wall_top', false, 41 + i);
      wallCats++;
      plan.left.wallCats--;
      // A painted cat house at the wall base below, facing the lane.
      if (wallCats === 1) {
        const hx = x + nx * (WALL_HALF + 0.3) + (bx - ax) / len * 1.4;
        const hz = z + nz * (WALL_HALF + 0.3) + (bz - az) / len * 1.4;
        if (free(hx, hz, 0.35, 0.05)) {
          place('soul_cathouse', 'wood', hx, gy(hx, hz), hz, yawTo(nx, nz), `cathouse${rec.catHouses.length}`);
          claim(hx, hz, 0.35);
          rec.catHouses.push({ ref: `${t.id}/soul/cathouse${rec.catHouses.length}`, kind: 'wood', position: [r2(hx), r2(gy(hx, hz)), r2(hz)], catSlot: true });
        }
      }
    }
  }

  /* Bowls at plaza planters and street-tree pits along Yasa Cd; a painted cat house at a café front ------------------ */
  for (const i of anchors) {
    if ((i.asset !== 'st_planter' && i.asset !== 'st_tree') || plan.left.pitBowls <= 0) {
      continue;
    }
    const [x0, , z0] = i.position;
    const { ch, d } = plan.chainage(x0, z0);
    if (ch < 120 || d > 12) {
      continue;
    }
    const reach = i.asset === 'st_planter' ? 0.9 : 0.75;
    for (let q = 0; q < 8; q++) {
      const ang = hash(x0, z0, 71) * 6.28 + (q / 8) * Math.PI * 2;
      const x = x0 + Math.cos(ang) * reach;
      const z = z0 + Math.sin(ang) * reach;
      if (free(x, z, 0.28, 0.1, i.position)) {
        bowlPair(x, z, -Math.sin(ang), Math.cos(ang), i.asset === 'st_planter' ? 'planter' : 'tree_pit', 73 + q);
        plan.left.pitBowls--;
        break;
      }
    }
  }
  if (plan.left.paintedHouses > 0) {
    const cafe = anchors.find((i) => i.asset === 'outdoor_table_chair_set_01' && plan.chainage(i.position[0], i.position[2]).ch > 125 && plan.chainage(i.position[0], i.position[2]).d < 8);
    if (cafe) {
      const slot = tileSlots.filter((q) => !q.wall).sort((p, q) => Math.hypot(p.x - cafe.position[0], p.z - cafe.position[2]) - Math.hypot(q.x - cafe.position[0], q.z - cafe.position[2])).find((q) => free(q.x + q.nx * 0.3, q.z + q.nz * 0.3, 0.35, 0.05));
      if (slot) {
        const hx = slot.x + slot.nx * 0.3;
        const hz = slot.z + slot.nz * 0.3;
        place('soul_cathouse', 'painted', hx, gy(hx, hz), hz, yawTo(slot.nx, slot.nz), `cathouse${rec.catHouses.length}`);
        claim(hx, hz, 0.35);
        rec.catHouses.push({ ref: `${t.id}/soul/cathouse${rec.catHouses.length}`, kind: 'painted', position: [r2(hx), r2(gy(hx, hz)), r2(hz)], catSlot: true, note: 'partner café house, painted by children' });
        plan.left.paintedHouses--;
      }
    }
  }

  /* 4. Yasa Cd spill-over at shop doors ---------------------------------------------------------------------------- */
  const poiNear = (x: number, z: number, r: number): string[] => t.manifest.pois.filter((p) => Math.hypot(p.position[0] - x, p.position[2] - z) < r).map((p) => p.kind);
  let trays = 0;
  let spillN = 0;
  for (const tg of plan.spillTargets) {
    const cands = tileSlots.filter((q) => q.side === tg.side && !q.wall && Math.abs(q.ch - tg.ch) < 2.5).sort((p, q) => Math.abs(p.ch - tg.ch) - Math.abs(q.ch - tg.ch));
    for (const q of cands) {
      const kinds = poiNear(q.x, q.z, 7);
      const u = hash(q.x, q.z, 51);
      let kind: SpillKind;
      if (kinds.includes('shop=clothes')) {
        kind = 'clothes_rack';
      } else if (tg.ch > 228) {
        kind = pickW<SpillKind>([['crates', 4], ['sacks', 3], ['carboys', 1], ['stools', 1]], u);
      } else if (kinds.some((k) => /cafe|restaurant|fast_food|confectionery/.test(k))) {
        kind = pickW<SpillKind>([['stools_tray', trays < 3 ? 3 : 0], ['stools', 3], ['sacks', 1], ['carboys', 1]], u);
      } else {
        kind = pickW<SpillKind>([['carboys', 3], ['gas_cage', 1], ['stools', 3], ['crates', 1], ['sacks', 1]], u);
      }
      const depth = kind === 'clothes_rack' ? 0.45 : kind === 'gas_cage' ? 0.42 : 0.5;
      const r = kind === 'clothes_rack' ? 0.75 : kind === 'crates' ? 0.62 : 0.5;
      const x = q.x + q.nx * depth;
      const z = q.z + q.nz * depth;
      if (!free(x, z, r, 0.05) || people.some((p) => Math.hypot(p.position[0] - x, p.position[2] - z) < r + 0.25)) {
        continue;
      }
      // Against the façade, front to the lane (the rack runs along the frontage).
      const yaw = kind === 'clothes_rack' ? yawTo(q.nx, q.nz) : yawTo(q.nx, q.nz) + (hash(x, z, 5) - 0.5) * 0.3;
      place('soul_spill', kind, x, gy(x, z), z, yaw, `spill${spillN++}`);
      claim(x, z, r);
      // Cats sleep on the goods: curled in the top crate, loafing on a sack.
      if ((kind === 'crates' || kind === 'sacks') && plan.left.goodsCats > 0 && hash(x, z, 57) < 0.6) {
        plan.left.goodsCats--;
        const o = rotateYaw(kind === 'crates' ? [0.32, 0.5, 0.02] : [-0.24, 0.47, 0.0], yaw);
        cat(x + o[0], gy(x, z) + o[1], z + o[2], yaw + (hash(z, x, 58) - 0.5) * 2, kind === 'crates' ? 'curl' : 'loaf', 'shop_goods', false, 59);
      }
      if (kind === 'stools_tray') {
        trays++;
        rec.vendorSlots.push({ id: `${t.id}/soul/ocak${trays}`, kind: 'tea_ocak', position: [r2(x), r2(gy(x, z)), r2(z)], note: 'tea runner stop: the tray on the stool is refilled from a çay ocağı (S5)' });
      }
      break;
    }
  }

  /* Square: benches (cats, bowl pairs, husks, butts), P0 bus stop ------------------------------------------------ */
  const benches = anchors.filter((i) => i.asset === 'st_bench' && (sc.inSquare(i.position[0], i.position[2]) || Math.hypot(i.position[0] - P0.x, i.position[2] - P0.z) < 16));
  const stop = anchors.find((i) => i.asset === 'st_stop_pole' && Math.hypot(i.position[0] - P0.x, i.position[2] - P0.z) < 18);
  // The İskele stop at P0: the bench nearest its pole (or nearest P0 while the street kit has no pole there).
  const stopAt = stop ? { x: stop.position[0], z: stop.position[2] } : P0;
  const stopBench = benches
    .filter((b) => Math.hypot(b.position[0] - stopAt.x, b.position[2] - stopAt.z) < 16)
    .sort((p, q) => Math.hypot(p.position[0] - stopAt.x, p.position[2] - stopAt.z) - Math.hypot(q.position[0] - stopAt.x, q.position[2] - stopAt.z))[0];
  for (const b of benches) {
    const yaw = yawOf(b);
    const [bx, by, bz] = b.position;
    const isStop = b === stopBench;
    const u = hash(bx, bz, 61);
    const seated = people.filter((p) => Math.hypot(p.position[0] - bx, p.position[2] - bz) < 1.1);
    const front = rotateYaw([0, 0, 1], yaw);
    if (isStop || u < 0.45) {
      husks(t.mesh, gy, (x, z) => paved(x, z, 0.05), bx, bz, front[0], front[2], 40 + Math.floor(hash(bz, bx, 3) * 50), Math.floor(bx * 13 + bz), stats);
      butts(t.mesh, gy, (x, z) => paved(x, z, 0.05), bx + front[0] * 0.6, bz + front[2] * 0.6, 1.2, 14, Math.floor(bx * 7 + bz * 3), stats);
    }
    // The bus-stop cat: curled on the far end of the seat, a bowl pair and a cardboard house beside the bench.
    if (isStop || (plan.left.benchCats > 0 && u > 0.55 && seated.length === 0)) {
      // The end of the seat that nobody sits on.
      const ends = [0.72, -0.72].map((e) => rotateYaw([e, 0.465, -0.02], yaw));
      const end = ends.find((o) => !seated.some((p) => Math.hypot(p.position[0] - bx - o[0], p.position[2] - bz - o[2]) < 0.8)) ?? ends[0];
      const cx = bx + end[0];
      const cz = bz + end[2];
      if (isStop && seated.some((p) => Math.hypot(p.position[0] - cx, p.position[2] - cz) < 0.8)) {
        // Every seat taken: the bus-stop cat waits under the bench.
        const under = rotateYaw([0.35, 0, 0.02], yaw);
        cat(bx + under[0], gy(bx + under[0], bz + under[2]), bz + under[2], yaw + Math.PI / 2, 'loaf', 'bus_stop_bench', true, 72);
      } else if (!seated.some((p) => Math.hypot(p.position[0] - cx, p.position[2] - cz) < 0.8)) {
        cat(cx, by + end[1], cz, yaw + Math.PI / 2 + (u - 0.5), isStop ? 'curl' : pickW<CatPose>([['loaf', 2], ['curl', 2], ['sit', 1]], u), isStop ? 'bus_stop_bench' : 'bench', false, 71);
        if (!isStop) {
          plan.left.benchCats--;
        }
      }
    }
    if (isStop) {
      const hs = rotateYaw([-1.45, 0, -0.05], yaw);
      const spot = nearFree(bx + hs[0], bz + hs[2], 0.35, 0.05, 1.2);
      if (spot) {
        const [hx, hz] = spot;
        place('soul_cathouse', 'cardboard', hx, gy(hx, hz), hz, yaw, `cathouse${rec.catHouses.length}`);
        claim(hx, hz, 0.35);
        rec.catHouses.push({ ref: `${t.id}/soul/cathouse${rec.catHouses.length}`, kind: 'cardboard', position: [r2(hx), r2(gy(hx, hz)), r2(hz)], catSlot: true, season: 'Nov-Mar swaps in EPS / cardboard' });
      }
    }
    if (isStop || (plan.left.squareBowls > 0 && u > 0.3 && u < 0.75)) {
      const legs = ([[0.9, 0, 0.12], [-0.9, 0, 0.12], [1.15, 0, -0.2], [-1.15, 0, -0.2], [0.35, 0, -0.6]] as XYZ[]).map((o) => rotateYaw(o, yaw));
      const leg = legs.find((o) => free(bx + o[0], bz + o[2], 0.25, 0.05, b.position)) ?? legs[0];
      const x = bx + leg[0];
      const z = bz + leg[2];
      if (free(x, z, 0.25, 0.05, b.position)) {
        const side = rotateYaw([0, 0, 1], yaw);
        bowlPair(x, z, side[0], side[2], isStop ? 'bus_stop' : 'bench_leg', 80 + bx);
        if (!isStop) {
          plan.left.squareBowls--;
        }
      }
    }
  }
  if (stopBench) {
    const [x, , z] = stopBench.position;
    t.mesh.withLod(LOD0, () => {
      butts(t.mesh, gy, (px, pz) => paved(px, pz, 0.05), x, z, 2.8, 130, 101, stats);
      gum(t.mesh, gy, (px, pz) => paved(px, pz, 0.05), x, z, 4, 30, 103, stats);
    });
  }

  /* Pier 1926: gulls on the ridge, butts at the land-side exits ----------------------------------------------------- */
  // The pier's frame as the hero lane builds it (hero/pier1926.ts): origin = mean of the outline's vertices, heading =
  // its longest edge; the building record's topY is the ridge height once the hero step has run in this tile.
  const pierSolid = a.solids.find((q) => q.rec.id === 'w102190096');
  const pier = pierSolid && a.tileOfSolid.get(pierSolid) === t.id ? (() => {
    const ring = pierSolid.ring;
    const n = ring.length / 2;
    let ox = 0;
    let oz = 0;
    for (let k = 0; k < n; k++) {
      ox += ring[k * 2];
      oz += ring[k * 2 + 1];
    }
    return { origin: [ox / n, oz / n] as [number, number], headingDeg: longestEdgeHeading(ring), ridgeY: pierSolid.rec.topY };
  })() : null;
  const windYaw = headingYaw(WIND_FROM, '+Z');
  if (pier) {
    const h = (pier.headingDeg * Math.PI) / 180;
    const P = (u: number, v: number): [number, number] => [pier.origin[0] + u * Math.sin(h) + v * Math.cos(h), pier.origin[1] - u * Math.cos(h) + v * Math.sin(h)];
    // The hipped roof's ridge runs along u from -6.2 to 6.2 at v = -2.3 (pier1926.ts MAIN plan); chimneys at u = +-6.3.
    const rnd = rng(1926);
    let u = -5.4;
    let g = 0;
    while (u < 5.4) {
      const [x, z] = P(u, -2.275);
      const sit = rnd() < 0.4;
      const juvenile = rnd() < 0.2;
      place('soul_gull_placeholder', juvenile ? 'juvenile_standing' : sit ? 'adult_sitting' : 'adult_standing', x, pier.ridgeY + 0.03, z, windYaw + (rnd() - 0.5) * 0.5, `gull_ridge${g}`);
      rec.gullPerches.push({ ref: `${t.id}/soul/gull_ridge${g}`, placeholder: true, kind: 'ridge', position: [r2(x), r2(pier.ridgeY), r2(z)] });
      g++;
      u += 0.55 + rnd() * 1.4;
    }
    for (const eu of [-4.5, 0.5, 5]) {
      const [x, z] = P(eu, 8.8);
      butts(t.mesh, gy, (px, pz) => paved(px, pz, 0.3), x, z, 2.2, 55, Math.floor(eu * 10 + 500), stats);
      gum(t.mesh, gy, (px, pz) => paved(px, pz, 0.3), x, z, 3.5, 12, Math.floor(eu * 10 + 600), stats);
    }
  }

  /* Quay posts: gulls on 3-5, anglers' kit beside 2-3 (night views) ------------------------------------------------- */
  const squareDist = (x: number, z: number): number => (sc.inSquare(x, z) ? 0 : sc.square.length ? ringDist(sc.square, x, z) : Infinity);
  const posts = anchors.filter((i) => i.asset === 'st_bollard' && i.variant === 'post' && squareDist(i.position[0], i.position[2]) < 12);
  let gullPosts = 0;
  let kits = 0;
  const kitPts: [number, number][] = [];
  for (const p of posts.sort((q, r) => hash(q.position[0], q.position[2], 91) - hash(r.position[0], r.position[2], 91))) {
    const [x, y, z] = p.position;
    if (plan.left.gullPosts > 0 && hash(x, z, 93) < 0.5) {
      plan.left.gullPosts--;
      place('soul_gull_placeholder', hash(z, x, 1) < 0.25 ? 'juvenile_standing' : 'adult_standing', x, y + 0.915, z, windYaw + (hash(x, z, 2) - 0.5) * 0.6, `gull_post${gullPosts}`);
      rec.gullPerches.push({ ref: `${t.id}/soul/gull_post${gullPosts}`, placeholder: true, kind: 'bollard', position: [r2(x), r2(y + 0.915), r2(z)] });
      gullPosts++;
      continue;
    }
    if (plan.left.kits > 0 && kitPts.every(([kx, kz]) => Math.hypot(kx - x, kz - z) > 9)) {
      // Towards the water: down the land field's gradient.
      const e = 0.5;
      const gx = a.land(x + e, z) - a.land(x - e, z);
      const gz = a.land(x, z + e) - a.land(x, z - e);
      const gl = Math.hypot(gx, gz);
      if (gl < 1e-6) {
        continue;
      }
      const wx = -gx / gl;
      const wz = -gz / gl;
      const kx = x - wx * 0.55 + wz * 0.6;
      const kz = z - wz * 0.55 - wx * 0.6;
      if (!free(kx, kz, 0.6, 0.3)) {
        continue;
      }
      place('soul_angler_kit', `set${kits}`, kx, gy(kx, kz), kz, yawTo(wx, wz), `angler${kits}`);
      claim(kx, kz, 0.6);
      rec.vendorSlots.push({ id: `${t.id}/soul/angler${kits}`, kind: 'angler', position: [r2(kx), r2(gy(kx, kz)), r2(kz)], heading: headingOf(yawTo(wx, wz)), hours: ['05:00-09:00', '17:00-21:00'], note: 'static kit; the angler (MetaHuman) and a waiting cat arrive in S5' });
      kitPts.push([x, z]);
      kits++;
      plan.left.kits--;
    }
  }

  /* Simit cart at the c02 spot, pigeons round it, a corn cart by the Rıhtım, dogs asleep on the square --------------- */
  const c02h = (C02.heading * Math.PI) / 180;
  const fwd: [number, number] = [Math.sin(c02h), -Math.cos(c02h)];
  const leftDir: [number, number] = [Math.sin(c02h - Math.PI / 2), -Math.cos(c02h - Math.PI / 2)];
  const cartTarget: [number, number] = [C02.x + fwd[0] * 24 + leftDir[0] * 7, C02.z + fwd[1] * 24 + leftDir[1] * 7];
  const bestSpot = (tx: number, tz: number, r: number, reach: number): [number, number] | null => {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let dx = -reach; dx <= reach; dx += 0.5) {
      for (let dz = -reach; dz <= reach; dz += 0.5) {
        const x = tx + dx;
        const z = tz + dz;
        const d = Math.hypot(dx, dz);
        if (d < bd && inTile(t, x, z) && free(x, z, r, 1.0)) {
          bd = d;
          best = [x, z];
        }
      }
    }
    return best;
  };
  if (inTile(t, cartTarget[0], cartTarget[1])) {
    const spot = bestSpot(cartTarget[0], cartTarget[1], 1.2, 5);
    if (spot) {
      const [x, z] = spot;
      const yaw = yawTo(C02.x - x, C02.z - z) + 0.5;
      place('soul_cart', 'simit', x, gy(x, z), z, yaw, 'simit_cart');
      claim(x, z, 1.3);
      rec.vendorSlots.push({ id: `${t.id}/soul/simit_cart`, kind: 'simit', position: [r2(x), r2(gy(x, z)), r2(z)], heading: headingOf(yaw), hours: '06:00-18:00', convertsTo: { kind: 'corn', from: '17:00', season: 'Aug-Oct' }, note: 'generic cylindrical glass cart (no municipal logo); vendor loop S5' });
      // A pigeon flock working the crumbs in front of the cart, 2-4 m out into the square.
      const fc: [number, number] = [x + Math.sin(yaw) * 3.2, z + Math.cos(yaw) * 3.2];
      const rnd = rng(x * 3 + z);
      let pn = 0;
      for (let k = 0; k < 60 && pn < 26; k++) {
        const ang = rnd() * Math.PI * 2;
        const d = 2.6 * Math.sqrt(rnd());
        const px = fc[0] + Math.cos(ang) * d;
        const pz = fc[1] + Math.sin(ang) * d;
        if (!free(px, pz, 0.12, 0.5)) {
          continue;
        }
        const morph = pickW([['grey', 7], ['dark', 2], ['brown', 1]] as const, rnd());
        const pose = pickW([['pecking', 5], ['standing', 3], ['walking', 2]] as const, rnd());
        place('soul_pigeon', `${morph}_${pose}`, px, gy(px, pz), pz, rnd() * 6.28, `pigeon${pn}`);
        claim(px, pz, 0.12);
        pn++;
      }
      const model = pigeonModelAvailable();
      rec.pigeonAreas.push({
        id: `${t.id}/soul/pigeons_cart`,
        placeholder: !model,
        centre: [r2(fc[0]), r2(gy(fc[0], fc[1])), r2(fc[1])],
        radius: 2.6,
        count: pn,
        trigger: 'walk parts the flock, running bursts it (S3)',
        ...(model ? { model: { asset: PIGEON_MODEL.id, source: PIGEON_MODEL.source, clips: pigeonClips(), staticPoses: PIGEON_POSES, credit: PIGEON_MODEL.attribution } } : {}),
      });
      gum(t.mesh, gy, (px, pz) => paved(px, pz, 0.3), fc[0], fc[1], 9, 70, 111, stats);
    }
  }
  if (inTile(t, P1.x, P1.z)) {
    const spot = bestSpot(P1.x - 4, P1.z - 3.5, 1.2, 4);
    if (spot) {
      const [x, z] = spot;
      const yaw = yawTo(P0.x - x, P0.z - z);
      place('soul_cart', 'corn', x, gy(x, z), z, yaw, 'corn_cart');
      claim(x, z, 1.3);
      rec.vendorSlots.push({ id: `${t.id}/soul/corn_cart`, kind: 'corn', position: [r2(x), r2(gy(x, z)), r2(z)], heading: headingOf(yaw), hours: '16:00-23:00', season: 'Aug-Oct; chestnut from mid-October' });
    }
  }
  // Dogs: the two most open sunny spots of the square, well apart, preferring the c02 view.
  if (sc.square.length && inTile(t, cartTarget[0], cartTarget[1])) {
    const cands: [number, number, number][] = [];
    for (let x = t.bounds.minX + 1; x < t.bounds.maxX; x += 2.5) {
      for (let z = t.bounds.minZ + 1; z < t.bounds.maxZ; z += 2.5) {
        if (!sc.inSquare(x, z) || !free(x, z, 1.2, 2)) {
          continue;
        }
        const dp = Math.min(...people.map((p) => Math.hypot(p.position[0] - x, p.position[2] - z)), 99);
        if (dp < 2.4) {
          continue;
        }
        const vx = x - C02.x;
        const vz = z - C02.z;
        const vd = Math.hypot(vx, vz);
        const inView = vd > 9 && vd < 30 && (vx * fwd[0] + vz * fwd[1]) / vd > Math.cos((25 * Math.PI) / 180);
        cands.push([x, z, Math.min(dp, 6) + (inView ? 5 : 0) + hash(x, z, 131)]);
      }
    }
    cands.sort((p, q) => q[2] - p[2]);
    const dogs: [number, number][] = [];
    for (const [x, z] of cands) {
      if (dogs.length >= 2 || dogs.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < 15)) {
        continue;
      }
      const pose = dogs.length ? 'sphinx' : 'side';
      const coat = dogs.length ? 'blond' : 'tan';
      const yaw = hash(z, x, 9) * 6.28;
      place('soul_dog_placeholder', `${coat}_${pose}`, x, gy(x, z), z, yaw, `dog${dogs.length}`);
      claim(x, z, 0.9);
      rec.dogSpots.push({ ref: `${t.id}/soul/dog${dogs.length}`, placeholder: true, position: [r2(x), r2(gy(x, z)), r2(z)], heading: headingOf(yaw), pose, coat, earTag: 'yellow', sun: true, note: 'crowd flows round it (navmesh obstacle)' });
      dogs.push([x, z]);
    }
  }

  /* Fish end: cats under half the fish stalls, run-off films draining downhill, scraps, a hose, the EPS cat house -- */
  // Nearest to the junction first: the cats crowd the stalls within about 20 m of P11.
  const stalls = anchors.filter((i) => i.asset.startsWith('fac_stall') && Math.hypot(i.position[0] - P11.x, i.position[2] - P11.z) < 30).sort((p, q) => Math.hypot(p.position[0] - P11.x, p.position[2] - P11.z) - Math.hypot(q.position[0] - P11.x, q.position[2] - P11.z));
  let fishCats = 0;
  let hoses = 0;
  stalls.forEach((st, k) => {
    const yaw = yawOf(st);
    const [sx, , sz] = st.position;
    const fish = st.asset === 'fac_stall_fish';
    const L = (lx: number, lz: number): [number, number] => {
      const o = rotateYaw([lx, 0, lz], yaw);
      return [sx + o[0], sz + o[2]];
    };
    if (fish) {
      for (const side of [-1, 1]) {
        if (hash(sx, sz, 141 + side) < 0.55) {
          const [x, z] = L(side * (0.7 + hash(sz, sx, side) * 0.4), 1.75);
          runoff(t.mesh, gy, (px, pz) => paved(px, pz, 0.1) && inTile(t, px, pz), x, z, 2 + hash(x, z, 3) * 3, 0.22 + hash(z, x, 4) * 0.25, Math.floor(x * 11 + z), stats);
        }
      }
      if (hash(sx, sz, 151) < 0.6) {
        const [x, z] = L(0.2, 2.0);
        scraps(t.mesh, gy, (px, pz) => paved(px, pz, 0.1), x, z, 0.9, 10 + Math.floor(hash(x, z, 5) * 16), Math.floor(x * 5 + z * 3), stats);
      }
      if (hoses < 1) {
        const spot = ([[-1.5, 0.5], [1.95, 0.5], [-1.5, 1.2], [1.95, 1.2]] as [number, number][]).map(([lx, lz]) => L(lx, lz)).find(([x, z]) => free(x, z, 0.3, 0.05));
        if (spot) {
          place('soul_hose', 'coil', spot[0], gy(spot[0], spot[1]), spot[1], yaw, `hose${hoses++}`);
          claim(spot[0], spot[1], 0.3);
        }
      }
    }
    if (fishCats < 7 && (fish ? hash(sx, sz, 163) < 0.75 : k % 4 === 1)) {
      // Low at the table's edge, under the tilted top, watching the fishmonger's hands.
      const under = hash(sx, sz, 161) < 0.5;
      const [x, z] = under ? L((hash(sz, sx, 3) - 0.5) * 1.2, 0.75) : L((hash(sz, sx, 3) < 0.5 ? -1 : 1) * 1.35, 1.55);
      if (paved(x, z, 0.05) && !people.some((p) => Math.hypot(p.position[0] - x, p.position[2] - z) < 0.45) && (under || clear(x, z, 0.2))) {
        cat(x, gy(x, z), z, yaw + Math.PI + (hash(x, z, 9) - 0.5) * 1.4, under ? pickW<CatPose>([['loaf', 2], ['sit', 1]], hash(z, x, 1)) : 'sit', 'under_stall', under, 171 + k);
        fishCats++;
      }
    }
  });

  /* Container group at the P11 lane mouth (Güneşlibahçe Sk, else Yağlıkçı İsmail Sk), posters on it, EPS cat house - */
  if (inTile(t, P11.x, P11.z)) {
    // The lane ways that start or end at the P11 junction (OSM splits a street into several ways with one name).
    const endsAt = (pts: readonly number[]): boolean => Math.hypot(pts[0] - P11.x, pts[1] - P11.z) < 3 || Math.hypot(pts[pts.length - 2] - P11.x, pts[pts.length - 1] - P11.z) < 3;
    const pref = ['Güneşlibahçe Sokağı', 'Yağlıkçı İsmail Sokağı', 'Yasa Caddesi'];
    const lanes = a.data.roads.filter((r) => r.name && pref.includes(r.name) && endsAt(r.pts)).sort((p, q) => pref.indexOf(p.name!) - pref.indexOf(q.name!));
    let placed = false;
    for (const road of lanes) {
      if (placed) {
        break;
      }
      // Walk the lane away from P11 and look for a free façade foot 5-14 m in.
      const pts = road.pts;
      const startsAtP11 = Math.hypot(pts[0] - P11.x, pts[1] - P11.z) < Math.hypot(pts[pts.length - 2] - P11.x, pts[pts.length - 1] - P11.z);
      const seqPts: [number, number][] = [];
      for (let k = 0; k < pts.length; k += 2) {
        seqPts.push([pts[k], pts[k + 1]]);
      }
      if (!startsAtP11) {
        seqPts.reverse();
      }
      const [ax, az] = seqPts[0];
      const [bx, bz] = seqPts[1];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      const tx = (bx - ax) / l;
      const tz = (bz - az) / l;
      for (let d = 4; d < 22 && !placed; d += 0.5) {
        for (const side of [-1, 1]) {
          const cx = ax + tx * d;
          const cz = az + tz * d;
          const nx = -tz * side;
          const nz = tx * side;
          let wall = -1;
          for (let o = 0.5; o < 6; o += 0.1) {
            if (s.buildingDistance(cx + nx * o, cz + nz * o) < 0.12) {
              wall = o;
              break;
            }
          }
          if (wall < 1.8) {
            continue;
          }
          const gx = cx + nx * (wall - 0.62);
          const gz = cz + nz * (wall - 0.62);
          const ok = [-1.6, 0, 1.6].every((f) => free(gx + tx * f, gz + tz * f, 0.7, 0.05));
          if (!ok) {
            continue;
          }
          const yaw = yawTo(-nx, -nz);
          const kinds = ['galvanised', 'green', 'bags'];
          kinds.forEach((kind, k) => {
            const f = (k - 1) * 1.6;
            const x = gx + tx * f;
            const z = gz + tz * f;
            place('soul_container', kind, x, gy(x, z), z, yaw + (hash(x, z, k) - 0.5) * 0.15, `container${k}`);
            claim(x, z, 0.8);
          });
          // Posters and stickers on the galvanised container's lane-side flank (its front faces the lane).
          const x0 = gx - tx * 1.6;
          const z0 = gz - tz * 1.6;
          const face = faceAt(x0 - nx * 0.525, z0 - nz * 0.525, -nx, -nz, 1.2, gy(x0, z0), 1.2);
          t.mesh.withLod(LOD0, () => {
            posterGrid(t.mesh, face, 0.08, 1.12, 0.42, 1.1, 1771, stats);
            stickersOnFace(t.mesh, face, 12, 0.45, 1.1, 1773, stats);
            t.mesh.decal('soul_stain', [gx, gy(gx, gz) + 0.004, gz], [0, 1, 0], { size: [4.2, 1.6], rotation: Math.atan2(tz, tx), offset: 0.004, color: [0.6, 0.55, 0.5, 0.7] });
          });
          const spot = nearFree(gx + tx * 3.1 + nx * 0.1, gz + tz * 3.1 + nz * 0.1, 0.35, 0.05, 4);
          const [hx, hz] = spot ?? [0, 0];
          if (spot) {
            place('soul_cathouse', 'eps', hx, gy(hx, hz), hz, yaw, `cathouse${rec.catHouses.length}`);
            claim(hx, hz, 0.35);
            rec.catHouses.push({ ref: `${t.id}/soul/cathouse${rec.catHouses.length}`, kind: 'eps', position: [r2(hx), r2(gy(hx, hz)), r2(hz)], catSlot: true });
            cat(hx + Math.sin(yaw) * 0.35, gy(hx, hz), hz + Math.cos(yaw) * 0.35, yaw, 'loaf', 'cat_house', true, 181);
          }
          rec.ambience.push({ id: `${t.id}/soul/waste_corner`, kind: 'waste_corner', centre: [r2(gx), r2(gy(gx, gz)), r2(gz)], radius: 6, note: 'bags after 21:00, compactor 23:00-01:00, cats at the bins at night (S5)' });
          placed = true;
          break;
        }
      }
    }
  }

  /* Battery box on the twin-lantern column at P9, e-scooters near P8, the motorbike bay near P1 ------------------------ */
  const lantern = anchors.find((i) => i.asset === 'st_twin_lantern' && Math.hypot(i.position[0] - 338.4, i.position[2] - 5991.3) < 6);
  if (lantern) {
    const sp = plan.spineAt(plan.chainage(lantern.position[0], lantern.position[2]).ch);
    const yaw = yawTo(sp.x - lantern.position[0], sp.z - lantern.position[2]) || 0.01;
    place('soul_battery_box', 'pole', lantern.position[0], lantern.position[1], lantern.position[2], yaw, 'battery_box');
  }
  if (inTile(t, P8.x, P8.z)) {
    let n = 0;
    for (let d = 1.5; d < 9 && n < 4; d += 0.5) {
      for (let q = 0; q < 12 && n < 4; q++) {
        const ang = (q / 12) * Math.PI * 2;
        const x = P8.x + Math.cos(ang) * d;
        const z = P8.z + Math.sin(ang) * d;
        const bd = s.buildingDistance(x, z);
        if (bd < 0.5 || bd > 1.1 || !free(x, z, 0.45, 0.4)) {
          continue;
        }
        // Parallel to the wall: along the building distance field's contour.
        const e = 0.3;
        const gx = s.buildingDistance(x + e, z) - s.buildingDistance(x - e, z);
        const gz = s.buildingDistance(x, z + e) - s.buildingDistance(x, z - e);
        const tipped = n === 3;
        const colour = SCOOTER_LIVERIES[Math.floor(hash(x, z, n) * SCOOTER_LIVERIES.length)];
        const yaw = yawTo(-gz, gx) + (hash(z, x, 2) - 0.5) * 0.4;
        place('soul_escooter', `${colour}_${tipped ? 'tipped' : 'standing'}`, x, gy(x, z), z, yaw, `escooter${n}`);
        claim(x, z, 0.5);
        n++;
      }
    }
    rec.vendorSlots.push({ id: `${t.id}/soul/midye`, kind: 'midye', position: [r2(P8.x), r2(gy(P8.x, P8.z)), r2(P8.z)], hours: '20:00-03:00', note: 'midyeci tray at the Yasa Cd entrance (c11), night only' });
    rec.vendorSlots.push({ id: `${t.id}/soul/busker_yasa`, kind: 'busker', position: [r2(P8.x + 3), r2(gy(P8.x + 3, P8.z + 2)), r2(P8.z + 2)], hours: '17:00-23:00' });
  }
  if (inTile(t, P1.x, P1.z)) {
    const ns = sc.near(P1.x, P1.z, 25, (st) => st.kerbed && !st.pedestrian);
    if (ns) {
      // Unit normal from the road towards P1 (the quay-side pavement), tangent along the kerb.
      let nx = P1.x - ns.px;
      let nz = P1.z - ns.pz;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      const off = ns.street.hw + 1.25;
      const bikes: [number, number][] = [];
      for (let f = -8; f <= 8 && bikes.length < 8; f += 0.85) {
        const x = ns.px + nx * off + ns.tx * f;
        const z = ns.pz + nz * off + ns.tz * f;
        // The bike stands perpendicular to the kerb: keep its whole length (1.9 m) clear.
        if (![-0.7, 0, 0.7].every((o) => free(x + nx * o, z + nz * o, 0.33, 0.5) && s.distance(x + nx * o, z + nz * o) > 0.3)) {
          continue;
        }
        bikes.push([x, z]);
        claim(x, z, 0.38);
        claim(x + nx * 0.7, z + nz * 0.7, 0.3);
        claim(x - nx * 0.7, z - nz * 0.7, 0.3);
      }
      bikes.forEach(([x, z], k) => {
        const [id] = MOTO_LIVERIES[Math.floor(hash(x, z, k) * MOTO_LIVERIES.length)];
        // Front wheel to the kerb, slightly skewed.
        const yaw = yawTo(-nx, -nz) + (hash(z, x, k) - 0.5) * 0.25;
        place('soul_moto', id, x, gy(x, z), z, yaw, `moto${k}`);
        if (k === 2) {
          // The seat is warm: a cat loafs on it.
          const o = rotateYaw([0, 0.84, -0.28], yaw);
          cat(x + o[0], gy(x, z) + o[1], z + o[2], yaw + Math.PI, 'loaf', 'bike_seat', false, 191);
        }
      });
      if (bikes.length) {
        const [x, z] = bikes[Math.floor(bikes.length / 2)];
        rec.vendorSlots.push({ id: `${t.id}/soul/moto_bay`, kind: 'moto_bay', position: [r2(x), r2(gy(x, z)), r2(z)], bikes: bikes.length, note: 'painted courier bay; fictional liveries; courier agents S5' });
      }
    }
  }

  /* Signal controller boxes at the signalised Rıhtım crossings, when the street kit has none within 15 m ----------- */
  const signalBoxes: InstanceRec[] = [];
  const CROSSING_PTS: [number, number][] = [
    [284.5, 5940],
    [285.1, 5949.6],
    [296.8, 5953.4],
    [300.1, 5960.7],
    [293.8, 5975.5],
    [306.2, 5982.3],
  ];
  sc.crossings.forEach((c, ci) => {
    const mx = (c.ax + c.bx) / 2;
    const mz = (c.az + c.bz) / 2;
    if (!inTile(t, mx, mz) || !CROSSING_PTS.some(([px, pz]) => Math.hypot(px - mx, pz - mz) < 12) || anchors.some((i) => i.asset === 'st_cabinet' && Math.hypot(i.position[0] - mx, i.position[2] - mz) < 15)) {
      return;
    }
    const l = Math.hypot(c.ax - c.bx, c.az - c.bz) || 1;
    const ux = (c.ax - c.bx) / l;
    const uz = (c.az - c.bz) / l;
    for (const [off, along] of [
      [1.6, 2.4],
      [1.6, -2.4],
      [2.4, 3.2],
      [2.4, -3.2],
    ]) {
      const x = c.ax + ux * off + c.tx * along;
      const z = c.az + uz * off + c.tz * along;
      if (!free(x, z, 0.75, 0.3) || s.distance(x, z) < 0.4) {
        continue;
      }
      signalBoxes.push(place('st_cabinet', 'single', x, gy(x, z), z, yawTo(-ux, -uz), `signal_box${ci}`));
      claim(x, z, 0.75);
      break;
    }
  });

  /* 3. Stickers on poles, bins and cabinets; poster grids and notices on cabinets --------------------------------- */
  t.mesh.withLod(LOD0, () => {
    const crossingNear = (x: number, z: number): boolean => sc.crossings.some((c) => segDist(x, z, c.ax, c.az, c.bx, c.bz) < 9);
    for (const i of [...anchors, ...signalBoxes]) {
      const [x, y, z] = i.position;
      if (!near(x, z) || y > gy(x, z) + 0.5) {
        continue;
      }
      const seed = Math.floor(x * 131 + z * 17);
      const u = hash(x, z, 201);
      const cross = crossingNear(x, z);
      let pole: PoleSpec | null = null;
      let n = 0;
      if (i.asset === 'st_signal' || i.asset === 'st_stop_pole') {
        pole = { x, z, r: 0.055, y0: 0.9, y1: i.variant === 'combo' ? 1.85 : 2.15, peak: 1.5 };
        n = cross || i.asset === 'st_stop_pole' ? 14 + Math.floor(u * 26) : 8 + Math.floor(u * 14);
      } else if (i.asset.startsWith('lamp_mast')) {
        pole = { x, z, r: 0.09, y0: 0.9, y1: 2.2, peak: 1.55 };
        n = cross ? 12 + Math.floor(u * 22) : 3 + Math.floor(u * 10);
      } else if (i.asset === 'st_twin_lantern') {
        pole = { x, z, r: 0.071, y0: 0.9, y1: 2.2, peak: 1.5 };
        n = 5 + Math.floor(u * 10);
      } else if (i.asset === 'st_bollard' && i.variant !== 'post') {
        const thin = i.variant === 'thin';
        pole = { x, z, r: thin ? 0.04 : 0.06, y0: 0.25, y1: thin ? 0.6 : 0.72, peak: 0.5 };
        n = cross ? 3 + Math.floor(u * 5) : Math.floor(u * 4);
      } else if (i.asset === 'st_bin') {
        pole = { x, z, r: 0.214, y0: 0.26, y1: 0.66, peak: 0.5 };
        n = 5 + Math.floor(u * 15);
      } else if (i.asset === 'st_cabinet') {
        const yaw = yawOf(i);
        const wide = i.variant === 'double';
        const hw = wide ? 0.65 : 0.42;
        const fr = rotateYaw([1, 0, 0], yaw);
        const fn = rotateYaw([0, 0, 1], yaw);
        const g = gy(x, z);
        const facePlane = (side: 1 | -1): Face => ({ o: [x - fr[0] * hw * side + fn[0] * 0.18 * side, g + 0.12, z - fr[2] * hw * side + fn[2] * 0.18 * side], rx: fr[0] * side, rz: fr[2] * side, nx: fn[0] * side, nz: fn[2] * side, w: hw * 2, h: 1.2 });
        const front = facePlane(1);
        const back = facePlane(-1);
        posterGrid(t.mesh, back, 0.04, hw * 2 - 0.04, 0.1, 1.15, seed, stats);
        stickersOnFace(t.mesh, front, 8 + Math.floor(u * 12), 0.4, 1.15, seed + 1, stats);
        stickersOnFace(t.mesh, back, 5 + Math.floor(u * 8), 0.2, 1.15, seed + 2, stats);
        if (u < 0.5) {
          lostCatNotice(t.mesh, front, hw, 0.72, 0.009, Math.floor(u * 100), stats);
        }
        continue;
      }
      if (pole && n > 0) {
        stickersOnPole(t.mesh, pole, gy(x, z), n, seed, stats);
      }
    }
  });

  /* Ground residue along Yasa Cd: gum spots and butts at the café fronts ------------------------------------------ */
  t.mesh.withLod(LOD0, () => {
    for (let ch = 126; ch < 262; ch += 9) {
      const p = plan.spineAt(ch);
      if (!inTile(t, p.x, p.z)) {
        continue;
      }
      gum(t.mesh, gy, (x, z) => paved(x, z, 0.1), p.x, p.z, 2.6, 8, Math.floor(ch * 7), stats);
    }
    for (const c of anchors) {
      if (c.asset !== 'outdoor_table_chair_set_01' || plan.chainage(c.position[0], c.position[2]).d > 8 || hash(c.position[0], c.position[2], 211) > 0.5) {
        continue;
      }
      butts(t.mesh, gy, (x, z) => paved(x, z, 0.05), c.position[0], c.position[2], 1.3, 10, Math.floor(c.position[0] * 3 + c.position[2]), stats);
    }
  });

  /* Street-name signs on the junction corners ------------------------------------------------------------------- */
  t.mesh.withLod(LOD0, () => {
    for (const j of JUNCTIONS) {
      const roads = a.data.roads.filter((r) => r.name && roadDist(r.pts, j.x, j.z) < 3);
      const names = [...new Set(roads.map((r) => r.name!))];
      for (const name of names) {
        const road = roads.find((r) => r.name === name)!;
        const dir = roadDirAt(road.pts, j.x, j.z);
        const corner = bestCorner(a, j.x, j.z, dir);
        if (!corner) {
          continue;
        }
        const numbers = `${1 + Math.floor(hash(j.x, name.length, 1) * 4) * 2}-${31 + Math.floor(hash(j.z, name.length, 2) * 30) * 2}`;
        const w = signWidth(name, numbers);
        const cx = corner.x + corner.ex * (w / 2 + 0.25);
        const cz = corner.z + corner.ez * (w / 2 + 0.25);
        if (!inTile(t, cx, cz)) {
          continue;
        }
        const g = gy(cx + corner.nx * 0.4, cz + corner.nz * 0.4);
        streetSign(t.mesh, faceAt(cx, cz, corner.nx, corner.nz, w, g, 3), w / 2, 2.75, name, numbers, j.mahalle, stats);
      }
    }
  });

  /* Ambience zones (each in the tile of its centre) -------------------------------------------------------------- */
  const zone = (id: string, kind: string, x: number, z: number, radius: number, note: string, extra: Record<string, unknown> = {}): void => {
    if (inTile(t, x, z)) {
      rec.ambience.push({ id: `soul/${id}`, kind, centre: [r2(x), r2(gy(x, z)), r2(z)], radius, note, ...extra });
    }
  };
  if (sc.square.length) {
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < sc.square.length; k += 2) {
      cx += sc.square[k];
      cz += sc.square[k + 1];
    }
    cx /= sc.square.length / 2;
    cz /= sc.square.length / 2;
    zone('plaza_square', 'plaza', cx, cz, 50, 'pier square: gulls, ferry horns, simit cries, crowd walla', { polygon: sc.square.map(r2) });
    zone('quay', 'quay', (cx + P0.x) / 2 - 25, cz - 12, 45, 'quay edge: water slap, gull calls, ferry engines and ropes, anglers at night');
  }
  zone('crossing', 'crossing', 294.4, 5960.3, 26, 'Rıhtım Cd crossings P2-P7: traffic, signal ticks, T3 tram bell, bus air brakes');
  const lane = plan.spineAt(172);
  zone('lane_yasa', 'lane', lane.x, lane.z, 48, 'Yasa Cd market lane: footsteps, shop radios, chair scrapes, tea glasses', { path: [125, 215].map((c) => { const p = plan.spineAt(c); return [r2(p.x), r2(p.z)]; }), width: 8 });
  zone('plaza_p10', 'plaza', 405.1, 6032.1, 12, 'Yasa × Mühürdar junction plaza: church bell, café terrace');
  zone('fish_end', 'fish_end', P11.x, P11.z, 18, 'fish end: fishmongers calling prices, ice shovels, hose-downs at 20:00, meowing at the stalls');
  // İskele Camii: the hero step adds its OSM outline (w102190093) to the manifest of the tile it builds in.
  const mosque = t.manifest.buildings.find((b) => b.id === 'w102190093');
  if (mosque) {
    const f = mosque.footprint;
    let mx = 0;
    let mz = 0;
    for (let k = 0; k < f.length; k += 2) {
      mx += f[k];
      mz += f[k + 1];
    }
    zone('mosque_side_door', 'mosque_side_door', mx / (f.length / 2), mz / (f.length / 2), 14, 'İskele Camii: ezan five times a day, shoes at the side door, the crowd after Friday prayers');
  }

  /* Records --------------------------------------------------------------------------------------------------------- */
  const tris = t.mesh.triangles(LOD0) - trisBefore;
  const paper = Object.fromEntries(Object.entries(stats).filter(([, v]) => v > 0));
  const nonEmpty = Object.fromEntries(Object.entries(rec).filter(([, v]) => (v as unknown[]).length));
  if (Object.keys(counts).length || Object.keys(paper).length || Object.keys(nonEmpty).length) {
    const { vendorSlots, ambience, ...animals } = nonEmpty as Partial<Records>;
    t.record('soul', {
      placeholders: 'Animal instances (soul_*_placeholder) are static stand-ins for the animated models of S5.',
      ...(Object.keys(animals).length ? { animals } : {}),
      ...(vendorSlots ? { vendorSlots } : {}),
      ...(ambience ? { ambience } : {}),
      counts: { instances: counts, paper },
      lod0Triangles: tris,
    });
  }
  for (const [k, v] of Object.entries(counts)) {
    plan.totals[k] = (plan.totals[k] ?? 0) + v;
  }
  for (const [k, v] of Object.entries(paper)) {
    plan.totals[`paper:${k}`] = (plan.totals[`paper:${k}`] ?? 0) + v;
  }
  plan.totals.lod0Triangles = (plan.totals.lod0Triangles ?? 0) + tris;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Junction corners                                                                                                */
/* ------------------------------------------------------------------------------------------------------------- */

function roadDist(pts: readonly number[], x: number, z: number): number {
  let d = Infinity;
  for (let k = 2; k < pts.length; k += 2) {
    d = Math.min(d, segDist(x, z, pts[k - 2], pts[k - 1], pts[k], pts[k + 1]));
  }
  return d;
}

function roadDirAt(pts: readonly number[], x: number, z: number): [number, number] {
  let best: [number, number] = [1, 0];
  let bd = Infinity;
  for (let k = 2; k < pts.length; k += 2) {
    const d = segDist(x, z, pts[k - 2], pts[k - 1], pts[k], pts[k + 1]);
    if (d < bd) {
      bd = d;
      const l = Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]) || 1;
      best = [(pts[k] - pts[k - 2]) / l, (pts[k + 1] - pts[k - 1]) / l];
    }
  }
  return best;
}

interface Corner {
  /** The building corner, the wall's outward normal and the unit vector from the corner along the wall. */
  x: number;
  z: number;
  nx: number;
  nz: number;
  ex: number;
  ez: number;
}

/**
 * The building corner nearest to the junction (within 12 m) whose wall runs along the named street (within 25°) and
 * faces the junction: the sign goes on that wall next to the corner.
 */
function bestCorner(a: AreaContext, jx: number, jz: number, dir: [number, number]): Corner | null {
  let best: Corner | null = null;
  let bd = Infinity;
  for (const s of a.solids) {
    if (!s.grounded || Math.hypot(s.cx - jx, s.cz - jz) > 40) {
      continue;
    }
    const ring = s.ring;
    const n = ring.length / 2;
    let area = 0;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      area += ring[k * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[k * 2 + 1];
    }
    const out = area > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[j * 2];
      const bz = ring[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 2.2) {
        continue;
      }
      const tx = (bx - ax) / len;
      const tz = (bz - az) / len;
      if (Math.abs(tx * dir[0] + tz * dir[1]) < Math.cos((25 * Math.PI) / 180)) {
        continue;
      }
      const nx = tz * out;
      const nz = -tx * out;
      if ((jx - ax) * nx + (jz - az) * nz < 0.5) {
        continue;
      }
      for (const [cx, cz, ex, ez] of [
        [ax, az, tx, tz],
        [bx, bz, -tx, -tz],
      ] as const) {
        const d = Math.hypot(cx - jx, cz - jz);
        if (d < 12 && d < bd) {
          bd = d;
          best = { x: cx, z: cz, nx, nz, ex, ez };
        }
      }
    }
  }
  return best;
}

/** A face of width w centred on (cx, cz) with outward normal (nx, nz), bottom at y0: origin at its left edge seen from the front. */
function faceAt(cx: number, cz: number, nx: number, nz: number, w: number, y0: number, h: number): Face {
  const rx = nz;
  const rz = -nx;
  return { o: [cx - rx * (w / 2), y0, cz - rz * (w / 2)], rx, rz, nx, nz, w, h };
}

export const soulStep: CompileStep = {
  id: 'soul',
  tiles: 'full',
  prepare(a) {
    soulPlan(a);
  },
  tile(t) {
    // EVREN_NO_SOUL=1 skips the step (A/B renders of the same tree with and without the soul layer).
    if (process.env.EVREN_NO_SOUL === '1') {
      return;
    }
    // Everything the step emits as tile geometry (paper layer, residue) is LOD0 only.
    t.mesh.withLod(LOD0, () => tileStep(t));
  },
  finish(a) {
    const plan = a.shared.get('soul') as SoulPlan | undefined;
    if (plan) {
      console.error(`[soul] ${JSON.stringify(plan.totals)}`);
    }
  },
};
