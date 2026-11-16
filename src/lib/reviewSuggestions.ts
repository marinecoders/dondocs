import { replaceReviewParagraphText } from './reviewParagraphText';
import { applyReviewStructure, captureReviewStructure, inspectReviewStructure, reviewStructureTargetSchema, structureNewIds, structureOperationIds, structureSuggestionLabel, structureSuggestionText, validateReviewStructureTarget, type ReviewStructureTarget } from './reviewStructureSuggestions';
import { transformRangeComments } from './reviewCommentRanges';
import { z } from 'zod';
import { feedbackCategorySchema, type FeedbackCategory } from './reviewFeedback';
import type { SerializedSession } from '@/stores/documentStore';
import { paragraphIdSchema } from './paragraphIdentity';
import { availableCommentFields, commentFieldLabel, supportsReviewComments } from './reviewCommentTargets';
import { canonicalReviewPayload, reviewDigestSchema, reviewRoundIdSchema, type ReviewRound } from './reviewRounds';
import { mechanicalFindings } from './mechanicalCorrections';
import { reconcileReviewRange, type ReviewRangeReconciliation } from './reconcileReviewText';
import { captureTextRange, isTextRangeBoundary, resolveTextRange, selectedTextRangeSchema, supportsPlainTextRange, type SelectedTextRange } from './reviewTextRanges';

export const REVIEW_SUGGESTION_LIMITS = { proposals: 100, changes: 20, decisions: 1_000, value: 20_000, totalCharacters: 200_000 } as const;
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
export const reviewProposalIdSchema = z.string().regex(/^proposal_[0-9a-f-]{36}$/).refine(value => z.string().uuid().safeParse(value.slice(9)).success);
const changeId = z.string().uuid();

export const reviewSuggestionTargetSchema = z.union([
  z.object({ kind: z.literal('field'), field: z.string().regex(/^[a-z][A-Za-z0-9]*$/).max(100), docType: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('paragraph'), paragraphId: paragraphIdSchema, docType: z.string().min(1).max(100) }).strict(),
  selectedTextRangeSchema,
  reviewStructureTargetSchema,
  z.object({ kind: z.literal('reference-title'), referenceIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), docType: z.string().min(1).max(100) }).strict(),
]);
export type ReviewSuggestionTarget = z.infer<typeof reviewSuggestionTargetSchema>;
export const reviewSuggestionChangeSchema = z.object({
  id: changeId, target: reviewSuggestionTargetSchema,
  expected: z.string().max(REVIEW_SUGGESTION_LIMITS.value), proposed: z.string().max(REVIEW_SUGGESTION_LIMITS.value),
}).strict().refine(value => value.expected !== value.proposed || value.target.kind === 'structure', 'A suggestion must change its target value.');
export type ReviewSuggestionChange = z.infer<typeof reviewSuggestionChangeSchema>;

/** Each manual suggestion is one change; a mechanical group is decided atomically. */
export const reviewSuggestionSchema = z.object({
  kind: z.literal('dondocs-review-suggestion'), version: z.literal(1),
  id: reviewProposalIdSchema, roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema,
  author: z.string().trim().min(1).max(100), createdAt: timestamp,
  label: z.string().trim().min(1).max(120),
  category: feedbackCategorySchema.optional(),
  origin: z.object({ kind: z.enum(['manual', 'mechanical']), rule: z.string().min(1).max(200).optional(),
    context: z.string().max(500).optional() }).strict(),
  changes: z.array(reviewSuggestionChangeSchema).min(1).max(REVIEW_SUGGESTION_LIMITS.changes),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>(), targets = new Set<string>();
  let characters = value.author.length + value.label.length + (value.origin.rule?.length ?? 0) + (value.origin.context?.length ?? 0);
  for (const change of value.changes) {
    const target = suggestionTargetKey(change.target);
    if (ids.has(change.id) || targets.has(target)) context.addIssue({ code: 'custom', message: 'A suggestion group cannot repeat an identity or target.' });
    ids.add(change.id);targets.add(target);
    characters += suggestionChangeCharacters(change);
  }
  if (value.origin.kind === 'manual' && value.changes.length !== 1) context.addIssue({ code: 'custom', message: 'A manual suggestion replaces one field or paragraph.' });
  if (characters > REVIEW_SUGGESTION_LIMITS.totalCharacters) context.addIssue({ code: 'custom', message: 'The suggestion exceeds the supported text limit.' });
});
export type ReviewSuggestion = z.infer<typeof reviewSuggestionSchema>;

