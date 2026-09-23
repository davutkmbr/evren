/**
 * Worker side of the traffic layer: the routable lane graph built from the OSM highways.
 *
 * - Drivable ways (carriageway classes, no access=no/private, no parking aisles) are clipped to the build rect and
 *   split at every vertex shared with another drivable way (the `refs` junction ids of data.ts) into edges.
 * - Every edge gets right-hand lanes per direction (oneway, lanes, lanes:forward/backward, width; kerbside parking
 *   strips narrow the moving part), trimmed back from junctions by the width of the crossing streets.
 * - Junctions get Hermite connectors from each incoming lane to the outgoing lanes it may turn into (rightmost lane
 *   turns right, leftmost turns left, straight keeps the lane; U-turns only at dead ends).
 * - Traffic signal nodes become signal heads grouped into controllers (phase group per approach axis), pedestrian
 *   crossings, tram crossings and bus stops become stops along the lanes.
 * - Bridge ways on a rendered deck (DeckSpec) follow the deck's lanes instead of the OSM geometry.
 * OSM carries no turn restriction relations in the slice data (schema v2), so every legal-looking turn is allowed.
 */
import type { WorldBounds } from '../../../core/contracts';
import type { OsmData, OsmPoint, OsmRoad } from '../data';
import { Surf } from '../shared/street-field';
import type { StreetSurface } from '../shared/street-surface';
import { clipPolyline, hermite, offsetPolyline, PathFlag, PathPool, pointAt, polyLength, project, reversePolyline, subPolyline } from './paths';
import { LaneFlag, MAX_GROUPS, StopKind, type DeckSpec } from './protocol';

/** Priority / preference rank of highway classes. */
export const RANK: Record<string, number> = {
  trunk: 6,
  trunk_link: 5,
  primary: 5,
  primary_link: 4.5,
  secondary: 4,
  secondary_link: 3.5,
  tertiary: 3,
  tertiary_link: 2.5,
  unclassified: 2,
  residential: 1.5,
  living_street: 1,
  service: 0.5,
};

/** Typical free-flow speeds (km/h) in the dense old town, lower than the legal limits. */
const SPEED_KMH: Record<string, number> = {
  trunk: 50,
  trunk_link: 35,
  primary: 42,
  primary_link: 32,
  secondary: 38,
  secondary_link: 30,
  tertiary: 34,
  tertiary_link: 28,
  unclassified: 28,
  residential: 24,
  living_street: 14,
  service: 14,
};

/** Moving vehicles per metre of lane at full (rush hour) traffic. */
const DENSITY: Record<string, number> = {
  trunk: 1 / 30,
  trunk_link: 1 / 50,
  primary: 1 / 32,
  primary_link: 1 / 50,
  secondary: 1 / 38,
  secondary_link: 1 / 55,
  tertiary: 1 / 55,
  tertiary_link: 1 / 70,
  unclassified: 1 / 130,
  residential: 1 / 240,
  living_street: 1 / 360,
  service: 1 / 600,
};

const BUS_KINDS = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);
const NO_ACCESS = new Set(['no', 'private']);
const LIMITED_ACCESS = new Set(['destination', 'delivery', 'customers', 'limited']);
const NO_PARKING = new Set(['no', 'no_parking', 'no_stopping', 'separate', 'fire_lane']);

/** Lane step (m) of lane and connector paths. */
const LANE_STEP = 2;
const CONN_STEP = 1;
/** Width (m) of a kerbside parking strip. */
export const PARK_STRIP = 2.1;
/** Trim (m) of deck lanes at the bridge heads, so the connector can bend onto the ground street. */
const DECK_TRIM = 22;

export function drivable(r: OsmRoad): boolean {
  if (RANK[r.kind] === undefined || r.pts.length < 4) {
    return false;
  }
  if (r.access && NO_ACCESS.has(r.access)) {
    return false;
  }
  if (r.kind === 'service' && (r.service === 'parking_aisle' || r.service === 'driveway' || r.service === 'drive-through')) {
    return false;
  }
  return true;
}

