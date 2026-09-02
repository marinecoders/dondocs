import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The browser compiles against a curated TeX Live bundle. A package the
// templates use must be in it, or the preview dies with a missing file where
// the compile matrix (a full TeX Live) sailed through.
describe('curated TeX Live bundle', () => {
  const bundle = readFileSync(join(process.cwd(), 'public', 'lib', 'texlive-packages.js'), 'utf8');

  // Two stores: the bundle every browser preloads, and the on-disk tree the
  // engine pulls a missing package from -- the browser over the network, the
  // companion's Node engine straight off disk. A package must be in both.
  const loaded = Array.from(
    readFileSync(join(process.cwd(), 'tex', 'main.tex'), 'utf8').matchAll(/^\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/gm),
  ).flatMap((m) => m[1].split(',')).map((p) => p.trim());

  it('carries every package the templates load', () => {
    for (const pkg of loaded) {
      expect(bundle, `${pkg}.sty is not in the bundle`).toMatch(new RegExp(`filename: '${pkg}\\.sty'`));
    }
  });

  it('has every package the templates load in the on-disk tree as well', () => {
    for (const pkg of loaded) {
      expect(existsSync(join(process.cwd(), 'public', 'lib', 'texlive', 'pdftex', '27', `${pkg}.sty`)), `${pkg}.sty is not in public/lib/texlive`).toBe(true);
    }
  });

  it('carries longtable, which a technical publication\'s parts lists break with', () => {
    expect(bundle).toMatch(/filename: 'longtable\.sty'/);
  });
});