export function reviewSuggestionText(proposals: readonly ReviewSuggestion[]): Array<{ field: string; value: string }> {
  return proposals.flatMap((proposal, index) => [proposal.author, proposal.label, proposal.origin.rule ?? '', proposal.origin.context ?? '',
    ...proposal.changes.flatMap(change => [change.expected, change.proposed, ...(change.target.kind === 'structure' ? structureReviewText(change.target) : []), ...Object.values(change.target).filter((value): value is string => typeof value === 'string'), ...(change.target.kind === 'range' && change.target.tracking ? [change.target.tracking.context] : [])])].map(value => ({ field: `Suggested replacement ${index + 1}`, value })));
}

export const reviewSuggestionRangeScopeSchema = z.object({
  context: z.string().max(REVIEW_SUGGESTION_LIMITS.value), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
}).strict().refine(scope => scope.start <= scope.end && isTextRangeBoundary(scope.context, scope.start)
  && isTextRangeBoundary(scope.context, scope.end), 'Choose complete characters in the exact current paragraph.');
export const reviewSuggestionResolutionSchema = z.object({
  changeId, expectedCurrent: z.string().max(REVIEW_SUGGESTION_LIMITS.value), value: z.string().max(REVIEW_SUGGESTION_LIMITS.value),
  range: reviewSuggestionRangeScopeSchema.optional(),
}).strict().refine(value => !value.range || value.range.context.slice(value.range.start, value.range.end) === value.expectedCurrent,
  'The resolution must match its exact selected current scope.');
export type ReviewSuggestionResolution = z.infer<typeof reviewSuggestionResolutionSchema>;

export const reviewSuggestionDecisionSchema = z.object({
  id: z.string().uuid(), proposalId: reviewProposalIdSchema,
  roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema,
  action: z.enum(['accepted', 'rejected', 'reversed', 'restored']), decidedAt: timestamp,
  previousDecisionId: z.string().uuid().optional(), acceptanceId: z.string().uuid().optional(),
  resolutions: z.array(reviewSuggestionResolutionSchema).min(1).max(REVIEW_SUGGESTION_LIMITS.changes).optional(),
}).strict();
export type ReviewSuggestionDecision = z.infer<typeof reviewSuggestionDecisionSchema>;

export const reviewSuggestionStateSchema = z.object({
  kind: z.literal('dondocs-review-suggestions'), version: z.union([z.literal(1), z.literal(2)]),
  roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema,
  proposals: z.array(reviewSuggestionSchema).max(REVIEW_SUGGESTION_LIMITS.proposals),
  decisions: z.array(reviewSuggestionDecisionSchema).max(REVIEW_SUGGESTION_LIMITS.decisions),
}).strict().superRefine((value, context) => {
  const proposals = new Set<string>(), ids = new Set<string>(), latest = new Map<string, ReviewSuggestionDecision>();
  let characters = 0;
  for (const proposal of value.proposals) {
    if (proposal.roundId !== value.roundId || proposal.baselineDigest !== value.baselineDigest) context.addIssue({ code: 'custom', message: 'Suggestion baseline does not match its round.' });
    if (proposals.has(proposal.id)) context.addIssue({ code: 'custom', message: 'Suggestion IDs must be unique.' });
    proposals.add(proposal.id);
    for (const change of proposal.changes) {
      if (ids.has(change.id)) context.addIssue({ code: 'custom', message: 'Suggestion change IDs must be unique.' });
      ids.add(change.id);characters += suggestionChangeCharacters(change);
    }
    characters += proposal.author.length + proposal.label.length + (proposal.origin.rule?.length ?? 0) + (proposal.origin.context?.length ?? 0);
  }
  for (const decision of value.decisions) {
    if (decision.roundId !== value.roundId || decision.baselineDigest !== value.baselineDigest || !proposals.has(decision.proposalId)) context.addIssue({ code: 'custom', message: 'Decision does not match a suggestion in this round.' });
    if (ids.has(decision.id)) context.addIssue({ code: 'custom', message: 'Decision IDs must be unique.' });
    const previous = latest.get(decision.proposalId);
    if (decision.resolutions) {
      const proposal = value.proposals.find(item => item.id === decision.proposalId);
      if (value.version !== 2 || decision.action !== 'accepted' || proposal?.origin.kind !== 'manual'
        || proposal.changes.length !== 1 || decision.resolutions.length !== 1
        || decision.resolutions[0].changeId !== proposal.changes[0].id) context.addIssue({ code: 'custom', message: 'A resolution must identify one accepted manual replacement in a version 2 review.' });
      for (const resolution of decision.resolutions) {
        characters += resolution.expectedCurrent.length + resolution.value.length + (resolution.range?.context.length ?? 0);
        if ((proposal?.changes[0].target.kind === 'range') !== !!resolution.range) context.addIssue({ code: 'custom', message: 'A selected resolution must retain its exact current range.' });
      }
    }
    if (decision.previousDecisionId !== previous?.id) context.addIssue({ code: 'custom', message: 'Decision history is not contiguous.' });
    if (decision.action === 'accepted' || decision.action === 'rejected') {
      if (previous && previous.action !== 'reversed' || decision.acceptanceId !== undefined) context.addIssue({ code: 'custom', message: 'This suggestion already has an active decision.' });
    } else {
      const root = previous?.action === 'accepted' ? previous.id : previous?.acceptanceId;
      if (!previous || decision.acceptanceId !== root || !root
        || decision.action === 'reversed' && !['accepted', 'restored'].includes(previous.action)
        || decision.action === 'restored' && previous.action !== 'reversed') context.addIssue({ code: 'custom', message: 'The reversal does not match its acceptance.' });
    }
    ids.add(decision.id);latest.set(decision.proposalId, decision);
  }
  if (characters > REVIEW_SUGGESTION_LIMITS.totalCharacters) context.addIssue({ code: 'custom', message: 'The suggestions exceed the supported text limit.' });
});
export type ReviewSuggestionState = z.infer<typeof reviewSuggestionStateSchema>;

