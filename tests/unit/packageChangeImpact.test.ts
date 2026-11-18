import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, readPackageAsset, retainPackageAsset } from '@/lib/actionPackageAssets';
import { commitActionPackage, createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage,
  packageAssets, type ActionPackage, type NativePackageMember, type PackageRevision } from '@/lib/actionPackages';
import { comparePackageChangeImpact, inspectPackageChangeImpact, type PackageChangeImpact } from '@/lib/packageChangeImpact';
import { impactInputFits } from '@/lib/packageChangeImpactModel';
import { capturePackageRenderProvenance } from '@/lib/packageRenderProvenance';
import { startPackageReview, transitionPackageReview } from '@/lib/packageReviewRounds';
import { buildPortableActionPackage, importPortableActionPackage } from '@/lib/actionPackageTransfer';
import { idbGetAllAttachments, idbPutAttachment } from '@/lib/documentsDb';
import { capturePackageBackup, restorePackageBackup, validatePackageBackup } from '@/lib/actionPackageBackup';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { useUIStore } from '@/stores/uiStore';
import { updatePackageInformation } from '@/lib/packageInformation';
import { preparePackageUpdate, applyPreparedPackageUpdate } from '@/lib/packageUpdates';
import { createPackageConsistencyException } from '@/lib/packageConsistency';
import { maintainedPackageAction } from '@/lib/maintainedPackageActions';
import { prepareConditionalPackage, applyPreparedConditionalPackage } from '@/lib/packageConditional';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
async function clearDb() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction([...db.objectStoreNames], 'readwrite'); for (const store of db.objectStoreNames) tx.objectStore(store).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
}
beforeEach(async () => {
  vi.restoreAllMocks(); vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  await createActionPackage('Initialize'); await clearDb(); useUIStore.setState({ storageHealth: 'ok' });
});
async function native(label = 'Main letter', subject = 'Training action', previous?: NativePackageMember) {
  const session = createBlankSession();
  Object.assign(session.formData, { subject, from: 'Training office', to: 'Training officer', sigLast: 'Example', classLevel: 'unclassified' });
  session.paragraphs = [{ id: 'body', text: 'Synthetic retained body.', level: 0 }];
  return capturePackageMember(captureDocumentRevision({ documentId: `source_${crypto.randomUUID()}`, epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...session, endItems: [], publicationTables: {} }), label, previous?.role ?? (label === 'Main letter' ? 'basic-letter' : 'supporting-document'), previous);
}
async function fixture() { return reviseActionPackage(await createActionPackage('Synthetic impact'), [await native(), await native('Supporting letter', 'Supporting action')]); }
function proposed(before: PackageRevision): PackageRevision { return { ...structuredClone(before), id: `revision_${crypto.randomUUID()}`, parentId: before.id, createdAt: before.createdAt + 1, outputs: [] }; }
const section = (report: PackageChangeImpact, kind: string) => report.sections.find(item => item.kind === kind)!.items;
async function retainedOutput(record: ActionPackage) {
  const revision = getPackageRevision(record), document = await PDFDocument.create();
  for (const _member of revision.members) document.addPage([612, 792]);
  const output = { id: `output_${crypto.randomUUID()}`, asset: await retainPackageAsset('Synthetic retained.pdf', 'application/pdf', new Uint8Array(await document.save()).buffer),
    createdAt: revision.createdAt + 1, policyIdentity: policy.status === 'ready' ? policy.policy.identity : '', renderer: 'Synthetic recorded renderer',
    provenance: await capturePackageRenderProvenance(revision), signingStatus: 'unsigned-assembled-derivative' as const,
    boundaries: revision.members.map((member, index) => ({ memberId: member.id, startPage: index + 1, pageCount: 1, firstPageLabel: String(index + 1), numbering: 'continuation' as const })) };
  return commitActionPackage(record, { ...record, sequence: record.sequence + 1,
    revisions: record.revisions.map(item => item.id === revision.id ? { ...item, outputs: [output] } : item) });
}

