/**
 * Viewpoint catalogue (phase 03). Positions are not stored as numbers: every entry names how its grip point is
 * derived from the same inputs the landmark builders use (LandmarkDef anchors / heights, builder specs, terrain),
 * so a perch stays on its structure when a builder or the landmark data changes. See resolve.ts.
 *
 * Headings are compass degrees toward the best view. Player-facing text (name, info) is Turkish. Hill coordinates
 * are the summits of the game's terrain near the real spot, except Pierre Loti (the café on the brow above Eyüp);
 * tools/headless/perches-check.ts prints the local summit.
 */
import type { PerchSurface } from '../../core/contracts';

export type PerchPlacement =
  /** Natural ground (hill tops): terrain height at lat/lon. */
  | { kind: 'ground'; lat: number; lon: number }
  /** Top portal beam (portal towers) or concrete apex (A towers) of a Bosphorus suspension bridge tower. */
  | { kind: 'bridge-tower'; landmarkId: string; tower: 0 | 1 }
  /** Tip of the Galata Kulesi lead cone (base of the finial). */
  | { kind: 'galata-cap' }
  /** Paved terrace of the Kız Kulesi islet, in the builder's local frame (u along the heading, v to the right). */
  | { kind: 'kiz-terrace'; u: number; v: number }
  /** Main dome of an imperial landmark mosque, `offset` m from the crown toward the perch heading (clear of the alem). */
  | { kind: 'mosque-dome'; landmarkId: string; offset: number }
  /** Top of one of the Rumeli Hisarı great towers. */
  | { kind: 'fortress-tower'; tower: 'saruca' | 'halil' | 'zaganos' }
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
    placement: { kind: 'galata-cap' },
  },
  {
    id: 'suleymaniye-kubbe',
    name: 'Süleymaniye Camii Kubbesi',
    info: "Mimar Sinan'ın büyük kubbesinin üstü; Haliç'in kıvrımı, Galata Kulesi ve Beyoğlu sırtları tam karşıdadır.",
    headingDeg: 40,
    surface: 'dome',
    gripRadius: 2.5,
    landmarkId: 'suleymaniye',
    placement: { kind: 'mosque-dome', landmarkId: 'suleymaniye', offset: 2.5 },
  },
  {
    id: 'kiz-kulesi',
    name: 'Kız Kulesi',
    info: "Adacığın taş terası, deniz seviyesinin hemen üstünde. Bir yanda Üsküdar ve Salacak, karşıda Sarayburnu, Topkapı Sarayı ve Ayasofya.",
    headingDeg: 255,
    surface: 'rock',
    gripRadius: 3.5,
    landmarkId: 'kiz-kulesi',
    placement: { kind: 'kiz-terrace', u: -17, v: 0 },
  },
  {
    id: 'rumeli-hisari-zaganos',
    name: 'Rumeli Hisarı, Zağanos Paşa Kulesi',
    info: "Hisarın en geniş kulesinin burçları. Boğaz'ın en dar noktası tam önünde; karşıda Anadolu Hisarı, kuzeyde Fatih Sultan Mehmet Köprüsü.",
    headingDeg: 95,
    surface: 'tower',
    gripRadius: 5,
    landmarkId: 'rumeli-hisari',
    placement: { kind: 'fortress-tower', tower: 'zaganos' },
  },
  {
    id: 'buyuk-camlica',
    name: 'Büyük Çamlıca Tepesi',
    info: "Anadolu yakasının simge tepesi; bütün şehir, Boğaz'ın iki köprüsü ve Adalar ayaklarının altındadır. Gün batımı Tarihî Yarımada'nın arkasında olur.",
    headingDeg: 262,
    surface: 'hill',
    gripRadius: 6,
    placement: { kind: 'ground', lat: 41.0274, lon: 29.069 },
  },
  {
    id: 'otagtepe',
    name: 'Otağtepe',
    info: "Fatih Sultan Mehmed'in kuşatma öncesi otağını kurduğu söylenen koru. Fatih Sultan Mehmet Köprüsü ve Rumeli Hisarı hemen aşağıdadır.",
    headingDeg: 248,
    surface: 'hill',
    gripRadius: 6,
    placement: { kind: 'ground', lat: 41.097, lon: 29.0793 },
  },
  {
    id: 'pierre-loti',
    name: 'Pierre Loti Tepesi',
    info: "Fransız yazar Pierre Loti'nin adını taşıyan kahvenin tepesi; Haliç'in bütün uzunluğu Eyüp mezarlığının servilerinin arasından görünür.",
    headingDeg: 140,
    surface: 'hill',
    gripRadius: 5,
    placement: { kind: 'ground', lat: 41.0553, lon: 28.9336 },
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
    id: 'buyukada-aya-yorgi',
    name: 'Büyükada, Aya Yorgi Tepesi',
    info: "Adaların en yüksek tepesi Yücetepe'deki Aya Yorgi Manastırı. Heybeliada, Burgazada ve açık Marmara bir bakışta görünür.",
    headingDeg: 300,
    surface: 'hill',
    gripRadius: 6,
    placement: { kind: 'ground', lat: 40.8486, lon: 29.1195 },
  },
  {
    id: 'aydos',
    name: 'Aydos Tepesi',
    info: "537 m ile İstanbul'un en yüksek doğal noktası. Anadolu yakasının yeşil sırtları, Marmara kıyısı ve Adalar geniş bir yay çizer.",
    headingDeg: 290,
    surface: 'hill',
    gripRadius: 8,
    // Highest point of the built terrain (~560 m), 0.8 km NNW of the surveyed summit (537 m, 40.9315 / 29.2545):
    // the relief spline overshoots on the ridge, so the surveyed spot is not a summit in the game.
    placement: { kind: 'ground', lat: 40.9375, lon: 29.2485 },
  },
  {
    id: 'yusa-tepesi',
    name: 'Yuşa Tepesi',
    info: "Beykoz sırtlarında, adını Yuşa Peygamber'e atfedilen türbeden alan tepe. Boğaz buradan kıvrılarak Karadeniz'e açılır.",
    headingDeg: 10,
    surface: 'hill',
    gripRadius: 6,
    placement: { kind: 'ground', lat: 41.162, lon: 29.0855 },
  },
];
