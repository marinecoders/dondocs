import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { actionPackageSchema, commitActionPackage, createActionPackage, getPackageRevision, listActionPackages,
  reviseActionPackage, duplicateActionPackage, renameActionPackage, packageAssets, type ActionPackage } from '@/lib/actionPackages';
import { assertActivePackageReview, assertPackageReviewBinding, getPackageReviewBinding, openPackageReview,
  packageReviewRoundStatus, startPackageReview, transitionPackageReview } from '@/lib/packageReviewRounds';
import { idbCompareActionPackage } from '@/lib/documentsDb';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { assemblePackage, preparePackageAssembly } from '@/lib/actionPackageAssembly';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { collectLiveAttachmentIds } from '@/lib/attachmentGc';
import { reviewPackageReviewMetadata } from '@/lib/actionPackageDisclosure';
import { useDocumentsStore } from '@/stores/documentsStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function clear() {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...db.objectStoreNames], 'readwrite');
    for (const name of db.objectStoreNames) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }); db.close();
}
async function fixture() {
  const session = createBlankSession();
  session.formData = { ...session.formData, subject: 'SYNTHETIC REVIEW', unitLine1: 'FICTIONAL TRAINING UNIT', from: 'Training Office', to: 'Training Officer', sigLast: 'Example', classLevel: 'unclassified' };
  session.paragraphs = [{ id: 'synthetic-paragraph', text: 'Captured review content.', level: 0 }];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'synthetic-source', capturedAt: 100, editSequence: 1, epoch: 0 },
    { ...session, endItems: [], publicationTables: {} }), 'Synthetic native', 'basic-letter');
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = new Uint8Array(await pdf.save()).buffer;
  const original = await captureOriginalPackageMember({ name: 'synthetic-signed.pdf', data: bytes }, 'enclosure', true);
  const record = await reviseActionPackage(await createActionPackage('Synthetic package'), [native, original]);
  return { record, native, original, bytes, session };
}
beforeEach(async () => {
  vi.restoreAllMocks(); await createActionPackage('Initialize'); await clear();
  useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true, baseline: null });
});
it('pins the selected saved revision, original bytes and captured output through newer source, membership removal and reload', async () => {
  const { record, native, original, bytes, session } = await fixture();
  const ports = { compile: async () => new Uint8Array(bytes), convertDocx: vi.fn(), waitForReady: async () => true };
  const rendered = await assemblePackage(await preparePackageAssembly(record, record.currentRevisionId, policy), ports);
  const reviewed = await startPackageReview(rendered, record.currentRevisionId, 'Synthetic baseline');
  expect(reviewed.revisions).toEqual(rendered.revisions); expect(reviewed.currentRevisionId).toBe(record.currentRevisionId);
  const round = reviewed.reviewRounds![0];
  expect(round.ownerPackageId).toBe(record.id); expect(round.baseline.outputs).toHaveLength(1);
  expect(round.baseline.members[0].kind === 'native' && round.baseline.members[0].source?.local).toBe(false);
  session.paragraphs[0].text = 'New source work';
  const newerOutput = await assemblePackage(await preparePackageAssembly(reviewed, record.currentRevisionId, policy), ports);
  const latest = await reviseActionPackage(newerOutput, []);
  const loaded = (await listActionPackages()).find(item => item.id === record.id)!;
  expect(loaded).toEqual(latest);
  const opened = await openPackageReview(loaded, round.id);
  expect(opened.baseline).toEqual(round.baseline); expect(opened.baseline.outputs).toHaveLength(1);
  expect(getPackageRevision(loaded, record.currentRevisionId).outputs).toHaveLength(2);
  expect(await readPackageAsset(original.kind === 'original' ? original.original : original.draft)).toEqual(bytes);
  const member = opened.baseline.members[0]; expect(member.kind === 'native' && member.session.paragraphs[0].text).toBe('Captured review content.');
  expect(member.kind === 'native' && member.session.timestamp).toBe(native.session.timestamp);
  const roots = await collectLiveAttachmentIds();
  for (const asset of packageAssets(reviewed)) expect(roots?.has(asset.id)).toBe(true);
  opened.baseline.members[0].label = 'Mutated caller';
  expect((await openPackageReview(loaded, round.id)).baseline.members[0].label).toBe(native.label);
  expect(useDocumentsStore.getState().docs).toEqual({});
});
it('binds feedback to exact parent, round, member revision, member digest and original asset digest', async () => {
  const { record, native } = await fixture(); const reviewed = await startPackageReview(record);
  const round = reviewed.reviewRounds![0], binding = getPackageReviewBinding(round, native.id);
  expect(() => assertPackageReviewBinding(round, binding)).not.toThrow();
  for (const field of ['packageId', 'roundId', 'revisionId', 'memberRevisionId', 'memberDigest', 'assetDigest', 'baselineDigest'] as const) {
    const foreign = { ...binding, [field]: field.endsWith('Digest') ? 'f'.repeat(64) : 'foreign-identity' };
    expect(() => assertPackageReviewBinding(round, foreign)).toThrow();
  }
  expect(() => getPackageReviewBinding(round, 'missing-member')).toThrow();
});
it('reviews only selected revision filenames for assembly while retaining older review resources', async () => {
  const { record, native, bytes } = await fixture();
  const retained = await captureOriginalPackageMember({ name: '(S) synthetic retained original.pdf', data: bytes }, 'enclosure', false);
  const prior = await reviseActionPackage(record, [native, retained]);
  const reviewed = await startPackageReview(prior);
  const current = await reviseActionPackage(reviewed, [native]);
  const prepared = await preparePackageAssembly(current, current.currentRevisionId, policy);
  expect(prepared.readiness).toEqual({ state: 'ready', findings: [] });
  const assembled = await assemblePackage(prepared, { compile: async () => new Uint8Array(bytes), convertDocx: vi.fn(), waitForReady: async () => true });
  expect(getPackageRevision(assembled).outputs).toHaveLength(1);
  const opened = await openPackageReview(assembled, reviewed.reviewRounds![0].id);
  expect(opened.baseline.members).toContainEqual(retained);
  expect(await readPackageAsset(retained.kind === 'original' ? retained.original : retained.draft)).toEqual(bytes);
  const included = await preparePackageAssembly({ ...assembled, currentRevisionId: opened.revisionId, revisions: [opened.baseline],
    historyScope: 'selected-revision', reviewRounds: undefined }, opened.revisionId, policy);
  expect(included.readiness.findings).toContainEqual(expect.objectContaining({ severity: 'error',
    message: "Package metadata includes markings outside this deployment's configured levels." }));
});
it('retains append-only lifecycle with local package authority, stale CAS and deliberate closed-round reopening', async () => {
  const { record } = await fixture(); const first = await startPackageReview(record);
  const round = first.reviewRounds![0];
  const closed = await transitionPackageReview(first, round.id, 'close');
  expect(() => assertActivePackageReview(closed.reviewRounds![0])).toThrow(/closed/);
  await expect(transitionPackageReview(first, round.id, 'close')).rejects.toThrow(/changed|saved/);
  await expect(transitionPackageReview(closed, round.id, 'close')).rejects.toThrow(/state changed/);
  const reopened = await transitionPackageReview(closed, round.id, 'reopen');
  const second = await startPackageReview(reopened);
  const superseded = await transitionPackageReview(second, round.id, 'supersede', second.reviewRounds![1].id);
  expect(packageReviewRoundStatus(superseded.reviewRounds![0])).toBe('superseded');
  expect((await openPackageReview(superseded, round.id)).baseline).toEqual(round.baseline);
  await expect(transitionPackageReview(superseded, round.id, 'reopen')).rejects.toThrow(/state changed/);
  const foreign = structuredClone(superseded); delete foreign.reviewRounds![1].ownerPackageId;
  await expect(transitionPackageReview(foreign, foreign.reviewRounds![1].id, 'close')).rejects.toThrow();
});
it('does not commit on cancellation, late invalidation, stale package state, quota abort, or malformed baselines', async () => {
  const { record } = await fixture();
  const signal = AbortSignal.abort(); await expect(startPackageReview(record, record.currentRevisionId, 'Cancelled', signal)).rejects.toThrow();
  await expect(startPackageReview(record, record.currentRevisionId, 'Invalidated', undefined, () => false)).rejects.toThrow();
  const saved = await renameActionPackage(record, 'Newer name');
  await expect(startPackageReview(record)).rejects.toThrow(/changed|saved/);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args) {
    const result = put.apply(this, args); if (this.name === 'app') this.transaction.abort(); return result;
  });
  await expect(startPackageReview(saved)).rejects.toThrow(/saved/); vi.restoreAllMocks();
  expect((await listActionPackages())[0]).toEqual(saved);
  const reviewed = await startPackageReview(saved);
  for (const mutate of [
    (value: ActionPackage) => { value.reviewRounds![0].baseline.members[0].label = 'Rewritten'; },
    (value: ActionPackage) => { value.reviewRounds![0].baselineDigest = 'f'.repeat(64); },
    (value: ActionPackage) => { value.reviewRounds![0].members[0].memberDigest = 'f'.repeat(64); },
    (value: ActionPackage) => { value.reviewRounds!.push(structuredClone(value.reviewRounds![0])); },
    (value: ActionPackage) => { value.reviewRounds = []; },
    (value: ActionPackage) => { delete value.reviewRounds![0].ownerPackageId; },
  ]) {
    const bad = structuredClone(reviewed); bad.sequence++; mutate(bad);
    expect(await idbCompareActionPackage(reviewed, bad)).toBe(false);
  }
  expect((await listActionPackages())[0]).toEqual(reviewed);
});
it('keeps legacy packages readable, strips review authority and context from clean transfer and duplication, and restores exact review backups', async () => {
  const { record } = await fixture(); expect(actionPackageSchema.parse(record).reviewRounds).toBeUndefined();
  const reviewed = await startPackageReview(record); const round = reviewed.reviewRounds![0];
  const portable = await buildPortableActionPackage(reviewed);
  expect(JSON.parse(portable).package.reviewRounds).toBeUndefined();
  const malicious = JSON.parse(portable); malicious.package.reviewRounds = [round];
  await expect(parsePortableActionPackage(JSON.stringify(malicious))).rejects.toThrow();
  expect((await duplicateActionPackage(reviewed)).reviewRounds).toBeUndefined();
  const backup = await buildBackup();
  await clear(); await restoreBackup(backup);
  const restored = (await listActionPackages()).find(value => value.id === reviewed.id)!;
  expect((await openPackageReview(restored, round.id)).baseline).toEqual(round.baseline);
  expect((await transitionPackageReview(restored, round.id, 'close')).reviewRounds![0].ownerPackageId).toBe(record.id);
});
it('fails closed on corrupt stored review digests at load and GC, and scans all retained review metadata', async () => {
  const { record } = await fixture(); const reviewed = await startPackageReview(record);
  const round = reviewed.reviewRounds![0];
  expect(() => reviewPackageReviewMetadata({ ...round, label: '(S) synthetic label' }, policy)).toThrow();
  expect(() => reviewPackageReviewMetadata({ ...round, members: [{ ...round.members[0], memberId: '(S) metadata' }] }, policy)).toThrow();
  const corrupt = structuredClone(reviewed); corrupt.reviewRounds![0].baselineDigest = 'f'.repeat(64);
  corrupt.reviewRounds![0].members.forEach(member => { member.baselineDigest = 'f'.repeat(64); });
  const db = await database(); await new Promise<void>(resolve => {
    const tx = db.transaction('app', 'readwrite'); tx.objectStore('app').put({ key: `action-package:${record.id}`, value: corrupt }); tx.oncomplete = () => resolve();
  }); db.close();
  await expect(listActionPackages()).rejects.toThrow(/digest/); expect(await collectLiveAttachmentIds()).toBeNull();
  await expect(buildBackup()).rejects.toThrow();
  await expect(commitActionPackage(corrupt, { ...corrupt, name: 'Corrupt', sequence: corrupt.sequence + 1 })).rejects.toThrow();
});

