import { z } from 'zod';
import type { SerializedSession } from '@/stores/documentStore';
import { paragraphIdSchema } from './paragraphIdentity';
import { availableCommentFields, commentFieldLabel, supportsReviewComments } from './reviewCommentTargets';
import { reviewDigestSchema, reviewRoundIdSchema, type ReviewRound } from './reviewRounds';
import { mechanicalFindings } from './mechanicalCorrections';

export const REVIEW_SUGGESTION_LIMITS = { proposals: 100, changes: 20, decisions: 1_000, value: 20_000, totalCharacters: 200_000 } as const;
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
export const reviewProposalIdSchema = z.string().regex(/^proposal_[0-9a-f-]{36}$/).refine(value => z.string().uuid().safeParse(value.slice(9)).success);
const changeId = z.string().uuid();

export const reviewSuggestionTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('field'), field: z.string().regex(/^[a-z][A-Za-z0-9]*$/).max(100), docType: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('paragraph'), paragraphId: paragraphIdSchema, docType: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('reference-title'), referenceIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), docType: z.string().min(1).max(100) }).strict(),
]);
export type ReviewSuggestionTarget = z.infer<typeof reviewSuggestionTargetSchema>;
export const reviewSuggestionChangeSchema = z.object({
  id: changeId, target: reviewSuggestionTargetSchema,
  expected: z.string().max(REVIEW_SUGGESTION_LIMITS.value), proposed: z.string().max(REVIEW_SUGGESTION_LIMITS.value),
}).strict().refine(value => value.expected !== value.proposed, 'A suggestion must change its target value.');
export type ReviewSuggestionChange = z.infer<typeof reviewSuggestionChangeSchema>;

/** Each manual suggestion is one change; a mechanical group is decided atomically. */
export const reviewSuggestionSchema = z.object({
  kind: z.literal('dondocs-review-suggestion'), version: z.literal(1),
  id: reviewProposalIdSchema, roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema,
  author: z.string().trim().min(1).max(100), createdAt: timestamp,
  label: z.string().trim().min(1).max(120),
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
    characters += change.expected.length + change.proposed.length;
  }
  if (value.origin.kind === 'manual' && value.changes.length !== 1) context.addIssue({ code: 'custom', message: 'A manual suggestion replaces one field or paragraph.' });
  if (characters > REVIEW_SUGGESTION_LIMITS.totalCharacters) context.addIssue({ code: 'custom', message: 'The suggestion exceeds the supported text limit.' });
});
export type ReviewSuggestion = z.infer<typeof reviewSuggestionSchema>;

export function reviewSuggestionText(proposals: readonly ReviewSuggestion[]): Array<{ field: string; value: string }> {
  return proposals.flatMap((proposal, index) => [proposal.author, proposal.label, proposal.origin.rule ?? '', proposal.origin.context ?? '',
    ...proposal.changes.flatMap(change => [change.expected, change.proposed, ...Object.values(change.target).filter((value): value is string => typeof value === 'string')])].map(value => ({ field: `Suggested replacement ${index + 1}`, value })));
}

export const reviewSuggestionDecisionSchema = z.object({
  id: z.string().uuid(), proposalId: reviewProposalIdSchema,
  roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema,
  action: z.enum(['accepted', 'rejected', 'reversed', 'restored']), decidedAt: timestamp,
  previousDecisionId: z.string().uuid().optional(), acceptanceId: z.string().uuid().optional(),
}).strict();
export type ReviewSuggestionDecision = z.infer<typeof reviewSuggestionDecisionSchema>;

