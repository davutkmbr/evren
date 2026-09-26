/**
 * Teleport destinations for the pause menu (Işınlan): the perches (spots the dragon can land on) and the view presets
 * merged into one entry per place, each with a region, a kind (for the icon) and a short Turkish info line.
 */
import type { PerchPoint } from '../../core/contracts';
import { VIEW_PRESETS, type ViewPreset } from '../../core/debug';
import { localToLatLon } from '../../core/geo-coords';

export type PlaceRegion = 'historic' | 'galata' | 'bosphorus' | 'asia' | 'around' | 'special';
export type PlaceKind = 'tower' | 'hill' | 'bridge' | 'view';

export const REGIONS: ReadonlyArray<{ id: PlaceRegion; title: string; chip: string }> = [
  { id: 'historic', title: 'Tarihi Yarımada ve Haliç', chip: 'Tarihi Yarımada' },
  { id: 'galata', title: 'Beyoğlu ve Galata', chip: 'Galata' },
  { id: 'bosphorus', title: 'Boğaz', chip: 'Boğaz' },
  { id: 'asia', title: 'Anadolu yakası', chip: 'Anadolu' },
  { id: 'around', title: 'Adalar ve çevre', chip: 'Adalar ve çevre' },
  { id: 'special', title: 'Özel manzaralar', chip: 'Özel' },
];

export interface Place {
  /** Perch id when the place has a perch, otherwise `view:<preset id>`. */
  id: string;
  name: string;
  region: PlaceRegion;
  kind: PlaceKind;
  info: string;
  perch?: PerchPoint;
  /** Curated view (camera pose, optional time of day) used by Işınlan; perch-only places get one behind the perch. */
  view: ViewPreset;
  /** Map pin position (local meters): the perch grip point, else the view position. Null: no pin (special views). */
  pin: { x: number; z: number } | null;
  /** Folded text for the search box. */
  search: string;
}

/** View presets that show the same place as a perch (their camera stands off the structure, so distance alone misses). */
const PRESET_PERCH: Record<string, string> = {
  galata: 'galata-kulesi',
  koprusu: 'bogazici-koprusu-kule',
  fsm: 'fsm-koprusu-kule',
  rumelihisari: 'rumeli-hisari-zaganos',
  kizkulesi: 'kiz-kulesi',
  camlica: 'buyuk-camlica',
};
/** Presets never merged into a perch (special views that happen to stand near one). */
const SPECIAL_PRESETS = new Set(['yuksek', 'gece']);
/** A preset this close (horizontal m) to an unclaimed perch is the same place. */
const MERGE_DISTANCE = 600;

/** Region per perch or preset id; anything missing falls back to `regionAt`. */
const REGION_OF: Record<string, PlaceRegion> = {
  'suleymaniye-kubbe': 'historic',
  'pierre-loti': 'historic',
  spawn: 'historic',
  sultanahmet: 'historic',
  ayasofya: 'historic',
  halic: 'historic',
  'galata-kulesi': 'galata',
  galata: 'galata',
  'bogazici-koprusu-kule': 'bosphorus',
  'fsm-koprusu-kule': 'bosphorus',
  'yss-koprusu-kule': 'bosphorus',
  'rumeli-hisari-zaganos': 'bosphorus',
  'yusa-tepesi': 'bosphorus',
  bogaz: 'bosphorus',
  karadeniz: 'bosphorus',
  'buyuk-camlica': 'asia',
  'kiz-kulesi': 'asia',
  otagtepe: 'asia',
  uskudar: 'asia',
  'istanbul-sapphire': 'around',
  'buyukada-aya-yorgi': 'around',
  aydos: 'around',
  levent: 'around',
  adalar: 'around',
  yuksek: 'special',
  gece: 'special',
};

