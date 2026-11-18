import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, renameActionPackage, actionPackageSchema, type ActionPackage } from '@/lib/actionPackages';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { createBlankSession } from '@/stores/documentStore';
import { updatePackageInformation } from '@/lib/packageInformation';
import { inspectPackageConsistency, updatePackageConsistency, createPackageConsistencyException, packageConsistencySchema, type PackageConsistency } from '@/lib/packageConsistency';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { reviewPackageConsistency } from '@/lib/actionPackageDisclosure';
import { buildPortableActionPackage, importPortableActionPackage } from '@/lib/actionPackageTransfer';
import { capturePackageBackup, validatePackageBackup, restorePackageBackup } from '@/lib/actionPackageBackup';
import { idbGetAllAttachments, idbPutAttachment } from '@/lib/documentsDb';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { reviewPayloadDigest } from '@/lib/reviewRounds';
import { buildPackageReviewerCopy, packageReviewTransferFile, parsePackageReviewTransfer } from '@/lib/packageReviewTransfer';
import { preparePackageAssembly } from '@/lib/actionPackageAssembly';
import { useUIStore } from '@/stores/uiStore';
import * as classification from '@/config/classification';

const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
const changedPolicy = resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } });
const { currentPolicy } = vi.hoisted(() => ({ currentPolicy: { value: undefined as unknown } }));
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => currentPolicy.value, getExportDeploymentPolicySync: () => currentPolicy.value }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const rule = (patch: Partial<PackageConsistency['rules'][number]> = {}): PackageConsistency['rules'][number] => ({ id: 'same-action', label: 'Shared action identifier', relation: 'equal', leftFactId: 'left', rightFactId: 'right', required: true, ...patch });
const declarations = (...rules: PackageConsistency['rules']): PackageConsistency => ({ version: 1, rules, exceptions: [] });
async function clearDb() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction([...db.objectStoreNames], 'readwrite'); for (const name of db.objectStoreNames) transaction.objectStore(name).clear(); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
}
async function fixture(left = '000123', right = '000124') {
  const members = await Promise.all([left, right].map(async (value, index) => {
    const session = createBlankSession(undefined, 'standard_letter'); session.formData.subject = value;
    session.paragraphs = [{ id: `body-${index}`, text: 'Synthetic relationship test content.', level: 0 }];
    return capturePackageMember(captureDocumentRevision({ documentId: `source-${index}`, epoch: 0, editSequence: 1, capturedAt: 100 }, { ...session, endItems: [], publicationTables: {} }), `Synthetic member ${index + 1}`, index === 0 ? 'basic-letter' : 'supporting-document');
  }));
  const record = await reviseActionPackage(await createActionPackage('Synthetic package relationships'), members);
  return updatePackageInformation(record, { version: 1, participants: [], facts: [
    { id: 'left', label: 'First identifier', kind: 'identifier', value: left, source: { kind: 'entered' } },
    { id: 'right', label: 'Second identifier', kind: 'identifier', value: right, source: { kind: 'entered' } },
  ] });
}
async function save(record: ActionPackage, value = declarations(rule())) { return updatePackageConsistency(record, value, policy); }
beforeEach(async () => { vi.restoreAllMocks(); currentPolicy.value = policy; await createActionPackage('Initialize'); await clearDb(); useUIStore.setState({ storageHealth: 'ok' }); });
afterEach(() => { vi.restoreAllMocks(); });

it('rejects duplicate/cross-reference metadata, executable properties and unsupported rules without storing fake completion', () => {
  for (const input of [declarations(rule(), rule()), declarations(rule({ rightFactId: 'left' })),
    { ...declarations(rule()), satisfied: true }, declarations({ ...rule(), relation: 'eval' } as never),
    { ...declarations(rule()), exceptions: [{ ruleId: 'missing', reason: 'Local exception', fingerprint: 'a'.repeat(64) }] },
    declarations(rule({ id: '__proto__' }))]) expect(packageConsistencySchema.safeParse(input).success).toBe(false);
});

