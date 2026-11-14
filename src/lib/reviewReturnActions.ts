import { getExportDeploymentPolicy } from '@/config/classification';
import { getSerializedSession, type SerializedSession } from '@/stores/documentStore';
import {
  applyOwnedReviewReturn, captureDocumentTarget, flushPendingReviewWrites, hasPendingReviewWrites,
  isCurrentDocumentTarget, type DocumentTarget,
} from '@/stores/documentsStore';
import { detectTextPII, type PIIDetectionResult } from '@/services/pii/detector';
import { captureChangeReport, prepareChangeReport } from './changeReport';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { triggerDownload } from './encoding';
import { describeCommentAnchor, supportsReviewComments } from './reviewCommentTargets';
import { mergeReturnedComments, type ReviewCommentMerge, type ReviewReturnChoice } from './reviewCommentMerge';
import { readReviewCopyLink, readReviewRound, type ReviewRound } from './reviewRounds';
import {
  createReviewReturn, parseReviewReturn, readReviewReturnReceipt, reviewReturnDigest,
  reviewReturnReceiptSchema, type ReviewReturn,
} from './reviewReturns';

interface ReturnSafety {
  marking: string;
  customMarkings: string[];
  notices: string[];
  privacy: PIIDetectionResult;
}
const exportBrand = Symbol('PreparedReviewReturnExport'), importBrand = Symbol('PreparedReviewReturnImport');
export interface PreparedReviewReturnExport extends ReturnSafety {
  readonly [exportBrand]: true;
  readonly roundLabel: string;
  readonly comments: ReviewReturn['comments'];
}
export interface PreparedReviewReturnImport extends ReturnSafety {
  readonly [importBrand]: true;
  readonly roundLabel: string;
  readonly createdAt: number;
  readonly currentMarking: string;
  readonly alreadyImported: boolean;
  readonly comments: ReviewReturn['comments'];
  readonly plan: ReviewCommentMerge;
}
interface OwnedReturn {
  target: DocumentTarget;
  round: ReviewRound;
  payload: ReviewReturn;
  session: SerializedSession;
}
const exports = new WeakMap<PreparedReviewReturnExport, OwnedReturn>();
const imports = new WeakMap<PreparedReviewReturnImport, OwnedReturn & { digest: string; started: boolean }>();

function currentCapture(): { target: DocumentTarget; session: SerializedSession } {
  const target = captureDocumentTarget(), session = structuredClone(getSerializedSession());
  if (!target || !supportsReviewComments(session)) throw new Error('Open the native correspondence document for this review first.');
  return { target, session };
}
function current(target: DocumentTarget): void {
  if (!isCurrentDocumentTarget(target)) throw new Error('The draft changed. Prepare the return again against the current document.');
}
type ReturnContents = Pick<ReviewReturn, 'comments' | 'createdAt'> & { handling?: ReviewReturn['handling'] };
function textFields(payload: ReturnContents) {
  return (payload.comments?.threads ?? []).flatMap((thread, index) => [
    ...Object.values(thread.anchor).filter((value): value is string => typeof value === 'string'),
    ...thread.messages.flatMap(message => [message.author, message.text]),
  ].map(value => ({ field: `Returned discussion ${index + 1}`, value })))
    .concat([payload.handling?.marking ?? '', ...(payload.handling?.customMarkings ?? [])].map(value => ({ field: 'Return handling marking', value })));
}

/** Reuse retained-source marking policy; scan only text actually emitted in this file. */
function safety(round: ReviewRound, payload: ReturnContents, policy: PolicyResolution): ReturnSafety {
  const baseline = round.baseline.session;
  const report = prepareChangeReport(captureChangeReport(
    { label: 'Reviewed baseline', title: round.label, session: baseline },
    { label: 'Returned discussions', title: round.label, session: { ...baseline, reviewComments: payload.comments } },
    new Date(payload.createdAt).toISOString(),
  ), policy);
  if (payload.handling && (payload.handling.marking !== report.marking
    || JSON.stringify([...payload.handling.customMarkings].sort()) !== JSON.stringify([...report.customMarkings].sort()))) {
    throw new Error('The return handling markings do not match its baseline and comments. Ask the reviewer to export the return again.');
  }
  return { marking: report.marking, customMarkings: report.customMarkings, notices: report.notices, privacy: detectTextPII(textFields(payload)) };
}

export async function prepareReviewReturnExport(): Promise<PreparedReviewReturnExport> {
  const captured = currentCapture();
  if (hasPendingReviewWrites()) await flushPendingReviewWrites();
  current(captured.target);
  const link = await readReviewCopyLink(captured.target.scope.documentId);
  if (!link) throw new Error('This document is not a linked reviewer copy. Open a reviewer copy before returning feedback.');
  const round = await readReviewRound(link.roundId);
  if (!round || round.baselineDigest !== link.baselineDigest) throw new Error('The reviewed baseline is unavailable or changed. Keep this draft and obtain the original review copy.');
  const raw = { comments: captured.session.reviewComments, createdAt: Date.now() };
  const policy = await getExportDeploymentPolicy(undefined, true);
  current(captured.target);
  const checked = safety(round, raw, policy);
  const payload = createReviewReturn(round.id, round.baselineDigest, raw.comments, { marking: checked.marking, customMarkings: checked.customMarkings });
  const result: PreparedReviewReturnExport = Object.freeze({ [exportBrand]: true as const, roundLabel: round.label,
    comments: structuredClone(payload.comments), ...checked, privacy: detectTextPII(textFields(payload)) });
  exports.set(result, { ...captured, round: structuredClone(round), payload });
  return result;
}