export const reviewSuggestionStateSchema = z.object({
  kind: z.literal('dondocs-review-suggestions'), version: z.literal(1),
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
      ids.add(change.id);characters += change.expected.length + change.proposed.length;
    }
    characters += proposal.author.length + proposal.label.length + (proposal.origin.rule?.length ?? 0) + (proposal.origin.context?.length ?? 0);
  }
  for (const decision of value.decisions) {
    if (decision.roundId !== value.roundId || decision.baselineDigest !== value.baselineDigest || !proposals.has(decision.proposalId)) context.addIssue({ code: 'custom', message: 'Decision does not match a suggestion in this round.' });
    if (ids.has(decision.id)) context.addIssue({ code: 'custom', message: 'Decision IDs must be unique.' });
    const previous = latest.get(decision.proposalId);
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

export function suggestionTargetKey(target: ReviewSuggestionTarget): string {
  return target.kind === 'field' ? `field:${target.field}` : target.kind === 'paragraph' ? `paragraph:${target.paragraphId}` : `reference-title:${target.referenceIndex}`;
}

export function suggestionTargetValue(session: SerializedSession, target: ReviewSuggestionTarget): { label: string; value: string } | null {
  if (!supportsReviewComments(session) || session.docType !== target.docType) return null;
  if (target.kind === 'field') {
    const field = availableCommentFields(session).find(item => item.field === target.field);
    return field ? { label: commentFieldLabel(target.field), value: field.value } : null;
  }
  if (target.kind === 'reference-title') {
    const reference = session.references[target.referenceIndex];
    return reference ? { label: `Reference ${target.referenceIndex + 1} title`, value: reference.title } : null;
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
    const baseline = suggestionTargetValue(round.baseline.session, change.target);
    if (!baseline || baseline.value !== change.expected) throw new Error('This suggestion does not match a supported field or paragraph in the reviewed baseline.');
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
  for (const proposal of state.proposals) validateReviewSuggestion(round, proposal);
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
  author: string; label: string; origin?: ReviewSuggestion['origin'];
  changes: ReadonlyArray<{ target: ReviewSuggestionTarget; proposed: string }>;
}): ReviewSuggestion {
  return validateReviewSuggestion(round, {
    kind: 'dondocs-review-suggestion', version: 1, id: `proposal_${crypto.randomUUID()}`,
    roundId: round.id, baselineDigest: round.baselineDigest, author: input.author,
    createdAt: Date.now(), label: input.label, origin: input.origin ?? { kind: 'manual' },
    changes: input.changes.map(change => {
      const baseline = suggestionTargetValue(round.baseline.session, change.target);
      if (!baseline) throw new Error('Choose a supported text field or whole paragraph from the reviewed baseline.');
      return { id: crypto.randomUUID(), target: change.target, expected: baseline.value, proposed: change.proposed };
    }),
  });
}

export interface ReviewSuggestionPlan {
  status: 'ready' | 'stale' | 'decided';
  changes: Array<{ id: string; label: string; baseline: string; current: string | null; proposed: string; stale: boolean }>;
  session: SerializedSession;
  state: ReviewSuggestionState;
}

export function inspectReviewSuggestion(round: ReviewRound, source: SerializedSession, input: ReviewSuggestion): ReviewSuggestionPlan['changes'] {
  const proposal = validateReviewSuggestion(round, input);
  const referencesMatch = !proposal.changes.some(change => change.target.kind === 'reference-title') || sameReviewReferences(source, round.baseline.session);
  return proposal.changes.map(change => {
    const current = suggestionTargetValue(source, change.target);
    return { id: change.id, label: current?.label ?? suggestionTargetValue(round.baseline.session, change.target)!.label,
      baseline: change.expected, current: current?.value ?? null, proposed: change.proposed,
      stale: current?.value !== change.expected || change.target.kind === 'reference-title' && !referencesMatch };
  });
}

/** Pure, all-member preflight. A rejected suggestion records no document edits. */
export function planReviewSuggestionDecision(round: ReviewRound, source: SerializedSession, inputState: ReviewSuggestionState,
  proposalId: string, action: 'accepted' | 'rejected', record: { id: string; decidedAt: number } = { id: crypto.randomUUID(), decidedAt: Date.now() }): ReviewSuggestionPlan {
  const state = validateReviewSuggestionState(round, inputState);
  const proposal = state.proposals.find(item => item.id === proposalId);
  if (!proposal) throw new Error('The suggestion is unavailable.');
  const changes = inspectReviewSuggestion(round, source, proposal);
  const previous = latestReviewSuggestionDecision(state, proposalId);
  if (previous && previous.action !== 'reversed') return { status: 'decided', changes, session: structuredClone(source), state };
  if (action === 'accepted' && changes.some(change => change.stale)) return { status: 'stale', changes, session: structuredClone(source), state };
  const session = structuredClone(source);
  if (action === 'accepted') for (const change of proposal.changes) {
    const target = change.target;
    if (target.kind === 'field') Object.assign(session.formData, { [target.field]: change.proposed });
    else if (target.kind === 'paragraph') session.paragraphs.find(paragraph => paragraph.id === target.paragraphId)!.text = change.proposed;
    else session.references[target.referenceIndex].title = change.proposed;
  }
  state.decisions.push({ ...record, proposalId, roundId: round.id, baselineDigest: round.baselineDigest,
    action, ...(previous ? { previousDecisionId: previous.id } : {}) });
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
    const oldValue = suggestionTargetValue(before, change.target)?.value;
    const nextValue = suggestionTargetValue(after, change.target)?.value;
    if (oldValue !== (direction === 'undo' ? change.proposed : change.expected)
      || nextValue !== (direction === 'undo' ? change.expected : change.proposed)) throw new Error('This history action does not reverse the accepted replacement.');
  }
  state.decisions.push({ ...record, proposalId: proposal.id, roundId: round.id, baselineDigest: round.baselineDigest,
    action: direction === 'undo' ? 'reversed' : 'restored', previousDecisionId: previous.id, acceptanceId });
  return reviewSuggestionStateSchema.parse(state);
}

/** Reference entries have no editing IDs. Bind their ordered values as a whole. */
function sameReviewReferences(left: SerializedSession, right: SerializedSession): boolean {
  return left.references.length === right.references.length && left.references.every((reference, index) => {
    const other = right.references[index];
    return reference.letter === other.letter && reference.title === other.title && reference.url === other.url;
  });
}
