/**
 * Façade module library exporter: authors every registered family's variants (spec.ts), measures how their
 * vertices move with the slot size, checks they stay linear over their fit range, and writes the shared library
 * `<world>/_shared/modules/` (catalog.json + one plain glb per family, src/street/modules/format.ts). The output is
 * deterministic and written only when it changed, so compiles of several areas (and parallel runs) agree on it.
 *
 * Families register here: add a FamilySpec list to FAMILIES. A new variant made elsewhere (Blender) needs no
 * compiler at all: a glb in the folder and an entry in the catalog (with `slice` instead of `_DW/_DH/_DD`).
 */
import { Document, NodeIO, VertexLayout } from '@gltf-transform/core';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { ModuleCatalog, ModuleFamily, ModuleVariant } from '../../../../src/street/modules/format';
import type { MaterialName } from '../materials';
import type { CapturedPrim } from './capture';
import { type AuthorCtx, capture, type FamilySpec, type VariantSpec } from './spec';

type AuthorFn = ((c: AuthorCtx) => void) | undefined;
import { BALCONY_FAMILIES } from './balcony';
import { SHOP_FAMILIES } from './shop';
import { SHOPFRONT_FAMILIES } from './shopfront';
import { TEXT_FAMILIES } from './text';
import { WALL_FAMILIES } from './wall';
import { WINDOW_FAMILIES } from './window';

/** Every module family the compiler authors. */
export const FAMILIES: readonly FamilySpec[] = [...WINDOW_FAMILIES, ...BALCONY_FAMILIES, ...TEXT_FAMILIES, ...SHOP_FAMILIES, ...SHOPFRONT_FAMILIES, ...WALL_FAMILIES];

const byName = new Map(FAMILIES.map((f) => [f.name, f]));

/** The family spec of `name` (throws for an unknown family: a slot must name a registered one). */
export function familySpec(name: string): FamilySpec {
  const f = byName.get(name);
  if (!f) {
    throw new Error(`unknown module family '${name}': register it in modules/library.ts FAMILIES`);
  }
  return f;
}

/** Library folder of a world output folder (the parent of the area folders). */
export const modulesDir = (worldDir: string): string => join(worldDir, '_shared', 'modules');

const DELTA = 0.01;
/** Largest deviation (m) of a vertex from its linear prediction at the corners of a variant's fit range. */
const LINEAR_TOL = 0.002;
const r5 = (v: number): number => Math.round(v * 1e5) / 1e5 || 0;
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 || 0;

interface Built {
  prims: CapturedPrim[];
  dw: number[][];
  dh: number[][];
  dd: number[][];
}

function sameTopology(a: CapturedPrim[], b: CapturedPrim[]): string | null {
  if (a.length !== b.length) {
    return `${a.length} vs ${b.length} primitives`;
  }
  for (let k = 0; k < a.length; k++) {
    if (a[k].material !== b[k].material || a[k].tint !== b[k].tint || a[k].moduleUv !== b[k].moduleUv) {
      return `primitive ${k}: ${a[k].material} vs ${b[k].material}`;
    }
    if (a[k].pos.length !== b[k].pos.length || a[k].idx.length !== b[k].idx.length || a[k].idx.some((v, i) => v !== b[k].idx[i])) {
      return `primitive ${k} (${a[k].material}): ${a[k].pos.length / 3}/${a[k].idx.length / 3} vs ${b[k].pos.length / 3}/${b[k].idx.length / 3} vertices/triangles`;
    }
  }
  return null;
}

