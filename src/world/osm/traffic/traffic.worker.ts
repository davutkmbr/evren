/// <reference lib="webworker" />
/** Builds the lane graph, tram tracks and parked vehicles off the main thread (see index.ts). */
import { FootprintIndex } from '../shared/footprints';
import { StreetSurface } from '../shared/street-surface';
import { serveWorker } from '../shared/worker';
import { rng32 } from './catalog';
import { buildNetwork, laneDensity } from './network';
import { parkKerbside, parkLots, ParkedBuffer } from './parking';
import type { TrafficNet, TrafficRequest, TrafficResult } from './protocol';
import { buildTracks, mapTramCrossings } from './rails';

serveWorker<TrafficRequest, TrafficResult>((req) => {
  const t0 = performance.now();
  const surface = new StreetSurface(req.base);
  const rng = rng32(req.seed);
  const b = buildNetwork(req.data, surface, req.base.rect, req.decks);
  const t1 = performance.now();
  const tb = buildTracks(req.data, b.pool, req.base.rect, req.decks);
  const footprints = new FootprintIndex(req.data.buildings);
  const parked = new ParkedBuffer(surface, rng);
  parkKerbside(b.edges, b.edgeKeepClear, (n) => b.nodes[n].ends.length, parked, surface, footprints, rng);
  const kerbside = parked.count;
  const lots = parkLots(req.data, parked, surface, footprints, rng);
  const t2 = performance.now();

  const L = b.lanes.length;
  const C = b.conns.length;
  const N = b.nodes.length;
  const H = b.heads.length;
  let stopTotal = 0;
  for (const l of b.lanes) {
    stopTotal += l.stops.length;
  }
  const net: TrafficNet = {
    samples: b.pool.samples.take(),
    pathStart: Uint32Array.from(b.pool.start),
    pathCount: Uint32Array.from(b.pool.count),
    pathStep: Float32Array.from(b.pool.step),
    pathLength: Float32Array.from(b.pool.length),
    pathFlags: Uint8Array.from(b.pool.flags),
    lanePath: new Uint32Array(L),
    laneEdge: new Uint32Array(L),
    laneFrom: new Int32Array(L),
    laneTo: new Int32Array(L),
    laneRank: new Float32Array(L),
    laneSpeed: new Float32Array(L),
    laneIndex: new Uint8Array(L),
    laneCount: new Uint8Array(L),
    laneFlags: new Uint8Array(L),
    laneDensity: new Float32Array(L),
    laneConnStart: new Uint32Array(L),
    laneConnCount: new Uint16Array(L),
    laneStopStart: new Uint32Array(L),
    laneStopCount: new Uint16Array(L),
    laneReverse: new Int32Array(L),
    connPath: new Uint32Array(C),
    connFrom: new Uint32Array(C),
    connTo: new Uint32Array(C),
    connNode: new Uint32Array(C),
    connTurn: new Float32Array(C),
    connWeight: new Float32Array(C),
    nodeX: new Float32Array(N),
    nodeZ: new Float32Array(N),
    nodeRank: new Float32Array(N),
    nodeDegree: new Uint8Array(N),
    nodeSignal: b.nodeSignal,
    stopS: new Float32Array(stopTotal),
    stopKind: new Uint8Array(stopTotal),
    stopRef: new Uint32Array(stopTotal),
    headController: new Uint16Array(H),
    headGroup: new Uint8Array(H),
    headPos: new Float32Array(H * 3),
    headRank: new Float32Array(H),
    ctrlGroups: Uint8Array.from(b.ctrlGroups),
    crossingBusy: Float32Array.from(b.crossingBusy),
    tramCrossing: mapTramCrossings(b.tramCrossings, tb),
  };
  let connCursor = 0;
  let stopCursor = 0;
  const connOrder: number[] = [];
  b.lanes.forEach((l, i) => {
    const e = b.edges[l.edge];
    net.lanePath[i] = l.path;
    net.laneEdge[i] = l.edge;
    net.laneFrom[i] = l.from;
    net.laneTo[i] = l.to;
    net.laneRank[i] = e.rank;
    net.laneSpeed[i] = e.speed;
    net.laneIndex[i] = l.index;
    net.laneCount[i] = l.count;
    net.laneFlags[i] = l.flags;
    net.laneDensity[i] = laneDensity(e);
    net.laneReverse[i] = l.reverse;
    net.laneConnStart[i] = connCursor;
    net.laneConnCount[i] = l.conns.length;
    for (const c of l.conns) {
      connOrder.push(c);
    }
    connCursor += l.conns.length;
    net.laneStopStart[i] = stopCursor;
    net.laneStopCount[i] = l.stops.length;
    for (const s of l.stops) {
      net.stopS[stopCursor] = s.s;
      net.stopKind[stopCursor] = s.kind;
      net.stopRef[stopCursor] = s.ref;
      stopCursor++;
    }
  });
  // connectors stored in lane order so each lane's connectors are contiguous
  connOrder.forEach((ci, k) => {
    const c = b.conns[ci];
    net.connPath[k] = c.path;
    net.connFrom[k] = c.from;
    net.connTo[k] = c.to;
    net.connNode[k] = c.node;
    net.connTurn[k] = c.turn;
    net.connWeight[k] = c.weight;
  });
  b.nodes.forEach((n, i) => {
    net.nodeX[i] = n.x;
    net.nodeZ[i] = n.z;
    net.nodeDegree[i] = Math.min(255, n.ends.length);
  });
  for (let i = 0; i < L; i++) {
    const to = net.laneTo[i];
    net.nodeRank[to] = Math.max(net.nodeRank[to], net.laneRank[i]);
  }
  b.heads.forEach((h, i) => {
    net.headController[i] = h.ctrl;
    net.headGroup[i] = h.group;
    net.headPos.set([h.x, h.y, h.z], i * 3);
    net.headRank[i] = h.rank;
  });
  const laneMetres = b.lanes.reduce((a, l) => a + l.len, 0);
  return {
    net,
    tracks: tb.tracks,
    parked: parked.take(),
    stats: {
      edges: b.edges.length,
      nodes: N,
      lanes: L,
      laneKm: Math.round(laneMetres / 100) / 10,
      connectors: C,
      signalHeads: H,
      controllers: b.ctrlGroups.length,
      crossings: b.crossingBusy.length,
      tramCrossings: b.tramCrossings.length,
      stops: stopTotal,
      tracks: tb.tracks.length,
      parkedKerb: kerbside,
      parkedLots: parked.count - kerbside,
      lots,
      paths: b.pool.size,
      samples: b.pool.samples.length / 5,
      graphMs: Math.round(t1 - t0),
      totalMs: Math.round(t2 - t0),
    },
  };
});
