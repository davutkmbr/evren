/**
 * The rider's look: body, face, hair, outfit, gear and colours. Deliberately coarse (a handful of choices per part,
 * three body sliders) so every combination looks good; colours come from curated palettes. Serialisable as plain
 * JSON (saved per player, later sent to other players).
 */

export const FACE_SHAPES = ['oval', 'square', 'round', 'long', 'heart'] as const;
export const NOSE_SHAPES = ['straight', 'aquiline', 'button', 'broad'] as const;
export const HAIR_STYLES = ['buzz', 'short', 'swept', 'ponytail', 'braid', 'bun', 'long'] as const;
export const FACIAL_HAIR = ['none', 'stubble', 'moustache', 'goatee', 'short', 'full'] as const;
export const OUTFITS = ['akinci', 'traveller', 'pilot', 'kaftan', 'steppe'] as const;
export const HEADWEAR = ['none', 'cicak', 'hood', 'cap', 'bork', 'headband'] as const;
export const GOGGLES = ['none', 'brow', 'eyes'] as const;
export const METALS = ['iron', 'brass', 'silver'] as const;

export type FaceShape = (typeof FACE_SHAPES)[number];
export type NoseShape = (typeof NOSE_SHAPES)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type FacialHair = (typeof FACIAL_HAIR)[number];
export type Outfit = (typeof OUTFITS)[number];
export type Headwear = (typeof HEADWEAR)[number];
export type Goggles = (typeof GOGGLES)[number];
export type Metal = (typeof METALS)[number];

/** Linear-ish sRGB triples (0..1), converted to linear by the material. */
export type RGB = readonly [number, number, number];

export const SKIN_TONES: readonly RGB[] = [
  [0.93, 0.78, 0.68],
  [0.88, 0.7, 0.58],
  [0.82, 0.62, 0.49],
  [0.74, 0.54, 0.41],
  [0.64, 0.45, 0.33],
  [0.53, 0.36, 0.26],
  [0.42, 0.28, 0.2],
  [0.3, 0.2, 0.15],
];

export const EYE_COLOURS: readonly RGB[] = [
  [0.25, 0.15, 0.08],
  [0.42, 0.27, 0.13],
  [0.45, 0.4, 0.2],
  [0.3, 0.45, 0.32],
  [0.35, 0.5, 0.62],
  [0.45, 0.5, 0.52],
];

export const HAIR_COLOURS: readonly RGB[] = [
  [0.035, 0.03, 0.028],
  [0.09, 0.06, 0.045],
  [0.2, 0.12, 0.07],
  [0.3, 0.14, 0.07],
  [0.5, 0.22, 0.1],
  [0.52, 0.4, 0.25],
  [0.78, 0.64, 0.42],
  [0.5, 0.49, 0.47],
  [0.86, 0.84, 0.8],
];

/** Natural dyes: madder, indigo, saffron, walnut, olive, pomegranate, teal, charcoal, undyed wool, oxblood, slate, moss. */
export const CLOTH_COLOURS: readonly RGB[] = [
  [0.48, 0.08, 0.07],
  [0.12, 0.16, 0.32],
  [0.78, 0.55, 0.2],
  [0.33, 0.22, 0.14],
  [0.36, 0.38, 0.2],
  [0.45, 0.08, 0.14],
  [0.12, 0.35, 0.36],
  [0.12, 0.12, 0.13],
  [0.78, 0.72, 0.6],
  [0.3, 0.07, 0.06],
  [0.33, 0.37, 0.42],
  [0.22, 0.3, 0.17],
];

export const LEATHER_TONES: readonly RGB[] = [
  [0.36, 0.2, 0.11],
  [0.2, 0.12, 0.08],
  [0.52, 0.34, 0.2],
  [0.1, 0.08, 0.07],
];

export interface RiderAppearance {
  v: 1;
  /** 0 soft / feminine .. 1 angular / masculine. */
  shape: number;
  /** 0 slender .. 1 heavy-set. */
  build: number;
  /** 0 short .. 1 tall (relative to the shape's average). */
  height: number;
  face: FaceShape;
  nose: NoseShape;
  /** 0 narrow .. 1 wide jaw. */
  jaw: number;
  /** 0 young .. 1 weathered (skin, creases, grey at the temples). */
  age: number;
  skin: number;
  eyes: number;
  hair: HairStyle;
  hairColour: number;
  facialHair: FacialHair;
  outfit: Outfit;
  primary: number;
  secondary: number;
  accent: number;
  leather: number;
  metal: Metal;
  headwear: Headwear;
  goggles: Goggles;
  cloak: boolean;
  scarf: boolean;
  pauldrons: boolean;
  gloves: boolean;
  earrings: boolean;
  amulet: boolean;
}

/** The rider the game shipped with, rebuilt: hooded red cloak, goggles, scarf, leather cuirass. */
/** The default rider: an akıncı in a crimson dolama, mail and mirror plate, a plumed çiçak, pala bıyık. */
export const DEFAULT_APPEARANCE: RiderAppearance = {
  v: 1,
  shape: 0.85,
  build: 0.5,
  height: 0.55,
  face: 'square',
  nose: 'aquiline',
  jaw: 0.6,
  age: 0.35,
  skin: 3,
  eyes: 0,
  hair: 'short',
  hairColour: 0,
  facialHair: 'moustache',
  outfit: 'akinci',
  primary: 0,
  secondary: 7,
  accent: 2,
  leather: 1,
  metal: 'brass',
  headwear: 'cicak',
  goggles: 'none',
  cloak: false,
  scarf: false,
  pauldrons: false,
  gloves: true,
  earrings: false,
  amulet: false,
};

