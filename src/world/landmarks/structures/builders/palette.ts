/**
 * Named surface presets (linear albedo, procedural surface type, roughness, metalness, pattern parameter) shared by
 * the builders. Colours are measured/estimated sRGB values converted to linear.
 */
import type { SurfaceState } from '../build/mesh-builder';
import { Emit, linearHex, Surf, type Rgb } from '../build/surfaces';

export function mat(hex: number, surf: number, rough: number, metal = 0, param = 0): SurfaceState {
  return { color: linearHex(hex), surf, rough, metal, param, emit: Emit.None, ea: 0, eb: 0, ec: 0 };
}

export function withEmit(s: SurfaceState, mode: number, a: number, b = 0, c = 0): SurfaceState {
  return { ...s, emit: mode, ea: a, eb: b, ec: c };
}

export function glassMat(tintHex: number, facade: number, floorHeight: number, bay: number, seed: number): SurfaceState {
  return { color: linearHex(tintHex), surf: facade, rough: floorHeight, metal: bay, param: seed, emit: Emit.None, ea: 0, eb: 0, ec: 0 };
}

export const Pal = {
  /** Light grey painted steel of the Bosphorus / FSM towers and decks (panel seams every 6 m). */
  bridgeSteel: mat(0xb4b8b8, Surf.Steel, 0.5, 0, 6),
  bridgeSteelDark: mat(0x8c9294, Surf.Steel, 0.55, 0, 18),
  deckSoffit: mat(0x9aa0a1, Surf.Steel, 0.62, 0, 18),
  concrete: mat(0xa8a49c, Surf.Concrete, 0.86, 0, 3),
  concreteLight: mat(0xc2beb4, Surf.Concrete, 0.82, 0, 4),
  concreteDark: mat(0x7e7b75, Surf.Concrete, 0.9, 0, 2.5),
  barrier: mat(0xb9b6ae, Surf.Concrete, 0.8, 0, 6),
  walkway: mat(0x8f8a82, Surf.Paving, 0.8, 0, 0.5),
  road: { ...mat(0x303030, Surf.Road, 0.88), metal: 0.6, param: 3 },
  railTrack: mat(0x8a877f, Surf.Rail, 0.85, 0, 4.4),
  galvanized: mat(0x9ea3a5, Surf.Steel, 0.45, 0.6, 0),
  lampGrey: mat(0x6f7477, Surf.Steel, 0.45, 0.4, 0),
  darkMetal: mat(0x2c2f31, Surf.Steel, 0.5, 0.3, 0),
  limestone: mat(0xcfc6b2, Surf.Ashlar, 0.78, 0, 0.45),
  rubbleStone: mat(0xa8977e, Surf.Rubble, 0.86, 0, 0.42),
  lead: mat(0x7d8586, Surf.Lead, 0.5, 0.25, 0.55),
  plaster: mat(0xe8e1d2, Surf.Plain, 0.8),
  whitePaint: mat(0xe9e9e4, Surf.Plain, 0.45),
  window: mat(0x1b2226, Surf.Window, 0.08),
  rock: mat(0x6f6a60, Surf.Rubble, 0.92, 0, 1.4),
} as const;

export const Color = {
  cable: linearHex(0x8d9396) as Rgb,
  hanger: linearHex(0x5d6366) as Rgb,
  stay: linearHex(0xdcdcd6) as Rgb,
  railing: linearHex(0x7c8285) as Rgb,
  railingLight: linearHex(0xb7bcbd) as Rgb,
  mast: linearHex(0xa9adaf) as Rgb,
  catenary: linearHex(0x3c3f41) as Rgb,
};
