/**
 * Shop sign lettering: a 5x7 bitmap font (A-Z plus the Turkish diacritics) and the words shop signs in the slice
 * carry, compiled into GLSL for the sign shader (materials.ts). Signs pick a trade word by the category of the
 * mapped POI in front of the shop (facade.ts encodes it in the sign depth, see signDepth()) and sometimes prefix a
 * family / place name, e.g. "YILDIZ BÖREK", "GALATA OPTİK". The words are in-world Turkish signage.
 */

/** 5x7 glyphs, rows top to bottom, '#' = ink. */
const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
};
const LETTERS = Object.keys(GLYPHS);
/** Diacritic codes (added as 32 * code to the letter index). */
const MARKS: Record<string, [string, number]> = { Ç: ['C', 3], Ğ: ['G', 4], İ: ['I', 1], Ö: ['O', 2], Ş: ['S', 3], Ü: ['U', 2] };
const SPACE = 31;

/** Trade words per sign category (0 shops, 1 food and drink, 2 services, 3 lodging) and name prefixes. */
const WORDS: string[][] = [
  ['MARKET', 'BAKKAL', 'TEKEL', 'BÜFE', 'KIRTASİYE', 'HIRDAVAT', 'TERZİ', 'KUYUMCU', 'OPTİK', 'BERBER', 'KUAFÖR', 'ÇİÇEKÇİ', 'MANAV', 'GİYİM', 'AYAKKABI', 'PARFÜM', 'SAAT', 'KİTAP', 'ELEKTRİK', 'NALBUR', 'EMLAK', 'TEKSTİL', 'BUTİK', 'ZÜCCACİYE', 'ŞARKÜTERİ', 'TELEFON'],
  ['KAFE', 'LOKANTA', 'RESTORAN', 'BÖREK', 'PASTANE', 'DÖNER', 'KEBAP', 'BALIK', 'SİMİT', 'FIRIN', 'MEYHANE', 'KAHVE', 'ÇAY EVİ', 'BAR', 'TATLI', 'PİDE', 'KÖFTE', 'CAFE'],
  ['ECZANE', 'BANKA', 'DÖVİZ', 'SİGORTA', 'NOTER', 'KARGO', 'TURİZM'],
  ['OTEL', 'HOTEL', 'PANSİYON', 'SUİTES'],
];
const NAMES = ['YILDIZ', 'ÖZ', 'GÜNEŞ', 'ASLAN', 'DOĞAN', 'ŞİMŞEK', 'GALATA', 'PERA', 'KARAKÖY', 'BEYOĞLU', 'TÜNEL', 'YENİ', 'ALTIN', 'DENİZ', 'ÇINAR', 'KARDEŞLER', 'BOĞAZ', 'HALİÇ', 'TOPHANE', 'CİHANGİR', 'ŞAHİN', 'KAYA', 'ÖZTÜRK', 'EMİNÖNÜ'];

/** Sign depth (m) carrying the category for the shader: 0.14 + 0.01 * category. */
export function signDepth(category: number): number {
  return 0.14 + 0.01 * category;
}

function encode(word: string): number[] {
  const out: number[] = [];
  for (const ch of word) {
    if (ch === ' ') {
      out.push(SPACE);
      continue;
    }
    const [base, mark] = MARKS[ch] ?? [ch, 0];
    const idx = LETTERS.indexOf(base);
    if (idx < 0) {
      throw new Error(`[osm:signs] no glyph for "${ch}"`);
    }
    out.push(idx + 32 * mark);
  }
  return out;
}

function glyphBits(rows: string[]): [number, number] {
  let lo = 0;
  let hi = 0;
  rows.forEach((row, r) => {
    let bits = 0;
    for (let c = 0; c < 5; c++) {
      bits = bits * 2 + (row[c] === '#' ? 1 : 0);
    }
    if (r < 4) {
      lo += bits * 2 ** (5 * r);
    } else {
      hi += bits * 2 ** (5 * (r - 4));
    }
  });
  return [lo, hi];
}

const intArray = (name: string, v: number[]): string => `const int ${name}[${v.length}] = int[${v.length}](${v.join(', ')});`;

