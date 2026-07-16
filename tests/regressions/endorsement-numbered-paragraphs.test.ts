/**
 * Endorsement bodies are numbered (SECNAV M-5216.5 Ch 9, Figs 9-1 and 9-2).
 *
 * These shipped unnumbered from the original doc-type import: Ch 9 says to
 * "continue the sequence of numbers from the basic letter", which governs
 * ENCLOSURES ("Assign a number to all enclosures that you add by continuing the
 * sequence…"). Read as a paragraph rule, it turned numbering off for both
 * endorsement types.
 *
 * The figures are unambiguous:
 *   Fig 9-1 (same-page): "1...A same-page endorsement may omit the SSIC…"
 *                        — numbered despite being a *single* paragraph, so the
 *                          don't-number-a-lone-item rule Ch 9 states for Via
 *                          addressees does not extend to paragraphs.
 *   Fig 9-2 (new-page):  "1...Start an endorsement on a new page."
 *                        "2...Every 'new page' endorsement must repeat…"
 */
import { describe, it, expect } from 'vitest';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { generateFlatLatex } from '@/services/latex/flat-generator';

const ENDORSEMENTS = ['same_page_endorsement', 'new_page_endorsement'] as const;

function store(docType: string, paragraphs: { text: string; level: number }[]) {
  return {
    docType,
    formData: {
      docType,
      from: 'Sergeant J. A. DOE, USMC',
      to: 'Commanding Officer, 1st Battalion, 6th Marines',
      subject: 'HOW TO PREPARE AN ENDORSEMENT',
      basicLetterId: 'CO 1stBn 6thMar ltr 5216 Ser 0123 of 15 Jan 25',
      endorsementOrdinal: 'FIRST',
      sigFirst: 'John',
      sigLast: 'DOE',
    },
    references: [],
    enclosures: [],
    paragraphs,
    copyTos: [],
    distributions: [],
  } as never;
}

describe.each(ENDORSEMENTS)('%s', (docType) => {
  it('numbers its paragraphs', () => {
    expect(DOC_TYPE_CONFIG[docType].compliance.numberedParagraphs).toBe(true);
  });

  it('renders a numbered body (Fig 9-2)', () => {
    const tex = generateFlatLatex(
      store(docType, [
        { text: 'Start an endorsement on a new page.', level: 0 },
        { text: 'Every new-page endorsement must repeat the basic letter subject.', level: 0 },
      ])
    );
    expect(tex).toContain('\\mbox{1.}');
    expect(tex).toContain('\\mbox{2.}');
  });

  // Fig 9-1's body is one paragraph and is still numbered "1." — the lone-item
  // exception Ch 9 grants Via addressees does not apply here.
  it('numbers a solitary paragraph too (Fig 9-1)', () => {
    const tex = generateFlatLatex(
      store(docType, [{ text: 'Forwarded, recommending approval.', level: 0 }])
    );
    expect(tex).toContain('\\mbox{1.}');
  });
});
