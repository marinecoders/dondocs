import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { prepareBatchCorrespondence } from '@/lib/batchDocument';
import { persistAttachment } from '@/lib/attachments';
import { finishCorrespondencePdf } from '@/services/pdf/finishCorrespondencePdf';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { endorsementTexts } from '@/lib/appendedEndorsement';
import { detectPlaceholders } from '@/lib/placeholders';
import type { SerializedSession } from '@/stores/documentStore';

const base = (): SerializedSession => ({ documentMode: 'compliant', documentCategory: 'correspondence', docType: 'new_page_endorsement', formType: 'navmc_10274', formData: {}, references: [], enclosures: [], paragraphs: [], distributions: [], copyTos: [], timestamp: 0 });
const pdf = async () => { const doc = await PDFDocument.create(); doc.addPage().drawText('Sample attachment'); return doc.save(); };
describe('complete batch output', () => {
  it.each(['compliant', 'custom'] as const)('retains %s numbering and replaces additional endorsement variables without mutating the source', async (mode) => {
    const source = base();
    source.docType = 'naval_letter';
    source.documentMode = mode;
    source.formData = {
      pageNumbering: 'none', appendEndorsement: true,
      from: 'Originator', to: 'Recipient', endorsementBody: 'Acknowledged by {{NAME}}.',
      additionalEndorsements: [{ id: '{{NAME}}', endorsementBody: 'Approved for {{NAME}}.',
        endorsementSigLast: '{{REVIEWER}}', endorsementTo: '{{COMMAND}}', endorsementDate: '{{DATE}}' }],
    };
    expect([...new Set(endorsementTexts(source.formData).flatMap(detectPlaceholders))].sort())
      .toEqual(['COMMAND', 'DATE', 'NAME', 'REVIEWER']);
    const document = await prepareBatchCorrespondence(source, {
      NAME: 'SAMPLE', REVIEWER: 'REVIEWER', COMMAND: 'Test Command', DATE: '3 Nov 26',
    });
    const files = generateAllLatexFiles(document).texFiles;
    expect(files['document.tex']).toContain(`\\setPageNumberStyle{${mode === 'compliant' ? 'simple' : 'none'}}`);
    expect(files['signatory.tex']).toContain('Approved for SAMPLE.');
    expect(document.formData.additionalEndorsements?.[0]).toMatchObject({
      id: '{{NAME}}', endorsementBody: 'Approved for SAMPLE.', endorsementDate: '3 Nov 26',
    });
    expect(source.formData.additionalEndorsements?.[0].endorsementBody).toBe('Approved for {{NAME}}.');
  });
  it('resolves the frozen source files and assembles basic letter, document and enclosure', async () => {
    const bytes = await pdf();
    const ref = await persistAttachment({ name: 'attachment.pdf', size: bytes.byteLength, type: 'application/pdf' }, bytes.buffer as ArrayBuffer);
    const source = base();
    source.formData = { basicLetterFileRef: ref, sigLast: '{{NAME}}', endorsementOrdinal: 'FIRST' };
    source.enclosures = [{ title: 'Report for {{NAME}}', fileRef: ref, pageStyle: 'fullpage' }];
    source.paragraphs = [{ text: 'Body for {{NAME}}', header: 'Report for {{NAME}}', level: 0 }];
    const document = await prepareBatchCorrespondence(source, { NAME: 'SAMPLE' });
    expect(document.formData.sigLast).toBe('SAMPLE');
    expect(document.paragraphs[0].header).toBe('Report for SAMPLE');
    expect(source.formData.sigLast).toBe('{{NAME}}');
    const finished = await finishCorrespondencePdf(await pdf(), source.docType, document.formData, generateAllLatexFiles(document));
    expect(finished.errors).toEqual([]);
    expect((await PDFDocument.load(finished.pdfBytes)).getPageCount()).toBe(3);
  });
  it('fails a row explicitly when its source attachment is no longer available', async () => {
    const source = base();
    source.enclosures = [{ title: 'Report', fileRef: { id: 'missing-file', name: 'report.pdf', size: 99, type: 'application/pdf' } }];
    await expect(prepareBatchCorrespondence(source, {})).rejects.toThrow('report.pdf');
  });
});
