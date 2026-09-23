import type { DistrictDef } from '../types';

/**
 * Named districts/quarters with their building character. Density 0..1, floors = typical storeys.
 * `reach` (km) weights the Voronoi partition so large outer districts claim more land than compact cores.
 */
export const DISTRICTS: readonly DistrictDef[] = [
  // Historic peninsula
  { id: 'sultanahmet', name: 'Sultanahmet', side: 'europe', lat: 41.0065, lon: 28.9755, style: 'historic', density: 0.55, floorsMean: 3.5, floorsMax: 5, reach: 0.8 },
  { id: 'eminonu', name: 'Eminönü', side: 'europe', lat: 41.0145, lon: 28.9685, style: 'historic', density: 0.9, floorsMean: 4.5, floorsMax: 7, reach: 0.7 },
  { id: 'fatih', name: 'Fatih', side: 'europe', lat: 41.0195, lon: 28.9455, style: 'historic', density: 0.85, floorsMean: 4.5, floorsMax: 6, reach: 1.4 },
  { id: 'aksaray', name: 'Laleli–Aksaray', side: 'europe', lat: 41.0085, lon: 28.9535, style: 'dense', density: 0.92, floorsMean: 6, floorsMax: 9, reach: 0.8 },
  { id: 'balat', name: 'Balat–Fener', side: 'europe', lat: 41.0305, lon: 28.9465, style: 'historic', density: 0.8, floorsMean: 3.5, floorsMax: 5, reach: 0.8 },
  { id: 'samatya', name: 'Samatya–Yedikule', side: 'europe', lat: 41.0005, lon: 28.9335, style: 'historic', density: 0.78, floorsMean: 4, floorsMax: 6, reach: 1.0 },
  // Western European side
  { id: 'zeytinburnu', name: 'Zeytinburnu', side: 'europe', lat: 40.9965, lon: 28.9035, style: 'dense', density: 0.85, floorsMean: 6, floorsMax: 12, reach: 1.5 },
  { id: 'bakirkoy', name: 'Bakırköy', side: 'europe', lat: 40.9805, lon: 28.8735, style: 'modern', density: 0.75, floorsMean: 7, floorsMax: 10, reach: 1.5 },
  { id: 'atakoy', name: 'Ataköy', side: 'europe', lat: 40.9835, lon: 28.8455, style: 'modern', density: 0.62, floorsMean: 10, floorsMax: 25, reach: 1.3 },
  { id: 'yesilkoy', name: 'Yeşilköy–Florya', side: 'europe', lat: 40.9655, lon: 28.8075, style: 'suburban', density: 0.45, floorsMean: 3, floorsMax: 6, reach: 1.9 },
  { id: 'bahcelievler', name: 'Bahçelievler', side: 'europe', lat: 41.0005, lon: 28.8555, style: 'dense', density: 0.9, floorsMean: 6, floorsMax: 10, reach: 1.7 },
  { id: 'kucukcekmece', name: 'Küçükçekmece', side: 'europe', lat: 41.0015, lon: 28.7935, style: 'dense', density: 0.8, floorsMean: 6, floorsMax: 12, reach: 2.2 },
  { id: 'avcilar', name: 'Avcılar', side: 'europe', lat: 40.9905, lon: 28.7385, style: 'dense', density: 0.82, floorsMean: 6, floorsMax: 12, reach: 1.6 },
  { id: 'bagcilar', name: 'Bağcılar', side: 'europe', lat: 41.0395, lon: 28.8525, style: 'dense', density: 0.95, floorsMean: 6, floorsMax: 10, reach: 1.9 },
  { id: 'esenler', name: 'Esenler', side: 'europe', lat: 41.0445, lon: 28.8795, style: 'dense', density: 0.9, floorsMean: 5, floorsMax: 9, reach: 1.3 },
  { id: 'bayrampasa', name: 'Bayrampaşa', side: 'europe', lat: 41.0445, lon: 28.9035, style: 'dense', density: 0.85, floorsMean: 5, floorsMax: 10, reach: 1.2 },
  { id: 'gaziosmanpasa', name: 'Gaziosmanpaşa', side: 'europe', lat: 41.0655, lon: 28.9095, style: 'dense', density: 0.9, floorsMean: 5, floorsMax: 10, reach: 1.7 },
  { id: 'sultangazi', name: 'Sultangazi', side: 'europe', lat: 41.1005, lon: 28.8705, style: 'dense', density: 0.8, floorsMean: 5, floorsMax: 10, reach: 2.1 },
  { id: 'basaksehir', name: 'Başakşehir', side: 'europe', lat: 41.0985, lon: 28.8005, style: 'modern', density: 0.6, floorsMean: 8, floorsMax: 22, reach: 3.0 },
  { id: 'eyup', name: 'Eyüpsultan', side: 'europe', lat: 41.0495, lon: 28.9335, style: 'historic', density: 0.7, floorsMean: 4, floorsMax: 7, reach: 1.1 },
  { id: 'kagithane', name: 'Kağıthane', side: 'europe', lat: 41.0815, lon: 28.9705, style: 'dense', density: 0.85, floorsMean: 7, floorsMax: 12, reach: 1.7 },
  // Beyoğlu & Beşiktaş
  { id: 'galata', name: 'Galata–Karaköy', side: 'europe', lat: 41.0245, lon: 28.9755, style: 'historic', density: 0.9, floorsMean: 5, floorsMax: 8, reach: 0.55 },
  { id: 'beyoglu', name: 'Beyoğlu', side: 'europe', lat: 41.0335, lon: 28.9765, style: 'historic', density: 0.95, floorsMean: 6, floorsMax: 8, reach: 0.8 },
  { id: 'cihangir', name: 'Cihangir', side: 'europe', lat: 41.0315, lon: 28.9845, style: 'dense', density: 0.95, floorsMean: 6, floorsMax: 7, reach: 0.45 },
  { id: 'kasimpasa', name: 'Kasımpaşa', side: 'europe', lat: 41.0405, lon: 28.9665, style: 'dense', density: 0.85, floorsMean: 5, floorsMax: 8, reach: 0.9 },
  { id: 'sisli', name: 'Şişli–Nişantaşı', side: 'europe', lat: 41.0545, lon: 28.9895, style: 'dense', density: 0.95, floorsMean: 7, floorsMax: 12, reach: 1.1 },
  { id: 'mecidiyekoy', name: 'Mecidiyeköy', side: 'europe', lat: 41.0675, lon: 28.9945, style: 'highrise', density: 0.95, floorsMean: 10, floorsMax: 40, reach: 0.8 },
  { id: 'besiktas', name: 'Beşiktaş', side: 'europe', lat: 41.0445, lon: 29.0055, style: 'dense', density: 0.85, floorsMean: 6, floorsMax: 8, reach: 1.0 },
  { id: 'levent', name: 'Levent–Esentepe', side: 'europe', lat: 41.0805, lon: 29.0095, style: 'highrise', density: 0.85, floorsMean: 14, floorsMax: 60, reach: 1.1 },
  { id: 'maslak', name: 'Maslak', side: 'europe', lat: 41.1105, lon: 29.0195, style: 'highrise', density: 0.75, floorsMean: 20, floorsMax: 60, reach: 1.0 },
  { id: 'etiler', name: 'Etiler–Ulus', side: 'europe', lat: 41.0785, lon: 29.0345, style: 'modern', density: 0.6, floorsMean: 5, floorsMax: 10, reach: 1.1 },
  // Upper Bosphorus, European shore
  { id: 'ortakoy', name: 'Ortaköy–Kuruçeşme', side: 'europe', lat: 41.0535, lon: 29.0305, style: 'yali', density: 0.55, floorsMean: 3, floorsMax: 5, reach: 0.8 },
  { id: 'bebek', name: 'Bebek–Arnavutköy', side: 'europe', lat: 41.0735, lon: 29.0425, style: 'yali', density: 0.5, floorsMean: 3, floorsMax: 4, reach: 0.9 },
  { id: 'rumelihisari', name: 'Rumeli Hisarı–Emirgan', side: 'europe', lat: 41.0965, lon: 29.0515, style: 'yali', density: 0.4, floorsMean: 3, floorsMax: 4, reach: 1.1 },
  { id: 'istinye', name: 'İstinye–Yeniköy', side: 'europe', lat: 41.1205, lon: 29.0575, style: 'yali', density: 0.45, floorsMean: 3, floorsMax: 5, reach: 1.2 },
  { id: 'tarabya', name: 'Tarabya', side: 'europe', lat: 41.1405, lon: 29.0525, style: 'yali', density: 0.4, floorsMean: 3, floorsMax: 6, reach: 1.0 },
  { id: 'sariyer', name: 'Sarıyer–Büyükdere', side: 'europe', lat: 41.1645, lon: 29.0485, style: 'suburban', density: 0.45, floorsMean: 3, floorsMax: 6, reach: 1.7 },
  { id: 'rumelikavagi', name: 'Rumeli Kavağı–Garipçe', side: 'europe', lat: 41.1955, lon: 29.0805, style: 'villa', density: 0.2, floorsMean: 2, floorsMax: 3, reach: 2.4 },
  { id: 'zekeriyakoy', name: 'Zekeriyaköy–Kilyos', side: 'europe', lat: 41.2155, lon: 29.0255, style: 'villa', density: 0.25, floorsMean: 2, floorsMax: 3, reach: 3.4 },
  { id: 'gokturk', name: 'Göktürk–Kemerburgaz', side: 'europe', lat: 41.1755, lon: 28.9005, style: 'villa', density: 0.35, floorsMean: 3, floorsMax: 8, reach: 3.0 },
  // Asian side, Bosphorus
  { id: 'uskudar', name: 'Üsküdar', side: 'asia', lat: 41.0245, lon: 29.0195, style: 'historic', density: 0.85, floorsMean: 5, floorsMax: 7, reach: 1.2 },
  { id: 'kuzguncuk', name: 'Kuzguncuk–Beylerbeyi', side: 'asia', lat: 41.0405, lon: 29.0405, style: 'yali', density: 0.55, floorsMean: 3, floorsMax: 4, reach: 0.9 },
  { id: 'cengelkoy', name: 'Çengelköy–Kandilli', side: 'asia', lat: 41.0605, lon: 29.0575, style: 'yali', density: 0.45, floorsMean: 3, floorsMax: 4, reach: 1.1 },
  { id: 'kanlica', name: 'Kavacık–Kanlıca', side: 'asia', lat: 41.0955, lon: 29.0805, style: 'suburban', density: 0.55, floorsMean: 4, floorsMax: 10, reach: 1.5 },
  { id: 'beykoz', name: 'Beykoz', side: 'asia', lat: 41.1345, lon: 29.1005, style: 'villa', density: 0.35, floorsMean: 3, floorsMax: 5, reach: 1.9 },
  { id: 'riva', name: 'Riva–Poyrazköy', side: 'asia', lat: 41.2055, lon: 29.1805, style: 'villa', density: 0.2, floorsMean: 2, floorsMax: 3, reach: 3.8 },
  // Asian side, inland and Marmara shore
  { id: 'altunizade', name: 'Altunizade–Acıbadem', side: 'asia', lat: 41.0145, lon: 29.0455, style: 'dense', density: 0.9, floorsMean: 7, floorsMax: 20, reach: 1.2 },
  { id: 'kadikoy', name: 'Kadıköy', side: 'asia', lat: 40.9905, lon: 29.0275, style: 'dense', density: 0.95, floorsMean: 6, floorsMax: 9, reach: 1.0 },
  { id: 'moda', name: 'Moda', side: 'asia', lat: 40.9825, lon: 29.0255, style: 'historic', density: 0.85, floorsMean: 5, floorsMax: 7, reach: 0.45 },
  { id: 'fenerbahce', name: 'Fenerbahçe–Kalamış', side: 'asia', lat: 40.9725, lon: 29.0425, style: 'dense', density: 0.75, floorsMean: 7, floorsMax: 12, reach: 0.9 },
  { id: 'goztepe', name: 'Göztepe–Erenköy', side: 'asia', lat: 40.9735, lon: 29.0655, style: 'dense', density: 0.8, floorsMean: 8, floorsMax: 15, reach: 1.4 },
  { id: 'bostanci', name: 'Suadiye–Bostancı', side: 'asia', lat: 40.9585, lon: 29.0905, style: 'dense', density: 0.8, floorsMean: 8, floorsMax: 16, reach: 1.3 },
  { id: 'atasehir', name: 'Ataşehir', side: 'asia', lat: 40.9905, lon: 29.1105, style: 'highrise', density: 0.85, floorsMean: 14, floorsMax: 50, reach: 1.5 },
  { id: 'umraniye', name: 'Ümraniye', side: 'asia', lat: 41.0255, lon: 29.1105, style: 'dense', density: 0.9, floorsMean: 7, floorsMax: 15, reach: 2.1 },
  { id: 'maltepe', name: 'Maltepe', side: 'asia', lat: 40.9355, lon: 29.1405, style: 'dense', density: 0.85, floorsMean: 7, floorsMax: 15, reach: 1.9 },
  { id: 'kartal', name: 'Kartal', side: 'asia', lat: 40.9005, lon: 29.1905, style: 'dense', density: 0.8, floorsMean: 7, floorsMax: 15, reach: 2.1 },
  { id: 'pendik', name: 'Pendik', side: 'asia', lat: 40.8805, lon: 29.2605, style: 'dense', density: 0.8, floorsMean: 6, floorsMax: 14, reach: 2.0 },
  { id: 'cekmekoy', name: 'Çekmeköy', side: 'asia', lat: 41.0405, lon: 29.1805, style: 'modern', density: 0.6, floorsMean: 6, floorsMax: 14, reach: 2.7 },
  { id: 'sancaktepe', name: 'Sancaktepe–Samandıra', side: 'asia', lat: 40.9905, lon: 29.2305, style: 'dense', density: 0.75, floorsMean: 6, floorsMax: 12, reach: 2.9 },
  { id: 'sultanbeyli', name: 'Sultanbeyli', side: 'asia', lat: 40.9655, lon: 29.2655, style: 'dense', density: 0.75, floorsMean: 4, floorsMax: 8, reach: 2.1 },
  // Princes' Islands
  { id: 'buyukada', name: 'Büyükada', side: 'island', lat: 40.8585, lon: 29.1205, style: 'villa', density: 0.35, floorsMean: 2.5, floorsMax: 3, reach: 1.9 },
  { id: 'heybeliada', name: 'Heybeliada', side: 'island', lat: 40.8775, lon: 29.0955, style: 'villa', density: 0.35, floorsMean: 2.5, floorsMax: 3, reach: 1.2 },
  { id: 'burgazada', name: 'Burgazada', side: 'island', lat: 40.8815, lon: 29.0655, style: 'villa', density: 0.35, floorsMean: 2.5, floorsMax: 3, reach: 1.0 },
  { id: 'kinaliada', name: 'Kınalıada', side: 'island', lat: 40.9095, lon: 29.0515, style: 'villa', density: 0.4, floorsMean: 2.5, floorsMax: 3, reach: 1.0 },
];
