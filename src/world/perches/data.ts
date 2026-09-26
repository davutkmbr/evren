/**
 * Viewpoint catalogue (phase 03). Positions are not stored as numbers: every entry names how its grip point is
 * derived from the same inputs the landmark builders use (LandmarkDef anchors / heights, builder specs, terrain),
 * so a perch stays on its structure when a builder or the landmark data changes. See resolve.ts.
 *
 * Headings are compass degrees toward the best view. Player-facing text (name, info) is Turkish.
 *
 * Placement rules (PERCH_RULES, checked by validatePerch at load and by tools/headless/perches-check.ts): a perch
 * stands on top of a structure (there is no ground placement: a hill top is not enough, trees and buildings grow
 * over the dragon and the camera), high above the ground and clear of every neighbour around it, with an open view.
 * Left out on purpose (the dragon's rig spheres: body r 1.7 m, tail 8.8 m behind, 20 m of spread wings):
 * - minaret balconies, tower galleries and terraces: body and tail reach into the storeys above;
 * - the Beyazıt Kulesi: its stone roof is 2.3 m wide around the 11 m signal pole, no grip keeps the body off the pole;
 * - the Çamlıca Kulesi: no ledge, the crown slopes straight into the 5 m antenna mast;
 * - Rumeli Hisarı: no built towers yet, and the hillside woods stand over its tower tops;
 * - hill tops (trees) and the city-wall towers (18-20 m over the ground: trees and houses around them are as tall).
 */
import type { PerchSurface } from '../../core/contracts';

export type PerchPlacement =
  /** Top portal beam (portal towers) or concrete apex (A towers) of a Bosphorus suspension bridge tower. */
  | { kind: 'bridge-tower'; landmarkId: string; tower: 0 | 1 }
  /**
   * Roof of a round tower (the Galata cone tip): `height` m over the builder's base, `radius` m out from the axis
   * toward the perch heading.
   */
  | { kind: 'tower-roof'; landmarkId: string; height: number; radius: number }
  /** Top of the Kız Kulesi cupola (base of the finial). */
  | { kind: 'kiz-cupola' }
  /**
   * Main dome of an imperial landmark mosque, `offset` m from the crown toward the perch heading and `side` m to its
   * right (negative: left), so the alem on the crown stands beside the dragon instead of between its legs.
   */
  | { kind: 'mosque-dome'; landmarkId: string; offset: number; side?: number }
  /** Roof of a catalogued skyscraper; `along` = position on the plan's long axis (-1..1, slanted roofs: 1 = high end). */
  | { kind: 'skyscraper-roof'; landmarkId: string; anchor: number; along: number };

export interface PerchData {
  id: string;
  name: string;
  info: string;
  headingDeg: number;
  surface: PerchSurface;
  gripRadius: number;
  landmarkId?: string;
  placement: PerchPlacement;
}

