/**
 * Feature kits of the details layer (worker side): one generic placement rule per OSM place type, driven by its
 * geometry and tags (.docs/planning/23-osm-feature-kits.md). Every rule reads the shipped OSM data only, stands its
 * props through the shared stand rule (props/stamp.ts) and keeps to a per-slice budget.
 *
 * - amenity=fuel: canopy over two pump islands facing the nearest street, the shop behind it and the price pylon
 *   at the street corner; brand colour from the name.
 * - leisure=pitch: football goals at both ends of the pitch's long axis (small goals on five-a-side pitches), hoops
 *   on basketball courts.
 * - leisure=playground: a swing, a slide tower and a climbing frame inside the area.
 * - green areas: shrubs (dense on scrub, loose clumps on lawns and in parks), field stones on grass, flower clumps on
 *   flower beds; never on paths, carriageways or against walls.
 * - shopfronts: an awning over the facade of cafés, restaurants and shops, the lit sign of every pharmacy, wall ATMs.
 * - amenity=fountain: a marble çeşme against the wall it stands at, else a round basin (fountain areas: at their centre).
 * - tourism=artwork / historic=memorial: a statue on its plinth; tourism=viewpoint: a coin telescope.
 * - landuse=cemetery: rows of Ottoman headstones along the area's axis; amenity=marketplace: rows of stalls.
 * - small street kit: fire hydrants, recycling containers, bicycle racks, outdoor fitness stations, hedges, metro
 *   entrances (railway=subway_entrance) and taxi stands (amenity=taxi).
 * - untagged lots (cover.ts LotStyle): shrubs on garden lots, stones and weedy scrub on vacant lots (the verges and
 *   leftover land along the big roads are mostly these).
 */
import type { OsmArea, OsmData, OsmLine, OsmPoint } from '../../data';
import { hash, pointInRing } from '../../shared/geometry';
import { Zone } from '../../shared/street-surface';
import { CoverChannel, LotStyle } from '../cover/cover';
import type { Placer } from './placement';

/** Per-slice budgets (instances). */
const BUDGET = { shrub: 2500, flowers: 1500, rock: 700, awning: 1500, tombstone: 2000, marketStall: 150, lotShrub: 1500, lotRock: 600 } as const;

/** Brand colours by name (lower case, Turkish folded); anything else takes a neutral palette colour. */
const BRANDS: [RegExp, [number, number, number]][] = [
  [/shell/, [0.95, 0.78, 0.08]],
  [/opet/, [0.08, 0.28, 0.62]],
  [/\bbp\b/, [0.1, 0.55, 0.2]],
  [/petrol ofisi|\bpo\b/, [0.8, 0.08, 0.08]],
  [/total/, [0.85, 0.15, 0.1]],
  [/aytemiz/, [0.95, 0.7, 0.05]],
  [/lukoil/, [0.75, 0.05, 0.1]],
  [/turkiye petrolleri|türkiye petrolleri|\btp\b/, [0.8, 0.1, 0.1]],
  [/moil|m oil/, [0.1, 0.3, 0.6]],
  [/alpet/, [0.9, 0.35, 0.05]],
];
const NEUTRAL: [number, number, number][] = [
  [0.1, 0.35, 0.6],
  [0.75, 0.12, 0.1],
  [0.15, 0.5, 0.25],
];
const AWNING_TINTS: [number, number, number][] = [
  [0.62, 0.08, 0.07],
  [0.1, 0.32, 0.18],
  [0.08, 0.14, 0.32],
  [0.78, 0.74, 0.62],
  [0.55, 0.3, 0.1],
  [0.72, 0.42, 0.06],
  [0.25, 0.25, 0.27],
];
const SHRUB_TINTS: [number, number, number][] = [
  [0.2, 0.32, 0.12],
  [0.24, 0.36, 0.14],
  [0.17, 0.27, 0.13],
  [0.3, 0.36, 0.16],
];
const FLOWER_TINTS: [number, number, number][] = [
  [0.85, 0.2, 0.35],
  [0.9, 0.75, 0.15],
  [0.62, 0.3, 0.75],
  [0.92, 0.9, 0.86],
  [0.9, 0.35, 0.15],
];

