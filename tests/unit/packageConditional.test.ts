import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
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
import { capturePackageMember, readPackageMemberDraft, readPackageAsset } from '@/lib/actionPackageAssets';
import { retainPackageMemberTemplates } from '@/lib/actionPackageTemplates';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { useUIStore } from '@/stores/uiStore';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { uint8ArrayToBase64 } from '@/lib/encoding';
import { listPackageBindingFields } from '@/lib/packageBindingTargets';
import { applyPreparedPackageAttachment, preparePackageAttachment } from '@/lib/packageAttachments';

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
  it('reopens signed correspondence using its signing profile and rejects a different form identity', async () => {
    const record = await create();
    const revision = record.revisions[0];
    const letter = revision.members[0];
    if (letter.kind !== 'native') throw new Error('Expected a native letter');
    revision.members[0] = { id: letter.id, label: letter.label, revisionId: letter.revisionId, role: letter.role,
      required: letter.required, kind: 'original', original: letter.draft, signedOriginal: true, officialFormId: 'package_correspondence' };
    await expect(readConditionalPackageTemplate(record)).resolves.toEqual(template());
    revision.members[0].officialFormId = 'navmc_118_11';
    await expect(readConditionalPackageTemplate(record)).rejects.toThrow('declared kind');
  });

  it('enforces recipient evidence rules in a copied recipe while keeping an editable draft available', async () => {
    const source = template();
    source.id = 'local_training_copy';
    source.members[0].completion = { writtenContent: true };
    if (source.members[0].kind !== 'native') throw new Error('Expected a native letter');
    source.members[0].draft.paragraphs = [];
    const plan = await prepareConditionalPackage({ template: source, answers: answers() }, policy);
    const { record } = await applyPreparedConditionalPackage(plan, policy, true);
    const revision = getPackageRevision(record);
    const { preparePackageDelivery } = await import('@/lib/packageDelivery');
    const selection = { label: 'Training', memberIds: [revision.members[0].id] };
    await expect(preparePackageDelivery(record, revision.id, { ...selection, purpose: 'recipient' }, policy)).rejects.toThrow('Write the body');
    await expect(preparePackageDelivery(record, revision.id, { ...selection, purpose: 'editable' }, policy)).resolves.toMatchObject({ purpose: 'editable' });
  });

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
    let record = await create(true), current = getPackageRevision(record);
    const old = current.members[1];
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
    const unchanged = await prepareConditionalPackage({ template: template(), answers: conditionalPackageAnswers(retained), record: retained }, policy);
    expect(unchanged.ready).toBe(true); expect(unchanged.changed).toBe(false);
  });

  it('does not resurrect a manually deleted managed member until explicitly restored', async () => {
    let record = await create(true); const removed = getPackageRevision(record).members[1];
    record = await reviseActionPackage(record, [getPackageRevision(record).members[0]]);
    const input = conditionalPackageAnswers(record), plan = await prepareConditionalPackage({ template: template(), answers: input, record }, policy);
    expect(plan.ready).toBe(false); expect(plan.changes.find(change => change.memberId === removed.id)?.choices).toEqual(['restore', 'remove']);
    const restored = await prepareConditionalPackage({ template: template(), answers: input, record, memberChoices: { [packageTemplateInstanceKey('extra')]: 'restore' } }, policy);
    const { record: result } = await applyPreparedConditionalPackage(restored, policy, true);
    expect(getPackageRevision(result).members[1].id).toBe(removed.id);
    expect(getPackageRevision(result).members[1]).toEqual(removed);
  });

  it('merges newer information for untouched answers and surfaces overlapping intake edits', async () => {
    let record = await create();
    const current = getPackageRevision(record), info = structuredClone(current.information!);
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

  it('reviews restored supporting-file text before Undo under a stricter deployment', async () => {
    const initial = await create();
    const permissive = resolveExportDeploymentPolicy({ hostname: 'test.smil.mil', environment: null, runtime: { status: 'absent' } });
    vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(permissive);
    vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(permissive);
    const file = { name: 'retained.txt', data: new TextEncoder().encode('Synthetic opening\nSECRET\nSynthetic retained evidence').buffer };
    const record = await applyPreparedPackageAttachment(await preparePackageAttachment(initial, file, permissive), permissive, true);
    const input = conditionalPackageAnswers(record); input.values.include = true;
    const applied = await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: template(), answers: input, record }, permissive), permissive, true);
    const files = await idbGetAllAttachments();
    vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(policy);
    vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(policy);
    await expect(undoConditionalPackage(applied.undo!, policy)).rejects.toThrow(/markings.*configured levels/);
    expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(applied.record);
    expect(await idbGetAllAttachments()).toEqual(files);
  });

  it('owns the exact template after library loss and rejects missing source bytes', async () => {
    const record = await create(), source = getPackageRevision(record).templateState!.source;
    expect(packageAssets(record).some(asset => asset.id === source.id)).toBe(true);
    expect(await readConditionalPackageTemplate(record)).toEqual(template());
    await idbDeleteAttachment(source.id);
    await expect(buildPortableActionPackage(record)).rejects.toThrow(/missing|corrupt/i);
  });
});

