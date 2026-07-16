/**
 * The SSIC lookup rendered a hand-maintained 129-code subset while the full
 * 2,240-code M-5210.2 set sat in `ssic.json` imported by nothing — a search for
 * a real code like 11013 returned nothing. That subset also mislabeled its
 * major groups: it omitted General Material (10000), so every group above it
 * was shifted down one (Facilities filed as 10000, Civilian Personnel as
 * 11000) and an invented "Science and Technology" filled 12000.
 *
 * These tests pin both halves: the whole dataset is reachable, and each group
 * name matches the codes actually filed under it.
 */
import { describe, it, expect } from 'vitest';
import { loadSsicCategories, loadAllSsicCodes } from '@/data/ssicCodes';

describe('SSIC dataset', () => {
  it('exposes the full M-5210.2 set, not the old 129-code subset', async () => {
    const codes = await loadAllSsicCodes();
    expect(codes.length).toBeGreaterThan(2000);
  });

  it('finds codes that the old subset never carried', async () => {
    const codes = await loadAllSsicCodes();
    const byCode = new Map(codes.map((c) => [c.code, c]));
    // 11013 (Shore Station Construction) and 3120 were unreachable before.
    expect(byCode.get('11013')).toBeDefined();
    expect(byCode.get('3120')).toBeDefined();
  });

  it('keeps 9301, which lives only in the old curated list', async () => {
    const codes = await loadAllSsicCodes();
    expect(codes.find((c) => c.code === '9301')?.title).toBe('Aviation Policy');
  });

  it('keeps the hand-written descriptions on common codes', async () => {
    const codes = await loadAllSsicCodes();
    const byCode = new Map(codes.map((c) => [c.code, c]));
    expect(byCode.get('5216')?.description).toBe('Official correspondence and memoranda');
    expect(byCode.get('1000')?.description).toBeTruthy();
  });

  it('emits no duplicate codes', async () => {
    const codes = await loadAllSsicCodes();
    expect(new Set(codes.map((c) => c.code)).size).toBe(codes.length);
  });
});

describe('SSIC major groups', () => {
  it('files every code under the group matching its thousands digit', async () => {
    const categories = await loadSsicCategories();
    for (const category of categories) {
      const [start] = category.range.split('-').map(Number);
      for (const { code } of category.codes) {
        expect(Math.floor(parseInt(code, 10) / 1000) * 1000).toBe(start);
      }
    }
  });

  // The regression itself: these three were shifted, and 13000 was missing.
  it.each([
    ['10000-10999', 'General Material', '10120'], // Clothing and Uniforms
    ['11000-11999', 'Facilities and Activities', '11011'], // Real Estate
    ['12000-12999', 'Civilian Personnel', '12300'], // Employment
    ['13000-13999', 'Aeronautical and Astronautical Material', '13010'], // Aircraft Characteristics
  ])('names %s "%s" and files %s under it', async (range, name, sampleCode) => {
    const categories = await loadSsicCategories();
    const category = categories.find((c) => c.range === range);
    expect(category?.name).toBe(name);
    expect(category?.codes.some((c) => c.code === sampleCode)).toBe(true);
  });

  it('no longer advertises groups that are not in M-5210.2', async () => {
    const categories = await loadSsicCategories();
    const names = categories.map((c) => c.name);
    expect(names).not.toContain('Science and Technology');
  });

  it('sorts codes numerically within a group', async () => {
    const categories = await loadSsicCategories();
    const group = categories.find((c) => c.range === '1000-1999')!;
    const nums = group.codes.map((c) => parseInt(c.code, 10));
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
  });
});
