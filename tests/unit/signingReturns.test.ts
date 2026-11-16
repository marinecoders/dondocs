import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { associateSigningReturn, createSigningRecord, createSigningHandoff, exportSigningRecord, importSigningRecord, listSigningRecords,
  prepareSigningReturn, removeSigningRecord, signingDigest, updateSigningFields, validateSigningRecord, type SigningRecord } from '@/lib/signingWorkspace';
import { base64ToUint8Array } from '@/lib/encoding';
import { compareSigningPdfs } from '@/lib/signingPdfComparison';

async function pdfBytes(text: string) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([400, 600]).drawText(text, { x: 20, y: 500, font, size: 12 });return pdf.save();
}
async function recordFixture(): Promise<SigningRecord> {
  let record = await createSigningRecord(await pdfBytes('ORIGINAL TRAINING DOCUMENT'), 'Same filename.pdf');
  record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'EXAMPLE SIGNER', page: 0, x: 0.5, y: 0.7, width: 0.3, height: 0.06 }]);
  return createSigningHandoff(record);
}
async function structurallySignedReturn(record: SigningRecord) {
  const pdf = await PDFDocument.load(base64ToUint8Array(record.handoffs![0].pdf.data));
  // Deliberately noncryptographic fixture: a /V value alone must never imply validity.
  pdf.getForm().getFields()[0].acroField.dict.set(PDFName.of('V'), pdf.context.obj({ Type: 'Sig', ByteRange: [0, 0, 0, 0] }));
  return pdf.save();
}
describe('returned signing document association', () => {
  it('compares retained content and preserves exact returned bytes without authenticating signatures', async () => {
    const record = await recordFixture(), bytes = await structurallySignedReturn(record), handoff = record.handoffs![0];
    const candidate = await prepareSigningReturn(record, handoff.id, bytes, 'Returned.pdf');
    expect(candidate.evidence.assessment).toBe('checks-agree');expect(candidate.evidence.checks.signatureValuesPresent).toBe(1);
    const saved = await associateSigningReturn(record, candidate, { reviewed: true, acceptedMismatch: false });
    expect(saved.source).toEqual(record.source);expect(saved.handoffs).toEqual(record.handoffs);
    expect(saved.returns![0].status).toBe('associated-unverified');
    expect(base64ToUint8Array(saved.returns![0].pdf.data)).toEqual(bytes);
    expect(saved.returns![0].pdf.sha256).toBe(await signingDigest(bytes));
    const portable = JSON.parse(new TextDecoder().decode(await exportSigningRecord(saved)));
    await removeSigningRecord(saved);expect(await importSigningRecord(portable)).toEqual(saved);
    const again = await prepareSigningReturn(saved, handoff.id, bytes, 'Different filename.pdf');
    await expect(associateSigningReturn(saved, again, { reviewed: true, acceptedMismatch: false })).rejects.toThrow('already associated');
  });
  it('does not trust matching filenames or forged handoff metadata when document content differs', async () => {
    const record = await recordFixture(), handoff = record.handoffs![0];
    const wrong = await PDFDocument.load(await pdfBytes('DIFFERENT TRAINING DOCUMENT'));
    wrong.setKeywords([`DonDocs handoff ${handoff.id}`]);
    const candidate = await prepareSigningReturn(record, handoff.id, await wrong.save(), record.source.filename);
    expect(candidate.evidence.assessment).toBe('different');expect(candidate.evidence.checks.matchingHandoffMarker).toBe(true);
    await expect(associateSigningReturn(record, candidate, { reviewed: true, acceptedMismatch: false })).rejects.toThrow('Explicit acknowledgement');
    const saved = await associateSigningReturn(record, candidate, { reviewed: true, acceptedMismatch: true });
    expect(saved.returns![0].status).toBe('associated-unverified');expect(saved.returns![0].decision.acceptedMismatch).toBe(true);
    const forged = structuredClone(saved);forged.returns![0].evidence.checks.sameContentStreams = true;
    await expect(validateSigningRecord(forged)).rejects.toThrow('comparison does not match');
  });
  it('requires an explicit decision for unchanged or inconclusive returns', async () => {
    const record = await recordFixture(), handoff = record.handoffs![0];
    const unchanged = await prepareSigningReturn(record, handoff.id, base64ToUint8Array(handoff.pdf.data), 'Unchanged.pdf');
    expect(unchanged.evidence.assessment).toBe('unchanged');
    await expect(associateSigningReturn(record, unchanged, { reviewed: false, acceptedMismatch: true })).rejects.toThrow('Compare the handoff');
    await expect(associateSigningReturn(record, unchanged, { reviewed: true, acceptedMismatch: false })).rejects.toThrow('Explicit acknowledgement');
    const rewritten = await PDFDocument.load(base64ToUint8Array(handoff.pdf.data));rewritten.setKeywords([]);
    const ambiguous = await prepareSigningReturn(record, handoff.id, await rewritten.save(), 'No marker.pdf');
    expect(ambiguous.evidence.assessment).toBe('inconclusive');
  });
  it('rejects forged candidates, stale drafts, cancellation and malformed PDFs', async () => {
    const record = await recordFixture(), handoff = record.handoffs![0], bytes = await structurallySignedReturn(record);
    const candidate = await prepareSigningReturn(record, handoff.id, bytes, 'Returned.pdf');
    await expect(associateSigningReturn(record, { ...candidate }, { reviewed: true, acceptedMismatch: false })).rejects.toThrow('changed');
    await expect(associateSigningReturn(record, candidate, { reviewed: true, acceptedMismatch: false }, () => false)).rejects.toThrow('not saved');
    const newer = await updateSigningFields(record, [{ ...record.fields[0], signer: 'NEW SIGNER' }]);
    await expect(associateSigningReturn(newer, candidate, { reviewed: true, acceptedMismatch: false })).rejects.toThrow('changed');
    await expect(associateSigningReturn(record, candidate, { reviewed: true, acceptedMismatch: false })).rejects.toThrow('not saved');
    await expect(prepareSigningReturn(newer, handoff.id, new Uint8Array([1, 2, 3]), 'Bad.pdf')).rejects.toThrow();
    expect((await listSigningRecords()).find(value => value.id === newer.id)).toEqual(newer);
  });
  it('bounds decompression before attempting content comparisons', async () => {
    const original = await pdfBytes('BOUNDED CONTENT COMPARISON'), pdf = await PDFDocument.create(), page = pdf.addPage([400, 600]);
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(' '.repeat(9 * 1024 * 1024))));
    const result = await compareSigningPdfs(original, await pdf.save(), crypto.randomUUID());
    expect(result.assessment).toBe('inconclusive');expect(result.checks.contentComparisonAvailable).toBe(false);
  });
});
