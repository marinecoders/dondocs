import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { packageFormFixture } from '../_helpers/packageFormReviewFixture';
import { buildPackageReviewerCopy, buildPackageReviewReturn, packageReviewTransferFile, preparePackageReviewerImport, importPackageReviewerCopy } from '@/lib/packageReviewTransfer';
import { addPackageFormComment, addPackageFormProposal, capturePackageFormAnchor, packageFormReviewFields } from '@/lib/packageFormReview';
import { preparePackageFormFeedbackImport, applyPreparedPackageFormFeedbackImport } from '@/lib/packageFormFeedbackImport';
import { inspectPackageFormReconciliation } from '@/lib/packageFormReconciliation';
import { applyPreparedPackageFormCorrection, preparePackageFormCorrection } from '@/lib/packageFormCorrections';
import { getPackageRevision, listActionPackages, reviseActionPackage, type ActionPackage } from '@/lib/actionPackages';
import { readPackageMemberDraft, retainPackageAsset } from '@/lib/actionPackageAssets';
import { patchPackageBindingDraftFields } from '@/lib/packageBindingTargets';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { idbCompareActionPackage } from '@/lib/documentsDb';
import { savePackageMemberReview } from '@/lib/packageMemberReviews';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy); });
async function removePackage(id: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction('app', 'readwrite'); transaction.objectStore('app').delete(`action-package:${id}`); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
}
async function returned(owner: ActionPackage, fieldId = 'name', value = '000999', rowId?: string) {
  const round = owner.reviewRounds![0], copy = await packageReviewTransferFile(await buildPackageReviewerCopy(owner, round.id, policy), policy);
  // Switch this fake-IDB fixture inventory to an independently imported reviewer copy.
  await removePackage(owner.id);
  try {
    let reviewer = await importPackageReviewerCopy(await preparePackageReviewerImport(copy, policy), policy);
    const reviewRound = reviewer.reviewRounds![0], member = reviewRound.baseline.members[0];
    const field = (await packageFormReviewFields(member)).find(field => field.target.kind === 'configured-form' && field.target.fieldId === fieldId && field.target.row?.rowId === rowId)!;
    const anchor = await capturePackageFormAnchor(member, field.target), child = reviewRound.memberReviews![0];
    let fieldReview = addPackageFormComment(child.fieldReview, anchor, 'Alex Example', 'Returned exact form feedback.');
    fieldReview = await addPackageFormProposal(member, fieldReview, anchor, 'Alex Example', value);
    reviewer = await savePackageMemberReview(reviewer, round.id, { ...child, fieldReview });
    const json = await packageReviewTransferFile(await buildPackageReviewReturn(reviewer, round.id, policy), policy);
    return { json, proposal: fieldReview.proposals!.at(-1)!, member };
  } finally {
    await removePackage(owner.id);
    expect(await idbCompareActionPackage(null, owner)).toBe(true);
  }
}
async function change(owner: ActionPackage, values: { name?: string; reorder?: boolean; removeFirst?: boolean; changeDefinition?: boolean }) {
  const member = getPackageRevision(owner).members[0]; if (member.kind !== 'native') throw new Error('Expected synthetic form.');
  const { draft } = await readPackageMemberDraft(member), fields = await packageFormReviewFields(member);
  let raw = draft as Record<string, unknown>;
  if (values.name) raw = (await patchPackageBindingDraftFields(raw, [{ target: fields.find(field => field.target.kind === 'configured-form' && field.target.fieldId === 'name')!.target, expected: member.session.genericForm!.answers.name as string, value: values.name }])).draft;
  const form = structuredClone((raw.genericForm ?? (raw as { payload?: { genericForm?: unknown } }).payload?.genericForm)) as typeof member.session.genericForm;
  // Native package drafts retain genericForm at their top level.
  if (!form) throw new Error('Expected a captured configured form draft.');
  form.answers.a = false;
  if (values.reorder) form.rows.roster.reverse();
  if (values.removeFirst) form.rows.roster = form.rows.roster.filter(row => row.id !== 'first');
  if (values.changeDefinition) form.definition.definitionRevision = 'v2';
  raw.genericForm = form;
  const { validatePackageDraft } = await import('@/lib/actionPackageDraft'), validated = await validatePackageDraft(raw);
  const asset = await retainPackageAsset(member.draft.name, member.draft.type, new TextEncoder().encode(JSON.stringify(raw)).buffer);
  return reviseActionPackage(owner, [{ ...member, draft: asset, session: validated.session }]);
}
it('collects exact returned feedback without changing newer answers, then requires an explicit three-way overlap decision', async () => {
  const { record: initial, round, member } = await packageFormFixture(), feedback = await returned(initial);
  let owner = await change(initial, { name: '000555', reorder: true }); const before = getPackageRevision(owner);
  const preview = await preparePackageFormFeedbackImport(owner, round.id, member.id, feedback.json, policy);
  expect(preview.ready).toBe(true); expect(preview.proposals).toBe(1); expect(preview.comments).toBe(1);
  owner = await applyPreparedPackageFormFeedbackImport(preview, policy, true);
  expect(getPackageRevision(owner)).toEqual(before);
  expect((await inspectPackageFormReconciliation(owner, round.id, member.id, feedback.proposal)).kind).toBe('overlap');
  await expect(preparePackageFormCorrection(owner, round.id, member.id, feedback.proposal.id, 'accepted', policy)).rejects.toThrow(/changed/);
  await expect(preparePackageFormCorrection(owner, round.id, member.id, feedback.proposal.id, 'accepted', policy, { resolution: { expectedCurrent: '000123', value: '000999' } })).rejects.toThrow(/again/);
  const prepared = await preparePackageFormCorrection(owner, round.id, member.id, feedback.proposal.id, 'accepted', policy, { resolution: { expectedCurrent: '000555', value: '000777' } });
  const saved = await applyPreparedPackageFormCorrection(prepared, policy, true), current = getPackageRevision(saved).members[0];
  expect(current.kind === 'native' && current.session.genericForm!.answers.name).toBe('000777');
  expect(current.kind === 'native' && current.session.genericForm!.rows.roster.map(row => row.id)).toEqual(['second', 'first']);
  expect(current.kind === 'native' && current.session.genericForm!.answers.a).toBe(false);
  expect(saved.fieldReviewApplications![0].resolution).toEqual({ expectedCurrent: '000555', value: '000777' });
});
it('merges an independent exact answer while preserving newer other answers and row order', async () => {
  const { record: initial, round, member } = await packageFormFixture(), feedback = await returned(initial);
  let owner = await change(initial, { reorder: true });
  owner = await applyPreparedPackageFormFeedbackImport(await preparePackageFormFeedbackImport(owner, round.id, member.id, feedback.json, policy), policy, true);
  expect((await inspectPackageFormReconciliation(owner, round.id, member.id, feedback.proposal)).kind).toBe('independent');
  const saved = await applyPreparedPackageFormCorrection(await preparePackageFormCorrection(owner, round.id, member.id, feedback.proposal.id, 'accepted', policy), policy, true);
  const current = getPackageRevision(saved).members[0];
  expect(current.kind === 'native' && current.session.genericForm!.answers).toMatchObject({ name: '000999', a: false });
  expect(current.kind === 'native' && current.session.genericForm!.rows.roster[0].id).toBe('second');
});
it.each([{ removeFirst: true }, { changeDefinition: true }])('keeps deleted rows or incompatible definitions unavailable and never retargets a proposal (%j)', async edits => {
  const { record: initial, round, member } = await packageFormFixture(), feedback = await returned(initial, 'grade', 'e2', 'first');
  let owner = await change(initial, edits);
  owner = await applyPreparedPackageFormFeedbackImport(await preparePackageFormFeedbackImport(owner, round.id, member.id, feedback.json, policy), policy, true);
  expect((await inspectPackageFormReconciliation(owner, round.id, member.id, feedback.proposal)).kind).toBe('unavailable');
  await expect(preparePackageFormCorrection(owner, round.id, member.id, feedback.proposal.id, 'accepted', policy)).rejects.toThrow(/unavailable/);
  const rejected = await applyPreparedPackageFormCorrection(await preparePackageFormCorrection(owner, round.id, member.id, feedback.proposal.id, 'rejected', policy), policy, true);
  expect(getPackageRevision(rejected).members).toEqual(getPackageRevision(owner).members);
});
it('surfaces returned discussion overlaps and refuses stale collection instead of overwriting saved work', async () => {
  const { record, round, member, child } = await packageFormFixture();
  const field = (await packageFormReviewFields(member))[0], anchor = await capturePackageFormAnchor(member, field.target);
  const fieldReview = addPackageFormComment(undefined, anchor, 'Alex Example', 'Original captured discussion.');
  const initial = await savePackageMemberReview(record, round.id, { ...child, fieldReview }), feedback = await returned(initial);
  const local = { ...fieldReview, comments: fieldReview.comments.map(comment => ({ ...comment, resolved: true })) };
  const current = await savePackageMemberReview(initial, round.id, { ...child, fieldReview: local });
  const conflict = await preparePackageFormFeedbackImport(current, round.id, member.id, feedback.json, policy);
  expect(conflict.ready).toBe(false); expect(conflict.conflicts).toHaveLength(1);
  const prepared = await preparePackageFormFeedbackImport(current, round.id, member.id, feedback.json, policy, { [fieldReview.comments[0].id]: 'current' });
  expect(prepared.ready).toBe(true);
  const newer = await reviseActionPackage(current, getPackageRevision(current).members);
  await expect(applyPreparedPackageFormFeedbackImport(prepared, policy, true)).rejects.toThrow(/changed/);
  expect((await listActionPackages()).find(item => item.id === newer.id)).toEqual(newer);
});