function suggestionChangeCharacters(change: ReviewSuggestionChange): number {
  return (change.target.kind === 'structure' ? JSON.stringify(change.target).length : 0) + change.expected.length + change.proposed.length + (change.target.kind === 'range' ? change.target.context.length + (change.target.tracking?.context.length ?? 0) : 0);
}

export function suggestionTargetKey(target: ReviewSuggestionTarget): string {
  if (target.kind === 'structure') return `structure:${target.operation.kind}:${structureOperationIds(target).join(':')}:${target.operation.gap.before?.id ?? ''}:${target.operation.gap.after?.id ?? ''}`;
  if (target.kind === 'range') return `range:${target.paragraphId}:${target.start}:${target.end}`;
  return target.kind === 'field' ? `field:${target.field}` : target.kind === 'paragraph' ? `paragraph:${target.paragraphId}` : `reference-title:${target.referenceIndex}`;
}

export function suggestionTargetValue(session: SerializedSession, target: ReviewSuggestionTarget): { label: string; value: string } | null {
  if (!supportsReviewComments(session) || session.docType !== target.docType) return null;
  if (target.kind === 'structure') return inspectReviewStructure(session, target) ? { label: structureSuggestionLabel(target), value: structureSuggestionText(target.operation.before) } : null;
  if (target.kind === 'field') {
    const field = availableCommentFields(session).find(item => item.field === target.field);
    return field ? { label: commentFieldLabel(target.field), value: field.value } : null;
  }
  if (target.kind === 'reference-title') {
    const reference = session.references[target.referenceIndex];
    return reference ? { label: `Reference ${target.referenceIndex + 1} title`, value: reference.title } : null;
  }
  if (target.kind === 'range') {
    const resolved = resolveTextRange(session, target);
    return resolved.status === 'current' ? { label: `Selected text in paragraph ${session.paragraphs.indexOf(resolved.paragraph!) + 1}`, value: resolved.text! } : null;
  }
  const matches = session.paragraphs.filter(paragraph => paragraph.id === target.paragraphId);
  const paragraph = matches.length === 1 ? matches[0] : undefined;
  if (!paragraph || paragraph.figure || paragraph.tableKey || paragraph.callout || paragraph.procedure || paragraph.appendix) return null;
  return { label: `Paragraph ${session.paragraphs.indexOf(paragraph) + 1}`, value: paragraph.text };
}

export function availableReviewSuggestionTargets(round: ReviewRound): Array<{ key: string; label: string; target: ReviewSuggestionTarget; value: string }> {
  const session = round.baseline.session;
  const candidates: ReviewSuggestionTarget[] = [
    ...availableCommentFields(session).map(field => ({ kind: 'field' as const, field: field.field, docType: session.docType })),
    ...session.paragraphs.flatMap(paragraph => paragraph.id && paragraphIdSchema.safeParse(paragraph.id).success
      ? [{ kind: 'paragraph' as const, paragraphId: paragraph.id, docType: session.docType }] : []),
  ];
  return candidates.flatMap(target => {
    const value = suggestionTargetValue(session, target);
    return value && value.value.length <= REVIEW_SUGGESTION_LIMITS.value ? [{ key: suggestionTargetKey(target), target, ...value }] : [];
  });
}

