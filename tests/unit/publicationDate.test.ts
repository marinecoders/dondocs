import { describe, it, expect } from 'vitest';
import { formatPublicationDate, lastWorkingDay, validatePublicationDate } from '@/lib/publicationDate';
import { validateMajorItemsOrder } from '@/lib/majorItemsOrder';
import { validateTimeComplianceParagraph } from '@/lib/timeCompliance';

describe('publication date', () => {
  it('prints the stored correspondence date in full', () => {
    expect(formatPublicationDate('15 Dec 24')).toBe('15 December 2024');
    expect(formatPublicationDate('not a date')).toBe('not a date');
  });

  it('finds the last weekday of a month', () => {
    // 31 May 2025 is a Saturday; the last working day is Friday the 30th.
    expect(lastWorkingDay(new Date(2025, 4, 10)).getDate()).toBe(30);
    expect(lastWorkingDay(new Date(2025, 3, 10)).getDate()).toBe(30); // 30 April 2025, a Wednesday
  });

  it('asks for the last working day of the month, and says which it is', () => {
    expect(validatePublicationDate('30 Apr 25')).toEqual([]);
    expect(validatePublicationDate('15 Dec 24')[0].message).toMatch(/31 December 2024 for December 2024/);
    expect(validatePublicationDate('')).toEqual([]);
  });
});

describe('major items order', () => {
  const row = (id: string) => ({ values: { id } });
  it('accepts ascending I.D. numbers and blanks', () => {
    expect(validateMajorItemsOrder([row('11030A'), row(''), row('11031A')])).toEqual([]);
  });
  it('flags rows out of numeric order', () => {
    expect(validateMajorItemsOrder([row('11493A'), row('11031A')])[0].message).toMatch(/numeric order/);
  });
});

describe('time compliance paragraph', () => {
  const tcp = { text: 'One year.', level: 0, header: 'Time Compliance Period' };
  it('is omitted on a NORMAL instruction', () => {
    expect(validateTimeComplianceParagraph('normal', [tcp])[0].message).toMatch(/omits the Time Compliance Period/);
    expect(validateTimeComplianceParagraph('normal', [])).toEqual([]);
  });
  it('stays on an URGENT one', () => {
    expect(validateTimeComplianceParagraph('urgent', [tcp])).toEqual([]);
  });
});
