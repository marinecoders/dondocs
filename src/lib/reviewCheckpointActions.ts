import { captureDocumentTarget, isCurrentDocumentTarget, type DocumentTarget } from '@/stores/documentsStore';
import { scheduleBackup } from '@/stores/backupStore';
import { loadReviewSuggestionWorkspace } from './reviewSuggestionActions';
import { idbSaveReviewCheckpoint } from './documentsDb';
import { assertCheckpointRound, createReviewCheckpoint, parseReviewCheckpoint, planReviewCheckpointUpdate, checkpointRetainedContent } from './reviewCheckpoints';
import { captureChangeReport, prepareChangeReport, type ChangeReport } from './changeReport';
import { MAX_REVIEW_CHECKPOINT_BYTES, type ReviewCheckpoint } from './reviewCheckpointModel';
import type { ReviewRound } from './reviewRounds';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { triggerDownload } from './encoding';

function current(target: DocumentTarget | null): void {
  if (!isCurrentDocumentTarget(target)) throw new Error('The draft changed. Refresh the checkpoint view before continuing.');
}

export async function saveReviewCheckpoint(roundId: string, reviewer: { id: string; label: string }): Promise<ReviewRound> {
  const context = await loadReviewSuggestionWorkspace(roundId);
  const checkpoint = await createReviewCheckpoint(context.round, context.current, context.state, reviewer);
  current(context.target);
  planReviewCheckpointUpdate(context.round, checkpoint);
  const saved = await idbSaveReviewCheckpoint(context.round, checkpoint, context.target.scope.documentId,
    () => isCurrentDocumentTarget(context.target));
  if (!saved) throw new Error('The round or draft changed, or storage failed. Refresh before marking this version reviewed.');
  scheduleBackup();
  return saved;
}

export async function importReviewCheckpoint(value: unknown, target = captureDocumentTarget()): Promise<ReviewRound> {
  current(target);
  const checkpoint = await parseReviewCheckpoint(value);
  const context = await loadReviewSuggestionWorkspace(checkpoint.roundId);
  current(target);
  assertCheckpointRound(checkpoint, context.round);
  planReviewCheckpointUpdate(context.round, checkpoint);
  const saved = await idbSaveReviewCheckpoint(context.round, checkpoint, context.target.scope.documentId,
    () => isCurrentDocumentTarget(target));
  if (!saved) throw new Error('The round or draft changed, or storage failed. Keep the checkpoint file and refresh before retrying.');
  scheduleBackup();
  return saved;
}

export interface PreparedCheckpointExport {
  readonly review: ChangeReport;
  readonly reviewerLabel: string;
  readonly capturedAt: number;
}
const exports = new WeakMap<PreparedCheckpointExport, { checkpoint: ReviewCheckpoint; round: ReviewRound }>();

/** Scan all emitted checkpoint text, including earlier removed content, through existing policy checks. */
export async function prepareCheckpointExport(input: ReviewCheckpoint, round: ReviewRound, policy: PolicyResolution): Promise<PreparedCheckpointExport> {
  const retained = structuredClone(round);
  const checkpoint = await parseReviewCheckpoint(structuredClone(input));
  assertCheckpointRound(checkpoint, retained);
  const baseline = retained.baseline.session;
  const retainedContent = checkpointRetainedContent([checkpoint]);
  const review = prepareChangeReport(captureChangeReport(
    { label: 'Retained review baseline', title: retained.label, session: baseline },
    { label: 'Captured reviewer checkpoint', title: checkpoint.reviewerLabel, session: baseline },
    new Date(checkpoint.capturedAt).toISOString(), retainedContent,
  ), policy);
  const prepared = Object.freeze({ review, reviewerLabel: checkpoint.reviewerLabel, capturedAt: checkpoint.capturedAt });
  exports.set(prepared, { checkpoint, round: retained });
  return prepared;
}

export function downloadReviewCheckpoint(prepared: PreparedCheckpointExport, policy: PolicyResolution): void {
  const owned = exports.get(prepared);
  if (!owned) throw new Error('Review the checkpoint before downloading it.');
  const { checkpoint, round } = owned;
  prepareChangeReport(captureChangeReport(
    { label: 'Retained review baseline', title: round.label, session: round.baseline.session },
    { label: 'Captured reviewer checkpoint', title: checkpoint.reviewerLabel, session: round.baseline.session },
    new Date(checkpoint.capturedAt).toISOString(), checkpointRetainedContent([checkpoint]),
  ), policy);
  const bytes = new TextEncoder().encode(JSON.stringify(checkpoint));
  if (bytes.byteLength > MAX_REVIEW_CHECKPOINT_BYTES) throw new Error('The checkpoint exceeds its 2 MB transfer limit.');
  triggerDownload(bytes, `review-checkpoint-${new Date(checkpoint.capturedAt).toISOString().slice(0, 10)}.json`, 'application/json');
}
