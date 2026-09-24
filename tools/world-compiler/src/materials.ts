/**
 * Material registry. Every material has an id (the glTF material name, shared by all tiles), a colour and, in format 1,
 * an optional texture set from an approved source (textures.ts): an asset of tools/assets/approved.json cached in
 * assets-src/, or a Poly Haven set in public/textures/ (listed in public/textures/LICENSES.md).
 *
 * Lanes export their material lists from their own modules and add them to MATERIAL_SETS in registry.ts (one line).
 * Only materials some tile uses reach the output, and only their textures are processed.
 *
 * Format 1.1 (weathering, see ../README.md):
 * - Variants: `<base>@<variant>` (e.g. `fac_plaster@weathered`, `fac_plaster@damaged`) is a full material made from its
 *   base with overrides (`materialVariant`, `withVariants`); steps pick one per wall segment.
 * - `weather`: layers (dirt, streak, edge, damp) that runtimes blend over the material, each driven by one channel of
 *   the `_WEATHER` vertex attribute (mesh.ts). Layer textures come from registry materials (approved sets only).
 */

/** Material id (the glTF material name). */
export type MaterialName = string;

export interface TextureSetRef {
  /** Approved asset id (tools/assets/approved.json), cached in assets-src/<kind>/<id>/. */
  asset?: string;
  /** Folder of an approved Poly Haven set in public/textures/ (albedo.jpg, normal.jpg, rough.jpg). */
  public?: string;
}

export type AlphaMode = 'OPAQUE' | 'MASK' | 'BLEND';

export interface EmissiveDef {
  /** sRGB hex colour of the glow (glTF emissiveFactor, linear). */
  color: number;
  /** Luminance of the lit surface in nits (cd/m²). glTF core caps emissiveFactor at 1, so this goes to extras. */
  nits: number;
  /** Lit only at night (shop signs, windows, lamp glass); off by day. */
  night: boolean;
  source: 'lamp' | 'sign' | 'window' | 'interior' | 'other';
}

/** Weathering layers in blend order; layer k is driven by `_WEATHER` component k (x, y, z, w). */
export const WEATHER_LAYERS = ['dirt', 'streak', 'edge', 'damp'] as const;
export type WeatherLayerName = (typeof WEATHER_LAYERS)[number];

/**
 * One weathering layer. Coverage m = clamp(channel × strength, 0, 1) × layer alpha (× the runtime's curvature term,
 * see `curvature`); the layer then replaces or multiplies the base colour, darkens it, and blends roughness and normal.
 */
export interface WeatherLayerDef {
  /** Registry material whose baked maps are the layer (base colour, alpha when it has one, normal, ORM). Absent: a flat layer (tint, darken, roughness only). */
  material?: MaterialName;
  /** Metres per layer repeat (default: that material's tiling). */
  tiling?: [number, number];
  /** Mirrored repeat (glTF MIRRORED_REPEAT): hides the seams of a non-tiling decal texture used as a layer (streaks). */
  mirror?: boolean;
  /** sRGB hex multiplied into the layer colour (default white). */
  tint?: number;
  /** Coverage at channel value 1 (default 1). */
  strength?: number;
  /** 'mix' (default) replaces the base colour by the layer's; 'multiply' multiplies it (grime, damp). */
  blend?: 'mix' | 'multiply';
  /** Colour multiplier at full coverage (default 1; damp about 0.6). */
  darken?: number;
  /** Constant roughness of the layer. Default: ORM green × the layer material's roughness factor; a flat layer keeps the base roughness. */
  roughness?: number;
  /** Normal map strength of the layer (default: the layer material's normalScale, else 1; 0 keeps the base normal). */
  normalScale?: number;
  /** 0..1: how much a runtime's convex-curvature estimate gates the layer (1 = convex edges only). Default 0.75 for edge, 0 otherwise. */
  curvature?: number;
}

export type WeatherDef = Partial<Record<WeatherLayerName, WeatherLayerDef>>;

