/**
 * OSM colour tags (colour, building:colour, roof:colour): #hex (3 or 6 digits), CSS colour names (spaces and
 * underscores ignored, "light_grey" = "lightgrey") and the Turkish colour words mappers in Istanbul use. Anything else
 * reads as "no colour" (null), so the caller falls back to its own palette: THREE.Color.setStyle would log a warning
 * and leave the colour white instead.
 */
import * as THREE from 'three';

/** Turkish colour words (lower case, Turkish letters folded to ASCII) as sRGB hex. */
const TURKISH: Record<string, number> = {
  kiremit: 0xb4553a, // roof-tile red
  kiremitrengi: 0xb4553a,
  kirmizi: 0xb03a2e,
  bordo: 0x7a2630,
  turuncu: 0xd9782d,
  sari: 0xd8b84a,
  hardal: 0xb8912f,
  yesil: 0x5f8a4a,
  mavi: 0x4a6f9a,
  lacivert: 0x2c3a5a,
  mor: 0x6a4a7a,
  pembe: 0xd99aa5,
  beyaz: 0xf2efe8,
  krem: 0xece0c2,
  bej: 0xd6c3a0,
  gri: 0x8c8c8c,
  acikgri: 0xb8b8b8,
  koyugri: 0x5a5a5a,
  siyah: 0x222222,
  kahverengi: 0x7a5236,
  kahve: 0x7a5236,
  bakir: 0xa8663a,
  kursun: 0x6d7879, // lead (domes)
};

function fold(v: string): string {
  return v
    .toLocaleLowerCase('tr')
    .replace(/[\s_-]+/g, '')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

/** sRGB hex of an OSM colour value, or null when it is not a colour this parser knows. */
export function osmColourHex(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const v = fold(value.trim());
  const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(v);
  if (hex && (v.startsWith('#') || /\d/.test(hex[1]))) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return parseInt(h, 16);
  }
  const names = THREE.Color.NAMES as Record<string, number>;
  if (v in names) {
    return names[v];
  }
  return v in TURKISH ? TURKISH[v] : null;
}

/** The colour as a THREE.Color (linear, from sRGB), or null when unreadable. */
export function osmColour(value: string | undefined, out = new THREE.Color()): THREE.Color | null {
  const hex = osmColourHex(value);
  return hex === null ? null : out.setHex(hex, THREE.SRGBColorSpace);
}
