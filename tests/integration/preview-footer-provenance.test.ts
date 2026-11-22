import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compileFixture } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';
import { normalizePreviewText, previewPageText, sourcesAcrossPages, sourcesOnPage } from '@/lib/previewSources';

async function readPages(bytes: Uint8Array) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const texts: string[] = [], positions: { text: string; y: number; page: number }[] = [];
  try {
    for (let number = 1; number <= Math.min(2, pdf.numPages); number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      texts.push(previewPageText(content.items));
      for (const item of content.items) if ('str' in item) positions.push({ text: item.str, y: item.transform[5], page: number });
    }
    return { texts, positions };
  } finally { await pdf.destroy(); }
}
const paragraphText = Array.from({ length: 80 }, (_, index) => `Sourceword${index} provides clear unique training directions for the next exercise.`).join(' ');

describe.skipIf(!hasPdfToolchain)('native preview footer provenance', () => {
  it('preserves a numeric body word at a page boundary and never links a different paragraph without that word', async () => {
    const store = buildBaseline('naval_letter');
    store.formData.pageNumbering = 'none'; store.formData.subject = 'NUMERIC BODY WORD';
    store.paragraphs = [{ id: 'actual', level: 0, text: paragraphText }, { id: 'elsewhere', level: 0, text: paragraphText }];
    const baseline = await compileFixture(store);
    expect(baseline.ok, baseline.logTail).toBe(true);
    const initial = await readPages(baseline.pdfBytes!);
    const normalized = normalizePreviewText(paragraphText), page = normalizePreviewText(initial.texts[0]);
    const anchor = normalized.split(' ').slice(0, 6).join(' '), prefix = page.slice(page.indexOf(anchor));
    expect(normalized.startsWith(prefix), prefix).toBe(true);
    const words = paragraphText.split(' '), last = prefix.split(' ').length - 1;
    // Short numeric replacement pulls a word onto the last body line. Derive
    // the boundary from the real engine rather than hard-code font metrics.
    for (const index of [last + 1, last, last - 1, last + 2, last - 2]) for (const number of ['99', '9', '999']) {
      const actualWords = [...words], expectedWords = [...words];
      actualWords.splice(index, 1, number); expectedWords.splice(index, 1);
      store.paragraphs = [{ id: 'actual', level: 0, text: actualWords.join(' ') }, { id: 'elsewhere', level: 0, text: expectedWords.join(' ') }];
      const rendered = await compileFixture(store);
      expect(rendered.ok, rendered.logTail).toBe(true);
      const { texts, positions } = await readPages(rendered.pdfBytes!);
      if (!normalizePreviewText(texts[0]).endsWith(number)) continue;
      expect(positions.some(item => item.page === 1 && item.text.trim().endsWith(number) && item.y >= 54)).toBe(true);
      const sources = store.paragraphs.map(item => ({ id: item.id!, paragraphId: item.id!, sectionId: 'body', label: item.id!, text: item.text }));
      const matches = sourcesAcrossPages({ 0: texts[0], 1: texts[1] }, sources, store.formData.subject);
      expect((matches.get(0) ?? []).map(item => item.id), `Native PDF: ${rendered.workDir}/main.pdf`).toEqual(['actual']);
      return;
    }
    throw new Error('The native fixture did not place a numeric word on the last body line.');
  }, 60_000);

  it('removes the actual simple-number footer within the measured footer band', async () => {
    const store = buildBaseline('naval_letter');
    store.formData.pageNumbering = 'simple'; store.formData.subject = 'POSITIONED NUMBERING';
    store.paragraphs = [{ id: 'continued', level: 0, text: paragraphText }];
    const rendered = await compileFixture(store);
    expect(rendered.ok, rendered.logTail).toBe(true);
    const { texts, positions } = await readPages(rendered.pdfBytes!);
    expect(positions.some(item => item.page === 2 && item.text.trim() === '2' && item.y >= 0 && item.y < 54)).toBe(true);
    const source = { id: 'continued', paragraphId: 'continued', sectionId: 'body', label: 'Paragraph 1', text: paragraphText };
    expect(sourcesAcrossPages({ 0: texts[0], 1: texts[1] }, [source], store.formData.subject).get(1)).toEqual([source]);
  });
});

it.skipIf(!hasPdfToolchain)('never treats repeated classification banners as a body paragraph on a different page', async () => {
  const store = buildBaseline('naval_letter');
  store.formData.classLevel = 'confidential';
  store.paragraphs = [
    { id: 'long', level: 0, text: 'This synthetic training paragraph supplies ordinary correspondence text for a page boundary. '.repeat(95) },
    { id: 'target', level: 0, text: 'CONFIDENTIAL' },
  ];
  const result = await compileFixture(store);
  expect(result.ok, result.logTail).toBe(true);
  const { texts } = await readPages(result.pdfBytes!);
  expect(texts[0].match(/CONFIDENTIAL/g)).toHaveLength(2);
  expect(sourcesOnPage(texts[0], [{ id: 'target', paragraphId: 'target', sectionId: 'body', label: 'Paragraph 2', text: 'CONFIDENTIAL' }])).toEqual([]);
}, 60_000);
