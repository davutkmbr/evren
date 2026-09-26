/**
 * Façade module expansion off the main thread (expander.ts is the client): fetches a tile's slots file and the
 * module glbs its variants need (cached for the session; the catalog once per URL), expands them (expand.ts) and
 * returns the merged parts per material ready for the draw batches: int16 normalized positions with their
 * quantization box, int16 normals, uint8 RGBA colours, float UV0 and indices, all transferred.
 *
 * In: `{ id, slots, catalog, tiling, district, colors, origin }` (absolute URLs). Out: `{ id, parts, stats }` or
 * `{ id, error }`.
 */
import { inflate } from '../format';
import { expandSlots, type ExpandedPart, filesFor, type ModuleGlb, parseModuleGlb } from './expand';
import { decodeSlots, type ModuleCatalog } from './format';

export interface ExpandRequest {
  id: number;
  slots: string;
  catalog: string;
  tiling: Record<string, [number, number]>;
  district: string | null;
  colors: Record<string, string[]>;
  origin: [number, number];
}

export interface PackedPart {
  material: string;
  position: Int16Array;
  /** Quantization: centre (x, y, z) and half extent; position = centre + q / 32767 * half. */
  quant: [number, number, number, number];
  normal: Int16Array;
  color: Uint8Array;
  uv: Float32Array | null;
  index: Uint16Array | Uint32Array;
}

export interface ExpandReply {
  id: number;
  parts?: PackedPart[];
  stats?: { slots: number; placed: number; unmatched: number; vertices: number; triangles: number; expandMs: number; totalMs: number; wireBytes: number; libWireBytes: number };
  error?: string;
}

const catalogs = new Map<string, Promise<ModuleCatalog>>();
const glbs = new Map<string, Promise<ModuleGlb>>();
/** Bytes of library files (catalog, module glbs) fetched since the last reply. */
let libWire = 0;

async function fetchBytes(url: string): Promise<{ bytes: ArrayBuffer; wire: number }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  const wire = await res.arrayBuffer();
  return { bytes: await inflate(wire), wire: wire.byteLength };
}

function catalog(url: string): Promise<ModuleCatalog> {
  let p = catalogs.get(url);
  if (!p) {
    p = fetchBytes(url).then(({ bytes, wire }) => {
      libWire += wire;
      return JSON.parse(new TextDecoder().decode(bytes)) as ModuleCatalog;
    });
    p.catch(() => catalogs.delete(url));
    catalogs.set(url, p);
  }
  return p;
}

function glb(url: string): Promise<ModuleGlb> {
  let p = glbs.get(url);
  if (!p) {
    p = fetchBytes(url).then(({ bytes, wire }) => {
      libWire += wire;
      return parseModuleGlb(bytes);
    });
    p.catch(() => glbs.delete(url));
    glbs.set(url, p);
  }
  return p;
}

function pack(p: ExpandedPart): PackedPart {
  const P = p.position;
  const n = P.length / 3;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = P[i * 3 + c];
      if (v < lo[c]) {
        lo[c] = v;
      }
      if (v > hi[c]) {
        hi[c] = v;
      }
    }
  }
  const cx = (lo[0] + hi[0]) / 2;
  const cy = (lo[1] + hi[1]) / 2;
  const cz = (lo[2] + hi[2]) / 2;
  const h = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-3) / 2;
  const k = 32767 / h;
  const pos = new Int16Array(n * 3);
  const nor = new Int16Array(n * 3);
  const col = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = Math.round((P[i * 3] - cx) * k);
    pos[i * 3 + 1] = Math.round((P[i * 3 + 1] - cy) * k);
    pos[i * 3 + 2] = Math.round((P[i * 3 + 2] - cz) * k);
    nor[i * 3] = Math.round(p.normal[i * 3] * 32767);
    nor[i * 3 + 1] = Math.round(p.normal[i * 3 + 1] * 32767);
    nor[i * 3 + 2] = Math.round(p.normal[i * 3 + 2] * 32767);
    for (let c = 0; c < 4; c++) {
      const v = p.color[i * 4 + c];
      col[i * 4 + c] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
  }
  return { material: p.material, position: pos, quant: [cx, cy, cz, h], normal: nor, color: col, uv: p.uv, index: n <= 65535 ? Uint16Array.from(p.index) : p.index };
}

self.onmessage = async (e: MessageEvent<ExpandRequest>) => {
  const q = e.data;
  const t0 = performance.now();
  try {
    const [cat, slots] = await Promise.all([catalog(q.catalog), fetchBytes(q.slots)]);
    const s = decodeSlots(slots.bytes);
    const loaded = new Map<string, ModuleGlb>();
    await Promise.all(
      [...filesFor({ catalog: cat }, s, q.district)].map(async (f) => {
        const rec = cat.files[f];
        loaded.set(f, await glb(`${new URL(f, q.catalog).href}${rec?.gz ? '.gz' : ''}?v=${rec?.hash ?? ''}`));
      }),
    );
    const t1 = performance.now();
    const { parts, stats } = expandSlots({ catalog: cat, mesh: (file, name) => loaded.get(file)?.get(name) }, s, { tiling: q.tiling, district: q.district, origin: q.origin, colors: q.colors });
    const packed = parts.map(pack);
    const t2 = performance.now();
    const transfer: ArrayBuffer[] = [];
    for (const p of packed) {
      transfer.push(p.position.buffer as ArrayBuffer, p.normal.buffer as ArrayBuffer, p.color.buffer as ArrayBuffer, p.index.buffer as ArrayBuffer);
      if (p.uv) {
        transfer.push(p.uv.buffer as ArrayBuffer);
      }
    }
    const reply: ExpandReply = {
      id: q.id,
      parts: packed,
      stats: { slots: stats.slots, placed: stats.placed, unmatched: stats.unmatched, vertices: stats.vertices, triangles: stats.triangles, expandMs: t2 - t1, totalMs: t2 - t0, wireBytes: slots.wire, libWireBytes: libWire },
    };
    libWire = 0;
    (self as unknown as Worker).postMessage(reply, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: q.id, error: String((err as Error)?.message ?? err) } satisfies ExpandReply);
  }
};
