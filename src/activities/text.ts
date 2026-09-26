/** Player-facing (Turkish) texts and time formatting for activities. */
import { medalFor, type Medal, type MedalTimes } from './courses';
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

/** Seconds with one decimal and a comma: 16.4 → "16,4". */
function tenths(seconds: number): string {
  const q = Math.max(0, Math.round(seconds * 10));
  return `${Math.floor(q / 10)},${q % 10}`;
}

/**
 * What the next medal needs after a finish in `time` (result screen): the gap to the next better target, rounded UP to
 * tenths (the least improvement that earns it); for gold the target itself; without a medal the bronze target.
 */
export function nextMedalText(time: number, medals: MedalTimes): string {
  const medal = medalFor(time, medals);
  if (medal === 'gold') {
    return `Hedef ${formatTargetTime(medals.gold)} · en iyi derece`;
  }
  if (medal === null) {
    return `Bronz için ${formatTargetTime(medals.bronze)}`;
  }
  const next: Medal = medal === 'silver' ? 'gold' : 'silver';
  const need = Math.ceil((time - medals[next]) * 10 - 1e-6) / 10;
  return `${MEDAL_NAME[next]} için ${tenths(Math.max(0.1, need))} s daha hızlı`;
}

/** Live gap to the ghost (s, negative = ahead of it): "Hayalet 2,1 s geride", "Hayalet 1,4 s önde", "Hayalet yanında". */
export function ghostGapText(gap: number): string {
  const tone = deltaTone(gap, 1);
  if (tone === 'even') {
    return 'Hayalet yanında';
  }
  return `Hayalet ${tenths(Math.abs(gap))} s ${tone === 'faster' ? 'geride' : 'önde'}`;
}

/** Placement problems that make a gate or speed ring invalid (custom-courses PlacementProblem minus 'bounds'). */
export type SkipReason = 'terrain' | 'structure';

/**
 * Save dialog warning for the invalid gates and speed rings that saving will skip, with the reason when they share
 * one: "1 geçersiz kapı atlanacak (yere değiyor)." Empty when nothing is skipped.
 */
