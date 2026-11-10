import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { buildBaseline } from '../_helpers/compileMatrix';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { compileFixture } from '../_helpers/compileLatex';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';

describe('correspondence closing exports', () => {
  it.each(['naval_letter', 'business_letter', 'standard_memorandum'] as const)('%s keeps the body tail through the complete Word signature', async type => {
    const store = buildBaseline(type);
    store.references = [];store.enclosures = [];store.copyTos = [{ text: 'AFTERCLOSING' }];
    store.paragraphs = Array.from({ length: 10 }, (_, i) => ({ level: 0,
      text: `BODY${i}START Training staff coordinate the scheduled exercise and consolidate comments before the published suspense. BODY${i}END` }));
    const word = await compileDocxFixture(store);
    expect(word.ok, word.log).toBe(true);
    const blob = await postProcessDocx(new Blob([Uint8Array.from(word.docxBytes!)]), { docType: type, ...store.formData });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)!;
    const start = paragraphs.findIndex(p => p.includes('DonDocsClosingTail'));
    const end = paragraphs.findIndex(p => p.includes('DonDocsSignatureEnd'));
    expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
    expect(paragraphs[start]).toContain('BODY8START');
    for (const p of paragraphs.slice(start, end)) expect(p).toContain('<w:keepNext/>');
    expect(paragraphs[end]).not.toContain('<w:keepNext/>');
    expect(paragraphs.find(p => p.includes('AFTERCLOSING'))).not.toContain('<w:keepNext/>');
    const pdf = await compileFixture(store);
    expect(pdf.ok, pdf.logTail).toBe(true);
    const { boxes } = await pdfTextLayout(pdf.pdfBytes!);
    const signer = boxes.find(b => /J\. A\. DOE|JOHN A DOE|John A DOE/.test(b.text))!;
    expect(signer).toBeDefined();
    const body = boxes.filter(b => b.page === signer.page && b.top > signer.top && /BODY|Training staff|scheduled|consolidate|published suspense/.test(b.text));
    expect(new Set(body.map(b => Math.round(b.top))).size).toBeGreaterThanOrEqual(2);
  }, 90_000);
});
