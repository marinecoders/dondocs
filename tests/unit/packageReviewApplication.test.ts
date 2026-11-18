import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { actionPackageSchema, createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, renameActionPackage, validPackageTransition, type ActionPackage, type NativePackageMember } from '@/lib/actionPackages';
import { startPackageReview, transitionPackageReview } from '@/lib/packageReviewRounds';
import { createPackageMemberReview, savePackageMemberReview } from '@/lib/packageMemberReviews';
import { createReviewSuggestion, createSelectedTextSuggestion, createParagraphStructureSuggestion, appendReviewSuggestions } from '@/lib/reviewSuggestions';
import { applyReviewStructure, type CaptureReviewStructureInput } from '@/lib/reviewStructureSuggestions';
import { captureTextRange } from '@/lib/reviewTextRanges';
import { initializePackageCitationTargets, linkPackageCitation, packageCitationOccurrences, resolvePackageCitations } from '@/lib/packageCitations';
import { packageCitationReadiness } from '@/lib/packageCitationRepair';
import { mutateReviewComments } from '@/lib/reviewCommentActions';
import { buildPackageReviewReturn, packageReviewTransferFile } from '@/lib/packageReviewTransfer';
import { previewPackageReviewReturn, inspectPackageReviewApplication, preparePackageReviewApplication, applyPreparedPackageReviewApplication, type PackageFeedbackChoices } from '@/lib/packageReviewApplication';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { idbGetAllAttachments, idbCompareActionPackage } from '@/lib/documentsDb';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { buildPortableActionPackage } from '@/lib/actionPackageTransfer';
import { useDocumentsStore } from '@/stores/documentsStore';
import { derivePackageNextActions } from '@/lib/packageNextActions';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: async () => 'Synthetic retained PDF' }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
async function clear() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction([...db.objectStoreNames], 'readwrite'); for (const name of db.objectStoreNames) tx.objectStore(name).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
}
async function fixture(citations = false) {
  const session = createBlankSession(); session.timestamp = 123; session.formData.subject = 'SYNTHETIC PACKAGE'; session.formData.classLevel = 'unclassified';
  session.paragraphs = [{ id: 'synthetic-paragraph', text: 'Captured package text.', level: 0 }, { id: 'unrelated-paragraph', text: 'Unrelated owner text.', level: 0 }];
  if (citations) { session.paragraphs[1].text = 'Use reference (a).'; session.references = [{ letter: 'a', title: 'Synthetic training reference' }]; }
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'synthetic-source', capturedAt: 123, editSequence: 1, epoch: 0 }, { ...session, endItems: [], publicationTables: {} }), 'Synthetic native', 'basic-letter');
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = new Uint8Array(await pdf.save()).buffer;
  const original = await captureOriginalPackageMember({ name: 'synthetic-signed.pdf', data: bytes }, 'enclosure', true);
  if (original.kind !== 'original') throw new Error('Expected an original PDF');
  let owner = await reviseActionPackage(await createActionPackage('Synthetic package'), [native, original]);
  if (citations) { owner = await initializePackageCitationTargets(owner); const revision = getPackageRevision(owner), occurrence = (await packageCitationOccurrences(revision))[0]; owner = await linkPackageCitation(owner, occurrence.source, revision.citations!.targets.find(item => item.kind === 'reference')!.id); }
  owner = await startPackageReview(owner);
  const round = owner.reviewRounds![0], child = await createPackageMemberReview(round, native.id);
  const proposal = createReviewSuggestion(child.nativeRound!, { author: 'Synthetic reviewer', label: 'Replace reviewed paragraph', changes: [{ target: { kind: 'paragraph', paragraphId: 'synthetic-paragraph', docType: native.session.docType }, proposed: 'Reviewed replacement.' }] });
  const comments = mutateReviewComments(child.comments, { kind: 'add', author: 'Synthetic reviewer', text: 'Synthetic feedback question.' }, () => ({ kind: 'document' }))!;
  owner = await savePackageMemberReview(owner, round.id, { ...child, comments, suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [proposal]) });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, round.id, policy), policy);
  const choices: PackageFeedbackChoices = { [native.id]: { comments: 'merge', proposals: { [proposal.id]: { action: 'accepted' } } }, [original.id]: { comments: 'merge' } };
  return { owner, native, original, bytes, round, proposal, json, choices };
}
async function newer(owner: ActionPackage, native: NativePackageMember, text: string, subject = 'SYNTHETIC NEWER SUBJECT') {
  const session = structuredClone(native.session); session.formData.subject = subject; session.paragraphs[0].text = text; session.paragraphs[1].text = 'Unrelated newer owner work.';
  const updated = await capturePackageMember(captureDocumentRevision({ documentId: 'synthetic-source', capturedAt: 234, editSequence: 2, epoch: 0 }, { ...session, endItems: [], publicationTables: {} }), native.label, native.role, native);
  return reviseActionPackage(owner, [...getPackageRevision(owner).members].reverse().map(item => item.id === native.id ? updated : item));
}
beforeEach(async () => { vi.restoreAllMocks(); await createActionPackage('Initialize'); await clear(); useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true, baseline: null }); });
it('creates exactly one revision against latest package, retaining reordering, newer fields, untouched paragraphs, original bytes, baseline and reload', async () => {
  const { owner, native, original, bytes, round, json, choices } = await fixture();
  const latest = await newer(owner, native, native.session.paragraphs[0].text);
  const preview = await previewPackageReviewReturn(json, latest, round.id, policy);
  expect(inspectPackageReviewApplication(preview, {}, policy).ready).toBe(false);
  const plan = inspectPackageReviewApplication(preview, choices, policy); expect(plan.ready).toBe(true);
  const beforeAssets = await idbGetAllAttachments();
  const prepared = await preparePackageReviewApplication(preview, choices, policy);
  expect(await idbGetAllAttachments()).toEqual(beforeAssets);
  const applied = await applyPreparedPackageReviewApplication(prepared, policy);
  expect(applied.revisions).toHaveLength(latest.revisions.length + 1); expect(applied.revisions.slice(0, -1)).toEqual(latest.revisions);
  const revision = getPackageRevision(applied); expect(revision.parentId).toBe(latest.currentRevisionId); expect(revision.members.map(item => item.id)).toEqual([original.id, native.id]);
  const member = revision.members[1] as NativePackageMember;
  expect(member.session.formData.subject).toBe('SYNTHETIC NEWER SUBJECT'); expect(member.session.paragraphs.map(item => item.text)).toEqual(['Reviewed replacement.', 'Unrelated newer owner work.']);
  expect(member.session.reviewComments?.threads[0].messages[0].text).toBe('Synthetic feedback question.');
  expect(await readPackageAsset(original.original)).toEqual(bytes); expect(applied.reviewRounds).toEqual(latest.reviewRounds);
  expect(applied.reviewApplications![0].outcomes[0].suggestions!.decisions[0].action).toBe('accepted');
  const next = await derivePackageNextActions(applied, undefined, { operation: 'review', policy });
  expect(next.readyForOperation, JSON.stringify(next.actions)).toBe(true);
  expect((await listActionPackages())[0]).toEqual(applied); expect(useDocumentsStore.getState().docs).toEqual({});
  await expect(applyPreparedPackageReviewApplication(prepared, policy)).rejects.toThrow(/again/);
  await expect(previewPackageReviewReturn(json, applied, round.id, policy)).rejects.toThrow(/already applied/);
  const clean = JSON.parse(await buildPortableActionPackage(applied)); expect(clean.package.reviewApplications).toBeUndefined(); expect(clean.package.reviewRounds).toBeUndefined();
  const backup = await buildBackup(); await clear(); await restoreBackup(backup);
  const restored = (await listActionPackages())[0]; expect(restored.reviewApplications).toEqual(applied.reviewApplications); expect(restored.reviewRounds).toEqual(applied.reviewRounds);
});
it('requires a deliberate overlapping replacement and retains exact baseline/current/proposed contexts', async () => {
  const { owner, native, round, proposal, json, choices } = await fixture(); const latest = await newer(owner, native, 'Overlapping owner replacement.');
  const preview = await previewPackageReviewReturn(json, latest, round.id, policy), conflict = inspectPackageReviewApplication(preview, choices, policy);
  expect(conflict.ready).toBe(false); expect(conflict.previews[0].proposals[0].changes[0]).toMatchObject({ baseline: 'Captured package text.', current: 'Overlapping owner replacement.', proposed: 'Reviewed replacement.', stale: true });
  await expect(preparePackageReviewApplication(preview, choices, policy)).rejects.toThrow(/Resolve/);
  choices[native.id].proposals![proposal.id].resolutions = [{ changeId: proposal.changes[0].id, expectedCurrent: 'Overlapping owner replacement.', value: 'Deliberate combined wording.' }];
  const applied = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(preview, choices, policy), policy);
  expect((getPackageRevision(applied).members.find(item => item.id === native.id) as NativePackageMember).session.paragraphs[0].text).toBe('Deliberate combined wording.');
});
it.each(['removed', 'replaced'] as const)('requires a membership choice for %s members and preserves current content on keep', async kind => {
  const { owner, native, original, round, json, choices } = await fixture();
  const members = kind === 'removed' ? [original] : [{ ...original, id: native.id, revisionId: 'replacement-member' }];
  const latest = await reviseActionPackage(owner, members), preview = await previewPackageReviewReturn(json, latest, round.id, policy);
  expect(inspectPackageReviewApplication(preview, choices, policy).ready).toBe(false);
  choices[native.id].member = 'current'; for (const proposal of Object.values(choices[native.id].proposals!)) proposal.action = 'keep'; if (kind === 'replaced') choices[original.id].member = 'current';
  const prepared = await preparePackageReviewApplication(preview, choices, policy), applied = await applyPreparedPackageReviewApplication(prepared, policy);
  expect(getPackageRevision(applied).members).toEqual(members);
});
it('restores a removed reviewed member only after an explicit choice and captures changed draft bytes', async () => {
  const { owner, native, original, round, json, choices } = await fixture();
  const latest = await reviseActionPackage(owner, [original]), preview = await previewPackageReviewReturn(json, latest, round.id, policy);
  choices[native.id].member = 'restore-reviewed';
  const applied = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(preview, choices, policy), policy);
  const restored = getPackageRevision(applied).members.find(item => item.id === native.id) as NativePackageMember;
  expect(restored.session.paragraphs[0].text).toBe('Reviewed replacement.'); expect(restored.source?.local).toBe(false);
  expect(JSON.parse(new TextDecoder().decode(await readPackageAsset(restored.draft))).paragraphs[0].text).toBe('Reviewed replacement.');
});
it('preserves all metadata and attachment stores on cancellation, invalidation, stale latest revision, quota and policy changes', async () => {
  const { owner, round, json, choices } = await fixture(); const preview = await previewPackageReviewReturn(json, owner, round.id, policy), prepared = await preparePackageReviewApplication(preview, choices, policy);
  const assets = await idbGetAllAttachments();
  await expect(applyPreparedPackageReviewApplication(prepared, policy, AbortSignal.abort())).rejects.toThrow();
  await expect(applyPreparedPackageReviewApplication(prepared, policy, undefined, () => false)).rejects.toThrow();
  const invalidPolicy = { status: 'loading', message: 'Changed policy' } as never;
  await expect(applyPreparedPackageReviewApplication(prepared, invalidPolicy)).rejects.toThrow(/Changed policy/);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args) { const result = put.apply(this, args); if (this.name === 'app') this.transaction.abort(); return result; });
  await expect(applyPreparedPackageReviewApplication(prepared, policy)).rejects.toThrow(/saved/); vi.restoreAllMocks();
  expect(await idbGetAllAttachments()).toEqual(assets); expect((await listActionPackages())[0]).toEqual(owner);
  const latest = await renameActionPackage(owner, 'Newer saved owner name');
  await expect(applyPreparedPackageReviewApplication(prepared, policy)).rejects.toThrow(/changed/);
  expect((await listActionPackages())[0]).toEqual(latest); expect(await idbGetAllAttachments()).toEqual(assets);
});
it('rejects closed/foreign/wrong-round/baseline/digest feedback and immutable receipt rewrites', async () => {
  const { owner, round, json, choices } = await fixture();
  const closed = await transitionPackageReview(owner, round.id, 'close'); await expect(previewPackageReviewReturn(json, closed, round.id, policy)).rejects.toThrow(/closed/);
  const reopened = await transitionPackageReview(closed, round.id, 'reopen');
  for (const mutate of [
    (value: { package: ActionPackage }) => { value.package.id = 'foreign-package'; },
    (value: { package: ActionPackage }) => { value.package.reviewRounds![0].baselineDigest = 'f'.repeat(64); },
    (value: { package: ActionPackage }) => { value.package.reviewRounds![0].memberReviews![0].binding.memberDigest = 'f'.repeat(64); },
    (value: { package: ActionPackage }) => { Object.assign(value.package.reviewRounds![0].memberReviews![0].nativeRound!, { ownerDocumentId: 'fake-source' }); },
  ]) { const value = JSON.parse(json); mutate(value); await expect(previewPackageReviewReturn(JSON.stringify(value), reopened, round.id, policy)).rejects.toThrow(); }
  await expect(previewPackageReviewReturn(json, reopened, 'wrong-round', policy)).rejects.toThrow();
  const applied = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(await previewPackageReviewReturn(json, reopened, round.id, policy), choices, policy), policy);
  const changed = structuredClone(applied); changed.sequence++; changed.reviewApplications![0].returnDigest = 'f'.repeat(64);
  expect(validPackageTransition(applied, changed)).toBe(false); expect(await idbCompareActionPackage(applied, changed)).toBe(false);
  const duplicate = structuredClone(applied); duplicate.reviewApplications!.push(duplicate.reviewApplications![0]); expect(() => actionPackageSchema.parse(duplicate)).toThrow();
});
async function selectedFixture() {
  const input = await fixture(), child = await createPackageMemberReview(input.round, input.native.id);
  const start = input.native.session.paragraphs[0].text.indexOf('package');
  const proposal = createSelectedTextSuggestion(child.nativeRound!, { author: 'Selected reviewer', paragraphId: 'synthetic-paragraph', start, end: start + 7, proposed: 'reviewed' });
  const comments = mutateReviewComments(child.comments, { kind: 'add', range: captureTextRange(input.native.session, 'synthetic-paragraph', start, start + 7)!, author: 'Selected reviewer', text: 'Exact selected range.' }, () => null, input.native.session)!;
  // Independent reviewer return; no source-document owner is added to the adapter.
  const owner = await savePackageMemberReview(input.owner, input.round.id, { ...child, comments, suggestions: appendReviewSuggestions(child.nativeRound!, input.owner.reviewRounds![0].memberReviews![0].suggestions!, [proposal]) });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, input.round.id, policy), policy);
  return { ...input, owner, json, proposal, choices: { ...input.choices, [input.native.id]: { comments: 'merge' as const, proposals: { [input.proposal.id]: { action: 'keep' as const }, [proposal.id]: { action: 'accepted' as const } } } } };
}
it('reconciles independent selected-text edits against a newer saved native member and preserves moved-member identity', async () => {
  const { owner, native, original, round, proposal, json, choices } = await selectedFixture();
  const latest = await newer(owner, native, 'Newest captured package text ending.');
  const preview = await previewPackageReviewReturn(json, latest, round.id, policy), plan = inspectPackageReviewApplication(preview, choices, policy);
  expect(plan.ready).toBe(true); expect(plan.previews[0].proposals.find(item => item.id === proposal.id)!.changes[0].reconciliation?.kind).toBe('independent');
  const applied = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(preview, choices, policy), policy), member = getPackageRevision(applied).members[1] as NativePackageMember;
  expect(member.id).toBe(native.id); expect(getPackageRevision(applied).members[0].id).toBe(original.id);
  expect(member.session.paragraphs[0].text).toBe('Newest captured reviewed text ending.');
  expect(applied.reviewApplications![0].outcomes[0].suggestions!.decisions.find(item => item.proposalId === proposal.id)?.resolutions?.[0].range?.context).toBe('Newest captured package text ending.');
  const anchor = member.session.reviewComments!.threads[0].anchor; expect(anchor.kind).toBe('range'); if (anchor.kind === 'range') expect(anchor.detached).toBe(true);
});
it('requires an exact manual scope for a selected-text overlap and refuses stale/forged full paragraph guards', async () => {
  const { owner, native, round, proposal, json, choices } = await selectedFixture();
  const context = 'Captured owner text.', latest = await newer(owner, native, context), preview = await previewPackageReviewReturn(json, latest, round.id, policy);
  expect(inspectPackageReviewApplication(preview, choices, policy).ready).toBe(false);
  const start = context.indexOf('owner'), choice = choices[native.id] as PackageFeedbackChoices[string];
  choice.proposals![proposal.id].resolutions = [{ changeId: proposal.changes[0].id, expectedCurrent: 'owner', value: 'combined', range: { context: 'wrong-context', start, end: start + 5 } }];
  expect(inspectPackageReviewApplication(preview, choices, policy).ready).toBe(false);
  choice.proposals![proposal.id].resolutions![0].range!.context = context;
  const applied = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(preview, choices, policy), policy);
  expect((getPackageRevision(applied).members.find(item => item.id === native.id) as NativePackageMember).session.paragraphs[0].text).toBe('Captured combined text.');
});
it('normalizes new returned range tracking against exact baseline and rejects fabricated original range identities', async () => {
  const { owner, native, round, json, choices } = await selectedFixture();
  const payload = JSON.parse(json); const child = payload.package.reviewRounds[0].memberReviews.find((item: { binding: { memberId: string } }) => item.binding.memberId === native.id);
  const anchor = child.comments.threads[0].anchor;
  anchor.tracking = { context: 'Unrelated package owner text.', start: 10, end: 17 };
  const normalized = await previewPackageReviewReturn(JSON.stringify(payload), owner, round.id, policy);
  expect(inspectPackageReviewApplication(normalized, choices, policy).ready).toBe(true);
  anchor.context = 'Invented package text.';
  const forged = await previewPackageReviewReturn(JSON.stringify(payload), owner, round.id, policy);
  expect(() => inspectPackageReviewApplication(forged, choices, policy)).toThrow(/baseline/);
  expect((await listActionPackages())[0]).toEqual(owner);
});
it('retains stable citation IDs and current unchanged linked occurrences, while changed tracked text remains visibly blocked', async () => {
  const { owner, native, round, json, choices } = await fixture(true);
  const before = getPackageRevision(owner).citations!, preview = await previewPackageReviewReturn(json, owner, round.id, policy);
  const applied = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(preview, choices, policy), policy);
  expect(getPackageRevision(applied).citations!.targets.map(item => item.id)).toEqual(before.targets.map(item => item.id));
  expect(getPackageRevision(applied).citations!.links.map(item => item.id)).toEqual(before.links.map(item => item.id));
  expect((await resolvePackageCitations(getPackageRevision(applied))).links.every(item => item.state === 'current')).toBe(true);
  const child = await createPackageMemberReview(round, native.id), proposal = createReviewSuggestion(child.nativeRound!, { author: 'Citation reviewer', label: 'Change linked paragraph', changes: [{ target: { kind: 'paragraph', paragraphId: 'unrelated-paragraph', docType: native.session.docType }, proposed: 'Use reference (b).' }] });
  const updated = await savePackageMemberReview(applied, round.id, { ...applied.reviewRounds![0].memberReviews![0], suggestions: appendReviewSuggestions(child.nativeRound!, applied.reviewRounds![0].memberReviews![0].suggestions!, [proposal]) });
  const nextJson = await packageReviewTransferFile(await buildPackageReviewReturn(updated, round.id, policy), policy), nextChoices = structuredClone(choices);
  for (const id of Object.keys(nextChoices[native.id].proposals!)) nextChoices[native.id].proposals![id].action = 'keep';
  nextChoices[native.id].proposals![proposal.id] = { action: 'accepted' };
  const prepared = await preparePackageReviewApplication(await previewPackageReviewReturn(nextJson, updated, round.id, policy), nextChoices, policy);
  expect(prepared.reviews.flatMap(item => item.notices).some(item => item.includes('repair linked citation'))).toBe(true);
  const changed = await applyPreparedPackageReviewApplication(prepared, policy);
  expect((await packageCitationReadiness(getPackageRevision(changed))).some(item => item.severity === 'error')).toBe(true);
  expect(getPackageRevision(changed).citations!.links[0].id).toBe(before.links[0].id);
});
it('does not pick an arrival-order winner for overlapping feedback from a second reviewer', async () => {
  const { owner, native, round, proposal, json, choices } = await fixture();
  const first = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(await previewPackageReviewReturn(json, owner, round.id, policy), choices, policy), policy);
  const child = await createPackageMemberReview(round, native.id), rival = createReviewSuggestion(child.nativeRound!, { author: 'Second reviewer', label: 'Second conflicting replacement', changes: [{ target: proposal.changes[0].target, proposed: 'Rival wording.' }] });
  const updated = await savePackageMemberReview(first, round.id, { ...first.reviewRounds![0].memberReviews![0], suggestions: appendReviewSuggestions(child.nativeRound!, first.reviewRounds![0].memberReviews![0].suggestions!, [rival]) });
  const returned = await packageReviewTransferFile(await buildPackageReviewReturn(updated, round.id, policy), policy);
  const nextChoices = structuredClone(choices); nextChoices[native.id].proposals![proposal.id].action = 'keep'; nextChoices[native.id].proposals![rival.id] = { action: 'accepted' };
  const preview = await previewPackageReviewReturn(returned, updated, round.id, policy); expect(inspectPackageReviewApplication(preview, nextChoices, policy).ready).toBe(false);
  nextChoices[native.id].proposals![rival.id].resolutions = [{ changeId: rival.changes[0].id, expectedCurrent: 'Reviewed replacement.', value: 'Deliberate reviewer synthesis.' }];
  const applied = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(preview, nextChoices, policy), policy);
  expect((getPackageRevision(applied).members[0] as NativePackageMember).session.paragraphs[0].text).toBe('Deliberate reviewer synthesis.');
  expect(applied.reviewApplications).toHaveLength(2); expect(applied.reviewApplications![1].outcomes[0].suggestions!.decisions).toHaveLength(2);
});
it('allows only one application from concurrent clicks and rejects a changed duplicate return identity', async () => {
  const { owner, round, json, choices } = await fixture(), preview = await previewPackageReviewReturn(json, owner, round.id, policy), prepared = await preparePackageReviewApplication(preview, choices, policy);
  const attempts = await Promise.allSettled([applyPreparedPackageReviewApplication(prepared, policy), applyPreparedPackageReviewApplication(prepared, policy)]);
  expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  const latest = (await listActionPackages())[0]; expect(latest.revisions).toHaveLength(owner.revisions.length + 1); expect(latest.reviewApplications).toHaveLength(1);
  const changed = JSON.parse(json); changed.createdAt++;
  await expect(previewPackageReviewReturn(JSON.stringify(changed), latest, round.id, policy)).rejects.toThrow(/identity changed/);
});
it('rolls back newly staged changed drafts when liveness changes during the parent CAS reads', async () => {
  const { owner, round, json, choices } = await fixture(), prepared = await preparePackageReviewApplication(await previewPackageReviewReturn(json, owner, round.id, policy), choices, policy), assets = await idbGetAllAttachments();
  let live = true; const get = IDBObjectStore.prototype.get;
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function(this: IDBObjectStore, ...args) { const result = get.apply(this, args); if (this.name === 'app') queueMicrotask(() => { live = false; }); return result; });
  await expect(applyPreparedPackageReviewApplication(prepared, policy, undefined, () => live)).rejects.toThrow(); vi.restoreAllMocks();
  expect((await listActionPackages())[0]).toEqual(owner); expect(await idbGetAllAttachments()).toEqual(assets);
});
it('retains original PDF discussion across separate returns without changing the original asset', async () => {
  const { owner, original, round, json, choices } = await fixture();
  const first = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(await previewPackageReviewReturn(json, owner, round.id, policy), choices, policy), policy);
  const child = await createPackageMemberReview(round, original.id), comments = mutateReviewComments(child.comments, { kind: 'add', author: 'Original reviewer', text: 'First original discussion.' }, () => ({ kind: 'document' }))!;
  let updated = await savePackageMemberReview(first, round.id, { ...child, comments });
  const nextChoices = structuredClone(choices); for (const choice of Object.values(nextChoices[nativeId(first)].proposals!)) choice.action = 'keep';
  const returnOne = await packageReviewTransferFile(await buildPackageReviewReturn(updated, round.id, policy), policy);
  const second = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(await previewPackageReviewReturn(returnOne, updated, round.id, policy), nextChoices, policy), policy);
  const replied = mutateReviewComments(comments, { kind: 'reply', threadId: comments.threads[0].id, author: 'Second original reviewer', text: 'Reply to the original question.' }, () => null)!;
  updated = await savePackageMemberReview(second, round.id, { ...child, comments: replied });
  const returnTwo = await packageReviewTransferFile(await buildPackageReviewReturn(updated, round.id, policy), policy);
  const third = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(await previewPackageReviewReturn(returnTwo, updated, round.id, policy), nextChoices, policy), policy);
  const discussion = third.reviewApplications!.at(-1)!.outcomes.find(item => item.memberId === original.id)!.comments!;
  expect(discussion.threads[0].messages.map(item => item.text)).toEqual(['First original discussion.', 'Reply to the original question.']);
  expect(getPackageRevision(third).members.find(item => item.id === original.id)).toEqual(original);
});
function nativeId(record: ActionPackage): string { return getPackageRevision(record).members.find(item => item.kind === 'native')!.id; }
it('blocks unsafe multiline resolution metadata and bounds the aggregate retained application record', async () => {
  const { owner, native, round, json, proposal, choices } = await fixture(), latest = await newer(owner, native, 'Newer owner text.');
  const preview = await previewPackageReviewReturn(json, latest, round.id, policy);
  choices[native.id].proposals![proposal.id].resolutions = [{ changeId: proposal.changes[0].id, expectedCurrent: 'Newer owner text.', value: 'Training heading\n(S) Synthetic marked resolution.' }];
  await expect(preparePackageReviewApplication(preview, choices, policy)).rejects.toThrow(/mark|level|handling/i);
  expect((await listActionPackages())[0]).toEqual(latest);
  choices[native.id].proposals![proposal.id].resolutions![0].value = 'Unclassified deliberate resolution.';
  const applied = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(preview, choices, policy), policy);
  const oversized = structuredClone(applied), template = oversized.reviewApplications![0];
  template.feedback[0].nativeRound!.baseline.session.paragraphs[0].text = 'Synthetic retained baseline. '.repeat(400);
  oversized.reviewApplications = Array.from({ length: 500 }, (_, index) => ({ ...structuredClone(template), id: `application-${index}`, returnId: `return-${index}`, revisionId: `revision-${index}` }));
  expect(actionPackageSchema.safeParse(oversized).success).toBe(false);
  const result = actionPackageSchema.safeParse(oversized); if (!result.success) expect(result.error.issues.some(item => item.message.includes('4 MB'))).toBe(true);
});
it('preserves embedded native enclosure bytes when applying a supported proposal', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = new Uint8Array(await pdf.save()).buffer;
  const session = createBlankSession(); session.paragraphs = [{ id: 'embedded-body', text: 'Reviewable embedded draft.', level: 0 }];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'embedded-source', capturedAt: 200, editSequence: 0, epoch: 0 }, { ...session, endItems: [], publicationTables: {},
    enclosures: [{ title: 'Synthetic unchanged PDF', file: { name: 'embedded.pdf', size: bytes.byteLength, data: bytes } }] }), 'Embedded native member', 'basic-letter');
  let owner = await startPackageReview(await reviseActionPackage(await createActionPackage('Embedded native review'), [native]));
  const round = owner.reviewRounds![0], child = await createPackageMemberReview(round, native.id), proposal = createReviewSuggestion(child.nativeRound!, { author: 'Embedded reviewer', label: 'Change text only', changes: [{ target: { kind: 'paragraph', paragraphId: 'embedded-body', docType: native.session.docType }, proposed: 'Revised text, original embedded PDF.' }] });
  owner = await savePackageMemberReview(owner, round.id, { ...child, suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [proposal]) });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, round.id, policy), policy), choices: PackageFeedbackChoices = { [native.id]: { comments: 'skip', proposals: { [proposal.id]: { action: 'accepted' } } } };
  const applied = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(await previewPackageReviewReturn(json, owner, round.id, policy), choices, policy), policy);
  const before = JSON.parse(new TextDecoder().decode(await readPackageAsset(native.draft))), member = getPackageRevision(applied).members[0] as NativePackageMember;
  const after = JSON.parse(new TextDecoder().decode(await readPackageAsset(member.draft)));
  expect(after.enclosures).toEqual(before.enclosures); expect(after.paragraphs[0].text).toBe('Revised text, original embedded PDF.');
});

