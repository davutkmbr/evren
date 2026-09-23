/**
 * Tree species of Istanbul modelled by the vegetation module (shared by the workers and the main thread).
 * Dimensions are the reference model size in metres; instances are scaled ~0.55..1.3 around it.
 */

export const Species = {
  /** Fıstık çamı (Pinus pinea): umbrella crown on a tall bare trunk. */
  StonePine: 0,
  /** Karaçam / kızılçam (Pinus nigra / Pinus brutia): forest pines. Variant 1 = red pine. */
  Pine: 1,
  /** Servi (Cupressus sempervirens 'Stricta'): dark columns of cemeteries and mosque yards. */
  Cypress: 2,
  /** Çınar (Platanus orientalis): broad crowns of squares, parks and courtyards. */
  Plane: 3,
  /** Meşe / kestane (Quercus petraea / Castanea sativa): broadleaf forest. Variant 1 = chestnut. */
  Broadleaf: 4,
  /** Kanarya hurma palmiyesi (Phoenix canariensis): Kadıköy–Moda seafront. */
  Palm: 5,
} as const;

export type SpeciesId = (typeof Species)[keyof typeof Species];

export const SPECIES_COUNT = 6;

export const SPECIES_NAMES: readonly string[] = ['stone-pine', 'pine', 'cypress', 'plane', 'broadleaf', 'palm'];

/** Texture array layers (bark and foliage share one albedo array and one normal array). */
export const TexLayer = {
  BarkStonePine: 0,
  BarkPine: 1,
  BarkCypress: 2,
  BarkPlane: 3,
  BarkOak: 4,
  BarkPalm: 5,
  LeafStonePine: 6,
  LeafBlackPine: 7,
  LeafRedPine: 8,
  LeafCypress: 9,
  LeafPlane: 10,
  LeafOak: 11,
  LeafChestnut: 12,
  LeafPalm: 13,
} as const;

export const TEX_LAYER_COUNT = 14;
export const FIRST_LEAF_LAYER = TexLayer.LeafStonePine;

/** Instance record layout (float32 stride). */
export const INSTANCE_STRIDE = 8;
/**
 * [0..2] base position (x, y, z) · [3] yaw (rad) · [4] uniform scale · [5] species + 8 * variant
 * [6] rank in [0, 1) (far thinning order, also seeds colour variation) · [7] crown width factor.
 */
export const VARIANT_STRIDE = 8;

export interface SpeciesShape {
  /** Reference height (m). */
  height: number;
  /** Reference crown diameter (m). */
  crownWidth: number;
  /** Height of the lowest foliage (m). */
  crownBase: number;
  /** Trunk radius at breast height (m). */
  trunkRadius: number;
  barkLayer: number;
  leafLayer: number;
  /** Number of leaf texture variants selectable per instance (leafLayer + variant). */
  variants: number;
  /** Wind: trunk bend amplitude (fraction of height), natural sway frequency (Hz), branch sway (m), leaf flutter (m). */
  wind: [number, number, number, number];
  /** Leaf roughness, translucency strength, share of trees that start yellowing (late September), normal map strength. */
  leafLook: [number, number, number, number];
}

export const SPECIES_SHAPES: readonly SpeciesShape[] = [
  {
    height: 15.5,
    crownWidth: 13.5,
    crownBase: 8.5,
    trunkRadius: 0.33,
    barkLayer: TexLayer.BarkStonePine,
    leafLayer: TexLayer.LeafStonePine,
    variants: 1,
    wind: [0.012, 0.28, 0.16, 0.025],
    leafLook: [0.72, 0.55, 0.0, 0.55],
  },
  {
    height: 18,
    crownWidth: 8.6,
    crownBase: 7,
    trunkRadius: 0.27,
    barkLayer: TexLayer.BarkPine,
    leafLayer: TexLayer.LeafBlackPine,
    variants: 2,
    wind: [0.016, 0.3, 0.16, 0.025],
    leafLook: [0.72, 0.5, 0.0, 0.55],
  },
  {
    height: 18,
    crownWidth: 2.9,
    crownBase: 0.6,
    trunkRadius: 0.22,
    barkLayer: TexLayer.BarkCypress,
    leafLayer: TexLayer.LeafCypress,
    variants: 1,
    wind: [0.02, 0.24, 0.05, 0.012],
    leafLook: [0.78, 0.35, 0.0, 0.6],
  },
  {
    height: 24,
    crownWidth: 20,
    crownBase: 5,
    trunkRadius: 0.62,
    barkLayer: TexLayer.BarkPlane,
    leafLayer: TexLayer.LeafPlane,
    variants: 1,
    wind: [0.008, 0.25, 0.22, 0.05],
    leafLook: [0.66, 0.75, 0.2, 0.6],
  },
  {
    height: 16,
    crownWidth: 12,
    crownBase: 3.8,
    trunkRadius: 0.34,
    barkLayer: TexLayer.BarkOak,
    leafLayer: TexLayer.LeafOak,
    variants: 2,
    wind: [0.01, 0.3, 0.18, 0.045],
    leafLook: [0.68, 0.7, 0.12, 0.6],
  },
  {
    height: 11.5,
    crownWidth: 9,
    crownBase: 6.5,
    trunkRadius: 0.4,
    barkLayer: TexLayer.BarkPalm,
    leafLayer: TexLayer.LeafPalm,
    variants: 1,
    wind: [0.01, 0.35, 0.35, 0.06],
    leafLook: [0.55, 0.6, 0.0, 0.7],
  },
];
