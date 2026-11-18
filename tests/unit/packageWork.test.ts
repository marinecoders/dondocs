import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, renameActionPackage } from '@/lib/actionPackages';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { updatePackageWork, packageWorkSchema, packageWorkToday, resolvePackageTaskTarget, type PackageWork } from '@/lib/packageWork';
import { derivePackageNextActions } from '@/lib/packageNextActions';
import { updatePackageRequirements, inspectPackageRequirements } from '@/lib/packageRequirements';
import { buildPortableActionPackage, importPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { capturePackageBackup } from '@/lib/actionPackageBackup';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { buildPackageReviewerCopy, packageReviewTransferFile, parsePackageReviewTransfer } from '@/lib/packageReviewTransfer';
import { preparePackageAssembly } from '@/lib/actionPackageAssembly';
import { reviewPackageWork } from '@/lib/actionPackageDisclosure';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { useUIStore } from '@/stores/uiStore';
import { updatePackageInformation } from '@/lib/packageInformation';
import { updatePackageConsistency } from '@/lib/packageConsistency';
import { preparePackageUpdate, applyPreparedPackageUpdate, undoPackageUpdate } from '@/lib/packageUpdates';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
const otherPolicy = resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } });
const work = (patch: Partial<PackageWork['tasks'][number]> = {}): PackageWork => ({ version: 1, tasks: [
  { id: 'collect-evidence', title: 'Collect supporting record', status: 'pending', owner: 'Alex Example', dueDate: '2026-11-18', notes: 'Use the reviewed copy.', ...patch },
] });
async function fixture() {
  const session = createBlankSession(); session.formData.subject = 'SYNTHETIC WORK TRACKING';
  session.paragraphs = [{ id: 'body', text: 'Synthetic supporting content.', level: 0 }];
  const member = await capturePackageMember(captureDocumentRevision({ documentId: 'work-source', epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...session, endItems: [], publicationTables: {} }), 'Synthetic main letter', 'basic-letter');
  return reviseActionPackage(await createActionPackage(`Work test ${crypto.randomUUID()}`), [member]);
}
async function clearDb() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction([...db.objectStoreNames], 'readwrite'); for (const name of db.objectStoreNames) transaction.objectStore(name).clear(); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
}
beforeEach(() => {
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy);
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  useUIStore.setState({ storageHealth: 'ok' });
});
afterEach(() => vi.restoreAllMocks());

it('owns caller changes before awaiting policy and preserves immutable content through task edits', async () => {
  const initial = await fixture(), prior = structuredClone(initial), supplied = work();
  let release!: (value: typeof policy) => void;
  vi.mocked(classification.getExportDeploymentPolicy).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = updatePackageWork(initial, supplied, policy);
  supplied.tasks[0].title = 'Caller changed'; initial.name = 'Caller changed package'; release(policy);
  const saved = await pending;
  expect(saved.name).toBe(prior.name); expect(saved.revisions.slice(0, -1)).toEqual(prior.revisions);
  expect(getPackageRevision(saved).work?.tasks[0].title).toBe('Collect supporting record');
  expect(getPackageRevision(saved).members).toEqual(getPackageRevision(prior).members);
  const completed = await updatePackageWork(saved, work({ status: 'complete' }), policy);
  expect(getPackageRevision(saved).work?.tasks[0].status).toBe('pending');
  expect(getPackageRevision(completed).work?.tasks[0].status).toBe('complete');
  await expect(updatePackageWork(completed, work({ status: 'complete' }), policy)).rejects.toThrow(/already matches/);
});

