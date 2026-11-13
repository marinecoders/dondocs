export type DateFormatType = 'military' | 'spelled' | 'iso';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Shared by date editing and correction previews. Reject locale ambiguity,
 * invalid days and inferred centuries instead of falling back to native Date.
 */
export function normalizeDate(value: string, style: DateFormatType): string | null {
  if (/[\r\n\u2028\u2029]/.test(value)) return null;
  const text = value.trim();
  let day: number;
  let month: number;
  let year: string;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dayFirst = /^(\d{1,2})[ \t]+([a-z]+)[ \t]+(\d{4}|\d{2})$/i.exec(text);
  const monthFirst = /^([a-z]+)[ \t]+(\d{1,2}),[ \t]+(\d{4})$/i.exec(text);
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (iso) {
    [, year] = iso;
    month = Number(iso[2]) - 1;
    day = Number(iso[3]);
  } else if (dayFirst || monthFirst) {
    const match = (dayFirst ?? monthFirst)!;
    day = Number(match[dayFirst ? 1 : 2]);
    const name = match[dayFirst ? 2 : 1].toLowerCase();
    month = MONTHS.findIndex(m => m.toLowerCase() === name || m.slice(0, 3).toLowerCase() === name);
    year = match[3];
    // Retain a short military year; expanding it needs the author's century.
    if (year.length === 2 && style !== 'military') return null;
  } else if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    if (first !== second && first <= 12 && second <= 12) return null;
    day = first > 12 ? first : second;
    month = (first > 12 ? second : first) - 1;
    year = numeric[3];
  } else return null;

  // Both supported centuries have the same leap days for short years. This
  // year is only used to validate the day, never to expand a short year.
  const validationYear = year.length === 2 ? 2000 + Number(year) : Number(year);
  const date = new Date(Date.UTC(validationYear, month, day));
  if (validationYear <= 1900 || validationYear >= 2100 || month < 0 || month > 11
    || date.getUTCFullYear() !== validationYear || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  if (style === 'iso') return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return style === 'military'
    ? `${day} ${MONTHS[month].slice(0, 3)} ${year.slice(-2)}`
    : `${MONTHS[month]} ${day}, ${year}`;
}
