import { getExportDeploymentPolicy } from '@/config/classification';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { createExportController, type ExportControllerPorts, type ExportGate } from '@/lib/exportController';
import { notifyObserver } from '@/lib/observers';
import { createExportArtifact } from '@/lib/exportExecution';
import { idbAppendWordHandoff } from '@/lib/documentsDb';
import { assertActiveReviewRound, parseReviewRound, type ReviewRound } from '@/lib/reviewRounds';
import { assertRetainedDocumentTextPolicy, assertRetainedTextPolicy } from '@/lib/retainedDocumentTextPolicy';
import { buildWordReviewHandoff } from '@/lib/wordReviewBaseline';
import { readWordDocument, WORD_DOCUMENT_TYPE } from '@/services/docx/import/readWord';
import { stampWordReviewIdentity } from '@/services/docx/review/identity';
import { issuedProofreadCommentDigest } from '@/services/docx/review/proofreadComments';
import { prepareSessionState } from '@/stores/documentStore';
import { captureDocumentTarget, isCurrentDocumentTarget, type DocumentTarget } from '@/stores/documentsStore';
import { scheduleBackup } from '@/stores/backupStore';
import { openBrowserExportDelivery } from '@/utils/exportDelivery';
import { withWordReviewAssets } from './wordReviewAssets';
import { renderPreparedCorrespondence, type CorrespondenceRendererPorts } from './correspondence';

interface WordReviewExportPorts {
  gate: ExportGate;
  renderer: CorrespondenceRendererPorts;
  resolvePolicy?: ExportControllerPorts['resolvePolicy'];
  openDelivery?: ExportControllerPorts['openDelivery'];
  onSaved?(round: ReviewRound): void;
}
interface Operation { id: string; round: ReviewRound; target: DocumentTarget }
const MAX_DOCX_BYTES = 20 * 1024 * 1024;

/** Use the application's existing approval, worker, export gate and delivery
 * lease. The only added artifact is an editable locator into a local baseline.
 */
export function createWordReviewExport(ports: WordReviewExportPorts) {
  let active = true, operation: Operation | undefined;
  const policy = ports.resolvePolicy ?? (retry => getExportDeploymentPolicy(undefined, retry));
  const assertCurrent = (owned: Operation, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!active || operation !== owned || !isCurrentDocumentTarget(owned.target)) throw new Error('The open draft changed. Prepare this saved Word review copy again.');
  };
  const controller = createExportController({
    gate: ports.gate, resolvePolicy: async retry => {
      const owned = operation, result = await policy(retry);
      if (!owned) throw new Error('Prepare a saved Word review first.');
      assertCurrent(owned);
      assertRetainedDocumentTextPolicy(owned.round.baseline.session, result);
      assertRetainedTextPolicy([owned.round.label], result);
      return result;
    },
    openDelivery: target => {
      const owned = operation;
      if (!owned) throw new Error('Prepare a saved Word review first.');
      assertCurrent(owned);
      const lease = (ports.openDelivery ?? openBrowserExportDelivery)(target);
      return { deliver: artifact => {
        assertCurrent(owned);
        if (artifact.job.id !== owned.id) throw new Error('This Word artifact belongs to a different review request.');
        return lease.deliver(artifact);
      }, release: () => lease.release() };
    },
    render: async (ready, signal) => {
      const owned = operation;
      if (!owned || ready.job.id !== owned.id) throw new Error('The Word review export is no longer owned by this request.');
      assertCurrent(owned, signal);
      const currentPolicy = await policy(true);
      assertCurrent(owned, signal);
      if (currentPolicy.status !== 'ready' || currentPolicy.policy.identity !== ready.job.policyIdentity) throw new Error('The deployment policy changed. Prepare and review this Word copy again.');
      // Verify the complete portable baseline, including its owned resources,
      // before rendering; current editor content never supplies a substitute.
      const artifact = await withWordReviewAssets(owned.round, ports.renderer.assets, signal, assets => {
        assertCurrent(owned, signal);
        return renderPreparedCorrespondence(ready, { ...ports.renderer, assets }, signal);
      });
      assertCurrent(owned, signal);
      if (artifact.completeness !== 'complete') return artifact;
      if (artifact.blob.size > MAX_DOCX_BYTES) throw new Error('Word review copies must be smaller than 20 MB.');
      const bytes = new Uint8Array(await artifact.blob.arrayBuffer());
      assertCurrent(owned, signal);
      const imported = await readWordDocument(bytes, ready.job.filename, signal);
      let issuedProofreadComments: string[] = [];
      if (ready.job.wordProofreadComments) {
        issuedProofreadComments = await Promise.all(imported.comments.flatMap(comment => {
          const digest = issuedProofreadCommentDigest(comment);
          return digest ? [digest] : [];
        }));
      }
      const id = crypto.randomUUID(), createdAt = Math.max(Date.now(), owned.round.createdAt);
      const plan = await buildWordReviewHandoff(owned.round, imported, { id, createdAt, docxSha256: imported.source.sha256 }, signal);
      const tagged = await stampWordReviewIdentity(bytes, { handoffId: id, roundId: owned.round.id, baselineDigest: owned.round.baselineDigest }, plan.sourceIndexes, signal);
      const taggedBytes = new Uint8Array(tagged);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', taggedBytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      assertCurrent(owned, signal);
      const latestPolicy = await policy(true);
      assertCurrent(owned, signal);
      if (latestPolicy.status !== 'ready' || latestPolicy.policy.identity !== ready.job.policyIdentity) throw new Error('The deployment policy changed. Prepare and review this Word copy again.');
      assertRetainedTextPolicy([imported.source.name, imported.source.retainedText], latestPolicy);
      const saved = await idbAppendWordHandoff(owned.round, { ...plan.receipt, docxSha256: digest,
        ...(issuedProofreadComments.length ? { issuedProofreadComments } : {}),
      }, () => active && operation === owned && !signal.aborted && isCurrentDocumentTarget(owned.target));
      if (!saved) throw new Error('The review baseline changed or its Word locator could not be saved. No copy was delivered.');
      owned.round = saved;
      scheduleBackup();
      assertCurrent(owned, signal);
      notifyObserver(ports.onSaved, parseReviewRound(saved));
      return createExportArtifact(ready, new Blob([taggedBytes], { type: WORD_DOCUMENT_TYPE }));
    },
  });
  return Object.freeze({
    controller,
    request(roundInput: ReviewRound, wordProofreadComments = false): boolean {
      const round = parseReviewRound(roundInput), target = captureDocumentTarget();
      if (!active || !target || !round.ownerDocumentId || round.ownerDocumentId !== target.scope.documentId) throw new Error('Open the original native draft that owns this review first.');
      assertActiveReviewRound(round);
      const previous = operation, id = crypto.randomUUID();
      operation = { id, round, target };
      const captured = captureDocumentRevision({ documentId: target.scope.documentId, epoch: target.scope.epoch,
        editSequence: target.editSequence, capturedAt: round.baseline.ts }, prepareSessionState(round.baseline.session, true));
      const accepted = controller.request({ id, captured, target: 'docx', ...(wordProofreadComments ? { wordProofreadComments } : {}),
        filename: `dondocs-word-review-${round.id}.docx` });
      if (!accepted) operation = previous;
      return accepted;
    },
    activate() { active = true; },
    dispose() { active = false;controller.cancel(); },
  });
}
