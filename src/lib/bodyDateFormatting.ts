export type BodyDateAudience = 'military' | 'civilian';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Body dates have an explicit four-digit year, including historical dates.
 * Keep this separate from header dates, whose supported short-year policy is
 * deliberately narrower. Never infer a century or a numeric month/day order. */
export function normalizeBodyDate(value: string, audience: BodyDateAudience): string | null {
  if (/[\r\n\u2028\u2029]/.test(value)) return null;
  const text = value.trim();
  const dayFirst = /^(\d{1,2})[ \t]+([a-z]+)[ \t]+(\d{4})$/i.exec(text);
  const monthFirst = /^([a-z]+)[ \t]+(\d{1,2}),[ \t]+(\d{4})$/i.exec(text);
  const match = dayFirst ?? monthFirst;
  if (!match) return null;
  const day = Number(match[dayFirst ? 1 : 2]);
  const monthName = match[dayFirst ? 2 : 1].toLowerCase();
  const month = MONTHS.findIndex(name => name.toLowerCase() === monthName || name.slice(0, 3).toLowerCase() === monthName);
  const yearText = match[3];
  const year = Number(yearText);
  if (year < 1 || month < 0 || day < 1 || day > 31) return null;
  // Date.UTC treats years 00–99 as 1900–1999; setUTCFullYear preserves the
  // author's explicit year while validating the Gregorian calendar day.
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return audience === 'military' ? `${day} ${MONTHS[month]} ${yearText}` : `${MONTHS[month]} ${day}, ${yearText}`;
}