describe('PR8 independent adversarial regressions', () => {
  it('reconnects historical template fields to a replacement optional fact after its old answer was cleared', async () => {
    const source = template(); source.program.questions[0].required = false;
    let record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: answers(true) }, policy), policy, true)).record;
    const off = conditionalPackageAnswers(record); off.values.include = false;
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: off, record }, policy), policy, true)).record;
    const cleared = conditionalPackageAnswers(record); delete cleared.values.subject;
    const mainLink = getPackageRevision(record).bindings!.items[0];
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: cleared, record,
      fieldChoices: { [mainLink.id]: 'detach' } }, policy), policy, true)).record;
    const restored = conditionalPackageAnswers(record); restored.values.subject = 'Replacement answer'; restored.values.include = true;
    const plan = await prepareConditionalPackage({ template: source, answers: restored, record }, policy);
    expect(plan.issues).toEqual([]); expect(plan.ready).toBe(true);
    const applied = (await applyPreparedConditionalPackage(plan, policy, true)).record, final = getPackageRevision(applied);
    const extra = final.members.find(member => member.id === final.templateState!.instances.find(instance => instance.memberKey === 'extra')!.memberId)!;
    expect(extra.kind === 'native' && extra.session.formData.subject).toBe('Replacement answer');
    const link = final.bindings!.items.find(binding => binding.memberId === extra.id)!;
    expect(final.templateState!.instances.find(instance => instance.memberId === extra.id)!.targets![0].linkId).toBe(link.id);
    expect(getPackageRevision((await parsePortableActionPackage(await buildPortableActionPackage(applied))).record)).toEqual(final);
  });

  it('restores an older document with a cleared answer as local content without resurrecting its fact', async () => {
    const source = template(); source.program.questions[0].required = false;
    let record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: answers(true) }, policy), policy, true)).record;
    const original = getPackageRevision(record), oldFact = original.information!.facts.find(fact => fact.label === 'Subject')!;
    const off = conditionalPackageAnswers(record); off.values.include = false;
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: off, record }, policy), policy, true)).record;
    const cleared = conditionalPackageAnswers(record); delete cleared.values.subject;
    const mainLink = getPackageRevision(record).bindings!.items[0];
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: cleared, record,
      fieldChoices: { [mainLink.id]: 'detach' } }, policy), policy, true)).record;
    const on = conditionalPackageAnswers(record); on.values.include = true;
    const plan = await prepareConditionalPackage({ template: source, answers: on, record }, policy);
    expect(plan.issues).toEqual([]);
    const applied = (await applyPreparedConditionalPackage(plan, policy, true)).record, final = getPackageRevision(applied);
    expect(final.members[1]).toEqual(original.members[1]);
    expect(final.information!.facts.some(fact => fact.id === oldFact.id)).toBe(false);
    expect(final.bindings!.items).toEqual([]);
    expect(conditionalPackageAnswers(applied).values.subject).toBeUndefined();
    const later = conditionalPackageAnswers(applied); later.values.subject = 'Answered after restoration';
    const conflict = await prepareConditionalPackage({ template: source, answers: later, record: applied }, policy);
    expect(conflict.ready).toBe(false); expect(conflict.fieldChanges[0].state).toBe('conflict');
    const accepted = await prepareConditionalPackage({ template: source, answers: later, record: applied,
      fieldChoices: { [conflict.fieldChanges[0].bindingId]: 'apply-package' } }, policy);
    expect(accepted.ready).toBe(true);
    const updated = getPackageRevision((await applyPreparedConditionalPackage(accepted, policy, true)).record);
    expect(updated.members[1].kind === 'native' && updated.members[1].session.formData.subject).toBe('Answered after restoration');
    expect(updated.bindings!.items[0].id).not.toBe(original.bindings!.items.find(binding => binding.memberId === original.members[1].id)!.id);
  });

  it('keeps a deliberately detached historical field detached when its branch and answer return', async () => {
    const source = template(); source.program.questions[0].required = false;
    let record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: answers(true) }, policy), policy, true)).record;
    const extra = getPackageRevision(record).members[1], detached = getPackageRevision(record).bindings!.items.find(binding => binding.memberId === extra.id)!;
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: conditionalPackageAnswers(record), record,
      fieldChoices: { [detached.id]: 'detach' } }, policy), policy, true)).record;
    const off = conditionalPackageAnswers(record); off.values.include = false;
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: off, record }, policy), policy, true)).record;
    const cleared = conditionalPackageAnswers(record); delete cleared.values.subject;
    const mainLink = getPackageRevision(record).bindings!.items[0];
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: cleared, record,
      fieldChoices: { [mainLink.id]: 'detach' } }, policy), policy, true)).record;
    const on = conditionalPackageAnswers(record); on.values.include = true; on.values.subject = 'Replacement shared answer';
    const plan = await prepareConditionalPackage({ template: source, answers: on, record }, policy);
    expect(plan.issues).toEqual([]);
    record = (await applyPreparedConditionalPackage(plan, policy, true)).record;
    const final = getPackageRevision(record);
    expect(final.members[1]).toEqual(extra);
    expect(final.bindings!.items.some(binding => binding.memberId === extra.id)).toBe(false);
    expect(final.templateState!.instances.find(instance => instance.memberId === extra.id)!.targets![0].initialized).toBe(true);
    const secondRemoval = conditionalPackageAnswers(record); secondRemoval.values.include = false;
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: secondRemoval, record }, policy), policy, true)).record;
    const secondReturn = conditionalPackageAnswers(record); secondReturn.values.include = true; secondReturn.values.subject = 'Changed after another removal';
    const secondPlan = await prepareConditionalPackage({ template: source, answers: secondReturn, record }, policy);
    expect(secondPlan.issues).toEqual([]);
    const secondFinal = getPackageRevision((await applyPreparedConditionalPackage(secondPlan, policy, true)).record);
    expect(secondFinal.members[1]).toEqual(extra);
    expect(secondFinal.bindings!.items.some(binding => binding.memberId === extra.id)).toBe(false);
  });

  it.each(['apply-package', 'keep-local', 'detach'] as const)('reconciles a reserved historical field after repeated restore cycles with %s', async choice => {
    const source = template(); source.program.questions[0].required = false;
    let record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: answers(true) }, policy), policy, true)).record;
    const original = getPackageRevision(record), extra = original.members[1], key = packageTemplateInstanceKey('extra');
    const off = conditionalPackageAnswers(record); off.values.include = false;
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: off, record }, policy), policy, true)).record;
    const cleared = conditionalPackageAnswers(record); delete cleared.values.subject;
    const mainLink = getPackageRevision(record).bindings!.items[0];
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: cleared, record,
      fieldChoices: { [mainLink.id]: 'detach' } }, policy), policy, true)).record;
    const firstRestore = conditionalPackageAnswers(record); firstRestore.values.include = true;
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: firstRestore, record }, policy), policy, true)).record;
    expect(getPackageRevision(record).members[1]).toEqual(extra);
    expect(getPackageRevision(record).bindings!.items).toEqual([]);
    expect(getPackageRevision(record).templateState!.instances.find(instance => instance.key === key)!.targets![0].initialized).toBe(false);
    const secondRemoval = conditionalPackageAnswers(record); secondRemoval.values.include = false;
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: secondRemoval, record }, policy), policy, true)).record;
    const refill = conditionalPackageAnswers(record); refill.values.subject = 'Refilled after two restorations'; refill.values.include = true;
    const preview = await prepareConditionalPackage({ template: source, answers: refill, record }, policy);
    expect(preview.ready).toBe(false);
    const conflict = preview.fieldChanges.find(change => change.memberId === extra.id)!;
    expect(conflict).toMatchObject({ state: 'conflict', before: 'Training request', after: 'Refilled after two restorations' });
    expect((await listActionPackages()).find(saved => saved.id === record.id)).toEqual(record);
    const accepted = await prepareConditionalPackage({ template: source, answers: refill, record,
      fieldChoices: { [conflict.bindingId]: choice } }, policy);
    expect(accepted.issues).toEqual([]);
    const applied = (await applyPreparedConditionalPackage(accepted, policy, true)).record, final = getPackageRevision(applied);
    const restored = final.members.find(member => member.id === extra.id)!;
    expect(restored.kind === 'native' && restored.session.formData.subject).toBe(choice === 'apply-package' ? 'Refilled after two restorations' : 'Training request');
    const binding = final.bindings!.items.find(binding => binding.memberId === extra.id);
    if (choice === 'detach') expect(binding).toBeUndefined();
    else expect(binding?.mode).toBe(choice === 'keep-local' ? 'override' : 'linked');
    expect(final.templateState!.instances.find(instance => instance.key === key)!.targets![0].initialized).toBe(true);
    expect(applied.revisions.slice(0, -1)).toEqual(record.revisions);
    expect(getPackageRevision((await parsePortableActionPackage(await buildPortableActionPackage(applied))).record)).toEqual(final);
  });

  it('preserves a local historical field override when reconnecting to a replacement fact', async () => {
    const source = template(); source.program.questions[0].required = false;
    let record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: answers(true) }, policy), policy, true)).record;
    const original = getPackageRevision(record), extra = original.members[1]; if (extra.kind !== 'native') throw new Error('Expected native');
    const session = structuredClone(extra.session); session.formData.subject = 'Local historical subject';
    const edited = await capturePackageMember(captureDocumentRevision({ documentId: 'local-extra', epoch: 0, editSequence: 1, capturedAt: 1 },
      { ...session, endItems: [], publicationTables: {} }), extra.label, extra.role, extra);
    record = await reviseActionPackage(record, [original.members[0], edited]);
    const off = conditionalPackageAnswers(record); off.values.include = false;
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: off, record,
      memberChoices: { [packageTemplateInstanceKey('extra')]: 'remove' } }, policy), policy, true)).record;
    const cleared = conditionalPackageAnswers(record); delete cleared.values.subject;
    const mainLink = getPackageRevision(record).bindings!.items[0];
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: cleared, record,
      fieldChoices: { [mainLink.id]: 'detach' } }, policy), policy, true)).record;
    const on = conditionalPackageAnswers(record); on.values.include = true; on.values.subject = 'Replacement shared subject';
    const plan = await prepareConditionalPackage({ template: source, answers: on, record,
      memberChoices: { [packageTemplateInstanceKey('extra')]: 'restore' } }, policy);
    expect(plan.issues).toEqual([]);
    const final = getPackageRevision((await applyPreparedConditionalPackage(plan, policy, true)).record);
    expect(final.members[1]).toEqual(edited);
    const link = final.bindings!.items.find(binding => binding.memberId === extra.id)!;
    expect(link.mode).toBe('override'); expect(link.expectedValue).toBe('Local historical subject');
    expect(link.id).not.toBe(original.bindings!.items.find(binding => binding.memberId === extra.id)!.id);
    expect(final.templateState!.instances.find(instance => instance.memberId === extra.id)!.targets![0].linkId).toBe(link.id);
  });

  it('restores historical locally edited content and preserves original evidence bytes', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.create(); pdf.addPage([612, 792]); pdf.setTitle('Exact reviewed evidence');
    const data = new Uint8Array(await pdf.save()).buffer, source = template();
    source.members.push({ key: 'evidence', kind: 'attachment', label: 'Evidence', role: 'enclosure', required: false,
      when: { op: 'equals', questionId: 'include', value: true } });
    let record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: answers(true),
      attachments: { [packageTemplateInstanceKey('evidence')]: { name: 'evidence.pdf', signedOriginal: true, data } } }, policy), policy, true)).record;
    const initial = getPackageRevision(record), extra = initial.members[1];
    if (extra.kind !== 'native') throw new Error('Expected extra');
    const session = structuredClone(extra.session); session.paragraphs[0].text = 'Local draft correction must survive.';
    const edited = await capturePackageMember(captureDocumentRevision({ documentId: 'local-extra', epoch: 0, editSequence: 1, capturedAt: 1 },
      { ...session, endItems: [], publicationTables: {} }), extra.label, extra.role, extra);
    record = await reviseActionPackage(record, [initial.members[0], edited, initial.members[2]]);
    const off = conditionalPackageAnswers(record); off.values.include = false;
    record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: off, record, memberChoices: {
      [packageTemplateInstanceKey('extra')]: 'remove', [packageTemplateInstanceKey('evidence')]: 'remove' } }, policy), policy, true)).record;
    const on = conditionalPackageAnswers(record); on.values.include = true;
    const plan = await prepareConditionalPackage({ template: source, answers: on, record, memberChoices: {
      [packageTemplateInstanceKey('extra')]: 'restore', [packageTemplateInstanceKey('evidence')]: 'restore' } }, policy);
    expect(plan.issues).toEqual([]);
    const final = getPackageRevision((await applyPreparedConditionalPackage(plan, policy, true)).record);
    expect(final.members[1]).toEqual(edited); expect(final.members[2]).toEqual(initial.members[2]);
    if (final.members[2].kind !== 'original') throw new Error('Expected original');
    expect(await readPackageAsset(final.members[2].original)).toEqual(data);
  });

  it('links an initially unanswered optional field when an answer is supplied later', async () => {
    const source = template(); source.program.questions[0].required = false;
    const input = answers(); delete input.values.subject;
    const initial = await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: input }, policy), policy, true);
    expect(getPackageRevision(initial.record).bindings!.items).toHaveLength(0);
    const later = conditionalPackageAnswers(initial.record); later.values.subject = 'Supplied later';
    const plan = await prepareConditionalPackage({ template: source, answers: later, record: initial.record }, policy);
    expect(plan.ready).toBe(true); expect(plan.fieldChanges[0].state).toBe('update');
    const applied = await applyPreparedConditionalPackage(plan, policy, true), member = getPackageRevision(applied.record).members[0];
    expect(member.kind === 'native' && member.session.formData.subject).toBe('Supplied later');
    expect(getPackageRevision(applied.record).bindings!.items).toHaveLength(1);
  });
  it('remaps reserved optional row targets to fresh identities and follows the row after an independent reorder', async () => {
    const source = template(), genericForm = fixtureInstance(), page = await fixturePage();
    genericForm.answers = {}; genericForm.rows.roster = [{ id: 'first', answers: {} }, { id: 'second', answers: {} }];
    genericForm.definition.pages[0].sha256 = page.sha256;
    const session = { ...createBlankSession(), documentCategory: 'forms' as const, formType: 'fixture', genericForm, formData: {}, paragraphs: [] };
    const fields = await listPackageBindingFields({ kind: 'native', id: 'blueprint', revisionId: 'blueprint', label: 'Worksheet', role: 'basic-letter', required: true, session,
      draft: { id: 'draft', name: 'draft', type: 'application/json', size: 1, sha256: '0'.repeat(64) } });
    source.program.questions = [{ id: 'date', label: 'Start date', kind: 'date', required: false }]; source.program.participantGroups = [];
    source.members = [{ key: 'main', kind: 'native', label: 'Worksheet', role: 'basic-letter', required: true,
      draft: { ...session, timestamp: 0, kind: 'dondocs-draft', version: 2, documentKind: 'configured-form' },
      pages: { 'page1.pdf': { name: 'page1.pdf', type: 'application/pdf', data: uint8ArrayToBase64(page.bytes) } },
      links: [{ questionId: 'date', target: fields.find(field => field.target.kind === 'configured-form' && field.target.fieldId === 'date' && field.target.row?.rowId === 'first')!.target, format: 'field' }] }];
    let record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: { version: 1, values: {}, groups: {} } }, policy), policy, true)).record;
    const member = getPackageRevision(record).members[0]; if (member.kind !== 'native') throw new Error('Expected worksheet');
    const captured = getPackageRevision(record).templateState!.source;
    expect(captured.resources?.pdfs).toEqual([member.templates!['page1.pdf']]);
    const json = await buildPortableActionPackage(record);
    expect(JSON.parse(json).portableResources.entries.filter((entry: { sha256: string }) => entry.sha256 === page.sha256)).toHaveLength(1);
    await clearDb();
    record = await importPortableActionPackage(json);
    expect(await readConditionalPackageTemplate(record)).toEqual(source);
    await retainPackageMemberTemplates(member, readPackageAsset);
    const firstId = member.session.genericForm!.rows.roster[0].id; expect(firstId).not.toBe('first');
    const edited = structuredClone((await readPackageMemberDraft(member)).reviewed.session); edited.genericForm!.rows.roster.reverse();
    const changed = await capturePackageMember(captureDocumentRevision({ documentId: 'row-edit', epoch: 0, editSequence: 1, capturedAt: 100 },
      { ...edited, endItems: edited.endItems ?? [], publicationTables: edited.publicationTables ?? {} }), member.label, member.role, member);
    record = await reviseActionPackage(record, [changed]);
    const input = conditionalPackageAnswers(record); input.values.date = '2028-02-29';
    const plan = await prepareConditionalPackage({ template: source, answers: input, record }, policy); expect(plan.ready).toBe(true);
    const result = getPackageRevision((await applyPreparedConditionalPackage(plan, policy, true)).record).members[0];
    if (result.kind !== 'native') throw new Error('Expected worksheet');
    expect(result.session.genericForm!.rows.roster.map(row => row.id)).toEqual([member.session.genericForm!.rows.roster[1].id, firstId]);
    expect(result.session.genericForm!.rows.roster[1].answers.date).toBe('2028-02-29');
    expect(result.session.genericForm!.rows.roster[0].answers.date).toBeUndefined();
  });
  it('expands contiguous repeated variants in person order while preserving stable identity keys', async () => {
    const source = template(), repeated = source.members[2];
    source.members.push({ ...structuredClone(repeated), key: 'person_cost', label: 'Person cost worksheet' });
    const input = answers(); input.groups.people = [{ id: 'alex', label: 'Same name', answers: { person: 'Alex' } }, { id: 'blair', label: 'Same name', answers: { person: 'Blair' } }];
    const initial = await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: input }, policy), policy, true);
    const before = getPackageRevision(initial.record), titles = before.members.map(member => member.label);
    expect(new Set(titles).size).toBe(titles.length);
    expect(before.templateState!.instances.filter(instance => instance.condition && instance.participantId).map(instance => instance.participantId)).toEqual(['alex', 'alex', 'blair', 'blair']);
    input.groups.people.reverse();
    const reordered = await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: input, record: initial.record }, policy), policy, true);
    expect(getPackageRevision(reordered.record).members.map(member => member.id)).toEqual([before.members[0].id, before.members[3].id, before.members[4].id, before.members[1].id, before.members[2].id]);
  });
  it('does not publish duplicate revisions for an unchanged applied intake', async () => {
    const record = await create();
    const plan = await prepareConditionalPackage({ template: template(), answers: conditionalPackageAnswers(record), record }, policy);
    expect(plan.changed).toBe(false);
    await expect(applyPreparedConditionalPackage(plan, policy, true)).rejects.toThrow(/Resolve and review/);
  });
  it('reinstates clean conditional documents automatically when their branch becomes active again', async () => {
    const first = await create(true), initial = getPackageRevision(first), off = conditionalPackageAnswers(first); off.values.include = false;
    const second = await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: template(), answers: off, record: first }, policy), policy, true);
    expect(getPackageRevision(second.record).members).toHaveLength(1);
    const on = conditionalPackageAnswers(second.record); on.values.include = true;
    const plan = await prepareConditionalPackage({ template: template(), answers: on, record: second.record }, policy);
    expect(plan.ready).toBe(true);
    const third = await applyPreparedConditionalPackage(plan, policy, true);
    expect(getPackageRevision(third.record).members[1].id).toBe(initial.members[1].id);
  });
  it('keeps an explicitly cleared hidden answer empty after its document link is detached', async () => {
    const source = template(); source.program.questions[0].when = { op: 'equals', questionId: 'include', value: true };
    const initial = await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: answers(true) }, policy), policy, true);
    const input = conditionalPackageAnswers(initial.record); input.values.include = false; delete input.values.subject;
    const main = getPackageRevision(initial.record).members[0], binding = getPackageRevision(initial.record).bindings!.items.find(binding => binding.memberId === main.id)!;
    const plan = await prepareConditionalPackage({ template: source, answers: input, record: initial.record, fieldChoices: { [binding.id]: 'detach' } }, policy);
    expect(plan.ready).toBe(true);
    const applied = await applyPreparedConditionalPackage(plan, policy, true);
    expect(conditionalPackageAnswers(applied.record).values.subject).toBeUndefined();
  });
  it('shows one inactive-field decision with its actual independently edited value', async () => {
    const source = template(); source.program.questions[0].when = { op: 'equals', questionId: 'include', value: true };
    let record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: answers(true) }, policy), policy, true)).record;
    const current = getPackageRevision(record), main = current.members[0]; if (main.kind !== 'native') throw new Error('Expected native');
    const snapshot = { ...main.session, formData: { ...main.session.formData, subject: 'Independent correction' }, endItems: [], publicationTables: {} };
    const edited = await capturePackageMember(captureDocumentRevision({ documentId: 'edit', epoch: 0, editSequence: 1, capturedAt: 100 }, snapshot), main.label, main.role, main);
    record = await reviseActionPackage(record, [edited, ...current.members.slice(1)]);
    const input = conditionalPackageAnswers(record); input.values.include = false;
    const plan = await prepareConditionalPackage({ template: source, answers: input, record }, policy);
    const binding = getPackageRevision(record).bindings!.items.find(binding => binding.memberId === main.id)!;
    const decisions = plan.fieldChanges.filter(change => change.bindingId === binding.id);
    expect(plan.ready).toBe(false); expect(decisions).toHaveLength(1);
    expect(decisions[0].before).toBe('Independent correction'); expect(decisions[0].label).toMatch(/Subject/);
    expect(decisions[0].choices).toEqual(['keep-local', 'detach']);
  });
  it('preserves independently corrected person labels when unchanged intake labels are reapplied', async () => {
    let record = await create(false, ['alex']);
    const before = getPackageRevision(record), input = structuredClone(before.templateState!.answers), information = structuredClone(before.information!);
    information.participants[0].label = 'Corrected person label'; record = await updatePackageInformation(record, information);
    input.values.include = true;
    const plan = await prepareConditionalPackage({ template: template(), answers: input, record }, policy);
    expect(plan.ready).toBe(true); expect(plan.answerChanges.some(change => change.state === 'kept-current' && change.requested === 'alex')).toBe(true);
    const applied = await applyPreparedConditionalPackage(plan, policy, true);
    expect(getPackageRevision(applied.record).information!.participants[0].label).toBe('Corrected person label');
  });
  it('does not resurrect an explicitly cleared optional answer when intake resumes', async () => {
    const source = template(); source.program.questions.find(question => question.id === 'subject')!.required = false;
    const initial = await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: answers() }, policy), policy, true);
    const cleared = conditionalPackageAnswers(initial.record);delete cleared.values.subject;
    const conflict = await prepareConditionalPackage({ template: source, answers: cleared, record: initial.record }, policy);
    expect(conflict.ready).toBe(false);
    const link = getPackageRevision(initial.record).bindings!.items[0];
    const plan = await prepareConditionalPackage({ template: source, answers: cleared, record: initial.record, fieldChoices: { [link.id]: 'detach' } }, policy);
    expect(plan.ready).toBe(true);
    const applied = await applyPreparedConditionalPackage(plan, policy, true);
    expect(conditionalPackageAnswers(applied.record).values.subject).toBeUndefined();
  });
  it('rejects an applied state that omits a required instance from its exact pinned template', async () => {
    const source = template();source.members[1].required = true;
    const { record } = await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: answers(true) }, policy), policy, true);
    const forged = structuredClone(record), revision = forged.revisions.at(-1)!;
    const id = revision.templateState!.instances.find(instance => instance.memberKey === 'extra')!.memberId;
    revision.templateState!.instances = revision.templateState!.instances.filter(instance => instance.memberId !== id);
    revision.members = revision.members.filter(member => member.id !== id);
    revision.bindings!.items = revision.bindings!.items.filter(binding => binding.memberId !== id);
    const { validateConditionalPackageStates } = await import('@/lib/packageConditionalSources');
    const { readPackageAsset } = await import('@/lib/actionPackageAssets');
    await expect(validateConditionalPackageStates(forged, readPackageAsset)).rejects.toThrow(/instance|required|mapping|missing/i);
  });
  it('rejects transfer that drops native target declarations together with its generation marker', async () => {
    const source = template(); source.program.questions[0].required = false;
    const input = answers(); delete input.values.subject;
    const { record } = await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: input }, policy), policy, true);
    const envelope = JSON.parse(await buildPortableActionPackage(record));
    envelope.package.id = crypto.randomUUID();
    const instance = envelope.package.revisions[0].templateState.instances[0];
    expect(instance.targets).toHaveLength(1);
    delete instance.targets; delete instance.generatedDigest;
    await expect(importPortableActionPackage(JSON.stringify(envelope))).rejects.toThrow(/native field declarations/);
  });
  it('rejects duplicate reserved link identities across captured documents before optional answers are supplied', async () => {
    const source = template(); source.program.questions[0].required = false;
    const input = answers(true); delete input.values.subject;
    const { record } = await applyPreparedConditionalPackage(await prepareConditionalPackage({ template: source, answers: input }, policy), policy, true);
    const envelope = JSON.parse(await buildPortableActionPackage(record)); envelope.package.id = crypto.randomUUID();
    const instances = envelope.package.revisions[0].templateState.instances;
    instances[1].targets[0].linkId = instances[0].targets[0].linkId;
    await expect(importPortableActionPackage(JSON.stringify(envelope))).rejects.toThrow(/Duplicate conditional field link identity/);
  });
  it('owns caller evidence bytes and names before asynchronous PDF inspection', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const { portableResourceDigest } = await import('@/lib/portableResources');
    const { extractPdfText } = await import('@/lib/pdfText');
    const { readPackageAsset } = await import('@/lib/actionPackageAssets');
    const pdf = await PDFDocument.create();pdf.addPage([612,792]);pdf.setTitle('Reviewed original');const original = new Uint8Array(await pdf.save()).buffer;
    const replacement = await PDFDocument.create();replacement.addPage([612,792]);replacement.setTitle('Unreviewed replacement');const changed = new Uint8Array(await replacement.save()).buffer;
    const source = template();source.members.push({ key: 'evidence', kind: 'attachment', label: 'Evidence', role: 'enclosure', required: true });
    const file = { name: 'reviewed.pdf', data: original, signedOriginal: false };
    vi.mocked(extractPdfText).mockImplementationOnce(async inspected => {
      expect(await portableResourceDigest(inspected instanceof Uint8Array ? new Uint8Array(inspected).buffer : inspected)).toBe(await portableResourceDigest(original));
      file.data = changed;file.name = 'replacement.pdf';return 'Synthetic reviewed evidence';
    });
    const plan = await prepareConditionalPackage({ template: source, answers: answers(), attachments: { [packageTemplateInstanceKey('evidence')]: file } }, policy);
    const { record } = await applyPreparedConditionalPackage(plan, policy, true);
    const member = getPackageRevision(record).members.find(member => member.kind === 'original')!;
    if(member.kind !== 'original')throw new Error('Expected evidence');
    expect.soft(member.original.name).toBe('reviewed.pdf');
    expect.soft(await portableResourceDigest(await readPackageAsset(member.original))).toBe(await portableResourceDigest(original));
  });
  it('owns intake answers synchronously before validating the source asynchronously', async () => {
    const input = answers(), pending = prepareConditionalPackage({ template: template(), answers: input }, policy);
    input.values.subject = 'Changed by caller before first await completed';
    const { record } = await applyPreparedConditionalPackage(await pending, policy, true);
    expect(getPackageRevision(record).templateState?.answers.values.subject).toBe('Training request');
  });
  it('undoes a package name changed by its own rename-only plan', async () => {
    const record = await create(), plan = await prepareConditionalPackage({ template: template(), answers: conditionalPackageAnswers(record), record, name: 'Renamed by intake' }, policy);
    const applied = await applyPreparedConditionalPackage(plan, policy, true);expect(applied.record.name).toBe('Renamed by intake');
    const undone = await undoConditionalPackage(applied.undo!, policy);
    expect(undone.name).toBe(record.name);
  });
});