export const PERCH_DATA: readonly PerchData[] = [
  {
    id: 'bogazici-koprusu-kule',
    name: '15 Temmuz Şehitler Köprüsü Kulesi',
    info: "Beylerbeyi yakasındaki 165 m'lik çelik kulenin tepesi. Aşağıda Boğaz'ın iki yakası, Ortaköy Camii ve uzakta Tarihî Yarımada'nın silueti uzanır.",
    headingDeg: 235,
    surface: 'tower',
    gripRadius: 3,
    landmarkId: 'bogazici-koprusu',
    placement: { kind: 'bridge-tower', landmarkId: 'bogazici-koprusu', tower: 1 },
  },
  {
    id: 'fsm-koprusu-kule',
    name: 'Fatih Sultan Mehmet Köprüsü Kulesi',
    info: "Kavacık yakasındaki kulenin tepesinden Boğaz'ın en dar yeri ve karşıda Rumeli Hisarı'nın kuleleri görünür.",
    headingDeg: 228,
    surface: 'tower',
    gripRadius: 3,
    landmarkId: 'fsm-koprusu',
    placement: { kind: 'bridge-tower', landmarkId: 'fsm-koprusu', tower: 1 },
  },
  {
    id: 'yss-koprusu-kule',
    name: 'Yavuz Sultan Selim Köprüsü Kulesi',
    info: "Garipçe yakasındaki 322 m'lik beton kule, şehrin en yüksek tünemek noktası. Kuzeyde Boğaz, Rumeli ve Anadolu fenerlerinin arasından Karadeniz'e açılır.",
    headingDeg: 35,
    surface: 'tower',
    gripRadius: 3,
    landmarkId: 'yss-koprusu',
    placement: { kind: 'bridge-tower', landmarkId: 'yss-koprusu', tower: 0 },
  },
  {
    id: 'galata-kulesi',
    name: 'Galata Kulesi',
    info: "Konik külahın tepesinden Haliç, Tarihî Yarımada'nın camileri ve Boğaz'ın girişi bir arada görünür. Hezarfen Ahmed Çelebi'nin efsanevi uçuşu da buradan başlamıştı.",
    headingDeg: 215,
    surface: 'tower',
    gripRadius: 2,
    landmarkId: 'galata-kulesi',
    // The tip of the lead cone (65.6 m, the base of the finial).
    placement: { kind: 'tower-roof', landmarkId: 'galata-kulesi', height: 65.6, radius: 0 },
  },
  {
    id: 'suleymaniye-kubbe',
    name: 'Süleymaniye Camii Kubbesi',
    info: "Mimar Sinan'ın büyük kubbesinin üstü; Haliç'in kıvrımı, Galata Kulesi ve Beyoğlu sırtları tam karşıdadır.",
    headingDeg: 40,
    surface: 'dome',
    gripRadius: 2.5,
    landmarkId: 'suleymaniye',
    // Beside the crown, not straight ahead of it: the alem stands next to the dragon instead of between its hind legs.
    placement: { kind: 'mosque-dome', landmarkId: 'suleymaniye', offset: 1.5, side: -2.6 },
  },
  {
    id: 'kiz-kulesi',
    name: 'Kız Kulesi',
    info: "Kulenin kurşun kaplı küçük kubbesi, Boğaz'ın ağzında denizin ortasında. Bir yanda Üsküdar ve Salacak, karşıda Sarayburnu, Topkapı Sarayı ve Ayasofya.",
    headingDeg: 255,
    surface: 'dome',
    gripRadius: 2,
    landmarkId: 'kiz-kulesi',
    // The cupola over the lantern, not the islet's terrace: a perch never sits at sea or ground level.
    placement: { kind: 'kiz-cupola' },
  },
  {
    id: 'istanbul-sapphire',
    name: 'İstanbul Sapphire Çatısı',
    info: "Levent'in 261 m'lik gökdeleninin eğimli çatısı. Büyükdere Caddesi'nin kuleleri ve doğuda Boğaz'ın mavisi ayaklarının altında.",
    headingDeg: 100,
    surface: 'roof',
    gripRadius: 4,
    landmarkId: 'levent-kuleleri',
    placement: { kind: 'skyscraper-roof', landmarkId: 'levent-kuleleri', anchor: 0, along: 0.9 },
  },
  {
    id: 'sultanahmet-kubbe',
    name: 'Sultanahmet Camii Kubbesi',
    info: "Altı minareli caminin büyük kubbesi. Tam karşıda Ayasofya, arkasında Topkapı Sarayı ve Boğaz'ın girişi; sağda Marmara'nın açıkları.",
    headingDeg: 37,
    surface: 'dome',
    gripRadius: 2.5,
    landmarkId: 'sultanahmet',
    placement: { kind: 'mosque-dome', landmarkId: 'sultanahmet', offset: 1.5, side: -2.4 },
  },
  {
    id: 'camlica-camii-kubbe',
    name: 'Büyük Çamlıca Camii Kubbesi',
    info: "Anadolu yakasının en yüksek tepesindeki caminin büyük kubbesi; bütün şehir, Boğaz'ın iki köprüsü ve Tarihî Yarımada ayaklarının altındadır. Gün batımı yarımadanın arkasında olur.",
    headingDeg: 250,
    surface: 'dome',
    gripRadius: 3,
    landmarkId: 'camlica-camii',
    placement: { kind: 'mosque-dome', landmarkId: 'camlica-camii', offset: 2, side: -3 },
  },
];
