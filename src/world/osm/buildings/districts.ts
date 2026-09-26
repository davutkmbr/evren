/**
 * Neighbourhood profiles for buildings without enough OSM tags: which facade archetypes, heights, roofs and colours
 * are typical where. Profiles are soft discs (lat / lon centre, radius); a building picks one profile by a
 * deterministic draw weighted with exp(-(d / r)^2), so neighbourhood borders blend instead of forming seams.
 * The table is plain data so the same mechanism scales to other districts later.
 */
import { latLonToLocal } from '../../../core/geo-coords';
import { Arch } from './archetypes';

export type Palette = readonly (readonly [number, number])[];

export interface DistrictProfile {
  name: string;
  lat: number;
  lon: number;
  /** Radius (m) of the soft disc. */
  radius: number;
  /** Archetype weights for generic buildings (building=yes / apartments / residential). */
  arch: Partial<Record<Arch, number>>;
  /** Typical floor count range of generic buildings. */
  floors: [number, number];
  /** Chance that a street wall without a mapped POI still has shops. */
  shops: number;
  /** Chance of a pitched roof on a low-rise generic building. */
  pitched: number;
  /** Mean weathering 0..1. */
  wear: number;
  /** Balcony frequency factor (commercial cores ~0.3, residential quarters ~1). */
  balconies: number;
  /** Façade colour palette of stuccoed buildings. */
  palette: Palette;
}

/** Pera / Galata stucco: creams, ochres, salmon, Galata red, pistachio, pale blue, lilac grey. */
const PERA: Palette = [
  [0xe9dcc2, 6],
  [0xe6c996, 3],
  [0xdca78f, 3],
  [0xc57d63, 2],
  [0xcfd0b0, 2],
  [0xbfccd0, 1],
  [0xcdbfc4, 1],
  [0xd8b56a, 1],
  [0xf0ebe0, 2],
];
/** Post-war apartments: off-whites, beiges, pastel pinks and yellows, grey. */
const APARTMENT: Palette = [
  [0xefe7d6, 4],
  [0xe8d7b4, 3],
  [0xe7c4b3, 2],
  [0xefd89c, 2],
  [0xd5d3cd, 2],
  [0xc9d3d6, 1],
  [0xd6c6a4, 2],
  [0xe9c99a, 2],
  [0xd9a38f, 1],
  [0xc7d1b0, 1],
  [0xb9c7d6, 1],
  [0xd8c3cf, 1],
];
/** Karaköy / Eminönü: stone greys, sand, faded ochre and red. */
const HAN: Palette = [
  [0xd9cdb5, 4],
  [0xc9bda6, 3],
  [0xb9b1a3, 2],
  [0xd7b98b, 2],
  [0xc08a6c, 1],
  [0xe3dccd, 2],
];
/** Tophane / Kasımpaşa: tired, darker, more saturated leftovers. */
const TOPHANE: Palette = [
  [0xe4d6bb, 4],
  [0xd9b98a, 2],
  [0xc9947c, 2],
  [0xb86f58, 1],
  [0xc4c7b0, 2],
  [0xd4d0c8, 3],
  [0xe8c26f, 1],
];

/** Bosphorus villages and the islands: painted timber and stucco, whites, ochres, ox-blood, sage and grey-blue. */
const YALI: Palette = [
  [0xefe9dc, 5],
  [0xe8d3a6, 3],
  [0xb5654f, 2],
  [0xc9c2a2, 2],
  [0xbfc8c9, 2],
  [0xe2c8b0, 2],
  [0xd9b56e, 1],
  [0xa7b59a, 1],
];

/**
 * Profiles of the streamed regions (regions.ts). Each disc stays at least 2.2 radii from the Galata slice's build
 * rect (districtAt cuts weights there), so the slice's buildings draw exactly as before.
 */
