/**
 * Land-use zones (lat, lon pairs). Painted in array order, later zones override earlier ones; circles are
 * painted after all polygons. Anything not covered is rural (forest, with farmland patches in the north-west).
 * Water always wins (decided by the terrain), roads/landmark pads are stamped on top.
 */
import { LandUse } from '../../../core/contracts';
import type { CircleZoneDef, ZoneDef } from '../types';
import { bosphorusAxis as axis } from './waterways';

const EUROPE_URBAN: readonly number[] = [
  40.94, 28.7, 41.14, 28.7, 41.14, 28.785, 41.132, 28.83, 41.127, 28.865, 41.114, 28.89, 41.1, 28.912, 41.097, 28.94,
  41.108, 28.955, 41.121, 28.97, 41.126, 28.995, 41.127, 29.015, 41.133, 29.03, 41.15, 29.034, 41.168, 29.04, 41.183, 29.065,
  ...axis(41.184, 41.0), 40.97, 28.99, 40.94, 28.99,
];

const ASIA_URBAN: readonly number[] = [
  ...axis(41.0, 41.144), 41.142, 29.105, 41.128, 29.118, 41.11, 29.12, 41.1, 29.13, 41.086, 29.15, 41.072, 29.165, 41.058, 29.19,
  41.05, 29.225, 41.04, 29.26, 41.03, 29.29, 41.03, 29.32, 40.84, 29.32, 40.86, 29.25, 40.88, 29.18, 40.905, 29.13, 40.94, 29.09,
  40.955, 29.03, 40.97, 28.997,
];

/** Wooded Bosphorus slopes behind the shore villages (yalı strip along the water, forest behind). */
const EUROPE_BELT: readonly number[] = [
  41.068, 29.036, 41.076, 29.034, 41.084, 29.039, 41.093, 29.037, 41.101, 29.038, 41.108, 29.041, 41.118, 29.044, 41.128, 29.042,
  41.138, 29.04, 41.148, 29.03, 41.158, 29.032, 41.17, 29.043, 41.185, 29.05, 41.2, 29.063, 41.215, 29.083, 41.24, 29.095,
  ...axis(41.224, 41.064),
];

const ASIA_BELT: readonly number[] = [
  ...axis(41.056, 41.224), 41.225, 29.17, 41.205, 29.145, 41.182, 29.113, 41.162, 29.106, 41.142, 29.116, 41.126, 29.112,
  41.112, 29.097, 41.1, 29.083, 41.088, 29.08, 41.075, 29.075, 41.062, 29.07,
];