it('checks only declared relationships and captures stable exact fact, member and binding destinations', async () => {
  const record = await fixture(), revision = getPackageRevision(record);
  expect(await inspectPackageConsistency(revision)).toEqual({ ready: true, findings: [] });
  revision.consistency = declarations(rule());
  revision.bindings = { version: 1, items: revision.members.map((member, index) => ({ id: `binding-${index}`, memberId: member.id, factId: index ? 'right' : 'left', format: 'field', mode: index ? 'override' : 'linked', expectedValue: index ? '000124' : '000123', target: { kind: 'correspondence', docType: 'standard_letter', field: 'subject' } })) };
  const inspection = await inspectPackageConsistency(revision);
  expect(inspection.ready).toBe(false); expect(inspection.findings[0].state).toBe('conflict');
  expect(inspection.findings[0].destinations).toEqual(revision.members.map((member, index) => ({ factId: index ? 'right' : 'left', memberId: member.id, bindingId: `binding-${index}` })));
  revision.information!.facts[1].value = '000123';
  expect((await inspectPackageConsistency(revision)).findings[0].state).toBe('satisfied');
});

it('keeps people and roles separate and rejects declaring a cross-person relationship', async () => {
  let record = await fixture(); const information = structuredClone(getPackageRevision(record).information!);
  information.participants = [{ id: 'person-a', label: 'Alex Example', role: 'subject' }, { id: 'person-b', label: 'Blair Example', role: 'approver' }];
  information.facts[0].participantId = 'person-a'; information.facts[1].participantId = 'person-b';
  // Fresh identities are required when confirmed values acquire a person.
  information.facts[0].id = 'person-left'; information.facts[1].id = 'person-right'; record = await updatePackageInformation(record, information);
  expect((await inspectPackageConsistency(getPackageRevision(record))).ready).toBe(true);
  const invalid = declarations(rule({ leftFactId: 'person-left', rightFactId: 'person-right', participantId: 'person-a' }));
  await expect(save(record, invalid)).rejects.toThrow(/different people/);
  const revision = { ...getPackageRevision(record), consistency: invalid };
  expect((await inspectPackageConsistency(revision)).findings[0].state).toBe('unresolved');
  await expect(createPackageConsistencyException(revision, 'same-action', 'Do not compare these people')).rejects.toThrow(/Resolve missing/);
});

it('orders real dates, preserves identifiers/false and compares decimals without Number precision loss', async () => {
  const revision = getPackageRevision(await fixture('000123', '123')); revision.consistency = declarations(rule());
  expect((await inspectPackageConsistency(revision)).ready).toBe(false);
  revision.information!.facts = [{ id: 'left', label: 'From date', kind: 'date', value: '2026-11-17', source: { kind: 'entered' } }, { id: 'right', label: 'To date', kind: 'date', value: '2026-11-18', source: { kind: 'entered' } }];
  revision.consistency = declarations(rule({ relation: 'date-on-or-before' })); expect((await inspectPackageConsistency(revision)).ready).toBe(true);
  revision.information!.facts.reverse(); revision.information!.facts[0].value = '2026-11-16'; expect((await inspectPackageConsistency(revision)).ready).toBe(false);
  revision.information!.facts = [{ id: 'left', label: 'Left', kind: 'boolean', value: false, source: { kind: 'entered' } }, { id: 'right', label: 'Right', kind: 'boolean', value: false, source: { kind: 'entered' } }];
  revision.consistency = declarations(rule()); expect((await inspectPackageConsistency(revision)).ready).toBe(true);
  revision.information!.facts = [{ id: 'left', label: 'Left', kind: 'decimal', value: '9007199254740993.00', source: { kind: 'entered' } }, { id: 'right', label: 'Right', kind: 'decimal', value: '9007199254740993', source: { kind: 'entered' } }];
  expect((await inspectPackageConsistency(revision)).ready).toBe(true);
  revision.information!.facts[1].value = '9007199254740992'; expect((await inspectPackageConsistency(revision)).ready).toBe(false);
});

