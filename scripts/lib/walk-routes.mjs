/**
 * Route planning for the dragon collision walk (scripts/walk-test.mjs --dragon), in plain Node: no browser, no
 * hand-picked coordinates. Any OSM area (OSM_AREAS in src/world/osm/area.ts) or local-metre bbox gets routes built
 * from its own OSM street data:
 * - streets: a seeded, coverage-greedy walk over the street graph (every walkable OSM way that is not in a tunnel,
 *   covered, indoors or below ground level (layer < 0: passages under buildings); ways join where they share a node), preferring edges no earlier route has taken;
 * - squares: two perpendicular chords across every pedestrian area / square (highway=pedestrian, place=square);
 * - quays: the coastline offset 10 m inland (OSM coastlines keep the land on their left).
 * Same seed and budget, same routes. Named presets keep hand-picked route sets (the Eminönü routes of commit 7c71997).
 */
import { existsSync, readFileSync } from 'node:fs';
import { readAreas } from '../../tools/world-compiler/lib/areas.mjs';

/** OSM highway kinds the dragon walks (motorways and their links are left out). */
const WALKABLE = new Set([
  'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified',
  'living_street', 'pedestrian', 'service', 'footway', 'path', 'steps', 'cycleway', 'track', 'road',
]);
const SQUARE_KINDS = new Set(['highway=pedestrian', 'place=square', 'landuse=pedestrian']);
/** Metres inland of the coastline for quay routes, and the shortest quay piece worth walking. */
const QUAY_OFFSET = 10;
const QUAY_MIN = 60;

/** Per-area defaults: route count, total planned length (m), seed. Areas without an entry get DEFAULT_PLAN. */
export const DEFAULT_PLAN = { preset: 'auto', routes: 10, lengthM: 4000, seed: 1 };
export const AREA_DEFAULTS = {
  galata: { preset: 'auto', routes: 40, lengthM: 24000, seed: 1 },
  eminonu: { preset: 'auto', routes: 10, lengthM: 4000, seed: 1 },
  kadikoy: { preset: 'auto', routes: 12, lengthM: 6000, seed: 1 },
};

/** Named OSM ways walked from end to end (every segment with the name, in file order): preset 'eminonu-streets'. */
const EMINONU_ROAD_ROUTES = [
  { id: 'resadiye', label: 'Reşadiye Caddesi', names: ['Reşadiye Caddesi'] },
  { id: 'hamidiye', label: 'Hamidiye / Mimar Kemalettin', names: ['Hamidiye Caddesi', 'Mimar Kemalettin Caddesi'] },
  { id: 'yenicami', label: 'Yeni Camii Cd, Tahmis, Hasırcılar', names: ['Yeni Camii Caddesi', 'Tahmis Sokağı', 'Hasırcılar Caddesi'] },
];
/** Straight legs (x, z polylines, local metres) across the square, along the tram line and the quay. */
const EMINONU_FREE_ROUTES = [
  { id: 'square', label: 'Eminönü Meydanı (Yeni Cami önü, batı-doğu)', pts: [-4210, 3045, -4150, 3050, -4080, 3060, -3990, 3055, -3930, 3070] },
  { id: 'square-ns', label: 'Meydan kuzey-güney (köprü ayağı, Yeni Cami ile Mısır Çarşısı arası)', pts: [-4020, 2990, -4060, 3050, -4076, 3095, -4085, 3125, -4080, 3160] },
  { id: 'quay', label: 'Rıhtım (iskeleler boyunca)', pts: [-4280, 2880, -4200, 2930, -4100, 2975, -3990, 2990, -3880, 3000] },
  { id: 'tram', label: 'Tramvay hattı (Eminönü - Sirkeci)', pts: [-4150, 2975, -4000, 3000, -3900, 3050, -3780, 3080, -3680, 3160] },
];

export const PRESETS = ['auto', 'eminonu-streets'];

/**
 * Known collider / render mismatches owned by other systems, per area: reported as `known` instead of failing the
 * run. Matched by collider source and position (x, z, radius r in m), so a bbox run picks up every list. Remove an
 * entry once fixed.
 */
export const KNOWN = {
  galata: [],
};

