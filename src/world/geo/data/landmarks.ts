/**
 * Landmark catalogue. Positions from OpenStreetMap features (building centroids, bridge decks, wall ways),
 * orientations from the minimum-area rectangle of each mosque footprint (the side closest to the qibla),
 * heights/years from public references. Anchors are flat lat, lon pairs.
 *
 * Anchor conventions:
 * - Bosphorus bridges: [towerEurope, towerAsia, endEurope, endAsia]
 * - Golden Horn bridges: [towerNorth, towerSouth, endNorth, endSouth] (main piers/pylons for girder and bascule bridges)
 * - kara-surlari / bozdogan-kemeri: wall/aqueduct polyline, south→north / west→east
 * - topkapi-sarayi: outer wall (Sur-ı Sultani + sea walls) polygon
 * - skyscraper clusters: one anchor per notable tower, heights in `anchorHeights`
 *
 * `radius` is the disc around (lat, lon) kept free of procedural buildings. For extended landmarks (bridges,
 * walls, aqueduct, tower clusters) it stays small on purpose — their full extent is given by the anchors, and
 * the land-use grid (LandUse.Landmark / Road, buildableAt) reserves the real corridor or per-tower pads.
 */
import type { LandmarkData } from '../types';

const MOSQUES: LandmarkData[] = [
  {
    id: 'ayasofya', name: 'Ayasofya-i Kebir Camii', kind: 'mosque', builder: 'mosques', lat: 41.0085, lon: 28.98, headingDeg: 123.8, radius: 85, height: 60, year: 537,
    info: "I. Justinianus'un 537'de tamamlattığı dev kubbeli bazilika; 1453'te camiye dönüştürüldü. 55,6 m yüksekliğindeki kubbesi yaklaşık bin yıl dünyanın en büyük kubbesiydi.",
  },
  {
    id: 'sultanahmet', name: 'Sultanahmet Camii', kind: 'mosque', builder: 'mosques', lat: 41.00538, lon: 28.97685, headingDeg: 133.9, radius: 80, height: 64, year: 1617,
    info: "Sultan I. Ahmed için Sedefkâr Mehmed Ağa'nın yaptığı altı minareli cami. İç mekânı kaplayan İznik çinileri yüzünden dünyada 'Mavi Cami' olarak bilinir.",
  },
  {
    id: 'suleymaniye', name: 'Süleymaniye Camii', kind: 'mosque', builder: 'mosques', lat: 41.01623, lon: 28.96395, headingDeg: 137.7, radius: 78, height: 76, year: 1557,
    info: "Kanuni Sultan Süleyman için Mimar Sinan'ın yaptığı külliyenin kalbi; Haliç'e hâkim üçüncü tepede yükselir. Sinan'ın 'kalfalık eserim' dediği yapıdır.",
  },
  {
    id: 'yeni-cami', name: 'Yeni Cami', kind: 'mosque', builder: 'mosques', lat: 41.01695, lon: 28.97211, headingDeg: 139, radius: 52, height: 62, year: 1665,
    info: "Eminönü meydanında Safiye Sultan'ın başlattığı, Turhan Hatice Sultan'ın 1665'te tamamlattığı cami; Mısır Çarşısı ile aynı külliyenin parçasıdır.",
  },
  {
    id: 'fatih-camii', name: 'Fatih Camii', kind: 'mosque', builder: 'mosques', lat: 41.01982, lon: 28.94988, headingDeg: 142.9, radius: 62, height: 62, year: 1771,
    info: "Fatih Sultan Mehmed'in 1470'te tamamlattığı ilk külliye 1766 depreminde yıkıldı; bugünkü cami III. Mustafa döneminde 1771'de yeniden inşa edildi.",
  },
  {
    id: 'yavuz-selim-camii', name: 'Yavuz Sultan Selim Camii', kind: 'mosque', builder: 'mosques', lat: 41.02663, lon: 28.95146, headingDeg: 138.9, radius: 52, height: 51, year: 1522,
    info: "Kanuni'nin babası Yavuz Sultan Selim adına Haliç'e bakan beşinci tepede yaptırdığı, tek kubbeli sade ve zarif cami.",
  },
  {
    id: 'mihrimah-edirnekapi', name: 'Mihrimah Sultan Camii (Edirnekapı)', kind: 'mosque', builder: 'mosques', lat: 41.02942, lon: 28.93557, headingDeg: 138.3, radius: 62, height: 50, year: 1565,
    info: "Mimar Sinan'ın Kanuni'nin kızı Mihrimah Sultan için şehrin en yüksek tepesinde, Edirnekapı surlarının dibinde yaptığı, yüzlerce penceresiyle ışıkla dolan cami.",
  },
  {
    id: 'nuruosmaniye', name: 'Nuruosmaniye Camii', kind: 'mosque', builder: 'mosques', lat: 41.01043, lon: 28.97028, headingDeg: 134, radius: 45, height: 50, year: 1755,
    info: "Kapalıçarşı'nın kapısında yükselen, Osmanlı barok üslubunun ilk büyük örneği; I. Mahmud başlattı, III. Osman 1755'te tamamlattı.",
  },
  {
    id: 'sehzade', name: 'Şehzade Camii', kind: 'mosque', builder: 'mosques', lat: 41.01383, lon: 28.95716, headingDeg: 138.1, radius: 55, height: 55, year: 1548,
    info: "Kanuni'nin genç yaşta ölen oğlu Şehzade Mehmed anısına Mimar Sinan'ın yaptığı ilk büyük selatin camisi; Sinan'ın 'çıraklık eserim' dediği yapı.",
  },
  {
    id: 'beyazit-camii', name: 'Beyazıt Camii', kind: 'mosque', builder: 'mosques', lat: 41.01028, lon: 28.96539, headingDeg: 140.6, radius: 62, height: 55, year: 1506,
    info: "II. Bayezid'in yaptırdığı, İstanbul'da günümüze ulaşan en eski selatin camisi; Kapalıçarşı ile İstanbul Üniversitesi arasındaki meydandadır.",
  },
  {
    id: 'eyup-sultan', name: 'Eyüp Sultan Camii', kind: 'mosque', builder: 'mosques', lat: 41.04801, lon: 28.93375, headingDeg: 147.3, radius: 42, height: 50, year: 1800,
    info: "Ebu Eyyub el-Ensari'nin türbesinin yanındaki cami; ilk yapı 1458'de Fatih tarafından yaptırıldı, bugünkü bina III. Selim döneminde 1800'de yenilendi.",
  },
  {
    id: 'ortakoy-camii', name: 'Büyük Mecidiye Camii (Ortaköy)', kind: 'mosque', builder: 'mosques', lat: 41.04729, lon: 29.02677, headingDeg: 141.2, radius: 28, height: 40, year: 1856,
    info: "Boğaz kıyısında, 15 Temmuz Şehitler Köprüsü'nün hemen yanındaki neobarok cami; Sultan Abdülmecid için Nikoğos Balyan tasarladı.",
  },
  {
    id: 'camlica-camii', name: 'Büyük Çamlıca Camii', kind: 'mosque', builder: 'mosques', lat: 41.03414, lon: 29.07052, headingDeg: 151.7, radius: 105, height: 107.1, year: 2019,
    info: "Çamlıca Tepesi'nde 2019'da açılan Türkiye'nin en büyük camisi; 107,1 m'lik dört minaresi ve 72 m yüksekliğindeki kubbesiyle Üsküdar siluetine hâkimdir.",
  },
  {
    id: 'mihrimah-uskudar', name: 'Mihrimah Sultan Camii (İskele Camii)', kind: 'mosque', builder: 'mosques', lat: 41.02682, lon: 29.01597, headingDeg: 139.5, radius: 36, height: 45, year: 1548,
    info: "Üsküdar iskelesinin karşısında Mimar Sinan'ın Mihrimah Sultan için yaptığı cami; denize bakan geniş son cemaat revakıyla tanınır.",
  },
  {
    id: 'yeni-valide-uskudar', name: 'Yeni Valide Camii', kind: 'mosque', builder: 'mosques', lat: 41.02479, lon: 29.01515, headingDeg: 135.4, radius: 40, height: 45, year: 1710,
    info: "III. Ahmed'in annesi Gülnuş Emetullah Sultan için yaptırılan, Üsküdar meydanındaki cami ve külliye; kafesli türbesiyle bilinir.",
  },
  {
    id: 'semsi-pasa', name: 'Şemsi Paşa Camii', kind: 'mosque', builder: 'mosques', lat: 41.02594, lon: 29.01135, headingDeg: 135.2, radius: 16, height: 25, year: 1580,
    info: "Mimar Sinan'ın Üsküdar sahilinde denize sıfır yaptığı küçük ve zarif cami; üzerine kuş konmadığı söylendiği için 'Kuşkonmaz Camii' diye de anılır.",
  },
  {
    id: 'kilic-ali-pasa', name: 'Kılıç Ali Paşa Camii', kind: 'mosque', builder: 'mosques', lat: 41.02642, lon: 28.98096, headingDeg: 130.7, radius: 28, height: 40, year: 1580,
    info: "Tophane'de Kaptan-ı Derya Kılıç Ali Paşa için Mimar Sinan'ın yaptığı, Ayasofya'nın planını küçük ölçekte yorumlayan külliye camisi.",
  },
  {
    id: 'nusretiye', name: 'Nusretiye Camii', kind: 'mosque', builder: 'mosques', lat: 41.02741, lon: 28.98315, headingDeg: 183.1, radius: 30, height: 48, year: 1826,
    info: "II. Mahmud'un Yeniçeri Ocağı'nın kaldırılmasının ardından 'zafer' anlamıyla adlandırdığı, Kirkor Balyan'ın yaptığı ampir üsluplu Tophane camisi.",
  },
  {
    id: 'dolmabahce-camii', name: 'Dolmabahçe Camii', kind: 'mosque', builder: 'mosques', lat: 41.03677, lon: 28.99523, headingDeg: 147.5, radius: 34, height: 45, year: 1855,
    info: "Dolmabahçe Sarayı'nın yanında Bezm-i Âlem Valide Sultan'ın başlattığı, Sultan Abdülmecid'in 1855'te tamamlattığı barok-ampir cami.",
  },
  {
    id: 'taksim-camii', name: 'Taksim Camii', kind: 'mosque', builder: 'mosques', lat: 41.037, lon: 28.98402, headingDeg: 183.5, radius: 52, height: 50, year: 2021,
    info: "Taksim Meydanı'nın kuzeybatı köşesinde 2021'de açılan, Beyoğlu siluetine eklenen kubbeli cami.",
  },
  {
    id: 'kucuk-ayasofya', name: 'Küçük Ayasofya Camii', kind: 'mosque', builder: 'mosques', lat: 41.00273, lon: 28.9722, headingDeg: 195.6, radius: 30, height: 25, year: 536,
    info: "Justinianus'un 527-536 arasında yaptırdığı Aziz Sergios ve Bakhos Kilisesi; 16. yüzyılın başında camiye dönüştürüldü, Ayasofya'nın 'küçük kardeşi' diye anılır.",
  },
];

