import { defineConfig, mergeConfig, type ViteDevServer } from 'vite';
import base from './vite.config.ts';
import { OFFICE_FONT_CONTENT_TYPE, OFFICE_FONT_URL } from './src/services/officeFonts.ts';
import { readLocalOfficeFontAssets } from './scripts/localOfficeFontAssets.ts';

export default defineConfig(({ command, isPreview }) => {
  if (command !== 'serve' || isPreview) throw new Error('The local font profile is for Vite development only.');
  const assets = new Map(Object.entries(readLocalOfficeFontAssets()).map(([name, bytes]) => [OFFICE_FONT_URL + name, bytes]));
  return mergeConfig(base, {
    define: { 'import.meta.env.VITE_LOCAL_OFFICE_FONTS': JSON.stringify('1') },
    server: { host: '127.0.0.1', strictPort: true, cors: false, watch: { ignored: ['**/public/tex/**', '**/public/lib/texlive/**'] } },
    plugins: [{
      name: 'dondocs-local-office-fonts',
      configureServer(server: ViteDevServer) {
        if (server.config.server.host !== '127.0.0.1') throw new Error('Bind the local font profile to 127.0.0.1.');
        server.middlewares.use((req, res, next) => {
          const asset = req.method === 'GET' && req.url ? assets.get(req.url) : undefined;
          if (!asset) return next();
          if (req.headers.host !== `127.0.0.1:${server.config.server.port ?? 5173}`
            || req.headers['sec-fetch-site'] === 'cross-site') {
            res.statusCode = 403;
            return res.end();
          }
          res.setHeader('Content-Type', OFFICE_FONT_CONTENT_TYPE);
          res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
          res.setHeader('Cache-Control', 'no-store');
          return res.end(asset);
        });
      },
    }],
  });
});
