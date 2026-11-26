import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, readPackageMemberDraft } from '@/lib/actionPackageAssets';
import { commitActionPackage, createActionPackage, getPackageRevision, listActionPackages, newPackageId,
  reviseActionPackage, type ActionPackage } from '@/lib/actionPackages';
import { idbGetAllAttachments } from '@/lib/documentsDb';
import { changeDocumentOverride, preparePackageUpdate, applyPreparedPackageUpdate, undoPackageUpdate } from '@/lib/packageUpdates';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { useUIStore } from '@/stores/uiStore';
import * as classification from '@/config/classification';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { uint8ArrayToBase64 } from '@/lib/encoding';
import { instantiatePackageTemplate, validatePackageTemplate } from '@/lib/packageTemplateLibrary';
import { listPackageBindingFields } from '@/lib/packageBindingTargets';
import { initializePackageCitationTargets, linkPackageCitation, packageCitationOccurrences, resolvePackageCitations } from '@/lib/packageCitations';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { buildPackageReviewerCopy, packageReviewTransferFile, parsePackageReviewTransfer } from '@/lib/packageReviewTransfer';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
const differentPolicy = resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } });
const target = { kind: 'correspondence' as const, docType: 'naval_letter' as const, field: 'subject' as const };

async function clearDb() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...db.objectStoreNames], 'readwrite');
    for (const name of db.objectStoreNames) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }); db.close();
}
async function fixture(count = 1, local = 'Original subject', mode: 'linked' | 'override' = 'linked', citations = false) {
  const members = [];
  for (let index = 0; index < count; index++) {
    const value = createBlankSession();
    value.formData = { ...value.formData, subject: local, unitLine1: 'FICTIONAL TRAINING UNIT', from: 'Training Office', to: 'Training Officer', sigLast: 'Example', classLevel: 'unclassified' };
    value.paragraphs = [{ id: 'body', text: 'Retain this exact paragraph and identity.', level: 0 }];
    if (citations) {
      value.references = [{ letter: 'a', title: 'Training reference' }];
      value.paragraphs[0].text = 'Follow reference (a).';
    }
    members.push(await capturePackageMember(captureDocumentRevision({ documentId: `source_${index}`, epoch: 0, editSequence: 1, capturedAt: 100 },
      { ...value, endItems: [], publicationTables: {} }), `Training letter ${index + 1}`, 'basic-letter'));
  }
  const record = await reviseActionPackage(await createActionPackage('Training action'), members);
  const original = getPackageRevision(record);
  const revision = { ...original, id: newPackageId('revision'), parentId: original.id,
    information: { version: 1 as const, participants: [], facts: [{ id: 'subject', label: 'Subject', kind: 'text' as const, value: 'Original subject', source: { kind: 'entered' as const } }] },
    bindings: { version: 1 as const, items: members.map((member, index) => ({ id: `link_${index}`, factId: 'subject', memberId: member.id, target, mode, expectedValue: 'Original subject', format: 'field' as const })) } };
  return commitActionPackage(record, { ...record, sequence: record.sequence + 1, currentRevisionId: revision.id, revisions: [...record.revisions, revision] });
}
function inputs(record: ActionPackage, value = 'Updated subject') {
  const revision = getPackageRevision(record), information = structuredClone(revision.information!);
  information.facts[0].value = value;
  return { information, bindings: revision.bindings! };
}
async function prepare(record: ActionPackage, value = 'Updated subject', choices = {}) {
  const { information, bindings } = inputs(record, value);
  return preparePackageUpdate(record, information, bindings, choices, policy);
}
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy);
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  await createActionPackage('Initialize'); await clearDb(); useUIStore.setState({ storageHealth: 'ok' });
});

