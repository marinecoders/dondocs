import type { PackageMember, PackageMemberReview, PackageReviewRound } from './actionPackages';
import { listPackageBindingFields, packageBindingTargetKey, type PackageBindingField, type PackageBindingTarget } from './packageBindingTargets';
import { packageFormAnchorSchema, packageFormReviewSchema, packageFormProposalSchema, type PackageFormProposal, type PackageFormAnchor, type PackageFormReview } from './packageFormReviewModel';
import { sameReviewStoredValue } from './documentsDb';
import type { FeedbackCategory } from './reviewFeedback';
export * from './packageFormReviewModel';

export async function packageFormReviewFields(member: PackageMember): Promise<PackageBindingField[]> {
  return member.kind === 'native' && member.session.documentCategory === 'forms' ? listPackageBindingFields(member) : [];
}
export async function capturePackageFormAnchor(member: PackageMember, target: PackageBindingTarget): Promise<PackageFormAnchor> {
  const key = packageBindingTargetKey(target), matches = (await packageFormReviewFields(member)).filter(field => packageBindingTargetKey(field.target) === key);
  if (matches.length !== 1) throw new Error('The exact form field or row is unavailable or ambiguous.');
  const field = matches[0];
  return packageFormAnchorSchema.parse({ target: field.target, label: field.label, kind: field.kind, context: field.value });
}
export async function inspectPackageFormAnchor(member: PackageMember | undefined, input: PackageFormAnchor): Promise<{
  state: 'current' | 'changed' | 'unavailable'; label: string; value?: PackageBindingField['value']; field?: PackageBindingField;
}> {
  const anchor = packageFormAnchorSchema.parse(input);
  if (!member) return { state: 'unavailable', label: `${anchor.label}: the captured form is no longer included.` };
  const key = packageBindingTargetKey(anchor.target), matches = (await packageFormReviewFields(member)).filter(field => packageBindingTargetKey(field.target) === key);
  if (matches.length !== 1 || matches[0].kind !== anchor.kind)
    return { state: 'unavailable', label: `${anchor.label}: the exact field, row or pinned definition is unavailable.` };
  const field = matches[0], current = sameReviewStoredValue(field.value, anchor.context);
  return { state: current ? 'current' : 'changed', label: current ? anchor.label : `${anchor.label}: the answer changed since this review.`, value: field.value, field };
}
export function addPackageFormComment(input: PackageFormReview | undefined, anchor: PackageFormAnchor,
  author: string, text: string, category: FeedbackCategory = 'question'): PackageFormReview {
  const review = packageFormReviewSchema.parse(structuredClone(input ?? { version: 1, comments: [] }));
  review.comments.push({ id: crypto.randomUUID(), anchor: packageFormAnchorSchema.parse(anchor), category, resolved: false,
    messages: [{ id: crypto.randomUUID(), author, text, createdAt: new Date().toISOString() }] });
  return packageFormReviewSchema.parse(review);
}
export async function validatePackageFormFeedback(round: PackageReviewRound, child: PackageMemberReview): Promise<void> {
  if (!child.fieldReview) return;
  const member = round.baseline.members.find(member => member.id === child.binding.memberId);
  if (!member || member.kind !== 'native' || member.session.documentCategory !== 'forms') throw new Error('Field feedback requires an exact captured form.');
  for (const comment of [...child.fieldReview.comments, ...(child.fieldReview.proposals ?? [])]) {
    const found = await capturePackageFormAnchor(member, comment.anchor.target);
    if (!sameReviewStoredValue(found, comment.anchor)) throw new Error('Form feedback does not match the reviewed answer and pinned definition.');
    if ('value' in comment) {
      const { patchPackageBindingTarget } = await import('./packageBindingTargets');
      await patchPackageBindingTarget(member.session, comment.anchor.target, comment.anchor.context, comment.value);
    }
  }
}

export async function addPackageFormProposal(member: PackageMember, input: PackageFormReview | undefined, anchor: PackageFormAnchor,
  author: string, value: string | boolean, reason?: string): Promise<PackageFormReview> {
  const found = await capturePackageFormAnchor(member, anchor.target);
  if (!sameReviewStoredValue(found, anchor) || member.kind !== 'native') throw new Error('The proposal must use its exact captured form answer.');
  const { patchPackageBindingTarget } = await import('./packageBindingTargets');
  await patchPackageBindingTarget(member.session, anchor.target, anchor.context, value);
  const proposal: PackageFormProposal = packageFormProposalSchema.parse({ id: crypto.randomUUID(), anchor, author, value, reason, createdAt: new Date().toISOString() });
  const review = packageFormReviewSchema.parse(structuredClone(input ?? { version: 1, comments: [] }));
  return packageFormReviewSchema.parse({ ...review, proposals: [...review.proposals ?? [], proposal] });
}