it('captures a reason for the exact conflict and expires it after changing values, scope context or rule declarations', async () => {
  let record = await save(await fixture()), revision = getPackageRevision(record);
  const exception = await createPackageConsistencyException(revision, 'same-action', 'The returned reference intentionally differs.');
  record = await save(record, { ...revision.consistency!, exceptions: [exception] }); revision = getPackageRevision(record);
  expect((await inspectPackageConsistency(revision)).findings[0]).toMatchObject({ state: 'excepted', exceptionReason: exception.reason });
  const information = structuredClone(revision.information!); information.facts[1].value = '000125'; record = await updatePackageInformation(record, information);
  expect((await inspectPackageConsistency(getPackageRevision(record))).findings[0]).toMatchObject({ state: 'conflict', staleException: true });
  const changedLabel = structuredClone(revision); changedLabel.consistency!.rules[0].label = 'Changed declared relationship';
  expect((await inspectPackageConsistency(changedLabel)).findings[0].staleException).toBe(true);
  const satisfied = structuredClone(revision); satisfied.information!.facts[1].value = '000123';
  expect((await inspectPackageConsistency(satisfied)).findings[0]).toMatchObject({ state: 'satisfied', staleException: true });
  const missing = structuredClone(revision); missing.information!.facts.pop();
  expect((await inspectPackageConsistency(missing)).findings[0]).toMatchObject({ state: 'unresolved', staleException: true });
  await expect(createPackageConsistencyException(missing, 'same-action', 'Cannot waive missing input')).rejects.toThrow(/Resolve missing/);
  expect(revision.consistency!.exceptions[0]).toEqual(exception);
});

it('captures participant context in exceptions, permits packagewide-to-person comparisons and refuses stale forged exceptions', async () => {
  let record = await fixture(); const information = structuredClone(getPackageRevision(record).information!);
  information.participants.push({ id: 'subject', label: 'Alex Example', role: 'subject' }); information.facts[0] = { ...information.facts[0], id: 'subject-id', participantId: 'subject' };
  record = await updatePackageInformation(record, information); record = await save(record, declarations(rule({ leftFactId: 'subject-id', participantId: 'subject' })));
  const revision = getPackageRevision(record), exception = await createPackageConsistencyException(revision, 'same-action', 'Explicit synthetic difference');
  const excepted = await save(record, { ...revision.consistency!, exceptions: [exception] });
  const changed = structuredClone(getPackageRevision(excepted)); changed.information!.participants[0].label = 'Corrected Alex label';
  expect((await inspectPackageConsistency(changed)).findings[0]).toMatchObject({ state: 'conflict', staleException: true });
  await expect(save(record, { ...revision.consistency!, exceptions: [{ ...exception, fingerprint: 'a'.repeat(64) }] })).rejects.toThrow(/no longer matches/);
});

it('persists declarations through actual portable transfer, fresh storage recovery, member revisions and exact review baselines', async () => {
  let record = await save(await fixture()); const revision = getPackageRevision(record);
  record = await save(record, { ...revision.consistency!, exceptions: [await createPackageConsistencyException(revision, 'same-action', 'Synthetic approved local exception')] });
  const before = structuredClone(record), json = await buildPortableActionPackage(record), backup = await capturePackageBackup(), assets = (await idbGetAllAttachments()) ?? [];
  await clearDb(); const imported = await importPortableActionPackage(json);
  expect(getPackageRevision(imported).consistency).toEqual(getPackageRevision(before).consistency); expect((await inspectPackageConsistency(getPackageRevision(imported))).ready).toBe(true);
  const revised = await reviseActionPackage(imported, [...getPackageRevision(imported).members].reverse());
  expect(getPackageRevision(revised).consistency).toEqual(getPackageRevision(before).consistency);
  await clearDb(); for (const asset of assets) await idbPutAttachment(asset);
  await restorePackageBackup(await validatePackageBackup(backup, new Map(assets.map(asset => [asset.id, asset.data]))));
  const restored = (await listActionPackages()).find(item => item.id === before.id)!; expect(getPackageRevision(restored).consistency).toEqual(getPackageRevision(before).consistency);
  expect(getPackageRevision(restored).members.map(member => member.kind === 'native' ? member.draft.sha256 : member.original.sha256)).toEqual(getPackageRevision(before).members.map(member => member.kind === 'native' ? member.draft.sha256 : member.original.sha256));
  const reviewed = await startPackageReview(restored), round = reviewed.reviewRounds![0];
  expect(round.baseline.consistency).toEqual(getPackageRevision(restored).consistency);
  const copy = await parsePackageReviewTransfer(await packageReviewTransferFile(await buildPackageReviewerCopy(reviewed, round.id, policy), policy));
  expect(getPackageRevision(copy.record).consistency).toEqual(round.baseline.consistency);
  await expect(save(copy.record, declarations(rule()))).rejects.toThrow(/owning package/);
});