it('uses an exact saved PDF in another recipe slot and checks its active completion rules before applying', async () => {
  // Use the installed worker when reading real PDF fields outside the browser.
  await import('@/components/pdf/pdfConfig');
  const { pdfjs } = await import('react-pdf');
  const worker = pdfjs.GlobalWorkerOptions.workerSrc;
  pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/build/pdf.worker.mjs');
  onTestFinished(() => { pdfjs.GlobalWorkerOptions.workerSrc = worker; });
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create(); pdf.addPage();
  const file = { name: 'original.pdf', signedOriginal: true, data: new Uint8Array(await pdf.save()).buffer };
  const recipe = template();
  recipe.members.push({ key: 'a', kind: 'attachment', role: 'enclosure', required: true, label: 'Source' },
    { key: 'b', kind: 'attachment', role: 'enclosure', required: true, label: 'Return' },
    { key: 'c', kind: 'attachment', role: 'enclosure', required: true, label: 'Verified return', completion: { signatureFields: ['Official signature'] } },
    { key: 'd', kind: 'attachment', role: 'enclosure', required: true, label: 'Completed return', completion: { requiredPdfFields: ['ApplicationDate'] } },
    { key: 'e', kind: 'attachment', role: 'enclosure', required: true, label: 'Official return', completion: { expectedForm: { id: 'navmc_118_11', edition: 'test-edition' } } });
  const run = { template: recipe, answers: answers() };
  const first = await prepareConditionalPackage({ ...run, attachments: { [packageTemplateInstanceKey('a')]: file } }, policy);
  const record = (await applyPreparedConditionalPackage(first, policy, true)).record;
  const source = getPackageRevision(record).members.find(member => member.label === 'Source')!;
  if (source.kind !== 'original') throw new Error('Expected original');
  const reuse = { name: source.label, reuse: { memberId: source.id, revisionId: source.revisionId } };
  await expect(prepareConditionalPackage({ ...run, record, attachments: { [packageTemplateInstanceKey('c')]: reuse } }, policy)).rejects.toThrow('Sign or verify');
  await expect(prepareConditionalPackage({ ...run, record, attachments: { [packageTemplateInstanceKey('d')]: reuse } }, policy)).rejects.toThrow('ApplicationDate');
  await expect(prepareConditionalPackage({ ...run, record, attachments: { [packageTemplateInstanceKey('e')]: reuse } }, policy)).rejects.toThrow('form and edition');
  const preview = await prepareConditionalPackage({ ...run, record, attachments: { [packageTemplateInstanceKey('b')]: reuse } }, policy);
  const updated = (await applyPreparedConditionalPackage(preview, policy, true)).record;
  const restored = await parsePortableActionPackage(await buildPortableActionPackage(updated));
  const received = getPackageRevision(restored.record).members.find(member => member.label === 'Return')!;
  expect(received).toMatchObject({ kind: 'original', signedOriginal: true, original: source.original });
  expect(received.id).not.toBe(source.id);
  expect(restored.resources.get('assets/' + source.original.id)?.data).toEqual(file.data);
});

