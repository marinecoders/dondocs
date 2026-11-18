import { assertPackageRequirementsReady } from "./packageRequirements";
import {
  actionPackageSchema, commitActionPackage, getPackageRevision, newPackageId,
  packageReviewBindingSchema, packageReviewRevision, packageReviewRoundSchema,
  type ActionPackage, type PackageReviewRound, type PackageReviewBinding,
} from './actionPackages';
import { reviewPayloadDigest } from './reviewRounds';
import { sameReviewStoredValue } from './documentsDb';

export { packageReviewBindingSchema, packageReviewRoundSchema };
export type { PackageReviewRound, PackageReviewBinding };
export function packageReviewRoundStatus(round: PackageReviewRound): 'active' | 'closed' | 'superseded' {
  return round.lifecycle?.events.at(-1)?.state ?? 'active';
}
export function assertActivePackageReview(round: PackageReviewRound): void {
  if (packageReviewRoundStatus(round) !== 'active') throw new Error('This package review is closed or superseded. Reopen a closed review deliberately before collecting or applying feedback.');
}
/** Validate at load, resource import, backup and CAS; digest checks never confer local authority. */
export async function validatePackageReviewBaselines(record: ActionPackage): Promise<void> {
  const { validatePackageMemberReviews } = await import("./packageMemberReviews");
  const { validateReviewSuggestionState } = await import('./reviewSuggestions');
  for (const application of record.reviewApplications ?? []) {
    const round = record.reviewRounds!.find(round => round.id === application.roundId)!;
    await validatePackageMemberReviews({ ...round, memberReviews: application.feedback });
    for (const outcome of application.outcomes) {
      const child = application.feedback.find(child => child.binding.memberId === outcome.memberId)!;
      if (outcome.suggestions) {
        if (!child.nativeRound) throw new Error('Original PDF feedback cannot contain native decisions.');
        validateReviewSuggestionState(child.nativeRound, outcome.suggestions);
      }
    }
  }
  for (const round of record.reviewRounds ?? []) {
    await validatePackageMemberReviews(round);
    if (await reviewPayloadDigest(round.baseline) !== round.baselineDigest)
      throw new Error('The exact package review baseline digest does not match. Restore an intact workspace backup.');
    for (const [index, member] of round.baseline.members.entries())
      if (await reviewPayloadDigest(member) !== round.members[index].memberDigest)
        throw new Error('A package review member digest does not match its captured revision.');
  }
}
/** A detached owned copy; reading a historical review never changes the current package revision. */
export async function openPackageReview(input: ActionPackage, roundId: string): Promise<PackageReviewRound> {
  const record = actionPackageSchema.parse(structuredClone(input));
  await validatePackageReviewBaselines(record);
  const round = record.reviewRounds?.find(round => round.id === roundId);
  if (!round) throw new Error('This saved package review is unavailable.');
  const { validateActionPackageResources } = await import('./actionPackageTransfer');
  const { readPackageAsset } = await import('./actionPackageAssets');
  await validateActionPackageResources({ ...record, revisions: [round.baseline], currentRevisionId: round.revisionId,
    historyScope: 'selected-revision', reviewRounds: undefined, reviewApplications: undefined, workingCopies: undefined }, readPackageAsset);
  return structuredClone(round);
}
export function getPackageReviewBinding(round: PackageReviewRound, memberId: string): PackageReviewBinding {
  const parsed = packageReviewRoundSchema.parse(round);
  const binding = parsed.members.find(member => member.memberId === memberId);
  if (!binding) throw new Error('This member does not belong to the exact package review baseline.');
  return structuredClone(binding);
}
export async function startPackageReview(input: ActionPackage, revisionId = input.currentRevisionId,
  label = 'Package review', signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const record = actionPackageSchema.parse(structuredClone(input));
  signal?.throwIfAborted();
  if (record.archived) throw new Error('Reopen this archived package before starting a review.');
  const baseline = packageReviewRevision(getPackageRevision(record, revisionId));
  const { conditionalMembershipFindings } = await import('./packageConditionalSources');
  const incomplete = conditionalMembershipFindings(baseline);
  if (incomplete.length) throw new Error(incomplete.map(finding => finding.message).join(' '));
  if (!baseline.members.length) throw new Error('Add a saved member before starting a package review.');
  await assertPackageRequirementsReady(baseline, 'review', { signal });
  const id = newPackageId('package-review'), baselineDigest = await reviewPayloadDigest(baseline);
  const members = await Promise.all(baseline.members.map(async member => ({
    packageId: record.id, roundId: id, revisionId, baselineDigest,
    memberId: member.id, memberRevisionId: member.revisionId,
    memberDigest: await reviewPayloadDigest(member),
    assetDigest: member.kind === 'native' ? member.draft.sha256 : member.original.sha256,
  })));
  const round = packageReviewRoundSchema.parse({ kind: 'dondocs-package-review-round', version: 1,
    id, packageId: record.id, ownerPackageId: record.id, revisionId, label,
    createdAt: Math.max(Date.now(), baseline.createdAt, ...(record.reviewRounds ?? []).map(round => round.createdAt + 1)),
    baseline, baselineDigest, members });
  return commitActionPackage(record, { ...record, sequence: record.sequence + 1,
    reviewRounds: [...record.reviewRounds ?? [], round] }, signal, isCurrent);
}
/** All mutations use parent-package CAS; document IDs are never used as package authority. */
export async function transitionPackageReview(input: ActionPackage, roundId: string,
  transition: 'close' | 'reopen' | 'supersede', replacementRoundId?: string,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const record = actionPackageSchema.parse(structuredClone(input));
  const round = record.reviewRounds?.find(round => round.id === roundId);
  if (!round || round.ownerPackageId !== record.id) throw new Error('Only the owning package can change this review.');
  const status = packageReviewRoundStatus(round);
  if (transition === 'reopen' ? status !== 'closed' : status !== 'active') throw new Error('The package review state changed. Reopen the saved package and retry.');
  const replacement = record.reviewRounds?.find(round => round.id === replacementRoundId);
  if (transition === 'supersede' && (!replacement || replacement.id === round.id || replacement.ownerPackageId !== record.id
    || replacement.createdAt <= round.createdAt || packageReviewRoundStatus(replacement) !== 'active'))
    throw new Error('Choose a newer active review belonging to this package.');
  const next = packageReviewRoundSchema.parse({ ...round, lifecycle: { events: [...round.lifecycle?.events ?? [], {
    id: newPackageId('package-review-state'), state: transition === 'close' ? 'closed' : transition === 'reopen' ? 'active' : 'superseded',
    changedAt: Math.max(Date.now(), round.createdAt, round.lifecycle?.events.at(-1)?.changedAt ?? 0),
    ...(transition === 'supersede' ? { replacementRoundId } : {}),
  }] } });
  return commitActionPackage(record, { ...record, sequence: record.sequence + 1,
    reviewRounds: record.reviewRounds!.map(value => value.id === roundId ? next : value) }, signal, isCurrent);
}
/** Used by native child feedback and portable returns; never infer a member from text. */
export function assertPackageReviewBinding(round: PackageReviewRound, binding: PackageReviewBinding): void {
  const expected = getPackageReviewBinding(round, binding.memberId);
  if (!sameReviewStoredValue(expected, packageReviewBindingSchema.parse(binding))) throw new Error('Feedback belongs to a different exact package revision or member.');
}
