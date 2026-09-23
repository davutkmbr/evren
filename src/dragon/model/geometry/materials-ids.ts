/** Per-vertex material ids stored in aData.x of the body mesh. */
export const MAT = {
  skin: 0,
  horn: 1,
  tooth: 2,
  eye: 3,
  mouth: 4,
  claw: 5,
  tongue: 6,
} as const;

/** Per-vertex material ids stored in aData.x of the rider mesh. */
export const RIDER_MAT = {
  wool: 0,
  leather: 1,
  metal: 2,
  skin: 3,
  darkLeather: 4,
  linen: 5,
  fur: 6,
  cloak: 7,
  glass: 8,
  brass: 9,
} as const;