it('captures a returned original against its saved slot without finishing unrelated intake', async () => {
  const { readFile } = await import('node:fs/promises');
  const { attachPackageSlotFiles } = await import('@/lib/packageSlotFiles');
  const { startConditionalPackage } = await import('@/lib/packageConditional');
  const { portableResourceDigest } = await import('@/lib/portableResources');
  const source = template();
  const file = async (name: string) => new File([new Uint8Array(await readFile('tests/fixtures/permission-pdfs/' + name))], name, { type: 'application/pdf' });
  const blank = await file('source.pdf');
  source.members.push({ key: 'returned', kind: 'attachment', label: 'Returned form', required: true, role: 'enclosure',
    completion: { blankSha256: await portableResourceDigest(await blank.arrayBuffer()) } });
  const initial = await startConditionalPackage(source, policy, undefined, () => true);
  const revision = getPackageRevision(initial);
  const slot = revision.templateState!.instances.find(item => item.memberKey === 'returned')!;
  await expect(attachPackageSlotFiles(initial, revision.id, slot.memberId, [blank], false)).rejects.toThrow('blank form');
  const key = packageTemplateInstanceKey('returned');
  await expect(prepareConditionalPackage({ template: source, answers: answers(),
    attachments: { [key]: { name: blank.name, data: await blank.arrayBuffer(), signedOriginal: false } } }, policy)).rejects.toThrow('blank form');
  const original = await file('source-cropped.pdf');
  const next = await attachPackageSlotFiles(initial, revision.id, slot.memberId, [original], true);
  const member = getPackageRevision(next).members.find(item => item.id === slot.memberId);
  expect(member).toMatchObject({ kind: 'original', signedOriginal: true, original: { name: original.name } });
  const { replacePackagePdf } = await import('@/lib/packageMemberHistory');
  await expect(replacePackagePdf(next, member!, blank, false)).rejects.toThrow('blank form');
  expect(getPackageRevision(next).templateState?.pending).toBe(true);
  await expect(attachPackageSlotFiles(next, revision.id, slot.memberId, [original], false)).rejects.toThrow('current editable');
});