export interface Edge {
  id: number;
  road: number;
  r: OsmRoad;
  pts: number[];
  len: number;
  from: number;
  to: number;
  /** Junction / feature ref -> arc length along pts. */
  refS: Map<number, number>;
  oneway: boolean;
  rank: number;
  speed: number;
  cobble: boolean;
  width: number;
  /** Parking strip width (m) on the left / right kerb (relative to pts direction). */
  parkL: number;
  parkR: number;
  /** Trim (m) at the start / end node. */
  trim0: number;
  trim1: number;
  deck: DeckSpec | null;
  /** Lane ids along pts (forward) and against it (backward), rightmost first. */
  fwd: number[];
  bwd: number[];
}

interface NodeRec {
  x: number;
  z: number;
  boundary: boolean;
  /** Edge ends at this node: edge id and whether it is the edge's start. */
  ends: { edge: number; start: boolean }[];
}

interface LaneRec {
  path: number;
  edge: number;
  from: number;
  to: number;
  forward: boolean;
  index: number;
  count: number;
  flags: number;
  /** Trimmed lane polyline (x, z). */
  pts: number[];
  len: number;
  conns: number[];
  stops: { s: number; kind: number; ref: number }[];
  reverse: number;
}

interface ConnRec {
  path: number;
  from: number;
  to: number;
  node: number;
  turn: number;
  weight: number;
}

interface HeadRec {
  source: number;
  ctrl: number;
  group: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  rank: number;
}

export interface NetworkBuild {
  pool: PathPool;
  edges: Edge[];
  nodes: NodeRec[];
  lanes: LaneRec[];
  conns: ConnRec[];
  heads: HeadRec[];
  ctrlGroups: number[];
  nodeSignal: Uint8Array;
  crossingBusy: number[];
  /** Tram crossing points (index = tram crossing ref of the stops). */
  tramCrossings: OsmPoint[];
  /** Stops of the edges (s along edge pts) used to keep parking clear. */
  edgeKeepClear: Map<number, number[]>;
}

function deckOf(r: OsmRoad, pts: number[], decks: readonly DeckSpec[]): DeckSpec | null {
  if (!r.bridge) {
    return null;
  }
  for (const d of decks) {
    let ok = true;
    for (let k = 0; k < pts.length && ok; k += 2) {
      const dx = pts[k] - d.ox;
      const dz = pts[k + 1] - d.oz;
      const s = dx * d.ax + dz * d.az;
      const x = -dx * d.az + dz * d.ax;
      ok = s > d.s0 - 8 && s < d.s1 + 8 && Math.abs(x) < d.halfWidth + 8;
    }
    if (ok) {
      return d;
    }
  }
  return null;
}

/**
 * Kerbside parking strips [left, right] (m) of an edge. Tagged parking wins; otherwise main roads stay clear and
 * every other street parks where the moving part keeps its minimum width: side streets of the old town are lined
 * with cars even when two-way traffic then has to squeeze through one at a time (see LaneFlag.Narrow).
 */
function parkingStrips(r: OsmRoad, id: number, width: number, lanes: number, oneway: boolean, rank: number): [number, number] {
  const tagged = r.parking;
  if (tagged) {
    const side = (v: string): number => (NO_PARKING.has(v) ? 0 : PARK_STRIP);
    return [side(tagged[0]), side(tagged[1])];
  }
  if (rank >= 3.5 || r.bridge || r.tunnel || r.junction === 'roundabout') {
    return [0, 0];
  }
  // minimum moving width: a lane per direction on busier streets, one shared lane on side streets
  const need = rank >= 2.5 ? lanes * 2.9 : oneway ? lanes * 2.6 : 3.2;
  const spare = width - need;
  const flip = ((id * 2654435761) >>> 0) % 2 === 0;
  if (spare >= PARK_STRIP * 2 - 0.1) {
    return [PARK_STRIP, PARK_STRIP];
  }
  if (spare >= PARK_STRIP - 0.35) {
    return flip ? [PARK_STRIP, 0] : [0, PARK_STRIP];
  }
  return [0, 0];
}

