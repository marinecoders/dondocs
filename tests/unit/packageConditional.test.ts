import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { prepareConditionalPackage, applyPreparedConditionalPackage, saveConditionalPackageDraft, undoConditionalPackage,
  readConditionalPackageTemplate, conditionalPackageAnswers, packageTemplateInstanceKey } from '@/lib/packageConditional';
import type { PackageTemplateV2 } from '@/lib/packageTemplateSchema';
import type { PackageTemplateAnswers } from '@/lib/packageTemplateProgram';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, packageAssets } from '@/lib/actionPackages';
import { idbGetAllAttachments, idbDeleteAttachment } from '@/lib/documentsDb';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { buildPortableActionPackage, importPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { updatePackageInformation } from '@/lib/packageInformation';
import { capturePackageMember, readPackageMemberDraft } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
const otherPolicy = resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } });

function template(): PackageTemplateV2 {
  const session = createBlankSession(undefined, 'standard_letter');
  session.formData = { ...session.formData, docType: 'standard_letter', subject: '', sigFirst: '', sigMiddle: '', sigLast: '', signatureType: 'none', classLevel: 'unclassified' };
  session.paragraphs = [{ id: 'body', text: 'Complete the remaining document details in its existing editor.', level: 0 }];
  const main = { key: 'main', kind: 'native' as const, label: 'Main document', role: 'basic-letter' as const, required: true,
    draft: { ...session, timestamp: 0, kind: 'dondocs-draft', version: 2, documentKind: 'correspondence' }, pages: {},
    links: [{ questionId: 'subject', target: { kind: 'correspondence' as const, docType: 'standard_letter', field: 'subject' as const }, format: 'field' as const }] };
  return { kind: 'dondocs-package-template', version: 2, id: 'training_template', name: 'Training action', createdAt: 0,
    program: { revision: '1', questions: [{ id: 'subject', label: 'Subject', kind: 'text', required: true }, { id: 'include', label: 'Include extra', kind: 'boolean', required: true },
      { id: 'person', label: 'Name', kind: 'text', groupId: 'people', required: true }],
    participantGroups: [{ id: 'people', label: 'People', role: 'subject', min: 0, max: 5 }], requirements: [] },
    members: [main, { ...structuredClone(main), key: 'extra', label: 'Conditional document', role: 'supporting-document', required: false, when: { op: 'equals', questionId: 'include', value: true } },
      { ...structuredClone(main), key: 'person_sheet', label: 'Person worksheet', role: 'supporting-document', repeatGroupId: 'people',
        links: [{ ...main.links[0], questionId: 'person' }] }] };
}
function answers(include = false): PackageTemplateAnswers { return { version: 1, values: { subject: 'Training request', include }, groups: {} }; }
async function create(include = false, people: string[] = []) {
  const input = answers(include); input.groups.people = people.map(id => ({ id, label: id, answers: { person: `${id} name` } }));
  const plan = await prepareConditionalPackage({ template: template(), answers: input }, policy);
  expect(plan.issues).toEqual([]); return (await applyPreparedConditionalPackage(plan, policy, true)).record;
}
async function clearDb() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('dondocs'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction([...db.objectStoreNames], 'readwrite'); for (const store of db.objectStoreNames) tx.objectStore(store).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
}
beforeEach(async () => {
  vi.restoreAllMocks(); vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  await createActionPackage('Initialize'); await clearDb(); useUIStore.setState({ storageHealth: 'ok' });
});

