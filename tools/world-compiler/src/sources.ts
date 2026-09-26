/**
 * Source closures for the stage cache (stage-cache.ts): which source files a compile stage depends on, hashed by
 * content. A stage's closure is its module plus everything it imports at run time (relative imports in the compiler
 * and in the game's src/; `import type` is erased and skipped, since every step imports its types from registry.ts), plus the modules that fill the AreaContext.shared entries it reads
 * (`shared.get('streetPlan')` depends on the module with `shared.set('streetPlan', ...)`), to a fixpoint. Package
 * imports count through package-lock.json, and the data files the compiler reads at run time (approved assets,
 * reference cameras, landing spots, texture sources) through GLOBAL_INPUTS, which every key includes.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { ROOT } from '../lib/areas.mjs';

const CODE_ROOTS = ['tools/world-compiler/src', 'tools/world-compiler/districts', 'tools/world-compiler/lib', 'src'];
/** Read at run time by the compiler (content). */
const INPUT_FILES = ['tools/world-compiler/s1', 'tools/world-compiler/districts', '.docs/street', 'tools/assets/approved.json', 'public/textures/LICENSES.md', 'scripts/blender/camera-overrides.json', 'package-lock.json'];
/** Texture and model sources (path, size, mtime, like the texture cache). */
const ASSET_ROOTS = ['assets-src', 'public/textures'];

/** Bump when the stage or tile cache records change. */
const STAGE_CACHE_VERSION = 1;

const sha = (...parts: string[]): string => createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);

interface SourceFile {
  hash: string;
  imports: string[];
  gets: string[];
  sets: string[];
}

function listFiles(rel: string, out: string[], filter?: RegExp): void {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) {
    return;
  }
  if (statSync(abs).isFile()) {
    out.push(rel);
    return;
  }
  for (const e of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name.startsWith('.') || e.name === 'node_modules') {
      continue;
    }
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      listFiles(r, out, filter);
    } else if (e.isFile() && (!filter || filter.test(e.name))) {
      out.push(r);
    }
  }
}

const EXTS = ['', '.ts', '.mts', '.mjs', '.js', '/index.ts', '/index.mjs'];

/** Keys of `shared.get(...)` / `shared.set(...)`: string literals, or constants resolved within the sources. */
const SHARED_RE = /shared\.(get|set)\(\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))/g;

class SourceGraph {
  readonly files = new Map<string, SourceFile>();
  private readonly setters = new Map<string, string[]>();
  private readonly memo = new Map<string, string>();

  constructor() {
    const all: string[] = [];
    for (const r of CODE_ROOTS) {
      listFiles(r, all, /\.(ts|mts|mjs|js)$/);
    }
    const consts = new Map<string, string>();
    const texts = new Map<string, string>();
    for (const f of all) {
      const text = readFileSync(resolve(ROOT, f), 'utf8');
      texts.set(f, text);
      for (const m of text.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*'([^']+)'/g)) {
        consts.set(m[1], m[2]);
      }
    }
    for (const f of all) {
      const text = texts.get(f)!;
      const imports: string[] = [];
      for (const m of text.matchAll(/(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1] ?? m[2] ?? m[3];
        // Type-only imports are erased: no run-time dependency (every step imports its types from registry.ts).
        if (!spec.startsWith('.') || /^(import|export)\s+type\s/.test(m[0])) {
          continue;
        }
        const base = resolve(ROOT, dirname(f), spec);
        const hit = EXTS.map((e) => base + e).find((p) => existsSync(p) && statSync(p).isFile()) ?? (base.endsWith('.mjs') && existsSync(base.replace(/\.mjs$/, '.d.mts')) ? base.replace(/\.mjs$/, '.d.mts') : null);
        if (hit) {
          imports.push(relative(ROOT, hit));
        }
      }
      const gets: string[] = [];
      const sets: string[] = [];
      // Comments do not count (this file's own header names shared keys).
      for (const m of text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').matchAll(SHARED_RE)) {
        const key = m[2] ?? m[3] ?? consts.get(m[4]) ?? `?${m[4]}`;
        (m[1] === 'get' ? gets : sets).push(key);
      }
      for (const k of sets) {
        this.setters.set(k, [...(this.setters.get(k) ?? []), f]);
      }
      this.files.set(f, { hash: createHash('sha256').update(text).digest('hex').slice(0, 24), imports, gets, sets });
    }
  }

  /** Files a set of root files depends on (imports and shared-state producers, to a fixpoint). */
  closure(roots: readonly string[]): string[] {
    const seen = new Set<string>();
    const todo = roots.filter((r) => this.files.has(r));
    while (todo.length) {
      const f = todo.pop()!;
      if (seen.has(f)) {
        continue;
      }
      seen.add(f);
      const sf = this.files.get(f)!;
      for (const i of sf.imports) {
        if (this.files.has(i) && !seen.has(i)) {
          todo.push(i);
        }
      }
      for (const k of sf.gets) {
        for (const s of this.setters.get(k) ?? []) {
          if (!seen.has(s)) {
            todo.push(s);
          }
        }
      }
    }
    return [...seen].sort();
  }

  /** Content hash of a closure. */
  hash(roots: readonly string[]): string {
    const key = [...roots].sort().join('|');
    let h = this.memo.get(key);
    if (!h) {
      h = sha(...this.closure(roots).map((f) => `${f}:${this.files.get(f)!.hash}`));
      this.memo.set(key, h);
    }
    return h;
  }

  /** Files that define `export const <name>` for any of `names`. */
  definers(pattern: RegExp): string[] {
    const out: string[] = [];
    for (const f of this.files.keys()) {
      if (f.startsWith('tools/world-compiler/src/') && pattern.test(readFileSync(resolve(ROOT, f), 'utf8'))) {
        out.push(f);
      }
    }
    return out;
  }
}

