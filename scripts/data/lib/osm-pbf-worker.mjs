/**
 * Worker of the local OSM index builder (osm-local.mjs buildIndex): decodes OSM PBF primitive blobs from the shared
 * file buffer and returns only what the current phase asks for. Phases:
 * - 'scan':  node blobs -> nodes inside the reserve bbox (coords; tags only inside the clip bbox); relation blobs ->
 *            every relation; way blobs -> only their kind.
 * - 'ways':  way blobs -> ways with at least one node inside the clip (clip node ids + bitset prefilter).
 * - 'wantw': way blobs -> ways whose id is in a wanted list (multipolygon members outside the clip).
 * - 'wantn': node blobs -> nodes whose id is in a wanted list (way / member nodes outside the reserve bbox).
 */
import { parentPort, workerData } from 'node:worker_threads';
import { inflateSync } from 'node:zlib';
import { readOsmPrimitiveBlock } from '@osmix/pbf';

const file = new Uint8Array(workerData.file);
const td = new TextDecoder();
const inflate = async (d) => inflateSync(d);
let setup = {};

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

/** zlib payload (or raw bytes) of the Blob message at [start, end). */
function blobPayload(start, end) {
  const pos = { p: start };
  let raw = null;
  let zlib = null;
  let rawSize;
  while (pos.p < end) {
    const tag = varint(file, pos);
    const f = Math.floor(tag / 8);
    const wt = tag & 7;
    if (wt === 0) {
      const v = varint(file, pos);
      if (f === 2) rawSize = v;
    } else if (wt === 2) {
      const len = varint(file, pos);
      const bytes = file.slice(pos.p, pos.p + len);
      pos.p += len;
      if (f === 1) raw = bytes;
      else if (f === 3) zlib = bytes;
      else if (f === 4 || f === 5 || f === 6 || f === 7) throw new Error('unsupported PBF blob compression (only zlib / raw)');
    } else if (wt === 1) pos.p += 8;
    else if (wt === 5) pos.p += 4;
    else throw new Error(`bad wire type ${wt}`);
  }
  return raw ? { raw } : { zlib, rawSize };
}

async function decode(start, end) {
  const p = blobPayload(start, end);
  if (p.raw) return readOsmPrimitiveBlock({ data: p.raw }, async (d) => d);
  return readOsmPrimitiveBlock({ data: p.zlib, rawSize: p.rawSize }, inflate);
}

