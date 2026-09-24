import { defineConfig, type Plugin } from 'vite';
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const sandboxPages = Object.fromEntries(
  readdirSync(resolve(__dirname, 'sandbox'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [`sandbox/${f.replace('.html', '')}`, resolve(__dirname, 'sandbox', f)]),
);

const WORLD_DIR = resolve(__dirname, 'public/world');
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
};

/**
 * Serves the compiled street layer (public/world) straight from disk in dev. public/world is not watched (recompiles
 * would flood the watcher), and Vite's public-file index only knows files that existed at startup, so files the
 * compiler writes later would otherwise fall through to the SPA fallback.
 */
function worldStatic(): Plugin {
  return {
    name: 'evren-world-static',
    configureServer(server) {
      server.middlewares.use('/world', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
        const file = join(WORLD_DIR, rel);
        if (!file.startsWith(WORLD_DIR)) {
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
    },
  };
}

export default defineConfig({
  plugins: [worldStatic()],
  server: {
    port: 5199,
    strictPort: true,
    host: '127.0.0.1',
    // Large generated or cached folders: served as static files, never watched (recompiles would flood the watcher).
    watch: {
      ignored: ['**/public/world/**', '**/assets-src/**', '**/private-assets/**', '**/.shots/**', '**/data/**', '**/tools/**', '**/scripts/**'],
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
