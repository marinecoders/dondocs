import { getExportDeploymentPolicy } from '@/config/classification';
import { getSerializedSession, type SerializedSession } from '@/stores/documentStore';
import { applyOwnedReviewSuggestions, captureDocumentTarget, flushPendingReviewWrites, hasPendingReviewWrites,
  isCurrentDocumentTarget, type DocumentTarget } from '@/stores/documentsStore';
import { idbReadReviewSuggestions } from './documentsDb';
import { readReviewCopyLink, readReviewRound, type ReviewRound } from './reviewRounds';
import { captureChangeReport, prepareChangeReport } from './changeReport';
import { classificationBannerLevel } from './detectClassification';
import { classificationRank, deriveOverallClassLevel } from './overallClassification';
import { supportsReviewComments } from './reviewCommentTargets';
import { appendReviewSuggestions, emptyReviewSuggestionState, planReviewSuggestionDecision, reviewSuggestionText,
  validateReviewSuggestion, validateReviewSuggestionState, type ReviewSuggestion, type ReviewSuggestionResolution, type ReviewSuggestionState } from './reviewSuggestions';
import { reviewSuggestionRecordSchema, type ReviewSuggestionWrite } from './reviewSuggestionWrites';
import { cacheReviewSuggestions } from './reviewSuggestionRuntime';

export interface ReviewSuggestionWorkspace {
  target: DocumentTarget; round: ReviewRound; state: ReviewSuggestionState | null; current: SerializedSession; owner: boolean;
}
function current(target: DocumentTarget): void {
  if (!isCurrentDocumentTarget(target)) throw new Error('The draft changed. Reopen the suggested edits against the current document.');
}

export async function loadReviewSuggestionWorkspace(roundId: string): Promise<ReviewSuggestionWorkspace> {
  const target = captureDocumentTarget();
  if (!target || !supportsReviewComments(getSerializedSession())) throw new Error('Open the native draft or linked reviewer copy for this review first.');
  if (hasPendingReviewWrites(target.scope.documentId)) await flushPendingReviewWrites(target.scope.documentId);
  current(target);
  const round = await readReviewRound(roundId), link = await readReviewCopyLink(target.scope.documentId);
  if (!round || round.ownerDocumentId !== target.scope.documentId && (link?.roundId !== round.id || link.baselineDigest !== round.baselineDigest)) {
    throw new Error('This draft is not the source or linked reviewer copy for the selected baseline.');
  }
  const raw = await idbReadReviewSuggestions(target.scope.documentId, round.id);
  const record = raw === null ? null : reviewSuggestionRecordSchema.parse(raw);
  if (record && record.documentId !== target.scope.documentId) throw new Error('The suggested edits belong to another draft.');
  const state = record ? validateReviewSuggestionState(round, record.state) : null;
  current(target);cacheReviewSuggestions(target.scope, round, state);
  return { target, round, state, current: structuredClone(getSerializedSession()), owner: round.ownerDocumentId === target.scope.documentId };
}

export interface ReviewSuggestionOutcome { status: 'committed' | 'pending' | 'stale' | 'invalid'; state: ReviewSuggestionState }

export async function submitReviewSuggestion(input: ReviewSuggestion): Promise<ReviewSuggestionOutcome> {
  const proposal = structuredClone(input), context = await loadReviewSuggestionWorkspace(proposal.roundId);
  validateReviewSuggestion(context.round, proposal);
  const after = appendReviewSuggestions(context.round, context.state ?? emptyReviewSuggestionState(context.round), [proposal]);
  if (context.state?.proposals.some(item => item.id === proposal.id)) return { status: 'committed', state: after };
  const operation: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`,
    documentId: context.target.scope.documentId, createdAt: Date.now(), round: { id: context.round.id, baselineDigest: context.round.baselineDigest },
    before: context.state, after, intent: { kind: 'propose', proposals: [proposal] } };
  return { status: await applyOwnedReviewSuggestions(context.target, operation), state: after };
}

/** Reuse the handling gate before reviewer text can enter a lower-marked source. */
export async function decideReviewSuggestion(roundId: string, proposalId: string, action: 'accepted' | 'rejected',
  resolutions?: readonly ReviewSuggestionResolution[]): Promise<ReviewSuggestionOutcome> {
  const context = await loadReviewSuggestionWorkspace(roundId);
  if (!context.owner) throw new Error('Only the local source draft can decide a suggested replacement.');
  const state = context.state ?? emptyReviewSuggestionState(context.round);
  const plan = planReviewSuggestionDecision(context.round, context.current, state, proposalId, action, undefined, resolutions);
  if (plan.status !== 'ready') throw new Error(plan.status === 'stale' ? 'The target differs from the reviewed baseline. Keep the newer draft or start a new review; no replacement was applied.' : 'This suggestion already has a decision.');
  const proposal = state.proposals.find(item => item.id === proposalId)!;
  if (action === 'accepted') {
    const policy = await getExportDeploymentPolicy(undefined, true);
    const text = [...reviewSuggestionText([proposal]), ...(resolutions ?? []).flatMap(item => [
      { field: 'Current text before resolution', value: item.expectedCurrent }, { field: 'Resolved text', value: item.value },
    ])].map((field, index) => ({ id: `suggestion-policy-${index}`, text: field.value, level: 0 }));
    const report = prepareChangeReport(captureChangeReport(
      { label: 'Reviewed baseline', title: '', session: context.round.baseline.session },
      { label: 'Proposed source', title: '', session: { ...plan.session, paragraphs: [...plan.session.paragraphs, ...text] } },
      new Date(proposal.createdAt).toISOString(),
    ), policy);
    const unknown = report.customMarkings.filter(marking => !classificationBannerLevel(marking));
    if (report.notices.some(notice => notice.includes('without saved marking text')) || unknown.some(marking =>
      plan.session.formData.classLevel !== 'custom' || plan.session.formData.customClassification?.trim() !== marking.trim())) {
      throw new Error('The reviewed content has unranked or incomplete markings. Preserve its exact custom marking or begin a corrected review before accepting text.');
    }
    const recognized = report.marking.match(/highest recognized marking: (.+)\)$/)?.[1] ?? report.marking;
    const floor = classificationBannerLevel(recognized) ?? 'unclassified';
    const declared = plan.session.formData.classLevel === 'custom'
      ? classificationBannerLevel(plan.session.formData.customClassification ?? '')
      : plan.session.formData.classLevel ?? 'unclassified';
    const level = deriveOverallClassLevel(declared ?? 'unclassified', plan.session.paragraphs);
    if ((classificationRank(level) ?? -1) < (classificationRank(floor) ?? 0)) {
      throw new Error('The resulting draft would be marked below the reviewed content. Keep or raise its handling marking before accepting this replacement.');
    }
    current(context.target);
  }
  const decision = plan.state.decisions.at(-1)!;
  const operation: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`,
    documentId: context.target.scope.documentId, createdAt: Date.now(), round: { id: context.round.id, baselineDigest: context.round.baselineDigest },
    before: context.state, after: plan.state, intent: { kind: 'decide', proposalId, action, record: { id: decision.id, decidedAt: decision.decidedAt },
      ...(decision.resolutions ? { resolutions: decision.resolutions } : {}) } };
  return { status: await applyOwnedReviewSuggestions(context.target, operation), state: plan.state };
}