it('appends independent evidence PDFs, transfers both originals and keeps the slot when its first file is removed', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = template();
  const key = packageTemplateInstanceKey('receipts');
  source.members.push({ key: 'receipts', kind: 'attachment', label: 'Receipts', required: true, role: 'enclosure', multipleFiles: true });
  const receipt = async (name: string) => ({ name, data: new Uint8Array(await readFile('tests/fixtures/permission-pdfs/' + name)).buffer, signedOriginal: false });
  const first = await receipt('source.pdf'), second = await receipt('source-cropped.pdf');
  const initial = await prepareConditionalPackage({ template: source, answers: answers(), attachments: { [key]: first } }, policy);
  let { record } = await applyPreparedConditionalPackage(initial, policy, true);
  const plan = await prepareConditionalPackage({ template: source, answers: answers(), record, attachments: { [key + '/second']: second } }, policy);
  record = (await applyPreparedConditionalPackage(plan, policy, true)).record;
  const restored = await parsePortableActionPackage(await buildPortableActionPackage(record));
  const members = getPackageRevision(restored.record).members;
  expect(members.slice(-2).map(item => item.kind === 'original' && item.original.name)).toEqual([first.name, second.name]);
  const promoted = await reviseActionPackage(record, members.filter(member => member.id !== members.at(-2)!.id));
  expect(getPackageRevision(promoted).templateState!.instances.find(item => item.key === key)?.memberId).toBe(members.at(-1)!.id);
});

