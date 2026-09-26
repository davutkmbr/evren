/**
 * Local OpenStreetMap backend: answers the Overpass QL our fetch scripts send, from a one-time extract instead of the
 * public Overpass API.
 *
 * Source: the Geofabrik Turkey extract (data/osm-src/turkey-latest.osm.pbf, gitignored; download and verify with
 * `node scripts/data/osm-extract.mjs download`). `buildIndex` clips the İstanbul province (CLIP_BBOX) out of it with
 * complete ways and complete multipolygon relations (their members outside the clip are pulled in too) and writes a
 * binary index (data/osm-src/istanbul.osmidx) that `openIndex` maps back into typed arrays in about a second.
 *
 * `overpassLocal(ql)` runs the QL subset our scripts use and returns the JSON Overpass returns ({ osm3s, elements }),
 * element order included (per `out`: nodes, ways, relations, each by ascending id), so downstream code is unchanged:
 * - settings `[out:json]...;` (ignored), unions `( ... );`, named sets `->.x`, `.x out ...;`, `out ...;`
 * - queries `node|way|relation|rel|nwr` with an optional input set (`way.w`), tag filters `["k"]`, `[!"k"]`,
 *   `["k"="v"]`, `["k"!="v"]`, `["k"~"re"]`, `["k"!~"re"]` (`,i` for case-insensitive), a bbox `(s,w,n,e)`,
 *   `(around:r,lat,lon[,lat,lon...])` (a point or a polyline), `(around.set:r)`, `(bw[.set])` / `(bn[.set])`
 *   (relations with way / node members in a set; `way(bn)`: ways through the set's nodes), `(r[.set])` / `(w[.set])` (way / node members of the set's
 *   relations / ways) and plain ids `(123)`
 * - out modes body / meta (printed as body) / skel / ids / tags, with `geom` for full geometry.
 * Spatial semantics follow Overpass: a way is in a bbox when a node lies inside or a segment crosses it, a relation
 * when a member node or member way is; around distances are great-circle metres (local planar approximation).
 * Anything else throws, naming the unsupported construct.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright); see data/osm/LICENSE.md.
 */
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, renameSync, writeSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const SRC_DIR = resolve(ROOT, 'data/osm-src');
export const SOURCE_PBF = resolve(SRC_DIR, 'turkey-latest.osm.pbf');
export const INDEX_FILE = resolve(SRC_DIR, 'istanbul.osmidx');
/** İstanbul province (27.97-29.93 E, 40.80-41.58 N) with a margin. */
export const CLIP_BBOX = { south: 40.7, west: 27.9, north: 41.7, east: 30.0 };
/** Nodes kept in memory while clipping (so boundary-crossing ways rarely need another pass over the file). */
const RESERVE_MARGIN = 0.5;
const MAGIC = 'OSMLIDX1';
const INDEX_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

function varint(u8, pos) {
  let v = 0;
  let s = 1;
  let b;
  do {
    b = u8[pos.p++];
    v += (b & 0x7f) * s;
    s *= 128;
  } while (b & 0x80);
  return v;
}

/** Blob frames of a PBF file: { type: 'OSMHeader' | 'OSMData', start, end } (Blob message byte ranges). */
function frames(u8) {
  const out = [];
  let p = 0;
  while (p < u8.length) {
    const hl = ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0;
    p += 4;
    const pos = { p };
    let type = '';
    let size = 0;
    while (pos.p < p + hl) {
      const tag = varint(u8, pos);
      const f = Math.floor(tag / 8);
      if ((tag & 7) === 2) {
        const len = varint(u8, pos);
        if (f === 1) type = Buffer.from(u8.subarray(pos.p, pos.p + len)).toString('utf8');
        pos.p += len;
      } else {
        const v = varint(u8, pos);
        if (f === 3) size = v;
      }
    }
    p += hl;
    out.push({ type, start: p, end: p + size });
    p += size;
  }
  return out;
}

/** Header block fields we need (bbox is not needed): replication timestamp, writing program. */
async function readHeader(u8, fr) {
  const { readOsmHeaderBlock } = await import('@osmix/pbf');
  const { inflateSync } = await import('node:zlib');
  const pos = { p: fr.start };
  let zlib = null;
  let raw = null;
  while (pos.p < fr.end) {
    const tag = varint(u8, pos);
    if ((tag & 7) === 2) {
      const len = varint(u8, pos);
      const f = Math.floor(tag / 8);
      if (f === 3) zlib = u8.slice(pos.p, pos.p + len);
      if (f === 1) raw = u8.slice(pos.p, pos.p + len);
      pos.p += len;
    } else varint(u8, pos);
  }
  return readOsmHeaderBlock({ data: raw ?? zlib }, async (d) => (raw ? d : inflateSync(d)));
}

class Pool {
  constructor(file, n) {
    const url = new URL('./osm-pbf-worker.mjs', import.meta.url);
    this.workers = Array.from({ length: n }, () => new Worker(url, { workerData: { file } }));
  }
  async setup(s) {
    await Promise.all(
      this.workers.map(
        (w) =>
          new Promise((ok) => {
            w.once('message', ok);
            w.postMessage({ setup: s });
          }),
      ),
    );
  }
  /** Runs blob ranges [i, start, end] through the workers; results in blob order. */
  async run(items, batch = 8) {
    const results = new Array(items.length);
    const slot = new Map(items.map((it, k) => [it[0], k]));
    let next = 0;
    await Promise.all(
      this.workers.map(
        (w) =>
          new Promise((ok, fail) => {
            const feed = () => {
              if (next >= items.length) {
                w.removeAllListeners('message');
                ok();
                return;
              }
              const chunk = items.slice(next, next + batch);
              next += batch;
              w.postMessage({ items: chunk });
            };
            w.on('message', (m) => {
              if (m.error) {
                fail(new Error(m.error));
                return;
              }
              for (const r of m.out) results[slot.get(r.i)] = r;
              feed();
            });
            feed();
          }),
      ),
    );
    return results;
  }
  close() {
    return Promise.all(this.workers.map((w) => w.terminate()));
  }
}

/** Value of `key` in a flat [k, v, k, v...] list. */
const tagOf = (kv, key) => {
  for (let j = 0; j < kv.length; j += 2) if (kv[j] === key) return kv[j + 1];
  return undefined;
};

function sortedHas(arr, v) {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const x = arr[m];
    if (x === v) return true;
    if (x < v) lo = m + 1;
    else hi = m - 1;
  }
  return false;
}

