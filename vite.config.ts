import { defineConfig, type Plugin } from 'vite';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const sandboxPages = Object.fromEntries(
  readdirSync(resolve(__dirname, 'sandbox'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [`sandbox/${f.replace('.html', '')}`, resolve(__dirname, 'sandbox', f)]),
);

/** Generated folders served straight from disk in dev (see worldStatic): mount path -> folder. */
const STATIC_DIRS: Record<string, string> = {
  '/world': resolve(__dirname, 'public/world'),
  // Flight-scale OSM regions (scripts/data/osm-regions.mjs), fetched while the dev server runs.
  '/data/osm/regions': resolve(__dirname, 'public/data/osm/regions'),
};
const WORLD_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ktx2': 'image/ktx2',
  '.webp': 'image/webp',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

/**
 * Private assets reach builds but never the repository or public/ (CLAUDE.md, .docs/assets/private-assets.md): the
 * US-risky historic recordings in private-assets/audio/moments/ (files + manifest.json) are served at
 * /audio/music/private/ in dev and copied to dist/audio/music/private/ by `vite build` when the folder exists.
 * EVREN_PRIVATE_ASSETS=0 leaves them out (dev and build), e.g. for a build that is published openly.
 */
const PRIVATE_MUSIC_DIR = resolve(__dirname, 'private-assets/audio/moments');
const PRIVATE_MUSIC_MOUNT = '/audio/music/private';
const withPrivateAssets = process.env.EVREN_PRIVATE_ASSETS !== '0';
if (withPrivateAssets && existsSync(PRIVATE_MUSIC_DIR)) {
  STATIC_DIRS[PRIVATE_MUSIC_MOUNT] = PRIVATE_MUSIC_DIR;
}

/** Copies the private music (see PRIVATE_MUSIC_DIR) into the build output. */
function privateMusic(): Plugin {
  let outDir = resolve(__dirname, 'dist');
  return {
    name: 'evren-private-music',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!withPrivateAssets || !existsSync(PRIVATE_MUSIC_DIR)) {
        return;
      }
      const target = join(outDir, 'audio/music/private');
      mkdirSync(target, { recursive: true });
      const files = readdirSync(PRIVATE_MUSIC_DIR).filter((f) => /\.(opus|m4a|json)$/.test(f));
      for (const f of files) {
        copyFileSync(join(PRIVATE_MUSIC_DIR, f), join(target, f));
      }
      console.log(`[private-assets] ${files.length} private music files copied to ${target}`);
    },
  };
}

/**
 * Serves the compiled street layer (public/world) straight from disk in dev. public/world is not watched (recompiles
 * would flood the watcher), and Vite's public-file index only knows files that existed at startup, so files the
 * compiler writes later would otherwise fall through to the SPA fallback.
 */
function worldStatic(): Plugin {
  return {
    name: 'evren-world-static',
    configureServer(server) {
      for (const [mount, dir] of Object.entries(STATIC_DIRS)) {
        server.middlewares.use(mount, (req, res, next) => {
          const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
          const file = join(dir, rel);
          if (!file.startsWith(dir)) {
            next();
            return;
          }
          try {
            const st = statSync(file);
            if (!st.isFile()) {
              next();
              return;
            }
            res.setHeader('Content-Type', WORLD_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
            res.setHeader('Content-Length', String(st.size));
            res.setHeader('Cache-Control', 'no-cache');
            createReadStream(file).pipe(res);
          } catch {
            next();
          }
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [worldStatic(), privateMusic()],
  server: {
    port: 5199,
    strictPort: true,
    host: '127.0.0.1',
    // Large generated or cached folders: served as static files, never watched (recompiles would flood the watcher).
    // The data folders are anchored (the root data/ and public/data/): a bare '**/data/**' also hid source folders
    // such as src/world/geo/data/ (landmark anchors, roads), whose edits then never reached the dev server.
    watch: {
      ignored: ['**/public/world/**', '**/public/data/**', `${resolve(__dirname, 'data').replace(/\\/g, '/')}/**`, '**/assets-src/**', '**/private-assets/**', '**/.shots/**', '**/tools/**', '**/scripts/**'],
    },
  },
  preview: { port: 5198, strictPort: true, host: '127.0.0.1' },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), ...sandboxPages },
    },
  },
});