/** Shorter names for the list (the perch catalogue names the exact spot: "... Kulesi", "... Çatısı"). */
const PERCH_NAMES: Record<string, string> = {
  'bogazici-koprusu-kule': '15 Temmuz Şehitler Köprüsü',
  'fsm-koprusu-kule': 'Fatih Sultan Mehmet Köprüsü',
  'yss-koprusu-kule': 'Yavuz Sultan Selim Köprüsü',
  'buyuk-camlica': 'Büyük Çamlıca',
  'rumeli-hisari-zaganos': 'Rumeli Hisarı',
  'suleymaniye-kubbe': 'Süleymaniye Camii',
  'istanbul-sapphire': 'İstanbul Sapphire',
  'pierre-loti': 'Pierre Loti',
  'buyukada-aya-yorgi': 'Aya Yorgi Tepesi',
};

/** Info lines for the view presets (a merged place shows its perch's text instead). */
const PRESET_INFO: Record<string, string> = {
  spawn: 'Topkapı Sarayı, Haliç ağzı ve Boğaz girişi aynı karede.',
  sultanahmet: 'Sultanahmet Camii ve Ayasofya’ya alçaktan yaklaşış.',
  ayasofya: 'Denizden Ayasofya’ya bakan açı.',
  galata: 'Haliç’in üstünden Galata Kulesi ve Beyoğlu sırtları.',
  halic: 'Haliç boyunca, köprülerin üstünden.',
  bogaz: 'Kız Kulesi ile Sarayburnu arasından Boğaz’a giriş.',
  koprusu: 'Boğaz’ın iki yakasını bağlayan ilk köprü, yakından.',
  fsm: 'Boğaz’ın en dar yerinde, Rumeli Hisarı’nın yanındaki köprü.',
  rumelihisari: 'Boğaz’ın en dar noktasını tutan hisar.',
  kizkulesi: 'Boğaz’ın ağzında, efsaneleriyle ünlü küçük kule.',
  uskudar: 'Üsküdar sahili ve iskelesi.',
  levent: 'Gökdelenler arasında alçak uçuş.',
  camlica: 'Şehrin tamamını gören tepe, Anadolu yakasının üstünden.',
  adalar: 'Kınalıada’dan Büyükada’ya uzanan adalar.',
  karadeniz: 'Boğaz’ın kuzey ucu, Karadeniz’e açılış.',
  yuksek: '2.600 m’de, bulut denizinin üstünde.',
  gece: 'Işıklı köprüler ve Boğaz, gece.',
};

const PRESET_KIND: Record<string, PlaceKind> = { koprusu: 'bridge', fsm: 'bridge', galata: 'tower', kizkulesi: 'tower', rumelihisari: 'tower', camlica: 'hill' };

const KIND_WORDS: Record<PlaceKind, string> = { tower: 'kule kubbe', hill: 'tepe', bridge: 'köprü', view: 'manzara' };

/** Folds Turkish letters for the search box ("kiz" finds "Kız Kulesi"). */
export function fold(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâî]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i' })[c] ?? c);
}

/** Bosphorus centre line (lat, lon), south to north: splits the European and Asian sides. */
const BOSPHORUS: ReadonlyArray<readonly [number, number]> = [
  [41.0, 28.985],
  [41.014, 28.99],
  [41.025, 28.998],
  [41.038, 29.02],
  [41.046, 29.034],
  [41.06, 29.045],
  [41.08, 29.056],
  [41.1, 29.061],
  [41.12, 29.068],
  [41.14, 29.076],
  [41.16, 29.086],
  [41.18, 29.097],
  [41.2, 29.11],
  [41.222, 29.12],
];

function bosphorusLon(lat: number): number {
  if (lat <= BOSPHORUS[0][0]) {
    return BOSPHORUS[0][1];
  }
  for (let i = 1; i < BOSPHORUS.length; i++) {
    const [la1, lo1] = BOSPHORUS[i];
    if (lat <= la1) {
      const [la0, lo0] = BOSPHORUS[i - 1];
      return lo0 + ((lat - la0) / (la1 - la0)) * (lo1 - lo0);
    }
  }
  return BOSPHORUS[BOSPHORUS.length - 1][1];
}

/** Rough region of a position without a table entry. */
export function regionAt(x: number, z: number): PlaceRegion {
  const { lat, lon } = localToLatLon(x, z);
  if (lat < 40.95) {
    return 'around';
  }
  const offset = lon - bosphorusLon(lat);
  // ~0.012° of longitude is about 1 km here
  if (lat > 41.03 && lat < 41.23 && Math.abs(offset) < 0.012) {
    return 'bosphorus';
  }
  if (offset > 0) {
    return 'asia';
  }
  if (lat < 41.022 || lon < 28.955) {
    return 'historic';
  }
  return lat < 41.045 ? 'galata' : 'around';
}