it('reviews a replacement in intake and preserves the previous signed evidence revision', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = template();
  const key = packageTemplateInstanceKey('return');
  source.members.push({ key: 'return', kind: 'attachment', label: 'Returned PDF', required: true, role: 'enclosure' });
  const original = async (name: string, signedOriginal: boolean) => ({
    name, signedOriginal, data: new Uint8Array(await readFile('tests/fixtures/permission-pdfs/' + name)).buffer,
  });
  const first = await original('source.pdf', true);
  const second = await original('source-cropped.pdf', false);
  const initial = await prepareConditionalPackage({ template: source, answers: answers(), attachments: { [key]: first } }, policy);
  const { record } = await applyPreparedConditionalPackage(initial, policy, true);
  const previous = getPackageRevision(record).members.at(-1)!;
  const plan = await prepareConditionalPackage({ template: source, answers: answers(), record, attachments: { [key]: second } }, policy);
  expect(plan.changes.find(change => change.key === key)).toMatchObject({ state: 'replace', memberId: previous.id, message: expect.stringContaining(first.name + ' with ' + second.name) });
  const next = (await applyPreparedConditionalPackage(plan, policy, true)).record;
  expect(getPackageRevision(next).members.at(-1)).toMatchObject({ id: previous.id, signedOriginal: false, original: { name: second.name } });
  expect(getPackageRevision(next, record.currentRevisionId).members.at(-1)).toMatchObject({ id: previous.id, signedOriginal: true, original: { name: first.name } });
});