it('retains configured templates independently of newer membership and preserves them through offline workspace recovery', async () => {
  const { fixturePage, fixtureInstance } = await import('../_helpers/formFixture');
  const { preparePackageMember } = await import('@/lib/actionPackageAssets');
  const page = await fixturePage(), instance = fixtureInstance();
  instance.definition.pages[0].sha256 = page.sha256;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(page.bytes))));
  try {
    const session = createBlankSession();
    const member = await capturePackageMember(captureDocumentRevision({ documentId: 'synthetic-form', epoch: 0, editSequence: 1, capturedAt: 100 },
      { ...session, documentCategory: 'forms', formType: 'fixture', genericForm: instance, endItems: [], publicationTables: {} }), 'Synthetic form', 'basic-letter');
    const record = await reviseActionPackage(await createActionPackage('Synthetic template review'), [member]);
    const reviewed = await startPackageReview(record), round = reviewed.reviewRounds![0];
    await reviseActionPackage(reviewed, []);
    const backup = await buildBackup();
    expect((await collectLiveAttachmentIds())?.has(member.templates!['page1.pdf'].id)).toBe(true);
    await clear();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await restoreBackup(backup);
    const restored = (await listActionPackages())[0], opened = await openPackageReview(restored, round.id);
    const captured = opened.baseline.members[0];
    if (captured.kind !== 'native') throw new Error('Expected captured configured form.');
    expect(new Uint8Array(await readPackageAsset(captured.templates!['page1.pdf']))).toEqual(page.bytes);
    expect((await preparePackageMember(captured)).snapshot.genericForm?.answers).toEqual(instance.answers);
  } finally { vi.unstubAllGlobals(); }
});
