import { parse, isValid, format, lastDayOfMonth, subDays, getDay } from 'date-fns';

/**
 * The date on a technical publication. The MARCORSYSCOM template prints it in
 * full ("30 April 2025") on the authentication page and in the page headers,
 * and says it "shall be the last working day of the month" of anticipated
 * signature. The correspondence date field holds "15 Dec 24"; this is where
 * the publication's form of it comes from.
 */

const STORED = 'd MMM yy';

export function formatPublicationDate(date: string): string {
  const d = parse(date.trim(), STORED, new Date());
  return isValid(d) ? format(d, 'd MMMM yyyy') : date;
}

/** The last weekday of the month `d` falls in. Holidays are the drafter's to
 *  know; a Saturday or Sunday is never a working day. */
export function lastWorkingDay(d: Date): Date {
  let last = lastDayOfMonth(d);
  while (getDay(last) === 0 || getDay(last) === 6) last = subDays(last, 1);
  return last;
}

export function validatePublicationDate(date: string): { severity: 'warning'; message: string }[] {
  const d = parse(date.trim(), STORED, new Date());
  if (!isValid(d)) return [];
  const expected = lastWorkingDay(d);
  if (format(d, 'yyyy-MM-dd') === format(expected, 'yyyy-MM-dd')) return [];
  return [{
    severity: 'warning',
    message: `The date should be the last working day of the month of signature: ${format(expected, 'd MMMM yyyy')} for ${format(d, 'MMMM yyyy')}.`,
  }];
}
