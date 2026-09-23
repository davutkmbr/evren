/** Greybox materials of format 0: one flat colour each (sRGB hex; glTF baseColorFactor stores them linear). */
export const MATERIALS = {
  wall: 0xb8ada0,
  roof: 0x7a3b2e,
  road: 0x303236,
  sidewalk: 0x9c9c98,
  kerb: 0xe8e6dc,
  pedestrian: 0xc2a878,
  quay: 0x6b7885,
  lot: 0x6f6a55,
  grass: 0x55743a,
  door: 0xc42020,
  doorInferred: 0xf08a10,
} as const;

export type MaterialName = keyof typeof MATERIALS;

export const MATERIAL_ORDER = Object.keys(MATERIALS) as MaterialName[];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear RGBA baseColorFactor of a material. */
export function baseColor(name: MaterialName): [number, number, number, number] {
  const hex = MATERIALS[name];
  const ch = (s: number): number => Math.round(srgbToLinear(((hex >> s) & 255) / 255) * 10000) / 10000;
  return [ch(16), ch(8), ch(0), 1];
}
