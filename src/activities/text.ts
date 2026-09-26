/** Player-facing (Turkish) texts and time formatting for activities. */
import type { AbortReason } from './race';

/** 83.44 → "1:23,4" (minutes:seconds,tenths; Turkish decimal comma). */
export function formatTime(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  const t = tenths % 10;
  return `${m}:${String(s).padStart(2, '0')},${t}`;
}

/** Signed difference against a reference: -1.26 → "−1,3 sn", 0.4 → "+0,4 sn". */
export function formatDelta(seconds: number): string {
  const tenths = Math.round(Math.abs(seconds) * 10);
  const sign = seconds < 0 && tenths > 0 ? '−' : '+';
  return `${sign}${Math.floor(tenths / 10)},${tenths % 10} sn`;
}

export const RACE_TEXT = {
  countdown: (name: string, n: number) => `${name} · ${n}`,
  go: (name: string) => `${name} · Başla!`,
  gate: (i: number, total: number, time: string) => `Kapı ${i}/${total} · ${time}`,
  missed: (expected: number) => `Kapı ${expected} kaçırıldı · geri dön`,
  wrongWay: 'Ters yön! Kapıdan öbür yönde geç',
  strayWarning: 'Parkurdan uzaklaşıyorsun',
  finished: (name: string, time: string) => `${name} bitti · ${time}`,
  firstRecord: 'İlk derece kaydedildi',
  newRecord: (delta: string) => `Yeni rekor! (${delta})`,
  noRecord: (best: string, delta: string) => `Rekor ${best} (${delta})`,
  aborted: {
    stray: 'Yarış iptal: parkurdan çok uzaklaştın',
    landed: 'Yarış iptal: ejderha indi',
    cancel: 'Yarış iptal edildi',
    teleport: 'Yarış iptal: ışınlanıldı',
  } satisfies Record<AbortReason, string>,
  label: {
    countdown: 'Geri sayım',
    running: (next: number, total: number) => `Kapı ${next}/${total}`,
    finished: 'Bitti',
    aborted: 'İptal',
  },
  unknownCourse: (id: string) => `Bilinmeyen parkur: ${id}`,
} as const;
