/**
 * Data exchanged between the structures worker (geometry generation) and the main thread (GPU batches,
 * colliders). Everything is plain data / typed arrays so it can be transferred without copies.
 */
import type { LandmarkDef } from '../../../core/contracts';

/** Vertex streams of one generated geometry (world space, meters). */
export interface GeometryData {
  position: Float32Array;
  /** Normalized int16 normals. */
  normal: Int16Array;
  /** Surface coordinates in meters: u = horizontal / across, v = height above the structure base / along. */
  uv: Float32Array;
  /** Linear albedo (opaque) or glass tint (glass), normalized uint8. */
  color: Uint8Array;
  /** Opaque: (surface type, roughness, metalness, param). Glass: (facade style, floor height, bay width, seed). */
  surf: Float32Array;
  /** (emission mode, a, b, c) - see Emit in build/surfaces.ts. */
  emit: Float32Array;
  index: Uint32Array;
}

export const BatchKind = { Opaque: 0, Glass: 1 } as const;
export type BatchKind = (typeof BatchKind)[keyof typeof BatchKind];

/** One culling/LOD unit: a structure part drawn from one material batch. */
export interface PartData {
  batch: BatchKind;
  /** LOD chain, most detailed first. */
  lods: GeometryData[];
  center: [number, number, number];
  radius: number;
  /** Multiplier on the quality's landmark detail distance for switching lods[i] -> lods[i + 1]. */
  detailScale: number;
  /** Beyond this camera distance (m, to the bounding sphere) the part is hidden. */
  cullDistance: number;
}

export type ColliderData =
  | { kind: 'box'; center: [number, number, number]; halfSize: [number, number, number]; yaw: number }
  | { kind: 'cylinder'; base: [number, number, number]; radius: number; height: number }
  | { kind: 'sphere'; center: [number, number, number]; radius: number };

/** Wire (cable / hanger / rail) instance layout, floats per instance. */
export const WIRE_STRIDE = 16;
/** Light sprite instance layout, floats per instance. */
export const LIGHT_STRIDE = 16;

export interface StructureResult {
  id: string;
  parts: PartData[];
  /** WIRE_STRIDE floats per wire: ax ay az bx by bz radius r g b ledGroup u0 u1 ledStrength fadeStart fadeEnd. */
  wires: Float32Array;
  /** LIGHT_STRIDE floats per light: x y z r g b size mode p0 p1 p2 p3 a0 a1 a2 a3. */
  lights: Float32Array;
  colliders: ColliderData[];
  /** Generation time in the worker (ms). */
  ms: number;
}

/** Oriented, regularly sampled terrain height patch (sampled on the main thread from geo.heightAt). */
export interface HeightPatch {
  ox: number;
  oz: number;
  /** Unit axis of the patch's first dimension (world xz). The second axis is (-uz, ux). */
  ux: number;
  uz: number;
  /** Extent along each axis (m). */
  lenU: number;
  lenV: number;
  /** Signed start offsets so the patch covers [u0, u0 + lenU] x [v0, v0 + lenV]. */
  u0: number;
  v0: number;
  cell: number;
  nu: number;
  nv: number;
  data: Float32Array;
}

/** Landmark definition as sent to the worker (anchors may carry a per-anchor `height`). */
export interface SiteDef extends Omit<LandmarkDef, 'anchors'> {
  anchors?: Array<{ x: number; z: number; height?: number }>;
}

export interface SiteInput {
  def: SiteDef;
  patches: HeightPatch[];
}

export type WorkerRequest = { type: 'build'; sites: SiteInput[] };

export type WorkerResponse =
  | { type: 'structure'; result: StructureResult }
  | { type: 'error'; id: string; message: string }
  | { type: 'done'; ms: number };
