/** Messages between the vegetation main thread and its placement workers. */

/** A raw window of one geo grid: cells [c0, c0 + w) × [r0, r0 + h) of a grid with the given cell size / origin. */
export interface GridWindow<T extends Float32Array | Uint8Array> {
  data: T;
  w: number;
  h: number;
  /** World x / z of the centre of the window's first cell. */
  x0: number;
  z0: number;
  cell: number;
}

export interface MosqueRingSite {
  x: number;
  z: number;
  /** Pad radius (m). */
  radius: number;
  /** 0 small masjid .. 1 imperial mosque. */
  size: number;
}

export interface RoadLine {
  /** 1 avenue, 2 street, 4 coastal (geo RoadKind order: highway 0, avenue 1, street 2, bridge 3, coastal 4). */
  kind: number;
  width: number;
  /** Flat x, z pairs. */
  pts: Float32Array;
}

export interface PlacementInitMessage {
  type: 'init';
  mosques: MosqueRingSite[];
  roads: RoadLine[];
  /** Per species: reference crown radius (m) and height (m). */
  crownRadius: number[];
  height: number[];
}

export interface TileRequestMessage {
  type: 'tile';
  id: number;
  /** Tile min corner (world) and edge (m). */
  x0: number;
  z0: number;
  size: number;
  densityScale: number;
  landUse: GridWindow<Uint8Array>;
  height: GridWindow<Float32Array>;
  coast: GridWindow<Float32Array>;
  /** Urban building density 0..1 sampled on a regular lattice. */
  density: GridWindow<Float32Array>;
}

export type PlacementRequest = PlacementInitMessage | TileRequestMessage;

export interface TileResultMessage {
  type: 'tile';
  id: number;
  /** INSTANCE_STRIDE floats per tree, sorted by rank (ascending) so any prefix is a uniform thinning. */
  instances: Float32Array;
  count: number;
  /** Lowest base and highest crown top (m) of the tile's trees. */
  minY: number;
  maxY: number;
  ms: number;
}
