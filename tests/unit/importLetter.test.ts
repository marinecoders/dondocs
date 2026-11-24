import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the actual parser and detectors; only file extraction needs a stand-in.
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn() }));

import { parseLetterText, parseLetterFile, hasParsedContent, parsedLetterSession } from '@/lib/importLetter';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { extractPdfText } from '@/lib/pdfText';
import { WORD_NS, wordImportFixture, wordParagraph } from '../_helpers/wordImportFixture';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
installWordXmlDom();

const letter = `UNCLASSIFIED
5216
Ser 1000/001
12 Nov 26

From: Example sender
To: Example recipient
Via: Example reviewer
Subj: SAMPLE LETTER IMPORT
Ref: (a) Sample reference
Encl: (1) Sample enclosure

1. First sample paragraph.
   a. Sample subparagraph.
2. Second sample paragraph.

A. B. EXAMPLE

Copy to:
Example copy recipient`;

beforeEach(() => vi.resetAllMocks());

describe('shared letter-text import pipeline', () => {
  it.each(['\n', '\r\n', '\r'])('recognizes separate editable fields with %j line endings', (lineEnding) => {
    const result = parseLetterText(letter.replace(/\n/g, lineEnding));
    expect(result.parsed).toEqual({
      ssic: '5216', serial: '1000/001', date: '12 Nov 26',
      from: 'Example sender', to: 'Example recipient', via: 'Example reviewer',
      subject: 'SAMPLE LETTER IMPORT',
      references: ['Sample reference'], enclosures: ['Sample enclosure'],
      paragraphs: [
        { text: 'First sample paragraph.', level: 0 },
        { text: 'Sample subparagraph.', level: 1 },
        { text: 'Second sample paragraph.', level: 0 },
      ],
      signature: { first: 'A', middle: 'B', last: 'EXAMPLE' },
      copyTos: ['Example copy recipient'],
    });
    expect(result.detection).toMatchObject({ docType: 'naval_letter', confidence: 'high' });
    expect(result.classification).toMatchObject({ classLevel: 'unclassified', found: true });
    expect(hasParsedContent(result.parsed)).toBe(true);
    expect(extractPdfText).not.toHaveBeenCalled();
  });

  it.each([['naval_letter', 'aa'], ['new_page_endorsement', 'aa'], ['new_page_endorsement', 'a0']])(
    'preserves imported continuation labels in a %s, including %s',
    (docType, continued) => {
      const source = parseLetterText(`From: Example sender\nTo: Example recipient\nSubj: TRAINING\nRef:\n(z) First source\n(${continued}) Second source\n\n1. See reference (${continued}).`);
      const session = parsedLetterSession(source.parsed, docType);
      expect(session.references).toEqual([{ letter: 'z', title: 'First source' }, { letter: continued, title: 'Second source' }]);
      expect(session.paragraphs[0].text).toBe(`See reference (${continued}).`);
      if (docType === 'new_page_endorsement') expect(session.formData.startingReferenceLetter).toBe('z');
      const files = generateAllLatexFiles(session).texFiles;
      expect(files['references.tex']).toContain(`\\lastrefitem{${continued}}{Second source}`);
      expect(files['body.tex']).toContain(`\\reflink{${continued}}`);
    },
  );

  it.each(['', ' \r\n\t ', 'Some text without recognizable letter structure.'])('does not import unrecognized input: %j', (text) => {
    expect(hasParsedContent(parseLetterText(text).parsed)).toBe(false);
  });

  it('uses the existing document-type detection for pasted text', () => {
    expect(parseLetterText('MEMORANDUM FOR THE RECORD\n\n1. Sample body.').detection)
      .toMatchObject({ docType: 'mfr', confidence: 'high' });
  });

  it('produces the same result for pasted text and text extracted from a PDF', async () => {
    vi.mocked(extractPdfText).mockResolvedValue(letter);
    expect(await parseLetterFile(new File(['%PDF'], 'sample.pdf', { type: 'application/pdf' })))
      .toEqual(parseLetterText(letter));
  });

  it('keeps DOCX header/footer markings in classification detection', async () => {
    const body = letter.replace('UNCLASSIFIED\n', '');
    const bytes = await wordImportFixture(body.split('\n').map(wordParagraph).join(''), { 'word/header1.xml': `<w:hdr xmlns:w="${WORD_NS}">${wordParagraph('UNCLASSIFIED')}</w:hdr>` });
    const result = await parseLetterFile(new File([bytes.buffer as ArrayBuffer], 'sample.docx'));
    const { paragraphs: _paragraphs, ...fields } = parseLetterText(body).parsed;
    expect(result.parsed).toMatchObject(fields);
    expect(result.parsed.paragraphs.some(paragraph => paragraph.text === 'First sample paragraph.')).toBe(true);
    expect(result.classification).toMatchObject({ classLevel: 'unclassified', found: true });
    expect(parseLetterText(body).classification.found).toBe(false);
  });

  it('rejects an unreadable header instead of silently omitting possible markings', async () => {
    const bytes = await wordImportFixture(letter.split('\n').map(wordParagraph).join(''), { 'word/header1.xml': '<w:hdr><' });
    await expect(parseLetterFile(new File([bytes.buffer as ArrayBuffer], 'sample.docx'))).rejects.toThrow();
  });
});
