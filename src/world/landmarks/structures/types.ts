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

/**
 * Road deck of a bridge, published on the main thread through the core 'roadSurface' service. The deck axis is
 * straight (BridgeFrame): station s along (ax, az) from (ox, oz), lateral x to the right, i.e. along (-az, ax).
 */
export interface DeckData {
  id: string;
  ox: number;
  oz: number;
  ax: number;
  az: number;
  /** Station of the first height sample and the sample spacing (m). */
  s0: number;
  step: number;
  /** Road surface height (m) at station s0 + i * step; the deck top is flat across (no crossfall). */
  heights: Float32Array;
  /** Half width of the deck top (m). */
  halfWidth: number;
  /** Lateral extent of the carriageway (the road strips, m). */
  roadX0: number;
  roadX1: number;
  /** Raised strips (walkway curbs) as flat [x0, x1, raise] triples. */
  raised: number[];
  /** Traffic lane centres (lateral m) and travel direction along +s. */
  lanes: { x: number; dir: 1 | -1 }[];
  /** Deck ends landing on the ground: the surface twists into the ground's crossfall there (build/deck-joint.ts). */
  joints: DeckJoint[];
}

/**
 * A deck end that lands on the ground (abutment or approach end): over `length` m inward from station `s` the deck
 * surface is raised by `offsets` (ground minus road surface at the end, sampled across the deck at `xs`; a raised
 * strip subtracts its raise), fading out inward, so the joint meets the drawn ground across the whole width.
 */
export interface DeckJoint {
  s: number;
  /** +1 when the deck continues toward -s from the end (the end is the deck's s1), -1 at s0. */
  dir: 1 | -1;
  length: number;
  /** Ascending lateral positions (m) of the offset samples. */
  xs: Float32Array;
  offsets: Float32Array;
  /** Lateral positions where the offset profile bends (a ribbon tessellated there follows it within 3 mm). */
  cuts: number[];
  /**
   * Lift (m) that keeps the deck above the ground under its last metres (a quay or platform the twisted deck would
   * dip under): row k at d = k * dd m inward (row 0 at the end: 0), sampled at `xs`.
   */
  bed: { dd: number; rows: number; lift: Float32Array } | null;
  /**
   * Lateral warp of the deck surface toward the lines of the ground it joins (tram tracks, lane lines): deck x `xs`
   * (ascending) moves by `dx` at the end, piecewise linear between them (0 outside), fading out over `length` m.
   */
  lateral: { xs: Float32Array; dx: Float32Array; length: number } | null;
}

/** A line drawn on a surface where it crosses a deck end: lateral position (m) and kind. */
export interface JointLine {
  x: number;
  kind: 'track' | 'lane';
}

/** One end of a deck of any bridge type (debug: joint checks, window.__structures.ends in dev). */
export interface DeckEnd {
  id: string;
  ox: number;
  oz: number;
  ax: number;
  az: number;
  s: number;
  dir: 1 | -1;
  /** Road surface height on the axis at the end (before the joint offsets). */
  height: number;
  halfWidth: number;
  /** The end lands on the ground (a DeckJoint applies). */
  landed: boolean;
  strips: { x0: number; x1: number; kind: string; raise: number; lanes: number; medianHalf: number; param: number }[];
  /** Lateral positions of barriers and lamp lines standing on the deck at the end (they cover its surface there). */
  fixtures: number[];
  /** The deck's tram track centres and lane lines where they meet the end (after the joint's lateral warp). */
  lines: JointLine[];
  /** The ground's lines across the end the deck was joined to (landed ends on the street ground). */
  groundLines: JointLine[];
}

export interface StructureResult {
  id: string;
  parts: PartData[];
  /** Road decks (bridges with a carriageway). */
  decks: DeckData[];
  /** Ends of every deck (joint checks). */
  ends: DeckEnd[];
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
  /** Exact ground across landed deck ends (sampled from the drawn street ground after a first build). */
  joints?: JointGround[];
}

/**
 * Drawn ground height across a deck end (deck frame ox/oz/ax/az, station s) at the ascending lateral positions `xs`
 * (a kerb shows as two samples 2 mm apart); NaN where there is no ground (water beside a quay or off a shore).
 */
export interface JointGround {
  ox: number;
  oz: number;
  ax: number;
  az: number;
  s: number;
  xs: Float32Array;
  ground: Float32Array;
  /** Ground under the deck's last metres: `rows` rows of xs.length heights at d = (k + 1) * dd m inward (NaN: none). */
  bed?: { dd: number; rows: number; ground: Float32Array };
  /** Tram tracks and lane lines of the ground crossing the end (their deck counterparts are moved onto them). */
  lines?: JointLine[];
}

export type WorkerRequest = { type: 'build'; sites: SiteInput[] };

export type WorkerResponse =
  | { type: 'structure'; result: StructureResult }
  | { type: 'error'; id: string; message: string }
  | { type: 'done'; ms: number };
