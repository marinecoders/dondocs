import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { executiveTemplates } from '@/data/templates/executive';
import { templateSession } from '@/lib/templateSession';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';

const available = ['pdflatex', 'pandoc'].every(tool => spawnSync(tool, ['--version']).status === 0);
describe.skipIf(!available)('Chapter 12 template exports', () => {
  it.each(executiveTemplates)('$name preserves its content and page size in PDF and Word', async template => {
    const session = templateSession(template, { unitLine1: 'TRAINING COMMAND', unitAddress: '123 TEST STREET', sigFirst: 'TRAINING', sigLast: 'EXAMPLE' });
    const store = { ...session, formData: { ...session.formData, date: '21 Nov 2026', signatureType: 'none' as const } };
    const expected = template.correspondenceDefaults?.stationerySize === '7x9' ? [504, 648] : template.correspondenceDefaults?.stationerySize === '5x7' ? [360, 504] : [612, 792];
    const result = await compileFixture(store);
    if (!result.ok) throw new Error(formatFailure(template.id, result));
    const pdf = await getDocument({ data: new Uint8Array(result.pdfBytes!), useSystemFonts: false }).promise;
    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      expect(viewport.width).toBeCloseTo(expected[0], 0);
      expect(viewport.height).toBeCloseTo(expected[1], 0);
      const text: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        text.push((await (await pdf.getPage(pageNumber)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '));
      }
      expect(text.join(' ')).toContain('EXAMPLE');
      expect(text.join(' ').replace(/\s+/g, ' ')).toContain(template.paragraphs[0].text.replace(/\s+/g, ' '));
      for (const line of (template.correspondenceDefaults?.to || '').split('\n')) expect(text.join(' ').replace(/\s+/g, ' ')).toContain(line);
      if (template.correspondenceDefaults?.letterheadMode === 'preprinted') expect(text.join(' ')).not.toContain('TRAINING COMMAND');
    } finally { await pdf.destroy(); }
    const word = await compileDocxFixture(store);
    if (!word.ok) throw new Error(formatDocxFailure(template.id, word));
    const blob = await postProcessDocx(new Blob([word.docxBytes! as BlobPart]), {
      docType: store.docType, letterheadMode: template.correspondenceDefaults?.letterheadMode,
      stationerySize: template.correspondenceDefaults?.stationerySize,
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain(`w:w="${expected[0] * 20}" w:h="${expected[1] * 20}"`);
    expect(xml).toContain('EXAMPLE');
    for (const line of (template.correspondenceDefaults?.to || '').split('\n')) expect(xml).toContain(line.replaceAll('&', '&amp;'));
    expect(xml).toContain(template.paragraphs[0].text.replaceAll('&', '&amp;'));
  });
});
