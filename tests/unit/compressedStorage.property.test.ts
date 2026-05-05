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
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  compressedStringify,
  compressedParse,
  compressedLocalStorage,
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
