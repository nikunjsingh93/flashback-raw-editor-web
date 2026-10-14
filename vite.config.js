import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

// Build stamp shown on the front page so you can confirm a deploy actually
// reached your device. The timestamp changes on every build, so if the version
// on your phone doesn't match a fresh build, it hasn't synced yet.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const BUILD_ID = `v${pkg.version}`;

export default defineConfig({
  // GitHub Pages project sites are served below the repository name.
  base: process.env.VITE_BASE_PATH || '/',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },

  plugins: [{
    name: 'offline-editor-assets',
    apply: 'build',
    closeBundle() {
      const folder = resolve('dist');
      const files = [];
      function walk(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const file = join(directory, entry.name);
          if (entry.isDirectory()) walk(file);
          else if (/\.(js|css|wasm|wgsl|cube|png)$/.test(entry.name)) files.push('./' + relative(folder, file).replaceAll('\\', '/'));
        }
      }
      walk(folder);
      const worker = join(folder, 'sw.js');
      writeFileSync(worker, readFileSync(worker, 'utf8').replace('/* BUILD_OFFLINE_ASSETS */ []', JSON.stringify(files.sort())));
    },
  }],

  // Serve assets from project root
  publicDir: 'public',

  // Worker format: ES modules
  worker: {
    format: 'es',
  },

  // Allow importing .wgsl files as raw text strings
  assetsInclude: ['**/*.wgsl', '**/*.cube'],

  // Don't pre-bundle libraw-wasm — its internal Web Worker is created via
  // `new Worker(new URL('./worker.js', import.meta.url))` and the wasm is
  // resolved relative to the module. Vite's dep optimizer rewrites those URLs
  // and breaks worker/wasm loading (decode hangs forever). Excluding it keeps
  // the package's own relative resolution intact.
  optimizeDeps: {
    exclude: ['libraw-wasm'],
  },

  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          // Keep libraw-wasm in its own chunk — it's large
          'libraw': ['libraw-wasm'],
        },
      },
    },
  },

  // NO COOP/COEP headers — matching production (public/_headers). The libraw
  // worker runs as a plain Web Worker without SharedArrayBuffer, and setting
  // them in dev only would hide a dev/prod difference (and COOP breaks iOS
  // standalone PWA launch in production).
});