it('round-trips tasks through a fresh database, recovery and an exact reviewer baseline', async () => {
  let record = await fixture(); record = await updatePackageWork(record, work({ target: { kind: 'member', id: getPackageRevision(record).members[0].id } }), policy);
  const expected = structuredClone(getPackageRevision(record).work), file = await buildPortableActionPackage(record);
  expect(getPackageRevision((await parsePortableActionPackage(file)).record).work).toEqual(expected);
  expect(getPackageRevision((await capturePackageBackup()).find(item => item.id === record.id)!).work).toEqual(expected);
  await clearDb(); const imported = await importPortableActionPackage(file);
  expect(getPackageRevision(imported).work).toEqual(expected);
  const reviewed = await startPackageReview(imported), round = reviewed.reviewRounds![0]; expect(round.baseline.work).toEqual(expected);
  const copy = await parsePackageReviewTransfer(await packageReviewTransferFile(await buildPackageReviewerCopy(reviewed, round.id, policy), policy));
  expect(getPackageRevision(copy.record).work).toEqual(expected);
  await expect(updatePackageWork(copy.record, work({ title: 'Reviewer mutation' }), policy)).rejects.toThrow(/owning package/);
});

it('preserves stale task targets without silently attaching another document', async () => {
  let record = await fixture(); const target = { kind: 'member' as const, id: getPackageRevision(record).members[0].id };
  record = await updatePackageWork(record, work({ target }), policy);
  record = await reviseActionPackage(record, []);
  expect(getPackageRevision(record).work?.tasks[0].target).toEqual(target);
  expect(resolvePackageTaskTarget(getPackageRevision(record), target).state).toBe('missing');
  record = await updatePackageWork(record, work({ target, title: 'Repair the retained task link' }), policy);
  await expect(updatePackageWork(record, work({ target: { ...target, id: 'unrelated' } }), policy)).rejects.toThrow(/existing document/);
  expect(getPackageRevision(record).work?.tasks[0].target).toEqual(target);
});

it('refuses stale, archived, cancelled, invalid-owner and changed-policy writes', async () => {
  const record = await fixture();
  await renameActionPackage(record, 'Concurrent package rename');
  await expect(updatePackageWork(record, work(), policy)).rejects.toThrow(/changed in another tab/);
  const current = (await listActionPackages()).find(item => item.id === record.id)!;
  await expect(updatePackageWork({ ...current, archived: true }, work(), policy)).rejects.toThrow(/unarchived/);
  await expect(updatePackageWork(current, work(), policy, undefined, () => false)).rejects.toThrow(/no longer current/);
  const controller = new AbortController(); controller.abort();
  await expect(updatePackageWork(current, work(), policy, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValueOnce(otherPolicy);
  await expect(updatePackageWork(current, work(), policy)).rejects.toThrow(/Deployment settings changed/);
  vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValueOnce(otherPolicy);
  await expect(updatePackageWork(current, work(), policy)).rejects.toThrow(/Deployment settings changed/);
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(current);
});

it('rolls back a quota-aborted task write without losing the previous package', async () => {
  const record = await fixture(), original = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    const value = original.apply(this, args); if (this.name === 'app') this.transaction.abort(); return value;
  });
  await expect(updatePackageWork(record, work(), policy)).rejects.toThrow(/could not be saved/); spy.mockRestore();
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});

it('rejects invalid dates, unsafe identities, excessive data and restricted task text', async () => {
  expect(() => packageWorkSchema.parse(work({ dueDate: '2025-02-29' }))).toThrow();
  expect(() => packageWorkSchema.parse(work({ id: '__proto__' }))).toThrow();
  expect(() => packageWorkSchema.parse(work({ notes: 'bad\u007ftext' }))).toThrow();
  expect(() => packageWorkSchema.parse({ version: 1, tasks: [...work().tasks, ...work().tasks] })).toThrow();
  expect(() => packageWorkSchema.parse({ version: 1, tasks: Array.from({ length: 101 }, (_, i) => ({ ...work().tasks[0], id: `task-${i}` })) })).toThrow();
  expect(() => reviewPackageWork(work({ notes: 'SECRET' }), policy)).toThrow(/outside/);
  const initial = await fixture();
  await expect(updatePackageWork(initial, work({ notes: 'SECRET' }), policy)).rejects.toThrow(/outside/);
  const forged = structuredClone(initial); forged.revisions.at(-1)!.work = work({ owner: 'SECRET' });
  const prepared = await preparePackageAssembly(forged, forged.currentRevisionId, policy, { includeRetainedDraftText: true });
  expect(prepared.readiness.findings.some(finding => finding.severity === 'error' && /configured levels/.test(finding.message))).toBe(true);
});

