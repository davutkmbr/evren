/**
 * Kadıköy (area `kadikoy`, the S1 strip): the first street-layer district. Everything here was fitted to the S1
 * reference photos (.docs/street/s1-strip.md, kadikoy-soul.md); the hand-authored steps (heroes, soul, the Aya Efimia
 * precinct, the café interior) and the camera-driven street dressing (tools/world-compiler/s1/cameras.json) run only
 * here.
 */
import type { DistrictProfile } from '../src/district';
import type { SpecRow } from '../src/facade/plan';

/** .docs/street/s1-strip.md section 2 (storeys include the ground floor; ranges resolve by hash). */
const SPEC: Record<number, SpecRow> = {
  1462853463: { typ: 'T2', storeys: [3, 4] },
  179197246: { typ: 'T2', storeys: [3, 4] },
  709156144: { typ: 'T2', storeys: [4, 4] },
  694298370: { typ: 'T2', storeys: [3, 4] },
  709156145: { typ: 'T2', storeys: [4, 4], railing: 'iron' },
  694298380: { typ: 'T1', storeys: [5, 6] },
  694298381: { typ: 'T1', storeys: [5, 6] },
  694298376: { typ: 'T3', storeys: [6, 6], cikma: 'full', glazedBase: 2, wall: 0x858a8d },
  709156143: { typ: 'T1', storeys: [5, 6] },
  694298375: { typ: 'T1', storeys: [5, 5] },
  694298374: { typ: 'T1', storeys: [5, 5] },
  694298373: { typ: 'T2', storeys: [2, 3] },
  179197314: { typ: 'T1', storeys: [5, 5] },
  694298383: { typ: 'T5', storeys: [1, 1] },
  179197243: { typ: 'T3', storeys: [5, 5], railing: 'glass', wall: 0xdddbd5 },
  179197258: { typ: 'T3', storeys: [5, 5], railing: 'glass', wall: 0xdddbd5 },
  179197266: { typ: 'T1', storeys: [5, 6] },
  1462853447: { typ: 'T1', storeys: [5, 5] },
  179197226: { typ: 'T2', storeys: [3, 3], roof: 'hipped', wall: 0xd8c592, G: 3.7, F: 2.85 },
  1462853450: { typ: 'T2', storeys: [3, 3], roof: 'hipped', wall: 0xd8c592, G: 3.7, F: 2.85 },
  711321929: { typ: 'T1', storeys: [3, 4], wall: 0xdcd2b6, frame: 0x3a4d40, cikma: 'none' },
  694715116: { typ: 'T1', storeys: [4, 5] },
  711321928: { typ: 'T1', storeys: [4, 5] },
  694715117: { typ: 'T1', storeys: [4, 5] },
  694298355: { typ: 'T1', storeys: [4, 5] },
  694715125: { typ: 'T1', storeys: [4, 5] },
  694298352: { typ: 'T1', storeys: [3, 4] },
  694298353: { typ: 'T1', storeys: [3, 4] },
  694715137: { typ: 'T1', storeys: [3, 4] },
  694715138: { typ: 'T1', storeys: [3, 4] },
};

/** The fish / produce end of the strip: near the Yasa × Güneşlibahçe × Yağlıkçı İsmail junction (spec P10–P11). */
function inMarket(x: number, z: number): boolean {
  const ax = 405.1;
  const az = 6032.1;
  const bx = 442.2;
  const bz = 6052.5;
  const l2 = (bx - ax) ** 2 + (bz - az) ** 2;
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
  return Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z) < 18 || Math.hypot(x - bx, z - bz) < 40;
}

