/**
 * Compile registry: the lists the compiler runs. Lanes add their compile steps, materials and props from their own
 * modules with ONE added line in the matching list below; everything else about a step lives in its module.
 *
 * - COMPILE_STEPS run in list order. `prepare` runs once before the tiles, `tile` once per tile (TileContext: its
 *   mesh, instances, lights, the solids it owns, detail level), `finish` once after all tiles.
 * - A step runs in format 1 only unless it lists `formats: [0, 1]`; it runs on every tile unless `tiles` says
 *   'full' (inside the strip) or 'greybox' (outside it). A step marked `handAuthored` (heroes, soul, precinct,
 *   interiors: fitted to one district) runs only where the district profile (district.ts) enables it.
 * - MATERIAL_SETS / PROP_SETS are registered before anything else; the format 0 materials come first because the
 *   registration order is the primitive order. Weather layer materials come before every set whose `weather` uses
 *   them, and a variant (`<base>@<variant>`) after its base (`withVariants` keeps them together).
 */
import type { RingIndex } from './cover';
import { district, type DistrictProfile, type HandAuthored } from './district';
import type { Foundation } from './foundation';
import type { Bounds2, FormatVersion, InstanceRec, LaneGraphFile, StripInfo, TileManifest, XYZ } from './format';
import type { GroundHeights, PierField } from './ground';
import type { InstanceSink } from './instances';
import type { LightSink } from './lights';
import { CORE_MATERIALS, defineMaterials, LIBRARY_MATERIALS, type MaterialDef, WEATHER_LAYER_MATERIALS } from './materials';
import type { TileMesh } from './mesh';
import type { OsmStreetData } from './osm-street';
import { CORE_PROPS, defineProps, PROP_MATERIALS, type PropDef } from './props';
import type { Solid } from './buildings';
import type { WalkExport } from './graphs';
import { buildingsStep, groundStep } from './core-steps';
import { lampFixturesStep } from './fixtures';
import { FACADE_MATERIALS } from './facade/materials';
import { FACADE_PROP_MATERIALS, FACADE_PROPS } from './facade/props';
import { facadeStep } from './facade/step';
import { STREET_MATERIALS, STREET_PROPS, streetGroundStep, STREET_STEPS } from './street';
import { HERO_PROPS, heroStep } from './hero';
import { HERO_MATERIALS } from './hero/materials';
import { interiorStep } from './interiors';
import { INTERIOR_MATERIALS } from './interiors/materials';
import { SOUL_MATERIALS, SOUL_PROPS, soulStep } from './soul';

export type Detail = 'full' | 'greybox';

/** Area-wide state shared by all steps. */
export interface AreaContext {
  format: FormatVersion;
  area: { id: string; bbox: { south: number; west: number; north: number; east: number } };
  data: OsmStreetData;
  foundation: Foundation;
  heights: GroundHeights;
  /** Positive on land and piers. */
  land: (x: number, z: number) => number;
  piers: PierField;
  /** Every solid in the tile rect, with doors placed. */
  solids: Solid[];
  tileOfSolid: ReadonlyMap<Solid, string>;
  /** Building outlines with their courtyards (cover.ts outlineIndex): what a wall faces. */
  outlines: RingIndex<number>;
  /** The grounded solids the tiles emit (cover.ts solidCover): where the ground is left out under a block. */
  cover: RingIndex<Solid>;
  /** The district profile of the area (district.ts). */
  district: DistrictProfile;
  manifests: ReadonlyMap<string, TileManifest>;
  walk: WalkExport;
  lanes: LaneGraphFile;
  /** The full-detail rect, or null when every tile is greybox. */
  strip: StripInfo | null;
  detailOf(tileId: string): Detail;
  outDir: string;
  /** Scratch space shared between steps, keyed by step id. */
  shared: Map<string, unknown>;
}

