/**
 * The Word export gives a subparagraph the same blank line a top-level
 * paragraph gets.
 *
 * SECNAV M-5216.5 Ch 7 ¶13 names them together — "each paragraph OR
 * SUBPARAGRAPH begins on the second line below the previous paragraph or
 * subparagraph" — and Figure 7-8 prints a hard return between every pair it
 * shows, down to (1)/(2). The flat generator used to emit \vspace{6pt} for
 * subparagraphs against 12pt for top-level ones, i.e. half a line.
 *
 * Asserting on the compiled DOCX rather than the LaTeX: `dondocs.lua` turns
 * \vspace{Npt} into a spacer paragraph carrying `w:before="N*20"` twips, and a
 * source-level check would pass even if the filter dropped the command.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';

const pandocAvailable =
  spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!pandocAvailable) {
  console.warn('[docx-subparagraph-spacing] pandoc not found on PATH — SKIPPING.');
}

/** Every <w:p> in document order. */
function paragraphs(xml: string): string[] {
  return xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g) || [];
}

function textOf(paragraph: string): string {
  return (paragraph.match(/<w:t[^>]*>([^<]*)</g) || [])
    .map((t) => t.replace(/^<w:t[^>]*>/, '').replace(/<$/, ''))
    .join('');
}

/**
 * The `w:before` twips on the spacer paragraph that immediately precedes the
 * paragraph carrying `marker`. The spacer is its own empty <w:p>, so this
 * walks back past nothing else.
 */
function spaceBefore(xml: string, marker: string): number | null {
  const ps = paragraphs(xml);
  const i = ps.findIndex((p) => textOf(p).includes(marker));
  if (i <= 0) return null;
  const before = ps[i - 1];
  const m = before.match(/<w:spacing[^>]*w:before="(\d+)"/);
  return m ? parseInt(m[1], 10) : null;
}

describe.skipIf(!pandocAvailable)('DOCX subparagraph spacing', () => {
  it('opens a subparagraph with the same gap as a top-level paragraph', async () => {
    const store = buildBaseline('naval_letter');
    store.paragraphs = [
      { text: 'ALPHAMARK top level paragraph.', level: 0 },
      { text: 'BRAVOMARK second top level paragraph.', level: 0 },
      { text: 'CHARLIEMARK first subparagraph.', level: 1 },
      { text: 'DELTAMARK second subparagraph.', level: 1 },
      { text: 'ECHOMARK a level two subparagraph.', level: 2 },
    ];

    const result = await compileDocxFixture(store);
    expect(result.ok, formatDocxFailure('docx-subparagraph-spacing', result)).toBe(true);

    const zip = await JSZip.loadAsync(result.docxBytes!);
    const xml = await zip.file('word/document.xml')!.async('string');

    const topLevel = spaceBefore(xml, 'BRAVOMARK');
    expect(topLevel, 'no spacer paragraph before the second top-level paragraph').not.toBeNull();

    for (const marker of ['CHARLIEMARK', 'DELTAMARK', 'ECHOMARK']) {
      const gap = spaceBefore(xml, marker);
      expect(gap, `no spacer paragraph before ${marker}`).not.toBeNull();
      expect(
        gap,
        `${marker} opens with ${gap} twips of space where a top-level paragraph ` +
          `gets ${topLevel}. ¶13 gives them the same blank line; 6pt (120 twips) ` +
          `is half of one.`,
      ).toBe(topLevel);
    }
  }, 120_000);
});