function sortedIndex(arr, v) {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const x = arr[m];
    if (x === v) return m;
    if (x < v) lo = m + 1;
    else hi = m - 1;
  }
  return -1;
}

const toSharedF64 = (list) => {
  const sab = new SharedArrayBuffer(Math.max(8, list.length * 8));
  const a = new Float64Array(sab, 0, list.length);
  a.set(list);
  return sab;
};

/**
 * Clips CLIP_BBOX out of the PBF and writes the index. Phases: scan (nodes in the reserve bbox, all relations) ->
 * ways touching the clip -> missing multipolygon member ways -> missing nodes (only when a way leaves the reserve).
 */
export async function buildIndex({ pbf = SOURCE_PBF, out = INDEX_FILE, bbox = CLIP_BBOX, threads = Math.max(2, availableParallelism() - 1), log = console.error } = {}) {
  const t0 = Date.now();
  const lap = (what) => log(`[osm-local] ${what} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const fd = openSync(pbf, 'r');
  const size = fstatSync(fd).size;
  const file = new SharedArrayBuffer(size);
  const u8 = new Uint8Array(file);
  for (let off = 0; off < size; ) off += readSync(fd, u8, off, Math.min(1 << 28, size - off), off);
  closeSync(fd);
  const fr = frames(u8);
  const header = await readHeader(u8, fr[0]);
  const osmBase = header.osmosis_replication_timestamp ? new Date(header.osmosis_replication_timestamp * 1000).toISOString().replace('.000Z', 'Z') : null;
  const data = fr.slice(1).map((f, i) => [i, f.start, f.end]);
  lap(`read ${(size / 1e6).toFixed(0)} MB, ${data.length} blobs, osmBase ${osmBase}`);

  const e7 = (v) => Math.round(v * 1e7);
  const clip = [e7(bbox.south), e7(bbox.west), e7(bbox.north), e7(bbox.east)];
  const reserve = [e7(bbox.south - RESERVE_MARGIN), e7(bbox.west - RESERVE_MARGIN), e7(bbox.north + RESERVE_MARGIN), e7(bbox.east + RESERVE_MARGIN)];
  const pool = new Pool(file, threads);
  try {
    /* 1. Scan: nodes of the reserve bbox, every relation, the kind of every blob. */
    await pool.setup({ phase: 'scan', clip, reserve });
    const scan = await pool.run(data);
    const kinds = scan.map((r) => r.kind);
    let nRes = 0;
    for (const r of scan) if (r.kind === 'n') nRes += r.ids.length;
    const resId = new Float64Array(nRes);
    const resLat = new Int32Array(nRes);
    const resLon = new Int32Array(nRes);
    const resClip = new Uint8Array(nRes);
    const nodeTags = new Map();
    let o = 0;
    const rels = [];
    for (const r of scan) {
      if (r.kind === 'n') {
        resId.set(r.ids, o);
        resLat.set(r.lat, o);
        resLon.set(r.lon, o);
        resClip.set(r.clip, o);
        for (let k = 0; k < r.tags.length; k += 2) nodeTags.set(o + r.tags[k], r.tags[k + 1]);
        o += r.ids.length;
      } else if (r.kind === 'r') rels.push(...r.rels);
    }
    scan.length = 0;
    const clipIdList = [];
    for (let i = 0; i < nRes; i++) if (resClip[i]) clipIdList.push(resId[i]);
    const bits = new SharedArrayBuffer(2 ** 30 / 8);
    const bitsI = new Int32Array(bits);
    for (const id of clipIdList) {
      const b = id % 2 ** 30;
      bitsI[b >>> 5] |= 1 << (b & 31);
    }
    lap(`scan: ${nRes} reserve nodes, ${clipIdList.length} in the clip, ${nodeTags.size} tagged; ${rels.length} relations`);

    /* 2. Ways with a node in the clip. */
    const wayItems = data.filter((d, k) => kinds[k] === 'w');
    await pool.setup({ phase: 'ways', clipIds: toSharedF64(clipIdList), bits });
    const ways = (await pool.run(wayItems)).flatMap((r) => r.ways);
    const wayIdsSorted = Float64Array.from(ways.map((w) => w.id));
    lap(`ways: ${ways.length}`);

    /* 3. Relations with a member in the clip; complete their multipolygon member ways. */
    const clipIds = Float64Array.from(clipIdList);
    const keptRels = rels.filter((r) => {
      for (let j = 0; j < r.types.length; j++) {
        if (r.types[j] === 0 ? sortedHas(clipIds, r.refs[j]) : r.types[j] === 1 && sortedHas(wayIdsSorted, r.refs[j])) return true;
      }
      return false;
    });
    const want = new Set();
    for (const r of keptRels) {
      if (tagOf(r.kv, 'type') !== 'multipolygon') continue;
      for (let j = 0; j < r.types.length; j++) if (r.types[j] === 1 && !sortedHas(wayIdsSorted, r.refs[j])) want.add(r.refs[j]);
    }
    if (want.size) {
      await pool.setup({ phase: 'wantw', want: toSharedF64([...want].sort((a, b) => a - b)) });
      const extra = (await pool.run(wayItems)).flatMap((r) => r.ways);
      ways.push(...extra);
      ways.sort((a, b) => a.id - b.id);
      lap(`relations: ${keptRels.length} kept, ${extra.length} of ${want.size} outside multipolygon member ways added`);
    } else lap(`relations: ${keptRels.length} kept`);

    /* 4. Nodes: the clip plus every node a kept way or relation references. */
    const needed = new Uint8Array(nRes);
    const missing = new Set();
    const need = (id) => {
      const k = sortedIndex(resId, id);
      if (k >= 0) needed[k] = 1;
      else missing.add(id);
    };
    for (const w of ways) for (const id of w.refs) need(id);
    for (const r of keptRels) for (let j = 0; j < r.types.length; j++) if (r.types[j] === 0) need(r.refs[j]);
    let extraNodes = { ids: new Float64Array(0), lat: new Int32Array(0), lon: new Int32Array(0) };
    if (missing.size) {
      await pool.setup({ phase: 'wantn', want: toSharedF64([...missing].sort((a, b) => a - b)) });
      const got = await pool.run(data.filter((d, k) => kinds[k] === 'n'));
      extraNodes = {
        ids: Float64Array.from(got.flatMap((r) => [...r.ids])),
        lat: Int32Array.from(got.flatMap((r) => [...r.lat])),
        lon: Int32Array.from(got.flatMap((r) => [...r.lon])),
      };
      lap(`nodes: ${extraNodes.ids.length} of ${missing.size} outside the reserve added`);
    }

    /* 5. Assemble the index. */
    let nNodes = extraNodes.ids.length;
    for (let i = 0; i < nRes; i++) if (resClip[i] || needed[i]) nNodes++;
    const nodeId = new Float64Array(nNodes);
    const nodeLat = new Int32Array(nNodes);
    const nodeLon = new Int32Array(nNodes);
    const taggedNodes = [];
    {
      let a = 0;
      let b = 0;
      let k = 0;
      const ex = extraNodes;
      while (a < nRes || b < ex.ids.length) {
        if (a < nRes && !(resClip[a] || needed[a])) {
          a++;
          continue;
        }
        if (b >= ex.ids.length || (a < nRes && resId[a] < ex.ids[b])) {
          nodeId[k] = resId[a];
          nodeLat[k] = resLat[a];
          nodeLon[k] = resLon[a];
          const kv = nodeTags.get(a);
          if (kv) taggedNodes.push([k, kv]);
          a++;
        } else {
          nodeId[k] = ex.ids[b];
          nodeLat[k] = ex.lat[b];
          nodeLon[k] = ex.lon[b];
          b++;
        }
        k++;
      }
    }

    const strings = [];
    const stringIdx = new Map();
    const intern = (s) => {
      let i = stringIdx.get(s);
      if (i === undefined) {
        i = strings.length;
        strings.push(s);
        stringIdx.set(s, i);
      }
      return i;
    };
    const tagTable = (list) => {
      const start = new Uint32Array(list.length + 1);
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        start[i] = n;
        n += list[i].length / 2;
      }
      start[list.length] = n;
      const kv = new Uint32Array(n * 2);
      let p = 0;
      for (const l of list) for (const s of l) kv[p++] = intern(s);
      return { start, kv };
    };

    const tnIdx = Uint32Array.from(taggedNodes.map((t) => t[0]));
    const tnTags = tagTable(taggedNodes.map((t) => t[1]));

    const W = ways.length;
    const wayId = new Float64Array(W);
    const wayRefStart = new Uint32Array(W + 1);
    let nRefs = 0;
    for (let i = 0; i < W; i++) {
      wayId[i] = ways[i].id;
      wayRefStart[i] = nRefs;
      nRefs += ways[i].refs.length;
    }
    wayRefStart[W] = nRefs;
    const wayRef = new Int32Array(nRefs);
    const missingRefIds = [];
    const wayBox = new Int32Array(W * 4);
    for (let i = 0; i < W; i++) {
      let s = 2 ** 31 - 1;
      let wv = s;
      let n = -s;
      let e = -s;
      let p = wayRefStart[i];
      for (const id of ways[i].refs) {
        const k = sortedIndex(nodeId, id);
        if (k < 0) {
          wayRef[p++] = -2 - missingRefIds.length;
          missingRefIds.push(id);
          continue;
        }
        wayRef[p++] = k;
        s = Math.min(s, nodeLat[k]);
        n = Math.max(n, nodeLat[k]);
        wv = Math.min(wv, nodeLon[k]);
        e = Math.max(e, nodeLon[k]);
      }
      wayBox.set([s, wv, n, e], i * 4);
    }
    const wayTags = tagTable(ways.map((w) => w.kv));

    const R = keptRels.length;
    keptRels.sort((a, b) => a.id - b.id);
    const relId = Float64Array.from(keptRels.map((r) => r.id));
    const relMemStart = new Uint32Array(R + 1);
    let nMem = 0;
    for (let i = 0; i < R; i++) {
      relMemStart[i] = nMem;
      nMem += keptRels[i].types.length;
    }
    relMemStart[R] = nMem;
    const relMemType = new Uint8Array(nMem);
    const relMemRef = new Float64Array(nMem);
    const relMemRole = new Uint32Array(nMem);
    for (let i = 0, p = 0; i < R; i++) {
      const r = keptRels[i];
      for (let j = 0; j < r.types.length; j++, p++) {
        relMemType[p] = r.types[j];
        relMemRef[p] = r.refs[j];
        relMemRole[p] = intern(r.roles[j]);
      }
    }
    const relTags = tagTable(keptRels.map((r) => r.kv));

    const sections = {
      nodeId,
      nodeLat,
      nodeLon,
      tnIdx,
      tnTagStart: tnTags.start,
      tnTagKv: tnTags.kv,
      wayId,
      wayRefStart,
      wayRef,
      missingRefId: Float64Array.from(missingRefIds),
      wayBox,
      wayTagStart: wayTags.start,
      wayTagKv: wayTags.kv,
      relId,
      relMemStart,
      relMemType,
      relMemRef,
      relMemRole,
      relTagStart: relTags.start,
      relTagKv: relTags.kv,
    };
    const meta = {
      version: INDEX_VERSION,
      source: 'Geofabrik extract turkey-latest.osm.pbf (https://download.geofabrik.de/europe/turkey.html)',
      writingProgram: header.writingprogram ?? null,
      osmBase,
      built: new Date().toISOString(),
      clip: bbox,
      counts: { nodes: nNodes, taggedNodes: tnIdx.length, ways: W, relations: R, strings: strings.length, missingWayNodes: missingRefIds.length },
    };
    writeIndex(out, meta, strings, sections);
    lap(`wrote ${out}: ${JSON.stringify(meta.counts)}`);
    return meta;
  } finally {
    await pool.close();
  }
}

const TYPES = { Float64Array, Int32Array, Uint32Array, Uint8Array };

function writeIndex(out, meta, strings, sections) {
  mkdirSync(dirname(out), { recursive: true });
  const layout = [];
  let off = 0;
  for (const [name, arr] of Object.entries(sections)) {
    layout.push({ name, type: arr.constructor.name, length: arr.length, offset: off });
    off += Math.ceil(arr.byteLength / 8) * 8;
  }
  const head = Buffer.from(JSON.stringify({ ...meta, layout, strings }), 'utf8');
  const pre = Buffer.alloc(16);
  pre.write(MAGIC, 0, 'latin1');
  pre.writeDoubleLE(head.length, 8);
  const base = Math.ceil((16 + head.length) / 8) * 8;
  const tmp = `${out}.tmp`;
  const fd = openSync(tmp, 'w');
  writeSync(fd, pre, 0, 16, 0);
  writeSync(fd, head, 0, head.length, 16);
  for (const l of layout) {
    const arr = sections[l.name];
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let p = 0; p < bytes.length; ) p += writeSync(fd, bytes, p, Math.min(1 << 28, bytes.length - p), base + l.offset + p);
  }
  closeSync(fd);
  renameSync(tmp, out);
}

/* ------------------------------------------------------------------ */
/* Load                                                                */
/* ------------------------------------------------------------------ */

const openIndexes = new Map();

/** Maps the index file into typed arrays (cached per path). */
export function openIndex(path = INDEX_FILE) {
  if (openIndexes.has(path)) return openIndexes.get(path);
  if (!existsSync(path)) {
    throw new Error(`local OSM index ${path} is missing: run \`node scripts/data/osm-extract.mjs all\` (or pass --source overpass)`);
  }
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  const buf = new ArrayBuffer(size);
  const u8 = new Uint8Array(buf);
  for (let off = 0; off < size; ) off += readSync(fd, u8, off, Math.min(1 << 28, size - off), off);
  closeSync(fd);
  if (Buffer.from(u8.subarray(0, 8)).toString('latin1') !== MAGIC) throw new Error(`${path}: not a local OSM index`);
  const headLen = new DataView(buf).getFloat64(8, true);
  const head = JSON.parse(Buffer.from(u8.subarray(16, 16 + headLen)).toString('utf8'));
  if (head.version !== INDEX_VERSION) throw new Error(`${path}: index version ${head.version}, expected ${INDEX_VERSION}; rebuild it`);
  const base = Math.ceil((16 + headLen) / 8) * 8;
  const a = {};
  for (const l of head.layout) a[l.name] = new TYPES[l.type](buf, base + l.offset, l.length);
  const idx = new OsmIndex(head, a);
  openIndexes.set(path, idx);
  return idx;
}

