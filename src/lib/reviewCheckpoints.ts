import type { SerializedSession } from '@/stores/documentStore';
import { captureReportMarkings, reviewComparisonSession, type ReportMarkingContext } from './changeReport';
import { describeCommentAnchor } from './reviewCommentTargets';
import { feedbackCategoryLabel } from './reviewFeedback';
import { inspectReviewSuggestion, latestReviewSuggestionDecision, type ReviewSuggestionState } from './reviewSuggestions';
import { parseReviewRound, reviewPayloadDigest, type ReviewRound } from './reviewRounds';
import { reviewCheckpointSchema, MAX_REVIEW_CHECKPOINTS, MAX_REVIEW_CHECKPOINT_BYTES, type CheckpointField, type ReviewCheckpoint } from './reviewCheckpointModel';

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, first => first.toUpperCase());
}

/** Reuse report projection so checkpoints do not retain binary resources or opaque asset handles. */
export function checkpointDocumentFields(session: SerializedSession): CheckpointField[] {
  const fields: CheckpointField[] = [];
  function walk(value: unknown, path: Array<string | number>, labels: string[]) {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const paragraph = path.length === 1 && path[0] === 'paragraphs'
          && item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' ? item.id : undefined;
        const key = [...path, paragraph ?? index];
        const label = [...labels, String(index + 1)];
        if (paragraph) fields.push({ key: JSON.stringify([...key, '$position']), label: `Paragraph ${index + 1} position`, value: String(index + 1) });
        walk(item, key, label);
      });
    } else if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (key !== 'id' && key !== 'timestamp') walk(child, [...path, key], [...labels, humanize(key)]);
      }
    } else {
      fields.push({ key: JSON.stringify(path), label: labels.join(' › '), value: String(value) });
    }
  }
  walk(reviewComparisonSession(session), [], []);
  return fields.sort((left, right) => left.key.localeCompare(right.key));
}

export function checkpointFeedbackFields(round: ReviewRound, session: SerializedSession,
  state: ReviewSuggestionState | null): CheckpointField[] {
  const fields: CheckpointField[] = [];
  const add = (key: string, label: string, value: string) => fields.push({ key, label, value });
  for (const thread of session.reviewComments?.threads ?? []) {
    const key = `discussion:${thread.id}`;
    const label = `Discussion: ${describeCommentAnchor(session, thread.anchor).label}`;
    add(`${key}:status`, `${label} · Status`, thread.resolved ? 'Resolved' : 'Open');
    add(`${key}:category`, `${label} · Category`, feedbackCategoryLabel(thread.category));
    if (thread.anchor.kind !== 'document') add(`${key}:context`, `${label} · Retained context`, thread.anchor.context);
    thread.messages.forEach((message, index) => {
      add(`${key}:message:${message.id}:author`, `${label} · Message ${index + 1} reviewer`, message.author);
      add(`${key}:message:${message.id}:text`, `${label} · Message ${index + 1}`, message.text);
    });
  }
  for (const proposal of state?.proposals ?? []) {
    const changes = inspectReviewSuggestion(round, session, proposal);
    const decision = latestReviewSuggestionDecision(state!, proposal.id);
    const key = `proposal:${proposal.id}`;
    const label = `Suggestion: ${proposal.label}`;
    const status = decision?.action === 'accepted' || decision?.action === 'restored' ? 'Accepted'
      : decision?.action === 'rejected' ? 'Rejected'
        : changes.some(change => change.stale) ? 'Conflicting / needs reconciliation' : 'Open';
    add(`${key}:status`, `${label} · Status`, status);
    add(`${key}:label`, 'Suggestion label', proposal.label);
    add(`${key}:category`, `${label} · Category`, feedbackCategoryLabel(proposal.category));
    add(`${key}:author`, `${label} · Reviewer`, proposal.author);
    if (decision) {
      add(`${key}:decision`, `${label} · Latest decision`, decision.action);
      add(`${key}:decision-time`, `${label} · Decision time`, new Date(decision.decidedAt).toISOString());
    }
    for (const change of changes) {
      add(`${key}:${change.id}:baseline`, `${label} · ${change.label} · Baseline`, change.baseline);
      add(`${key}:${change.id}:current`, `${label} · ${change.label} · Current`, change.current ?? '(Unavailable)');
      add(`${key}:${change.id}:proposed`, `${label} · ${change.label} · Proposed`, change.proposed);
    }
  }
  return fields;
}

export async function createReviewCheckpoint(round: ReviewRound, session: SerializedSession,
  state: ReviewSuggestionState | null, reviewer: { id: string; label: string }, capturedAt = Date.now()): Promise<ReviewCheckpoint> {
  const content = { kind: 'dondocs-review-checkpoint' as const, version: 1 as const, id: crypto.randomUUID(),
    reviewerId: reviewer.id, reviewerLabel: reviewer.label.trim(), roundId: round.id, baselineDigest: round.baselineDigest,
    capturedAt, document: checkpointDocumentFields(session), feedback: checkpointFeedbackFields(round, session, state),
    markings: captureReportMarkings(session) };
  const parsed = reviewCheckpointSchema.parse({ ...content, digest: '0'.repeat(64) });
  return { ...parsed, digest: await reviewPayloadDigest(content) };
}