it('keeps manual task completion independent from actual evidence and the selected operation', async () => {
  let record = await fixture(); record = await updatePackageRequirements(record, { version: 1, items: [
    { id: 'missing-proof', label: 'Supporting proof', kind: 'document', operations: ['pdf'], condition: 'active' },
  ] }, policy);
  record = await updatePackageWork(record, work({ status: 'complete' }), policy);
  expect((await inspectPackageRequirements(getPackageRevision(record), 'pdf')).ready).toBe(false);
  const pdf = await derivePackageNextActions(record, undefined, { operation: 'pdf', policy, today: '2026-11-18' });
  expect(pdf.readyForOperation).toBe(false); expect(pdf.pendingTasks).toBe(0);
  expect(pdf.actions.some(action => action.kind === 'evidence' && action.blocking && action.destination?.requirementId === 'missing-proof')).toBe(true);
  const portable = await derivePackageNextActions(record, undefined, { operation: 'portable', policy });
  expect(portable.readyForOperation, JSON.stringify(portable.actions)).toBe(true); expect(portable.actions.some(action => action.id === 'prepare-portable')).toBe(true);
});

it('uses local calendar dates, retains same-owner tasks and prioritizes real conflicts over overdue tasks', async () => {
  expect(packageWorkToday(new Date(2026, 10, 18, 0, 1))).toBe('2026-11-18');
  const timezoneInstant = new Date('2026-11-18T00:01:00Z');
  vi.spyOn(timezoneInstant, 'getFullYear').mockReturnValue(2026); vi.spyOn(timezoneInstant, 'getMonth').mockReturnValue(10); vi.spyOn(timezoneInstant, 'getDate').mockReturnValue(17);
  expect(packageWorkToday(timezoneInstant)).toBe('2026-11-17');
  let record = await fixture(); record = await updatePackageWork(record, { version: 1, tasks: [
    work({ id: 'today', title: 'Due today' }).tasks[0], work({ id: 'past', title: 'Already due', dueDate: '2026-11-17' }).tasks[0],
    work({ id: 'other', title: 'Other same-owner task' }).tasks[0],
  ] }, policy);
  record = await updatePackageInformation(record, { version: 1, participants: [], facts: [
    { id: 'start', label: 'Start', kind: 'date', value: '2026-11-19', source: { kind: 'entered' } },
    { id: 'end', label: 'End', kind: 'date', value: '2026-11-18', source: { kind: 'entered' } },
  ] });
  record = await updatePackageConsistency(record, { version: 1, rules: [
    { id: 'dates', label: 'Dates', relation: 'date-on-or-before', leftFactId: 'start', rightFactId: 'end', required: true },
  ], exceptions: [] }, policy);
  const result = await derivePackageNextActions(record, undefined, { operation: 'review', policy, today: '2026-11-18' });
  expect(result.readyForOperation).toBe(false); expect(result.actions[0].kind, JSON.stringify(result.actions)).toBe('consistency');
  const tasks = result.actions.filter(action => action.kind === 'task'); expect(tasks).toHaveLength(3);
  expect(tasks.find(task => task.taskId === 'today')?.overdue).toBe(false);
  expect(tasks.find(task => task.taskId === 'past')?.overdue).toBe(true);
  expect((await derivePackageNextActions(record, undefined, { operation: 'portable', policy })).actions.find(action => action.kind === 'consistency')?.blocking).toBe(false);
});


