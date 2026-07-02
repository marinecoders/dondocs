// Imported into the generated service worker (see vite.config.ts
// workbox.importScripts). Workbox's generateSW only cleans its OWN precache, so
// runtime caches from earlier releases linger on returning clients until the
// browser evicts them under quota pressure — and one of them, the CDN-era
// pandoc-wasm-cdn-cache-v1, holds ~58MB. Delete the retired names on activate
// so that dead weight is reclaimed.
//
// On a pandoc version bump (which rotates the live cache to
// pandoc-wasm-cache-<newversion>), add the prior version's cache name here.
const RETIRED_CACHES = [
  'pandoc-wasm-cache-v1',
  'pandoc-wasm-cache-v2',
  'pandoc-wasm-cdn-cache-v1',
  'wasi-shim-cdn-cache-v1',
];

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all(RETIRED_CACHES.map((name) => caches.delete(name))));
});
