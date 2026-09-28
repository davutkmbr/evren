/**
 * Rules of the building merge (scripts/data/footprints-merge.ts): pure functions over flat x, z rings in local metres,
 * unit-tested in rules.test.ts. Research and rationale: seventeenskies-unreal
 * .docs/assets/candidates/building-footprints.md (merge strategy). Every rule is generic: no coordinate, id or place
 * is special-cased; the merge summary counts what each rule did.
 *
 * Footprints: OSM always wins. A Microsoft ML footprint is dropped when it overlaps an OSM building or part, is too
 * small, stands on a street, rail, water, the sea, a city wall or open ground where ML detections are vehicles,
 * containers or stalls (parking, pitches, platforms, piers, ports, aprons...), or duplicates a larger ML footprint.
 * Small kept ones become one-storey outbuildings. Kept footprints get stable synthetic ids.
 * Merged rows: untagged residential outlines far larger than a row building are split into row lots until the mahalle
 * approaches İBB's building count; the outline stays, its lots are generated inside it.
 * Heights (first hit wins): OSM tags, Urban Atlas rooftop height, the median of tagged neighbours, İBB's storey mix per
 * mahalle, the GHS-BUILT-H cell mean; the district profile of the renderer (buildings/districts.ts) where none applies.
 */

import { boxOf, ccw, cutRing, Grid, hullArea, intersectionArea, orientedBox, pointInRing, type Ring, ringArea, ringCentroid, samplePoints, type Segments, type Polygons, atSea } from './geometry';

export type { Ring } from './geometry';

/* ---------------------------------------------------------------------------------------------------------------- */
/* Constants                                                                                                        */
/* ---------------------------------------------------------------------------------------------------------------- */

/** ML footprints below this area (m²) are dropped: the fetch's minimum for OSM outlines. */
export const ML_MIN_AREA = 12;
/** ML footprints below this area (m²) are kept as one-storey outbuildings (kind 'shed'). */
export const ML_OUTBUILDING_AREA = 30;
/** An ML footprint overlapping OSM by more than this (m², or 10 % of its area when that is smaller) is OSM's. */
export const OSM_OVERLAP_MAX = 1;
/** Two ML footprints overlapping by more than this share of the smaller one are one building (the larger stays). */
export const DUPLICATE_SHARE = 0.5;
/** Share of a footprint's area on streets, rails or dropped ground that drops it (its centroid there drops it too). */
export const COVER_SHARE = 0.5;
/** An ML footprint whose centroid lies this close (m) to a city wall line is the wall (towers, gates, the wall itself). */
export const WALL_CLEARANCE = 8;
/** Half width (m) of a railway track corridor (gauge, sleepers, clearance). */
export const RAIL_HALF_WIDTH = 2.5;
/** Synthetic ids: -(SYNTHETIC_ID_BASE + h), h < SYNTHETIC_ID_RANGE; below infill ids (buildings/infill.ts, >= -256e6). */
export const SYNTHETIC_ID_BASE = 256_000_001;
export const SYNTHETIC_ID_RANGE = 2 ** 28;

/**
 * Row split tiers, [minimum area m², minimum length m]: outlines longer and larger than a row building. The second
 * tier only runs where a mahalle is still short of its target after the first (dense cores drawn as block outlines).
 */
export const SPLIT_TIERS: readonly (readonly [number, number])[] = [
  [600, 25],
  [300, 16],
];
/** Outlines larger than this (m²) stay whole (malls, plants, stations). */
export const SPLIT_MAX_AREA = 5000;
/** Outlines less convex than this (area / hull) stay whole: Y and star shaped blocks, spirals, slivers. */
export const SPLIT_MIN_CONVEXITY = 0.6;
/** Outlines estimated at this many storeys or more stay whole: high-rise blocks are single buildings (İBB class 3). */
export const SPLIT_MAX_LEVELS = 9;
/** Lot frontage range (m): the infill parcel rule (buildings/infill.ts). */
export const LOT_FRONTAGE: readonly [number, number] = [6, 12];
/** Outlines deeper (m) than this get two rows of lots, back to back. */
export const LOT_DOUBLE_DEPTH = 32;
/** Lots below this area (m²) are merged into their neighbour. */
export const LOT_MIN_AREA = 25;
/**
 * The mahalle count a split aims at, as a share of İBB's: in mahalle where OSM is complete OSM counts a median 0.92 of
 * İBB's buildings (İBB's MAKS inventory counts annexes OSM draws as one building).
 */