const pick = <T>(list: readonly T[], h: number): T => list[Math.min(list.length - 1, Math.floor(h * list.length))];

/** World position of a local offset (right = x, forward = z) from (x, z) turned to yaw (forward = (sin, cos)). */
function at(x: number, z: number, yaw: number, rx: number, fz: number): [number, number] {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return [x + rx * c + fz * s, z - rx * s + fz * c];
}

/** Oriented bounding box of a flat ring (the edge direction with the smallest box). */
function orientedBox(r: ArrayLike<number>): { cx: number; cz: number; len: number; wid: number; ax: number; az: number } {
  const n = r.length / 2;
  let best = { area: Infinity, cx: 0, cz: 0, len: 0, wid: 0, ax: 1, az: 0 };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ax = r[j * 2] - r[i * 2];
    let az = r[j * 2 + 1] - r[i * 2 + 1];
    const l = Math.hypot(ax, az);
    if (l < 1e-3) {
      continue;
    }
    ax /= l;
    az /= l;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = r[k * 2];
      const z = r[k * 2 + 1];
      const u = x * ax + z * az;
      const v = -x * az + z * ax;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const uc = (u0 + u1) / 2;
      const vc = (v0 + v1) / 2;
      const long = u1 - u0 >= v1 - v0;
      best = {
        area,
        cx: uc * ax - vc * az,
        cz: uc * az + vc * ax,
        len: long ? u1 - u0 : v1 - v0,
        wid: long ? v1 - v0 : u1 - u0,
        ax: long ? ax : -az,
        az: long ? az : ax,
      };
    }
  }
  return best;
}

function inArea(a: OsmArea, x: number, z: number): boolean {
  return pointInRing(a.ring, x, z) && !(a.holes ?? []).some((h) => pointInRing(h, x, z));
}

function fold(s: string): string {
  return s.toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
}

/* ------------------------------------------------------------------ amenity=fuel */

function placeFuel(pl: Placer, points: readonly OsmPoint[]): void {
  points.forEach((p, i) => {
    if (p.kind !== 'amenity=fuel' || !pl.inArea(p.x, p.z)) {
      return;
    }
    const spot = pl.near(p.x, p.z, 25, 8, 9) ?? pl.near(p.x, p.z, 18, 6, 8);
    if (!spot) {
      return;
    }
    const [x, z] = spot;
    const yaw = pl.faceStreet(x, z, hash(i * 1.7) * Math.PI * 2);
    const name = fold(p.name ?? '');
    const brand = BRANDS.find(([re]) => re.test(name))?.[1] ?? pick(NEUTRAL, hash(i * 3.1));
    if (!pl.prop('fuelCanopy', x, z, yaw, 1, brand)) {
      return;
    }
    for (const [rx, fz] of [
      [0, 0],
      [-6, 0],
      [6, 0],
      [0, -4],
      [0, 4],
    ]) {
      pl.reserve(...at(x, z, yaw, rx, fz));
    }
    for (const fz of [-2.5, 2.5]) {
      const [px, pz] = at(x, z, yaw, 0, fz);
      pl.props.add('fuelPump', px, pl.y(px, pz), pz, yaw, 1, brand);
    }
    const [sx, sz] = at(x, z, yaw, 0, -11.5);
    if (pl.free(sx, sz, 4, 4)) {
      pl.prop('fuelShop', sx, sz, yaw, 1, brand);
    }
    for (const side of [1, -1]) {
      const [qx, qz] = at(x, z, yaw, side * 9.5, 7);
      if (pl.free(qx, qz, 1, 1.5)) {
        pl.prop('fuelSign', qx, qz, yaw, 1, brand);
        break;
      }
    }
  });
}

/* ------------------------------------------------------------------ leisure=pitch */

