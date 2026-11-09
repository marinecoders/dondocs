import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { headquartersAddressIndentIn } from '@/services/latex/subparagraphIndent';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { compileFixture } from '../_helpers/compileLatex';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { headquartersFixture } from '../_helpers/headquartersFixture';

describe('headquarters Word paragraph layout', () => {
  it.each(['standard_memorandum', 'executive_memorandum'] as const)('%s exports measured hanging and block indents', async type => {
    const store = headquartersFixture(type);
    const pdf = await compileFixture(store);
    expect(pdf.ok, pdf.logTail).toBe(true);
    const { boxes } = await pdfTextLayout(pdf.pdfBytes!);
    const expected = 72 + headquartersAddressIndentIn(store.formData.memorandumFor!, 'times', 12) * 72 * 72 / 72.27;
    for (const marker of ['RUNOVERSTART', 'ATTNSTART', 'ATTNTAIL']) {
      expect(Math.abs(boxes.find(b => b.text.includes(marker))!.left - expected)).toBeLessThan(1);
    }
    const docx = await compileDocxFixture(store);
    expect(docx.ok, docx.log).toBe(true);
    const blob = await postProcessDocx(new Blob([Uint8Array.from(docx.docxBytes!)]), { docType: type, ...store.formData });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    const indent = Math.round(headquartersAddressIndentIn(store.formData.memorandumFor!, 'times', 12) * 1440);
    expect(xml).toContain(`<w:ind w:left="${indent}" w:hanging="${indent}"/>`);
    expect(xml).toContain(`<w:ind w:left="${indent}"/>`);
    expect(xml).toMatch(/RUNOVERSTART/);
    expect(xml).toContain('a.');
    expect(xml).toContain('(1)');
    expect(xml).toContain('(2)');
    expect(xml).not.toContain('FROM:');
  }, 90_000);
});
