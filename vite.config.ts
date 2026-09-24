import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const sandboxPages = Object.fromEntries(
  readdirSync(resolve(__dirname, 'sandbox'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [`sandbox/${f.replace('.html', '')}`, resolve(__dirname, 'sandbox', f)]),
);

export default defineConfig({
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
