/**
 * Facade / roof colour palettes (sRGB hex) observed in Istanbul streets: cream, off-white and beige apartment
 * plaster, pale yellow / salmon / light grey, occasional ochre and pastel blue; oxblood "aşı boyası" and
 * pastel timber on historic houses and yalıs; weathered terracotta Marseille/alaturka tiles.
 */
export type Palette = readonly (readonly [number, number])[];

export const APARTMENT_WALLS: Palette = [
  [0xe6d9be, 5],
  [0xece7dc, 4],
  [0xd8c4a2, 4],
  [0xe8d59a, 2.6],
  [0xe0ae90, 2.2],
  [0xc8c5be, 3],
  [0xd1a45c, 0.8],
  [0xb6c4cc, 0.8],
  [0xe3bdb2, 1.2],
  [0xc9cfae, 0.5],
  [0xf1efea, 2.4],
  [0xcdb896, 2],
  [0xc57e5b, 0.4],
  [0xbdb3a2, 2],
  [0xd9cfc0, 2.5],
];

export const OLD_APARTMENT_WALLS: Palette = [
  [0xcbbfa3, 3],
  [0xb8ab91, 2],
  [0xd4c7ae, 2],
  [0xa89c86, 1.5],
  [0xc9b08e, 1.5],
  [0xe0d3bd, 1.2],
  [0xd9b8a0, 1.2],
  [0xc7c7b8, 1],
  [0xb9a58f, 1],
  [0xd6c39a, 1],
];

export const HISTORIC_WOOD_WALLS: Palette = [
  [0xd9c9a0, 2.5],
  [0x8b3a2e, 1.5],
  [0x6e4a36, 1],
  [0xc8b79a, 2],
  [0xa7b3b0, 1],
  [0xd6b46a, 1.2],
  [0x7e8c74, 0.6],
  [0xe5d5b8, 2],
  [0xb25d48, 0.8],
  [0xd9a98f, 1],
];

export const YALI_WALLS: Palette = [
  [0x7b3024, 3],
  [0xede6d6, 2.2],
  [0xe8d8b0, 2],
  [0xe3c0b8, 1.4],
  [0xe9d79e, 1.4],
  [0x8e9aa0, 1],
  [0x5a4a3e, 0.7],
  [0xc9d2cc, 0.8],
];

export const VILLA_WALLS: Palette = [
  [0xf0ece2, 4],
  [0xe8dcc0, 3],
  [0xe2c9a6, 2],
  [0xe8d6a8, 1.5],
  [0xd9c2b4, 1.2],
  [0xcfcac0, 1.5],
  [0xbfa889, 0.8],
];

export const MASS_WALLS: Palette = [
  [0xeeeae0, 3],
  [0xe2d6be, 2],
  [0xd6d0c6, 2],
  [0xe5c9a8, 1],
  [0xd9d3b8, 1],
  [0xcfd2d0, 1],
];

export const MASS_ACCENTS: Palette = [
  [0xc9713d, 2],
  [0x6c8fb0, 1.5],
  [0x9db06a, 1],
  [0xb84d3a, 1.5],
  [0xd9a441, 1],
  [0x8a8f96, 1.5],
];

export const GLASS_TINTS: Palette = [
  [0x5e7f86, 3],
  [0x8a9aa3, 2.5],
  [0x4c5e73, 2],
  [0x6f7a74, 1.5],
  [0x9c8e7a, 0.8],
  [0x34414b, 1.2],
  [0x7d9aa4, 1.5],
];

export const OFFICE_WALLS: Palette = [
  [0xc9cbcb, 2],
  [0xe0ddd5, 2],
  [0x8e949a, 1.2],
  [0xd6cfc2, 1.5],
  [0xa7a39a, 1],
];

export const INDUSTRIAL_WALLS: Palette = [
  [0xbfc3c4, 3],
  [0xd8d4c8, 2],
  [0x8c9aa6, 1.2],
  [0xa8b6b0, 1],
  [0xc7b9a0, 1.5],
  [0x9e8f80, 0.8],
];

export const ROOF_TILES: Palette = [
  [0xa65f45, 2.5],
  [0x9a5741, 3],
  [0x8e5443, 3],
  [0x7f4b3d, 2.2],
  [0xa86f58, 1.6],
  [0x6f463a, 1.4],
  [0xb3714f, 1.2],
  [0x946452, 1.5],
  [0x5f4038, 0.6],
  [0xa07a66, 0.8],
]

export const ROOF_FLATS: Palette = [
  [0x8e8b85, 3],
  [0xa19d95, 2.5],
  [0x4a4744, 1.5],
  [0xb5b5b0, 1.2],
  [0xc9c6bf, 1.2],
  [0x948c80, 2],
  [0xa87a60, 0.8],
];

export const INDUSTRIAL_ROOFS: Palette = [
  [0x8f9496, 3],
  [0xa9a9a2, 2],
  [0x6f7b7f, 1.5],
  [0x9a6a55, 1],
  [0xbcbcb4, 1.5],
];

export const AWNINGS: Palette = [
  [0x9e2f2a, 2],
  [0x2f5e8a, 1.5],
  [0x3f6b3a, 1],
  [0xd8c9a8, 1.5],
  [0x6b3a2a, 1],
  [0xc7942f, 1],
];

/** Jitters a colour in RGB (multiplicative brightness + small hue drift) for per-building variety. */
export function jitterColor(hex: number, r1: number, r2: number, amount = 1): number {
  const b = 1 + (r1 - 0.5) * 0.14 * amount;
  const t = (r2 - 0.5) * 0.08 * amount;
  const r = clamp255(((hex >> 16) & 255) * b * (1 + t));
  const g = clamp255(((hex >> 8) & 255) * b);
  const bl = clamp255((hex & 255) * b * (1 - t));
  return (r << 16) | (g << 8) | bl;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
