/**
 * The Word export applies the same heading rule as the PDF: a period only when
 * text follows the heading.
 *
 * SECNAV M-5216.5 Ch 7 ¶13d covers the underline and the capitalization; the
 * manual's own 75 standalone headings supply the rest, 69 of them bare. The
 * two generators are separate code paths, so this is asserted twice.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';

const pandocAvailable =
  spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!pandocAvailable) {
  console.warn('[docx-heading-period] pandoc not found on PATH — SKIPPING.');
}

/** Text of each <w:p> in document order, whitespace collapsed. */
function paragraphTexts(xml: string): string[] {
  const ps = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g) || [];
  return ps.map((p) =>
    (p.match(/<w:t[^>]*>([^<]*)</g) || [])
      .map((t) => t.replace(/^<w:t[^>]*>/, '').replace(/<$/, ''))
      .join('')
      .trim()
      .replace(/\s+/g, ' '),
  );
}

function paragraphWith(texts: string[], needle: string): string {
  const p = texts.find((t) => t.includes(needle));
  expect(p, `could not find a paragraph containing "${needle}"`).toBeDefined();
  return p!;
}

describe.skipIf(!pandocAvailable)('DOCX paragraph heading punctuation', () => {
  it('leaves a heading bare when it has no text, and keeps the period when it does', async () => {
    const store = buildBaseline('naval_letter');
    store.paragraphs = [
      { text: '', header: 'Format', level: 0 },
      { text: 'The first subparagraph carries body text.', header: '', level: 1 },
      { text: 'Body text follows this heading on the same line.', header: 'General Rules', level: 0 },
      { text: '', header: 'Deadline', level: 1 },
    ];

    const result = await compileDocxFixture(store);
    expect(result.ok, formatDocxFailure('docx-heading-period', result)).toBe(true);

    const zip = await JSZip.loadAsync(result.docxBytes!);
    const xml = await zip.file('word/document.xml')!.async('string');
    const texts = paragraphTexts(xml);

    expect(paragraphWith(texts, 'Format'), 'a heading with no text of its own takes no punctuation').toBe(
      '1. Format',
    );
    expect(paragraphWith(texts, 'Deadline'), 'the rule holds at subparagraph level too').toBe(
      'a. Deadline',
    );
    expect(
      paragraphWith(texts, 'General Rules'),
      'a heading that introduces a sentence still keeps its period',
    ).toBe('2. General Rules. Body text follows this heading on the same line.');
  }, 120_000);
});