export interface MaterialDef {
  id: MaterialName;
  /** sRGB hex. Format 1: the tint multiplied into the base colour texture, or the flat colour without one. */
  color: number;
  /** sRGB hex flat colour in format 0 (default: color). */
  flat?: number;
  /** Texture set (format 1). Absent: flat colour. */
  textures?: TextureSetRef;
  /** Maps taken from the set (default: every map the set has). */
  maps?: { baseColor?: boolean; normal?: boolean; orm?: boolean; opacity?: boolean };
  /** Size of one texture repeat in metres [u, v]. Default: approved.json repeat_m, the public set's repeat, else 2 m. */
  tiling?: [number, number];
  /** glTF factors (they multiply the maps). */
  roughness?: number;
  metallic?: number;
  normalScale?: number;
  /** occlusionTexture.strength of the texture's own AO. */
  occlusion?: number;
  alphaMode?: AlphaMode;
  alphaCutoff?: number;
  doubleSided?: boolean;
  emissive?: EmissiveDef;
  /** Runtime hints: 'ground' surfaces are walkable (eye-height queries). */
  surface?: 'ground' | 'wall' | 'roof' | 'glass' | 'metal' | 'wood' | 'fabric' | 'plant' | 'other';
  /** Casts shadows at eye level (default: wall and roof surfaces). */
  castShadow?: boolean;
  /** Weathering layers driven by `_WEATHER` (format 1.1). */
  weather?: WeatherDef;
  /** Allows this definition to replace an earlier one with the same id. */
  replace?: boolean;
}

/** Separator of variant ids: `<base>@<variant>`. */
export const VARIANT_SEPARATOR = '@';
/** Canonical variant names (others are allowed when they match VARIANT_NAME). */
export const MATERIAL_VARIANTS = ['weathered', 'damaged'] as const;
export const VARIANT_NAME = /^[a-z][a-z0-9_]*$/;

export function variantId(base: MaterialName, variant: string): MaterialName {
  if (base.includes(VARIANT_SEPARATOR) || !VARIANT_NAME.test(variant)) {
    throw new Error(`bad material variant '${base}${VARIANT_SEPARATOR}${variant}': base ids have no '@', variant names match ${VARIANT_NAME}`);
  }
  return `${base}${VARIANT_SEPARATOR}${variant}`;
}

/** Base id and variant name of a material id (variant null for a base material). */
export function splitVariant(id: MaterialName): { base: MaterialName; variant: string | null } {
  const k = id.indexOf(VARIANT_SEPARATOR);
  return k < 0 ? { base: id, variant: null } : { base: id.slice(0, k), variant: id.slice(k + 1) };
}

/** `{ variantOf, variant }` of a variant id, `{}` for a base material (manifest and glTF extras fields). */
export function variantFields(id: MaterialName): { variantOf?: MaterialName; variant?: string } {
  const { base, variant } = splitVariant(id);
  return variant === null ? {} : { variantOf: base, variant };
}

export type MaterialOverrides = Omit<Partial<MaterialDef>, 'id'>;

/** The variant `<base.id>@<variant>`: the base definition with `overrides` (the base's `replace` is not inherited). */
export function materialVariant(base: MaterialDef, variant: string, overrides: MaterialOverrides): MaterialDef {
  const def: MaterialDef = { ...base, ...overrides, id: variantId(base.id, variant) };
  if (!('replace' in overrides)) {
    delete def.replace;
  }
  return def;
}

/** A base material followed by its variants, for a MATERIAL_SETS list: `...withVariants(def, { weathered: {...} })`. */
export function withVariants(base: MaterialDef, variants: Record<string, MaterialOverrides>): MaterialDef[] {
  return [base, ...Object.entries(variants).map(([name, o]) => materialVariant(base, name, o))];
}

/** Registry materials a material's weather layers read their textures from. */
export function weatherLayerMaterials(id: MaterialName): MaterialName[] {
  const w = materialDef(id).weather;
  return w ? WEATHER_LAYERS.map((k) => w[k]?.material).filter((m): m is MaterialName => !!m) : [];
}

/** Greybox colours of format 0 (sRGB hex; glTF baseColorFactor stores them linear), in primitive order. */
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

const registry = new Map<MaterialName, MaterialDef>();
const order: MaterialName[] = [];

/** Registers materials; a duplicate id throws unless the new definition has `replace: true`. */
export function defineMaterials(defs: readonly MaterialDef[]): void {
  for (const d of defs) {
    const known = registry.get(d.id);
    if (known && !d.replace) {
      throw new Error(`material '${d.id}' is defined twice (set replace: true to override it)`);
    }
    const { base, variant } = splitVariant(d.id);
    if (variant !== null && (!registry.has(base) || variantId(base, variant) !== d.id)) {
      throw new Error(`material variant '${d.id}': register its base '${base}' first (withVariants), variant names match ${VARIANT_NAME}`);
    }
    for (const k of WEATHER_LAYERS) {
      const m = d.weather?.[k]?.material;
      if (m && !registry.has(m)) {
        throw new Error(`material '${d.id}': weather.${k} uses '${m}', which is not registered yet (WEATHER_LAYER_MATERIALS come early in MATERIAL_SETS)`);
      }
    }
    if (!known) {
      order.push(d.id);
    }
    registry.set(d.id, d);
  }
}

