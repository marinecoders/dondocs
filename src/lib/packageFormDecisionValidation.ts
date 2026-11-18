import { getPackageRevision, type ActionPackage } from './actionPackages';
import { capturePackageFormAnchor, inspectPackageFormAnchor } from './packageFormReview';
import { sameReviewStoredValue } from './documentsDb';
import { patchPackageBindingTarget } from './packageBindingTargets';
/** Recovery/import validates the recorded decision against its exact saved states. */
export async function validatePackageFieldReviewApplications(record: ActionPackage): Promise<void> {
  for (const application of record.fieldReviewApplications ?? []) {
    const round = record.reviewRounds?.find(round => round.id === application.roundId);
    const baseline = round?.baseline.members.find(member => member.id === application.memberId);
    if (!baseline || baseline.kind !== 'native') throw new Error('A form decision lost its exact reviewed form.');
    const anchor = await capturePackageFormAnchor(baseline, application.proposal.anchor.target);
    if (!sameReviewStoredValue(anchor, application.proposal.anchor)) throw new Error('A form decision has inconsistent captured answer context.');
    await patchPackageBindingTarget(baseline.session, anchor.target, anchor.context, application.proposal.value);
    const before = getPackageRevision(record, application.beforeRevisionId), after = getPackageRevision(record, application.revisionId);
    if (after.parentId !== before.id) throw new Error('A form decision is not associated with its exact child revision.');
    const left = await inspectPackageFormAnchor(before.members.find(member => member.id === application.memberId), anchor);
    const right = await inspectPackageFormAnchor(after.members.find(member => member.id === application.memberId), anchor);
    if (!sameReviewStoredValue(left.value ?? null, application.before) || !sameReviewStoredValue(right.value ?? null, application.after)
      || application.action === 'accepted' && (!right.field || !sameReviewStoredValue(application.after, application.proposal.value))
      || application.action === 'rejected' && !sameReviewStoredValue(before.members, after.members))
      throw new Error('The form decision does not describe its captured before and after answers.');
  }
}
