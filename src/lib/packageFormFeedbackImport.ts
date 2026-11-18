import { actionPackageSchema, commitActionPackage, type ActionPackage } from './actionPackages';
import { createPackageMemberReview } from './packageMemberReviews';
import { assertActivePackageReview, openPackageReview } from './packageReviewRounds';
import { parsePackageReviewReturn, inspectPackageReviewTransfer } from './packageReviewTransfer';
import { packageFormReviewSchema, type PackageFormComment } from './packageFormReview';
import { sameReviewStoredValue } from './documentsDb';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import type { ExportReview } from './preparedExport';

export interface PreparedPackageFormFeedbackImport {
  readonly ready: boolean; readonly label: string; readonly comments: number; readonly proposals: number;
  readonly reviews: readonly ExportReview[];
  readonly conflicts: readonly { id: string; label: string; current: PackageFormComment; returned: PackageFormComment }[];
}
const imports = new WeakMap<PreparedPackageFormFeedbackImport, { before: ActionPackage; after: ActionPackage; policy: string }>();
const freeze = <T,>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const key = (policy: PolicyResolution) => { if (policy.status !== 'ready') throw new Error(policy.message); return JSON.stringify(policy.policy); };
/** Collect exact returned form feedback without changing the current draft or deciding its answers. */
export async function preparePackageFormFeedbackImport(input: ActionPackage, roundId: string, memberId: string,
  json: string, policy: PolicyResolution, inputChoices: Record<string, 'current' | 'returned'> = {}): Promise<PreparedPackageFormFeedbackImport> {
  const before = actionPackageSchema.parse(structuredClone(input)), choices = structuredClone(inputChoices), identity = key(policy);
  const round = await openPackageReview(before, roundId); assertActivePackageReview(round);
  if (before.archived || round.ownerPackageId !== before.id) throw new Error('Open the unarchived owning review to collect returned form feedback.');
  const parsed = await parsePackageReviewReturn(json, before, roundId), incoming = parsed.memberReviews.find(child => child.binding.memberId === memberId);
  if (!incoming?.fieldReview) throw new Error('This return has no precise feedback for the selected captured form.');
  const existing = round.memberReviews?.find(child => child.binding.memberId === memberId) ?? await createPackageMemberReview(round, memberId);
  const fieldReview = packageFormReviewSchema.parse(structuredClone(existing.fieldReview ?? { version: 1, comments: [] }));
  const conflicts: Array<{ id: string; label: string; current: PackageFormComment; returned: PackageFormComment }> = [];
  for (const comment of incoming.fieldReview.comments) {
    const index = fieldReview.comments.findIndex(item => item.id === comment.id), current = fieldReview.comments[index];
    if (index < 0) { fieldReview.comments.push(comment); continue; }
    if (sameReviewStoredValue(current, comment)) continue;
    if (!sameReviewStoredValue(current.anchor, comment.anchor)) throw new Error('A returned comment changed its captured field identity. Ask for a new comment.');
    const choice = choices[comment.id];
    if (choice === 'returned') fieldReview.comments[index] = comment;
    else if (choice !== 'current') conflicts.push({ id: comment.id, label: comment.anchor.label, current, returned: comment });
  }
  for (const id of Object.keys(choices)) if (!incoming.fieldReview.comments.some(comment => comment.id === id)) throw new Error('A discussion choice does not belong to this returned form.');
  const proposals = [...fieldReview.proposals ?? []];
  for (const proposal of incoming.fieldReview.proposals ?? []) {
    const current = proposals.find(item => item.id === proposal.id);
    if (current && !sameReviewStoredValue(current, proposal)) throw new Error('A returned form proposal changed under an existing identity.');
    if (!current) proposals.push(proposal);
  }
  const child = { ...existing, fieldReview: packageFormReviewSchema.parse({ ...fieldReview, ...(proposals.length ? { proposals } : {}) }) };
  const nextRound = { ...round, memberReviews: [...round.memberReviews ?? []].filter(item => item.binding.memberId !== memberId).concat(child) };
  const after = actionPackageSchema.parse({ ...before, sequence: before.sequence + 1, reviewRounds: before.reviewRounds!.map(item => item.id === roundId ? nextRound : item) });
  const prepared = freeze({ ready: !conflicts.length, label: round.baseline.members.find(member => member.id === memberId)!.label,
    comments: incoming.fieldReview.comments.length, proposals: incoming.fieldReview.proposals?.length ?? 0,
    reviews: await inspectPackageReviewTransfer(parsed, policy), conflicts });
  if (!conflicts.length) imports.set(prepared, { before, after, policy: identity }); return prepared;
}
export async function applyPreparedPackageFormFeedbackImport(prepared: PreparedPackageFormFeedbackImport, policy: PolicyResolution,
  reviewed: boolean, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const value = imports.get(prepared), identity = key(policy);
  if (!value || value.policy !== identity || !prepared.ready || !reviewed) throw new Error('Resolve and review the exact returned form feedback before saving it.');
  if (key(await getExportDeploymentPolicy()) !== identity) throw new Error('Deployment settings changed. Review the form feedback again.');
  let error: unknown;
  const current = () => { try { signal?.throwIfAborted(); if (!isCurrent() || key(getExportDeploymentPolicySync()) !== identity) throw new Error('The form feedback or deployment settings changed.'); return true; } catch (cause) { error = cause; return false; } };
  try { const result = await commitActionPackage(value.before, value.after, signal, current); imports.delete(prepared); return result; }
  catch (cause) { throw error ?? cause; }
}