export function materialDef(id: MaterialName): MaterialDef {
  const d = registry.get(id);
  if (!d) {
    throw new Error(`unknown material '${id}': define it with defineMaterials() in a module listed in registry.ts`);
  }
  return d;
}

export function hasMaterial(id: MaterialName): boolean {
  return registry.has(id);
}

/** Primitive order of a tile: registration order. */
export function materialOrder(): readonly MaterialName[] {
  return order;
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear RGB of an sRGB hex colour, rounded to 4 decimals. */
export function linearRgb(hex: number): [number, number, number] {
  const ch = (s: number): number => Math.round(srgbToLinear(((hex >> s) & 255) / 255) * 10000) / 10000;
  return [ch(16), ch(8), ch(0)];
}

/** Linear RGBA baseColorFactor of a material: its flat colour in format 0, its tint in format 1. */
export function baseColor(name: MaterialName, format = 0): [number, number, number, number] {
  const d = materialDef(name);
  return [...linearRgb(format === 0 ? (d.flat ?? d.color) : d.color), 1];
}

export const hexColor = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** The format 0 materials (primitive order of format 0). Format 1 gives the ground and blocks approved textures. */
export const CORE_MATERIALS: MaterialDef[] = [
  { id: 'wall', color: 0xd9cfc2, flat: MATERIALS.wall, textures: { public: 'plaster_painted' }, tiling: [2, 2], surface: 'wall' },
  { id: 'roof', color: 0x8a8580, flat: MATERIALS.roof, textures: { public: 'concrete' }, tiling: [2.7, 2.7], surface: 'roof' },
  { id: 'road', color: 0xffffff, flat: MATERIALS.road, textures: { asset: 'asphalt_02' }, surface: 'ground' },
  { id: 'sidewalk', color: 0xffffff, flat: MATERIALS.sidewalk, textures: { asset: 'patterned_concrete_pavers' }, surface: 'ground' },
  { id: 'kerb', color: 0xdfe3e8, flat: MATERIALS.kerb, textures: { asset: 'granite_tile_04' }, surface: 'ground' },
  { id: 'pedestrian', color: 0xffffff, flat: MATERIALS.pedestrian, textures: { asset: 'patterned_cobblestone' }, surface: 'ground' },
  { id: 'quay', color: 0xd6d4ce, flat: MATERIALS.quay, textures: { public: 'concrete' }, tiling: [2.7, 2.7], surface: 'ground' },
  { id: 'lot', color: 0xffffff, flat: MATERIALS.lot, textures: { public: 'yard' }, tiling: [3, 3], surface: 'ground' },
  { id: 'grass', color: MATERIALS.grass, roughness: 0.95, surface: 'ground' },
  { id: 'door', color: 0x6b5140, flat: MATERIALS.door, textures: { asset: 'PaintedWood009C' }, tiling: [1.2, 2.4], surface: 'wood' },
  { id: 'doorInferred', color: 0xc9ccce, flat: MATERIALS.doorInferred, textures: { asset: 'painted_metal_shutter' }, surface: 'metal' },
];

/**
 * Library: one neutral material per approved texture set, for lanes that need no tint of their own. Ids are the asset
 * ids of approved.json and `ph_<folder>` for the public/textures sets.
 */
export const LIBRARY_MATERIALS: MaterialDef[] = [
  { id: 'patterned_concrete_pavers', color: 0xffffff, textures: { asset: 'patterned_concrete_pavers' }, surface: 'ground' },
  { id: 'patterned_cobblestone', color: 0xffffff, textures: { asset: 'patterned_cobblestone' }, surface: 'ground' },
  { id: 'asphalt_02', color: 0xffffff, textures: { asset: 'asphalt_02' }, surface: 'ground' },
  { id: 'granite_tile_04', color: 0xffffff, textures: { asset: 'granite_tile_04' }, surface: 'ground' },
  { id: 'peeling_painted_wall', color: 0xffffff, textures: { asset: 'peeling_painted_wall' }, surface: 'wall' },
  { id: 'damaged_plaster', color: 0xffffff, textures: { asset: 'damaged_plaster' }, surface: 'wall' },
  { id: 'long_white_tiles', color: 0xffffff, textures: { asset: 'long_white_tiles' }, surface: 'wall' },
  { id: 'painted_metal_shutter', color: 0xffffff, textures: { asset: 'painted_metal_shutter' }, surface: 'metal' },
  { id: 'worn_shutter', color: 0xffffff, textures: { asset: 'worn_shutter' }, surface: 'metal' },
  { id: 'green_metal_rust', color: 0xffffff, textures: { asset: 'green_metal_rust' }, surface: 'metal' },
  { id: 'wood_peeling_paint_weathered', color: 0xffffff, textures: { asset: 'wood_peeling_paint_weathered' }, surface: 'wood' },
  { id: 'floor_tiles_02', color: 0xffffff, textures: { asset: 'floor_tiles_02' }, surface: 'ground' },
  { id: 'Road013B', color: 0xffffff, textures: { asset: 'Road013B' }, tiling: [4, 4], surface: 'ground' },
  { id: 'Tiles043', color: 0xffffff, textures: { asset: 'Tiles043' }, tiling: [1, 1], surface: 'wall' },
  { id: 'Terrazzo005', color: 0xffffff, textures: { asset: 'Terrazzo005' }, tiling: [2, 2], surface: 'ground' },
  { id: 'Tiles133B', color: 0xffffff, textures: { asset: 'Tiles133B' }, tiling: [1, 1], surface: 'ground' },
  { id: 'Tiles024', color: 0xffffff, textures: { asset: 'Tiles024' }, tiling: [1, 1], surface: 'ground' },
  { id: 'PaintedWood009C', color: 0xffffff, textures: { asset: 'PaintedWood009C' }, tiling: [1, 1], surface: 'wood' },
  { id: 'Marble019', color: 0xffffff, textures: { asset: 'Marble019' }, tiling: [2, 2], surface: 'other' },
  { id: 'ph_plaster', color: 0xffffff, textures: { public: 'plaster' }, tiling: [2, 2], surface: 'wall' },
  { id: 'ph_plaster_painted', color: 0xffffff, textures: { public: 'plaster_painted' }, tiling: [2, 2], surface: 'wall' },
  { id: 'ph_stone', color: 0xffffff, textures: { public: 'stone' }, tiling: [2, 2], surface: 'wall' },
  { id: 'ph_concrete', color: 0xffffff, textures: { public: 'concrete' }, tiling: [2.7, 2.7], surface: 'wall' },
  { id: 'ph_brick', color: 0xffffff, textures: { public: 'brick' }, tiling: [1, 1], surface: 'wall' },
  { id: 'ph_roof_tiles', color: 0xffffff, textures: { public: 'roof_tiles' }, tiling: [2.5, 2.5], surface: 'roof' },
  { id: 'ph_asphalt', color: 0xffffff, textures: { public: 'asphalt' }, tiling: [2.08, 2.08], surface: 'ground' },
  { id: 'ph_cobble', color: 0xffffff, textures: { public: 'cobble' }, tiling: [1.5, 1.5], surface: 'ground' },
  { id: 'ph_sidewalk', color: 0xffffff, textures: { public: 'sidewalk' }, tiling: [2, 2], surface: 'ground' },
  { id: 'ph_granite', color: 0xffffff, textures: { public: 'granite' }, tiling: [3, 3], surface: 'ground' },
  { id: 'ph_yard', color: 0xffffff, textures: { public: 'yard' }, tiling: [3, 3], surface: 'ground' },
];

/**
 * Weathering layer sources (approved sets only), registered right after the library. Lanes reference them in a
 * material's `weather` (or register their own layer materials before the materials that use them).
 */
export const WEATHER_LAYER_MATERIALS: MaterialDef[] = [
  { id: 'wx_grime', color: 0xffffff, textures: { public: 'concrete' }, tiling: [2.7, 2.7], surface: 'other', castShadow: false },
  { id: 'wx_streak', color: 0xffffff, textures: { asset: 'Leaking003' }, maps: { normal: false }, alphaMode: 'BLEND', roughness: 0.9, surface: 'other', castShadow: false },
  { id: 'wx_band', color: 0xffffff, textures: { asset: 'Leaking008' }, maps: { normal: false }, alphaMode: 'BLEND', roughness: 0.9, surface: 'other', castShadow: false },
  { id: 'wx_substrate', color: 0xffffff, textures: { asset: 'damaged_plaster' }, surface: 'other', castShadow: false },
];

/**
 * Starting point for rendered and painted walls: sooty grime (x), leak streaks (y), chipped paint showing the plaster
 * below (z, convex edges), darker and glossier damp at the base (w). Tune per façade with overrides.
 */
export const WALL_WEATHER: WeatherDef = {
  dirt: { material: 'wx_grime', tint: 0x8a8278, blend: 'multiply', strength: 0.9, roughness: 0.95 },
  streak: { material: 'wx_streak', tint: 0x4a4038, tiling: [1.6, 3], mirror: true, strength: 1.5, roughness: 0.85 },
  edge: { material: 'wx_substrate', strength: 1, curvature: 0.75 },
  damp: { blend: 'multiply', darken: 0.6, roughness: 0.45 },
};