class OsmIndex {
  constructor(head, a) {
    this.meta = head;
    this.strings = head.strings;
    delete head.strings;
    Object.assign(this, a);
    this.nNodes = a.nodeId.length;
    this.nWays = a.wayId.length;
    this.nRels = a.relId.length;
    this._strIdx = null;
  }
  /** String table index of `s`, -1 when absent. */
  str(s) {
    if (!this._strIdx) {
      this._strIdx = new Map();
      this.strings.forEach((v, i) => this._strIdx.set(v, i));
    }
    return this._strIdx.get(s) ?? -1;
  }
  /** Tag slot [start, end) (pair units) of node i, or null. */
  nodeTagRange(i) {
    const k = sortedIndex(this.tnIdx, i);
    return k < 0 ? null : [this.tnTagStart[k], this.tnTagStart[k + 1]];
  }
  nodeIndex(id) {
    return sortedIndex(this.nodeId, id);
  }
  wayIndex(id) {
    return sortedIndex(this.wayId, id);
  }
  relIndex(id) {
    return sortedIndex(this.relId, id);
  }
  tagsObject(kvArr, s, e) {
    const t = {};
    for (let j = s; j < e; j++) t[this.strings[kvArr[2 * j]]] = this.strings[kvArr[2 * j + 1]];
    return t;
  }
}

