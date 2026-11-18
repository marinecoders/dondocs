import { actionPackageSchema, commitActionPackage, getPackageRevision, newPackageId, type ActionPackage, type NativePackageMember, type PackageRevision } from './actionPackages';
import { assertActivePackageReview, openPackageReview } from './packageReviewRounds';
import { parsePackageReviewReturn, inspectPackageReviewTransfer } from './packageReviewTransfer';
import { inspectPackageFormAnchor, packageFormFeedbackText, type PackageFormProposal, type PackageFieldReviewApplication } from './packageFormReview';
import { packageBindingTargetKey, patchPackageBindingDraftFields, type PackageBindingValue } from './packageBindingTargets';
import { readPackageMemberDraft, readPackageAsset } from './actionPackageAssets';
import { sameReviewStoredValue, type StoredAttachment } from './documentsDb';
import { captureLinkedPackageChanges, preserveUnchangedCitations } from './packageLinkedUpdates';
import { formatPackageFactForField } from './packageFieldBindings';
import { packageFactSchema } from './packageInformation';
import { portableResourceDigest } from './portableResources';
import { reviewPackageNative, reviewPackageOriginal, reviewPackageText } from './actionPackageDisclosure';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';
import type { PackageUpdateChoices, PackageUpdatePreview } from './packageUpdates';