const REGION_DISTRICTS: readonly DistrictProfile[] = [
  // Asian side: Kadıköy is mostly 6-8 storey 1960-80s apartment blocks around an older, lower çarşı.
  { name: 'Kadıköy çarşı', lat: 40.9905, lon: 29.0255, radius: 330, arch: { [Arch.Plain]: 0.5, [Arch.Modern]: 0.3, [Arch.Levantine]: 0.2 }, floors: [4, 6], shops: 0.85, pitched: 0.15, wear: 0.45, balconies: 0.7, palette: APARTMENT },
  { name: 'Kadıköy (Osmanağa, Rasimpaşa, Caferağa)', lat: 40.9875, lon: 29.0305, radius: 900, arch: { [Arch.Plain]: 0.62, [Arch.Modern]: 0.33, [Arch.Levantine]: 0.05 }, floors: [5, 8], shops: 0.35, pitched: 0.12, wear: 0.35, balconies: 1.2, palette: APARTMENT },
  { name: 'Moda', lat: 40.982, lon: 29.026, radius: 420, arch: { [Arch.Plain]: 0.6, [Arch.Levantine]: 0.2, [Arch.Modern]: 0.2 }, floors: [4, 7], shops: 0.3, pitched: 0.22, wear: 0.3, balconies: 1.1, palette: APARTMENT },
  { name: 'Haydarpaşa', lat: 40.9967, lon: 29.0192, radius: 260, arch: { [Arch.Modern]: 0.55, [Arch.Plain]: 0.35, [Arch.Civic]: 0.1 }, floors: [2, 4], shops: 0.15, pitched: 0.3, wear: 0.55, balconies: 0.4, palette: HAN },
  { name: 'Üsküdar', lat: 41.0255, lon: 29.015, radius: 650, arch: { [Arch.Plain]: 0.55, [Arch.Modern]: 0.25, [Arch.Wood]: 0.1, [Arch.Levantine]: 0.1 }, floors: [3, 6], shops: 0.55, pitched: 0.45, wear: 0.45, balconies: 1.0, palette: APARTMENT },
  { name: 'Beşiktaş', lat: 41.043, lon: 29.006, radius: 550, arch: { [Arch.Plain]: 0.55, [Arch.Modern]: 0.35, [Arch.Levantine]: 0.1 }, floors: [5, 8], shops: 0.55, pitched: 0.2, wear: 0.4, balconies: 1.0, palette: APARTMENT },
  // Bosphorus villages: two to four storey timber and stucco houses under pitched roofs.
  { name: 'Ortaköy', lat: 41.0474, lon: 29.0262, radius: 380, arch: { [Arch.Plain]: 0.45, [Arch.Wood]: 0.25, [Arch.Levantine]: 0.2, [Arch.Modern]: 0.1 }, floors: [2, 5], shops: 0.6, pitched: 0.6, wear: 0.35, balconies: 0.8, palette: YALI },
  { name: 'Arnavutköy / Bebek', lat: 41.072, lon: 29.0435, radius: 700, arch: { [Arch.Wood]: 0.35, [Arch.Plain]: 0.4, [Arch.Levantine]: 0.15, [Arch.Modern]: 0.1 }, floors: [2, 4], shops: 0.35, pitched: 0.7, wear: 0.3, balconies: 0.8, palette: YALI },
  { name: 'Rumeli Hisarı / Emirgan', lat: 41.095, lon: 29.056, radius: 900, arch: { [Arch.Wood]: 0.35, [Arch.Plain]: 0.4, [Arch.Modern]: 0.15, [Arch.Levantine]: 0.1 }, floors: [2, 4], shops: 0.25, pitched: 0.7, wear: 0.3, balconies: 0.8, palette: YALI },
  { name: 'Anadolu Hisarı / Kanlıca / Çengelköy', lat: 41.075, lon: 29.063, radius: 1100, arch: { [Arch.Wood]: 0.4, [Arch.Plain]: 0.4, [Arch.Modern]: 0.1, [Arch.Levantine]: 0.1 }, floors: [2, 4], shops: 0.25, pitched: 0.75, wear: 0.35, balconies: 0.8, palette: YALI },
  { name: 'Kuzguncuk / Beylerbeyi', lat: 41.04, lon: 29.037, radius: 600, arch: { [Arch.Wood]: 0.35, [Arch.Plain]: 0.45, [Arch.Levantine]: 0.1, [Arch.Modern]: 0.1 }, floors: [2, 4], shops: 0.3, pitched: 0.7, wear: 0.35, balconies: 0.9, palette: YALI },
  // Historic peninsula and the Golden Horn outside the slice.
  { name: 'Sultanahmet / Cankurtaran', lat: 41.0045, lon: 28.9775, radius: 420, arch: { [Arch.Plain]: 0.45, [Arch.Wood]: 0.2, [Arch.Levantine]: 0.2, [Arch.Modern]: 0.15 }, floors: [3, 5], shops: 0.5, pitched: 0.5, wear: 0.4, balconies: 0.7, palette: PERA },
  { name: 'Kumkapı / Aksaray', lat: 41.0033, lon: 28.9645, radius: 520, arch: { [Arch.Plain]: 0.6, [Arch.Modern]: 0.25, [Arch.Levantine]: 0.1, [Arch.Wood]: 0.05 }, floors: [4, 6], shops: 0.6, pitched: 0.25, wear: 0.55, balconies: 0.9, palette: TOPHANE },
  { name: 'Balat / Fener', lat: 41.0303, lon: 28.9478, radius: 550, arch: { [Arch.Plain]: 0.45, [Arch.Levantine]: 0.25, [Arch.Wood]: 0.2, [Arch.Modern]: 0.1 }, floors: [3, 5], shops: 0.4, pitched: 0.5, wear: 0.6, balconies: 1.0, palette: PERA },
  { name: 'Eyüp', lat: 41.0475, lon: 28.9337, radius: 700, arch: { [Arch.Plain]: 0.6, [Arch.Modern]: 0.25, [Arch.Wood]: 0.15 }, floors: [3, 6], shops: 0.4, pitched: 0.4, wear: 0.45, balconies: 1.0, palette: APARTMENT },
  // Princes' Islands: timber mansions in gardens.
  { name: 'Adalar', lat: 40.8765, lon: 29.115, radius: 1600, arch: { [Arch.Wood]: 0.6, [Arch.Levantine]: 0.2, [Arch.Plain]: 0.2 }, floors: [2, 3], shops: 0.2, pitched: 0.85, wear: 0.35, balconies: 0.7, palette: YALI },
];