it('blocks review/PDF only for unresolved required relationships while portable inspection retains drafts and optional warnings', async () => {
  const record = await save(await fixture());
  await expect(startPackageReview(record)).rejects.toThrow(/Shared action identifier/);
  const pdf = await preparePackageAssembly(record, record.currentRevisionId, policy), portable = await preparePackageAssembly(record, record.currentRevisionId, policy, { includeRetainedDraftText: true });
  expect(pdf.readiness.findings.find(finding => finding.message.includes('Shared action identifier'))?.severity).toBe('error');
  expect(portable.readiness.findings.find(finding => finding.message.includes('Shared action identifier'))?.severity).toBe('warning');
  const optional = await save(record, declarations(rule({ required: false }))); expect((await inspectPackageConsistency(getPackageRevision(optional))).ready).toBe(true);
  await expect(startPackageReview(optional)).resolves.toHaveProperty('reviewRounds');
});

it('checks a historical reviewer-copy baseline while keeping an earlier valid round independent from current relationships', async () => {
  const optional = await save(await fixture(), declarations(rule({ required: false }))), reviewed = await startPackageReview(optional), round = reviewed.reviewRounds![0];
  const current = await save(reviewed, declarations(rule()));
  await expect(buildPackageReviewerCopy(current, round.id, policy)).resolves.toHaveProperty('mode', 'copy');
  const imported = structuredClone(reviewed), old = imported.revisions.find(revision => revision.id === round.revisionId)!;
  old.consistency!.rules[0].required = true;
  const invalid = imported.reviewRounds![0]; invalid.baseline.consistency!.rules[0].required = true;
  invalid.baselineDigest = await reviewPayloadDigest(invalid.baseline);
  invalid.members = invalid.members.map(binding => ({ ...binding, baselineDigest: invalid.baselineDigest }));
  await expect(buildPackageReviewerCopy(imported, round.id, policy)).rejects.toThrow(/Shared action identifier/);
});

it('owns input synchronously, rejects cancelled/stale writes and keeps declarations immutable in saved history', async () => {
  const record = await fixture(), value = declarations(rule()), pending = save(record, value); value.rules[0].label = 'Caller mutation';
  const saved = await pending; expect(getPackageRevision(saved).consistency!.rules[0].label).toBe('Shared action identifier');
  const abort = new AbortController(); abort.abort(); await expect(updatePackageConsistency(saved, undefined, policy, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(updatePackageConsistency(saved, undefined, policy, undefined, () => false)).rejects.toThrow();
  expect((await listActionPackages()).find(item => item.id === saved.id)).toEqual(saved);
  await expect(save(saved, declarations(rule({ leftFactId: 'different' })))).rejects.toThrow(/new relationship identity/);
  const next = { ...structuredClone(getPackageRevision(saved)), id: 'illegal-child', parentId: saved.currentRevisionId, consistency: declarations(rule({ rightFactId: 'different' })) };
  expect(actionPackageSchema.safeParse({ ...saved, currentRevisionId: next.id, revisions: [...saved.revisions, next] }).success).toBe(false);
});

it('refuses a concurrent rename or late deployment change without replacing the saved package', async () => {
  const record = await fixture();
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockImplementationOnce(async () => { await renameActionPackage(record, 'Concurrent rename'); return policy; });
  await expect(save(record)).rejects.toThrow(); expect((await listActionPackages()).find(item => item.id === record.id)?.name).toBe('Concurrent rename');
  vi.restoreAllMocks(); const current = (await listActionPackages()).find(item => item.id === record.id)!;
  currentPolicy.value = changedPolicy; await expect(save(current)).rejects.toThrow(/Deployment settings changed/);
  currentPolicy.value = policy; vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(changedPolicy);
  await expect(save(current)).rejects.toThrow(); expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(current);
});

it('includes retained labels and exception reasons in classification/privacy review', async () => {
  const record = await save(await fixture()), revision = getPackageRevision(record);
  const exception = await createPackageConsistencyException(revision, 'same-action', 'SECRET\nSynthetic review fixture');
  const value = { ...revision.consistency!, exceptions: [exception] };
  expect(() => reviewPackageConsistency(value, policy)).toThrow(/outside/);
  await expect(save(record, value)).rejects.toThrow(/outside/);
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});
