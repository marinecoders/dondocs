import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, renameActionPackage, actionPackageSchema } from '@/lib/actionPackages';
import { captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { preparePackageSigningSource, openPackageSigningSource, preparePackageSigningHandoff, capturePackageSigningHandoff,
  preparePackageSigningReturn, applyPackageSigningReturn, copyPreparedPackageSigningReturn, readPackageSigningRecord,
  openCapturedPackageSigningRecord, getPackageSigningPdf } from '@/lib/packageSigning';
import { updateSigningFields, createSigningHandoff, prepareSigningReturn, associateSigningReturn, listSigningRecords,
  removeSigningRecord, importSigningRecord } from '@/lib/signingWorkspace';
import { updatePackageInformation } from '@/lib/packageInformation';
import { buildPortableActionPackage, importPortableActionPackage } from '@/lib/actionPackageTransfer';
import { idbGetAllAttachments } from '@/lib/documentsDb';
import { base64ToUint8Array } from '@/lib/encoding';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { extractPdfText } from '@/lib/pdfText';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
const otherPolicy = resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } });
async function clearDb() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction([...db.objectStoreNames], 'readwrite'); for (const store of db.objectStoreNames) tx.objectStore(store).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
}
beforeEach(async () => {
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  vi.mocked(extractPdfText).mockResolvedValue(''); await createActionPackage('Initialize'); await clearDb(); useUIStore.setState({ storageHealth: 'ok' });
});
afterEach(() => vi.restoreAllMocks());
async function fixture(different = false) {
  const pdf = await PDFDocument.create(); pdf.addPage([400, 600]);
  const original = await captureOriginalPackageMember({ name: 'Synthetic unsigned source.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'basic-letter', false);
  const initial = await reviseActionPackage(await createActionPackage('Synthetic return action'), [original]);
  const target = { kind: 'member' as const, id: original.id, revisionId: original.revisionId };
  let signing = await openPackageSigningSource(await preparePackageSigningSource(initial, initial.currentRevisionId, target, policy), policy, true);
  signing = await createSigningHandoff(await updateSigningFields(signing, [{ id: crypto.randomUUID(), signer: 'Alex Example', page: 0, x: 0.2, y: 0.7, width: 0.4, height: 0.08 }]));
  const record = await capturePackageSigningHandoff(await preparePackageSigningHandoff(initial, initial.currentRevisionId, target, signing, signing.handoffs![0].id, policy), policy, true);
  let returnedBytes = base64ToUint8Array(signing.handoffs![0].pdf.data);
  if (different) { const changed = await PDFDocument.create(); changed.addPage([420, 620]); returnedBytes = new Uint8Array(await changed.save()); }
  const candidate = await prepareSigningReturn(signing, signing.handoffs![0].id, returnedBytes, 'Synthetic associated return.pdf');
  signing = await associateSigningReturn(signing, candidate, { reviewed: true, acceptedMismatch: true });
  return { record, signing, entry: getPackageRevision(record).signing!.handoffs[0], returned: signing.returns![0], returnedBytes };
}
it('adds a compared return as a new preserved original while retaining all newer package work', async () => {
  const value = await fixture(), newer = await updatePackageInformation(value.record, { version: 1, participants: [], facts: [
    { id: 'newer-subject', label: 'Current subject', kind: 'text', value: 'Preserve newer current information', source: { kind: 'entered' } },
  ] });
  const prepared = await preparePackageSigningReturn(newer, value.entry.id, value.signing, value.returned.id, policy);
  expect(prepared.preservesCurrentMembers).toBe(true); expect(prepared.assessment).toBe('unchanged');
  const saved = await applyPackageSigningReturn(prepared, policy, { reviewed: true, acceptedMismatch: true }), revision = getPackageRevision(saved);
  expect(revision.parentId).toBe(newer.currentRevisionId); expect(revision.information).toEqual(getPackageRevision(newer).information);
  expect(revision.members.slice(0, -1)).toEqual(getPackageRevision(newer).members); expect(saved.revisions.slice(0, -1)).toEqual(newer.revisions);
  const member = revision.members.at(-1)!; expect(member.kind).toBe('original'); expect(member.label).toContain('unverified');
  if (member.kind !== 'original') throw new Error('Expected retained original');
  expect(new Uint8Array(await readPackageAsset(member.original))).toEqual(value.returnedBytes);
  const entry = revision.signing!.handoffs[0], receipt = entry.returns![0];
  expect(receipt).toMatchObject({ signingReturnId: value.returned.id, memberId: member.id, appliedRevisionId: revision.id, assessment: 'unchanged', acceptedMismatch: true });
  const restored = await readPackageSigningRecord(entry, undefined, receipt.id);
  expect(restored.returns).toEqual(value.signing.returns); expect(restored.returns![0].status).toBe('associated-unverified');
  expect((await readPackageSigningRecord(entry)).returns).toBeUndefined();
});
it('requires fresh package acknowledgement of unchanged, differing or inconclusive matching evidence', async () => {
  const value = await fixture(true), prepared = await preparePackageSigningReturn(value.record, value.entry.id, value.signing, value.returned.id, policy);
  expect(prepared.assessment).toBe('different');
  await expect(applyPackageSigningReturn(prepared, policy, { reviewed: false, acceptedMismatch: true })).rejects.toThrow('Review');
  await expect(applyPackageSigningReturn(prepared, policy, { reviewed: true, acceptedMismatch: false })).rejects.toThrow('Explicitly acknowledge');
  expect((await listActionPackages())[0]).toEqual(value.record);
  const saved = await applyPackageSigningReturn(prepared, policy, { reviewed: true, acceptedMismatch: true });
  expect(getPackageRevision(saved).signing!.handoffs[0].returns![0].assessment).toBe('different');
});
it('owns returned bytes and rejects forged or reused preparation handles', async () => {
  const value = await fixture(), prepared = await preparePackageSigningReturn(value.record, value.entry.id, value.signing, value.returned.id, policy);
  const bytes = copyPreparedPackageSigningReturn(prepared); bytes.fill(0); value.signing.returns![0].pdf.data = '';
  expect(copyPreparedPackageSigningReturn(prepared)).toEqual(value.returnedBytes);
  await expect(applyPackageSigningReturn({ ...prepared }, policy, { reviewed: true, acceptedMismatch: true })).rejects.toThrow('Review');
  await applyPackageSigningReturn(prepared, policy, { reviewed: true, acceptedMismatch: true });
  await expect(applyPackageSigningReturn(prepared, policy, { reviewed: true, acceptedMismatch: true })).rejects.toThrow('Review');
});
it('rejects stale, aborted and policy-invalidated adoption without adding files or changing the saved package', async () => {
  const value = await fixture(), prepared = await preparePackageSigningReturn(value.record, value.entry.id, value.signing, value.returned.id, policy), beforeFiles = await idbGetAllAttachments();
  const controller = new AbortController(); controller.abort();
  await expect(applyPackageSigningReturn(prepared, policy, { reviewed: true, acceptedMismatch: true }, controller.signal)).rejects.toThrow();
  let calls = 0; await expect(applyPackageSigningReturn(prepared, policy, { reviewed: true, acceptedMismatch: true }, undefined, () => ++calls === 1)).rejects.toThrow();
  expect(await idbGetAllAttachments()).toEqual(beforeFiles); expect((await listActionPackages())[0]).toEqual(value.record);
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(otherPolicy);
  await expect(applyPackageSigningReturn(prepared, policy, { reviewed: true, acceptedMismatch: true })).rejects.toThrow('Deployment settings changed');
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(policy);
  const newer = await renameActionPackage(value.record, 'Preserve renamed action');
  await expect(applyPackageSigningReturn(prepared, policy, { reviewed: true, acceptedMismatch: true })).rejects.toThrow('package changed');
  expect((await listActionPackages())[0]).toEqual(newer); expect(await idbGetAllAttachments()).toEqual(beforeFiles);
});
it('requires a saved record and an existing associated return from this exact captured handoff', async () => {
  const value = await fixture();
  await expect(preparePackageSigningReturn(value.record, value.entry.id, { ...value.signing, title: 'Unsaved record changes' }, value.returned.id, policy)).rejects.toThrow('saved associated return');
  await expect(preparePackageSigningReturn(value.record, value.entry.id, value.signing, crypto.randomUUID(), policy)).rejects.toThrow('already associated');
  await expect(preparePackageSigningReturn(value.record, 'unavailable-handoff', value.signing, value.returned.id, policy)).rejects.toThrow('captured by this package');
  const other = await fixture();
  await expect(preparePackageSigningReturn(value.record, value.entry.id, other.signing, other.returned.id, policy)).rejects.toThrow('does not belong');
});
it('prevents duplicate adoption and rejects changed receipt or original identities', async () => {
  const value = await fixture(), prepared = await preparePackageSigningReturn(value.record, value.entry.id, value.signing, value.returned.id, policy);
  const saved = await applyPackageSigningReturn(prepared, policy, { reviewed: true, acceptedMismatch: true });
  await expect(preparePackageSigningReturn(saved, value.entry.id, value.signing, value.returned.id, policy)).rejects.toThrow('already captured');
  const altered = structuredClone(saved), current = altered.revisions.find(item => item.id === altered.currentRevisionId)!;
  current.signing!.handoffs[0].returns![0].memberId = current.members[0].id;
  expect(actionPackageSchema.safeParse(altered).success).toBe(false);
});
it('restores exact returned files from a portable package in an independent empty signing store', async () => {
  const value = await fixture(), prepared = await preparePackageSigningReturn(value.record, value.entry.id, value.signing, value.returned.id, policy);
  const saved = await applyPackageSigningReturn(prepared, policy, { reviewed: true, acceptedMismatch: true }), json = await buildPortableActionPackage(saved);
  await clearDb(); const imported = await importPortableActionPackage(json), entry = getPackageRevision(imported).signing!.handoffs[0], receipt = entry.returns![0];
  expect(await listSigningRecords()).toHaveLength(0);
  expect((await getPackageSigningPdf(entry, undefined, receipt.id)).bytes).toEqual(value.returnedBytes);
  const restored = await openCapturedPackageSigningRecord(entry, policy, true, undefined, () => true, receipt.id);
  expect(restored.returns).toEqual(value.signing.returns); expect((await listSigningRecords())[0].returns).toEqual(restored.returns);
});
it('adds a captured historical return to newer local signing placements without overwriting them', async () => {
  const value = await fixture(), prepared = await preparePackageSigningReturn(value.record, value.entry.id, value.signing, value.returned.id, policy);
  const saved = await applyPackageSigningReturn(prepared, policy, { reviewed: true, acceptedMismatch: true }), entry = getPackageRevision(saved).signing!.handoffs[0], receipt = entry.returns![0];
  await removeSigningRecord(value.signing);
  let local = await importSigningRecord(await readPackageSigningRecord(entry));
  local = await updateSigningFields(local, [{ ...local.fields[0], signer: 'Preserve newer local signer placement' }]);
  const restored = await openCapturedPackageSigningRecord(entry, policy, true, undefined, () => true, receipt.id);
  expect(restored.fields).toEqual(local.fields); expect(restored.returns).toEqual(value.signing.returns);
  expect((await listActionPackages())[0]).toEqual(saved);
});
it('reviews all exact return metadata and PDF content under the active package policy', async () => {
  const value = await fixture(); vi.mocked(extractPdfText).mockResolvedValue('(S) Synthetic returned marking');
  await expect(preparePackageSigningReturn(value.record, value.entry.id, value.signing, value.returned.id, policy)).rejects.toThrow('configured levels');
  expect(getPackageRevision((await listActionPackages())[0]).members).toHaveLength(1);
});
