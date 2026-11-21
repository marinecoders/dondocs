import { getExportDeploymentPolicy } from '@/config/classification';
import { captureDocumentTarget, isCurrentDocumentTarget } from '@/stores/documentsStore';
import { readAttachment } from './attachments';
import { triggerDownload } from './encoding';
import { assertRetainedTextPolicy } from './retainedDocumentTextPolicy';
import { readReviewReturnReceipt, readReviewReturnReceipts, type ReviewReturnReceipt } from './reviewReturns';
import { validateWordSourceFile } from './wordSourceResources';

export async function listRetainedWordReturns(documentId: string): Promise<ReviewReturnReceipt[]> {
  return (await readReviewReturnReceipts()).filter(receipt => receipt.documentId === documentId && receipt.wordSource)
    .sort((left, right) => right.importedAt - left.importedAt);
}

/** Re-read local ownership and validate exact bytes before delivering a saved original. */
export async function downloadRetainedWordReturn(roundId: string, returnId: string): Promise<void> {
  const target = captureDocumentTarget();
  const current = () => {
    if (!target || !isCurrentDocumentTarget(target)) throw new Error('The draft changed. Open its saved Word returns again.');
  };
  current();
  const receipt = await readReviewReturnReceipt(roundId, returnId);current();
  const source = receipt?.wordSource;
  if (!source || receipt.documentId !== target!.scope.documentId) throw new Error('This saved Word return does not belong to the open draft.');
  const result = await readAttachment(source.fileRef.id);current();
  if (result.status !== 'found') throw new Error('The returned Word original is unavailable. Restore a complete workspace backup or keep your original file.');
  await validateWordSourceFile(result.attachment, source);current();
  const policy = await getExportDeploymentPolicy(undefined, true);current();
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertRetainedTextPolicy([source.name, source.retainedText], policy);
  triggerDownload(new Uint8Array(result.attachment.data), source.name, source.fileRef.type);
}