export function knownFor(c) {
  for (const list of Object.values(KNOWN)) {
    const k = list.find((n) => c.info?.source === n.source && c.at.some(([x, , z]) => Math.hypot(x - n.x, z - n.z) < n.r));
    if (k) return k;
  }
  return null;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inRect = (r, x, z) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

/**
 * Resolves `--area <id>` or `--bbox minX,minZ,maxX,maxZ` to { id, rect, dataFile, data }. A bbox uses the data file of
 * the area that covers most of it (the runtime slice wins ties, being what the game draws).
 */
export function resolveArea(root, { area, bbox }) {
  const areas = readAreas();
  const load = (a) => {
    const file = `${root}/${a.dataFile}`;
    if (!existsSync(file)) throw new Error(`area '${a.id}': ${a.dataFile} is missing (node scripts/data/fetch-osm.mjs --area ${a.id})`);
    return JSON.parse(readFileSync(file, 'utf8'));
  };
  if (bbox) {
    const [minX, minZ, maxX, maxZ] = bbox.split(',').map(Number);
    if (![minX, minZ, maxX, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ) throw new Error(`bad --bbox '${bbox}' (minX,minZ,maxX,maxZ in local metres)`);
    const rect = { minX, minZ, maxX, maxZ };
    let best = null;
    for (const a of areas) {
      if (!existsSync(`${root}/${a.dataFile}`)) continue;
      const data = load(a);
      const b = data.bbox;
      const ox = Math.max(0, Math.min(maxX, b.maxX) - Math.max(minX, b.minX));
      const oz = Math.max(0, Math.min(maxZ, b.maxZ) - Math.max(minZ, b.minZ));
      const score = ox * oz * (a.profile === 'slice' ? 1.01 : 1);
      if (score > 0 && (!best || score > best.score)) best = { score, a, data };
    }
    if (!best) throw new Error(`no OSM area data overlaps --bbox ${bbox}`);
    return { id: `bbox:${bbox}`, source: best.a.id, rect, dataFile: best.a.dataFile, data: best.data };
  }
  const a = areas.find((x) => x.id === area);
  if (!a) throw new Error(`unknown area '${area}' (known: ${areas.map((x) => x.id).join(', ')})`);
  const data = load(a);
  const b = data.bbox;
  return { id: a.id, source: a.id, rect: { minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ }, dataFile: a.dataFile, data };
}

/** Clips a polyline to the rect: returns the in-rect runs (vertices inside, no interpolation at the edge). */
function clipRuns(pts, rect) {
  const runs = [];
  let cur = [];
  for (let i = 0; i < pts.length; i += 2) {
    if (inRect(rect, pts[i], pts[i + 1])) cur.push(pts[i], pts[i + 1]);
    else {
      if (cur.length >= 4) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 4) runs.push(cur);
  return runs;
}

/** Walkable street graph of the rect: nodes keyed by coordinate (ways share OSM nodes), edges carry their way. */
export function streetGraph(data, rect) {
  const nodes = new Map();
  const edges = [];
  const node = (x, z) => {
    const k = `${x.toFixed(1)},${z.toFixed(1)}`;
    let n = nodes.get(k);
    if (!n) {
      n = { id: nodes.size, x, z, edges: [] };
      nodes.set(k, n);
    }
    return n;
  };
  for (const w of data.roads) {
    if (!WALKABLE.has(w.kind) || w.tunnel || w.covered || w.indoor || (w.layer ?? 0) < 0 || w.access === 'private') continue;
    for (const run of clipRuns(w.pts, rect)) {
      for (let i = 0; i + 3 < run.length; i += 2) {
        const a = node(run[i], run[i + 1]);
        const b = node(run[i + 2], run[i + 3]);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.05) continue;
        const e = { id: edges.length, a: a.id, b: b.id, len, way: w.id, name: w.name ?? null, kind: w.kind, width: w.width ?? null };
        edges.push(e);
        a.edges.push(e);
        b.edges.push(e);
      }
    }
  }
  const list = [...nodes.values()];
  return { nodes: list, edges, lengthM: edges.reduce((s, e) => s + e.len, 0) };
}

/** Street routes: coverage-greedy seeded walks over the graph, each about `targetM` long. */
function streetRoutes(graph, count, targetM, rand, visited) {
  const routes = [];
  if (!graph.edges.length) return routes;
  const pickEdge = () => {
    // Uniform by length over the edges no route has walked yet (all edges once everything is covered).
    const pool = graph.edges.filter((e) => !visited.has(e.id));
    const src = pool.length ? pool : graph.edges;
    let t = rand() * src.reduce((s, e) => s + e.len, 0);
    for (const e of src) if ((t -= e.len) <= 0) return e;
    return src[src.length - 1];
  };
  for (let r = 0; r < count; r++) {
    const e0 = pickEdge();
    let from = graph.nodes[rand() < 0.5 ? e0.a : e0.b];
    const pts = [from.x, from.z];
    const names = new Set();
    let len = 0;
    let prev = null;
    while (len < targetM) {
      let options = from.edges.filter((e) => e !== prev);
      if (!options.length) options = from.edges;
      if (!options.length) break;
      const fresh = options.filter((e) => !visited.has(e.id));
      // Mostly continue into unwalked streets; sometimes cross walked ones to reach the next unwalked part.
      const pool = fresh.length && rand() < 0.9 ? fresh : options;
      // Prefer going straight on (the same way) so routes read as streets, not zig-zags.
      const same = pool.filter((e) => prev && e.way === prev.way);
      const e = same.length && rand() < 0.75 ? same[0] : pool[Math.floor(rand() * pool.length)];
      const to = graph.nodes[e.a === from.id ? e.b : e.a];
      visited.add(e.id);
      if (e.name) names.add(e.name);
      pts.push(to.x, to.z);
      len += e.len;
      prev = e;
      from = to;
    }
    if (len < 20) continue;
    const label = [...names].slice(0, 3).join(', ') || 'isimsiz sokaklar';
    routes.push({ id: `street-${String(r + 1).padStart(2, '0')}`, label, kind: 'street', lengthM: Math.round(len), legs: [pts] });
  }
  return routes;
}

/** Two perpendicular chords (through the centroid, along the ring's long and short axes) per square, clipped to the ring. */
function squareRoutes(data, rect) {
  const routes = [];
  for (const a of data.areas ?? []) {
    if (!SQUARE_KINDS.has(a.kind) || !a.ring || a.ring.length < 6) continue;
    const r = a.ring;
    const n = r.length / 2;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += r[i * 2];
      cz += r[i * 2 + 1];
    }
    cx /= n;
    cz /= n;
    if (!inRect(rect, cx, cz)) continue;
    // Principal axis from the vertex covariance.
    let sxx = 0;
    let szz = 0;
    let sxz = 0;
    for (let i = 0; i < n; i++) {
      const dx = r[i * 2] - cx;
      const dz = r[i * 2 + 1] - cz;
      sxx += dx * dx;
      szz += dz * dz;
      sxz += dx * dz;
    }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    for (const [k, th] of [['long', ang], ['short', ang + Math.PI / 2]]) {
      const dx = Math.cos(th);
      const dz = Math.sin(th);
      // Chord ends: where the axis line leaves the ring, 4 m inside.
      const ts = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = r[j * 2] - cx;
        const az = r[j * 2 + 1] - cz;
        const bx = r[i * 2] - cx;
        const bz = r[i * 2 + 1] - cz;
        const ex = bx - ax;
        const ez = bz - az;
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (ax * ez - az * ex) / den;
        const u = (ax * dz - az * dx) / den;
        if (u >= 0 && u <= 1) ts.push(t);
      }
      const t0 = Math.min(...ts.filter((t) => t < 0)) + 4;
      const t1 = Math.max(...ts.filter((t) => t > 0)) - 4;
      if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 - t0 < 25) continue;
      const pts = [];
      const steps = Math.max(1, Math.ceil((t1 - t0) / 30));
      for (let s = 0; s <= steps; s++) {
        const t = t0 + ((t1 - t0) * s) / steps;
        pts.push(+(cx + dx * t).toFixed(1), +(cz + dz * t).toFixed(1));
      }
      const run = longestRun(pts, rect);
      if (!run || polyLength(run) < 25) continue;
      routes.push({ id: `square-${a.id}-${k}`, label: `${a.name ?? a.kind} (${k === 'long' ? 'uzun' : 'kısa'} eksen)`, kind: 'square', lengthM: Math.round(polyLength(run)), legs: [run] });
    }
  }
  return routes;
}

