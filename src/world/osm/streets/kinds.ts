/**
 * Street prop kinds shared by streets.worker.ts (placement) and index.ts / props.ts (geometry), without three.js:
 * instance record layout, lamp light types and the lamp head offsets used for light pools and far-away head sprites.
 */

/** Instanced street furniture models (one InstancedMesh each). */
export const PROP_KINDS = [
  'lampArm',
  'lampArmLow',
  'lampDouble',
  'lampLantern',
  'lampWall',
  'signal',
  'bollard',
  'tramCanopy',
  'ticketGate',
  'catenaryCentre',
  'catenarySide',
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/**
 * Light of a lamp instance (per-instance `aLight`): the prop shader and the pool / sprite colours read it.
 * Istanbul mixes orange high-pressure sodium, white LED on the renewed main roads and warm white historic lanterns.
 */
export const Light = { None: 0, Sodium: 1, Led: 2, Warm: 3 } as const;
export type Light = (typeof Light)[keyof typeof Light];

/** Linear light colours (pools, sprites). */
export const LIGHT_RGB: Record<number, [number, number, number]> = {
  [Light.Sodium]: [1.0, 0.46, 0.13],
  /** ~3500-4000 K retrofit LED (the night grade desaturates, so sources stay a little warmer than neutral). */
  [Light.Led]: [1.0, 0.86, 0.7],
  /** ~2700 K historic lanterns. */
  [Light.Warm]: [1.0, 0.63, 0.3],
};

/**
 * Ground pool colours: the lamp colours with extra chroma, because the lit ground sits in the mid-tones where the
 * night grade's scotopic shift (composite.glsl.ts Purkinje) desaturates and cools it again.
 */
export const POOL_RGB: Record<number, [number, number, number]> = {
  [Light.Sodium]: [1.0, 0.38, 0.07],
  [Light.Led]: [1.0, 0.8, 0.56],
  [Light.Warm]: [1.0, 0.48, 0.13],
};

/** Lamp head position in model space (+X = the way the arm reaches / the lamp faces) and pool radius (m). */
export const LAMP_HEADS: Partial<Record<PropKind, { heads: [number, number, number][]; pool: number; gain: number }>> = {
  lampArm: { heads: [[1.75, 8.3, 0]], pool: 17, gain: 1.0 },
  lampArmLow: { heads: [[1.2, 6.2, 0]], pool: 13, gain: 0.95 },
  lampDouble: {
    heads: [
      [1.9, 9.3, 0],
      [-1.9, 9.3, 0],
    ],
    pool: 18,
    gain: 0.9,
  },
  lampLantern: { heads: [[0, 3.95, 0]], pool: 9, gain: 0.8 },
  lampWall: { heads: [[0.62, 4.55, 0]], pool: 9, gain: 0.85 },
};