it('reports exact changed members and shared values without rewriting saved revisions or files', async () => {
  const record = await fixture(), before = getPackageRevision(record), after = proposed(before);
  after.members[1] = await native('Supporting letter', 'A newer action', before.members[1] as NativePackageMember);
  after.information = { version: 1, participants: [], facts: [{ id: 'date', label: 'Action date', kind: 'date', value: '2026-11-17', source: { kind: 'entered' } }] };
  const snapshots = JSON.stringify(record), assets = await idbGetAllAttachments(), report = await comparePackageChangeImpact(before, after);
  expect(section(report, 'member').map(item => item.state)).toEqual(['unchanged', 'changed']);
  expect(section(report, 'fact')[0]).toMatchObject({ state: 'added', destinations: [{ revisionId: after.id, factId: 'date' }] });
  expect(report.summary).toMatchObject({ changedMembers: 1, changedFacts: 1 }); expect(Object.isFrozen(report.sections[0].items[0])).toBe(true);
  expect(JSON.stringify(record)).toBe(snapshots); expect((await listActionPackages())[0]).toEqual(record); expect(await idbGetAllAttachments()).toEqual(assets);
});

it('separates movement and descriptive changes from captured content and device-local provenance', async () => {
  const before = getPackageRevision(await fixture()), after = proposed(before); after.members.reverse();
  const moved = await comparePackageChangeImpact(before, after); expect(section(moved, 'member').every(item => item.state === 'moved')).toBe(true);
  expect(moved.summary).toMatchObject({ changedMembers: 0, movedMembers: 2 });
  after.members = structuredClone(before.members); after.members[0].label = 'Renamed main letter';
  expect(section(await comparePackageChangeImpact(before, after), 'member')[0].state).toBe('metadata-only');
  after.members[0] = structuredClone(before.members[0]); const member = after.members[0] as NativePackageMember;
  member.revisionId = `rewrapped_${crypto.randomUUID()}`; if (member.source) member.source.local = false;
  expect(section(await comparePackageChangeImpact(before, after), 'member')[0].state).toBe('unchanged');
});

it('does not claim matching content when session records conflict with the same captured draft digest', async () => {
  const before = getPackageRevision(await fixture()), after = proposed(before); (after.members[0] as NativePackageMember).session.formData.subject = 'Conflicting uncaptured subject';
  const report = await comparePackageChangeImpact(before, after); expect(section(report, 'member')[0].state).toBe('unknown'); expect(report.summary.unknownEvidence).toBe(1);
});

it('keeps unchanged outputs historical after metadata changes and never claims their file bytes were verified', async () => {
  const record = await retainedOutput(await fixture()), before = getPackageRevision(record), after = proposed(before);
  after.information = { version: 1, participants: [], facts: [{ id: 'source', label: 'Source checked', kind: 'boolean', value: false, source: { kind: 'entered' } }] };
  const original = await readPackageAsset(before.outputs[0].asset), report = await comparePackageChangeImpact(before, after);
  expect(section(report, 'output')[0]).toMatchObject({ state: 'metadata-only', capturedRevisionId: before.id, association: 'historical', availability: 'not-checked' });
  expect(report.summary.affectedOutputs).toBe(1); expect(new Uint8Array(await readPackageAsset(before.outputs[0].asset))).toEqual(new Uint8Array(original));
  const same = await comparePackageChangeImpact(before, proposed(before)); expect(section(same, 'output')[0].state).toBe('unchanged');
});

it('identifies legacy, forged and reused output records without promoting them to current evidence', async () => {
  const before = getPackageRevision(await retainedOutput(await fixture())), after = proposed(before);
  const legacy = structuredClone(before); delete legacy.outputs[0].provenance;
  expect(section(await comparePackageChangeImpact(legacy, after), 'output')[0].state).toBe('unavailable');
  const forged = structuredClone(before); forged.outputs[0].provenance!.inputSha256 = 'f'.repeat(64);
  expect(section(await comparePackageChangeImpact(forged, after), 'output')[0]).toMatchObject({ state: 'unknown', association: 'unknown' });
  after.outputs = structuredClone(before.outputs);
  expect(section(await comparePackageChangeImpact(before, after), 'output')[0]).toMatchObject({ state: 'unknown', association: 'unknown' });
});

it('compares reviews against exact captured members while preserving lifecycle and unaffected documents', async () => {
  let record = await startPackageReview(await fixture()); record = await transitionPackageReview(record, record.reviewRounds![0].id, 'close');
  const before = getPackageRevision(record), after = proposed(before), snapshot = JSON.stringify(record);
  const unchanged = await comparePackageChangeImpact(before, after, { reviewRounds: record.reviewRounds, packageId: record.id });
  expect(section(unchanged, 'review')[0]).toMatchObject({ state: 'unchanged', association: 'historical', affectedMemberIds: [] });
  after.members[1] = await native('Supporting letter', 'Updated action', before.members[1] as NativePackageMember);
  const report = await comparePackageChangeImpact(before, after, { reviewRounds: record.reviewRounds, packageId: record.id });
  expect(section(report, 'review')[0]).toMatchObject({ state: 'changed', affectedMemberIds: [before.members[1].id] });
  expect(section(report, 'review')[0].message).toContain('closed review'); expect(JSON.stringify(record)).toBe(snapshot);
  await expect(comparePackageChangeImpact(before, after, { reviewRounds: record.reviewRounds, packageId: 'another-package' })).rejects.toThrow(/different package/);
});

