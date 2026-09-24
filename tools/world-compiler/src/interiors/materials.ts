/**
 * Materials of the interior shells (registered in registry.ts through INTERIOR_MATERIALS). Library materials of the
 * approved sets (Terrazzo005, Marble019, ph_brick) are used directly where no tint is needed.
 */
import type { MaterialDef } from '../materials';

export const INTERIOR_MATERIALS: MaterialDef[] = [
  { id: 'int_floor', color: 0xf2efe9, textures: { asset: 'Terrazzo005' }, tiling: [0.8, 0.8], surface: 'ground' },
  { id: 'int_wall', color: 0xefe4d2, textures: { public: 'plaster' }, maps: { baseColor: false }, tiling: [2, 2], normalScale: 0.6, surface: 'wall' },
  { id: 'int_ceiling', color: 0xf1ede6, textures: { public: 'plaster' }, maps: { baseColor: false }, tiling: [2, 2], normalScale: 0.4, surface: 'wall' },
  { id: 'int_brick', color: 0xe9d9cc, textures: { public: 'brick' }, tiling: [1.1, 1.1], surface: 'wall' },
  { id: 'int_counter', color: 0x375646, textures: { asset: 'PaintedWood009C' }, tiling: [1, 1], surface: 'wood' },
  { id: 'int_wood_dark', color: 0x4a3222, textures: { asset: 'PaintedWood009C' }, tiling: [1, 1], surface: 'wood' },
  { id: 'int_chalk', color: 0x22282a, roughness: 0.95, surface: 'other' },
  { id: 'int_chalk_text', color: 0xe9e6dc, roughness: 0.9, surface: 'other', castShadow: false },
  { id: 'int_steel', color: 0xc4c8cb, metallic: 0.9, roughness: 0.28, surface: 'metal' },
  { id: 'int_red', color: 0xa3281f, roughness: 0.4, surface: 'other' },
  { id: 'int_alu', color: 0xa7acaf, metallic: 0.8, roughness: 0.35, surface: 'metal' },
  { id: 'int_brass', color: 0xc9a25a, metallic: 0.9, roughness: 0.35, surface: 'metal' },
  /* Café dressing (cafe-dressing.ts). */
  { id: 'int_glass', color: 0xdfe8e6, roughness: 0.06, surface: 'glass', castShadow: false },
  { id: 'int_glass_case', color: 0xffffff, roughness: 0.05, alphaMode: 'BLEND', surface: 'glass', castShadow: false },
  { id: 'int_ceramic', color: 0xf3f1ec, roughness: 0.25, surface: 'other' },
  { id: 'int_tea', color: 0x8a2f12, roughness: 0.1, surface: 'glass' },
  { id: 'int_coffee', color: 0x3b2618, roughness: 0.6, surface: 'other' },
  { id: 'int_bag_red', color: 0x9e2a22, roughness: 0.5, surface: 'other' },
  { id: 'int_bag_brown', color: 0x6b4a2e, roughness: 0.7, surface: 'other' },
  { id: 'int_bag_gold', color: 0xb8923a, roughness: 0.4, metallic: 0.4, surface: 'other' },
  { id: 'int_black', color: 0x1c1c1e, roughness: 0.4, surface: 'other' },
  { id: 'int_screen', color: 0x1a2530, roughness: 0.15, surface: 'glass', emissive: { color: 0x9ec8ff, nits: 60, night: false, source: 'interior' } },
  { id: 'int_baklava', color: 0xc8892c, roughness: 0.35, surface: 'other' },
  { id: 'int_baklava_dark', color: 0x8f5a1c, roughness: 0.35, surface: 'other' },
  { id: 'int_photo_mat', color: 0xe9e1cf, roughness: 0.8, surface: 'other', castShadow: false },
  { id: 'int_photo', color: 0x9c8462, roughness: 0.6, surface: 'other', castShadow: false },
  { id: 'int_photo_light', color: 0xd6c6a2, roughness: 0.6, surface: 'other', castShadow: false },
  { id: 'int_photo_dark', color: 0x4e3d2c, roughness: 0.6, surface: 'other', castShadow: false },
];
