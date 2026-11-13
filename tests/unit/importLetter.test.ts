import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the actual parser and detectors; only file extraction needs a stand-in.
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn() }));
vi.mock('@/services/docx/pandoc-converter', () => ({
  convertDocxToPlainText: vi.fn(),
  extractDocxMarkingText: vi.fn(),
}));

import { parseLetterText, parseLetterFile, hasParsedContent } from '@/lib/importLetter';
import { extractPdfText } from '@/lib/pdfText';
import { convertDocxToPlainText, extractDocxMarkingText } from '@/services/docx/pandoc-converter';

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
    expect(convertDocxToPlainText).not.toHaveBeenCalled();
  });

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
    vi.mocked(convertDocxToPlainText).mockResolvedValue(body);
    vi.mocked(extractDocxMarkingText).mockResolvedValue('UNCLASSIFIED');
    const result = await parseLetterFile(new File(['sample'], 'sample.docx'));
    expect(result.parsed).toEqual(parseLetterText(body).parsed);
    expect(result.classification).toMatchObject({ classLevel: 'unclassified', found: true });
    expect(parseLetterText(body).classification.found).toBe(false);
  });

  it('still reads a DOCX body if optional header/footer extraction fails', async () => {
    vi.mocked(convertDocxToPlainText).mockResolvedValue(letter);
    vi.mocked(extractDocxMarkingText).mockRejectedValue(new Error('markings unavailable'));
    expect(await parseLetterFile(new File(['sample'], 'sample.docx'))).toEqual(parseLetterText(letter));
  });
});
