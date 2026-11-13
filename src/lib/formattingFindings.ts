import { DOC_TYPE_CONFIG, type DocumentData, type DocumentCategory, type DocumentMode } from '@/types/document';
import { normalizeDate } from './dateFormatting';

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
      const after = normalizeDate(before, style);
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
