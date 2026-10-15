/**
 * The letter card, built for the sandbox a host renders MCP Apps in.
 *
 * One script, with the App bridge and pdf.js (worker module included, since
 * the sandbox allows no worker) bundled in, inlined into the page template
 * as a single self-contained file: `dist-companion/companion/app/letter.html`,
 * beside the built entry that serves it as the `ui://dondocs/letter.html`
 * resource. Run after `vite.companion.config.ts`, which empties the parent.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

const HERE = import.meta.dirname;
const OUT = resolve(HERE, 'dist-companion', 'companion', 'app');

export default defineConfig({
  define: {
    // The build time names the page in the host's console log, where a
    // stale copy is otherwise indistinguishable from the one just installed.
    __APP_VERSION__: JSON.stringify(pkg.version), __GIT_SHA__: JSON.stringify(''), __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    // pdf.js reads its own script URL to locate a worker file; there is none to locate.
    'import.meta.url': 'undefined',
  },
  publicDir: false,
  build: {
    outDir: OUT,
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    lib: { entry: resolve(HERE, 'companion/app/letter.ts'), formats: ['iife'], name: 'DonDocsLetter', fileName: () => 'letter.js' },
    rolldownOptions: { output: { inlineDynamicImports: true } },
  },
  plugins: [{
    name: 'inline-page',
    closeBundle() {
      const script = readFileSync(join(OUT, 'letter.js'), 'utf-8');
      const template = readFileSync(resolve(HERE, 'companion/app/template.html'), 'utf-8');
      if (!template.includes('<!-- letter.js -->')) { throw new Error('template.html has no <!-- letter.js --> slot'); }
      // The script is data inside a script element: only a closing tag could
      // break out. A replacer function, not a string: a string replacement
      // reads `$&` and `$'` as patterns, and a minified bundle is full of them.
      const page = template.replace('<!-- letter.js -->', () => `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>`);
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, 'letter.html'), page);
      rmSync(join(OUT, 'letter.js'));
    },
  }],
});