function laneCounts(r: OsmRoad, oneway: boolean, rank: number): [number, number] {
  const w = r.width;
  if (oneway) {
    const n = r.lanesForward ?? r.lanes ?? (w >= 9.5 && rank >= 3 ? 3 : w >= 6.4 && rank >= 3 ? 2 : 1);
    return [Math.max(1, Math.min(4, n)), 0];
  }
  if (r.lanesForward || r.lanesBackward) {
    return [Math.max(1, Math.min(3, r.lanesForward ?? 1)), Math.max(1, Math.min(3, r.lanesBackward ?? 1))];
  }
  if (r.lanes && r.lanes >= 2) {
    const f = Math.ceil(r.lanes / 2);
    return [Math.min(3, f), Math.min(3, Math.max(1, r.lanes - f))];
  }
  return w >= 13 && rank >= 3 ? [2, 2] : [1, 1];
}

/** Headings (unit x, z) at the start and the end of a polyline. */
function endHeading(p: number[], atEnd: boolean): [number, number] {
  const n = p.length / 2;
  let a = atEnd ? n - 2 : 0;
  let b = atEnd ? n - 1 : 1;
  // skip degenerate segments
  while (Math.hypot(p[b * 2] - p[a * 2], p[b * 2 + 1] - p[a * 2 + 1]) < 1e-3 && (atEnd ? a > 0 : b < n - 1)) {
    if (atEnd) {
      a--;
    } else {
      b++;
    }
  }
  const dx = p[b * 2] - p[a * 2];
  const dz = p[b * 2 + 1] - p[a * 2 + 1];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

/** Signed turn from heading a to heading b (rad, + = left seen from above with north up). */
function turnAngle(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(-(ax * bz - az * bx), ax * bx + az * bz);
}

export function buildNetwork(
  data: Pick<OsmData, 'roads' | 'points'>,
  surface: StreetSurface,
  rect: WorldBounds,
  decks: readonly DeckSpec[],
): NetworkBuild {
  const pool = new PathPool(surface);

  /* ---------------- pieces and nodes ---------------- */
  interface Piece {
    road: number;
    pts: number[];
    refs: number[];
    startCut: boolean;
    endCut: boolean;
  }
  const pieces: Piece[] = [];
  const refUse = new Map<number, number>();
  data.roads.forEach((r, road) => {
    if (!drivable(r)) {
      return;
    }
    const vref = new Array<number>(r.pts.length / 2).fill(-1);
    if (r.refs) {
      for (let k = 0; k < r.refs.length; k += 2) {
        vref[r.refs[k]] = r.refs[k + 1];
      }
    }
    for (const c of clipPolyline(r.pts, vref, rect)) {
      pieces.push({ road, pts: c.pts, refs: c.keep, startCut: c.startCut, endCut: c.endCut });
      for (const ref of c.keep) {
        if (ref >= 0) {
          refUse.set(ref, (refUse.get(ref) ?? 0) + 1);
        }
      }
    }
  });

  const nodes: NodeRec[] = [];
  const nodeOfRef = new Map<number, number>();
  const nodeFor = (ref: number, x: number, z: number, boundary: boolean): number => {
    if (ref >= 0) {
      const n = nodeOfRef.get(ref);
      if (n !== undefined) {
        return n;
      }
      nodeOfRef.set(ref, nodes.length);
    }
    nodes.push({ x, z, boundary, ends: [] });
    return nodes.length - 1;
  };

  /* ---------------- edges ---------------- */
  const edges: Edge[] = [];
  for (const pc of pieces) {
    const r = data.roads[pc.road];
    const n = pc.pts.length / 2;
    let a = 0;
    for (let i = 1; i < n; i++) {
      const ref = pc.refs[i];
      const split = i === n - 1 || (ref >= 0 && (refUse.get(ref) ?? 0) >= 2);
      if (!split) {
        continue;
      }
      const pts = pc.pts.slice(a * 2, i * 2 + 2);
      const refS = new Map<number, number>();
      let acc = 0;
      for (let v = a; v <= i; v++) {
        if (v > a) {
          acc += Math.hypot(pc.pts[v * 2] - pc.pts[v * 2 - 2], pc.pts[v * 2 + 1] - pc.pts[v * 2 - 1]);
        }
        if (pc.refs[v] >= 0) {
          refS.set(pc.refs[v], acc);
        }
      }
      const from = nodeFor(pc.refs[a], pts[0], pts[1], a === 0 && pc.startCut);
      const to = nodeFor(pc.refs[i], pts[pts.length - 2], pts[pts.length - 1], i === n - 1 && pc.endCut);
      const rank = RANK[r.kind] ?? 1;
      let speed = (SPEED_KMH[r.kind] ?? 25) / 3.6;
      if (r.maxspeed) {
        speed = Math.min(speed * 1.15, (r.maxspeed / 3.6) * 0.85);
      }
      const mid = pointAt(pts, acc / 2);
      const cobble = surface.surfaceAt(mid[0], mid[1]) === Surf.Cobble;
      if (cobble) {
        speed *= 0.8;
      }
      edges.push({
        id: edges.length,
        road: pc.road,
        r,
        pts,
        len: acc,
        from,
        to,
        refS,
        oneway: !!r.oneway,
        rank,
        speed,
        cobble,
        width: r.width,
        parkL: 0,
        parkR: 0,
        trim0: 0,
        trim1: 0,
        deck: deckOf(r, pts, decks),
        fwd: [],
        bwd: [],
      });
      nodes[from].ends.push({ edge: edges.length - 1, start: true });
      nodes[to].ends.push({ edge: edges.length - 1, start: false });
      a = i;
    }
  }

  /* ---------------- trims ---------------- */
  const trimAt = (node: NodeRec, self: Edge): number => {
    const deg = node.ends.length;
    if (self.deck) {
      return DECK_TRIM;
    }
    if (node.boundary || deg <= 1) {
      return 0;
    }
    if (deg === 2) {
      return 1.5;
    }
    let w = 0;
    for (const e of node.ends) {
      if (e.edge !== self.id) {
        w = Math.max(w, edges[e.edge].width / 2);
      }
    }
    return Math.min(16, Math.max(3.5, w + 1.8));
  };
  for (const e of edges) {
    e.trim0 = trimAt(nodes[e.from], e);
    e.trim1 = trimAt(nodes[e.to], e);
    const sum = e.trim0 + e.trim1;
    const max = e.len * 0.8;
    if (sum > max) {
      e.trim0 *= max / sum;
      e.trim1 *= max / sum;
    }
  }

  /* ---------------- lanes ---------------- */
  const lanes: LaneRec[] = [];
  for (const e of edges) {
    const r = e.r;
    let nF: number;
    let nB: number;
    let fwdOffsets: number[];
    let bwdOffsets: number[];
    let fwdGeom: (off: number) => number[];
    let bwdGeom: (off: number) => number[];
    let narrow = false;
    if (e.deck) {
      const d = e.deck;
      const sA = (e.pts[0] - d.ox) * d.ax + (e.pts[1] - d.oz) * d.az;
      const sB = (e.pts[e.pts.length - 2] - d.ox) * d.ax + (e.pts[e.pts.length - 1] - d.oz) * d.az;
      const sign = sB >= sA ? 1 : -1;
      const pick = (dir: number): number[] =>
        d.lanes
          .filter((l) => l.dir === dir)
          .map((l) => l.x)
          .sort((p, q) => Math.abs(q) - Math.abs(p));
      fwdOffsets = pick(sign);
      bwdOffsets = e.oneway ? [] : pick(-sign);
      nF = fwdOffsets.length;
      nB = bwdOffsets.length;
      const line = (x: number, s0: number, s1: number): number[] => [
        d.ox + d.ax * s0 - d.az * x,
        d.oz + d.az * s0 + d.ax * x,
        d.ox + d.ax * s1 - d.az * x,
        d.oz + d.az * s1 + d.ax * x,
      ];
      fwdGeom = (x) => line(x, sA, sB);
      bwdGeom = (x) => line(x, sB, sA);
    } else {
      [nF, nB] = laneCounts(r, e.oneway, e.rank);
      [e.parkL, e.parkR] = parkingStrips(r, r.id + e.id, e.width, nF + nB, e.oneway, e.rank);
      const a = -e.width / 2 + e.parkL;
      const b = e.width / 2 - e.parkR;
      if (e.oneway) {
        const lw = (b - a) / nF;
        fwdOffsets = Array.from({ length: nF }, (_, k) => b - (k + 0.5) * lw);
        bwdOffsets = [];
      } else {
        const m = a + ((b - a) * nB) / (nF + nB);
        const lwF = (b - m) / nF;
        const lwB = (m - a) / nB;
        fwdOffsets = Array.from({ length: nF }, (_, k) => b - (k + 0.5) * lwF);
        // backward offsets in the edge frame (negative = left of pts direction)
        bwdOffsets = Array.from({ length: nB }, (_, k) => a + (k + 0.5) * lwB);
        // too narrow for two cars side by side: both directions share the middle, one at a time
        if (fwdOffsets[nF - 1] - bwdOffsets[nB - 1] < 2.3) {
          const c = (fwdOffsets[nF - 1] + bwdOffsets[nB - 1]) / 2;
          const k = Math.min(0.45, Math.max(0, (b - a) / 2 - 1.05));
          fwdOffsets[nF - 1] = c + k;
          bwdOffsets[nB - 1] = c - k;
          narrow = true;
        }
      }
      fwdGeom = (off) => offsetPolyline(e.pts, off);
      bwdGeom = (off) => reversePolyline(offsetPolyline(e.pts, off));
    }
    const baseFlags = (e.r.tunnel ? LaneFlag.Hidden : 0) | (e.deck ? LaneFlag.Deck : 0) | (BUS_KINDS.has(r.kind) ? LaneFlag.Bus : 0) | (narrow ? LaneFlag.Narrow : 0);
    const pathFlags = (e.r.tunnel ? PathFlag.Hidden : 0) | (e.deck ? PathFlag.Deck : 0);
    const make = (forward: boolean, offsets: number[], geom: (off: number) => number[], out: number[]): void => {
      offsets.forEach((off, k) => {
        const full = geom(off);
        const L = polyLength(full);
        const t0 = forward ? e.trim0 : e.trim1;
        const t1 = forward ? e.trim1 : e.trim0;
        const pts = subPolyline(full, Math.min(t0, L * 0.45), Math.max(L - t1, L * 0.55));
        const from = forward ? e.from : e.to;
        const to = forward ? e.to : e.from;
        let flags = baseFlags;
        if (nodes[from].boundary) {
          flags |= LaneFlag.Entry;
        }
        if (nodes[to].boundary) {
          flags |= LaneFlag.Exit;
        }
        const id = lanes.length;
        lanes.push({
          path: pool.add(pts, LANE_STEP, pathFlags),
          edge: e.id,
          from,
          to,
          forward,
          index: k,
          count: offsets.length,
          flags,
          pts,
          len: polyLength(pts),
          conns: [],
          stops: [],
          reverse: -1,
        });
        out.push(id);
      });
    };
    make(true, fwdOffsets, fwdGeom, e.fwd);
    make(false, bwdOffsets, bwdGeom, e.bwd);
    if (e.fwd.length && e.bwd.length) {
      lanes[e.fwd[0]].reverse = e.bwd[e.bwd.length - 1];
      lanes[e.bwd[0]].reverse = e.fwd[e.fwd.length - 1];
    }
  }

  /* ---------------- connectors ---------------- */
  const conns: ConnRec[] = [];
  const nodeRank = new Float32Array(nodes.length);
  nodes.forEach((node, ni) => {
    const incoming: number[] = [];
    const legs: { edge: number; lanes: number[] }[] = [];
    for (const end of node.ends) {
      const e = edges[end.edge];
      // lanes arriving here: forward lanes when the edge ends here, backward lanes when it starts here
      incoming.push(...(end.start ? e.bwd : e.fwd));
      const out = end.start ? e.fwd : e.bwd;
      if (out.length) {
        legs.push({ edge: e.id, lanes: out });
      }
      nodeRank[ni] = Math.max(nodeRank[ni], e.rank);
    }
    for (const li of incoming) {
      const lin = lanes[li];
      const [hx, hz] = endHeading(lin.pts, true);
      const px = lin.pts[lin.pts.length - 2];
      const pz = lin.pts[lin.pts.length - 1];
      const options: { leg: number; target: number; turn: number; weight: number }[] = [];
      const addFor = (allowUturn: boolean): void => {
        legs.forEach((leg, gi) => {
          const e = edges[leg.edge];
          const first = lanes[leg.lanes[0]];
          const [ox, oz] = endHeading(first.pts, false);
          const turn = turnAngle(hx, hz, ox, oz);
          const uturn = leg.edge === lin.edge || Math.abs(turn) > 2.6;
          if (uturn && !allowUturn) {
            return;
          }
          const nIn = lin.count;
          const nOut = leg.lanes.length;
          let target: number;
          const k = lin.index;
          if (uturn) {
            target = nOut - 1;
          } else if (turn < -0.6) {
            if (nIn > 1 && k !== 0) {
              return;
            }
            target = 0;
          } else if (turn > 0.6) {
            if (nIn > 1 && k !== nIn - 1) {
              return;
            }
            target = nOut - 1;
          } else {
            target = Math.min(k, nOut - 1);
          }
          const turnW = uturn ? 0.05 : Math.abs(turn) < 0.6 ? 1 : turn < 0 ? 0.36 : 0.26;
          let classW = 0.3 + e.rank * 0.26;
          if (e.r.access && LIMITED_ACCESS.has(e.r.access)) {
            classW *= 0.25;
          }
          if (e.r.kind === 'service') {
            classW *= 0.35;
          }
          if (e.r.name && e.r.name === edges[lin.edge].r.name) {
            classW *= 1.4;
          }
          options.push({ leg: gi, target: leg.lanes[target], turn, weight: turnW * classW });
        });
      };
      addFor(false);
      if (options.length === 0 && lin.count > 1) {
        // middle lanes without a straight option: let them turn anywhere
        const saved = lin.count;
        lin.count = 1;
        addFor(false);
        lin.count = saved;
      }
      if (options.length === 0) {
        addFor(true);
      }
      if (options.length === 0) {
        if (!(lin.flags & LaneFlag.Exit)) {
          lin.flags |= LaneFlag.Sink;
        }
        continue;
      }
      for (const o of options) {
        const lout = lanes[o.target];
        const qx = lout.pts[0];
        const qz = lout.pts[1];
        const [tx, tz] = endHeading(lout.pts, false);
        const u = Math.abs(o.turn) > 2.6;
        const d = Math.hypot(qx - px, qz - pz);
        const curve = d < 0.05 ? [px, pz, qx + tx * 0.05, qz + tz * 0.05] : hermite(px, pz, hx, hz, qx, qz, tx, tz, u ? 1.6 : 0.5 + Math.abs(o.turn) * 0.12);
        const hidden = lin.flags & LaneFlag.Hidden && lout.flags & LaneFlag.Hidden ? PathFlag.Hidden : 0;
        const deck = (lin.flags | lout.flags) & LaneFlag.Deck ? PathFlag.Deck : 0;
        const id = conns.length;
        conns.push({ path: pool.add(curve, CONN_STEP, hidden | deck), from: li, to: o.target, node: ni, turn: o.turn, weight: o.weight });
        lin.conns.push(id);
      }
    }
  });

  /* ---------------- stops: signals ---------------- */
  const edgesOfRef = new Map<number, number[]>();
  for (const e of edges) {
    for (const ref of e.refS.keys()) {
      let list = edgesOfRef.get(ref);
      if (!list) {
        list = [];
        edgesOfRef.set(ref, list);
      }
      list.push(e.id);
    }
  }
  // Only highway=traffic_signals nodes: the streets layer draws their poles. Signalised crossings without such a
  // node have no visible signal and are treated as busy zebra crossings below.
  const sources: { p: OsmPoint; crossing: boolean }[] = data.points
    .filter((p) => p.kind === 'highway=traffic_signals' && p.ref !== undefined)
    .map((p) => ({ p, crossing: false }));
  // controllers: signal nodes closer than 45 m form one junction
  const parent = sources.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      if ((sources[i].p.x - sources[j].p.x) ** 2 + (sources[i].p.z - sources[j].p.z) ** 2 < 45 * 45) {
        parent[find(i)] = find(j);
      }
    }
  }
  const ctrlOfRoot = new Map<number, number>();
  const heads: HeadRec[] = [];
  const nodeSignal = new Uint8Array(nodes.length);
  const laneS = (lane: LaneRec, x: number, z: number): number => project(lane.pts, x, z).s;
  /** Stop position on `lane` for a feature at arc s of its edge (null when the feature lies behind the lane start). */
  const stopOnLane = (lane: LaneRec, e: Edge, s: number, back: number): number | null => {
    const along = lane.forward ? s : e.len - s;
    if (along < 0.5) {
      return null;
    }
    if (along > e.len - 0.5) {
      return Math.max(0, lane.len - 0.3);
    }
    const c = pointAt(e.pts, s);
    const ls = laneS(lane, c[0], c[1]) - back;
    if (ls > lane.len - 0.3) {
      return Math.max(0, lane.len - 0.3);
    }
    return ls < 0.5 ? null : ls;
  };
  sources.forEach((src, si) => {
    const p = src.p;
    const root = find(si);
    let ctrl = ctrlOfRoot.get(root);
    if (ctrl === undefined) {
      ctrl = ctrlOfRoot.size;
      ctrlOfRoot.set(root, ctrl);
    }
    for (const ei of edgesOfRef.get(p.ref!) ?? []) {
      const e = edges[ei];
      const s = e.refS.get(p.ref!)!;
      const dir = p.direction === 'forward' ? 1 : p.direction === 'backward' ? -1 : 0;
      for (const [forward, list] of [
        [true, e.fwd],
        [false, e.bwd],
      ] as const) {
        if (!list.length || (dir === 1 && !forward) || (dir === -1 && forward)) {
          continue;
        }
        const stops: number[] = [];
        for (const li of list) {
          const st = stopOnLane(lanes[li], e, s, src.crossing ? 3.2 : 2.2);
          stops.push(st ?? -1);
        }
        if (stops[0] < 0) {
          continue;
        }
        const lane0 = lanes[list[0]];
        const pa = pointAt(lane0.pts, stops[0]);
        const heading = Math.atan2(pa[3], pa[2]);
        // pole on the right kerb, a little past the stop line
        const kerb = (forward ? e.width / 2 : e.width / 2) + 0.9;
        const off = kerb - (forward ? offsetOf(e, lane0, true) : offsetOf(e, lane0, false));
        const hx = pa[0] - pa[3] * off + pa[2] * 1.2;
        const hz = pa[1] + pa[2] * off + pa[3] * 1.2;
        const head = heads.length;
        heads.push({ source: si, ctrl, group: 0, x: hx, y: surface.heightAt(hx, hz), z: hz, heading, rank: e.rank });
        list.forEach((li, k) => {
          if (stops[k] >= 0) {
            lanes[li].stops.push({ s: stops[k], kind: StopKind.Signal, ref: head });
            if (lanes[li].len - stops[k] < 30) {
              nodeSignal[lanes[li].to] = 1;
            }
          }
        });
      }
    }
  });
  // phase groups per controller: approaches along the same axis share a group
  const nCtrl = ctrlOfRoot.size;
  const ctrlGroups: number[] = new Array(nCtrl).fill(0);
  const axes: number[][] = Array.from({ length: nCtrl }, () => []);
  for (const h of heads) {
    const ax = ((h.heading % Math.PI) + Math.PI) % Math.PI;
    const list = axes[h.ctrl];
    let g = list.findIndex((a) => {
      const d = Math.abs(a - ax);
      return Math.min(d, Math.PI - d) < 0.55;
    });
    if (g < 0) {
      if (list.length < MAX_GROUPS) {
        list.push(ax);
        g = list.length - 1;
      } else {
        g = list.length - 1;
      }
    }
    h.group = g;
    ctrlGroups[h.ctrl] = Math.max(ctrlGroups[h.ctrl], g + 1);
  }

  /* ---------------- stops: crossings, tram crossings, bus stops ---------------- */
  const crossingBusy: number[] = [];
  const tramCrossings: OsmPoint[] = [];
  const edgeKeepClear = new Map<number, number[]>();
  const keepClear = (e: number, s: number): void => {
    let l = edgeKeepClear.get(e);
    if (!l) {
      l = [];
      edgeKeepClear.set(e, l);
    }
    l.push(s);
  };
  for (const src of sources) {
    for (const ei of edgesOfRef.get(src.p.ref!) ?? []) {
      keepClear(ei, edges[ei].refS.get(src.p.ref!)!);
    }
  }
  for (const p of data.points) {
    if (p.ref === undefined) {
      continue;
    }
    const isCrossing = p.kind === 'highway=crossing' && p.crossing !== 'no';
    const isTram = p.kind === 'railway=tram_crossing' || p.kind === 'railway=level_crossing';
    if (!isCrossing && !isTram) {
      continue;
    }
    if (isCrossing && sources.some((q) => (q.p.x - p.x) ** 2 + (q.p.z - p.z) ** 2 < 14 * 14)) {
      continue;
    }
    const list = edgesOfRef.get(p.ref);
    if (!list) {
      continue;
    }
    const ref = isCrossing ? crossingBusy.length : tramCrossings.length;
    if (isCrossing) {
      const marked = p.crossing === 'marked' || p.crossing === 'zebra' || p.crossing === 'uncontrolled' || p.crossing === 'traffic_signals' || p.markings === 'zebra';
      crossingBusy.push(marked ? 1 : 0.45);
    } else {
      tramCrossings.push(p);
    }
    for (const ei of list) {
      const e = edges[ei];
      const s = e.refS.get(p.ref)!;
      keepClear(ei, s);
      for (const li of [...e.fwd, ...e.bwd]) {
        const st = stopOnLane(lanes[li], e, s, isCrossing ? 3.2 : 4.5);
        if (st !== null) {
          lanes[li].stops.push({ s: st, kind: isCrossing ? StopKind.Crossing : StopKind.TramCrossing, ref });
        }
      }
    }
  }
  let busStops = 0;
  for (const p of data.points) {
    if (p.kind !== 'highway=bus_stop') {
      continue;
    }
    let best = -1;
    let bestD = 16;
    let bestS = 0;
    lanes.forEach((l, li) => {
      if (!(l.flags & LaneFlag.Bus) || l.index !== 0 || l.len < 24) {
        return;
      }
      const n = l.pts.length;
      // cheap bbox reject
      let near = false;
      for (let k = 0; k < n && !near; k += 2) {
        near = Math.abs(l.pts[k] - p.x) < 60 && Math.abs(l.pts[k + 1] - p.z) < 60;
      }
      if (!near) {
        return;
      }
      const pr = project(l.pts, p.x, p.z);
      if (pr.d < bestD) {
        // the stop must be on the lane's right side
        const q = pointAt(l.pts, pr.s);
        const side = (p.x - q[0]) * -q[3] + (p.z - q[1]) * q[2];
        if (side > -1) {
          bestD = pr.d;
          best = li;
          bestS = pr.s;
        }
      }
    });
    if (best >= 0) {
      const l = lanes[best];
      const s = Math.min(l.len - 8, Math.max(10, bestS + 4));
      l.stops.push({ s, kind: StopKind.BusStop, ref: busStops++ });
      keepClear(l.edge, l.forward ? s : edges[l.edge].len - s);
    }
  }
  for (const l of lanes) {
    l.stops.sort((p, q) => p.s - q.s);
  }
  return { pool, edges, nodes, lanes, conns, heads, ctrlGroups, nodeSignal, crossingBusy, tramCrossings, edgeKeepClear };

  /** Lateral offset (edge frame, + = right of pts) of a lane at its start. */
  function offsetOf(e: Edge, lane: LaneRec, forward: boolean): number {
    const c = pointAt(e.pts, forward ? e.trim0 + 0.1 : e.len - e.trim1 - 0.1);
    const lx = lane.pts[forward ? 0 : 0];
    const lz = lane.pts[forward ? 1 : 1];
    const off = (lx - c[0]) * -c[3] + (lz - c[1]) * c[2];
    return forward ? off : -off;
  }
}

/** Per-lane spawn densities (vehicles / m at full traffic). */
export function laneDensity(e: Edge): number {
  let d = DENSITY[e.r.kind] ?? 1 / 200;
  if (e.r.access && LIMITED_ACCESS.has(e.r.access)) {
    d *= 0.2;
  }
  if (e.cobble) {
    d *= 0.7;
  }
  if (e.deck) {
    // Galata Köprüsü: the busiest link of the slice
    d *= 1.6;
  }
  return d;
}