function placePitches(pl: Placer, areas: readonly OsmArea[]): void {
  areas.forEach((a) => {
    if (a.kind !== 'leisure=pitch' || (a.layer ?? 0) < 0) {
      return;
    }
    const b = orientedBox(a.ring);
    if (!pl.inArea(b.cx, b.cz, 4) || b.len < 12 || b.wid < 7) {
      return;
    }
    const sport = a.sport ?? 'soccer';
    const football = /soccer|football|futbol/.test(sport) || (!a.sport && b.len >= 25);
    const basket = /basketball/.test(sport);
    if (!football && !basket) {
      return;
    }
    for (const end of [-1, 1]) {
      const inset = basket ? 1.6 : 0.4;
      const x = b.cx + b.ax * end * (b.len / 2 - inset);
      const z = b.cz + b.az * end * (b.len / 2 - inset);
      if (!inArea(a, x, z)) {
        continue;
      }
      // Front (+Z) looks back along the axis into the pitch.
      const yaw = Math.atan2(-b.ax * end, -b.az * end);
      if (basket) {
        pl.prop('basketHoop', x, z, yaw);
      } else {
        pl.prop('goal', x, z, yaw, b.len < 45 ? 0.5 : 1);
      }
    }
  });
}

/* ------------------------------------------------------------------ leisure=playground */

function placePlaygrounds(pl: Placer, data: Pick<OsmData, 'areas' | 'points'>): void {
  const sites: { x: number; z: number; area: OsmArea | null; seed: number }[] = [];
  data.areas.forEach((a, i) => {
    if (a.kind === 'leisure=playground') {
      const b = orientedBox(a.ring);
      sites.push({ x: b.cx, z: b.cz, area: a, seed: i });
    }
  });
  data.points.forEach((p, i) => {
    if (p.kind === 'leisure=playground') {
      sites.push({ x: p.x, z: p.z, area: null, seed: 1000 + i });
    }
  });
  for (const s of sites) {
    if (!pl.inArea(s.x, s.z)) {
      continue;
    }
    const yaw = hash(s.seed * 1.3) * Math.PI * 2;
    const kit = ['swing', 'slide', 'climber'] as const;
    kit.forEach((kind, k) => {
      const [x, z] = at(s.x, s.z, yaw, (k - 1) * 4.2, (hash(s.seed + k) - 0.5) * 2);
      if ((s.area && !inArea(s.area, x, z)) || !pl.free(x, z, 1.5, 2.5)) {
        return;
      }
      pl.prop(kind, x, z, yaw + (k === 1 ? Math.PI * hash(s.seed * 2.7) : 0));
    });
  }
}

/* ------------------------------------------------------------------ green areas */

interface GreenRule {
  /** Sample spacing (m) and share of samples planted with a shrub, a stone or a flower clump. */
  step: number;
  shrub: number;
  rock: number;
  flowers: number;
}

const GREEN: Record<string, GreenRule> = {
  'natural=scrub': { step: 3.5, shrub: 0.7, rock: 0.05, flowers: 0 },
  'natural=heath': { step: 4, shrub: 0.45, rock: 0.08, flowers: 0 },
  'landuse=grass': { step: 8, shrub: 0.16, rock: 0.07, flowers: 0 },
  'natural=grass': { step: 8, shrub: 0.12, rock: 0.06, flowers: 0 },
  'landuse=meadow': { step: 9, shrub: 0.1, rock: 0.05, flowers: 0.04 },
  'landuse=village_green': { step: 9, shrub: 0.12, rock: 0.03, flowers: 0.03 },
  'leisure=park': { step: 10, shrub: 0.18, rock: 0.02, flowers: 0.04 },
  'leisure=garden': { step: 6, shrub: 0.3, rock: 0.02, flowers: 0.15 },
  'landuse=flowerbed': { step: 1.6, shrub: 0, rock: 0, flowers: 0.8 },
  'natural=bare_rock': { step: 3, shrub: 0.05, rock: 0.5, flowers: 0 },
};