/** Quay routes: coastline pieces in the rect, offset QUAY_OFFSET m to the left (land side) and resampled every 15 m. */
function quayRoutes(data, rect) {
  const routes = [];
  for (const l of data.lines ?? []) {
    if (l.kind !== 'natural=coastline') continue;
    for (const run of clipRuns(l.pts, rect)) {
      const off = [];
      const n = run.length / 2;
      for (let i = 0; i < n; i++) {
        const p = Math.max(0, i - 1);
        const q = Math.min(n - 1, i + 1);
        let tx = run[q * 2] - run[p * 2];
        let tz = run[q * 2 + 1] - run[p * 2 + 1];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        // Left of the direction of travel in x-right / z-down (south) local metres: (tz, -tx).
        off.push(run[i * 2] + tz * QUAY_OFFSET, run[i * 2 + 1] - tx * QUAY_OFFSET);
      }
      const pts = longestRun(resample(off, 15), rect);
      if (!pts) continue;
      const len = polyLength(pts);
      if (len < QUAY_MIN) continue;
      routes.push({ id: `quay-${l.id}-${routes.length + 1}`, label: 'Rıhtım (kıyı çizgisinin 10 m içi)', kind: 'quay', lengthM: Math.round(len), legs: [pts] });
    }
  }
  return routes;
}

