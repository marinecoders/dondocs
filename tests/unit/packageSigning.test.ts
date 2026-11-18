import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import * as impactModel from '@/lib/packageChangeImpactModel';
import { createActionPackage, getPackageRevision, reviseActionPackage, renameActionPackage, listActionPackages, duplicateActionPackage,
  actionPackageSchema, type ActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { capturePackageSigningHandoff, preparePackageSigningHandoff, preparePackageSigningSource, openPackageSigningSource,
  packageSigningTargets, readPackageSigningRecord, getPackageSigningPdf, openCapturedPackageSigningRecord, packageSigningContextFingerprint,
  type PackageSigningTarget } from '@/lib/packageSigning';
import { createSigningHandoff, updateSigningFields, listSigningRecords, removeSigningRecord } from '@/lib/signingWorkspace';
import { base64ToUint8Array } from '@/lib/encoding';
import { buildPortableActionPackage, parsePortableActionPackage, importPortableActionPackage } from '@/lib/actionPackageTransfer';
import { capturePackageBackup } from '@/lib/actionPackageBackup';
import { preparePackageAssembly, assemblePackage } from '@/lib/actionPackageAssembly';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { useUIStore } from '@/stores/uiStore';
import { extractPdfText } from '@/lib/pdfText';
import { idbGetAllAttachments } from '@/lib/documentsDb';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => 'Synthetic training text.') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
const otherPolicy = resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } });
async function clearDb() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction([...db.objectStoreNames], 'readwrite'); for (const store of db.objectStoreNames) tx.objectStore(store).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
}
beforeEach(async () => {
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy);
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  vi.mocked(extractPdfText).mockResolvedValue('Synthetic training text.');
  await createActionPackage('Initialize'); await clearDb(); useUIStore.setState({ storageHealth: 'ok' });
});
afterEach(() => vi.restoreAllMocks());
async function fixture(width = 400) {
  const pdf = await PDFDocument.create(); pdf.addPage([width, 600]);
  const member = await captureOriginalPackageMember({ name: 'Synthetic unsigned letter.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'basic-letter', false);
  const record = await reviseActionPackage(await createActionPackage('Synthetic signing action'), [member]);
  return { record, target: { kind: 'member', id: member.id, revisionId: member.revisionId } as const };
}
async function signing(record: ActionPackage, target: PackageSigningTarget, signer = 'Alex Example') {
  const prepared = await preparePackageSigningSource(record, record.currentRevisionId, target, policy);
  let captured = await openPackageSigningSource(prepared, policy, true);
  captured = await updateSigningFields(captured, [{ id: crypto.randomUUID(), signer, page: 0, x: 0.2, y: 0.7, width: 0.4, height: 0.08 }]);
  captured = await createSigningHandoff(captured); return captured;
}
async function captured() {
  const { record, target } = await fixture(), signingRecord = await signing(record, target);
  const prepared = await preparePackageSigningHandoff(record, record.currentRevisionId, target, signingRecord, signingRecord.handoffs![0].id, policy);
  return { initial: record, target, signingRecord, record: await capturePackageSigningHandoff(prepared, policy, true) };
}

it('opens only a reviewed privately captured exact source without changing the package or source bytes', async () => {
  const { record, target } = await fixture(), source = getPackageRevision(record).members[0]; expect(source.kind).toBe('original');
  const prepared = await preparePackageSigningSource(record, record.currentRevisionId, target, policy);
  await expect(openPackageSigningSource(prepared, policy, false)).rejects.toThrow('Review');
  await expect(openPackageSigningSource({ ...prepared }, policy, true)).rejects.toThrow('Review');
  const saved = await openPackageSigningSource(prepared, policy, true);
  expect(base64ToUint8Array(saved.source.data)).toEqual(new Uint8Array(await readPackageAsset(source.kind !== 'native' ? source.original : source.draft)));
  expect((await listActionPackages())[0]).toEqual(record);
});
it('captures a handoff into a new child revision and verifies its actual PDF bytes and signer assignment', async () => {
  const { initial, record, signingRecord } = await captured(), revision = getPackageRevision(record), entry = revision.signing!.handoffs[0];
  expect(revision.parentId).toBe(initial.currentRevisionId); expect(revision.members).toEqual(getPackageRevision(initial).members);
  expect(record.revisions[0]).toEqual(initial.revisions[0]); expect(entry.sourceRevisionId).toBe(initial.currentRevisionId);
  const restored = await readPackageSigningRecord(entry), pdf = await getPackageSigningPdf(entry);
  expect(restored.handoffs).toEqual(signingRecord.handoffs); expect(restored.fields[0].signer).toBe('Alex Example');
  expect(pdf.bytes).toEqual(base64ToUint8Array(signingRecord.handoffs![0].pdf.data));
  const metadata = new TextDecoder().decode(await readPackageAsset(entry.recordAsset));
  expect(metadata).toContain(`package-asset:${entry.pdfs.source.id}`); expect(metadata).not.toContain(signingRecord.source.data);
  expect(JSON.parse(metadata).record.handoffs[0].pdf.data).toBe(`package-asset:${entry.pdfs.handoff.id}`);
});
it('preserves the prepared handoff when caller-owned fields change after preparation', async () => {
  const { record, target } = await fixture(), source = await signing(record, target);
  const prepared = await preparePackageSigningHandoff(record, record.currentRevisionId, target, source, source.handoffs![0].id, policy);
  source.handoffs![0].fields[0].signer = 'Unreviewed changed signer'; source.source.data = '';
  expect(Object.isFrozen(prepared.signers)).toBe(true);
  const saved = await capturePackageSigningHandoff(prepared, policy, true);
  expect(getPackageRevision(saved).signing!.handoffs[0].signers).toEqual(['Alex Example']);
});
it('rejects a saved handoff from another PDF and unsaved signing records', async () => {
  const first = await fixture(), other = await fixture(480), source = await signing(other.record, other.target);
  await expect(preparePackageSigningHandoff(first.record, first.record.currentRevisionId, first.target, source, source.handoffs![0].id, policy)).rejects.toThrow('different exact');
  const changed = { ...source, title: 'Unsaved different title' };
  await expect(preparePackageSigningHandoff(other.record, other.record.currentRevisionId, other.target, changed, source.handoffs![0].id, policy)).rejects.toThrow('saved signing record');
});
it('rejects stale package plans and preserves prior saved files', async () => {
  const { record, target } = await fixture(), source = await signing(record, target);
  const prepared = await preparePackageSigningHandoff(record, record.currentRevisionId, target, source, source.handoffs![0].id, policy);
  const newer = await renameActionPackage(record, 'Newer package title'), assets = await idbGetAllAttachments();
  await expect(capturePackageSigningHandoff(prepared, policy, true)).rejects.toThrow('package changed');
  expect((await listActionPackages())[0]).toEqual(newer); expect(await idbGetAllAttachments()).toEqual(assets);
});
it('checks policy again at source opening and package handoff capture', async () => {
  const { record, target } = await fixture(), source = await signing(record, target);
  const sourcePlan = await preparePackageSigningSource(record, record.currentRevisionId, target, policy);
  const handoff = await preparePackageSigningHandoff(record, record.currentRevisionId, target, source, source.handoffs![0].id, policy);
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(otherPolicy);
  await expect(openPackageSigningSource(sourcePlan, policy, true)).rejects.toThrow('Deployment settings changed');
  await expect(capturePackageSigningHandoff(handoff, policy, true)).rejects.toThrow('Deployment settings changed');
  expect((await listActionPackages())[0]).toEqual(record);
});
it('cancels writes before or during their guarded commit without publishing partial package state', async () => {
  const { record, target } = await fixture(), source = await signing(record, target);
  const prepared = await preparePackageSigningHandoff(record, record.currentRevisionId, target, source, source.handoffs![0].id, policy), controller = new AbortController();
  controller.abort(); await expect(capturePackageSigningHandoff(prepared, policy, true, controller.signal)).rejects.toThrow();
  const assets = await idbGetAllAttachments();
  await expect(capturePackageSigningHandoff(prepared, policy, true, undefined, () => false)).rejects.toThrow('package changed');
  let calls = 0; await expect(capturePackageSigningHandoff(prepared, policy, true, undefined, () => ++calls === 1)).rejects.toThrow();
  expect((await listActionPackages())[0]).toEqual(record); expect(await idbGetAllAttachments()).toEqual(assets);
});
it('requires an owning current revision, a declared unsigned PDF and authentic reviewed preparation', async () => {
  const { record, target } = await fixture();
  await expect(preparePackageSigningSource({ ...record, archived: true }, record.currentRevisionId, target, policy)).rejects.toThrow('current, unarchived owning');
  await expect(preparePackageSigningSource(record, record.revisions[0].id, target, policy)).rejects.toThrow('current, unarchived owning');
  await expect(preparePackageSigningSource(record, record.currentRevisionId, { ...target, revisionId: 'unavailable' }, policy)).rejects.toThrow('exact unsigned');
  const copy = structuredClone(record); const member = copy.revisions.find(item => item.id === copy.currentRevisionId)!.members[0]; if (member.kind === 'original') member.signedOriginal = true;
  expect(packageSigningTargets(getPackageRevision(copy))).toEqual([]);
  await expect(preparePackageSigningSource(copy, copy.currentRevisionId, target, policy)).rejects.toThrow('exact unsigned');
});
it('round-trips package assets and signing through a fresh-browser portable import without a local signing record', async () => {
  const { record, signingRecord } = await captured(), entry = getPackageRevision(record).signing!.handoffs[0];
  await removeSigningRecord(signingRecord);
  const json = await buildPortableActionPackage(record), parsed = await parsePortableActionPackage(json);
  const read = async (asset: typeof entry.recordAsset) => parsed.resources.get(`assets/${asset.id}`)!.data;
  expect((await readPackageSigningRecord(entry, read)).handoffs![0].pdf.sha256).toBe(entry.pdfs.handoff.sha256);
  await clearDb(); const imported = await importPortableActionPackage(json);
  expect(getPackageRevision(imported).signing).toEqual(getPackageRevision(record).signing); expect(await listSigningRecords()).toHaveLength(0);
  const restored = await openCapturedPackageSigningRecord(getPackageRevision(imported).signing!.handoffs[0], policy, true);
  expect(restored.id).toBe(signingRecord.id); expect(restored.handoffs).toEqual(signingRecord.handoffs);
  expect((await capturePackageBackup())[0].revisions.at(-1)!.signing).toEqual(getPackageRevision(record).signing);
});
it('rejects modified metadata, cross-package associations and duplicate handoffs', async () => {
  const { record, initial, target, signingRecord } = await captured(), entry = getPackageRevision(record).signing!.handoffs[0];
  await expect(readPackageSigningRecord({ ...entry, metadataText: '' })).rejects.toThrow('does not match');
  expect(actionPackageSchema.safeParse({ ...record, id: 'different-package' }).success).toBe(false);
  const altered = structuredClone(record); altered.revisions.find(item => item.id === altered.currentRevisionId)!.signing!.handoffs[0].sourceRevisionId = 'invented';
  altered.revisions.push({ ...structuredClone(getPackageRevision(altered)), id: 'next-revision', parentId: altered.currentRevisionId }); altered.currentRevisionId = 'next-revision';
  expect(actionPackageSchema.safeParse(altered).success).toBe(false);
  const copied = await duplicateActionPackage(record); expect(copied.revisions.every(item => !item.signing)).toBe(true);
  await expect(preparePackageSigningHandoff(record, record.currentRevisionId, target, signingRecord, signingRecord.handoffs![0].id, policy)).rejects.toThrow('already captured');
  expect(getPackageRevision(initial).signing).toBeUndefined();
});
it('rejects retained signing metadata markings before storing a package handoff', async () => {
  const { record, target } = await fixture(), source = await signing(record, target, '(S) Synthetic handling label');
  await expect(preparePackageSigningHandoff(record, record.currentRevisionId, target, source, source.handoffs![0].id, policy)).rejects.toThrow('configured levels');
  expect(getPackageRevision((await listActionPackages())[0]).signing).toBeUndefined();
});
it('checks source PDF markings before creating a separate local signing draft', async () => {
  const { record, target } = await fixture(); vi.mocked(extractPdfText).mockResolvedValue('(S) Synthetic source marking');
  await expect(preparePackageSigningSource(record, record.currentRevisionId, target, policy)).rejects.toThrow('configured levels');
  expect(await listSigningRecords()).toHaveLength(0);
});
it('uses complete retained output provenance and rejects legacy or inconsistent associations', async () => {
  const { record } = await fixture(), ports = { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true };
  const retained = await assemblePackage(await preparePackageAssembly(record, record.currentRevisionId, policy), ports), revision = getPackageRevision(retained);
  const target: PackageSigningTarget = { kind: 'output', id: revision.outputs[0].id };
  expect((await preparePackageSigningSource(retained, revision.id, target, policy)).sourceSha256).toBe(revision.outputs[0].asset.sha256);
  const legacy = structuredClone(retained); delete legacy.revisions.find(item => item.id === legacy.currentRevisionId)!.outputs[0].provenance;
  await expect(preparePackageSigningSource(legacy, revision.id, target, policy)).rejects.toThrow('Retain a new PDF');
  const changed = structuredClone(retained); changed.revisions.find(item => item.id === changed.currentRevisionId)!.outputs[0].provenance!.inputSha256 = '0'.repeat(64);
  await expect(preparePackageSigningSource(changed, revision.id, target, policy)).rejects.toThrow('Retain a new PDF');
});
it('compares package signing context independently of local tasks and signing-history appends', async () => {
  const { record, initial } = await captured();
  expect(await packageSigningContextFingerprint(getPackageRevision(record))).toBe(await packageSigningContextFingerprint(getPackageRevision(initial)));
  const changed = structuredClone(getPackageRevision(record)); changed.work = { version: 1, tasks: [{ id: 'manual', title: 'Pending coordination', status: 'pending' }] };
  expect(await packageSigningContextFingerprint(changed)).toBe(await packageSigningContextFingerprint(getPackageRevision(record)));
  changed.members.reverse(); changed.information = { version: 1, participants: [], facts: [{ id: 'changed', label: 'Changed context', kind: 'text', value: 'New facts require a new decision', source: { kind: 'entered' } }] };
  expect(await packageSigningContextFingerprint(changed)).not.toBe(await packageSigningContextFingerprint(getPackageRevision(record)));
  const zip = await JSZip.loadAsync(await (await import('@/lib/signingWorkspace')).downloadSigningHandoff(await readPackageSigningRecord(getPackageRevision(record).signing!.handoffs[0]), getPackageRevision(record).signing!.handoffs[0].handoffId));
  expect(await zip.file('ready-to-sign.pdf')!.async('uint8array')).toEqual((await getPackageSigningPdf(getPackageRevision(record).signing!.handoffs[0])).bytes);
});

it('preserves earlier signing context hashes when assembly inputs gain an optional profile wrapper', async () => {
  const { record } = await fixture(), revision = getPackageRevision(record), original = impactModel.packageAssemblyInputs;
  const members = (value: typeof revision) => { const result: unknown = original(value); return result && typeof result === 'object' && !Array.isArray(result) && 'members' in result ? result.members : result; };
  const previous = await packageSigningContextFingerprint(revision);
  const spy = vi.spyOn(impactModel, 'packageAssemblyInputs').mockImplementation(value => ({ members: members(value), assembly: undefined }) as unknown as ReturnType<typeof original>);
  expect(await packageSigningContextFingerprint(revision)).toBe(previous);
  spy.mockImplementation(value => ({ members: members(value), assembly: { version: 1, profile: 'mixed', cover: true } }) as unknown as ReturnType<typeof original>);
  expect(await packageSigningContextFingerprint(revision)).not.toBe(previous);
});
