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
      includeAssets: ['icon.svg', 'lib/**/*'],
      manifest: {
        name: 'DonDocs - Naval Correspondence & Form Generator',
        short_name: 'DonDocs',
        description: 'Free SECNAV M-5216.5 correspondence & form generator for Navy/USMC. 20 document types — naval letters, memoranda, endorsements, NAVMC forms. PDF/DOCX export, 100% browser-based, works offline.',
        theme_color: '#1a365d',
        background_color: '#ffffff',
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
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // With registerType: 'prompt', vite-plugin-pwa handles skipWaiting via message
        // Do NOT add skipWaiting or clientsClaim here - they cause auto-reload
        // Increase limit for large JS bundles (SwiftLaTeX is ~9MB)
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB
        // NOTE: `html` intentionally NOT precached. Navigations go through the
        // NetworkFirst runtime rule below so users always get the latest app
        // shell on new tabs/sessions (see issue #31 — stale PWA cache kept
        // users stuck on old versions). Hashed JS/CSS bundles are still
        // precached so offline + subsequent loads stay fast.
        globPatterns: ['**/*.{js,css,ico,png,svg,woff,woff2}'],
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
            // App shell (index.html): NetworkFirst so every new tab/session
            // gets the latest version if online. Falls back to cache after 3s
            // so offline/slow networks still load the app instantly.
            // This is the core fix for "updates don't reach users" (#31).
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'dondocs-app-shell-v1',
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
            // Cache pandoc WASM files for offline DOCX generation
            urlPattern: /\/lib\/pandoc\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pandoc-wasm-cache-v1',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
              },
            },
          },
          {
            // Cache the Pandoc WASM binary fetched from unpkg by pandoc.js
            // (`https://unpkg.com/pandoc-wasm@1.0.1/src/pandoc.wasm`, ~58 MB).
            // Without this rule, only the browser's HTTP cache would protect
            // against re-downloading after the user clears site data or after
            // the browser cache evicts under pressure. With workbox's 90-day
            // CacheFirst, the bytes survive across sessions and the
            // `usePandocIdlePrefetch` warm-up is durable.
            urlPattern: /^https:\/\/unpkg\.com\/pandoc-wasm@/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pandoc-wasm-cdn-cache-v1',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
              },
              cacheableResponse: {
                // unpkg returns 200 for cache hits; opaque (0) responses
                // can occur for cross-origin requests without CORS, but
                // unpkg sets CORS headers so we should always get 200.
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache the WASI shim that pandoc.js imports from jsdelivr
            // (`https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@.../index.js`,
            // ~50 KB). Same rationale as the unpkg rule above.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@bjorn3\/browser_wasi_shim/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'wasi-shim-cdn-cache-v1',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
              },
              cacheableResponse: {
                statuses: [0, 200],
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
