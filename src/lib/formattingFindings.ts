import { DOC_TYPE_CONFIG, type DocumentData, type DocumentCategory, type DocumentMode } from '@/types/document';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PUBLICATIONS = new Set(['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter']);

export interface FormattingInput {
  documentCategory: DocumentCategory;
  documentMode: DocumentMode;
  docType: string;
  formData: Partial<DocumentData>;
}

export interface FormattingFinding {
  field: 'date' | 'sigFirst' | 'sigMiddle';
  label: string;
  before: string;
  /** Absent when the author must resolve an invalid or ambiguous date. */
  after?: string;
  message: string;
}

/** No native Date fallback, locale guessing, day rollover or inferred century. */
function formattedDate(value: string, style: 'military' | 'spelled'): string | null {
  if (/[\r\n]/.test(value)) return null;
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
    // A two-digit year can retain its century-free military representation,
    // but converting it to a spelled four-digit year would require a guess.
    if (year.length === 2 && style === 'spelled') return null;
  } else if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    if (first !== second && first <= 12 && second <= 12) return null;
    day = first > 12 ? first : second;
    month = (first > 12 ? second : first) - 1;
    year = numeric[3];
  } else return null;

  const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year);
  const date = new Date(Date.UTC(fullYear, month, day));
  if (fullYear <= 1900 || fullYear >= 2100 || month < 0 || month > 11
    || date.getUTCFullYear() !== fullYear || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return style === 'military'
    ? `${day} ${MONTHS[month].slice(0, 3)} ${year.slice(-2)}`
    : `${MONTHS[month]} ${day}, ${year}`;
}

/** Advisory, field-scoped additions to the existing correspondence checks.
 * DatePicker already formats edits on blur; these also reach saved/imported
 * values without requiring a field edit. Initial fixes only remove spaces from
 * one explicitly punctuated initial; they never abbreviate or repartition names.
 */
export function formattingFindings(input: FormattingInput, section: string): FormattingFinding[] {
  const config = Object.hasOwn(DOC_TYPE_CONFIG, input.docType) ? DOC_TYPE_CONFIG[input.docType] : undefined;
  if (input.documentCategory !== 'correspondence' || !config || PUBLICATIONS.has(input.docType)
    || config.signature === 'dual') return [];
  const findings: FormattingFinding[] = [];
  const dateSection = config.uiMode === 'executive' ? 'executive' : 'addressing';
  if (section === dateSection) {
    const before = input.formData.date ?? '';
    if (before.trim() && !/[{}[\]]/.test(before)) {
      const style = config.uiMode === 'executive' || input.documentMode === 'compliant'
        ? config.compliance.dateFormat : 'military';
      const after = formattedDate(before, style);
      if (after !== before) findings.push({
        field: 'date', label: 'Date', before, ...(after === null ? {} : { after }),
        message: after === null
          ? `Check this date in the Date field or choose it from the calendar. Use ${style === 'military' ? '12 Nov 26' : 'November 12, 2026'}; no change is suggested when the date is unclear.`
          : 'Use the date format for this document.',
      });
    }
  }
  if (section === 'signature') {
    for (const [field, label] of [['sigFirst', 'First name initial'], ['sigMiddle', 'Middle initial']] as const) {
      const before = input.formData[field] ?? '';
      const match = /^[ \t]*([a-z])[ \t]*\.[ \t]*$/i.exec(before);
      const after = match && `${match[1]}.`;
      if (after && after !== before) findings.push({ field, label, before, after, message: 'Remove extra spacing around this signature initial.' });
    }
  }
  return findings;
}
