import { describe, it, expect } from 'vitest';
// Importing is safe: vendor-assets.mjs has an execution guard, so no download runs.
import { planParts, PART_SIZE } from '../../scripts/vendor-assets.mjs';

const CLOUDFLARE_LIMIT = 25 * 1024 * 1024; // the per-file cap that killed PR #75
const PANDOC_WASM_BYTES = 58_379_729; // pandoc-wasm@1.0.1, pinned in the script

describe('planParts — the split that keeps every deployed file under 25MiB', () => {
  it('splits the real pandoc.wasm size into the expected three parts', () => {
    expect(planParts(PANDOC_WASM_BYTES)).toEqual([19_922_944, 19_922_944, 18_533_841]);
  });

  it('property: parts always sum to the total and each clears the Cloudflare limit', () => {
    for (const total of [1, PART_SIZE - 1, PART_SIZE, PART_SIZE + 1, PANDOC_WASM_BYTES, 100_000_000]) {
      const sizes = planParts(total);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(total);
      for (const s of sizes) {
        expect(s).toBeGreaterThan(0);
        expect(s).toBeLessThan(CLOUDFLARE_LIMIT);
      }
    }
  });

  it('a payload at exactly one part size yields a single part', () => {
    expect(planParts(PART_SIZE)).toEqual([PART_SIZE]);
  });

  it('rejects invalid inputs', () => {
    expect(() => planParts(0)).toThrow();
    expect(() => planParts(-5)).toThrow();
    expect(() => planParts(1.5)).toThrow();
    expect(() => planParts(100, 0)).toThrow();
  });

  it('reassembly identity: slicing a buffer per plan and concatenating restores it', () => {
    // Synthetic 1MB pseudo-random buffer, split with a small part size.
    const total = 1_000_003; // deliberately not a multiple
    const src = new Uint8Array(total);
    for (let i = 0; i < total; i++) src[i] = (i * 31 + 7) % 256;

    const sizes = planParts(total, 123_457);
    const parts: Uint8Array[] = [];
    let off = 0;
    for (const s of sizes) {
      parts.push(src.slice(off, off + s));
      off += s;
    }

    const merged = new Uint8Array(total);
    let w = 0;
    for (const p of parts) {
      merged.set(p, w);
      w += p.byteLength;
    }
    expect(w).toBe(total);
    expect(Buffer.from(merged).equals(Buffer.from(src))).toBe(true);
  });
});
