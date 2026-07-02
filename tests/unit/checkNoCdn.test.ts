import { describe, it, expect } from 'vitest';
// Safe to import: check-no-cdn.mjs has an execution guard, so no dist scan runs.
import { findCdnHits, FORBIDDEN } from '../../scripts/check-no-cdn.mjs';

describe('findCdnHits — the air-gap regression detector', () => {
  it('flags every forbidden host with the right line number', () => {
    for (const host of FORBIDDEN) {
      const text = `line one\nconst url = "https://${host}/some/asset.js";\nline three`;
      expect(findCdnHits(text)).toEqual([{ host, line: 2 }]);
    }
  });

  it('reports multiple hits across lines', () => {
    const text = 'import x from "https://cdn.jsdelivr.net/a.js";\nok\nfetch("https://unpkg.com/b.wasm");';
    expect(findCdnHits(text)).toEqual([
      { host: 'cdn.jsdelivr.net', line: 1 },
      { host: 'unpkg.com', line: 3 },
    ]);
  });

  it('clean text produces no hits', () => {
    const text = 'const wasmUrl = new URL("./pandoc.wasm.part0", import.meta.url);\nfetch("/lib/pandoc/pandoc.wasm.manifest.json");';
    expect(findCdnHits(text)).toEqual([]);
  });
});
