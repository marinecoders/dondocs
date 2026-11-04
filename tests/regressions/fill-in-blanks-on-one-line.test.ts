/**
 * Two fill-in blanks on one line are not an underline.
 *
 * The end of one blank and the start of the next looked like `__text__`, so the
 * label between them was underlined and each blank lost two underscores.
 */
import { describe, expect, it } from 'vitest';
import { lineToHtml } from '@/components/ui/variable-chip-editor-text';
import { convertRichTextToLatex } from '@/services/latex/escaper';
import { generateFlatLatex } from '@/services/latex/flat-generator';

const wordBody = (text: string) => {
  const latex = generateFlatLatex({
    docType: 'naval_letter',
    formData: { docType: 'naval_letter', subject: 'SUBJECT', from: 'CO', to: 'CG' },
    references: [], enclosures: [], copyTos: [], distributions: [],
    paragraphs: [{ text: `START ${text} END`, level: 0 }],
  } as never);
  return latex.slice(latex.indexOf('START ') + 6, latex.indexOf(' END'));
};

const targets = [
  ['PDF', convertRichTextToLatex, (inner: string) => `\\uline{${inner}}`],
  ['Word', wordBody, (inner: string) => `\\uline{${inner}}`],
  ['editor', lineToHtml, (inner: string) => `<u>${inner}</u>`],
] as const;

describe.each(targets)('%s', (_name, convert, underline) => {
  it.each([
    'Signature: ______ Date: ______',
    'Name: ___ Date: ___',
    'One ___ two ____ three _____',
    '______',
  ])('leaves %j as typed', (text) => {
    expect(convert(text)).toBe(text);
  });

  it('keeps both blanks whole with two spaces between them', () => {
    const out = convert('Signature: ______  Date: ______');
    expect(out).not.toMatch(/uline|<u>/);
    expect(out.match(/_{6}/g)).toHaveLength(2);
  });

  it('still underlines next to a blank', () => {
    expect(convert('__Name__ ______')).toBe(`${underline('Name')} ______`);
    expect(convert('______ __Name__')).toBe(`______ ${underline('Name')}`);
    expect(convert('______ then __Name__ then ______')).toBe(`______ then ${underline('Name')} then ______`);
  });

  it('still underlines adjacent marked runs, which the editor writes back to back', () => {
    expect(convert('__one____two__')).toBe(`${underline('one')}${underline('two')}`);
  });
});
