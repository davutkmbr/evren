/**
 * Building records and the archetypes that turn a lot into an Istanbul building: apartman blocks, 19th-century
 * stone apartments, timber houses with cumba, yalıs, villas, glass towers, mass housing slabs and industrial halls.
 */
import { Kind, RoofTop, Style, Usage, WinType, type DistrictMsg, type StyleId } from '../protocol';
import type { GeoSampler } from './geo-sampler';
import { LU } from './geo-sampler';
import {
  APARTMENT_WALLS,
  GLASS_TINTS,
  HISTORIC_WOOD_WALLS,
  INDUSTRIAL_ROOFS,
  INDUSTRIAL_WALLS,
  MASS_ACCENTS,
  MASS_WALLS,
  OFFICE_WALLS,
  OLD_APARTMENT_WALLS,
  ROOF_FLATS,
  ROOF_TILES,
  VILLA_WALLS,
  YALI_WALLS,
  jitterColor,
  type Palette,
} from './palettes';
import { Rng } from './rng';

export const BType = {
  Apartment: 0,
  OldApartment: 1,
  HistoricHouse: 2,
  Yali: 3,
  Villa: 4,
  Tower: 5,
  Office: 6,
  Mass: 7,
  Industrial: 8,
  Podium: 9,
  House: 10,
} as const;

export const Roof = {
  Flat: 0,
  Hip: 1,
  Gable: 2,
  Sawtooth: 3,
} as const;

export const BF = {
  Shop: 1,
  Balcony: 2,
  BalconyGlazed: 4,
  Cikma: 8,
  Cumba: 16,
  Parapet: 32,
  Penthouse: 64,
  Party1: 128,
  Party3: 256,
  Old: 512,
  Tanks: 1024,
  Solar: 2048,
  Awning: 4096,
  Chimney: 8192,
  BackBalcony: 16384,
  Party2: 32768,
  Setback: 65536,
  Crown: 131072,
  Beacon: 262144,
  Accent: 524288,
} as const;

/** Typology of a block (how lots are cut) - chosen per block from district style and land use. */
export const Typ = {
  RowHistoric: 0,
  RowDense: 1,
  Detached: 2,
  Mass: 3,
  Tower: 4,
  Villa: 5,
  Suburb: 6,
  Industrial: 7,
  Yali: 8,
} as const;
export type TypId = (typeof Typ)[keyof typeof Typ];

export interface BuildingRec {
  x: number;
  z: number;
  /** Local +x axis = (cos a, sin a); the front facade faces local -z. */
  a: number;
  w: number;
  d: number;
  baseY: number;
  groundY: number;
  type: number;
  floors: number;
  floorH: number;
  gfH: number;
  /** Eave / roof slab height above groundY. */
  height: number;
  roof: number;
  pitch: number;
  overhang: number;
  wallKind: number;
  wallColor: number;
  roofColor: number;
  accentColor: number;
  winType: number;
  sx: number;
  usage: number;
  flags: number;
  seed: number;
  rnd: number;
  keep: number;
  importance: number;
}

export interface LotInput {
  x: number;
  z: number;
  a: number;
  w: number;
  d: number;
  typ: TypId;
  style: StyleId;
  district: DistrictMsg | null;
  party1: boolean;
  party3: boolean;
  party2: boolean;
  /** Distance (m) to the nearest major road (shops, extra floors). */
  roadDist: number;
  /** Distance from the city core (m) - mass housing and density falloff. */
  coreDist: number;
  seed: number;
  /** Floors offset shared by the whole block (buildings of one block were built to the same zoning height). */
  blockBias?: number;
  /** Extra floors granted along main roads (shared by the block). */
  roadBonus?: number;
}

const ORIENT_EPS = 0.35;

function pick(rng: Rng, p: Palette): number {
  return rng.weighted(p);
}

