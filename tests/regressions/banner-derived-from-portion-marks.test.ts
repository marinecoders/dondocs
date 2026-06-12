/**
 * Regression: the classification banner was driven solely by the document
 * level, so a CUI document containing an (S) paragraph rendered a CUI banner
 * over SECRET content — an under-marked document. SECNAV M-5216.5 /
 * DoDM 5200.01 Vol 2 require the banner to reflect the highest portion.
 * Also: portion marks rendered in DOCX but were silently dropped from the
 * PDF body. Both fixed via the shared deriveOverallClassLevel chokepoint.
 */
import { describe, it, expect } from 'vitest';
import { deriveOverallClassLevel } from '@/lib/overallClassification';
import { generateClassificationTex, generateBodyTex } from '@/services/latex/generator';
import type { Paragraph } from '@/types/document';

function store(classLevel: string, paragraphs: Paragraph[]) {
  return {
    docType: 'naval_letter',
    formData: { classLevel } as never,
    references: [],
    enclosures: [],
    paragraphs,
    copyTos: [],
    distributions: [],
  };
}

describe('deriveOverallClassLevel', () => {
  it('returns the document level when no portion outranks it', () => {
    expect(deriveOverallClassLevel('secret', [{ text: 'x', level: 0, portionMarking: 'C' }])).toBe('secret');
    expect(deriveOverallClassLevel('unclassified', [])).toBe('unclassified');
  });

  it('raises to the highest portion mark', () => {
    expect(deriveOverallClassLevel('cui', [{ text: 'x', level: 0, portionMarking: 'S' }])).toBe('secret');
    expect(deriveOverallClassLevel('unclassified', [{ text: 'x', level: 0, portionMarking: 'TS' }])).toBe('top_secret');
    expect(deriveOverallClassLevel('confidential', [
      { text: 'a', level: 0, portionMarking: 'U' },
      { text: 'b', level: 1, portionMarking: 'S' },
    ])).toBe('secret');
  });

  it('maps retired FOUO portions to CUI', () => {
    expect(deriveOverallClassLevel('unclassified', [{ text: 'x', level: 0, portionMarking: 'FOUO' }])).toBe('cui');
  });

  it('never derives over custom (unrankable free text)', () => {
    expect(deriveOverallClassLevel('custom', [{ text: 'x', level: 0, portionMarking: 'TS' }])).toBe('custom');
  });
});

describe('banner derivation in generateClassificationTex (PDF path)', () => {
  it('CUI document with an (S) paragraph renders a SECRET banner', () => {
    const tex = generateClassificationTex(store('cui', [{ text: 'classified para', level: 0, portionMarking: 'S' }]));
    expect(tex).toContain('\\setClassification{SECRET}');
  });

  it('unclassified document with a (TS) paragraph renders a TOP SECRET banner', () => {
    const tex = generateClassificationTex(store('unclassified', [{ text: 'x', level: 0, portionMarking: 'TS' }]));
    expect(tex).toContain('\\setClassification{TOP SECRET}');
  });

  it('unmarked documents are unchanged', () => {
    const tex = generateClassificationTex(store('unclassified', [{ text: 'x', level: 0 }]));
    expect(tex).toContain('Unclassified');
    expect(tex).not.toContain('\\setClassification{');
  });
});

describe('portion marks render in the PDF body (previously DOCX-only)', () => {
  it('prefixes (S) on the marked paragraph', () => {
    const tex = generateBodyTex(store('secret', [
      { text: 'secret content here', level: 0, portionMarking: 'S' },
      { text: 'unmarked content', level: 0 },
    ]));
    expect(tex).toContain('(S) secret content here');
    expect(tex).not.toContain('(S) unmarked');
  });

  it('prefixes on subparagraph levels too', () => {
    const tex = generateBodyTex(store('secret', [
      { text: 'top', level: 0, portionMarking: 'U' },
      { text: 'nested secret', level: 1, portionMarking: 'S' },
    ]));
    expect(tex).toContain('(U) top');
    expect(tex).toContain('(S) nested secret');
  });
});