export const SPLIT_TARGET = 0.92;

/** Neighbour median (scripts/data/lib/levels-fill.mjs): radius (m), minimum and maximum samples. */
export const FILL_RADIUS = 160;
export const FILL_MIN = 4;
export const FILL_MAX = 24;
/** Storey height (m) for levels <-> heights (scripts/data/lib/levels-fill.mjs, tools/world-compiler LEVEL_HEIGHT). */
export const STOREY = 3.1;
/** GHS-BUILT-H: the cell's area-weighted mean height stays within this share of the raster value. */
export const GHS_BAND = 0.3;
/** GHS-BUILT-H cells with less building footprint (m²) than this are not checked (too few buildings to judge). */
export const GHS_MIN_FOOTPRINT = 400;
/** Footprints below this area (m²) get at most two storeys. */
export const SMALL_FOOTPRINT = 40;
/** A mahalle's tallest tagged building caps its estimates once it has this many tagged buildings. */
export const CAP_SAMPLES = 20;

/** Kinds that are neither sampled nor filled by the storey estimate (scripts/data/lib/levels-fill.mjs FILL_SKIP). */
export const FILL_SKIP: ReadonlySet<string> = new Set(['roof', 'garage', 'garages', 'shed', 'kiosk', 'hut', 'container', 'carport', 'service', 'toilets', 'cabin', 'mosque', 'church', 'chapel', 'synagogue', 'cathedral', 'temple', 'shrine', 'greenhouse', 'bridge', 'ruins', 'stadium', 'grandstand', 'hangar', 'transformer_tower', 'water_tower', 'tower']);
/** Outline kinds a row split may partition (generic residential outlines; houses are one house by definition). */
export const SPLIT_KINDS: ReadonlySet<string> = new Set(['yes', 'apartments', 'residential', 'terrace']);

/** İBB storey classes (floors): 1-4, 5-8, 9-19 ("5-9" and "9-19" in the source share 9; it counts as class 3 here). */
export const IBB_CLASSES: readonly (readonly [number, number])[] = [
  [1, 4],
  [5, 8],
  [9, 19],
];
/** Storey draw inside a class: weights of each storey count, lowest first. */
const CLASS_WEIGHTS: readonly (readonly number[])[] = [
  [0.2, 0.35, 0.3, 0.15],
  [0.35, 0.3, 0.2, 0.15],
  [0.3, 0.25, 0.15, 0.1, 0.07, 0.05, 0.03, 0.02, 0.01, 0.01, 0.01],
];

/** Source of an estimated storey count (the data's `levelsFrom`). */
export const LevelsFrom = { None: 0, Neighbours: 1, Ibb: 2, Ghs: 3, UrbanAtlas: 4 } as const;
export type LevelsFrom = (typeof LevelsFrom)[keyof typeof LevelsFrom];
export const LEVELS_FROM_NAMES = ['', 'neighbours', 'ibb', 'ghs', 'urban-atlas'] as const;


/* ---------------------------------------------------------------------------------------------------------------- */
/* Hashes and synthetic ids                                                                                         */
/* ---------------------------------------------------------------------------------------------------------------- */

/** FNV-1a (32 bit) of a string, finished with the murmur3 mixer. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform draw in [0, 1) from a key. */
export const hash01 = (key: string): number => hash32(key) / 4294967296;

/** Key of an ML footprint: its tile and its centroid in degrees on a ~0.5 m lattice (independent of the projection). */
export const mlKey = (quadkey: string, lat: number, lon: number): string => `ml:${quadkey}:${Math.round(lat / 5e-6)}:${Math.round(lon / 5e-6)}`;
/** Key of lot `k` of row `row` of a split outline. */
export const lotKey = (parent: number, row: number, k: number): string => `lot:${parent}:${row}:${k}`;

/**
 * Stable synthetic ids for keys: -(SYNTHETIC_ID_BASE + h) with h the key's hash in [0, SYNTHETIC_ID_RANGE), never an
 * OSM id nor an infill id. Keys are taken in sorted order and a taken h moves on to the next free one, so a key's id
 * changes only when a colliding key sorts before it. `used` carries the taken values across calls (ML, then lots).
 */