export const DISTRICTS: readonly DistrictProfile[] = [
  { name: 'Eminönü / Tahtakale', lat: 41.0168, lon: 28.9695, radius: 420, arch: { [Arch.Han]: 0.45, [Arch.Plain]: 0.3, [Arch.Modern]: 0.15, [Arch.Levantine]: 0.1 }, floors: [3, 6], shops: 0.9, pitched: 0.18, wear: 0.65, balconies: 0.3, palette: HAN },
  { name: 'Sirkeci', lat: 41.0152, lon: 28.9765, radius: 300, arch: { [Arch.Levantine]: 0.4, [Arch.Han]: 0.3, [Arch.Plain]: 0.2, [Arch.Modern]: 0.1 }, floors: [4, 6], shops: 0.75, pitched: 0.2, wear: 0.5, balconies: 0.5, palette: HAN },
  { name: 'Karaköy', lat: 41.0226, lon: 28.9752, radius: 330, arch: { [Arch.Han]: 0.5, [Arch.Levantine]: 0.22, [Arch.Plain]: 0.18, [Arch.Modern]: 0.1 }, floors: [4, 7], shops: 0.9, pitched: 0.2, wear: 0.55, balconies: 0.45, palette: HAN },
  { name: 'Bankalar / Voyvoda', lat: 41.0238, lon: 28.9738, radius: 140, arch: { [Arch.Levantine]: 0.65, [Arch.Han]: 0.25, [Arch.Modern]: 0.1 }, floors: [5, 6], shops: 0.5, pitched: 0.15, wear: 0.4, balconies: 0.5, palette: HAN },
  { name: 'Galata', lat: 41.0262, lon: 28.9745, radius: 280, arch: { [Arch.Levantine]: 0.62, [Arch.Plain]: 0.26, [Arch.Wood]: 0.04, [Arch.Modern]: 0.08 }, floors: [4, 6], shops: 0.65, pitched: 0.35, wear: 0.45, balconies: 0.9, palette: PERA },
  { name: 'Pera / İstiklal', lat: 41.0318, lon: 28.9768, radius: 430, arch: { [Arch.Levantine]: 0.58, [Arch.Plain]: 0.25, [Arch.Modern]: 0.17 }, floors: [5, 7], shops: 0.75, pitched: 0.3, wear: 0.4, balconies: 0.85, palette: PERA },
  { name: 'Cihangir', lat: 41.0315, lon: 28.9838, radius: 330, arch: { [Arch.Plain]: 0.58, [Arch.Levantine]: 0.22, [Arch.Wood]: 0.08, [Arch.Modern]: 0.12 }, floors: [5, 8], shops: 0.3, pitched: 0.45, wear: 0.3, balconies: 1.1, palette: APARTMENT },
  { name: 'Tophane / Firuzağa', lat: 41.0277, lon: 28.9800, radius: 280, arch: { [Arch.Plain]: 0.45, [Arch.Wood]: 0.18, [Arch.Levantine]: 0.22, [Arch.Modern]: 0.15 }, floors: [3, 5], shops: 0.45, pitched: 0.55, wear: 0.65, balconies: 1.0, palette: TOPHANE },
  { name: 'Kasımpaşa / Şişhane', lat: 41.0305, lon: 28.9675, radius: 480, arch: { [Arch.Plain]: 0.6, [Arch.Modern]: 0.2, [Arch.Wood]: 0.1, [Arch.Levantine]: 0.1 }, floors: [3, 6], shops: 0.4, pitched: 0.5, wear: 0.55, balconies: 1.0, palette: TOPHANE },
  { name: 'Galataport / Salıpazarı', lat: 41.0262, lon: 28.9828, radius: 190, arch: { [Arch.Modern]: 0.7, [Arch.Han]: 0.3 }, floors: [2, 4], shops: 0.6, pitched: 0.1, wear: 0.15, balconies: 0.2, palette: HAN },
  { name: 'Gümüşsuyu / Taksim', lat: 41.0362, lon: 28.9868, radius: 380, arch: { [Arch.Modern]: 0.4, [Arch.Plain]: 0.42, [Arch.Levantine]: 0.18 }, floors: [6, 9], shops: 0.4, pitched: 0.2, wear: 0.3, balconies: 0.9, palette: APARTMENT },
  ...REGION_DISTRICTS,
];