export const ZONES: readonly ZoneDef[] = [
  { name: 'Avrupa yakası kentsel alan', use: LandUse.Urban, ll: EUROPE_URBAN },
  { name: 'Anadolu yakası kentsel alan', use: LandUse.Urban, ll: ASIA_URBAN },
  { name: 'Boğaz koruları (Avrupa)', use: LandUse.Forest, ll: EUROPE_BELT, shoreStrip: true },
  { name: 'Boğaz koruları (Anadolu)', use: LandUse.Forest, ll: ASIA_BELT, shoreStrip: true },

  // Historic cores
  {
    name: 'Suriçi (Tarihi Yarımada)',
    use: LandUse.HistoricUrban,
    ll: [
      41.0405, 28.9425, 41.0355, 28.9385, 41.0305, 28.9335, 41.0245, 28.9275, 41.0185, 28.9235, 41.0115, 28.9205, 41.0035, 28.9195,
      40.9955, 28.9205, 40.9905, 28.924, 40.99, 28.94, 40.995, 28.99, 41.02, 28.992, 41.022, 28.975, 41.027, 28.962, 41.034, 28.951,
      41.041, 28.945,
    ],
  },
  {
    name: 'Galata–Pera',
    use: LandUse.HistoricUrban,
    ll: [41.0205, 28.972, 41.0245, 28.981, 41.0275, 28.985, 41.031, 28.988, 41.0375, 28.988, 41.04, 28.978, 41.034, 28.9695, 41.0265, 28.9655, 41.022, 28.9675],
  },
  {
    name: 'Üsküdar merkez',
    use: LandUse.HistoricUrban,
    ll: [41.0175, 29.0115, 41.0305, 29.0125, 41.0315, 29.0255, 41.0255, 29.0315, 41.0165, 29.0265],
  },
  {
    name: 'Kadıköy çarşı ve Moda',
    use: LandUse.HistoricUrban,
    ll: [40.9785, 29.0205, 40.9905, 29.0205, 40.9965, 29.0255, 40.9955, 29.0345, 40.9855, 29.0355, 40.977, 29.0305],
  },
  {
    name: 'Eyüp merkez',
    use: LandUse.HistoricUrban,
    ll: [41.0425, 28.9275, 41.0505, 28.9265, 41.0535, 28.9335, 41.0485, 28.9375, 41.0435, 28.9365],
  },

  // Business districts
  {
    name: 'Zincirlikuyu–Levent–Esentepe',
    use: LandUse.Highrise,
    ll: [41.0645, 29.0045, 41.0665, 29.0165, 41.0765, 29.0175, 41.0855, 29.0155, 41.0925, 29.0115, 41.0905, 29.0015, 41.0805, 29.0005, 41.0705, 29.0015],
  },
  {
    name: 'Mecidiyeköy–Gayrettepe',
    use: LandUse.Highrise,
    ll: [41.0615, 28.9885, 41.0635, 28.9985, 41.0685, 29.0035, 41.0735, 29.0005, 41.0725, 28.9885, 41.0665, 28.9845],
  },
  {
    name: 'Maslak',
    use: LandUse.Highrise,
    ll: [41.1025, 29.0105, 41.1045, 29.0245, 41.1175, 29.0245, 41.1215, 29.0125, 41.1165, 29.0035, 41.1085, 29.0045],
  },
  {
    name: 'Ataşehir Finans',
    use: LandUse.Highrise,
    ll: [40.9765, 29.0935, 40.9775, 29.1085, 40.9905, 29.1125, 41.0015, 29.1045, 40.9985, 29.0935, 40.9885, 29.0905],
  },

  // Industry, ports and shipyards
  { name: 'Haliç Tersanesi', use: LandUse.Industrial, ll: [41.0315, 28.9635, 41.0355, 28.9685, 41.0385, 28.9625, 41.0355, 28.9555, 41.0325, 28.9575] },
  { name: 'Hasköy', use: LandUse.Industrial, ll: [41.0395, 28.9485, 41.0435, 28.9535, 41.0475, 28.9475, 41.0435, 28.9425] },
  { name: 'Kağıthane sanayi', use: LandUse.Industrial, ll: [41.0845, 28.9765, 41.0905, 28.9895, 41.0985, 28.9875, 41.0955, 28.9745, 41.0885, 28.9715] },
  { name: 'Zeytinburnu–Kazlıçeşme', use: LandUse.Industrial, ll: [40.9885, 28.9025, 40.9965, 28.9125, 41.0035, 28.9075, 40.9975, 28.8955] },
  { name: 'Topkapı sanayi', use: LandUse.Industrial, ll: [41.0135, 28.9015, 41.0175, 28.9125, 41.0255, 28.9095, 41.0215, 28.8985] },
  { name: 'Haydarpaşa Limanı', use: LandUse.Industrial, ll: [40.9945, 29.0115, 40.9985, 29.0215, 41.0035, 29.0205, 41.0025, 29.0105] },
  { name: 'İkitelli OSB', use: LandUse.Industrial, ll: [41.0605, 28.7855, 41.0655, 28.8155, 41.0845, 28.8125, 41.0855, 28.7855, 41.0755, 28.7805] },
  { name: 'Dudullu OSB', use: LandUse.Industrial, ll: [41.0035, 29.1485, 41.0055, 29.1685, 41.0205, 29.1705, 41.0215, 29.1505] },
  { name: 'Kartal sanayi', use: LandUse.Industrial, ll: [40.8985, 29.1755, 40.9005, 29.1905, 40.9095, 29.1925, 40.9095, 29.1755] },

  // Urban forests
  { name: 'Atatürk Kent Ormanı (Florya)', use: LandUse.Forest, ll: [40.9785, 28.7755, 40.9795, 28.7955, 40.9905, 28.7965, 40.9915, 28.7765] },
  { name: 'Alibeyköy barajı havzası', use: LandUse.Forest, ll: [41.098, 28.86, 41.102, 28.9, 41.112, 28.935, 41.14, 28.945, 41.165, 28.935, 41.168, 28.9, 41.15, 28.86, 41.12, 28.848] },
  { name: 'Aydos Ormanı', use: LandUse.Forest, ll: [40.9185, 29.2255, 40.9155, 29.2655, 40.9345, 29.2855, 40.9555, 29.2705, 40.9575, 29.2355, 40.9405, 29.2155] },
  { name: 'Kayışdağı', use: LandUse.Forest, ll: [40.9625, 29.1505, 40.9605, 29.1705, 40.9725, 29.1805, 40.9815, 29.1685, 40.9785, 29.1525] },
  { name: 'Elmalı barajı havzası', use: LandUse.Forest, ll: [41.052, 29.11, 41.05, 29.135, 41.065, 29.15, 41.09, 29.145, 41.092, 29.12, 41.075, 29.105] },
  { name: 'Sazlıdere havzası', use: LandUse.Forest, ll: [41.125, 28.72, 41.125, 28.76, 41.16, 28.76, 41.16, 28.72] },

  // Parks, groves, campuses
  { name: 'Sultanahmet Parkı', use: LandUse.Park, ll: [41.0077, 28.9768, 41.0083, 28.9787, 41.0068, 28.9801, 41.0058, 28.9785, 41.0062, 28.9769] },
  { name: 'İstanbul Üniversitesi bahçesi', use: LandUse.Park, ll: [41.0118, 28.9622, 41.0141, 28.9628, 41.0139, 28.9662, 41.0121, 28.9657] },
  { name: 'Gülhane Parkı', use: LandUse.Park, ll: [41.0115, 28.98, 41.0148, 28.9788, 41.0178, 28.9812, 41.0152, 28.9838, 41.0122, 28.9826] },
  { name: 'Sarayburnu Parkı', use: LandUse.Park, ll: [41.0148, 28.9838, 41.0178, 28.9812, 41.0192, 28.9855, 41.0158, 28.9885, 41.0135, 28.9862] },
  { name: 'Yıldız Parkı', use: LandUse.Park, ll: [41.0465, 29.0095, 41.0495, 29.0185, 41.0545, 29.0165, 41.0525, 29.0075] },
  { name: 'Maçka Demokrasi Parkı', use: LandUse.Park, ll: [41.0425, 28.9935, 41.0455, 28.9975, 41.0495, 28.9965, 41.0465, 28.9915] },
  { name: 'Emirgan Korusu', use: LandUse.Park, ll: [41.1015, 29.0505, 41.1055, 29.0545, 41.1115, 29.0505, 41.1085, 29.0445, 41.1035, 29.0455] },
  { name: 'Fethi Paşa Korusu', use: LandUse.Park, ll: [41.0295, 29.0195, 41.0325, 29.0265, 41.0375, 29.0255, 41.0345, 29.0175] },
  { name: 'Validebağ Korusu', use: LandUse.Park, ll: [41.0145, 29.0365, 41.0175, 29.0445, 41.0225, 29.0435, 41.0205, 29.0355] },
  { name: 'Göztepe 60. Yıl Parkı', use: LandUse.Park, ll: [40.9745, 29.0515, 40.9785, 29.0585, 40.9845, 29.0575, 40.9815, 29.0505] },
  { name: 'Fenerbahçe Parkı', use: LandUse.Park, ll: [40.9625, 29.0345, 40.9655, 29.0405, 40.9705, 29.0385, 40.9685, 29.0325] },
  { name: 'Boğaziçi Üniversitesi', use: LandUse.Park, ll: [41.0795, 29.0445, 41.0845, 29.0525, 41.0905, 29.0485, 41.0855, 29.0395] },
  { name: 'İTÜ Ayazağa', use: LandUse.Park, ll: [41.0995, 29.0185, 41.1025, 29.0305, 41.1085, 29.0285, 41.1065, 29.0175] },
  { name: 'Yenikapı meydanı', use: LandUse.Park, ll: [40.9995, 28.9445, 41.0025, 28.9595, 40.9985, 28.9615, 40.9965, 28.9475] },
  { name: 'Hidiv Korusu', use: LandUse.Park, ll: [41.1035, 29.0725, 41.1065, 29.0795, 41.1105, 29.0775, 41.1085, 29.0705] },
  { name: 'Nezahat Gökyiğit Botanik Bahçesi', use: LandUse.Park, ll: [40.9875, 29.0845, 40.9885, 29.0935, 40.9935, 29.0935, 40.9925, 29.0845] },

  // Cemeteries
  { name: 'Karacaahmet Mezarlığı', use: LandUse.Cemetery, ll: [41.0115, 29.0215, 41.0135, 29.0345, 41.0215, 29.0355, 41.0245, 29.0285, 41.0185, 29.0205] },
  { name: 'Zincirlikuyu Mezarlığı', use: LandUse.Cemetery, ll: [41.0655, 29.0125, 41.0685, 29.0195, 41.0735, 29.0175, 41.0705, 29.0105] },
  { name: 'Edirnekapı Mezarlığı', use: LandUse.Cemetery, ll: [41.0255, 28.9215, 41.0315, 28.9295, 41.0385, 28.9315, 41.0355, 28.9195, 41.0295, 28.9155] },
  { name: 'Eyüp Sultan Mezarlığı', use: LandUse.Cemetery, ll: [41.0495, 28.9315, 41.0535, 28.9365, 41.0575, 28.9335, 41.0535, 28.9275] },
  { name: 'Merkezefendi Mezarlığı', use: LandUse.Cemetery, ll: [41.0045, 28.9135, 41.0115, 28.9205, 41.0165, 28.9165, 41.0095, 28.9085] },
  { name: 'Feriköy Mezarlığı', use: LandUse.Cemetery, ll: [41.0495, 28.9795, 41.0515, 28.9835, 41.0545, 28.9815, 41.0525, 28.9775] },

  // Airport
  {
    name: 'Atatürk Havalimanı',
    use: LandUse.Airport,
    ll: [40.9665, 28.7985, 40.9655, 28.8305, 40.9885, 28.8385, 40.9985, 28.8275, 40.9975, 28.8005, 40.9855, 28.7925],
  },
];

