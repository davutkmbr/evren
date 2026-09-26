// Turkish makam pitch system (Arel–Ezgi–Uzdilek, 53 Holdrian commas per octave) and the makam data used by the pieces.
//
// Every perde (pitch name) is stored as its comma offset above Rast inside the middle octave (Rast..Gerdaniye) plus
// the kanun course (diatonic string letter) it is played on. A trailing ' raises by an octave, a trailing , lowers.
// Classical names outside the middle octave (Yegâh, Hüseyni Aşiran, Muhayyer, Tiz Nevâ, ...) are aliases.

export const COMMA_CENTS = 1200 / 53; // 22.64 cents

export type Letter = 'G' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

interface PerdeDef {
  commas: number;
  letter: Letter;
  tr: string; // Turkish spelling, for docs/report
}

/** Middle-octave perdes, commas above Rast (AEU). */
export const PERDE: Record<string, PerdeDef> = {
  rast: { commas: 0, letter: 'G', tr: 'Rast' },
  nimZirgule: { commas: 4, letter: 'G', tr: 'Nîm Zirgüle' },
  zirgule: { commas: 5, letter: 'G', tr: 'Zirgüle' },
  dugah: { commas: 9, letter: 'A', tr: 'Dügâh' },
  kurdi: { commas: 13, letter: 'B', tr: 'Kürdî' },
  dikKurdi: { commas: 14, letter: 'B', tr: 'Dik Kürdî' },
  segah: { commas: 17, letter: 'B', tr: 'Segâh' },
  buselik: { commas: 18, letter: 'B', tr: 'Bûselik' },
  cargah: { commas: 22, letter: 'C', tr: 'Çârgâh' },
  nimHicaz: { commas: 26, letter: 'C', tr: 'Nîm Hicaz' },
  hicaz: { commas: 27, letter: 'C', tr: 'Hicaz' },
  dikHicaz: { commas: 30, letter: 'C', tr: 'Dik Hicaz' },
  neva: { commas: 31, letter: 'D', tr: 'Nevâ' },
  nimHisar: { commas: 35, letter: 'E', tr: 'Nîm Hisar' },
  hisar: { commas: 36, letter: 'E', tr: 'Hisar' },
  dikHisar: { commas: 39, letter: 'E', tr: 'Dik Hisar' },
  huseyni: { commas: 40, letter: 'E', tr: 'Hüseynî' },
  acem: { commas: 44, letter: 'F', tr: 'Acem' },
  dikAcem: { commas: 45, letter: 'F', tr: 'Dik Acem' },
  evic: { commas: 48, letter: 'F', tr: 'Eviç' },
  mahur: { commas: 49, letter: 'F', tr: 'Mâhûr' },
  dikMahur: { commas: 52, letter: 'F', tr: 'Dik Mâhûr' },
};

/** Classical names of pitches outside the middle octave. */
export const ALIASES: Record<string, string> = {
  yegah: 'neva,',
  huseyniAsiran: 'huseyni,',
  acemAsiran: 'acem,',
  irak: 'evic,',
  gevest: 'mahur,',
  kabaCargah: 'cargah,',
  gerdaniye: "rast'",
  muhayyer: "dugah'",
  sunbule: "dikKurdi'",
  tizSegah: "segah'",
  tizBuselik: "buselik'",
  tizCargah: "cargah'",
  tizNimHicaz: "nimHicaz'",
  tizNeva: "neva'",
  tizHuseyni: "huseyni'",
};

const LETTER_INDEX: Record<Letter, number> = { G: 0, A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 };

export interface Pitch {
  name: string; // as written
  commas: number; // commas above middle Rast (may be negative / > 53)
  course: number; // diatonic string index: middle Rast (G) = 0, Dügâh = 1, ..., Gerdaniye = 7
}