function placeGreen(pl: Placer, areas: readonly OsmArea[]): void {
  const left = { ...BUDGET };
  const s = pl.ctx.surface;
  areas.forEach((a, ai) => {
    const rule = GREEN[a.kind];
    if (!rule || (a.layer ?? 0) < 0) {
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < a.ring.length; k += 2) {
      minX = Math.min(minX, a.ring[k]);
      maxX = Math.max(maxX, a.ring[k]);
      minZ = Math.min(minZ, a.ring[k + 1]);
      maxZ = Math.max(maxZ, a.ring[k + 1]);
    }
    const st = rule.step;
    for (let gz = Math.floor(minZ / st); gz * st <= maxZ; gz++) {
      for (let gx = Math.floor(minX / st); gx * st <= maxX; gx++) {
        const h0 = hash(gx * 12.9898 + gz * 78.233 + ai * 0.37);
        const kind = h0 < rule.shrub ? 'shrub' : h0 < rule.shrub + rule.rock ? 'rock' : h0 < rule.shrub + rule.rock + rule.flowers ? 'flowers' : null;
        if (!kind || left[kind] <= 0) {
          continue;
        }
        const x = (gx + 0.2 + 0.6 * hash(gx * 3.1 + gz * 7.7)) * st;
        const z = (gz + 0.2 + 0.6 * hash(gx * 5.3 + gz * 1.9)) * st;
        if (!pl.inArea(x, z, 2) || !inArea(a, x, z) || pl.wall(x, z) < 1.5 || pl.onPad(x, z)) {
          continue;
        }
        if (pl.channel(x, z, CoverChannel.Path) >= -0.8 || pl.channel(x, z, CoverChannel.Parking) >= -0.5 || s.zone(x, z) === Zone.Carriageway || s.distance(x, z) < 1.2) {
          continue;
        }
        const h1 = hash(gx * 1.7 + gz * 9.1 + 0.5);
        const yaw = h1 * Math.PI * 2;
        const scale = kind === 'rock' ? 0.5 + h1 * 1.1 : kind === 'shrub' ? 0.7 + h1 * 0.9 : 0.8 + h1 * 0.5;
        const tint = kind === 'shrub' ? pick(SHRUB_TINTS, h1) : kind === 'flowers' ? pick(FLOWER_TINTS, hash(ai * 3.3 + gx)) : undefined;
        if (pl.props.add(kind, x, pl.y(x, z), z, yaw, scale, tint)) {
          left[kind]--;
        }
      }
    }
  });
}

/* ------------------------------------------------------------------ shopfronts */

function isFront(p: OsmPoint): 'food' | 'shop' | 'pharmacy' | null {
  if (p.kind === 'amenity=pharmacy') return 'pharmacy';
  if (/^amenity=(cafe|restaurant|bar|pub|fast_food|ice_cream)$/.test(p.kind)) return 'food';
  if (p.kind.startsWith('shop=') && p.kind !== 'shop=kiosk' && p.kind !== 'shop=mall' && p.kind !== 'shop=supermarket') return 'shop';
  return null;
}

/**
 * Point on the facade nearest to (x, z) and the yaw facing out of it: the first cell next to a building (the building
 * distance field is quantised to its raster pixel) off the carriageway, pulled back to 0.3 m from the wall. Null when
 * there is none within 8 m.
 */
function facadeSpot(pl: Placer, x: number, z: number): { x: number; z: number; yaw: number } | null {
  const s = pl.ctx.surface;
  const px = pl.ctx.cover.grid.px;
  for (let r = 0; r <= 8; r += px * 0.5) {
    const n = r === 0 ? 1 : Math.max(8, Math.round((r * 6) / px));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const qx = x + Math.cos(a) * r;
      const qz = z + Math.sin(a) * r;
      const w = pl.wall(qx, qz);
      if (w <= 0 || w > px * 1.5 || s.zone(qx, qz) === Zone.Carriageway) {
        continue;
      }
      const yaw = pl.faceAwayFromWall(qx, qz, NaN);
      if (!Number.isFinite(yaw)) {
        continue;
      }
      const back = Math.max(0, w - 0.3);
      return { x: qx - Math.sin(yaw) * back, z: qz - Math.cos(yaw) * back, yaw };
    }
  }
  return null;
}

