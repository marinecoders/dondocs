import { expect, it } from 'vitest';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordDrawing, wordImportFixture, wordParagraph } from '../_helpers/wordImportFixture';
import { parseLetterFile, parsedLetterSession } from '@/lib/importLetter';
import { generateFlatLatex } from '@/services/latex/flat-generator';

installWordXmlDom();
const header = ['5216', 'Ser TRNG/001', '16 Nov 26', 'From: Training Office', 'To: Fictional Marine', 'Subj: OWNED WORD FIELDS'];
async function parse(lines: string[], suffix = '') {
  const bytes = await wordImportFixture(lines.map(wordParagraph).join('') + suffix);
  return parseLetterFile(new File([bytes.buffer as ArrayBuffer], 'field-ownership.docx'));
}

it('maps complete ordinary Word paragraph fields and emits each reference/enclosure only once', async () => {
  const result = await parse([...header, 'Ref: (a) REFERENCE-TRAINING', 'Encl: (1) ENCLOSURE-TRAINING', '1. Body action.', 'J. A. DOE']);
  expect(result.parsed).toMatchObject({ ssic: '5216', serial: 'TRNG/001', date: '16 Nov 26', references: ['REFERENCE-TRAINING'], enclosures: ['ENCLOSURE-TRAINING'], signature: { first: 'J', middle: 'A', last: 'DOE' } });
  expect(result.word!.blocks.map(block => block.paragraph.text)).toEqual(['Body action.']);
  const session = parsedLetterSession(result.parsed);
  const output = generateFlatLatex(session);
  expect(output.match(/REFERENCE-TRAINING/g)).toHaveLength(1);
  expect(output.match(/ENCLOSURE-TRAINING/g)).toHaveLength(1);
});

it('claims complete multi-paragraph lists and finds the closing signature before both trailing list types', async () => {
  const result = await parse([...header, 'Ref:', '(a) FIRST REFERENCE', '(b) SECOND REFERENCE', 'Encl:', '(1) FIRST ENCLOSURE', '1. Body action.', 'J. A. DOE', 'Copy to:', 'COPYTO-TRAINING-RECIPIENT', '', 'Distribution:', 'DISTRIBUTION-TRAINING-RECIPIENT']);
  expect(result.parsed.references).toEqual(['FIRST REFERENCE', 'SECOND REFERENCE']);
  expect(result.parsed.copyTos).toEqual(['COPYTO-TRAINING-RECIPIENT']);
  expect(result.parsed.distributions).toEqual(['DISTRIBUTION-TRAINING-RECIPIENT']);
  expect(result.parsed.signature).toEqual({ first: 'J', middle: 'A', last: 'DOE' });
  expect(result.word!.blocks.map(block => block.paragraph.text)).toEqual(['Body action.']);
  const output = generateFlatLatex(parsedLetterSession(result.parsed));
  expect(output.match(/COPYTO-TRAINING-RECIPIENT/g)).toHaveLength(1);
  expect(output.match(/DISTRIBUTION-TRAINING-RECIPIENT/g)).toHaveLength(1);
});

it('retains ambiguous reference/trailing prose in the body without populating it from plain-parser guesses', async () => {
  const result = await parse([...header, 'Ref: (b) AMBIGUOUS-REFERENCE', '1. Body action.', 'J. A. DOE', 'Copy to:', 'COPYTO-TRAINING-RECIPIENT', 'This unknown trailing prose must remain.']);
  expect(result.parsed.references).toEqual([]);
  expect(result.parsed.copyTos).toEqual([]);
  expect(result.parsed.signature).toBeUndefined();
  const body = result.word!.blocks.map(block => block.paragraph.text);
  expect(body).toContain('Ref: (b) AMBIGUOUS-REFERENCE');
  expect(body).toContain('This unknown trailing prose must remain.');
  expect(body).toContain('J. A. DOE');
  expect(result.word!.notices.join(' ')).toContain('ambiguous');
});

it('keeps repeated header values and duplicate trailing lists once each without assigning ambiguous metadata', async () => {
  const result = await parse(['From: FIRST-SOURCE-OFFICE', 'From: SECOND-SOURCE-OFFICE', 'To: Marine', 'Subj: SOURCE', '1. Body', 'Copy to: FIRST-RECIPIENT', 'Copy to: SECOND-RECIPIENT']);
  expect(result.parsed.from).toBeUndefined();
  expect(result.parsed.copyTos).toEqual([]);
  const body = result.word!.blocks.map(block => block.paragraph.text).join('\n');
  for (const text of ['FIRST-SOURCE-OFFICE', 'SECOND-SOURCE-OFFICE', 'FIRST-RECIPIENT', 'SECOND-RECIPIENT']) expect(body.split(text)).toHaveLength(2);
});

it('preserves genuine introductory prose/tables/images and an unowned date after the address', async () => {
  const table = `<w:tbl><w:tr><w:tc>${wordParagraph('Name')}</w:tc><w:tc>${wordParagraph('MARINE')}</w:tc></w:tr></w:tbl>`;
  const bytes = await wordImportFixture(['From: Office', 'To: Marine', 'Subj: SOURCE', 'Important introduction.', '16 Nov 26'].map(wordParagraph).join('') + table + `<w:p>${wordDrawing}</w:p>` + wordParagraph('1. Action'));
  const result = await parseLetterFile(new File([bytes.buffer as ArrayBuffer], 'genuine-prefix.docx'));
  expect(result.parsed.date).toBeUndefined();
  expect(result.word!.blocks.map(block => block.paragraph.text)).toEqual(['Important introduction.', '16 Nov 26', '', 'Source image', 'Action']);
  expect(result.word!.blocks[2].paragraph.bodyTable?.rows).toEqual([['Name', 'MARINE']]);
});


it.each([
  'Ref: (a) REFERENCE-A (b) REFERENCE-B',
  'Ref: (a) REFERENCE-A (c) AMBIGUOUS-REFERENCE-C',
  'Encl: (1) ENCLOSURE-A (2) ENCLOSURE-B',
  'Encl: (1) ENCLOSURE-A (3) AMBIGUOUS-ENCLOSURE-C',
])('retains an inline multi-item list once with an explicit review notice: %s', async value => {
  const result = await parse([...header, value, '1. Body action.']);
  expect(result.parsed.references).toEqual([]);
  expect(result.parsed.enclosures).toEqual([]);
  expect(result.word!.blocks.filter(block => block.paragraph.text === value)).toHaveLength(1);
  expect(result.word!.notices.join(' ')).toContain('ambiguous Word reference/enclosure list');
});