export function latestReviewSuggestionDecision(state: ReviewSuggestionState, proposalId: string): ReviewSuggestionDecision | undefined {
  for (let index = state.decisions.length - 1; index >= 0; index--) if (state.decisions[index].proposalId === proposalId) return state.decisions[index];
  return undefined;
}

export function emptyReviewSuggestionState(round: Pick<ReviewRound, 'id' | 'baselineDigest'>): ReviewSuggestionState {
  return { kind: 'dondocs-review-suggestions', version: 1, roundId: round.id, baselineDigest: round.baselineDigest, proposals: [], decisions: [] };
}

export function validateReviewSuggestion(round: ReviewRound, value: unknown): ReviewSuggestion {
  const proposal = reviewSuggestionSchema.parse(value);
  if (proposal.roundId !== round.id || proposal.baselineDigest !== round.baselineDigest) throw new Error('This suggestion belongs to another review baseline.');
  for (const change of proposal.changes) {
    if (change.target.kind === 'structure') {
      validateReviewStructureTarget(round.baseline.session, change.target);
      if (proposal.origin.kind !== 'manual' || change.expected !== structureSuggestionText(change.target.operation.before)
        || change.proposed !== structureSuggestionText(change.target.operation.after)) throw new Error('The structural suggestion must retain its exact captured nodes and readable comparison.');
      continue;
    }
    const baseline = suggestionTargetValue(round.baseline.session, change.target);
    if (!baseline || baseline.value !== change.expected) throw new Error('This suggestion does not match a supported field or paragraph in the reviewed baseline.');
    if (change.target.kind === 'range') {
      const target = change.target;
      if (proposal.origin.kind !== 'manual' || target.tracking || target.detached) throw new Error('Selected text suggestions require the exact original range.');
      // Validate the complete result too: replacements must keep this a supported plain paragraph.
      prepareReviewSuggestionRange(round.baseline.session, target, change.expected, change.proposed);
    }
    if (change.target.kind === 'reference-title') {
      const index = change.target.referenceIndex;
      const finding = mechanicalFindings({ ...round.baseline.session, references: [round.baseline.session.references[index]] }, 'references', null).find(item => item.after !== undefined);
      const corrected = finding && finding.sourceText.slice(0, finding.target.start) + finding.after + finding.sourceText.slice(finding.target.end);
      if (proposal.origin.kind !== 'mechanical' || change.proposed !== corrected) throw new Error('Reference review suggestions support only the existing NOTAL formatting correction.');
    }
  }
  return proposal;
}

export function validateReviewSuggestionState(round: ReviewRound, value: unknown): ReviewSuggestionState {
  const state = reviewSuggestionStateSchema.parse(value);
  if (state.roundId !== round.id || state.baselineDigest !== round.baselineDigest) throw new Error('These suggestions belong to another review baseline.');
  const reserved = new Set<string>();
  for (const proposal of state.proposals) {
    validateReviewSuggestion(round, proposal);
    for (const change of proposal.changes) if (change.target.kind === 'structure') for (const id of structureNewIds(change.target)) {
      if (reserved.has(id)) throw new Error('Different review operations cannot reuse a new paragraph identity.');
      reserved.add(id);
    }
  }
  return state;
}

/** Returned proposals are immutable; replay is harmless and changed IDs are rejected. */
export function appendReviewSuggestions(round: ReviewRound, original: ReviewSuggestionState, values: readonly unknown[]): ReviewSuggestionState {
  if (values.length > REVIEW_SUGGESTION_LIMITS.proposals) throw new Error('The return contains too many suggestions.');
  const state = validateReviewSuggestionState(round, original);
  for (const value of values) {
    const proposal = validateReviewSuggestion(round, value);
    const existing = state.proposals.find(item => item.id === proposal.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(proposal)) throw new Error('A returned suggestion changed under an existing identity. Ask the reviewer to create a new suggestion.');
    if (!existing) state.proposals.push(proposal);
  }
  return validateReviewSuggestionState(round, state);
}

export function createReviewSuggestion(round: ReviewRound, input: {
  author: string; label: string; origin?: ReviewSuggestion['origin']; category?: FeedbackCategory;
  changes: ReadonlyArray<{ target: ReviewSuggestionTarget; proposed: string }>;
}): ReviewSuggestion {
  return validateReviewSuggestion(round, {
    kind: 'dondocs-review-suggestion', version: 1, id: `proposal_${crypto.randomUUID()}`,
    roundId: round.id, baselineDigest: round.baselineDigest, author: input.author,
    createdAt: Date.now(), label: input.label, ...(input.category ? { category: input.category } : {}), origin: input.origin ?? { kind: 'manual' },
    changes: input.changes.map(change => {
      const baseline = suggestionTargetValue(round.baseline.session, change.target);
      if (!baseline) throw new Error('Choose a supported text field or whole paragraph from the reviewed baseline.');
      return { id: crypto.randomUUID(), target: change.target, expected: baseline.value, proposed: change.proposed };
    }),
  });
}

