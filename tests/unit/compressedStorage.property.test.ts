/**
 * Property tests for `src/lib/compressedStorage.ts`.
 *
 * The compression layer sits between Zustand's persist middleware and
 * localStorage. A bug here either:
 *   - silently corrupts every saved session (round-trip failure), or
 *   - rejects legacy plain-JSON sessions on upgrade (compat failure)
 *
 * Both modes are covered: the round-trip property fuzzes random
 * JSON-serializable shapes, and the legacy-compat case pins down a
 * known-good pre-compression string.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import pako from 'pako';
import {
  compressedStringify,
  compressedParse,
  compressedLocalStorage,
  safeLocalStorage,
  lastWriteFailed,
} from '@/lib/compressedStorage';

const COMPRESSED_PREFIX = 'gz:';

const jsonValueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    tie('object'),
    tie('array'),
  ),
  object: fc.dictionary(fc.string(), tie('value'), { maxKeys: 5 }),
  array: fc.array(tie('value'), { maxLength: 5 }),
})).value;

describe('compressedStringify + compressedParse — round-trip', () => {
  it('round-trips primitive values', () => {
    expect(compressedParse(compressedStringify('hello'))).toBe('hello');
    expect(compressedParse(compressedStringify(42))).toBe(42);
    expect(compressedParse(compressedStringify(true))).toBe(true);
    expect(compressedParse(compressedStringify(null))).toBe(null);
  });

  it('round-trips objects', () => {
    const data = { name: 'Smith', rank: 'SSgt' };
    expect(compressedParse(compressedStringify(data))).toEqual(data);
  });

  it('round-trips arrays', () => {
    const data = [1, 2, 3, { nested: true }];
    expect(compressedParse(compressedStringify(data))).toEqual(data);
  });

  it('round-trips a typical document-shaped object', () => {
    // A representative session payload — the bigger and more
    // repetitive the data, the more compression matters.
    const session = {
      version: '1.1.31',
      formData: {
        from: 'SSgt John A. Smith 1234567890/0311 USMC',
        subject: 'FORMAL COUNSELING - PFT FAILURE',
        unitAddress: 'PSC BOX 8050, CHERRY POINT, NC 28533-0050',
      },
      paragraphs: Array.from({ length: 20 }, (_, i) => ({
        level: i % 3,
        text: `Paragraph number ${i + 1}: lorem ipsum dolor sit amet`,
      })),
    };
    expect(compressedParse(compressedStringify(session))).toEqual(session);
  });

  it('round-trips arbitrary JSON-serializable values (property)', () => {
    fc.assert(
      fc.property(jsonValueArb, (value) => {
        const round = compressedParse(compressedStringify(value));
        expect(round).toEqual(value);
      }),
      { numRuns: 200 }
    );
  });
});

describe('compressedParse — backward compatibility with plain JSON', () => {
  it('parses legacy plain-JSON values written before compression was enabled', () => {
    // Pre-compression values have no `gz:` prefix and are just JSON.
    // The parse path detects this and falls through to JSON.parse.
    const legacy = JSON.stringify({ legacy: true });
    expect(compressedParse(legacy)).toEqual({ legacy: true });
  });

  it('parses a plain-JSON value even if it happens to start with `gz`', () => {
    // The full prefix is `gz:` (with colon), so a JSON value that
    // happens to start with `gz` (without colon) must NOT be misread
    // as compressed. Edge case in the prefix detection.
    const tricky = JSON.stringify('gz-not-a-prefix');
    expect(compressedParse(tricky)).toBe('gz-not-a-prefix');
  });
});

describe('compressedStringify — output shape', () => {
  it('uses compressed form for repetitive payloads (>= ~50 bytes)', () => {
    const large = JSON.stringify(Array.from({ length: 50 }, (_, i) => `item-${i}`));
    const out = compressedStringify(JSON.parse(large));
    expect(out.startsWith(COMPRESSED_PREFIX)).toBe(true);
  });

  it('falls back to plain JSON for very small payloads (compression overhead)', () => {
    // A single integer is tiny; deflate + base64 overhead dwarfs the
    // savings and the fallback kicks in.
    const out = compressedStringify(42);
    expect(out.startsWith(COMPRESSED_PREFIX)).toBe(false);
    expect(out).toBe('42');
  });

  it('output of compressed form is shorter than input JSON for repetitive data', () => {
    // The whole point of compression — a 1KB+ repetitive payload
    // should fit in a fraction of the original size.
    const repetitive = {
      data: Array.from({ length: 100 }, () => 'AAAAAAAAAAAAAAAAAAAA'),
    };
    const json = JSON.stringify(repetitive);
    const compressed = compressedStringify(repetitive);
    expect(compressed.length).toBeLessThan(json.length);
  });
});

describe('compressedLocalStorage — Zustand StateStorage adapter', () => {
  it('round-trip via the storage adapter', () => {
    compressedLocalStorage.setItem('test-key', JSON.stringify({ a: 1 }));
    const retrieved = compressedLocalStorage.getItem('test-key');
    expect(JSON.parse(retrieved as string)).toEqual({ a: 1 });
    compressedLocalStorage.removeItem('test-key');
  });

  it('removeItem clears the value', () => {
    compressedLocalStorage.setItem('test-key', JSON.stringify({ a: 1 }));
    compressedLocalStorage.removeItem('test-key');
    expect(compressedLocalStorage.getItem('test-key')).toBeNull();
  });

  it('getItem returns null for unknown keys', () => {
    expect(compressedLocalStorage.getItem('definitely-not-set')).toBeNull();
  });
});

describe('compressedLocalStorage — quota and corruption safety', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('rethrows a quota error exactly once, without retrying the larger plain value', () => {
    const quota = new DOMException('full', 'QuotaExceededError');
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw quota;
    });
    // Restore in finally rather than via afterEach: restoreAllMocks doesn't
    // reliably un-spy a host object's method across all runtimes, and a leaked
    // throwing setItem would break the next test.
    try {
      // A repetitive payload so the compressed branch is what's attempted first.
      const value = JSON.stringify({ data: Array.from({ length: 200 }, () => 'AAAAAAAAAAAAAAAA') });

      expect(() => compressedLocalStorage.setItem('k', value)).toThrow();
      // The old code caught the quota error and retried with the larger plain
      // value (a second throwing write); the fix writes exactly once and rethrows.
      expect(setSpy).toHaveBeenCalledTimes(1);
    } finally {
      setSpy.mockRestore();
    }
  });

  it('getItem returns null for a truncated/corrupt gz payload instead of throwing', () => {
    // 'gz:' alone inflates to "" — would crash downstream JSON.parse if returned.
    localStorage.setItem('empty-gz', 'gz:');
    expect(compressedLocalStorage.getItem('empty-gz')).toBeNull();
    // Valid base64 ("hello") but not a deflate stream — pako rejects the zlib
    // header. (Avoid invalid-base64 input, whose atob handling differs by runtime.)
    localStorage.setItem('bad-gz', 'gz:aGVsbG8=');
    expect(compressedLocalStorage.getItem('bad-gz')).toBeNull();
  });

  it('STASHES the raw corrupt payload at `<name>.corrupt` before resetting', () => {
    // The whole point of the stash: a corrupt read returns null (store falls back
    // to defaults), but the very next persist write would overwrite the only copy
    // of the user's data. The raw bytes must be preserved for recovery first.
    const raw = 'gz:aGVsbG8=';
    localStorage.setItem('doc-key', raw);
    expect(compressedLocalStorage.getItem('doc-key')).toBeNull();
    expect(localStorage.getItem('doc-key.corrupt')).toBe(raw);
  });

  it('survives corruption even when the recovery stash write itself fails', () => {
    // Worst case: corrupt payload AND localStorage is full, so the `.corrupt`
    // stash can't be written. getItem must still return null, never throw.
    localStorage.setItem('doc-key2', 'gz:aGVsbG8=');
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      expect(compressedLocalStorage.getItem('doc-key2')).toBeNull();
    } finally {
      setSpy.mockRestore();
    }
  });
});

describe('compressedStringify — deflate failure falls back to plain JSON', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns valid, parseable plain JSON when pako.deflate throws', () => {
    vi.spyOn(pako, 'deflate').mockImplementation(() => {
      throw new Error('deflate blew up');
    });
    const value = { a: 1, b: 'hello', c: [1, 2, 3] };
    const out = compressedStringify(value);
    expect(out.startsWith('gz:')).toBe(false); // plain JSON, not compressed
    expect(compressedParse(out)).toEqual(value); // still round-trips
  });
});

describe('safeLocalStorage — never throws; tracks durability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('swallows a SecurityError (blocked site data / private mode) on write and flags it', () => {
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      // Must NOT throw — a persisted store's set() escaping would crash boot.
      expect(() => safeLocalStorage.setItem('pref', 'v')).not.toThrow();
      expect(lastWriteFailed('pref')).toBe(true);
    } finally {
      setSpy.mockRestore();
    }
    // A later successful write clears the failed flag — the durability claim heals.
    safeLocalStorage.setItem('pref', 'v2');
    expect(lastWriteFailed('pref')).toBe(false);
  });

  it('getItem returns null (not throw) when reading is blocked', () => {
    const getSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      expect(safeLocalStorage.getItem('anything')).toBeNull();
    } finally {
      getSpy.mockRestore();
    }
  });
});