export function parsePerde(nameIn: string): Pitch {
  let name = nameIn;
  let oct = 0;
  // resolve alias (possibly with further octave marks appended)
  const base = name.replace(/[',]+$/, '');
  const marks = name.slice(base.length);
  const resolved = ALIASES[base] ? ALIASES[base] + marks : name;
  let core = resolved;
  while (core.endsWith("'") || core.endsWith(',')) {
    oct += core.endsWith("'") ? 1 : -1;
    core = core.slice(0, -1);
  }
  const def = PERDE[core];
  if (!def) throw new Error(`unknown perde "${nameIn}"`);
  return { name: nameIn, commas: def.commas + 53 * oct, course: LETTER_INDEX[def.letter] + 7 * oct };
}

/** Frequency of a comma offset, given the frequency of middle Dügâh (the tuning "ahenk" of the piece). */
export function commasToHz(commas: number, dugahHz: number): number {
  return dugahHz * Math.pow(2, (commas - 9) / 53);
}

export function centsToHz(centsAboveDugah: number, dugahHz: number): number {
  return dugahHz * Math.pow(2, centsAboveDugah / 1200);
}

/** Kanun mandal quantisation: modern Turkish kanuns divide the semitone into six mandal steps (72-EDO, 16.67 c). */
export function kanunMandalCents(commas: number): number {
  const cents = (commas - 9) * COMMA_CENTS; // relative to Dügâh (an open, un-mandalled A course)
  return Math.round(cents / (100 / 6)) * (100 / 6);
}

export interface Makam {
  name: string;
  tr: string;
  /** Ascending scale, with alternative descending pitches noted separately. */
  ascending: string[];
  descending?: string[];
  durak: string; // tonic / final
  guclu: string; // dominant
  yeden: string; // leading tone below the durak
  seyir: string; // melodic progression rule (English summary)
  cinsler: string; // tetrachord/pentachord structure
  /** Performance-practice overrides in commas (applied on top of AEU values), e.g. the low Uşşak segâh. */
  practice?: Record<string, number>;
}

export const MAKAMS: Record<string, Makam> = {
  hicaz: {
    name: 'Hicaz',
    tr: 'Hicaz',
    ascending: ['dugah', 'dikKurdi', 'nimHicaz', 'neva', 'huseyni', 'evic', 'gerdaniye', 'muhayyer'],
    descending: ['muhayyer', 'gerdaniye', 'acem', 'huseyni', 'neva', 'nimHicaz', 'dikKurdi', 'dugah'],
    durak: 'dugah',
    guclu: 'neva',
    yeden: 'rast',
    cinsler: 'Hicaz tetrachord on Dügâh (5+12+5 commas) + Rast pentachord on Nevâ (9+8+5+9); Acem instead of Eviç when descending',
    seyir:
      'Inici-çıkıcı: open around the güçlü Nevâ, show the Hicaz tetrachord on Dügâh, touch the yeden Rast, rise through the Rast pentachord on Nevâ to Muhayyer, descend with Acem, suspend (asma kalış) on Nevâ and cadence on Dügâh through Nîm Hicaz – Dik Kürdî.',
  },
  ussak: {
    name: 'Ussak',
    tr: 'Uşşak',
    ascending: ['dugah', 'segah', 'cargah', 'neva', 'huseyni', 'acem', 'gerdaniye', 'muhayyer'],
    durak: 'dugah',
    guclu: 'neva',
    yeden: 'rast',
    cinsler: 'Uşşak tetrachord on Dügâh (8+5+9 commas) + Bûselik pentachord on Nevâ (9+4+9+9)',
    seyir:
      'Çıkıcı: start at the durak, show the Uşşak tetrachord with its low Segâh, suspend on the güçlü Nevâ, reach Gerdaniye/Muhayyer, come down with a suspension on Segâh and cadence Çârgâh – Segâh – Dügâh.',
    // Performers play the Uşşak segâh noticeably lower than the AEU 8-comma value (about 150–165 cents above Dügâh).
    practice: { segah: -1 },
  },
  nihavend: {
    name: 'Nihavend',
    tr: 'Nihâvend',
    ascending: ['rast', 'dugah', 'kurdi', 'cargah', 'neva', 'nimHisar', 'acem', 'gerdaniye'],
    descending: ['gerdaniye', 'acem', 'nimHisar', 'neva', 'cargah', 'kurdi', 'dugah', 'rast'],
    durak: 'rast',
    guclu: 'neva',
    yeden: 'acemAsiran',
    cinsler:
      'Bûselik pentachord on Rast (9+4+9+9 commas) + Kürdî tetrachord on Nevâ (4+9+9); Hicaz tetrachord on Nevâ (Hisar, Eviç) as a colour when rising',
    seyir:
      'Inici-çıkıcı: open around the güçlü Nevâ, touch Gerdaniye, suspend on Nevâ and Çârgâh, descend through the Bûselik pentachord (Kürdî, Dügâh) and cadence on Rast, using Acem Aşiran (or Irak) as the yeden.',
  },
};

/** Resolve a perde name to commas, applying a makam's performance-practice overrides. */
export function pitchInMakam(name: string, makam?: Makam): Pitch {
  const p = parsePerde(name);
  if (makam?.practice) {
    const base = (ALIASES[name.replace(/[',]+$/, '')] ?? name).replace(/[',]+$/, '');
    const adj = makam.practice[base];
    if (adj) return { ...p, commas: p.commas + adj };
  }
  return p;
}
