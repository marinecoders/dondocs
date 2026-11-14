import { captureDocumentTarget, isCurrentDocumentTarget, prepareReviewedDocument, copyPreparedDocument,
  openCommittedDocument, flushDocumentWrites, type DocumentTarget } from '@/stores/documentsStore';
import { serializeDocumentSnapshot } from './documentSerialization';
import { idbPutDocument, idbDeleteDocumentIfUnchanged, type StoredDocument } from './documentsDb';
import { withAttachmentStaging } from './attachments';
import { parseSharedDocument, validateAssetShareExpiration } from './assetShare';

/** Resources commit before metadata; a failed capture never replaces the current draft. */
export async function openSharedDocument(value: unknown, target: DocumentTarget | null = captureDocumentTarget(), active: () => boolean = () => true): Promise<'applied' | 'stale'> {
  const owned = structuredClone(value);
  const reviewed = await parseSharedDocument(owned);
  const current = () => active() && isCurrentDocumentTarget(target);
  if (!current()) return 'stale';
  return withAttachmentStaging(async () => {
    const prepared = await prepareReviewedDocument(reviewed, current, true);
    if (!prepared || !current()) return 'stale';
    await flushDocumentWrites();
    if (!current()) return 'stale';
    const snapshot = copyPreparedDocument(prepared), now = Date.now();
    const id = `shared_${crypto.randomUUID()}`;
    const record: StoredDocument = { id,
      meta: { id, title: String(snapshot.formData.subject || 'Shared document'), docType: snapshot.docType, updatedAt: now,
        ...(snapshot.documentCategory === 'forms' ? {} : { nativeReviewText: true }) },
      session: serializeDocumentSnapshot(snapshot, now) };
    validateAssetShareExpiration(owned);
    if (!await idbPutDocument(record)) throw new Error('The shared document could not be saved completely. Your current draft has not changed.');
    try {
      validateAssetShareExpiration(owned);
      if (!active()) throw new Error('Opening this shared document was cancelled. Your current draft has not changed.');
    }
    catch (cause) {
      const removed = await idbDeleteDocumentIfUnchanged(record);
      if (removed !== 'deleted' && removed !== 'already-deleted') throw new Error('Opening this share stopped while saving. The copy was not opened; check local storage before using any recovered shared record.', { cause });
      throw cause;
    }
    return openCommittedDocument(prepared, record, target) === 'applied' ? 'applied' : 'stale';
  });
}
