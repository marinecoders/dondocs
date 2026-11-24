import { execFileSync } from 'node:child_process';
import mammoth from 'mammoth';
import { describe, expect, it } from 'vitest';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { compileFixture } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';

describe('plain-paper memorandum identification', () => {
  it.each([false, true])('prints the same sender identifiers in PDF and Word when provided: %s', async identifiers => {
    const source = buildBaseline('plain_paper_memorandum');
    Object.assign(source.formData, {
      ssic: identifiers ? '5216' : '', officeCode: identifiers ? 'N3-TRAINING' : '', serial: '', date: '23 Nov 26',
      inReplyTo: true,
    });
    source.references = [];
    source.enclosures = [];
    const pdf = await compileFixture(source);
    expect(pdf.ok, pdf.logTail).toBe(true);
    const text = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf.pdfBytes!, encoding: 'utf8' });
    const docx = await compileDocxFixture(source);
    expect(docx.ok, docx.log).toBe(true);
    const word = await mammoth.extractRawText({ buffer: Buffer.from(docx.docxBytes!) });
    for (const extracted of [text, word.value]) {
      expect(extracted).toContain('23 Nov 26');
      expect(extracted.includes('5216')).toBe(identifiers);
      expect(extracted.includes('N3-TRAINING')).toBe(identifiers);
      expect(extracted).not.toContain('IN REPLY REFER TO');
      if (identifiers) expect(extracted).toMatch(/5216\s+N3-TRAINING\s+23 Nov 26/);
    }
  }, 60_000);
});
