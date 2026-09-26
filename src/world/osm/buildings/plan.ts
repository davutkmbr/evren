/**
 * Building plan: everything the generators need about one building, derived deterministically from its OSM tags,
 * its footprint and its neighbourhood profile (districts.ts). Tags always win over heuristics; the heuristics only
 * fill what OSM leaves open (most Beyoğlu buildings carry nothing but building=yes).
 */
import * as THREE from 'three';
import type { OsmBuilding } from '../data';
import { hash } from '../shared/geometry';
import { Arch, ARCHETYPES, Balcony, Head, Layer } from './archetypes';
import { districtAt, type DistrictProfile, pickColour, pickWeighted } from './districts';
import { osmColour } from '../shared/colour';

export type RoofShape = 'flat' | 'hipped' | 'gabled' | 'pyramidal' | 'skillion' | 'dome' | 'domes';
/** Roof covering (roof material: tiles / lead / metal; flat roofs: slab finishes, see materials.ts). */
export const RoofCover = { Tiles: 0, Lead: 1, Metal: 2, Slate: 3 } as const;
export type RoofCover = (typeof RoofCover)[keyof typeof RoofCover];
/** Flat roof finish (Kind.Slab surfaces). */
export const SlabFinish = { Membrane: 0, Terrace: 1, Concrete: 2, Gravel: 3 } as const;
export type SlabFinish = (typeof SlabFinish)[keyof typeof SlabFinish];

export type CorniceStyle = 'none' | 'slab' | 'classic' | 'heavy';

/** Cornice profiles (bottom-up bands of [height, projection], m) drawn by massing.ts mouldings(). */
export const CORNICE_PROFILES: Record<CorniceStyle, readonly (readonly [number, number])[]> = {
  none: [],
  heavy: [
    [0.42, 0.05],
    [0.14, 0.16],
    [0.26, 0.55],
    [0.09, 0.62],
  ],
  classic: [
    [0.3, 0.04],
    [0.2, 0.34],
    [0.08, 0.4],
  ],
  slab: [[0.2, 0.3]],
};

export function corniceHeight(style: CorniceStyle): number {
  return CORNICE_PROFILES[style].reduce((s, b) => s + b[0], 0);
}

/**
 * Bottom of the cornice below the wall top (m): under a pitched roof the cornice sits just under the eave, on flat
 * roofs it crowns the wall below the parapet.
 */
export function corniceDrop(p: Pick<BuildingPlan, 'roof' | 'parapet' | 'cornice'>): number {
  const total = corniceHeight(p.cornice);
  const pitched = p.roof !== 'flat' && p.roof !== 'domes';
  return pitched ? Math.max(0.2 + total, 0.55) : total > 0 ? p.parapet - 0.2 + total : p.parapet + 0.1;
}

/** BuildingPlan.clearance for a style (recompute after changing the roof, parapet or cornice). */
export function clearanceOf(p: Pick<BuildingPlan, 'arch' | 'head' | 'roof' | 'parapet' | 'cornice'>): number {
  const crown = p.head === Head.Pediment ? 0.8 : p.arch === Arch.Levantine && p.head === Head.Cap ? 0.5 : ARCHETYPES[p.arch].crown;
  return corniceDrop(p) + crown + 0.12;
}

export interface BuildingPlan {
  arch: Arch;
  head: Head;
  wall: Layer;
  plinth: Layer;
  /** Linear wall tint and trim (cornice, sills, surrounds) tint. */
  tint: THREE.Color;
  trim: THREE.Color;
  floors: number;
  floorH: number;
  /** Height of the wall top above the reference ground (m). */
  wallH: number;
  /** Height of the bottom above the reference ground (building:part min_height), 0 for whole buildings. */
  minH: number;
  roof: RoofShape;
  roofCover: RoofCover;
  roofTint: THREE.Color;
  /** Roof pitch (tan). */
  pitch: number;
  slab: SlabFinish;
  /** Parapet height above the flat roof slab (m). */
  parapet: number;
  wear: number;
  shutters: boolean;
  roller: boolean;
  office: boolean;
  plinthOn: boolean;
  banded: boolean;
  clapboard: boolean;
  balcony: Balcony;
  /** Bay windows: 'cumba' (timber / stone oriel on one bay) or 'cikma' (post-war projecting upper floors). */
  bay: 'none' | 'cumba' | 'cikma';
  cornice: CorniceStyle;
  courses: boolean;
  /**
   * Wall height kept free above the top floor's window heads (m): window crown plus the cornice / eave / parapet
   * zone. The top floor row that still fits under it is the last windowed row (archetypes.ts topWindowRow).
   */
  clearance: number;
  minaret: boolean;
  shopRate: number;
  district: DistrictProfile;
  /** Stable per-building random seed in [0, 1). */
  seed: number;
}