export interface PackageFormCorrectionOptions {
  mode?: 'local' | 'shared'; sharedValue?: PackageBindingValue; choices?: PackageUpdateChoices; returnedJson?: string;
}
export interface PreparedPackageFormCorrection {
  readonly ready: boolean; readonly issues: readonly string[]; readonly reviews: readonly ExportReview[];
  readonly changes: readonly PackageUpdatePreview[]; readonly proposal: PackageFormProposal;
  readonly before: PackageBindingValue; readonly after: PackageBindingValue;
  readonly action: 'accepted' | 'rejected' | 'undo'; readonly mode: 'local' | 'shared';
}
interface Capture { before: ActionPackage; after: ActionPackage; attachments: StoredAttachment[]; policy: string }
const preparations = new WeakMap<PreparedPackageFormCorrection, Capture>();
const policyKey = (policy: PolicyResolution) => { if (policy.status !== 'ready') throw new Error(policy.message); return JSON.stringify(policy.policy); };
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export function latestPackageFormDecision(record: ActionPackage, roundId: string, memberId: string, proposalId: string) {
  const receipts = record.fieldReviewApplications ?? [], undone = new Set(receipts.flatMap(receipt => receipt.undoOf ? [receipt.undoOf] : []));
  return [...receipts].reverse().find(receipt => receipt.roundId === roundId && receipt.memberId === memberId
    && receipt.proposal.id === proposalId && receipt.action !== 'undo' && !undone.has(receipt.id));
}
function assertOwner(record: ActionPackage, roundId: string) {
  const round = record.reviewRounds?.find(round => round.id === roundId);
  if (record.archived || !round || round.ownerPackageId !== record.id || record.reviewRounds?.some(round => round.ownerPackageId === undefined))
    throw new Error('Open the unarchived owning package review to decide form feedback.');
  assertActivePackageReview(round); return round;
}
function stageMember(previous: NativePackageMember, draft: Record<string, unknown>, session: NativePackageMember['session']) {
  const data = new TextEncoder().encode(JSON.stringify(draft)).buffer;
  return portableResourceDigest(data).then(sha256 => {
    const asset = { ...previous.draft, id: newPackageId('asset'), size: data.byteLength, sha256 };
    return { member: { ...previous, revisionId: newPackageId('member-revision'), session, draft: asset }, attachment: { ...asset, data } };
  });
}
/** Prepare exact captured proposal decisions without changing storage or active document state. */
export async function preparePackageFormCorrection(input: ActionPackage, roundId: string, memberId: string, proposalId: string,
  action: 'accepted' | 'rejected', policy: PolicyResolution, inputOptions: PackageFormCorrectionOptions = {}, signal?: AbortSignal): Promise<PreparedPackageFormCorrection> {
  const record = actionPackageSchema.parse(structuredClone(input)), options = structuredClone(inputOptions), identity = policyKey(policy);
  if (!['accepted', 'rejected'].includes(action)) throw new Error('Choose an accept or reject decision.');
  const sourceRound = assertOwner(record, roundId); signal?.throwIfAborted();
  const round = await openPackageReview(record, roundId);
  let child = round.memberReviews?.find(child => child.binding.memberId === memberId), reviews: ExportReview[] = [];
  if (options.returnedJson) {
    const returned = await parsePackageReviewReturn(options.returnedJson, record, roundId);
    child = returned.memberReviews.find(child => child.binding.memberId === memberId);
    reviews = await inspectPackageReviewTransfer(returned, policy);
  }
  const proposal = child?.fieldReview?.proposals?.find(proposal => proposal.id === proposalId);
  if (!proposal) throw new Error('The exact form proposal is unavailable.');
  if (latestPackageFormDecision(record, roundId, memberId, proposalId)) throw new Error('This form proposal already has a decision. Undo its saved decision deliberately first.');
  const current = getPackageRevision(record), member = current.members.find(member => member.id === memberId);
  const inspection = await inspectPackageFormAnchor(member, proposal.anchor);
  const mode = options.mode ?? 'local';
  if (!['local', 'shared'].includes(mode)) throw new Error('Choose a supported correction scope.');
  let revision: PackageRevision = { ...structuredClone(current), id: newPackageId('revision'), parentId: current.id, createdAt: Math.max(Date.now(), current.createdAt, sourceRound.createdAt), outputs: [] as typeof current.outputs };
  const issues: string[] = [], attachments: StoredAttachment[] = [], changes: PackageUpdatePreview[] = [];
  if (action === 'accepted') {
    const reviewedMember = round.baseline.members.find(member => member.id === memberId);
    if (member?.kind === 'native' && reviewedMember?.kind === 'native' && member.source?.documentId !== reviewedMember.source?.documentId)
      throw new Error('This member now captures another source document. Review the replacement form separately.');
    if (member?.kind !== 'native' || !inspection.field) throw new Error(inspection.label);
    if (inspection.state !== 'current') throw new Error('The answer changed after review. Reconcile the current value before accepting this proposal.');
    if (mode === 'local') {
      const { draft } = await readPackageMemberDraft(member), patched = await patchPackageBindingDraftFields(draft,
        [{ target: proposal.anchor.target, expected: inspection.value!, value: proposal.value }]);
      const staged = await stageMember(member, patched.draft, patched.session); attachments.push(staged.attachment);
      revision.members = revision.members.map(item => item.id === memberId ? staged.member : item);
      if (revision.bindings) revision.bindings.items = revision.bindings.items.map(binding => binding.memberId === memberId
        && packageBindingTargetKey(binding.target) === packageBindingTargetKey(proposal.anchor.target) ? { ...binding, mode: 'override' } : binding);
      reviews.push(reviewPackageNative(member.session, member.label, policy, draft as typeof member.session), reviewPackageNative(patched.session, member.label, policy, patched.draft as unknown as typeof member.session));
      await preserveUnchangedCitations(revision);
    } else {
      const binding = revision.bindings?.items.find(binding => binding.memberId === memberId && packageBindingTargetKey(binding.target) === packageBindingTargetKey(proposal.anchor.target));
      const fact = revision.information?.facts.find(fact => fact.id === binding?.factId);
      if (!binding || !fact || options.sharedValue === undefined) throw new Error('Choose the linked package value and enter its deliberately reviewed replacement.');
      const nextFact = packageFactSchema.parse({ ...fact, value: options.sharedValue, source: { kind: 'entered' } });
      if (!sameReviewStoredValue(formatPackageFactForField(nextFact, inspection.field, binding.format), proposal.value))
        throw new Error('The entered package value does not format to this proposed form answer.');
      revision.information!.facts = revision.information!.facts.map(item => item.id === fact.id ? nextFact : item);
      const result = await captureLinkedPackageChanges(current, revision, { ...options.choices, [binding.id]: 'reconnect' }, policy, signal);
      revision = result.revision; issues.push(...result.issues); changes.push(...result.changes); attachments.push(...result.attachments); reviews.push(...result.reviews);
    }
  }
  signal?.throwIfAborted();
  const before = inspection.value ?? null, after = action === 'accepted' ? proposal.value : before;
  const receipt: PackageFieldReviewApplication = { id: newPackageId('form-decision'), roundId, memberId, proposal: structuredClone(proposal),
    beforeRevisionId: current.id, revisionId: revision.id, createdAt: revision.createdAt, action, mode, before, after };
  reviews.push(reviewPackageText(packageFormFeedbackText({ proposal, receipt }), 'Form correction and captured review', policy));
  const next = actionPackageSchema.parse({ ...record, sequence: record.sequence + 1, currentRevisionId: revision.id, revisions: [...record.revisions, revision],
    fieldReviewApplications: [...record.fieldReviewApplications ?? [], receipt] });
  const prepared = freeze({ ready: !issues.length, issues, reviews, changes, proposal: structuredClone(proposal), before, after, action, mode });
  if (!issues.length) preparations.set(prepared, { before: record, after: next, attachments, policy: identity });
  return prepared;
}
/** Undo restores a complete saved revision; review every restored input, including downstream values. */
async function restoredRevisionReviews(revision: PackageRevision, policy: PolicyResolution): Promise<ExportReview[]> {
  const reviews = [reviewPackageText(packageFormFeedbackText({ ...revision,
    members: revision.members.map(member => member.kind === 'native' ? { ...member, session: undefined } : member) }), 'Restored package context', policy)];
  for (const member of revision.members) {
    if (member.kind === 'native') {
      const { draft } = await readPackageMemberDraft(member);
      reviews.push(reviewPackageNative(member.session, member.label, policy, draft as typeof member.session));
    } else reviews.push(await reviewPackageOriginal(await readPackageAsset(member.original), member.label, policy));
  }
  if (revision.templateState) {
    const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readPackageAsset(revision.templateState.source)));
    reviews.push(reviewPackageText(packageFormFeedbackText(raw), 'Restored pinned action template', policy));
  }
  return reviews;
}
export async function preparePackageFormDecisionUndo(input: ActionPackage, decisionId: string, policy: PolicyResolution): Promise<PreparedPackageFormCorrection> {
  const record = actionPackageSchema.parse(structuredClone(input)), identity = policyKey(policy), receipt = record.fieldReviewApplications?.find(receipt => receipt.id === decisionId);
  if (!receipt || receipt.action === 'undo' || record.fieldReviewApplications?.some(item => item.undoOf === receipt.id)) throw new Error('Choose a current form decision that has not been undone.');
  assertOwner(record, receipt.roundId);
  if (record.currentRevisionId !== receipt.revisionId) throw new Error('Newer work exists. Keep it and review a new correction instead of replacing it with Undo.');
  const previous = getPackageRevision(record, receipt.beforeRevisionId), revision = { ...structuredClone(previous), id: newPackageId('revision'), parentId: record.currentRevisionId, createdAt: Math.max(Date.now(), getPackageRevision(record).createdAt), outputs: [] };
  const undo: PackageFieldReviewApplication = { ...receipt, id: newPackageId('form-decision'), beforeRevisionId: record.currentRevisionId, revisionId: revision.id,
    createdAt: revision.createdAt, action: 'undo', undoOf: receipt.id, before: receipt.after, after: receipt.before };
  const next = actionPackageSchema.parse({ ...record, sequence: record.sequence + 1, currentRevisionId: revision.id, revisions: [...record.revisions, revision], fieldReviewApplications: [...record.fieldReviewApplications!, undo] });
  const prepared = freeze({ ready: true, issues: [], changes: [], reviews: [reviewPackageText(packageFormFeedbackText(undo), 'Undo form correction', policy), ...await restoredRevisionReviews(revision, policy)],
    proposal: receipt.proposal, before: receipt.after, after: receipt.before, action: 'undo' as const, mode: receipt.mode });
  preparations.set(prepared, { before: record, after: next, attachments: [], policy: identity }); return prepared;
}
export async function applyPreparedPackageFormCorrection(prepared: PreparedPackageFormCorrection, policy: PolicyResolution, reviewed: boolean,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const capture = preparations.get(prepared), identity = policyKey(policy);
  if (!capture || capture.policy !== identity || !prepared.ready || !reviewed) throw new Error('Prepare and review the exact form correction before applying it.');
  if (policyKey(await getExportDeploymentPolicy()) !== identity) throw new Error('Deployment settings changed. Review this correction again.');
  signal?.throwIfAborted();
  let guardError: unknown;
  const current = () => { try { signal?.throwIfAborted(); if (!isCurrent() || policyKey(getExportDeploymentPolicySync()) !== identity) throw new Error('This correction or its deployment settings are no longer current.'); return true; } catch (cause) { guardError = cause; return false; } };
  try {
    const result = await commitActionPackage(capture.before, capture.after, signal, current, capture.attachments);
    preparations.delete(prepared); return result;
  } catch (cause) { throw guardError ?? cause; }
}