export async function parseReviewCheckpoint(value: unknown): Promise<ReviewCheckpoint> {
  const parsed = reviewCheckpointSchema.parse(value);
  const { digest, ...content } = parsed;
  if (await reviewPayloadDigest(content) !== digest) throw new Error('The checkpoint checksum does not match its captured text.');
  return parsed;
}

export function assertCheckpointRound(checkpoint: ReviewCheckpoint, round: Pick<ReviewRound, 'id' | 'baselineDigest'>): void {
  if (checkpoint.roundId !== round.id || checkpoint.baselineDigest !== round.baselineDigest) {
    throw new Error('This checkpoint belongs to another review baseline. Select its original review round.');
  }
}

/** The serialized document fields independently preserve their declared marking floor. */
function checkpointDocumentMarkings(fields: readonly CheckpointField[]) {
  const values = new Map(fields.map(field => [field.key, field.value]));
  const parents = new Set<string>();
  const contexts: ReportMarkingContext[] = [];
  for (const field of fields) {
    const path = JSON.parse(field.key) as Array<string | number>;
    const key = path.at(-1);
    if (key === 'classLevel' || key === 'customClassification') {
      const parent = path.slice(0, -1);
      const parentKey = JSON.stringify(parent);
      if (!parents.has(parentKey)) {
        parents.add(parentKey);
        const classLevel = values.get(JSON.stringify([...parent, 'classLevel']));
        const customClassification = values.get(JSON.stringify([...parent, 'customClassification']));
        contexts.push({ ...(classLevel === undefined ? {} : { classLevel }),
          ...(customClassification === undefined ? {} : { customClassification }) });
      }
    }
    if (typeof key === 'string' && /portion|marking/i.test(key)) contexts.push({ portionMarking: field.value });
  }
  return contexts;
}

export function checkpointRetainedContent(checkpoints: readonly ReviewCheckpoint[]) {
  return {
    text: checkpoints.flatMap(checkpoint => [
      { field: 'Checkpoint reviewer label', value: checkpoint.reviewerLabel },
      ...[...checkpoint.document, ...checkpoint.feedback].flatMap(field => [
        { field: 'Checkpoint field label', value: field.label },
        { field: field.label, value: field.value },
      ]),
    ]),
    markings: checkpoints.flatMap(checkpoint => [...structuredClone(checkpoint.markings), ...checkpointDocumentMarkings(checkpoint.document)]),
  };
}

export function planReviewCheckpointUpdate(round: ReviewRound, checkpoint: ReviewCheckpoint): ReviewRound {
  assertCheckpointRound(checkpoint, round);
  const checkpoints = [...(round.checkpoints ?? []).filter(item => item.reviewerId !== checkpoint.reviewerId), checkpoint];
  if (checkpoints.length > MAX_REVIEW_CHECKPOINTS) {
    throw new Error('This review has 25 reviewer markers. Select an existing marker to update it.');
  }
  if (new TextEncoder().encode(JSON.stringify(checkpoints)).byteLength > MAX_REVIEW_CHECKPOINT_BYTES) {
    throw new Error('The combined reviewer checkpoints exceed 2 MB. Keep separate checkpoint files for this review.');
  }
  return parseReviewRound({ ...round, checkpoints });
}

export interface CheckpointChange { label: string; before: string; after: string }
export interface CheckpointComparison { document: CheckpointChange[]; feedback: CheckpointChange[] }

export function compareReviewCheckpoint(checkpoint: ReviewCheckpoint, round: ReviewRound, session: SerializedSession,
  state: ReviewSuggestionState | null): CheckpointComparison {
  assertCheckpointRound(checkpoint, round);
  function compare(before: CheckpointField[], after: CheckpointField[], feedback = false): CheckpointChange[] {
    const left = new Map(before.map(field => [field.key, field]));
    const right = new Map(after.map(field => [field.key, field]));
    return [...new Set([...left.keys(), ...right.keys()])].flatMap(key => {
      const a = left.get(key), b = right.get(key);
      return a?.value === b?.value ? [] : [{ label: (b ?? a)!.label,
        before: a?.value ?? (feedback ? '(Not recorded at checkpoint)' : '(Absent)'),
        after: b?.value ?? (feedback ? '(Not available in this copy; no removal or decision is inferred)' : '(Absent)') }];
    });
  }
  return { document: compare(checkpoint.document, checkpointDocumentFields(session)),
    feedback: compare(checkpoint.feedback, checkpointFeedbackFields(round, session, state), true) };
}
