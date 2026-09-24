/**
 * Materials of the interior shells (registered in registry.ts through INTERIOR_MATERIALS). Library materials of the
 * approved sets (Terrazzo005, Marble019, ph_brick) are used directly where no tint is needed.
 */
import type { MaterialDef } from '../materials';

export const INTERIOR_MATERIALS: MaterialDef[] = [
  { id: 'int_floor', color: 0xf2efe9, textures: { asset: 'Terrazzo005' }, tiling: [1.6, 1.6], surface: 'ground' },
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
];