export interface PlaceOptions {
  variant?: string;
  scale?: number | XYZ;
  ref?: string;
  seed?: number;
  /** Lights of the prop's template: false = none; overrides apply to every light of the template. */
  lights?: false | { kelvin?: number; lumens?: number; night?: boolean };
}

export interface TileContext {
  readonly area: AreaContext;
  readonly id: string;
  readonly manifest: TileManifest;
  readonly bounds: Bounds2;
  /** glb node translation; mesh positions are world metres, the mesh stores them relative to this. */
  readonly origin: XYZ;
  readonly detail: Detail;
  readonly mesh: TileMesh;
  /** Solids whose footprint centroid lies in this tile (they may overhang it). */
  readonly solids: readonly Solid[];
  readonly instances: InstanceSink;
  readonly lights: LightSink;
  /**
   * Places a prop instance at a world position, turned by `yaw` radians about +Y (see instances.ts headingYaw), and
   * adds the lights of the prop's template (placed with the instance) unless `lights: false`.
   */
  place(asset: string, position: XYZ, yaw: number, opts?: PlaceOptions): InstanceRec;
  /** Stores a step's records in the tile manifest (`extra[stepId]`). */
  record(stepId: string, data: unknown): void;
}

export interface CompileStep {
  id: string;
  /** A hand-authored step (fitted to one district's places or reference cameras): runs only where the profile enables it. */
  handAuthored?: HandAuthored;
  /** Formats the step runs in (default [1]). */
  formats?: FormatVersion[];
  /** Tiles the step runs on (default 'all'). */
  tiles?: 'all' | Detail;
  /**
   * The step's tile() uses up area state tile by tile (quotas): `state` reads that state, `restore` sets it. Worker
   * threads pass it from tile to tile in tile order (parallel/ordered.ts). Steps without it must give the same tile
   * output whatever tiles were compiled before (`--check` compares against a serial compile).
   */
  ordered?: { state(a: AreaContext): unknown; restore(a: AreaContext, state: unknown): void };
  prepare?(a: AreaContext): void | Promise<void>;
  tile?(t: TileContext): void | Promise<void>;
  finish?(a: AreaContext): void | Promise<void>;
}

/** Material sets in registration (primitive) order. */
export const MATERIAL_SETS: readonly (readonly MaterialDef[])[] = [CORE_MATERIALS, LIBRARY_MATERIALS, WEATHER_LAYER_MATERIALS, PROP_MATERIALS, STREET_MATERIALS, HERO_MATERIALS, FACADE_MATERIALS, FACADE_PROP_MATERIALS, INTERIOR_MATERIALS, SOUL_MATERIALS];

export const PROP_SETS: readonly (readonly PropDef[])[] = [CORE_PROPS, STREET_PROPS, FACADE_PROPS, HERO_PROPS, SOUL_PROPS];

export const COMPILE_STEPS: readonly CompileStep[] = [streetGroundStep, heroStep, facadeStep, ...STREET_STEPS, interiorStep, soulStep];

let registered = false;
/** Registers every material and prop set (idempotent). */
export function registerAll(): void {
  if (registered) {
    return;
  }
  registered = true;
  for (const set of MATERIAL_SETS) {
    defineMaterials(set);
  }
  const local = district().materials;
  if (local) {
    defineMaterials(local.map((d) => ({ ...d, replace: true })));
  }
  for (const set of PROP_SETS) {
    defineProps(set);
  }
}

/**
 * The steps that run in `format` on a tile of `detail` (or all steps of the format when detail is omitted), without
 * the hand-authored steps the active district profile does not enable.
 */
export function stepsFor(format: FormatVersion, detail?: Detail): CompileStep[] {
  const on = district().handAuthored;
  return COMPILE_STEPS.filter((s) => (s.formats ?? [1]).includes(format) && (!detail || !s.tiles || s.tiles === 'all' || s.tiles === detail) && (!s.handAuthored || on[s.handAuthored]));
}
