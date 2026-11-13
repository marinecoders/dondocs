import { describe, expect, it } from 'vitest';
import { normalizeBodyDate } from '@/lib/bodyDateFormatting';
import { normalizeDate } from '@/lib/dateFormatting';

describe('explicit body-date calendar years', () => {
  it.each([
    ['10 Nov 1775', '10 November 1775', 'November 10, 1775'],
    ['01 Jan 1900', '1 January 1900', 'January 1, 1900'],
    ['5 Nov 2100', '5 November 2100', 'November 5, 2100'],
    ['November 10, 1775', '10 November 1775', 'November 10, 1775'],
    ['29 Feb 2000', '29 February 2000', 'February 29, 2000'],
    ['29 Feb 2400', '29 February 2400', 'February 29, 2400'],
    ['01 Jan 0001', '1 January 0001', 'January 1, 0001'],
    ['31 Dec 9999', '31 December 9999', 'December 31, 9999'],
  ])('preserves the exact known year in %j', (before, military, civilian) => {
    expect(normalizeBodyDate(before, 'military')).toBe(military);
    expect(normalizeBodyDate(before, 'civilian')).toBe(civilian);
    expect(normalizeBodyDate(military, 'military')).toBe(military);
    expect(normalizeBodyDate(civilian, 'civilian')).toBe(civilian);
  });
  it.each(['29 Feb 1775', '29 Feb 1900', '29 Feb 2100', '31 Apr 2026', '1 Jan 0000', '1 Jan 10000',
    '10 Nov 75', 'November 10, 75', '03/04/1775', '1775-11-10', '10 Nov\n1775'])('does not infer or repair %j', before => {
    expect(normalizeBodyDate(before, 'military')).toBeNull();
    expect(normalizeBodyDate(before, 'civilian')).toBeNull();
  });
  it('does not change the shipped header-date year policy', () => {
    expect(normalizeDate('10 Nov 1775', 'military')).toBeNull();
    expect(normalizeDate('1 Jan 1900', 'military')).toBeNull();
    expect(normalizeDate('1 Jan 2100', 'spelled')).toBeNull();
  });
});
