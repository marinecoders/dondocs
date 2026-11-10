import { describe, expect, it } from 'vitest';
import mammoth from 'mammoth';
import { compileFixture } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import JSZip from 'jszip';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { finishCorrespondencePdf } from '@/services/pdf/finishCorrespondencePdf';

describe('native correspondence list pagination', () => {
  it.each(['standard_memorandum', 'executive_memorandum'] as const)('%s preserves single-reference URI actions in the final native PDF', async type => {
    const store = buildBaseline(type);
    const url = 'https://example.mil/my_reference?section=2&name=training%20plan#overview';
    store.references = [{ letter: 'a', title: 'Training coordination and operational readiness requirements for all assigned commands and supporting activities', url }];
    store.enclosures = [];
    store.formData.includeHyperlinks = true;
    store.formData.signatureType = 'none';
    const result = await compileFixture(store);
    expect(result.ok, result.logTail).toBe(true);
    const final = await finishCorrespondencePdf(result.pdfBytes!, type, store.formData, generateAllLatexFiles(store));
    const pdf = await getDocument({ data: final.pdfBytes.slice(), useSystemFonts: false }).promise;
    try {
      const links = (await (await pdf.getPage(1)).getAnnotations()).filter(a => a.url === url);
      expect(links).toHaveLength(2);
    } finally { await pdf.destroy(); }
  }, 60_000);

  it.each([11, 12])('keeps Courier %ipt reference captions inside their Word columns', async size => {
    for (const count of [1, 2]) {
      const store = buildBaseline('standard_memorandum');
      store.documentMode = 'custom';
      Object.assign(store.formData, { fontFamily: 'courier', fontSize: `${size}pt` });
      store.references = Array.from({ length: count }, (_, i) => ({ letter: String.fromCharCode(97 + i), title: `REFERENCE${i} training guidance` }));
      store.enclosures = [];
      const result = await compileDocxFixture(store);
      expect(result.ok, result.log).toBe(true);
      const final = await postProcessDocx(new Blob([Uint8Array.from(result.docxBytes!)]), { docType: store.docType, ...store.formData });
      const zip = await JSZip.loadAsync(await final.arrayBuffer());
      const xml = await zip.file('word/document.xml')!.async('string');
      const styles = await zip.file('word/styles.xml')!.async('string');
      expect(styles.match(/<w:docDefaults>[^]*?<\/w:docDefaults>/)?.[0]).toContain(`<w:sz w:val="${size * 2}"/>`);
      const caption = count === 1 ? 'Reference:' : 'Reference(s):';
      const table = [...xml.matchAll(/<w:tbl>[^]*?<\/w:tbl>/g)].map(m => m[0]).find(t => t.includes(caption));
      expect(table).toBeDefined();
      const width = Number(table!.match(/<w:gridCol w:w="(\d+)"/)![1]) / 20;
      // Courier's fixed 0.6em glyphs, plus two spaces between caption and entry.
      expect(width).toBeGreaterThan((caption.length + 2) * 0.6 * size);
      expect(table).toContain('REFERENCE0');
    }
  }, 60_000);

  it.each(['naval_letter', 'standard_memorandum'] as const)('%s preserves long references in both exports', async type => {
    const store = buildBaseline(type);
    store.references = Array.from({ length: 20 }, (_, i) => ({ letter: String.fromCharCode(97 + i),
      title: `REF${i}START ${'Training coordination and operational readiness requirements. '.repeat(6)} REF${i}END` }));
    store.enclosures = [];
    const pdf = await compileFixture(store);
    expect(pdf.ok, pdf.logTail).toBe(true);
    const { boxes } = await pdfTextLayout(pdf.pdfBytes!);
    for (const box of boxes.filter(b => !/^\d+$/.test(b.text.trim()))) expect(box.bottom, box.text).toBeGreaterThan(50);
    const docx = await compileDocxFixture(store);
    expect(docx.ok, docx.log).toBe(true);
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(docx.docxBytes!) });
    for (let i = 0; i < 20; i++) {
      expect(boxes.map(b => b.text).join(' ')).toContain(`REF${i}END`);
      expect(value).toContain(`REF${i}END`);
    }
  }, 90_000);
});