let graph: SourceGraph | null = null;
const sources = (): SourceGraph => (graph ??= new SourceGraph());

let globalMemo: string | null = null;
/** Hash of the run-time inputs every stage shares (data-like files, texture sources, Node version). */
export function globalInputs(): string {
  if (globalMemo) {
    return globalMemo;
  }
  const h = createHash('sha256');
  const files: string[] = [];
  for (const r of INPUT_FILES) {
    listFiles(r, files);
  }
  for (const f of files) {
    h.update(f).update('\0').update(readFileSync(resolve(ROOT, f))).update('\0');
  }
  const assets: string[] = [];
  for (const r of ASSET_ROOTS) {
    listFiles(r, assets);
  }
  for (const f of assets) {
    const st = statSync(resolve(ROOT, f));
    h.update(`${f}:${st.size}:${Math.round(st.mtimeMs)}\0`);
  }
  h.update(`node ${process.versions.node} stage-cache ${STAGE_CACHE_VERSION}`);
  globalMemo = h.digest('hex').slice(0, 24);
  return globalMemo;
}

const SRC = 'tools/world-compiler/src/';

/** The modules that define compile step `id` (`export const x: CompileStep = { id: '<id>'`), or every source. */
function stepRoots(id: string): string[] {
  const re = new RegExp(`CompileStep\\s*=\\s*\\{\\s*id:\\s*'${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`);
  const roots = sources().definers(re);
  return roots.length ? roots : [...sources().files.keys()];
}

/** Closure hash of compile step `id`. */
export function stepSourceHash(id: string): string {
  return sources().hash(stepRoots(id));
}

/** The files compile step `id` depends on (diagnostics: --cache-explain). */
export function stepSources(id: string): string[] {
  return sources().closure(stepRoots(id));
}

/**
 * Closure hash of the area setup (cli.ts's own text plus the modules it runs before the tiles: foundation, fields,
 * solids, doors, passages, graphs, lamps, POIs, strip, district profiles). cli.ts's imports are not followed (it
 * imports every step through registry.ts).
 */
export function setupSourceHash(): string {
  // The caches' own record formats (stage-cache.ts, parallel/tile-out.ts, cache.ts) count as setup code.
  const roots = ['foundation', 'ground', 'buildings', 'passages', 'graphs', 'walk-network', 'lamps', 'pois', 'cover', 'district', 'strip', 'osm-street', 'format', 'instances', 'lights', 'stage-cache', 'cache', 'parallel/tile-out', 'parallel/ordered'].map((f) => `${SRC}${f}.ts`);
  return sha(sources().hash(roots), sources().files.get(`${SRC}cli.ts`)?.hash ?? '');
}

/**
 * Closure hash of tile assembly: LOD split, glb writing and compression, validation, web profile, and the material,
 * texture and prop code, plus cli.ts's own text. What assembly reads from the material and prop registries (defined
 * all over the lanes) is checked per tile instead (cli.ts assemblyDeps).
 */
export function assemblySourceHash(): string {
  const roots = ['mesh', 'gltf', 'compress', 'lod', 'validate', 'web', 'materials', 'textures', 'props'].map((f) => `${SRC}${f}.ts`);
  return sha(sources().hash(roots), sources().files.get(`${SRC}cli.ts`)?.hash ?? '');
}
