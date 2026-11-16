import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createSigningRecord, createSigningHandoff, downloadSigningHandoff, exportSigningRecord, importSigningRecord, listSigningRecords, loadSigningInventory, removeSigningRecord, removeUnreadableSigningRecord, signingDigest, updateSigningFields, validateSigningRecord } from '@/lib/signingWorkspace';
import { idbCompareSigningRecord, idbReadSigningRecords } from '@/lib/documentsDb';
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
  it('checks ownership at the commit boundary and frees record capacity after explicit removal', async () => {
    let checks = 0;
    const before = await listSigningRecords();
    await expect(createSigningRecord(await fixture(), 'Cancelled at commit.pdf', () => ++checks === 1)).rejects.toThrow('could not be saved');
    expect(await listSigningRecords()).toEqual(before);
    const created = [];
    for (let index = before.length; index < 20; index++) created.push(await createSigningRecord(await fixture(), `Capacity ${index}.pdf`));
    await expect(createSigningRecord(await fixture(), 'Overflow.pdf')).rejects.toThrow('could not be saved');
    const removed = created.pop()!;await removeSigningRecord(removed);
    const replacement = await createSigningRecord(await fixture(), 'Replacement.pdf');
    expect((await listSigningRecords()).some(value => value.id === replacement.id)).toBe(true);
    for (const record of [...created, replacement]) await removeSigningRecord(record);
    expect(await listSigningRecords()).toEqual(before);
  });
  it('quarantines malformed saved records without hiding healthy work and guards their explicit removal', async () => {
    const healthy = await createSigningRecord(await fixture(), 'Healthy.pdf');
    const damaged = structuredClone(healthy);damaged.id = crypto.randomUUID();damaged.source.sha256 = '0'.repeat(64);
    expect(await idbCompareSigningRecord(null, damaged)).toBe(true);
    const inventory = await loadSigningInventory();expect(inventory.records.some(value => value.id === healthy.id)).toBe(true);
    const problem = inventory.unreadable.find(value => value.id === damaged.id)!;expect(problem.data).toEqual(damaged);
    await expect(removeUnreadableSigningRecord(problem, () => false)).rejects.toThrow('cancelled');
    await removeUnreadableSigningRecord(problem);
    expect((await loadSigningInventory()).unreadable.some(value => value.id === damaged.id)).toBe(false);
    await expect(removeUnreadableSigningRecord({ id: healthy.id, data: healthy, message: 'Invalid' })).rejects.toThrow('readable');
    expect((await listSigningRecords()).some(value => value.id === healthy.id)).toBe(true);
  });
});

async function portableHandoffFixture() {
  let record = await createSigningRecord(await fixture(), 'Import invariants.pdf');
  record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'SIGNER', page: 0, x: 0.2, y: 0.6, width: 0.3, height: 0.06 }]);
  return createSigningHandoff(record);
}
it('rejects duplicate handoff field identities in portable records', async () => {
  const duplicate = await portableHandoffFixture();
  duplicate.handoffs![0].fields.push(structuredClone(duplicate.handoffs![0].fields[0]));
  await expect(validateSigningRecord(duplicate)).rejects.toThrow('duplicate identity');
});
it('rejects handoff page geometry inconsistent with its retained source', async () => {
  const geometry = await portableHandoffFixture();
  const changed = await PDFDocument.create(); changed.addPage([500, 700]);
  const { captureSigningPdf } = await import('@/lib/signingWorkspace');
  geometry.handoffs![0].pdf = await captureSigningPdf(await changed.save(), 'Different page.pdf');
  await expect(validateSigningRecord(geometry)).rejects.toThrow('Invalid signature page');
});
