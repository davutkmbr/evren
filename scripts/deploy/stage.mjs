#!/usr/bin/env node
/**
 * Stages dist/ for the public web deploy (wrangler.jsonc, Cloudflare Workers static assets) after a public build
 * (EVREN_PUBLIC=1 vite build, see npm run build:web):
 *
 *   - dist/world/ gets exactly the shipping street layer: world/index.json, the areas it lists, _shared/ and walls/.
 *     Experiment folders (s1-hero, kadikoy-facade, ...) never ship. public/world/ is gitignored and compiled locally,
 *     so the source folder is EVREN_WORLD_DIR (default public/world/; a worktree points it at the main checkout).
 *   - dist/sandbox/ (dev test pages) is removed. Private assets (rider clips, US-risky music) stay; worker/index.ts
 *     keeps the music away from US visitors.
 *   - Checks the Workers limits (25 MiB per file, 20 000 files on the free plan) and fails before a deploy would.
 *
 *   node scripts/deploy/stage.mjs
 *   EVREN_WORLD_DIR=../evren/public/world node scripts/deploy/stage.mjs
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');
const WORLD_SRC = resolve(ROOT, process.env.EVREN_WORLD_DIR ?? 'public/world');
const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES = 20_000;
const WORLD_EXTRA = ['_shared', 'walls'];
const REMOVE = ['sandbox'];

function fail(msg) {
  console.error(`[stage] ${msg}`);
  process.exit(1);
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(p);
    } else if (e.isFile()) {
      yield p;
    }
  }
}

if (!existsSync(join(DIST, 'index.html'))) {
  fail('dist/index.html missing: run the public build first (npm run build:web)');
}
const indexFile = join(WORLD_SRC, 'index.json');
if (!existsSync(indexFile)) {
  fail(`no compiled world at ${WORLD_SRC} (npm run compile:world, or set EVREN_WORLD_DIR)`);
}

for (const r of REMOVE) {
  rmSync(join(DIST, r), { recursive: true, force: true });
}

const worldOut = join(DIST, 'world');
rmSync(worldOut, { recursive: true, force: true });
const areas = JSON.parse(readFileSync(indexFile, 'utf8')).areas.map((a) => a.id);
for (const dir of [...areas, ...WORLD_EXTRA]) {
  const src = join(WORLD_SRC, dir);
  if (!existsSync(src)) {
    fail(`world/${dir} is listed but missing in ${WORLD_SRC}`);
  }
  cpSync(src, join(worldOut, dir), { recursive: true });
}
cpSync(indexFile, join(worldOut, 'index.json'));

let files = 0;
let bytes = 0;
const oversized = [];
for (const f of walk(DIST)) {
  const size = statSync(f).size;
  files++;
  bytes += size;
  if (size > MAX_FILE) {
    oversized.push(`${relative(DIST, f)} (${(size / 1048576).toFixed(1)} MiB)`);
  }
}
if (oversized.length) {
  fail(`files over 25 MiB (Workers static asset limit):\n  ${oversized.join('\n  ')}`);
}
if (files > MAX_FILES) {
  fail(`${files} files, over the ${MAX_FILES} free-plan limit`);
}
console.log(`[stage] ${areas.length} world areas + ${WORLD_EXTRA.join(', ')}; dist: ${files} files, ${(bytes / 1048576).toFixed(0)} MiB`);
