/**
 * Endorsement bodies are numbered (SECNAV M-5216.5).
 *
 * The rule is Ch 2 ¶13a: "Identify all paragraphs or subparagraphs with a
 * number or letter." Ch 9 states no exception, so endorsements inherit it.
 * Where the manual wants paragraphs unnumbered it says so in those words --
 * Ch 11 ¶6 "Do not number main paragraphs", Ch 12 ¶3.2c(2) "Do not number the
 * paragraphs" -- and Ch 9 contains no such sentence. Its only "do not number"
 * is for Via addressees.
 *
 * The figures agree:
 *   Fig 9-1 (same-page): "1...A same-page endorsement may omit the SSIC…"
 *                        — numbered despite being a *single* paragraph.
 *   Fig 9-2 (new-page):  "1...Start an endorsement on a new page."
 *                        "2...Every 'new page' endorsement must repeat…"
 *
 * These shipped unnumbered because Ch 9's "continue the sequence" language was
 * read as a paragraph rule. It never is: ¶3 continues a sequence of *letters*
 * (references), ¶4 a sequence of *numbers* (enclosures), and Fig 9-2's own
 * first paragraph continues *page* numbers.
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