export interface FootprintInfo {
  area: number;
  cx: number;
  cz: number;
  /** Area / convex hull area. */
  convexity: number;
  vertices: number;
  /** Half extents of the minimum-area rectangle. */
  hl: number;
  hw: number;
  rectangular: boolean;
}

const RESIDENTIAL = new Set(['yes', 'apartments', 'residential', 'house', 'detached', 'terrace', 'semidetached_house', 'dormitory']);
const CIVIC_KINDS = new Set(['church', 'cathedral', 'chapel', 'synagogue', 'school', 'university', 'college', 'public', 'government', 'civic', 'hospital', 'townhall', 'train_station', 'museum', 'spiritual', 'temple']);
const COMMERCIAL = new Set(['commercial', 'retail', 'office', 'hotel', 'industrial', 'warehouse', 'hangar', 'supermarket']);
const SMALL = new Set(['kiosk', 'shed', 'garage', 'garages', 'hut', 'container', 'guardhouse', 'service', 'toilets', 'cabin', 'kafe', 'restaurant']);
const MODERN_KINDS = new Set(['stadium', 'parking', 'transportation', 'hospital', 'hangar', 'support_tower']);

const WOOD_PALETTE = [
  [0xc9a36b, 3],
  [0xa39a8c, 3],
  [0x7a5a40, 2],
  [0x94503f, 2],
  [0xb3bd9d, 1],
  [0xe3ddd0, 2],
  [0xd2b98a, 2],
] as const;
const MODERN_PALETTE = [
  [0xeeebe4, 4],
  [0xd9d6cf, 3],
  [0xc4c0b8, 2],
  [0xe6dcc6, 2],
  [0xb9c0c4, 1],
  [0xdcc1ae, 1],
] as const;
const STONE_TINTS = [
  [0xf1ebdf, 3],
  [0xe6ddcd, 3],
  [0xe3d4b8, 3],
  [0xd4cdc2, 2],
  [0xd6c3a2, 2],
  [0xc2bbb0, 2],
  [0xb3aca2, 1],
] as const;
const ROOF_TINTS = [
  [0xffffff, 6],
  [0xf2d9c8, 3],
  [0xd9c2b5, 2],
  [0xb89f94, 2],
  [0xffe3cf, 2],
] as const;

const TAG_ROOFS: Record<string, RoofShape> = {
  flat: 'flat',
  gabled: 'gabled',
  gambrel: 'gabled',
  saltbox: 'gabled',
  hipped: 'hipped',
  'half-hipped': 'hipped',
  mansard: 'hipped',
  pyramidal: 'pyramidal',
  skillion: 'skillion',
  lean_to: 'skillion',
  dome: 'dome',
  onion: 'dome',
  round: 'dome',
};

function linear(hex: number, out = new THREE.Color()): THREE.Color {
  return out.setHex(hex, THREE.SRGBColorSpace);
}

function isMosque(b: OsmBuilding): boolean {
  const n = b.name?.toLocaleLowerCase('tr') ?? '';
  return b.kind === 'mosque' || (b.amenity === 'place_of_worship' && (b.religion === 'muslim' || /cami|mescid/.test(n))) || /\bcami|mescidi?\b/.test(n);
}

function isHamam(b: OsmBuilding): boolean {
  return b.amenity === 'public_bath' || /hamam/i.test(b.name ?? '');
}

