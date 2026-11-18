import { getPackageRevision, type ActionPackage, type PackageRevision } from './actionPackages';
import { capturePackageFormAnchor, inspectPackageFormAnchor } from './packageFormReview';
import { sameReviewStoredValue } from './documentsDb';
import { patchPackageBindingTarget } from './packageBindingTargets';
function restoredContents(revision: PackageRevision) {
  const { id: _id, parentId: _parent, createdAt: _created, outputs: _outputs, ...contents } = revision;
  return contents;
}
/** Recovery/import validates the recorded decision against its exact saved states. */
export async function validatePackageFieldReviewApplications(record: ActionPackage): Promise<void> {
  for (const application of record.fieldReviewApplications ?? []) {
    const round = record.reviewRounds?.find(round => round.id === application.roundId);
    const baseline = round?.baseline.members.find(member => member.id === application.memberId);
    if (!baseline || baseline.kind !== 'native') throw new Error('A form decision lost its exact reviewed form.');
    const proposal = round?.memberReviews?.find(child => child.binding.memberId === application.memberId)
      ?.fieldReview?.proposals?.find(proposal => proposal.id === application.proposal.id);
    if (!proposal || !sameReviewStoredValue(proposal, application.proposal))
      throw new Error('A form decision does not match its exact retained review proposal.');
    const anchor = await capturePackageFormAnchor(baseline, application.proposal.anchor.target);
    if (!sameReviewStoredValue(anchor, application.proposal.anchor)) throw new Error('A form decision has inconsistent captured answer context.');
    await patchPackageBindingTarget(baseline.session, anchor.target, anchor.context, application.proposal.value);
    const before = getPackageRevision(record, application.beforeRevisionId), after = getPackageRevision(record, application.revisionId);
    if (after.parentId !== before.id) throw new Error('A form decision is not associated with its exact child revision.');
    if (application.action === 'undo') {
      const decided = record.fieldReviewApplications?.find(item => item.id === application.undoOf);
      if (!decided || application.mode !== decided.mode || application.beforeRevisionId !== decided.revisionId
        || !sameReviewStoredValue(application.before, decided.after) || !sameReviewStoredValue(application.after, decided.before)
        || !sameReviewStoredValue(restoredContents(after), restoredContents(getPackageRevision(record, decided.beforeRevisionId))))
        throw new Error('The form decision Undo does not restore its exact prior package contents.');
    }
    const left = await inspectPackageFormAnchor(before.members.find(member => member.id === application.memberId), anchor);
    const right = await inspectPackageFormAnchor(after.members.find(member => member.id === application.memberId), anchor);
    if (!sameReviewStoredValue(left.value ?? null, application.before) || !sameReviewStoredValue(right.value ?? null, application.after)
      || application.action === 'accepted' && (!right.field || !sameReviewStoredValue(application.after, application.resolution?.value ?? application.proposal.value))
      || application.action === 'accepted' && application.resolution && !sameReviewStoredValue(application.resolution.expectedCurrent, application.before)
      || application.action === 'rejected' && !sameReviewStoredValue(before.members, after.members))
      throw new Error('The form decision does not describe its captured before and after answers.');
  }
}