/** Binary search in a sorted Float64Array. */
function has(arr, v) {
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

const BITS = 2 ** 30;
const inClipNode = (id) => {
  const b = id % BITS;
  return (setup.bits[b >>> 5] & (1 << (b & 31))) !== 0 && has(setup.clipIds, id);
};

function blockKind(block) {
  for (const g of block.primitivegroup) {
    if (g.dense?.id.length || g.nodes.length) return 'n';
    if (g.ways.length) return 'w';
    if (g.relations.length) return 'r';
  }
  return '-';
}

/** Iterates the nodes of a block: cb(id, lat1e7, lon1e7, kv|null). */
function eachNode(block, str, cb, wantTags) {
  const gran = block.granularity ?? 100;
  const latOff = block.lat_offset ?? 0;
  const lonOff = block.lon_offset ?? 0;
  const conv = (off, v) => Math.round((off + gran * v) / 100);
  for (const g of block.primitivegroup) {
    const d = g.dense;
    if (d?.id.length) {
      let id = 0;
      let lat = 0;
      let lon = 0;
      let k = 0;
      const kvs = d.keys_vals;
      for (let i = 0; i < d.id.length; i++) {
        id += d.id[i];
        lat += d.lat[i];
        lon += d.lon[i];
        let kv = null;
        if (kvs.length) {
          const s = k;
          while (kvs[k] !== 0) k += 2;
          if (k > s && wantTags) {
            kv = [];
            for (let j = s; j < k; j += 2) kv.push(str(kvs[j]), str(kvs[j + 1]));
          }
          k++;
        }
        cb(id, conv(latOff, lat), conv(lonOff, lon), kv);
      }
    }
    for (const n of g.nodes) {
      let kv = null;
      if (n.keys.length && wantTags) {
        kv = [];
        for (let j = 0; j < n.keys.length; j++) kv.push(str(n.keys[j]), str(n.vals[j]));
      }
      cb(n.id, conv(latOff, n.lat), conv(lonOff, n.lon), kv);
    }
  }
}

function wayRecord(w, str) {
  const refs = new Float64Array(w.refs.length);
  let r = 0;
  for (let j = 0; j < w.refs.length; j++) refs[j] = r += w.refs[j];
  const kv = [];
  for (let j = 0; j < w.keys.length; j++) kv.push(str(w.keys[j]), str(w.vals[j]));
  return { id: w.id, refs, kv };
}

async function handle(start, end) {
  const block = await decode(start, end);
  const table = block.stringtable;
  const cache = new Array(table.length);
  const str = (i) => (cache[i] ??= td.decode(table[i]));
  const kind = blockKind(block);
  const { phase } = setup;
  if (phase === 'scan') {
    if (kind === 'n') {
      const [cs, cw, cn, ce] = setup.clip;
      const [rs, rw, rn, re] = setup.reserve;
      const ids = [];
      const lats = [];
      const lons = [];
      const clip = [];
      const tags = [];
      eachNode(
        block,
        str,
        (id, lat, lon, kv) => {
          if (lat < rs || lat > rn || lon < rw || lon > re) return;
          const c = lat >= cs && lat <= cn && lon >= cw && lon <= ce;
          if (c && kv) tags.push(ids.length, kv);
          ids.push(id);
          lats.push(lat);
          lons.push(lon);
          clip.push(c ? 1 : 0);
        },
        true,
      );
      return { kind, ids: Float64Array.from(ids), lat: Int32Array.from(lats), lon: Int32Array.from(lons), clip: Uint8Array.from(clip), tags };
    }
    if (kind === 'r') {
      const rels = [];
      for (const g of block.primitivegroup) {
        for (const r of g.relations) {
          const kv = [];
          for (let j = 0; j < r.keys.length; j++) kv.push(str(r.keys[j]), str(r.vals[j]));
          const refs = new Float64Array(r.memids.length);
          let m = 0;
          for (let j = 0; j < r.memids.length; j++) refs[j] = m += r.memids[j];
          rels.push({ id: r.id, kv, types: Uint8Array.from(r.types), refs, roles: r.roles_sid.map(str) });
        }
      }
      return { kind, rels };
    }
    return { kind };
  }
  if (phase === 'ways' || phase === 'wantw') {
    const ways = [];
    for (const g of block.primitivegroup) {
      for (const w of g.ways) {
        if (phase === 'wantw') {
          if (has(setup.want, w.id)) ways.push(wayRecord(w, str));
          continue;
        }
        let r = 0;
        for (let j = 0; j < w.refs.length; j++) {
          r += w.refs[j];
          if (inClipNode(r)) {
            ways.push(wayRecord(w, str));
            break;
          }
        }
      }
    }
    return { kind, ways };
  }
  if (phase === 'wantn') {
    const ids = [];
    const lats = [];
    const lons = [];
    eachNode(
      block,
      str,
      (id, lat, lon) => {
        if (has(setup.want, id)) {
          ids.push(id);
          lats.push(lat);
          lons.push(lon);
        }
      },
      false,
    );
    return { kind, ids: Float64Array.from(ids), lat: Int32Array.from(lats), lon: Int32Array.from(lons) };
  }
  throw new Error(`unknown phase ${phase}`);
}

parentPort.on('message', async (msg) => {
  if (msg.setup) {
    setup = msg.setup;
    if (setup.clipIds) setup.clipIds = new Float64Array(setup.clipIds);
    if (setup.bits) setup.bits = new Int32Array(setup.bits);
    if (setup.want) setup.want = new Float64Array(setup.want);
    parentPort.postMessage({ ready: true });
    return;
  }
  try {
    const out = [];
    for (const [i, start, end] of msg.items) out.push({ i, ...(await handle(start, end)) });
    parentPort.postMessage({ out });
  } catch (e) {
    parentPort.postMessage({ error: String(e?.stack ?? e) });
  }
});