export function downloadReviewReturn(prepared: PreparedReviewReturnExport): void {
  const owned = exports.get(prepared);
  if (!owned) throw new Error('Prepare this return before downloading it.');
  current(owned.target);
  if (hasPendingReviewWrites()) throw new Error('Review changes are still saving. Prepare the return again after Save completes.');
  triggerDownload(new TextEncoder().encode(JSON.stringify(owned.payload, null, 2)),
    `dondocs-review-return-${new Date(owned.payload.createdAt).toISOString().slice(0, 10)}.json`, 'application/json');
}

export async function prepareReviewReturnImport(value: unknown): Promise<PreparedReviewReturnImport> {
  const captured = currentCapture(), payload = parseReviewReturn(value);
  if (hasPendingReviewWrites()) await flushPendingReviewWrites();
  current(captured.target);
  const round = await readReviewRound(payload.roundId);
  if (!round || round.ownerDocumentId !== captured.target.scope.documentId) throw new Error('Open the original draft that owns this review round. This return cannot be attached to another document.');
  if (round.baselineDigest !== payload.baselineDigest) throw new Error('This return belongs to a different baseline revision. Nothing was changed.');
  const digest = await reviewReturnDigest(payload), previous = await readReviewReturnReceipt(round.id, payload.id);
  if (previous && (previous.returnDigest !== digest || previous.documentId !== round.ownerDocumentId || previous.baselineDigest !== round.baselineDigest)) {
    throw new Error('Different feedback uses an already imported return identity. Ask the reviewer to export a new return.');
  }
  const policy = await getExportDeploymentPolicy(undefined, true);
  current(captured.target);
  const checked = safety(round, payload, policy);
  const plan = previous ? { status: 'ready' as const, comments: captured.session.reviewComments, conflicts: [], changedThreads: 0, addedThreads: 0, removedThreads: 0 }
    : mergeReturnedComments(round.baseline.session.reviewComments, captured.session.reviewComments, payload.comments);
  const local = prepareChangeReport(captureChangeReport(
    { label: 'Current captured draft', title: 'Current draft', session: captured.session },
    { label: 'Proposed discussions', title: 'Current draft', session: { ...captured.session, reviewComments: plan.comments } },
    new Date(payload.createdAt).toISOString(),
  ), policy);
  const result: PreparedReviewReturnImport = Object.freeze({ [importBrand]: true as const, roundLabel: round.label, createdAt: payload.createdAt,
    currentMarking: local.marking, alreadyImported: previous !== null, comments: structuredClone(payload.comments), plan: structuredClone(plan), ...checked });
  imports.set(result, { ...captured, round: structuredClone(round), payload, digest, started: false });
  return result;
}

export function reviewReturnPlan(prepared: PreparedReviewReturnImport, choices: Readonly<Record<string, ReviewReturnChoice>>): ReviewCommentMerge {
  const owned = imports.get(prepared);
  if (!owned || owned.started || prepared.alreadyImported) throw new Error('Prepare the return again before applying it.');
  current(owned.target);
  return mergeReturnedComments(owned.round.baseline.session.reviewComments, owned.session.reviewComments, owned.payload.comments, choices);
}

export function reviewReturnTargetLabel(prepared: PreparedReviewReturnImport, threadId: string): string {
  const owned = imports.get(prepared);
  const thread = owned && [owned.session.reviewComments, owned.payload.comments, owned.round.baseline.session.reviewComments]
    .flatMap(comments => comments?.threads ?? []).find(thread => thread.id === threadId);
  return owned && thread ? describeCommentAnchor(owned.session, thread.anchor).label : 'Discussion';
}

export async function applyReviewReturn(prepared: PreparedReviewReturnImport, choices: Readonly<Record<string, ReviewReturnChoice>>): Promise<'committed' | 'pending' | 'stale' | 'invalid' | 'already-imported'> {
  const owned = imports.get(prepared);
  if (!owned || owned.started) throw new Error('This return has already been applied. Prepare it again to check its saved state.');
  current(owned.target);
  if (prepared.alreadyImported) return 'already-imported';
  const plan = reviewReturnPlan(prepared, choices);
  if (plan.status !== 'ready') throw new Error('Choose how to resolve every conflicting discussion before importing.');
  const receipt = reviewReturnReceiptSchema.parse({ kind: 'dondocs-review-return-receipt', version: 1,
    roundId: owned.round.id, baselineDigest: owned.round.baselineDigest, documentId: owned.target.scope.documentId,
    returnId: owned.payload.id, returnDigest: owned.digest, importedAt: Date.now() });
  owned.started = true;
  return applyOwnedReviewReturn(owned.target, plan.comments, { kind: 'comment-return', round: {
    id: owned.round.id, baselineDigest: owned.round.baselineDigest, ownerDocumentId: owned.target.scope.documentId,
  }, receipt });
}
