import type { CameraMode, DebugFlags } from './contracts';
import { latLonToLocal } from './geo-coords';

export function parseDebugFlags(search = window.location.search): DebugFlags {
  const params = new URLSearchParams(search);
  const num = (k: string) => (params.has(k) ? Number(params.get(k)) : undefined);
  const flag = (k: string) => params.get(k) === '1' || params.get(k) === 'true';
  const cam = params.get('cam') as CameraMode | null;
  return {
    view: params.get('view') ?? undefined,
    time: num('t'),
    cam: cam ?? undefined,
    quality: params.get('q') ?? undefined,
    freeze: flag('freeze'),
    autopilot: flag('autopilot'),
    stats: flag('stats'),
    nohud: flag('nohud'),
    params,
  };
}

export interface ViewPreset {
  /** Turkish label for UI. */
  label: string;
  /** Dragon position (local meters). */
  x: number;
  y: number;
  z: number;
  /** Dragon heading (compass degrees). */
  headingDeg: number;
  /** Nose pitch in degrees (+ up). */
  pitchDeg: number;
  /** Suggested time of day. */
  time?: number;
}

function preset(label: string, lat: number, lon: number, y: number, headingDeg: number, pitchDeg = 0, time?: number): ViewPreset {
  const p = latLonToLocal(lat, lon);
  return { label, x: p.x, y, z: p.z, headingDeg, pitchDeg, time };
}

/** Named spawn/view points (?view=name). The flight system teleports the dragon here. */
export const VIEW_PRESETS: Record<string, ViewPreset> = {
  spawn: preset('Sarayburnu üzeri', 41.0085, 28.9745, 260, 55, -4),
  sultanahmet: preset('Sultanahmet', 41.0035, 28.9645, 180, 75, -6),
  ayasofya: preset('Ayasofya', 41.0125, 28.9905, 140, 215, -8),
  galata: preset('Galata', 41.0185, 28.9625, 160, 60, -5),
  halic: preset('Haliç', 41.0335, 28.9465, 150, 125, -3),
  bogaz: preset('Boğaz girişi', 41.0125, 29.0005, 220, 30, -3),
  koprusu: preset('15 Temmuz Şehitler Köprüsü', 41.0335, 29.0265, 120, 30, 2),
  fsm: preset('FSM Köprüsü', 41.0735, 29.0525, 140, 10, 0),
  rumelihisari: preset('Rumeli Hisarı', 41.0795, 29.0495, 110, 40, -4),
  kizkulesi: preset('Kız Kulesi', 41.0165, 29.0025, 60, 20, -2),
  uskudar: preset('Üsküdar', 41.0265, 29.0065, 140, 110, -4),
  levent: preset('Levent', 41.0655, 28.9855, 320, 45, -2),
  camlica: preset('Çamlıca', 41.0185, 29.0455, 360, 45, -4),
  adalar: preset('Adalar', 40.8985, 29.0765, 300, 150, -4),
  karadeniz: preset('Karadeniz girişi', 41.1805, 29.0905, 350, 20, -2),
  yuksek: preset('Bulutların üstü', 41.0205, 28.9905, 2600, 45, -8),
  gece: preset('Gece Boğaz', 41.0335, 29.0265, 180, 30, -2, 21.5),
};