/** Terrain sampled under the footprint. Returns null when the lot cannot hold a building. */
function siteHeights(geo: GeoSampler, x: number, z: number, a: number, w: number, d: number, setback: number, strict: boolean): [number, number] | null {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  let minH = Infinity;
  let maxH = -Infinity;
  const hw = w * 0.5 - ORIENT_EPS;
  const hd = d * 0.5 - ORIENT_EPS;
  const n = strict ? 3 : 2;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const lx = n === 2 ? (ix === 0 ? -hw : hw) : -hw + (hw * 2 * ix) / (n - 1);
      const lz = n === 2 ? (iz === 0 ? -hd : hd) : -hd + (hd * 2 * iz) / (n - 1);
      const px = x + lx * ca - lz * sa;
      const pz = z + lx * sa + lz * ca;
      if (!geo.buildable(px, pz, setback)) {
        return null;
      }
      const h = geo.height(px, pz);
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
    }
  }
  if (!geo.buildable(x, z, setback)) {
    return null;
  }
  const hc = geo.height(x, z);
  minH = Math.min(minH, hc);
  maxH = Math.max(maxH, hc);
  if (minH < 0.3) {
    return null;
  }
  return [minH, maxH];
}

let blockBias = 0;

/** Floors around the district mean, offset by the block bias; neighbours differ by a floor or two at most. */
function floorsFor(rng: Rng, mean: number, max: number, min = 2): number {
  const r = rng.next();
  const jitter = r < 0.55 ? 0 : r < 0.8 ? (rng.chance(0.5) ? 1 : -1) : r < 0.95 ? (rng.chance(0.5) ? 2 : -2) : rng.int(-3, 3);
  const f = Math.round(mean + blockBias + jitter);
  return Math.max(min, Math.min(max, f));
}