export function assignIds(keys: readonly string[], used: Set<number> = new Set()): { ids: Map<string, number>; collisions: number } {
  const ids = new Map<string, number>();
  let collisions = 0;
  for (const key of [...keys].sort()) {
    if (ids.has(key)) {
      continue;
    }
    let h = hash32(key) % SYNTHETIC_ID_RANGE;
    if (used.has(h)) {
      collisions++;
      while (used.has(h)) {
        h = (h + 1) % SYNTHETIC_ID_RANGE;
      }
    }
    used.add(h);
    ids.set(key, -(SYNTHETIC_ID_BASE + h));
  }
  return { ids, collisions };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* ML footprints                                                                                                    */
/* ---------------------------------------------------------------------------------------------------------------- */

/** Why an ML footprint was not kept (the first rule that applies), in the order the rules run. */
export const Drop = { Kept: 0, Small: 1, Osm: 2, Water: 3, Sea: 4, Street: 5, Rail: 6, Wall: 7, Open: 8, Duplicate: 9 } as const;
export type Drop = (typeof Drop)[keyof typeof Drop];
export const DROP_NAMES = ['kept', 'small', 'osmOverlap', 'water', 'sea', 'street', 'rail', 'cityWall', 'openGround', 'duplicate'] as const;

export interface MlContext {
  /** Calls `fn(ring, holes)` for every OSM building and building part whose box meets `box`. */
  osmNear(box: { minX: number; minZ: number; maxX: number; maxZ: number }, fn: (ring: Ring, holes: readonly Ring[]) => boolean | void): void;
  streets: Segments;
  rails: Segments;
  walls: Segments;
  coast: Segments;
  water: Polygons<string>;
  /** Ground where ML detections are not buildings (parking, pitches, platforms, piers, ports, aprons...), by kind. */
  open: Polygons<string>;
}

/** Share of `pts` (flat x, z) for which `test` holds. */
function share(pts: readonly number[], test: (x: number, z: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < pts.length; i += 2) {
    n += test(pts[i], pts[i + 1]) ? 1 : 0;
  }
  return pts.length ? n / (pts.length / 2) : 0;
}

/**
 * The first drop rule an ML footprint (counter-clockwise ring) meets, and for open ground the kind of ground, or Kept.
 * Streets, rails, water and open ground drop a footprint whose centroid lies on them or that covers them with at least
 * COVER_SHARE of its area (sampled on a lattice); a footprint touching a street edge stays.
 */
export function classifyMl(ring: Ring, ctx: MlContext): { drop: Drop; what?: string } {
  const area = Math.abs(ringArea(ring));
  if (area < ML_MIN_AREA) {
    return { drop: Drop.Small };
  }
  const box = boxOf(ring);
  const limit = Math.min(OSM_OVERLAP_MAX, 0.1 * area);
  let osm = false;
  ctx.osmNear(box, (r, holes) => {
    if (intersectionArea(ring, r, holes) > limit) {
      osm = true;
      return true;
    }
    return false;
  });
  if (osm) {
    return { drop: Drop.Osm };
  }
  const pts = samplePoints(ring);
  const [cx, cz] = [pts[0], pts[1]];
  if (ctx.water.at(cx, cz) !== null || share(pts, (x, z) => ctx.water.at(x, z) !== null) >= COVER_SHARE) {
    return { drop: Drop.Water };
  }
  if (atSea(ctx.coast, cx, cz)) {
    return { drop: Drop.Sea };
  }
  if (ctx.streets.covers(cx, cz) || share(pts, (x, z) => ctx.streets.covers(x, z)) >= COVER_SHARE) {
    return { drop: Drop.Street };
  }
  if (ctx.rails.covers(cx, cz) || share(pts, (x, z) => ctx.rails.covers(x, z)) >= COVER_SHARE) {
    return { drop: Drop.Rail };
  }
  if (ctx.walls.covers(cx, cz)) {
    return { drop: Drop.Wall };
  }
  const open = ctx.open.at(cx, cz);
  if (open !== null) {
    return { drop: Drop.Open, what: open };
  }
  if (share(pts, (x, z) => ctx.open.at(x, z) !== null) >= COVER_SHARE) {
    return { drop: Drop.Open, what: ctx.open.at(pts[2] ?? cx, pts[3] ?? cz) ?? 'mixed' };
  }
  return { drop: Drop.Kept };
}

/**
 * Duplicate ML detections: two footprints overlapping by more than DUPLICATE_SHARE of the smaller one are one
 * building; the larger stays (ties: the smaller key). Returns a flag per footprint (1 = duplicate).
 */
export function duplicates(rings: readonly Ring[], keys: readonly string[]): Uint8Array {
  const n = rings.length;
  const area = rings.map((r) => Math.abs(ringArea(r)));
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => area[b] - area[a] || (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : 0));
  const grid = new Grid(32);
  const out = new Uint8Array(n);
  for (const i of order) {
    const b = boxOf(rings[i]);
    let dup = false;
    grid.each(b.minX, b.minZ, b.maxX, b.maxZ, (j) => {
      if (!dup && intersectionArea(rings[i], rings[j]) > DUPLICATE_SHARE * Math.min(area[i], area[j])) {
        dup = true;
      }
    });
    if (dup) {
      out[i] = 1;
    } else {
      grid.add(i, b.minX, b.minZ, b.maxX, b.maxZ);
    }
  }
  return out;
}

