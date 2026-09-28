/**
 * Exports the web game's vessels for other runtimes (the Unreal game), built headlessly by the game's own builders:
 * the life fleet (city ferries: vapur and double-ender, sea bus, excursion boat, tug, pilot boat, motorboat, tankers,
 * container ships, bulk carriers, fishing boat, purse seiner, motor yacht, sailing yacht) and the moored waterfront
 * boats (balık-ekmek boats, kayıks), one plain-float glTF per variant, tileable detail maps baked from the web shader
 * as PNGs, and a manifest with the material rules.
 *
 *   npx tsx tools/export/vessels-gltf.ts [--out <dir>] [--only id,id]
 *
 *   --out   default: ../seventeenskies-unreal/world-export/vessels beside the main web checkout (never public/)
 *   --only  design ids (vapur, seabus, kayik, ...): only these are rebuilt; other designs' files and entries are kept
 *
 * Output (<dir>):
 * - <key>.glb per variant (key = design id for the default variant, <design>--<variant> otherwise) and
 *   <key>_lod1.glb (the web's distant LOD) for the fleet. Frame: origin midship on the design waterline (the pivot),
 *   bow to -Z, starboard +X, +Y up, metres. Nodes: `hull`, parts on their pivots (flag_n, radar_n, emblem_n), empty
 *   SOCKET_* nodes (lights, wake, spray, propellers). Vertex layout: tools/export/vessels/mesh.ts.
 * - textures/vessel_*.png: tileable detail maps (tools/export/vessels/detail-maps.ts).
 * - index.json: frame, vertex layout, shading rules, and per design its dimensions, variants (files, hashes,
 *   triangles, paints, liveries flagged for trademarks), parts, sockets, physics, handling and idle motion.
 *
 * Liveries: the default variant of every design is release-safe (the generic livery). The web's own liveries after
 * Şehir Hatları, İDO, Turyol and Dentur are exported as `--web` variants flagged `releaseSafe: false`.
 * Every glb is checked after writing: Khronos glTF-Validator and a load through three.js' GLTFLoader.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { validateGlb } from '../world-compiler/src/validate';
import { bakeDetailMaps } from './vessels/detail-maps';
import { convert, PART_ROLES, type SocketOut, type Vec3, writeGlb } from './vessels/mesh';
import { shadingManifest } from './vessels/shading';
import { socketsOf } from './vessels/sockets';
import { collectDesigns } from './vessels/sources';

const FORMAT = 1;
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const args = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** The main checkout (a worktree resolves to the repository it belongs to), beside which the Unreal repo lives. */
function mainCheckout(): string {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return dirname(common);
  } catch {
    return ROOT;
  }
}

const out = resolve(argOf('--out') ?? join(mainCheckout(), '../seventeenskies-unreal/world-export/vessels'));
const only = argOf('--only') ? new Set(argOf('--only')!.split(',')) : null;
if (!relative(join(ROOT, 'public'), out).startsWith('..') || !relative(join(mainCheckout(), 'public'), out).startsWith('..')) {
  console.error(`refusing to write into the web game's public/: ${out}`);
  process.exit(2);
}
const t0 = performance.now();
mkdirSync(out, { recursive: true });

const sha = (b: Uint8Array): string => createHash('sha1').update(b).digest('hex').slice(0, 16);
const hex = (c: number): string => c.toString(16).padStart(6, '0');
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const v3 = (v: readonly number[]): Vec3 => [r3(v[0]), r3(v[1]), r3(v[2])];

/** Writes a file when its bytes differ from the one on disk; returns its hash. */
const written: string[] = [];
function put(file: string, bytes: Uint8Array): string {
  const hash = sha(bytes);
  const path = join(out, file);
  if (!existsSync(path) || sha(readFileSync(path)) !== hash) {
    writeFileSync(path, bytes);
    written.push(file);
  }
  return hash;
}

interface FileRecord {
  file: string;
  hash: string;
  bytes: number;
  triangles: number;
}

const all = collectDesigns();
const order = (id: string): number => all.findIndex((d) => d.id === id);
const designs = all.filter((d) => !only || only.has(d.id));
if (only) {
  for (const id of only) if (!designs.some((d) => d.id === id)) console.warn(`warning: no design ${id}`);
}
const slots = new Set<string>();
const manifest: Record<string, unknown> = {};
const files: FileRecord[] = [];