/* ------------------------------------------------------------------ */
/* Overpass QL subset                                                  */
/* ------------------------------------------------------------------ */

/** Splits `src` on `sep` at bracket depth 0, outside quotes. */
function splitTop(src, sep) {
  const out = [];
  let depth = 0;
  let q = null;
  let cur = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      cur += c;
      if (c === '\\') cur += src[++i] ?? '';
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === sep && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Index of the bracket closing the one at `open`, quote-aware. */
function closing(src, open) {
  const pairs = { '(': ')', '[': ']' };
  const stack = [pairs[src[open]]];
  let q = null;
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return i;
    }
  }
  throw new Error(`unbalanced bracket in: ${src}`);
}

const unquote = (s) => {
  s = s.trim();
  if (s.startsWith('"')) return JSON.parse(s);
  if (s.startsWith("'")) return s.slice(1, -1).replace(/\\'/g, "'");
  return s;
};

const TOKEN = String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[\w:.\-]+)`;
const TAG_RE = new RegExp(String.raw`^\s*(!)?\s*(${TOKEN})\s*(?:(=|!=|~|!~)\s*(${TOKEN})\s*(,\s*i\s*)?)?$`);

function parseTagFilter(body) {
  const m = body.match(TAG_RE);
  if (!m) throw new Error(`unsupported tag filter [${body}]`);
  const [, not, k, op, v, ci] = m;
  const key = unquote(k);
  if (not) return { key, op: 'absent' };
  if (!op) return { key, op: 'present' };
  const value = unquote(v);
  if (op === '~' || op === '!~') return { key, op, re: new RegExp(value, ci ? 'i' : '') };
  return { key, op, value };
}

function parseParenFilter(body) {
  const b = body.trim();
  let m;
  if ((m = b.match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)$/))) {
    const [s, w, n, e] = m.slice(1).map(Number);
    return { kind: 'bbox', s, w, n, e };
  }
  if ((m = b.match(/^around\.(\w+)\s*:\s*([\d.]+)$/))) return { kind: 'aroundSet', set: m[1], r: Number(m[2]) };
  if ((m = b.match(/^around\s*:\s*(.+)$/))) {
    const nums = m[1].split(',').map((x) => Number(x.trim()));
    if (nums.length < 3 || nums.length % 2 === 0 || nums.some((x) => !Number.isFinite(x))) throw new Error(`bad around filter (${b})`);
    const pts = [];
    for (let k = 1; k < nums.length; k += 2) pts.push([nums[k], nums[k + 1]]);
    return { kind: 'aroundPts', r: nums[0], pts };
  }
  if ((m = b.match(/^(bw|bn|r|w)(?:\.(\w+))?$/))) return { kind: m[1], set: m[2] ?? '_' };
  if ((m = b.match(/^(?:id\s*:\s*)?([\d,\s]+)$/))) return { kind: 'ids', ids: m[1].split(',').map((x) => Number(x.trim())) };
  throw new Error(`unsupported filter (${b})`);
}

function parseStatement(stmt) {
  let s = stmt.trim();
  if (s.startsWith('[')) return { kind: 'settings' };
  let m;
  if ((m = s.match(/^(?:\.(\w+)\s+)?out\b(.*)$/s))) {
    const words = m[2].trim().split(/\s+/).filter(Boolean);
    for (const w of words) if (!['body', 'meta', 'geom', 'skel', 'ids', 'tags', 'asc', 'noids'].includes(w)) throw new Error(`unsupported out mode '${w}'`);
    return { kind: 'out', set: m[1] ?? '_', geom: words.includes('geom'), mode: words.find((w) => ['skel', 'ids', 'tags'].includes(w)) ?? 'body' };
  }
  let to = '_';
  const arrow = s.match(/->\s*\.(\w+)\s*$/);
  if (arrow) {
    to = arrow[1];
    s = s.slice(0, arrow.index).trim();
  }
  if (s.startsWith('(')) {
    const end = closing(s, 0);
    if (s.slice(end + 1).trim()) throw new Error(`unsupported statement: ${stmt}`);
    return { kind: 'union', to, body: splitTop(s.slice(1, end), ';').map(parseStatement) };
  }
  if ((m = s.match(/^(node|way|relation|rel|nwr)(?:\.(\w+))?/))) {
    const type = m[1] === 'rel' ? 'relation' : m[1];
    const q = { kind: 'query', to, type, input: m[2] ?? null, tags: [], spatial: [] };
    let p = m[0].length;
    while (p < s.length) {
      if (/\s/.test(s[p])) {
        p++;
        continue;
      }
      if (s[p] !== '[' && s[p] !== '(') throw new Error(`unsupported query syntax at '${s.slice(p)}'`);
      const end = closing(s, p);
      const body = s.slice(p + 1, end);
      if (s[p] === '[') q.tags.push(parseTagFilter(body));
      else q.spatial.push(parseParenFilter(body));
      p = end + 1;
    }
    return q;
  }
  if ((m = s.match(/^\.(\w+)$/))) return { kind: 'copy', from: m[1], to };
  throw new Error(`unsupported statement: ${stmt}`);
}

export function parseQL(ql) {
  return splitTop(ql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''), ';').map(parseStatement);
}

/* ---------------------------------------------------------------- geometry helpers */

const E7 = 1e-7;
const R_EARTH = 6_371_000;
const DEG = Math.PI / 180;

/** Segment [a, b] against rectangle (all in e7 ints / plain numbers). */
function segHitsBox(ax, ay, bx, by, x0, y0, x1, y1) {
  if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) return false;
  if ((ax >= x0 && ax <= x1 && ay >= y0 && ay <= y1) || (bx >= x0 && bx <= x1 && by >= y0 && by <= y1)) return true;
  // Liang-Barsky clip
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const edges = [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ];
  for (const [pp, qq] of edges) {
    if (pp === 0) {
      if (qq < 0) return false;
    } else {
      const t = qq / pp;
      if (pp < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

function ptSegDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return x * x + y * y;
}

function segsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const o1 = o(ax, ay, bx, by, cx, cy);
  const o2 = o(ax, ay, bx, by, dx, dy);
  const o3 = o(cx, cy, dx, dy, ax, ay);
  const o4 = o(cx, cy, dx, dy, bx, by);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

function segSegDist2(ax, ay, bx, by, cx, cy, dx, dy) {
  if (segsCross(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(ptSegDist2(ax, ay, cx, cy, dx, dy), ptSegDist2(bx, by, cx, cy, dx, dy), ptSegDist2(cx, cy, ax, ay, bx, by), ptSegDist2(dx, dy, ax, ay, bx, by));
}

/**
 * Distance target for around filters: segments (a point is a zero-length segment) in local metres on a grid.
 * Projection: equirectangular about the targets' mean latitude.
 */
class AroundTarget {
  constructor(segs, r) {
    this.r = r;
    let latSum = 0;
    for (const s of segs) latSum += s[0] + s[2];
    this.lat0 = segs.length ? latSum / (2 * segs.length) : 0;
    this.kx = R_EARTH * DEG * Math.cos(this.lat0 * DEG);
    this.ky = R_EARTH * DEG;
    this.cell = Math.max(2 * r, 100);
    this.grid = new Map();
    this.box = [Infinity, Infinity, -Infinity, -Infinity];
    this.segs = segs.map(([la, lo, lb, lob]) => {
      const q = [lo * this.kx, la * this.ky, lob * this.kx, lb * this.ky];
      this.box = [Math.min(this.box[0], la, lb), Math.min(this.box[1], lo, lob), Math.max(this.box[2], la, lb), Math.max(this.box[3], lo, lob)];
      return q;
    });
    this.segs.forEach((q, i) => {
      const [x0, y0, x1, y1] = [Math.min(q[0], q[2]) - r, Math.min(q[1], q[3]) - r, Math.max(q[0], q[2]) + r, Math.max(q[1], q[3]) + r];
      for (let gy = Math.floor(y0 / this.cell); gy <= Math.floor(y1 / this.cell); gy++) {
        for (let gx = Math.floor(x0 / this.cell); gx <= Math.floor(x1 / this.cell); gx++) {
          const key = gx * 1e6 + gy;
          const list = this.grid.get(key);
          if (list) list.push(i);
          else this.grid.set(key, [i]);
        }
      }
    });
    const dLat = r / this.ky;
    const dLon = r / this.kx;
    this.degBox = [this.box[0] - dLat, this.box[1] - dLon, this.box[2] + dLat, this.box[3] + dLon];
  }
  /** Coarse reject of a lat/lon box (degrees). */
  mayHit(s, w, n, e) {
    const b = this.degBox;
    return !(n < b[0] || s > b[2] || e < b[1] || w > b[3]);
  }
  /** Is the segment (lat/lon degrees) within r of any target segment? */
  hitSeg(la, lo, lb, lob) {
    const ax = lo * this.kx;
    const ay = la * this.ky;
    const bx = lob * this.kx;
    const by = lb * this.ky;
    const r2 = this.r * this.r;
    const seen = new Set();
    for (let gy = Math.floor(Math.min(ay, by) / this.cell); gy <= Math.floor(Math.max(ay, by) / this.cell); gy++) {
      for (let gx = Math.floor(Math.min(ax, bx) / this.cell); gx <= Math.floor(Math.max(ax, bx) / this.cell); gx++) {
        for (const i of this.grid.get(gx * 1e6 + gy) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const q = this.segs[i];
          if (segSegDist2(ax, ay, bx, by, q[0], q[1], q[2], q[3]) <= r2) return true;
        }
      }
    }
    return false;
  }
}

/* ---------------------------------------------------------------- evaluation */

const emptySet = () => ({ node: [], way: [], relation: [] });

function unionSets(sets) {
  const out = emptySet();
  for (const t of ['node', 'way', 'relation']) {
    const s = new Set();
    for (const x of sets) for (const i of x[t]) s.add(i);
    out[t] = [...s].sort((a, b) => a - b);
  }
  return out;
}

/** Runs parsed statements against `idx`; returns the Overpass JSON answer. */
export function runQL(idx, ql) {
  const stmts = typeof ql === 'string' ? parseQL(ql) : ql;
  const sets = new Map([['_', emptySet()]]);
  const elements = [];
  const getSet = (name) => {
    const s = sets.get(name);
    if (!s) throw new Error(`set .${name} is not defined`);
    return s;
  };
  const exec = (st) => {
    if (st.kind === 'settings') return null;
    if (st.kind === 'out') {
      const s = getSet(st.set);
      for (const i of s.node) elements.push(nodeJson(idx, i, st));
      for (const i of s.way) elements.push(wayJson(idx, i, st));
      for (const i of s.relation) elements.push(relJson(idx, i, st));
      return null;
    }
    let res;
    if (st.kind === 'union') res = unionSets(st.body.map(exec).filter(Boolean));
    else if (st.kind === 'copy') res = getSet(st.from);
    else res = query(idx, st, getSet);
    sets.set(st.to, res);
    return res;
  };
  for (const st of stmts) exec(st);
  return {
    version: 0.6,
    generator: `seventeen-skies local OSM index (${idx.meta.source})`,
    osm3s: {
      timestamp_osm_base: idx.meta.osmBase,
      copyright: 'The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.',
    },
    elements,
  };
}

function tagMatcher(idx, filters) {
  const compiled = filters.map((f) => ({ ...f, k: idx.str(f.key), v: f.value !== undefined ? idx.str(f.value) : -1 }));
  return (kv, s, e) => {
    for (const f of compiled) {
      let val = -1;
      if (f.k >= 0) {
        for (let j = s; j < e; j++) {
          if (kv[2 * j] === f.k) {
            val = kv[2 * j + 1];
            break;
          }
        }
      }
      switch (f.op) {
        case 'present':
          if (val < 0) return false;
          break;
        case 'absent':
          if (val >= 0) return false;
          break;
        case '=':
          if (val < 0 || val !== f.v) return false;
          break;
        case '!=':
          if (val >= 0 && val === f.v) return false;
          break;
        case '~':
          if (val < 0 || !f.re.test(idx.strings[val])) return false;
          break;
        case '!~':
          if (val >= 0 && f.re.test(idx.strings[val])) return false;
          break;
      }
    }
    return true;
  };
}

/** Way i in the bbox (e7 ints): a node inside or a segment crossing. */
function wayInBox(idx, i, b) {
  const o = i * 4;
  if (idx.wayBox[o + 2] < b[0] || idx.wayBox[o] > b[2] || idx.wayBox[o + 3] < b[1] || idx.wayBox[o + 1] > b[3]) return false;
  const s = idx.wayRefStart[i];
  const e = idx.wayRefStart[i + 1];
  let px = null;
  let py = null;
  for (let j = s; j < e; j++) {
    const k = idx.wayRef[j];
    if (k < 0) {
      px = null;
      continue;
    }
    const y = idx.nodeLat[k];
    const x = idx.nodeLon[k];
    if (y >= b[0] && y <= b[2] && x >= b[1] && x <= b[3]) return true;
    if (px !== null && segHitsBox(px, py, x, y, b[1], b[0], b[3], b[2])) return true;
    px = x;
    py = y;
  }
  return false;
}

function nodeInBox(idx, k, b) {
  const y = idx.nodeLat[k];
  const x = idx.nodeLon[k];
  return y >= b[0] && y <= b[2] && x >= b[1] && x <= b[3];
}

function nodeNearTarget(idx, k, t) {
  const la = idx.nodeLat[k] * E7;
  const lo = idx.nodeLon[k] * E7;
  return t.mayHit(la, lo, la, lo) && t.hitSeg(la, lo, la, lo);
}

function wayNearTarget(idx, i, t) {
  const o = i * 4;
  if (!t.mayHit(idx.wayBox[o] * E7, idx.wayBox[o + 1] * E7, idx.wayBox[o + 2] * E7, idx.wayBox[o + 3] * E7)) return false;
  const s = idx.wayRefStart[i];
  const e = idx.wayRefStart[i + 1];
  let prev = -1;
  for (let j = s; j < e; j++) {
    const k = idx.wayRef[j];
    if (k < 0) {
      prev = -1;
      continue;
    }
    const la = idx.nodeLat[k] * E7;
    const lo = idx.nodeLon[k] * E7;
    if (e - s === 1 && t.hitSeg(la, lo, la, lo)) return true;
    if (prev >= 0 && t.hitSeg(idx.nodeLat[prev] * E7, idx.nodeLon[prev] * E7, la, lo)) return true;
    prev = k;
  }
  return false;
}

function relMembersMatch(idx, i, nodeTest, wayTest) {
  for (let j = idx.relMemStart[i]; j < idx.relMemStart[i + 1]; j++) {
    const t = idx.relMemType[j];
    if (t === 0) {
      const k = idx.nodeIndex(idx.relMemRef[j]);
      if (k >= 0 && nodeTest(k)) return true;
    } else if (t === 1) {
      const w = idx.wayIndex(idx.relMemRef[j]);
      if (w >= 0 && wayTest(w)) return true;
    }
  }
  return false;
}

/** Segments (lat/lon degrees) of a set's elements, for around.set. */
function setSegments(idx, set) {
  const segs = [];
  const nodeSeg = (k) => {
    const la = idx.nodeLat[k] * E7;
    const lo = idx.nodeLon[k] * E7;
    segs.push([la, lo, la, lo]);
  };
  const waySegs = (w) => {
    const s = idx.wayRefStart[w];
    const e = idx.wayRefStart[w + 1];
    let prev = -1;
    for (let j = s; j < e; j++) {
      const k = idx.wayRef[j];
      if (k < 0) {
        prev = -1;
        continue;
      }
      if (e - s === 1) nodeSeg(k);
      if (prev >= 0) segs.push([idx.nodeLat[prev] * E7, idx.nodeLon[prev] * E7, idx.nodeLat[k] * E7, idx.nodeLon[k] * E7]);
      prev = k;
    }
  };
  for (const k of set.node) nodeSeg(k);
  for (const w of set.way) waySegs(w);
  for (const r of set.relation) {
    for (let j = idx.relMemStart[r]; j < idx.relMemStart[r + 1]; j++) {
      if (idx.relMemType[j] === 0) {
        const k = idx.nodeIndex(idx.relMemRef[j]);
        if (k >= 0) nodeSeg(k);
      } else if (idx.relMemType[j] === 1) {
        const w = idx.wayIndex(idx.relMemRef[j]);
        if (w >= 0) waySegs(w);
      }
    }
  }
  return segs;
}

function query(idx, st, getSet) {
  const types = st.type === 'nwr' ? ['node', 'way', 'relation'] : [st.type];
  const tagOk = tagMatcher(idx, st.tags);
  const input = st.input ? getSet(st.input) : null;
  const e7 = (v) => Math.round(v * 1e7);
  const tests = { node: [], way: [], relation: [] };
  /** Cheap rejects run before the tag filters (way bbox against the query box). */
  const pre = { node: [], way: [] };
  /** Candidate restriction from membership filters (bw / bn / r / w) and ids. */
  const restrict = { node: null, way: null, relation: null };
  const restrictTo = (type, list) => {
    const s = new Set(list);
    restrict[type] = restrict[type] ? new Set([...restrict[type]].filter((x) => s.has(x))) : s;
  };
  for (const f of st.spatial) {
    if (f.kind === 'bbox') {
      const b = [e7(f.s), e7(f.w), e7(f.n), e7(f.e)];
      pre.way.push((w) => {
        const o = w * 4;
        return !(idx.wayBox[o + 2] < b[0] || idx.wayBox[o] > b[2] || idx.wayBox[o + 3] < b[1] || idx.wayBox[o + 1] > b[3]);
      });
      tests.node.push((k) => nodeInBox(idx, k, b));
      tests.way.push((w) => wayInBox(idx, w, b));
      tests.relation.push((r) =>
        relMembersMatch(
          idx,
          r,
          (k) => nodeInBox(idx, k, b),
          (w) => wayInBox(idx, w, b),
        ),
      );
    } else if (f.kind === 'aroundSet' || f.kind === 'aroundPts') {
      let segs;
      if (f.kind === 'aroundSet') segs = setSegments(idx, getSet(f.set));
      else {
        segs = [];
        if (f.pts.length === 1) segs.push([f.pts[0][0], f.pts[0][1], f.pts[0][0], f.pts[0][1]]);
        for (let k = 1; k < f.pts.length; k++) segs.push([f.pts[k - 1][0], f.pts[k - 1][1], f.pts[k][0], f.pts[k][1]]);
      }
      if (!segs.length) {
        for (const t of types) tests[t].push(() => false);
        continue;
      }
      const target = new AroundTarget(segs, f.r);
      pre.way.push((w) => {
        const o = w * 4;
        return target.mayHit(idx.wayBox[o] * E7, idx.wayBox[o + 1] * E7, idx.wayBox[o + 2] * E7, idx.wayBox[o + 3] * E7);
      });
      tests.node.push((k) => nodeNearTarget(idx, k, target));
      tests.way.push((w) => wayNearTarget(idx, w, target));
      tests.relation.push((r) =>
        relMembersMatch(
          idx,
          r,
          (k) => nodeNearTarget(idx, k, target),
          (w) => wayNearTarget(idx, w, target),
        ),
      );
    } else if (f.kind === 'bn' && st.type === 'way') {
      const nodes = new Set(getSet(f.set).node);
      const list = [];
      for (let w = 0; w < idx.nWays; w++) {
        for (let j = idx.wayRefStart[w]; j < idx.wayRefStart[w + 1]; j++) {
          if (nodes.has(idx.wayRef[j])) {
            list.push(w);
            break;
          }
        }
      }
      restrictTo('way', list);
    } else if (f.kind === 'bw' || f.kind === 'bn') {
      if (st.type !== 'relation') throw new Error(`(${f.kind}) is only supported on relations and way(bn)`);
      const src = getSet(f.set);
      const ids = new Set((f.kind === 'bw' ? src.way : src.node).map((i) => (f.kind === 'bw' ? idx.wayId[i] : idx.nodeId[i])));
      const want = f.kind === 'bw' ? 1 : 0;
      const list = [];
      for (let r = 0; r < idx.nRels; r++) {
        for (let j = idx.relMemStart[r]; j < idx.relMemStart[r + 1]; j++) {
          if (idx.relMemType[j] === want && ids.has(idx.relMemRef[j])) {
            list.push(r);
            break;
          }
        }
      }
      restrictTo('relation', list);
    } else if (f.kind === 'r') {
      const src = getSet(f.set);
      const out = [];
      const want = st.type === 'node' ? 0 : st.type === 'way' ? 1 : 2;
      for (const r of src.relation) {
        for (let j = idx.relMemStart[r]; j < idx.relMemStart[r + 1]; j++) {
          if (idx.relMemType[j] !== want) continue;
          const i = want === 0 ? idx.nodeIndex(idx.relMemRef[j]) : want === 1 ? idx.wayIndex(idx.relMemRef[j]) : idx.relIndex(idx.relMemRef[j]);
          if (i >= 0) out.push(i);
        }
      }
      restrictTo(st.type, out);
    } else if (f.kind === 'w') {
      if (st.type !== 'node') throw new Error('(w) is only supported on nodes');
      const out = [];
      for (const w of getSet(f.set).way) for (let j = idx.wayRefStart[w]; j < idx.wayRefStart[w + 1]; j++) if (idx.wayRef[j] >= 0) out.push(idx.wayRef[j]);
      restrictTo('node', out);
    } else if (f.kind === 'ids') {
      for (const t of types) {
        const find = t === 'node' ? (id) => idx.nodeIndex(id) : t === 'way' ? (id) => idx.wayIndex(id) : (id) => idx.relIndex(id);
        restrictTo(
          t,
          f.ids.map(find).filter((i) => i >= 0),
        );
      }
    }
  }
  const res = emptySet();
  for (const t of types) {
    let cand;
    if (restrict[t]) cand = [...restrict[t]].sort((a, b) => a - b);
    else if (input) cand = input[t];
    else cand = null;
    if (input && restrict[t]) {
      const s = new Set(input[t]);
      cand = cand.filter((i) => s.has(i));
    }
    const pass = (i) => {
      for (const test of tests[t]) if (!test(i)) return false;
      return true;
    };
    const out = [];
    if (t === 'node') {
      if (!cand && st.tags.length && st.tags.some((f) => f.op !== 'absent' && f.op !== '!=' && f.op !== '!~')) {
        // Only tagged nodes can match a positive tag filter.
        for (let j = 0; j < idx.tnIdx.length; j++) {
          if (tagOk(idx.tnTagKv, idx.tnTagStart[j], idx.tnTagStart[j + 1]) && pass(idx.tnIdx[j])) out.push(idx.tnIdx[j]);
        }
      } else {
        if (!cand && !st.spatial.length) throw new Error('refusing an unbounded node query');
        const n = cand ? cand.length : idx.nNodes;
        for (let c = 0; c < n; c++) {
          const i = cand ? cand[c] : c;
          const tr = idx.nodeTagRange(i);
          if ((tr ? tagOk(idx.tnTagKv, tr[0], tr[1]) : tagOk(idx.tnTagKv, 0, 0)) && pass(i)) out.push(i);
        }
      }
    } else {
      const start = t === 'way' ? idx.wayTagStart : idx.relTagStart;
      const kv = t === 'way' ? idx.wayTagKv : idx.relTagKv;
      const n = cand ? cand.length : t === 'way' ? idx.nWays : idx.nRels;
      const quick = t === 'way' ? pre.way : [];
      scan: for (let c = 0; c < n; c++) {
        const i = cand ? cand[c] : c;
        for (const q of quick) if (!q(i)) continue scan;
        if (tagOk(kv, start[i], start[i + 1]) && pass(i)) out.push(i);
      }
    }
    res[t] = out;
  }
  return res;
}

/* ---------------------------------------------------------------- JSON output */

const fix7 = (v) => Number((v * E7).toFixed(7));

function nodeJson(idx, k, st) {
  const el = { type: 'node', id: idx.nodeId[k] };
  if (st.mode === 'ids') return el;
  if (st.mode !== 'tags') {
    el.lat = fix7(idx.nodeLat[k]);
    el.lon = fix7(idx.nodeLon[k]);
  }
  if (st.mode !== 'skel') {
    const tr = idx.nodeTagRange(k);
    if (tr && tr[1] > tr[0]) el.tags = idx.tagsObject(idx.tnTagKv, tr[0], tr[1]);
  }
  return el;
}

function wayGeometry(idx, w) {
  const geometry = [];
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let j = idx.wayRefStart[w]; j < idx.wayRefStart[w + 1]; j++) {
    const k = idx.wayRef[j];
    if (k < 0) {
      geometry.push(null);
      continue;
    }
    const lat = idx.nodeLat[k];
    const lon = idx.nodeLon[k];
    geometry.push({ lat: fix7(lat), lon: fix7(lon) });
    box[0] = Math.min(box[0], lat);
    box[1] = Math.min(box[1], lon);
    box[2] = Math.max(box[2], lat);
    box[3] = Math.max(box[3], lon);
  }
  return { geometry, box };
}

const boundsOf = (box) => ({ minlat: fix7(box[0]), minlon: fix7(box[1]), maxlat: fix7(box[2]), maxlon: fix7(box[3]) });

function wayNodeIds(idx, w) {
  const ids = [];
  for (let j = idx.wayRefStart[w]; j < idx.wayRefStart[w + 1]; j++) {
    const k = idx.wayRef[j];
    ids.push(k >= 0 ? idx.nodeId[k] : idx.missingRefId[-2 - k]);
  }
  return ids;
}

function wayJson(idx, w, st) {
  const el = { type: 'way', id: idx.wayId[w] };
  if (st.mode === 'ids') return el;
  let g = null;
  if (st.geom && st.mode !== 'tags') {
    g = wayGeometry(idx, w);
    if (Number.isFinite(g.box[0])) el.bounds = boundsOf(g.box);
  }
  if (st.mode !== 'tags') el.nodes = wayNodeIds(idx, w);
  if (g) el.geometry = g.geometry;
  if (st.mode !== 'skel') {
    const s = idx.wayTagStart[w];
    const e = idx.wayTagStart[w + 1];
    if (e > s) el.tags = idx.tagsObject(idx.wayTagKv, s, e);
  }
  return el;
}

const MEMBER_TYPES = ['node', 'way', 'relation'];

function relJson(idx, r, st) {
  const el = { type: 'relation', id: idx.relId[r] };
  if (st.mode === 'ids') return el;
  if (st.mode !== 'tags') {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = (lat, lon) => {
      box[0] = Math.min(box[0], lat);
      box[1] = Math.min(box[1], lon);
      box[2] = Math.max(box[2], lat);
      box[3] = Math.max(box[3], lon);
    };
    const members = [];
    for (let j = idx.relMemStart[r]; j < idx.relMemStart[r + 1]; j++) {
      const type = MEMBER_TYPES[idx.relMemType[j]];
      const m = { type, ref: idx.relMemRef[j], role: idx.strings[idx.relMemRole[j]] };
      if (st.geom && type === 'node') {
        const k = idx.nodeIndex(m.ref);
        if (k >= 0) {
          m.lat = fix7(idx.nodeLat[k]);
          m.lon = fix7(idx.nodeLon[k]);
          grow(idx.nodeLat[k], idx.nodeLon[k]);
        }
      } else if (st.geom && type === 'way') {
        const w = idx.wayIndex(m.ref);
        if (w >= 0) {
          const g = wayGeometry(idx, w);
          m.geometry = g.geometry;
          if (Number.isFinite(g.box[0])) {
            grow(g.box[0], g.box[1]);
            grow(g.box[2], g.box[3]);
          }
        }
      }
      members.push(m);
    }
    if (st.geom && Number.isFinite(box[0])) el.bounds = boundsOf(box);
    el.members = members;
  }
  if (st.mode !== 'skel') {
    const s = idx.relTagStart[r];
    const e = idx.relTagStart[r + 1];
    if (e > s) el.tags = idx.tagsObject(idx.relTagKv, s, e);
  }
  return el;
}

/** Overpass-compatible answer for `ql` from the local index. */
export function overpassLocal(ql, path = INDEX_FILE) {
  return runQL(openIndex(path), ql);
}

/** Value of `--source` (default 'local'): 'local' | 'overpass'. */
export function sourceArg(args) {
  const i = args.indexOf('--source');
  const v = i >= 0 ? args[i + 1] : 'local';
  if (v !== 'local' && v !== 'overpass') throw new Error(`--source must be 'local' or 'overpass', got '${v}'`);
  return v;
}
