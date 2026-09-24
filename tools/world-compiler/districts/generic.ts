/**
 * The generic Istanbul district: the default profile of every area without its own file. A mixed fabric of
 * 1950s-80s apartment blocks, older masonry and newer infill; neutral paint; no hand-authored steps, no reference
 * cameras and no default strip (every tile greybox unless `--strip` names a rect).
 */
import type { DistrictProfile } from '../src/district';

export const GENERIC: DistrictProfile = {
  id: 'generic',
  label: 'Generic Istanbul district',
  strip: null,
  cameras: null,
  handAuthored: { heroes: false, soul: false, precinct: false, interiors: false },
  buildings: {
    defaultLevels: 4,
    typology: (area) => [
      ['T1', 0.55],
      ['T2', area < 90 ? 0.25 : 0.18],
      ['T3', area > 180 ? 0.3 : 0.15],
    ],
    storeys: { T1: [4, 6], T2: [3, 4], T3: [4, 7] },
    spec: {},
    heroIds: new Set(),
    heroHeights: {},
    landmarkIds: new Set(),
    shuttered: new Set(),
    wearBias: 0,
  },
  facade: {
    paint: {
      T1: [
        [0xc9b48f, 1],
        [0xd6cbb2, 1.2],
        [0xbcb8b0, 1],
        [0xc8a898, 0.7],
        [0xaab09e, 0.6],
        [0xdad6cd, 1],
        [0xa9b0b3, 0.4],
      ],
      T2: [
        [0xcfbd93, 1.2],
        [0xd6ccb5, 1],
        [0xbcb6aa, 1],
        [0xc6ab94, 0.6],
      ],
      T3: [
        [0x858a8e, 1],
        [0x5d6165, 0.6],
        [0xd6d5d0, 1],
        [0xb9bbba, 0.8],
      ],
      trim: [0xdcd8ce, 0xd6cdb8, 0xd3d0c8],
    },
    t1Balcony: [
      ['all', 0.22],
      ['alternate', 0.22],
      ['ends', 0.18],
      ['centre', 0.16],
      ['none', 0.22],
    ],
    t2Balcony: 0.35,
    acScale: 1,
    flag: [0xb3262c, 0xeeeae0],
    market: () => false,
  },
  shops: {
    firstWords: ['YILDIZ', 'GÜNEŞ', 'DENİZ', 'BEREKET', 'ÇINAR', 'LALE', 'ASLAN', 'KARDEŞLER', 'USTA', 'ÖZ', 'ALTIN', 'YENİ', 'EMEK', 'HUZUR', 'SAFA', 'POYRAZ', 'MERCAN', 'İNCİ', 'SEDEF', 'NAR', 'DEFNE', 'ZEYTİN', 'ŞAHİN', 'DOĞAN', 'KAYA', 'TUNA', 'AKYOL', 'ERGÜN', 'KÖŞE', 'MAHALLE', 'ANADOLU', 'EGE', 'KARADENİZ', 'TOROS', 'MENEKŞE', 'IŞIK', 'SEVGİ', 'UMUT', 'NEŞE', 'GÜVEN'],
    filler: ['clothes', 'cafe', 'fastfood', 'phone', 'market', 'shoes', 'jewellery', 'restaurant', 'optician', 'bakery', 'barber', 'hardware'],
    marketFiller: ['produce', 'deli', 'nuts', 'produce', 'butcher', 'fastfood', 'sweets'],
    fallback: ['clothes', 'phone', 'market', 'shoes', 'cafe', 'jewellery', 'hardware', 'books', 'barber'],
    tradeOverrides: {},
  },
  street: { crowd: { pedestrian: 0.07, sidewalk: 0.03, square: 0.03 } },
};
