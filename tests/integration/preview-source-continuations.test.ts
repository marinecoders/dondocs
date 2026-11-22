import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { join } from 'node:path';
import { previewPageText, sourcesAcrossPages } from '@/lib/previewSources';
import { compileFixture } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';

describe.skipIf(!hasPdfToolchain)('actual continued paragraph navigation', () => {
  it('matches the source over compiled native PDF continuation pages', async () => {
    const store = buildBaseline('naval_letter');
    store.formData.subject = 'CROSS PAGE SOURCE';
    const text = Array.from({ length: 80 }, (_, index) => `Sourceword${index} provides clear unique training directions for the next exercise.`).join(' ');
    store.paragraphs = [{ id: 'continued', level: 0, text }];
    const compiled = await compileFixture(store);
    expect(compiled.ok, compiled.logTail).toBe(true);
    const pdf = await getDocument({ data: new Uint8Array(await readFile(join(compiled.workDir, 'main.pdf'))), useSystemFonts: true }).promise;
    const pages: string[] = [];
    try {
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        pages.push(previewPageText(content.items));
      }
    } finally { await pdf.destroy(); }
    expect(pages.length).toBeGreaterThan(1);
    const source = { id: 'continued', paragraphId: 'continued', label: 'Paragraph 1', sectionId: 'body', text };
    const matches = sourcesAcrossPages(Object.fromEntries(pages.map((page, index) => [index, page])), [source], store.formData.subject);
    expect(matches.get(1), pages.join('\n---\n')).toEqual([source]);
  });
});
