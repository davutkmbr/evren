/**
 * Bosphorus and island villages (landing-spot profile `bosphorus`): Ortaköy, Bebek, Arnavutköy, Rumeli and Anadolu
 * Hisarı, Emirgan, Kanlıca, Çengelköy, Beylerbeyi, Kuzguncuk, Salacak, Büyükada, Heybeliada. Low two- and
 * three-storey houses (painted timber and masonry, T2) along the shore road with a few apartment blocks and little
 * infill; lighter, warmer paint (cream, ochre, oxblood, pale grey-blue); more balconies, few AC units; ground floors
 * are cafés, fish restaurants, bakeries and grocers. Place words come from each spot; names stay fictional.
 */
import type { DistrictProfile } from '../src/district';
import { GENERIC } from './generic';

export const BOSPHORUS: DistrictProfile = {
  ...GENERIC,
  id: 'bosphorus',
  label: 'Bosphorus village',
  buildings: {
    ...GENERIC.buildings,
    defaultLevels: 3,
    typology: (area, kind) =>
      kind === 'apartments'
        ? [
            ['T1', 0.7],
            ['T2', 0.3],
          ]
        : [
            ['T1', area > 160 ? 0.4 : 0.25],
            ['T2', 0.65],
            ['T3', 0.1],
          ],
    storeys: { T1: [3, 5], T2: [2, 3], T3: [3, 4] },
    wearBias: 0,
  },
  facade: {
    ...GENERIC.facade,
    paint: {
      T1: [
        [0xe2d8c3, 1.2],
        [0xd9c7a2, 1],
        [0xc9cfcf, 0.7],
        [0xe8e4da, 1],
        [0xd4b89a, 0.6],
      ],
      T2: [
        [0xe6dcc6, 1],
        [0xd8b36e, 0.9],
        [0x9c4a3c, 0.6],
        [0xb9c4c6, 0.6],
        [0xe9e6de, 1.1],
        [0xc98f6a, 0.5],
        [0x8f9c8a, 0.4],
      ],
      T3: [
        [0xd6d5d0, 1],
        [0xb9bbba, 0.8],
        [0xcfc3ad, 0.7],
      ],
      trim: [0xf0ece2, 0xe4dccb, 0xdcd8ce],
    },
    t1Balcony: [
      ['all', 0.3],
      ['alternate', 0.2],
      ['ends', 0.15],
      ['centre', 0.2],
      ['none', 0.15],
    ],
    t2Balcony: 0.45,
    acScale: 0.5,
  },
  shops: {
    ...GENERIC.shops,
    filler: ['cafe', 'restaurant', 'fish', 'bakery', 'sweets', 'cafe', 'deli', 'produce', 'market', 'barber', 'fastfood'],
    marketFiller: ['fish', 'produce', 'deli', 'bakery', 'sweets'],
    fallback: ['cafe', 'restaurant', 'market', 'bakery', 'sweets', 'barber'],
  },
  street: { crowd: { pedestrian: 0.06, sidewalk: 0.025, square: 0.03 } },
};
