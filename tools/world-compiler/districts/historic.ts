/**
 * Historic core (landing-spot profile `historic`): the historic peninsula and old Pera outside Eminönü (Sultanahmet,
 * Süleymaniye, Kumkapı, Balat, Eyüp, Karaköy, Galata, İstiklal). Stone and plaster masonry blocks and hans (T2) with
 * concrete infill (T3) and fewer apartment blocks; muted stone and ochre paint as in Eminönü, but the ground floors
 * are cafés, restaurants, sweets, souvenirs and clothes rather than wholesale trades. Place words come from each
 * spot (landing-spots.json `placeWords`); every business name stays fictional.
 */
import type { DistrictProfile } from '../src/district';
import { EMINONU } from './eminonu';
import { GENERIC } from './generic';

export const HISTORIC: DistrictProfile = {
  ...GENERIC,
  id: 'historic',
  label: 'Historic core',
  buildings: {
    ...GENERIC.buildings,
    defaultLevels: 4,
    typology: (area, kind) =>
      kind === 'apartments' || kind === 'residential'
        ? [
            ['T1', 0.55],
            ['T2', 0.45],
          ]
        : [
            ['T1', 0.2],
            ['T2', area < 90 ? 0.6 : 0.5],
            ['T3', area > 180 ? 0.3 : 0.2],
          ],
    storeys: { T1: [4, 6], T2: [3, 5], T3: [4, 6] },
    wearBias: 0.08,
  },
  facade: { ...EMINONU.facade, t2Balcony: 0.3, acScale: 0.75 },
  shops: {
    ...GENERIC.shops,
    filler: ['cafe', 'restaurant', 'sweets', 'jewellery', 'clothes', 'cafe', 'fastfood', 'books', 'textiles', 'housewares', 'bakery', 'coffee'],
    marketFiller: ['spice', 'nuts', 'sweets', 'deli', 'produce', 'coffee'],
    fallback: ['cafe', 'restaurant', 'clothes', 'jewellery', 'sweets', 'housewares', 'books'],
    tradeOverrides: { 'shop=gift': 'housewares', 'shop=carpet': 'textiles', 'shop=souvenir': 'housewares', 'shop=antiques': 'housewares', 'shop=spices': 'spice' },
  },
  street: { crowd: { pedestrian: 0.08, sidewalk: 0.035, square: 0.03 } },
};
