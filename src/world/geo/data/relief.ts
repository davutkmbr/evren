/**
 * Authored relief features layered on top of the surveyed spline (elevation-points.ts) and the
 * OSM river valleys (rivers.ts).
 */
import type { RiverValley } from './rivers';
import { bosphorusAxis, GOLDEN_HORN_AXIS } from './waterways';

/**
 * Named summits and surveyed spots whose exact elevation is enforced with a smooth bump (or dip, when the
 * spline overshoots):
 * [name, lat, lon, elevation m, radius m (across the ridge), ridge heading deg, elongation along the ridge].
 * Elongated, noise-warped bumps follow the real ridge lines instead of reading as round cones.
 */
export type Summit = readonly [name: string, lat: number, lon: number, elevation: number, radius: number, headingDeg: number, elongation: number];

export const SUMMITS: readonly Summit[] = [
  ['Büyük Çamlıca', 41.0269, 29.0678, 268, 430, 12, 1.5],
  ['Küçük Çamlıca', 41.0164, 29.0655, 229, 360, 160, 1.2],
  ['Kayışdağı', 40.9707, 29.1636, 438, 900, 150, 1.7],
  ['Aydos Dağı', 40.9315, 29.2545, 537, 1100, 35, 1.5],
  ['Alemdağ', 41.0665, 29.2094, 442, 1000, 0, 1.3],
  ['Yuşa Tepesi', 41.1618, 29.0852, 201, 400, 20, 1.3],
  ['Yücetepe (Büyükada)', 40.8485, 29.1194, 202, 360, 15, 1.5],
  ['İsa Tepesi (Büyükada)', 40.866, 29.1227, 164, 320, 15, 1.4],
  ['Hristos Tepesi (Burgazada)', 40.8778, 29.0599, 165, 330, 0, 1.1],
  ['Değirmen Tepesi (Heybeliada)', 40.875, 29.0918, 136, 330, 60, 1.3],
  ['Kınalıada Tepesi', 40.9102, 29.0487, 115, 280, 30, 1.2],
  ['Sivriada', 40.8753, 28.972, 90, 140, 0, 1],
  ['Sedef Adası', 40.8508, 29.1445, 60, 180, 30, 1.4],
  // The seven hills of the historic peninsula: knolls strung along the ridge above the Golden Horn
  ['1. tepe (Sarayburnu–Ayasofya)', 41.0112, 28.9818, 42, 330, 110, 1.4],
  ['Sultanahmet Meydanı–Hipodrom', 41.0063, 28.9768, 34, 260, 37, 1.8],
  ['2. tepe (Çemberlitaş)', 41.0087, 28.9712, 52, 300, 100, 1.5],
  ['3. tepe (Beyazıt–Süleymaniye)', 41.0118, 28.9628, 60, 360, 20, 1.5],
  ['Süleymaniye sırtı', 41.0162, 28.964, 52, 190, 20, 1.4],
  ['Şehzadebaşı', 41.0138, 28.9575, 42, 150, 120, 1.3],
  ['4. tepe (Fatih)', 41.0193, 28.9502, 64, 360, 135, 1.6],
  ['5. tepe (Yavuz Selim)', 41.0262, 28.9512, 68, 320, 150, 1.4],
  ['6. tepe (Edirnekapı)', 41.0292, 28.9365, 76, 400, 135, 1.6],
  ['7. tepe (Cerrahpaşa)', 41.0048, 28.9372, 62, 450, 80, 1.5],
  // Beyoğlu ridge (Tünel → Galatasaray → Taksim, along İstiklal Caddesi); Galata sits lower on its flank
  ['Tepebaşı–Pera sırtı', 41.0335, 28.976, 72, 330, 37, 2.2],
  ['Taksim', 41.0368, 28.9855, 84, 340, 30, 2],
  ['Galata', 41.0256, 28.9742, 40, 220, 37, 1.3],
];

/**
 * Buried or unmapped historic stream valleys that still shape the city. Floors were traced upstream from each
 * mouth along the SRTM valley bottom (research only, encoded as numbers) and made monotonic.
 * Same layout as RIVER_VALLEYS: lat, lon, floor triples, upstream -> mouth.
 */
