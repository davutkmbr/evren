/**
 * Hand-encoded maritime geography. Pier coordinates are OpenStreetMap amenity=ferry_terminal nodes
 * (© OpenStreetMap contributors, ODbL); the Bosphorus centreline follows the Istanbul Strait traffic separation
 * scheme through the channel (auto-centred on the geo coastline at runtime).
 */

export type PierStyle = 'terminal' | 'kadikoy' | 'uskudar' | 'modern' | 'small';

export interface PierDef {
  id: string;
  name: string;
  style: PierStyle;
  /** Berths along the frontage: lat, lon pairs of the mooring points (ferry terminal nodes). */
  berths: readonly (readonly [number, number])[];
  /** Building footprint along the shore (m) and depth out over the water (m). */
  frontage: number;
  reach: number;
}

export const PIERS: readonly PierDef[] = [
  {
    id: 'eminonu',
    name: 'Eminönü İskelesi',
    style: 'terminal',
    berths: [
      [41.01787, 28.97402],
      [41.01744, 28.97507],
      [41.01713, 28.97627],
    ],
    frontage: 44,
    reach: 26,
  },
  { id: 'karakoy', name: 'Karaköy İskelesi', style: 'terminal', berths: [[41.02132, 28.97652]], frontage: 46, reach: 24 },
  {
    id: 'kadikoy',
    name: 'Kadıköy İskelesi',
    style: 'kadikoy',
    berths: [
      [40.99296, 29.02313],
      [40.99182, 29.02155],
    ],
    frontage: 52,
    reach: 28,
  },
  { id: 'kadikoy-ido', name: 'Kadıköy Deniz Otobüsü İskelesi', style: 'modern', berths: [[40.99124, 29.0181]], frontage: 26, reach: 18 },
  {
    id: 'uskudar',
    name: 'Üsküdar İskelesi',
    style: 'uskudar',
    berths: [
      [41.02749, 29.0147],
      [41.02816, 29.01593],
    ],
    frontage: 46,
    reach: 24,
  },
  { id: 'besiktas', name: 'Beşiktaş İskelesi', style: 'modern', berths: [[41.04083, 29.00742]], frontage: 48, reach: 24 },
  {
    id: 'kabatas',
    name: 'Kabataş İskelesi',
    style: 'modern',
    berths: [
      [41.03303, 28.99415],
      [41.03546, 28.99425],
    ],
    frontage: 50,
    reach: 26,
  },
  { id: 'kinaliada', name: 'Kınalıada İskelesi', style: 'small', berths: [[40.9106, 29.05567]], frontage: 22, reach: 20 },
  { id: 'burgazada', name: 'Burgazada İskelesi', style: 'small', berths: [[40.88113, 29.07031]], frontage: 22, reach: 20 },
  { id: 'heybeliada', name: 'Heybeliada İskelesi', style: 'small', berths: [[40.8769, 29.10177]], frontage: 24, reach: 20 },
  { id: 'buyukada', name: 'Büyükada İskelesi', style: 'kadikoy', berths: [[40.8761, 29.12778]], frontage: 34, reach: 22 },
  { id: 'kanlica', name: 'Kanlıca İskelesi', style: 'small', berths: [[41.10026, 29.06533]], frontage: 18, reach: 16 },
  { id: 'sariyer', name: 'Sarıyer İskelesi', style: 'small', berths: [[41.16628, 29.05759]], frontage: 20, reach: 18 },
  { id: 'anadolu-kavagi', name: 'Anadolu Kavağı İskelesi', style: 'small', berths: [[41.17343, 29.08787]], frontage: 18, reach: 16 },
];

export type FerryKind = 'vapur' | 'seabus';

export interface FerryLineDef {
  id: string;
  kind: FerryKind;
  /** Stops as [pierId, berthIndex]. The line runs A -> B -> ... -> last and back. */
  stops: readonly (readonly [string, number])[];
  /** Optional open-water via points (lat, lon) between consecutive stops, keyed by the leg index (outbound). */
  via?: Readonly<Record<number, readonly (readonly [number, number])[]>>;
  vessels: number;
  /** Dwell at each stop (s). */
  dwell: number;
}

