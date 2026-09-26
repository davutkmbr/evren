/**
 * Material ids of the rider mesh (aData.x). Colours are not baked in: cloth ids pick the appearance's primary /
 * secondary / accent colour and the leather / metal tones through the material's uniforms, so recolouring needs no
 * rebuild. Channels: aData.y = ch0 (wear on leather and metal, the cloak's length parameter, pattern bands on cloth),
 * aExtra = ch1 lips, ch2 eyebrows, ch3 beard shadow (skin).
 */
export const RM = {
  skin: 0,
  hair: 1,
  eye: 2,
  primary: 3,
  secondary: 4,
  accent: 5,
  linen: 6,
  leather: 7,
  darkLeather: 8,
  iron: 9,
  metal: 10,
  fur: 11,
  glass: 12,
  cloak: 13,
  felt: 14,
  nail: 15,
  teeth: 16,
} as const;

/** Paint channel indices. */
export const CH = { wear: 0, lip: 1, brow: 2, beard: 3 } as const;
