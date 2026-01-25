import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import fs from 'fs'
import type { Plugin } from 'vite'

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
  plugins: [
    react(),
    tailwindcss(),
    texliveMiddleware(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'lib/**/*'],
      manifest: {
        name: 'Naval Correspondence Generator',
        short_name: 'NavCorr',
        description: 'Generate SECNAV M-5216.5 compliant Naval correspondence with batch processing',
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Precache critical TeX files to ensure they're always available
        // Use timestamp-based revision to ensure fresh fetch after deployment
        additionalManifestEntries: [
          { url: '/tex/null', revision: '2026-01-12' },
        ],
        // Cache TeX Live files for offline use
        runtimeCaching: [
          {
            // Handle /tex/* paths (internal TeX file requests)
            urlPattern: /\/tex\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tex-internal-cache-v2', // v2: invalidate stale HTML responses
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
