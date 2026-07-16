/**
 * Regression: an enclosure's number is produced in three places that must agree
 * — the printed "Encl:" list, the `\enclosure{n}` LaTeX anchor, and the
 * `number` handed to the JS PDF merge (which stamps page markers and resolves
 * "Encl (n)" hyperlinks by it).
 *
 * When endorsement continuation landed, the first two were offset but the merge
 * list still counted from `i + 1`. A continued endorsement therefore printed
 * "Encl: (2)" while the merged PDF marked the page "Enclosure (1)" and the
 * hyperlink anchor pointed at a destination that was never created. These
 * assert the three stay in lockstep.
 */
import { describe, it, expect } from 'vitest';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';

function store(docType: string, startingEnclosureNumber?: number) {
  return {
    docType,
    formData: {
      docType,
      fontSize: '12pt',
      fontFamily: 'times',
      pageNumbering: 'none',
      department: 'usmc',
      unitLine1: '1ST BATTALION, 6TH MARINES',
      ssic: '1000',
      date: '15 Jan 25',
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: 'CG, II MEF',
      subject: 'TEST',
      endorsementOrdinal: 'FIRST',
      basicLetterId: 'CG II MEF ltr 1000 Ser 01/23 of 1 Jan 25',
      sigFirst: 'John',
      sigLast: 'DOE',
      startingEnclosureNumber,
    },
    references: [],
    enclosures: [{ title: 'Alpha' }, { title: 'Bravo' }],
    paragraphs: [{ text: 'body', level: 0 }],
    copyTos: [],
    distributions: [],
  } as never;
}

describe('enclosure numbering agrees across all three producers', () => {
  it('continued endorsement: merge list, LaTeX anchor, and printed list all start at 2', () => {
    const s = store('same_page_endorsement', 2);
    const { enclosures, texFiles } = generateAllLatexFiles(s) as unknown as {
      enclosures: { number: number }[];
      texFiles: Record<string, string>;
    };

    // 1. the list handed to the PDF merge
    expect(enclosures.map((e) => e.number)).toEqual([2, 3]);
    // 2. the LaTeX anchor / list definition
    expect(texFiles['encl-config.tex']).toContain('\\enclosure{2}');
    expect(texFiles['encl-config.tex']).toContain('\\enclosure{3}');
    expect(texFiles['encl-config.tex']).not.toContain('\\enclosure{1}');
    // 3. the printed Encl: list (flat/DOCX path)
    const flat = generateFlatLatex(s);
    expect(flat).toContain('(2)~~Alpha');
    expect(flat).toContain('(3)~~Bravo');
  });

  it('defaults to 1 with no continuation set', () => {
    const s = store('same_page_endorsement');
    const { enclosures } = generateAllLatexFiles(s) as unknown as {
      enclosures: { number: number }[];
    };
    expect(enclosures.map((e) => e.number)).toEqual([1, 2]);
    expect(generateFlatLatex(s)).toContain('(1)~~Alpha');
  });

  it('ignores a stale continuation on a basic letter', () => {
    const s = store('naval_letter', 5);
    const { enclosures } = generateAllLatexFiles(s) as unknown as {
      enclosures: { number: number }[];
    };
    expect(enclosures.map((e) => e.number)).toEqual([1, 2]);
    expect(generateFlatLatex(s)).toContain('(1)~~Alpha');
  });
});
