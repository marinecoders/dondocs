import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { newSl4Part, type Sl4Row } from '@/data/techpub/sl4';
import { paginateSl4Rows } from '@/lib/sl4Pagination';

const parts = (count: number) => Array.from({ length: count }, (_, i) => newSl4Part(String(i)));
const heading: Sl4Row = { kind: 'heading', id: 'heading', text: 'Group', portionMarking: 'U' };

describe('SL-4 eighteen-row sheet planning', () => {
  it('counts headings and blank rows while leaving a short final sheet unpadded', () => {
    const rows: Sl4Row[] = [heading, ...parts(16), { kind: 'blank', id: 'blank' }, newSl4Part('last')];
    const pages = paginateSl4Rows(rows);
    expect(pages.map((page) => page.length)).toEqual([18, 1]);
    expect(pages.flat()).toEqual(rows);
  });

  it('moves a parent at row eighteen together with its first child', () => {
    const rows = [...parts(17), newSl4Part('parent'), { ...newSl4Part('child'), parentId: 'parent' }];
    expect(paginateSl4Rows(rows).map((page) => page.map((row) => row.id))).toEqual([rows.slice(0, 17).map((r) => r.id), ['parent', 'child']]);
  });

  it('allows a continuing group after its parent and first child share a sheet', () => {
    const rows = [newSl4Part('parent'), ...parts(30).map((part) => ({ ...part, parentId: 'parent' }))];
    expect(paginateSl4Rows(rows).map((page) => page.length)).toEqual([18, 13]);
  });

  it('keeps nested parent starts together across a boundary', () => {
    const rows = [...parts(16), newSl4Part('parent'), { ...newSl4Part('child'), parentId: 'parent' }, { ...newSl4Part('grandchild'), parentId: 'child' }];
    expect(paginateSl4Rows(rows).map((page) => page.length)).toEqual([16, 3]);
  });

  it('does not leave headings or a parent plus intervening blanks at the bottom', () => {
    const rows = [...parts(17), heading, newSl4Part('last')];
    expect(paginateSl4Rows(rows).map((page) => page.length)).toEqual([17, 2]);
    const withBlank: Sl4Row[] = [...parts(16), newSl4Part('parent'), { kind: 'blank', id: 'blank' }, { ...newSl4Part('child'), parentId: 'parent' }];
    expect(paginateSl4Rows(withBlank).map((page) => page.length)).toEqual([16, 3]);
  });

  it('refuses an unbreakable parent chain rather than exceeding its capacity', () => {
    const rows = [newSl4Part('a'), { ...newSl4Part('b'), parentId: 'a' }, { ...newSl4Part('c'), parentId: 'b' }];
    expect(() => paginateSl4Rows(rows, 2)).toThrow('cannot fit');
  });

  it('refuses invalid hierarchy and capacities before making sheets', () => {
    expect(() => paginateSl4Rows([{ ...newSl4Part('a'), parentId: 'missing' }])).toThrow('hierarchy');
    for (const capacity of [0, 19, 2.5, NaN, Infinity]) expect(() => paginateSl4Rows([], capacity)).toThrow('capacity');
    expect(paginateSl4Rows(parts(2), 1).map((page) => page.length)).toEqual([1, 1]);
    expect(paginateSl4Rows([])).toEqual([]);
  });

  it('does not mutate, drop, duplicate or renumber rows at any supported capacity', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 1, max: 18 }), (count, capacity) => {
      const rows = parts(count), original = structuredClone(rows);
      const pages = paginateSl4Rows(rows, capacity);
      expect(pages.flat()).toEqual(original);
      expect(pages.every((page) => page.length > 0 && page.length <= capacity)).toBe(true);
      expect(rows).toEqual(original);
    }), { seed: 521517, numRuns: 100 });
  });
});
