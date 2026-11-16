import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createSigningRecord, listSigningRecords, updateSigningFields, validateSigningRecord } from '@/lib/signingWorkspace';
import { idbReadSigningRecords } from '@/lib/documentsDb';

async function fixture() { const pdf = await PDFDocument.create();pdf.addPage([400, 600]);return pdf.save(); }
describe('retained signing drafts', () => {
  it('survives reload independently of the source and rejects stale saves', async () => {
    const source = await fixture();const record = await createSigningRecord(source, 'Letter.pdf');source.fill(0);
    const saved = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'FIRST SIGNER', page: 0, x: 0.2, y: 0.6, width: 0.3, height: 0.06 }]);
    const reopened = (await listSigningRecords()).find(value => value.id === record.id)!;
    expect(reopened).toEqual(saved);expect(reopened.source.data).toBe(record.source.data);
    await expect(updateSigningFields(record, [])).rejects.toThrow('another tab');
    const corrupt = structuredClone(saved);corrupt.source.sha256 = '0'.repeat(64);
    await expect(validateSigningRecord(corrupt)).rejects.toThrow('digest');
    await expect(validateSigningRecord({ ...saved, fields: [{ ...saved.fields[0], page: 99 }] })).rejects.toThrow('Invalid signature page');
  });
  it('suppresses writes when a capture or update loses its initiating workspace', async () => {
    const before = await idbReadSigningRecords();
    await expect(createSigningRecord(await fixture(), 'Cancelled.pdf', () => false)).rejects.toThrow('could not be saved');
    expect(await idbReadSigningRecords()).toEqual(before);
    const record = await createSigningRecord(await fixture(), 'Owned.pdf');
    await expect(updateSigningFields(record, [], () => false)).rejects.toThrow('cancelled');
    expect((await listSigningRecords()).find(value => value.id === record.id)).toEqual(record);
  });
});
