import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// Importing is safe: generate-icons.mjs has an execution guard, so no rendering runs.
import { TARGETS } from '../../scripts/generate-icons.mjs';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf-8');

/**
 * The icons exist only as generated files, referenced by NAME from three
 * places that ship independently of the generator. Renaming a TARGETS entry
 * (or an entry in any consumer) would 404 an install icon silently — nothing
 * at build time cross-checks the strings. This locks them in sync, the same
 * way "pdf worker in sync" guards the vendored worker.
 */
describe('generated icons stay in sync with their consumers', () => {
  const targetFiles = TARGETS.map((t: { file: string }) => t.file);

  it('every generated icon is registered in the PWA manifest config (vite.config.ts)', () => {
    const vite = read('vite.config.ts');
    for (const file of targetFiles) {
      expect(vite, `${file} missing from vite.config.ts includeAssets/icons`).toContain(file);
    }
  });

  it('index.html links the apple-touch-icon the script actually generates', () => {
    const html = read('index.html');
    expect(targetFiles).toContain('apple-touch-icon.png');
    expect(html).toContain('href="/apple-touch-icon.png"');
  });

  it('every generated icon is gitignored (build artifact, never committed)', () => {
    const gitignore = read('.gitignore');
    for (const file of targetFiles) {
      expect(gitignore, `${file} missing from .gitignore`).toContain(`public/${file}`);
    }
  });

  it('the manifest never references an icon the script does not generate', () => {
    const vite = read('vite.config.ts');
    // Every png icon named in the config must be produced by TARGETS.
    const referenced = [...vite.matchAll(/'((?:apple-touch-icon|pwa-)[\w-]*\.png)'/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const file of referenced) {
      expect(targetFiles, `vite.config.ts references ${file}, which generate-icons.mjs does not produce`).toContain(file);
    }
  });
});
