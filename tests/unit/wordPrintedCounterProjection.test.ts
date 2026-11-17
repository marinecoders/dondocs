import { describe, expect, it } from 'vitest';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordRun } from '../_helpers/wordImportFixture';
import { readWordDocument } from '@/services/docx/import/readWord';
import { readWordPrintedCounter } from '@/services/docx/import/printedCounter';
installWordXmlDom();
const underline = (text: string) => wordRun(text, '<w:u w:val="single"/>');
const labels = [
  { xml: wordRun('1. '), raw: '1. ', level: 0 }, { xml: wordRun('a. '), raw: 'a. ', level: 1 },
  { xml: wordRun('(1) '), raw: '(1) ', level: 2 }, { xml: wordRun('(a) '), raw: '(a) ', level: 3 },
  { xml: underline('1') + wordRun('. '), raw: '__1__. ', level: 4 },
  { xml: underline('a') + wordRun('. '), raw: '__a__. ', level: 5 },
  { xml: underline('(1)') + wordRun(' '), raw: '__(1)__ ', level: 6 },
  { xml: underline('(a)') + wordRun(' '), raw: '__(a)__ ', level: 7 },
  { xml: wordRun('(') + underline('1') + wordRun(') '), raw: '(__1__) ', level: 6 },
  { xml: wordRun('(') + underline('a') + wordRun(') '), raw: '(__a__) ', level: 7 },
];
const whitespace = [
  { name: 'spaces', xml: wordRun('  '), raw: '  ' },
  { name: 'tab', xml: '<w:r><w:tab/></w:r>', raw: '\t' },
  { name: 'line break', xml: '<w:r><w:br/></w:r>', raw: '\n' },
];
const cases = labels.flatMap(label => whitespace.map(space => ({ ...label, space })));
describe('shared Word printed labels with leading whitespace', () => {
  it.each(cases)('projects level $level with $space.name while preserving raw and visible offsets', async ({ xml, raw, level, space }) => {
    const source = await wordImportFixture(`<w:p>${space.xml}${xml}${wordRun('Keep ')}${wordRun('bold', '<w:b/>')}${wordRun(' body.')}</w:p>`);
    const imported = await readWordDocument(source, 'whitespace-label.docx'), prefix = space.raw + raw;
    expect(readWordPrintedCounter(prefix + 'Keep **bold** body.')).toEqual({ serializedLength: prefix.length, visibleLength: prefix.replaceAll('__', '').length, level });
    expect(imported.sourceBlocks[0].paragraph.text).toBe(prefix + 'Keep **bold** body.');
    expect(imported.blocks[0].paragraph).toMatchObject({ level, text: 'Keep **bold** body.' });
    expect(imported.blocks[0].nativeTextOffset).toBe(prefix.replaceAll('__', '').length);
    expect(imported.source.bytes).toEqual(source);
  });
  it.each(whitespace)('keeps ordinary emphasized numbers and prose after $name', async space => {
    const source = await wordImportFixture(`<w:p>${space.xml}${underline('1')}${wordRun(' ordinary body text.')}</w:p>`);
    const imported = await readWordDocument(source, 'ordinary-prose.docx');
    expect(readWordPrintedCounter(space.raw + '__1__ ordinary body text.')).toBeUndefined();
    expect(imported.blocks[0].paragraph).toMatchObject({ level: 0, text: space.raw + '__1__ ordinary body text.' });
    expect(imported.blocks[0].nativeTextOffset).toBe(0);
  });
});