export const BURIED_VALLEYS: readonly RiverValley[] = [
  {
    name: 'Lykos (Bayrampaşa) vadisi',
    halfWidth: 140,
    wallSlope: 0.12,
    pts: [
      41.0333, 28.9202, 61, 41.0295, 28.9205, 61, 41.0289, 28.9231, 48, 41.0293, 28.9263, 48, 41.0287, 28.9298, 48,
      41.0269, 28.9308, 43, 41.0251, 28.9322, 35, 41.0230, 28.9323, 34, 41.0205, 28.9330, 29, 41.0195, 28.9352, 25,
      41.0184, 28.9374, 23, 41.0176, 28.9399, 20, 41.0159, 28.9416, 17, 41.0149, 28.9440, 17, 41.0135, 28.9459, 16,
      41.0116, 28.9481, 12, 41.0096, 28.9476, 12, 41.0061, 28.9467, 5, 41.0048, 28.9489, 2, 41.0031, 28.9503, 0,
      41.0015, 28.9520, 0,
    ],
  },
  {
    name: 'Unkapanı–Aksaray vadisi',
    halfWidth: 60,
    wallSlope: 0.2,
    pts: [
      41.0145, 28.9534, 36, 41.0159, 28.9553, 36, 41.0167, 28.9585, 31, 41.0184, 28.9596, 18, 41.0203, 28.9611, 8,
      41.0223, 28.9611, 2, 41.0245, 28.9608, 0,
    ],
  },
  {
    name: 'Cağaloğlu–Sirkeci yamacı',
    halfWidth: 35,
    wallSlope: 0.22,
    pts: [
      41.0092, 28.9785, 35, 41.0110, 28.9772, 25, 41.0130, 28.9768, 21, 41.0150, 28.9771, 7, 41.0160, 28.9772, 0,
    ],
  },
  {
    name: 'Mahmutpaşa yokuşu',
    halfWidth: 35,
    wallSlope: 0.22,
    pts: [
      41.0096, 28.9703, 53, 41.0115, 28.9702, 41, 41.0136, 28.9698, 26, 41.0156, 28.9703, 17, 41.0165, 28.9708, 0,
    ],
  },
  {
    name: 'Dolapdere vadisi',
    halfWidth: 50,
    wallSlope: 0.25,
    pts: [
      41.0454, 28.9829, 43, 41.0435, 28.9820, 34, 41.0414, 28.9806, 26, 41.0399, 28.9783, 22, 41.0399, 28.9755, 18,
      41.0395, 28.9727, 10, 41.0381, 28.9708, 8, 41.0367, 28.9689, 5, 41.0360, 28.9680, 0,
    ],
  },
  {
    name: 'Ihlamur vadisi',
    halfWidth: 60,
    wallSlope: 0.25,
    pts: [
      41.0665, 29.0021, 117, 41.0646, 29.0012, 102, 41.0626, 29.0012, 80, 41.0606, 29.0013, 67, 41.0584, 29.0015, 40,
      41.0559, 28.9991, 26, 41.0541, 29.0002, 22, 41.0523, 29.0013, 20, 41.0503, 29.0018, 19, 41.0484, 29.0022, 12,
      41.0459, 29.0023, 12, 41.0444, 29.0040, 12, 41.0429, 29.0059, 10, 41.0420, 29.0065, 0,
    ],
  },
  {
    name: 'Küçüksu deresi',
    halfWidth: 50,
    wallSlope: 0.3,
    pts: [
      41.0642, 29.0836, 16, 41.0645, 29.0805, 14, 41.0659, 29.0785, 12, 41.0676, 29.0771, 10, 41.0693, 29.0756, 9,
      41.0707, 29.0736, 7, 41.0723, 29.0722, 6, 41.0740, 29.0707, 3, 41.0756, 29.0693, 2, 41.0778, 29.0680, 2,
      41.0785, 29.0655, 0,
    ],
  },
  {
    name: 'İstinye vadisi',
    halfWidth: 70,
    wallSlope: 0.28,
    pts: [
      41.1342, 29.0312, 68, 41.1325, 29.0328, 57, 41.1317, 29.0357, 53, 41.1300, 29.0376, 35, 41.1279, 29.0376, 25,
      41.1258, 29.0382, 25, 41.1238, 29.0400, 24, 41.1233, 29.0426, 17, 41.1224, 29.0451, 14, 41.1209, 29.0469, 10,
      41.1192, 29.0485, 1, 41.1156, 29.0487, 1, 41.1130, 29.0510, 0,
    ],
  },
  {
    name: 'Tarabya vadisi',
    halfWidth: 50,
    wallSlope: 0.3,
    pts: [
      41.1439, 29.0298, 103, 41.1435, 29.0325, 103, 41.1427, 29.0350, 80, 41.1426, 29.0377, 60, 41.1422, 29.0404, 46,
      41.1410, 29.0426, 40, 41.1400, 29.0450, 31, 41.1394, 29.0475, 18, 41.1388, 29.0500, 14, 41.1380, 29.0527, 4,
      41.1383, 29.0554, 0, 41.1380, 29.0580, 0,
    ],
  },
  {
    name: 'Büyükdere–Bahçeköy vadisi',
    halfWidth: 90,
    wallSlope: 0.25,
    pts: [
      41.1691, 28.9996, 46, 41.1677, 29.0017, 44, 41.1670, 29.0042, 37, 41.1665, 29.0070, 36, 41.1651, 29.0088, 25,
      41.1637, 29.0106, 25, 41.1622, 29.0124, 17, 41.1611, 29.0146, 17, 41.1602, 29.0171, 13, 41.1587, 29.0189, 9,
      41.1573, 29.0207, 9, 41.1556, 29.0223, 8, 41.1543, 29.0247, 6, 41.1537, 29.0275, 0, 41.1533, 29.0320, 0,
      41.1550, 29.0333, 0, 41.1572, 29.0346, 0, 41.1580, 29.0370, 0, 41.1584, 29.0396, 0, 41.1589, 29.0424, 0,
      41.1585, 29.0450, 0,
    ],
  },
  {
    name: 'Kasımpaşa deresi',
    halfWidth: 70,
    wallSlope: 0.22,
    pts: [
      41.0610, 28.9800, 73, 41.0544, 28.9707, 38, 41.0467, 28.9683, 23, 41.0396, 28.9669, 11, 41.0355, 28.9662, 5,
      41.0335, 28.9652, 0,
    ],
  },
  {
    name: 'Baltalimanı deresi',
    halfWidth: 50,
    wallSlope: 0.28,
    pts: [
      41.1000, 29.0300, 36, 41.1007, 29.0424, 12, 41.0975, 29.0520, 5, 41.0975, 29.0555, 0,
    ],
  },
];