/** Covered bazaars and bedestens: rows of small lead domes. */
export function isBazaar(b: OsmBuilding): boolean {
  return /bedesten|mısır çarşısı|kapalı ?çarşı/i.test(b.name ?? '');
}

function isTomb(b: OsmBuilding): boolean {
  return b.historic === 'tomb' || /türbe/i.test(b.name ?? '');
}

/** Archetype from tags and name, or null for "use the neighbourhood profile". */
function taggedArch(b: OsmBuilding, kind: string, h: number): Arch | null {
  const n = b.name ?? '';
  if (isMosque(b) || isHamam(b) || isTomb(b)) {
    return Arch.Mosque;
  }
  if (b.material === 'wood') {
    return Arch.Wood;
  }
  if (CIVIC_KINDS.has(kind) || /kilise|sinagog|konsolos|sarayı|lisesi|postane|müzesi|bankası/i.test(n)) {
    return Arch.Civic;
  }
  if (/\bhanı?\b|işhanı|pasajı|bedesten|çarşısı|antrepo/i.test(n)) {
    return Arch.Han;
  }
  if (/apartmanı|\bapt\b|palas/i.test(n)) {
    return Arch.Levantine;
  }
  if (MODERN_KINDS.has(kind) || b.material === 'glass' || b.material === 'concrete') {
    return Arch.Modern;
  }
  if (kind === 'hotel') {
    return h < 0.4 ? Arch.Levantine : Arch.Modern;
  }
  if (kind === 'office' || kind === 'commercial' || kind === 'retail') {
    return null;
  }
  if (kind === 'industrial' || kind === 'warehouse') {
    return h < 0.6 ? Arch.Han : Arch.Modern;
  }
  return null;
}

/**
 * Plans one building. `f` describes its footprint; `seedId` is the OSM id (or a synthetic id for infill), which
 * keeps colours stable across data refetches.
 */
