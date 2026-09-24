/**
 * Eminönü (area `eminonu`): Yeni Cami and its square, Mısır Çarşısı, Tahtakale and the Eminönü piers. A dense
 * historic commercial fabric: stone and plaster hans and 19th-century masonry blocks (T2) with later concrete
 * commercial infill (T3) and few apartment blocks (T1); ground floors are shops throughout, mostly wholesale trades
 * (spice, nuts and dried fruit, coffee, textiles, hardware and housewares, jewellery). Paint is older and more muted
 * than Kadıköy's, soot-greyed stone and dusty ochre. Every business name is fictional; the place words are
 * neighbourhood names only. Mosques and Mısır Çarşısı are landmarks (simple massing, flagged in the manifest).
 */
import type { DistrictProfile } from '../src/district';
import { GENERIC } from './generic';

export const EMINONU: DistrictProfile = {
  id: 'eminonu',
  label: 'Eminönü',
  strip: { rect: { minX: -4408, minZ: 2832, maxX: -3652, maxZ: 3332 } },
  cameras: null,
  handAuthored: { heroes: false, soul: false, precinct: false, interiors: false },
  buildings: {
    defaultLevels: 4,
    typology: (area, kind) =>
      kind === 'apartments' || kind === 'residential'
        ? [
            ['T1', 0.7],
            ['T2', 0.3],
          ]
        : [
            ['T1', 0.15],
            ['T2', area < 90 ? 0.6 : 0.5],
            ['T3', area > 180 ? 0.38 : 0.25],
          ],
    storeys: { T1: [4, 6], T2: [3, 5], T3: [5, 7] },
    spec: {},
    heroIds: new Set(),
    heroHeights: {},
    // Mısır Çarşısı (the Spice Bazaar, amenity=marketplace); the mosques are landmarks by the generic rule.
    landmarkIds: new Set([24234971]),
    shuttered: new Set(),
    wearBias: 0.1,
  },
  facade: {
    paint: {
      T1: [
        [0xc2b59c, 1],
        [0xb3aa98, 1],
        [0xbca58a, 0.8],
        [0xc9c0ae, 1],
        [0xa7a79c, 0.7],
        [0xb89c8c, 0.5],
        [0xd2cab8, 0.8],
      ],
      T2: [
        [0xb9ae98, 1.3],
        [0xc4b393, 1.1],
        [0xa9a397, 1],
        [0xbfa48e, 0.6],
        [0xd0c6b0, 0.9],
        [0x9c9a8e, 0.6],
        [0xb7ab9f, 0.8],
      ],
      T3: [
        [0x7d8185, 1],
        [0x5d6064, 0.7],
        [0xc9c7c0, 0.9],
        [0xa9aaa6, 0.8],
        [0x8a7f72, 0.5],
      ],
      trim: [0xd2cbbb, 0xc9c0ab, 0xcfcabe],
    },
    // Offices and storage above the shops: few balconies.
    t1Balcony: [
      ['all', 0.1],
      ['alternate', 0.1],
      ['ends', 0.15],
      ['centre', 0.2],
      ['none', 0.45],
    ],
    t2Balcony: 0.25,
    acScale: 0.7,
    flag: [0xb3262c, 0xeeeae0],
    market: () => false,
  },
  shops: {
    firstWords: ['EMİNÖNÜ', 'TAHTAKALE', 'HALİÇ', 'MAHMUTPAŞA', 'SİRKECİ', 'HASIRCILAR', 'YILDIZ', 'BEREKET', 'ÇINAR', 'ASLAN', 'KARDEŞLER', 'USTA', 'ÖZ', 'ALTIN', 'YENİ', 'EMEK', 'HUZUR', 'SAFA', 'İPEK', 'SEDEF', 'MERCAN', 'İNCİ', 'ZÜMRÜT', 'NAR', 'ŞAHİN', 'DOĞAN', 'KAYA', 'TUNA', 'AKYOL', 'ERGÜN', 'ANADOLU', 'EGE', 'KARADENİZ', 'TOROS', 'GÜVEN', 'IŞIK', 'KESTANE', 'FINDIK', 'KERVAN', 'TARİHİ'],
    filler: ['spice', 'nuts', 'coffee', 'textiles', 'textiles', 'housewares', 'hardware', 'jewellery', 'clothes', 'sweets', 'fastfood', 'housewares', 'shoes', 'market'],
    marketFiller: ['spice', 'nuts', 'coffee', 'deli', 'sweets', 'produce'],
    fallback: ['textiles', 'housewares', 'hardware', 'clothes', 'jewellery', 'spice', 'nuts'],
    tradeOverrides: {
      'shop=spices': 'spice',
      'shop=herbalist': 'spice',
      'shop=coffee': 'coffee',
      'shop=tea': 'coffee',
      'shop=fabric': 'textiles',
      'shop=textiles': 'textiles',
      'shop=curtain': 'textiles',
      'shop=sewing': 'textiles',
      'shop=houseware': 'housewares',
      'shop=household_items_shop': 'housewares',
      'shop=interior_decoration': 'housewares',
      'shop=furniture': 'housewares',
      'shop=gift': 'housewares',
      'shop=craft': 'hardware',
      'shop=toys': 'housewares',
    },
  },
  street: { crowd: { ...GENERIC.street.crowd, pedestrian: 0.08, sidewalk: 0.04, square: 0.03 } },
};