/** Authors a variant (or one of its caps), derives _DW/_DH/_DD and checks linearity over its fit range. */
function build(fam: FamilySpec, v: VariantSpec, author: AuthorFn = v.author): Built {
  const [W, H, D] = v.ref;
  const base = capture(author, W, H, D).take();
  const deriv = (dw: number, dh: number, dd: number): number[][] => {
    const moved = capture(author, W + dw, H + dh, D + dd).take();
    const bad = sameTopology(base, moved);
    if (bad) {
      throw new Error(`module ${fam.name}/${v.id}: topology changes with the size (${bad}); split the variant's fit range`);
    }
    return base.map((p, k) => p.pos.map((x, i) => (moved[k].pos[i] - x) / DELTA));
  };
  const b: Built = { prims: base, dw: deriv(DELTA, 0, 0), dh: deriv(0, DELTA, 0), dd: deriv(0, 0, DELTA) };
  // Linearity at the corners of the fit range (one parameter at a time, then all together).
  const ends = (ref: number, r: [number, number] | undefined): number[] => {
    const lo = r ? Math.max(r[0] + 0.001, 0.02) : Math.max(0.02, ref - 0.5);
    const hi = r ? Math.min(r[1] - 0.001, ref + 3) : ref + 0.5;
    return ref === 0 && !r ? [0] : [lo, hi];
  };
  const tests: [number, number, number][] = [];
  for (const w of ends(W, v.fit?.w)) {
    tests.push([w, H, D]);
  }
  for (const h of ends(H, v.fit?.h)) {
    tests.push([W, h, D]);
  }
  for (const d of ends(D, v.fit?.d)) {
    tests.push([W, H, d]);
  }
  tests.push([ends(W, v.fit?.w).at(-1)!, ends(H, v.fit?.h).at(-1)!, ends(D, v.fit?.d).at(-1)!]);
  for (const [w, h, d] of tests) {
    const got = capture(author, w, h, d).take();
    const bad = sameTopology(base, got);
    if (bad) {
      throw new Error(`module ${fam.name}/${v.id}: topology changes at w ${w.toFixed(3)} h ${h.toFixed(3)} d ${d.toFixed(3)} (${bad}); narrow its fit range`);
    }
    base.forEach((p, k) => {
      for (let i = 0; i < p.pos.length; i++) {
        const want = p.pos[i] + b.dw[k][i] * (w - W) + b.dh[k][i] * (h - H) + b.dd[k][i] * (d - D);
        if (Math.abs(want - got[k].pos[i]) > LINEAR_TOL) {
          throw new Error(`module ${fam.name}/${v.id}: vertex ${Math.floor(i / 3)} of ${p.material} bends (off by ${(want - got[k].pos[i]).toFixed(4)} m at w ${w.toFixed(2)} h ${h.toFixed(2)} d ${d.toFixed(2)}); make it linear in the size or split the fit range`);
        }
      }
    });
  }
  return b;
}

async function familyGlb(fam: FamilySpec, built: Map<string, Built>): Promise<Uint8Array> {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'Evren world-compiler (façade modules)';
  const buffer = doc.createBuffer();
  const mats = new Map<string, ReturnType<Document['createMaterial']>>();
  const material = (m: string) => {
    let x = mats.get(m);
    if (!x) {
      x = doc.createMaterial(m).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1);
      mats.set(m, x);
    }
    return x;
  };
  const scene = doc.createScene(fam.name);
  for (const [id, b] of built) {
    const mesh = doc.createMesh(id);
    b.prims.forEach((p, k) => {
      const f32 = (a: number[], round: (x: number) => number) => Float32Array.from(a, round);
      const acc = (name: string, type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR', array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) => doc.createAccessor(`${id}_${k}_${name}`).setType(type).setArray(array).setBuffer(buffer);
      const nv = p.pos.length / 3;
      const prim = doc
        .createPrimitive()
        .setAttribute('POSITION', acc('position', 'VEC3', f32(p.pos, r5)))
        .setAttribute('NORMAL', acc('normal', 'VEC3', f32(p.nrm, r5)))
        .setAttribute('COLOR_0', acc('color', 'VEC4', f32(p.col, r4)))
        .setIndices(acc('index', 'SCALAR', nv <= 65535 ? Uint16Array.from(p.idx) : Uint32Array.from(p.idx)))
        .setMaterial(material(p.material));
      if (p.moduleUv) {
        prim.setAttribute('TEXCOORD_0', acc('uv', 'VEC2', f32(p.uv, r5)));
      }
      for (const [sem, d] of [['_DW', b.dw[k]], ['_DH', b.dh[k]], ['_DD', b.dd[k]]] as const) {
        if (d.some((x) => Math.abs(x) > 1e-6)) {
          prim.setAttribute(sem, acc(sem.slice(1).toLowerCase(), 'VEC3', f32(d, r5)));
        }
      }
      prim.setExtras({ ...(p.tint !== null ? { tint: p.tint } : {}), ...(p.moduleUv ? { uv: 'module' } : {}) });
      mesh.addPrimitive(prim);
    });
    scene.addChild(doc.createNode(id).setMesh(mesh));
  }
  doc.getRoot().setDefaultScene(scene);
  // Separate (non-interleaved) accessors: the runtime's module reader and Blender take them as they are.
  return new NodeIO().setVertexLayout(VertexLayout.SEPARATE).writeBinary(doc);
}

