import { reviewPackageSigningMetadata } from './actionPackageDisclosure';
import { reviewPackageScans } from './actionPackageDisclosure';
import { assertReviewStructureNewIdsAvailable } from './reviewStructureSuggestions';
import { paragraphCommentIds } from './paragraphIdentity';
import type { ReviewStructureTarget } from './reviewStructureSuggestions';
import type { SerializedSession } from '@/stores/documentStore';
import { actionPackageSchema, commitActionPackage, getPackageRevision, listActionPackages, newPackageId,
  type ActionPackage, type NativePackageMember, type PackageMember } from './actionPackages';
import { assertActivePackageReview, assertPackageReviewBinding } from './packageReviewRounds';
import { inspectPackageReviewTransfer, parsePackageReviewReturn, type ParsedPackageReviewTransfer } from './packageReviewTransfer';
import { appendReviewSuggestions, emptyReviewSuggestionState, inspectReviewSuggestion, latestReviewSuggestionDecision,
  planReviewSuggestionDecision, reviewStructureReservedIds, type ReviewSuggestionResolution, type ReviewSuggestionState } from './reviewSuggestions';
import { normalizeReturnedRangeComments, transformRangeComments } from './reviewCommentRanges';
import { mergeReturnedComments, type ReviewReturnChoice, type ReviewCommentMerge } from './reviewCommentMerge';
import { canonicalReviewPayload } from './reviewRounds';
import { sameReviewStoredValue, type StoredAttachment } from './documentsDb';
import { readPackageAsset } from './actionPackageAssets';
import { validatePackageDraft } from './actionPackageDraft';
import { packageCitationCandidates, packageCitationOccurrences } from './packageCitations';
import { packageCitationReadiness } from './packageCitationRepair';
import { portableResourceDigest } from './portableResources';
import { newAttachmentId, withAttachmentStaging } from './attachments';
import { reviewPackageNative, reviewPackageText, reviewPackageReviewMetadata, reviewPackageInformation, reviewPackageBindings, reviewPackageConsistency, reviewPackageWork } from './actionPackageDisclosure';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { classificationBannerLevel } from './detectClassification';
import { classificationRank, deriveOverallClassLevel } from './overallClassification';
import { captureChangeReport, prepareChangeReport } from './changeReport';
import type { ReviewComments } from './reviewComments';
import type { ExportReview } from './preparedExport';

export interface PackageFeedbackChoice {
  /** A changed native revision is reconciled normally; a missing/replaced member needs an explicit choice. */
  member?: 'current' | 'restore-reviewed';
  comments?: 'merge' | 'skip';
  commentConflicts?: Record<string, ReviewReturnChoice>;
  proposals?: Record<string, { action: 'accepted' | 'rejected' | 'keep'; resolutions?: ReviewSuggestionResolution[] }>;
}
export type PackageFeedbackChoices = Record<string, PackageFeedbackChoice>;
export interface PackageFeedbackMemberPreview {
  memberId: string; label: string; status: 'present' | 'removed' | 'replaced';
  baseline: PackageMember; current?: PackageMember; comments: ReviewCommentMerge;
  discussion: { baseline?: ReviewComments; current?: ReviewComments; returned?: ReviewComments };
  proposals: Array<{ id: string; label: string; decided: boolean; structural?: { source: SerializedSession; target: ReviewStructureTarget }; changes: ReturnType<typeof inspectReviewSuggestion> }>;
  issues: string[];
}
export interface PackageReviewApplicationPlan {
  ready: boolean; members: PackageMember[]; previews: PackageFeedbackMemberPreview[];
  outcomes: Array<{ memberId: string; choice: PackageFeedbackChoice; comments?: ReviewComments; suggestions?: ReviewSuggestionState }>;
}
/** Package-member identity history belongs to the saved parent, independently
 * of a native library document or the current review's portable baseline. */
