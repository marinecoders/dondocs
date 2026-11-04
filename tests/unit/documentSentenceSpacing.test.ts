import { describe, expect, it } from 'vitest';
import { generateAllLatexFiles, generateDocumentTex } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { processBodyText } from '@/services/latex/escaper';

describe('sentence spacing scope', () => {
  it.each(['compliant', 'custom', undefined] as const)(
    'adds no sentence space of its own to a letter in %s mode',
    (documentMode) => {
      const tex = generateDocumentTex({
        docType: 'standard_letter', documentMode, formData: {},
        paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [],
      });
      expect(tex).toContain('\\frenchspacing');
      expect(tex).not.toContain('\\nonfrenchspacing');
    }
  );

  it.each(['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'])(
    'preserves existing typography for the %s technical publication',
    (docType) => {
      const tex = generateDocumentTex({
        docType, documentMode: 'compliant', formData: {},
        paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [],
      });
      expect(tex).toContain('\\nonfrenchspacing');
      expect(tex).not.toContain('\\frenchspacing');
    }
  );
});

describe('typed spaces between words', () => {
  it.each([
    ['one stays one', 'Alpha. Bravo', 'Alpha. Bravo'],
    ['two stays two', 'Alpha.  Bravo', 'Alpha.\\ \\ Bravo'],
    ['more than two prints as two', 'Alpha.      Bravo', 'Alpha.\\ \\ Bravo'],
    ['mid-sentence too', 'Alpha  bravo', 'Alpha\\ \\ bravo'],
    ['the ends are left alone', '  Alpha  ', '  Alpha  '],
    ['one space on each side of a bold edge', '**Alpha. ** Bravo', '\\textbf{Alpha.}\\ \\ Bravo'],
    ['two and one across a bold edge', '**Alpha.  ** Bravo', '\\textbf{Alpha.}\\ \\ Bravo'],
    ['three and three across a bold edge', '**Alpha.   **   Bravo', '\\textbf{Alpha.}\\ \\ Bravo'],
    ['one and two across an opening edge', 'Alpha. **  Bravo**', 'Alpha.\\ \\ \\textbf{Bravo}'],
    ['across an italic edge', '*Alpha. * Bravo', '\\textit{Alpha.}\\ \\ Bravo'],
    ['across an underline edge', '__Alpha. __ Bravo', '\\uline{Alpha.}\\ \\ Bravo'],
    ['across nested marks', '__***Alpha. ***__ Bravo', '\\uline{\\textbf{\\textit{Alpha.}}}\\ \\ Bravo'],
    ['through a mark that holds only a space', 'Alpha.** ** Bravo', 'Alpha.\\ \\ Bravo'],
    ['one space at a bold edge stays one', '**Alpha. **Bravo', '\\textbf{Alpha.} Bravo'],
    ['leading spaces inside a mark are still leading', '**  Alpha** bravo', '  \\textbf{Alpha} bravo'],
    ['a literal brace is not a mark', '{Alpha  } bravo', '\\{Alpha\\ \\ \\} bravo'],
    ['three non-breaking spaces', 'Alpha.   Bravo', 'Alpha.\\ \\ Bravo'],
    ['a tab beside spaces', 'Alpha.  \tBravo', 'Alpha.\\ \\ Bravo'],
    ['two tabs', 'Alpha.\t\tBravo', 'Alpha.\\ \\ Bravo'],
    ['one tab stays one', 'Alpha.\tBravo', 'Alpha.\tBravo'],
  ])('PDF body text: %s', (_name, typed, printed) => {
    expect(processBodyText(typed)).toBe(printed);
  });

  it.each([
    ['one stays one', 'Alpha. Bravo', 'Alpha. Bravo'],
    ['two stays two', 'Alpha.  Bravo', 'Alpha.~ Bravo'],
    ['more than two prints as two', 'Alpha.      Bravo', 'Alpha.~ Bravo'],
    ['one space on each side of a bold edge', '**Alpha. ** Bravo', '\\textbf{Alpha.}~ Bravo'],
    ['three and three across a bold edge', '**Alpha.   **   Bravo', '\\textbf{Alpha.}~ Bravo'],
    ['one and two across an opening edge', 'Alpha. **  Bravo**', 'Alpha.~ \\textbf{Bravo}'],
    ['across an italic edge', '*Alpha. * Bravo', '\\textit{Alpha.}~ Bravo'],
    ['three non-breaking spaces', 'Alpha.   Bravo', 'Alpha.~ Bravo'],
    ['space, non-breaking space, space', 'Alpha.   Bravo', 'Alpha.~ Bravo'],
    ['one non-breaking space stays', 'Alpha. Bravo', 'Alpha. Bravo'],
    ['a tab beside spaces', 'Alpha.  \tBravo', 'Alpha.~ Bravo'],
  ])('Word body text: %s', (_name, typed, printed) => {
    const tex = generateFlatLatex({
      docType: 'standard_letter', documentMode: 'compliant', formData: {},
      paragraphs: [{ level: 0, text: typed }], references: [], enclosures: [], copyTos: [], distributions: [],
    } as never);
    expect(tex).toContain(printed);
  });

  const endorsed = {
    docType: 'standard_letter', documentMode: 'compliant', references: [], enclosures: [], copyTos: [], distributions: [],
    paragraphs: [{ level: 0, text: 'Basic letter.' }],
    formData: {
      from: 'Sender', to: 'Addressee', appendEndorsement: true, endorsementBody: 'Alpha.  Bravo',
      additionalEndorsements: [{ endorsementFrom: 'Next', endorsementTo: 'Last', endorsementBody: 'Charlie.      Delta' }],
    },
  } as never;

  it('applies to endorsement text in the PDF', () => {
    const tex = Object.values(generateAllLatexFiles(endorsed).texFiles).join('\n');
    expect(tex).toContain('Alpha.\\ \\ Bravo');
    expect(tex).toContain('Charlie.\\ \\ Delta');
  });

  it('applies to endorsement text in Word', () => {
    const tex = generateFlatLatex(endorsed);
    expect(tex).toContain('Alpha.~ Bravo');
    expect(tex).toContain('Charlie.~ Delta');
  });
});