export function makeBuilding(lot: LotInput, geo: GeoSampler): BuildingRec | null {
  const rng = new Rng(lot.seed);
  blockBias = lot.blockBias ?? 0;
  const dist = lot.district;
  const fMean = dist ? dist.floorsMean : 4;
  const fMax = dist ? dist.floorsMax : 6;
  const use = geo.landUse(lot.x, lot.z);
  const density = geo.density(lot.x, lot.z);
  const nearRoad = lot.roadDist < 45;
  const strict = lot.w * lot.d > 900;

  let type: number = BType.Apartment;
  let floors = 5;
  let floorH = 3.0;
  let gfH = 3.2;
  let roof: number = Roof.Flat;
  let wallKind: number = Kind.Wall;
  let palette: Palette = APARTMENT_WALLS;
  let winType: number = WinType.Apartment;
  let sx = 3.0;
  let usage: number = Usage.Residential;
  let flags = 0;
  let pitch = 0.5;
  let overhang = 0.45;
  let setback: number = 6;

  switch (lot.typ) {
    case Typ.RowHistoric: {
      const r = rng.next();
      const pHouse = lot.style === Style.Historic ? 0.34 : 0.15;
      if (r < pHouse && lot.w < 14) {
        type = BType.HistoricHouse;
        floors = rng.int(2, 4);
        floorH = rng.range(3.1, 3.5);
        gfH = floorH + rng.range(-0.1, 0.3);
        wallKind = rng.chance(0.78) ? Kind.Wood : Kind.Wall;
        palette = HISTORIC_WOOD_WALLS;
        winType = WinType.Historic;
        sx = rng.range(1.7, 2.3);
        roof = rng.chance(0.85) ? Roof.Hip : Roof.Gable;
        overhang = rng.range(0.5, 0.8);
        pitch = rng.range(0.44, 0.55);
        flags |= BF.Old | BF.Chimney;
        if (rng.chance(0.75)) {
          flags |= BF.Cumba;
        }
      } else if (r < pHouse + 0.36) {
        type = BType.OldApartment;
        floors = Math.max(3, Math.min(fMax, floorsFor(rng, fMean + 0.3, fMax, 3)));
        floorH = rng.range(3.5, 3.9);
        gfH = rng.range(3.9, 4.6);
        wallKind = rng.chance(0.55) ? Kind.Stone : Kind.Wall;
        palette = OLD_APARTMENT_WALLS;
        winType = WinType.Historic;
        sx = rng.range(2.1, 2.7);
        roof = rng.chance(0.62) ? Roof.Hip : Roof.Flat;
        pitch = rng.range(0.38, 0.5);
        overhang = rng.range(0.25, 0.45);
        flags |= BF.Old | BF.Chimney;
        if (rng.chance(0.35)) {
          flags |= BF.Cumba;
        }
        if (rng.chance(0.25)) {
          flags |= BF.Balcony;
        }
      } else {
        type = BType.Apartment;
        floors = floorsFor(rng, fMean, fMax, 3);
        floorH = rng.range(2.9, 3.1);
        gfH = rng.range(3.2, 3.9);
        sx = rng.range(2.7, 3.4);
        roof = rng.chance(0.55) ? Roof.Hip : Roof.Flat;
        flags |= rng.chance(0.7) ? BF.Balcony : 0;
        flags |= rng.chance(0.4) ? BF.Cikma : 0;
        flags |= rng.chance(0.4) ? BF.Old : 0;
      }
      break;
    }
    case Typ.RowDense: {
      if (rng.chance(dist && dist.floorsMean <= 6 ? 0.14 : 0.06)) {
        type = BType.OldApartment;
        floors = Math.max(4, floorsFor(rng, fMean, fMax, 4));
        floorH = rng.range(3.4, 3.8);
        gfH = rng.range(3.8, 4.4);
        wallKind = rng.chance(0.45) ? Kind.Stone : Kind.Wall;
        palette = OLD_APARTMENT_WALLS;
        winType = WinType.Historic;
        sx = rng.range(2.2, 2.8);
        roof = rng.chance(0.5) ? Roof.Hip : Roof.Flat;
        flags |= BF.Old | (rng.chance(0.4) ? BF.Balcony : 0);
      } else {
        type = BType.Apartment;
        floors = floorsFor(rng, fMean, fMax, 3);
        floorH = rng.range(2.85, 3.1);
        gfH = rng.range(3.2, 4.0);
        sx = rng.range(2.7, 3.5);
        roof = rng.chance(0.5) ? Roof.Hip : Roof.Flat;
        flags |= rng.chance(0.8) ? BF.Balcony : 0;
        flags |= rng.chance(0.55) ? BF.Cikma : 0;
        flags |= rng.chance(0.3) ? BF.Old : 0;
      }
      break;
    }
    case Typ.Detached: {
      type = BType.Apartment;
      floors = floorsFor(rng, fMean + 0.5, fMax, 3);
      floorH = rng.range(2.9, 3.15);
      gfH = rng.range(3.0, 3.8);
      sx = rng.range(2.8, 3.6);
      roof = rng.chance(0.42) ? Roof.Hip : Roof.Flat;
      flags |= rng.chance(0.85) ? BF.Balcony | BF.BackBalcony : 0;
      flags |= rng.chance(0.3) ? BF.Cikma : 0;
      if (rng.chance(0.2)) {
        winType = WinType.Ribbon;
      }
      break;
    }
    case Typ.Mass: {
      type = BType.Mass;
      floors = rng.int(9, Math.max(10, Math.min(22, fMax + 6)));
      floorH = rng.range(2.8, 2.95);
      gfH = floorH + 0.3;
      palette = MASS_WALLS;
      winType = WinType.Mass;
      sx = rng.range(2.6, 3.2);
      roof = rng.chance(0.5) ? Roof.Hip : Roof.Flat;
      pitch = rng.range(0.4, 0.5);
      overhang = 0.3;
      flags |= BF.Balcony | (rng.chance(0.6) ? BF.Accent : 0);
      break;
    }
    case Typ.Tower: {
      if (rng.chance(0.55) && lot.w > 22 && lot.d > 22) {
        type = BType.Tower;
        const tall = rng.next();
        floors = Math.round(16 + tall * tall * Math.max(4, (dist ? dist.floorsMax : 40) - 16));
        floorH = rng.range(3.7, 4.2);
        gfH = rng.range(5, 7);
        wallKind = Kind.Curtain;
        palette = GLASS_TINTS;
        winType = WinType.Curtain;
        sx = rng.range(1.35, 1.6);
        usage = rng.chance(0.75) ? Usage.Office : Usage.Residential;
        flags |= BF.Crown | BF.Beacon | (rng.chance(0.55) ? BF.Setback : 0);
        roof = Roof.Flat;
      } else {
        type = BType.Office;
        floors = rng.int(7, 16);
        floorH = rng.range(3.5, 3.9);
        gfH = rng.range(4.2, 5.5);
        palette = OFFICE_WALLS;
        winType = rng.chance(0.6) ? WinType.Ribbon : WinType.Curtain;
        wallKind = winType === WinType.Curtain ? Kind.Curtain : Kind.Wall;
        if (wallKind === Kind.Curtain) {
          palette = GLASS_TINTS;
        }
        sx = rng.range(1.4, 1.8);
        usage = Usage.Office;
        roof = Roof.Flat;
        flags |= BF.Parapet;
      }
      setback = 8;
      break;
    }
    case Typ.Villa: {
      type = BType.Villa;
      floors = rng.int(1, 3);
      floorH = rng.range(3.0, 3.3);
      gfH = floorH;
      palette = VILLA_WALLS;
      winType = WinType.Villa;
      sx = rng.range(2.4, 3.2);
      roof = rng.chance(0.82) ? Roof.Hip : Roof.Flat;
      pitch = rng.range(0.42, 0.55);
      overhang = rng.range(0.5, 0.9);
      flags |= rng.chance(0.5) ? BF.Balcony : 0;
      break;
    }
    case Typ.Suburb: {
      if (rng.chance(0.55)) {
        type = BType.House;
        floors = rng.int(2, 3);
        floorH = rng.range(2.9, 3.2);
        gfH = floorH;
        palette = VILLA_WALLS;
        winType = WinType.Villa;
        sx = rng.range(2.5, 3.2);
        roof = rng.chance(0.75) ? Roof.Hip : Roof.Flat;
        overhang = rng.range(0.4, 0.7);
      } else {
        type = BType.Apartment;
        floors = floorsFor(rng, Math.max(3, fMean), Math.max(4, fMax), 2);
        floorH = rng.range(2.85, 3.05);
        gfH = rng.range(3.0, 3.4);
        sx = rng.range(2.7, 3.3);
        roof = rng.chance(0.55) ? Roof.Hip : Roof.Flat;
        flags |= rng.chance(0.7) ? BF.Balcony | BF.BackBalcony : 0;
      }
      break;
    }
    case Typ.Industrial: {
      type = BType.Industrial;
      floors = 1;
      gfH = rng.range(7, 13);
      floorH = gfH;
      palette = INDUSTRIAL_WALLS;
      winType = WinType.Industrial;
      sx = rng.range(4.5, 7);
      usage = Usage.Industrial;
      roof = rng.chance(0.4) ? Roof.Sawtooth : rng.chance(0.6) ? Roof.Gable : Roof.Flat;
      pitch = roof === Roof.Gable ? rng.range(0.12, 0.22) : 0.5;
      overhang = 0.3;
      break;
    }
    case Typ.Yali: {
      type = BType.Yali;
      floors = rng.int(2, 3);
      floorH = rng.range(3.6, 4.1);
      gfH = floorH + 0.2;
      wallKind = rng.chance(0.7) ? Kind.Wood : Kind.Wall;
      palette = YALI_WALLS;
      winType = WinType.Yali;
      sx = rng.range(1.6, 2.1);
      roof = Roof.Hip;
      pitch = rng.range(0.4, 0.5);
      overhang = rng.range(0.9, 1.4);
      flags |= BF.Old | BF.Chimney | (rng.chance(0.6) ? BF.Cumba : 0);
      setback = 3.5;
      break;
    }
  }

  if (use === LU.Suburban && type === BType.Apartment) {
    floors = Math.min(floors, 5);
  }
  if (use === LU.HistoricUrban && (type === BType.Apartment || type === BType.Mass)) {
    floors = Math.min(floors, Math.max(4, fMax));
  }
  if (nearRoad && (type === BType.Apartment || type === BType.OldApartment)) {
    floors += lot.roadBonus ?? 1;
  }
  // Thin out heights where the density map fades (edges of neighbourhoods).
  if (density < 0.5 && floors > 3 && type !== BType.Tower) {
    floors = Math.max(2, Math.round(floors * (0.6 + density * 0.8)));
  }

  const hs = siteHeights(geo, lot.x, lot.z, lot.a, lot.w, lot.d, setback, strict);
  if (!hs) {
    return null;
  }
  const [minH, maxH] = hs;
  if (maxH - minH > Math.max(7, 0.4 * Math.hypot(lot.w, lot.d))) {
    return null;
  }

  // Ground floor shops: along commercial streets, historic/dense cores and main roads.
  const shopChance =
    type === BType.Apartment || type === BType.OldApartment
      ? (lot.typ === Typ.RowDense || lot.typ === Typ.RowHistoric ? 0.45 : 0.15) + (nearRoad ? 0.35 : 0)
      : type === BType.Office
        ? 0.5
        : 0;
  if (rng.chance(shopChance)) {
    flags |= BF.Shop;
    gfH = Math.max(gfH, rng.range(3.8, 4.6));
    if (rng.chance(0.35)) {
      flags |= BF.Awning;
    }
  }
  if (flags & BF.Balcony && rng.chance(type === BType.Mass ? 0.25 : 0.32)) {
    flags |= BF.BalconyGlazed;
  }
  if (roof === Roof.Flat && (type === BType.Apartment || type === BType.Mass || type === BType.OldApartment || type === BType.House)) {
    flags |= BF.Parapet;
    if (rng.chance(0.55)) {
      flags |= BF.Tanks;
    }
    if (rng.chance(0.3)) {
      flags |= BF.Solar;
    }
    if (type === BType.Apartment && rng.chance(0.3)) {
      flags |= BF.Penthouse;
    }
  } else if (roof === Roof.Hip && type === BType.Apartment && rng.chance(0.12)) {
    flags |= BF.Solar;
  }
  if (roof === Roof.Hip && (type === BType.Apartment || type === BType.Villa || type === BType.House) && rng.chance(0.3)) {
    flags |= BF.Chimney;
  }
  if (lot.party1) {
    flags |= BF.Party1;
  }
  if (lot.party3) {
    flags |= BF.Party3;
  }
  if (lot.party2) {
    flags |= BF.Party2;
  }

  const height = gfH + Math.max(0, floors - 1) * floorH;
  let wallColor = jitterColor(pick(rng, palette), rng.next(), rng.next(), wallKind === Kind.Curtain ? 0.5 : 1);
  if (type === BType.Office && wallKind !== Kind.Curtain) {
    wallColor = jitterColor(pick(rng, OFFICE_WALLS), rng.next(), rng.next());
  }
  const roofPalette = roof === Roof.Hip || (roof === Roof.Gable && type !== BType.Industrial) ? ROOF_TILES : type === BType.Industrial ? INDUSTRIAL_ROOFS : ROOF_FLATS;
  const roofColor = jitterColor(pick(rng, roofPalette), rng.next(), rng.next(), 1.3);
  const accentColor = pick(rng, MASS_ACCENTS);
  const area = lot.w * lot.d;

  return {
    x: lot.x,
    z: lot.z,
    a: lot.a,
    w: lot.w,
    d: lot.d,
    baseY: minH - 1.4,
    groundY: maxH,
    type,
    floors,
    floorH,
    gfH,
    height,
    roof,
    pitch,
    overhang,
    wallKind,
    wallColor,
    roofColor,
    accentColor,
    winType,
    sx,
    usage,
    flags,
    seed: Math.floor(rng.next() * 256),
    rnd: Math.floor(rng.next() * 4294967295),
    keep: rng.next(),
    importance: (height + (maxH - minH)) * Math.sqrt(area),
  };
}

/** Roof appearance code for compact chunks (top face of a box). */
export function roofTopOf(b: BuildingRec): number {
  if (b.roof === Roof.Hip || (b.roof === Roof.Gable && b.type !== BType.Industrial)) {
    return RoofTop.Tile;
  }
  if (b.type === BType.Industrial) {
    return RoofTop.Metal;
  }
  return RoofTop.Flat;
}