function packageReservedParagraphIds(record: ActionPackage, memberId: string, roundId: string, exceptProposalId: string): string[] {
  const contentIds = (members: readonly PackageMember[]) => members.flatMap(member => member.id === memberId && member.kind === 'native'
    ? [...member.session.paragraphs.flatMap(node => node.id ? [node.id] : []), ...paragraphCommentIds(member.session.reviewComments)] : []);
  const rounds = record.reviewRounds ?? [];
  const states = [...rounds.flatMap(round => (round.memberReviews ?? []).filter(child => child.binding.memberId === memberId).flatMap(child => child.suggestions ? [child.suggestions] : [])),
    ...(record.reviewApplications ?? []).flatMap(application => application.outcomes.filter(outcome => outcome.memberId === memberId).flatMap(outcome => outcome.suggestions ? [outcome.suggestions] : []))];
  return [...record.revisions.flatMap(revision => contentIds(revision.members)), ...rounds.flatMap(round => contentIds(round.baseline.members)),
    ...states.flatMap(state => reviewStructureReservedIds(state, state.roundId === roundId ? exceptProposalId : undefined))];
}
/** All proposal operations flow through the shared native planner, including future supported operations. */
export function planPackageReviewApplication(owner: ActionPackage, returned: ParsedPackageReviewTransfer,
  choices: PackageFeedbackChoices = {}): PackageReviewApplicationPlan {
  const record = actionPackageSchema.parse(structuredClone(owner));
  const round = record.reviewRounds?.find(item => item.id === returned.round.id);
  if (!round || round.ownerPackageId !== record.id || returned.record.id !== record.id
    || round.baselineDigest !== returned.round.baselineDigest) throw new Error('Open the owning exact package review.');
  assertActivePackageReview(round);
  if (record.archived) throw new Error('Reopen this archived package before applying feedback.');
  const members = getPackageRevision(record).members, previews: PackageFeedbackMemberPreview[] = [], outcomes: PackageReviewApplicationPlan['outcomes'] = [];
  for (const child of returned.memberReviews) {
    assertPackageReviewBinding(round, child.binding);
    const memberId = child.binding.memberId, baseline = round.baseline.members.find(item => item.id === memberId)!;
    const index = members.findIndex(item => item.id === memberId), current = index < 0 ? undefined : members[index];
    const replaced = current && (current.kind !== baseline.kind || current.kind === 'native' && baseline.kind === 'native'
      && current.source?.documentId !== baseline.source?.documentId
      || current.kind === 'original' && baseline.kind === 'original' && current.original.sha256 !== baseline.original.sha256);
    const status = !current ? 'removed' : replaced ? 'replaced' : 'present';
    const choice = choices[memberId] ?? {}, issues: string[] = [];
    if (status !== 'present' && !choice.member) issues.push('Choose whether to keep the current membership or restore this reviewed member.');
    const target = status !== 'present' && choice.member === 'restore-reviewed' ? structuredClone(baseline) : current;
    const keep = status !== 'present' && choice.member === 'current';
    if (!choice.comments) issues.push('Choose whether to merge or skip returned discussion.');
    const priorOutcome = [...record.reviewApplications ?? []].reverse().filter(item => item.roundId === round.id)
      .flatMap(item => item.outcomes).find(item => item.memberId === memberId);
    const baseComments = baseline.kind === 'native' ? baseline.session.reviewComments : undefined;
    const currentComments = target?.kind === 'native' ? target.session.reviewComments : priorOutcome?.comments;
    const incomingComments = baseline.kind === 'native' ? normalizeReturnedRangeComments(baseline.session, target?.kind === 'native' ? target.session : baseline.session, child.comments) : child.comments;
    const comments = mergeReturnedComments(baseComments, currentComments, incomingComments, choice.commentConflicts);
    if (!keep && choice.comments === 'merge' && comments.status !== 'ready') issues.push('Resolve each discussion conflict.');
    let session: SerializedSession | undefined = target?.kind === 'native' ? structuredClone(target.session) : undefined;
    if (session && choice.comments === 'merge' && !keep) {
      if (comments.comments) session.reviewComments = comments.comments; else delete session.reviewComments;
    }
    let state: ReviewSuggestionState | undefined;
    const proposals: PackageFeedbackMemberPreview['proposals'] = [];
    if (child.nativeRound && child.suggestions) {
      const prior = [...record.reviewApplications ?? []].reverse().filter(item => item.roundId === round.id)
        .flatMap(item => item.outcomes).find(item => item.memberId === memberId && item.suggestions)?.suggestions;
      state = appendReviewSuggestions(child.nativeRound, prior ?? emptyReviewSuggestionState(child.nativeRound), child.suggestions.proposals);
      for (const proposal of [...child.suggestions.proposals].sort((a, b) => a.id.localeCompare(b.id))) {
        const decided = !!latestReviewSuggestionDecision(state, proposal.id);
        proposals.push({ id: proposal.id, label: proposal.label, decided,
          ...(session && proposal.changes[0].target.kind === 'structure' ? { structural: { source: structuredClone(session), target: proposal.changes[0].target } } : {}),
          changes: inspectReviewSuggestion(child.nativeRound, session ?? child.nativeRound.baseline.session, proposal) });
        const decision = choice.proposals?.[proposal.id];
        if (!decision) { issues.push(`Choose an action for ${proposal.label}.`); continue; }
        if (decision.action === 'keep') continue;
        if (decided) { issues.push(`This proposal already has a decision. Keep its recorded decision.`); continue; }
        if ((keep || !session) && decision.action === 'accepted') { issues.push('Restore the reviewed member before accepting its proposals, or keep them pending or reject them.'); continue; }
        try {
          if (decision.action === 'accepted' && session) for (const change of proposal.changes) if (change.target.kind === 'structure')
            assertReviewStructureNewIdsAvailable(session, change.target, packageReservedParagraphIds(record, memberId, child.nativeRound.id, proposal.id));
          const plan = planReviewSuggestionDecision(child.nativeRound, session ?? child.nativeRound.baseline.session, state, proposal.id, decision.action, undefined, decision.resolutions);
          if (plan.status !== 'ready') { issues.push(`Resolve the overlapping or unsupported change in ${proposal.label}, or keep it pending.`); continue; }
          if (decision.action === 'accepted' && session && sameReviewStoredValue(session.reviewComments, plan.session.reviewComments)) {
            let comments = plan.session.reviewComments;
            for (const before of session.paragraphs) {
              const after = plan.session.paragraphs.find(item => item.id === before.id);
              if (!after || !sameReviewStoredValue(before, after)) comments = transformRangeComments(comments, before, after ?? { ...before, id: 'removed-review-paragraph', text: '' });
            }
            if (comments) plan.session.reviewComments = comments; else delete plan.session.reviewComments;
          }
          if (!keep && session) session = plan.session; state = plan.state;
        } catch (error) {
          issues.push(error instanceof Error ? error.message : 'Review this proposal resolution again.');
        }
      }
    }
    if (!keep && target) {
      let next = target;
      if (session && target.kind === 'native') {
        next = { ...target, session };
      }
      if (index < 0) members.push(next); else members[index] = next;
    }
    previews.push({ memberId, label: baseline.label, status, baseline, current, comments, discussion: { baseline: baseComments, current: currentComments, returned: incomingComments }, proposals, issues });
    outcomes.push({ memberId, choice: structuredClone(choice), ...((choice.comments === 'merge' && !keep ? comments.comments : currentComments) ? { comments: session?.reviewComments ?? (choice.comments === 'merge' && !keep ? comments.comments : currentComments) } : {}), ...(state ? { suggestions: state } : {}) });
  }
  return { ready: previews.every(item => !item.issues.length), members, previews, outcomes };
}