// Bridge anchors: [main pier A, main pier B, deck end A, deck end B]. Bridges crossing the OSM slice are fitted to the
// OSM ways they carry (node scripts/data/fit-bridge-anchors.mjs), so their decks line up with the streets they join.
const STRUCTURES: LandmarkData[] = [
  {
    id: 'bogazici-koprusu', name: '15 Temmuz Şehitler Köprüsü', kind: 'bridge', builder: 'structures', lat: 41.04546, lon: 29.03433, headingDeg: 141.8, radius: 560, height: 165, year: 1973,
    footprint: 'none',
    anchors: [41.04932, 29.03031, 41.04176, 29.03817, 41.05095, 29.02861, 41.03996, 29.04005],
    info: "Ortaköy ile Beylerbeyi arasında Avrupa ile Asya'yı ilk kez birleştiren asma köprü; 1.074 m ana açıklığı ve 165 m'lik kuleleriyle 1973'te açıldı.",
  },
  {
    id: 'fsm-koprusu', name: 'Fatih Sultan Mehmet Köprüsü', kind: 'bridge', builder: 'structures', lat: 41.09138, lon: 29.0613, headingDeg: 86.5, radius: 560, height: 110, year: 1988,
    footprint: 'none',
    anchors: [41.09108, 29.05482, 41.09168, 29.06777, 41.09107, 29.05453, 41.09169, 29.06806],
    info: "Rumeli Hisarı ile Kavacık arasında, Boğaz'ın en dar yerinin hemen kuzeyinde uzanan ikinci asma köprü; 1.090 m ana açıklığa sahiptir.",
  },
  {
    id: 'yss-koprusu', name: 'Yavuz Sultan Selim Köprüsü', kind: 'bridge', builder: 'structures', lat: 41.20297, lon: 29.11167, headingDeg: 121, radius: 720, height: 322, year: 2016,
    footprint: 'none',
    anchors: [41.20623, 29.10448, 41.19971, 29.11885, 41.20756, 29.10156, 41.19838, 29.12177],
    info: "Garipçe ile Poyrazköy arasında Karadeniz girişindeki üçüncü köprü; 322 m'lik kuleleri ve 1.408 m ana açıklığıyla karma asma-eğik askılı bir yapıdır.",
  },
  {
    id: 'galata-koprusu', name: 'Galata Köprüsü', kind: 'bridge', builder: 'structures', lat: 41.02001, lon: 28.97329, headingDeg: 208.7, radius: 240, height: 14, year: 1994,
    footprint: 'none',
    anchors: [41.020371, 28.973427, 41.019729, 28.972962, 41.021859, 28.974503, 41.018217, 28.971868],
    info: "Karaköy ile Eminönü'nü bağlayan, alt katındaki lokantaları ve üstündeki oltacılarıyla ünlü açılır kapanır köprü; bugünkü köprü 1994'te tamamlanan beşincisidir.",
  },
  {
    id: 'ataturk-koprusu', name: 'Atatürk Köprüsü', kind: 'bridge', builder: 'structures', lat: 41.02423, lon: 28.96512, headingDeg: 238.3, radius: 260, height: 12, year: 1940,
    footprint: 'none',
    anchors: [41.024363, 28.965498, 41.024029, 28.96478, 41.025396, 28.967719, 41.022999, 28.962563],
    info: "Azapkapı ile Unkapanı arasında Haliç'i geçen köprü; 1940'ta hizmete girdi, halk arasında Unkapanı Köprüsü diye bilinir.",
  },
  {
    id: 'halic-metro-koprusu', name: 'Haliç Metro Köprüsü', kind: 'bridge', builder: 'structures', lat: 41.02242, lon: 28.96645, headingDeg: 216, radius: 250, height: 65, year: 2014,
    footprint: 'none',
    anchors: [41.023091, 28.967058, 41.021782, 28.965797, 41.024248, 28.968174, 41.020621, 28.964678],
    info: "M2 metro hattını Haliç üzerinden geçiren eğik askılı köprü; 65 m'lik iki pilonu ve ortasındaki Haliç istasyonuyla 2014'te açıldı.",
  },
  {
    id: 'halic-koprusu', name: 'Haliç Köprüsü', kind: 'bridge', builder: 'structures', lat: 41.04364, lon: 28.94203, headingDeg: 211.9, radius: 320, height: 22, year: 1974,
    footprint: 'none',
    anchors: [41.04407, 28.94238, 41.04322, 28.94168, 41.04743, 28.94515, 41.03986, 28.93891],
    info: "Halıcıoğlu ile Ayvansaray arasında çevre yolunu Haliç'in üzerinden geçiren 995 m uzunluğundaki karayolu köprüsü.",
  },
  {
    id: 'galata-kulesi', name: 'Galata Kulesi', kind: 'tower', builder: 'structures', lat: 41.02563, lon: 28.97421, headingDeg: 0, radius: 24, height: 67, year: 1348,
    info: "Cenevizlilerin 1348'de yaptığı 'İsa Kulesi'; konik külahıyla Beyoğlu siluetinin simgesi. Hezarfen Ahmed Çelebi'nin efsanevi uçuşu buradan başladı.",
  },
  {
    id: 'kiz-kulesi', name: 'Kız Kulesi', kind: 'tower', builder: 'structures', lat: 41.02111, lon: 29.0041, headingDeg: 20, radius: 28, height: 23, year: 1763,
    info: "Salacak açıklarında küçük bir adacık üzerindeki kule; kökeni antik çağa uzanır, bugünkü yapı 18. yüzyıldan kalmadır ve 2023'te restore edildi.",
  },
  {
    id: 'camlica-kulesi', name: 'Çamlıca Kulesi', kind: 'tower', builder: 'structures', lat: 41.01637, lon: 29.06554, headingDeg: 0, radius: 55, height: 369, year: 2021,
    info: "Küçük Çamlıca Tepesi'ndeki 369 m'lik radyo-televizyon kulesi; tepesi deniz seviyesinden 587 m yükseklikte olan İstanbul'un en yüksek yapısı.",
  },
  {
    id: 'beyazit-kulesi', name: 'Beyazıt Kulesi', kind: 'tower', builder: 'structures', lat: 41.01279, lon: 28.9649, headingDeg: 0, radius: 18, height: 85, year: 1828,
    info: "İstanbul Üniversitesi bahçesinde, yangınları gözetlemek için II. Mahmud'un 1828'de yaptırdığı 85 m'lik kâgir kule.",
  },
  {
    id: 'levent-kuleleri', name: 'Levent Gökdelenleri', kind: 'skyscraper', builder: 'structures', lat: 41.0818, lon: 29.0103, headingDeg: 20, radius: 42, height: 261, year: 2011,
    footprint: 'cluster', footprintWidth: 42,
    anchors: [41.0851, 29.006, 41.08281, 29.01193, 41.08054, 29.01031, 41.07979, 29.00817, 41.08503, 29.01021, 41.07622, 29.01368, 41.0781, 29.011],
    anchorHeights: [261, 181, 170, 160, 158, 130, 118],
    info: "Büyükdere Caddesi boyunca yükselen iş kuleleri; İstanbul Sapphire (261 m), İş Kuleleri ve Sabancı Center şehrin finans siluetini oluşturur.",
  },
  {
    id: 'maslak-kuleleri', name: 'Maslak Gökdelenleri', kind: 'skyscraper', builder: 'structures', lat: 41.1085, lon: 29.0085, headingDeg: 20, radius: 42, height: 284, year: 2017,
    footprint: 'cluster', footprintWidth: 42,
    anchors: [41.10239, 28.98548, 41.10288, 28.98662, 41.11096, 29.02315, 41.11361, 29.02092, 41.1084, 29.01956, 41.11377, 29.01573, 41.11006, 29.01923, 41.10775, 29.0151],
    anchorHeights: [284, 284, 202, 165, 150, 130, 120, 120],
    info: "Maslak ve Huzur'da yükselen plaza ve rezidanslar; 284 m'lik Skyland ikiz kuleleri ve Spine Tower bölgenin simgeleridir.",
  },
  {
    id: 'atasehir-kuleleri', name: 'Ataşehir Finans Merkezi', kind: 'skyscraper', builder: 'structures', lat: 40.9935, lon: 29.1095, headingDeg: 0, radius: 45, height: 352, year: 2023,
    footprint: 'cluster', footprintWidth: 45,
    anchors: [41.00196, 29.1107, 40.9947, 29.12173, 41.00089, 29.10858, 41.00101, 29.10275, 40.99118, 29.11678, 40.98411, 29.10041, 40.99989, 29.11091, 40.98132, 29.10074, 41.00006, 29.10961],
    anchorHeights: [352, 301, 230, 225, 185, 180, 170, 165, 150],
    info: "İstanbul Finans Merkezi ve çevresindeki kuleler; Merkez Bankası kulesi ve 301 m'lik Metropol İstanbul Anadolu yakasının en yüksek yapılarıdır.",
  },
  {
    id: 'zincirlikuyu-kuleleri', name: 'Zincirlikuyu–Mecidiyeköy Gökdelenleri', kind: 'skyscraper', builder: 'structures', lat: 41.0685, lon: 29.0075, headingDeg: 0, radius: 40, height: 180, year: 2013,
    footprint: 'cluster', footprintWidth: 40,
    anchors: [41.06856, 29.01624, 41.06509, 28.99909, 41.06754, 28.99255, 41.07321, 29.01168, 41.06963, 29.01075, 41.06887, 29.01368, 41.0665, 29.017],
    anchorHeights: [180, 160, 155, 150, 130, 125, 110],
    info: "Zincirlikuyu, Esentepe ve Mecidiyeköy arasındaki kule kümesi; Zorlu Center, Çiftçi Towers, Torun Center ve Trump Towers Büyükdere Caddesi'nin başlangıcını işaretler.",
  },
];

