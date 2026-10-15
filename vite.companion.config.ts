/**
 * The companion, built for Node.
 *
 * Two entries, `companion/mcp.ts` and `companion/server.ts`, bundled with
 * everything they import (the app's shared core, the MCP SDK, zod), so the
 * output runs on a machine with Node and nothing else. The render assets the
 * entries read from disk are copied beside them in the layout `assets.ts`
 * resolves: `companion/*.mjs` next to `lib/` and `attachments/`.
 *
 * Its own output directory, `dist-companion/`: the web build empties `dist/`,
 * and its CDN scan would trip on the SDK's bundled JSON-schema validator,
 * whose meta-schema ids name a public host as an identifier, not a fetch.
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import pkg from './package.json' with { type: 'json' };

const HERE = import.meta.dirname;
const OUT = resolve(HERE, 'dist-companion');

/** What the server reads at runtime, and nothing the browser build vendors for itself. */
const LIB_FILES = [
  'texlive', 'swiftlatexpdftex.js', 'swiftlatexpdftex.wasm', 'PdfTeXEngine.js',
  'latex-templates.js', 'texlive-packages.js', join('pandoc', 'dondocs.lua'), join('pandoc', 'reference.docx'),
];

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __GIT_SHA__: JSON.stringify(''), __BUILD_TIME__: JSON.stringify('') },
  resolve: { alias: { '@': resolve(HERE, 'src') } },
  publicDir: false,
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    target: 'node20',
    outDir: join(OUT, 'companion'),
    emptyOutDir: true,
    minify: false,
    rolldownOptions: {
      input: { mcp: resolve(HERE, 'companion/mcp.ts'), server: resolve(HERE, 'companion/server.ts') },
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs', banner: '#!/usr/bin/env node' },
    },
  },
  plugins: [{
    name: 'companion-assets',
    closeBundle() {
      cpSync(resolve(HERE, 'companion/engineWorker.mjs'), join(OUT, 'companion', 'engineWorker.mjs'));
      for (const dir of ['lib', 'attachments']) { rmSync(join(OUT, dir), { recursive: true, force: true }); }
      mkdirSync(join(OUT, 'lib', 'pandoc'), { recursive: true });
      for (const file of LIB_FILES) {
        cpSync(resolve(HERE, 'public/lib', file), join(OUT, 'lib', file), { recursive: true });
      }
      cpSync(resolve(HERE, 'public/attachments'), join(OUT, 'attachments'), { recursive: true });
    },
  }],
});
