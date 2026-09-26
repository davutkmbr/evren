import type { CameraMode, FlightMode, LandmarkDef, LandmarkKind } from '../core/contracts';

/** Loading step labels per system name (engine emits the system name before its init). */
const LOADING_LABELS: Record<string, string> = {
  ui: 'Arayüz hazırlanıyor',
  geo: 'Coğrafya işleniyor',
  sky: 'Gökyüzü ve atmosfer',
  terrain: 'Arazi',
  water: 'Boğaz ve deniz',
  city: 'Şehir inşa ediliyor',
  vegetation: 'Ağaçlar ve korular',
  mosques: 'Camiler',
  structures: 'Köprüler ve kuleler',
  heritage: 'Saraylar ve surlar',
  clouds: 'Bulutlar',
  'dragon-model': 'Ejderha',
  flight: 'Uçuş fiziği',
  camera: 'Kamera',
  life: 'Şehir hayatı',
  fx: 'Efektler',
  audio: 'Ses',
  orbit: 'Kamera',
  ready: 'Işık ve gölgeler derleniyor',
};

export function loadingLabel(system: string): string {
  const known = LOADING_LABELS[system];
  if (known) {
    return known;
  }
  const clean = system.replace(/[-_]+/g, ' ').trim();
  return clean ? clean.charAt(0).toLocaleUpperCase('tr-TR') + clean.slice(1) : 'Hazırlanıyor';
}

export const FLIGHT_MODE_LABELS: Record<FlightMode, string> = {
  flying: 'Uçuş',
  gliding: 'Süzülme',
  diving: 'Dalış',
  hovering: 'Havada asılı',
  stalling: 'Hız kaybı',
  landing: 'İniş',
  grounded: 'Yerde',
  takeoff: 'Kalkış',
  swimming: 'Suda',
  underwater: 'Su altında',
};

export const CAMERA_MODE_LABELS: Record<CameraMode, string> = {
  third: 'Üçüncü şahıs',
  pov: 'Binici gözü',
  cinematic: 'Sinematik',
  free: 'Serbest',
};

export const LANDMARK_KIND_LABELS: Record<LandmarkKind, string> = {
  mosque: 'Cami',
  bridge: 'Köprü',
  tower: 'Kule',
  palace: 'Saray',
  fortress: 'Hisar',
  walls: 'Surlar',
  station: 'Gar',
  skyscraper: 'Gökdelenler',
  monument: 'Anıt',
  barracks: 'Kışla',
  other: 'Simge yapı',
};

const SHORT_NAMES: Record<string, string> = {
  ayasofya: 'Ayasofya',
  'bogazici-koprusu': '15 Temmuz Köprüsü',
  'fsm-koprusu': 'FSM Köprüsü',
  'yss-koprusu': 'Yavuz Sultan Selim Köprüsü',
  'zincirlikuyu-kuleleri': 'Zincirlikuyu',
  'atasehir-kuleleri': 'Ataşehir',
  'levent-kuleleri': 'Levent',
  'maslak-kuleleri': 'Maslak',
  hipodrom: 'Hipodrom',
  'ortakoy-camii': 'Ortaköy Camii',
  'camlica-camii': 'Çamlıca Camii',
  'mihrimah-uskudar': 'Mihrimah Sultan',
  'mihrimah-edirnekapi': 'Mihrimah Sultan',
  kuleli: 'Kuleli',
};

/** Compact name for tight spots (compass tape, map labels). */
export function shortLandmarkName(landmark: LandmarkDef): string {
  return SHORT_NAMES[landmark.id] ?? landmark.name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
}

/** Coarse day phase from the sun elevation (degrees) and clock time. */
export function dayPhase(sunElevationDeg: number, hours: number): string {
  const morning = hours < 12;
  if (sunElevationDeg < -12) {
    return 'Gece';
  }
  if (sunElevationDeg < -0.8) {
    return morning ? 'Şafak' : 'Alacakaranlık';
  }
  if (sunElevationDeg < 8) {
    return morning ? 'Gün doğumu' : 'Gün batımı';
  }
  if (hours < 11) {
    return 'Sabah';
  }
  if (hours < 14.5) {
    return 'Öğle';
  }
  return 'İkindi';
}

/** Loading screen: alternating control tips and verified facts. */
export const LOADING_TIPS: readonly string[] = [
  'Space ile kanat çırp; tırmanmak ve hızlanmak için ritmi koru.',
  'İstanbul Boğazı yaklaşık 31 km uzunluğunda; Karadeniz ile Marmara’yı birleştirir.',
  'Shift ile kanatları kapat ve dalışa geç; irtifayı hıza çevirirsin.',
  'Ctrl ile yavaşla ve havada asılı kal; freni bırakıp W’ye basınca uçuşa dönersin.',
  'Süleymaniye Camii’ni Mimar Sinan 1550–1557 yılları arasında inşa etti.',
  'C ile üçüncü şahıs, binici gözü ve sinematik kamera arasında geçiş yap.',
  'Fatih Sultan Mehmet Köprüsü 1988’de açıldı; ana açıklığı 1.090 metredir.',
  'Bir simge yapıya 800 metre kadar yaklaşıp ona yöneldiğinde onu keşfedersin.',
  'Galata Kulesi 1348’de Cenevizliler tarafından inşa edildi.',
  'M ile haritayı aç; haritada bir noktaya tıklayarak oraya ışınlan.',
  '15 Temmuz Şehitler Köprüsü 1973’te açıldı; iki kıtayı ilk kez birbirine bağladı.',
];