function perchKind(p: PerchPoint): PlaceKind {
  if (p.landmarkId?.includes('koprusu')) {
    return 'bridge';
  }
  return p.surface === 'hill' ? 'hill' : 'tower';
}

/** A perch's viewpoint as a teleport target: behind and above the grip point, facing its view. */
export function perchView(p: PerchPoint, back = 140, up = 45, pitchDeg = -10): ViewPreset {
  const h = (p.headingDeg * Math.PI) / 180;
  return {
    label: PERCH_NAMES[p.id] ?? p.name,
    x: p.x - Math.sin(h) * back,
    y: p.y + up,
    z: p.z + Math.cos(h) * back,
    headingDeg: p.headingDeg,
    pitchDeg,
  };
}

const REGION_ORDER = new Map(REGIONS.map((r, i) => [r.id, i]));

/**
 * One entry per place: every perch (merged with the preset of the same place, if any), then the remaining presets.
 * Order: perches by region, then views by region, special views last.
 */
export function buildPlaces(perches: readonly PerchPoint[]): Place[] {
  const places: Place[] = [];
  const byPerch = new Map<string, { perch: PerchPoint; presetId?: string; preset?: ViewPreset }>();
  for (const p of perches) {
    byPerch.set(p.id, { perch: p });
  }
  const loose: Array<[string, ViewPreset]> = [];
  // table merges first so the distance fallback cannot claim their perches
  const entries = Object.entries(VIEW_PRESETS).sort(([a], [b]) => Number(b in PRESET_PERCH) - Number(a in PRESET_PERCH));
  for (const [id, preset] of entries) {
    let target = PRESET_PERCH[id] ? byPerch.get(PRESET_PERCH[id]) : undefined;
    if (!target && !SPECIAL_PRESETS.has(id)) {
      let best = MERGE_DISTANCE;
      for (const t of byPerch.values()) {
        const d = Math.hypot(t.perch.x - preset.x, t.perch.z - preset.z);
        if (!t.preset && d < best) {
          best = d;
          target = t;
        }
      }
    }
    if (target && !target.preset) {
      target.presetId = id;
      target.preset = preset;
    } else {
      loose.push([id, preset]);
    }
  }

  for (const { perch, presetId, preset } of byPerch.values()) {
    const name = PERCH_NAMES[perch.id] ?? perch.name;
    const region = REGION_OF[perch.id] ?? (presetId ? REGION_OF[presetId] : undefined) ?? regionAt(perch.x, perch.z);
    const kind = perchKind(perch);
    const view = preset ? { ...preset, label: name } : perchView(perch);
    places.push({
      id: perch.id,
      name,
      region,
      kind,
      info: perch.info,
      perch,
      view,
      pin: { x: perch.x, z: perch.z },
      search: fold([name, perch.name, preset?.label ?? '', REGIONS.find((r) => r.id === region)?.title ?? '', KIND_WORDS[kind], 'konulabilir'].join(' ')),
    });
  }
  for (const [id, preset] of loose) {
    const region = REGION_OF[id] ?? regionAt(preset.x, preset.z);
    const kind = PRESET_KIND[id] ?? 'view';
    places.push({
      id: `view:${id}`,
      name: preset.label,
      region,
      kind,
      info: PRESET_INFO[id] ?? '',
      view: preset,
      pin: region === 'special' ? null : { x: preset.x, z: preset.z },
      search: fold([preset.label, REGIONS.find((r) => r.id === region)?.title ?? '', KIND_WORDS[kind]].join(' ')),
    });
  }
  const rank = (p: Place): number => (p.region === 'special' ? 2 : p.perch ? 0 : 1);
  return places
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || (REGION_ORDER.get(a.p.region) ?? 0) - (REGION_ORDER.get(b.p.region) ?? 0) || a.i - b.i)
    .map(({ p }) => p);
}