/**
 * Sea depth control points (positive meters): Bosphorus thalweg (sills near Kabataş and the Black Sea
 * entrance, ~110 m trough off Bebek/Kandilli), the Golden Horn shoaling toward Eyüp, the Marmara shelf
 * deepening south of the Islands and the Black Sea shelf. [lat, lon, depth].
 */
export const BATHYMETRY: readonly (readonly [number, number, number])[] = [
  // Bosphorus, south to north (mid-channel points)
  [41.0040, 28.9978, 55],
  [41.0160, 28.9987, 42],
  [41.0280, 29.0017, 34],
  [41.0360, 29.0113, 45],
  [41.0440, 29.0305, 62],
  [41.0560, 29.0441, 78],
  [41.0680, 29.0517, 108],
  [41.0760, 29.0531, 100],
  [41.0840, 29.0619, 72],
  [41.0960, 29.0595, 68],
  [41.1080, 29.0705, 60],
  [41.1200, 29.0835, 62],
  [41.1320, 29.0776, 58],
  [41.1480, 29.0680, 55],
  [41.1640, 29.0680, 62],
  [41.1800, 29.0826, 72],
  [41.2000, 29.1045, 62],
  [41.2200, 29.1347, 70],
  // Black Sea shelf
  [41.2600, 29.1400, 82],
  [41.2600, 29.0200, 48],
  [41.2600, 28.8800, 45],
  [41.2600, 29.2600, 68],
  [41.2450, 29.1900, 60],
  // Golden Horn, mouth to head
  [41.0215, 28.9760, 38],
  [41.0275, 28.9640, 26],
  [41.0340, 28.9520, 16],
  [41.0415, 28.9440, 10],
  [41.0480, 28.9395, 5],
  [41.0560, 28.9440, 2.5],
  // Marmara, off the historic peninsula and the European shore
  [41.0000, 28.9700, 45],
  [40.9920, 28.9450, 38],
  [40.9800, 28.9100, 28],
  [40.9650, 28.8800, 40],
  [40.9550, 28.8400, 30],
  [40.9480, 28.8000, 42],
  [40.9350, 28.7600, 60],
  [40.9100, 28.9000, 75],
  [40.9000, 28.7500, 95],
  [40.8700, 28.8200, 120],
  [40.8400, 28.7500, 190],
  [40.8350, 28.9000, 220],
  // Around the Islands and off the Asian shore
  [40.9900, 29.0050, 22],
  [40.9750, 29.0180, 32],
  [40.9550, 29.0350, 52],
  [40.9350, 29.0700, 55],
  [40.9300, 29.1100, 42],
  [40.9050, 29.1500, 36],
  [40.8800, 29.2000, 42],
  [40.8650, 29.2600, 52],
  [40.8950, 29.0950, 45],
  [40.8700, 29.0300, 70],
  [40.8550, 29.0800, 85],
  [40.8350, 29.0400, 190],
  [40.8350, 29.1200, 160],
  [40.8350, 29.2000, 150],
  [40.8350, 29.2900, 110],
  [40.8700, 28.9500, 95],
];

