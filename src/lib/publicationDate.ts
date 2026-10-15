import { parse, parseISO, isValid, format, lastDayOfMonth, subDays, getDay } from 'date-fns';

const STORED = 'd MMM yy';
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

export function formatPublicationDate(date: string): string {
  const d = parse(date.trim(), STORED, new Date());
  return isValid(d) ? format(d, 'd MMMM yyyy') : date;
}

/** OPM's observed federal holidays for a Monday–Friday workweek. */
function federalHolidays(year: number): Set<string> {
  const dates: Date[] = [];
  const observed = (y: number, month: number, day: number) => {
    const d = new Date(y, month, day);
    d.setDate(d.getDate() + (getDay(d) === 6 ? -1 : getDay(d) === 0 ? 1 : 0));
    dates.push(d);
  };
  for (const y of [year - 1, year, year + 1]) {
    for (const [m, d] of [[0, 1], [5, 19], [6, 4], [10, 11], [11, 25]]) {
      if (m !== 5 || y >= 2021) observed(y, m, d);
    }
  }
  for (const [month, weekday, occurrence] of [[0, 1, 3], [1, 1, 3], [8, 1, 1], [9, 1, 2], [10, 4, 4]]) {
    const first = new Date(year, month, 1);
    dates.push(new Date(year, month, 1 + (weekday - getDay(first) + 7) % 7 + 7 * (occurrence - 1)));
  }
  let memorial = new Date(year, 4, 31);
  while (getDay(memorial) !== 1) memorial = subDays(memorial, 1);
  dates.push(memorial);
  return new Set(dates.map(iso));
}

export function lastWorkingDay(d: Date, closedDates: string[] = []): Date {
  const closed = new Set([...federalHolidays(d.getFullYear()), ...closedDates]);
  let last = lastDayOfMonth(d);
  while (getDay(last) === 0 || getDay(last) === 6 || closed.has(iso(last))) last = subDays(last, 1);
  return last;
}

export function validatePublicationDate(date: string, signingDate?: string, closedDates = ''): { severity: 'warning'; message: string }[] {
  const error = (message: string) => [{ severity: 'warning' as const, message }];
  const d = parse(date.trim(), STORED, new Date());
  if (!isValid(d)) return [];
  const closures = closedDates.split(/[\s,;]+/).filter(Boolean);
  const validISO = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));
  if (closures.some((value) => !validISO(value))) return error('Enter office closure dates as YYYY-MM-DD, separated by commas.');
  if (signingDate && !validISO(signingDate)) return error('Enter a valid signing date.');
  const signed = signingDate ? parseISO(signingDate) : d;
  const expected = lastWorkingDay(signed, closures);
  if (expected.getMonth() !== signed.getMonth()) return error('The signing month has no working day in the selected calendar.');
  if (iso(d) === iso(expected)) return [];
  return error(`The effective date must be the last working day of the signing month: ${format(expected, 'd MMMM yyyy')} for ${format(signed, 'MMMM yyyy')}.`);
}
