/**
 * A control character pasted into any field must not stop the PDF.
 *
 * The symbol fail-safe kept all of ASCII, which includes the control range, and
 * pdfTeX rejects nearly all of those with no PDF at all. The compile-level proof
 * is tests/integration/latex-compile-control-characters.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { escapeLatex, processBodyText } from '@/services/latex/escaper';
import { generateFlatLatex } from '@/services/latex/flat-generator';

const CONTROLS = Array.from({ length: 32 }, (_, code) => code)
  .filter((code) => ![9, 10, 11, 12, 13].includes(code))
  .concat(0x7f)
  .map((code) => String.fromCharCode(code));

describe.each([
  ['processBodyText', processBodyText],
  ['escapeLatex', escapeLatex],
])('%s', (_name, escape) => {
  it.each(CONTROLS.map((ch) => [ch.charCodeAt(0).toString(16), ch]))('drops U+%s', (_code, ch) => {
    expect(escape(`Alpha${ch}Bravo`)).toBe('AlphaBravo');
  });

  it.each([['vertical tab', '\v'], ['form feed', '\f']])('keeps a %s as a word gap', (_name, ch) => {
    expect(escape(`Alpha${ch}Bravo`)).toBe('Alpha Bravo');
  });

  it('leaves tabs alone', () => {
    expect(escape('Alpha\tBravo')).toBe('Alpha\tBravo');
  });
});

it('keeps line breaks in body text', () => {
  expect(processBodyText('Alpha\nBravo')).toBe('Alpha\\\\\nBravo');
});

it.each([['vertical tab', '\v'], ['form feed', '\f']])('Word export keeps a %s as a word gap', (_name, ch) => {
  const latex = generateFlatLatex({
    docType: 'naval_letter',
    formData: { docType: 'naval_letter', subject: `SUBJECT${ch}LINE`, from: 'CO', to: 'CG' },
    references: [], enclosures: [], copyTos: [], distributions: [],
    paragraphs: [{ text: `Alpha${ch}Bravo`, level: 0 }],
  } as never);
  expect(latex).toContain('Alpha Bravo');
  expect(latex).toContain('SUBJECT LINE');
});

it('Word export drops DEL, which pandoc would keep', () => {
  const latex = generateFlatLatex({
    docType: 'naval_letter',
    formData: { docType: 'naval_letter', subject: 'SUBJECT\x7fLINE', from: 'CO', to: 'CG' },
    references: [], enclosures: [], copyTos: [], distributions: [],
    paragraphs: [{ text: 'Alpha\x7fBravo', level: 0 }],
  } as never);
  expect(latex).toContain('AlphaBravo');
  expect(latex).toContain('SUBJECTLINE');
});
