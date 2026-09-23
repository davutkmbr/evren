/**
 * Fortress plans. Rings from OpenStreetMap (© OpenStreetMap contributors, ODbL: Rumeli Hisarı relation 7318154,
 * Yedikule relation 20318937, Anadolu Hisarı relation 13234926), tower sizes from the Turkish Ministry of Culture /
 * Sarıyer municipality fact sheets (Saruca Paşa: Ø 23.3 m, 28 m; Zağanos Paşa: Ø 26.7 m, 21 m; Halil Paşa: Ø 23.3 m, 22 m).
 */

export interface TowerSpot {
  name?: string;
  lat: number;
  lon: number;
  /** Radius (m); 0 for square pylons. */
  r: number;
  /** Height above the local ground (m). */
  h?: number;
}

/** Rumeli Hisarı: inner face of the curtain wall (courtyard side), open ring, south → west → north → east. */
export const RUMELI_CURTAIN: readonly number[] = [
  41.084031, 29.05553, 41.084331, 29.055725, 41.084427, 29.055753, 41.084601, 29.055713, 41.084781, 29.055701, 41.084967, 29.05572,
  41.085268, 29.055773, 41.085569, 29.055801, 41.085818, 29.055735, 41.085867, 29.055864, 41.085878, 29.05598, 41.085874, 29.056045,
  41.085862, 29.056104, 41.085725, 29.056233, 41.085775, 29.056285, 41.085782, 29.05633, 41.085766, 29.056373, 41.085622, 29.056366,
  41.085195, 29.056295, 41.085033, 29.056422, 41.084899, 29.056662, 41.084675, 29.056622, 41.084508, 29.05668, 41.083864, 29.056662,
  41.083905, 29.056431, 41.083925, 29.056197, 41.083958, 29.056071, 41.083986, 29.05601, 41.083997, 29.055944, 41.083996, 29.055778,
  41.083968, 29.055707, 41.083939, 29.055671, 41.083983, 29.055642, 41.084006, 29.05561,
];

export const RUMELI_GREAT_TOWERS: readonly TowerSpot[] = [
  { name: 'saruca', lat: 41.085935, lon: 29.055757, r: 11.65, h: 28 },
  { name: 'halil', lat: 41.084872, lon: 29.056602, r: 11.65, h: 22 },
  { name: 'zaganos', lat: 41.083909, lon: 29.055506, r: 13.35, h: 21 },
];

export const RUMELI_SMALL_TOWERS: readonly TowerSpot[] = [
  { lat: 41.083882, lon: 29.056709, r: 4.2 },
  { lat: 41.084183, lon: 29.056698, r: 4.4 },
  { lat: 41.084503, lon: 29.056698, r: 4.4 },
  { lat: 41.085034, lon: 29.056507, r: 5.0 },
  { lat: 41.085777, lon: 29.05634, r: 3.2 },
  { lat: 41.085503, lon: 29.055757, r: 4.6 },
  { lat: 41.085205, lon: 29.055727, r: 4.2 },
  { lat: 41.084917, lon: 29.055703, r: 4.2 },
  { lat: 41.084683, lon: 29.055691, r: 4.6 },
  { lat: 41.084341, lon: 29.055703, r: 4.5 },
];

/** Yedikule: outer face of the pentagonal enclosure (the west side is the Theodosian land wall with the Golden Gate). */
export const YEDIKULE_RING: readonly number[] = [
  40.993944, 28.923325, 40.993944, 28.923379, 40.993632, 28.923674, 40.993381, 28.924107, 40.993336, 28.924149, 40.993005, 28.92396,
  40.992536, 28.923911, 40.992525, 28.923899, 40.992448, 28.923354, 40.992271, 28.922893, 40.99221, 28.922851, 40.992129, 28.922524,
  40.992793, 28.922704, 40.993722, 28.922328, 40.993771, 28.92227, 40.993813, 28.92295, 40.993951, 28.923301,
];

/** Yedikule towers: three round Ottoman towers (n, e, s), two Byzantine wall towers, the Golden Gate marble pylons. */
export const YEDIKULE_TOWERS: readonly TowerSpot[] = [
  { name: 'n', lat: 40.994025, lon: 28.923331, r: 10.0, h: 27 },
  { name: 'e', lat: 40.993332, lon: 28.924093, r: 10.0, h: 26 },
  { name: 's', lat: 40.992503, lon: 28.923926, r: 10.0, h: 26 },
  { name: 'sw', lat: 40.992116, lon: 28.922533, r: 0, h: 20 },
  { name: 'nw', lat: 40.993755, lon: 28.922295, r: 0, h: 20 },
  { name: 'gg-s', lat: 40.992864, lon: 28.92267, r: 0, h: 20 },
  { name: 'gg-n', lat: 40.993044, lon: 28.922598, r: 0, h: 20 },
];

/** Anadolu Hisarı: the keep (Hisarpeçe); the citadel walls are laid out around it by the builder. */
export const ANADOLU_KEEP: readonly number[] = [41.082162, 29.06712, 41.082067, 29.067102, 41.082079, 29.06699, 41.082174, 29.067006];
