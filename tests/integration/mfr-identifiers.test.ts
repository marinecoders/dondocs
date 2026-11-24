import { execFileSync } from 'node:child_process';
import mammoth from 'mammoth';
import { describe, expect, it } from 'vitest';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { TAGGED_MAIN_FILE } from '@/services/latex/renderDocument';
import { renderTaggedCorrespondence } from '@/services/pdf/accessibility/render';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { compileGeneratedFixture } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';

function pdfText(bytes: Uint8Array) {
  return execFileSync('pdftotext', ['-layout', '-', '-'], { input: bytes, encoding: 'utf8' });
}

describe('memorandum for the record identifiers', () => {
  it.each([false, true])('matches standard PDF, tagged PDF and Word with identifiers entered: %s', async enabled => {
    const source = buildBaseline('mfr');
    source.formData = {
      ...source.formData, letterheadMode: 'preprinted', date: '23 Nov 26',
      ssic: enabled ? '5216' : '', officeCode: enabled ? 'N7-TRAINING' : '',
      serial: '', signatureType: 'none',
    };
    source.enclosures = [];
    source.references = [];
    source.copyTos = [];
    source.distributions = [];
    const pdf = await compileGeneratedFixture(generateAllLatexFiles(source).texFiles, {}, source.docType);
    expect(pdf.ok, pdf.logTail).toBe(true);
    const tagged = await renderTaggedCorrespondence(source, {
      referenceDate: new Date('2026-11-23T12:00:00Z'),
      signal: new AbortController().signal,
      read: () => { throw new Error('Unexpected attachment'); },
      loadSeal: () => { throw new Error('Unexpected seal'); },
      async compile(files) {
        const tex = Object.fromEntries(Object.entries(files).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
        tex['main.tex'] = tex[TAGGED_MAIN_FILE];
        const result = await compileGeneratedFixture(tex, {}, source.docType);
        expect(result.ok, result.logTail).toBe(true);
        return result.pdfBytes!;
      },
    });
    const docx = await compileDocxFixture(source);
    expect(docx.ok, docx.log).toBe(true);
    const word = await mammoth.extractRawText({ buffer: Buffer.from(docx.docxBytes!) });
    expect(pdfText(tagged)).toBe(pdfText(pdf.pdfBytes!));
    for (const text of [word.value, pdfText(tagged)]) {
      expect(text).toContain('MEMORANDUM FOR THE RECORD');
      expect(text).toContain('23 Nov 26');
      expect(text.includes('5216')).toBe(enabled);
      expect(text.includes('N7-TRAINING')).toBe(enabled);
    }
  }, 60_000);
});