for (const d of designs) {
  const variants: Record<string, unknown> = {};
  let sockets: SocketOut[] = [];
  let bounds: [Vec3, Vec3] | null = null;
  let airDraft = d.airDraft;
  const frame = { design: d.id, frame: 'origin midship on the design waterline, bow -Z, starboard +X, +Y up, metres' };
  const byDefault = new Map<string, Record<string, unknown>>();
  for (const v of d.variants) {
    if (!v.build) continue;
    const near = v.build(0);
    const conv = convert(near.geometry, near.layout, d.turn, v.key);
    if (v.isDefault) {
      sockets = socketsOf(d, near.geometry);
      bounds = conv.hull.bounds();
      for (const p of conv.parts) {
        const b = p.mesh.bounds();
        for (let k = 0; k < 3; k++) {
          bounds[0][k] = Math.min(bounds[0][k], b[0][k]);
          bounds[1][k] = Math.max(bounds[1][k], b[1][k]);
        }
      }
      if (!airDraft) airDraft = bounds[1][1];
    }
    for (const m of [conv.hull, ...conv.parts.map((p) => p.mesh)]) for (const s of m.prims.keys()) slots.add(s);
    const bytes = await writeGlb(v.key, conv.hull, conv.parts, sockets, { ...frame, variant: v.id });
    const triangles = conv.hull.triangles() + conv.parts.reduce((s, p) => s + p.mesh.triangles(), 0);
    const main: FileRecord = { file: `${v.key}.glb`, hash: put(`${v.key}.glb`, bytes), bytes: bytes.length, triangles };
    files.push(main);
    let lod1: FileRecord | null = null;
    if (d.lodDistance !== null) {
      const far = v.build(1);
      const c1 = convert(far.geometry, far.layout, d.turn, `${v.key}_lod1`);
      for (const m of [c1.hull, ...c1.parts.map((p) => p.mesh)]) for (const s of m.prims.keys()) slots.add(s);
      const b1 = await writeGlb(`${v.key}_lod1`, c1.hull, c1.parts, [], { ...frame, variant: v.id, lod: 1 });
      lod1 = { file: `${v.key}_lod1.glb`, hash: put(`${v.key}_lod1.glb`, b1), bytes: b1.length, triangles: c1.hull.triangles() + c1.parts.reduce((s, p) => s + p.mesh.triangles(), 0) };
      files.push(lod1);
    }
    const record = {
      default: v.isDefault,
      releaseSafe: v.releaseSafe,
      ...(v.trademarks.length ? { trademarks: v.trademarks } : {}),
      ...main,
      ...(lod1 ? { lod1 } : {}),
      paints: v.paints.map(hex),
      parts: conv.parts.map((p) => ({ node: p.node, kind: p.kind, role: PART_ROLES[p.kind] ?? 'static', pivot: v3(p.pivot), axis: [0, 1, 0], triangles: p.mesh.triangles() })),
    };
    byDefault.set(v.id, record);
    variants[v.id] = record;
  }
  // Paint-only liveries share the default variant's files.
  const base = d.variants.find((v) => v.isDefault)!;
  for (const v of d.variants) {
    if (v.build) continue;
    const shared = byDefault.get(base.id)!;
    variants[v.id] = { ...shared, default: v.isDefault, releaseSafe: v.releaseSafe, ...(v.trademarks.length ? { trademarks: v.trademarks } : {}), paints: v.paints.map(hex), sharesFilesWith: base.id };
  }
  manifest[d.id] = {
    family: d.family,
    kind: d.kind,
    title: d.title,
    dimensions: { length: d.length, beam: d.beam, draft: d.draft, airDraft: r3(airDraft), bounds: bounds ? [v3(bounds[0]), v3(bounds[1])] : null },
    pivot: 'midship on the design (laden) waterline; ballasted cargo ships ride higher by the physics `lift`',
    ...(d.lodDistance !== null ? { lodDistance: d.lodDistance } : {}),
    big: d.big,
    ...(d.catamaran ? { catamaran: true } : {}),
    ...(d.doubleEnded ? { doubleEnded: true } : {}),
    ...(d.planing ? { planing: true } : {}),
    ...(d.turn ? { turned: 'the web builds this boat bow to +Z: add half a turn to a web yaw when placing it from web data' } : {}),
    variants,
    sockets: sockets.map((s) => ({ node: `SOCKET_${s.name}`, position: v3(s.position), ...s.extras })),
    motion: d.motion,
    ...(d.physics ? { physics: d.physics } : {}),
    ...(d.handling ? { handling: d.handling } : {}),
  };
}

const { maps, written: mapsWritten } = await bakeDetailMaps(out);