function placeFronts(pl: Placer, points: readonly OsmPoint[]): void {
  let awnings = BUDGET.awning;
  points.forEach((p, i) => {
    const type = isFront(p);
    if (!type || !pl.inArea(p.x, p.z)) {
      return;
    }
    if (type !== 'pharmacy' && (awnings <= 0 || hash(i * 0.91 + 0.3) > (type === 'food' ? 0.65 : 0.4))) {
      return;
    }
    const spot = facadeSpot(pl, p.x, p.z);
    if (!spot || pl.clearance(spot.x, spot.z) < (type === 'pharmacy' ? 1.5 : 3.4)) {
      return;
    }
    const { x, z, yaw } = spot;
    if (type === 'pharmacy') {
      pl.prop('pharmacySign', x, z, yaw);
    } else if (pl.prop('awning', x, z, yaw, 1, pick(AWNING_TINTS, hash(i * 2.9)))) {
      awnings--;
    }
  });
}

/* ------------------------------------------------------------------ fountains, monuments, street kit */

/** The centre of an area's oriented box (areas) or the point itself. */
function sitesOf(data: Pick<OsmData, 'points' | 'areas'>, kinds: readonly string[]): { x: number; z: number; area: OsmArea | null; seed: number }[] {
  const out: { x: number; z: number; area: OsmArea | null; seed: number }[] = [];
  data.points.forEach((p, i) => {
    if (kinds.includes(p.kind)) {
      out.push({ x: p.x, z: p.z, area: null, seed: i });
    }
  });
  data.areas.forEach((a, i) => {
    if (kinds.includes(a.kind)) {
      const b = orientedBox(a.ring);
      out.push({ x: b.cx, z: b.cz, area: a, seed: 5000 + i });
    }
  });
  return out;
}

function placeFountains(pl: Placer, data: Pick<OsmData, 'points' | 'areas'>): void {
  for (const s of sitesOf(data, ['amenity=fountain'])) {
    if (!pl.inArea(s.x, s.z)) {
      continue;
    }
    // A point fountain within 2.5 m of a wall is a çeşme on that wall; everything else a free-standing basin.
    if (!s.area && pl.wall(s.x, s.z) < 2.5) {
      const f = facadeSpot(pl, s.x, s.z);
      if (f && pl.clearance(f.x, f.z) > 1.5) {
        pl.prop('cesme', f.x, f.z, f.yaw);
      }
      continue;
    }
    const spot = pl.near(s.x, s.z, 6, 3, 3);
    if (spot && (!s.area || inArea(s.area, spot[0], spot[1]))) {
      pl.prop('fountainBasin', spot[0], spot[1], hash(s.seed) * Math.PI, s.area ? 1.3 : 1);
    }
  }
}

/** One prop near every site of the given kinds: free spot within `radius`, facing the street. */
function placeAt(pl: Placer, data: Pick<OsmData, 'points' | 'areas'>, kinds: readonly string[], kind: Parameters<Placer['prop']>[0], radius: number, wall: number, room: number, scale = () => 1): void {
  for (const s of sitesOf(data, kinds)) {
    if (!pl.inArea(s.x, s.z)) {
      continue;
    }
    const spot = pl.near(s.x, s.z, radius, wall, room);
    if (spot && (!s.area || inArea(s.area, spot[0], spot[1]))) {
      pl.prop(kind, spot[0], spot[1], pl.faceStreet(spot[0], spot[1], hash(s.seed * 1.1) * Math.PI * 2), scale());
    }
  }
}

function placeAtms(pl: Placer, points: readonly OsmPoint[]): void {
  points.forEach((p) => {
    if (p.kind !== 'amenity=atm' || !pl.inArea(p.x, p.z)) {
      return;
    }
    const f = facadeSpot(pl, p.x, p.z);
    if (f && pl.clearance(f.x, f.z) > 1.2) {
      pl.prop('atm', f.x, f.z, f.yaw);
    }
  });
}

