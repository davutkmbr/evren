/**
 * Messages between the traffic layer (main thread) and traffic.worker.ts: the routable lane graph, tram tracks,
 * signal heads and parked vehicles, all as flat typed arrays (structured-clone / transfer friendly).
 */
import type { OsmData } from '../data';
import type { OsmWorkerBase } from '../shared/protocol';

/**
 * Elevated deck a bridge way runs on (Galata Köprüsü): a straight frame (origin, unit axis) with the lateral lane
 * and track offsets of the rendered deck (right-hand traffic: `dir` +1 travels along +axis). Heights are resolved on
 * the main thread (see decks.ts); the worker only lays out the geometry.
 */
export interface DeckSpec {
  id: string;
  ox: number;
  oz: number;
  ax: number;
  az: number;
  /** Station range of the deck (m along the axis). */
  s0: number;
  s1: number;
  halfWidth: number;
  /** Lateral offsets (m, + = right of +axis) of the carriageway lanes, outermost first per direction. */
  lanes: { x: number; dir: 1 | -1 }[];
  /** Lateral offsets of the tram tracks. */
  tracks: { x: number; dir: 1 | -1 }[];
}

export interface TrafficRequest {
  base: OsmWorkerBase;
  data: Pick<OsmData, 'roads' | 'rails' | 'points' | 'areas' | 'buildings'>;
  decks: DeckSpec[];
  seed: number;
}

/** Sample stride of TrafficNet.samples: x, y, z, roll (rad, + = right side down), speed cap (m/s). */
export const SAMPLE_STRIDE = 5;

/** Lane / path flags. */
export const LaneFlag = {
  /** Vehicles spawn at the start of this lane (slice edge). */
  Entry: 1,
  /** Lane leaves the slice: vehicles despawn at its end. */
  Exit: 2,
  /** Inside a tunnel: vehicles are hidden. */
  Hidden: 4,
  /** Runs on a bridge deck (heights come from the deck). */
  Deck: 8,
  /** Buses may use it (primary .. tertiary and links). */
  Bus: 16,
  /** Dead end without a U-turn: vehicles despawn at its end. */
  Sink: 32,
  /** Two-way street too narrow for two cars side by side (parked cars): one direction at a time. */
  Narrow: 64,
} as const;

export const StopKind = {
  /** Signal head: ref = head index. */
  Signal: 0,
  /** Pedestrian crossing without signals: ref = crossing index. */
  Crossing: 1,
  /** Tram level crossing: ref = tram crossing index. */
  TramCrossing: 2,
  /** Bus stop (buses only): ref = bus stop index. */
  BusStop: 3,
} as const;

/** Parked vehicle record: x, y, z, yaw, pitch, roll, model, r, g, b (linear paint). */
export const PARKED_STRIDE = 10;

/**
 * The lane graph. Every drivable path (lane or junction connector) is a polyline resampled at a fixed step
 * (`pathStep`), so a position s maps to sample floor(s / step) in O(1).
 */
export interface TrafficNet {
  samples: Float32Array;
  pathStart: Uint32Array;
  pathCount: Uint32Array;
  pathStep: Float32Array;
  pathLength: Float32Array;
  /** PathFlag bits (paths.ts): deck samples, hidden in a tunnel. */
  pathFlags: Uint8Array;

  /** Per lane (index = lane id). */
  lanePath: Uint32Array;
  laneEdge: Uint32Array;
  laneFrom: Int32Array;
  laneTo: Int32Array;
  /** Road rank (priority at junctions, route preference). */
  laneRank: Float32Array;
  /** Speed limit (m/s). */
  laneSpeed: Float32Array;
  /** 0 = rightmost lane of its direction. */
  laneIndex: Uint8Array;
  laneCount: Uint8Array;
  laneFlags: Uint8Array;
  /** Spawn weight (vehicles per metre at full traffic). */
  laneDensity: Float32Array;
  laneConnStart: Uint32Array;
  laneConnCount: Uint16Array;
  laneStopStart: Uint32Array;
  laneStopCount: Uint16Array;
  /** Opposite-direction lane of the same edge for U-turns at dead ends (-1 if none). */
  laneReverse: Int32Array;

  /** Per connector. */
  connPath: Uint32Array;
  connFrom: Uint32Array;
  connTo: Uint32Array;
  connNode: Uint32Array;
  /** Signed turn angle (rad, + = left). */
  connTurn: Float32Array;
  /** Route choice weight. */
  connWeight: Float32Array;

  /** Per node. */
  nodeX: Float32Array;
  nodeZ: Float32Array;
  /** Highest rank among the node's incoming lanes. */
  nodeRank: Float32Array;
  /** Number of edges meeting at the node. */
  nodeDegree: Uint8Array;
  /** 1 when the node is signal controlled (vehicles obey their heads instead of yielding). */
  nodeSignal: Uint8Array;

  /** Stops sorted by s within each lane. */
  stopS: Float32Array;
  stopKind: Uint8Array;
  stopRef: Uint32Array;

  /**
   * Signal heads (one per controlled approach): controller, phase group (approach axis), kerb-side position of the
   * signal pole (x, y, z) and the rank of the approaching road (the main phase follows the highest rank).
   */
  headController: Uint16Array;
  headGroup: Uint8Array;
  headPos: Float32Array;
  headRank: Float32Array;
  /** Signal controllers: number of phase groups. */
  ctrlGroups: Uint8Array;

  /** Pedestrian crossings: probability weight that pedestrians are crossing (0..1). */
  crossingBusy: Float32Array;
  /** Tram crossings: TRAM_CROSSING_STRIDE floats per crossing, [track, s] pairs (track -1 when unused). */
  tramCrossing: Float32Array;
}

/** Phase groups per signal controller. */
export const MAX_GROUPS = 4;
export const TRAM_CROSSING_STRIDE = 4;

export const TrackLine = { T1: 0, T2: 1 } as const;

/** A tram track: a path (in TrafficNet.samples) plus its stops. */
export interface TramTrack {
  path: number;
  line: number;
  /** Stop positions (m along the path) of the vehicle centre. */
  stops: number[];
  /** T2: the paired track of the other direction / siding (-1 otherwise). */
  pair: number;
  /**
   * T2: single-track sections shared with the paired track, [s0, s1] in this track's own stations, in the same
   * order on both tracks (a tram may only enter one while the paired tram is not on it).
   */
  single?: [number, number][];
  /** Deck-flagged samples (heights from the deck). */
  deck: boolean;
}

export interface TrafficResult {
  net: TrafficNet;
  tracks: TramTrack[];
  parked: Float32Array;
  stats: Record<string, number>;
}
