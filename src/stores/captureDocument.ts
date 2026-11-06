import { captureDocumentRevision } from '@/lib/capturedDocument';
import { useDocumentStore } from './documentStore';
import { captureDocumentTarget, isCurrentDocumentTarget } from './documentsStore';

/** Store adapter: identity and complete content are captured before any await. */
export function captureCurrentDocumentRevision() {
  const target = captureDocumentTarget();
  if (!target) throw new Error('There is no open document to capture.');
  const captured = captureDocumentRevision({
    documentId: target.scope.documentId,
    epoch: target.scope.epoch,
    editSequence: target.editSequence,
    capturedAt: Date.now(),
  }, useDocumentStore.getState().getSnapshot());
  if (!isCurrentDocumentTarget(target)) throw new Error('The document changed while it was being captured.');
  return captured;
}