/** Rows of `kind` across an area along its long axis: `step` along the rows, `row` between them, `share` filled. */
function fillRows(pl: Placer, a: OsmArea, seed: number, kind: 'tombstone' | 'marketStall', step: number, row: number, share: number, budget: { left: number }, tint?: (h: number) => [number, number, number]): void {
  const b = orientedBox(a.ring);
  const sx = -b.az;
  const sz = b.ax;
  const yaw = Math.atan2(sx, sz);
  for (let v = -b.wid / 2 + row / 2; v <= b.wid / 2 - row / 2; v += row) {
    for (let u = -b.len / 2 + step / 2; u <= b.len / 2 - step / 2; u += step) {
      if (budget.left <= 0) {
        return;
      }
      const h = hash(seed * 0.13 + u * 3.7 + v * 11.3);
      if (h > share) {
        continue;
      }
      const jit = kind === 'tombstone' ? (hash(h * 91) - 0.5) * 0.5 : 0;
      const x = b.cx + b.ax * (u + jit) + sx * v;
      const z = b.cz + b.az * (u + jit) + sz * v;
      if (!pl.inArea(x, z, 2) || !inArea(a, x, z) || pl.wall(x, z) < 1 || pl.channel(x, z, CoverChannel.Path) >= -0.5 || pl.ctx.surface.zone(x, z) === Zone.Carriageway) {
        continue;
      }
      const tilt = kind === 'tombstone' ? (hash(h * 7) - 0.5) * 0.35 : 0;
      if (pl.props.add(kind, x, pl.y(x, z), z, yaw + tilt, kind === 'tombstone' ? 0.8 + hash(h * 13) * 0.5 : 1, tint?.(h))) {
        budget.left--;
      }
    }
  }
}

function placeCemeteries(pl: Placer, areas: readonly OsmArea[]): void {
  const budget = { left: BUDGET.tombstone };
  areas.forEach((a, i) => {
    if (a.kind === 'landuse=cemetery' || a.kind === 'amenity=grave_yard') {
      fillRows(pl, a, i, 'tombstone', 1.5, 2.4, 0.55, budget, (h) => {
        const k = 0.72 + 0.2 * hash(h * 5);
        return [k, k * 0.97, k * 0.9];
      });
    }
  });
}

function placeMarkets(pl: Placer, data: Pick<OsmData, 'points' | 'areas'>): void {
  const budget = { left: BUDGET.marketStall };
  data.areas.forEach((a, i) => {
    if (a.kind === 'amenity=marketplace') {
      fillRows(pl, a, i, 'marketStall', 3.4, 4.2, 0.85, budget, (h) => pick(AWNING_TINTS, h));
    }
  });
  data.points.forEach((p, i) => {
    if (p.kind !== 'amenity=marketplace' || !pl.inArea(p.x, p.z)) {
      return;
    }
    const yaw = pl.faceStreet(p.x, p.z, hash(i) * Math.PI);
    for (let k = -2; k <= 2 && budget.left > 0; k++) {
      const [x, z] = at(p.x, p.z, yaw, k * 3.4, 0);
      if (pl.free(x, z, 1.5, 2)) {
        pl.prop('marketStall', x, z, yaw, 1, pick(AWNING_TINTS, hash(i * 3 + k)));
        budget.left--;
      }
    }
  });
}

function placeHedges(pl: Placer, lines: readonly OsmLine[]): void {
  for (const l of lines) {
    if (l.kind !== 'barrier=hedge') {
      continue;
    }
    for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const ax = l.pts[i];
      const az = l.pts[i + 1];
      const dx = l.pts[i + 2] - ax;
      const dz = l.pts[i + 3] - az;
      const len = Math.hypot(dx, dz);
      // The hedge segment's x axis along the line: (cos yaw, -sin yaw) = (dx, dz) / len.
      const yaw = Math.atan2(-dz, dx);
      for (let s = 1; s < len; s += 2) {
        const x = ax + (dx * s) / len;
        const z = az + (dz * s) / len;
        if (pl.inArea(x, z, 2) && pl.ctx.surface.zone(x, z) !== Zone.Carriageway) {
          pl.props.add('hedge', x, pl.y(x, z), z, yaw, 1, undefined, l.height ? l.height / 1.1 : 1);
        }
      }
    }
  }
}

