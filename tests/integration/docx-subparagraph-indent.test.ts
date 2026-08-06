/**
 * Subparagraphs indent their FIRST LINE only.
 *
 * SECNAV M-5216.5 Ch 7 ¶13: "When using a subparagraph, the first line is
 * always indented the appropriate number of spaces depending on the level of
 * subparagraphing. All other lines of a subparagraph continue at the left
 * margin. Do not indent the continuation lines of a subparagraph." Figure 7-8
 * shows the same shape.
 *
 * The flat generator emitted `\dondocsindent`, which `postProcessDocx` turns
 * into `w:ind w:left` — a block indent that pushes every wrapped line right
 * too. The correct marker is `\dondocsfirstindent` → `w:ind w:firstLine`.
 *
 * These assert on the marker characters in the compiled DOCX rather than the
 * LaTeX, because the marker has to survive pandoc AND the Lua filter to mean
 * anything: `dondocs.lua` silently drops raw LaTeX it does not recognise, so a
 * generator emitting a command the filter ignores looks correct in source and
 * produces an unindented paragraph. The two markers are deliberately different
 * characters (U+00A0 vs U+2003) precisely so the post-pass can tell them apart.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';

const pandocAvailable =
  spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!pandocAvailable) {
  console.warn(
    '[docx-subparagraph-indent] pandoc not found on PATH — the indent checks below will be SKIPPED.'
  );
}

const NBSP = '\u00A0';   // \dondocsindent      → w:ind w:left     (whole block)
const EMSP = '\u2003';   // \dondocsfirstindent → w:ind w:firstLine (first line only)

/** The <w:p> elements whose text contains `needle`. */
function paragraphsContaining(xml: string, needle: string): string[] {
  return (xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).filter(p => {
    const text = (p.match(/<w:t[^>]*>([^<]*)</g) || []).join('');
    return text.includes(needle);
  });
}

/**
 * The run of marker characters at the very start of a paragraph — the only
 * place the post-pass reads an indent from.
 *
 * Deliberately not "does the paragraph contain a nbsp anywhere": the `~~`
 * between a label and its text is itself a pair of non-breaking spaces, so a
 * whole-paragraph search reports a block indent on every numbered subparagraph
 * whether or not one is present.
 */
function leadingIndentMarkers(paragraph: string): string {
  const firstText = paragraph.match(/<w:t[^>]*>([^<]*)</)?.[1] ?? '';
  return firstText.match(/^[\u00A0\u2003]*/)?.[0] ?? '';
}

describe.skipIf(!pandocAvailable)('DOCX subparagraph indentation', () => {
  it('marks subparagraphs for a first-line indent, not a block indent', async () => {
    const store = buildBaseline('naval_letter');
    store.paragraphs = [
      { text: 'PARENT_MARKER top level paragraph.', level: 0 },
      { text: 'CHILD_MARKER first subparagraph.', level: 1 },
      { text: 'GRANDCHILD_MARKER second level down.', level: 2 },
    ];

    const result = await compileDocxFixture(store);
    expect(result.ok, formatDocxFailure('subparagraph-indent', result)).toBe(true);

    const zip = await JSZip.loadAsync(result.docxBytes!);
    const xml = await zip.file('word/document.xml')!.async('string');

    for (const marker of ['CHILD_MARKER', 'GRANDCHILD_MARKER']) {
      const [para] = paragraphsContaining(xml, marker);
      expect(para, `no paragraph rendered for ${marker}`).toBeDefined();
      const markers = leadingIndentMarkers(para!);
      expect(markers.length, `${marker} has no indent marker at all`).toBeGreaterThan(0);
      expect(
        markers.includes(NBSP),
        `${marker} leads with the block-indent marker — its wrapped lines will ` +
          'be pushed right, which ¶13 forbids',
      ).toBe(false);
      expect(markers.split('').every(c => c === EMSP)).toBe(true);
    }

    // Level 0 starts at the left margin and gets no marker of either kind.
    const [parent] = paragraphsContaining(xml, 'PARENT_MARKER');
    expect(parent).toBeDefined();
    expect(leadingIndentMarkers(parent!)).toBe('');
  }, 120_000);

  it('deepens the first-line indent with each level', async () => {
    const store = buildBaseline('naval_letter');
    // A subparagraph aligns under its parent's text, so the fixture needs the
    // parent: opening a document at level 1 leaves nothing to align to.
    store.paragraphs = [
      { text: 'LVL0 zero.', level: 0 },
      { text: 'LVL1 one.', level: 1 },
      { text: 'LVL2 two.', level: 2 },
    ];

    const result = await compileDocxFixture(store);
    expect(result.ok, formatDocxFailure('subparagraph-depth', result)).toBe(true);
    const zip = await JSZip.loadAsync(result.docxBytes!);
    const xml = await zip.file('word/document.xml')!.async('string');

    const runLength = (marker: string) => {
      const [para] = paragraphsContaining(xml, marker);
      return leadingIndentMarkers(para ?? '').length;
    };

    expect(runLength('LVL1')).toBeGreaterThan(0);
    expect(runLength('LVL2')).toBeGreaterThan(runLength('LVL1'));
  }, 120_000);

  it('leaves business letters on the block indent', async () => {
    // Ch 11 has no equivalent of the Ch 7 ¶13 continuation-line rule, and the
    // business layout deliberately indents the whole block.
    const store = buildBaseline('business_letter');
    store.paragraphs = [{ text: 'BIZ_MARKER indented block.', level: 1 }];

    const result = await compileDocxFixture(store);
    expect(result.ok, formatDocxFailure('business-indent', result)).toBe(true);
    const zip = await JSZip.loadAsync(result.docxBytes!);
    const xml = await zip.file('word/document.xml')!.async('string');

    const [para] = paragraphsContaining(xml, 'BIZ_MARKER');
    expect(para).toBeDefined();
    expect(leadingIndentMarkers(para!)).toContain(NBSP);
  }, 120_000);
});
