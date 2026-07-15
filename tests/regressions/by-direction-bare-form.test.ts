/**
 * Regression: the "By direction" signature block hardcoded a
 * `|| 'the Commanding Officer'` fallback, so every by-direction letter printed
 * "By direction of the Commanding Officer" — in both the PDF (generator) and
 * flat/DOCX (flat-generator) paths. SECNAV M-5216.5 Ch 7 ¶14b(4)-(5) makes the
 * bare "By direction" the norm and reserves the "of the <activity head>" long
 * form for correspondence affecting pay and allowances, so the long form must
 * appear only when an authority is actually named.
 */
import { describe, it, expect } from 'vitest';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { generateSignatoryTex } from '@/services/latex/generator';

function store(byDirectionAuthority?: string) {
  return {
    docType: 'naval_letter',
    formData: {
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: 'CG, II MEF',
      subject: 'TEST',
      sigFirst: 'John',
      sigLast: 'DOE',
      sigRank: 'Lieutenant Colonel',
      byDirection: true,
      byDirectionAuthority,
    },
    references: [],
    enclosures: [],
    paragraphs: [{ text: 'body', level: 0 }],
    copyTos: [],
    distributions: [],
  } as never;
}

describe.each([
  ['flat-generator (DOCX path)', (a?: string) => generateFlatLatex(store(a))],
  ['generator (PDF path)', (a?: string) => generateSignatoryTex(store(a))],
])('by-direction bare form — %s', (_label, render) => {
  it('emits a bare "By direction" when no authority is named', () => {
    const tex = render();
    expect(tex).toContain('By direction');
    // The long form must not be conjured from a default.
    expect(tex).not.toContain('By direction of');
  });

  it('emits the long form only when an authority is named', () => {
    expect(render('the Commanding Officer')).toContain(
      'By direction of the Commanding Officer'
    );
  });

  it('treats a whitespace-only authority as unset', () => {
    expect(render('   ')).not.toContain('By direction of');
  });
});
