import { describe, expect, it } from 'vitest';
import { correspondenceRenderer } from '../_helpers/correspondenceRender';
import { buildBaseline } from '../_helpers/compileMatrix';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { finishCorrespondencePdf } from '@/services/pdf/finishCorrespondencePdf';

describe('breakable correspondence lists', () => {
  const render = correspondenceRenderer();
  it.each(['naval_letter', 'standard_memorandum'] as const)('%s paginates all references inside the paper', async type => {
    const store = buildBaseline(type);
    store.references = Array.from({ length: 20 }, (_, i) => ({ letter: String.fromCharCode(97 + i),
      title: `REF${i}START ${'Training coordination and operational readiness requirements for all assigned commands. '.repeat(4)} REF${i}END` }));
    store.enclosures = [];
    const { boxes } = await pdfTextLayout(await render(store));
    const text = boxes.map(b => b.text).join(' ');
    for (let i = 0; i < 20; i++) expect(text).toContain(`REF${i}END`);
    expect(Math.max(...boxes.map(b => b.page))).toBeGreaterThan(2);
    for (const box of boxes.filter(b => !/^\d+$/.test(b.text.trim()))) {
      expect(box.bottom, `${box.text} on page ${box.page}`).toBeGreaterThan(50);
      expect(box.right).toBeLessThan(542);
    }
  }, 60_000);

  it('paginates enclosure titles and a reference longer than a page', async () => {
    const store = buildBaseline('naval_letter');
    store.references = [{ letter: 'a', title: `LONGSTART ${'Training coordination requirements. '.repeat(400)} LONGEND` }];
    store.enclosures = Array.from({ length: 20 }, (_, i) => ({ title: `ENC${i}START ${'Training schedule and support responsibilities. '.repeat(5)} ENC${i}END` }));
    const { boxes } = await pdfTextLayout(await render(store));
    const text = boxes.map(b => b.text).join(' ');
    expect(text).toContain('LONGEND');
    for (let i = 0; i < 20; i++) expect(text).toContain(`ENC${i}END`);
    for (const box of boxes.filter(b => !/^\d+$/.test(b.text.trim()))) expect(box.bottom, box.text).toBeGreaterThan(50);
  }, 60_000);

  it('does not letter a single headquarters reference', async () => {
    const store = buildBaseline('standard_memorandum');
    store.references = [{ letter: 'a', title: 'SINGLEREFERENCE Training coordination guidance' }];
    const { boxes } = await pdfTextLayout(await render(store));
    const text = boxes.map(b => b.text).join(' ');
    expect(text).toContain('Reference:');
    expect(text).toContain('SINGLEREFERENCE');
    expect(text).not.toContain('(a)');
  }, 60_000);

  it.each(['standard_memorandum', 'executive_memorandum'] as const)('%s keeps a single wrapped reference clickable in the final bundled PDF', async type => {
    const store = buildBaseline(type);
    const url = 'https://example.mil/my_reference?section=2&name=training%20plan#overview';
    store.references = [{ letter: 'a', title: 'LINKSTART Training coordination and operational readiness requirements for all assigned commands and supporting activities LINKEND', url }];
    store.enclosures = [];
    store.formData.includeHyperlinks = true;
    store.formData.signatureType = 'none';
    const bytes = await render(store);
    const finished = await finishCorrespondencePdf(bytes, type, store.formData, generateAllLatexFiles(store), store.paragraphs);
    const { boxes } = await pdfTextLayout(finished.pdfBytes);
    expect(boxes.map(b => b.text).join(' ')).not.toContain('(a)');
    const doc = await getDocument({ data: finished.pdfBytes.slice(), useSystemFonts: false }).promise;
    try {
      for (const marker of ['LINKSTART', 'LINKEND']) {
        const text = boxes.find(b => b.text.includes(marker))!;
        expect(text).toBeDefined();
        const annotations = await (await doc.getPage(text.page)).getAnnotations();
        const link = annotations.find(a => a.url === url && a.rect[0] <= text.left + 1 && a.rect[2] >= text.right - 1 && a.rect[1] <= text.bottom + 1 && a.rect[3] >= text.top - 1);
        expect(link, `${marker} must have a clickable title rectangle`).toBeDefined();
      }
    } finally { await doc.destroy(); }
  }, 60_000);

  it.each([false, true])('omits reference links when disabled or the URL is unsafe (enabled: %s)', async enabled => {
    const store = buildBaseline('standard_memorandum');
    store.references = [{ letter: 'a', title: 'SAFE REFERENCE TITLE', url: enabled ? 'javascript:alert(1)' : 'https://example.mil/reference' }];
    store.enclosures = [];
    store.formData.includeHyperlinks = enabled;
    store.formData.signatureType = 'none';
    const finished = await finishCorrespondencePdf(await render(store), store.docType, store.formData, generateAllLatexFiles(store));
    const doc = await getDocument({ data: finished.pdfBytes.slice(), useSystemFonts: false }).promise;
    try {
      const annotations = await (await doc.getPage(1)).getAnnotations();
      expect(annotations.filter(a => a.url)).toHaveLength(0);
    } finally { await doc.destroy(); }
  }, 60_000);
});