function buildGlsl(): string {
  const lo: number[] = [];
  const hi: number[] = [];
  for (const l of LETTERS) {
    const [a, b] = glyphBits(GLYPHS[l]);
    lo.push(a);
    hi.push(b);
  }
  const chars: number[] = [];
  const start: number[] = [];
  const len: number[] = [];
  const catStart: number[] = [];
  const catCount: number[] = [];
  const add = (w: string): void => {
    const e = encode(w);
    start.push(chars.length);
    len.push(e.length);
    chars.push(...e);
  };
  for (const list of [...WORDS, NAMES]) {
    catStart.push(start.length);
    catCount.push(list.length);
    list.forEach(add);
  }
  return /* glsl */ `
${intArray('SIGN_FONT_LO', lo)}
${intArray('SIGN_FONT_HI', hi)}
${intArray('SIGN_CHARS', chars)}
${intArray('SIGN_WSTART', start)}
${intArray('SIGN_WLEN', len)}
${intArray('SIGN_CSTART', catStart)}
${intArray('SIGN_CCOUNT', catCount)}

// Ink of glyph code \`code\` at pixel (col, row); rows -2..-1 carry marks above, row 7..8 the cedilla.
float signPixel(int code, int col, int row) {
  if (code == ${SPACE} || col < 0 || col > 4) return 0.0;
  int letter = code & 31;
  int mark = code >> 5;
  if (row >= 0 && row < 7) {
    int bits = row < 4 ? (SIGN_FONT_LO[letter] >> (5 * row)) : (SIGN_FONT_HI[letter] >> (5 * (row - 4)));
    return float((bits >> (4 - col)) & 1);
  }
  if (row == -2) {
    if (mark == 1) return col == 2 ? 1.0 : 0.0;
    if (mark == 2) return col == 1 || col == 3 ? 1.0 : 0.0;
    if (mark == 4) return col == 1 || col == 3 ? 1.0 : 0.0;
  }
  if (row == -1 && mark == 4) return col == 2 ? 1.0 : 0.0;
  if (row == 7 && mark == 3) return col == 2 ? 1.0 : 0.0;
  if (row == 8 && mark == 3) return col == 1 ? 1.0 : 0.0;
  return 0.0;
}

// Lettering coverage on a sign face: p = metric position on the face (centre origin), half size (hw, hh),
// category 0..3, h = per-sign hash; fw = metric pixel footprint (fwidth) for the far-distance fallback.
float signText(vec2 p, float hw, float hh, int cat, float h, float fw) {
  int word = SIGN_CSTART[cat] + int(fract(h * 7.31) * float(SIGN_CCOUNT[cat]));
  int name = SIGN_CSTART[4] + int(fract(h * 3.17) * float(SIGN_CCOUNT[4]));
  int wl = SIGN_WLEN[word];
  int nl = SIGN_WLEN[name];
  float px = min(hh * 2.0 * 0.82 / 11.0, 0.075);
  float adv = px * 6.0;
  bool useName = fract(h * 5.13) < 0.55 && float(wl + nl + 1) * adv < hw * 1.8;
  int n = useName ? wl + nl + 1 : wl;
  px = min(px, hw * 1.8 / (float(n) * 6.0));
  adv = px * 6.0;
  float total = float(n) * adv - px;
  float x = p.x + total * 0.5;
  if (x < 0.0 || x >= total + px) return 0.0;
  int i = int(floor(x / adv));
  int code = useName ? (i < nl ? SIGN_CHARS[SIGN_WSTART[name] + i] : i == nl ? ${SPACE} : SIGN_CHARS[SIGN_WSTART[word] + i - nl - 1]) : SIGN_CHARS[SIGN_WSTART[word] + i];
  float cx = x - float(i) * adv;
  float ry = (3.5 * px - p.y) / px;
  if (px < fw * 0.7) {
    // Too small to resolve: average ink density of a line of text.
    return code == ${SPACE} ? 0.0 : 0.3 * step(0.0, ry) * step(ry, 7.0);
  }
  if (px > fw * 2.5) {
    return signPixel(code, int(floor(cx / px)), int(floor(ry)));
  }
  // 2x2 supersampling while a font pixel covers only a few screen pixels.
  float o = 0.25 * fw / px;
  float acc = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 q = vec2(cx / px, ry) + vec2(k == 0 || k == 2 ? -o : o, k < 2 ? -o : o);
    acc += signPixel(code, int(floor(q.x)), int(floor(q.y)));
  }
  return acc * 0.25;
}
`;
}

export const SIGN_GLSL = buildGlsl();
