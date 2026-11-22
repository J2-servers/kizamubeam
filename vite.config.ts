import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// Feste Portnummer für Tauri (siehe src-tauri/tauri.conf.json)
export default defineConfig({
  clearScreen: false,
  // Module workers may lazily load the geometry engine after their worker-local bootstrap.
  worker: { format: 'es' },
  // src-tauri is built by cargo: watching its target folder crashes the dev server with EBUSY on Windows while a
  // release build writes kizamubeam_lib.dll (the Tauri template ignores the folder for the same reason)
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  // The QuickJS engine of JavaScript plugins finds its .wasm file next to its own module (import.meta.url).
  // Pre-bundling moves the module into .vite/deps without the file, so the dev server answered with index.html
  // and every JavaScript plugin failed with plugin-crash; build and preview were not affected.
  optimizeDeps: { exclude: ['@jitl/quickjs-wasmfile-release-sync'] },
  // Ersatzschriften (~22 kB) einbetten, damit Text-in-Pfad auch ohne Netz und als Einzeldatei funktioniert.
  // Two pages: the main window and the separate window "Produkt erstellen" (src/criar/, opened by src-tauri/src/criar.rs)
  build: {
    target: 'es2021',
    outDir: 'dist',
    assetsInlineLimit: 32768,
    rollupOptions: { input: { main: resolve(root, 'index.html'), criar: resolve(root, 'criar.html') } },
  },
});
