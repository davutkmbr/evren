/**
 * The building merge's output (scripts/data/footprints-merge.ts), read by scripts/data/fetch-osm.mjs and the storey
 * fill (scripts/data/lib/levels-fill.mjs), so every layer takes the same added footprints, the same row lots and the
 * same storeys: data/footprints-src/merged/buildings.bin (gitignored, rebuilt from the pinned inputs).
 *
 * Container: 'EVFPMRG1', f64 header byte length, JSON header, zero padding to 8 bytes, then little-endian typed arrays
 * at the offsets the header lists. Records (added ML footprints and the lots of split outlines) are sorted by the
 * CELL m cell of their centroid on a grid over the OSM clip box (header.grid), so an area reads only its cells:
 * - cellStart (u32, cells + 1); id (f64); parent (f64: the split outline for lots, 0 for ML footprints);
 * - source (u8: 1 ml, 2 lot); kind (u8: index into header.kinds); quadkey (u8: index into header.quadkeys, 255 none);
 * - confidence (u8, ML confidence x 100, 255 unknown); cx, cz (f32 centroid); ringStart (u32, records + 1); xy (f32
 *   pairs, local metres, counter-clockwise rings).
 * Split outlines: splitIds (f64, sorted). Storeys: levelIds (f64, sorted: OSM ids, ML ids, lot ids), levels (u8),
 * levelsFrom (u8: 1 neighbours, 2 ibb, 3 ghs, 4 urban-atlas).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const MERGED_FILE = resolve(ROOT, 'data/footprints-src/merged/buildings.bin');
export const MERGE_FORMAT = 1;
const MAGIC = 'EVFPMRG1';
const TYPES = { f64: Float64Array, f32: Float32Array, u32: Uint32Array, u8: Uint8Array };
export const SOURCE_NAMES = ['', 'ml', 'lot'];
export const LEVELS_FROM = ['', 'neighbours', 'ibb', 'ghs', 'urban-atlas'];

const typeName = (a) => (a instanceof Float64Array ? 'f64' : a instanceof Float32Array ? 'f32' : a instanceof Uint32Array ? 'u32' : 'u8');

/** Writes a merge container (`header` JSON plus named typed arrays). */
export function writeMerged(file, header, arrays) {
  const layout = [];
  let offset = 0;
  for (const [name, a] of Object.entries(arrays)) {
    offset = Math.ceil(offset / 8) * 8;
    layout.push({ name, type: typeName(a), offset, length: a.length });
    offset += a.byteLength;
  }
  const head = Buffer.from(JSON.stringify({ ...header, format: MERGE_FORMAT, layout }));
  const base = Math.ceil((16 + head.length) / 8) * 8;
  const out = new Uint8Array(base + Math.ceil(offset / 8) * 8);
  out.set(Buffer.from(MAGIC, 'latin1'), 0);
  new DataView(out.buffer).setFloat64(8, head.length, true);
  out.set(head, 16);
  layout.forEach((l, k) => {
    const a = Object.values(arrays)[k];
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), base + l.offset);
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out);
  return out.length;
}

function lowerBound(arr, v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const opened = new Map();

/** The merge output, or null when it has not been built (data/footprints-src/ absent): callers keep OSM only. */
export function openMerged(file = MERGED_FILE) {
  if (opened.has(file)) {
    return opened.get(file);
  }
  if (!existsSync(file)) {
    opened.set(file, null);
    return null;
  }
  const buf = readFileSync(file);
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  if (Buffer.from(u8.subarray(0, 8)).toString('latin1') !== MAGIC) {
    throw new Error(`${file}: not a building merge file`);
  }
  const headLen = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getFloat64(8, true);
  const header = JSON.parse(Buffer.from(u8.subarray(16, 16 + headLen)).toString('utf8'));
  if (header.format !== MERGE_FORMAT) {
    throw new Error(`${file}: merge format ${header.format}, expected ${MERGE_FORMAT} (re-run scripts/data/footprints-merge.ts)`);
  }
  const base = Math.ceil((16 + headLen) / 8) * 8;
  const a = {};
  for (const l of header.layout) {
    const Ctor = TYPES[l.type];
    const at = u8.byteOffset + base + l.offset;
    a[l.name] = at % Ctor.BYTES_PER_ELEMENT === 0 ? new Ctor(u8.buffer, at, l.length) : new Ctor(u8.slice(base + l.offset, base + l.offset + l.length * Ctor.BYTES_PER_ELEMENT).buffer);
  }
  const g = header.grid;
  let lotsByParent = null;
  const record = (k) => {
    const ring = [];
    for (let v = a.ringStart[k]; v < a.ringStart[k + 1]; v++) {
      ring.push(Math.round(a.xy[v * 2] * 10) / 10, Math.round(a.xy[v * 2 + 1] * 10) / 10);
    }
    return {
      id: a.id[k],
      source: SOURCE_NAMES[a.source[k]],
      parent: a.parent[k] || undefined,
      kind: header.kinds[a.kind[k]],
      quadkey: a.quadkey[k] === 255 ? undefined : header.quadkeys[a.quadkey[k]],
      confidence: a.confidence[k] === 255 ? undefined : a.confidence[k] / 100,
      cx: a.cx[k],
      cz: a.cz[k],
      ring,
    };
  };
  const merged = {
    header,
    /** Stamp of this merge (layers built from one merge carry the same). */
    stamp: header.stamp,
    osmBase: header.osmBase,
    /** Added ML footprints whose centroid lies in the box (lots are taken through lotsOf). */
    *mlIn(minX, minZ, maxX, maxZ) {
      const i0 = Math.max(0, Math.floor((minX - g.x0) / g.cell));
      const i1 = Math.min(g.nx - 1, Math.floor((maxX - g.x0) / g.cell));
      const j0 = Math.max(0, Math.floor((minZ - g.z0) / g.cell));
      const j1 = Math.min(g.nz - 1, Math.floor((maxZ - g.z0) / g.cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = j * g.nx + i;
          for (let k = a.cellStart[c]; k < a.cellStart[c + 1]; k++) {
            if (a.source[k] === 1 && a.cx[k] >= minX && a.cx[k] < maxX && a.cz[k] >= minZ && a.cz[k] < maxZ) {
              yield record(k);
            }
          }
        }
      }
    },
    /** Whether the building with this id is split into row lots. */
    isSplit(id) {
      const k = lowerBound(a.splitIds, id);
      return k < a.splitIds.length && a.splitIds[k] === id;
    },
    /** Lots of a split outline, in lot order. */
    lotsOf(id) {
      if (!lotsByParent) {
        lotsByParent = new Map();
        for (let k = 0; k < a.id.length; k++) {
          if (a.source[k] === 2) {
            const list = lotsByParent.get(a.parent[k]) ?? [];
            list.push(k);
            lotsByParent.set(a.parent[k], list);
          }
        }
      }
      return (lotsByParent.get(id) ?? []).map(record);
    },
    /** Estimated storeys of a building by id: { levels, from } or null. */
    levelsOf(id) {
      const k = lowerBound(a.levelIds, id);
      return k < a.levelIds.length && a.levelIds[k] === id ? { levels: a.levels[k], from: LEVELS_FROM[a.levelsFrom[k]] } : null;
    },
  };
  opened.set(file, merged);
  return merged;
}