/** Recursive retained text participates in handling checks, including metadata. */
function structureReviewText(target: ReviewStructureTarget): string[] {
  const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  return strings(target);
}
export function reviewStructureReservedIds(state: ReviewSuggestionState, exceptProposalId?: string): string[] {
  return state.proposals.filter(proposal => proposal.id !== exceptProposalId).flatMap(proposal => proposal.changes.flatMap(change => change.target.kind === 'structure' ? structureOperationIds(change.target) : []));
}
export function createParagraphStructureSuggestion(round: ReviewRound, input: { author: string; category?: FeedbackCategory; operation: Parameters<typeof captureReviewStructure>[1] }): ReviewSuggestion {
  const target = captureReviewStructure(round.baseline.session, input.operation);
  return validateReviewSuggestion(round, { kind: 'dondocs-review-suggestion', version: 1, id: `proposal_${crypto.randomUUID()}`,
    roundId: round.id, baselineDigest: round.baselineDigest, author: input.author, createdAt: Date.now(), label: structureSuggestionLabel(target),
    ...(input.category ? { category: input.category } : {}), origin: { kind: 'manual' },
    changes: [{ id: crypto.randomUUID(), target, expected: structureSuggestionText(target.operation.before), proposed: structureSuggestionText(target.operation.after) }] });
}

/** Capture a precise baseline selection; caret targets also support explicit insertion proposals. */
export function createSelectedTextSuggestion(round: ReviewRound, input: {
  author: string; label?: string; category?: FeedbackCategory; paragraphId: string; start: number; end: number; proposed: string;
}): ReviewSuggestion {
  const target = captureTextRange(round.baseline.session, input.paragraphId, input.start, input.end, { allowCaret: true });
  if (!target) throw new Error('Select supported plain text from one reviewed paragraph.');
  return createReviewSuggestion(round, { author: input.author, label: input.label ?? 'Replace selected text', category: input.category,
    changes: [{ target, proposed: input.proposed }] });
}

/** Map only the unique, plain paragraph ID. Never infer identity from a quote. */
export function inspectReviewSuggestionRange(source: SerializedSession, target: SelectedTextRange): ReviewRangeReconciliation | null {
  return inspectReviewSuggestionRangeUsing(source, target, reconcileReviewRange);
}
function inspectReviewSuggestionRangeUsing(source: SerializedSession, target: SelectedTextRange,
  reconcileRange: typeof reconcileReviewRange): ReviewRangeReconciliation | null {
  if (!supportsReviewComments(source) || source.docType !== target.docType || target.detached || target.tracking) return null;
  const matches = source.paragraphs.filter(paragraph => paragraph.id === target.paragraphId);
  if (matches.length !== 1 || !supportsPlainTextRange(matches[0])) return null;
  return reconcileRange(target, matches[0].text);
}

/** Validate the scoped splice without copying unrelated text or mapping discussions. */
function prepareReviewSuggestionRange(source: SerializedSession, target: SelectedTextRange, expected: string, proposed: string) {
  if (target.context.slice(target.start, target.end) !== expected) throw new Error('The selected text no longer matches this replacement.');
  const mapped = inspectReviewSuggestionRange(source, target);
  if (mapped?.kind !== 'independent' || !mapped.scope) throw new Error('The selected text no longer matches this replacement.');
  const { context, start, end } = mapped.scope;
  if (context.slice(start, end) !== expected) throw new Error('The selected text no longer matches this replacement.');
  const before = source.paragraphs.find(paragraph => paragraph.id === target.paragraphId)!;
  const text = context.slice(0, start) + proposed + context.slice(end);
  if (!supportsPlainTextRange({ ...before, text }) || !isTextRangeBoundary(text, start)
    || !isTextRangeBoundary(text, start + proposed.length)) throw new Error('The replacement must preserve supported plain text and complete characters.');
  return { before, text };
}

/** Pure scoped splice. Outside edits survive only an unambiguous independent mapping. */
export function applyReviewSuggestionRange(source: SerializedSession, target: SelectedTextRange, expected: string, proposed: string): SerializedSession {
  const { before, text } = prepareReviewSuggestionRange(source, target, expected, proposed);
  const session = structuredClone(source), after = { ...before, text };
  session.paragraphs[session.paragraphs.findIndex(paragraph => paragraph.id === target.paragraphId)] = after;
  const comments = transformRangeComments(source.reviewComments, before, after);

  if (comments) session.reviewComments = comments;
  else delete session.reviewComments;
  return session;
}