export const KADIKOY: DistrictProfile = {
  id: 'kadikoy',
  label: 'Kadıköy',
  strip: { cameras: 'tools/world-compiler/s1/cameras.json', spec: '.docs/street/s1-strip.md', route: 'rihtim-carsi' },
  cameras: 'tools/world-compiler/s1/cameras.json',
  handAuthored: { heroes: true, soul: true, precinct: true, interiors: true },
  buildings: {
    // Kadıköy's untagged buildings are mostly 1950s-70s apartment blocks.
    defaultLevels: 5,
    typology: (area) => [
      ['T1', 0.6],
      ['T2', area < 90 ? 0.3 : 0.2],
      ['T3', area > 180 ? 0.25 : 0.12],
    ],
    storeys: { T1: [5, 6], T2: [3, 4], T3: [5, 7] },
    spec: SPEC,
    // Piers, Haldun Taner, İskele Camii, Aya Efimia (hero lane).
    heroIds: new Set([102190096, 560203763, 102190100, 102190093, 694298377, 694298362, 694298363]),
    heroHeights: { 102190100: 13 },
    landmarkIds: new Set(),
    // The 1930 lottery kiosk at the Yasa Cd entrance (spec section 2, c11).
    shuttered: new Set([709156144]),
    wearBias: 0,
  },
  facade: {
    /**
     * Paint sampled from the strip's reference photos (.shots/s1/reference: c06, c07, Emel Apt, the çarşı and
     * Güneşlibahçe streets): dusty ochre, faded salmon, grey-green, cream, light grey, dirty white, blue-grey. Old
     * paint has saturation 0.05-0.35 (HSV), never the 0.4-0.55 of fresh pastels; albedo-level values.
     */
    paint: {
      T1: [
        [0xc9ae80, 1.2],
        [0xcdb68d, 1],
        [0xbba27a, 0.8],
        [0xc8a391, 0.9],
        [0xceb2a3, 0.7],
        [0xaab29c, 0.7],
        [0x9fab96, 0.5],
        [0xd8ccb2, 1.4],
        [0xd3c6a9, 1],
        [0xbcb8b0, 1.1],
        [0xaeaba4, 0.8],
        [0xd9d6ce, 1.1],
        [0xdedbd3, 0.9],
        [0xa9b2b4, 0.4],
        [0xcdb9b1, 0.5],
      ],
      T2: [
        [0xd2bf8f, 1.4],
        [0xd8cdb4, 1.2],
        [0xbcb6aa, 1],
        [0xc9b192, 0.8],
        [0xc0c3b6, 0.5],
        [0xc9a797, 0.5],
      ],
      T3: [
        [0x858a8e, 1],
        [0x595d61, 0.7],
        [0xd9d8d3, 1],
        [0xbdbfbe, 0.8],
      ],
      trim: [0xdfdcd3, 0xdad1bb, 0xd6d3cb],
    },
    t1Balcony: [
      ['all', 0.25],
      ['alternate', 0.25],
      ['ends', 0.2],
      ['centre', 0.15],
      ['none', 0.15],
    ],
    t2Balcony: 0.45,
    acScale: 1,
    // Plain yellow-and-navy flags (no crest).
    flag: [0xe0b830, 0x1b2a5a],
    market: inMarket,
  },
  shops: {
    firstWords: ['YILDIZ', 'GÜNEŞ', 'DENİZ', 'MARTI', 'YAKAMOZ', 'BEREKET', 'ÇINAR', 'LALE', 'ASLAN', 'KARDEŞLER', 'USTA', 'ÖZ', 'ALTIN', 'YENİ', 'EMEK', 'HUZUR', 'SAFA', 'LİMAN', 'İSKELE', 'RIHTIM', 'VAPUR', 'POYRAZ', 'LODOS', 'KARAYEL', 'MERCAN', 'İNCİ', 'SEDEF', 'NAR', 'AYVA', 'DEFNE', 'ZEYTİN', 'KESTANE', 'ŞAHİN', 'DOĞAN', 'KAYA', 'TUNA', 'AKYOL', 'ERGÜN', 'KÖŞE', 'ÇARŞI', 'MAHALLE', 'ANADOLU', 'EGE', 'KARADENİZ', 'TOROS', 'MENEKŞE', 'IŞIK', 'SEVGİ', 'UMUT', 'NEŞE'],
    filler: ['clothes', 'cafe', 'fastfood', 'phone', 'market', 'shoes', 'books', 'jewellery', 'restaurant', 'optician', 'bakery', 'barber'],
    marketFiller: ['fish', 'produce', 'deli', 'nuts', 'fish', 'produce', 'butcher', 'fastfood', 'sweets'],
    fallback: ['clothes', 'phone', 'market', 'shoes', 'cafe', 'jewellery', 'hardware', 'books', 'barber'],
    tradeOverrides: {},
  },
  street: { crowd: { pedestrian: 0.06, sidewalk: 0.03, square: 0.03 } },
};