it('reviews retained task names and notes before linked updates or restoring an older revision', async () => {
  const high = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'secret', allowedLevels: ['unclassified', 'cui', 'confidential', 'secret'] }, runtime: { status: 'absent' } });
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(high);
  vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(high);
  const record = await updatePackageWork(await fixture(), work({ notes: 'SECRET' }), high);
  const information = { version: 1 as const, participants: [], facts: [{ id: 'subject', label: 'Subject', kind: 'text' as const, value: 'Training', source: { kind: 'entered' as const } }] };
  await expect(preparePackageUpdate(record, information, undefined, {}, policy)).rejects.toThrow(/outside/);
  const applied = await applyPreparedPackageUpdate(await preparePackageUpdate(record, information, undefined, {}, high), high, true);
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(policy);
  vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(policy);
  await expect(undoPackageUpdate(applied.undo, policy)).rejects.toThrow(/outside/);
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(applied.record);
});

it('does not advertise an owning review for archived, historical or reviewer-only views', async () => {
  const initial = await fixture(), record = await updatePackageWork(initial, work(), policy);
  const historical = await derivePackageNextActions(record, initial.currentRevisionId, { operation: 'review', policy });
  expect(historical.readyForOperation).toBe(false);
  expect(historical.actions.find(action => action.id === 'review-historical')?.destination?.revisionId).toBe(record.currentRevisionId);
  const archived = await derivePackageNextActions({ ...record, archived: true }, undefined, { operation: 'review', policy });
  expect(archived.readyForOperation).toBe(false); expect(archived.actions.some(action => action.id === 'prepare-review')).toBe(false);
  const reviewed = await startPackageReview(record), round = reviewed.reviewRounds![0];
  const reviewer = (await parsePackageReviewTransfer(await packageReviewTransferFile(await buildPackageReviewerCopy(reviewed, round.id, policy), policy))).record;
  const inspected = await derivePackageNextActions(reviewer, undefined, { operation: 'review', policy });
  expect(inspected.readyForOperation).toBe(false); expect(inspected.actions.some(action => action.id === 'review-copy' && action.blocking)).toBe(true);
  expect(inspected.actions.find(action => action.id === `review-${round.id}`)?.destination).toEqual({ section: 'review', reviewRoundId: round.id, revisionId: round.revisionId });
});


it('derives real review applicability from saved inputs while task-only changes preserve the review', async () => {
  let record = await startPackageReview(await fixture()); const round = record.reviewRounds![0];
  record = await updatePackageWork(record, work(), policy);
  const taskOnly = await derivePackageNextActions(record, undefined, { operation: 'review', policy });
  expect(taskOnly.readyForOperation).toBe(true);
  expect(taskOnly.actions.some(action => action.id === `impact-review-${round.id}`)).toBe(false);
  expect(taskOnly.actions.find(action => action.id === `review-${round.id}`)?.destination?.revisionId).toBe(round.revisionId);
  const member = getPackageRevision(record).members[0]; if (member.kind !== 'native') throw new Error('Expected native member');
  const session = createBlankSession(); session.formData.subject = 'CHANGED SYNTHETIC REVIEW INPUT';
  session.paragraphs = [{ id: 'body', text: 'Newer content requires applicability inspection.', level: 0 }];
  const changed = await capturePackageMember(captureDocumentRevision({ documentId: 'changed-work-source', epoch: 0, editSequence: 2, capturedAt: 200 },
    { ...session, endItems: [], publicationTables: {} }), member.label, member.role, member);
  record = await reviseActionPackage(record, [changed]);
  const latest = await derivePackageNextActions(record, undefined, { operation: 'review', policy });
  const action = latest.actions.find(action => action.id === `impact-review-${round.id}`);
  expect(action).toMatchObject({ kind: 'impact', blocking: false, destination: { section: 'review', revisionId: round.revisionId, reviewRoundId: round.id } });
  expect(action?.message).toMatch(/document input.*changed/);
  expect(record.reviewRounds![0]).toEqual(round);
});
