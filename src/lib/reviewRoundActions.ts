import { buildDraftFileFromSnapshot, parseDraftFile, type ReviewedDraft } from './draftFile';
import { captureCurrentDocumentRevision } from '@/stores/captureDocument';
import { copyCapturedDocument } from './capturedDocument';
import { serializeDocumentSnapshot } from './documentSerialization';
import { getSerializedSession, prepareSessionState } from '@/stores/documentStore';
import { captureDocumentTarget, copyPreparedDocument, deriveTitle, isCurrentDocumentTarget, openCommittedReviewCopy,
  prepareReviewedDocument, flushDocumentWrites, hasPendingReviewWrites, flushPendingReviewWrites, useDocumentsStore, type DocumentTarget } from '@/stores/documentsStore';
import { idbAddReviewRound, idbInstallReviewCopy, idbTransitionReviewRound, type StoredDocument } from './documentsDb';
import { withAttachmentStaging } from './attachments';
import { supportsReviewComments } from './reviewCommentTargets';
import { captureChangeReport, prepareChangeReport, type ChangeReport } from './changeReport';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { triggerDownload } from './encoding';
import { MAX_REVIEW_COPY_BYTES, REVIEW_COPY_KIND, parseReviewRound, reviewCopyEnvelopeSchema, reviewPayloadDigest,
  type ReviewRound, type ReviewCopyEnvelope } from './reviewRounds';
import { readReviewRound } from './reviewRounds';
import { assertCheckpointRound, parseReviewCheckpoint, checkpointRetainedContent } from './reviewCheckpoints';
import { planReviewRoundTransition, type ReviewRoundTransition } from './reviewRoundLifecycle';
import { scheduleBackup } from '@/stores/backupStore';
import { documentTextFields } from './documentFields';

function assertCurrent(target: DocumentTarget | null): asserts target is DocumentTarget {
  if (!isCurrentDocumentTarget(target)) throw new Error('The document changed. Reopen Reviews before trying again.');
}
const builtCopies = new WeakMap<ReviewCopyEnvelope, ReviewCopyEnvelope>();

/** A pin owns existing immutable file handles; unfinished uploads must settle first. */
export async function startReviewRound(label: string, target = captureDocumentTarget()): Promise<ReviewRound> {
  assertCurrent(target);
  useDocumentsStore.getState().saveCurrent();
  const captured = copyCapturedDocument(captureCurrentDocumentRevision());
  if (captured.kind !== 'correspondence' || !supportsReviewComments(captured.document)) throw new Error('Review rounds currently support native correspondence only.');
  const snapshot = captured.document, createdAt = Date.now();
  if (!snapshot.reviewComments?.threads.length) delete snapshot.reviewComments;
  if (snapshot.enclosures.some(enclosure => enclosure.file && !enclosure.fileRef)
    || snapshot.formData.basicLetterFile && !snapshot.formData.basicLetterFileRef) throw new Error('An attachment is still being saved. Wait for the upload to finish and try again.');
  return withAttachmentStaging(async () => {
    const draft = await buildDraftFileFromSnapshot(snapshot, createdAt);
    parseDraftFile(draft, false, true);
    const baselineDigest = await reviewPayloadDigest(draft);
    await flushDocumentWrites();
    assertCurrent(target);
    const round = parseReviewRound({ kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
      createdAt, label: label.trim(), sourceDocumentId: target.scope.documentId, ownerDocumentId: target.scope.documentId,
      baselineDigest, baseline: { ts: createdAt, session: serializeDocumentSnapshot(snapshot, createdAt) } });
    const result = await idbAddReviewRound(round);
    if (result !== 'committed' && result !== 'unchanged') throw new Error('The review baseline could not be saved. Nothing is ready to send; check browser storage and try again.');
    scheduleBackup();
    return round;
  });
}