export interface PackageReviewReturnPreview { readonly packageName: string; readonly returnId: string; readonly reviews: readonly ExportReview[] }
const previews = new WeakMap<PackageReviewReturnPreview, { owner: ActionPackage; returned: ParsedPackageReviewTransfer; policy: string }>();
function policyIdentity(policy: PolicyResolution): string {
  if (policy.status !== 'ready') throw new Error(policy.message);
  return canonicalReviewPayload(policy.policy);
}
function assertNewReturn(owner: ActionPackage, returned: ParsedPackageReviewTransfer): void {
  const receipt = owner.reviewApplications?.find(item => item.returnId === returned.payload.id);
  if (receipt) throw new Error(receipt.returnDigest === returned.digest ? 'This feedback return was already applied. Open its saved package revision.' : 'This return identity changed after application. Ask for a new return.');
}
export async function previewPackageReviewReturn(json: string, input: ActionPackage, roundId: string, policy: PolicyResolution): Promise<PackageReviewReturnPreview> {
  const owner = actionPackageSchema.parse(structuredClone(input));
  const returned = await parsePackageReviewReturn(json, owner, roundId); assertNewReturn(owner, returned);
  const preview = Object.freeze({ packageName: owner.name, returnId: returned.payload.id,
    reviews: await inspectPackageReviewTransfer(returned, policy) });
  previews.set(preview, { owner, returned, policy: policyIdentity(policy) }); return preview;
}
function retainedPreview(preview: PackageReviewReturnPreview, policy: PolicyResolution) {
  const retained = previews.get(preview);
  if (!retained || retained.policy !== policyIdentity(policy)) throw new Error('Prepare this feedback again after the policy changed.');
  return retained;
}
export function inspectPackageReviewApplication(preview: PackageReviewReturnPreview, choices: PackageFeedbackChoices, policy: PolicyResolution): PackageReviewApplicationPlan {
  const retained = retainedPreview(preview, policy);
  return planPackageReviewApplication(retained.owner, retained.returned, choices);
}
export interface PreparedPackageReviewApplication { readonly packageName: string; readonly reviews: readonly ExportReview[]; readonly plan: PackageReviewApplicationPlan }
const preparations = new WeakMap<PreparedPackageReviewApplication, { owner: ActionPackage; after: ActionPackage; attachments: StoredAttachment[]; policy: string }>();
/** Rewrite only changed model keys; preserve original inline binary assets from the retained draft. */
async function rewrittenMember(previous: NativePackageMember, session: SerializedSession): Promise<{ member: NativePackageMember; attachment: StoredAttachment }> {
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readPackageAsset(previous.draft))) as Record<string, unknown>;
  const original = structuredClone(raw);
  for (const [key, value] of Object.entries(session)) {
    if (sameReviewStoredValue(value, (previous.session as unknown as Record<string, unknown>)[key])) continue;
    if (key === 'formData') raw[key] = { ...(raw[key] as object), ...value };
    else if (key === 'paragraphs') {
      const old = original.paragraphs as Array<Record<string, unknown>>;
      raw[key] = session.paragraphs.map(paragraph => {
        const prior = old.find(item => item.id === paragraph.id);
        return { ...paragraph, ...(paragraph.figure && prior?.figure ? { figure: prior.figure } : {}) };
      });
    } else raw[key] = value;
  }
  if (!session.reviewComments) delete raw.reviewComments;
  const reviewed = await validatePackageDraft(raw);
  if (!sameReviewStoredValue(reviewed.session, session)) throw new Error('This changed member cannot preserve its native resources. Keep the current member and review it separately.');
  const data = new TextEncoder().encode(JSON.stringify(raw)).buffer, id = newAttachmentId();
  const draft = { id, name: previous.draft.name, type: previous.draft.type, size: data.byteLength, sha256: await portableResourceDigest(data) };
  return { member: { ...previous, revisionId: newPackageId('member-revision'), session: reviewed.session, draft }, attachment: { id, name: draft.name, type: draft.type, size: draft.size, data } };
}
export async function preparePackageReviewApplication(preview: PackageReviewReturnPreview, choices: PackageFeedbackChoices, policy: PolicyResolution): Promise<PreparedPackageReviewApplication> {
  const { owner, returned } = retainedPreview(preview, policy), plan = planPackageReviewApplication(owner, returned, choices);
  if (!plan.ready) throw new Error('Resolve each feedback choice before reviewing this application.');
  assertNewReturn(owner, returned);
  const current = getPackageRevision(owner), attachments: StoredAttachment[] = [];
  const members = await Promise.all(plan.members.map(async member => {
    if (member.kind !== 'native') return member;
    const previous = current.members.find(item => item.id === member.id);
    const retained = previous?.kind === 'native' && previous.draft.id === member.draft.id ? previous : returned.round.baseline.members.find(item => item.id === member.id);
    if (retained?.kind !== 'native' || sameReviewStoredValue(retained.session, member.session)) {
      // Restored review captures strip local source authority. Preserve the saved
      // draft bytes while assigning that detached capture its own revision identity.
      const captured = owner.revisions.flatMap(revision => revision.members)
        .find(saved => saved.id === member.id && saved.revisionId === member.revisionId);
      return captured && !sameReviewStoredValue(captured, member)
        ? { ...member, revisionId: newPackageId('member-revision') } : member;
    }
    const rewritten = await rewrittenMember(retained, member.session); attachments.push(rewritten.attachment); return rewritten.member;
  }));
  const revision = { id: newPackageId('revision'), parentId: owner.currentRevisionId, createdAt: Date.now(), members, outputs: [],
    ...(current.bindings ? { bindings: structuredClone(current.bindings) } : {}),
    ...(current.templateState ? { templateState: structuredClone(current.templateState) } : {}),
    ...(current.information ? { information: structuredClone(current.information) } : {}),
    ...(current.requirements ? { requirements: structuredClone(current.requirements) } : {}),
    ...(current.consistency ? { consistency: structuredClone(current.consistency) } : {}),
    ...(current.work ? { work: structuredClone(current.work) } : {}),
    ...(current.signing ? { signing: structuredClone(current.signing) } : {}),
    ...(current.assembly ? { assembly: structuredClone(current.assembly) } : {}),
    ...(current.scans ? { scans: structuredClone(current.scans) } : {}),
    ...(current.citations ? { citations: structuredClone(current.citations) } : {}) };
  // Rebind an unchanged known citation identity only when every recorded value except the new member revision still matches.
  if (revision.citations) {
    const candidates = await packageCitationCandidates(revision), occurrences = await packageCitationOccurrences(revision);
    const withoutRevision = ({ memberRevisionId: _revision, ...value }: { memberRevisionId: string }) => value;
    revision.citations.targets = revision.citations.targets.map(target => {
      const { id, ...binding } = target;
      const candidate = candidates.find(candidate => sameReviewStoredValue(withoutRevision(candidate.target), withoutRevision(binding)));
      return candidate ? { id, ...candidate.target } : target;
    });
    revision.citations.links = revision.citations.links.map(link => {
      const occurrence = occurrences.find(occurrence => sameReviewStoredValue(withoutRevision(occurrence.source), withoutRevision(link.source)));
      return occurrence ? { ...link, source: occurrence.source } : link;
    });
  }
  const application = { id: newPackageId('package-application'), roundId: returned.round.id, baselineDigest: returned.round.baselineDigest,
    returnId: returned.payload.id, returnDigest: returned.digest, createdAt: Date.now(), revisionId: revision.id,
    feedback: structuredClone(returned.memberReviews), outcomes: structuredClone(plan.outcomes) };
  const after = actionPackageSchema.parse({ ...owner, sequence: owner.sequence + 1, currentRevisionId: revision.id,
    revisions: [...owner.revisions, revision], reviewApplications: [...owner.reviewApplications ?? [], application] });
  for (const child of returned.memberReviews) {
    const next = members.find(member => member.id === child.binding.memberId);
    if (!child.nativeRound || next?.kind !== 'native') continue;
    const report = prepareChangeReport(captureChangeReport({ label: 'Reviewed baseline', title: '', session: child.nativeRound.baseline.session },
      { label: 'Applied package member', title: '', session: next.session }, new Date(returned.payload.createdAt).toISOString()), policy);
    const unknown = report.customMarkings.filter(marking => !classificationBannerLevel(marking));
    if (report.notices.some(notice => notice.includes('without saved marking text')) || unknown.some(marking =>
      next.session.formData.classLevel !== 'custom' || next.session.formData.customClassification?.trim() !== marking.trim()))
      throw new Error('Preserve the exact custom handling marking before applying this feedback.');
    const recognized = report.marking.match(/highest recognized marking: (.+)\)$/)?.[1] ?? report.marking;
    const floor = classificationBannerLevel(recognized) ?? 'unclassified';
    const declared = next.session.formData.classLevel === 'custom' ? classificationBannerLevel(next.session.formData.customClassification ?? '') : next.session.formData.classLevel ?? 'unclassified';
    if ((classificationRank(deriveOverallClassLevel(declared ?? 'unclassified', next.session.paragraphs)) ?? -1) < (classificationRank(floor) ?? 0))
      throw new Error('The resulting package member would be marked below the reviewed content. Keep or raise its handling marking before applying feedback.');
  }
  const readiness = await packageCitationReadiness(revision);
  const reviews = [...preview.reviews, { ...reviewPackageText('', 'Package citation readiness', policy), notices: readiness.map(item => item.message) }, reviewPackageReviewMetadata(application, policy),
    ...(current.bindings ? [reviewPackageBindings(current.bindings, policy)] : []),
    ...(current.information ? [reviewPackageInformation(current.information, policy)] : []),
    ...(current.consistency ? [reviewPackageConsistency(current.consistency, policy)] : []),
    ...(current.work ? [reviewPackageWork(current.work, policy)] : []),
    ...(current.signing ? [reviewPackageSigningMetadata(current.signing, policy)] : []),
    ...(current.scans ? [reviewPackageScans(current.scans, policy)] : []),
    ...members.flatMap(member => member.kind === 'native' ? [reviewPackageNative(member.session, member.label, policy)] : [])];
  const prepared = Object.freeze({ packageName: owner.name, reviews, plan: structuredClone(plan) });
  preparations.set(prepared, { owner, after, attachments, policy: policyIdentity(policy) }); return prepared;
}
export async function applyPreparedPackageReviewApplication(prepared: PreparedPackageReviewApplication, policy: PolicyResolution,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const retained = preparations.get(prepared);
  if (!retained || retained.policy !== policyIdentity(policy)) throw new Error('Prepare and review this application again.');
  signal?.throwIfAborted();
  if (!isCurrent()) throw new Error('This package application is no longer current.');
  const latest = (await listActionPackages()).find(item => item.id === retained.owner.id);
  if (!sameReviewStoredValue(latest, retained.owner)) throw new Error('The saved package changed. Preview the feedback against its latest revision again.');
  const result = await withAttachmentStaging(() => commitActionPackage(retained.owner, retained.after, signal, isCurrent, retained.attachments));
  preparations.delete(prepared); return result;
}
