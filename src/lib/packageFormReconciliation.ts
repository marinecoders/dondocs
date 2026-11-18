import { actionPackageSchema, getPackageRevision, type ActionPackage } from './actionPackages';
import { inspectPackageFormAnchor, type PackageFormProposal } from './packageFormReview';
import type { PackageBindingValue } from './packageBindingTargets';
import { sameReviewStoredValue } from './documentsDb';
export interface PackageFormReconciliation {
  kind: 'current' | 'independent' | 'already-applied' | 'overlap' | 'unavailable';
  reviewed: PackageBindingValue; current?: PackageBindingValue; proposed: string | boolean;
  currentLabel?: string; message: string;
}
/** Only the exact field and stable row within the pinned definition participate in the three-way comparison. */
export async function inspectPackageFormReconciliation(input: ActionPackage, roundId: string, memberId: string, proposal: PackageFormProposal): Promise<PackageFormReconciliation> {
  const record = actionPackageSchema.parse(structuredClone(input)), round = record.reviewRounds?.find(round => round.id === roundId);
  const baseline = round?.baseline.members.find(member => member.id === memberId), member = getPackageRevision(record).members.find(member => member.id === memberId);
  const result = { reviewed: proposal.anchor.context, proposed: proposal.value };
  if (!round || !baseline || baseline.kind !== 'native' || member?.kind !== 'native' || member.source?.documentId !== baseline.source?.documentId)
    return { ...result, kind: 'unavailable', message: 'The exact captured form was removed or replaced. Keep the current form or reject this proposal.' };
  const inspection = await inspectPackageFormAnchor(member, proposal.anchor);
  if (!inspection.field) return { ...result, kind: 'unavailable', message: inspection.label };
  const common = { ...result, current: inspection.value, currentLabel: inspection.field.label };
  if (sameReviewStoredValue(inspection.value, proposal.value)) return { ...common, kind: 'already-applied', message: 'The latest saved answer already matches this proposal. Record a decision deliberately.' };
  if (sameReviewStoredValue(inspection.value, proposal.anchor.context)) return { ...common, kind: member.revisionId === baseline.revisionId ? 'current' : 'independent',
    message: member.revisionId === baseline.revisionId ? 'The exact reviewed answer is unchanged.' : 'Other form content changed. This exact answer is unchanged and independent edits will be preserved.' };
  return { ...common, kind: 'overlap', message: 'This answer changed after review. Keep the current answer or explicitly review a replacement for this exact current value.' };
}
