/** Player-facing (Turkish) texts and time formatting for activities. */
import type { Medal } from './courses';
import type { AbortReason } from './race';

const MINUS = '−';

/** 83.44 → "1:23,4" (minutes:seconds,tenths; Turkish decimal comma). */
export function formatTime(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  const t = tenths % 10;
  return `${m}:${String(s).padStart(2, '0')},${t}`;
}

/** 83.456 → "1:23,46" (minutes:seconds,hundredths): the race clock, finish times and splits. */
export function formatRaceTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')},${String(c).padStart(2, '0')}`;
}

/** Whole seconds → "4:08" (medal targets). */
export function formatTargetTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type DeltaTone = 'faster' | 'slower' | 'even';

/** Colour class of a signed delta (negative = faster than the reference), after rounding to `digits`. */
export function deltaTone(seconds: number, digits = 2): DeltaTone {
  const q = Math.round(Math.abs(seconds) * 10 ** digits);
  if (q === 0) {
    return 'even';
  }
  return seconds < 0 ? 'faster' : 'slower';
}

/**
 * Signed split delta against the best run: -1.237 → "−1,24", 0.8 → "+0,80", 0 → "±0,00" (hundredths, U+2212 minus).
 * Deltas of a minute or more read "−1:02,50".
 */
export function formatSplitDelta(seconds: number, digits = 2): string {
  const scale = 10 ** digits;
  const q = Math.round(Math.abs(seconds) * scale);
  const tone = deltaTone(seconds, digits);
  const sign = tone === 'even' ? '±' : tone === 'faster' ? MINUS : '+';
  const whole = Math.floor(q / scale);
  const frac = digits > 0 ? `,${String(q % scale).padStart(digits, '0')}` : '';
  if (whole >= 60) {
    return `${sign}${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}${frac}`;
  }
  return `${sign}${whole}${frac}`;
}

/** Distance label for the next-gate marker: 637 → "640 m", 1234 → "1,2 km". */
export function formatGateDistance(meters: number): string {
  if (meters < 995) {
    return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  }
  const tenths = Math.round(meters / 100);
  return `${Math.floor(tenths / 10)},${tenths % 10} km`;
}

/** Course length: 10771 → "10,8 km". */
export function formatCourseLength(meters: number): string {
  const tenths = Math.round(meters / 100);
  return `${Math.floor(tenths / 10)},${tenths % 10} km`;
}

export const MEDAL_NAME: Readonly<Record<Medal, string>> = { gold: 'Altın', silver: 'Gümüş', bronze: 'Bronz' };

export const RACE_TEXT = {
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
  /** Start toast (the only toast a race shows). */
  started: (name: string) => `Halka yarışı · ${name}`,
  countdownGo: 'BAŞLA!',
  hud: {
    gate: 'Kapı',
    time: 'Süre',
    split: (i: number) => `Kapı ${i}`,
    ghost: (gap: string) => `Hayalet: ${gap} s`,
    missed: (expected: number) => `Kapı ${expected} kaçırıldı · geri dön`,
    wrongWay: 'Ters yön · kapıdan öbür yönde geç',
    stray: 'Parkurdan uzaklaşıyorsun',
    landing: 'Yere indin · havalan, yoksa yarış biter',
    cancelHint: 'iptal',
  },
  finishCard: {
    title: 'Parkur tamamlandı',
    newRecord: 'YENİ REKOR!',
    firstRecord: 'İlk derece',
    best: 'Rekor',
    previousBest: 'Önceki rekor',
    noMedal: 'Madalya yok',
    targets: 'Hedefler',
    splits: 'Ara dereceler',
    close: 'kapat',
  },
  picker: {
    title: 'Halka yarışı',
    subtitle: 'Parkur seç',
    best: 'Rekor',
    noBest: 'Henüz derece yok',
    gates: (n: number) => `${n} kapı`,
    start: 'başlat',
    choose: 'seç',
    close: 'kapat',
  },
} as const;