describe('captured conditional package membership', () => {
  it('prepares without writes and captures source, documents, facts and links in one initial transaction', async () => {
    const supplied = answers(true), plan = await prepareConditionalPackage({ template: template(), answers: supplied }, policy);
    supplied.values.subject = 'Caller changed';
    expect(plan.ready).toBe(true); expect(await listActionPackages()).toEqual([]); expect(await idbGetAllAttachments()).toEqual([]);
    const { record } = await applyPreparedConditionalPackage(plan, policy, true), revision = getPackageRevision(record);
    expect(record.revisions).toHaveLength(1); expect(revision.members).toHaveLength(2); expect(revision.templateState?.pending).toBe(false);
    expect(revision.templateState?.answers.values.subject).toBe('Training request');
    for (const member of revision.members) if (member.kind === 'native') {
      expect(member.session.formData.subject).toBe('Training request'); expect((await readPackageMemberDraft(member)).reviewed.session).toEqual(member.session);
    }
    expect(await readConditionalPackageTemplate(record)).toEqual(template());
    const transferred = await parsePortableActionPackage(await buildPortableActionPackage(record));
    expect(getPackageRevision(transferred.record).templateState).toEqual(revision.templateState);
  });

  it('saves incomplete raw intake for reload and fresh-browser transfer, then applies complete answers', async () => {
    const incomplete: PackageTemplateAnswers = { version: 1, values: { subject: 'In progress' }, groups: {} };
    const record = await saveConditionalPackageDraft({ template: template(), answers: incomplete }, policy);
    expect(getPackageRevision(record).members).toEqual([]); expect(getPackageRevision(record).templateState?.pending).toBe(true);
    expect((await listActionPackages())[0]).toEqual(record);
    const file = await buildPortableActionPackage(record); await clearDb(); const imported = await importPortableActionPackage(file);
    expect(conditionalPackageAnswers(imported)).toEqual(incomplete);
    const completed = answers(); completed.values.subject = 'Completed progress';
    const plan = await prepareConditionalPackage({ template: await readConditionalPackageTemplate(imported), answers: completed, record: imported }, policy);
    const applied = await applyPreparedConditionalPackage(plan, policy, true);
    expect(applied.record.revisions).toHaveLength(2); expect(getPackageRevision(applied.record).members).toHaveLength(1);
  });

  it('keeps stable people and member identities through reorder and creates fresh IDs for another action', async () => {
    const record = await create(false, ['alex', 'blair']), before = getPackageRevision(record), input = conditionalPackageAnswers(record);
    input.groups.people.reverse();
    const plan = await prepareConditionalPackage({ template: template(), answers: input, record }, policy);
    const { record: next } = await applyPreparedConditionalPackage(plan, policy, true), revision = getPackageRevision(next);
    expect(revision.members.map(member => member.id)).toEqual([before.members[0].id, before.members[2].id, before.members[1].id]);
    expect(revision.members[1]).toEqual(before.members[2]); expect(revision.members[2]).toEqual(before.members[1]);
    const another = await create(false, ['alex', 'blair']);
    expect(getPackageRevision(another).members.some(member => before.members.some(old => old.id === member.id))).toBe(false);
    expect(getPackageRevision(another).information?.facts.some(fact => before.information?.facts.some(old => old.id === fact.id))).toBe(false);
  });

  it('requires a keep/remove decision for edited documents leaving a branch and preserves untracked documents', async () => {
    let record = await create(true), current = getPackageRevision(record), old = current.members[1];
    if (old.kind !== 'native') throw new Error('Expected native');
    const { draft } = await readPackageMemberDraft(old);
    const changed = { ...old.session, paragraphs: [{ id: 'body', text: 'Independent local correction.', level: 0 }], endItems: [], publicationTables: {} };
    const member = await capturePackageMember(captureDocumentRevision({ documentId: 'local_edit', epoch: 0, editSequence: 1, capturedAt: 100 }, changed), old.label, old.role, old);
    expect(draft).toBeTruthy(); record = await reviseActionPackage(record, [current.members[0], member]); current = getPackageRevision(record);
    const input = conditionalPackageAnswers(record); input.values.include = false;
    const first = await prepareConditionalPackage({ template: template(), answers: input, record }, policy);
    expect(first.ready).toBe(false); expect(first.changes.some(change => change.state === 'conflict')).toBe(true);
    const plan = await prepareConditionalPackage({ template: template(), answers: input, record, memberChoices: { [packageTemplateInstanceKey('extra')]: 'keep' } }, policy);
    const { record: retained } = await applyPreparedConditionalPackage(plan, policy, true);
    expect(getPackageRevision(retained).members).toEqual(current.members);
    expect(retained.revisions.slice(0, -1)).toEqual(record.revisions);
  });

  it('does not resurrect a manually deleted managed member until explicitly restored', async () => {
    let record = await create(true); const removed = getPackageRevision(record).members[1];
    record = await reviseActionPackage(record, [getPackageRevision(record).members[0]]);
    const input = conditionalPackageAnswers(record), plan = await prepareConditionalPackage({ template: template(), answers: input, record }, policy);
    expect(plan.ready).toBe(false); expect(plan.changes.find(change => change.memberId === removed.id)?.choices).toEqual(['restore', 'remove']);
    const restored = await prepareConditionalPackage({ template: template(), answers: input, record, memberChoices: { [packageTemplateInstanceKey('extra')]: 'restore' } }, policy);
    const { record: result } = await applyPreparedConditionalPackage(restored, policy, true);
    expect(getPackageRevision(result).members[1].id).toBe(removed.id);
    expect(getPackageRevision(result).members[1].revisionId).not.toBe(removed.revisionId);
  });

  it('merges newer information for untouched answers and surfaces overlapping intake edits', async () => {
    let record = await create(), current = getPackageRevision(record), info = structuredClone(current.information!);
    info.facts.find(fact => fact.label === 'Subject')!.value = 'Newer package value'; record = await updatePackageInformation(record, info);
    expect(conditionalPackageAnswers(record).values.subject).toBe('Newer package value');
    const unchanged = answers(true), merged = await prepareConditionalPackage({ template: template(), answers: unchanged, record }, policy);
    expect(merged.ready).toBe(true); expect(merged.answerChanges[0].state).toBe('kept-current');
    const changed = answers(true); changed.values.subject = 'Independent intake edit';
    const conflict = await prepareConditionalPackage({ template: template(), answers: changed, record }, policy);
    expect(conflict.ready).toBe(false); expect(conflict.answerChanges[0].state).toBe('conflict');
    const resolved = await prepareConditionalPackage({ template: template(), answers: changed, record, answerChoices: { [conflict.answerChanges[0].key]: 'keep-current' } }, policy);
    const applied = await applyPreparedConditionalPackage(resolved, policy, true);
    expect(getPackageRevision(applied.record).information?.facts.find(fact => fact.label === 'Subject')?.value).toBe('Newer package value');
  });

  it('rejects forged, stale, cancelled and changed-policy updates without installing files', async () => {
    const plan = await prepareConditionalPackage({ template: template(), answers: answers(true) }, policy);
    await expect(applyPreparedConditionalPackage({ ...plan }, policy, true)).rejects.toThrow(/Prepare and review/);
    const abort = new AbortController(); abort.abort();
    await expect(applyPreparedConditionalPackage(plan, policy, true, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(applyPreparedConditionalPackage(plan, policy, true, undefined, () => false)).rejects.toThrow(/no longer current/);
    vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(otherPolicy);
    await expect(applyPreparedConditionalPackage(plan, policy, true)).rejects.toThrow(/Deployment settings changed/);
    expect(await listActionPackages()).toEqual([]); expect(await idbGetAllAttachments()).toEqual([]);
  });

  it('rolls back a quota-aborted initial action and can retry the same owned preparation', async () => {
    const plan = await prepareConditionalPackage({ template: template(), answers: answers(true) }, policy), put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) { const result = put.apply(this, args); if (this.name === 'app') this.transaction.abort(); return result; });
    await expect(applyPreparedConditionalPackage(plan, policy, true)).rejects.toThrow(/could not be saved/); spy.mockRestore();
    expect(await listActionPackages()).toEqual([]); expect(await idbGetAllAttachments()).toEqual([]);
    expect(getPackageRevision((await applyPreparedConditionalPackage(plan, policy, true)).record).members).toHaveLength(2);
  });

  it('undoes as another child revision and refuses to overwrite intervening saved work', async () => {
    const record = await create(), input = conditionalPackageAnswers(record); input.values.include = true;
    const { record: applied, undo } = await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: template(), answers: input, record }, policy), policy, true);
    const restored = await undoConditionalPackage(undo!, policy);
    expect(restored.revisions.slice(0, -1)).toEqual(applied.revisions); expect(getPackageRevision(restored).members).toEqual(getPackageRevision(record).members);
    await expect(undoConditionalPackage(undo!, policy)).rejects.toThrow(/no longer be undone/);
  });

  it('owns the exact template after library loss and rejects missing source bytes', async () => {
    const record = await create(), source = getPackageRevision(record).templateState!.source;
    expect(packageAssets(record).some(asset => asset.id === source.id)).toBe(true);
    expect(await readConditionalPackageTemplate(record)).toEqual(template());
    await idbDeleteAttachment(source.id);
    await expect(buildPortableActionPackage(record)).rejects.toThrow(/missing|corrupt/i);
  });
});