export function skippedWarning(gates: readonly SkipReason[], rings: readonly SkipReason[]): string {
  if (gates.length === 0 && rings.length === 0) {
    return '';
  }
  const parts = [gates.length > 0 ? `${gates.length} geçersiz kapı` : '', rings.length > 0 ? `${rings.length} geçersiz hız halkası` : ''].filter(Boolean);
  const reasons = new Set([...gates, ...rings]);
  const why = reasons.size === 1 ? ` (${RACE_TEXT.editor.problem[[...reasons][0]]})` : '';
  return `${parts.join(', ')} atlanacak${why}.`;
}

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
  countdown: {
    go: 'Başla!',
    sub: 'İlk kapıya doğru uç',
    goSub: 'Kapıdan geç, süre akıyor',
    counts: (gates: number, rings: number) => (rings > 0 ? `${gates} kapı · ${rings} hız halkası` : `${gates} kapı`),
    ghost: (best: string) => `Hayalet: rekorun ${best}`,
    cancel: 'iptal',
    lesson: 'Süre tutulmaz, adım adım',
  },
  /** Guided chain practice (lesson.ts). */
  lesson: {
    step: (n: number, total: number) => `Adım ${n}/${total}`,
    finished: (done: number, total: number) => (done >= total ? 'Antrenman tamamlandı' : `Antrenman bitti · ${done}/${total} adım`),
    rowSub: (length: string, steps: number) => `Antrenman · ${length} · ${steps} adım`,
    start: 'Antrenmana başla',
    note: 'Başlangıca ışınlanır · süre ve madalya yok',
  },
  hud: {
    gate: (passed: number, total: number) => `Kapı ${passed}/${total}`,
    missed: (expected: number) => `Kapı ${expected} kaçırıldı · geri dön`,
    wrongWay: 'Ters yön · kapıdan öbür yönde geç',
    stray: 'Parkurdan uzaklaşıyorsun',
    landing: 'Yere indin · havalan, yoksa yarış biter',
    boost: (dv: number) => `+${dv} m/s`,
  },
  finish: {
    done: (name: string) => `${name} tamamlandı`,
    newRecord: 'Yeni rekor',
    firstRecord: 'İlk derece',
    noMedal: 'Madalya yok',
    medal: (m: Medal) => `${MEDAL_NAME[m]} madalya`,
    previousBest: 'Önceki rekor',
    delta: 'Fark',
    rings: 'Hız halkası',
    retry: 'Tekrar',
    courses: 'Parkurlar',
    close: 'Uçmaya devam',
    chartTitle: 'Kapı kapı fark',
    chartSub: 'Önceki rekora göre, o kapıya kadar kazanılan veya kaybedilen saniye',
    chartLabel: 'Kapı kapı fark: önceki rekora göre kazanılan veya kaybedilen saniye',
    faster: 'Daha hızlı',
    slower: 'Daha yavaş',
    firstRunNote: 'İlk derecen bu. Bir sonraki koşuda kapı kapı farkı burada göreceksin.',
    noSplitsNote: 'Önceki rekorun ara dereceleri bu parkurla eşleşmiyor, kapı kapı fark gösterilemiyor.',
    tipSplit: (split: string) => `Ara derece ${split}`,
    tipDelta: (delta: string) => `Rekora göre ${delta} s`,
    gate: (n: number) => `Kapı ${n}`,
    finishGate: (name: string) => `${name} (bitiş)`,
  },
  picker: {
    title: 'Halka yarışları',
    counts: (courses: number, medals: number) => `${courses} parkur · ${medals} madalya`,
    close: 'Kapat',
    list: 'Parkurlar',
    newCourse: 'Yeni parkur',
    customTag: 'Senin parkurun',
    customDesc: (rings: number) => (rings > 0 ? `Senin parkurun · ${rings} hız halkası` : 'Senin parkurun'),
    rowSub: (custom: boolean, length: string, gates: number) => `${custom ? 'Senin parkurun · ' : ''}${length} · ${gates} kapı`,
    edit: 'Düzenle',
    copyCode: 'Kodu kopyala',
    remove: 'Sil',
    removeConfirm: 'Silmek için tekrar bas',
    length: 'Uzunluk',
    gatesRings: 'Kapı · hız halkası',
    best: 'Rekorun',
    runs: 'Koşu',
    start: 'Yarışa başla',
    ghost: 'Hayalet',
    ghostNone: 'yok',
    note: 'Başlangıca ışınlanır, 3 sn geri sayım',
    mapLabel: (name: string) => `${name} parkur haritası`,
    legendGate: 'Kapı',
    legendRing: 'Hız halkası',
    legendStart: 'Başlangıç',
    importCode: 'Paylaşılan parkur kodu',
    importPlaceholder: 'EVR1.… yapıştır, Enter',
    importHint: 'Enter içe aktar · Esc vazgeç',
  },
  editor: {
    title: (name: string | undefined) => `Parkur editörü · ${name ?? 'Yeni parkur'}`,
    placing: (size: string) => `Kapı · ${size}`,
    placingRing: 'Hız halkası',
    counts: (gates: number, rings: number, length: string) => `${gates} kapı · ${rings} hız halkası · ${length}`,
    size: { small: 'küçük', medium: 'orta', large: 'büyük' } as const,
    keys: {
      place: 'Buraya koy',
      kind: 'Kapı ↔ hız halkası',
      size: 'Kapı boyutu',
      undo: 'Sonuncuyu sil',
      save: 'Kaydet',
      exit: 'Çık',
    },
    problem: { terrain: 'yere değiyor', structure: 'yapının içinde' } as const,
    invalidCount: (n: number) => `${n} geçersiz halka · kaydederken atlanır`,
    minGates: (min: number) => `En az ${min} geçerli kapı gerekli`,
    saveTitle: 'Parkuru kaydet',
    namePrompt: 'Parkurun adı',
    cancel: 'Vazgeç',
    save: 'Kaydet',
  },
  editorToast: {
    started: 'Parkur editörü · uç ve B ile halka koy',
    placedGate: (n: number) => `Kapı ${n} yerleştirildi`,
    placedRing: (n: number) => `Hız halkası ${n} yerleştirildi`,
    invalid: {
      terrain: 'Halka yere ya da suya değiyor · kaydederken atlanacak',
      structure: 'Halka bir yapının içinde · kaydederken atlanacak',
    },
    refused: {
      limit: 'Daha fazla halka eklenemez',
      spacing: 'Önceki kapıya çok yakın',
      bounds: 'Harita sınırının dışında',
    },
    removed: 'Son halka silindi',
    nothingToRemove: 'Silinecek halka yok',
    exitConfirm: 'Kaydedilmemiş değişiklikler var · çıkmak için Y’ye tekrar bas',
    exited: 'Parkur editörü kapatıldı',
    saved: (name: string) => `Parkur kaydedildi · ${name}`,
    skipped: (gates: number, rings: number) =>
      [gates > 0 ? `${gates} geçersiz kapı` : '', rings > 0 ? `${rings} geçersiz hız halkası` : ''].filter(Boolean).join(', ') + ' atlandı',
    tooFew: (valid: number, min: number) => `Kaydedilemedi: ${valid} geçerli kapı var, en az ${min} gerekli`,
    leadIn: 'Kaydedilemedi: ilk kapının arkası engelli (başlangıç yaklaşması için açık alan gerekli)',
    limit: (max: number) => `En fazla ${max} parkur kaydedilebilir · önce birini sil`,
    duplicate: 'Bu parkur zaten kayıtlı',
    busy: 'Önce yarışı bitir ya da iptal et',
  },
  share: {
    copied: 'Parkur kodu panoya kopyalandı',
    copyFallback: 'Kod alana yazıldı · Ctrl+C ile kopyala',
    imported: (name: string) => `Parkur içe aktarıldı · ${name}`,
    errors: {
      empty: 'Önce bir parkur kodu yapıştır',
      format: 'Bu bir parkur kodu değil',
      size: 'Kod çok uzun',
      data: 'Parkur kodu bozuk ya da geçersiz',
    },
    deleted: (name: string) => `Parkur silindi · ${name}`,
  },
} as const;