export const FERRY_LINES: readonly FerryLineDef[] = [
  { id: 'eminonu-kadikoy', kind: 'vapur', stops: [['eminonu', 1], ['kadikoy', 0]], vessels: 2, dwell: 70 },
  { id: 'karakoy-kadikoy', kind: 'vapur', stops: [['karakoy', 0], ['kadikoy', 1]], vessels: 2, dwell: 70 },
  { id: 'eminonu-uskudar', kind: 'vapur', stops: [['eminonu', 2], ['uskudar', 0]], vessels: 2, dwell: 60 },
  { id: 'besiktas-uskudar', kind: 'vapur', stops: [['besiktas', 0], ['uskudar', 1]], vessels: 2, dwell: 60 },
  {
    id: 'kabatas-adalar',
    kind: 'vapur',
    stops: [['kabatas', 0], ['kinaliada', 0], ['burgazada', 0], ['heybeliada', 0], ['buyukada', 0]],
    via: { 0: [[41.012, 29.001], [40.985, 29.012], [40.945, 29.04]] },
    vessels: 2,
    dwell: 50,
  },
  {
    id: 'bogaz-turu',
    kind: 'vapur',
    stops: [['eminonu', 0], ['besiktas', 0], ['kanlica', 0], ['sariyer', 0], ['anadolu-kavagi', 0]],
    vessels: 1,
    dwell: 45,
  },
  {
    id: 'ido-adalar',
    kind: 'seabus',
    stops: [['kabatas', 1], ['kadikoy-ido', 0], ['heybeliada', 0], ['buyukada', 0]],
    via: { 0: [[41.012, 29.0015]], 1: [[40.965, 29.03], [40.92, 29.075]] },
    vessels: 2,
    dwell: 40,
  },
];

/** Istanbul Strait centreline, Black Sea -> Marmara (lat, lon). */
export const STRAIT_CENTRELINE: readonly (readonly [number, number])[] = [
  [41.258, 29.142],
  [41.232, 29.13],
  [41.212, 29.118],
  [41.196, 29.1],
  [41.178, 29.082],
  [41.162, 29.071],
  [41.145, 29.075],
  [41.127, 29.079],
  [41.112, 29.071],
  [41.1, 29.062],
  [41.087, 29.062],
  [41.076, 29.052],
  [41.063, 29.047],
  [41.052, 29.042],
  [41.045, 29.034],
  [41.037, 29.021],
  [41.03, 29.006],
  [41.018, 28.996],
  [41.004, 28.996],
  [40.985, 28.99],
  [40.962, 28.965],
  [40.925, 28.91],
  [40.885, 28.845],
  [40.845, 28.765],
];

/** Anchorage areas: centre (lat, lon), radius (m), share of the anchored fleet. */
export const ANCHORAGES: readonly { id: string; lat: number; lon: number; radius: number; share: number }[] = [
  { id: 'ahirkapi', lat: 40.989, lon: 28.962, radius: 1900, share: 0.62 },
  { id: 'kadikoy', lat: 40.968, lon: 29.0, radius: 1300, share: 0.38 },
];

/** Small-craft cruising zones (lat, lon, radius m, weight). */
export const SMALL_CRAFT_ZONES: readonly { lat: number; lon: number; radius: number; weight: number }[] = [
  { lat: 41.045, lon: 29.03, radius: 1800, weight: 1.4 },
  { lat: 41.075, lon: 29.052, radius: 1600, weight: 1.0 },
  { lat: 41.012, lon: 28.998, radius: 1500, weight: 1.2 },
  { lat: 40.976, lon: 29.028, radius: 2200, weight: 1.0 },
  { lat: 40.995, lon: 28.955, radius: 2000, weight: 0.8 },
  { lat: 40.885, lon: 29.09, radius: 3500, weight: 1.0 },
  { lat: 41.14, lon: 29.066, radius: 1800, weight: 0.6 },
  { lat: 40.955, lon: 29.085, radius: 2500, weight: 0.6 },
];

/** Seagull gathering spots (lat, lon, flock size weight). */
export const GULL_SITES: readonly (readonly [number, number, number])[] = [
  [41.0178, 28.9745, 1.6],
  [41.0198, 28.9728, 1.4],
  [41.0216, 28.9772, 1.0],
  [40.9935, 29.0222, 1.3],
  [41.0272, 29.0138, 1.1],
  [41.0208, 29.0038, 1.0],
  [41.0412, 29.0072, 0.9],
  [41.0332, 28.9947, 0.9],
  [41.0472, 29.0262, 0.8],
  [41.0165, 28.9868, 0.8],
  [40.8765, 29.1282, 0.8],
  [41.0855, 29.0565, 0.6],
  [41.1664, 29.0585, 0.6],
  [40.9795, 29.0245, 0.6],
];

/** Mosques with pigeon flocks over their courtyards (geo landmark ids) and relative size. */
export const PIGEON_MOSQUES: readonly (readonly [string, number])[] = [
  ['yeni-cami', 1.6],
  ['sultanahmet', 1.2],
  ['suleymaniye', 1.0],
  ['beyazit-camii', 1.0],
  ['eyup-sultan', 1.1],
  ['fatih-camii', 0.8],
  ['mihrimah-uskudar', 0.9],
  ['ortakoy-camii', 0.8],
  ['ayasofya', 0.7],
  ['nuruosmaniye', 0.6],
];

/** Road deck heights (m above sea) of the bridge spans in geo.roads. */
export const BRIDGE_DECKS: Readonly<Record<string, number>> = {
  'bogazici-koprusu-yol': 66,
  'fsm-koprusu-yol': 66,
  'yss-koprusu-yol': 68,
  'galata-koprusu-yol': 8.5,
  'ataturk-koprusu-yol': 7,
  'halic-koprusu-yol': 23,
};