/** Kind of a kept ML footprint: small ones are one-storey outbuildings. */
export const mlKind = (area: number): 'yes' | 'shed' => (area < ML_OUTBUILDING_AREA ? 'shed' : 'yes');

/* ---------------------------------------------------------------------------------------------------------------- */
/* Mahalle names (İBB join)                                                                                         */
/* ---------------------------------------------------------------------------------------------------------------- */

/** Comparable mahalle / ilçe name: Turkish upper case, circumflexes dropped, "Mahallesi" and punctuation removed. */
export function normName(s: string): string {
  return s
    .toLocaleUpperCase('tr')
    .replace(/Â/g, 'A')
    .replace(/Î/g, 'İ')
    .replace(/Û/g, 'U')
    .replace(/[.'’`"\-(),/]/g, ' ')
    .replace(/(^|\s)(MAHALL?ES[İI]|MAH|MH)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ASCII fold of a normalized name (İ I Ş Ğ Ü Ö Ç), for spellings that differ only there. */
export const foldName = (s: string): string => s.replace(/[İI]/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C');

/** Levenshtein distance (small strings). */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

/** Whether the words of the shorter name are the trailing (`end`) or leading run of the longer name's words. */
function wordRun(a: string, b: string, end: boolean): boolean {
  const [s, l] = a.split(' ').length <= b.split(' ').length ? [a.split(' '), b.split(' ')] : [b.split(' '), a.split(' ')];
  if (s.length === l.length) {
    return false;
  }
  return end ? s.every((w, k) => w === l[l.length - s.length + k]) : s.every((w, k) => w === l[k]);
}

/**
 * Joins İBB rows ({ ilce, mahalle }) to OSM mahalle ({ key, ilce, name }) of the same ilçe. Exact normalized names
 * first; then, repeated while new pairs appear and only for pairs unique on both sides: equal without spaces, equal
 * after the ASCII fold, equal without a trailing "Mahalle", one name a leading or trailing run of the other's words
 * (trailing first: OSM adds the village, "Çanta Balaban" for İBB's "Balaban"), edit distance <= 2 (names of 6+
 * letters). `aliases` maps "ILÇE/MAHALLE" (normalized İBB names) to OSM names ("Ilçe/Name" when the mahalle moved to
 * another ilçe) for mahalle renamed or split since 2017, and "ILÇE" to the OSM ilçe name for renamed ilçe. Returns İBB row index -> OSM keys, and the unmatched rows on both sides.
 */
export function joinMahalle<K>(ibb: readonly { ilce: string; mahalle: string }[], osm: readonly { key: K; ilce: string; name: string }[], aliases: Readonly<Record<string, string | string[]>> = {}): { match: Map<number, K[]>; ibbUnmatched: number[]; osmUnmatched: K[] } {
  const ilceOf = (s: string): string => {
    const n = normName(s);
    const a = aliases[n];
    return typeof a === 'string' ? normName(a) : n;
  };
  const byIlce = new Map<string, { key: K; name: string; used: boolean }[]>();
  for (const o of osm) {
    const k = normName(o.ilce);
    const list = byIlce.get(k) ?? [];
    list.push({ key: o.key, name: normName(o.name), used: false });
    byIlce.set(k, list);
  }
  const match = new Map<number, K[]>();
  let pending: number[] = [];
  ibb.forEach((row, i) => {
    const alias = aliases[`${normName(row.ilce)}/${normName(row.mahalle)}`];
    // An alias "Ilçe/Name" points into another ilçe (mahalle moved between ilçe since 2017).
    const targets = alias === undefined ? [`/${row.mahalle}`] : Array.isArray(alias) ? alias : [alias];
    const hits = targets.flatMap((t) => {
      const [il, name] = t.includes('/') ? [t.slice(0, t.indexOf('/')) || row.ilce, t.slice(t.indexOf('/') + 1)] : [row.ilce, t];
      return (byIlce.get(ilceOf(il)) ?? []).filter((o) => !o.used && o.name === normName(name));
    });
    if (hits.length) {
      hits.forEach((h) => (h.used = true));
      match.set(i, hits.map((h) => h.key));
    } else {
      pending.push(i);
    }
  });
  const flat = (s: string): string => s.replace(/ /g, '');
  const noMahalle = (s: string): string => flat(foldName(s)).replace(/MAHALLE$/, '');
  const tests: ((a: string, b: string) => boolean)[] = [
    (a, b) => flat(a) === flat(b),
    (a, b) => flat(foldName(a)) === flat(foldName(b)),
    (a, b) => noMahalle(a) === noMahalle(b) && noMahalle(a).length > 0,
    (a, b) => wordRun(foldName(a), foldName(b), true),
    (a, b) => wordRun(foldName(a), foldName(b), false),
    (a, b) => flat(a).length >= 6 && editDistance(flat(foldName(a)), flat(foldName(b))) <= 2,
  ];
  for (let changed = true; changed && pending.length; ) {
    changed = false;
    for (const test of tests) {
      for (const i of [...pending]) {
        const row = ibb[i];
        const il = ilceOf(row.ilce);
        const name = normName(row.mahalle);
        const cands = (byIlce.get(il) ?? []).filter((o) => !o.used && test(name, o.name));
        if (cands.length !== 1) {
          continue;
        }
        const rivals = pending.filter((j) => j !== i && ilceOf(ibb[j].ilce) === il && test(normName(ibb[j].mahalle), cands[0].name));
        if (rivals.length) {
          continue;
        }
        cands[0].used = true;
        match.set(i, [cands[0].key]);
        pending = pending.filter((j) => j !== i);
        changed = true;
      }
    }
  }
  const osmUnmatched: K[] = [];
  for (const list of byIlce.values()) {
    for (const o of list) {
      if (!o.used) {
        osmUnmatched.push(o.key);
      }
    }
  }
  return { match, ibbUnmatched: pending, osmUnmatched };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Row splits                                                                                                       */
/* ---------------------------------------------------------------------------------------------------------------- */

/** Tags that make an outline more than a generic residential row (never split). */
export interface SplitTags {
  kind: string;
  part?: boolean;
  hasParts?: boolean;
  holes?: readonly unknown[];
  height?: number;
  levels?: number;
  name?: string;
  amenity?: string;
  shop?: string;
  tourism?: string;
  historic?: string;
  religion?: string;
}

/** Why an outline may not be split into row lots in `tier` (land use is the caller's test), or null when it may. */
export function splitBlock(b: SplitTags, ring: Ring, tier = 0): string | null {
  const [minArea, minLength] = SPLIT_TIERS[tier];
  if (b.part || b.hasParts) {
    return 'parts';
  }
  if (!SPLIT_KINDS.has(b.kind)) {
    return 'kind';
  }
  if (b.height || b.levels) {
    return 'heightTagged';
  }
  if (b.name || b.amenity || b.shop || b.tourism || b.historic || b.religion) {
    return 'namedOrUse';
  }
  const area = Math.abs(ringArea(ring));
  if (area < minArea) {
    return 'small';
  }
  if (area > SPLIT_MAX_AREA) {
    return 'huge';
  }
  if (b.holes?.length) {
    return 'courtyard';
  }
  if (orientedBox(ring).hl * 2 < minLength) {
    return 'short';
  }
  return area / Math.max(1e-6, hullArea(ring)) < SPLIT_MIN_CONVEXITY ? 'concave' : null;
}

/** Whether an outline's tags and shape allow a row split in `tier` (land use is the caller's test). */
export const splittable = (b: SplitTags, ring: Ring, tier = 0): boolean => splitBlock(b, ring, tier) === null;

/** Drops vertices closer than 5 cm to the previous one (clipping leaves duplicates). */
function tidy(r: Ring): Ring {
  const out: Ring = [];
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const x = r[i * 2];
    const z = r[i * 2 + 1];
    const m = out.length;
    if (m >= 2 && Math.hypot(x - out[m - 2], z - out[m - 1]) < 0.05) {
      continue;
    }
    out.push(x, z);
  }
  while (out.length >= 6 && Math.hypot(out[0] - out[out.length - 2], out[1] - out[out.length - 1]) < 0.05) {
    out.length -= 2;
  }
  return out.length >= 6 ? out : [];
}

/**
 * Row lots of an outline: strips across its long axis (frontage drawn in LOT_FRONTAGE per lot from `key`), two rows
 * back to back when deeper than LOT_DOUBLE_DEPTH, each strip cut out of the outline exactly (geometry.ts cutRing, so a
 * strip through a concave outline yields one lot per arm). A lot under LOT_MIN_AREA joins its strip's smaller
 * neighbour strip. The lots tile the outline (counter-clockwise rings); an empty list means no split.
 */
export function splitLots(ring: Ring, key: string): Ring[] {
  const r = ccw(ring);
  const box = orientedBox(r);
  const [f0, f1] = LOT_FRONTAGE;
  const cuts: number[] = [];
  for (let k = 0, s = -box.hl; box.hl - s > f1; k++) {
    let w = f0 + (f1 - f0) * hash01(`${key}:w${k}`);
    if (box.hl - s - w < f0) {
      w = (box.hl - s) / 2;
    }
    s += w;
    cuts.push(s);
  }
  const rows: (number | null)[] = box.hw * 2 > LOT_DOUBLE_DEPTH ? [0] : [];
  // OBB coordinates: s along (dx, dz), t along (-dz, dx), both from the box centre.
  const cs = box.cx * box.dx + box.cz * box.dz;
  const ct = -box.cx * box.dz + box.cz * box.dx;
  const cut = (pieces: Ring[], nx: number, nz: number, d: number): Ring[] => pieces.flatMap((p) => cutRing(p, nx, nz, d));
  const lotsOf = (edges: readonly number[]): { ring: Ring; strip: number; area: number }[] => {
    const out: { ring: Ring; strip: number; area: number }[] = [];
    const tEdges = [null, ...rows, null];
    for (let k = 0; k <= edges.length; k++) {
      let strip = [r];
      if (k > 0) {
        strip = cut(strip, box.dx, box.dz, cs + edges[k - 1]);
      }
      if (k < edges.length) {
        strip = cut(strip, -box.dx, -box.dz, -(cs + edges[k]));
      }
      for (let q = 0; q + 1 < tEdges.length; q++) {
        let part = strip;
        if (tEdges[q] !== null) {
          part = cut(part, -box.dz, box.dx, ct + tEdges[q]!);
        }
        if (tEdges[q + 1] !== null) {
          part = cut(part, box.dz, -box.dx, -(ct + tEdges[q + 1]!));
        }
        for (const p of part) {
          const t = tidy(p);
          if (t.length) {
            out.push({ ring: t, strip: k, area: Math.abs(ringArea(t)) });
          }
        }
      }
    }
    return out;
  };
  const edges = cuts.slice();
  for (;;) {
    const lots = lotsOf(edges);
    if (lots.length <= 1) {
      return [];
    }
    let worst: (typeof lots)[number] | null = null;
    for (const l of lots) {
      if (l.area < LOT_MIN_AREA && (!worst || l.area < worst.area)) {
        worst = l;
      }
    }
    if (!worst) {
      return lots.map((l) => l.ring);
    }
    if (!edges.length) {
      // One strip whose rows or arms stay too small: the outline stays whole.
      return [];
    }
    // Join the strip with its smaller neighbour strip (remove the cut between them).
    const stripArea = (k: number): number => lots.filter((l) => l.strip === k).reduce((a, l) => a + l.area, 0);
    const k = worst.strip;
    const left = k > 0 ? stripArea(k - 1) : Infinity;
    const right = k < edges.length ? stripArea(k + 1) : Infinity;
    edges.splice(left <= right ? k - 1 : k, 1);
  }
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Storeys                                                                                                          */
/* ---------------------------------------------------------------------------------------------------------------- */

/** İBB storey class (0, 1, 2) of a storey count. */
export const classOf = (levels: number): number => (levels >= IBB_CLASSES[2][0] ? 2 : levels >= IBB_CLASSES[1][0] ? 1 : 0);

/**
 * Class quotas for `undecided` buildings of a mahalle: its İBB shares applied to all `total` buildings, minus the
 * buildings already decided per class (tags, neighbours), scaled to the undecided count (largest remainders).
 */
export function classQuotas(ibb: readonly number[], total: number, decided: readonly number[], undecided: number): number[] {
  const sum = ibb.reduce((s, v) => s + v, 0);
  if (sum <= 0 || undecided <= 0) {
    return [undecided, 0, 0];
  }
  const want = ibb.map((v, k) => Math.max(0, (v / sum) * total - decided[k]));
  const wsum = want.reduce((s, v) => s + v, 0);
  const shares = wsum > 0 ? want.map((v) => v / wsum) : ibb.map((v) => v / sum);
  const exact = shares.map((s) => s * undecided);
  const q = exact.map(Math.floor);
  let rest = undecided - q.reduce((s, v) => s + v, 0);
  const order = exact.map((e, k) => [e - Math.floor(e), k]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let i = 0; rest > 0; i = (i + 1) % order.length, rest--) {
    q[order[i][1]]++;
  }
  return q;
}

/**
 * Classes of the undecided units of a mahalle (`units` sorted by footprint area, largest first; `weight` counts the
 * buildings a unit stands for, e.g. the lots of a split outline): the largest take the highest classes first.
 */
export function assignClasses(weights: readonly number[], quotas: readonly number[]): Uint8Array {
  const out = new Uint8Array(weights.length);
  const left = quotas.slice();
  let cls = 2;
  weights.forEach((w, i) => {
    while (cls > 0 && left[cls] <= 0) {
      cls--;
    }
    out[i] = cls;
    left[cls] -= w;
  });
  return out;
}

/** Storey count inside an İBB class, drawn from `h` in [0, 1). */
export function storeysInClass(cls: number, h: number): number {
  const w = CLASS_WEIGHTS[cls];
  const total = w.reduce((s, v) => s + v, 0);
  let t = h * total;
  for (let k = 0; k < w.length; k++) {
    t -= w[k];
    if (t < 0) {
      return IBB_CLASSES[cls][0] + k;
    }
  }
  return IBB_CLASSES[cls][0] + w.length - 1;
}

/**
 * Factor on the estimated heights of a GHS-BUILT-H cell so its area-weighted mean height stays within GHS_BAND of the
 * raster value `ghs` (m): `fixedAH` and `estAH` are the sums of footprint area x height of the tagged and the
 * estimated buildings, `area` their footprint. 1 when inside the band or nothing can move.
 */
export function ghsFactor(ghs: number, fixedAH: number, estAH: number, area: number): number {
  if (!(ghs > 0) || area < GHS_MIN_FOOTPRINT || estAH <= 0) {
    return 1;
  }
  const mean = (fixedAH + estAH) / area;
  const lo = (1 - GHS_BAND) * ghs;
  const hi = (1 + GHS_BAND) * ghs;
  if (mean >= lo && mean <= hi) {
    return 1;
  }
  const target = mean > hi ? hi : lo;
  return Math.max(0.25, Math.min(4, (target * area - fixedAH) / estAH));
}

/** Sanity limits of an estimate: outbuildings one storey, small footprints two, the mahalle's cap, at least one. */
export function capLevels(levels: number, area: number, kind: string, cap: number): number {
  let v = Math.round(levels);
  if (kind === 'shed') {
    v = 1;
  }
  if (area < SMALL_FOOTPRINT) {
    v = Math.min(v, 2);
  }
  return Math.max(1, Math.min(v, cap));
}

/** Tagged storeys of a building (levels, else height less the roof over STOREY m), 0 when untagged. */
export const taggedLevels = (b: { levels?: number; height?: number; roofHeight?: number }): number => b.levels ?? (b.height ? Math.max(1, Math.round((b.height - (b.roofHeight ?? 0)) / STOREY)) : 0);

/** Point-in-polygon on a ring re-exported for callers that only import the rules. */
export { pointInRing, ringCentroid };