it('delivers declared slots in recipe order and keeps missing slots and confirmations in scope', async () => {
  const { readDeliveryChoices } = await import('@/lib/packageDeliveryChoices');
  const { preparePackageDelivery } = await import('@/lib/packageDelivery');
  const { assertDeliveryRequirements } = await import('@/lib/packageRequirements');
  const spec = template();
  spec.program.requirements.push({ id: 'checked', kind: 'confirmation', label: 'Check the enclosure', operations: ['pdf'] });
  spec.members.push({ key: 'evidence', kind: 'attachment', label: 'Evidence', role: 'supporting-document', required: true, multipleFiles: true });
  spec.deliveryChoices = [{ id: 'file', label: 'File' }, { id: 'forward', label: 'Forward', memberKeys: ['extra', 'evidence', 'main'],
    confirmationIds: ['checked'], when: { op: 'equals', questionId: 'include', value: true } }];
  const record = await saveConditionalPackageDraft({ template: spec, answers: answers(true), name: 'Training' }, policy);
  const bytes = (await fixturePage()).bytes;
  const key = packageTemplateInstanceKey('evidence');
  const plan = await prepareConditionalPackage({ template: spec, answers: answers(true), record, attachments: {
    [key]: { name: 'first.pdf', data: new Uint8Array(bytes).buffer, signedOriginal: false },
    [key + '/second']: { name: 'second.pdf', data: new Uint8Array(bytes).buffer, signedOriginal: false },
  } }, policy);
  const applied = await applyPreparedConditionalPackage(plan, policy, true);
  const revision = getPackageRevision(applied.record);
  const [file, forward] = await readDeliveryChoices(revision);
  expect(file.memberIds).toEqual(revision.members.map(member => member.id));
  expect(forward.memberIds.map(id => revision.members.find(member => member.id === id)?.label)).toEqual(['Conditional document', 'Evidence', 'second.pdf', 'Main document']);
  await expect(preparePackageDelivery(applied.record, revision.id, { choiceId: 'forward', scope: 'selected', label: 'Forward', purpose: 'recipient', memberIds: file.memberIds }, policy)).rejects.toThrow('Review this delivery choice');
  await expect(assertDeliveryRequirements(revision, forward.memberIds, undefined, forward)).rejects.toMatchObject({
    findings: expect.arrayContaining([expect.objectContaining({ label: 'Check the enclosure' })]),
  });
});
