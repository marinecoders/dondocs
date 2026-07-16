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

/** The doc types that continue a package rather than open one. */
export function isEndorsement(docType: string): boolean {
  return docType === 'same_page_endorsement' || docType === 'new_page_endorsement';
}

/**
 * Zero-based index the reference lettering starts at.
 *
 * SECNAV M-5216.5 Ch 9 ¶3: an endorsement continues the basic letter's
 * sequence — if the basic ran to (f), the endorsement's first new reference is
 * (g). The basic letter is a separate document DonDocs cannot see, so the user
 * supplies the start. Only endorsements continue a sequence; everything else
 * opens its own at (a), so a stale value can't silently offset a basic letter.
 */
export function referenceStartIndex(docType: string, startingLetter?: string): number {
  if (!isEndorsement(docType)) return 0;
  const letter = (startingLetter ?? '').trim().toLowerCase();
  if (!/^[a-z]$/.test(letter)) return 0;
  return letter.charCodeAt(0) - 97;
}

/**
 * The number the enclosure list starts at — the same Ch 9 ¶3 continuation rule
 * as references. Defaults to 1 for anything that isn't an endorsement or has no
 * usable value.
 */
export function enclosureStartNumber(docType: string, startingNumber?: number): number {
  if (!isEndorsement(docType)) return 1;
  const n = Number(startingNumber);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * The page number the document starts at — the Ch 9 page-continuation rule
 * (Fig 9-2 ¶1), gated exactly like its reference/enclosure siblings above: a
 * startingPageNumber left behind after switching document type must never
 * silently offset a basic letter's own sequence.
 */
export function pageStartNumber(docType: string, startingPageNumber?: number): number {
  if (!isEndorsement(docType)) return 1;
  const n = Number(startingPageNumber);
  return Number.isFinite(n) && n > 1 ? Math.floor(n) : 1;
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
