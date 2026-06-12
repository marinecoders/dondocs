/**
 * Regression (audit C-4): escapeTabular did not escape `&` — the comment
 * ("& is the column separator") misapplied to cell CONTENT. A unit name
 * like "H&S Battalion" became a phantom alignment tab that corrupted the
 * DOCX table layout. The PDF path always escaped `&`; same input produced
 * a broken DOCX. Content ampersands are now escaped to \&.
 */
import { describe, it, expect } from 'vitest';
import { generateFlatLatex } from '@/services/latex/flat-generator';

describe('escapeTabular escapes content ampersands (C-4)', () => {
  it('H&S-style unit names emit \\& in tabular cells, never a bare &', () => {
    const tex = generateFlatLatex({
      docType: 'naval_letter',
      formData: {
        unitLine1: 'H&S Battalion',
        from: 'Commanding Officer, H&S Battalion',
        to: 'CG, II MEF',
        subject: 'TEST',
      } as never,
      references: [],
      enclosures: [],
      paragraphs: [{ text: 'body', level: 0 }],
      copyTos: [],
      distributions: [],
    });
    expect(tex).toContain('H\\&S Battalion');
    // No bare content ampersand from the input survives. (Table syntax `&`
    // emitted by the generator itself is always ` & ` separated.)
    expect(tex).not.toMatch(/H&S/);
  });
});