/**
 * Channels where the sea floor drops steeply right off the quays (Bosphorus, Golden Horn): polygons
 * (lat, lon pairs) with a short underwater shore ramp. Elsewhere the shelf slopes gently.
 */
export const STEEP_CHANNELS: readonly (readonly number[])[] = [
  [
    41.0020, 28.9880, 41.0180, 28.9950, 41.0320, 29.0020, 41.0440, 29.0200, 41.0600, 29.0330, 41.0750, 29.0420,
    41.0900, 29.0500, 41.1100, 29.0530, 41.1300, 29.0540, 41.1520, 29.0480, 41.1720, 29.0620, 41.1950, 29.0830,
    41.2230, 29.1070, 41.2330, 29.1500, 41.2050, 29.1330, 41.1750, 29.1030, 41.1450, 29.1030, 41.1150, 29.0930,
    41.0880, 29.0760, 41.0620, 29.0660, 41.0420, 29.0520, 41.0250, 29.0270, 41.0080, 29.0200, 40.9980, 29.0080,
  ],
  [
    41.0170, 28.9760, 41.0230, 28.9570, 41.0380, 28.9380, 41.0600, 28.9360, 41.0640, 28.9520, 41.0460, 28.9540,
    41.0320, 28.9700, 41.0250, 28.9840,
  ],
];

/** Sandy shores: [name, lat, lon, stretch radius m, sand width m]. */
export const BEACHES: readonly (readonly [string, number, number, number, number])[] = [
  ['Florya Güneş Plajı', 40.9695, 28.7880, 900, 45],
  ['Menekşe', 40.9775, 28.7665, 500, 30],
  ['Yeşilköy', 40.9570, 28.8260, 600, 22],
  ['Caddebostan', 40.9625, 29.0620, 700, 40],
  ['Suadiye', 40.9555, 29.0800, 700, 35],
  ['Bostancı–Maltepe dolgusu', 40.9380, 29.1150, 900, 25],
  ['Kilyos', 41.2470, 29.0180, 1500, 70],
  ['Kilyos batı', 41.2530, 28.9900, 1200, 55],
  ['Uzunya', 41.2600, 28.9600, 900, 45],
  ['Riva', 41.2290, 29.2230, 1100, 80],
  ['Şile yolu kumsalı', 41.2230, 29.2700, 1500, 55],
  ['Rumeli Feneri', 41.2350, 29.1050, 350, 25],
  ['Poyrazköy', 41.2080, 29.1300, 300, 20],
  ['Büyükada Yörükali', 40.8560, 29.1380, 300, 22],
  ['Büyükada Nakibey', 40.8640, 29.1010, 250, 20],
  ['Heybeliada Değirmenburnu', 40.8770, 29.1060, 250, 18],
  ['Burgazada Kalpazankaya', 40.8750, 29.0510, 220, 15],
  ['Kınalıada', 40.9120, 29.0590, 250, 15],
  ['Küçükçekmece gölü kıyısı', 41.0150, 28.7700, 800, 18],
];

