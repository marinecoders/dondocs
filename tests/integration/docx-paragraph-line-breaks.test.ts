/**
 * Line breaks inside a paragraph have to survive into Word.
 *
 * The PDF path turned `\n` into `\\` and trimmed breaks at the paragraph
 * edges; the Word path did neither. Pandoc read a single newline as a space,
 * so a Shift+Enter break vanished, and a blank line as a paragraph break, so
 * a sub-paragraph whose text began with one printed its label on a line of
 * its own. Only the compiled document shows this, so these read Word's
 * paragraphs and line breaks out of document.xml.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';

const pandocAvailable = spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!pandocAvailable) {
  console.warn('[docx-paragraph-line-breaks] pandoc not found on PATH — these checks will be SKIPPED.');
}

const store = (paragraphs: { text: string; level: number }[]) => ({
  docType: 'naval_letter',
  formData: {
    docType: 'naval_letter', fontSize: '12pt', fontFamily: 'times', pageNumbering: 'none',
    department: 'usmc', unitLine1: '1ST BATTALION, 6TH MARINES',
    unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123', sealType: 'dow',
    letterheadColor: 'blue', ssic: '5216', date: '7 Sep 06',
    from: 'Commanding Officer', to: 'Commanding General', subject: 'LINE BREAKS',
    sigFirst: 'John', sigLast: 'DOE', classLevel: 'unclassified',
  },
  references: [], enclosures: [], copyTos: [], distributions: [], paragraphs,
}) as never;

/** Word paragraphs as text, with each line break shown as ⏎. */
async function wordParagraphs(paragraphs: { text: string; level: number }[]): Promise<string[]> {
  const result = await compileDocxFixture(store(paragraphs));
  expect(result.ok, formatDocxFailure('line breaks', result)).toBe(true);
  const xml = await (await JSZip.loadAsync(result.docxBytes!)).file('word/document.xml')!.async('string');
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [])
    .map(p => [...p.matchAll(/<w:t[^>]*>([^<]*)<|<w:br\s*\/>/g)].map(m => m[1] ?? '⏎').join('').trim());
}

describe.skipIf(!pandocAvailable)('Word export — line breaks inside a paragraph', () => {
  it('keeps a Shift+Enter break as a line break', async () => {
    const paras = await wordParagraphs([{ text: 'line one\nline two', level: 0 }]);
    expect(paras.find(p => p.includes('line one'))).toMatch(/^1\.\s+line one⏎line two$/);
  }, 120_000);

  it('keeps a blank line inside the paragraph instead of splitting it', async () => {
    const paras = await wordParagraphs([{ text: 'above\n\nbelow', level: 0 }]);
    expect(paras.find(p => p.includes('above'))).toMatch(/^1\.\s+above⏎\s*⏎below$/);
  }, 120_000);

  it('drops breaks at the start, so a sub-paragraph label stays with its text', async () => {
    const paras = await wordParagraphs([
      { text: 'Parent.', level: 0 },
      { text: '\n\nSub-paragraph text.', level: 1 },
    ]);
    expect(paras.find(p => p.includes('Sub-paragraph'))).toMatch(/^a\.\s+Sub-paragraph text\.$/);
  }, 120_000);
});