// --only updates its designs in an existing manifest and keeps the others (and their material slots).
const previous = only && existsSync(join(out, 'index.json')) ? (JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')) as { vessels?: Record<string, unknown>; shading?: { materials?: Record<string, unknown> } }) : null;
if (previous) {
  for (const [id, rec] of Object.entries(previous.vessels ?? {})) if (!(id in manifest)) manifest[id] = rec;
  for (const name of Object.keys(previous.shading?.materials ?? {})) slots.add(name.replace(/^vessel_/, ''));
}
const vessels = Object.fromEntries(Object.keys(manifest).sort((a, b) => order(a) - order(b)).map((id) => [id, manifest[id]]));

const index = {
  format: FORMAT,
  generated: new Date().toISOString().slice(0, 10),
  source: `web ${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()}`,
  frame: 'glTF / three.js: +Y up, metres; a vessel faces -Z (bow), starboard +X; its origin (pivot) is midship on the design waterline',
  lod1: 'the web distant LOD (<key>_lod1.glb): the hull mesh only; parts and sockets live in the main file',
  unreal: {
    axes: 'Interchange lands glTF (+X, +Y up, +Z) on Unreal (+X, +Z up, +Y) in cm (the landmarks rule): the bow points to Unreal -Y, starboard to +X',
    yaw: 'a web heading (three.js rotation.y = θ) is the Unreal yaw -θ for the mesh as imported; the web forward is (-sin θ, -cos θ) in (x, z)',
    import: 'static meshes with combine off (parts are their own meshes on pivots), SOCKET_ nodes as sockets (or from this index), no generated lightmap UVs: UV channels 1-3 carry data (4 channels, the Nanite maximum)',
    scale: 'metres in the files; Interchange converts to centimetres (x100)',
    vertexColour: 'COLOR_0 is linear float in the files; Unreal keeps vertex colours in 8 bits',
  },
  vertexData: {
    COLOR_0: 'linear base colour (alpha 1)',
    TEXCOORD_0: 'surface coordinates in metres: walls (along the wall, up), decks and flat faces (x, z); divide by a map tiling',
    TEXCOORD_1: '(roughness, metalness)',
    TEXCOORD_2: '(paint mode 0 baked / 1 instance hull paint / 2 accent palette, emissive class 0 none / 1 cabin / 2 crew / 3 lamp / 4 sign / 5 glow)',
    TEXCOORD_3: '(motion weight: flag cloth 0 at the staff .. 1 at the fly, glow strength of class 5)',
  },
  shading: shadingManifest(maps, [...slots]),
  vessels,
};
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 1));

// Stale files (designs or variants no longer exported).
if (!only) {
  const keep = new Set(files.map((f) => f.file));
  for (const f of readdirSync(out)) {
    if (f.endsWith('.glb') && !keep.has(f)) rmSync(join(out, f));
  }
  const textures = new Set(Object.values(maps).map((m) => m.file.replace('textures/', '')));
  for (const f of readdirSync(join(out, 'textures'))) {
    if (!textures.has(f)) rmSync(join(out, 'textures', f));
  }
}

// Check: Khronos validator and a three.js load of every file written by this run's designs.
const loader = new GLTFLoader();
let failures = 0;
const rows: string[] = [];
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(join(out, f.file)));
  const report = await validateGlb(f.file, bytes);
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  let tris = 0;
  let sockets = 0;
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) tris += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.getAttribute('position').count) / 3;
    else if (o.name.startsWith('SOCKET_')) sockets++;
  });
  const ok = report.errors === 0 && tris === f.triangles;
  if (!ok) {
    failures++;
    console.error(`FAILED ${f.file}: ${report.errors} validator errors, ${tris} triangles loaded, ${f.triangles} written`);
    for (const m of report.messages) console.error(`  ${m}`);
  }
  rows.push(`${f.file.padEnd(30)} ${String(tris).padStart(7)} tris ${(f.bytes / 1024).toFixed(0).padStart(6)} KB  sockets ${String(sockets).padStart(2)}  validator ${report.errors}E ${report.warnings}W ${report.infos}I${report.warnings ? ` ${Object.keys(report.codes).join(',')}` : ''}`);
}
console.log(rows.join('\n'));
const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
const texBytes = Object.values(maps).reduce((s, m) => s + readFileSync(join(out, m.file)).length, 0);
console.log(
  `vessels export: ${designs.length} designs, ${files.length} glbs (${(totalBytes / 1048576).toFixed(1)} MB, ${written.length} written), ${Object.keys(maps).length} maps (${(texBytes / 1048576).toFixed(1)} MB, ${mapsWritten} written), ${slots.size} material slots -> ${out} in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
);
if (failures) {
  console.error(`${failures} file(s) failed the check`);
  process.exit(1);
}
