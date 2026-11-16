import { describe, expect, it } from 'vitest';
import { joinReviewParagraphs, reviewStructureTextRuns, splitReviewParagraph } from '@/lib/reviewStructureFormatting';
import { lineToHtml } from '@/components/ui/variable-chip-editor-text';
const paragraph = (text: string) => ({ id: 'old', level: 0, text });

describe('format-preserving structural text', () => {
  it.each(['**', '*', '__'])('reopens %s at a split without trimming whitespace', marker => {
    const text = `Before ${marker}bold words${marker} after`;
    const result = splitReviewParagraph(paragraph(text), 7 + marker.length + 5, 'fresh');
    expect(result.map(item => item.text)).toEqual([`Before ${marker}bold ${marker}`, `${marker}words${marker} after`]);
    expect(result.map(item => lineToHtml(item.text)).join('')).toContain('words');
    expect(result.map(item => item.id)).toEqual(['old', 'fresh']);
  });
  it('preserves separate rich runs, variable chips, headings, markings and reference labels', () => {
    const source = { ...paragraph('**Bold** *italic* __underlined__ {{NAME}} end'), header: 'Heading', portionMarking: 'U' as const, referenceId: 'ref' };
    const result = splitReviewParagraph(source, source.text.indexOf('{{'), 'fresh');
    expect(result[0]).toEqual({ ...source, text: '**Bold** *italic* __underlined__ ' });
    expect(result[1]).toEqual({ id: 'fresh', level: 0, portionMarking: 'U', text: '{{NAME}} end' });
    expect(() => splitReviewParagraph(source, source.text.indexOf('NAME'), 'fresh')).toThrow(/variable/);
  });
  it('preserves exact join whitespace and each supported run', () => {
    const left = paragraph(' **Bold** '), right = { ...paragraph('*italic* __underlined__ {{NAME}}  '), id: 'right' };
    expect(joinReviewParagraphs(left, right, ' ')).toEqual({ ...left, text: ' **Bold**  *italic* __underlined__ {{NAME}}  ' });
    expect(joinReviewParagraphs(paragraph('word'), { ...paragraph('tail'), id: 'right' }, '').text).toBe('wordtail');
  });
  it('rejects malformed, nested, legacy and atomic structures with a recovery explanation', () => {
    for (const text of ['**unclosed', '***nested***', '__foo_bar__', '\\textbf{legacy}', 'one\ntwo', '{{bad}}', '<b>x</b>']) expect(() => reviewStructureTextRuns(text)).toThrow(/ordinary editing/);
    expect(() => splitReviewParagraph({ ...paragraph('one two'), tableKey: 'table' }, 3, 'fresh')).toThrow();
    expect(() => joinReviewParagraphs(paragraph('one'), { ...paragraph('two'), header: 'Label' }, ' ')).toThrow(/heading/);
    expect(() => joinReviewParagraphs(paragraph('one'), { ...paragraph('two'), portionMarking: 'S' }, ' ')).toThrow(/marking/);
  });
  it('requires complete Unicode graphemes and nonempty sides', () => {
    const source = paragraph('A😀e\u0301👨‍👩‍👧‍👦Z');
    for (const offset of [0, 2, 4, 6, source.text.length]) expect(() => splitReviewParagraph(source, offset, 'fresh')).toThrow();
    expect(() => splitReviewParagraph(paragraph('**e**\u0301x'), 3, 'fresh')).toThrow(/visible character/);
    expect(splitReviewParagraph(source, 3, 'fresh').map(item => item.text)).toEqual(['A😀', 'e\u0301👨‍👩‍👧‍👦Z']);
  });
});
