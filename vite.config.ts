import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import type { Plugin } from 'vite'

// ─────────────────────────────────────────────────────────────────────────────
// Build-time version metadata (single source of truth)
// ─────────────────────────────────────────────────────────────────────────────
// These values are injected into the bundle via `define` below and consumed
// by src/lib/version.ts. Do not hardcode version strings elsewhere in the app.
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
) as { version: string };

const APP_VERSION = pkg.version;
const GIT_SHA = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
})();
const BUILD_TIME = new Date().toISOString();

// The vendored pandoc-wasm release (from the manifest scripts/vendor-assets.mjs
// wrote at prebuild). The pandoc runtime cache is named after it, so bumping
// the pinned version rotates to a brand-new cache — a returning client can
// never reassemble a mix of old cached parts and new network parts. 'dev' when
// the manifest isn't staged yet (e.g. dev without a prior vendor run).
const PANDOC_VERSION = (() => {
  try {
    const m = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, 'public/lib/pandoc/pandoc.wasm.manifest.json'), 'utf-8')
    );
    return typeof m.version === 'string' ? m.version : 'dev';
  } catch {
    return 'dev';
  }
})();

// Inject version metadata into index.html as <meta> tags so deployed version
// can be verified without running JS (e.g., `curl site.com | grep dondocs-version`).
function versionMetaPlugin(): Plugin {
  return {
    name: 'dondocs-version-meta',
    transformIndexHtml(html) {
      const metaTags = [
        `<meta name="dondocs-version" content="${APP_VERSION}" />`,
        `<meta name="dondocs-sha" content="${GIT_SHA}" />`,
        `<meta name="dondocs-build-time" content="${BUILD_TIME}" />`,
      ].join('\n    ');
      return html.replace('</head>', `    ${metaTags}\n  </head>`);
    },
  };
}

