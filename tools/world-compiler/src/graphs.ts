/**
 * Walk graph (src/world/osm/details/crowd/graph.ts: sidewalks, cobbled lanes, pedestrian streets, footways, steps,
 * crossings, square wander graphs, joined into one network by walk-network.ts) and lane graph
 * (src/world/osm/traffic/network.ts) of the area, run in Node and exported as plain JSON. Heights follow the compiled
 * ground (ground.ts), not the flight slice's platform lifts.
 */
import type { WorldBounds } from '../../../src/core/contracts';
import { buildCover } from '../../../src/world/osm/details/cover/cover';
import { buildWalkGraph, poiDensity } from '../../../src/world/osm/details/crowd/graph';
import type { OsmData } from '../../../src/world/osm/data';
import type { StreetSurface } from '../../../src/world/osm/shared/street-surface';
import { buildNetwork } from '../../../src/world/osm/traffic/network';
import { SAMPLE_STRIDE } from '../../../src/world/osm/traffic/protocol';
import { FORMAT, type LaneGraphFile, type WalkGraphFile } from './format';
import type { GroundHeights } from './ground';
import { type NetworkStats, walkNetwork } from './walk-network';

/** Margin (m) the walk graph builder keeps from its area edge (crowd/graph.ts AREA_MARGIN). */
const WALK_AREA_MARGIN = 26;

const r2 = (v: number): number => Math.round(v * 100) / 100;

export interface WalkExport {
  file: WalkGraphFile;
  /** Lane direction (unit x, z) per vertex, for spawn headings. */
  dir: Float32Array;
  /** Runtime lanes (crowd/graph.ts), wander graphs and synthetic crossings of the runtime builder. */
  lanes: number;
  squares: number;
  runtimeCrossings: number;
  /** Runtime graph size before the network pass. */
  runtime: { vertices: number; edges: number };
  network: NetworkStats;
}

export function exportWalkGraph(area: string, data: OsmData, surface: StreetSurface, rect: WorldBounds, heights: GroundHeights, tileOf: (x: number, z: number) => string): WalkExport {
  const walkArea = { minX: rect.minX - WALK_AREA_MARGIN, maxX: rect.maxX + WALK_AREA_MARGIN, minZ: rect.minZ - WALK_AREA_MARGIN, maxZ: rect.maxZ + WALK_AREA_MARGIN };
  const poi = poiDensity(data.points, rect);
  const cover = buildCover(data, data.buildings, surface, [], poi);
  const trunks: number[] = [];
  for (const p of data.points) {
    if (p.kind === 'natural=tree') {
      trunks.push(p.x, p.z);
    }
  }
  const walk = buildWalkGraph(data, { surface, cover, area: walkArea, pads: [], poi, deck: null, trunks: Float32Array.from(trunks) });
  const net = walkNetwork(data, walk.graph, { surface, cover, rect, poi });
  const n = net.x.length;
  const file: WalkGraphFile = { format: FORMAT, area, vertices: [], halfWidth: [], edges: net.edges, density: net.density.map((d) => Math.round(d * 1000) / 1000), tile: [] };
  const dir = new Float32Array(n * 2);
  for (let v = 0; v < n; v++) {
    const x = net.x[v];
    const z = net.z[v];
    file.vertices.push(r2(x), r2(heights.at(x, z)), r2(z));
    file.halfWidth.push(r2(net.hw[v]));
    file.tile.push(tileOf(x, z));
    dir[v * 2] = net.dx[v];
    dir[v * 2 + 1] = net.dz[v];
  }
  return { file, dir, lanes: walk.lanes, squares: walk.squares, runtimeCrossings: walk.crossings, runtime: { vertices: walk.vertices, edges: walk.graph.nbr.length / 2 }, network: net.stats };
}

export function exportLaneGraph(area: string, data: OsmData, surface: StreetSurface, rect: WorldBounds, heights: GroundHeights): LaneGraphFile {
  const net = buildNetwork(data, surface, rect, []);
  const samples = net.pool.samples.take();
  const points = (path: number): number[] => {
    const out: number[] = [];
    const s0 = net.pool.start[path];
    for (let i = 0; i < net.pool.count[path]; i++) {
      const o = (s0 + i) * SAMPLE_STRIDE;
      const x = samples[o];
      const z = samples[o + 2];
      out.push(r2(x), r2(heights.carriage(x, z)), r2(z));
    }
    return out;
  };
  const file: LaneGraphFile = { format: FORMAT, area, paths: [] };
  for (const lane of net.lanes) {
    file.paths.push({ id: lane.path, kind: 'lane', points: points(lane.path), next: lane.conns.map((c) => net.conns[c].path), flags: lane.flags });
  }
  for (const c of net.conns) {
    file.paths.push({ id: c.path, kind: 'connector', points: points(c.path), next: [net.lanes[c.to].path], flags: net.pool.flags[c.path] });
  }
  file.paths.sort((a, b) => a.id - b.id);
  return file;
}