const sha16 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex').slice(0, 16);

function writeIfChanged(file: string, bytes: Uint8Array): void {
  if (existsSync(file) && Buffer.compare(readFileSync(file), bytes) === 0) {
    return;
  }
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
}

export interface LibraryExport {
  catalog: ModuleCatalog;
  /** Every material a module uses (with the families' style renames). */
  materials: MaterialName[];
  dir: string;
}

let cached: Promise<{ catalog: ModuleCatalog; files: Map<string, Uint8Array>; materials: MaterialName[] }> | null = null;

/** Authors the library once per process (catalog, glb bytes, materials). */
export function authorLibrary(): Promise<{ catalog: ModuleCatalog; files: Map<string, Uint8Array>; materials: MaterialName[] }> {
  cached ??= (async () => {
    const families: Record<string, ModuleFamily> = {};
    const files = new Map<string, Uint8Array>();
    const materials = new Set<MaterialName>();
    for (const fam of FAMILIES) {
      const built = new Map<string, Built>();
      const caps = new Map<string, [string | null, string | null]>();
      const add = (id: string, b: Built): void => {
        built.set(id, b);
        for (const p of b.prims) {
          materials.add(p.material);
        }
      };
      for (const v of fam.variants) {
        if (v.author) {
          const b = build(fam, v);
          if (b.prims.length) {
            add(v.id, b);
          }
        }
        const names: [string | null, string | null] = [null, null];
        v.repeat?.caps?.forEach((cap, k) => {
          if (cap) {
            const b = build(fam, v, cap);
            if (b.prims.length) {
              names[k] = `${v.id}.cap${k}`;
              add(names[k]!, b);
            }
          }
        });
        caps.set(v.id, names);
      }
      const file = `${fam.name}.glb`;
      if (built.size) {
        files.set(file, await familyGlb(fam, built));
      }
      for (const s of [...Object.values(fam.styles ?? {}), fam]) {
        for (const m of Object.values(s.remap ?? {})) {
          materials.add(m);
        }
      }
      families[fam.name] = {
        doc: fam.doc,
        ...(fam.remap ? { remap: fam.remap } : {}),
        ...(fam.text ? { text: fam.text } : {}),
        ...(fam.styles ? { styles: fam.styles } : {}),
        variants: fam.variants.map((v): ModuleVariant => ({
          id: v.id,
          file,
          mesh: built.has(v.id) ? v.id : '',
          ref: v.ref,
          ...(v.fit ? { fit: v.fit } : {}),
          ...(v.styles ? { styles: v.styles } : {}),
          ...(v.weight !== undefined ? { weight: v.weight } : {}),
          ...(v.palettes ? { palettes: v.palettes } : {}),
          ...(v.advance !== undefined ? { advance: Math.round(v.advance * 1e5) / 1e5 } : {}),
          ...(v.repeat ? { repeat: { pitch: v.repeat.pitch, ...(v.repeat.up ? { up: true } : {}), ...(caps.get(v.id)?.some(Boolean) ? { caps: caps.get(v.id) } : {}) } } : {}),
        })),
      };
    }
    const fileRecs = Object.fromEntries([...files].map(([f, b]) => [f, { hash: sha16(b), bytes: b.byteLength, gz: gzipSync(b, { level: 9 }).byteLength }]));
    const body = { format: 1 as const, families, files: fileRecs };
    const catalog: ModuleCatalog = { ...body, hash: sha16(JSON.stringify(body)) };
    return { catalog, files, materials: [...materials].sort() };
  })();
  return cached;
}

/** Writes the library into `<worldDir>/_shared/modules/` (only files that changed). */
export async function exportLibrary(worldDir: string): Promise<LibraryExport> {
  const { catalog, files, materials } = await authorLibrary();
  const dir = modulesDir(worldDir);
  mkdirSync(dir, { recursive: true });
  for (const [f, b] of files) {
    writeIfChanged(join(dir, f), b);
    writeIfChanged(join(dir, `${f}.gz`), gzipSync(b, { level: 9 }));
  }
  const text = new TextEncoder().encode(JSON.stringify(catalog, null, 1));
  writeIfChanged(join(dir, 'catalog.json'), text);
  writeIfChanged(join(dir, 'catalog.json.gz'), gzipSync(text, { level: 9 }));
  return { catalog, materials, dir };
}
