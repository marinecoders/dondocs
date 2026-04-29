/**
 * Tests for the small utility modules:
 *   - `src/lib/utils.ts` (cn)
 *   - `src/services/docx/layout-config.ts`
 *
 * `cn` is the className-merging primitive used by every component in the
 * app — a regression here breaks every Tailwind class composition. The
 * layout-config table is the source of truth for SECNAV column widths,
 * fed into both the LaTeX → DOCX pipeline and the LaTeX generator
 * itself.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { cn } from '@/lib/utils';
import { LAYOUT, TEXT_WIDTH_IN, layoutToMetadata } from '@/services/docx/layout-config';

describe('cn — className merger', () => {
  it('basic concatenation', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('falsy inputs are dropped', () => {
    expect(cn('foo', null, undefined, false, 'bar')).toBe('foo bar');
  });

  it('conflicting Tailwind classes resolve to the last one', () => {
    // tailwind-merge dedupes conflicting utilities — this is the
    // whole reason `cn` exists rather than just calling clsx.
    expect(cn('p-2 p-4')).toBe('p-4');
    expect(cn('text-red-500 text-blue-500')).toBe('text-blue-500');
  });

  it('object syntax (clsx feature) works', () => {
    expect(cn({ foo: true, bar: false })).toBe('foo');
  });

  it('arrays are flattened', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar');
  });

  it('never throws on garbage input', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.string(),
            fc.constant(null),
            fc.constant(undefined),
            fc.boolean(),
            fc.dictionary(fc.string(), fc.boolean())
          )
        ),
        (inputs) => {
          // @ts-expect-error — fast-check generators don't perfectly
          // match clsx's `ClassValue` union, but the runtime behavior
          // we're testing is "never throws" which doesn't depend on
          // the type fidelity.
          cn(...inputs);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('empty input returns empty string', () => {
    expect(cn()).toBe('');
  });
});

describe('LAYOUT — SECNAV column proportions', () => {
  it('every block is a record of fractions in [0, 1]', () => {
    for (const [block, cols] of Object.entries(LAYOUT)) {
      for (const [colName, value] of Object.entries(cols)) {
        expect(typeof value, `${block}.${colName}`).toBe('number');
        expect(value as number, `${block}.${colName} ≥ 0`).toBeGreaterThanOrEqual(0);
        expect(value as number, `${block}.${colName} ≤ 1`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('letterhead columns sum to 1 (3-col seal | center | spacer)', () => {
    const total =
      LAYOUT.letterhead.sealCol +
      LAYOUT.letterhead.centerCol +
      LAYOUT.letterhead.spacerCol;
    expect(total).toBeCloseTo(1, 3);
  });

  it('every 2-col block sums to 1', () => {
    const blocks: Array<[string, { leftCol?: number; rightCol?: number; labelCol?: number; contentCol?: number }]> = [
      ['ssic', LAYOUT.ssic],
      ['address', LAYOUT.address],
      ['copyTo', LAYOUT.copyTo],
      ['signature', LAYOUT.signature],
      ['dualSignature', LAYOUT.dualSignature],
    ];
    for (const [name, b] of blocks) {
      const total = (b.leftCol ?? b.labelCol!) + (b.rightCol ?? b.contentCol!);
      expect(total, `${name} sum`).toBeCloseTo(1, 3);
    }
  });

  it('TEXT_WIDTH_IN is the SECNAV-canonical 6.5"', () => {
    expect(TEXT_WIDTH_IN).toBe(6.5);
  });
});

describe('layoutToMetadata', () => {
  it('returns a flat record of stringified numbers', () => {
    const meta = layoutToMetadata();
    for (const [key, value] of Object.entries(meta)) {
      expect(typeof value, `${key}`).toBe('string');
      // Each value parses as a finite number in [0, 1].
      const n = Number(value);
      expect(Number.isFinite(n), `${key} should be a finite number string`).toBe(true);
      expect(n, `${key} ≥ 0`).toBeGreaterThanOrEqual(0);
      expect(n, `${key} ≤ 1`).toBeLessThanOrEqual(1);
    }
  });

  it('includes all the expected pandoc metadata keys', () => {
    const meta = layoutToMetadata();
    const expectedKeys = [
      'lh-seal',
      'lh-center',
      'lh-spacer',
      'ssic-left',
      'ssic-right',
      'addr-label',
      'addr-content',
      'copyto-label',
      'copyto-content',
      'sig-left',
      'sig-right',
      'dual-sig-left',
      'dual-sig-right',
    ];
    for (const key of expectedKeys) {
      expect(meta).toHaveProperty(key);
    }
  });

  it('values are rounded to 3 decimal places (matches pandoc precision)', () => {
    const meta = layoutToMetadata();
    for (const [key, value] of Object.entries(meta)) {
      // Format: "N.NNN" — at most 3 digits after the decimal point.
      expect(value, `${key} should match /^\\d+\\.\\d{3}$/`).toMatch(/^\d+\.\d{3}$/);
    }
  });
});
