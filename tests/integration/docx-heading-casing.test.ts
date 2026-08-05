/**
 * The Word export keeps a heading's capitals and its punctuation.
 *
 * Two separate defects met on this path. The DOCX generator lowercased the
 * tail of every word, like the PDF one did, so MCO 5216.20B Ch 13 ¶5b's
 * acronyms came out as Hqmc and Medevac. It also deleted every ( ) , . ; : ! ?
 * ' " / \ from the heading, which the PDF path never did — so a heading kept
 * its commas in the PDF and lost them in Word, and a slash form arrived welded
 * together as "CommanderCommanding Officer".
 *
 * The same fixture list drives the PDF test, and this asserts the identical
 * strings, so the two formats cannot drift apart again without a failure here.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';
import { HEADING_CASES } from '../_helpers/headingCases';

const pandocAvailable =
  spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!pandocAvailable) {
  console.warn('[docx-heading-casing] pandoc not found on PATH — SKIPPING.');
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

describe.skipIf(!pandocAvailable)('DOCX paragraph heading casing', () => {
  it('keeps acronyms, mixed-case terms and punctuation exactly as typed', async () => {
    const store = buildBaseline('naval_letter');
    store.paragraphs = HEADING_CASES.map(({ typed }) => ({ text: 'Body text.', header: typed, level: 0 }));

    const result = await compileDocxFixture(store);
    expect(result.ok, formatDocxFailure('docx-heading-casing', result)).toBe(true);

    const zip = await JSZip.loadAsync(result.docxBytes!);
    const texts = paragraphTexts(await zip.file('word/document.xml')!.async('string'));

    HEADING_CASES.forEach(({ typed, rendered }, i) => {
      const want = `${i + 1}. ${rendered}. Body text.`;
      const got = texts.find((t) => t.startsWith(`${i + 1}. `) && t.endsWith('Body text.'));
      expect(got, `no paragraph for heading ${i + 1} ("${typed}")`).toBeDefined();
      expect(got, `"${typed}" must export as "${rendered}"`).toBe(want);
    });
  }, 120_000);
});
