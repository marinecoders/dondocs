import { describe, expect, it } from 'vitest';
import mammoth from 'mammoth';
import { compileFixture } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';

describe('native correspondence list pagination', () => {
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
