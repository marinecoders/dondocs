import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The browser compiles against a curated TeX Live bundle. A package the
// templates use must be in it, or the preview dies with a missing file where
// the compile matrix (a full TeX Live) sailed through.
describe('curated TeX Live bundle', () => {
  // Evaluate the bundle the way the engine loads it and read the array the
  // engine preloads. Grepping the file for a filename once passed on an entry
  // that had been appended into a different array -- every document then
  // failed in every browser while the test stayed green.
  const packages = (() => {
    const src = readFileSync(join(process.cwd(), 'public', 'lib', 'texlive-packages.js'), 'utf8');
    const window: Record<string, unknown> = {};
    new Function('window', src)(window);
    return window.TEXLIVE_PACKAGES as Array<{ format: number; filename: string; content: string }>;
  })();
  // Each package sits in the array under two format numbers. The engine
  // asks for a style file under 26; an entry only under 27 is never found.
  const carries = (file: string) => packages.some((p) => p.format === 26 && p.filename === file);

  // Two stores: the bundle every browser preloads, and the on-disk tree the
  // engine pulls a missing package from -- the browser over the network, the
  // companion's Node engine straight off disk. A package must be in both.
  // The browser asks for a style file under pdftex/26/, the same format
  // number the preload lookup uses.
  const loaded = Array.from(
    readFileSync(join(process.cwd(), 'tex', 'main.tex'), 'utf8').matchAll(/^\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/gm),
  ).flatMap((m) => m[1].split(',')).map((p) => p.trim());

  it('carries every package the templates load', () => {
    for (const pkg of loaded) {
      expect(carries(`${pkg}.sty`), `${pkg}.sty is not in TEXLIVE_PACKAGES`).toBe(true);
    }
  });

  it('has every package the templates load in the on-disk tree as well', () => {
    for (const pkg of loaded) {
      expect(existsSync(join(process.cwd(), 'public', 'lib', 'texlive', 'pdftex', '26', `${pkg}.sty`)), `${pkg}.sty is not in public/lib/texlive`).toBe(true);
    }
  });

  it('carries longtable, which a technical publication\'s parts lists break with', () => {
    expect(carries('longtable.sty')).toBe(true);
  });
});
