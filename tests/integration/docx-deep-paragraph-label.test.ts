/**
 * Paragraph labels below the fourth level are underlined, and the underline has
 * to survive into Word rather than printing as LaTeX source.
 *
 * The generator emits such a label as `\mbox{\uline{1.}}` — the `\mbox` stops
 * pandoc reading "1." at the start of a line as an ordered-list marker. The Lua
 * filter's mbox handler returned its content as a plain string, so Word showed
 * the characters `\uline{1.}` in front of the paragraph.
 *
 * A bare `\uline` was never the problem: pandoc reads it correctly, which is
 * why inline `__underline__` in body text has always worked. The `\mbox`
 * wrapper is what hid it, so that is where this is fixed.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';

const pandocAvailable =
  spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!pandocAvailable) {
  console.warn('[docx-deep-paragraph-label] pandoc not found on PATH — SKIPPING.');
}

/** A letter nested deep enough that labels start being underlined. */
function deeplyNested() {
  const store = buildBaseline('naval_letter');
  store.paragraphs = [
    { text: 'Top level.', level: 0 },
    { text: 'Second level.', level: 1 },
    { text: 'Third level.', level: 2 },
    { text: 'Fourth level.', level: 3 },
    { text: 'DEEPMARKER fifth level.', level: 4 },
  ];
  return store;
}

async function documentXml(store: ReturnType<typeof deeplyNested>) {
  const result = await compileDocxFixture(store);
  expect(result.ok, formatDocxFailure('deep-label', result)).toBe(true);
  const zip = await JSZip.loadAsync(result.docxBytes!);
  return zip.file('word/document.xml')!.async('string');
}

describe.skipIf(!pandocAvailable)('DOCX deep paragraph labels', () => {
  it('renders the label underlined instead of printing \\uline', async () => {
    const xml = await documentXml(deeplyNested());

    expect(xml, 'raw LaTeX leaked into the document text').not.toContain('\\uline');
    expect(xml, 'the label lost its underline run').toContain('<w:u ');

    const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)</g)].map(m => m[1]);
    expect(texts.join(''), 'the label itself disappeared').toContain('1.');
  }, 120_000);

  it('leaves shallower labels as plain text', async () => {
    // Levels 1-4 are not underlined, so they must not gain an \mbox-shaped
    // underline just because the handler learned a new trick.
    const store = buildBaseline('naval_letter');
    store.paragraphs = [{ text: 'SHALLOW only level.', level: 0 }];
    const xml = await documentXml(store);

    expect(xml).not.toContain('\\uline');
    const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)</g)].map(m => m[1]).join('');
    expect(texts).toContain('SHALLOW');
  }, 120_000);

  it('still underlines an inline __phrase__ in body text', async () => {
    // The path that already worked, pinned so the filter change cannot regress
    // it while fixing the label.
    const store = buildBaseline('naval_letter');
    store.paragraphs = [{ text: 'Body with __an underlined phrase__ inline.', level: 0 }];
    const xml = await documentXml(store);

    expect(xml).toContain('<w:u ');
    const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)</g)].map(m => m[1]).join('');
    expect(texts).toContain('an underlined phrase');
    expect(xml).not.toContain('\\uline');
  }, 120_000);
});