/** Exact current target retained by an acceptance; immutable proposal stays unchanged. */
export function resolvedReviewSuggestionRange(target: SelectedTextRange, resolution?: ReviewSuggestionResolution): SelectedTextRange {
  return resolution?.range ? { kind: 'range', paragraphId: target.paragraphId, docType: target.docType, ...resolution.range } : target;
}

/** Inverse target for the exact accepted splice, used by the existing Undo writer. */
export function acceptedReviewSuggestionRange(target: SelectedTextRange, proposed: string): SelectedTextRange {
  return { ...target, context: target.context.slice(0, target.start) + proposed + target.context.slice(target.end), end: target.start + proposed.length };
}

export interface ReviewSuggestionPlan {
  status: 'ready' | 'stale' | 'decided';
  changes: Array<{ id: string; label: string; baseline: string; current: string | null; proposed: string; stale: boolean; reconciliation?: ReviewRangeReconciliation }>;
  session: SerializedSession;
  state: ReviewSuggestionState;
}

export function inspectReviewSuggestion(round: ReviewRound, source: SerializedSession, input: ReviewSuggestion, acceptedResolutions?: readonly ReviewSuggestionResolution[]): ReviewSuggestionPlan['changes'] {
  return inspectReviewSuggestionUsing(round, source, input, acceptedResolutions, reconcileReviewRange);
}

/** Reuse only identical pure alignments during this synchronous display batch.
 * Every proposal and native target is still validated; writes use the uncached
 * single-proposal path. The bounded cache leaves scope when the batch returns.
 */
export function inspectReviewSuggestionBatch(round: ReviewRound, source: SerializedSession,
  inputs: readonly { proposal: ReviewSuggestion; resolutions?: readonly ReviewSuggestionResolution[] }[]): Array<ReviewSuggestionPlan['changes']> {
  if (inputs.length > REVIEW_SUGGESTION_LIMITS.proposals) throw new Error('The review contains too many suggestions.');
  const cache = new Map<string, ReviewRangeReconciliation>();
  let characters = 0;
  const reconcileRange: typeof reconcileReviewRange = (baseline, current) => {
    const key = JSON.stringify([baseline.context, baseline.start, baseline.end, current]);
    const cached = cache.get(key);
    if (cached) return { ...cached, ...(cached.scope ? { scope: { ...cached.scope } } : {}) };
    const result = reconcileReviewRange(baseline, current);
    if (cache.size < REVIEW_SUGGESTION_LIMITS.proposals * 2 && characters + key.length <= REVIEW_SUGGESTION_LIMITS.totalCharacters) {
      cache.set(key, result);characters += key.length;
    }
    return result;
  };
  return inputs.map(input => inspectReviewSuggestionUsing(round, source, input.proposal, input.resolutions, reconcileRange));
}

function inspectReviewSuggestionUsing(round: ReviewRound, source: SerializedSession, input: ReviewSuggestion,
  acceptedResolutions: readonly ReviewSuggestionResolution[] | undefined, reconcileRange: typeof reconcileReviewRange): ReviewSuggestionPlan['changes'] {
  const proposal = validateReviewSuggestion(round, input);
  const referencesMatch = !proposal.changes.some(change => change.target.kind === 'reference-title') || sameReviewReferences(source, round.baseline.session);
  return proposal.changes.map(change => {
    if (change.target.kind === 'structure') {
      const forward = inspectReviewStructure(source, change.target);
      const reverse = inspectReviewStructure(source, change.target, 'reverse');
      return { id: change.id, label: structureSuggestionLabel(change.target), baseline: change.expected,
        current: forward ? change.expected : reverse ? change.proposed : null, proposed: change.proposed, stale: !forward };
    }
    const reconciliation = change.target.kind === 'range' ? inspectReviewSuggestionRangeUsing(source, change.target, reconcileRange) : null;
    const resolution = acceptedResolutions?.find(item => item.changeId === change.id);
    const applied = change.target.kind === 'range' && resolution?.range
      ? inspectReviewSuggestionRangeUsing(source, acceptedReviewSuggestionRange(resolvedReviewSuggestionRange(change.target, resolution), resolution.value), reconcileRange) : null;
    const current = resolution?.range ? applied?.scope ? { value: applied.scope.context.slice(applied.scope.start, applied.scope.end),
      label: suggestionTargetValue(round.baseline.session, change.target)!.label } : null : reconciliation?.scope ? { value: reconciliation.scope.context.slice(reconciliation.scope.start, reconciliation.scope.end),
      label: suggestionTargetValue(round.baseline.session, change.target)!.label } : suggestionTargetValue(source, change.target);
    const accepted = change.target.kind === 'range' ? suggestionTargetValue(source, acceptedReviewSuggestionRange(change.target, change.proposed)) : null;
    return { id: change.id, label: current?.label ?? suggestionTargetValue(round.baseline.session, change.target)!.label,
      baseline: change.expected, current: current?.value ?? (resolution?.range ? null : accepted?.value ?? null), proposed: change.proposed,
      stale: change.target.kind === 'range' ? reconciliation?.kind !== 'independent' : current?.value !== change.expected || change.target.kind === 'reference-title' && !referencesMatch,
      ...(reconciliation ? { reconciliation } : {}) };
  });
}