/** Read only the retained snapshot; newer editor work never enters a reviewer copy. */
export async function buildReviewCopy(round: ReviewRound): Promise<ReviewCopyEnvelope> {
  const pin = parseReviewRound(round);
  for (const checkpoint of pin.checkpoints ?? []) {
    assertCheckpointRound(await parseReviewCheckpoint(checkpoint), pin);
  }
  const draft = await buildDraftFileFromSnapshot(prepareSessionState(pin.baseline.session, true), pin.baseline.ts);
  parseDraftFile(draft, false, true);
  if (await reviewPayloadDigest(draft) !== pin.baselineDigest) throw new Error('The saved review baseline no longer matches its retained resources. Keep the original reviewer file and retry from an intact backup.');
  const { id, createdAt, label, sourceDocumentId, baselineDigest, lifecycle, checkpoints } = pin;
  const envelope: ReviewCopyEnvelope = {
    kind: REVIEW_COPY_KIND,
    version: 1,
    round: { id, createdAt, label, sourceDocumentId, baselineDigest,
      ...(lifecycle ? { lifecycle } : {}), ...(checkpoints?.length ? { checkpoints } : {}) },
    draft,
  };
  builtCopies.set(envelope, structuredClone(envelope));
  return envelope;
}

export interface ReviewedReviewCopy {
  envelope: ReviewCopyEnvelope;
  reviewed: ReviewedDraft;
}
const reviewedCopies = new WeakMap<ReviewedReviewCopy, ReviewedReviewCopy>();

/** Parse and verify the whole portable draft before any local document is installed. */
export async function parseReviewCopy(value: unknown): Promise<ReviewedReviewCopy> {
  const parsed = reviewCopyEnvelopeSchema.safeParse(structuredClone(value));
  if (!parsed.success) throw new Error('This is not a supported reviewer copy. Choose a current DonDocs reviewer file.');
  const envelope = parsed.data;
  for (const checkpoint of envelope.round.checkpoints ?? []) {
    assertCheckpointRound(await parseReviewCheckpoint(checkpoint), envelope.round);
  }
  let reviewed: ReviewedDraft;
  try { reviewed = parseDraftFile(envelope.draft, false, true); }
  catch { throw new Error('This reviewer file does not contain a complete readable native draft.'); }
  if (!supportsReviewComments(reviewed.session)) throw new Error('This review copy is not supported native correspondence.');
  if (reviewed.session.timestamp !== envelope.round.createdAt) throw new Error('This reviewer copy has an inconsistent revision timestamp.');
  if (await reviewPayloadDigest(envelope.draft) !== envelope.round.baselineDigest) throw new Error('This reviewer copy does not match its recorded baseline. Ask for a new copy.');
  const result = { envelope, reviewed };
  reviewedCopies.set(result, structuredClone(result));
  return result;
}

/** Persist the document, pin and reviewer association in one committed transaction. */
export async function openReviewCopy(input: ReviewedReviewCopy, target = captureDocumentTarget()): Promise<'applied' | 'stale'> {
  const owned = reviewedCopies.get(input);
  if (!owned) throw new Error('Prepare this reviewer copy again before opening it.');
  assertCurrent(target);
  const { envelope, reviewed } = structuredClone(owned);
  return withAttachmentStaging(async () => {
    const existing = await readReviewRound(envelope.round.id);
    if (existing) await buildReviewCopy(existing);
    const prepared = await prepareReviewedDocument(reviewed, () => isCurrentDocumentTarget(target), true);
    if (!prepared) return 'stale';
    const snapshot = copyPreparedDocument(prepared);
    const baselineSession = serializeDocumentSnapshot(snapshot, envelope.round.createdAt);
    const rebuilt = await buildDraftFileFromSnapshot(snapshot, envelope.round.createdAt);
    if (await reviewPayloadDigest(rebuilt) !== envelope.round.baselineDigest) throw new Error('This reviewer copy needs a newer reader. No review document was opened.');
    assertCurrent(target);
    const round = parseReviewRound({ kind: 'dondocs-review-round', version: 1, ...envelope.round,
      baseline: { ts: envelope.round.createdAt, session: baselineSession } });
    const id = `review-copy_${crypto.randomUUID()}`, name = `Review: ${round.label}`;
    const record: StoredDocument = { id, meta: { id, title: name, name, docType: snapshot.docType, updatedAt: Date.now(), nativeReviewText: true },
      session: serializeDocumentSnapshot(snapshot, Date.now()) };
    if (!await idbInstallReviewCopy(record, round, { documentId: id, roundId: round.id, baselineDigest: round.baselineDigest })) {
      throw new Error('The reviewer copy could not be saved completely. Your current draft has not changed.');
    }
    return openCommittedReviewCopy(prepared, record, target) === 'applied' ? 'applied' : 'stale';
  });
}

