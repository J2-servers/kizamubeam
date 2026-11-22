// Browser-Entwicklungsmodus ohne Tauri: identisch zu vite.config.ts, aber Vite sucht
// Voreinstellungen nur in der echten App-Indexdatei. Ohne diese Einschränkung versucht
// Vite, die Fixture-Seiten unter artifacts/**/index.html (index.html von Headless-Tests,
// die ihr eigenes gebündelte fixture.js laden) als Einstiegspunkte zu optimieren, und
// meldet "fixture.js could not be resolved".
//
// Start: npx vite --config vite.dev-browser.config.ts   ->  http://localhost:1420
import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  worker: { format: 'es' },
  server: { port: 1420, strictPort: true, host: true },
  // Wie in vite.config.ts (#379): Die QuickJS-Maschine der JavaScript-Plugins findet ihre .wasm-Datei neben dem
  // eigenen Modul (import.meta.url). Beim Vorbündeln landet das Modul ohne die Datei in .vite/deps, der Dev-Server
  // antwortet mit index.html, und JEDES JavaScript-Plugin scheitert mit plugin-crash (alle Kern-Generatoren).
  optimizeDeps: { entries: ['./index.html'], exclude: ['@jitl/quickjs-wasmfile-release-sync'] },
  build: { target: 'es2021', outDir: 'dist', assetsInlineLimit: 32768 },
});