/** Villages, towns and small green spots painted over the polygons. */
export const CIRCLE_ZONES: readonly CircleZoneDef[] = [
  // Bosphorus villages, European shore
  { name: 'Bebek', use: LandUse.Urban, lat: 41.0775, lon: 29.0425, radius: 380 },
  { name: 'Rumeli Hisarı köyü', use: LandUse.Suburban, lat: 41.0885, lon: 29.0545, radius: 220 },
  { name: 'Emirgan', use: LandUse.Suburban, lat: 41.1035, lon: 29.0545, radius: 260 },
  { name: 'İstinye', use: LandUse.Urban, lat: 41.1125, lon: 29.0515, radius: 450 },
  { name: 'Yeniköy', use: LandUse.Suburban, lat: 41.1215, lon: 29.0655, radius: 450 },
  { name: 'Tarabya', use: LandUse.Suburban, lat: 41.1385, lon: 29.0555, radius: 420 },
  { name: 'Kireçburnu', use: LandUse.Suburban, lat: 41.1465, lon: 29.0525, radius: 260 },
  { name: 'Büyükdere', use: LandUse.Urban, lat: 41.1585, lon: 29.0435, radius: 480 },
  { name: 'Sarıyer', use: LandUse.Urban, lat: 41.1665, lon: 29.0545, radius: 600 },
  { name: 'Rumeli Kavağı', use: LandUse.Suburban, lat: 41.1795, lon: 29.0735, radius: 360 },
  { name: 'Garipçe', use: LandUse.Suburban, lat: 41.2115, lon: 29.1055, radius: 200 },
  { name: 'Rumeli Feneri', use: LandUse.Suburban, lat: 41.2335, lon: 29.1085, radius: 260 },
  // Bosphorus villages, Asian shore
  { name: 'Vaniköy', use: LandUse.Suburban, lat: 41.0645, lon: 29.0595, radius: 220 },
  { name: 'Kandilli', use: LandUse.Suburban, lat: 41.0735, lon: 29.0595, radius: 260 },
  { name: 'Anadolu Hisarı köyü', use: LandUse.Suburban, lat: 41.0835, lon: 29.0695, radius: 320 },
  { name: 'Kanlıca', use: LandUse.Suburban, lat: 41.1015, lon: 29.0675, radius: 350 },
  { name: 'Çubuklu', use: LandUse.Suburban, lat: 41.1085, lon: 29.0815, radius: 300 },
  { name: 'Paşabahçe', use: LandUse.Urban, lat: 41.1175, lon: 29.0925, radius: 420 },
  { name: 'Beykoz', use: LandUse.Urban, lat: 41.1335, lon: 29.0985, radius: 620 },
  { name: 'Anadolu Kavağı', use: LandUse.Suburban, lat: 41.1745, lon: 29.0885, radius: 350 },
  { name: 'Poyrazköy', use: LandUse.Suburban, lat: 41.2065, lon: 29.1275, radius: 300 },
  { name: 'Anadolu Feneri', use: LandUse.Suburban, lat: 41.2165, lon: 29.1535, radius: 220 },
  { name: 'Riva', use: LandUse.Suburban, lat: 41.2255, lon: 29.2215, radius: 520 },
  { name: 'Polonezköy', use: LandUse.Suburban, lat: 41.1175, lon: 29.2075, radius: 480 },
  // Villages and towns in the northern forests
  { name: 'Kilyos', use: LandUse.Suburban, lat: 41.2445, lon: 29.0215, radius: 700 },
  { name: 'Zekeriyaköy', use: LandUse.Suburban, lat: 41.1985, lon: 29.0295, radius: 1200 },
  { name: 'Bahçeköy', use: LandUse.Suburban, lat: 41.1755, lon: 28.9865, radius: 600 },
  { name: 'Uskumruköy', use: LandUse.Suburban, lat: 41.2185, lon: 28.9925, radius: 420 },
  { name: 'Demirciköy', use: LandUse.Suburban, lat: 41.2375, lon: 28.9685, radius: 380 },
  { name: 'Göktürk', use: LandUse.Suburban, lat: 41.1815, lon: 28.8855, radius: 1300 },
  { name: 'Kemerburgaz', use: LandUse.Suburban, lat: 41.1605, lon: 28.9185, radius: 800 },
  { name: 'Ağaçlı', use: LandUse.Suburban, lat: 41.2505, lon: 28.8705, radius: 350 },
  { name: 'Ömerli yolu köyleri', use: LandUse.Suburban, lat: 41.0555, lon: 29.2755, radius: 700 },
  // Princes' Islands towns
  { name: 'Büyükada çarşı', use: LandUse.Suburban, lat: 40.8725, lon: 29.1265, radius: 720 },
  { name: 'Büyükada Nizam', use: LandUse.Suburban, lat: 40.8615, lon: 29.1135, radius: 380 },
  { name: 'Heybeliada çarşı', use: LandUse.Suburban, lat: 40.8795, lon: 29.0985, radius: 520 },
  { name: 'Burgazada çarşı', use: LandUse.Suburban, lat: 40.8815, lon: 29.0675, radius: 420 },
  { name: 'Kınalıada çarşı', use: LandUse.Suburban, lat: 40.9105, lon: 29.0555, radius: 460 },
  { name: 'Yassıada', use: LandUse.Suburban, lat: 40.8647, lon: 28.9921, radius: 150 },
  // Hilltop parks and small green spots
  { name: 'Büyük Çamlıca Korusu', use: LandUse.Park, lat: 41.0272, lon: 29.0668, radius: 300 },
  { name: 'Küçük Çamlıca Korusu', use: LandUse.Park, lat: 41.0158, lon: 29.0625, radius: 260 },
  { name: 'Otağtepe', use: LandUse.Park, lat: 41.0935, lon: 29.0735, radius: 280 },
  { name: 'Gezi Parkı', use: LandUse.Park, lat: 41.0385, lon: 28.9875, radius: 90 },
  { name: 'Abraham Paşa Korusu', use: LandUse.Park, lat: 41.1235, lon: 29.1015, radius: 320 },
  { name: 'Aşiyan Mezarlığı', use: LandUse.Cemetery, lat: 41.0805, lon: 29.0515, radius: 160 },
  { name: 'Kandilli Rasathanesi', use: LandUse.Park, lat: 41.0625, lon: 29.0625, radius: 200 },
];