it('requires a replacement decision when an original PDF identity now contains different bytes', async () => {
  const { owner, native, original, round, json, choices } = await fixture();
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
  const replacement = await captureOriginalPackageMember({ name: 'synthetic-replaced-original.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'enclosure', true);
  if (replacement.kind !== 'original') throw new Error('Expected original replacement');
  const changed = { ...replacement, id: original.id };
  const latest = await reviseActionPackage(owner, [native, changed]);
  const preview = await previewPackageReviewReturn(json, latest, round.id, policy);
  const unresolved = inspectPackageReviewApplication(preview, choices, policy);
  expect(unresolved.ready).toBe(false);
  expect(unresolved.previews.find(member => member.memberId === original.id)?.status).toBe('replaced');
  await expect(preparePackageReviewApplication(preview, choices, policy)).rejects.toThrow(/Resolve/);
  choices[original.id].member = 'current';
  const applied = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(preview, choices, policy), policy);
  expect(getPackageRevision(applied).members.find(member => member.id === original.id)).toEqual(changed);
  expect(new Uint8Array(await readPackageAsset(original.original))).not.toEqual(new Uint8Array(await readPackageAsset(changed.original)));
  expect(applied.reviewRounds![0].baseline.members.find(member => member.id === original.id)).toEqual(original);
});

it.each(['removed', 'replaced'] as const)('restores an unchanged %s native member with detached authority and a fresh capture identity', async kind => {
  const { owner, native, original, round, json, choices, proposal } = await fixture(true);
  const latest = await reviseActionPackage(owner, kind === 'removed' ? [original] : [original, { ...original, id: native.id, revisionId: 'replacement-original-revision' }]);
  choices[native.id] = { member: 'restore-reviewed', comments: 'skip', proposals: { [proposal.id]: { action: 'keep' } } };
  const preview = await previewPackageReviewReturn(json, latest, round.id, policy);
  expect(inspectPackageReviewApplication(preview, choices, policy).ready).toBe(true);
  const prepared = await preparePackageReviewApplication(preview, choices, policy);
  const applied = await applyPreparedPackageReviewApplication(prepared, policy);
  const restored = getPackageRevision(applied).members.find(member => member.id === native.id) as NativePackageMember;
  expect(restored.session).toEqual(native.session);
  expect(restored.draft).toEqual(native.draft);
  expect(restored.source?.local).toBe(false);
  expect(restored.revisionId).not.toBe(native.revisionId);
  expect(getPackageRevision(applied).citations!.targets.map(target => target.id)).toEqual(getPackageRevision(owner).citations!.targets.map(target => target.id));
  expect((await resolvePackageCitations(getPackageRevision(applied))).links.every(link => link.state === 'current')).toBe(true);
  expect(applied.reviewApplications).toHaveLength(1);
  expect(applied.revisions.slice(0, -1)).toEqual(latest.revisions);
  expect((await listActionPackages())[0]).toEqual(applied);
});

it('restores a replaced signed original with its exact reviewed bytes while preserving the replacement in history', async () => {
  const { owner, original, native, round, json, choices, proposal, bytes } = await fixture();
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
  const replacement = await captureOriginalPackageMember({ name: 'newer-original.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'enclosure', false);
  if (replacement.kind !== 'original') throw new Error('Expected original fixture');
  const latest = await reviseActionPackage(owner, [native, { ...replacement, id: original.id }]);
  choices[original.id].member = 'restore-reviewed';
  choices[native.id] = { comments: 'skip', proposals: { [proposal.id]: { action: 'keep' } } };
  const prepared = await preparePackageReviewApplication(await previewPackageReviewReturn(json, latest, round.id, policy), choices, policy);
  const applied = await applyPreparedPackageReviewApplication(prepared, policy);
  expect(getPackageRevision(applied).members.find(member => member.id === original.id)).toEqual(original);
  expect(await readPackageAsset(original.original)).toEqual(bytes);
  expect(new Uint8Array(await readPackageAsset(replacement.original))).not.toEqual(new Uint8Array(bytes));
  expect(applied.revisions.slice(0, -1)).toEqual(latest.revisions);
  expect(applied.reviewApplications).toHaveLength(1);
  expect((await listActionPackages())[0]).toEqual(applied);
});

it.each(['insert', 'delete', 'split', 'join', 'move'] as const)('applies %s structural feedback through portable package return and atomic parent storage without library authority', async kind => {
  const input = await selectedFixture(), child = input.owner.reviewRounds![0].memberReviews!.find(item => item.binding.memberId === input.native.id)!;
  const operation: CaptureReviewStructureInput = kind === 'insert' ? { kind: 'insert-paragraph', index: 1, text: 'New reviewed paragraph.', level: 0, paragraphId: 'package-new-paragraph' }
    : kind === 'delete' ? { kind: 'delete-paragraph', paragraphId: 'synthetic-paragraph' }
      : kind === 'split' ? { kind: 'split-paragraph', paragraphId: 'synthetic-paragraph', splitAt: 9, newParagraphId: 'package-split-paragraph' }
        : kind === 'join' ? { kind: 'join-paragraphs', paragraphId: 'synthetic-paragraph', nextParagraphId: 'unrelated-paragraph', separator: ' ' }
          : { kind: 'move-paragraph', paragraphId: 'synthetic-paragraph', destinationId: 'unrelated-paragraph', placement: 'after' };
  const proposal = createParagraphStructureSuggestion(child.nativeRound!, { author: 'Structural package reviewer', operation });
  const owner = await savePackageMemberReview(input.owner, input.round.id, { ...child, suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [proposal]) });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, input.round.id, policy), policy);
  const choices: PackageFeedbackChoices = structuredClone(input.choices);
  for (const decision of Object.values(choices[input.native.id].proposals!)) decision.action = 'keep';
  choices[input.native.id].proposals![proposal.id] = { action: 'accepted' };
  const preview = await previewPackageReviewReturn(json, owner, input.round.id, policy), prepared = await preparePackageReviewApplication(preview, choices, policy);
  const applied = await applyPreparedPackageReviewApplication(prepared, policy);
  const member = getPackageRevision(applied).members.find(item => item.id === input.native.id) as NativePackageMember;
  const target = proposal.changes[0].target; if (target.kind !== 'structure') throw new Error();
  const expected = applyReviewStructure({ ...input.native.session, reviewComments: child.comments }, target);
  expect(member.session.paragraphs).toEqual(expected.paragraphs);
  expect(member.session.reviewComments).toEqual(expected.reviewComments);
  const range = member.session.reviewComments!.threads[0].anchor;
  if (kind === 'split') expect(range).toMatchObject({ paragraphId: 'synthetic-paragraph', tracking: { paragraphId: 'package-split-paragraph', start: 0, end: 7 } });
  if (kind === 'delete') expect(range).toMatchObject({ detached: true });
  expect(JSON.parse(new TextDecoder().decode(await readPackageAsset(member.draft))).paragraphs).toEqual(expected.paragraphs);
  expect(await readPackageAsset(input.original.original)).toEqual(input.bytes);
  expect(applied.reviewRounds![0].baseline).toEqual(owner.reviewRounds![0].baseline);
  expect(applied.revisions).toHaveLength(owner.revisions.length + 1);
  expect((await listActionPackages())[0]).toEqual(applied);
  expect(useDocumentsStore.getState().docs).toEqual({});
});