export interface PreparedReviewCopy { readonly review: ChangeReport }
const preparedCopies = new WeakMap<PreparedReviewCopy, ReviewCopyEnvelope>();

/** Reuse full document marking/privacy review, including raw checkpoint values and declared markings. */
function reviewCopyExportReport(owned: ReviewCopyEnvelope, policy: PolicyResolution): ChangeReport {
  const parsed = parseDraftFile(owned.draft, false, true);
  const session = { ...parsed.session,
    formData: { ...parsed.session.formData, ...(parsed.basicLetter ? { basicLetterFile: parsed.basicLetter } : {}) },
    enclosures: parsed.session.enclosures.map((enclosure, index) => ({ ...enclosure, file: parsed.files[index] })) };
  const empty = { ...session, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [],
    endItems: [], publicationTables: {}, reviewComments: undefined };
  const retained = checkpointRetainedContent(owned.round.checkpoints ?? []);
  // Keep report identity/control exclusions when scanning copy-only asset metadata.
  retained.text.push(...documentTextFields(session, 'share', { includeUnknownDataUris: true })
    .filter(field => field.role !== 'control')
    .map(field => ({ field: field.label, value: field.text })));
  return prepareChangeReport(captureChangeReport({ label: 'Empty', title: '', session: empty },
    { label: 'Review baseline', title: owned.round.label, session }, new Date(owned.round.createdAt).toISOString(),
    retained), policy);
}

export function prepareReviewCopyExport(envelope: ReviewCopyEnvelope, policy: PolicyResolution): PreparedReviewCopy {
  const captured = builtCopies.get(envelope);
  if (!captured) throw new Error('Prepare the retained baseline again before downloading a reviewer copy.');
  const owned = structuredClone(captured);
  const prepared = Object.freeze({ review: reviewCopyExportReport(owned, policy) });
  preparedCopies.set(prepared, owned);
  return prepared;
}

export function downloadReviewCopy(prepared: PreparedReviewCopy, policy: PolicyResolution): void {
  const envelope = preparedCopies.get(prepared);
  if (!envelope) throw new Error('Review this copy before downloading it.');
  reviewCopyExportReport(envelope, policy);
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  if (bytes.byteLength > MAX_REVIEW_COPY_BYTES) throw new Error('This review copy exceeds the 100 MB transfer limit.');
  triggerDownload(bytes, `dondocs-review-${envelope.round.id}.json`, 'application/json');
}

export function initialReviewLabel(): string {
  return deriveTitle(getSerializedSession()).slice(0, 120);
}

/** Only the open local source may deliberately change a round's lifecycle. */
export async function transitionReviewRound(round: ReviewRound, transition: ReviewRoundTransition,
  replacementId?: string, target = captureDocumentTarget()): Promise<ReviewRound> {
  assertCurrent(target);
  if (round.ownerDocumentId !== target.scope.documentId) {
    throw new Error('Open the original source draft to change this review round.');
  }
  if (hasPendingReviewWrites(target.scope.documentId)) await flushPendingReviewWrites(target.scope.documentId);
  useDocumentsStore.getState().saveCurrent();
  await flushDocumentWrites();
  assertCurrent(target);
  const replacement = replacementId ? await readReviewRound(replacementId) : undefined;
  if (replacementId && !replacement) throw new Error('The replacement review is no longer available.');
  const next = planReviewRoundTransition(round, transition, replacement ?? undefined);
  if (!await idbTransitionReviewRound(round, next, () => isCurrentDocumentTarget(target))) {
    throw new Error('The round, source or replacement changed before the state could be saved. Refresh Reviews and try again.');
  }
  scheduleBackup();
  return next;
}