const HERITAGE: LandmarkData[] = [
  {
    id: 'topkapi-sarayi', name: 'Topkapı Sarayı', kind: 'palace', builder: 'heritage', lat: 41.01243, lon: 28.98366, headingDeg: 45, radius: 360, height: 42, year: 1478,
    footprint: 'polygon', footprintWidth: 150,
    footprintPolygon: [41.01183, 28.98199, 41.01122, 28.98339, 41.01091, 28.9842, 41.01338, 28.98587, 41.01388, 28.98604, 41.01471, 28.98421, 41.0136, 28.98303, 41.01278, 28.98233],
    anchors: [
      41.00556, 28.98289, 41.00659, 28.98181, 41.00875, 28.98135, 41.01098, 28.97825, 41.0135, 28.97884, 41.01482, 28.97977, 41.0167, 28.98178,
      41.01701, 28.98187, 41.01692, 28.98241, 41.01715, 28.9826, 41.01756, 28.98392, 41.01776, 28.98533, 41.01765, 28.98535, 41.01736, 28.98669,
      41.013, 28.98807, 41.01021, 28.98786, 41.00632, 28.98604, 41.00579, 28.9855, 41.00452, 28.98339,
    ],
    info: "Fatih Sultan Mehmed'in 1460-1478 arasında Sarayburnu'na yaptırdığı, yaklaşık dört yüzyıl Osmanlı sultanlarının yaşadığı saray; avluları ve Adalet Kulesi'yle bugün müzedir.",
  },
  {
    id: 'dolmabahce-sarayi', name: 'Dolmabahçe Sarayı', kind: 'palace', builder: 'heritage', lat: 41.03913, lon: 28.99861, headingDeg: 58, radius: 280, height: 36, year: 1856,
    info: "Sultan Abdülmecid için Balyan ailesinin yaptığı, 600 m'yi aşan Boğaz cephesiyle Avrupa üsluplu saray; Atatürk 1938'de burada hayata gözlerini yumdu.",
  },
  {
    id: 'ciragan-sarayi', name: 'Çırağan Sarayı', kind: 'palace', builder: 'heritage', lat: 41.0434, lon: 29.01541, headingDeg: 55, radius: 120, height: 22, year: 1871,
    info: "Sultan Abdülaziz döneminde Sarkis Balyan'ın yaptığı mermer saray; 1910 yangınından sonra restore edilerek otel olarak kullanılmaktadır.",
  },
  {
    id: 'beylerbeyi-sarayi', name: 'Beylerbeyi Sarayı', kind: 'palace', builder: 'heritage', lat: 41.04272, lon: 29.04002, headingDeg: 40, radius: 110, height: 22, year: 1865,
    info: "Anadolu yakasında Sultan Abdülaziz için Sarkis ve Agop Balyan'ın yaptığı yazlık saray; deniz köşkleri ve teraslı bahçeleriyle ünlüdür.",
  },
  {
    id: 'rumeli-hisari', name: 'Rumeli Hisarı', kind: 'fortress', builder: 'heritage', lat: 41.08492, lon: 29.05671, headingDeg: 10, radius: 145, height: 28, year: 1452,
    footprint: 'slope',
    info: "Fatih Sultan Mehmed'in fetihten önce Boğaz'ı denetlemek için yalnızca dört ayda yaptırdığı kale; üç büyük kulesi Boğaz'ın en dar noktasına bakar.",
  },
  {
    id: 'anadolu-hisari', name: 'Anadolu Hisarı', kind: 'fortress', builder: 'heritage', lat: 41.08409, lon: 29.06837, headingDeg: 0, radius: 65, height: 25, year: 1395,
    info: "Yıldırım Bayezid'in Göksu deresinin Boğaz'a döküldüğü yerde yaptırdığı 'Güzelce Hisar'; Rumeli Hisarı'nın tam karşısındadır.",
  },
  {
    id: 'kara-surlari', name: 'İstanbul Kara Surları', kind: 'walls', builder: 'heritage', lat: 41.0159, lon: 28.9225, headingDeg: 8, radius: 40, height: 20, year: 413,
    footprint: 'line', footprintWidth: 32,
    anchors: [
      40.98902, 28.92015, 40.98943, 28.92018, 40.99049, 28.92066, 40.99213, 28.92252, 40.99275, 28.92269, 40.99372, 28.92233, 40.99411, 28.92192,
      40.99468, 28.92159, 40.99731, 28.92108, 40.99979, 28.92035, 40.99999, 28.92054, 41.00082, 28.92062, 41.00375, 28.92141, 41.00622, 28.92183,
      41.00798, 28.92227, 41.00819, 28.92253, 41.00862, 28.92268, 41.00898, 28.92271, 41.0092, 28.9225, 41.011, 28.92258, 41.01152, 28.92251,
      41.01329, 28.92198, 41.0155, 28.92233, 41.01603, 28.92253, 41.01733, 28.92316, 41.02077, 28.92547, 41.02479, 28.92979, 41.02707, 28.93207,
      41.0274, 28.93257, 41.02901, 28.93441, 41.0295, 28.9349, 41.03057, 28.9356, 41.0322, 28.9372, 41.0337, 28.9396, 41.0352, 28.9392,
      41.0365, 28.9394, 41.0378, 28.9401, 41.0398, 28.9419, 41.0406, 28.9428,
    ],
    info: "Marmara'dan Haliç'e uzanan 6,5 km'lik çift sıra sur ve hendek sistemi; II. Theodosius döneminde 413'te tamamlandı ve bin yıl boyunca şehri korudu.",
  },
  {
    id: 'yedikule', name: 'Yedikule Hisarı', kind: 'fortress', builder: 'heritage', lat: 40.99308, lon: 28.92262, headingDeg: 10, radius: 105, height: 30, year: 1458,
    info: "Kara surlarının güney ucunda Bizans'ın Altın Kapı'sını da içine alan yedi kuleli, yıldız planlı hisar; uzun yıllar zindan olarak kullanıldı.",
  },
  {
    id: 'haydarpasa-gari', name: 'Haydarpaşa Garı', kind: 'station', builder: 'heritage', lat: 40.9961, lon: 29.01851, headingDeg: 305, radius: 85, height: 42, year: 1908,
    info: "Bağdat Demiryolu'nun başlangıcı olarak 1908'de açılan, deniz kıyısındaki kuleli Neo-Rönesans gar binası.",
  },
  {
    id: 'selimiye-kislasi', name: 'Selimiye Kışlası', kind: 'barracks', builder: 'heritage', lat: 41.00779, lon: 29.01605, headingDeg: 35, radius: 165, height: 30, year: 1828,
    info: "III. Selim'in Nizam-ı Cedid askerleri için kurduğu, köşe kuleleriyle Harem kıyısından görülen dev kışla; Florence Nightingale Kırım Savaşı'nda burada çalıştı.",
  },
  {
    id: 'kuleli', name: 'Kuleli Askerî Lisesi', kind: 'barracks', builder: 'heritage', lat: 41.05858, lon: 29.05342, headingDeg: 20, radius: 105, height: 40, year: 1845,
    info: "Çengelköy kıyısında iki kuleli cephesiyle Boğaz'ın simge yapılarından; 1845'ten beri askerî okul olarak kullanılan kışla binası.",
  },
  {
    id: 'bozdogan-kemeri', name: 'Bozdoğan Kemeri', kind: 'monument', builder: 'heritage', lat: 41.01615, lon: 28.95518, headingDeg: 125, radius: 60, height: 29, year: 375,
    footprint: 'line', footprintWidth: 10,
    anchors: [41.01769, 28.9523, 41.01719, 28.95327, 41.01668, 28.95423, 41.01618, 28.95519, 41.01567, 28.95615, 41.01515, 28.9571, 41.01462, 28.95805],
    info: "Roma İmparatoru Valens döneminde 4. yüzyılda tamamlanan su kemeri; Atatürk Bulvarı'nın üzerinden geçerek üçüncü ve dördüncü tepeleri birleştirir.",
  },
  {
    id: 'sirkeci-gari', name: 'Sirkeci Garı', kind: 'station', builder: 'heritage', lat: 41.01505, lon: 28.97715, headingDeg: 40, radius: 75, height: 25, year: 1890,
    info: "Doğu Ekspresi'nin son durağı olarak 1890'da açılan, August Jasmund'un tasarladığı oryantalist üsluplu gar.",
  },
  {
    id: 'hipodrom', name: 'Sultanahmet Meydanı (Hipodrom)', kind: 'monument', builder: 'heritage', lat: 41.00563, lon: 28.97506, headingDeg: 37, radius: 130, height: 32, year: 203,
    footprint: 'line', footprintWidth: 30,
    anchors: [41.00705, 28.97635, 41.00583, 28.97527, 41.00563, 28.97506, 41.00541, 28.97484, 41.00405, 28.97358],
    info: "Bizans'ın at yarışı ve tören alanı Hipodrom'un bugünkü meydanı; Dikilitaş, Yılanlı Sütun ve Örme Dikilitaş antik spina hattında sıralanır.",
  },
];

export const LANDMARKS: readonly LandmarkData[] = [...MOSQUES, ...STRUCTURES, ...HERITAGE];
