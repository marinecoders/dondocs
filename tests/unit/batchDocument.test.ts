import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { prepareBatchCorrespondence } from '@/lib/batchDocument';
import { persistAttachment } from '@/lib/attachments';
import { finishCorrespondencePdf } from '@/services/pdf/finishCorrespondencePdf';
import { generateAllLatexFiles } from '@/services/latex/generator';
import type { SerializedSession } from '@/stores/documentStore';

const base = (): SerializedSession => ({ documentMode: 'compliant', documentCategory: 'correspondence', docType: 'new_page_endorsement', formType: 'navmc_10274', formData: {}, references: [], enclosures: [], paragraphs: [], distributions: [], copyTos: [], timestamp: 0 });
const pdf = async () => { const doc = await PDFDocument.create(); doc.addPage().drawText('Sample attachment'); return doc.save(); };
describe('complete batch output', () => {
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