/** Pure, all-member preflight. A rejected suggestion records no document edits. */
export function planReviewSuggestionDecision(round: ReviewRound, source: SerializedSession, inputState: ReviewSuggestionState,
  proposalId: string, action: 'accepted' | 'rejected', record: { id: string; decidedAt: number } = { id: crypto.randomUUID(), decidedAt: Date.now() },
  inputResolutions?: readonly ReviewSuggestionResolution[]): ReviewSuggestionPlan {
  const state = validateReviewSuggestionState(round, inputState);
  const proposal = state.proposals.find(item => item.id === proposalId);
  if (!proposal) throw new Error('The suggestion is unavailable.');
  const changes = inspectReviewSuggestion(round, source, proposal);
  const previous = latestReviewSuggestionDecision(state, proposalId);
  if (previous && previous.action !== 'reversed') return { status: 'decided', changes, session: structuredClone(source), state };
  let resolutions = inputResolutions && z.array(reviewSuggestionResolutionSchema).min(1).max(1).parse(inputResolutions);
  if (resolutions && proposal.changes.some(change => change.target.kind === 'structure')) throw new Error('Structural changes require their exact captured paragraph structure. Start a fresh proposal for changed content.');
  if (resolutions && (action !== 'accepted' || proposal.origin.kind !== 'manual' || proposal.changes.length !== 1
    || resolutions[0].changeId !== proposal.changes[0].id)) throw new Error('Only a supported manual replacement can be reconciled.');
  const rangeChange = proposal.changes[0].target.kind === 'range' ? proposal.changes[0] : null;
  if (resolutions && !!rangeChange !== !!resolutions[0].range) throw new Error('A selected resolution requires its exact current range scope.');
  if (action === 'accepted' && rangeChange) {
    const inspection = changes[0].reconciliation;
    const resolution = resolutions?.[0];
    const validCurrent = inspection && (resolution ? inspection.currentContext === resolution.range!.context
      : inspection.kind === 'independent' && !!inspection.scope);
    if (!validCurrent) return { status: 'stale', changes, session: structuredClone(source), state };
    if (!resolutions) {
      const scope = inspection!.scope!;
      resolutions = [{ changeId: rangeChange.id, expectedCurrent: scope.context.slice(scope.start, scope.end), value: rangeChange.proposed, range: scope }];
    }
  } else if (action === 'accepted' && changes.some(change => resolutions
    ? change.current === null || change.current !== resolutions[0].expectedCurrent : change.stale)) return { status: 'stale', changes, session: structuredClone(source), state };
  if (action === 'accepted' && proposal.changes.some(change => change.target.kind === 'structure'
    && !inspectReviewStructure(source, change.target, 'forward', reviewStructureReservedIds(state, proposal.id)))) return { status: 'stale', changes, session: structuredClone(source), state };
  let session = structuredClone(source);
  if (action === 'accepted') for (const change of proposal.changes) {
    const target = change.target;
    const value = resolutions?.[0].value ?? change.proposed;
    if (target.kind === 'field') Object.assign(session.formData, { [target.field]: value });
    else if (target.kind === 'paragraph') replaceReviewParagraphText(session, target.paragraphId, value);
    else if (target.kind === 'range') session = applyReviewSuggestionRange(session, resolvedReviewSuggestionRange(target, resolutions?.[0]), resolutions?.[0].expectedCurrent ?? change.expected, value);
    else if (target.kind === 'structure') session = applyReviewStructure(session, target, 'forward', reviewStructureReservedIds(state, proposal.id));
    else session.references[target.referenceIndex].title = value;
  }
  if (resolutions) state.version = 2;
  state.decisions.push({ ...record, proposalId, roundId: round.id, baselineDigest: round.baselineDigest,
    action, ...(previous ? { previousDecisionId: previous.id } : {}), ...(resolutions ? { resolutions } : {}) });
  return { status: 'ready', changes, session, state: reviewSuggestionStateSchema.parse(state) };
}

