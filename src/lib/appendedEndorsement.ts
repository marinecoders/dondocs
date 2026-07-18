/**
 * The appointee's acknowledgement, carried on the appointment letter's own page.
 *
 * An appointment is two halves written at once: the appointing officer signs,
 * a rule divides the sheet, and the appointee endorses back below it. That is a
 * same-page endorsement in the sense of SECNAV M-5216.5 Ch 9 — it may omit the
 * SSIC, subject, and basic-letter ID precisely because it sits on the basic
 * letter's page — but unlike the standalone `same_page_endorsement` doc type it
 * is authored together with the letter, so it carries its own addressees, body,
 * and signer.
 *
 * Pure and leaf (no store, no LaTeX escaping) so the PDF and DOCX generators
 * can share one definition of what "has an acknowledgement" and what goes in it,
 * and can't drift into rendering different documents from the same input.
 */
import { abbreviatedSignatoryName } from '@/lib/signatoryName';

/**
 * Doc types that may carry an appended acknowledgement — letters only.
 *
 * Ch 9 ¶1 opens "When a *letter* is transmitted via your activity, use an
 * endorsement", and the memorandum chapters (10-12) never mention endorsements
 * at all, so there is no cite for endorsing a memorandum and Compliant mode may
 * not invent one. The memo types were listed here on judgement rather than a
 * cite, and the DOCX path then proved the point: `buildAppendedEndorsement` is
 * reachable only from `buildStandardLayout`, while memos route through
 * `buildMemoLayout`, so a memo rendered the acknowledgement in the PDF and
 * dropped it from the Word file.
 */
const ELIGIBLE = new Set(['naval_letter', 'standard_letter']);

export interface AppendedEndorsementData {
  appendEndorsement?: boolean;
  endorsementFrom?: string;
  endorsementTo?: string;
  endorsementBody?: string;
  endorsementSigFirst?: string;
  endorsementSigMiddle?: string;
  endorsementSigLast?: string;
  endorsementSerial?: string;
  endorsementDate?: string;
  /** Fall back to inverting the letter's own addressees. */
  from?: string;
  to?: string;
}

export interface AppendedEndorsement {
  from: string;
  to: string;
  /** One entry per non-blank line; the generators number them 1., 2., … */
  paragraphs: string[];
  /** Optional — an appointee endorsing back is not assigning a serial. */
  serial: string;
  /** Blank by default: the appointee hand-dates this when they sign. */
  date: string;
}

export function canAppendEndorsement(docType: string): boolean {
  return ELIGIBLE.has(docType);
}

/**
 * The acknowledgement to render, or null when there's nothing to show.
 *
 * The addressees invert the letter by default — the appointee is the letter's
 * "To" and answers back to its "From" — because that's true of every
 * appointment and re-typing both is just an opportunity to get them backwards.
 * An explicit value always wins.
 */
export function resolveAppendedEndorsement(
  docType: string,
  data: AppendedEndorsementData
): AppendedEndorsement | null {
  if (!data.appendEndorsement || !canAppendEndorsement(docType)) return null;

  const from = (data.endorsementFrom || '').trim() || (data.to || '').trim();
  const to = (data.endorsementTo || '').trim() || (data.from || '').trim();

  const paragraphs = (data.endorsementBody || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // Without addressees there is no endorsement to render — an unaddressed
  // block under a rule would just be a stray paragraph.
  if (!from || !to) return null;

  return {
    from,
    to,
    paragraphs,
    serial: (data.endorsementSerial || '').trim(),
    date: (data.endorsementDate || '').trim(),
  };
}

/**
 * The signer's name in the abbreviated form endorsements use (Ch 9): initials
 * and surname, no rank or title.
 */
export function appendedEndorsementSigner(data: AppendedEndorsementData): string {
  return abbreviatedSignatoryName(
    data.endorsementSigFirst,
    data.endorsementSigMiddle,
    data.endorsementSigLast
  );
}
