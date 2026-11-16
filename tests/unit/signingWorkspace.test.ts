import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createSigningRecord, createSigningHandoff, downloadSigningHandoff, exportSigningRecord, importSigningRecord, listSigningRecords, removeSigningRecord, signingDigest, updateSigningFields, validateSigningRecord } from '@/lib/signingWorkspace';
import { idbReadSigningRecords } from '@/lib/documentsDb';
import { base64ToUint8Array } from '@/lib/encoding';
import JSZip from 'jszip';

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
  it('freezes exact handoff bytes while later placements change and transfers records between browsers', async () => {
    const sourceRevision = { documentId: 'saved-draft', epoch: 1, editSequence: 12, capturedAt: 300 };
    let record = await createSigningRecord(await fixture(), 'Exact.pdf', () => true, sourceRevision);
    record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'ORIGINAL SIGNER', page: 0, x: 0.2, y: 0.6, width: 0.3, height: 0.06 }]);
    record = await createSigningHandoff(record);
    const original = structuredClone(record), handoff = record.handoffs![0];
    record = await updateSigningFields(record, [{ ...record.fields[0], signer: 'NEW SIGNER', x: 0.5 }]);
    expect(record.handoffs![0]).toEqual(handoff);expect(record.sourceRevision).toEqual(sourceRevision);
    const zip = await JSZip.loadAsync(await downloadSigningHandoff(record, handoff.id));
    const bytes = await zip.file('ready-to-sign.pdf')!.async('uint8array');
    expect(await signingDigest(bytes)).toBe(handoff.pdf.sha256);
    expect(bytes).toEqual(base64ToUint8Array(handoff.pdf.data));
    expect(JSON.parse(await zip.file('manifest.json')!.async('string')).fields[0].signer).toBe('ORIGINAL SIGNER');
    expect(await zip.file('README.txt')!.async('string')).toContain('does not authenticate');
    const portable = JSON.parse(new TextDecoder().decode(await exportSigningRecord(record)));
    await expect(importSigningRecord(original)).rejects.toThrow('different signing record');
    await removeSigningRecord(record);
    expect(await importSigningRecord(portable)).toEqual(record);
    expect(await importSigningRecord(portable)).toEqual(record);
  });
  it('rejects modified handoff bytes and cancelled handoff writes', async () => {
    let record = await createSigningRecord(await fixture(), 'Guard.pdf');
    record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'SIGNER', page: 0, x: 0.2, y: 0.6, width: 0.3, height: 0.06 }]);
    await expect(createSigningHandoff(record, () => false)).rejects.toThrow('not saved');
    expect((await listSigningRecords()).find(value => value.id === record.id)).toEqual(record);
    record = await createSigningHandoff(record);const corrupt = structuredClone(record);
    corrupt.handoffs![0].pdf.sha256 = '0'.repeat(64);
    await expect(importSigningRecord(corrupt)).rejects.toThrow('digest');
    await expect(removeSigningRecord(record, () => false)).rejects.toThrow('cancelled');
    await expect(removeSigningRecord({ ...record, updatedAt: record.updatedAt + 1 })).rejects.toThrow('changed');
  });
});