it('persists a package move retaining a paragraph introduced by an earlier accepted proposal', async () => {
  const input = await fixture(), child = input.owner.reviewRounds![0].memberReviews!.find(item => item.binding.memberId === input.native.id)!;
  const insertion = { ...createParagraphStructureSuggestion(child.nativeRound!, { author: 'Reviewer', operation: { kind: 'insert-paragraph', index: 1, text: 'Accepted package insertion.', level: 0, paragraphId: 'accepted-package-insertion' } }), id: 'proposal_11111111-1111-4111-8111-111111111111' };
  const move = { ...createParagraphStructureSuggestion(child.nativeRound!, { author: 'Reviewer', operation: { kind: 'move-paragraph', paragraphId: 'synthetic-paragraph', destinationId: 'unrelated-paragraph', placement: 'after' } }), id: 'proposal_22222222-2222-4222-8222-222222222222' };
  const owner = await savePackageMemberReview(input.owner, input.round.id, { ...child, suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [insertion, move]) });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, input.round.id, policy), policy);
  const choices = structuredClone(input.choices);
  choices[input.native.id].proposals![input.proposal.id] = { action: 'keep' };
  choices[input.native.id].proposals![insertion.id] = { action: 'accepted' };
  choices[input.native.id].proposals![move.id] = { action: 'accepted' };
  const preview = await previewPackageReviewReturn(json, owner, input.round.id, policy);
  const applied = await applyPreparedPackageReviewApplication(await preparePackageReviewApplication(preview, choices, policy), policy);
  const member = getPackageRevision(applied).members.find(item => item.id === input.native.id) as NativePackageMember;
  expect(member.session.paragraphs.map(node => node.id)).toEqual(['accepted-package-insertion', 'unrelated-paragraph', 'synthetic-paragraph']);
  expect(JSON.parse(new TextDecoder().decode(await readPackageAsset(member.draft))).paragraphs).toEqual(member.session.paragraphs);
  expect((await listActionPackages())[0]).toEqual(applied);
  expect(JSON.parse(await buildBackup()).actionPackages[0].reviewApplications).toEqual(applied.reviewApplications);
});