describe('captured package update plans', () => {
  it('keeps and restores only the selected field without modifying either captured document', async () => {
    const original = await fixture(2, 'Local subject');
    const revision = getPackageRevision(original);
    const [selected, sibling] = revision.bindings!.items;
    const change = (record: ActionPackage, undo?: string) => changeDocumentOverride(
      record, selected.memberId, selected.id, undo, policy, new AbortController().signal, () => true);
    const kept = await change(original);
    const after = getPackageRevision(kept);
    expect(after.members).toEqual(revision.members);
    expect(after.information).toEqual(revision.information);
    expect(after.bindings!.items).toEqual([{ ...selected, mode: 'override', expectedValue: 'Local subject' }, sibling]);
    await expect(change(kept, revision.id)).rejects.toThrow(/package changed/i);
    expect(getPackageRevision(await change(kept, after.id)).bindings).toEqual(revision.bindings);
  });

  it('blocks updates in reviewer copies and preserves exact owner review baselines', async () => {
    const owner = await startPackageReview(await fixture());
    const copy = await parsePackageReviewTransfer(await packageReviewTransferFile(await buildPackageReviewerCopy(owner, owner.reviewRounds![0].id, policy), policy));
    const changes = inputs(copy.record);
    await expect(preparePackageUpdate(copy.record, changes.information, changes.bindings, {}, policy)).rejects.toThrow(/reviewer copy/);
    const { record } = await applyPreparedPackageUpdate(await prepare(owner), policy, true);
    expect(record.reviewRounds).toEqual(owner.reviewRounds);
    expect(record.reviewRounds![0].baseline.information!.facts[0].value).toBe('Original subject');
    expect(getPackageRevision(record).information!.facts[0].value).toBe('Updated subject');
  });

  it('previews without writes and applies all member fields as one immutable child revision', async () => {
    const original = await fixture(2), originalJson = JSON.stringify(original), assets = await idbGetAllAttachments();
    const args = inputs(original), planned = await preparePackageUpdate(original, args.information, args.bindings, {}, policy);
    args.information.facts[0].value = 'Caller mutation';
    expect(planned.ready).toBe(true); expect(planned.changed).toBe(true);
    expect(planned.changes.map(change => change.state)).toEqual(['update', 'update']);
    expect(await idbGetAllAttachments()).toEqual(assets); expect((await listActionPackages())[0]).toEqual(original);
    const { record } = await applyPreparedPackageUpdate(planned, policy, true);
    expect(record.sequence).toBe(original.sequence + 1); expect(record.revisions.slice(0, -1)).toEqual(original.revisions);
    expect(JSON.stringify(original)).toBe(originalJson);
    const revision = getPackageRevision(record);
    for (const member of revision.members) {
      expect(member.kind).toBe('native'); if (member.kind !== 'native') continue;
      const raw = await readPackageMemberDraft(member);
      expect(raw.reviewed.session.formData.subject).toBe('Updated subject');
      expect(raw.reviewed.session.formData.from).toBe('Training Office');
      expect(raw.reviewed.session.paragraphs).toEqual([{ id: 'body', text: 'Retain this exact paragraph and identity.', level: 0 }]);
    }
    expect(revision.bindings?.items.every(link => link.expectedValue === 'Updated subject')).toBe(true);
    const portable = await parsePortableActionPackage(await buildPortableActionPackage(record));
    expect(getPackageRevision(portable.record).information).toEqual(revision.information);
    expect(getPackageRevision(portable.record).bindings).toEqual(revision.bindings);
  });

  it.each(['keep-local', 'apply-package'] as const)('requires a decision for independent edits: %s', async choice => {
    const original = await fixture(1, 'Independently edited');
    const conflict = await prepare(original);
    expect(conflict.ready).toBe(false); expect(conflict.changes[0].state).toBe('conflict');
    await expect(applyPreparedPackageUpdate(conflict, policy, true)).rejects.toThrow(/Resolve and review/);
    const planned = await prepare(original, 'Updated subject', { link_0: choice });
    const { record } = await applyPreparedPackageUpdate(planned, policy, true);
    const revision = getPackageRevision(record), member = revision.members[0];
    if (member.kind !== 'native') throw new Error('Expected native member');
    expect(member.session.formData.subject).toBe(choice === 'keep-local' ? 'Independently edited' : 'Updated subject');
    expect(revision.bindings!.items[0].mode).toBe(choice === 'keep-local' ? 'override' : 'linked');
  });

  it('preserves explicit exceptions until reconnecting and detaches without rewriting a field', async () => {
    const original = await fixture(1, 'Local exception', 'override');
    const { record } = await applyPreparedPackageUpdate(await prepare(original), policy, true);
    expect(getPackageRevision(record).members).toEqual(getPackageRevision(original).members);
    expect(getPackageRevision(record).bindings!.items[0].expectedValue).toBe('Local exception');
    const connected = await applyPreparedPackageUpdate(await prepare(record, 'Updated subject', { link_0: 'reconnect' }), policy, true);
    expect(connected.record.revisions.at(-1)?.bindings!.items[0].mode).toBe('linked');
    const detached = await preparePackageUpdate(connected.record, undefined, undefined, {}, policy);
    expect(detached.changes[0].state).toBe('detach');
    const result = await applyPreparedPackageUpdate(detached, policy, true);
    expect(getPackageRevision(result.record).members).toEqual(getPackageRevision(connected.record).members);
    expect(getPackageRevision(result.record).information).toBeUndefined();
  });

  it('does not let an unrelated stale link block another fact or a label correction', async () => {
    const original = await fixture(1, 'Independently edited'), args = inputs(original, 'Original subject');
    args.information.facts[0].label = 'Corrected subject label';
    args.information.facts.push({ id: 'other', label: 'Other information', kind: 'text', value: 'New fact', source: { kind: 'entered' } });
    const planned = await preparePackageUpdate(original, args.information, args.bindings, {}, policy);
    expect(planned.ready).toBe(true);
    const { record } = await applyPreparedPackageUpdate(planned, policy, true);
    expect(getPackageRevision(record).members).toEqual(getPackageRevision(original).members);
    expect(getPackageRevision(record).bindings).toEqual(getPackageRevision(original).bindings);
  });

  it('cannot bypass a saved local override by changing proposed link metadata', async () => {
    const original = await fixture(1, 'Deliberate exception', 'override'), args = inputs(original);
    args.bindings.items[0].mode = 'linked';
    const planned = await preparePackageUpdate(original, args.information, args.bindings, {}, policy);
    expect(planned.changes[0].state).toBe('override');
    const { record } = await applyPreparedPackageUpdate(planned, policy, true);
    expect(getPackageRevision(record).members).toEqual(getPackageRevision(original).members);
    expect(getPackageRevision(record).bindings!.items[0].mode).toBe('override');
  });

  it('rejects forged previews, retargeted identities, fabricated expected values and unknown decisions', async () => {
    const original = await fixture(), planned = await prepare(original), args = inputs(original);
    await expect(applyPreparedPackageUpdate({ ...planned }, policy, true)).rejects.toThrow(/Prepare and review/);
    args.bindings.items[0].target = { ...target, field: 'from' };
    await expect(preparePackageUpdate(original, args.information, args.bindings, {}, policy)).rejects.toThrow(/link identity/);
    const other = inputs(original); other.bindings.items[0].expectedValue = 'Fabricated';
    await expect(preparePackageUpdate(original, other.information, other.bindings, {}, policy)).rejects.toThrow(/last-applied/);
    await expect(prepare(original, 'Updated', { unknown: 'detach' })).rejects.toThrow(/does not belong/);
    expect(Object.isFrozen(planned.changes[0])).toBe(true);
  });

  it('requires current policy and explicit review, and cannot publish a no-op', async () => {
    const original = await fixture(), planned = await prepare(original);
    await expect(applyPreparedPackageUpdate(planned, differentPolicy, true)).rejects.toThrow(/Prepare and review/);
    await expect(applyPreparedPackageUpdate(planned, policy, false)).rejects.toThrow(/Resolve and review/);
    const same = await prepare(original, 'Original subject'); expect(same.changed).toBe(false);
    await expect(applyPreparedPackageUpdate(same, policy, true)).rejects.toThrow(/Resolve and review/);
    const sensitive = await prepare(original, '123-45-6789'); expect(sensitive.reviews.some(review => review.privacy.found)).toBe(true);
    await expect(prepare(original, 'SECRET')).rejects.toThrow(/outside.*configured levels/);
    expect((await listActionPackages())[0]).toEqual(original);
  });

  it('refuses stale, invalidated and cancelled plans without installing staged bytes', async () => {
    const original = await fixture(), first = await prepare(original), second = await prepare(original, 'Second change');
    const assets = await idbGetAllAttachments(), controller = new AbortController(); controller.abort();
    await expect(applyPreparedPackageUpdate(first, policy, true, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(applyPreparedPackageUpdate(first, policy, true, undefined, () => false)).rejects.toThrow(/no longer current/);
    expect(await idbGetAllAttachments()).toEqual(assets);
    await applyPreparedPackageUpdate(second, policy, true);
    await expect(applyPreparedPackageUpdate(first, policy, true)).rejects.toThrow(/saved package changed/);
  });

  it('rolls back member assets together with a quota-aborted package transaction', async () => {
    const original = await fixture(2), planned = await prepare(original), assets = await idbGetAllAttachments();
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const result = put.apply(this, args); if (this.name === 'app') this.transaction.abort(); return result;
    });
    await expect(applyPreparedPackageUpdate(planned, policy, true)).rejects.toThrow(/could not be saved/); spy.mockRestore();
    expect(await idbGetAllAttachments()).toEqual(assets); expect((await listActionPackages())[0]).toEqual(original);
  });

  it('checks actual deployment policy again inside the final storage guard', async () => {
    const original = await fixture(), planned = await prepare(original), assets = await idbGetAllAttachments();
    let checks = 0;
    vi.mocked(classification.getExportDeploymentPolicySync).mockImplementation(() => ++checks > 2 ? differentPolicy : policy);
    await expect(applyPreparedPackageUpdate(planned, policy, true)).rejects.toThrow(/Deployment settings changed/);
    expect(checks).toBeGreaterThan(2);
    expect(await idbGetAllAttachments()).toEqual(assets); expect((await listActionPackages())[0]).toEqual(original);
  });

  it('undoes as a new revision and keeps saved history even if the returned record was mutated', async () => {
    const original = await fixture(), { record, undo } = await applyPreparedPackageUpdate(await prepare(original), policy, true);
    const history = structuredClone(record.revisions); record.name = 'Caller mutation';
    const restored = await undoPackageUpdate(undo, policy);
    expect(restored.revisions.slice(0, -1)).toEqual(history);
    const current = getPackageRevision(restored), before = getPackageRevision(original);
    expect(current.members).toEqual(before.members); expect(current.information).toEqual(before.information); expect(current.bindings).toEqual(before.bindings);
    expect(current.parentId).toBe(undo.appliedRevisionId);
    await expect(undoPackageUpdate(undo, policy)).rejects.toThrow(/no longer be undone/);
  });

  it('rejects forged Undo receipts and refuses Undo after newer work', async () => {
    const original = await fixture(), { record, undo } = await applyPreparedPackageUpdate(await prepare(original), policy, true);
    await expect(undoPackageUpdate({ ...undo }, policy)).rejects.toThrow(/no longer be undone/);
    await applyPreparedPackageUpdate(await prepare(record, 'Newer work'), policy, true);
    await expect(undoPackageUpdate(undo, policy)).rejects.toThrow(/changed after/);
  });

  it('keeps unchanged citation and paragraph identities current after a header update', async () => {
    let original = await fixture(1, 'Original subject', 'linked', true);
    original = await initializePackageCitationTargets(original);
    const revision = getPackageRevision(original), occurrence = (await packageCitationOccurrences(revision))[0];
    original = await linkPackageCitation(original, occurrence.source, revision.citations!.targets[0].id);
    const { record } = await applyPreparedPackageUpdate(await prepare(original), policy, true);
    const next = getPackageRevision(record), resolved = await resolvePackageCitations(next);
    expect(resolved.links[0].state).toBe('current');
    expect(next.citations!.links[0].id).toBe(getPackageRevision(original).citations!.links[0].id);
    expect(next.citations!.links[0].source.paragraphId).toBe('body');
    expect(next.citations!.links[0].source.memberRevisionId).not.toBe(occurrence.source.memberRevisionId);
  });

  it('commits multiple configured answers together with exact identifiers and false intact', async () => {
    const page = await fixturePage(), instance = fixtureInstance();
    instance.definition.pages[0].sha256 = page.sha256;
    const session = { ...createBlankSession(), documentCategory: 'forms' as const, formType: 'fixture', genericForm: instance, timestamp: 0 };
    const template = await validatePackageTemplate({ kind: 'dondocs-package-template', version: 1, id: 'configured', name: 'Configured action', createdAt: 0,
      members: [{ kind: 'native', label: 'Configured worksheet', role: 'supporting-document', required: true, draft: session,
        pages: { 'page1.pdf': { name: 'page1.pdf', type: 'application/pdf', data: uint8ArrayToBase64(page.bytes) } } }] });
    let original = await instantiatePackageTemplate(template, 'Configured action', {}, {});
    const current = getPackageRevision(original), member = current.members[0], fields = await listPackageBindingFields(member);
    const name = fields.find(field => field.label === 'Name')!, flag = fields.find(field => field.label === 'A')!;
    const revision = { ...current, id: newPackageId('revision'), parentId: current.id,
      information: { version: 1 as const, participants: [], facts: [
        { id: 'name', label: 'Identifier', kind: 'identifier' as const, value: '000123', source: { kind: 'entered' as const } },
        { id: 'flag', label: 'Confirmed', kind: 'boolean' as const, value: true, source: { kind: 'entered' as const } }] },
      bindings: { version: 1 as const, items: [name, flag].map((field, index) => ({ id: `link_${index}`, memberId: member.id,
        factId: index ? 'flag' : 'name', target: field.target, expectedValue: field.value, mode: 'linked' as const, format: 'field' as const })) } };
    original = await commitActionPackage(original, { ...original, sequence: original.sequence + 1, currentRevisionId: revision.id, revisions: [...original.revisions, revision] });
    const information = structuredClone(revision.information); information.facts[0].value = '000000'; information.facts[1].value = false;
    const plan = await preparePackageUpdate(original, information, revision.bindings, {}, policy);
    const result = await applyPreparedPackageUpdate(plan, policy, true), saved = getPackageRevision(result.record).members[0];
    if (saved.kind !== 'native') throw new Error('Expected configured member');
    expect(saved.session.genericForm!.answers).toMatchObject({ name: '000000', a: false });
    expect(saved.session.genericForm!.answerRevision).toBe(1);
    expect(saved.templates).toEqual(member.kind === 'native' ? member.templates : undefined);
    expect((await readPackageMemberDraft(saved)).reviewed.session).toEqual(saved.session);
  });
});