function longestRun(pts, rect) {
  let best = null;
  for (const r of clipRuns(pts, rect)) if (!best || polyLength(r) > polyLength(best)) best = r;
  return best;
}

export function polyLength(pts) {
  let s = 0;
  for (let i = 2; i < pts.length; i += 2) s += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return s;
}

function resample(pts, step) {
  const out = [pts[0], pts[1]];
  let acc = 0;
  for (let i = 2; i < pts.length; i += 2) {
    acc += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (acc >= step || i === pts.length - 2) {
      out.push(+pts[i].toFixed(1), +pts[i + 1].toFixed(1));
      acc = 0;
    }
  }
  return out;
}

function eminonuStreets(data) {
  const routes = [];
  for (const r of EMINONU_ROAD_ROUTES) {
    const legs = [];
    for (const name of r.names) for (const w of data.roads) if (w.name === name && !w.bridge) legs.push(w.pts);
    routes.push({ id: r.id, label: r.label, kind: 'street', lengthM: Math.round(legs.reduce((s, p) => s + polyLength(p), 0)), legs });
  }
  for (const r of EMINONU_FREE_ROUTES) routes.push({ id: r.id, label: r.label, kind: r.id.startsWith('square') ? 'square' : r.id === 'quay' ? 'quay' : 'street', lengthM: Math.round(polyLength(r.pts)), legs: [r.pts] });
  return routes;
}

/**
 * Plans the routes of one area. opts: preset ('auto' | 'eminonu-streets'), routes (street route count), lengthM (total
 * planned length, squares and quays included), seed. Returns { routes, graph: { lengthM, edges, plannedM, coveragePct } }.
 */
export function planRoutes(area, opts = {}) {
  const def = { ...DEFAULT_PLAN, ...(AREA_DEFAULTS[area.source] ?? {}), ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) };
  const graph = streetGraph(area.data, area.rect);
  if (def.preset === 'eminonu-streets') {
    const routes = eminonuStreets(area.data);
    return { plan: def, routes, graph: { lengthM: Math.round(graph.lengthM), edges: graph.edges.length } };
  }
  if (def.preset !== 'auto') throw new Error(`unknown preset '${def.preset}' (known: ${PRESETS.join(', ')})`);
  const rand = rng(def.seed);
  // Squares and quays first (they are few and are where the dragon lands); streets share the rest of the budget.
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const extra = [];
  let extraM = 0;
  for (const r of [...shuffle(squareRoutes(area.data, area.rect)), ...shuffle(quayRoutes(area.data, area.rect))]) {
    if (extraM + r.lengthM > def.lengthM * 0.35) continue;
    extra.push(r);
    extraM += r.lengthM;
  }
  const visited = new Set();
  const streetBudget = Math.max(0, def.lengthM - extraM);
  const streets = streetRoutes(graph, def.routes, streetBudget / Math.max(1, def.routes), rand, visited);
  let plannedM = 0;
  for (const id of visited) plannedM += graph.edges[id].len;
  return {
    plan: def,
    routes: [...streets, ...extra],
    graph: { lengthM: Math.round(graph.lengthM), edges: graph.edges.length, plannedM: Math.round(plannedM), coveragePct: graph.lengthM ? +((plannedM / graph.lengthM) * 100).toFixed(1) : 0 },
  };
}

/** Nearest walkable OSM way to a point (for stuck reports): name, kind, mapped width, distance. */
export function nearestWay(data, x, z) {
  let best = null;
  for (const w of data.roads) {
    if (!WALKABLE.has(w.kind)) continue;
    const p = w.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i];
      const az = p[i + 1];
      const ex = p[i + 2] - ax;
      const ez = p[i + 3] - az;
      const l2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
      if (!best || d < best.d) best = { d, name: w.name ?? null, kind: w.kind, width: w.width ?? null, id: w.id };
    }
  }
  return best ? { ...best, d: +best.d.toFixed(1) } : null;
}
