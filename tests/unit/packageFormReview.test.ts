import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { packageFormFixture } from '../_helpers/packageFormReviewFixture';
import { capturePackageFormAnchor, inspectPackageFormAnchor, addPackageFormComment, packageFormReviewFields } from '@/lib/packageFormReview';
import { savePackageMemberReview } from '@/lib/packageMemberReviews';
import { listActionPackages } from '@/lib/actionPackages';
import { buildPackageReviewReturn, buildPackageReviewerCopy, packageReviewTransferFile, parsePackageReviewTransfer } from '@/lib/packageReviewTransfer';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { transitionPackageReview } from '@/lib/packageReviewRounds';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
async function anchored() {
  const data = await packageFormFixture();
  const field = (await packageFormReviewFields(data.member)).find(field => field.target.kind === 'configured-form' && field.target.row?.rowId === 'first' && field.target.fieldId === 'grade')!;
  const anchor = await capturePackageFormAnchor(data.member, field.target);
  return { ...data, anchor };
}
it('retains exact stable row identity through reorder and distinguishes changed, deleted and ambiguous targets', async () => {
  const { member, anchor } = await anchored(), changed = structuredClone(member);
  changed.session.genericForm!.rows.roster.reverse();
  expect((await inspectPackageFormAnchor(changed, anchor)).state).toBe('current');
  changed.session.genericForm!.rows.roster[1].answers.grade = 'e2';
  expect((await inspectPackageFormAnchor(changed, anchor)).state).toBe('changed');
  changed.session.genericForm!.rows.roster.pop();
  expect((await inspectPackageFormAnchor(changed, anchor)).state).toBe('unavailable');
  changed.session.genericForm!.rows.roster.push({ id: 'first', answers: { grade: 'e1' } }, { id: 'first', answers: { grade: 'e1' } });
  expect((await inspectPackageFormAnchor(changed, anchor)).state).toBe('unavailable');
});
it('rejects even same-version definition changes and excludes signature/system fields', async () => {
  const { member, anchor } = await anchored(), changed = structuredClone(member);
  changed.session.genericForm!.definition.fields.name.label = 'A changed field label';
  expect((await inspectPackageFormAnchor(changed, anchor)).state).toBe('unavailable');
  expect((await packageFormReviewFields(member)).some(field => field.target.kind === 'configured-form' && field.target.fieldId === 'signature')).toBe(false);
});
it('persists exact field comments and carries them through real reviewer copies and returns', async () => {
  const { record, round, member, child, anchor } = await anchored();
  const fieldReview = addPackageFormComment(undefined, anchor, 'Alex Example', 'Check this exact fictional roster grade.', 'required-correction');
  const saved = await savePackageMemberReview(record, round.id, { ...child, fieldReview });
  expect((await listActionPackages()).find(item => item.id === saved.id)).toEqual(saved);
  for (const build of [buildPackageReviewerCopy, buildPackageReviewReturn]) {
    const text = await packageReviewTransferFile(await build(saved, round.id, policy), policy), parsed = await parsePackageReviewTransfer(text);
    expect(parsed.memberReviews.find(item => item.binding.memberId === member.id)?.fieldReview).toEqual(fieldReview);
  }
  expect(saved.revisions).toEqual(record.revisions);
});
it('rejects forged captured context, closed rounds, cancelled writes and stale package saves', async () => {
  const { record, round, child, anchor } = await anchored();
  const fieldReview = addPackageFormComment(undefined, anchor, 'Alex Example', 'Synthetic comment.');
  await expect(savePackageMemberReview(record, round.id, { ...child, fieldReview: { ...fieldReview, comments: [{ ...fieldReview.comments[0], anchor: { ...anchor, context: 'e2' } }] } })).rejects.toThrow(/reviewed answer/);
  const cancelled = new AbortController(); cancelled.abort();
  await expect(savePackageMemberReview(record, round.id, { ...child, fieldReview }, cancelled.signal)).rejects.toThrow();
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
  const saved = await savePackageMemberReview(record, round.id, { ...child, fieldReview });
  await expect(savePackageMemberReview(record, round.id, child)).rejects.toThrow(/changed/);
  const closed = await transitionPackageReview(saved, round.id, 'close');
  await expect(savePackageMemberReview(closed, round.id, { ...child, fieldReview })).rejects.toThrow(/closed/);
});
it('checks multiline form feedback markings at the actual portable transfer boundary', async () => {
  const { record, round, child, anchor } = await anchored();
  const saved = await savePackageMemberReview(record, round.id, { ...child, fieldReview: addPackageFormComment(undefined, anchor, 'Alex Example', 'Synthetic note.\n(S) Synthetic restricted example.') });
  await expect(buildPackageReviewReturn(saved, round.id, policy)).rejects.toThrow(/markings|levels/);
});