it('owns input records before checksum awaits and rejects cancelled work without storage changes', async () => {
  const record = await retainedOutput(await fixture()), before = getPackageRevision(record), after = proposed(before), pending = comparePackageChangeImpact(before, after);
  after.members[0].label = 'Caller mutation after preparation began';
  const report = await pending; expect(section(report, 'member')[0].label).toBe('Main letter'); expect(section(report, 'output')[0].state).toBe('unchanged');
  const abort = new AbortController(); const cancelled = comparePackageChangeImpact(before, proposed(before), { signal: abort.signal }); abort.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' }); expect((await listActionPackages())[0]).toEqual(record);
});

it('preserves exact comparison semantics through a complete workspace backup and restore', async () => {
  let record = await retainedOutput(await fixture()); const beforeId = record.currentRevisionId;
  record = await reviseActionPackage(record, [...getPackageRevision(record).members].reverse());
  const report = await inspectPackageChangeImpact(record, beforeId), backups = await capturePackageBackup();
  const assets = packageAssets(record), resources = new Map(await Promise.all(assets.map(async asset => [asset.id, await readPackageAsset(asset)] as const)));
  const validated = await validatePackageBackup(backups, resources); await clearDb();
  for (const asset of assets) await idbPutAttachment({ ...asset, data: resources.get(asset.id)! }, true);
  await restorePackageBackup(validated); const restored = (await listActionPackages())[0];
  expect(await inspectPackageChangeImpact(restored, beforeId)).toEqual(report);
});

it('does not invent pruned history after a selected-revision portable handoff', async () => {
  const record = await fixture(), beforeId = record.revisions[0].id, file = await buildPortableActionPackage(record); await clearDb();
  const restored = await importPortableActionPackage(file);
  expect(restored.historyScope).toBe('selected-revision');
  await expect(inspectPackageChangeImpact(restored, beforeId)).rejects.toThrow(/unavailable/);
  const compared = await comparePackageChangeImpact(getPackageRevision(record), getPackageRevision(restored));
  expect(compared.changed).toBe(false);
});

it('distinguishes recorded citation renumbering from an unrelated content replacement', async () => {
  const before = getPackageRevision(await fixture()), after = proposed(before), member = before.members[0];
  before.citations = { version: 1, targets: [{ id: 'reference-a', kind: 'reference', memberId: member.id, memberRevisionId: member.revisionId, index: 0, itemSha256: 'a'.repeat(64) }], links: [] };
  after.citations = structuredClone(before.citations); const target = after.citations.targets[0]; if (!('index' in target)) throw new Error('Expected reference'); after.citations.targets[0] = { ...target, index: 1 };
  expect(section(await comparePackageChangeImpact(before, after), 'citation')[0].state).toBe('renumbered');
  after.citations.targets[0].itemSha256 = 'b'.repeat(64);
  expect(section(await comparePackageChangeImpact(before, after), 'citation')[0].state).toBe('changed');
});

it('bounds comparison traversal without expanding huge arrays or following cycles', async () => {
  expect(impactInputFits(Array.from({ length: 250_001 }, () => null))).toBe(false);
  const before = getPackageRevision(await fixture()), after = proposed(before), cycle: Record<string, unknown> = {}; cycle.self = cycle;
  Object.assign(after, { unexpected: cycle }); const report = await comparePackageChangeImpact(before, after);
  expect(report.limited).toBe(true); expect(report.summary.unknownEvidence).toBe(1); expect(report.sections).toEqual([]);
});

it('tracks assigned evidence dependencies while keeping inactive declarations separate', async () => {
  const before = getPackageRevision(await fixture()), after = proposed(before), assigned = before.members[0];
  before.requirements = { version: 1, items: [
    { id: 'active', label: 'Active proof', kind: 'document', operations: ['pdf'], condition: 'active', memberId: assigned.id },
    { id: 'inactive', label: 'Inactive proof', kind: 'document', operations: ['pdf'], condition: 'inactive', memberId: assigned.id },
  ] };
  after.requirements = structuredClone(before.requirements); after.members[0] = await native('Main letter', 'Changed captured evidence', assigned as NativePackageMember);
  const report = await comparePackageChangeImpact(before, after);
  expect(section(report, 'requirement').map(item => item.state)).toEqual(['changed', 'unchanged']);
});

