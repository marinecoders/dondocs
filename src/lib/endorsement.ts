/**
 * Helpers for basing an endorsement on the letter it endorses. Pure and leaf
 * (no store imports) so the composition logic is unit-testable and can't drift.
 *
 * SECNAV M-5216.5 Ch 9: an endorsement identifies the basic letter with a
 * reference-line-style id — "[originator] [type] [SSIC] Ser [serial] of [date]".
 * The originator, SSIC, serial, and date all come straight off the basic letter,
 * so composing this by hand is exactly the error-prone step this removes.
 */

// A structural subset of SerializedSession — accepting a loose shape keeps this a
// leaf module (no dependency on the document store's types).
export interface BasicLetterLike {
  docType: string;
  formData?: {
    from?: string;
    unitLine1?: string;
    ssic?: string;
    serial?: string;
    date?: string;
  };
}

// The word used for the document type in a reference line ("ltr" / "memo").
const REF_WORD: Record<string, string> = {
  naval_letter: 'ltr',
  standard_letter: 'ltr',
  business_letter: 'ltr',
  multiple_address_letter: 'ltr',
  joint_letter: 'ltr',
  executive_correspondence: 'ltr',
  moa: 'ltr',
  mou: 'ltr',
  mfr: 'memo',
  plain_paper_memorandum: 'memo',
  letterhead_memorandum: 'memo',
  standard_memorandum: 'memo',
  action_memorandum: 'memo',
  information_memorandum: 'memo',
  executive_memorandum: 'memo',
  decision_memorandum: 'memo',
  joint_memorandum: 'memo',
  mf: 'memo',
  same_page_endorsement: 'endorsement',
  new_page_endorsement: 'endorsement',
};

export function refWordForDocType(docType: string): string {
  return REF_WORD[docType] ?? 'ltr';
}

// Empty or a bracketed placeholder ([SSIC]) counts as absent.
function usable(value: string | undefined): string {
  const t = (value ?? '').trim();
  return t && !/^\[.*\]$/.test(t) ? t : '';
}

/**
 * Compose the basic-letter identifier from the letter being endorsed:
 * "[originator] [type] [SSIC] Ser [serial] of [date]", dropping any part the
 * basic letter doesn't have. The result is an editable draft, not a locked value.
 */
export function composeBasicLetterId(session: BasicLetterLike): string {
  const fd = session.formData ?? {};
  const originator = usable(fd.from) || usable(fd.unitLine1);
  const ssic = usable(fd.ssic);
  const serial = usable(fd.serial);
  const date = usable(fd.date);

  const parts: string[] = [];
  if (originator) parts.push(originator);
  parts.push(refWordForDocType(session.docType));
  if (ssic) parts.push(ssic);
  if (serial) parts.push(`Ser ${serial}`);

  const base = parts.join(' ').trim();
  return date ? `${base} of ${date}` : base;
}