/** Called only for the owning History action tagged with this acceptance ID. */
export function planReviewSuggestionHistory(round: ReviewRound, before: SerializedSession, after: SerializedSession,
  inputState: ReviewSuggestionState, acceptanceId: string, direction: 'undo' | 'redo', record: { id: string; decidedAt: number } = { id: crypto.randomUUID(), decidedAt: Date.now() }): ReviewSuggestionState {
  const state = validateReviewSuggestionState(round, inputState);
  const acceptance = state.decisions.find(decision => decision.id === acceptanceId && decision.action === 'accepted');
  if (!acceptance) throw new Error('The review acceptance for this history action is unavailable.');
  const proposal = state.proposals.find(item => item.id === acceptance.proposalId)!;
  const previous = latestReviewSuggestionDecision(state, proposal.id)!;
  const activeId = previous.action === 'accepted' ? previous.id : previous.acceptanceId;
  if (activeId !== acceptanceId || direction === 'undo' && !['accepted', 'restored'].includes(previous.action)
    || direction === 'redo' && previous.action !== 'reversed') throw new Error('This history action no longer matches the latest review decision.');
  if (proposal.changes.some(change => change.target.kind === 'reference-title')) {
    const corrected = structuredClone(round.baseline.session);
    for (const change of proposal.changes) if (change.target.kind === 'reference-title') corrected.references[change.target.referenceIndex].title = change.proposed;
    if (!sameReviewReferences(before, direction === 'undo' ? corrected : round.baseline.session)
      || !sameReviewReferences(after, direction === 'undo' ? round.baseline.session : corrected)) throw new Error('The reference list no longer matches this review decision.');
  }
  for (const change of proposal.changes) {
    if (change.target.kind === 'structure') {
      const derived = applyReviewStructure(before, change.target, direction === 'undo' ? 'reverse' : 'forward', reviewStructureReservedIds(state, proposal.id));
      if (canonicalReviewPayload(derived.paragraphs) !== canonicalReviewPayload(after.paragraphs)) throw new Error('This history action does not reverse only the accepted paragraph operation.');
      continue;
    }
    const resolved = acceptance.resolutions?.find(item => item.changeId === change.id);
    const original = resolved?.expectedCurrent ?? change.expected, applied = resolved?.value ?? change.proposed;
    const target = change.target.kind === 'range' ? resolvedReviewSuggestionRange(change.target, resolved) : change.target;
    const appliedTarget = target.kind === 'range' ? acceptedReviewSuggestionRange(target, applied) : target;
    const historyValue = (source: SerializedSession, value: ReviewSuggestionTarget) => {
      if (value.kind !== 'range') return suggestionTargetValue(source, value)?.value;
      const mapping = inspectReviewSuggestionRange(source, value);
      return mapping?.kind === 'independent' && mapping.scope ? mapping.scope.context.slice(mapping.scope.start, mapping.scope.end) : undefined;
    };
    const oldValue = historyValue(before, direction === 'undo' ? appliedTarget : target);
    const nextValue = historyValue(after, direction === 'undo' ? target : appliedTarget);
    if (oldValue !== (direction === 'undo' ? applied : original)
      || nextValue !== (direction === 'undo' ? original : applied)) throw new Error('This history action does not reverse the accepted replacement.');
    if (target.kind === 'range' && appliedTarget.kind === 'range') {
      const derived = applyReviewSuggestionRange(before, direction === 'undo' ? appliedTarget : target,
        direction === 'undo' ? applied : original, direction === 'undo' ? original : applied);
      const expectedText = derived.paragraphs.find(paragraph => paragraph.id === target.paragraphId)!.text;
      if (after.paragraphs.find(paragraph => paragraph.id === target.paragraphId)?.text !== expectedText)
        throw new Error('This history action does not reverse only the accepted range.');
    }
  }
  state.decisions.push({ ...record, proposalId: proposal.id, roundId: round.id, baselineDigest: round.baselineDigest,
    action: direction === 'undo' ? 'reversed' : 'restored', previousDecisionId: previous.id, acceptanceId });
  return reviewSuggestionStateSchema.parse(state);
}

/** Reference entries have no editing IDs. Bind their ordered values as a whole. */
function sameReviewReferences(left: SerializedSession, right: SerializedSession): boolean {
  if (left.references.length !== right.references.length) return false;
  for (let index = 0; index < left.references.length; index++) {
    const reference = left.references[index];
    const other = right.references[index];
    if (!reference || !other || reference.letter !== other.letter || reference.title !== other.title || reference.url !== other.url) return false;
  }
  return true;
}
