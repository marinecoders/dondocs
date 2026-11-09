import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { compileFixture, type TestStore } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

function fixture(docType: string, documentMode: 'compliant' | 'custom'): TestStore {
  return { docType, documentMode, formData: { fontFamily: 'times', fontSize: '12pt', subject: 'VISIBLE SUBJECT', from: 'HIDDEN FROM VALUE', to: 'HIDDEN TO VALUE\nRecipient second line', date: '7 Nov 2026', sigFirst: 'Jane', sigLast: 'Signer', signatureType: 'none' },
    paragraphs: [{ text: 'Numbered body.', level: 0 }], references: [{ letter: 'a', title: 'CUSTOM REFERENCE' }], enclosures: [{ title: 'CUSTOM ENCLOSURE' }], copyTos: [], distributions: [] };
}
async function outputs(store: TestStore) {
  const pdf = await compileFixture(store);expect(pdf.ok, pdf.logTail).toBe(true);
  const file = `${pdf.workDir}/output.pdf`;await writeFile(file, pdf.pdfBytes!);
  const text = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });expect(text.status).toBe(0);
  const docx = await compileDocxFixture(store);expect(docx.ok, docx.log).toBe(true);
  const zip = await JSZip.loadAsync(docx.docxBytes!);
  const xml = await zip.file('word/document.xml')!.async('string');
  const proofs = join(tmpdir(), 'dondocs-output-proofs');
  await mkdir(proofs, { recursive: true });
  await writeFile(join(proofs, `${store.docType}-${store.documentMode}.pdf`), pdf.pdfBytes!);
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
  const word = Array.from(document.getElementsByTagName('w:p'), paragraph =>
    Array.from(paragraph.getElementsByTagName('w:t'), node => node.textContent ?? '').join('')).join('\n');
  return { pdf: text.stdout, word };
}
describe('output control contracts', () => {
  describeToolchainRequirement('output control contracts');
  it.skipIf(!hasPdfToolchain)('does not print hidden MFR addresses in PDF or Word', async () => {
    const store = fixture('mfr', 'compliant');store.references = [];store.enclosures = [];
    const output = await outputs(store);
    for (const text of Object.values(output)) { expect(text).toContain('VISIBLE SUBJECT');expect(text).not.toMatch(/HIDDEN FROM VALUE|HIDDEN TO VALUE|Recipient second line|From:|To:/); }
  }, 180_000);
  it.skipIf(!hasPdfToolchain)('prints custom business references, enclosures and paragraph labels in both formats', async () => {
    const output = await outputs(fixture('business_letter', 'custom'));
    for (const text of Object.values(output)) { expect(text).toContain('HIDDEN TO VALUE');expect(text).toContain('Recipient second line');expect(text).toContain('CUSTOM REFERENCE');expect(text).toContain('CUSTOM ENCLOSURE');expect(text).toMatch(/1\.\s*Numbered body/); }
  }, 180_000);
  it.skipIf(!hasPdfToolchain)('omits disabled formal business lists in compliant mode in both formats', async () => {
    const output = await outputs(fixture('business_letter', 'compliant'));
    for (const text of Object.values(output)) { expect(text).toContain('HIDDEN TO VALUE');expect(text).toContain('Recipient second line');expect(text).not.toContain('CUSTOM REFERENCE');expect(text).not.toContain('CUSTOM ENCLOSURE');expect(text).not.toMatch(/1\.\s*Numbered body/); }
  }, 180_000);
  for (const docType of ['standard_memorandum', 'action_memorandum', 'information_memorandum']) {
    for (const mode of ['compliant', 'custom'] as const) {
      it.skipIf(!hasPdfToolchain)(`${docType} preserves the ${mode} formal-list controls in PDF and Word`, async () => {
        const output = await outputs(fixture(docType, mode));
        for (const text of Object.values(output)) {
          expect(text).toContain('Numbered body');
          if (mode === 'custom') {
            expect(text).toContain('CUSTOM REFERENCE');
            expect(text).toContain('CUSTOM ENCLOSURE');
            expect(text).toMatch(/1\.\s*Numbered body/);
          } else {
            expect(text).not.toContain('CUSTOM REFERENCE');
            expect(text).not.toContain('CUSTOM ENCLOSURE');
            expect(text).not.toMatch(/1\.\s*Numbered body/);
          }
        }
      }, 180_000);
    }
  }

});