/**
 * Low shore flats: quays, coastal roads and reclaimed or alluvial ground that sit at a few metres above the
 * water before the hills rise (Eminönü, Tophane, Dolmabahçe, Üsküdar, Kadıköy, the yalı strips...).
 * Only lowers the terrain. The band is measured inland from the real shoreline (coast distance), the
 * polyline only selects where it applies.
 */
export interface ShoreFlat {
  name: string;
  /** Selection polyline, flat lat, lon pairs roughly along the shore. */
  ll: readonly number[];
  /** Cells within this distance (m) of the polyline are affected; the effect fades over the outer 40 %. */
  reach: number;
  /** Width (m) of the flat band inland from the shoreline. */
  width: number;
  /** Ground elevation at the waterline (m). */
  level: number;
  /** Rise across the flat band (m per m). */
  rise: number;
  /** Slope of the ground rising behind the band (m per m). */
  wallSlope: number;
}

export const SHORE_FLATS: readonly ShoreFlat[] = [
  { name: 'Boğaz kıyı şeridi', ll: bosphorusAxis(41.0, 41.182), reach: 2800, width: 35, level: 1.8, rise: 0.02, wallSlope: 0.35 },
  { name: 'Haliç kıyı şeridi', ll: GOLDEN_HORN_AXIS, reach: 1000, width: 45, level: 2, rise: 0.02, wallSlope: 0.3 },
  {
    name: 'Eminönü–Sirkeci', reach: 500, width: 190, level: 2.5, rise: 0.012, wallSlope: 0.2,
    ll: [41.0232, 28.9618, 41.0205, 28.9668, 41.018, 28.9712, 41.017, 28.976, 41.0168, 28.98],
  },
  {
    name: 'Karaköy–Tophane–Fındıklı', reach: 450, width: 190, level: 2.5, rise: 0.01, wallSlope: 0.3,
    ll: [41.0222, 28.97, 41.024, 28.9765, 41.0262, 28.9815, 41.029, 28.9865, 41.0322, 28.9912, 41.0345, 28.9948],
  },
  {
    name: 'Dolmabahçe–Beşiktaş', reach: 500, width: 260, level: 2.5, rise: 0.012, wallSlope: 0.16,
    ll: [41.035, 28.996, 41.0375, 28.999, 41.04, 29.003, 41.042, 29.007, 41.0432, 29.01],
  },
  {
    name: 'Çırağan–Ortaköy', reach: 400, width: 110, level: 2.2, rise: 0.015, wallSlope: 0.22,
    ll: [41.0428, 29.011, 41.0438, 29.016, 41.0452, 29.021, 41.047, 29.0255, 41.049, 29.028],
  },
  { name: 'Bebek koyu', reach: 400, width: 120, level: 2.2, rise: 0.015, wallSlope: 0.22, ll: [41.0745, 29.043, 41.077, 29.044, 41.0795, 29.0445] },
  { name: 'İstinye koyu', reach: 500, width: 150, level: 2.2, rise: 0.015, wallSlope: 0.18, ll: [41.1105, 29.054, 41.1135, 29.0545, 41.115, 29.057] },
  {
    name: 'Büyükdere–Sarıyer', reach: 450, width: 140, level: 2.2, rise: 0.015, wallSlope: 0.2,
    ll: [41.1545, 29.047, 41.1575, 29.044, 41.161, 29.045, 41.165, 29.052, 41.1675, 29.057],
  },
  {
    name: 'Paşabahçe–Beykoz', reach: 500, width: 150, level: 2.2, rise: 0.015, wallSlope: 0.18,
    ll: [41.115, 29.089, 41.119, 29.093, 41.125, 29.096, 41.131, 29.0975, 41.136, 29.0985],
  },
  {
    name: 'Küçüksu–Anadolu Hisarı', reach: 380, width: 150, level: 2.3, rise: 0.015, wallSlope: 0.2,
    ll: [41.077, 29.064, 41.08, 29.0655, 41.0835, 29.068, 41.0852, 29.0685],
  },
  { name: 'Kuleli', reach: 300, width: 110, level: 2.2, rise: 0.015, wallSlope: 0.25, ll: [41.0575, 29.0525, 41.0595, 29.0545] },
  { name: 'Çengelköy', reach: 350, width: 90, level: 2.2, rise: 0.015, wallSlope: 0.25, ll: [41.0495, 29.0505, 41.052, 29.052] },
  { name: 'Beylerbeyi', reach: 350, width: 110, level: 2.2, rise: 0.015, wallSlope: 0.22, ll: [41.041, 29.0385, 41.043, 29.04, 41.045, 29.042] },
  { name: 'Kuzguncuk', reach: 300, width: 100, level: 2.2, rise: 0.015, wallSlope: 0.22, ll: [41.0345, 29.0285, 41.0365, 29.03] },
  {
    name: 'Üsküdar', reach: 420, width: 230, level: 2.8, rise: 0.015, wallSlope: 0.12,
    ll: [41.0232, 29.0112, 41.025, 29.0118, 41.0275, 29.014, 41.0295, 29.017],
  },
  {
    name: 'Harem–Haydarpaşa', reach: 400, width: 140, level: 2.5, rise: 0.012, wallSlope: 0.2,
    ll: [41.011, 29.011, 41.006, 29.012, 41.001, 29.015, 40.9975, 29.0175],
  },
  {
    name: 'Kadıköy çarşı', reach: 500, width: 300, level: 2.8, rise: 0.02, wallSlope: 0.08,
    ll: [40.9935, 29.0225, 40.9905, 29.023, 40.9875, 29.0235, 40.9845, 29.0245],
  },
  {
    name: 'Unkapanı–Balat–Ayvansaray', reach: 400, width: 170, level: 2.8, rise: 0.012, wallSlope: 0.22,
    ll: [41.025, 28.96, 41.0285, 28.9545, 41.032, 28.9495, 41.0355, 28.946, 41.039, 28.943, 41.041, 28.9415],
  },
  { name: 'Kasımpaşa', reach: 450, width: 200, level: 2.5, rise: 0.015, wallSlope: 0.15, ll: [41.033, 28.966, 41.0355, 28.965] },
  { name: 'Hasköy–Sütlüce', reach: 350, width: 90, level: 2.5, rise: 0.015, wallSlope: 0.2, ll: [41.0395, 28.9505, 41.043, 28.946, 41.047, 28.9425] },
  { name: 'Eyüp', reach: 550, width: 280, level: 3, rise: 0.015, wallSlope: 0.12, ll: [41.0455, 28.9355, 41.048, 28.9345, 41.0505, 28.9365] },
  {
    name: 'Kumkapı–Yenikapı–Samatya', reach: 450, width: 140, level: 2.5, rise: 0.02, wallSlope: 0.14,
    ll: [41.0035, 28.976, 41.002, 28.969, 41.0005, 28.962, 40.9995, 28.954, 40.9985, 28.946, 40.9965, 28.938, 40.9935, 28.929],
  },
  {
    name: 'Bostancı–Maltepe–Kartal dolgusu', reach: 500, width: 180, level: 2.5, rise: 0.01, wallSlope: 0.05,
    ll: [40.9545, 29.098, 40.944, 29.115, 40.934, 29.132, 40.922, 29.148, 40.911, 29.162, 40.9, 29.178, 40.89, 29.19],
  },
  { name: 'Büyükada iskele', reach: 350, width: 90, level: 2.2, rise: 0.02, wallSlope: 0.15, ll: [40.8745, 29.1265, 40.8765, 29.129, 40.8775, 29.1315] },
  { name: 'Heybeliada iskele', reach: 300, width: 80, level: 2.2, rise: 0.02, wallSlope: 0.15, ll: [40.8785, 29.0985, 40.8795, 29.101] },
];
