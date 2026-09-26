/**
 * Runs the world compiler (src/cli.ts) from an esbuild bundle instead of through tsx: tsx transforms with esbuild's
 * keepNames, which wraps every inner function in a __name() call, and the compiler's hot loops (noise, ground
 * splitting, façade weathering) create closures per call; the bundle is built without it (steps ~25-35 % faster,
 * output byte-identical). Worker threads (--jobs) run the same bundle. Bundling takes ~0.2 s; the bundle is named
 * by its content hash under node_modules/.cache/evren-world/build/. Falls back to tsx when esbuild is missing.
 *
 *   npm run compile:world -- --area eminonu [...]      (same arguments as src/cli.ts)
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Before anything uses the libuv thread pool: the web profile gzips on it (web.ts packWeb).
process.env.UV_THREADPOOL_SIZE ??= String(availableParallelism());

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const entry = join(here, 'src/cli.ts');
const dir = join(root, 'node_modules/.cache/evren-world/build');

async function bundle() {
  const { build } = await import('esbuild');
  const res = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    keepNames: false,
    logLevel: 'warning',
    plugins: [
      {
        // Modules other than the entry keep their own import.meta.url (lib/areas.mjs derives ROOT from it); the
        // entry's is the bundle's, which worker threads load.
        name: 'import-meta-url',
        setup(b) {
          b.onLoad({ filter: /\.(ts|mts|mjs|js)$/ }, (a) => {
            const text = readFileSync(a.path, 'utf8');
            return { contents: a.path === entry ? text : text.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(a.path).href)), loader: /\.m?ts$/.test(a.path) ? 'ts' : 'js' };
          });
        },
      },
    ],
  });
  const code = res.outputFiles[0].contents;
  const file = join(dir, `cli-${createHash('sha256').update(code).digest('hex').slice(0, 16)}.mjs`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, code);
    renameSync(tmp, file);
    // Bundles of older sources (a day old: a parallel compile may still load a recent one).
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (p !== file && Date.now() - statSync(p).mtimeMs > 86400e3) {
        rmSync(p, { force: true });
      }
    }
  }
  return file;
}

let file = null;
try {
  file = await bundle();
} catch (e) {
  console.error(`[run] bundling failed, running through tsx: ${e.message}`);
}
if (file) {
  // cli.ts reads its arguments from process.argv.slice(2), which stay as given.
  await import(pathToFileURL(file).href);
} else {
  const r = spawnSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), entry, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exitCode = r.status ?? 1;
}
