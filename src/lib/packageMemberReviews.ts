import { validatePackagePdfFeedback } from './packagePdfReview';
import { validatePackageFormFeedback } from './packageFormReview';
import { actionPackageSchema, commitActionPackage, packageMemberReviewSchema, type ActionPackage, type PackageMemberReview, type PackageReviewBinding, type PackageReviewRound } from './actionPackages';
import { assertActivePackageReview, assertPackageReviewBinding, getPackageReviewBinding, openPackageReview } from './packageReviewRounds';
import { reviewPayloadDigest, type ReviewRound } from './reviewRounds';
import { emptyReviewSuggestionState, validateReviewSuggestionState } from './reviewSuggestions';
import { supportsReviewComments } from './reviewCommentTargets';
import { sameReviewStoredValue } from './documentsDb';

export type { PackageMemberReview };
/** Stable across independent reviewer browsers. The entire parent/member binding participates. */
async function nativeIdentity(binding: PackageReviewBinding): Promise<string> {
  const hash = await reviewPayloadDigest(binding);
  return `review_${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export async function createPackageMemberReview(round: PackageReviewRound, memberId: string): Promise<PackageMemberReview> {
  const binding = getPackageReviewBinding(round, memberId);
  const member = round.baseline.members.find(member => member.id === memberId)!;
  if (member.kind === 'original' || !supportsReviewComments(member.session)) return { binding, comments: { version: 1, threads: [] } };
  const baseline = { ts: member.session.timestamp, session: structuredClone(member.session) };
  const nativeRound: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: await nativeIdentity(binding),
    createdAt: baseline.ts, label: member.label, sourceDocumentId: member.id,
    baselineDigest: await reviewPayloadDigest(baseline), baseline };
  return packageMemberReviewSchema.parse({ binding, nativeRound,
    comments: structuredClone(member.session.reviewComments ?? { version: 1, threads: [] }),
    suggestions: emptyReviewSuggestionState(nativeRound) });
}
/** Validate immutable native adapter identity, exact captured timestamp/model, and proposal targets. */
export async function validatePackageMemberReviews(round: PackageReviewRound, read?: (asset: import('./actionPackages').PackageAsset) => Promise<ArrayBuffer>, pdfCache?: import('./packagePdfReview').PackagePdfValidationCache): Promise<void> {
  for (const child of round.memberReviews ?? []) {
    assertPackageReviewBinding(round, child.binding);
    await validatePackageFormFeedback(round, child);
    await validatePackagePdfFeedback(round, child, read, pdfCache);
    const expected = await createPackageMemberReview(round, child.binding.memberId);
    if (!sameReviewStoredValue(expected.nativeRound, child.nativeRound)) throw new Error('The native child review does not match its exact captured package member.');
    if (child.nativeRound) {
      const state = validateReviewSuggestionState(child.nativeRound, child.suggestions);
      if (state.decisions.length) throw new Error('Package feedback cannot contain author decisions.');
    }
  }
}
export async function preparePackageReviewMember(input: ActionPackage, roundId: string, memberId: string,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<{ record: ActionPackage; child: PackageMemberReview }> {
  const record = actionPackageSchema.parse(structuredClone(input));
  const round = await openPackageReview(record, roundId); assertActivePackageReview(round);
  const retained = round.memberReviews?.find(child => child.binding.memberId === memberId);
  if (retained) return { record, child: structuredClone(retained) };
  const child = await createPackageMemberReview(round, memberId);
  const next = await savePackageMemberReview(record, roundId, child, signal, isCurrent);
  return { record: next, child };
}
/** Only parent-package CAS writes. Never activate a document or write the library draft. */
export async function savePackageMemberReview(input: ActionPackage, roundId: string, value: PackageMemberReview,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const record = actionPackageSchema.parse(structuredClone(input));
  const round = record.reviewRounds?.find(round => round.id === roundId);
  if (!round) throw new Error('The saved package review is unavailable.');
  assertActivePackageReview(round); assertPackageReviewBinding(round, value.binding);
  const child = packageMemberReviewSchema.parse(structuredClone(value));
  const children = round.memberReviews ?? [];
  const nextRound = { ...round, memberReviews: [...children.filter(item => item.binding.memberId !== child.binding.memberId), child] };
  await validatePackageMemberReviews(nextRound);
  return commitActionPackage(record, { ...record, sequence: record.sequence + 1,
    reviewRounds: record.reviewRounds!.map(item => item.id === roundId ? nextRound : item) }, signal, isCurrent);
}