it('reports stale consistency exceptions even when the stored rule and exception objects are unchanged', async () => {
  const before = getPackageRevision(await fixture());
  before.information = { version: 1, participants: [], facts: [
    { id: 'start', label: 'Start', kind: 'date', value: '2026-11-20', source: { kind: 'entered' } },
    { id: 'end', label: 'End', kind: 'date', value: '2026-11-17', source: { kind: 'entered' } },
  ] };
  before.consistency = { version: 1, rules: [{ id: 'dates', label: 'Chronology', relation: 'date-on-or-before', leftFactId: 'start', rightFactId: 'end', required: true }], exceptions: [] };
  before.consistency.exceptions.push(await createPackageConsistencyException(before, 'dates', 'Synthetic deliberate exception.'));
  const after = proposed(before); after.information!.facts[0].value = '2026-11-21';
  const report = await comparePackageChangeImpact(before, after), item = section(report, 'consistency')[0];
  expect(item.state).toBe('changed'); expect(item.message).toContain('excepted to conflict'); expect(item.message).toContain('no longer applies');
  expect(item.destinations).toEqual([{ revisionId: after.id, factId: 'start' }, { revisionId: after.id, factId: 'end' }]);
});

it('issues complete immutable impact from the real private field plan only after overlapping edits are resolved', async () => {
  let record = await fixture();
  record = await updatePackageInformation(record, { version: 1, participants: [], facts: [{ id: 'subject', label: 'Subject', kind: 'text', value: 'Training action', source: { kind: 'entered' } }] });
  const before = getPackageRevision(record), main = before.members[0] as NativePackageMember;
  const bindings = { version: 1 as const, items: [{ id: 'subject-link', factId: 'subject', memberId: main.id,
    target: { kind: 'correspondence' as const, docType: main.session.docType, field: 'subject' as const }, mode: 'linked' as const, expectedValue: 'Training action', format: 'field' as const }] };
  const information = structuredClone(before.information!); information.facts[0].value = 'Updated package value';
  const first = await preparePackageUpdate(record, information, bindings, {}, policy);
  expect(first.ready).toBe(true); expect(first.impact?.summary).toMatchObject({ changedMembers: 1, changedFacts: 1 });
  expect(Object.isFrozen(first.impact?.sections)).toBe(true);
  record = (await applyPreparedPackageUpdate(first, policy, true)).record;
  const saved = getPackageRevision(record), local = await native('Main letter', 'Independent local edit', saved.members[0] as NativePackageMember);
  record = await reviseActionPackage(record, [local, ...saved.members.slice(1)]);
  const next = structuredClone(getPackageRevision(record).information!); next.facts[0].value = 'Newer package value';
  const conflict = await preparePackageUpdate(record, next, getPackageRevision(record).bindings, {}, policy);
  expect(conflict.ready).toBe(false); expect(conflict.impact).toBeUndefined();
  const resolved = await preparePackageUpdate(record, next, getPackageRevision(record).bindings, { 'subject-link': 'apply-package' }, policy);
  expect(resolved.ready).toBe(true); expect(resolved.impact?.summary.changedMembers).toBe(1);
  const applied = (await applyPreparedPackageUpdate(resolved, policy, true)).record;
  expect((getPackageRevision(applied).members[0] as NativePackageMember).session.formData.subject).toBe('Newer package value');
});

it('attaches impact from the actual captured conditional plan while new actions have no invented baseline', async () => {
  const template = await maintainedPackageAction('administrative-request');
  const answers = { version: 1 as const, values: { requester: 'Alex Example', organization: 'Synthetic unit', recipient: 'Training office', subject: 'Training request', date: '2026-11-17', ssic: '01500', details: 'A synthetic request.', supportingEvidence: false }, groups: {} };
  const initial = await prepareConditionalPackage({ template, answers }, policy); expect(initial.ready).toBe(true); expect(initial.impact).toBeUndefined();
  const record = (await applyPreparedConditionalPackage(initial, policy, true)).record, next = structuredClone(answers); next.values.subject = 'Updated training request';
  const preview = await prepareConditionalPackage({ template, answers: next, record }, policy);
  expect(preview.ready).toBe(true); expect(preview.impact?.summary).toMatchObject({ changedMembers: 2, changedFacts: 1 });
  expect(section(preview.impact!, 'member').every(member => member.state === 'changed')).toBe(true);
});