export function planBuilding(b: OsmBuilding, f: FootprintInfo, seedId: number): BuildingPlan {
  const seed = hash((Math.abs(seedId) % 1_000_003) * 0.618 + 0.37);
  const H = (k: number): number => hash(seed * 97.13 + k * 13.37);
  const kind = b.kind === 'yes' && (b.amenity === 'restaurant' || b.amenity === 'cafe' || b.shop) ? 'commercial' : b.kind;
  const district = districtAt(f.cx, f.cz, H(1));

  let arch = taggedArch(b, kind, H(2));
  if (arch === null) {
    const weights = { ...district.arch };
    if (COMMERCIAL.has(kind)) {
      weights[Arch.Modern] = (weights[Arch.Modern] ?? 0) + 0.25;
      weights[Arch.Wood] = 0;
    }
    if (kind === 'house' || kind === 'detached') {
      weights[Arch.Wood] = (weights[Arch.Wood] ?? 0) + 0.3;
    }
    if (f.area > 900) {
      weights[Arch.Wood] = 0;
      weights[Arch.Modern] = (weights[Arch.Modern] ?? 0) + 0.4;
    }
    if (f.area < 60) {
      weights[Arch.Modern] = (weights[Arch.Modern] ?? 0) * 0.3;
    }
    arch = pickWeighted<Arch>(weights, H(3));
  }
  const small = SMALL.has(kind) || f.area < 14;
  const def = ARCHETYPES[arch];
  const floorH = def.floorH[0] + (def.floorH[1] - def.floorH[0]) * H(4);

  // Floors: tags first, then archetype / district heuristics with neighbour-to-neighbour variety.
  let floors = b.levels ?? 0;
  if (!floors && b.height) {
    floors = Math.max(1, Math.round((b.height - (b.roofHeight ?? 0)) / floorH));
  }
  if (!floors) {
    const [lo, hi] = district.floors;
    const t = H(5);
    // Estimated from tagged neighbours (regions, data.ts levelsFill): that storey count ±1, else the district range.
    floors = b.levelsFill ? b.levelsFill + (t < 0.2 ? -1 : t > 0.85 ? 1 : 0) : lo + Math.floor(Math.pow(t, 0.85) * (hi - lo + 1));
    if (f.area < 25) {
      floors -= 2;
    } else if (f.area < 45) {
      floors -= 1;
    } else if (f.area > 320) {
      floors += 1;
    }
    // Neighbour-to-neighbour variety: post-war blocks replaced single plots with taller buildings.
    if (H(6) < 0.12) {
      floors += arch === Arch.Plain || arch === Arch.Modern ? 2 : 1;
    } else if (H(6) > 0.9) {
      floors -= 1;
    }
    if (arch === Arch.Wood) {
      floors = Math.min(floors, 2 + Math.floor(H(7) * 3));
    } else if (arch === Arch.Levantine) {
      floors = Math.min(floors, 7);
    } else if (arch === Arch.Han) {
      floors = Math.min(floors, 6);
    } else if (arch === Arch.Civic) {
      floors = Math.max(2, Math.min(floors - 1, 5));
    } else if (arch === Arch.Mosque) {
      floors = isTomb(b) ? 1 : 2;
    } else if (arch === Arch.Modern && COMMERCIAL.has(kind)) {
      floors += 1;
    }
    if (small) {
      floors = 1;
    }
    floors = Math.max(1, Math.min(floors, 12));
  }
  const minLevel = b.minLevel ?? 0;
  const minH = b.minHeight ?? minLevel * floorH;

  // Roof.
  const tagRoof = b.roofShape ? TAG_ROOFS[b.roofShape] : undefined;
  let roof: RoofShape;
  const compact = f.convexity > 0.88 && f.vertices <= 12;
  if (tagRoof) {
    roof = tagRoof;
  } else if (isBazaar(b)) {
    roof = 'domes';
  } else if (arch === Arch.Mosque) {
    // Mahalle mescids have hipped roofs; only the larger mosques carry a lead dome.
    roof = isHamam(b) ? 'domes' : f.area > 300 && f.area < 1600 && f.hl < f.hw * 1.8 ? 'dome' : 'hipped';
  } else if (small) {
    roof = H(8) < 0.3 && f.rectangular ? 'skillion' : 'flat';
  } else if (arch === Arch.Modern) {
    roof = 'flat';
  } else if (arch === Arch.Civic) {
    roof = f.area < 1400 && compact ? (b.kind === 'church' || /kilise/i.test(b.name ?? '') ? 'gabled' : 'hipped') : 'flat';
  } else {
    const rate = arch === Arch.Wood ? 0.95 : arch === Arch.Han ? district.pitched * 0.8 : arch === Arch.Levantine ? district.pitched * 1.1 : district.pitched;
    const fits = compact && f.area < (arch === Arch.Han ? 1200 : 700) && floors <= 8;
    roof = fits && H(9) < rate ? (f.rectangular && f.area < 220 && (arch === Arch.Wood ? H(10) < 0.35 : H(10) < 0.15) ? 'gabled' : f.rectangular && f.hl < f.hw * 1.15 && f.area < 180 ? 'pyramidal' : 'hipped') : 'flat';
  }
  if (roof !== 'flat' && roof !== 'dome' && roof !== 'domes' && !compact && !tagRoof) {
    roof = 'flat';
  }
  const pitched = roof !== 'flat' && roof !== 'domes';
  let roofCover: RoofCover = arch === Arch.Mosque && (roof !== 'hipped' || H(32) < 0.4) ? RoofCover.Lead : RoofCover.Tiles;
  if (b.roofMaterial === 'metal' || b.roofMaterial === 'copper' || b.roofMaterial === 'tin') {
    roofCover = RoofCover.Metal;
  } else if (b.roofMaterial === 'lead') {
    roofCover = RoofCover.Lead;
  } else if (b.roofMaterial === 'slate' || b.roofMaterial === 'eternit') {
    roofCover = RoofCover.Slate;
  } else if (roof === 'dome') {
    roofCover = RoofCover.Lead;
  }
  const roofTint = osmColour(b.roofColour) ?? linear(pickColour(ROOF_TINTS, H(11)));
  if (!b.roofColour && roofCover === RoofCover.Tiles && H(12) < 0.06) {
    roofCover = RoofCover.Slate;
  }
  const pitch = Math.tan(((arch === Arch.Han ? 20 : arch === Arch.Wood ? 27 : 24) + 8 * H(13)) * (Math.PI / 180));

  // Materials and colours.
  let wall: Layer;
  let plinth: Layer;
  const tint = new THREE.Color();
  const h14 = H(14);
  switch (arch) {
    case Arch.Levantine:
      wall = h14 < 0.28 ? Layer.Stone : h14 < 0.62 ? Layer.Plaster : Layer.Painted;
      plinth = Layer.Stone;
      break;
    case Arch.Han:
      wall = h14 < 0.32 ? Layer.Stone : h14 < 0.58 ? Layer.Plaster : h14 < 0.8 ? Layer.Painted : Layer.Brick;
      plinth = Layer.Stone;
      break;
    case Arch.Civic:
    case Arch.Mosque:
      wall = h14 < 0.72 ? Layer.Stone : Layer.Plaster;
      plinth = Layer.Stone;
      break;
    case Arch.Wood:
      wall = Layer.Painted;
      plinth = Layer.Stone;
      break;
    case Arch.Modern:
      wall = h14 < 0.45 ? Layer.Concrete : Layer.Painted;
      plinth = h14 < 0.7 ? Layer.Stone : Layer.Concrete;
      break;
    default:
      wall = h14 < 0.5 ? Layer.Plaster : Layer.Painted;
      plinth = h14 < 0.3 ? Layer.Stone : wall;
  }
  if (b.material === 'stone' || b.material === 'sandstone' || b.material === 'limestone') {
    wall = Layer.Stone;
  } else if (b.material === 'brick') {
    wall = Layer.Brick;
  } else if (b.material === 'plaster' || b.material === 'stucco') {
    wall = h14 < 0.5 ? Layer.Plaster : Layer.Painted;
  } else if (b.material === 'concrete') {
    wall = Layer.Concrete;
  }
  const tagged = osmColour(b.colour);
  if (tagged) {
    tint.copy(tagged);
  } else if (wall === Layer.Stone) {
    linear(pickColour(STONE_TINTS, H(15)), tint);
  } else if (wall === Layer.Brick) {
    tint.setRGB(0.95 + 0.1 * H(15), 0.92 + 0.08 * H(16), 0.9 + 0.08 * H(15));
  } else if (arch === Arch.Wood) {
    linear(pickColour(WOOD_PALETTE, H(15)), tint);
  } else if (arch === Arch.Modern) {
    linear(pickColour(MODERN_PALETTE, H(15)), tint);
  } else {
    linear(pickColour(district.palette, H(15)), tint);
  }
  if (!tagged && wall !== Layer.Brick) {
    tint.multiplyScalar(0.9 + 0.12 * H(17));
  }
  const trim = new THREE.Color();
  if (wall === Layer.Stone || arch === Arch.Modern) {
    trim.copy(tint).multiplyScalar(1.04);
  } else {
    // Stucco trims are painted white / cream or a lighter shade of the wall.
    trim.copy(tint).lerp(linear(H(18) < 0.5 ? 0xf1ece2 : 0xe4d9c4), 0.55 + 0.3 * H(19));
  }

  const head: Head = arch === Arch.Levantine ? ([Head.Cap, Head.Cap, Head.Pediment, Head.Segmental, Head.Round] as const)[Math.floor(H(20) * 5)] : arch === Arch.Han ? Head.Segmental : arch === Arch.Civic || arch === Arch.Mosque ? Head.Round : Head.Cap;

  let balcony: Balcony = Balcony.None;
  const hb = H(21) / Math.max(0.05, district.balconies);
  if (arch === Arch.Levantine) {
    balcony = hb < 0.4 ? Balcony.Centre : hb < 0.5 ? Balcony.Nobile : hb < 0.62 ? Balcony.Ends : Balcony.None;
  } else if (arch === Arch.Plain && !COMMERCIAL.has(kind)) {
    balcony = hb < 0.22 ? Balcony.All : hb < 0.42 ? Balcony.Alternate : hb < 0.52 ? Balcony.Centre : Balcony.None;
  } else if (arch === Arch.Modern && !COMMERCIAL.has(kind)) {
    balcony = hb < 0.45 ? Balcony.All : hb < 0.6 ? Balcony.Alternate : Balcony.None;
  }
  if (floors < 3 || small) {
    balcony = Balcony.None;
  }

  let bay: BuildingPlan['bay'] = 'none';
  const hby = H(22);
  if (arch === Arch.Wood && floors >= 2) {
    bay = hby < 0.75 ? 'cumba' : 'none';
  } else if (arch === Arch.Levantine && floors >= 4) {
    bay = hby < 0.2 ? 'cumba' : 'none';
  } else if (arch === Arch.Plain && floors >= 4 && roof === 'flat') {
    bay = hby < 0.4 ? 'cikma' : hby < 0.5 ? 'cumba' : 'none';
  }

  const office = COMMERCIAL.has(kind) && kind !== 'hotel' ? H(23) < 0.8 : arch === Arch.Han ? H(23) < 0.6 : false;
  const wear = Math.min(1, Math.max(0, district.wear + (H(24) - 0.5) * 0.6 - (arch === Arch.Modern ? 0.2 : 0) - (tagged ? 0.1 : 0)));
  const cornice: CorniceStyle = arch === Arch.Levantine || arch === Arch.Civic ? (H(25) < 0.5 ? 'heavy' : 'classic') : arch === Arch.Han ? 'classic' : arch === Arch.Plain ? (H(25) < 0.45 ? 'slab' : 'none') : arch === Arch.Modern ? (H(25) < 0.3 ? 'slab' : 'none') : 'none';

  const parapet = roof === 'flat' ? (arch === Arch.Levantine || arch === Arch.Civic ? 1.1 : 0.9) : roof === 'domes' ? 0.3 : 0;
  const clearance = clearanceOf({ arch, head, roof, parapet, cornice });

  return {
    arch,
    head,
    wall,
    plinth,
    tint,
    trim,
    floors,
    floorH,
    wallH: 0,
    minH,
    roof,
    roofCover,
    roofTint,
    pitch,
    slab: pickWeighted<number>({ 0: 0.35, 1: 0.3, 2: 0.25, 3: 0.1 }, H(26)) as SlabFinish,
    parapet,
    wear,
    shutters: arch === Arch.Wood ? H(27) < 0.7 : arch === Arch.Levantine ? H(27) < 0.3 : arch === Arch.Plain ? H(27) < 0.1 : false,
    roller: arch === Arch.Plain ? H(28) < 0.5 : arch === Arch.Modern ? H(28) < 0.35 : false,
    office,
    plinthOn: arch === Arch.Levantine ? H(29) < 0.7 : arch === Arch.Han || arch === Arch.Civic ? H(29) < 0.6 : arch === Arch.Modern ? H(29) < 0.3 : arch === Arch.Wood ? H(29) < 0.65 : false,
    banded: arch === Arch.Han && wall === Layer.Stone && H(30) < 0.3,
    clapboard: arch === Arch.Wood,
    balcony,
    bay,
    cornice,
    clearance,
    courses: arch === Arch.Levantine || arch === Arch.Civic || (arch === Arch.Han && H(31) < 0.6) || (arch === Arch.Plain && H(31) < 0.25),
    minaret: arch === Arch.Mosque && isMosque(b) && !isTomb(b) && f.area > 60,
    shopRate: small ? 0 : district.shops,
    district,
    seed,
  };
}

/**
 * Wall height (m above the reference ground) of a plan, honouring height / roof:height tags. Untagged walls are tall
 * enough for every floor to carry windows under the cornice / parapet zone (plan.clearance).
 */
export function wallHeight(b: OsmBuilding, p: BuildingPlan, roofRise: number): number {
  if (b.height) {
    const roofH = b.roofHeight ?? (p.roof === 'flat' ? 0 : roofRise);
    return Math.max(p.minH + 2.5, b.height - roofH);
  }
  const head = Math.min(ARCHETYPES[p.arch].head, p.floorH - 0.35);
  const base = p.floors * p.floorH + (p.roof === 'flat' ? p.parapet + 0.25 : 0.3);
  return Math.max(p.minH + 2.5, base, p.minH + (p.floors - 1) * p.floorH + head + p.clearance + 0.05);
}