const FALLBACK: DistrictProfile = { name: 'default', lat: 0, lon: 0, radius: 1, arch: { [Arch.Plain]: 0.6, [Arch.Levantine]: 0.2, [Arch.Modern]: 0.2 }, floors: [3, 6], shops: 0.4, pitched: 0.4, wear: 0.45, balconies: 1.0, palette: APARTMENT };

interface LocalProfile {
  p: DistrictProfile;
  x: number;
  z: number;
}

const LOCAL: LocalProfile[] = DISTRICTS.map((p) => ({ p, ...latLonToLocal(p.lat, p.lon) }));

/** Profile at (x, z) for the uniform draw `h` in [0, 1). */
export function districtAt(x: number, z: number, h: number): DistrictProfile {
  let total = 0;
  const w: number[] = [];
  for (const l of LOCAL) {
    const d = Math.hypot(x - l.x, z - l.z) / l.p.radius;
    const v = d < 2.2 ? Math.exp(-d * d) : 0;
    w.push(v);
    total += v;
  }
  if (total < 0.02) {
    return FALLBACK;
  }
  let t = h * total;
  for (let i = 0; i < LOCAL.length; i++) {
    t -= w[i];
    if (t <= 0) {
      return LOCAL[i].p;
    }
  }
  return LOCAL[LOCAL.length - 1].p;
}

/** Weighted pick from a {key: weight} table. */
export function pickWeighted<K extends number>(table: Partial<Record<K, number>>, h: number): K {
  const entries = Object.entries(table) as [string, number][];
  const total = entries.reduce((s, e) => s + e[1], 0);
  let t = h * total;
  for (const [k, v] of entries) {
    t -= v;
    if (t <= 0) {
      return Number(k) as K;
    }
  }
  return Number(entries[0][0]) as K;
}

/** Weighted colour pick from a palette. */
export function pickColour(p: Palette, h: number): number {
  const total = p.reduce((s, e) => s + e[1], 0);
  let t = h * total;
  for (const [hex, w] of p) {
    t -= w;
    if (t <= 0) {
      return hex;
    }
  }
  return p[0][0];
}
