/**
 * Best-effort guess at which DonDocs document type an imported file is, from its
 * extracted text. Naval correspondence carries strong, recognizable openers
 * (an endorsement line, "MEMORANDUM FOR THE RECORD", "MEMORANDUM OF
 * AGREEMENT", …); when one is present we're confident, and when the text is a
 * plain From/To/Subj letter or an unqualified memorandum we say so, so the
 * import flow can prompt the drafter to confirm instead of guessing wrong.
 *
 * Pure and leaf — the heuristics are unit-tested against text fixtures,
 * independent of whether the text came from a PDF or a DOCX.
 */

export interface DocTypeDetection {
  /** The best-guess DonDocs docType key. */
  docType: string;
  /** 'high' when a distinctive marker matched; 'low' when the drafter should confirm. */
  confidence: 'high' | 'low';
  /** Why (for the review UI): the marker that decided it, or the ambiguity. */
  reason: string;
}

/** The document types the importer offers, in the order the picker lists them. */
export const IMPORTABLE_DOC_TYPES = [
  'naval_letter',
  'standard_letter',
  'business_letter',
  'multiple_address_letter',
  'same_page_endorsement',
  'new_page_endorsement',
  'plain_paper_memorandum',
  'letterhead_memorandum',
  'mfr',
  'moa',
  'mou',
] as const;

// Strong, unambiguous openers → a specific type, high confidence. Tested in
// order. Each is anchored to the START of a line (the `m` flag) because these
// are title / endorsement lines, not phrases — a naval letter whose Subj reads
// "RENEWAL OF MEMORANDUM OF AGREEMENT" must not be misread as an MOA.
const STRONG_MARKERS: { re: RegExp; docType: string; reason: string }[] = [
  { re: /^\s*memorandum\s+for\s+the\s+record/im, docType: 'mfr', reason: 'Contains "MEMORANDUM FOR THE RECORD".' },
  { re: /^\s*memorandum\s+of\s+agreement/im, docType: 'moa', reason: 'Contains "MEMORANDUM OF AGREEMENT".' },
  { re: /^\s*memorandum\s+of\s+understanding/im, docType: 'mou', reason: 'Contains "MEMORANDUM OF UNDERSTANDING".' },
  // "FIRST ENDORSEMENT", "SECOND ENDORSEMENT on …", "1st Endorsement". New-page
  // is always a valid form, so it's the safe default guess for an endorsement.
  {
    re: /^\s*(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\s+endorsement\b/im,
    docType: 'new_page_endorsement',
    reason: 'Contains an endorsement line.',
  },
];

const hasLabel = (text: string, label: RegExp) => label.test(text);

export function detectDocumentType(rawText: string): DocTypeDetection {
  const text = rawText.replace(/\r\n?/g, '\n');

  for (const m of STRONG_MARKERS) {
    if (m.re.test(text)) return { docType: m.docType, confidence: 'high', reason: m.reason };
  }

  const hasFrom = hasLabel(text, /^\s*from\s*:/im);
  const hasTo = hasLabel(text, /^\s*to\s*:/im);
  const hasSubj = hasLabel(text, /^\s*subj(?:ect)?\s*:/im);

  // A generic "MEMORANDUM" title line (including "MEMORANDUM FOR <name>") — the
  // family is clear but the specific memo type isn't, so ask the drafter to
  // confirm. Line-anchored so a body mention ("per the memorandum") doesn't fire.
  if (/^\s*memorandum\b/im.test(text) && !(hasFrom && hasTo && hasSubj)) {
    return {
      docType: 'plain_paper_memorandum',
      confidence: 'low',
      reason: 'Looks like a memorandum, but the exact memo type is unclear — please confirm.',
    };
  }

  // A business letter: salutation + complimentary close, no naval Subj line.
  if (/^\s*dear\b/im.test(text) && /(sincerely|respectfully|very truly yours)/i.test(text) && !hasSubj) {
    return { docType: 'business_letter', confidence: 'high', reason: 'Has a salutation and complimentary close.' };
  }

  // The standard naval-letter skeleton. From+To+Subj is the confident case;
  // naval_letter is the USMC default, with standard_letter offered as the
  // plain-paper alternative in the picker.
  if (hasFrom && hasTo && hasSubj) {
    return { docType: 'naval_letter', confidence: 'high', reason: 'Has From / To / Subj addressing.' };
  }

  // Some addressing but not the full set — parse what we can as a naval letter,
  // but let the drafter confirm the type.
  if (hasFrom || hasTo || hasSubj) {
    return {
      docType: 'naval_letter',
      confidence: 'low',
      reason: 'Partial addressing found — please confirm the document type.',
    };
  }

  return {
    docType: 'naval_letter',
    confidence: 'low',
    reason: "Couldn't identify the document type from the text — please choose.",
  };
}
