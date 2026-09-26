/**
 * Download file names for album photos: `seventeen-skies-<place>-<date>.<ext>`, safe ASCII only (Turkish letters
 * folded: "Kız Kulesi" → "kiz-kulesi", "Üsküdar" → "uskudar"). Pure.
 */

const FOLD: Record<string, string> = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  â: 'a', Â: 'a', î: 'i', Î: 'i', û: 'u', Û: 'u', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l',
};

/** Lowercase ASCII slug: letters and digits, words joined by "-", at most `max` characters; '' when nothing is left. */
export function slugify(text: string, max = 40): string {
  const folded = Array.from(String(text ?? ''), (ch) => FOLD[ch] ?? ch).join('');
  const ascii = folded.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length <= max) {
    return slug;
  }
  const cut = slug.slice(0, max);
  const dash = cut.lastIndexOf('-');
  return (dash > max * 0.5 ? cut.slice(0, dash) : cut).replace(/-+$/g, '');
}

const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** "2026-09-26" in local time. */
export function isoDate(ms: number): string {
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** `seventeen-skies-galata-kulesi-2026-09-26.webp`. */
export function photoFileName(place: string, takenAt: number, mime: string): string {
  const slug = slugify(place) || 'istanbul';
  return `seventeen-skies-${slug}-${isoDate(takenAt)}.${EXT[mime] ?? 'webp'}`;
}