// Middleware to handle texlive requests for SwiftLaTeX
// This prevents Vite's HTML fallback from returning HTML for missing TeX files
// SwiftLaTeX expects status 301 for missing files to trigger proper fallback behavior
function texliveMiddleware(): Plugin {
  // Track missing files for easy debugging
  const missingFiles = new Set<string>();
  const servedFiles = new Set<string>();

  // Format number to human-readable type
  const formatTypes: Record<string, string> = {
    '3': 'tfm (font metrics)',
    '4': 'type1 (pfb fonts)',
    '10': 'cfg (config)',
    '11': 'map (font map)',
    '26': 'tex (source)',
    '27': 'sty (style)',
    '28': 'cls (class)',
    '32': 'def (definitions)',
    '33': 'vf (virtual font)',
    '39': 'clo (class options)',
  };

  return {
    name: 'texlive-middleware',
    configureServer(server) {
      // Log summary on server start
      console.log('\n[texlive] TeX Live middleware active');
      console.log('[texlive] Missing files will return 301 (not found)');
      console.log('[texlive] Use DONDOCS.texlive.summary() in browser console to see request summary\n');

      server.middlewares.use((req, res, next) => {
        const url = req.url || '';

        // Handle texlive pdftex requests
        const texliveMatch = url.match(/\/lib\/texlive\/pdftex\/(\d+)\/(.+)$/);

        if (texliveMatch) {
          const format = texliveMatch[1];
          const filename = texliveMatch[2];
          const formatName = formatTypes[format] || `format ${format}`;
          const fileKey = `${format}/${filename}`;

          // For known stub files, return the stub content
          if (filename === 'null' || filename === 'null.tex') {
            console.log(`[texlive] ✓ STUB   ${fileKey} → null stub`);
            res.setHeader('Content-Type', 'text/plain');
            res.end('% null stub file\n\\endinput\n');
            return;
          }

          if (filename === 'ppnull.def') {
            console.log(`[texlive] ✓ STUB   ${fileKey} → ppnull stub`);
            res.setHeader('Content-Type', 'text/plain');
            res.end('% ppnull.def stub\n\\endinput\n');
            return;
          }

          // For .aux files - return 301 (generated during compilation, not a package)
          if (filename.endsWith('.aux')) {
            console.log(`[texlive] ✗ 301    ${fileKey} → aux file (generated, not a package)`);
            res.statusCode = 301;
            res.end('');
            return;
          }

          // Check if the static file actually exists
          const staticPath = path.join(__dirname, 'public', 'lib', 'texlive', 'pdftex', format, filename);
          if (!fs.existsSync(staticPath)) {
            missingFiles.add(fileKey);
            console.log(`[texlive] ✗ 301    ${fileKey} → MISSING (${formatName})`);
            res.statusCode = 301;
            res.end('');
            return;
          }

          // File exists, let Vite serve it
          servedFiles.add(fileKey);
          console.log(`[texlive] ✓ 200    ${fileKey} → served (${formatName})`);
        }

        // Handle enc directory
        const encMatch = url.match(/\/lib\/texlive\/pdftex\/enc\/(.+)$/);
        if (encMatch) {
          const filename = encMatch[1];
          const fileKey = `enc/${filename}`;
          const staticPath = path.join(__dirname, 'public', 'lib', 'texlive', 'pdftex', 'enc', filename);
          if (!fs.existsSync(staticPath)) {
            missingFiles.add(fileKey);
            console.log(`[texlive] ✗ 301    ${fileKey} → MISSING (encoding)`);
            res.statusCode = 301;
            res.end('');
            return;
          }
          servedFiles.add(fileKey);
          console.log(`[texlive] ✓ 200    ${fileKey} → served (encoding)`);
        }

        // Handle pfb directory
        const pfbMatch = url.match(/\/lib\/texlive\/pdftex\/pfb\/(.+)$/);
        if (pfbMatch) {
          const filename = pfbMatch[1];
          const fileKey = `pfb/${filename}`;
          const staticPath = path.join(__dirname, 'public', 'lib', 'texlive', 'pdftex', 'pfb', filename);
          if (!fs.existsSync(staticPath)) {
            missingFiles.add(fileKey);
            console.log(`[texlive] ✗ 301    ${fileKey} → MISSING (pfb font)`);
            res.statusCode = 301;
            res.end('');
            return;
          }
          servedFiles.add(fileKey);
          console.log(`[texlive] ✓ 200    ${fileKey} → served (pfb font)`);
        }

        // Catch /tex/null requests (internal TeX paths)
        if (url === '/tex/null' || url.endsWith('/tex/null')) {
          console.log(`[texlive] ✓ STUB   /tex/null → null stub`);
          res.setHeader('Content-Type', 'text/plain');
          res.end('% null stub file\n\\endinput\n');
          return;
        }

        next();
      });

      // Add endpoint to get summary
      server.middlewares.use((req, res, next) => {
        if (req.url === '/__texlive_summary') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            missing: Array.from(missingFiles).sort(),
            served: Array.from(servedFiles).sort(),
            missingCount: missingFiles.size,
            servedCount: servedFiles.size,
          }, null, 2));
          return;
        }
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __GIT_SHA__: JSON.stringify(GIT_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    tailwindcss(),
    texliveMiddleware(),
    versionMetaPlugin(),
    VitePWA({
      registerType: 'prompt',
      // SW-1: do NOT precache lib/**/* — that injected the entire engine tree
      // (TeX packages, fonts, pandoc.wasm; ~36 MB deployed) into the precache
      // manifest, bypassing maximumFileSizeToCacheInBytes and downloading it
      // all on first visit for users who never compile. The runtime
      // CacheFirst rules below cache engine assets on demand instead.
      // PNG icons are rasterized from icon.svg by scripts/generate-icons.mjs on
      // prebuild — one source of truth for the brand mark; the PNGs never drift.
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png'],
      manifest: {
        name: 'DonDocs - Naval Correspondence & Form Generator',
        short_name: 'DonDocs',
        description: 'Free SECNAV M-5216.5 correspondence & form generator for Navy/USMC. 20 document types — naval letters, memoranda, endorsements, NAVMC forms. PDF/DOCX export, 100% browser-based, works offline.',
        // Matches index.html's light theme-color meta (the manifest can't be
        // media-queried, so it carries the light value; the metas handle dark).
        theme_color: '#f1f6fa',
        // Android's install splash background — match the app canvas so launch
        // doesn't flash pure white before first paint.
        background_color: '#f1f6fa',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            // Dedicated safe-zone render (mark at 70% on full-bleed navy) — the
            // raw icon.svg's circle spans ~94% of the canvas and would be
            // cropped by circular/squircle launcher masks.
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // With registerType: 'prompt', vite-plugin-pwa handles skipWaiting via message
        // Do NOT add skipWaiting or clientsClaim here - they cause auto-reload
        // Reclaim retired runtime caches on activate (workbox only cleans its
        // own precache). public/sw-cleanup.js is served next to sw.js.
        importScripts: ['sw-cleanup.js'],
        // Increase limit for large JS bundles (SwiftLaTeX is ~9MB)
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB
        // SW-2: the app loads latex-templates.js?v=11 and swiftlatexpdftex.js?v=6;
        // without this, precache lookups miss on the ?v= param and offline
        // engine init fails despite the asset being cached.
        ignoreURLParametersMatching: [/^v$/],
        // NOTE: `html` intentionally NOT precached. Navigations go through the
        // NetworkFirst runtime rule below so users always get the latest app
        // shell on new tabs/sessions (see issue #31 — stale PWA cache kept
        // users stuck on old versions). Hashed JS/CSS bundles are still
        // precached so offline + subsequent loads stay fast.
        globPatterns: ['**/*.{js,css,ico,png,svg,woff,woff2}'],
        // Keep form template pages and thumbnails OUT of the precache manifest.
        // A catalog of any size would sweep hundreds of entries and megabytes
        // into every offline install via the png glob; they runtime-cache on
        // demand instead (form-templates rule below), the same lesson as the
        // lib/** exclusion (SW-1).
        globIgnores: ['templates/**'],
        // Don't fall back to a precached index.html — we want NetworkFirst.
        navigateFallback: null,
        // Precache critical TeX files to ensure they're always available
        // Use timestamp-based revision to ensure fresh fetch after deployment
        additionalManifestEntries: [
          { url: '/tex/null', revision: '2026-02-23' },
        ],
        // Cache TeX Live files for offline use
        runtimeCaching: [
          {
            // Engine core files at lib/ root (latex-templates.js,
            // swiftlatexpdftex.js/.wasm, pdf.worker*.mjs) — no longer
            // precached (SW-1), so cache on first use for offline reuse.
            urlPattern: /\/lib\/[^/]+$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'engine-core-cache-v1',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
          {
            // Form template pages + thumbnails: far too many to precache once a
            // catalog is imported. StaleWhileRevalidate — NOT CacheFirst — so a viewed form
            // still opens instantly offline (the air-gap promise for SIPR/JWICS),
            // yet a re-harvest that rewrites page*.pdf under the SAME filename
            // propagates on the next online load. CacheFirst here would pin the
            // old PDF bytes for 90 days while the box overlay (.json, SWR below)
            // updated independently — drifting text off its boxes on a form the
            // user already viewed. The two must revalidate on the same cadence.
            urlPattern: /\/templates\/.*\.(pdf|png)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'form-templates-cache-v2',
              expiration: { maxEntries: 2500, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Form configs + registry index: StaleWhileRevalidate so a viewed
            // form still opens offline, but a re-harvest/redeploy propagates on
            // the next online load instead of being pinned by CacheFirst.
            urlPattern: /\/templates\/.*\.json$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'form-configs-cache-v1',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // App shell (index.html): NetworkFirst so every new tab/session
            // gets the latest version if online. Falls back to cache after 3s
            // so offline/slow networks still load the app instantly.
            // This is the core fix for "updates don't reach users" (#31).
            //
            // The cache name is stamped per BUILD: the shell references hashed
            // bundles that live in the precache, and each new service worker
            // purges the previous precache on activation. An unversioned shell
            // cache could outlive its bundles — offline launch would render a
            // stale index.html whose scripts are gone (blank app). Versioning
            // means a freshly-activated SW starts with an empty shell cache and
            // can never serve a shell older than its own precache; the first
            // online navigation refills it. (Old shell caches are one ~10 KB
            // entry each; workbox only cleans precaches, so they linger — an
            // accepted cost.)
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: `dondocs-app-shell-${GIT_SHA || BUILD_TIME.replace(/[:.]/g, '-')}`,
              // Do NOT add fetchOptions here: workbox silently DROPS
              // fetchOptions for navigation requests (StrategyHandler.fetch,
              // workbox#1796 — fetch(navRequest, init) throws, so it passes
              // undefined). A `cache: 'no-store'` on this rule compiles into
              // sw.js and does nothing. The guard against the 1.2.95 vector
              // (SW's shell fetch satisfied by a stale browser HTTP cache
              // entry) is the ORIGIN: public/_headers serves "/" with
              // no-cache, must-revalidate, so a cached shell has zero
              // freshness and must revalidate before it can satisfy anything.
              // What we CAN harden here: never let a non-200 (error page,
              // redirect body, opaque response) be stored as the app shell.
              cacheableResponse: { statuses: [200] },
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days offline grace
              },
            },
          },
          {
            // Handle /tex/* paths (internal TeX file requests)
            urlPattern: /\/tex\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tex-internal-cache-v3', // v3: distribution/copyto/spacing changes
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              plugins: [
                {
                  // Reject HTML responses (Cloudflare SPA returns HTML for 404s)
                  cacheWillUpdate: async ({ response }) => {
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.includes('text/html')) {
                      console.warn('[SW] Rejecting HTML response for tex file');
                      return null;
                    }
                    return response;
                  },
                  fetchDidSucceed: async ({ response }) => {
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.includes('text/html')) {
                      console.warn('[SW] Returning 404 for HTML tex response');
                      return new Response('', { status: 404, statusText: 'Not Found' });
                    }
                    return response;
                  },
                },
              ],
            },
          },
          {
            urlPattern: /\/lib\/texlive\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'texlive-cache-v3', // v3: with HTML rejection plugin
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              plugins: [
                {
                  // Reject HTML responses (Cloudflare SPA returns HTML for 404s)
                  cacheWillUpdate: async ({ response }) => {
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.includes('text/html')) {
                      console.warn('[SW] Rejecting HTML response for texlive file');
                      return null; // Don't cache HTML
                    }
                    return response;
                  },
                  // Return 404 for HTML responses instead of passing them through
                  fetchDidSucceed: async ({ response }) => {
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.includes('text/html')) {
                      console.warn('[SW] Returning 404 for HTML texlive response');
                      return new Response('', { status: 404, statusText: 'Not Found' });
                    }
                    return response;
                  },
                },
              ],
            },
          },
          {
            // Pandoc assets (manifest + wasm parts + lua filter + reference
            // docx) — all same-origin since the air-gap vendoring. The cache
            // name is stamped with the pandoc release, so a version bump lands
            // on an empty cache and the manifest + every part are fetched fresh
            // together: no returning client can ever assemble a stale-part /
            // fresh-part mix from an unversioned CacheFirst URL. Retired caches
            // are reclaimed by public/sw-cleanup.js on activate.
            urlPattern: /\/lib\/pandoc\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: `pandoc-wasm-cache-${PANDOC_VERSION}`,
              expiration: {
                // manifest + 3 parts + dondocs.lua + reference.docx = 6 live
                // entries (pandoc.js and wasi-shim.js are precached).
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
              },
            },
          },
        ],
      },
    }),
  ],
  base: '/',
  server: {
    // Allow ngrok and other tunnel services
    host: true,
    allowedHosts: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    // Copy lib files to dist for production
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  },
})