/** Samples per m² of lot and what they become. */
const LOT_RULE: Partial<Record<LotStyle, { per: number; shrub: number; rock: number }>> = {
  [LotStyle.Garden]: { per: 1 / 70, shrub: 0.75, rock: 0.05 },
  [LotStyle.Vacant]: { per: 1 / 60, shrub: 0.35, rock: 0.4 },
  [LotStyle.Yard]: { per: 1 / 150, shrub: 0.4, rock: 0.1 },
};
/** Weedy scrub on vacant ground: drier greens. */
const WEED_TINTS: [number, number, number][] = [
  [0.3, 0.33, 0.16],
  [0.36, 0.36, 0.2],
  [0.26, 0.3, 0.15],
];

function placeLots(pl: Placer): void {
  const { grid, lots } = pl.ctx.cover;
  const s = pl.ctx.surface;
  let shrubs = BUDGET.lotShrub;
  let rocks = BUDGET.lotRock;
  lots.forEach((lot, li) => {
    const rule = LOT_RULE[lot.style];
    if (!rule || lot.area < 60) {
      return;
    }
    const n = Math.min(40, Math.floor(lot.area * rule.per));
    for (let q = 0; q < n; q++) {
      const h = hash(li * 7.31 + q * 1.93);
      const k = lot.cells[Math.floor(h * lot.cells.length)];
      const i = k % grid.w;
      const x = grid.cx(i) + (hash(h * 17) - 0.5) * grid.px;
      const z = grid.cz((k - i) / grid.w) + (hash(h * 29) - 0.5) * grid.px;
      const r = hash(h * 43);
      const kind = r < rule.shrub ? 'shrub' : r < rule.shrub + rule.rock ? 'rock' : null;
      if (!kind || (kind === 'shrub' ? shrubs : rocks) <= 0) {
        continue;
      }
      if (!pl.inArea(x, z, 2) || pl.wall(x, z) < 1.5 || s.distance(x, z) < 1.5 || s.zone(x, z) === Zone.Carriageway || pl.onPad(x, z)) {
        continue;
      }
      // Shrubs where the lot paints green, stones anywhere on it.
      if (kind === 'shrub' && pl.channel(x, z, CoverChannel.Green) < -0.3) {
        continue;
      }
      const tint = kind === 'shrub' ? (lot.style === LotStyle.Vacant ? pick(WEED_TINTS, r) : pick(SHRUB_TINTS, r)) : undefined;
      if (pl.props.add(kind, x, pl.y(x, z), z, h * Math.PI * 2, kind === 'rock' ? 0.4 + r * 1.2 : 0.6 + r * 0.9, tint)) {
        if (kind === 'shrub') {
          shrubs--;
        } else {
          rocks--;
        }
      }
    }
  });
}

export function placeFeatures(pl: Placer, data: Pick<OsmData, 'points' | 'areas' | 'lines'>): void {
  placeFuel(pl, data.points);
  placePitches(pl, data.areas);
  placePlaygrounds(pl, data);
  placeFountains(pl, data);
  placeAt(pl, data, ['tourism=artwork', 'historic=memorial', 'historic=monument'], 'statue', 5, 2, 3);
  placeAt(pl, data, ['tourism=viewpoint'], 'telescope', 4, 1, 1.5);
  placeAt(pl, data, ['emergency=fire_hydrant'], 'hydrant', 2, 0.3, 0.8);
  placeAt(pl, data, ['amenity=recycling', 'amenity=waste_disposal'], 'recycling', 4, 0.5, 2.5);
  placeAt(pl, data, ['amenity=bicycle_parking'], 'bikeRack', 4, 0.5, 2.5);
  placeAt(pl, data, ['leisure=fitness_station'], 'fitness', 6, 2, 3);
  placeAt(pl, data, ['railway=subway_entrance'], 'metroEntrance', 4, 1.5, 4);
  placeAt(pl, data, ['amenity=taxi'], 'taxiStand', 6, 1, 3);
  placeMarkets(pl, data);
  placeFronts(pl, data.points);
  placeAtms(pl, data.points);
  placeCemeteries(pl, data.areas);
  placeHedges(pl, data.lines);
  placeGreen(pl, data.areas);
  placeLots(pl);
}
