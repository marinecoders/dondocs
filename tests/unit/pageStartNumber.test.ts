/**
 * The Ch 9 page continuation is endorsements-only, exactly like its
 * reference/enclosure siblings: "a value left behind after switching document
 * type can never silently offset a basic letter's sequence" (the 1.2.94
 * guarantee). The DOCX generator violated this ungated from the start, and the
 * PDF plumbing nearly shipped with the same leak — these pin the gate in the
 * helper and at both generators' output.
 */
import { describe, it, expect } from 'vitest';
import { pageStartNumber } from '@/lib/endorsement';
import { generateDocumentTex } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';

const store = (docType: string) =>
  ({
    docType,
    formData: {
      docType,
      pageNumbering: 'simple',
      startingPageNumber: 4, // lingering from an endorsement session
      from: 'Commanding Officer',
      to: 'Commanding General',
      subject: 'PAGE LEAK CHECK',
      sigFirst: 'John',
      sigLast: 'DOE',
    },
    references: [],
    enclosures: [],
    paragraphs: [{ text: 'Body.', level: 0 }],
    copyTos: [],
    distributions: [],
  }) as never;

describe('pageStartNumber', () => {
  it('continues for endorsement types', () => {
    expect(pageStartNumber('new_page_endorsement', 4)).toBe(4);
    expect(pageStartNumber('same_page_endorsement', 7)).toBe(7);
  });

  it('never offsets any other doc type', () => {
    expect(pageStartNumber('naval_letter', 4)).toBe(1);
    expect(pageStartNumber('moa', 9)).toBe(1);
  });

  it('treats absent, 1, and junk as start-at-1', () => {
    expect(pageStartNumber('new_page_endorsement', undefined)).toBe(1);
    expect(pageStartNumber('new_page_endorsement', 1)).toBe(1);
    expect(pageStartNumber('new_page_endorsement', NaN)).toBe(1);
  });
});

describe('a lingering startingPageNumber on a non-endorsement', () => {
  it('emits no counter in the PDF generator', () => {
    expect(generateDocumentTex(store('naval_letter'))).not.toContain('\\setStartingPageNumber');
    expect(generateDocumentTex(store('new_page_endorsement'))).toContain('\\setStartingPageNumber{4}');
  });

  it('emits no counter in the DOCX generator', () => {
    expect(generateFlatLatex(store('naval_letter'))).not.toContain('\\setcounter{page}');
    expect(generateFlatLatex(store('new_page_endorsement'))).toContain('\\setcounter{page}{4}');
  });
});
