import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The browser compiles against a curated TeX Live bundle. A package the
// templates use must be in it, or the preview dies with a missing file where
// the compile matrix (a full TeX Live) sailed through.
describe('curated TeX Live bundle', () => {
  const bundle = readFileSync(join(process.cwd(), 'public', 'lib', 'texlive-packages.js'), 'utf8');

  it('carries every package the templates load', () => {
    const preamble = readFileSync(join(process.cwd(), 'tex', 'main.tex'), 'utf8');
    const loaded = Array.from(preamble.matchAll(/^\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/gm)).flatMap((m) => m[1].split(','));
    for (const pkg of loaded.map((p) => p.trim())) {
      expect(bundle, `${pkg}.sty is not in the bundle`).toMatch(new RegExp(`filename: '${pkg}\\.sty'`));
    }
  });

  it('carries longtable, which a technical publication\'s parts lists break with', () => {
    expect(bundle).toMatch(/filename: 'longtable\.sty'/);
  });
});