const clamp01 = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);
const index = (x: unknown, n: number, d: number): number => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < n ? x : d);
const oneOf = <T extends string>(x: unknown, list: readonly T[], d: T): T => (typeof x === 'string' && (list as readonly string[]).includes(x) ? (x as T) : d);
const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d);

/** Any stored / received value -> a valid appearance (unknown fields dropped, bad ones defaulted). */
export function sanitizeAppearance(raw: unknown): RiderAppearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_APPEARANCE;
  return {
    v: 1,
    shape: clamp01(r.shape, d.shape),
    build: clamp01(r.build, d.build),
    height: clamp01(r.height, d.height),
    face: oneOf(r.face, FACE_SHAPES, d.face),
    nose: oneOf(r.nose, NOSE_SHAPES, d.nose),
    jaw: clamp01(r.jaw, d.jaw),
    age: clamp01(r.age, d.age),
    skin: index(r.skin, SKIN_TONES.length, d.skin),
    eyes: index(r.eyes, EYE_COLOURS.length, d.eyes),
    hair: oneOf(r.hair, HAIR_STYLES, d.hair),
    hairColour: index(r.hairColour, HAIR_COLOURS.length, d.hairColour),
    facialHair: oneOf(r.facialHair, FACIAL_HAIR, d.facialHair),
    outfit: oneOf(r.outfit, OUTFITS, d.outfit),
    primary: index(r.primary, CLOTH_COLOURS.length, d.primary),
    secondary: index(r.secondary, CLOTH_COLOURS.length, d.secondary),
    accent: index(r.accent, CLOTH_COLOURS.length, d.accent),
    leather: index(r.leather, LEATHER_TONES.length, d.leather),
    metal: oneOf(r.metal, METALS, d.metal),
    headwear: oneOf(r.headwear, HEADWEAR, d.headwear),
    goggles: oneOf(r.goggles, GOGGLES, d.goggles),
    cloak: bool(r.cloak, d.cloak),
    scarf: bool(r.scarf, d.scarf),
    pauldrons: bool(r.pauldrons, d.pauldrons),
    gloves: bool(r.gloves, d.gloves),
    earrings: bool(r.earrings, d.earrings),
    amulet: bool(r.amulet, d.amulet),
  };
}

/** Fields that change only colours (the material's uniforms): no geometry rebuild. */
const COLOUR_KEYS: ReadonlyArray<keyof RiderAppearance> = ['skin', 'eyes', 'hairColour', 'primary', 'secondary', 'accent', 'leather', 'metal'];

export function geometryKey(a: RiderAppearance): string {
  const o: Record<string, unknown> = { ...a };
  for (const k of COLOUR_KEYS) {
    delete o[k];
  }
  // Age greys the hair and deepens creases in the shader only... except the sculpted creases: keep coarse steps.
  o.age = Math.round(a.age * 4) / 4;
  return JSON.stringify(o);
}

function pick<T>(list: readonly T[], rnd: () => number): T {
  return list[Math.floor(rnd() * list.length) % list.length];
}

/** A random but coherent look (matching palettes, sensible gear). */
export function randomAppearance(rnd: () => number = Math.random): RiderAppearance {
  const shape = rnd() < 0.5 ? 0.1 + rnd() * 0.25 : 0.65 + rnd() * 0.3;
  const masculine = shape > 0.5;
  const outfit = pick(OUTFITS, rnd);
  const headwear: Headwear = outfit === 'pilot' ? pick(['cap', 'none', 'headband'] as const, rnd) : outfit === 'steppe' ? pick(['bork', 'none', 'hood'] as const, rnd) : pick(HEADWEAR, rnd);
  const age = rnd() * 0.8;
  return sanitizeAppearance({
    v: 1,
    shape,
    build: 0.15 + rnd() * 0.7,
    height: 0.15 + rnd() * 0.7,
    face: pick(FACE_SHAPES, rnd),
    nose: pick(NOSE_SHAPES, rnd),
    jaw: masculine ? 0.4 + rnd() * 0.5 : 0.1 + rnd() * 0.45,
    age,
    skin: Math.floor(rnd() * SKIN_TONES.length),
    eyes: Math.floor(rnd() * EYE_COLOURS.length),
    hair: masculine ? pick(['buzz', 'short', 'swept', 'ponytail', 'bun', 'long'] as const, rnd) : pick(['swept', 'ponytail', 'braid', 'bun', 'long', 'short'] as const, rnd),
    hairColour: age > 0.65 && rnd() < 0.5 ? 7 + Math.floor(rnd() * 2) : Math.floor(rnd() * 7),
    facialHair: masculine ? pick(FACIAL_HAIR, rnd) : 'none',
    outfit,
    primary: Math.floor(rnd() * CLOTH_COLOURS.length),
    secondary: pick([7, 3, 8, 10, 11], rnd),
    accent: pick([2, 0, 6, 8, 5], rnd),
    leather: Math.floor(rnd() * LEATHER_TONES.length),
    metal: pick(METALS, rnd),
    headwear,
    goggles: pick(GOGGLES, rnd),
    cloak: rnd() < 0.6,
    scarf: rnd() < 0.5,
    pauldrons: outfit === 'traveller' ? rnd() < 0.7 : rnd() < 0.25,
    gloves: rnd() < 0.7,
    earrings: rnd() < 0.3,
    amulet: rnd() < 0.35,
  });
}
